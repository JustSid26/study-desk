"use client";

/**
 * The editor pane of the in-app problem screen.
 *
 * The editing surface is <CodeEditor> (CodeMirror): syntax highlighting,
 * bracket closing and auto-indent, with the grammar loaded on demand for
 * whichever language you pick. What follows is the part that is ours — the
 * per-language buffers, autosave, and the run/submit round trip.
 *
 * (Previously a plain <textarea>. A full code editor is ~1MB of JavaScript to
 * get bracket matching on a page whose real work happens on LeetCode's judge;
 * what a solver actually needs is a monospaced box that doesn't eat Tab and
 * doesn't lose the attempt when you navigate away. Both of those are cheap.
 *
 * Nothing here imports `@/lib/leetcode` — it is server-only. The language
 * labels arrive as a prop from the page, and the judge is reached through the
 * two API routes.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DIALOG_PANEL,
  Field,
  Select,
  Textarea,
} from "@/components/ui";
import { recordAccepted, saveDraft } from "@/app/actions/solver";
import { CodeEditor, type CodeEditorHandle } from "@/components/code-editor";
import { usePalette } from "@/components/use-palette";

/** Mirrors `JudgeResult` from `@/lib/leetcode`, which the client can't import. */
export interface JudgeView {
  state: string;
  verdict: string;
  ok: boolean;
  error: string | null;
  runtime: string | null;
  memory: string | null;
  totalCorrect: number | null;
  totalTestcases: number | null;
  codeAnswer: string[] | null;
  expectedAnswer: string[] | null;
  stdout: string | null;
  lastTestcase: string | null;
}

type JudgeResponse =
  | { ok: true; result: JudgeView; logged?: boolean }
  | { ok: false; error: string; kind?: string };

export interface SolverProps {
  slug: string;
  questionId: string;
  title: string;
  /** langSlug -> LeetCode's starter code */
  snippets: Record<string, string>;
  sampleTestCase: string;
  /** Every saved draft for this problem, keyed by language. */
  initialDrafts: Record<string, string>;
  /** The language of the most recent draft, when there is one. */
  initialLang: string | null;
  /** `LANG_LABELS`, passed down because its module is server-only. */
  langLabels: Record<string, string>;
}


/** Preferred defaults, in order, when there is no saved draft to follow. */
const FALLBACK_LANGS = ["python3", "java"];

function pickLang(
  available: string[],
  initialLang: string | null,
  drafts: Record<string, string>,
): string {
  if (initialLang && available.includes(initialLang)) return initialLang;
  const drafted = available.find((l) => drafts[l] !== undefined);
  if (drafted) return drafted;
  const preferred = FALLBACK_LANGS.find((l) => available.includes(l));
  return preferred ?? available[0] ?? "python3";
}

