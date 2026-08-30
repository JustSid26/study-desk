# Study Desk

A study tracker that keeps three things in one place: notes, subject mastery, and
LeetCode progress. Runs locally against a SQLite file — nothing is uploaded anywhere.

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3311
```

## What it does

**Notes** — type them in Markdown, or upload photos, PDFs, docx and text files. Drop
files anywhere on the page, or paste a screenshot straight in. Images and PDFs preview
inline; docx is converted server-side. A file note keeps its own body as annotations, so
a photo of handwritten notes can carry typed commentary next to it.

**Subjects** — a subject holds topics, and each topic carries a mastery level that cycles
from not started, through learning and revising, to solid. Paste a whole syllabus in when
creating a subject. Study sessions are logged against a subject and feed the heatmap.

**LeetCode** — progress against your own targets by difficulty, a breakdown by topic, and
a revisit queue that surfaces problems you flagged plus anything you haven't touched past
the staleness threshold.

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

Everything lives in `data/` — `study.db` and `uploads/`. Back up that one folder. It is
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
  lib/         leetcode client, sync engine, queries, date helpers
  app/
    actions/   server actions (mutations)
    api/       file serving, docx conversion, sync, problem lookup
    ...        one directory per route
  components/  shared UI
drizzle/       generated migrations
```

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
