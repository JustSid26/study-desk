"use client";

/**
 * The two dashboard header actions.
 *
 * Both use the native `<dialog>` element driven by `showModal()` — never
 * `window.confirm`/`alert`, which can't be styled, can't hold a form and block
 * the whole tab. Each form posts straight to its Server Action through
 * `useActionState`, so a validation failure comes back as text inside the
 * dialog instead of a thrown error, and the dialog only closes once the action
 * has actually reported success.
 */

import Link from "next/link";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";

import { createSession } from "@/app/actions/subjects";
import { saveProblem } from "@/app/actions/problems";
import {
  Button,
  Chip,
  DIALOG_PANEL,
  Field,
  Input,
  Select,
  Textarea,
  linkButtonClass,
} from "@/components/ui";
import { today } from "@/lib/dates";

export type DialogSubject = { id: string; name: string; color?: string | null };

type State = { ok: true } | { ok: false; error: string } | null;

const PANEL = `${DIALOG_PANEL} w-[min(31rem,calc(100vw-1.5rem))] max-h-[86vh] overflow-y-auto`;

/* ------------------------------ dialog shell ------------------------------ */

function Modal({
  dialogRef,
  titleId,
  title,
  onClose,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={PANEL}
      onClose={onClose}
      // Clicking the backdrop lands on the dialog element itself, never on the
      // panel content, so this closes on an outside click without a wrapper div.
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h2 id={titleId} className="text-[14px] font-semibold text-ink">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Button>
      </div>
      <div className="px-4 py-4">{children}</div>
    </dialog>
  );
}

function ErrorLine({ state }: { state: State }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="text-[12.5px] leading-snug text-flame">
      {state.error}
    </p>
  );
}

/* ----------------------------- log study time ----------------------------- */

