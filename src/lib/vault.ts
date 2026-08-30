import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { SUBJECTS_DIR, ensureDataDirs, insideVault, insideVaultReal } from "./paths";

/**
 * The notes vault.
 *
 * A subject is a real directory under `data/subjects/`, and units or chapters
 * are directories inside it, nested as deep as you like. Notes are real files:
 * `.md` for typed ones, and whatever you uploaded for the rest.
 *
 * The FILESYSTEM IS THE SOURCE OF TRUTH — there is no notes table shadowing it.
 * That means you can drop a PDF into a folder from Finder and it shows up in the
 * app, move a folder and nothing dangles, and back the whole thing up by copying
 * one directory. The cost is that the app has to be careful about paths, which
 * is what `insideVault` is for.
 */

/** Files we will open in the reader rather than only offer for download. */
const KIND_BY_EXT: Record<string, NoteKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".avif": "image",
  ".heic": "image",
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "doc",
};

export type NoteKind = "markdown" | "text" | "image" | "pdf" | "docx" | "doc" | "file";

export const kindForFile = (name: string): NoteKind =>
  KIND_BY_EXT[path.extname(name).toLowerCase()] ?? "file";

export interface VaultEntry {
  /** POSIX-style path relative to the vault root, e.g. "OS/Unit 1/paging.pdf" */
  rel: string;
  name: string;
  isDir: boolean;
  kind: NoteKind;
  size: number;
  modified: number;
  /** directories only: how many files sit anywhere beneath it */
  fileCount?: number;
}

export interface VaultNode extends VaultEntry {
  children?: VaultNode[];
}

/**
 * A name that is safe to create on disk. Rejects separators and dotfiles.
 *
 * The second class is the set of characters Windows and macOS refuse in a
 * filename, plus the control range. That range is written as `\x00-\x1f`
 * escapes rather than the literal bytes: a raw control character in a source
 * file is invisible in most tools, and anything that normalises it — an editor,
 * a diff viewer, a copy-paste — silently turns the class into the range
 * ` -<`, which strips digits, dots and the extension off every name.
 */
export function cleanName(raw: string): string {
  const name = String(raw ?? "")
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return name;
}

const toRel = (abs: string) =>
  path.relative(SUBJECTS_DIR, abs).split(path.sep).join("/");

/** Ignore the noise macOS and editors leave behind. */
const isHidden = (name: string) =>
  name.startsWith(".") || name === "__MACOSX" || name === "Thumbs.db";

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    if (e.isDirectory()) n += await countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

/** One directory's immediate children, folders first then files, both by name. */
export async function listDir(rel = ""): Promise<VaultEntry[]> {
  await ensureDataDirs();
  const abs = insideVault(rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: VaultEntry[] = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const child = path.join(abs, e.name);
    let stat;
    try {
      stat = await fs.stat(child);
    } catch {
      continue; // a broken symlink or a file that vanished mid-listing
    }
    out.push({
      rel: toRel(child),
      name: e.name,
      isDir: e.isDirectory(),
      kind: e.isDirectory() ? "file" : kindForFile(e.name),
      size: e.isDirectory() ? 0 : stat.size,
      modified: stat.mtimeMs,
      ...(e.isDirectory() ? { fileCount: await countFiles(child) } : {}),
    });
  }

  out.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1,
  );
  return out;
}

/** The whole tree, for the sidebar. Depth-capped so a stray deep folder can't hang the page. */
export async function tree(rel = "", depth = 6): Promise<VaultNode[]> {
  const entries = await listDir(rel);
  if (depth <= 0) return entries;
  return Promise.all(
    entries.map(async (e) =>
      e.isDir ? { ...e, children: await tree(e.rel, depth - 1) } : e,
    ),
  );
}

/** Top-level subjects. */
export const listSubjects = () => listDir("");

export async function createFolder(parentRel: string, name: string): Promise<string> {
  const clean = cleanName(name);
  if (!clean) throw new Error("Give the folder a name.");
  const target = insideVault(path.posix.join(parentRel || "", clean));
  await fs.mkdir(target, { recursive: true });
  return toRel(target);
}