export function Solver({
  slug,
  questionId,
  title,
  snippets,
  sampleTestCase,
  initialDrafts,
  initialLang,
  langLabels,
}: SolverProps) {
  const router = useRouter();

  const label = React.useCallback(
    (l: string) => langLabels[l] ?? l,
    [langLabels],
  );

  const langs = React.useMemo(
    () => Object.keys(snippets).sort((a, b) => label(a).localeCompare(label(b))),
    [snippets, label],
  );

  const [lang, setLang] = React.useState(() =>
    pickLang(langs, initialLang, initialDrafts),
  );
  const [code, setCode] = React.useState(
    () => initialDrafts[lang] ?? snippets[lang] ?? "",
  );
  const [testcase, setTestcase] = React.useState(sampleTestCase);

  // What is known to be on the server, per language. The "Saved" marker is
  // derived from it rather than stored, so it can never claim a save that the
  // last keystroke already invalidated.
  const [savedCode, setSavedCode] = React.useState<Record<string, string>>({});
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<"run" | "submit" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [runResult, setRunResult] = React.useState<JudgeView | null>(null);
  const [submitResult, setSubmitResult] = React.useState<JudgeView | null>(null);
  const [logNote, setLogNote] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  // Per-language buffers, so flicking between Python and Java to compare
  // approaches doesn't throw away whichever one you weren't looking at.
  const buffers = React.useRef<Record<string, string>>({});
  const editorRef = React.useRef<CodeEditorHandle>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const [palette, setPalette] = usePalette();

  /* ------------------------------ autosave ------------------------------- */

  const baseline = savedCode[lang] ?? initialDrafts[lang] ?? snippets[lang] ?? "";
  const dirty = code !== baseline;

  React.useEffect(() => {
    // Nothing to save on mount, and nothing to save just because you switched
    // to a language whose starter code you haven't touched.
    if (!dirty) return;
    const timer = setTimeout(() => {
      void saveDraft(slug, lang, code).then((res) => {
        setSaveFailed(!res.ok);
        if (res.ok) setSavedCode((map) => ({ ...map, [lang]: code }));
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, slug, lang, code]);

  const marker = saveFailed
    ? "Not saved"
    : dirty
      ? "Saving"
      : savedCode[lang] !== undefined
        ? "Saved"
        : "Draft";

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (confirming && !el.open) el.showModal();
    if (!confirming && el.open) el.close();
  }, [confirming]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  /* ------------------------------- editing -------------------------------- */

  const edit = (next: string) => {
    buffers.current[lang] = next;
    setCode(next);
  };

  function changeLang(next: string) {
    buffers.current[lang] = code;
    // Setting `lang` and `code` together re-runs the autosave effect, whose
    // cleanup cancels the outgoing language's pending write — and nothing
    // re-arms it. Flush it here or a switch inside the 800ms window loses the
    // edit to everything but the in-memory buffer.
    if (dirty) void saveDraft(slug, lang, code);
    setLang(next);
    setCode(buffers.current[next] ?? initialDrafts[next] ?? snippets[next] ?? "");
    setSaveFailed(false);
  }

  /* -------------------------------- judge --------------------------------- */

  async function judge(kind: "run" | "submit") {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(kind);
    setError(null);
    setLogNote(null);
    if (kind === "run") setRunResult(null);
    else setSubmitResult(null);

    // Whatever happens next, don't lose what was sent.
    void saveDraft(slug, lang, code);

    try {
      const res = await fetch(`/api/leetcode/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          questionId,
          lang,
          code,
          ...(kind === "run" ? { input: testcase } : {}),
        }),
        signal: controller.signal,
      });

      const data = (await res.json()) as JudgeResponse;

      if (!data.ok) {
        setError(data.error);
        return;
      }

      if (kind === "run") {
        setRunResult(data.result);
        return;
      }

      setSubmitResult(data.result);
      if (data.logged === false) {
        setLogNote("The verdict didn't make it into your local submission history.");
      }

      if (data.result.ok) {
        const logged = await recordAccepted({ slug, title, lang });
        setLogNote(
          logged.ok
            ? logged.created
              ? "Logged in your tracker as solved today."
              : "Your tracker entry is updated — solved again today."
            : logged.error,
        );
      }
      router.refresh();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.name === "AbortError"
          ? "That was cancelled."
          : "Couldn't reach the app server. Check that it's still running and try again.",
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(null);
      }
    }
  }

  const pending = busy !== null;

  if (!langs.length) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-[15px] font-semibold text-ink">Editor</h2>
        </CardHeader>
        <CardBody>
          <p className="text-[13px] leading-relaxed text-ink-2">
            LeetCode didn&rsquo;t send any starter code for this problem, which usually
            means it&rsquo;s premium-only. Open it on leetcode.com to solve it there.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <Field label="Language" className="w-[172px]">
          <Select
            value={lang}
            disabled={pending}
            onChange={(e) => changeLang(e.target.value)}
          >
            {langs.map((l) => (
              <option key={l} value={l}>
                {label(l)}
              </option>
            ))}
          </Select>
        </Field>
        <span className="lbl" role="status" aria-live="polite">
          {marker}
        </span>
      </CardHeader>

      <CardBody className="flex min-w-0 flex-col gap-3">
        <div className="min-h-[340px] overflow-hidden rounded-[10px] border border-line bg-surface lg:min-h-[420px]">
          <CodeEditor
            ref={editorRef}
            value={code}
            language={lang}
            palette={palette}
            ariaLabel={`Your ${label(lang)} solution to ${title}`}
            className="h-[340px] lg:h-[420px]"
            onChange={edit}
            onRun={() => { if (!busy) void judge("run"); }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
          <p className="leading-snug">
            Brackets close themselves and new lines keep their indent. Escape then Tab
            moves on.
          </p>
          <div className="flex items-center gap-1">
            <span className="lbl">Syntax</span>
            {(["mono", "colour"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPalette(p)}
                aria-pressed={palette === p}
                className={`rounded-md px-2 py-0.5 font-medium ${
                  palette === p
                    ? "bg-accent text-on-accent"
                    : "text-ink-3 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {p === "mono" ? "Mono" : "Colour"}
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Testcase"
          hint="One argument per line, the way LeetCode's own box takes it."
        >
          <Textarea
            value={testcase}
            onChange={(e) => setTestcase(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={3}
            className="font-mono text-[12.5px]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} onClick={() => void judge("run")}>
            {busy === "run" ? "Running" : "Run"}
          </Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {busy === "submit" ? "Submitting" : "Submit"}
          </Button>
          {pending ? (
            <span className="text-[12px] text-ink-3" role="status">
              Waiting on LeetCode&rsquo;s judge — this takes a few seconds.
            </span>
          ) : null}
        </div>
        <p className="text-[11.5px] leading-snug text-ink-3">
          Run only checks your testcase here; it never appears on your LeetCode profile.
          Submit does.
        </p>

        {error ? (
          <p role="alert" className="text-[12.5px] leading-relaxed">
            {error}
          </p>
        ) : null}

        {runResult ? <Verdict result={runResult} kind="run" /> : null}
        {submitResult ? (
          <Verdict result={submitResult} kind="submit" note={logNote} />
        ) : null}
      </CardBody>

      <dialog
        ref={dialogRef}
        aria-labelledby="submit-confirm-heading"
        onClose={() => setConfirming(false)}
        className={`${DIALOG_PANEL} w-[min(92vw,420px)]`}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id="submit-confirm-heading" className="text-[15px] font-semibold text-ink">
            Submit to LeetCode?
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            This is a real submission on your account. It is public, and a wrong answer
            shows in your LeetCode submission history exactly like an accepted one. Run
            it against your testcase first if you&rsquo;re unsure.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false);
                void judge("submit");
              }}
            >
              Submit {label(lang)}
            </Button>
          </div>
        </div>
      </dialog>
    </Card>
  );
}

/* -------------------------------- verdict ---------------------------------- */

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="lbl">{label}</span>
      <pre className="overflow-x-auto rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12px] leading-[1.5] text-ink">
        {value}
      </pre>
    </div>
  );
}

const joinLines = (v: string[] | null) =>
  v && v.length ? v.join("\n") : null;

function Verdict({
  result,
  kind,
  note,
}: {
  result: JudgeView;
  kind: "run" | "submit";
  note?: string | null;
}) {
  const yours = joinLines(result.codeAnswer);
  const expected = joinLines(result.expectedAnswer);
  const counted =
    result.totalTestcases != null && result.totalCorrect != null
      ? `${result.totalCorrect} of ${result.totalTestcases} testcases passed`
      : null;

  return (
    <section
      aria-label={`${kind === "run" ? "Run" : "Submission"} result`}
      className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-line bg-surface-3 px-3.5 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-ink">{result.verdict}</h3>
        <span className="lbl">{kind === "run" ? "Run" : "Submission"}</span>
      </div>

      {result.ok && kind === "submit" ? (
        <p className="text-[13px] leading-relaxed text-ink-2">
          {[
            result.runtime ? `Runtime ${result.runtime}` : null,
            result.memory ? `Memory ${result.memory}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Accepted."}
        </p>
      ) : null}

      {!result.ok && counted ? (
        <p className="font-mono text-[12px] tabular-nums text-ink-2">{counted}</p>
      ) : null}

      {result.error ? <Block label="Error" value={result.error} /> : null}

      {!result.ok && result.lastTestcase ? (
        <Block label="Failing input" value={result.lastTestcase} />
      ) : null}

      {yours ? <Block label="Your output" value={yours} /> : null}
      {expected ? <Block label="Expected" value={expected} /> : null}
      {result.stdout ? <Block label="Stdout" value={result.stdout} /> : null}

      {note ? (
        <p className="text-[12px] leading-snug text-ink-3" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