async function submitSession(_prev: State, fd: FormData): Promise<State> {
  const res = await createSession(fd);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export function LogSessionButton({ subjects }: { subjects: DialogSubject[] }) {
  // The subjects page renders this button more than once (header, recent
  // sessions, empty state), so the heading id has to be per-instance or the
  // page ships duplicate ids and `aria-labelledby` resolves to the wrong one.
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [day, setDay] = useState("");
  const [state, formAction, pending] = useActionState(submitSession, null);

  // `today()` is only read once the dialog opens, so the server-rendered markup
  // never carries a date the visitor's own timezone might disagree with.
  const open = useCallback(() => {
    setDay(today());
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      dialogRef.current?.close();
    }
  }, [state]);

  const empty = subjects.length === 0;

  return (
    <>
      <Button variant="primary" onClick={open}>
        Log study time
      </Button>

      <Modal
        dialogRef={dialogRef}
        titleId={titleId}
        title="Log study time"
        onClose={() => undefined}
      >
        {empty ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Study time is logged against a subject, and there aren&apos;t any yet. Add
              one first and it will show up here.
            </p>
            <Link
              href="/subjects"
              className={linkButtonClass({ variant: "primary" })}
            >
              Add a subject
            </Link>
          </div>
        ) : (
          <form ref={formRef} action={formAction} className="flex flex-col gap-3.5">
            <Field label="Subject">
              <Select name="subjectId" defaultValue={subjects[0].id}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Minutes">
                <Input
                  name="minutes"
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  required
                  inputMode="numeric"
                  placeholder="45"
                />
              </Field>
              <Field label="Day">
                <Input
                  name="day"
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Note" hint="Optional — what you actually worked on.">
              <Textarea name="note" rows={2} maxLength={500} />
            </Field>

            <ErrorLine state={state} />

            <div className="flex items-center justify-end gap-2 pt-0.5">
              <Button onClick={() => dialogRef.current?.close()}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Saving…" : "Log study time"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/* ------------------------------ log a problem ----------------------------- */

type Hit = {
  slug: string;
  number: number | null;
  title: string;
  difficulty: string;
  tags: string[];
  url: string | null;
};

const BLANK = {
  slug: "",
  url: "",
  number: "",
  title: "",
  difficulty: "Medium",
  tags: [] as string[],
};

/**
 * A row being edited. Declared structurally rather than imported from
 * `@/lib/queries`, which is server-only — the LeetCode table passes its own
 * `ProblemItem` straight in.
 */
export type DialogProblem = {
  id: string;
  slug: string;
  number: number | null;
  title: string;
  url: string | null;
  difficulty: string;
  status: string;
  solvedDay: string;
  minutes: number | null;
  lang: string | null;
  notes: string;
  confidence: number | null;
  tags: string[];
};

function fieldsFor(p: DialogProblem | undefined) {
  if (!p) return BLANK;
  return {
    slug: p.slug,
    url: p.url ?? "",
    number: p.number == null ? "" : String(p.number),
    title: p.title,
    difficulty: p.difficulty || "Medium",
    tags: p.tags ?? [],
  };
}

function isHit(x: unknown): x is Hit {
  const h = x as Hit | null;
  return !!h && typeof h.slug === "string" && typeof h.title === "string";
}

/**
 * Log a problem, or edit one. The edit case is a prop, not a second dialog —
 * the fields, the validation and the Server Action are identical, and the only
 * difference is what the form starts out holding.
 */
export function LogProblemButton({ problem }: { problem?: DialogProblem } = {}) {
  const editing = problem !== undefined;
  // One of these renders per table row, so the heading id has to be unique.
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [day, setDay] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [fields, setFields] = useState(() => fieldsFor(problem));

  // The tidy-up runs inside the action rather than in an effect watching
  // `state` — an effect would set state synchronously on every success and
  // cascade an extra render for nothing.
  const [state, formAction, pending] = useActionState(
    async (_prev: State, fd: FormData): Promise<State> => {
      const res = await saveProblem(fd);
      if (!res.ok) return { ok: false, error: res.error };
      formRef.current?.reset();
      setFields(fieldsFor(problem));
      setQuery("");
      setHits([]);
      dialogRef.current?.close();
      return { ok: true };
    },
    null,
  );

  const open = useCallback(() => {
    setDay(problem ? problem.solvedDay : today());
    setFields(fieldsFor(problem));
    setIsOpen(true);
    dialogRef.current?.showModal();
  }, [problem]);

  // Debounced catalogue lookup. The in-flight request is aborted on every
  // keystroke so a slow early response can't overwrite a newer result set.
  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!isOpen || term.length < 2) {
        setHits([]);
        return;
      }
      fetch(`/api/lookup?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { results?: unknown[] } | null) => {
          const rows = Array.isArray(data?.results) ? data.results : [];
          setHits(rows.filter(isHit).slice(0, 6));
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isOpen]);

  function pick(hit: Hit) {
    setFields({
      slug: hit.slug,
      url: hit.url ?? "",
      number: hit.number == null ? "" : String(hit.number),
      title: hit.title,
      difficulty: hit.difficulty || "Medium",
      tags: hit.tags ?? [],
    });
    setQuery("");
    setHits([]);
  }

  return (
    <>
      {editing ? (
        <Button size="sm" variant="ghost" aria-label={`Edit ${problem.title}`} onClick={open}>
          Edit
        </Button>
      ) : (
        <Button onClick={open}>Log a problem</Button>
      )}

      <Modal
        dialogRef={dialogRef}
        titleId={titleId}
        title={editing ? "Edit problem" : "Log a problem"}
        onClose={() => setIsOpen(false)}
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-3.5">
          <input type="hidden" name="slug" value={fields.slug} />
          <input type="hidden" name="url" value={fields.url} />
          <input type="hidden" name="tags" value={fields.tags.join(",")} />
          {/* On an edit, carry the fields this form doesn't show, or saving
              would blank the language and the notes. */}
          {editing ? (
            <>
              <input type="hidden" name="id" value={problem.id} />
              <input type="hidden" name="lang" value={problem.lang ?? ""} />
              <input type="hidden" name="notes" value={problem.notes ?? ""} />
            </>
          ) : null}

          {editing ? null : (
          <div className="flex flex-col gap-1.5">
            <Field label="Find it in the catalogue" hint="Search by title or number.">
              <Input
                type="search"
                autoComplete="off"
                value={query}
                placeholder="two sum, or 1"
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            {hits.length ? (
              <ul className="overflow-hidden rounded-[8px] border border-line">
                {hits.map((h) => (
                  <li key={h.slug} className="border-b border-line-soft last:border-b-0">
                    <button
                      type="button"
                      onClick={() => pick(h)}
                      className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-ink-3">
                        {h.number ?? "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {h.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-3">{h.difficulty}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          )}

          <Field label="Title">
            <Input
              name="title"
              required
              maxLength={200}
              value={fields.title}
              onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Number">
              <Input
                name="number"
                inputMode="numeric"
                placeholder="Optional"
                value={fields.number}
                onChange={(e) => setFields((f) => ({ ...f, number: e.target.value }))}
              />
            </Field>
            <Field label="Difficulty">
              <Select
                name="difficulty"
                value={fields.difficulty}
                onChange={(e) => setFields((f) => ({ ...f, difficulty: e.target.value }))}
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Solved on">
              <Input
                name="solvedDay"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field label="Minutes">
              <Input
                name="minutes"
                type="number"
                min={1}
                max={1440}
                step={1}
                inputMode="numeric"
                placeholder="Optional"
                defaultValue={problem?.minutes == null ? "" : String(problem.minutes)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Confidence" hint="1 shaky, 5 solid.">
              <Select
                name="confidence"
                defaultValue={problem?.confidence == null ? "" : String(problem.confidence)}
              >
                <option value="">Not sure yet</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue={problem?.status ?? "solved"}>
                <option value="solved">Solved</option>
                <option value="revisit">Flag to revisit</option>
              </Select>
            </Field>
          </div>

          {fields.tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {fields.tags.slice(0, 8).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          ) : null}

          <ErrorLine state={state} />

          <div className="flex items-center justify-end gap-2 pt-0.5">
            <Button onClick={() => dialogRef.current?.close()}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Log a problem"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
