"use client";

/**
 * The Practice editor — a textarea that behaves enough like an editor.
 *
 * No CodeMirror, no Monaco: a 400KB editor bundle to type twenty lines of Java
 * would be the heaviest thing in the app. What a plain textarea is missing and
 * this adds back is the short list that actually hurts without it — Tab that
 * indents instead of leaving the field, a line-number gutter, save on Cmd+S,
 * run on Cmd+Enter, and a click-to-jump from an error to the line that caused it.
 *
 * The gutter is a second element scrolled in lockstep with the textarea, so the
 * two must agree on line height exactly — hence the literal `leading-[21px]` on
 * both, and `wrap="off"` so one logical line is always one visual line. Wrapping
 * would put the numbers out of step the moment a line ran long.
 *
 * `import type` only from the server modules: the types are erased at compile
 * time, so nothing from `server-only` is pulled into this bundle.
 */

import * as React from "react";
import type { PracticeLang } from "@/lib/paths";
import type { RunResult } from "@/lib/runner";

import { Button, Empty, Textarea } from "@/components/ui";
import { savePracticeCode } from "@/app/actions/practice";

const LINE_HEIGHT = 21;
const SAVE_DEBOUNCE_MS = 700;
const TAB = "    ";

/**
 * The gutter and the textarea must be the same definite height, or the gutter
 * has no overflow of its own: in the `items-stretch` flex row it would grow to
 * its full content height, `scrollTop` would clamp back to 0, and the numbers
 * would sit still while the code scrolled — beside a column of empty space as
 * tall as the file.
 */
const PANE_HEIGHT = "h-[46vh] min-h-[300px]";

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export interface PracticeEditorProps {
  lang: PracticeLang;
  /** null when the language directory has no files yet */
  file: string | null;
  code: string;
  /** false when the toolchain for this language isn't installed */
  available: boolean;
  /** the plain sentence to show when it isn't, e.g. "javac isn't on this machine's PATH…" */
  unavailableNote: string | null;
  /** "javac 21.0.2 · Python 3.12.1" — muted, informational */
  versions: string;
}

const LANG_LABEL: Record<PracticeLang, string> = { java: "Java", python: "Python" };