/**
 * Write a text note. Adds .md when no extension is given.
 *
 * `insideVaultReal` rather than `insideVault`: `writeFile` follows a symlink, so
 * the lexical check alone would let a link planted in the vault redirect the
 * write anywhere on disk.
 */
export async function writeNote(rel: string, body: string): Promise<string> {
  const withExt = path.extname(rel) ? rel : `${rel}.md`;
  const abs = await insideVaultReal(withExt);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf8");
  return toRel(abs);
}

export async function readNote(rel: string): Promise<string> {
  return fs.readFile(await insideVaultReal(rel), "utf8");
}

export async function readBinary(rel: string): Promise<Buffer> {
  return fs.readFile(await insideVaultReal(rel));
}

export async function statEntry(rel: string): Promise<VaultEntry | null> {
  try {
    const abs = insideVault(rel);
    const s = await fs.stat(abs);
    return {
      rel: toRel(abs),
      name: path.basename(abs),
      isDir: s.isDirectory(),
      kind: s.isDirectory() ? "file" : kindForFile(abs),
      size: s.size,
      modified: s.mtimeMs,
    };
  } catch {
    return null;
  }
}

/** Save an upload, never overwriting: "notes.pdf" becomes "notes (2).pdf". */
export async function saveUpload(
  folderRel: string,
  filename: string,
  data: Buffer,
): Promise<string> {
  const clean = cleanName(filename) || "upload";
  const dir = insideVault(folderRel || "");
  await fs.mkdir(dir, { recursive: true });

  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || "upload";
  let candidate = clean;
  for (let i = 2; i < 500; i++) {
    try {
      await fs.access(path.join(dir, candidate));
      candidate = `${stem} (${i})${ext}`;
    } catch {
      break; // free
    }
  }

  const abs = path.join(dir, candidate);
  insideVault(toRel(abs)); // re-assert containment after the name dance
  await fs.writeFile(abs, data);
  return toRel(abs);
}

export async function renameEntry(rel: string, nextName: string): Promise<string> {
  const clean = cleanName(nextName);
  if (!clean) throw new Error("Give it a name.");
  const abs = insideVault(rel);
  // Keep the extension when a file is renamed without one.
  const ext = path.extname(abs);
  const finalName = !path.extname(clean) && ext ? clean + ext : clean;
  const next = path.join(path.dirname(abs), finalName);
  insideVault(toRel(next));
  await fs.rename(abs, next);
  return toRel(next);
}

export async function moveEntry(rel: string, intoFolderRel: string): Promise<string> {
  const abs = insideVault(rel);
  const destDir = insideVault(intoFolderRel || "");

  // Refuse to move a folder into itself or its own descendant.
  if (destDir === abs || destDir.startsWith(abs + path.sep)) {
    throw new Error("A folder can't be moved inside itself.");
  }
  await fs.mkdir(destDir, { recursive: true });
  const next = path.join(destDir, path.basename(abs));
  insideVault(toRel(next));
  await fs.rename(abs, next);
  return toRel(next);
}

export async function deleteEntry(rel: string): Promise<void> {
  const abs = insideVault(rel);
  if (abs === path.resolve(SUBJECTS_DIR)) throw new Error("That's the vault root.");
  await fs.rm(abs, { recursive: true, force: true });
}

/** Every file in the vault, newest first — powers "recent" and the dashboard count. */
export async function recentFiles(limit = 20): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  const walk = async (rel: string, depth: number) => {
    if (depth > 8) return;
    for (const e of await listDir(rel)) {
      if (e.isDir) await walk(e.rel, depth + 1);
      else out.push(e);
    }
  };
  await walk("", 0);
  out.sort((a, b) => b.modified - a.modified);
  return out.slice(0, limit);
}

/** Day-keyed counts of note activity, from file mtimes. Feeds the heatmap. */
export async function noteActivity(): Promise<Map<string, number>> {
  const files = await recentFiles(5000);
  const map = new Map<string, number>();
  for (const f of files) {
    const d = new Date(f.modified);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
