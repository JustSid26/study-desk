import "server-only";

import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { problems, problemTags, type Difficulty } from "@/db/schema";
import { currentStreak, bestStreak, dayKey, addDays, daysBetween, today } from "./dates";
import { noteActivity } from "./vault";
import { getSettings } from "./sync";

/**
 * Everything the read-only screens ask for.
 *
 * There is no study-time table any more, and no subjects/notes tables: a day is
 * "active" because you solved a problem or touched a note in the vault, and the
 * note side of that comes from file mtimes on disk, not from a row.
 */

/* ------------------------------- problems -------------------------------- */

export interface ProblemView {
  id: string;
  slug: string;
  number: number | null;
  title: string;
  url: string | null;
  difficulty: Difficulty;
  status: string;
  solvedDay: string;
  minutes: number | null;
  lang: string | null;
  notes: string;
  attempts: number;
  confidence: number | null;
  source: string;
  tags: string[];
}

export async function getProblems(): Promise<ProblemView[]> {
  const rows = await db
    .select()
    .from(problems)
    .orderBy(desc(problems.solvedDay), desc(problems.createdAt));
  const tagRows = await db.select().from(problemTags);
  const tagsBy = new Map<string, string[]>();
  tagRows.forEach((t) => {
    const list = tagsBy.get(t.problemId) ?? [];
    list.push(t.tag);
    tagsBy.set(t.problemId, list);
  });
  return rows.map((p) => ({ ...p, tags: tagsBy.get(p.id) ?? [] }));
}

/** Solved counts per topic tag, for the patterns chart. */
export async function getTagCounts(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db
    .select({ tag: problemTags.tag, count: sql<number>`count(*)` })
    .from(problemTags)
    .groupBy(problemTags.tag)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) || 0 }));
}

/* -------------------------------- activity -------------------------------- */

export interface DayActivity {
  problems: number;
  notes: number;
}

/** The heatmap and the streaks, keyed by local calendar day. */
export async function getActivity(): Promise<Map<string, DayActivity>> {
  const [problemRows, notesByDay] = await Promise.all([
    db
      .select({ day: problems.solvedDay, n: sql<number>`count(*)` })
      .from(problems)
      .groupBy(problems.solvedDay),
    noteActivity(),
  ]);

  const map = new Map<string, DayActivity>();
  const at = (day: string) => {
    const cur = map.get(day) ?? { problems: 0, notes: 0 };
    map.set(day, cur);
    return cur;
  };

  problemRows.forEach((r) => (at(r.day).problems += Number(r.n) || 0));
  notesByDay.forEach((n, day) => (at(day).notes += Number(n) || 0));

  return map;
}

const isActive = (a?: DayActivity) => !!a && (a.problems > 0 || a.notes > 0);

/* ------------------------------- revisits --------------------------------- */

export interface RevisitEntry {
  problem: ProblemView;
  reason: string;
  daysAgo: number;
}

export function buildRevisitQueue(list: ProblemView[], staleAfter: number): RevisitEntry[] {
  const now = today();
  return list
    .map((p) => {
      const daysAgo = daysBetween(p.solvedDay, now);
      if (p.status === "revisit") {
        return { problem: p, reason: "You flagged it", daysAgo };
      }
      if (daysAgo >= staleAfter) {
        return { problem: p, reason: `Not seen in ${daysAgo} days`, daysAgo };
      }
      return null;
    })
    .filter((x): x is RevisitEntry => x !== null)
    .sort(
      (a, b) =>
        Number(b.problem.status === "revisit") - Number(a.problem.status === "revisit") ||
        b.daysAgo - a.daysAgo,
    );
}

/* ------------------------------- dashboard -------------------------------- */

export async function getDashboard() {
  const [activity, problemList, settingsRow] = await Promise.all([
    getActivity(),
    getProblems(),
    getSettings(),
  ]);

  const activeDays = new Set(
    [...activity.entries()].filter(([, a]) => isActive(a)).map(([d]) => d),
  );

  let weekProblems = 0;
  for (let i = 0; i < 7; i++) {
    weekProblems += activity.get(dayKey(addDays(new Date(), -i)))?.problems ?? 0;
  }

  const todayActivity = activity.get(today()) ?? { problems: 0, notes: 0 };

  const byDifficulty: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  problemList.forEach((p) => (byDifficulty[p.difficulty] += 1));

  // Every file in the vault is counted exactly once by `noteActivity`, so the
  // day buckets sum to the number of notes on disk.
  let noteCount = 0;
  activity.forEach((a) => (noteCount += a.notes));

  return {
    settings: settingsRow,
    activity,
    activeDays,
    streak: currentStreak(activeDays),
    best: bestStreak(activeDays),
    todayActivity,
    weekProblems,
    problems: problemList,
    byDifficulty,
    noteCount,
    revisitQueue: buildRevisitQueue(problemList, settingsRow.revisitDays),
  };
}
