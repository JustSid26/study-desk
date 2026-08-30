"use client";

/**
 * The note reader.
 *
 * One file, opened from the folder tree. What it renders depends on the kind
 * the vault reported, because a PDF, a screenshot and a typed note want three
 * genuinely different affordances and pretending otherwise gives you a viewer
 * that is bad at all three.
 *
 * This is a Client Component, so it never imports `@/lib/vault` — the server
 * page reads the file and hands the body, the rendered preview and the folder
 * list down as props.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DIALOG_PANEL,
  Field,
  Input,
  Select,
  linkButtonClass,
} from "@/components/ui";
import { deleteEntry, moveEntry, renameEntry, saveNote } from "@/app/actions/vault";
import { formatBytes } from "@/lib/dates";
import type { NoteKind } from "@/lib/vault";

export interface FolderOption {
  rel: string;
  label: string;
}

export interface NoteViewProps {
  /** Vault-relative path of the open file. */
  path: string;
  name: string;
  kind: NoteKind;
  size: number;
  /** Pre-formatted on the server: `relativeTime` reads the clock, and doing
   *  that during render would disagree with the server's HTML. */
  modifiedText: string;
  folderPath: string;
  folderLabel: string;
  /** Source text for the kinds that have any. */
  body: string | null;
  /** `<Markdown>` is a Server Component; its output arrives already rendered. */
  preview: React.ReactNode;
  folders: FolderOption[];
}

const fileHref = (path: string, download = false) =>
  `/api/vault/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

const folderHref = (path: string) =>
  path ? `/subjects?path=${encodeURIComponent(path)}` : "/subjects";

/* --------------------------------- dialog --------------------------------- */

/* ------------------------------- text editor ------------------------------ */

const AUTOSAVE_MS = 800;

/**
 * Edit / Preview.
 *
 * The textarea is uncontrolled on purpose. A controlled one re-renders the
 * whole pane on every keystroke, which on a long note is felt as lag while
 * typing; here React sees nothing until the status line actually changes, and
 * setting the status to the value it already holds bails out of the render.
 *
 * The preview is the server's, so switching to it flushes the pending save
 * first and waits for the refresh rather than showing a stale body.
 */
function TextEditor({
  path,
  body,
  preview,
}: {
  path: string;
  body: string;
  preview: React.ReactNode;
}) {
  const [mode, setMode] = React.useState<"edit" | "preview">(body.trim() ? "preview" : "edit");
  const [status, setStatus] = React.useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const [error, setError] = React.useState<string | null>(null);

  const area = React.useRef<HTMLTextAreaElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = React.useRef(body);
  const inFlight = React.useRef(false);

  /**
   * Write the buffer, and keep writing until it matches what is on disk.
   *
   * The loop is the point. `onInput` is the only thing that ever arms a timer,
   * and it clears the old one each keystroke — so a `flush` that bailed out
   * because a save was already in the air left nothing scheduled at all, and the
   * text typed during that save reached disk only if the textarea happened to
   * lose focus or the pane unmounted. A reload in between lost it, which the
   * line under the editor promises will not happen. Re-reading `area.current`
   * after each write picks that text up instead.
   */
  const flush = React.useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // A save is already running; it will see anything typed since on its next
    // turn, so there is nothing to schedule and nothing to lose.
    if (inFlight.current) return;

    inFlight.current = true;
    try {
      let wrote = false;
      for (;;) {
        const text = area.current?.value;
        if (text === undefined || text === lastSaved.current) {
          if (wrote) setStatus("saved");
          break;
        }
        setStatus("saving");
        const res = await saveNote(path, text);
        if (!res.ok) {
          setError(res.error);
          setStatus("unsaved");
          break;
        }
        lastSaved.current = text;
        setError(null);
        wrote = true;
      }
    } catch {
      setError("Couldn't reach the server. Your text is still here.");
      setStatus("unsaved");
    } finally {
      inFlight.current = false;
    }
  }, [path]);

  // A pending edit must not be lost by clicking away to another note.
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const text = area.current?.value;
      if (text !== undefined && text !== lastSaved.current) void saveNote(path, text);
    },
    [path],
  );

  function onInput() {
    setStatus("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "unsaved"
        ? "Unsaved"
        : status === "saved"
          ? "Saved"
          : "";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-2.5">
        <div className="inline-flex rounded-[7px] border border-line bg-surface-2 p-0.5">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                if (m === "preview") void flush();
                setMode(m);
              }}
              className={`h-7 cursor-pointer rounded-[5px] px-3 text-[12px] font-medium capitalize transition-colors ${
                mode === m ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-ink-3 hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-ink-3" aria-live="polite">
          {statusText}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-3 text-[12.5px] leading-snug">
          {error}
        </p>
      ) : null}

      {mode === "edit" ? (
        <div className="px-4 py-4">
          <label className="sr-only" htmlFor="note-body">
            Note body
          </label>
          <textarea
            id="note-body"
            ref={area}
            defaultValue={body}
            onInput={onInput}
            onBlur={() => void flush()}
            spellCheck
            className="min-h-[58vh] w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3"
            placeholder="Write. Markdown works — # for a heading, - for a list."
          />
          <p className="mt-2 text-[11.5px] text-ink-3">
            Saves on its own about a second after you stop typing.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-4">
          {body.trim() ? preview : <p className="text-[13px] text-ink-3">This note is empty.</p>}
        </div>
      )}
    </>
  );
}

