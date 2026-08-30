/**
 * Dashboard — a Server Component. Everything on this page is read straight from
 * SQLite at request time; only the two header actions cross into the client.
 *
 * The heatmap window is walked with `dayRange`/`addDays`, never by adding
 * 86_400_000ms, so the "active days" count doesn't drift a day at each DST
 * boundary and quietly disagree with the streak.
 */
import Link from "next/link";

import { getDashboard, getNotes, getRecentSessions } from "@/lib/queries";
import {
  addDays,
  dayRange,
  formatDay,
  formatFullDay,
  formatMins,
  relativeTime,
  today,
} from "@/lib/dates";
import { Heatmap, HeatmapKey } from "@/components/heatmap";
import { subjectColor } from "@/components/subject-color";
import { kindLabel } from "@/components/note-list";
import { LogProblemButton, LogSessionButton } from "@/components/log-dialogs";
import { DIFFICULTY_COLOR } from "@/app/leetcode/bits";
import {
  BarRow,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Empty,
  Meter,
  PageHeader,
  StatTile,
  linkButtonClass,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const WEEKS = 26;
const SUBJECT_ROWS = 5;
const NOTE_ROWS = 6;

const LINK_PRIMARY = linkButtonClass({ variant: "primary" });
const LINK_QUIET =
  "text-[12px] font-medium text-accent underline decoration-from-font underline-offset-2";

const CARD_TITLE = "text-[13.5px] font-semibold text-ink";

/* -------------------------------- copy ---------------------------------- */

function todayLine(minutes: number, goal: number): string {
  if (minutes <= 0) return "Nothing logged yet today";
  if (goal > 0 && minutes >= goal) return `Goal met — ${formatMins(minutes)} logged`;
  if (goal <= 0) return `${formatMins(minutes)} logged`;
  return `${formatMins(goal - minutes)} to go to hit today's goal`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/* ------------------------------ note icons ------------------------------- */

const ICON = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function NoteKindIcon({ kind }: { kind: string }) {
  if (kind === "image") {
    return (
      <svg {...ICON} aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m4 17 5-5 4 4 3-2 4 4" />
      </svg>
    );
  }
  if (kind === "pdf" || kind === "docx" || kind === "doc") {
    return (
      <svg {...ICON} aria-hidden="true">
        <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v5h5" />
        <path d="M9 14h6" />
      </svg>
    );
  }
  if (kind === "file") {
    return (
      <svg {...ICON} aria-hidden="true">
        <path d="M20 12.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.5" />
        <path d="M14 3h6v6" />
      </svg>
    );
  }
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M5 4h14v16H5z" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
    </svg>
  );
}

/* --------------------------------- page ---------------------------------- */

export default async function DashboardPage() {
  const [dash, notes, recent] = await Promise.all([
    getDashboard(),
    getNotes(),
    getRecentSessions(1),
  ]);

  const {
    settings,
    activity,
    activeDays,
    streak,
    best,
    todayActivity,
    weekMinutes,
    weekProblems,
    subjects,
    problems,
    byDifficulty,
    noteCount,
    revisitQueue,
  } = dash;

  const dailyGoal = settings.dailyMins > 0 ? settings.dailyMins : 0;
  const weeklyGoal = dailyGoal * 7;
  const weekPct = weeklyGoal > 0 ? Math.round((weekMinutes / weeklyGoal) * 100) : 0;

  // Calendar-correct walk over the heatmap's own window.
  const windowDays = dayRange(addDays(new Date(), -(WEEKS * 7 - 1)), new Date());
  let windowActive = 0;
  let windowMinutes = 0;
  for (const day of windowDays) {
    if (activeDays.has(day)) windowActive += 1;
    windowMinutes += activity.get(day)?.minutes ?? 0;
  }

  const lastSession = recent[0];
  const shownSubjects = subjects.slice(0, SUBJECT_ROWS);
  const recentNotes = notes.slice(0, NOTE_ROWS);
  const totalSolved = problems.length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`${formatFullDay(today())} · ${todayLine(todayActivity.minutes, dailyGoal)}`}
      >
        <LogSessionButton subjects={subjects.map((s) => ({ id: s.id, name: s.name }))} />
        <LogProblemButton />
      </PageHeader>

      {/* ------------------------------ stats ------------------------------ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Current streak"
          value={
            <>
              {streak}
              <span className="ml-1 text-[14px] font-semibold text-ink-3">
                {plural(streak, "day", "days")}
              </span>
            </>
          }
          sub={best > 0 ? `Best run ${best} ${plural(best, "day", "days")}` : "No run yet"}
        />
        <StatTile
          label="This week"
          value={formatMins(weekMinutes)}
          sub={
            weeklyGoal > 0
              ? `${weekPct}% of the ${formatMins(weeklyGoal)} weekly goal`
              : "No daily goal set"
          }
        />
        <StatTile
          label="Problems solved"
          value={totalSolved}
          sub={`${weekProblems} in the last 7 days`}
        />
        <StatTile
          label="Notes kept"
          value={noteCount}
          sub={
            recentNotes.length
              ? `Last updated ${relativeTime(recentNotes[0].updatedAt)}`
              : "Nothing written yet"
          }
        />
      </div>

      {/* ----------------------------- activity ---------------------------- */}
      <Card>
        <CardHeader>
          <h2 className={CARD_TITLE}>Activity</h2>
          <HeatmapKey />
        </CardHeader>
        <CardBody>
          <Heatmap activity={activity} goalMins={dailyGoal || 60} weeks={WEEKS} />
          <p className="mt-3 text-[12px] leading-snug text-ink-3">
            {windowActive} active {plural(windowActive, "day", "days")} in the last {WEEKS}{" "}
            weeks · {formatMins(windowMinutes)} logged
            {lastSession
              ? ` · last session ${formatMins(lastSession.minutes)}${
                  lastSession.subjectName ? ` on ${lastSession.subjectName}` : ""
                }, ${formatDay(lastSession.day)}`
              : ""}
          </p>
        </CardBody>
      </Card>

      {/* --------------------- subjects + leetcode ------------------------- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className={CARD_TITLE}>Subjects</h2>
            {subjects.length > SUBJECT_ROWS ? (
              <Link href="/subjects" className={LINK_QUIET}>
                See all {subjects.length}
              </Link>
            ) : null}
          </CardHeader>
          {shownSubjects.length ? (
            <CardBody className="py-2">
              <ul className="flex flex-col">
                {shownSubjects.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-1.5 border-b border-line-soft py-2.5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
                          style={{ backgroundColor: subjectColor(s.color) }}
                        />
                        <span className="truncate text-[13.5px] font-medium text-ink">
                          {s.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                        {s.counts.solid} of {s.topics.length}{" "}
                        {plural(s.topics.length, "topic", "topics")} solid
                      </span>
                    </div>
                    <Meter value={s.progress} />
                  </li>
                ))}
              </ul>
            </CardBody>
          ) : (
            <Empty
              title="No subjects yet"
              action={
                <Link href="/subjects" className={LINK_PRIMARY}>
                  Add a subject
                </Link>
              }
            >
              A subject holds its topics, its notes and the time you put into it. Add the
              first one to start tracking mastery.
            </Empty>
          )}
        </Card>

        <Card>
          <CardHeader>
            <h2 className={CARD_TITLE}>LeetCode</h2>
            <Link href="/leetcode" className={LINK_QUIET}>
              Open
            </Link>
          </CardHeader>
          {totalSolved ? (
            <CardBody>
              <div className="flex items-baseline gap-2">
                <span className="text-[34px] font-bold leading-none tabular-nums tracking-[-0.025em] text-ink">
                  {totalSolved}
                </span>
                <span className="text-[12px] text-ink-3">solved, all time</span>
              </div>

              <div className="mt-4 flex flex-col gap-2.5">
                <BarRow
                  label="Easy"
                  value={byDifficulty.Easy}
                  max={settings.goalEasy}
                  color={DIFFICULTY_COLOR.Easy}
                  valueText={`${byDifficulty.Easy} / ${settings.goalEasy}`}
                />
                <BarRow
                  label="Medium"
                  value={byDifficulty.Medium}
                  max={settings.goalMedium}
                  color={DIFFICULTY_COLOR.Medium}
                  valueText={`${byDifficulty.Medium} / ${settings.goalMedium}`}
                />
                <BarRow
                  label="Hard"
                  value={byDifficulty.Hard}
                  max={settings.goalHard}
                  color={DIFFICULTY_COLOR.Hard}
                  valueText={`${byDifficulty.Hard} / ${settings.goalHard}`}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line-soft pt-3">
                <span className="text-[12.5px] text-ink-2">
                  {revisitQueue.length
                    ? `${revisitQueue.length} ${plural(
                        revisitQueue.length,
                        "problem",
                        "problems",
                      )} waiting for a revisit`
                    : "Nothing waiting for a revisit"}
                </span>
                <Link href="/leetcode" className={LINK_QUIET}>
                  Go to the revisit queue
                </Link>
              </div>
            </CardBody>
          ) : (
            <Empty
              title="No problems logged"
              action={
                <Link href="/setup" className={LINK_PRIMARY}>
                  Go to Setup
                </Link>
              }
            >
              Log a solve by hand, or connect your LeetCode username in Setup to import
              everything you have already done.
            </Empty>
          )}
        </Card>
      </div>

      {/* ------------------------------ recent ----------------------------- */}
      <Card>
        <CardHeader>
          <h2 className={CARD_TITLE}>Recent</h2>
          {notes.length > NOTE_ROWS ? (
            <Link href="/notes" className={LINK_QUIET}>
              See all {notes.length}
            </Link>
          ) : null}
        </CardHeader>
        {recentNotes.length ? (
          <ul className="flex flex-col">
            {recentNotes.map((n) => (
              <li key={n.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/notes?note=${encodeURIComponent(n.id)}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span className="shrink-0 text-ink-3" title={kindLabel(n.kind)}>
                    <NoteKindIcon kind={n.kind} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                    {n.title.trim() || "Untitled note"}
                  </span>
                  {n.subjectName ? (
                    <Chip dot={subjectColor(n.subjectColor)} className="hidden shrink-0 sm:inline-flex">
                      {n.subjectName}
                    </Chip>
                  ) : null}
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                    {relativeTime(n.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title="No notes yet"
            action={
              <Link href="/notes" className={LINK_PRIMARY}>
                Write a note
              </Link>
            }
          >
            Notes are where the thinking lands — paste a proof, drop in a PDF, or keep a
            list of what tripped you up.
          </Empty>
        )}
      </Card>
    </>
  );
}
