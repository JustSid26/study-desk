"use client";

/**
 * The left-hand notes panel: search, subject filter, the two ways to add a
 * note, and the list itself.
 *
 * Filtering happens here, in the browser, over the list the server already
 * sent — a personal note library is small and a keystroke should never cost a
 * round trip. The `?q=` parameter is written back with `replace(..., {scroll:
 * false})` so the URL stays shareable and a reload restores the search without
 * pushing a history entry per character.
 *
 * Uploads have three doors and one handler: the file picker, a drop anywhere
 * on the document, and a clipboard paste. Screenshots are the common case —
 * copy, hit paste, and it files itself.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { createNote, uploadNotes } from "@/app/actions/notes";
import { NoteList, type NoteListItem } from "@/components/note-list";
import { Button, Empty, Input, Select } from "@/components/ui";

export interface SubjectOption {
  id: string;
  name: string;
  color: string;
}

const ACCEPT = "image/*,.pdf,.docx,.doc,.txt,.md";

const ALL = "all";
const UNFILED = "unfiled";

type Status = { tone: "ok" | "error"; text: string } | null;

function matches(note: NoteListItem, needle: string): boolean {
  if (!needle) return true;
  return (
    note.title.toLowerCase().includes(needle) ||
    note.snippet.toLowerCase().includes(needle) ||
    (note.fileName ?? "").toLowerCase().includes(needle) ||
    note.tags.some((t) => t.toLowerCase().includes(needle))
  );
}

/** Only the "Files" drag type is ours — dragging selected text must not arm the zone. */
function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

export function NotesToolbar({
  notes,
  subjects,
  selectedId = "",
  initialQuery = "",
}: {
  notes: NoteListItem[];
  subjects: SubjectOption[];
  selectedId?: string;
  initialQuery?: string;
}) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [query, setQuery] = React.useState(initialQuery);
  const [subjectFilter, setSubjectFilter] = React.useState<string>(ALL);
  const [status, setStatus] = React.useState<Status>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  /* ------------------------------ url sync ------------------------------- */

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (selectedId) params.set("note", selectedId);
      const trimmed = query.trim();
      if (trimmed) params.set("q", trimmed);
      const next = params.toString();
      router.replace(next ? `/notes?${next}` : "/notes", { scroll: false });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, selectedId, router]);

  /* ------------------------------ filtering ------------------------------ */

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (subjectFilter === UNFILED && note.subjectId !== null) return false;
      if (subjectFilter !== ALL && subjectFilter !== UNFILED && note.subjectId !== subjectFilter) {
        return false;
      }
      return matches(note, needle);
    });
  }, [notes, query, subjectFilter]);

  const filtering = query.trim() !== "" || subjectFilter !== ALL;

  /* ------------------------------- uploads ------------------------------- */

  const upload = React.useCallback(
    async (incoming: File[]) => {
      const files = incoming.filter((f) => f.size > 0);
      if (!files.length) return;

      setBusy(true);
      setStatus({
        tone: "ok",
        text: `Uploading ${files.length} ${files.length === 1 ? "file" : "files"}…`,
      });

      const fd = new FormData();
      files.forEach((file) => fd.append("files", file));
      if (subjectFilter !== ALL && subjectFilter !== UNFILED) fd.set("subjectId", subjectFilter);

      try {
        const result = await uploadNotes(fd);
        if (!result.ok) {
          setStatus({ tone: "error", text: result.error });
          return;
        }
        setStatus({ tone: "ok", text: result.message });
        // One file in, one note open — the point of pasting a screenshot is to
        // land on it. Several at once stay in the list.
        if (result.noteIds.length === 1) {
          router.push(`/notes?note=${encodeURIComponent(result.noteIds[0])}`, { scroll: false });
        }
      } catch {
        setStatus({ tone: "error", text: "That upload didn't go through. Try again." });
      } finally {
        setBusy(false);
      }
    },
    [router, subjectFilter],
  );

  /* ------------------ drop anywhere, paste anywhere ---------------------- */

  React.useEffect(() => {
    // dragenter/dragleave fire for every child element the pointer crosses, so
    // the overlay is driven by a depth counter rather than by the last event.
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault(); // without this the browser navigates to the file
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void upload(files);
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [upload]);

  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // `clipboardData.files` is empty for a plain text paste, so typing into
      // the search box or a note body is never hijacked.
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      void upload(files);
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload]);

  /* -------------------------------- write -------------------------------- */

  async function write() {
    setBusy(true);
    try {
      const owner =
        subjectFilter !== ALL && subjectFilter !== UNFILED ? subjectFilter : undefined;
      const result = await createNote(owner);
      if (!result.ok) {
        setStatus({ tone: "error", text: result.error });
        return;
      }
      setStatus(null);
      router.push(`/notes?note=${encodeURIComponent(result.id)}`, { scroll: false });
    } catch {
      setStatus({ tone: "error", text: "Couldn't start that note. Try again." });
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="card flex min-w-0 flex-col overflow-hidden">
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-6"
        >
          <div className="rounded-[12px] border-2 border-dashed border-accent bg-surface px-6 py-5 text-center shadow-[var(--shadow-card)]">
            <p className="text-[15px] font-semibold text-ink">Drop to add notes</p>
            <p className="mt-1 text-[12.5px] text-ink-3">
              Photos, PDFs, Word files, text and Markdown.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 border-b border-line-soft p-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
        />

        <Select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          aria-label="Filter by subject"
        >
          <option value={ALL}>All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={UNFILED}>Unfiled</option>
        </Select>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={write} disabled={busy}>
            Write a note
          </Button>
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>
            Upload files
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // so the same file can be picked twice in a row
            if (files.length) void upload(files);
          }}
        />

        {status ? (
          <p
            role="status"
            className={`text-[12px] leading-snug ${
              status.tone === "error" ? "text-flame" : "text-ink-2"
            }`}
          >
            {status.text}
          </p>
        ) : (
          <p className="text-[11.5px] leading-snug text-ink-3">
            Drop files anywhere, or paste a screenshot.
          </p>
        )}
      </div>

      <div className="min-w-0 md:max-h-[calc(100vh-268px)] md:overflow-y-auto">
        {filtered.length ? (
          <NoteList notes={filtered} selectedId={selectedId} query={query.trim()} />
        ) : notes.length === 0 ? (
          <Empty
            title="No notes yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={write} disabled={busy}>
                  Write a note
                </Button>
                <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                  Upload files
                </Button>
              </div>
            }
          >
            Three ways in: write one here, upload a photo or PDF, or paste a screenshot
            straight onto this page.
          </Empty>
        ) : (
          <Empty
            title="Nothing matches"
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setSubjectFilter(ALL);
                }}
              >
                Clear filters
              </Button>
            }
          >
            {filtering
              ? "No note matches that search and subject."
              : "No notes to show."}
          </Empty>
        )}
      </div>
    </div>
  );
}
