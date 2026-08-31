"use client";

import * as React from "react";

/**
 * Collapse the rail to icons.
 *
 * The state lives on `<html data-rail>` rather than in React, because the grid
 * that sizes the rail is in the root layout — a Server Component. Driving it
 * from an attribute keeps the layout on the server and means the CSS does the
 * resizing, with no prop threaded through every page.
 *
 * `layout.tsx` sets the same attribute from an inline script before first
 * paint, so a collapsed rail never flashes open on load.
 */

const KEY = "study-tracker.rail";

function apply(collapsed: boolean) {
  document.documentElement.setAttribute("data-rail", collapsed ? "collapsed" : "open");
}

/**
 * The attribute IS the state, so it is read as an external store rather than
 * mirrored into React. A MutationObserver keeps every toggle on the page in
 * step, and the server snapshot matches the markup the server actually sent.
 */
function subscribe(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rail"] });
  return () => obs.disconnect();
}

const isCollapsed = () =>
  document.documentElement.getAttribute("data-rail") === "collapsed";

export function RailToggle() {
  const collapsed = React.useSyncExternalStore(subscribe, isCollapsed, () => false);

  const toggle = () => {
    const next = !collapsed;
    apply(next);
    try {
      window.localStorage.setItem(KEY, next ? "collapsed" : "open");
    } catch {
      /* not remembered next visit, but it still applies now */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
      title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
      aria-expanded={!collapsed}
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}
