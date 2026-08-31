"use client";

/**
 * Your data — where it lives, how to get a copy out, and how to destroy it.
 *
 * The wipe is behind a real <dialog> that only enables its destructive button
 * once the word "erase" has been typed. Never a native browser prompt: it can't be
 * styled, it can't be read by a screen reader properly, and it makes a
 * catastrophic action one keypress away.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button, Card, CardBody, CardHeader, DIALOG_PANEL } from "@/components/ui";
import { clearEverything, exportJson } from "@/app/actions/settings";
import { dayKey } from "@/lib/dates";

export function DataCard() {
  const router = useRouter();

  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function doExport() {
    setExporting(true);
    setError(null);
    setNote(null);
    try {
      const res = await exportJson();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const payload = JSON.stringify(
        { version: res.version, exportedAt: res.exportedAt, data: res.data },
        null,
        2,
      );
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `study-tracker-${dayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNote("Exported. Check your downloads folder.");
    } catch {
      setError("Couldn't build the export file.");
    } finally {
      setExporting(false);
    }
  }

  function openDialog() {
    setConfirmText("");
    setError(null);
    setNote(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    setConfirmText("");
  }

  async function doClear() {
    setClearing(true);
    try {
      const res = await clearEverything(confirmText);
      if (res.ok) {
        closeDialog();
        setNote(
          `Everything is gone: every record, and ${res.filesRemoved} uploaded ${
            res.filesRemoved === 1 ? "file" : "files"
          }.`,
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setClearing(false);
    }
  }

  const armed = confirmText.trim().toLowerCase() === "erase";

  return (
    <Card>
      <CardHeader>
        <h2 className="text-[15px] font-semibold text-ink">Your data</h2>
      </CardHeader>

      <CardBody className="flex flex-col gap-4">
        <div className="text-[13px] leading-relaxed text-ink-2">
          <p>
            Everything lives in a SQLite file at{" "}
            <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px] text-ink">
              data/study.db
            </code>
            , with your notes beside it as real files under{" "}
            <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px] text-ink">
              data/subjects/
            </code>
            . Both sit on this machine. Nothing is synced anywhere, there is no account, and no
            server of ours ever sees a note.
          </p>
          <p className="mt-2">
            Backing up means copying that one folder. To keep it somewhere that already syncs — a
            Dropbox or iCloud folder, an external drive — set{" "}
            <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px] text-ink">
              STUDY_DATA_DIR
            </code>{" "}
            to that path and restart the app.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          <Button onClick={doExport} disabled={exporting}>
            {exporting ? "Building the file…" : "Export everything (JSON)"}
          </Button>
          <Button variant="danger" onClick={openDialog}>
            Clear everything
          </Button>
        </div>
        <p className="-mt-2 text-[11.5px] leading-snug text-ink-3">
          The export is every row of the database as plain JSON — problems, tags, the LeetCode
          catalogue, your timetable, drafts, submissions and settings. Your notes are not in it:
          they are files, and you back them up by copying{" "}
          <code className="font-mono text-[11px]">data/subjects/</code>.
        </p>

        <div aria-live="polite">
          {note ? <p className="text-[12.5px] leading-snug text-ink-2">{note}</p> : null}
          {error ? (
            <p role="alert" className="text-[12.5px] leading-snug">
              {error}
            </p>
          ) : null}
        </div>
      </CardBody>

      <dialog
        ref={dialogRef}
        aria-labelledby="clear-title"
        onClose={() => setConfirmText("")}
        className={`${DIALOG_PANEL} w-[min(30rem,calc(100vw-2rem))]`}
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h3 id="clear-title" className="text-[15px] font-semibold text-ink">
            Clear everything
          </h3>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            This deletes every problem, timetable entry, draft, submission and setting, empties{" "}
            <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px] text-ink">
              data/subjects/
            </code>{" "}
            of every subject folder and note in it, and drops the cached problem catalogue. It cannot be undone. Export first if you might
            want any of it back.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="lbl">Type erase to confirm</span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="erase"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full min-w-0 rounded-[7px] border border-line bg-surface px-2.5 font-mono text-[13px] text-ink placeholder:text-ink-3"
            />
          </label>

          {error ? (
            <p role="alert" className="text-[12.5px] leading-snug">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-3">
          <Button variant="ghost" onClick={closeDialog} disabled={clearing}>
            Keep my data
          </Button>
          <Button variant="danger" onClick={doClear} disabled={!armed || clearing}>
            {clearing ? "Erasing…" : "Erase everything"}
          </Button>
        </div>
      </dialog>
    </Card>
  );
}
