/**
 * Notes.
 *
 * Everything lands here: typed notes, photos of handwriting, PDFs, Word files.
 * A Server Component reads the list and, when `?note=<id>` is set, the selected
 * note's full body — the list rows carry only a snippet, so opening a note is
 * the one place the whole text is fetched.
 *
 * On md+ it is a two-pane browser. Under md the two panes take turns: the list
 * until you pick something, then the reader with a link back.
 */
import Link from "next/link";

import { NotesToolbar } from "@/components/notes-toolbar";
import { NoteReader } from "@/components/note-reader";
import { Empty, PageHeader, linkButtonClass } from "@/components/ui";
import { getNote, getNotes, getSubjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const wanted = first(params.note).trim();
  const query = first(params.q).trim();

  const [noteList, subjectList] = await Promise.all([getNotes(), getSubjects()]);
  const selected = wanted ? await getNote(wanted) : null;

  const subjects = subjectList.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const readerOpen = wanted !== "";

  const count = noteList.length;

  return (
    <>
      <PageHeader
        title="Notes"
        sub={
          count
            ? `${count} ${count === 1 ? "note" : "notes"} — writing, photos, PDFs and Word files.`
            : "Writing, photos, PDFs and Word files, all in one place."
        }
      />

      <div className="grid min-w-0 gap-4 md:grid-cols-[340px_minmax(0,1fr)] md:items-start">
        <div className={`min-w-0 ${readerOpen ? "hidden md:block" : "block"}`}>
          <NotesToolbar
            notes={noteList}
            subjects={subjects}
            selectedId={selected?.id ?? ""}
            initialQuery={query}
          />
        </div>

        <div className={`min-w-0 flex-col gap-3 ${readerOpen ? "flex" : "hidden md:flex"}`}>
          {readerOpen ? (
            <Link
              href={query ? `/notes?q=${encodeURIComponent(query)}` : "/notes"}
              scroll={false}
              className="self-start text-[13px] font-medium text-accent md:hidden"
            >
              Back to all notes
            </Link>
          ) : null}

          {selected ? (
            <NoteReader key={selected.id} note={selected} subjects={subjects} />
          ) : readerOpen ? (
            <div className="card">
              <Empty
                title="That note is gone"
                action={
                  <Link
                    href="/notes"
                    scroll={false}
                    className={linkButtonClass()}
                  >
                    Back to all notes
                  </Link>
                }
              >
                It was deleted, or the link points at an id that never existed.
              </Empty>
            </div>
          ) : (
            <div className="card">
              <Empty title="Nothing open">
                Pick a note from the list. Or start one: write it, upload a photo or PDF, or
                paste a screenshot anywhere on this page.
              </Empty>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
