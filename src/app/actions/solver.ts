"use server";

/**
 * The two mutations the in-app problem screen needs.
 *
 * `saveDraft` deliberately does NOT revalidate: it fires every ~800ms while you
 * are typing, and a revalidation would re-render the problem page — and with it
 * the editor — mid-keystroke. The draft only has to survive a reload, and the
 * next server render reads it fresh anyway.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  catalogue,
  drafts,
  problemTags,
  problems,
  questionCache,
  type Difficulty,
} from "@/db/schema";
import { today } from "@/lib/dates";
import { newId } from "@/lib/id";
import { problemUrl } from "@/lib/leetcode";

type Fail = { ok: false; error: string };

const fail = (error: string): Fail => ({ ok: false, error });

const firstIssue = (err: z.ZodError) =>
  err.issues[0]?.message ?? "That input isn't valid.";

const slugField = z
  .string()
  .trim()
  .min(1, "That problem has no name.")
  .max(120)
  .regex(/^[a-z0-9-]+$/, "That isn't a LeetCode problem name.");

const langField = z
  .string()
  .trim()
  .min(1, "Pick a language first.")
  .max(40)
  .regex(/^[a-z0-9+#._-]+$/i, "That isn't a language LeetCode knows.");

/* --------------------------------- draft ---------------------------------- */

const draftSchema = z.object({
  slug: slugField,
  lang: langField,
  code: z.string().max(200_000, "That solution is too long to keep as a draft."),
});

/** One row per problem and language, so switching languages never loses work. */
export async function saveDraft(
  slug: string,
  lang: string,
  code: string,
): Promise<{ ok: true; savedAt: number } | Fail> {
  const parsed = draftSchema.safeParse({ slug, lang, code });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;

  try {
    const savedAt = Date.now();
    await db
      .insert(drafts)
      .values({ slug: d.slug, lang: d.lang, code: d.code, updatedAt: savedAt })
      .onConflictDoUpdate({
        target: [drafts.slug, drafts.lang],
        set: { code: d.code, updatedAt: savedAt },
      });
    return { ok: true, savedAt };
  } catch {
    return fail("Couldn't save the draft. Your code is still in the editor.");
  }
}

/* ------------------------------ record a solve ----------------------------- */

const acceptedSchema = z.object({
  slug: slugField,
  title: z.string().trim().min(1, "That problem has no title.").max(200),
  lang: langField,
});

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * An Accepted submission fills the tracker in by itself — that is the whole
 * point of solving inside the app. Number, difficulty and topics come from the
 * local cache rather than the client, so a forged request can't invent them.
 *
 * Anything you own — notes, confidence, minutes — is left exactly as it was.
 */
export async function recordAccepted(input: {
  slug: string;
  title: string;
  lang: string;
}): Promise<{ ok: true; created: boolean; solvedDay: string } | Fail> {
  const parsed = acceptedSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;

  try {
    const [cached] = await db
      .select({
        number: questionCache.number,
        title: questionCache.title,
        difficulty: questionCache.difficulty,
      })
      .from(questionCache)
      .where(eq(questionCache.slug, d.slug))
      .limit(1);

    const [listed] = await db
      .select({
        number: catalogue.number,
        title: catalogue.title,
        difficulty: catalogue.difficulty,
        topicTags: catalogue.topicTags,
      })
      .from(catalogue)
      .where(eq(catalogue.slug, d.slug))
      .limit(1);

    const number = cached?.number ?? listed?.number ?? null;
    const title = cached?.title ?? listed?.title ?? d.title;
    const difficulty: Difficulty =
      cached?.difficulty ?? listed?.difficulty ?? "Medium";
    const tags = listed ? parseTags(listed.topicTags) : [];

    const day = today();
    const now = Date.now();

    const [existing] = await db
      .select({ id: problems.id, attempts: problems.attempts })
      .from(problems)
      .where(eq(problems.slug, d.slug))
      .limit(1);

    if (existing) {
      await db
        .update(problems)
        .set({
          number,
          title,
          url: problemUrl(d.slug),
          difficulty,
          status: "solved",
          solvedDay: day,
          lang: d.lang,
          attempts: (existing.attempts ?? 1) + 1,
          source: "leetcode",
          updatedAt: now,
        })
        .where(eq(problems.id, existing.id));

      revalidatePath("/");
      revalidatePath("/leetcode");
      revalidatePath(`/leetcode/${d.slug}`);
      return { ok: true, created: false, solvedDay: day };
    }

    const id = newId();
    await db.insert(problems).values({
      id,
      slug: d.slug,
      number,
      title,
      url: problemUrl(d.slug),
      difficulty,
      status: "solved",
      solvedDay: day,
      lang: d.lang,
      attempts: 1,
      source: "leetcode",
      createdAt: now,
      updatedAt: now,
    });

    if (tags.length) {
      await db
        .insert(problemTags)
        .values(tags.slice(0, 30).map((tag) => ({ problemId: id, tag })))
        .onConflictDoNothing();
    }

    revalidatePath("/");
    revalidatePath("/leetcode");
    revalidatePath(`/leetcode/${d.slug}`);
    return { ok: true, created: true, solvedDay: day };
  } catch {
    return fail("Solved on LeetCode, but the local log didn't update. Log it by hand.");
  }
}

/** Drop a draft once it is no longer wanted. Used by the editor's reset. */
export async function clearDraft(
  slug: string,
  lang: string,
): Promise<{ ok: true } | Fail> {
  const parsed = z.object({ slug: slugField, lang: langField }).safeParse({ slug, lang });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await db
      .delete(drafts)
      .where(and(eq(drafts.slug, parsed.data.slug), eq(drafts.lang, parsed.data.lang)));
    return { ok: true };
  } catch {
    return fail("Couldn't clear that draft.");
  }
}
