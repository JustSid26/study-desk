"use server";

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { notes, noteTags, files, subjects, type NoteKind } from "@/db/schema";
import { newId, safeExtension } from "@/lib/id";
import { ensureDataDirs, UPLOADS_DIR, resolveUpload } from "@/lib/paths";

const MAX_BYTES = 60 * 1024 * 1024; // 60 MB

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

function fail(error: string): Fail {
  return { ok: false, error };
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "That input isn't valid.";
}

function touch() {
  revalidatePath("/");
  revalidatePath("/notes");
}

function cleanTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .map((t) => t.slice(0, 40)),
    ),
  ].slice(0, 20);
}

async function replaceNoteTags(noteId: string, tags: string[]) {
  await db.delete(noteTags).where(eq(noteTags.noteId, noteId));
  const clean = cleanTags(tags);
  if (clean.length) {
    await db
      .insert(noteTags)
      .values(clean.map((tag) => ({ noteId, tag })))
      .onConflictDoNothing();
  }
}

async function subjectExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  return rows.length > 0;
}

/* --------------------------------- create --------------------------------- */

/** An empty typed note. Returns the id so the page can select it straight away. */
export async function createNote(subjectId?: string | null): Promise<Ok<{ id: string }> | Fail> {
  try {
    const owner = subjectId?.trim() || null;
    if (owner && !(await subjectExists(owner))) {
      return fail("That subject no longer exists.");
    }

    const id = newId();
    const now = Date.now();
    await db.insert(notes).values({
      id,
      subjectId: owner,
      title: "",
      body: "",
      kind: "text",
      createdAt: now,
      updatedAt: now,
    });

    touch();
    return { ok: true, id };
  } catch {
    return fail("Couldn't create that note. Try again.");
  }
}

/* --------------------------------- update --------------------------------- */

const patchSchema = z.object({
  title: z.string().max(200, "Keep the title under 200 characters.").optional(),
  body: z.string().max(500_000, "That note is too long to save.").optional(),
  subjectId: z.string().nullable().optional(),
  tags: z.array(z.string()).max(20, "Twenty tags is plenty.").optional(),
});

export async function updateNote(
  id: string,
  patch: {
    title?: string;
    body?: string;
    subjectId?: string | null;
    tags?: string[];
  },
): Promise<Ok<{ updatedAt: number }> | Fail> {
  if (!id) return fail("That note no longer exists.");

  const parsed = patchSchema.safeParse(patch ?? {});
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    const existing = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.id, id))
      .limit(1);
    if (!existing.length) return fail("That note no longer exists.");

    const updatedAt = Date.now();
    const set: Record<string, unknown> = { updatedAt };

    if (parsed.data.title !== undefined) set.title = parsed.data.title.trim();
    if (parsed.data.body !== undefined) set.body = parsed.data.body;
    if (parsed.data.subjectId !== undefined) {
      const owner = parsed.data.subjectId?.trim() || null;
      if (owner && !(await subjectExists(owner))) {
        return fail("That subject no longer exists.");
      }
      set.subjectId = owner;
    }

    await db.update(notes).set(set).where(eq(notes.id, id));

    if (parsed.data.tags !== undefined) {
      await replaceNoteTags(id, parsed.data.tags);
    }

    touch();
    return { ok: true, updatedAt };
  } catch {
    return fail("Couldn't save that note. Try again.");
  }
}

/* --------------------------------- delete --------------------------------- */

/**
 * Deletes the note, its file row and the blob on disk. A blob that has already
 * gone missing must not block the delete — the database row is the thing the
 * user asked to be rid of.
 */
export async function deleteNote(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That note no longer exists.");

  try {
    const rows = await db
      .select({ id: notes.id, fileId: notes.fileId })
      .from(notes)
      .where(eq(notes.id, id))
      .limit(1);
    if (!rows.length) return fail("That note no longer exists.");

    const fileId = rows[0].fileId;
    let relative: string | null = null;
    if (fileId) {
      const fileRows = await db
        .select({ path: files.path })
        .from(files)
        .where(eq(files.id, fileId))
        .limit(1);
      relative = fileRows[0]?.path ?? null;
    }

    await db.delete(notes).where(eq(notes.id, id)); // note_tags cascade
    if (fileId) await db.delete(files).where(eq(files.id, fileId));

    if (relative) {
      try {
        await fs.promises.unlink(resolveUpload(relative));
      } catch {
        /* already gone, or outside the uploads dir — the rows are what matter */
      }
    }

    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't delete that note. Try again.");
  }
}

