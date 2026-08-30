"use server";

/**
 * Vault mutations — every write to `data/subjects/` goes through here.
 *
 * The filesystem is the source of truth, so these actions are thin: they
 * validate what arrived from a form, hand it to `@/lib/vault`, and translate a
 * thrown path-containment error into a sentence a person can read. Nothing here
 * throws at the caller; every path returns `{ok:true,...}` or `{ok:false,error}`.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import * as vault from "@/lib/vault";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

const fail = (error: string): Fail => ({ ok: false, error });

/** Every mutation moves a folder listing, and the dashboard counts note files. */
function touch() {
  revalidatePath("/subjects");
  revalidatePath("/");
}

/**
 * `insideVault` throws when a path escapes the vault, and `fs` throws its own
 * codes. Both become one sentence rather than a stack trace on the screen.
 */
function message(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "That file isn't there any more.";
    if (code === "EEXIST") return "Something with that name is already there.";
    if (code === "EACCES" || code === "EPERM") return "This machine won't let the app write there.";
    if (code === "ENOTEMPTY") return "That folder still has things in it.";
    if (err.message) return err.message;
  }
  return fallback;
}

/* -------------------------------- schemas --------------------------------- */

/** A vault-relative path. Containment is enforced by `insideVault`, not here. */
const relPath = z.string().max(1024, "That path is too long.");

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(120, "That name is too long — 120 characters at most.");

/** Join two vault-relative segments. Always POSIX; the vault speaks in slashes. */
const joinRel = (parent: string, child: string) =>
  parent ? `${parent.replace(/\/+$/, "")}/${child}` : child;

const parentOf = (rel: string) => {
  const cut = rel.lastIndexOf("/");
  return cut === -1 ? "" : rel.slice(0, cut);
};

/* -------------------------------- folders --------------------------------- */

/**
 * A subject is just a top-level folder. There is no row to create, which is why
 * you can also make one by adding a directory in Finder.
 */
export async function createSubject(name: string): Promise<Ok<{ path: string }> | Fail> {
  return createFolder("", name);
}