export function PracticeEditor({
  lang,
  file,
  code: initialCode,
  available,
  unavailableNote,
  versions,
}: PracticeEditorProps) {
  const [code, setCode] = React.useState(initialCode);
  const [saveState, setSaveState] = React.useState<SaveState>("clean");
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [showInput, setShowInput] = React.useState(false);
  const [stdin, setStdin] = React.useState("");

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [activeLine, setActiveLine] = React.useState<number | null>(null);

  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  /** what is currently on disk, so an unchanged buffer never writes */
  const savedRef = React.useRef(initialCode);
  // A textarea that swallows Tab would trap the keyboard. Escape releases the
  // next Tab so there is always a way out without a mouse.
  const escapedRef = React.useRef(false);

  /* --------------------------------- save -------------------------------- */

  const save = React.useCallback(
    async (next: string): Promise<boolean> => {
      if (!file || next === savedRef.current) return true;
      setSaveState("saving");
      const res = await savePracticeCode({ lang, file, code: next });
      if (res.ok) {
        savedRef.current = next;
        setSaveError(null);
        // Another keystroke may have landed while the write was in flight; that
        // leaves the buffer dirty again and the debounce will pick it up.
        setSaveState((s) => (s === "saving" ? "saved" : s));
        return true;
      }
      setSaveError(res.error);
      setSaveState("error");
      return false;
    },
    [lang, file],
  );

  React.useEffect(() => {
    if (code === savedRef.current) return;
    const timer = window.setTimeout(() => void save(code), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [code, save]);

  /* --------------------------------- run --------------------------------- */

  const run = React.useCallback(async () => {
    if (!file || !available || running) return;
    setRunning(true);
    setRunError(null);
    setActiveLine(null);
    try {
      // Run what is on screen, not what the debounce last happened to flush.
      await save(code);
      const res = await fetch("/api/practice/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lang,
          file,
          input: showInput && stdin ? stdin : undefined,
        }),
      });
      // The route answers {ok:true,result} or {ok:false,error} and nothing else,
      // but it is still a network payload, so it is narrowed rather than trusted.
      const data = (await res.json()) as
        | { ok: true; result: RunResult }
        | { ok: false; error?: string }
        | null;
      if (data?.ok) {
        setResult(data.result);
      } else {
        setResult(null);
        setRunError(data?.error ?? "That run didn't complete.");
      }
    } catch {
      setResult(null);
      setRunError("Couldn't reach the runner. Is the dev server still up?");
    } finally {
      setRunning(false);
    }
  }, [available, code, file, lang, running, save, showInput, stdin]);

  /* ------------------------------- keyboard ------------------------------- */

  function onAreaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      escapedRef.current = true;
      return;
    }
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) {
      escapedRef.current = false;
      return;
    }
    // Escape-then-Tab, and Shift+Tab on its own, always move focus: without
    // both of those the editor is a keyboard trap (WCAG 2.1.2).
    if (escapedRef.current || e.shiftKey) {
      escapedRef.current = false;
      return; // let the browser move focus
    }
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = code.slice(0, start) + TAB + code.slice(end);
    setCode(next);
    // React re-renders with the new value and would otherwise drop the caret at
    // the end, so put it back on the next frame.
    window.requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + TAB.length;
    });
  }

  function onPaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      void save(code);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run();
    }
  }

  /* ------------------------------ line jumping ---------------------------- */

  const syncGutter = () => {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop;
    }
  };

  function goToLine(line: number) {
    const el = areaRef.current;
    if (!el) return;
    const lines = code.split("\n");
    const target = Math.min(Math.max(1, line), lines.length);
    let offset = 0;
    for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1;

    el.focus();
    el.setSelectionRange(offset, offset);
    el.scrollTop = Math.max(0, (target - 1) * LINE_HEIGHT - el.clientHeight / 2);
    syncGutter();
    setActiveLine(target);
  }

  const lineCount = React.useMemo(() => code.split("\n").length, [code]);
  const gutterWidth = `${Math.max(2, String(lineCount).length)}ch`;

  /* -------------------------------- render -------------------------------- */

  if (!file) {
    return (
      <section className="card">
        <Empty title="No file open">
          Practice files are real files on disk, under{" "}
          <code className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px] text-ink">
            practicecode/{lang}/
          </code>
          . Make one on the left and it appears here — and in your editor.
        </Empty>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" onKeyDown={onPaneKeyDown}>
      {unavailableNote ? (
        <p role="alert" className="text-[13px] leading-relaxed">
          {unavailableNote}
        </p>
      ) : null}

      <section className="card flex min-w-0 flex-col overflow-hidden">
        {/* ------------------------------ toolbar ---------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate font-mono text-[13px] font-medium text-ink">{file}</h2>
            <SaveMarker state={saveState} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant={showInput ? "default" : "ghost"}
              aria-pressed={showInput}
              onClick={() => setShowInput((v) => !v)}
            >
              Program input
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void run()}
              disabled={running || !available}
              title={
                available
                  ? "Run this file (Cmd+Enter)"
                  : `${LANG_LABEL[lang]} can't run on this machine`
              }
            >
              {running ? "Running…" : "Run"}
            </Button>
          </div>
        </div>

        {/* ------------------------------ editor ----------------------------- */}
        <div className="flex min-w-0 items-stretch bg-surface">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className={`${PANE_HEIGHT} shrink-0 select-none overflow-hidden border-r border-line-soft bg-surface-3 py-3 pl-3 pr-2 text-right font-mono text-[12.5px] leading-[21px] text-ink-3`}
            style={{ width: `calc(${gutterWidth} + 20px)` }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div
                key={i}
                className={i + 1 === activeLine ? "font-medium text-ink" : undefined}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* The focus outline is inset: the textarea sits flush against the
              gutter inside an `overflow-hidden` card, which would clip an
              outset one away entirely. */}
          <textarea
            ref={areaRef}
            value={code}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            data-gramm="false"
            aria-label={`${LANG_LABEL[lang]} source of ${file}`}
            onChange={(e) => {
              setCode(e.target.value);
              setSaveState("dirty");
            }}
            onKeyDown={onAreaKeyDown}
            onScroll={syncGutter}
            className={`${PANE_HEIGHT} w-full min-w-0 resize-none bg-transparent px-3 py-3 font-mono text-[12.5px] leading-[21px] text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent`}
          />
        </div>

        {/* --------------------------- program input ------------------------- */}
        {showInput ? (
          <div className="border-t border-line-soft px-4 py-3">
            <label className="flex flex-col gap-1.5">
              <span className="lbl">Program input (stdin)</span>
              <Textarea
                rows={3}
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                spellCheck={false}
                className="font-mono text-[12.5px]"
                placeholder={"One value per line, as the program reads them"}
              />
            </label>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
              Leave this closed and stdin is closed too, so a program waiting on input stops
              straight away instead of hanging for fifteen seconds.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-soft px-4 py-2 text-[11.5px] text-ink-3">
          <span>{versions || "No toolchain detected"}</span>
          <span className="font-mono">Cmd+S saves · Cmd+Enter runs</span>
        </div>

        <p className="border-t border-line-soft px-4 py-2 text-[11.5px] leading-snug text-ink-3">
          Tab indents by four spaces. Press Escape then Tab to move on to the next control.
        </p>
      </section>

      {saveError ? (
        <p role="alert" className="text-[12.5px]">
          {saveError}
        </p>
      ) : null}

      {runError ? (
        <p role="alert" className="text-[13px]">
          {runError}
        </p>
      ) : null}

      {result ? <RunOutput result={result} onGoToLine={goToLine} /> : null}
    </div>
  );
}

/* ------------------------------- save marker ------------------------------ */

const SAVE_TEXT: Record<SaveState, string> = {
  clean: "",
  dirty: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
};

function SaveMarker({ state }: { state: SaveState }) {
  const text = SAVE_TEXT[state];
  if (!text) return null;
  return (
    <span
      aria-live="polite"
      className={`shrink-0 text-[11.5px] ${state === "error" ? "text-ink" : "text-ink-3"}`}
    >
      {text}
    </span>
  );
}

/* --------------------------------- output --------------------------------- */

function RunOutput({
  result,
  onGoToLine,
}: {
  result: RunResult;
  onGoToLine: (line: number) => void;
}) {
  const compile = result.stage === "compile";
  const stderr = result.stderr.trim();

  return (
    <div className="flex flex-col gap-3">
      {result.diagnostics.length > 0 ? (
        <section className="card">
          <div className="border-b border-line-soft px-4 py-2.5">
            <h3 className="lbl">
              {compile ? "What the compiler objected to" : "What went wrong"}
            </h3>
          </div>
          <ul className="divide-y divide-line-soft">
            {result.diagnostics.map((d, i) => (
              <li key={`${d.line}-${i}`} className="px-4 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-relaxed text-ink">
                  {d.line !== null ? (
                    <button
                      type="button"
                      onClick={() => onGoToLine(d.line as number)}
                      className="shrink-0 cursor-pointer rounded-[5px] border border-line bg-surface-2 px-1.5 py-px font-mono text-[11.5px] font-medium text-ink transition-colors hover:bg-accent hover:text-on-accent"
                      aria-label={`Go to line ${d.line}`}
                    >
                      Line {d.line}
                    </button>
                  ) : null}
                  <span className="min-w-0 font-mono text-[12.5px]">{d.message}</span>
                </p>
                {d.hint ? (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{d.hint}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5">
          <h3 className="lbl">{compile ? "Compile error" : "Output"}</h3>
          <div className="flex items-center gap-3 font-mono text-[11.5px] tabular-nums text-ink-3">
            <span>exit {result.exitCode ?? "—"}</span>
            <span>{result.ms} ms</span>
          </div>
        </div>

        <div className="px-4 py-3">
          {result.timedOut ? (
            <p role="alert" className="mb-3 text-[13px] leading-relaxed">
              Stopped after 15 seconds. That almost always means a loop with no way out —
              check the condition that is supposed to end it, and that whatever it counts is
              actually changing.
            </p>
          ) : null}

          {result.stdout.trim() ? (
            <pre className="max-h-[40vh] overflow-auto whitespace-pre font-mono text-[12.5px] leading-[1.55] text-ink">
              {result.stdout}
            </pre>
          ) : (
            <p className="text-[12.5px] text-ink-3">
              {compile
                ? "Nothing was produced — the file didn't compile."
                : "The program printed nothing."}
            </p>
          )}

          {result.truncated ? (
            <p className="mt-2 text-[11.5px] text-ink-3">
              Output was cut off at 256 KB.
            </p>
          ) : null}
        </div>

        {stderr ? (
          <details className="border-t border-line-soft">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-ink">
              Full output
            </summary>
            <div className="px-4 pb-3">
              <pre className="max-h-[40vh] overflow-auto whitespace-pre rounded-[8px] bg-surface-2 p-3 font-mono text-[12px] leading-[1.55] text-ink-2">
                {stderr}
              </pre>
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
