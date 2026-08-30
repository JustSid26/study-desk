import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/* ---------------------------------------------------------------------------
 * Conventions
 *  - ids are short random strings (see lib/id.ts), not autoincrement, so records
 *    can be created client-side and merged from an import without renumbering.
 *  - `*At` columns are epoch milliseconds (integer).
 *  - a "day" column is a local calendar date string, YYYY-MM-DD. Everything the
 *    streak and heatmap read is keyed on this, never on a timestamp, so a study
 *    session logged at 11pm belongs to the day you were actually studying.
 * ------------------------------------------------------------------------- */

const now = sql`(unixepoch() * 1000)`;

/* ------------------------------ leetcode --------------------------------- */

export const DIFFICULTY = ["Easy", "Medium", "Hard"] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

/**
 * The public LeetCode problem catalogue (~4,000 rows), fetched once and
 * refreshable. Having it locally is what lets a synced solve arrive already
 * carrying its number, difficulty and topic tags instead of you typing them.
 */
export const catalogue = sqliteTable(
  "catalogue",
  {
    slug: text("slug").primaryKey(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    difficulty: text("difficulty").$type<Difficulty>().notNull(),
    paidOnly: integer("paid_only", { mode: "boolean" }).notNull().default(false),
    /** JSON array of topic-tag names, e.g. ["Array","Hash Table"] */
    topicTags: text("topic_tags").notNull().default("[]"),
    acRate: real("ac_rate"),
    fetchedAt: integer("fetched_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("catalogue_number_idx").on(t.number),
    index("catalogue_difficulty_idx").on(t.difficulty),
  ],
);

export const PROBLEM_STATUS = ["solved", "revisit"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUS)[number];

export const PROBLEM_SOURCE = ["manual", "leetcode"] as const;
export type ProblemSource = (typeof PROBLEM_SOURCE)[number];

/**
 * Your solve log. A row is keyed by slug so a LeetCode sync can upsert without
 * creating duplicates.
 *
 * Fields the sync owns:  number, title, difficulty, solvedDay (first seen), source
 * Fields you own:        status, minutes, lang, notes, confidence, attempts
 * A re-sync never overwrites the second group — see lib/leetcode.ts.
 */
export const problems = sqliteTable(
  "problems",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    number: integer("number"),
    title: text("title").notNull(),
    url: text("url"),
    difficulty: text("difficulty").$type<Difficulty>().notNull().default("Medium"),
    status: text("status").$type<ProblemStatus>().notNull().default("solved"),
    /** YYYY-MM-DD, local — the day it counts toward your streak */
    solvedDay: text("solved_day").notNull(),
    minutes: integer("minutes"),
    lang: text("lang"),
    notes: text("notes").notNull().default(""),
    attempts: integer("attempts").notNull().default(1),
    /** 1-5, your own read on how solid it felt; drives the revisit queue */
    confidence: integer("confidence"),
    source: text("source").$type<ProblemSource>().notNull().default("manual"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("problems_slug_idx").on(t.slug),
    index("problems_day_idx").on(t.solvedDay),
    index("problems_status_idx").on(t.status),
  ],
);

export const problemTags = sqliteTable(
  "problem_tags",
  {
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.problemId, t.tag] }),
    index("problem_tags_tag_idx").on(t.tag),
  ],
);

/* ------------------------------- settings -------------------------------- */

/**
 * Single row, id = "singleton". Kept as a table rather than a config file so a
 * backup of data/ is genuinely everything.
 */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("singleton"),

  dailyProblems: integer("daily_problems").notNull().default(2),
  goalEasy: integer("goal_easy").notNull().default(150),
  goalMedium: integer("goal_medium").notNull().default(250),
  goalHard: integer("goal_hard").notNull().default(75),
  /** a solved problem older than this many days re-enters the revisit queue */
  revisitDays: integer("revisit_days").notNull().default(30),

  leetcodeUsername: text("leetcode_username"),
  /** aggregate counts from the last sync, so the UI can show them even when
   *  the full solve list isn't available (public-profile mode) */
  lcTotalSolved: integer("lc_total_solved"),
  lcEasySolved: integer("lc_easy_solved"),
  lcMediumSolved: integer("lc_medium_solved"),
  lcHardSolved: integer("lc_hard_solved"),
  /** JSON map of "YYYY-MM-DD" -> submission count, from LeetCode's calendar */
  lcCalendar: text("lc_calendar"),
  lcSyncedAt: integer("lc_synced_at"),
  lcSyncMode: text("lc_sync_mode").$type<"public" | "session">(),
  lcLastError: text("lc_last_error"),

  catalogueSyncedAt: integer("catalogue_synced_at"),
  catalogueCount: integer("catalogue_count"),
});

