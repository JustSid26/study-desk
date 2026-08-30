"use client";

/**
 * Add / edit a class.
 *
 * One dialog, two jobs: the header's "Add a class" and every block on the grid
 * open the same form, with the edit case arriving as a prop rather than as a
 * second component. The trigger is a real `<button>` so the caller can style it
 * as a header action or stretch it across an entry block.
 *
 * Nothing here imports the database or the vault — the subject folders arrive
 * as plain props from the server.
 */

import * as React from "react";

import {
  Button,
  DIALOG_PANEL,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { saveEntry, deleteEntry } from "@/app/actions/timetable";
import { DAY_LABELS, minutesOf, type ClassItem, type SubjectOption } from "./bits";

interface FormState {
  title: string;
  weekday: string;
  startsAt: string;
  endsAt: string;
  location: string;
  subjectPath: string;
  note: string;
}

const blank = (weekday: number): FormState => ({
  title: "",
  weekday: String(weekday),
  startsAt: "09:00",
  endsAt: "10:00",
  location: "",
  subjectPath: "",
  note: "",
});

const fromEntry = (e: ClassItem): FormState => ({
  title: e.title,
  weekday: String(e.weekday),
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  location: e.location ?? "",
  subjectPath: e.subjectPath ?? "",
  note: e.note ?? "",
});

function ClassDialog({
  entry,
  subjects,
  defaultWeekday,
  open,
  onClose,
}: {
  entry: ClassItem | null;
  subjects: SubjectOption[];
  defaultWeekday: number;
  open: boolean;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [form, setForm] = React.useState<FormState>(
    entry ? fromEntry(entry) : blank(defaultWeekday),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, start] = React.useTransition();

  // Open and close through an effect so the panel never paints a frame of the
  // previous entry while state catches up.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setForm(entry ? fromEntry(entry) : blank(defaultWeekday));
      setError(null);
      setConfirming(false);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, entry, defaultWeekday]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const orderBad =
    !!form.startsAt && !!form.endsAt && minutesOf(form.endsAt) <= minutesOf(form.startsAt);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("What is the class called?");
      return;
    }
    if (orderBad) {
      setError("The class has to end after it starts.");
      return;
    }
    const fd = new FormData();
    if (entry) fd.set("id", entry.id);
    fd.set("title", form.title);
    fd.set("weekday", form.weekday);
    fd.set("startsAt", form.startsAt);
    fd.set("endsAt", form.endsAt);
    fd.set("location", form.location);
    fd.set("subjectPath", form.subjectPath);
    fd.set("note", form.note);

    start(async () => {
      const res = await saveEntry(fd);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  function remove() {
    if (!entry) return;
    setError(null);
    start(async () => {
      const res = await deleteEntry(entry.id);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  const headingId = "class-dialog-heading";

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      className={`${DIALOG_PANEL} w-[min(94vw,520px)]`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <div>
          <h2 id={headingId} className="text-[15px] font-semibold text-ink">
            {entry ? "Edit this class" : "Add a class"}
          </h2>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
            A class repeats every week on the day you pick.
          </p>
        </div>

        <Field label="Title">
          <Input
            name="title"
            required
            autoFocus
            maxLength={120}
            placeholder="Operating Systems lecture"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Day">
            <Select value={form.weekday} onChange={(e) => set("weekday", e.target.value)}>
              {DAY_LABELS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts">
            <Input
              type="time"
              required
              value={form.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <Input
              type="time"
              required
              aria-invalid={orderBad || undefined}
              value={form.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
            />
          </Field>
        </div>

        {orderBad ? (
          <p role="alert" className="text-[12px]">
            The class has to end after it starts.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location" hint="Optional — a room, a building, a link.">
            <Input
              maxLength={120}
              placeholder="LT-3"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
            />
          </Field>
          <Field
            label="Subject folder"
            hint={
              subjects.length
                ? "Links the class to its notes in the vault."
                : "You have no subject folders yet."
            }
          >
            <Select
              value={form.subjectPath}
              disabled={!subjects.length}
              onChange={(e) => set("subjectPath", e.target.value)}
            >
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.rel} value={s.rel}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Note" hint="Optional — what to bring, what it covers.">
          <Textarea
            rows={3}
            maxLength={5000}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-[12.5px]">
            {error}
          </p>
        ) : null}

        {confirming && entry ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <span className="text-[12.5px] text-ink-2">
              Remove {entry.title} from every week?
            </span>
            <span className="flex items-center gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button variant="danger" disabled={pending} onClick={remove}>
                {pending ? "Removing…" : "Remove"}
              </Button>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            {entry ? (
              <Button variant="danger" disabled={pending} onClick={() => setConfirming(true)}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              <Button variant="ghost" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending || orderBad}>
                {pending ? "Saving…" : entry ? "Save class" : "Add class"}
              </Button>
            </span>
          </div>
        )}
      </form>
    </dialog>
  );
}

/**
 * A button that opens the class form. The paint is entirely the caller's, so
 * the same component is the header action and the click target stretched over
 * an entry block on the grid.
 */
export function ClassTrigger({
  entry = null,
  subjects,
  defaultWeekday = 0,
  className,
  label,
  children,
}: {
  entry?: ClassItem | null;
  subjects: SubjectOption[];
  defaultWeekday?: number;
  className?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      {/* `label` already spells out the day, the time range and the room, which
          a short block has no space to print. It is the tooltip as well as the
          accessible name, so that detail is one hover away and not only
          reachable by screen reader. */}
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <ClassDialog
        entry={entry}
        subjects={subjects}
        defaultWeekday={defaultWeekday}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The header / empty-state action, wearing the standard Button look. */
export function AddClassButton({
  subjects,
  defaultWeekday = 0,
  variant = "primary",
  size = "md",
  children = "Add a class",
}: {
  subjects: SubjectOption[];
  defaultWeekday?: number;
  variant?: "primary" | "default";
  size?: "sm" | "md";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {children}
      </Button>
      <ClassDialog
        entry={null}
        subjects={subjects}
        defaultWeekday={defaultWeekday}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
