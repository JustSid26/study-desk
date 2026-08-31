"use client";

/**
 * Logging a problem by hand.
 *
 * The module this came out of paired it with a second dialog for logging
 * minutes at a desk. That idea is gone from the app, so what is left is one
 * dialog about one thing, colocated with the route that owns it.
 *
 * Two entry points, one dialog: the toolbar button opens it empty, and the
 * table's Edit button opens the same dialog prefilled with a row. A second
 * form for the edit case would be a second place to fix every bug.
 *
 * The catalogue typeahead is a plain `GET /api/lookup`, not a Server Action:
 * keystroke-rate reads want to be abortable and cacheable, and Server Actions
 * queue behind one another.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button, DIALOG_PANEL, Field, Input, Select, Textarea } from "@/components/ui";
import { saveProblem } from "@/app/actions/problems";

import type { ProblemItem } from "./bits";

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
const STATUSES = [
  { value: "solved", label: "Solved" },
  { value: "revisit", label: "Revisit" },
] as const;

/** What `/api/lookup` returns per row. */
interface Hit {
  slug: string;
  number: number;
  title: string;
  difficulty: string;
  tags: string[];
  url: string;
}

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface FormState {
  title: string;
  slug: string;
  number: string;
  url: string;
  difficulty: string;
  status: string;
  solvedDay: string;
  minutes: string;
  lang: string;
  confidence: string;
  notes: string;
  tags: string;
}

function initialState(problem?: ProblemItem): FormState {
  return {
    title: problem?.title ?? "",
    slug: problem?.slug ?? "",
    number: problem?.number ? String(problem.number) : "",
    url: problem?.url ?? "",
    difficulty: problem?.difficulty ?? "Medium",
    status: problem?.status === "revisit" ? "revisit" : "solved",
    solvedDay: problem?.solvedDay || todayKey(),
    minutes: problem?.minutes ? String(problem.minutes) : "",
    lang: problem?.lang ?? "",
    confidence: problem?.confidence ? String(problem.confidence) : "",
    notes: problem?.notes ?? "",
    tags: (problem?.tags ?? []).join(", "),
  };
}

