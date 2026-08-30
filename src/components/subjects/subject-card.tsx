"use client";

/**
 * One subject: mastery meter, the four status counts, a stat line, and the
 * topic list. Rename and recolour are inline <dialog>s; delete states in one
 * sentence exactly what it takes with it, because it takes more than the row.
 *
 * The prop shape is declared here rather than imported from `@/lib/queries` —
 * that module is server-only, and a client component must not pull it in.
 */
import * as React from "react";

import {
  addTopic,
  cycleTopicStatus,
  deleteSubject,
  deleteTopic,
  recolorSubject,
  renameSubject,
} from "@/app/actions/subjects";
import { subjectColor } from "@/components/subject-color";
import { formatMins } from "@/lib/dates";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  DIALOG_PANEL,
  Empty,
  Input,
  Meter,
} from "@/components/ui";
import { ColourSwatches } from "@/components/subjects/colour-swatches";

type TopicStatus = "new" | "learning" | "revising" | "solid";

export interface SubjectCardData {
  id: string;
  name: string;
  color: string;
  goalMins: number | null;
  topics: Array<{ id: string; name: string; status: TopicStatus; position: number }>;
  minutesLogged: number;
  noteCount: number;
  progress: number;
  counts: Record<TopicStatus, number>;
}

/** Mastery hues. Every one is rendered beside its own word, never alone. */
const STATUS_DOT: Record<TopicStatus, string> = {
  new: "var(--color-ink-3)",
  learning: "var(--color-learning)",
  revising: "var(--color-medium)",
  solid: "var(--color-easy)",
};

const STATUS_LABEL: Record<TopicStatus, string> = {
  new: "Not started",
  learning: "Learning",
  revising: "Revising",
  solid: "Solid",
};

