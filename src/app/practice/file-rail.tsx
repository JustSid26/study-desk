"use client";

/**
 * The explorer: both language folders and every file in them, laid out the way
 * an editor's file tree is — a chevron per folder, an indent guide down the
 * children, one compact row per file, and the row actions revealed on hover.
 *
 * Showing both folders at once replaces the old language toggle: picking a file
 * is picking its language, which is one decision rather than two.
 *
 * It is a Client Component only because creating, renaming and deleting each
 * need a `<dialog>` and a pending state — the rows themselves stay real links,
 * so middle-click, the status bar and the back button all still work.
 *
 * Modified times arrive pre-formatted from the server. Calling `relativeTime`
 * here instead would render "2m ago" on the server and "3m ago" on the client
 * and trip a hydration mismatch on every slow load.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, DIALOG_PANEL, Empty, Field, Input } from "@/components/ui";
import { createFile, deleteFile, renameFile } from "@/app/actions/practice";

export type RailLang = "java" | "python";

export interface RailFile {
  name: string;
  modifiedText: string;
}

const LANGS: Array<{ id: RailLang; label: string }> = [
  { id: "java", label: "java" },
  { id: "python", label: "python" },
];

/** Chevron; rotated by CSS so the open and closed states cannot disagree. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function FileGlyph({ lang }: { lang: RailLang }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 font-mono text-[9px] font-semibold leading-none tracking-tight text-ink-3"
    >
      {lang === "java" ? "J" : "PY"}
    </span>
  );
}

const href = (lang: RailLang, file?: string) =>
  file ? `/practice?lang=${lang}&file=${encodeURIComponent(file)}` : `/practice?lang=${lang}`;

export function FileRail({
  lang,
  filesByLang,
  selected,
}: {
  /** the language of the open file, so its folder starts expanded */
  lang: RailLang;
  filesByLang: Record<RailLang, RailFile[]>;
  selected: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const byLang = filesByLang;

  // The open file's folder starts expanded; the other opens if it has anything
  // in it, so a new user sees both rather than one collapsed mystery.
  const [expanded, setExpanded] = React.useState<Record<RailLang, boolean>>(() => ({
    java: lang === "java" || byLang.java.length > 0,
    python: lang === "python" || byLang.python.length > 0,
  }));
  const toggle = (id: RailLang) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const createRef = React.useRef<HTMLDialogElement>(null);
  const renameRef = React.useRef<HTMLDialogElement>(null);
  const deleteRef = React.useRef<HTMLDialogElement>(null);

  const [newName, setNewName] = React.useState("");
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameTo, setRenameTo] = React.useState("");
  const [doomed, setDoomed] = React.useState<string | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  function openCreate() {
    setNewName("");
    setError(null);
    createRef.current?.showModal();
  }

  function openRename(file: string) {
    setRenaming(file);
    setRenameTo(file.replace(/\.(java|py)$/i, ""));
    setError(null);
    renameRef.current?.showModal();
  }

  function openDelete(file: string) {
    setDoomed(file);
    setError(null);
    deleteRef.current?.showModal();
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await createFile({ lang, name: newName });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    createRef.current?.close();
    setNote(res.note);
    startTransition(() => router.push(href(lang, res.name)));
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setError(null);
    const res = await renameFile({ lang, file: renaming, nextName: renameTo });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    renameRef.current?.close();
    setNote(res.note);
    startTransition(() => router.push(href(lang, res.name)));
  }

  async function submitDelete() {
    if (!doomed) return;
    setError(null);
    const res = await deleteFile({ lang, file: doomed });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    deleteRef.current?.close();
    setNote(`${doomed} is gone.`);
    const wasOpen = doomed === selected;
    setDoomed(null);
    startTransition(() => {
      router.push(wasOpen ? href(lang) : href(lang, selected ?? undefined));
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* ------------------------------ explorer ---------------------------- */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-2.5 py-2">
          <h2 className="lbl truncate">Explorer</h2>
          <Button size="sm" variant="ghost" onClick={openCreate} title="New file">
            New file
          </Button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto py-1" role="tree" aria-label="Practice files">
          {LANGS.map(({ id, label }) => {
            const own = byLang[id];
            const open = expanded[id];
            return (
              <div key={id} role="treeitem" aria-expanded={open} aria-selected={false}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="flex w-full cursor-pointer items-center gap-1 px-2 py-[3px] text-left text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <Chevron open={open} />
                  <span className="truncate font-medium">{label}</span>
                  <span className="ml-auto shrink-0 pl-1 font-mono text-[10.5px] tabular-nums text-ink-3">
                    {own.length}
                  </span>
                </button>

                {open ? (
                  own.length === 0 ? (
                    <p className="py-1 pl-[26px] pr-2 text-[11.5px] text-ink-3">No files yet</p>
                  ) : (
                    <ul role="group" className="relative">
                      {/* The indent guide, drawn once behind the children rather
                          than as a border on each row, so it is unbroken. */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-0 left-[13px] top-0 w-px bg-line"
                      />
                      {own.map((f) => {
                        const current = id === lang && f.name === selected;
                        return (
                          <li key={f.name} role="none" className="group/row relative">
                            <Link
                              href={href(id, f.name)}
                              role="treeitem"
                              aria-selected={current}
                              aria-current={current ? "page" : undefined}
                              title={`${f.name} — ${f.modifiedText}`}
                              className={`flex min-w-0 items-center gap-1.5 py-[3px] pl-[26px] pr-14 no-underline ${
                                current
                                  ? "bg-accent-soft text-ink"
                                  : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                              }`}
                            >
                              <FileGlyph lang={id} />
                              <span className="truncate font-mono text-[12px]">{f.name}</span>
                            </Link>

                            {/* Actions sit over the row. They appear on hover and
                                on keyboard focus, so they are reachable without a
                                pointer — `group-focus-within` covers tabbing in. */}
                            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                              <IconButton
                                label={`Rename ${f.name}`}
                                onClick={() => openRename(f.name)}
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m14 5 4 4" />
                                </svg>
                              </IconButton>
                              <IconButton
                                label={`Delete ${f.name}`}
                                onClick={() => openDelete(f.name)}
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="m6 7 1 13h10l1-13" />
                                </svg>
                              </IconButton>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="shrink-0 border-t border-line-soft px-2.5 py-2 text-[11px] leading-snug text-ink-3">
          Real files under{" "}
          <code className="rounded bg-surface-2 px-1 py-px font-mono text-[10.5px] text-ink">
            practicecode/
          </code>
          , so they open in your editor too.
        </p>
      </section>

      {/* ----------------------------- dialogs ---------------------------- */}
      <dialog
        ref={createRef}
        aria-labelledby="practice-create-title"
        className={`${DIALOG_PANEL} w-[min(400px,92vw)]`}
        onClose={() => setError(null)}
      >
        <form onSubmit={submitCreate} className="flex flex-col gap-3.5 p-4">
          <h2 id="practice-create-title" className="text-[15px] font-semibold text-ink">
            New {lang === "java" ? "Java" : "Python"} file
          </h2>
          <Field
            label="Name"
            hint={
              lang === "java"
                ? "The file and its public class have to share a name, so this becomes the class name too."
                : "Letters, numbers and underscores. The .py is added for you."
            }
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={lang === "java" ? "TwoSum" : "two_sum"}
              autoFocus
            />
          </Field>
          {error ? (
            <p role="alert" className="text-[12.5px]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => createRef.current?.close()}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || !newName.trim()}>
              Create
            </Button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={renameRef}
        aria-labelledby="practice-rename-title"
        className={`${DIALOG_PANEL} w-[min(400px,92vw)]`}
        onClose={() => setError(null)}
      >
        <form onSubmit={submitRename} className="flex flex-col gap-3.5 p-4">
          <h2 id="practice-rename-title" className="text-[15px] font-semibold text-ink">
            Rename {renaming}
          </h2>
          <Field
            label="New name"
            hint={
              lang === "java"
                ? "The class declared inside is renamed with the file, so it still compiles."
                : undefined
            }
          >
            <Input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              autoFocus
            />
          </Field>
          {error ? (
            <p role="alert" className="text-[12.5px]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => renameRef.current?.close()}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || !renameTo.trim()}>
              Rename
            </Button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteRef}
        aria-labelledby="practice-delete-title"
        className={`${DIALOG_PANEL} w-[min(400px,92vw)]`}
        onClose={() => setError(null)}
      >
        <div className="flex flex-col gap-3.5 p-4">
          <h2 id="practice-delete-title" className="text-[15px] font-semibold text-ink">
            Delete {doomed}?
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            This removes the file from disk. It doesn&apos;t go to the Trash, and there is no
            undo here.
          </p>
          {error ? (
            <p role="alert" className="text-[12.5px]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => deleteRef.current?.close()}>Keep it</Button>
            <Button variant="danger" onClick={() => void submitDelete()} disabled={pending}>
              Delete
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/* --------------------------------- icons ---------------------------------- */

const ICON = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
    >
      {children}
    </button>
  );
}
