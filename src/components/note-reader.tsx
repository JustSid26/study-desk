"use client";

/**
 * The reader / editor pane.
 *
 * Title, subject and tags autosave on a 500ms debounce. Every field is local
 * state, so a save never yanks the caret out of the input you are typing in —
 * the server action revalidates the route, the inputs keep what you typed.
 *
 * The body is rendered by kind. A file note still carries its own `body` as
 * your typed commentary underneath, because a photo of a page of handwriting
 * is only half a note.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { deleteNote, updateNote } from "@/app/actions/notes";
import { Markdown } from "@/components/markdown";
import { Button, Chip, DIALOG_PANEL, Input, Select, linkButtonClass } from "@/components/ui";
import { subjectColor } from "@/components/subject-color";
import { kindLabel } from "@/components/note-list";
import type { SubjectOption } from "@/components/notes-toolbar";
import { formatBytes, relativeTime } from "@/lib/dates";

export interface NoteDetail {
  id: string;
  title: string;
  body: string;
  kind: string;
  subjectId: string | null;
  fileId: string | null;
  fileName: string | null;
  fileSize: number | null;
  mime: string | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

type Patch = {
  title?: string;
  body?: string;
  subjectId?: string | null;
  tags?: string[];
};

type SaveState = { state: "idle" | "saving" | "saved" | "error"; error?: string };

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ------------------------------- file card -------------------------------- */

function FileCard({
  fileId,
  name,
  size,
  note,
}: {
  fileId: string;
  name: string;
  size: number | null;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-line bg-surface-2 px-3.5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-ink">{name}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {size !== null ? formatBytes(size) : "Size unknown"}
          {note ? ` — ${note}` : ""}
        </p>
      </div>
      <a
        href={`/api/files/${encodeURIComponent(fileId)}?download=1`}
        className={linkButtonClass()}
      >
        Download
      </a>
    </div>
  );
}

/* --------------------------------- docx ----------------------------------- */

