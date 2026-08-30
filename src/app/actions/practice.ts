"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isPracticeLang } from "@/lib/paths";
import {
  createPracticeFile,
  deletePracticeFile,
  renamePracticeFile,
  writePracticeFile,
} from "@/lib/practice";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

const fail = (error: string): Fail => ({ ok: false, error });

const firstIssue = (err: z.ZodError) =>
  err.issues[0]?.message ?? "That input isn't valid.";

/** A thrown filesystem error is for us; the sentence the user reads is theirs. */
function reason(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  // The messages our own lib throws are already written for a person.
  return message && message.length < 200 && !/ENOENT|EACCES|EISDIR|EEXIST/.test(message)
    ? message
    : fallback;
}

/**
 * Every message here is written for the person reading it. Zod's own defaults
 * ("Invalid input: expected string, received undefined") are fine in a log and
 * useless in a dialog, so each field carries its own.
 */
const langSchema = z
  .string({ error: "Say which language this is." })
  .refine(isPracticeLang, "That isn't a language this app runs.");

const nameSchema = z
  .string({ error: "Give the file a name." })
  .trim()
  .min(1, "Give the file a name.")
  .max(100, "That file name is too long.");

function touch() {
  revalidatePath("/practice");
}

/* --------------------------------- save ----------------------------------- */

const saveSchema = z.object({
  lang: langSchema,
  file: nameSchema,
  code: z
    .string({ error: "There was nothing to save." })
    .max(400_000, "That file is too big to save from the browser."),
});

/**
 * The editor's autosave.
 *
 * Deliberately does NOT revalidate: it fires every few keystrokes, and
 * re-rendering /practice on each one would re-probe the toolchain (two spawned
 * processes) and push a fresh RSC payload over the file you are still typing in.
 * The only thing that goes stale is the "3m ago" beside the filename, which the
 * next real navigation fixes.
 */
export async function savePracticeCode(input: {
  lang: string;
  file: string;
  code: string;
}): Promise<Ok<{ savedAt: number }> | Fail> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { lang, file, code } = parsed.data;
  if (!isPracticeLang(lang)) return fail("That isn't a language this app runs.");

  try {
    await writePracticeFile(lang, file, code);
    return { ok: true, savedAt: Date.now() };
  } catch (err) {
    return fail(reason(err, "Couldn't write that file to disk."));
  }
}

/* -------------------------------- create ---------------------------------- */

const createSchema = z.object({ lang: langSchema, name: nameSchema });

export async function createFile(input: {
  lang: string;
  name: string;
}): Promise<Ok<{ name: string; note: string | null }> | Fail> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { lang, name } = parsed.data;
  if (!isPracticeLang(lang)) return fail("That isn't a language this app runs.");

  try {
    const created = await createPracticeFile(lang, name);
    touch();
    return { ok: true, ...created };
  } catch (err) {
    return fail(reason(err, "Couldn't create that file."));
  }
}

/* -------------------------------- rename ---------------------------------- */

const renameSchema = z.object({
  lang: langSchema,
  file: nameSchema,
  nextName: nameSchema,
});

export async function renameFile(input: {
  lang: string;
  file: string;
  nextName: string;
}): Promise<Ok<{ name: string; note: string | null }> | Fail> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { lang, file, nextName } = parsed.data;
  if (!isPracticeLang(lang)) return fail("That isn't a language this app runs.");

  try {
    const renamed = await renamePracticeFile(lang, file, nextName);
    touch();
    return { ok: true, ...renamed };
  } catch (err) {
    return fail(reason(err, "Couldn't rename that file."));
  }
}

/* -------------------------------- delete ---------------------------------- */

const deleteSchema = z.object({ lang: langSchema, file: nameSchema });

export async function deleteFile(input: {
  lang: string;
  file: string;
}): Promise<Ok<{ name: string }> | Fail> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { lang, file } = parsed.data;
  if (!isPracticeLang(lang)) return fail("That isn't a language this app runs.");

  try {
    await deletePracticeFile(lang, file);
    touch();
    return { ok: true, name: file };
  } catch (err) {
    return fail(reason(err, "Couldn't delete that file."));
  }
}
