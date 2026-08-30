"use client";

/**
 * The full solve log: a filter row, a table, and the delete confirmation.
 *
 * Client-side because the filters are local state — the whole list is already
 * on the page, so filtering it in the browser is instant and costs no round
 * trip. Everything that changes data still goes through a Server Action.
 */
import * as React from "react";

import {
  Button,
  Chip,
  DIALOG_PANEL,
  Empty,
  Field,
  Input,
  LinkButton,
  Select,
} from "@/components/ui";
import { formatDay, formatMins } from "@/lib/dates";
import { deleteProblem } from "@/app/actions/problems";
import { LogProblemButton } from "@/components/log-dialogs";
import { DifficultyChip, type ProblemItem } from "./bits";

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;

function statusLabel(status: string) {
  return status === "revisit" ? "Revisit" : "Solved";
}

export function ProblemsTable({ problems }: { problems: ProblemItem[] }) {
  const [difficulty, setDifficulty] = React.useState("all");
  const [tag, setTag] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const [target, setTarget] = React.useState<ProblemItem | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  // Open and close through an effect, so the dialog never paints a frame of the
  // previous row's title while state catches up.
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (target && !el.open) el.showModal();
    if (!target && el.open) el.close();
  }, [target]);

  const tags = React.useMemo(() => {
    const set = new Set<string>();
    problems.forEach((p) => p.tags.forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [problems]);

  const sorted = React.useMemo(
    () => [...problems].sort((a, b) => b.solvedDay.localeCompare(a.solvedDay)),
    [problems],
  );

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () =>
      sorted.filter((p) => {
        if (difficulty !== "all" && p.difficulty !== difficulty) return false;
        if (status !== "all" && p.status !== status) return false;
        if (tag !== "all" && !p.tags.includes(tag)) return false;
        if (!q) return true;
        return (
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          String(p.number ?? "").includes(q) ||
          (p.lang ?? "").toLowerCase().includes(q)
        );
      }),
    [sorted, difficulty, status, tag, q],
  );

  const filterActive = difficulty !== "all" || status !== "all" || tag !== "all" || q !== "";

  const clear = () => {
    setDifficulty("all");
    setStatus("all");
    setTag("all");
    setQuery("");
  };

  if (!problems.length) {
    return (
      <Empty
        title="No problems logged yet"
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <LogProblemButton />
            <LinkButton href="/setup">Import from LeetCode</LinkButton>
          </div>
        }
      >
        Log a solve by hand, or connect your LeetCode account in Setup and pull your
        history in.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Difficulty" className="w-[130px]">
          <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="all">All</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Topic" className="w-[168px]">
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="all">All topics</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" className="w-[130px]">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="solved">Solved</option>
            <option value="revisit">Revisit</option>
          </Select>
        </Field>

        <Field label="Search" className="min-w-[160px] flex-1">
          <Input
            type="search"
            value={query}
            placeholder="Title, number or language"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>

        {filterActive ? (
          <Button variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {filterActive ? (
        <p role="status" className="text-[12px] text-ink-3">
          Showing {filtered.length} of {problems.length}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <Empty
          title="Nothing matches those filters"
          action={<Button onClick={clear}>Clear filters</Button>}
        >
          Widen the search, or clear the filters to see all {problems.length} problems.
        </Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <caption className="sr-only">
              Every problem you have logged, newest first, with its difficulty, topics
              and the day you solved it. This is the full data behind the difficulty and
              topic charts above.
            </caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="lbl py-2 pr-3 font-medium">#</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Title</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Difficulty</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Topics</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Time</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Language</th>
                <th scope="col" className="lbl py-2 pr-3 font-medium">Solved</th>
                <th scope="col" className="lbl py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-line-soft align-middle">
                  <td className="py-2.5 pr-3 font-mono text-[12px] tabular-nums text-ink-3">
                    {p.number ?? "—"}
                  </td>
                  <td className="max-w-[260px] py-2.5 pr-3">
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-accent"
                      >
                        {p.title}
                      </a>
                    ) : (
                      <span className="font-medium text-ink">{p.title}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <DifficultyChip difficulty={p.difficulty} />
                  </td>
                  <td className="py-2.5 pr-3">
                    {p.tags.length ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {p.tags.slice(0, 3).map((t) => (
                          <Chip key={t}>{t}</Chip>
                        ))}
                        {p.tags.length > 3 ? (
                          <span className="text-[11.5px] text-ink-3">
                            +{p.tags.length - 3}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{statusLabel(p.status)}</td>
                  <td className="py-2.5 pr-3 font-mono text-[12px] tabular-nums text-ink-2">
                    {p.minutes ? formatMins(p.minutes) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{p.lang || "—"}</td>
                  <td className="py-2.5 pr-3 font-mono text-[12px] tabular-nums text-ink-2">
                    {formatDay(p.solvedDay)}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Same dialog, prefilled — the edit case is a prop, not a
                          second form. */}
                      <LogProblemButton problem={p} />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => {
                          setError(null);
                          setTarget(p);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-problem-heading"
        onClose={() => setTarget(null)}
        className={`${DIALOG_PANEL} w-[min(92vw,380px)]`}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id="delete-problem-heading" className="text-[15px] font-semibold text-ink">
            Delete this problem?
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {target ? `"${target.title}" leaves your log, along with its notes and topics.` : ""}{" "}
            You can log it again, but the notes are gone.
          </p>
          {error ? (
            <p role="alert" className="text-[12px] text-flame">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => setTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (!target) return;
                const id = target.id;
                setError(null);
                start(async () => {
                  const res = await deleteProblem(id);
                  if (res.ok) setTarget(null);
                  else setError(res.error);
                });
              }}
            >
              {pending ? "Deleting" : "Delete"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
