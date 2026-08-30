"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  problems,
  problemTags,
  DIFFICULTY,
  PROBLEM_STATUS,
  type Difficulty,
} from "@/db/schema";
import { newId } from "@/lib/id";
import { isValidDay, today } from "@/lib/dates";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

function fail(error: string): Fail {
  return { ok: false, error };
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "That input isn't valid.";
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function touch() {
  revalidatePath("/");
  revalidatePath("/leetcode");
}

/** "https://leetcode.com/problems/two-sum/" -> "two-sum" */
function slugFromUrl(url: string): string | null {
  const m = /\/problems\/([A-Za-z0-9-]+)/.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function replaceProblemTags(problemId: string, tags: string[]) {
  await db.delete(problemTags).where(eq(problemTags.problemId, problemId));
  const clean = [
    ...new Set(tags.map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 60))),
  ].slice(0, 30);
  if (clean.length) {
    await db
      .insert(problemTags)
      .values(clean.map((tag) => ({ problemId, tag })))
      .onConflictDoNothing();
  }
}

/* --------------------------------- save ----------------------------------- */

const saveSchema = z.object({
  id: z.string().nullable(),
  slug: z
    .string()
    .min(1, "Add a title or a LeetCode link so the problem has an identity.")
    .max(100),
  number: z.number().int().positive("A problem number is a positive whole number.").nullable(),
  title: z.string().trim().min(1, "What's the problem called?").max(200, "That title is too long."),
  url: z.string().trim().max(500).nullable(),
  difficulty: z.enum(DIFFICULTY),
  status: z.enum(PROBLEM_STATUS),
  solvedDay: z.string().refine(isValidDay, "That isn't a real date."),
  minutes: z
    .number()
    .int("Log whole minutes.")
    .min(1, "Log at least one minute.")
    .max(1440, "That's more than a day.")
    .nullable(),
  lang: z.string().trim().max(40).nullable(),
  notes: z.string().max(20_000, "Those notes are too long to save."),
  confidence: z
    .number()
    .int()
    .min(1, "Confidence runs from 1 to 5.")
    .max(5, "Confidence runs from 1 to 5.")
    .nullable(),
  tags: z.array(z.string()).max(30),
});

function optionalInt(raw: string): number | null | "bad" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "bad";
  return Math.trunc(n);
}

function formTags(fd: FormData): string[] {
  const many = fd.getAll("tags").filter((t): t is string => typeof t === "string");
  const flat = many.flatMap((t) => t.split(","));
  return flat.map((t) => t.trim()).filter(Boolean);
}

/**
 * Create or update. Keyed on slug, so logging "3sum" by hand today and syncing
 * it from LeetCode tomorrow lands on one row rather than two.
 */
export async function saveProblem(
  fd: FormData,
): Promise<Ok<{ id: string; slug: string; created: boolean }> | Fail> {
  const numberRaw = optionalInt(str(fd, "number"));
  if (numberRaw === "bad") return fail("The problem number has to be a number.");
  const minutesRaw = optionalInt(str(fd, "minutes"));
  if (minutesRaw === "bad") return fail("Time spent has to be a number of minutes.");
  const confidenceRaw = optionalInt(str(fd, "confidence"));
  if (confidenceRaw === "bad") return fail("Confidence has to be a number from 1 to 5.");

  const url = str(fd, "url").trim();
  const title = str(fd, "title").trim();
  const givenSlug = str(fd, "slug").trim().toLowerCase();
  const slug = givenSlug || slugFromUrl(url) || slugify(title);

  const parsed = saveSchema.safeParse({
    id: str(fd, "id").trim() || null,
    slug,
    number: numberRaw,
    title,
    url: url || null,
    difficulty: (str(fd, "difficulty").trim() || "Medium") as Difficulty,
    status: str(fd, "status").trim() || "solved",
    solvedDay: str(fd, "solvedDay").trim() || today(),
    minutes: minutesRaw,
    lang: str(fd, "lang").trim() || null,
    notes: str(fd, "notes"),
    confidence: confidenceRaw,
    tags: formTags(fd),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const d = parsed.data;

  try {
    const bySlug = await db
      .select({ id: problems.id, source: problems.source, attempts: problems.attempts })
      .from(problems)
      .where(eq(problems.slug, d.slug))
      .limit(1);

    const existing = bySlug[0] ?? null;

    if (existing && d.id && existing.id !== d.id) {
      return fail(
        "Another entry already uses that LeetCode problem. Edit that one instead of duplicating it.",
      );
    }

    const now = Date.now();

    if (existing) {
      await db
        .update(problems)
        .set({
          number: d.number,
          title: d.title,
          url: d.url,
          difficulty: d.difficulty,
          status: d.status,
          solvedDay: d.solvedDay,
          minutes: d.minutes,
          lang: d.lang,
          notes: d.notes,
          confidence: d.confidence,
          // A row LeetCode owns stays LeetCode's — editing it by hand must not
          // quietly demote it to a manual entry.
          ...(existing.source === "leetcode" ? {} : { source: "manual" as const }),
          updatedAt: now,
        })
        .where(eq(problems.id, existing.id));

      await replaceProblemTags(existing.id, d.tags);
      touch();
      return { ok: true, id: existing.id, slug: d.slug, created: false };
    }

    const id = d.id || newId();
    await db.insert(problems).values({
      id,
      slug: d.slug,
      number: d.number,
      title: d.title,
      url: d.url,
      difficulty: d.difficulty,
      status: d.status,
      solvedDay: d.solvedDay,
      minutes: d.minutes,
      lang: d.lang,
      notes: d.notes,
      attempts: 1,
      confidence: d.confidence,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    await replaceProblemTags(id, d.tags);
    touch();
    return { ok: true, id, slug: d.slug, created: true };
  } catch {
    return fail("Couldn't save that problem. Try again.");
  }
}

export async function deleteProblem(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That problem is no longer in your log.");
  try {
    await db.delete(problems).where(eq(problems.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't delete that problem. Try again.");
  }
}

/** You did it again today: solved, dated now, one more attempt on the clock. */
export async function markReviewed(
  id: string,
): Promise<Ok<{ solvedDay: string; attempts: number }> | Fail> {
  if (!id) return fail("That problem is no longer in your log.");
  try {
    const rows = await db
      .select({ attempts: problems.attempts })
      .from(problems)
      .where(eq(problems.id, id))
      .limit(1);
    if (!rows.length) return fail("That problem is no longer in your log.");

    const day = today();
    const attempts = (rows[0].attempts ?? 1) + 1;

    await db
      .update(problems)
      .set({
        status: "solved",
        solvedDay: day,
        attempts,
        updatedAt: Date.now(),
      })
      .where(eq(problems.id, id));

    touch();
    return { ok: true, solvedDay: day, attempts };
  } catch {
    return fail("Couldn't mark that reviewed. Try again.");
  }
}
