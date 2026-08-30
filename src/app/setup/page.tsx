/**
 * Setup.
 *
 * Server-rendered because the connection status is a live call to LeetCode:
 * a cached "signed in" badge next to an expired cookie is worse than no badge
 * at all, so this page is never cached.
 */
import type { Metadata } from "next";

import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui";
import { relativeTime } from "@/lib/dates";
import { checkSession, envCredentials, hasSession } from "@/lib/leetcode";
import { toolchainStatus } from "@/lib/runner";
import { getSettings } from "@/lib/sync";

import { LeetCodeCard } from "./leetcode-card";
import { GoalsCard } from "./goals-card";
import { DataCard } from "./data-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Setup — Study Tracker",
  description: "Connect LeetCode, set your targets, and see where your data lives.",
};

/** What each practice language needs on PATH, and how to get it. */
const TOOLCHAIN = [
  {
    lang: "java" as const,
    label: "Java",
    command: "javac",
    fix: "Install a JDK, then restart the app.",
  },
  {
    lang: "python" as const,
    label: "Python",
    command: "python3",
    fix: "Install Python 3, then restart the app.",
  },
];

export default async function SetupPage() {
  const settings = await getSettings();
  const creds = envCredentials();
  // Probed here rather than cached: a JDK installed since the last page load
  // should show up on this one, and a missing javac must never read as present.
  const [session, toolchain] = await Promise.all([checkSession(creds), toolchainStatus()]);

  return (
    <>
      <PageHeader
        title="Setup"
        sub="Where your LeetCode history comes from, what you're aiming at, and where all of it is stored."
      />

      <LeetCodeCard
        username={settings.leetcodeUsername ?? ""}
        signedIn={session.valid}
        sessionUser={session.username}
        cookiePresent={hasSession(creds)}
        lastError={settings.lcLastError ?? null}
        lastSyncText={settings.lcSyncedAt ? relativeTime(settings.lcSyncedAt) : null}
        lastSyncMode={settings.lcSyncMode ?? null}
        catalogueCount={settings.catalogueCount ?? null}
        catalogueSyncedText={
          settings.catalogueSyncedAt ? relativeTime(settings.catalogueSyncedAt) : null
        }
      />

      <GoalsCard
        initial={{
          dailyProblems: settings.dailyProblems,
          goalEasy: settings.goalEasy,
          goalMedium: settings.goalMedium,
          goalHard: settings.goalHard,
          revisitDays: settings.revisitDays,
        }}
      />

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Practice</h2>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
              Practice runs your code with the compilers already on this machine. A language
              that isn&rsquo;t installed can still be written and saved — only Run is off.
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {TOOLCHAIN.map(({ lang, label, command, fix }) => {
            const { available, version } = toolchain[lang];
            return (
              <div
                key={lang}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-soft pb-2.5 last:border-0 last:pb-0"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[13px] font-medium text-ink">{label}</span>
                  <code className="font-mono text-[11.5px] text-ink-3">{command}</code>
                </div>
                <span
                  className={`min-w-0 font-mono text-[11.5px] ${
                    available ? "text-ink-2" : "text-ink"
                  }`}
                >
                  {available ? version || "found on PATH" : `not found — ${fix}`}
                </span>
              </div>
            );
          })}
          <p className="text-[11.5px] leading-snug text-ink-3">
            Files live at <code className="font-mono text-[11px]">practicecode/</code> in the
            project, so the same file opens in your own editor.
          </p>
        </CardBody>
      </Card>

      <DataCard />

      <Card>
        <CardHeader>
          <h2 className="text-[15px] font-semibold text-ink">About</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-2">
          <p>
            Study Tracker keeps your notes, your subject mastery and your LeetCode progress in one
            place, so the thing you studied and the problem you solved because of it sit next to
            each other instead of in two apps. It runs entirely on your own machine.
          </p>
          <div>
            <div className="lbl">Shortcuts</div>
            <ul className="mt-1.5 list-disc pl-4 marker:text-ink-3">
              <li>Drop a file onto a folder in Subjects to file it there as a note.</li>
              <li>Paste a screenshot into the same pane to do it without saving the file first.</li>
            </ul>
          </div>
          <p className="text-ink-3">
            Storage: a SQLite file at{" "}
            <code className="font-mono text-[11.5px]">data/study.db</code> plus the notes vault at{" "}
            <code className="font-mono text-[11.5px]">data/subjects/</code>, on this machine, not
            synced anywhere.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
