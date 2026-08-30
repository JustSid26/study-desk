"use client";

/**
 * The colour picker shared by "New subject" and "Recolour". Real <button>s, one
 * per hue, with the selection carried by an aria-pressed state AND a visible
 * tick — the ring alone would be colour-only signalling.
 */
import * as React from "react";

import { SUBJECT_COLORS } from "@/components/subject-color";

export function ColourSwatches({
  value,
  onChange,
  idPrefix,
}: {
  value: string;
  onChange: (color: string) => void;
  idPrefix?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Subject colour"
      className="flex flex-wrap gap-2"
      id={idPrefix ? `${idPrefix}-colours` : undefined}
    >
      {SUBJECT_COLORS.map((hex, i) => {
        const selected = hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            aria-label={`Colour ${i + 1}`}
            aria-pressed={selected}
            onClick={() => onChange(hex)}
            style={{ backgroundColor: hex }}
            className={[
              "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line transition-transform",
              selected ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "hover:scale-105",
            ].join(" ")}
          >
            {selected ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5 text-white"
              >
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