/* -------------------------------- docx body ------------------------------- */

/**
 * Word documents are converted server-side by `/api/vault/docx` — mammoth for
 * the structure, sanitize-html for the safety — so what arrives here is already
 * a tight allowlist of tags and can be dropped straight into `.prose-note`.
 */
function DocxBody({ path, name, size }: { path: string; name: string; size: number }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = React.useState("");
  const [error, setError] = React.useState("");

  // Keyed by `path` at the call site, so a different document remounts this
  // with its initial "loading" state instead of being reset from the effect.
  React.useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/vault/docx?path=${encodeURIComponent(path)}`, {
          signal: ac.signal,
        });
        const data: unknown = await res.json();
        const payload = (data ?? {}) as { html?: unknown; error?: unknown };
        if (!res.ok) {
          throw new Error(
            typeof payload.error === "string" ? payload.error : "This document couldn't be read.",
          );
        }
        setHtml(typeof payload.html === "string" ? payload.html : "");
        setState("ready");
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "This document couldn't be read.");
        setState("error");
      }
    })();

    return () => ac.abort();
  }, [path]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2.5 px-4 py-8 text-[13px] text-ink-3">
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-transparent"
        />
        <span role="status">Reading the document…</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="px-4 py-4">
        <p role="alert" className="mb-3 text-[12.5px] leading-snug">
          {error}
        </p>
        <FileCard path={path} name={name} size={size} />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto px-4 py-4">
      {html ? (
        // Sanitised in the route handler, never in the browser.
        <div className="prose-note" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-[13px] text-ink-3">This document has no text in it.</p>
      )}
    </div>
  );
}

/* -------------------------------- file card ------------------------------- */

function FileCard({ path, name, size }: { path: string; name: string; size: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3.5">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-ink">{name}</div>
        <div className="mt-0.5 font-mono text-[11.5px] text-ink-3">{formatBytes(size)}</div>
      </div>
      <a className={linkButtonClass({ size: "sm" })} href={fileHref(path, true)} download>
        Download
      </a>
    </div>
  );
}

/* --------------------------------- reader --------------------------------- */

export function NoteView({
  path,
  name,
  kind,
  size,
  modifiedText,
  folderPath,
  folderLabel,
  body,
  preview,
  folders,
}: NoteViewProps) {
  const router = useRouter();
  // Plain refs: `.current` is only ever read inside a handler.
  const rename = React.useRef<HTMLDialogElement>(null);
  const move = React.useRef<HTMLDialogElement>(null);
  const remove = React.useRef<HTMLDialogElement>(null);

  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [nextName, setNextName] = React.useState(name);

  // The folder it already sits in isn't a destination.
  const moveTargets = folders.filter((f) => f.rel !== folderPath);
  const [destination, setDestination] = React.useState(moveTargets[0]?.rel ?? "");

  /** Every mutation is the same shape: clear the error, run it, then either
   *  follow the file to where it went or show what stopped it. */
  function run<T extends { ok: true }>(
    work: () => Promise<T | { ok: false; error: string }>,
    done: (result: T) => void,
  ) {
    setError(null);
    start(async () => {
      const res = await work();
      if (res.ok) done(res as T);
      else setError(res.error);
    });
  }

  const openFile = (rel: string) => `/subjects?file=${encodeURIComponent(rel)}`;

  return (
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0">
          <Link
            href={folderHref(folderPath)}
            className="lbl inline-flex items-center gap-1 no-underline hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m14 6-6 6 6 6" />
            </svg>
            {folderLabel}
          </Link>
          <h2 className="mt-1 break-words text-[17px] font-semibold leading-snug text-ink">
            {name}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">
            {kind === "file" ? "File" : kind} · {formatBytes(size)} · {modifiedText}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => rename.current?.showModal()}>
            Rename
          </Button>
          <Button size="sm" onClick={() => move.current?.showModal()} disabled={!moveTargets.length}>
            Move
          </Button>
          <Button size="sm" variant="danger" onClick={() => remove.current?.showModal()}>
            Delete
          </Button>
        </div>
      </CardHeader>

      {kind === "markdown" || kind === "text" ? (
        <TextEditor path={path} body={body ?? ""} preview={preview} />
      ) : kind === "image" ? (
        <CardBody className="flex flex-col">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileHref(path)}
            alt={name}
            className="h-auto max-w-full self-start rounded-[10px] border border-line"
          />
          <a
            className={linkButtonClass({ size: "sm", className: "mt-3 self-start" })}
            href={fileHref(path, true)}
            download
          >
            Download
          </a>
        </CardBody>
      ) : kind === "pdf" ? (
        <CardBody className="flex flex-col">
          <iframe
            title={name}
            src={fileHref(path)}
            className="w-full rounded-[10px] border border-line bg-surface-2"
            style={{ height: "min(72vh, 700px)" }}
          />
          <p className="mt-3 text-[12.5px] text-ink-3">
            Not showing?{" "}
            <a className="text-ink underline underline-offset-2" href={fileHref(path, true)} download>
              Download the PDF
            </a>{" "}
            and open it in a reader.
          </p>
        </CardBody>
      ) : kind === "docx" ? (
        <DocxBody key={path} path={path} name={name} size={size} />
      ) : (
        <CardBody>
          <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
            {kind === "doc"
              ? "The old .doc format can't be read in the app — only .docx. Download it to open it in Word."
              : "This kind of file can't be shown in the app, but it's safe in the folder and ready to download."}
          </p>
          <FileCard path={path} name={name} size={size} />
        </CardBody>
      )}

      {/* -------------------------------- rename ------------------------------- */}
      <dialog
        ref={rename}
        aria-labelledby="note-rename-heading"
        onClose={() => setError(null)}
        className={`${DIALOG_PANEL} w-[min(26rem,calc(100vw-2rem))]`}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => renameEntry(path, nextName),
              (res) => {
                rename.current?.close();
                router.replace(openFile(res.path));
              },
            );
          }}
        >
          <div className="border-b border-line-soft px-4 py-3">
            <h3 id="note-rename-heading" className="text-[15px] font-semibold text-ink">
              Rename
            </h3>
          </div>
          <div className="px-4 py-4">
            <Field label="Name" hint="Leave the extension off and it keeps the one it has.">
              <Input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                autoFocus
                maxLength={120}
              />
            </Field>
            {/* A modal renders in the top layer, so a failure reported outside
                it would be invisible behind the open dialog. */}
            {error ? (
              <p role="alert" className="mt-3 text-[12.5px] leading-snug">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Button variant="ghost" onClick={() => rename.current?.close()} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !nextName.trim()}>
              {pending ? "Renaming" : "Rename"}
            </Button>
          </div>
        </form>
      </dialog>

      {/* --------------------------------- move -------------------------------- */}
      <dialog
        ref={move}
        aria-labelledby="note-move-heading"
        onClose={() => setError(null)}
        className={`${DIALOG_PANEL} w-[min(26rem,calc(100vw-2rem))]`}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => moveEntry(path, destination),
              (res) => {
                move.current?.close();
                router.replace(openFile(res.path));
              },
            );
          }}
        >
          <div className="border-b border-line-soft px-4 py-3">
            <h3 id="note-move-heading" className="text-[15px] font-semibold text-ink">
              Move
            </h3>
          </div>
          <div className="px-4 py-4">
            <Field label="Into" hint="Every folder in the vault, subjects included.">
              <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
                {moveTargets.map((f) => (
                  <option key={f.rel || "root"} value={f.rel}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            {error ? (
              <p role="alert" className="mt-3 text-[12.5px] leading-snug">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Button variant="ghost" onClick={() => move.current?.close()} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending || !moveTargets.length}>
              {pending ? "Moving" : "Move"}
            </Button>
          </div>
        </form>
      </dialog>

      {/* -------------------------------- delete ------------------------------- */}
      <dialog
        ref={remove}
        aria-labelledby="note-delete-heading"
        onClose={() => setError(null)}
        className={`${DIALOG_PANEL} w-[min(26rem,calc(100vw-2rem))]`}
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h3 id="note-delete-heading" className="text-[15px] font-semibold text-ink">
            Delete this note?
          </h3>
        </div>
        <div className="px-4 py-4 text-[13px] leading-relaxed text-ink-2">
          <p>
            <span className="font-medium text-ink">{name}</span> is removed from the folder on disk.
            There&apos;s no undo.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] leading-snug">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
          <Button variant="ghost" onClick={() => remove.current?.close()}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              run(
                () => deleteEntry(path),
                () => {
                  remove.current?.close();
                  router.replace(folderHref(folderPath));
                },
              )
            }
          >
            {pending ? "Deleting" : "Delete"}
          </Button>
        </div>
      </dialog>
    </Card>
  );
}
