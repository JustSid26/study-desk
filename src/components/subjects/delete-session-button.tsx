"use client";

import * as React from "react";

import { deleteSession } from "@/app/actions/subjects";

export function DeleteSessionButton({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = React.useTransition();

  return (
    <button
      type="button"
      aria-label={`Delete session: ${label}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await deleteSession(id);
        })
      }
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-flame-soft hover:text-flame disabled:opacity-50"
    >
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
    </button>
  );
}
