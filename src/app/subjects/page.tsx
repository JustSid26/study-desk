/**
 * Subjects.
 *
 * A subject is a folder under `data/subjects/`, a unit or a chapter is a folder
 * inside it, and a note is a file. There is no notes table shadowing any of it,
 * which is why this page is a file browser rather than a list view: the tree on
 * the left is the directory tree, and the cards on the right are what `ls`
 * would print.
 *
 * The whole left rail is `<details>` elements, so expanding a subject costs no
 * JavaScript at all — the only client code on this page is the bits that need a
 * handler: the uploader, the create dialogs and the note reader.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardBody, CardHeader, Empty, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { NoteView, type FolderOption } from "@/components/note-view";
import { formatBytes, relativeTime } from "@/lib/dates";
import {
  kindForFile,
  listDir,
  readNote,
  statEntry,
  tree,
  type NoteKind,
  type VaultEntry,
  type VaultNode,
} from "@/lib/vault";

import { NewEntry } from "./new-entry";
import { Uploader } from "./uploader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subjects — Study Tracker",
  description: "Your subjects, units and notes, as folders and files on disk.",
};

/* -------------------------------- helpers --------------------------------- */

const parentOf = (rel: string) => {
  const cut = rel.lastIndexOf("/");
  return cut === -1 ? "" : rel.slice(0, cut);
};

const folderHref = (rel: string) =>
  rel ? `/subjects?path=${encodeURIComponent(rel)}` : "/subjects";

const noteHref = (rel: string) => `/subjects?file=${encodeURIComponent(rel)}`;

const KIND_LABEL: Record<NoteKind, string> = {
  markdown: "Markdown",
  text: "Text",
  image: "Image",
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  file: "File",
};

/** A .txt big enough to be a database dump is not something to paint as prose. */
const MAX_INLINE_TEXT = 1_500_000;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every folder in the vault, flattened, for the Move destination list. */
function flattenFolders(nodes: VaultNode[], out: FolderOption[] = []): FolderOption[] {
  for (const n of nodes) {
    if (!n.isDir) continue;
    out.push({ rel: n.rel, label: n.rel.split("/").join(" / ") });
    if (n.children) flattenFolders(n.children, out);
  }
  return out;
}

/* --------------------------------- icons ---------------------------------- */

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17Z" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 3.5h7l5 5v12H6Z" />
      <path d="M13 3.5v5h5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-90"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/* ---------------------------------- tree ---------------------------------- */

const ROW =
  "flex min-w-0 items-center gap-1.5 rounded-[6px] py-[5px] pr-2 text-[12.5px] no-underline transition-colors";

