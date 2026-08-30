"use client";

/**
 * Getting files into a folder.
 *
 * Three routes to the same server action, because the three are how people
 * actually have the file to hand: the picker when it is on disk, a drop when
 * it is already in a Finder window, and a paste when it is a screenshot that
 * was never saved at all. The drop target is the whole folder pane rather than
 * a small dashed box — aiming at a target is work, and the pane is already the
 * thing you are looking at.
 *
 * Wraps the server-rendered grid: `children` arrives as an RSC payload, so the
 * cards themselves stay on the server.
 */

import * as React from "react";

import { Button } from "@/components/ui";
import { uploadFiles } from "@/app/actions/vault";

interface Report {
  saved: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/** The vault's own per-file cap, checked here too so an oversized file is named
 *  in the UI instead of dying as a rejected request. Not a boundary — the
 *  action enforces the real one. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;

/** A Server Action request is capped (see `serverActions.bodySizeLimit`), so a
 *  drop of thirty scans goes up as several requests rather than one that the
 *  framework refuses whole. */
const MAX_BATCH_BYTES = 48 * 1024 * 1024;

function batch(files: File[]): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length && bytes + file.size > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** A pasted screenshot arrives as a nameless blob, or as a dozen identical
 *  `image.png`s. Stamp it so the folder listing stays readable. */
function nameForPaste(file: File): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(
    d.getMinutes(),
  )}.${p(d.getSeconds())}`;
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] || "png");
  return `Pasted ${stamp}.${ext}`;
}

export function Uploader({
  folderPath,
  toolbar,
  children,
}: {
  folderPath: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [report, setReport] = React.useState<Report | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // dragenter/dragleave fire for every child element the cursor crosses, so a
  // boolean flickers. Counting entries against leaves does not.
  const depth = React.useRef(0);

  const send = React.useCallback(
    async (files: File[]) => {
      if (!files.length || busy) return;
      setBusy(true);
      setError(null);
      setReport(null);

      const total: Report = { saved: [], skipped: [] };
      for (const f of files) {
        if (f.size > MAX_FILE_BYTES) total.skipped.push({ name: f.name, reason: "over 60 MB" });
      }
      const sendable = files.filter((f) => f.size <= MAX_FILE_BYTES);

      try {
        for (const group of batch(sendable)) {
          const fd = new FormData();
          fd.set("folderPath", folderPath);
          for (const f of group) fd.append("files", f, f.name);

          const res = await uploadFiles(fd);
          if (res.ok) {
            total.saved.push(...res.saved.map((s) => s.name));
            total.skipped.push(...res.skipped);
          } else {
            // One rejected batch shouldn't hide what the earlier ones landed.
            for (const f of group) total.skipped.push({ name: f.name, reason: res.error });
          }
        }
        if (!total.saved.length && !total.skipped.length) {
          setError("No files came through. Try picking them again.");
        } else {
          setReport(total);
        }
      } catch {
        setError("The upload didn't go through. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, folderPath],
  );

  // Paste is global: there is no field to focus first, you just paste.
  React.useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void send(files.map((f) => new File([f], nameForPaste(f), { type: f.type })));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [send]);

  const savedCount = report?.saved.length ?? 0;

  return (
    <div
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault(); // without this the browser opens the file instead
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        void send(files);
      }}
      className={`flex flex-col gap-4 rounded-[16px] transition-colors ${
        dragging ? "outline-2 outline-dashed outline-offset-4 outline-line-strong" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <Button onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Uploading" : "Upload files"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // so picking the same file twice still fires
            void send(files);
          }}
        />
      </div>

      <p className="-mt-1 text-[12px] leading-snug text-ink-3">
        {dragging
          ? "Drop to add them here."
          : "Drop files anywhere on this pane, or paste a screenshot. 60 MB a file."}
      </p>

      {error ? (
        <p role="alert" className="text-[12.5px] leading-snug">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="text-[12.5px] leading-snug text-ink-2" aria-live="polite">
          {savedCount ? (
            <p>
              Added {savedCount} {savedCount === 1 ? "file" : "files"}
              {report.saved.length <= 4 ? `: ${report.saved.join(", ")}` : ""}.
            </p>
          ) : null}
          {report.skipped.length ? (
            <ul className="mt-1 list-disc pl-4 text-ink-3 marker:text-ink-3">
              {report.skipped.map((s) => (
                <li key={s.name}>
                  Skipped {s.name} — {s.reason.replace(/\.$/, "")}.
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
