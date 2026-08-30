"use client";

/**
 * New subject, in one pass: name, colour, an optional weekly minute goal, and a
 * "one per line" textarea that seeds every topic at once — typing a syllabus in
 * is the whole point, so it must not cost one round trip per line.
 */
import * as React from "react";

import { createSubject } from "@/app/actions/subjects";
import { SUBJECT_COLORS } from "@/components/subject-color";
import { Button, DIALOG_PANEL, Field, Input, Textarea } from "@/components/ui";
import { ColourSwatches } from "@/components/subjects/colour-swatches";

export function NewSubjectButton({
  variant = "primary",
  size = "md",
  label = "New subject",
}: {
  variant?: "primary" | "default" | "ghost";
  size?: "sm" | "md";
  label?: string;
}) {
  // Rendered twice on the subjects page (header and empty state), so the ids
  // have to be per-instance rather than literals.
  const titleId = React.useId();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const [color, setColor] = React.useState<string>(SUBJECT_COLORS[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function open() {
    setError(null);
    dialogRef.current?.showModal();
    // Autofocus after the dialog is actually in the top layer.
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function close() {
    dialogRef.current?.close();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("color", color);
    setError(null);
    startTransition(async () => {
      const res = await createSubject(fd);
      if (res.ok) {
        form.reset();
        setColor(SUBJECT_COLORS[0]);
        close();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={open}>
        {label}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setError(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className={`${DIALOG_PANEL} w-[min(94vw,460px)]`}
      >
        <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
          <h2 id={titleId} className="text-[15px] font-semibold text-ink">
            New subject
          </h2>

          <Field label="Name">
            <Input
              ref={nameRef}
              name="name"
              required
              maxLength={80}
              placeholder="Organic chemistry"
              autoComplete="off"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="lbl">Colour</span>
            <ColourSwatches value={color} onChange={setColor} idPrefix={titleId} />
          </div>

          <Field label="Weekly goal" hint="Optional. Minutes a week you want to put in.">
            <Input
              name="goalMins"
              type="number"
              min={1}
              max={10080}
              step={5}
              inputMode="numeric"
              placeholder="300"
              className="tabular-nums"
            />
          </Field>

          <Field
            label="Topics, one per line"
            hint="Optional. Paste a syllabus and every line becomes a topic."
          >
            <Textarea
              name="topics"
              rows={5}
              placeholder={"Alkenes\nStereochemistry\nReaction mechanisms"}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-[12.5px] leading-snug text-flame">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving" : "Create subject"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
