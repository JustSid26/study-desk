import path from "node:path";
import fs from "node:fs";

/**
 * Everything that is *yours* lives under one directory, so a backup is a copy
 * of a single folder and nothing is hidden in a cache somewhere.
 *
 *   data/
 *     study.db          SQLite database
 *     uploads/          uploaded originals, named by file id
 *
 * Override with STUDY_DATA_DIR to keep it on an external drive or in Dropbox.
 */
export const DATA_DIR =
  process.env.STUDY_DATA_DIR ?? path.join(process.cwd(), "data");

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DB_FILE = path.join(DATA_DIR, "study.db");

let ensured = false;

/** Create the data directories on first use. Cheap and idempotent. */
export function ensureDataDirs() {
  if (ensured) return;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  ensured = true;
}

/**
 * Resolve a stored relative path to an absolute one, refusing anything that
 * escapes the uploads directory. Stored paths come from our own upload handler,
 * but this is the boundary where a tampered database row would otherwise turn
 * into an arbitrary file read.
 */
export function resolveUpload(relative: string): string {
  const abs = path.resolve(UPLOADS_DIR, relative);
  const root = path.resolve(UPLOADS_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Refusing to read outside the uploads directory");
  }
  return abs;
}