export async function createFolder(
  parentPath: string,
  name: string,
): Promise<Ok<{ path: string }> | Fail> {
  const parsed = z.object({ parentPath: relPath, name: nameSchema }).safeParse({
    parentPath: parentPath ?? "",
    name: name ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name isn't valid.");

  const clean = vault.cleanName(parsed.data.name);
  if (!clean) return fail("That name is only characters a folder can't have. Try letters.");

  try {
    const existing = await vault.statEntry(joinRel(parsed.data.parentPath, clean));
    if (existing) return fail(`There's already something called "${clean}" here.`);

    const path = await vault.createFolder(parsed.data.parentPath, clean);
    touch();
    return { ok: true, path };
  } catch (err) {
    return fail(message(err, "Couldn't create that folder."));
  }
}

/* --------------------------------- notes ---------------------------------- */

/** A new typed note. Gets `.md` unless you gave it an extension yourself. */
export async function writeNote(
  folderPath: string,
  name: string,
  body: string,
): Promise<Ok<{ path: string }> | Fail> {
  const parsed = z
    .object({
      folderPath: relPath,
      name: nameSchema,
      body: z.string().max(2_000_000, "That note is too long to save."),
    })
    .safeParse({ folderPath: folderPath ?? "", name: name ?? "", body: body ?? "" });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That note isn't valid.");

  const clean = vault.cleanName(parsed.data.name);
  if (!clean) return fail("That name is only characters a file can't have. Try letters.");

  const target = joinRel(parsed.data.folderPath, clean.includes(".") ? clean : `${clean}.md`);

  try {
    // A new note must never land on top of an existing one — that is what
    // saveNote is for, and it is reached by opening the note first.
    const existing = await vault.statEntry(target);
    if (existing) return fail(`There's already a note called "${clean}" here.`);

    const path = await vault.writeNote(target, parsed.data.body);
    touch();
    return { ok: true, path };
  } catch (err) {
    return fail(message(err, "Couldn't write that note."));
  }
}

/**
 * The autosave. Overwriting is the whole point, so there is no clobber check.
 *
 * Deliberately does NOT `touch()`. It fires roughly once a second while you
 * type, and /subjects is force-dynamic: revalidating it re-walks the vault to
 * depth 6 with a `countFiles` recursion per directory, then pushes a fresh RSC
 * payload over the note you are still typing in. The only thing that goes stale
 * is a modified time in the folder listing, which the next real navigation
 * fixes. Every other mutation here still revalidates.
 */
export async function saveNote(
  path: string,
  body: string,
): Promise<Ok<{ path: string; savedAt: number }> | Fail> {
  const parsed = z
    .object({ path: relPath.min(1, "No note was open."), body: z.string().max(2_000_000) })
    .safeParse({ path: path ?? "", body: body ?? "" });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Couldn't save that.");

  try {
    const existing = await vault.statEntry(parsed.data.path);
    if (!existing) return fail("That note isn't there any more.");
    if (existing.isDir) return fail("That's a folder, not a note.");

    const saved = await vault.writeNote(parsed.data.path, parsed.data.body);
    return { ok: true, path: saved, savedAt: Date.now() };
  } catch (err) {
    return fail(message(err, "Couldn't save that note."));
  }
}

/* -------------------------------- uploads --------------------------------- */

/** 60 MB a file. Big enough for a scanned textbook chapter, small enough that a
 *  stray video doesn't quietly fill the disk. Not exported: a `"use server"`
 *  module may only export async functions. */
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export interface UploadReport {
  saved: Array<{ name: string; path: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Uploads report per file rather than failing as a batch: dropping twelve
 * scans and being told only that "the upload failed" tells you nothing about
 * which one was too big.
 */
export async function uploadFiles(fd: FormData): Promise<(Ok<UploadReport>) | Fail> {
  const rawFolder = fd.get("folderPath");
  const parsed = relPath.safeParse(typeof rawFolder === "string" ? rawFolder : "");
  if (!parsed.success) return fail("That folder isn't valid.");
  const folderPath = parsed.data;

  const files = fd.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return fail("No files came through. Try picking them again.");

  try {
    const folder = folderPath ? await vault.statEntry(folderPath) : { isDir: true };
    if (!folder || !folder.isDir) return fail("That folder isn't there any more.");
  } catch (err) {
    return fail(message(err, "That folder isn't valid."));
  }

  const report: UploadReport = { saved: [], skipped: [] };

  for (const file of files) {
    const name = file.name || "upload";
    if (file.size === 0) {
      report.skipped.push({ name, reason: "empty" });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      report.skipped.push({ name, reason: "over 60 MB" });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const path = await vault.saveUpload(folderPath, name, buf);
      report.saved.push({ name, path });
    } catch (err) {
      report.skipped.push({ name, reason: message(err, "couldn't be written") });
    }
  }

  if (report.saved.length) touch();
  if (!report.saved.length && report.skipped.length) {
    const only = report.skipped.length === 1 ? report.skipped[0] : null;
    return fail(
      only
        ? `${only.name} was skipped — ${only.reason}.`
        : `None of those ${report.skipped.length} files could be saved.`,
    );
  }
  return { ok: true, ...report };
}

/* ------------------------------ move / rename ----------------------------- */

export async function renameEntry(
  path: string,
  name: string,
): Promise<Ok<{ path: string }> | Fail> {
  const parsed = z
    .object({ path: relPath.min(1, "Nothing was selected."), name: nameSchema })
    .safeParse({ path: path ?? "", name: name ?? "" });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That name isn't valid.");

  if (!vault.cleanName(parsed.data.name)) {
    return fail("That name is only characters a file can't have. Try letters.");
  }

  try {
    const next = await vault.renameEntry(parsed.data.path, parsed.data.name);
    touch();
    return { ok: true, path: next };
  } catch (err) {
    return fail(message(err, "Couldn't rename that."));
  }
}

export async function moveEntry(
  path: string,
  intoFolder: string,
): Promise<Ok<{ path: string }> | Fail> {
  const parsed = z
    .object({ path: relPath.min(1, "Nothing was selected."), intoFolder: relPath })
    .safeParse({ path: path ?? "", intoFolder: intoFolder ?? "" });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That move isn't valid.");

  if (parentOf(parsed.data.path) === parsed.data.intoFolder) {
    return fail("That's already where it lives.");
  }

  try {
    const dest = parsed.data.intoFolder;
    if (dest) {
      const folder = await vault.statEntry(dest);
      if (!folder || !folder.isDir) return fail("That folder isn't there any more.");
    }
    const next = await vault.moveEntry(parsed.data.path, dest);
    touch();
    return { ok: true, path: next };
  } catch (err) {
    return fail(message(err, "Couldn't move that."));
  }
}

/* --------------------------------- delete --------------------------------- */

/** Deletes a file, or a folder and everything under it. The parent comes back
 *  so the caller knows where to send the person next. */
export async function deleteEntry(path: string): Promise<Ok<{ parent: string }> | Fail> {
  const parsed = relPath.min(1, "Nothing was selected.").safeParse(path ?? "");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That path isn't valid.");

  try {
    const existing = await vault.statEntry(parsed.data);
    if (!existing) return fail("That's already gone.");

    await vault.deleteEntry(parsed.data);
    touch();
    return { ok: true, parent: parentOf(parsed.data) };
  } catch (err) {
    return fail(message(err, "Couldn't delete that."));
  }
}
