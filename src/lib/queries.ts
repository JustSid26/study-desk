import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  subjects,
  topics,
  notes,
  noteTags,
  files,
  sessions,
  problems,
  problemTags,
  type Difficulty,
  type TopicStatus,
} from "@/db/schema";
import {
  currentStreak,
  bestStreak,
  dayKey,
  addDays,
  daysBetween,
  today,
} from "./dates";
import { getSettings } from "./sync";

/* ------------------------------- subjects -------------------------------- */

export interface SubjectWithTopics {
  id: string;
  name: string;
  color: string;
  goalMins: number | null;
  topics: Array<{ id: string; name: string; status: TopicStatus; position: number }>;
  minutesLogged: number;
  noteCount: number;
  progress: number;
  counts: Record<TopicStatus, number>;
}

const MASTERY_WEIGHT: Record<TopicStatus, number> = {
  new: 0,
  learning: 0.34,
  revising: 0.7,
  solid: 1,
};

export async function getSubjects(): Promise<SubjectWithTopics[]> {
  const [subjectRows, topicRows, minuteRows, noteRows] = await Promise.all([
    db.select().from(subjects).orderBy(subjects.position, subjects.createdAt),
    db.select().from(topics).orderBy(topics.position, topics.name),
    db
      .select({ subjectId: sessions.subjectId, mins: sql<number>`sum(${sessions.minutes})` })
      .from(sessions)
      .groupBy(sessions.subjectId),
    db
      .select({ subjectId: notes.subjectId, n: sql<number>`count(*)` })
      .from(notes)
      .groupBy(notes.subjectId),
  ]);

  const minutesBy = new Map(minuteRows.map((r) => [r.subjectId, Number(r.mins) || 0]));
  const notesBy = new Map(noteRows.map((r) => [r.subjectId, Number(r.n) || 0]));

  return subjectRows.map((s) => {
    const own = topicRows.filter((t) => t.subjectId === s.id);
    const counts: Record<TopicStatus, number> = { new: 0, learning: 0, revising: 0, solid: 0 };
    own.forEach((t) => (counts[t.status] += 1));
    const progress = own.length
      ? own.reduce((a, t) => a + MASTERY_WEIGHT[t.status], 0) / own.length
      : 0;

    return {
      id: s.id,
      name: s.name,
      color: s.color,
      goalMins: s.goalMins,
      topics: own.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        position: t.position,
      })),
      minutesLogged: minutesBy.get(s.id) ?? 0,
      noteCount: notesBy.get(s.id) ?? 0,
      progress,
      counts,
    };
  });
}

/* --------------------------------- notes --------------------------------- */

