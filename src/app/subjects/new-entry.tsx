"use client";

/**
 * The two ways to add something that isn't a file you already have: a folder,
 * and a typed note.
 *
 * Both are `<dialog>` rather than an inline field, because both need a name and
 * a note also needs a body, and a form that grows out of a toolbar shifts the
 * grid underneath it. Rendered in the toolbar and again inside an empty state,
 * so the button that fixes an empty folder is the real button, not a pointer to
 * one somewhere else on the page.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button, DIALOG_PANEL, Field, Input, Textarea } from "@/components/ui";
import { createFolder, createSubject, writeNote } from "@/app/actions/vault";

export function NewEntry({
  folderPath,
  isRoot,
  emphasis = false,
}: {
  folderPath: string;
  isRoot: boolean;
  /** In an empty state the primary action carries the weight. */
  emphasis?: boolean;
}) {
  const router = useRouter();
  // Plain refs rather than a `useDialog()` wrapper: reading `.current` only
  // ever happens inside a handler, which is the one place a ref may be read.
  const folder = React.useRef<HTMLDialogElement>(null);
  const note = React.useRef<HTMLDialogElement>(null);

  const [pending, start] = React.useTransition();
  const [folderName, setFolderName] = React.useState("");
  const [folderError, setFolderError] = React.useState<string | null>(null);
  const [noteName, setNoteName] = React.useState("");
  const [noteBody, setNoteBody] = React.useState("");
  const [noteError, setNoteError] = React.useState<string | null>(null);

  function submitFolder() {
    setFolderError(null);
    start(async () => {
      const res = isRoot
        ? await createSubject(folderName)
        : await createFolder(folderPath, folderName);
      if (!res.ok) {
        setFolderError(res.error);
        return;
      }
      setFolderName("");
      folder.current?.close();
      router.push(`/subjects?path=${encodeURIComponent(res.path)}`);
    });
  }

  function submitNote() {
    setNoteError(null);
    start(async () => {
      const res = await writeNote(folderPath, noteName, noteBody);
      if (!res.ok) {
        setNoteError(res.error);
        return;
      }
      setNoteName("");
      setNoteBody("");
      note.current?.close();
      router.push(`/subjects?file=${encodeURIComponent(res.path)}`);
    });
  }

  return (
    <>
      <Button variant={emphasis ? "primary" : "default"} onClick={() => folder.current?.showModal()}>
        {isRoot ? "New subject" : "New folder"}
      </Button>
      <Button onClick={() => note.current?.showModal()}>Write a note</Button>

      {/* -------------------------------- folder ------------------------------- */}
      <dialog
        ref={folder}
        aria-labelledby="new-folder-heading"
        className={`${DIALOG_PANEL} w-[min(26rem,calc(100vw-2rem))]`}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submitFolder();
          }}
        >
          <div className="border-b border-line-soft px-4 py-3">
            <h3 id="new-folder-heading" className="text-[15px] font-semibold text-ink">
              {isRoot ? "New subject" : "New folder"}
            </h3>
          </div>
          <div className="px-4 py-4">
            <Field
              label="Name"
              hint={
                isRoot
                  ? "A subject is a folder on disk. Units and chapters are folders inside it."
                  : "Use it for a unit, a chapter, or anything else you want to keep together."
              }
            >
              <Input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder={isRoot ? "Operating Systems" : "Unit 3 — Paging"}
                maxLength={120}
              />
            </Field>
            {folderError ? (
              <p role="alert" className="mt-3 text-[12.5px] leading-snug">
                {folderError}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Button variant="ghost" type="button" onClick={() => folder.current?.close()}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !folderName.trim()}>
              {pending ? "Creating" : "Create"}
            </Button>
          </div>
        </form>
      </dialog>

      {/* --------------------------------- note -------------------------------- */}
      <dialog
        ref={note}
        aria-labelledby="new-note-heading"
        className={`${DIALOG_PANEL} w-[min(34rem,calc(100vw-2rem))]`}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submitNote();
          }}
        >
          <div className="border-b border-line-soft px-4 py-3">
            <h3 id="new-note-heading" className="text-[15px] font-semibold text-ink">
              Write a note
            </h3>
          </div>
          <div className="flex flex-col gap-4 px-4 py-4">
            <Field label="Title" hint="Saved as a .md file in this folder.">
              <Input
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                placeholder="Page replacement algorithms"
                maxLength={120}
              />
            </Field>
            <Field label="Body" hint="Markdown works. You can keep editing after it's created.">
              <Textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={8}
                placeholder="# Page replacement&#10;&#10;- FIFO&#10;- LRU"
              />
            </Field>
            {noteError ? (
              <p role="alert" className="text-[12.5px] leading-snug">
                {noteError}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Button variant="ghost" type="button" onClick={() => note.current?.close()}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !noteName.trim()}>
              {pending ? "Creating" : "Create note"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
