import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

/**
 * Everything that is *yours* lives under one directory, so a backup is a copy
 * of a single folder and nothing is hidden in a cache somewhere.
 *
 *   data/
 *     study.db          SQLite: LeetCode progress, timetable, settings
 *     subjects/         the notes vault — one directory per subject
 *
 * Practice scratch files sit outside it, at the project root, because they are
 * source files you may well want to open in a real editor:
 *
 *   practicecode/
 *     java/  python/
 *
 * Override the data location with STUDY_DATA_DIR to keep it on an external
 * drive or in a synced folder.
 */
export const DATA_DIR =
  process.env.STUDY_DATA_DIR ?? path.join(process.cwd(), "data");

export const SUBJECTS_DIR = path.join(DATA_DIR, "subjects");
export const DB_FILE = path.join(DATA_DIR, "study.db");

export const PRACTICE_DIR =
  process.env.STUDY_PRACTICE_DIR ?? path.join(process.cwd(), "practicecode");

export const PRACTICE_LANGS = {
  java: { dir: path.join(PRACTICE_DIR, "java"), ext: ".java" },
  python: { dir: path.join(PRACTICE_DIR, "python"), ext: ".py" },
} as const;

export type PracticeLang = keyof typeof PRACTICE_LANGS;
export const isPracticeLang = (v: string): v is PracticeLang =>
  Object.prototype.hasOwnProperty.call(PRACTICE_LANGS, v);

let ensured = false;

/** Create the directories on first use. Cheap and idempotent. */
export function ensureDataDirs() {
  if (ensured) return;
  fs.mkdirSync(SUBJECTS_DIR, { recursive: true });
  for (const { dir } of Object.values(PRACTICE_LANGS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  ensured = true;
}

/**
 * Resolve a caller-supplied relative path against a root, refusing anything
 * that escapes it.
 *
 * Every path in this app arrives from a URL, a form field or a database row, so
 * this is the one boundary between "a note the user clicked" and an arbitrary
 * file read. `path.resolve` collapses `..` before the check, so `a/../../etc`
 * is caught rather than passed through.
 */
function contain(root: string, relative: string): string {
  const base = path.resolve(root);
  const abs = path.resolve(base, relative ?? "");
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error("That path is outside the allowed directory.");
  }
  return abs;
}

/**
 * The same check, carried through symbolic links.
 *
 * `contain` is purely lexical: `path.resolve` collapses `..`, but it does not
 * follow links, so a symlink sitting *inside* the vault — `data/subjects/x ->
 * ~/.ssh` — resolves to a path that starts with the vault root and passes.
 * `fs.stat` and `createReadStream` then follow it straight out. The vault is
 * documented as a folder you fill from Finder and can point at a synced drive,
 * so a link can arrive without the app ever creating one (nothing here does).
 *
 * The nearest existing ancestor is what gets resolved, because a file about to
 * be created has no real path of its own but the directory it lands in does.
 * The root is resolved too: `STUDY_DATA_DIR` may itself be reached through a
 * link, and comparing a real path against a lexical base would then reject
 * every legitimate file.
 */
async function containReal(root: string, abs: string): Promise<string> {
  const base = await fsp.realpath(root).catch(() => path.resolve(root));

  const tail: string[] = [];
  let probe = abs;
  let real = abs;
  for (;;) {
    try {
      real = await fsp.realpath(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break; // hit the filesystem root; nothing exists
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }

  const resolved = tail.length ? path.join(real, ...tail) : real;
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("That path is outside the allowed directory.");
  }
  return abs;
}

/** Resolve a path inside the notes vault. Throws if it escapes. */
export const insideVault = (relative: string) => contain(SUBJECTS_DIR, relative);

/**
 * `insideVault`, plus the symlink check. Use this wherever a caller-supplied
 * path is about to be opened, read or written — the lexical form alone is only
 * safe for paths that are never dereferenced.
 */
export async function insideVaultReal(relative: string): Promise<string> {
  return containReal(SUBJECTS_DIR, insideVault(relative));
}

/** Resolve a filename inside one practice language directory. Throws if it escapes. */
export const insidePractice = (lang: PracticeLang, filename: string) =>
  contain(PRACTICE_LANGS[lang].dir, filename);
