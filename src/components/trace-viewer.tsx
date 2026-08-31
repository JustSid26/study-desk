"use client";

/**
 * The step-through view of a traced Java run.
 *
 * The whole trace arrives up front — it is a recording, not a live debugger —
 * so scrubbing is instant and nothing re-runs the program. The editor above
 * marks the current line; this panel shows the stack, the variables in each
 * frame, and the output as it had been printed by that point.
 */

import * as React from "react";
import type { TraceStep, TraceValue, Trace } from "@/lib/tracer";
import { Button } from "@/components/ui";

/* -------------------------------- values ---------------------------------- */

/**
 * Render one value. Arrays and lists are drawn as a row of indexed cells rather
 * than as text, because watching a cell change in place is the entire point of
 * looking at a sort or a two-pointer walk.
 */
function Value({ value, depth = 0 }: { value: TraceValue; depth?: number }) {
  switch (value.kind) {
    case "null":
      return <span className="font-mono text-ink-3">null</span>;
    case "num":
    case "bool":
      return <span className="font-mono tabular-nums text-ink">{value.text}</span>;
    case "char":
      return <span className="font-mono text-ink">{`'${value.text}'`}</span>;
    case "string":
      return (
        <span className="font-mono text-ink">
          {`"${value.text}"`}
          {value.truncated ? <span className="text-ink-3">…</span> : null}
        </span>
      );
    case "boxed":
      return <Value value={value.value} depth={depth} />;
    case "cycle":
      return <span className="font-mono text-ink-3">↺ same object</span>;
    case "deep":
      return <span className="font-mono text-ink-3">{value.type} …</span>;

    case "array":
    case "list":
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-end gap-1">
            {value.items.map((item, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="font-mono text-[9.5px] leading-none text-ink-3">{i}</span>
                <span className="mt-0.5 min-w-[26px] rounded border border-line bg-surface-3 px-1.5 py-1 text-center font-mono text-[11.5px] tabular-nums text-ink">
                  {depth < 2 ? <Value value={item} depth={depth + 1} /> : "…"}
                </span>
              </div>
            ))}
            {value.more ? (
              <span className="self-center text-[11px] text-ink-3">+{value.more} more</span>
            ) : null}
            {value.items.length === 0 ? (
              <span className="text-[11.5px] text-ink-3">empty</span>
            ) : null}
          </div>
          <span className="text-[10.5px] text-ink-3">
            {value.type} · length {value.length}
          </span>
        </div>
      );

    case "object":
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[11px] text-ink-3">{value.type}</span>
          <div className="flex flex-col gap-0.5 border-l border-line-soft pl-2">
            {value.fields.length === 0 ? (
              <span className="text-[11.5px] text-ink-3">no fields</span>
            ) : (
              value.fields.map((f) => (
                <div key={f.name} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-mono text-[11.5px] text-ink-2">{f.name}</span>
                  {depth < 2 ? <Value value={f.value} depth={depth + 1} /> : <span className="text-ink-3">…</span>}
                </div>
              ))
            )}
          </div>
        </div>
      );
  }
}

/* -------------------------------- viewer ---------------------------------- */

export interface TraceViewerProps {
  trace: Trace;
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}

const PLAY_MS = 320;