/* --------------------------------- upload --------------------------------- */

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".text"]);

function kindFor(mime: string, ext: string): NoteKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || ext === ".pdf") return "pdf";
  if (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    return "docx";
  }
  if (m === "application/msword" || ext === ".doc") return "doc";
  if (m.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic"].includes(ext)) return "image";
  return "file";
}

function isInlineText(mime: string, ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const m = (mime || "").toLowerCase();
  return m === "text/plain" || m === "text/markdown" || m === "text/x-markdown";
}

function titleFrom(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
  return (base || name || "Untitled").slice(0, 200);
}

/**
 * Multiple files in one go. Every file is judged on its own: one oversized PDF
 * doesn't cost you the other nine, and the caller gets told exactly what was
 * skipped and why.
 */
export async function uploadNotes(fd: FormData): Promise<
  | Ok<{
      added: number;
      noteIds: string[];
      skipped: Array<{ name: string; reason: string }>;
      message: string;
    }>
  | Fail
> {
  const raw = fd.getAll("files");
  const incoming = raw.filter((f): f is File => typeof f !== "string" && f instanceof File);

  if (!incoming.length) return fail("Choose at least one file to upload.");

  const subjectRaw = fd.get("subjectId");
  const subjectId = typeof subjectRaw === "string" && subjectRaw.trim() ? subjectRaw.trim() : null;
  if (subjectId && !(await subjectExists(subjectId))) {
    return fail("That subject no longer exists.");
  }

  const noteIds: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  try {
    ensureDataDirs();
  } catch {
    return fail("Couldn't open the data folder to save uploads.");
  }

  for (const file of incoming) {
    const name = (file.name || "file").slice(0, 200);

    if (file.size === 0) {
      skipped.push({ name, reason: "the file is empty" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ name, reason: "it's over the 60 MB limit" });
      continue;
    }

    const ext = safeExtension(name);
    const mime = file.type || "application/octet-stream";
    const now = Date.now();

    try {
      // A plain-text or Markdown upload is just a note. Keeping a copy of the
      // bytes on disk as well would only give you two things to keep in sync.
      if (isInlineText(mime, ext)) {
        const body = await file.text();
        const noteId = newId();
        await db.insert(notes).values({
          id: noteId,
          subjectId,
          title: titleFrom(name),
          body,
          kind: "text",
          fileId: null,
          createdAt: now,
          updatedAt: now,
        });
        noteIds.push(noteId);
        continue;
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const fileId = newId();
      const relative = `${fileId}${ext}`;
      const absolute = path.join(UPLOADS_DIR, relative);

      await fs.promises.writeFile(absolute, bytes);

      await db.insert(files).values({
        id: fileId,
        name,
        mime,
        size: bytes.byteLength,
        path: relative, // relative to UPLOADS_DIR, never absolute
        sha256: createHash("sha256").update(bytes).digest("hex"),
        createdAt: now,
      });

      const noteId = newId();
      await db.insert(notes).values({
        id: noteId,
        subjectId,
        title: titleFrom(name),
        body: "",
        kind: kindFor(mime, ext),
        fileId,
        createdAt: now,
        updatedAt: now,
      });
      noteIds.push(noteId);
    } catch {
      skipped.push({ name, reason: "it couldn't be saved to disk" });
    }
  }

  if (noteIds.length) touch();

  if (!noteIds.length) {
    const why = skipped[0]?.reason ?? "nothing could be read";
    return fail(
      skipped.length === 1
        ? `${skipped[0].name} wasn't added — ${why}.`
        : `None of the ${skipped.length} files were added — the first failed because ${why}.`,
    );
  }

  const added = noteIds.length;
  const message =
    skipped.length === 0
      ? `Added ${added} ${added === 1 ? "note" : "notes"}.`
      : `Added ${added} of ${added + skipped.length}. Skipped ${skipped
          .map((s) => `${s.name} — ${s.reason}`)
          .join("; ")}.`;

  return { ok: true, added, noteIds, skipped, message };
}
