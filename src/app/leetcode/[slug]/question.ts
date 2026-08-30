import "server-only";

/**
 * Loading a problem statement: cache first, network second, cache again as the
 * fallback when the network fails.
 *
 * This lives beside the page rather than inside it because it is the one piece
 * of the screen that is genuinely impure — it reads the clock and writes to the
 * database, neither of which belongs in a render.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { catalogue, questionCache } from "@/db/schema";
import type { Difficulty, QuestionCacheRow } from "@/db/schema";
import { LeetCodeError, envCredentials, fetchQuestion } from "@/lib/leetcode";

const WEEK_MS = 7 * 86_400_000;

export interface QuestionView {
  slug: string;
  questionId: string;
  number: number;
  title: string;
  difficulty: Difficulty;
  /** raw HTML — the caller sanitises it */
  content: string;
  hints: string[];
  snippets: Record<string, string>;
  sampleTestCase: string;
  acRate: number | null;
  fetchedAt: number;
}

export type QuestionLoad =
  | {
      ok: true;
      view: QuestionView;
      topics: string[];
      /** set when the fetch failed and this is the cached copy */
      stale: string | null;
    }
  | { ok: false; error: string };

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function fromRow(row: QuestionCacheRow): QuestionView {
  return {
    slug: row.slug,
    questionId: row.questionId,
    number: row.number,
    title: row.title,
    difficulty: row.difficulty,
    content: row.content,
    hints: parseJson<string[]>(row.hints, []).filter((h) => typeof h === "string"),
    snippets: parseJson<Record<string, string>>(row.snippets, {}),
    sampleTestCase: row.sampleTestCase,
    acRate: row.acRate,
    fetchedAt: row.fetchedAt,
  };
}

export async function loadQuestion(slug: string): Promise<QuestionLoad> {
  const [cached, listed] = await Promise.all([
    db.select().from(questionCache).where(eq(questionCache.slug, slug)).limit(1),
    db
      .select({ topicTags: catalogue.topicTags, acRate: catalogue.acRate })
      .from(catalogue)
      .where(eq(catalogue.slug, slug))
      .limit(1),
  ]);

  const view = cached[0] ? fromRow(cached[0]) : null;
  let topics = parseJson<string[]>(listed[0]?.topicTags ?? "[]", []).filter(
    (t): t is string => typeof t === "string",
  );

  if (view && Date.now() - view.fetchedAt <= WEEK_MS) {
    return { ok: true, view: withAcRate(view, listed[0]?.acRate), topics, stale: null };
  }

  try {
    const q = await fetchQuestion(slug, envCredentials());
    const fetchedAt = Date.now();
    const row = {
      slug: q.slug,
      questionId: q.questionId,
      number: q.number,
      title: q.title,
      difficulty: q.difficulty,
      content: q.content,
      hints: JSON.stringify(q.hints),
      snippets: JSON.stringify(q.snippets),
      sampleTestCase: q.sampleTestCase,
      exampleTestcases: q.exampleTestcases,
      acRate: q.acRate,
      fetchedAt,
    };

    await db
      .insert(questionCache)
      .values(row)
      .onConflictDoUpdate({ target: questionCache.slug, set: row });

    if (q.topicTags.length) topics = q.topicTags;

    return {
      ok: true,
      topics,
      stale: null,
      view: {
        slug: q.slug,
        questionId: q.questionId,
        number: q.number,
        title: q.title,
        difficulty: q.difficulty,
        content: q.content,
        hints: q.hints,
        snippets: q.snippets,
        sampleTestCase: q.sampleTestCase,
        acRate: q.acRate,
        fetchedAt,
      },
    };
  } catch (err) {
    // A cached copy is worth far more than an error page. Only admit that
    // something went wrong when there is nothing to fall back on.
    if (!view) {
      return {
        ok: false,
        error:
          err instanceof LeetCodeError
            ? err.message
            : "Couldn't load that problem from LeetCode.",
      };
    }
    return {
      ok: true,
      view: withAcRate(view, listed[0]?.acRate),
      topics,
      stale:
        err instanceof LeetCodeError && err.kind === "network"
          ? "LeetCode is unreachable, so this is the saved copy."
          : "Couldn't refresh from LeetCode, so this is the saved copy.",
    };
  }
}

/** The catalogue keeps an acceptance rate too; use it when the cache has none. */
function withAcRate(view: QuestionView, fallback: number | null | undefined): QuestionView {
  return view.acRate == null && fallback != null ? { ...view, acRate: fallback } : view;
}
