import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import {
  PRACTICE_LANGS,
  ensureDataDirs,
  insidePractice,
  type PracticeLang,
} from "./paths";

/**
 * The practice scratchpad's file layer.
 *
 * These are real files at `practicecode/java/` and `practicecode/python/` — not
 * blobs in a database — because the whole point of the tab is that you can also
 * open the folder in IntelliJ or VS Code and it is the same code. So this module
 * is deliberately thin: list, read, write, create, rename, delete, and nothing
 * clever in between.
 *
 * Two rules are enforced here rather than at the call sites:
 *  - every path goes through `insidePractice`, so a name from a URL or a form
 *    can never resolve outside its language directory;
 *  - a practice file is a FLAT name. There are no subfolders, so anything with a
 *    separator in it is refused outright instead of being quietly flattened.
 */

export interface PracticeFile {
  name: string;
  size: number;
  modified: number;
}

/** A create or rename that had to change the name, and the sentence explaining it. */
export interface NamedResult {
  name: string;
  note: string | null;
}

const MAX_STEM = 80;

/* ------------------------------ name handling ----------------------------- */

/** `class` and friends can't be a Java type name, so they can't be a filename either. */
const JAVA_RESERVED = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new", "package",
  "private", "protected", "public", "return", "short", "static", "strictfp",
  "super", "switch", "synchronized", "this", "throw", "throws", "transient",
  "try", "void", "volatile", "while", "record", "var", "yield", "sealed", "permits",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function assertFlat(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("Give the file a name.");
  if (/[/\\]/.test(name)) {
    throw new Error(
      "A file name can't contain a folder separator — practice files sit directly in practicecode/.",
    );
  }
  if (name.startsWith(".")) throw new Error("A file name can't start with a dot.");
  return name;
}

/** Strip a trailing .java/.py so "Hello.java" and "Hello" mean the same thing. */
const stemOf = (raw: string) => raw.replace(/\.(java|py)$/i, "").trim();

/**
 * Derive a legal Java type name. `javac` refuses to compile `public class Foo`
 * unless the file is `Foo.java`, so the filename is not a free choice — it is
 * the class name, and "my first try" has to become `MyFirstTry`.
 */
export function javaClassName(raw: string): string {
  const words = stemOf(raw)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_$]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let name = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
    .slice(0, MAX_STEM);

  if (!name) name = "Scratch";
  if (/^[0-9]/.test(name)) name = `N${name}`;
  if (JAVA_RESERVED.has(name)) name = `${name}Class`;
  return name;
}

/** Python is far more forgiving; only spaces and punctuation need cleaning up. */
export function pythonStem(raw: string): string {
  let name = stemOf(raw)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_STEM);

  if (!name) name = "scratch";
  if (/^[0-9]/.test(name)) name = `n${name}`;
  return name;
}

/** The filename this language will actually accept, plus whether it had to change. */
function fileNameFor(
  lang: PracticeLang,
  raw: string,
): { name: string; stem: string; adjusted: boolean } {
  const asked = stemOf(assertFlat(raw));
  const stem = lang === "java" ? javaClassName(asked) : pythonStem(asked);
  return {
    name: stem + PRACTICE_LANGS[lang].ext,
    stem,
    adjusted: stem !== asked,
  };
}

/* --------------------------------- starters ------------------------------- */

function starter(lang: PracticeLang, stem: string): string {
  if (lang === "java") {
    return `public class ${stem} {
    public static void main(String[] args) {
        System.out.println("Hello from ${stem}");
    }
}
`;
  }
  return `print("Hello from ${stem}")
`;
}

/* ---------------------------------- list ---------------------------------- */

const isHidden = (name: string) => name.startsWith(".") || name === "__pycache__";

/**
 * Every source file in one language directory, newest first — you almost always
 * want the thing you were last editing, not the alphabetically first thing.
 * Only files with the language's own extension are listed, so stray `.class`
 * files or a README don't pretend to be runnable.
 */
