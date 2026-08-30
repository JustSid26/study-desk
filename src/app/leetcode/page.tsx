/**
 * LeetCode — the solve log, the goals it feeds, and the queue of things going
 * stale. A Server Component: every number is computed on the server from the
 * database, and only the filter row, the revisit buttons and the log dialog
 * cross over to the client.
 */
import Link from "next/link";

import {
  BarRow,
  Card,
  CardBody,
  CardHeader,
  Empty,
  LinkButton,
  PageHeader,
  StatTile,
} from "@/components/ui";
import { LogProblemButton } from "@/components/log-dialogs";
import { getDashboard, getProblems, getTagCounts } from "@/lib/queries";
import { addDays, currentStreak, dayRange, relativeTime } from "@/lib/dates";
import type { Difficulty } from "@/db/schema";

import { DIFFICULTY_COLOR, DifficultyChip, type ProblemItem } from "./bits";
import { ProblemsTable } from "./problems-table";
import { ReviewedButton } from "./reviewed-button";

export const dynamic = "force-dynamic";

const TOPIC_LIMIT = 12;
const REVISIT_LIMIT = 8;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export default async function LeetCodePage() {
  const [problems, tagCounts, dashboard] = await Promise.all([
    getProblems(),
    getTagCounts(),
    getDashboard(),
  ]);

  const { settings, byDifficulty, revisitQueue } = dashboard;

  const total = problems.length;

  // A week is seven calendar days ending today. Walking the range through
  // `dayRange` keeps it seven days across a DST change, which adding
  // 86_400_000ms would not.
  const week = new Set(dayRange(addDays(new Date(), -6), new Date()));
  const weekCount = problems.filter((p) => week.has(p.solvedDay)).length;
  const weekTarget = (settings.dailyProblems ?? 0) * 7;

  const solvingStreak = currentStreak(new Set(problems.map((p) => p.solvedDay)));

  const goals: Record<Difficulty, number> = {
    Easy: settings.goalEasy,
    Medium: settings.goalMedium,
    Hard: settings.goalHard,
  };
  const goalTotal = goals.Easy + goals.Medium + goals.Hard;

  const topics = tagCounts.filter((t) => t.count > 0);
  const shownTopics = topics.slice(0, TOPIC_LIMIT);
  const hiddenTopics = topics.length - shownTopics.length;
  const topicMax = shownTopics[0]?.count ?? 1;

  const queue = revisitQueue.slice(0, REVISIT_LIMIT);

  const syncedAt = settings.lcSyncedAt;
  const username = settings.leetcodeUsername;
  const remoteTotal = settings.lcTotalSolved ?? 0;
  const missing =
    settings.lcSyncMode === "public" && remoteTotal > total ? remoteTotal : null;

  return (
    <>
      <PageHeader
        title="LeetCode"
        sub={
          <>
            <span>
              {total} solved · {weekCount} this week
            </span>
            {syncedAt && username ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>
                  Synced from {username} {relativeTime(syncedAt)}
                </span>
              </>
            ) : null}
            {missing !== null ? (
              <span className="mt-1 block text-ink-3">
                LeetCode says you&rsquo;ve solved {missing}; {total} are imported here —
                add your session cookie in Setup to import the rest.
              </span>
            ) : null}
          </>
        }
      >
        <LogProblemButton />
        <LinkButton href="/setup">Sync from LeetCode</LinkButton>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Total solved"
          value={total}
          sub={`${byDifficulty.Easy} easy · ${byDifficulty.Medium} medium · ${byDifficulty.Hard} hard`}
        />
        <StatTile
          label="Last 7 days"
          value={weekCount}
          sub={weekTarget > 0 ? `Target ${weekTarget}` : "No weekly target set"}
        />
        <StatTile
          label="Solving streak"
          value={solvingStreak}
          sub={`${plural(solvingStreak, "day")} in a row with a solve`}
        />
        <StatTile
          label="Revisit queue"
          value={revisitQueue.length}
          sub={
            revisitQueue.length
              ? `${plural(revisitQueue.length, "problem")} due`
              : "Nothing due"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-[15px] font-semibold text-ink">Progress by difficulty</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {(["Easy", "Medium", "Hard"] as const).map((d) => (
              <BarRow
                key={d}
                label={d}
                value={byDifficulty[d]}
                max={goals[d]}
                color={DIFFICULTY_COLOR[d]}
                valueText={`${byDifficulty[d]} / ${goals[d]}`}
              />
            ))}
            <p className="text-[12px] leading-snug text-ink-3">
              {total} of {goalTotal} toward your difficulty goals. Change the targets in
              Setup.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-[15px] font-semibold text-ink">Topics</h2>
            <span className="lbl">
              {topics.length} {plural(topics.length, "tag")}
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {shownTopics.length ? (
              <>
                {shownTopics.map((t) => (
                  <BarRow
                    key={t.tag}
                    label={t.tag}
                    value={t.count}
                    max={topicMax}
                    valueText={t.count}
                  />
                ))}
                {hiddenTopics > 0 ? (
                  <p className="text-[12px] leading-snug text-ink-3">
                    {hiddenTopics} more {plural(hiddenTopics, "tag")} with fewer solves
                    are not shown. All of them are in the table below.
                  </p>
                ) : null}
              </>
            ) : (
              <Empty title="No topics yet">
                Topics arrive with a LeetCode sync, or you can add them yourself when you
                log a problem.
              </Empty>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-[15px] font-semibold text-ink">Revisit queue</h2>
          <span className="lbl">
            {revisitQueue.length} {plural(revisitQueue.length, "problem")}
          </span>
        </CardHeader>
        {queue.length ? (
          <ul className="divide-y divide-line-soft">
            {queue.map(({ problem, reason }) => (
              <li
                key={problem.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[13.5px] font-medium text-ink">
                    {problem.number ? `${problem.number}. ` : ""}
                    {problem.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <DifficultyChip difficulty={problem.difficulty} />
                    <span className="text-[12px] text-ink-3">{reason}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ReviewedButton id={problem.id} title={problem.title} />
                  {problem.url ? (
                    <LinkButton
                      size="sm"
                      href={problem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${problem.title} on LeetCode`}
                    >
                      Open
                    </LinkButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nothing due">
            Nothing has gone stale and nothing is flagged. Flag a problem as
            &ldquo;revisit&rdquo; when a solve felt shaky and it will show up here.
          </Empty>
        )}
        {revisitQueue.length > queue.length ? (
          <p className="border-t border-line-soft px-4 py-2.5 text-[12px] text-ink-3">
            {revisitQueue.length - queue.length} more due. Filter the table below by
            status to see them all.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-[15px] font-semibold text-ink">All problems</h2>
          <Link
            href="/setup"
            className="text-[12.5px] font-medium text-accent underline underline-offset-2"
          >
            Sync settings
          </Link>
        </CardHeader>
        <CardBody>
          <ProblemsTable problems={problems as ProblemItem[]} />
        </CardBody>
      </Card>
    </>
  );
}
