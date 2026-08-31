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

## Setting up Java and Python

Practice runs your code by shelling out to the real toolchains, so they have to be
installed and on your `PATH`. Nothing is bundled. **Setup** shows what the app can
currently find, and Run reports it plainly when something is missing.

Two things matter more than the exact version:

- It must be a **JDK, not a JRE.** A JRE has no `javac` to compile with and no
  `jdk.jdi` module, which is what the visualiser is built on. Java **11 or newer**;
  anything current is fine.
- **Python must be 3.x.** The app probes `python3`, then `python`, and on Windows
  the `py -3` launcher first, and only accepts one that reports a `Python 3.` banner
  — so a stray Python 2 on the path will not be picked by mistake.

### macOS

```bash
brew install openjdk            # then run the symlink line brew prints
brew install python

# without Homebrew: adoptium.net for the JDK, python.org for Python
```

Homebrew does not put `openjdk` on the path by itself — it prints a `sudo ln -sfn ...`
line at the end. Run it, or Java stays invisible to the app.

### Windows

Install a JDK (**Temurin** from adoptium.net, or Oracle) and Python from **python.org**.

Two things to get right, both easy to miss:

- In the Python installer, tick **"Add python.exe to PATH"** on the first screen.
- For the JDK, make sure its `bin` folder is on `PATH` — the Temurin installer offers
  this as an option; Oracle's usually does it for you.

Or with a package manager:

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
winget install Python.Python.3.12
```

Windows has no `python3` command — the installer creates `python.exe` and the `py`
launcher. The app handles that itself, so you do not need to create an alias.

> Avoid installing Python from the Microsoft Store if you can. Windows ships a stub
> called `python3` that opens the Store instead of running anything; the app detects
> and skips it, but a real install is less confusing.

### Linux

```bash
# Debian / Ubuntu
sudo apt install default-jdk python3

# Fedora
sudo dnf install java-latest-openjdk-devel python3

# Arch
sudo pacman -S jdk-openjdk python
```

Use `default-jdk`, not `default-jre`. The JRE packages have no compiler and no
`jdk.jdi`, so both Run and Visualise fail on them.

### Checking it worked

```bash
javac -version      # javac 21.x or newer
java  -version
python3 -V          # Python 3.x   (on Windows: py -3 -V)

java --list-modules | grep jdk.jdi     # required for the visualiser
```

That last line is the one that matters for **Visualise**. If it prints nothing you
have a JRE or a cut-down runtime; install a full JDK.

Restart the dev server after installing anything — the toolchain is looked up when
the server boots, not per request.

### Visualise is Java-only

Stepping through code line by line works for **Java** and not yet for Python. The JVM
has no equivalent of Python's `sys.settrace`, so the Java support is a JDI client
(`tools/tracer/Tracer.java`) that runs your file in a second JVM and records every
line — which is why it needs a JDK rather than just an interpreter. Python would
actually be the easier of the two to add; it simply is not built yet.

Python still runs normally with **Run**, with the same error explanations.

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
