"use client";

/**
 * The left rail: which language, which file, and the three things you do to a
 * file. It is a Client Component only because creating, renaming and deleting
 * each need a `<dialog>` and a pending state — the rows themselves stay real
 * links, so middle-click, the status bar and the back button all still work.
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
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
];

const href = (lang: RailLang, file?: string) =>
  file ? `/practice?lang=${lang}&file=${encodeURIComponent(file)}` : `/practice?lang=${lang}`;

export function FileRail({
  lang,
  files,
  selected,
}: {
  lang: RailLang;
  files: RailFile[];
  selected: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

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
    <div className="flex min-w-0 flex-col gap-3">
      {/* ---------------------------- language ---------------------------- */}
      <div
        role="group"
        aria-label="Language"
        className="grid grid-cols-2 gap-1 rounded-[9px] border border-line bg-surface-2 p-1"
      >
        {LANGS.map(({ id, label }) => {
          const current = id === lang;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={current}
              onClick={() => startTransition(() => router.push(href(id)))}
              className={`h-8 cursor-pointer rounded-[6px] text-[12.5px] font-medium transition-colors ${
                current
                  ? "bg-surface text-ink shadow-[var(--shadow-card)]"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ------------------------------ files ----------------------------- */}
      <section className="card min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2.5">
          <h2 className="lbl">Files</h2>
          <Button size="sm" onClick={openCreate}>
            New file
          </Button>
        </div>

        {files.length === 0 ? (
          <Empty
            title="Nothing here yet"
            action={
              <Button size="sm" variant="primary" onClick={openCreate}>
                New file
              </Button>
            }
          >
            These are real files on disk under{" "}
            <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11px] text-ink">
              practicecode/{lang}/
            </code>
            , so anything you make here also opens in your editor.
          </Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {files.map((f) => {
              const current = f.name === selected;
              return (
                <li
                  key={f.name}
                  className={`group flex items-center gap-1 pr-1.5 ${
                    current ? "bg-accent-soft" : ""
                  }`}
                >
                  <Link
                    href={href(lang, f.name)}
                    aria-current={current ? "page" : undefined}
                    className="min-w-0 flex-1 px-3 py-2.5 no-underline"
                  >
                    <span
                      className={`block truncate font-mono text-[12.5px] ${
                        current ? "font-medium text-ink" : "text-ink-2"
                      }`}
                    >
                      {f.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-3">
                      {f.modifiedText}
                    </span>
                  </Link>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label={`Rename ${f.name}`} onClick={() => openRename(f.name)}>
                      <svg {...ICON} aria-hidden="true">
                        <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
                        <path d="M14.5 6.5 17.5 9.5" />
                      </svg>
                    </IconButton>
                    <IconButton label={`Delete ${f.name}`} onClick={() => openDelete(f.name)}>
                      <svg {...ICON} aria-hidden="true">
                        <path d="M5 7h14" />
                        <path d="M9 7V5h6v2" />
                        <path d="M7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7" />
                      </svg>
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {note ? (
        <p className="text-[11.5px] leading-snug text-ink-3">
          {note}{" "}
          <button
            type="button"
            onClick={() => setNote(null)}
            className="cursor-pointer underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      ) : null}

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
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}
