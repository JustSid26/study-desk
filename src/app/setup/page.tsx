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
import { getSettings } from "@/lib/sync";

import { LeetCodeCard } from "./leetcode-card";
import { GoalsCard } from "./goals-card";
import { DataCard } from "./data-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Setup — Study Tracker",
  description: "Connect LeetCode, set your targets, and see where your data lives.",
};

export default async function SetupPage() {
  const settings = await getSettings();
  const creds = envCredentials();
  const session = await checkSession(creds);

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
          dailyMins: settings.dailyMins,
          dailyProblems: settings.dailyProblems,
          goalEasy: settings.goalEasy,
          goalMedium: settings.goalMedium,
          goalHard: settings.goalHard,
          revisitDays: settings.revisitDays,
        }}
      />

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
              <li>Drop a file anywhere on a page to turn it into a note.</li>
              <li>Paste a screenshot anywhere to do the same without saving it first.</li>
            </ul>
          </div>
          <p className="text-ink-3">
            Storage: a SQLite file at{" "}
            <code className="font-mono text-[11.5px]">data/study.db</code> plus{" "}
            <code className="font-mono text-[11.5px]">data/uploads/</code>, on this machine, not
            synced anywhere.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
