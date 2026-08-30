"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  problems,
  problemTags,
  catalogue,
  settings,
  timetable,
  drafts,
  submissions,
  questionCache,
} from "@/db/schema";
import {
  getSettings,
  patchSettings,
  syncLeetCode,
  syncCatalogue,
  enrichFromCatalogue,
} from "@/lib/sync";
import { envCredentials, LeetCodeError, type Credentials } from "@/lib/leetcode";
import { deleteEntry, listSubjects, recentFiles } from "@/lib/vault";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

function fail(error: string): Fail {
  return { ok: false, error };
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function touchAll() {
  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/leetcode");
  revalidatePath("/practice");
  revalidatePath("/timetable");
  revalidatePath("/setup");
}

/* --------------------------------- goals ---------------------------------- */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const goalsSchema = z.object({
  dailyProblems: z.number().finite("Give a daily problems target."),
  goalEasy: z.number().finite("Give an Easy target."),
  goalMedium: z.number().finite("Give a Medium target."),
  goalHard: z.number().finite("Give a Hard target."),
  revisitDays: z.number().finite("Give a revisit interval in days."),
});

function num(fd: FormData, key: string, fallback: number): number {
  const raw = str(fd, key).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export async function updateGoals(fd: FormData): Promise<
  | Ok<{
      dailyProblems: number;
      goalEasy: number;
      goalMedium: number;
      goalHard: number;
      revisitDays: number;
    }>
  | Fail
> {
  try {
    const current = await getSettings();

    const parsed = goalsSchema.safeParse({
      dailyProblems: num(fd, "dailyProblems", current.dailyProblems),
      goalEasy: num(fd, "goalEasy", current.goalEasy),
      goalMedium: num(fd, "goalMedium", current.goalMedium),
      goalHard: num(fd, "goalHard", current.goalHard),
      revisitDays: num(fd, "revisitDays", current.revisitDays),
    });
    if (!parsed.success) return fail("Every target has to be a number.");

    const next = {
      dailyProblems: clamp(parsed.data.dailyProblems, 0, 50),
      goalEasy: clamp(parsed.data.goalEasy, 0, 5000),
      goalMedium: clamp(parsed.data.goalMedium, 0, 5000),
      goalHard: clamp(parsed.data.goalHard, 0, 5000),
      revisitDays: clamp(parsed.data.revisitDays, 1, 365),
    };

    await patchSettings(next);
    touchAll();
    return { ok: true, ...next };
  } catch {
    return fail("Couldn't save those targets. Try again.");
  }
}

/* -------------------------------- leetcode -------------------------------- */

const usernameSchema = z
  .string()
  .trim()
  .min(1, "Add your LeetCode username — it's the name in your profile URL.")
  .max(60, "That's longer than a LeetCode username can be.")
  .regex(/^[A-Za-z0-9_.-]+$/, "A LeetCode username is letters, numbers, dots, dashes and underscores.");

export async function saveLeetCodeUsername(
  name: string,
): Promise<Ok<{ username: string }> | Fail> {
  const parsed = usernameSchema.safeParse(name ?? "");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That username isn't valid.");

  try {
    await patchSettings({ leetcodeUsername: parsed.data });
    revalidatePath("/");
    revalidatePath("/setup");
    return { ok: true, username: parsed.data };
  } catch {
    return fail("Couldn't save that username. Try again.");
  }
}

/**
 * The sync. Every LeetCodeError message is already written for a person, so it
 * is passed through untouched rather than replaced with a generic apology.
 */
export async function runSync(fd: FormData): Promise<
  | Ok<{
      mode: "public" | "session";
      username: string;
      imported: number;
      updated: number;
      skipped: number;
      enriched: number;
      catalogueRows: number;
      limitation?: string;
    }>
  | Fail
> {
  let username = str(fd, "username").trim();

  try {
    const current = await getSettings();
    if (!username) username = (current.leetcodeUsername ?? "").trim();
  } catch {
    return fail("Couldn't read your settings. Try again.");
  }

  if (!username) {
    return fail("Add your LeetCode username first — it's the name in your profile URL.");
  }

  const session = str(fd, "session").trim();
  const csrf = str(fd, "csrf").trim();
  const env = envCredentials();
  const creds: Credentials = {
    session: session || env.session || null,
    csrf: csrf || env.csrf || null,
  };

  const refreshCatalogue = str(fd, "refreshCatalogue") !== "";

  try {
    const result = await syncLeetCode(username, creds, { refreshCatalogue });
    const enriched = await enrichFromCatalogue();

    touchAll();
    return {
      ok: true,
      mode: result.mode,
      username: result.username,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      enriched,
      catalogueRows: result.catalogueRows,
      limitation: result.limitation,
    };
  } catch (err) {
    const message =
      err instanceof LeetCodeError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : "The sync failed. Try again in a minute.";

    try {
      await patchSettings({ lcLastError: message });
    } catch {
      /* the sync failure is what matters; recording it is best-effort */
    }

    revalidatePath("/");
    revalidatePath("/setup");
    return fail(message);
  }
}

export async function refreshCatalogue(): Promise<Ok<{ count: number }> | Fail> {
  try {
    const count = await syncCatalogue();
    if (!count) {
      return fail("LeetCode returned an empty catalogue. Try again in a few minutes.");
    }
    revalidatePath("/");
    revalidatePath("/leetcode");
    revalidatePath("/setup");
    return { ok: true, count };
  } catch (err) {
    const message =
      err instanceof LeetCodeError ? err.message : "Couldn't refresh the problem catalogue.";
    try {
      await patchSettings({ lcLastError: message });
    } catch {
      /* best effort */
    }
    revalidatePath("/setup");
    return fail(message);
  }
}

/* --------------------------------- danger --------------------------------- */

/**
 * Wipes every table and the whole notes vault. The literal word "erase" has to
 * be typed — a click alone can't do this.
 */
export async function clearEverything(
  confirmation: string,
): Promise<Ok<{ filesRemoved: number }> | Fail> {
  if ((confirmation ?? "").trim().toLowerCase() !== "erase") {
    return fail('Type "erase" to confirm. Nothing was deleted.');
  }

  try {
    // Children before parents, so a foreign key never blocks the wipe.
    await db.delete(problemTags);
    await db.delete(problems);
    await db.delete(submissions);
    await db.delete(drafts);
    await db.delete(questionCache);
    await db.delete(timetable);
    await db.delete(catalogue);
    await db.delete(settings);

    // The vault is the notes: emptying it means removing every subject folder.
    let filesRemoved = 0;
    try {
      filesRemoved = (await recentFiles(100_000)).length;
      for (const entry of await listSubjects()) {
        try {
          await deleteEntry(entry.rel);
        } catch {
          /* a folder already gone is a folder already deleted */
        }
      }
    } catch {
      /* an unreadable vault means there is nothing here to remove */
    }

    await getSettings(); // rebuild the singleton with defaults
    touchAll();
    return { ok: true, filesRemoved };
  } catch {
    return fail("Couldn't clear the database. Nothing may have been deleted.");
  }
}

/* --------------------------------- export --------------------------------- */

/** The whole database as plain JSON. Metadata only — the vault is a folder you
 *  back up by copying it, and the question cache is re-fetchable. */
export async function exportJson(): Promise<
  | Ok<{
      exportedAt: number;
      version: 1;
      data: Record<string, unknown[]>;
    }>
  | Fail
> {
  try {
    const [
      problemRows,
      problemTagRows,
      catalogueRows,
      timetableRows,
      draftRows,
      submissionRows,
      settingsRows,
    ] = await Promise.all([
      db.select().from(problems),
      db.select().from(problemTags),
      db.select().from(catalogue),
      db.select().from(timetable),
      db.select().from(drafts),
      db.select().from(submissions),
      db.select().from(settings),
    ]);

    return {
      ok: true,
      exportedAt: Date.now(),
      version: 1,
      data: {
        problems: problemRows,
        problemTags: problemTagRows,
        catalogue: catalogueRows,
        timetable: timetableRows,
        drafts: draftRows,
        submissions: submissionRows,
        settings: settingsRows,
      },
    };
  } catch {
    return fail("Couldn't build the export. Try again.");
  }
}
