"use client";

import * as React from "react";

export type Palette = "mono" | "colour";

const KEY = "study-tracker.code-palette";

/**
 * Which syntax palette the editors use, remembered across visits.
 *
 * `useSyncExternalStore` rather than state-plus-an-effect: localStorage is an
 * external store, and this is the hook built for reading one without a
 * hydration mismatch. The server snapshot is always "mono", the client reads
 * the real value on its first render, and subscribing to `storage` means
 * changing the palette in one tab updates any other tab already open.
 *
 * Every access is wrapped: Safari in private mode throws on localStorage rather
 * than returning null, and a thrown editor is worse than a forgotten preference.
 */

/**
 * Set when localStorage is unreadable or unwritable. Without it, a browser that
 * refuses storage would re-read the old value after every toggle and the button
 * would appear to do nothing — a preference that is merely forgotten next visit
 * is a far better failure than one that cannot be changed at all.
 */
let fallback: Palette | null = null;

function read(): Palette {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "colour" || stored === "mono") return stored;
  } catch {
    /* fall through to the in-memory value */
  }
  return fallback ?? "mono";
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Fires for writes from *other* tabs; same-tab writes notify directly.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePalette(): [Palette, (next: Palette) => void] {
  const palette = React.useSyncExternalStore(subscribe, read, () => "mono" as Palette);

  const update = React.useCallback((next: Palette) => {
    fallback = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* not persisted, but `fallback` keeps it for this session */
    }
    listeners.forEach((fn) => fn());
  }, []);

  return [palette, update];
}
