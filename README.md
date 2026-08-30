# Study Desk

A study tracker that keeps three things in one place: notes, subject mastery, and
LeetCode progress. Runs locally against a SQLite file — nothing is uploaded anywhere.

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3311
```

## What it does

**Subjects** — a subject is a real folder under `data/subjects/`, with folders inside it
for units or chapters, nested as deep as you like. Notes are real files: Markdown you type
in the app, or PDFs, images and docx you upload, drop or paste. Because the filesystem is
the source of truth, a file you drop into a folder from Finder appears in the app, and a
backup is a copy of one directory.

**LeetCode** — the problem statement, examples and hints open inside the app. Write a
solution, run it against the sample tests, and submit it to LeetCode without leaving.
An accepted submission logs itself locally with its difficulty, topics and language.
Progress bars against your own targets, a topic breakdown, and a revisit queue that
surfaces problems you flagged plus anything untouched past the staleness threshold.

**Practice** — a scratchpad for Java and Python that runs on a button instead of a
terminal. Files live in `practicecode/java` and `practicecode/python` as real files.
Compiler and runtime errors come back as a line number, the message, and a sentence
explaining what it usually means; the line number jumps the caret there.

**Timetable** — a weekly grid where a class block's height is its real duration. A class
can point at a subject folder, so it links straight to that subject's notes.

## Importing from LeetCode

LeetCode has no official API. This talks to the same GraphQL endpoint the site's own
frontend uses, which means two levels of access:

| | Username only | With a session cookie |
|---|---|---|
| Solved totals by difficulty | yes | yes |
| Per-topic solved counts | yes | yes |
| Submission calendar | yes | yes |
| ~20 most recent solves | yes | yes |
| **Every problem ever solved** | no | yes |

A public profile deliberately does not expose a full solved list, so the complete history
needs a request authenticated as you.

Set a username in **Setup**, or in `.env.local`:

```
LEETCODE_USERNAME=your-username
```

For the full history, add your own session cookie. In a browser signed in to leetcode.com:
DevTools → Application → Cookies → `https://leetcode.com`, then copy the values of
`LEETCODE_SESSION` and `csrftoken` into `.env.local`:

```
LEETCODE_SESSION=...
LEETCODE_CSRF=...
```

It stays on this machine, is only ever sent to leetcode.com, and expires after a month or
so — after which the app falls back to username-only mode and says so in Setup.

Re-syncing is safe. LeetCode owns a problem's identity (number, title, difficulty, topic
tags); everything else is yours — status, minutes, language, notes, confidence, attempts —
and a sync leaves it untouched. The solve date is only written when a problem is first
imported, so syncing again never rewrites your history.

One limitation worth knowing: LeetCode's accepted-problems listing carries no solve dates,
so a first full import dates most problems to that day. Only the recent solves carry real
dates. Everything logged afterwards is dated properly.

## Your data

Everything lives in `data/` — `study.db` and `subjects/`. Back up that one folder. It is
not synced; point `STUDY_DATA_DIR` at a synced directory to change that:

```
STUDY_DATA_DIR=/Users/you/Dropbox/study-tracker
```

Setting `DATABASE_URL` to a libSQL/Turso URL moves the database to the cloud without any
code changes.

## Layout

```
src/
  db/          schema and connection
  lib/         leetcode client, sync engine, vault (the notes filesystem),
               runner (Java/Python execution), queries, date helpers
  app/
    actions/   server actions (mutations)
    api/       vault file serving, docx conversion, code run/submit, sync
    ...        one directory per route
  components/  shared UI
drizzle/       generated migrations
data/subjects/ your notes, as folders and files
practicecode/  your Java and Python scratch files
```

Running code spawns real processes, so the runner caps output, times a run out after 15
seconds, and kills the whole process group — `javac` and `java` spawn children that
outlive the parent.

Days are stored as local `YYYY-MM-DD` strings rather than timestamps, and every day-walk
uses calendar arithmetic — adding 86,400,000 ms repeats a day at the autumn clock change
and skips one in spring, which silently breaks a streak.

## Scripts

| | |
|---|---|
| `npm run dev` | development server on port 3311 |
| `npm run build` / `npm start` | production build and serve |
| `npm run db:generate` | generate a migration after a schema change |
| `npm run db:migrate` | apply migrations |
| `npm run db:studio` | browse the database |