function TreeList({
  nodes,
  depth,
  activeFolder,
  activeFile,
}: {
  nodes: VaultNode[];
  depth: number;
  activeFolder: string;
  activeFile: string;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => {
        const pad = { paddingLeft: 6 + depth * 13 };

        if (!node.isDir) {
          const current = node.rel === activeFile;
          return (
            <li key={node.rel}>
              <Link
                href={noteHref(node.rel)}
                aria-current={current ? "page" : undefined}
                style={pad}
                className={`${ROW} ${
                  current
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <span className="w-3 shrink-0" aria-hidden="true" />
                <FileIcon className="shrink-0 text-ink-3" />
                <span className="truncate">{node.name}</span>
              </Link>
            </li>
          );
        }

        // Open every folder on the way to whatever is being looked at.
        const onPath = activeFolder === node.rel || activeFolder.startsWith(`${node.rel}/`);
        const current = !activeFile && activeFolder === node.rel;
        const children = node.children ?? [];

        // Two affordances, two controls. The link used to be the whole content
        // of the <summary>: being display:flex it filled the row, so every
        // click landed on the anchor and navigated, the toggle never fired, and
        // a folder could be opened only by navigating into it and never closed
        // — while the chevron's rotation advertised a disclosure that did
        // nothing. The link now sits outside <details> so it stays visible when
        // the folder is collapsed, and the <summary> is the chevron alone,
        // overlaid on the row's leading slot.
        return (
          <li key={node.rel} className="relative">
            <Link
              href={folderHref(node.rel)}
              aria-current={current ? "page" : undefined}
              style={{ paddingLeft: 6 + depth * 13 + 18 }}
              className={`${ROW} ${
                current
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <FolderIcon className="shrink-0" />
              <span className="truncate">{node.name}</span>
              <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] tabular-nums text-ink-3">
                {node.fileCount ?? 0}
              </span>
            </Link>

            <details open={onPath} className="group">
              <summary
                aria-label={`Toggle ${node.name}`}
                style={{ left: 6 + depth * 13 }}
                className="absolute top-0 flex h-6 w-3 cursor-pointer list-none items-center justify-center rounded-[3px] hover:text-ink [&::-webkit-details-marker]:hidden"
              >
                <Chevron />
              </summary>

              {children.length ? (
                <TreeList
                  nodes={children}
                  depth={depth + 1}
                  activeFolder={activeFolder}
                  activeFile={activeFile}
                />
              ) : (
                <p
                  style={{ paddingLeft: 6 + (depth + 1) * 13 }}
                  className="py-[5px] text-[11.5px] text-ink-3"
                >
                  Empty
                </p>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------- breadcrumbs ------------------------------- */

function Breadcrumbs({ path }: { path: string }) {
  const segments = path ? path.split("/") : [];

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-3">
        <li>
          {segments.length ? (
            <Link href="/subjects" className="no-underline hover:text-ink">
              All subjects
            </Link>
          ) : (
            <span aria-current="page" className="font-medium text-ink">
              All subjects
            </span>
          )}
        </li>
        {segments.map((segment, i) => {
          const rel = segments.slice(0, i + 1).join("/");
          const last = i === segments.length - 1;
          return (
            <li key={rel} className="flex items-center gap-x-1.5">
              <span aria-hidden="true">/</span>
              {last ? (
                <span aria-current="page" className="font-medium text-ink">
                  {segment}
                </span>
              ) : (
                <Link href={folderHref(rel)} className="no-underline hover:text-ink">
                  {segment}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------- cards --------------------------------- */

const CARD_LINK =
  "card flex min-w-0 flex-col gap-1 px-3.5 py-3 no-underline transition-shadow hover:shadow-[var(--shadow-lift)]";

function EntryCard({ entry }: { entry: VaultEntry }) {
  if (entry.isDir) {
    const count = entry.fileCount ?? 0;
    return (
      <Link href={folderHref(entry.rel)} className={CARD_LINK}>
        <span className="flex items-center gap-2 text-ink-3">
          <FolderIcon />
          <span className="lbl">Folder</span>
        </span>
        <span className="truncate text-[13.5px] font-medium text-ink">{entry.name}</span>
        <span className="font-mono text-[11px] text-ink-3">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </Link>
    );
  }

  return (
    <Link href={noteHref(entry.rel)} className={CARD_LINK}>
      <span className="flex items-center gap-2 text-ink-3">
        <FileIcon />
        <span className="lbl">{KIND_LABEL[entry.kind]}</span>
      </span>
      <span className="truncate text-[13.5px] font-medium text-ink">{entry.name}</span>
      <span className="font-mono text-[11px] text-ink-3">
        {formatBytes(entry.size)} · {relativeTime(entry.modified)}
      </span>
    </Link>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default async function SubjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Both come off the URL, so neither is trusted: `statEntry` resolves through
  // `insideVault` and returns null for anything outside the vault or gone.
  const fileParam = first(params.file);
  const pathParam = first(params.path);

  const fileEntry = fileParam ? await statEntry(fileParam) : null;
  const openFile = fileEntry && !fileEntry.isDir ? fileEntry : null;

  const pathEntry = pathParam ? await statEntry(pathParam) : null;
  const currentPath = openFile
    ? parentOf(openFile.rel)
    : pathEntry?.isDir
      ? pathEntry.rel
      : fileEntry?.isDir
        ? fileEntry.rel
        : "";

  const [nodes, entries] = await Promise.all([tree(), listDir(currentPath)]);

  const isRoot = currentPath === "";

  /* ------------------------------ note reader ----------------------------- */

  let reader: React.ReactNode = null;
  if (openFile) {
    const kind = kindForFile(openFile.name);
    const readable = (kind === "markdown" || kind === "text") && openFile.size <= MAX_INLINE_TEXT;

    let body: string | null = null;
    if (readable) {
      try {
        body = await readNote(openFile.rel);
      } catch {
        body = null; // unreadable on disk — fall through to the file card
      }
    }

    const folders: FolderOption[] = [
      { rel: "", label: "All subjects" },
      ...flattenFolders(nodes),
    ];

    // A note whose body never made it here must not open in the editor: an
    // autosave from an empty textarea would write that emptiness to disk.
    const displayKind: NoteKind =
      (kind === "markdown" || kind === "text") && body === null ? "file" : kind;

    reader = (
      <NoteView
        key={openFile.rel}
        path={openFile.rel}
        name={openFile.name}
        kind={displayKind}
        size={openFile.size}
        modifiedText={relativeTime(openFile.modified)}
        folderPath={parentOf(openFile.rel)}
        folderLabel={parentOf(openFile.rel).split("/").pop() || "All subjects"}
        body={body}
        preview={<Markdown source={body ?? ""} />}
        folders={folders}
      />
    );
  }

  /* ------------------------------ folder view ----------------------------- */

  const grid = entries.length ? (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <EntryCard key={entry.rel} entry={entry} />
      ))}
    </div>
  ) : isRoot ? (
    <Card>
      <Empty
        title="No subjects yet"
        action={<NewEntry folderPath="" isRoot emphasis />}
      >
        A subject is a folder on disk, under <code className="font-mono">data/subjects</code>. Units
        and chapters are folders inside it, and your notes are the files in those folders — so you
        can also make one by adding a directory in Finder.
      </Empty>
    </Card>
  ) : (
    <Card>
      <Empty
        title="Nothing in here yet"
        action={<NewEntry folderPath={currentPath} isRoot={false} emphasis />}
      >
        Add a folder for a unit or a chapter, write a note, or drop a PDF or a screenshot straight
        onto this pane.
      </Empty>
    </Card>
  );

  const folderView = (
    <div className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs path={currentPath} />
      <Uploader
        folderPath={currentPath}
        toolbar={<NewEntry folderPath={currentPath} isRoot={isRoot} />}
      >
        {grid}
      </Uploader>
    </div>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <>
      <PageHeader
        title="Subjects"
        sub="Every subject is a folder, every note is a file. Back it up by copying one directory."
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto">
          <Card>
            <CardHeader>
              <h2 className="text-[13px] font-semibold text-ink">Folders</h2>
              <span className="lbl">{nodes.length} subjects</span>
            </CardHeader>
            <CardBody className="px-1.5 py-2">
              {nodes.length ? (
                <TreeList
                  nodes={nodes}
                  depth={0}
                  activeFolder={currentPath}
                  activeFile={openFile?.rel ?? ""}
                />
              ) : (
                <p className="px-2.5 py-2 text-[12.5px] leading-snug text-ink-3">
                  No subjects yet. The first folder you make shows up here.
                </p>
              )}
            </CardBody>
          </Card>
        </aside>

        <div className="min-w-0">{reader ?? folderView}</div>
      </div>
    </>
  );
}