function DocxBody({ fileId, name, size }: { fileId: string; name: string; size: number | null }) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // No reset here: the parent remounts this component per file (`key={fileId}`),
  // so a fresh mount already starts from the empty state and nothing needs to
  // set state synchronously inside the effect.
  React.useEffect(() => {
    let cancelled = false;

    fetch(`/api/docx/${encodeURIComponent(fileId)}`)
      .then(async (response) => {
        const data: { html?: string; error?: string } = await response.json();
        if (cancelled) return;
        if (!response.ok || typeof data.html !== "string") {
          setError(data.error ?? "That document could not be read.");
          return;
        }
        setHtml(data.html);
      })
      .catch(() => {
        if (!cancelled) setError("That document could not be read.");
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (error) {
    return <FileCard fileId={fileId} name={name} size={size} note={error} />;
  }

  if (html === null) {
    return (
      <p className="flex items-center gap-2.5 text-[13px] text-ink-3">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent"
        />
        Reading the document…
      </p>
    );
  }

  /* The HTML arrives from /api/docx, which runs mammoth's output through the
     same sanitize-html allowlist the Markdown renderer uses. */
  return <div className="prose-note" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* -------------------------------- reader ---------------------------------- */

export function NoteReader({
  note,
  subjects,
}: {
  note: NoteDetail;
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  const dialog = React.useRef<HTMLDialogElement>(null);

  const [title, setTitle] = React.useState(note.title);
  const [body, setBody] = React.useState(note.body);
  const [subjectId, setSubjectId] = React.useState(note.subjectId ?? "");
  const [tagsText, setTagsText] = React.useState(note.tags.join(", "));
  const [editing, setEditing] = React.useState(note.kind === "text" && !note.body);
  const [save, setSave] = React.useState<SaveState>({ state: "idle" });
  const [deleting, setDeleting] = React.useState(false);

  const pending = React.useRef<Patch>({});
  const timer = React.useRef<number | null>(null);
  const savedTimer = React.useRef<number | null>(null);

  const noteId = note.id;

  const flush = React.useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;

    setSave({ state: "saving" });
    try {
      const result = await updateNote(noteId, patch);
      if (!result.ok) {
        setSave({ state: "error", error: result.error });
        return;
      }
      setSave({ state: "saved" });
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => {
        setSave((current) => (current.state === "saved" ? { state: "idle" } : current));
      }, 2400);
    } catch {
      setSave({ state: "error", error: "Couldn't reach the server. Your text is still here." });
    }
  }, [noteId]);

  const flushRef = React.useRef(flush);
  React.useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const queue = React.useCallback(
    (patch: Patch, delay = 500) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void flushRef.current();
      }, delay);
    },
    [],
  );

  // Switching notes unmounts this component (the page keys it by id), so the
  // last debounced edit has to go out on the way down or it is simply lost.
  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      void flushRef.current();
    },
    [],
  );

  async function confirmDelete() {
    setDeleting(true);
    try {
      pending.current = {};
      if (timer.current) window.clearTimeout(timer.current);
      const result = await deleteNote(noteId);
      dialog.current?.close();
      if (!result.ok) {
        setSave({ state: "error", error: result.error });
        return;
      }
      router.replace("/notes", { scroll: false });
    } catch {
      dialog.current?.close();
      setSave({ state: "error", error: "Couldn't delete that note. Try again." });
    } finally {
      setDeleting(false);
    }
  }

  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const hasFile = note.kind !== "text" && !!note.fileId;
  const fileName = note.fileName ?? "Attached file";

  const annotations =
    editing ? (
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          queue({ body: e.target.value });
        }}
        rows={hasFile ? 6 : 18}
        placeholder={
          hasFile
            ? "Your own notes on this file — what it covers, what to revisit."
            : "Write here. Markdown works."
        }
        className="w-full min-w-0 rounded-[7px] border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3"
      />
    ) : body.trim() ? (
      <Markdown source={body} />
    ) : (
      <p className="text-[13px] text-ink-3">
        {hasFile ? "No commentary on this file yet." : "This note is empty."} Choose Edit to
        write.
      </p>
    );

  return (
    <div className="card flex min-w-0 flex-col overflow-hidden">
      {/* ------------------------------ header ----------------------------- */}
      <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              queue({ title: e.target.value });
            }}
            placeholder="Untitled note"
            aria-label="Note title"
            className="min-w-0 flex-1 basis-[200px] border-0 bg-transparent p-0 text-[19px] font-bold tracking-[-0.02em] text-ink placeholder:font-normal placeholder:text-ink-3"
          />
          <span
            aria-live="polite"
            className={`shrink-0 text-[11.5px] ${
              save.state === "error" ? "text-flame" : "text-ink-3"
            }`}
          >
            {save.state === "saving"
              ? "Saving…"
              : save.state === "saved"
                ? "Saved"
                : save.state === "error"
                  ? (save.error ?? "Not saved")
                  : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subject ? <Chip dot={subjectColor(subject.color)}>{subject.name}</Chip> : null}
          <Chip>{kindLabel(note.kind)}</Chip>
          <span suppressHydrationWarning className="text-[11.5px] text-ink-3">
            Edited {relativeTime(note.updatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              queue({ subjectId: e.target.value || null }, 0);
            }}
            aria-label="Subject"
            className="h-9 w-auto min-w-[132px] max-w-[200px]"
          >
            <option value="">Unfiled</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <Input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              queue({ tags: parseTags(e.target.value) });
            }}
            placeholder="Tags, comma separated"
            aria-label="Tags, comma separated"
            className="w-auto min-w-[150px] flex-1 basis-[160px]"
          />

          <Button
            variant={editing ? "primary" : "default"}
            onClick={() => {
              if (editing) void flushRef.current();
              setEditing((v) => !v);
            }}
          >
            {editing ? "Done" : "Edit"}
          </Button>

          <Button
            variant="danger"
            onClick={() => dialog.current?.showModal()}
            aria-label={`Delete ${title.trim() || "this note"}`}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* ------------------------------- body ------------------------------ */}
      <div className="flex min-w-0 flex-col gap-4 px-4 py-4">
        {note.kind === "image" && note.fileId ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${encodeURIComponent(note.fileId)}`}
              alt={title.trim() || fileName}
              className="h-auto max-w-full self-start rounded-[8px] border border-line"
            />
            <a
              href={`/api/files/${encodeURIComponent(note.fileId)}?download=1`}
              className="self-start text-[12px] text-accent underline"
            >
              Download {fileName}
            </a>
          </div>
        ) : null}

        {note.kind === "pdf" && note.fileId ? (
          <div className="flex flex-col gap-2">
            <iframe
              src={`/api/files/${encodeURIComponent(note.fileId)}`}
              title={title.trim() || fileName}
              className="w-full rounded-[8px] border border-line bg-surface-2"
              style={{ height: "min(70vh, 640px)" }}
            />
            <a
              href={`/api/files/${encodeURIComponent(note.fileId)}?download=1`}
              className="self-start text-[12px] text-accent underline"
            >
              Download {fileName} — some browsers block PDFs in a frame
            </a>
          </div>
        ) : null}

        {note.kind === "docx" && note.fileId ? (
          <DocxBody
            key={note.fileId}
            fileId={note.fileId}
            name={fileName}
            size={note.fileSize}
          />
        ) : null}

        {(note.kind === "doc" || note.kind === "file") && note.fileId ? (
          <FileCard
            fileId={note.fileId}
            name={fileName}
            size={note.fileSize}
            note={note.kind === "doc" ? "Word's older .doc format — open it locally" : undefined}
          />
        ) : null}

        {hasFile ? (
          <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
            <h2 className="lbl">Your notes</h2>
            {annotations}
          </div>
        ) : (
          annotations
        )}

        {editing ? (
          <p className="text-[11.5px] text-ink-3">
            Markdown works: **bold**, - lists, # headings, `code`.
          </p>
        ) : null}
      </div>

      {/* ------------------------------ delete ----------------------------- */}
      <dialog
        ref={dialog}
        className={`${DIALOG_PANEL} w-[min(92vw,380px)]`}
        onClose={() => setDeleting(false)}
      >
        <div className="flex flex-col gap-2 p-4">
          <h2 className="text-[15px] font-semibold text-ink">Delete this note?</h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {hasFile
              ? `“${title.trim() || "Untitled note"}” and its uploaded file are removed for good.`
              : `“${title.trim() || "Untitled note"}” is removed for good.`}{" "}
            This cannot be undone.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => dialog.current?.close()} disabled={deleting}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete note"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