export function LogProblemButton({
  problem,
  emphasis = false,
}: {
  /** Present for the edit case — the same dialog, prefilled. */
  problem?: ProblemItem;
  /** In an empty state the primary action carries the weight. */
  emphasis?: boolean;
}) {
  const router = useRouter();
  const dialog = React.useRef<HTMLDialogElement>(null);

  const [form, setForm] = React.useState<FormState>(() => initialState(problem));
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const editing = Boolean(problem);
  const set = <K extends keyof FormState>(key: K, value: string) =>
    setForm((cur) => ({ ...cur, [key]: value }));

  function open() {
    setForm(initialState(problem));
    setHits([]);
    setError(null);
    dialog.current?.showModal();
  }

  /* ------------------------------ typeahead ------------------------------ */

  // Only for a new entry: an existing row already has its identity, and
  // re-searching from its title would offer to overwrite it with itself.
  const query = editing ? "" : form.title.trim();

  // The suggestion list is derived, not stored: clearing it from inside the
  // effect body would be a synchronous setState and a cascading render.
  const suggestions = query && !form.slug ? hits : [];

  React.useEffect(() => {
    if (!query || form.slug) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { results?: Hit[] };
        setHits(Array.isArray(body.results) ? body.results : []);
      } catch {
        /* an aborted or failed lookup just means no suggestions */
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, form.slug]);

  function pick(hit: Hit) {
    setForm((cur) => ({
      ...cur,
      title: hit.title,
      slug: hit.slug,
      number: hit.number ? String(hit.number) : "",
      url: hit.url,
      difficulty: DIFFICULTIES.includes(hit.difficulty as (typeof DIFFICULTIES)[number])
        ? hit.difficulty
        : cur.difficulty,
      tags: hit.tags.join(", "),
    }));
    setHits([]);
  }

  /* -------------------------------- submit ------------------------------- */

  function submit() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      if (problem) fd.set("id", problem.id);
      for (const [key, value] of Object.entries(form)) fd.set(key, value);

      const res = await saveProblem(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      dialog.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size={editing ? "sm" : "md"}
        variant={emphasis ? "primary" : "default"}
        onClick={open}
        aria-label={editing ? `Edit ${problem!.title}` : undefined}
      >
        {editing ? "Edit" : "Log a problem"}
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby="log-problem-title"
        className={`${DIALOG_PANEL} w-[min(38rem,calc(100vw-2rem))]`}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="border-b border-line-soft px-4 py-3">
            <h3 id="log-problem-title" className="text-[15px] font-semibold text-ink">
              {editing ? "Edit problem" : "Log a problem"}
            </h3>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
              {editing
                ? "Everything here is yours — a re-sync from LeetCode never overwrites it."
                : "Start typing a title or a number and pick it from the catalogue to fill the rest in."}
            </p>
          </div>

          <div className="max-h-[min(60vh,32rem)] overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4">
              <Field label="Title" hint="Or paste the LeetCode link below and leave this blank.">
                <Input
                  value={form.title}
                  onChange={(e) => {
                    set("title", e.target.value);
                    // A hand-edited title is no longer the catalogue row that
                    // filled it, so release the slug and search again.
                    if (form.slug && !editing) set("slug", "");
                  }}
                  placeholder="Two Sum"
                  maxLength={200}
                  autoComplete="off"
                />
              </Field>

              {suggestions.length ? (
                <ul className="-mt-2 flex flex-col overflow-hidden rounded-[8px] border border-line">
                  {suggestions.map((hit) => (
                    <li key={hit.slug} className="border-b border-line-soft last:border-0">
                      <button
                        type="button"
                        onClick={() => pick(hit)}
                        className="flex w-full cursor-pointer items-baseline gap-2 bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="font-mono text-[11.5px] tabular-nums text-ink-3">
                          {hit.number || "—"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                          {hit.title}
                        </span>
                        <span className="shrink-0 text-[11.5px] text-ink-2">{hit.difficulty}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Link" hint="Optional. The slug is read out of it.">
                  <Input
                    type="url"
                    value={form.url}
                    onChange={(e) => set("url", e.target.value)}
                    placeholder="https://leetcode.com/problems/two-sum/"
                    maxLength={500}
                  />
                </Field>
                <Field label="Number" hint="Optional.">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={form.number}
                    onChange={(e) => set("number", e.target.value)}
                  />
                </Field>
                <Field label="Difficulty">
                  <Select
                    value={form.difficulty}
                    onChange={(e) => set("difficulty", e.target.value)}
                  >
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" hint="Revisit puts it back in the queue on the LeetCode tab.">
                  <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Solved on">
                  <Input
                    type="date"
                    value={form.solvedDay}
                    onChange={(e) => set("solvedDay", e.target.value)}
                  />
                </Field>
                <Field label="Time on it" hint="Optional, in minutes.">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1440}
                    step={1}
                    value={form.minutes}
                    onChange={(e) => set("minutes", e.target.value)}
                  />
                </Field>
                <Field label="Language" hint="Optional.">
                  <Input
                    value={form.lang}
                    onChange={(e) => set("lang", e.target.value)}
                    placeholder="Java"
                    maxLength={40}
                  />
                </Field>
                <Field label="Confidence" hint="1 shaky, 5 solid. Optional.">
                  <Select
                    value={form.confidence}
                    onChange={(e) => set("confidence", e.target.value)}
                  >
                    <option value="">Not set</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Tags" hint="Comma separated. The catalogue fills these in for you.">
                <Input
                  value={form.tags}
                  onChange={(e) => set("tags", e.target.value)}
                  placeholder="Array, Hash Table"
                />
              </Field>

              <Field label="Notes" hint="The approach, the trick, or what caught you out.">
                <Textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={5}
                  maxLength={20000}
                />
              </Field>

              {error ? (
                <p role="alert" className="text-[12.5px] leading-snug">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-3">
            <Button variant="ghost" type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={pending || (!form.title.trim() && !form.url.trim())}
            >
              {pending ? "Saving" : editing ? "Save changes" : "Log it"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
