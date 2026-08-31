"use client";

/**
 * The Practice editor.
 *
 * The editing surface is <CodeEditor>, which wraps CodeMirror — syntax
 * highlighting, bracket closing and auto-indent are the reasons, and each is
 * something a textarea cannot do without reimplementing an editor. The grammar
 * for a language loads on demand, so nothing is paid for a language not in use.
 *
 * This file keeps what surrounds the editor: autosave, the run request, the
 * output panel, and the jump from a diagnostic to the line that caused it.
 *
 * `import type` only from the server modules: the types are erased at compile
 * time, so nothing from `server-only` is pulled into this bundle.
 */

import * as React from "react";
import type { PracticeLang } from "@/lib/paths";
import type { RunResult } from "@/lib/runner";
import type { Trace } from "@/lib/tracer";

import { Button, Empty, Textarea } from "@/components/ui";
import { savePracticeCode } from "@/app/actions/practice";
import { CodeEditor, type CodeEditorHandle } from "@/components/code-editor";
import { usePalette } from "@/components/use-palette";
import { TraceViewer } from "@/components/trace-viewer";

const SAVE_DEBOUNCE_MS = 700;

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
  /** false when this JDK can't trace (no jdk.jdi) or the file isn't Java */
  canTrace?: boolean;
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
  canTrace,
}: PracticeEditorProps) {
  const [code, setCode] = React.useState(initialCode);
  const [saveState, setSaveState] = React.useState<SaveState>("clean");
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [showInput, setShowInput] = React.useState(false);
  const [stdin, setStdin] = React.useState("");

  const [tracing, setTracing] = React.useState(false);
  const [trace, setTrace] = React.useState<Trace | null>(null);
  const [traceIndex, setTraceIndex] = React.useState(0);
  const [traceError, setTraceError] = React.useState<string | null>(null);

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);

  const editorRef = React.useRef<CodeEditorHandle>(null);
  /** what is currently on disk, so an unchanged buffer never writes */
  const savedRef = React.useRef(initialCode);
  const [palette, setPalette] = usePalette();

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

  /* -------------------------------- trace --------------------------------- */

  /**
   * Trace is a separate press from Run, not a mode of it: it launches a second
   * JVM and pays a socket round-trip per line, so it is far slower than simply
   * running the file.
   */
  const visualise = React.useCallback(async () => {
    if (!file || tracing) return;
    // The tracer compiles the file from disk, so an unsaved buffer would be
    // traced as whatever was last written.
    const ok = await save(code);
    if (!ok) return;

    setTracing(true);
    setTraceError(null);
    setTrace(null);
    setResult(null);
    try {
      const res = await fetch("/api/practice/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const data = await res.json();
      if (!data.ok) {
        setTraceError(
          data.compileError
            ? `${data.error}\n\n${data.compileError}`
            : (data.error ?? "The trace failed."),
        );
      } else {
        setTrace(data as Trace);
        setTraceIndex(0);
      }
    } catch {
      setTraceError("Couldn't reach the tracer.");
    } finally {
      setTracing(false);
    }
  }, [code, file, save, tracing]);

  /* ------------------------------ line jumping ---------------------------- */

  /** Jump the caret to a line — how a diagnostic gets you to its cause. */
  const goToLine = React.useCallback((line: number) => {
    editorRef.current?.goToLine(line);
  }, []);

  /** Save now, rather than on the debounce. Bound to Cmd/Ctrl+S in the editor. */
  const flush = React.useCallback(() => save(code), [save, code]);

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
    <div className="flex min-w-0 flex-col gap-3">
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
            {canTrace ? (
              <Button
                size="sm"
                variant="default"
                onClick={() => void visualise()}
                disabled={tracing || running || !available}
                title="Step through this file line by line"
              >
                {tracing ? "Tracing…" : "Visualise"}
              </Button>
            ) : null}
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
        <div className={`${PANE_HEIGHT} min-w-0 overflow-hidden bg-surface`}>
          <CodeEditor
            ref={editorRef}
            value={code}
            language={lang}
            palette={palette}
            tracedLine={trace ? (trace.steps[traceIndex]?.line ?? null) : null}
            ariaLabel={file ? `${LANG_LABEL[lang]} source of ${file}` : "Code editor"}
            className="h-full"
            onChange={(next) => {
              setCode(next);
              setSaveState("dirty");
            }}
            onSave={() => void flush()}
            onRun={() => void run()}
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="lbl">Syntax</span>
              {(["mono", "colour"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPalette(p)}
                  aria-pressed={palette === p}
                  className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium ${
                    palette === p
                      ? "bg-accent text-on-accent"
                      : "text-ink-3 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {p === "mono" ? "Mono" : "Colour"}
                </button>
              ))}
            </div>
            <span className="font-mono">Cmd+S saves · Cmd+Enter runs</span>
          </div>
        </div>

        <p className="border-t border-line-soft px-4 py-2 text-[11.5px] leading-snug text-ink-3">
          Brackets and quotes close themselves, and a new line keeps its indent. Tab
          indents by four spaces — press Escape then Tab to move on to the next control.
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

      {traceError ? (
        <div className="card px-4 py-3">
          <p role="alert" className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
            {traceError}
          </p>
        </div>
      ) : null}

      {trace ? (
        <TraceViewer
          trace={trace}
          index={traceIndex}
          onIndex={setTraceIndex}
          onClose={() => setTrace(null)}
        />
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