export interface NoteSummary {
  id: string;
  title: string;
  snippet: string;
  kind: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  fileId: string | null;
  fileName: string | null;
  fileSize: number | null;
  mime: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export async function getNotes(): Promise<NoteSummary[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      kind: notes.kind,
      subjectId: notes.subjectId,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      fileId: notes.fileId,
      fileName: files.name,
      fileSize: files.size,
      mime: files.mime,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(subjects, eq(notes.subjectId, subjects.id))
    .leftJoin(files, eq(notes.fileId, files.id))
    .orderBy(desc(notes.updatedAt));

  const tagRows = await db.select().from(noteTags);
  const tagsBy = new Map<string, string[]>();
  tagRows.forEach((t) => {
    const list = tagsBy.get(t.noteId) ?? [];
    list.push(t.tag);
    tagsBy.set(t.noteId, list);
  });

  return rows.map((r) => ({
    ...r,
    snippet: r.body.replace(/[#*`>_\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
    tags: tagsBy.get(r.id) ?? [],
  }));
}

export async function getNote(id: string) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      kind: notes.kind,
      subjectId: notes.subjectId,
      fileId: notes.fileId,
      fileName: files.name,
      fileSize: files.size,
      mime: files.mime,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(files, eq(notes.fileId, files.id))
    .where(eq(notes.id, id))
    .limit(1);
  if (!rows.length) return null;
  const tags = await db.select().from(noteTags).where(eq(noteTags.noteId, id));
  return { ...rows[0], tags: tags.map((t) => t.tag) };
}

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
  const rows = await db.select().from(problems).orderBy(desc(problems.solvedDay), desc(problems.createdAt));
  const tagRows = await db.select().from(problemTags);
  const tagsBy = new Map<string, string[]>();
  tagRows.forEach((t) => {
    const list = tagsBy.get(t.problemId) ?? [];
    list.push(t.tag);
    tagsBy.set(t.problemId, list);
  });
  return rows.map((p) => ({ ...p, tags: tagsBy.get(p.id) ?? [] }));
}

/* -------------------------------- activity -------------------------------- */

export interface DayActivity {
  minutes: number;
  problems: number;
  notes: number;
}

/** Everything the heatmap and streaks read, keyed by local calendar day. */
export async function getActivity(): Promise<Map<string, DayActivity>> {
  const [sessionRows, problemRows, noteRows] = await Promise.all([
    db
      .select({ day: sessions.day, mins: sql<number>`sum(${sessions.minutes})` })
      .from(sessions)
      .groupBy(sessions.day),
    db
      .select({
        day: problems.solvedDay,
        n: sql<number>`count(*)`,
        mins: sql<number>`coalesce(sum(${problems.minutes}), 0)`,
      })
      .from(problems)
      .groupBy(problems.solvedDay),
    db.select({ createdAt: notes.createdAt }).from(notes),
  ]);

  const map = new Map<string, DayActivity>();
  const bump = (day: string, patch: Partial<DayActivity>) => {
    const cur = map.get(day) ?? { minutes: 0, problems: 0, notes: 0 };
    cur.minutes += patch.minutes ?? 0;
    cur.problems += patch.problems ?? 0;
    cur.notes += patch.notes ?? 0;
    map.set(day, cur);
  };

  sessionRows.forEach((r) => bump(r.day, { minutes: Number(r.mins) || 0 }));
  problemRows.forEach((r) =>
    bump(r.day, { problems: Number(r.n) || 0, minutes: Number(r.mins) || 0 }),
  );
  noteRows.forEach((r) => bump(dayKey(r.createdAt), { notes: 1 }));

  return map;
}

const isActive = (a?: DayActivity) => !!a && (a.minutes > 0 || a.problems > 0 || a.notes > 0);

/* ------------------------------- dashboard -------------------------------- */

export async function getDashboard() {
  const [activity, subjectList, problemList, settingsRow] = await Promise.all([
    getActivity(),
    getSubjects(),
    getProblems(),
    getSettings(),
  ]);

  const activeDays = new Set([...activity.entries()].filter(([, a]) => isActive(a)).map(([d]) => d));

  let weekMinutes = 0;
  let weekProblems = 0;
  for (let i = 0; i < 7; i++) {
    const a = activity.get(dayKey(addDays(new Date(), -i)));
    weekMinutes += a?.minutes ?? 0;
    weekProblems += a?.problems ?? 0;
  }

  const todayActivity = activity.get(today()) ?? { minutes: 0, problems: 0, notes: 0 };

  const byDifficulty: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  problemList.forEach((p) => (byDifficulty[p.difficulty] += 1));

  const noteCount = (await db.select({ n: sql<number>`count(*)` }).from(notes))[0]?.n ?? 0;

  return {
    settings: settingsRow,
    activity,
    activeDays,
    streak: currentStreak(activeDays),
    best: bestStreak(activeDays),
    todayActivity,
    weekMinutes,
    weekProblems,
    subjects: subjectList,
    problems: problemList,
    byDifficulty,
    noteCount: Number(noteCount) || 0,
    revisitQueue: buildRevisitQueue(problemList, settingsRow.revisitDays),
  };
}

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

/** Solved counts per topic tag, for the patterns chart. */
export async function getTagCounts(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db
    .select({ tag: problemTags.tag, count: sql<number>`count(*)` })
    .from(problemTags)
    .groupBy(problemTags.tag)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) || 0 }));
}

export async function getRecentSessions(limit = 10) {
  return db
    .select({
      id: sessions.id,
      minutes: sessions.minutes,
      day: sessions.day,
      note: sessions.note,
      subjectId: sessions.subjectId,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(sessions)
    .leftJoin(subjects, eq(sessions.subjectId, subjects.id))
    .orderBy(desc(sessions.day), desc(sessions.createdAt))
    .limit(limit);
}