export function TraceViewer({ trace, index, onIndex, onClose }: TraceViewerProps) {
  const [playing, setPlaying] = React.useState(false);
  const total = trace.steps.length;
  const step: TraceStep | undefined = trace.steps[index];

  // Autoplay runs only while there is a next step. Deriving `advancing` rather
  // than clearing `playing` from inside the effect keeps the stop condition out
  // of the effect body — the button reads the derived value, so it still flips
  // back to "Play" on its own at the end.
  const advancing = playing && index < total - 1;

  React.useEffect(() => {
    if (!advancing) return;
    const t = setTimeout(() => onIndex(index + 1), PLAY_MS);
    return () => clearTimeout(t);
  }, [advancing, index, onIndex]);

  const go = React.useCallback(
    (next: number) => {
      setPlaying(false);
      onIndex(Math.max(0, Math.min(next, total - 1)));
    },
    [onIndex, total],
  );

  // Arrow keys scrub, but not while the caret is in a field.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  if (total === 0) {
    return (
      <div className="card p-4">
        <p className="text-[13px] text-ink-2">
          The program ran but produced no traceable lines. That happens when everything
          sits on a single line, since a step is only recorded when execution reaches a
          different one.
        </p>
        <Button size="sm" variant="ghost" className="mt-3" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const printed = step ? trace.stdout.slice(0, step.out) : "";

  return (
    <section className="card flex min-w-0 flex-col" aria-label="Execution trace">
      {/* ------------------------------ controls ----------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => go(0)} aria-label="First step">⏮</Button>
          <Button size="sm" variant="ghost" onClick={() => go(index - 1)} aria-label="Previous step">←</Button>
          <Button
            size="sm"
            variant={advancing ? "default" : "primary"}
            onClick={() => {
              // Pressing play at the end replays from the top rather than
              // sitting on a button that does nothing.
              if (!advancing && index >= total - 1) onIndex(0);
              setPlaying(!advancing);
            }}
          >
            {advancing ? "Pause" : "Play"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(index + 1)} aria-label="Next step">→</Button>
          <Button size="sm" variant="ghost" onClick={() => go(total - 1)} aria-label="Last step">⏭</Button>
        </div>

        <label className="flex min-w-[180px] flex-1 items-center gap-2">
          <span className="sr-only">Step</span>
          <input
            type="range"
            min={0}
            max={total - 1}
            value={index}
            onChange={(e) => go(Number(e.target.value))}
            className="h-1 w-full min-w-0 cursor-pointer appearance-none rounded bg-surface-2 accent-[var(--color-accent)]"
          />
        </label>

        <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px] tabular-nums text-ink-2">
          {String(index + 1).padStart(String(total).length, "0")} / {total} · line{" "}
          {step?.line ?? "—"}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {trace.notice ? (
        <p role="alert" className="mx-4 my-2 shrink-0 text-[12px] leading-snug">
          {trace.notice}
        </p>
      ) : null}

      {/* -------------------------------- panes ------------------------------
          Both panes are a fixed height and scroll internally. Left to size
          themselves, the variables list grows and shrinks with whatever is in
          scope, and the page reflows under the pointer on every single step. */}
      <div className="grid min-w-0 gap-px bg-line-soft md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:grid-cols-1">
        {/* variables, innermost frame first */}
        <div className="min-w-0 overflow-y-auto bg-surface px-4 py-3 [height:26vh] [min-height:200px] xl:[height:30vh]">
          <h3 className="lbl mb-2">Variables</h3>
          {step && step.frames.length ? (
            <div className="flex flex-col gap-3">
              {step.frames.map((frame, fi) => (
                <div key={fi} className="min-w-0">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="font-mono text-[11.5px] font-semibold text-ink">
                      {frame.method}()
                    </span>
                    <span className="text-[10.5px] text-ink-3">
                      line {frame.line}
                      {fi === 0 ? " · running" : ""}
                    </span>
                  </div>
                  {frame.vars.length === 0 ? (
                    <p className="text-[11.5px] text-ink-3">Nothing in scope yet.</p>
                  ) : (
                    <dl className="flex flex-col gap-1.5 border-l border-line-soft pl-2.5">
                      {frame.vars.map((v) => (
                        <div key={v.name} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                          <dt className="font-mono text-[12px] font-medium text-ink">{v.name}</dt>
                          <dd className="min-w-0"><Value value={v.value} /></dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-3">No frame at this step.</p>
          )}
        </div>

        {/* call stack + output so far */}
        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto bg-surface px-4 py-3 [height:26vh] [min-height:200px] xl:[height:22vh]">
          <div>
            <h3 className="lbl mb-1.5">Call stack</h3>
            <ol className="flex flex-col gap-0.5">
              {(step?.frames ?? []).map((f, i) => (
                <li
                  key={i}
                  className={`font-mono text-[11.5px] ${i === 0 ? "text-ink" : "text-ink-3"}`}
                  style={{ paddingLeft: `${Math.min(i, 8) * 8}px` }}
                >
                  {f.method}() <span className="text-ink-3">:{f.line}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-w-0">
            <h3 className="lbl mb-1.5">Output so far</h3>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink">
              {printed || <span className="text-ink-3">Nothing printed yet.</span>}
            </pre>
          </div>

          {trace.stderr.trim() ? (
            <div className="min-w-0">
              <h3 className="lbl mb-1.5">Errors</h3>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] text-ink">
                {trace.stderr.trim()}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      <p className="border-t border-line-soft px-4 py-2 text-[11px] text-ink-3">
        {trace.steps.length} steps in {trace.ms} ms. Left and right arrow keys step through.
      </p>
    </section>
  );
}