const ORDER: TopicStatus[] = ["new", "learning", "revising", "solid"];

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-3.5 w-3.5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function SubjectCard({ subject }: { subject: SubjectCardData }) {
  const dot = subjectColor(subject.color);
  const pct = Math.round((subject.progress || 0) * 100);

  const renameRef = React.useRef<HTMLDialogElement>(null);
  const recolourRef = React.useRef<HTMLDialogElement>(null);
  const deleteRef = React.useRef<HTMLDialogElement>(null);
  const topicInputRef = React.useRef<HTMLInputElement>(null);

  const [name, setName] = React.useState(subject.name);
  const [color, setColor] = React.useState(subject.color);
  const [draft, setDraft] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function openDialog(ref: React.RefObject<HTMLDialogElement | null>) {
    setDialogError(null);
    ref.current?.showModal();
  }

  function onRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogError(null);
    startTransition(async () => {
      const res = await renameSubject(subject.id, name);
      if (res.ok) renameRef.current?.close();
      else setDialogError(res.error);
    });
  }

  function onRecolour(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogError(null);
    startTransition(async () => {
      const res = await recolorSubject(subject.id, color);
      if (res.ok) recolourRef.current?.close();
      else setDialogError(res.error);
    });
  }

  function onDelete() {
    setDialogError(null);
    startTransition(async () => {
      const res = await deleteSubject(subject.id);
      if (res.ok) deleteRef.current?.close();
      else setDialogError(res.error);
    });
  }

  /**
   * Submit-and-stay: the field clears and keeps focus the instant you hit
   * Enter, so a whole syllabus goes in without ever reaching for the mouse.
   */
  function onAddTopic(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    setError(null);
    topicInputRef.current?.focus();
    startTransition(async () => {
      const res = await addTopic(subject.id, value);
      if (!res.ok) {
        setError(res.error);
        setDraft(value);
      }
      topicInputRef.current?.focus();
    });
  }

  function onCycle(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await cycleTopicStatus(id);
      if (!res.ok) setError(res.error);
    });
  }

  function onDeleteTopic(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTopic(id);
      if (!res.ok) setError(res.error);
    });
  }

  const topicCount = subject.topics.length;
  const goalText = subject.goalMins ? ` of ${formatMins(subject.goalMins)} a week` : "";
  const noteText =
    subject.noteCount === 0
      ? "no notes filed"
      : `${subject.noteCount} note${subject.noteCount === 1 ? "" : "s"} filed`;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            style={{ backgroundColor: dot }}
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          />
          <h2 className="truncate text-[14.5px] font-semibold text-ink">{subject.name}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="sm" variant="ghost" onClick={() => openDialog(renameRef)}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog(recolourRef)}>
            Recolour
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-flame hover:bg-flame-soft hover:text-flame"
            onClick={() => openDialog(deleteRef)}
          >
            Delete
          </Button>
        </div>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <Meter value={subject.progress} className="min-w-0 flex-1" />
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-2">
            {pct}% mastered
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ORDER.map((s) => (
            <Chip key={s} dot={STATUS_DOT[s]}>
              {STATUS_LABEL[s]}
              <span className="tabular-nums font-semibold text-ink">{subject.counts[s]}</span>
            </Chip>
          ))}
        </div>

        <p className="text-[12.5px] leading-snug text-ink-2">
          <span className="tabular-nums">{formatMins(subject.minutesLogged)}</span> logged
          {goalText} · {noteText}
        </p>

        <details
          open={open}
          onToggle={(e) => setOpen(e.currentTarget.open)}
          className="mt-auto border-t border-line-soft pt-2.5"
        >
          <summary className="lbl cursor-pointer list-none marker:content-none">
            {open ? "Hide" : "Show"} topics ({topicCount})
          </summary>

          <div className="pt-2">
            {topicCount === 0 ? (
              <Empty title="No topics yet" className="px-0 py-3">
                Break the subject into the things you actually have to learn — a chapter, a
                concept, a tense.
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {subject.topics.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.name}</span>
                    <button
                      type="button"
                      onClick={() => onCycle(t.id)}
                      title="Cycle mastery: not started, learning, revising, solid"
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-[3px] text-[11.5px] font-medium leading-none text-ink-2 transition-colors hover:bg-surface-3"
                    >
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: STATUS_DOT[t.status] }}
                        className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
                      />
                      {STATUS_LABEL[t.status]}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete topic ${t.name}`}
                      onClick={() => onDeleteTopic(t.id)}
                      className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-flame-soft hover:text-flame"
                    >
                      <XIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={onAddTopic} className="mt-2 flex items-center gap-2">
              <Input
                ref={topicInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={80}
                autoComplete="off"
                placeholder="Add topic, press Enter"
                aria-label={`Add a topic to ${subject.name}`}
                className="h-8 text-[12.5px]"
              />
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                Add
              </Button>
            </form>

            {error ? (
              <p role="alert" className="mt-1.5 text-[12px] leading-snug text-flame">
                {error}
              </p>
            ) : null}
          </div>
        </details>
      </CardBody>

      {/* ------------------------------ rename ------------------------------ */}
      <dialog
        ref={renameRef}
        aria-labelledby={`rename-${subject.id}`}
        onClick={(e) => {
          if (e.target === renameRef.current) renameRef.current?.close();
        }}
        className={`${DIALOG_PANEL} w-[min(94vw,400px)]`}
      >
        <form onSubmit={onRename} className="flex flex-col gap-3 p-4">
          <h2 id={`rename-${subject.id}`} className="text-[15px] font-semibold text-ink">
            Rename subject
          </h2>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="off"
            aria-label="Subject name"
          />
          {dialogError ? (
            <p role="alert" className="text-[12.5px] leading-snug text-flame">
              {dialogError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setName(subject.name);
                renameRef.current?.close();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Save name
            </Button>
          </div>
        </form>
      </dialog>

      {/* ----------------------------- recolour ----------------------------- */}
      <dialog
        ref={recolourRef}
        aria-labelledby={`recolour-${subject.id}`}
        onClick={(e) => {
          if (e.target === recolourRef.current) recolourRef.current?.close();
        }}
        className={`${DIALOG_PANEL} w-[min(94vw,400px)]`}
      >
        <form onSubmit={onRecolour} className="flex flex-col gap-3 p-4">
          <h2 id={`recolour-${subject.id}`} className="text-[15px] font-semibold text-ink">
            Recolour {subject.name}
          </h2>
          <ColourSwatches value={color} onChange={setColor} idPrefix={`recolour-${subject.id}`} />
          {dialogError ? (
            <p role="alert" className="text-[12.5px] leading-snug text-flame">
              {dialogError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setColor(subject.color);
                recolourRef.current?.close();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Save colour
            </Button>
          </div>
        </form>
      </dialog>

      {/* ------------------------------ delete ------------------------------ */}
      <dialog
        ref={deleteRef}
        aria-labelledby={`delete-${subject.id}`}
        onClick={(e) => {
          if (e.target === deleteRef.current) deleteRef.current?.close();
        }}
        className={`${DIALOG_PANEL} w-[min(94vw,420px)]`}
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={`delete-${subject.id}`} className="text-[15px] font-semibold text-ink">
            Delete {subject.name}?
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Its {topicCount} {topicCount === 1 ? "topic" : "topics"} and the{" "}
            {formatMins(subject.minutesLogged)} of study time logged against it go with it, while
            its {subject.noteCount} {subject.noteCount === 1 ? "note stays" : "notes stay"} in
            Notes, unfiled.
          </p>
          {dialogError ? (
            <p role="alert" className="text-[12.5px] leading-snug text-flame">
              {dialogError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => deleteRef.current?.close()}>
              Keep it
            </Button>
            <Button variant="danger" onClick={onDelete} disabled={pending}>
              Delete subject
            </Button>
          </div>
        </div>
      </dialog>
    </Card>
  );
}