/* ------------------------------- relations ------------------------------- */

export const problemsRelations = relations(problems, ({ many }) => ({
  tags: many(problemTags),
}));

export const problemTagsRelations = relations(problemTags, ({ one }) => ({
  problem: one(problems, { fields: [problemTags.problemId], references: [problems.id] }),
}));


/* ------------------------------- timetable ------------------------------- */

export const WEEKDAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Your weekly timetable. Times are "HH:MM" on a 24-hour clock and stored as
 * strings rather than minutes-since-midnight, so what you typed is what comes
 * back and the rows sort correctly with a plain string comparison.
 *
 * `subjectPath` optionally points at a folder in the notes vault, which is what
 * lets a timetable entry link straight to that subject's notes.
 */
export const timetable = sqliteTable(
  "timetable",
  {
    id: text("id").primaryKey(),
    /** 0 = Monday … 6 = Sunday */
    weekday: integer("weekday").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    title: text("title").notNull(),
    /** relative path of a folder in the vault, e.g. "Operating Systems" */
    subjectPath: text("subject_path"),
    location: text("location"),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("timetable_day_idx").on(t.weekday, t.startsAt)],
);

/* --------------------------- question cache ------------------------------ */

/**
 * A problem's description, fetched from LeetCode and kept so the in-app problem
 * screen opens instantly and still works offline. The HTML is stored raw and
 * sanitised at render time — sanitising on the way in would bake today's
 * allowlist into the cache.
 */
export const questionCache = sqliteTable("question_cache", {
  slug: text("slug").primaryKey(),
  questionId: text("question_id").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  difficulty: text("difficulty").$type<Difficulty>().notNull(),
  /** raw HTML from LeetCode */
  content: text("content").notNull().default(""),
  /** JSON array of hint strings */
  hints: text("hints").notNull().default("[]"),
  /** JSON: { langSlug: starterCode } */
  snippets: text("snippets").notNull().default("{}"),
  sampleTestCase: text("sample_test_case").notNull().default(""),
  exampleTestcases: text("example_testcases").notNull().default(""),
  acRate: real("ac_rate"),
  fetchedAt: integer("fetched_at").notNull().default(now),
});

/* ------------------------------ solutions -------------------------------- */

/**
 * Your working draft per problem, so switching away from the editor and coming
 * back does not lose the attempt. One row per problem and language.
 */
export const drafts = sqliteTable(
  "drafts",
  {
    slug: text("slug").notNull(),
    lang: text("lang").notNull(),
    code: text("code").notNull().default(""),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.slug, t.lang] })],
);

export const SUBMISSION_VERDICT = [
  "Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded",
  "Runtime Error", "Compile Error", "Output Limit Exceeded", "Unknown",
] as const;

/** A log of what was actually sent to LeetCode, and what came back. */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    lang: text("lang").notNull(),
    code: text("code").notNull(),
    verdict: text("verdict").notNull().default("Unknown"),
    /** LeetCode's own submission id, when it gave us one */
    remoteId: text("remote_id"),
    runtime: text("runtime"),
    memory: text("memory"),
    totalCorrect: integer("total_correct"),
    totalTestcases: integer("total_testcases"),
    errorText: text("error_text"),
    day: text("day").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("submissions_slug_idx").on(t.slug), index("submissions_day_idx").on(t.day)],
);

/* --------------------------- inferred row types --------------------------- */

export type ProblemRow = typeof problems.$inferSelect;
export type CatalogueRow = typeof catalogue.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type TimetableRow = typeof timetable.$inferSelect;
export type QuestionCacheRow = typeof questionCache.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;
