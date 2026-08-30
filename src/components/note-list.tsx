/**
 * The note list rows.
 *
 * No "use client" of its own — it is pure markup with `<Link>`s — but it is
 * rendered by the (client) notes panel, so it must not touch anything
 * `server-only`. `relativeTime` and `subjectColor` are both pure helpers.
 */
import Link from "next/link";

import { Chip } from "@/components/ui";
import { subjectColor } from "@/components/subject-color";
import { relativeTime } from "@/lib/dates";

export interface NoteListItem {
  id: string;
  title: string;
  snippet: string;
  kind: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  fileId: string | null;
  fileName: string | null;
  fileSize: number | null;
  mime: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

const KIND_LABEL: Record<string, string> = {
  text: "Note",
  image: "Image",
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  file: "File",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "File";
}

/** "notes-for-tuesday.PDF" -> "PDF". A typed note has no file, so name the format. */
function badgeText(note: NoteListItem): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(note.fileName ?? "");
  if (match) return match[1].toUpperCase().slice(0, 4);
  if (note.kind === "text") return "MD";
  return note.kind.toUpperCase().slice(0, 4);
}

function href(id: string, query: string): string {
  const params = new URLSearchParams();
  params.set("note", id);
  if (query) params.set("q", query);
  return `/notes?${params.toString()}`;
}

export function NoteList({
  notes,
  selectedId,
  query = "",
}: {
  notes: NoteListItem[];
  selectedId?: string;
  query?: string;
}) {
  return (
    <ul className="flex flex-col">
      {notes.map((note) => {
        const selected = note.id === selectedId;
        const secondary = note.snippet || note.fileName || "No text yet";

        return (
          <li key={note.id} className="border-b border-line-soft last:border-b-0">
            <Link
              href={href(note.id, query)}
              aria-current={selected ? "true" : undefined}
              className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${
                selected ? "bg-accent-soft" : "hover:bg-surface-2"
              }`}
            >
              {note.kind === "image" && note.fileId ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/files/${encodeURIComponent(note.fileId)}`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-11 w-[38px] shrink-0 rounded-[5px] border border-line object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-11 w-[38px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface-2 font-mono text-[9.5px] font-medium tracking-[0.06em] text-ink-3"
                >
                  {badgeText(note)}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold leading-snug text-ink">
                  {note.title.trim() || "Untitled note"}
                </span>
                <span className="mt-0.5 block truncate text-[12px] leading-snug text-ink-3">
                  {secondary}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {note.subjectName ? (
                    <Chip dot={subjectColor(note.subjectColor)}>{note.subjectName}</Chip>
                  ) : null}
                  <Chip>{kindLabel(note.kind)}</Chip>
                  <span
                    suppressHydrationWarning
                    className="text-[11.5px] leading-none text-ink-3"
                  >
                    {relativeTime(note.updatedAt)}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
