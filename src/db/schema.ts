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

/* ------------------------------- subjects -------------------------------- */

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#275C4B"),
  /** optional weekly study target, in minutes */
  goalMins: integer("goal_mins"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
});

/** Mastery ladder for a topic. Ordered — `masteryWeight` depends on this order. */
export const TOPIC_STATUS = ["new", "learning", "revising", "solid"] as const;
export type TopicStatus = (typeof TOPIC_STATUS)[number];

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").$type<TopicStatus>().notNull().default("new"),
    position: integer("position").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("topics_subject_idx").on(t.subjectId)],
);

/* --------------------------------- files --------------------------------- */

/**
 * Uploaded originals. The bytes live on disk under data/uploads/<id><ext>;
 * only metadata is in the database, so the DB stays small and a photo of a
 * whiteboard is still served as a plain static-ish file by /api/files/[id].
 */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  /** path relative to the uploads dir — never an absolute path, so the data
   *  directory can be moved or backed up wholesale */
  path: text("path").notNull(),
  sha256: text("sha256"),
  createdAt: integer("created_at").notNull().default(now),
});

/* --------------------------------- notes --------------------------------- */

export const NOTE_KIND = ["text", "image", "pdf", "docx", "doc", "file"] as const;
export type NoteKind = (typeof NOTE_KIND)[number];

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default(""),
    /** Markdown. On a file note this is your own commentary on the file. */
    body: text("body").notNull().default(""),
    kind: text("kind").$type<NoteKind>().notNull().default("text"),
    fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("notes_subject_idx").on(t.subjectId),
    index("notes_updated_idx").on(t.updatedAt),
  ],
);

export const noteTags = sqliteTable(
  "note_tags",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.tag] }),
    index("note_tags_tag_idx").on(t.tag),
  ],
);

/* ------------------------------- sessions -------------------------------- */

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").references(() => subjects.id, {
      onDelete: "cascade",
    }),
    minutes: integer("minutes").notNull(),
    /** YYYY-MM-DD, local */
    day: text("day").notNull(),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("sessions_day_idx").on(t.day)],
);

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

  dailyMins: integer("daily_mins").notNull().default(90),
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

export const subjectsRelations = relations(subjects, ({ many }) => ({
  topics: many(topics),
  notes: many(notes),
  sessions: many(sessions),
}));

export const topicsRelations = relations(topics, ({ one }) => ({
  subject: one(subjects, { fields: [topics.subjectId], references: [subjects.id] }),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  subject: one(subjects, { fields: [notes.subjectId], references: [subjects.id] }),
  file: one(files, { fields: [notes.fileId], references: [files.id] }),
  tags: many(noteTags),
}));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(notes, { fields: [noteTags.noteId], references: [notes.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  subject: one(subjects, { fields: [sessions.subjectId], references: [subjects.id] }),
}));

export const problemsRelations = relations(problems, ({ many }) => ({
  tags: many(problemTags),
}));

export const problemTagsRelations = relations(problemTags, ({ one }) => ({
  problem: one(problems, { fields: [problemTags.problemId], references: [problems.id] }),
}));

/* --------------------------- inferred row types --------------------------- */

export type Subject = typeof subjects.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type CatalogueRow = typeof catalogue.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