export async function listPracticeFiles(lang: PracticeLang): Promise<PracticeFile[]> {
  ensureDataDirs();
  const { dir, ext } = PRACTICE_LANGS[lang];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PracticeFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || isHidden(e.name)) continue;
    if (path.extname(e.name).toLowerCase() !== ext) continue;
    try {
      const stat = await fs.stat(path.join(dir, e.name));
      out.push({ name: e.name, size: stat.size, modified: stat.mtimeMs });
    } catch {
      continue; // vanished mid-listing
    }
  }

  out.sort((a, b) => b.modified - a.modified);
  return out;
}

/* ------------------------------- read / write ----------------------------- */

export async function readPracticeFile(lang: PracticeLang, name: string): Promise<string> {
  return fs.readFile(insidePractice(lang, assertFlat(name)), "utf8");
}

/**
 * Save a file, creating the language directory if this is the first one.
 * The extension is appended when it's missing so the autosave can be handed the
 * same name the URL carries.
 */
export async function writePracticeFile(
  lang: PracticeLang,
  name: string,
  code: string,
): Promise<string> {
  ensureDataDirs();
  const { ext } = PRACTICE_LANGS[lang];
  const raw = assertFlat(name);
  const final = path.extname(raw).toLowerCase() === ext ? raw : raw + ext;

  const abs = insidePractice(lang, final);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, code, "utf8");
  return final;
}

const exists = (abs: string) =>
  fs.access(abs).then(
    () => true,
    () => false,
  );

/**
 * Create a new scratch file with something runnable already in it.
 *
 * For Java the class name is derived from the filename rather than asked for
 * separately: they are not allowed to disagree, and a compiler error that says
 * "class Hello is public, should be declared in a file named Hello.java" is a
 * terrible way to learn that. When the name had to change, `note` says so.
 */
export async function createPracticeFile(
  lang: PracticeLang,
  name: string,
): Promise<NamedResult> {
  ensureDataDirs();
  const { name: final, stem, adjusted } = fileNameFor(lang, name);
  const abs = insidePractice(lang, final);

  if (await exists(abs)) {
    throw new Error(`There's already a file called ${final}. Pick another name.`);
  }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, starter(lang, stem), "utf8");

  return {
    name: final,
    note: adjusted
      ? lang === "java"
        ? `Saved as ${final}. Java needs the file and its public class to share a name, so the class inside is ${stem}.`
        : `Saved as ${final} — spaces and punctuation aren't safe in a Python filename.`
      : null,
  };
}

/**
 * Rename, keeping Java compilable: renaming `Hello.java` to `Greeter.java` and
 * leaving `public class Hello` inside would break the very next Run, so the
 * declaration is rewritten with the file.
 */
export async function renamePracticeFile(
  lang: PracticeLang,
  name: string,
  nextName: string,
): Promise<NamedResult> {
  const from = insidePractice(lang, assertFlat(name));
  const { name: final, stem, adjusted } = fileNameFor(lang, nextName);
  const to = insidePractice(lang, final);

  if (to === from) return { name: final, note: null };
  if (await exists(to)) {
    throw new Error(`There's already a file called ${final}. Pick another name.`);
  }

  await fs.rename(from, to);

  const notes: string[] = [];
  if (adjusted) notes.push(`Saved as ${final}.`);

  if (lang === "java") {
    const before = path.basename(from, ".java");
    const body = await fs.readFile(to, "utf8");
    const rewritten = body.replace(
      new RegExp(`\\b(class|interface|enum|record)\\s+${escapeRe(before)}\\b`, "g"),
      `$1 ${stem}`,
    );
    if (rewritten !== body) {
      await fs.writeFile(to, rewritten, "utf8");
      notes.push(`The class inside was renamed to ${stem} so javac still accepts it.`);
    }
  }

  return { name: final, note: notes.length ? notes.join(" ") : null };
}

export async function deletePracticeFile(lang: PracticeLang, name: string): Promise<void> {
  const abs = insidePractice(lang, assertFlat(name));
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) return; // already gone — deleting twice is not an error worth showing
  if (!stat.isFile()) throw new Error("That isn't a practice file.");
  await fs.rm(abs, { force: true });
}
