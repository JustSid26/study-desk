"use client";

/**
 * The LeetCode card.
 *
 * Client-side because the sync is a long POST to /api/sync — a full import
 * pages through every solved problem 100 at a time with a polite delay between
 * pages, so 30+ seconds is normal. A server-action form post would leave the
 * page looking frozen for all of it; here the button can go disabled and say
 * what it is doing.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button, Card, CardBody, CardHeader, Chip, Field, Input } from "@/components/ui";
import { refreshCatalogue, saveLeetCodeUsername } from "@/app/actions/settings";

interface SyncResult {
  mode: "public" | "session";
  username: string;
  imported: number;
  updated: number;
  skipped: number;
  totals: { total: number; Easy: number; Medium: number; Hard: number };
  catalogueRows: number;
  limitation?: string;
}

type SyncResponse =
  | { ok: true; result: SyncResult; enriched: number }
  | { ok: false; error: string; kind?: string };

export function LeetCodeCard({
  username,
  signedIn,
  sessionUser,
  cookiePresent,
  lastError,
  lastSyncText,
  lastSyncMode,
  catalogueCount,
  catalogueSyncedText,
}: {
  username: string;
  signedIn: boolean;
  sessionUser: string | null;
  cookiePresent: boolean;
  lastError: string | null;
  lastSyncText: string | null;
  lastSyncMode: "public" | "session" | null;
  catalogueCount: number | null;
  catalogueSyncedText: string | null;
}) {
  const router = useRouter();

  const [name, setName] = React.useState(username);
  const [savedName, setSavedName] = React.useState(username);
  const [nameNote, setNameNote] = React.useState<string | null>(null);

  const [syncing, setSyncing] = React.useState(false);
  const [result, setResult] = React.useState<SyncResult | null>(null);
  const [enriched, setEnriched] = React.useState(0);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const [catBusy, setCatBusy] = React.useState(false);
  const [catNote, setCatNote] = React.useState<string | null>(null);
  const [catError, setCatError] = React.useState<string | null>(null);

  async function commitUsername() {
    const value = name.trim();
    if (value === savedName) return;
    if (!value) {
      setNameNote(null);
      return;
    }
    const res = await saveLeetCodeUsername(value);
    if (res.ok) {
      setSavedName(res.username);
      setName(res.username);
      setNameNote("Saved.");
      router.refresh();
    } else {
      setNameNote(res.error);
    }
  }

  async function runSync() {
    const value = name.trim();
    if (!value) {
      setSyncError("Add your LeetCode username first — it's the name in your profile URL.");
      return;
    }

    setSyncing(true);
    setSyncError(null);
    setResult(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: value }),
      });

      let body: SyncResponse;
      try {
        body = (await res.json()) as SyncResponse;
      } catch {
        setSyncError("LeetCode's reply didn't come back as JSON. Try again in a minute.");
        return;
      }

      if (body.ok) {
        setResult(body.result);
        setEnriched(body.enriched);
        setSavedName(body.result.username);
        router.refresh();
      } else {
        setSyncError(body.error);
        router.refresh();
      }
    } catch {
      setSyncError("Couldn't reach the sync endpoint. Is the dev server still running?");
    } finally {
      setSyncing(false);
    }
  }

  async function runCatalogue() {
    setCatBusy(true);
    setCatNote(null);
    setCatError(null);
    try {
      const res = await refreshCatalogue();
      if (res.ok) {
        setCatNote(`Cached ${res.count.toLocaleString()} problems.`);
        router.refresh();
      } else {
        setCatError(res.error);
      }
    } finally {
      setCatBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">LeetCode</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            Pull your solves in so the heatmap, the difficulty bars and the revisit queue have
            something real to work with.
          </p>
        </div>
        <Chip dot={signedIn ? "var(--color-accent)" : "var(--color-medium)"}>
          {signedIn ? "Full history" : "Username only"}
        </Chip>
      </CardHeader>

      <CardBody className="flex flex-col gap-5">
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            label="LeetCode username"
            hint="The name in your profile URL — leetcode.com/u/<name>, not your email."
            className="sm:flex-1"
          >
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameNote(null);
              }}
              onBlur={commitUsername}
              placeholder="your-username"
              autoComplete="off"
              spellCheck={false}
              disabled={syncing}
            />
          </Field>
          <Button
            variant="primary"
            onClick={runSync}
            disabled={syncing || !name.trim()}
            className="sm:mb-[26px]"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>

        {nameNote ? (
          <p className="-mt-3 text-[12px] leading-snug text-ink-2" aria-live="polite">
            {nameNote}
          </p>
        ) : null}

        {/* ------------------------------ status ---------------------------- */}
        <div className="rounded-[9px] border border-line-soft bg-surface-2 px-3 py-2.5">
          <p className="text-[13px] font-medium leading-snug text-ink">
            {signedIn
              ? `Signed in as ${(sessionUser ?? savedName) || "your account"} — full history available`
              : "Username only"}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink-2">
            {signedIn
              ? "Your session cookie is working, so a sync can list every problem you have ever solved."
              : cookiePresent
                ? "A LEETCODE_SESSION value is set but LeetCode didn't accept it — it has most likely expired. Paste a fresh one and restart the dev server."
                : "No session cookie is set, so a sync gets what your public profile exposes and nothing more."}
          </p>
          {lastSyncText ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
              Last sync {lastSyncText}
              {lastSyncMode ? ` (${lastSyncMode === "session" ? "full history" : "public profile"})` : ""}.
            </p>
          ) : (
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">No sync yet.</p>
          )}
        </div>

        {/* --------------------------- live sync state ---------------------- */}
        <div aria-live="polite" className="flex flex-col gap-3">
          {syncing ? (
            <div className="rounded-[9px] border border-line-soft bg-surface-3 px-3 py-2.5">
              <p className="text-[13px] font-medium leading-snug text-ink">
                Talking to leetcode.com…
              </p>
              <p className="mt-1 text-[12px] leading-snug text-ink-2">
                A full import walks your solved list 100 problems at a time, pausing between pages
                so LeetCode doesn&apos;t rate-limit us. Thirty seconds or more is normal. Keep this
                tab open.
              </p>
            </div>
          ) : null}

          {syncError ? (
            <div role="alert" className="rounded-[9px] border border-line bg-flame-soft px-3 py-2.5">
              <p className="lbl text-ink">Sync failed</p>
              <p className="mt-1 text-[13px] leading-snug text-ink">{syncError}</p>
            </div>
          ) : null}

          {result ? (
            <div className="rounded-[9px] border border-line-soft bg-surface-2 px-3 py-3">
              <p className="text-[13px] font-medium leading-snug text-ink">
                Synced {result.username} —{" "}
                {result.mode === "session" ? "full history" : "public profile"}.
              </p>

              <dl className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="Imported" value={result.imported} />
                <Stat label="Updated" value={result.updated} />
                <Stat label="Skipped" value={result.skipped} />
                <Stat label="Total" value={result.totals.total} />
                <Stat label="Easy" value={result.totals.Easy} />
                <Stat label="Medium" value={result.totals.Medium} />
              </dl>
              <dl className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="Hard" value={result.totals.Hard} />
                {enriched ? <Stat label="Filled in" value={enriched} /> : null}
                {result.catalogueRows ? (
                  <Stat label="Catalogue" value={result.catalogueRows} />
                ) : null}
              </dl>

              {result.limitation ? (
                <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[12px] leading-relaxed text-ink-2">
                  {result.limitation}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {lastError && !result && !syncError ? (
          <div role="alert" className="rounded-[9px] border border-line bg-flame-soft px-3 py-2.5">
            <p className="lbl text-ink">Last sync failed</p>
            <p className="mt-1 text-[13px] leading-snug text-ink">{lastError}</p>
          </div>
        ) : null}

        {/* ---------------------------- what you get ------------------------ */}
        <div>
          <h3 className="text-[13px] font-semibold text-ink">What each mode gets you</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div
              className={`rounded-[9px] border p-3 ${
                signedIn ? "border-line-soft bg-surface" : "border-accent bg-accent-soft"
              }`}
            >
              <div className="lbl">Username alone gets you</div>
              <ul className="mt-2 list-disc pl-4 text-[12.5px] leading-relaxed text-ink-2 marker:text-ink-3">
                <li>Solved totals by difficulty</li>
                <li>Per-topic counts</li>
                <li>Your submission calendar</li>
                <li>Your ~20 most recent solves</li>
              </ul>
            </div>
            <div
              className={`rounded-[9px] border p-3 ${
                signedIn ? "border-accent bg-accent-soft" : "border-line-soft bg-surface"
              }`}
            >
              <div className="lbl">Adding your session cookie also gets you</div>
              <ul className="mt-2 list-disc pl-4 text-[12.5px] leading-relaxed text-ink-2 marker:text-ink-3">
                <li>Every problem you have ever solved</li>
              </ul>
            </div>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
            The gap exists because LeetCode&apos;s public profile deliberately does not expose a
            full solved list — only your own signed-in session can ask for one.
          </p>
        </div>

        {/* --------------------------- cookie how-to ------------------------ */}
        <details className="group rounded-[9px] border border-line-soft bg-surface-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-ink-3 transition-transform group-open:rotate-90"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            How to add my session cookie
          </summary>

          <div className="border-t border-line-soft px-3 py-3">
            <ol className="list-decimal pl-4 text-[12.5px] leading-relaxed text-ink-2 marker:text-ink-3">
              <li>Sign in to leetcode.com in your browser.</li>
              <li>
                Open DevTools and go to <span className="text-ink">Application</span> →{" "}
                <span className="text-ink">Cookies</span> →{" "}
                <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px] text-ink">
                  https://leetcode.com
                </code>
                .
              </li>
              <li>
                Copy the value of{" "}
                <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px] text-ink">
                  LEETCODE_SESSION
                </code>{" "}
                — and of{" "}
                <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px] text-ink">
                  csrftoken
                </code>{" "}
                while you are there.
              </li>
              <li>
                Paste them into{" "}
                <code className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px] text-ink">
                  .env.local
                </code>{" "}
                at the root of this project:
                <pre className="mt-1.5 overflow-x-auto rounded-[7px] bg-surface-3 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink">
{`LEETCODE_SESSION=<the long value>
LEETCODE_CSRF=<the csrftoken value>`}
                </pre>
              </li>
              <li>Restart the dev server so Next.js picks the file up, then sync again.</li>
            </ol>

            <p className="mt-3 border-t border-line-soft pt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              That cookie stays on this machine in a file git ignores. It is only ever sent to
              leetcode.com, from the server, never to anyone else. It expires roughly every month,
              and when it does the sync quietly drops back to username-only — repeat these steps to
              get the full history back.
            </p>
          </div>
        </details>

        {/* ---------------------------- catalogue --------------------------- */}
        <div className="border-t border-line-soft pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink">Refresh the problem catalogue</h3>
              <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">
                Caches all ~4,000 LeetCode problems locally, so logging a problem can autocomplete
                its number, difficulty and topic tags instead of you typing them. No cookie needed;
                it takes a minute or so.
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
                {catalogueCount
                  ? `${catalogueCount.toLocaleString()} problems cached${
                      catalogueSyncedText ? `, last refreshed ${catalogueSyncedText}` : ""
                    }.`
                  : "Nothing cached yet."}
              </p>
            </div>
            <Button onClick={runCatalogue} disabled={catBusy}>
              {catBusy ? "Fetching…" : "Refresh catalogue"}
            </Button>
          </div>

          <div aria-live="polite">
            {catBusy ? (
              <p className="mt-2 text-[12px] leading-snug text-ink-2">
                Paging through the catalogue. This runs one page at a time on purpose — leave it be.
              </p>
            ) : null}
            {catNote ? (
              <p className="mt-2 text-[12px] leading-snug text-ink-2">{catNote}</p>
            ) : null}
            {catError ? (
              <p role="alert" className="mt-2 text-[12px] leading-snug">
                {catError}
              </p>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="lbl">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] font-medium tabular-nums text-ink">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
