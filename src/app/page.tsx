/**
 * Dashboard — a Server Component.
 *
 * There is no study-time table any more, so nothing here counts minutes: a day
 * counts because you solved a problem or touched a note in the vault. The four
 * tiles, the heatmap and the LeetCode card all read from `getDashboard()`; the
 * note rows come off the filesystem, which is the source of truth for the vault.
 */
import Link from "next/link";

import { getDashboard } from "@/lib/queries";
import { recentFiles, type NoteKind } from "@/lib/vault";
import { addDays, dayRange, formatFullDay, relativeTime, today } from "@/lib/dates";
import { Heatmap, HeatmapKey } from "@/components/heatmap";
import { DIFFICULTY_COLOR, DifficultyChip } from "@/app/leetcode/bits";
import {
  BarRow,
  Card,
  CardBody,
  CardHeader,
  Empty,
  PageHeader,
  StatTile,
  linkButtonClass,
} from "@/components/ui";

import { listClasses } from "./timetable/data";
import { fmtRange, minutesOf, mondayIndex, byStart, DAY_LABELS } from "./timetable/bits";

export const dynamic = "force-dynamic";

const WEEKS = 26;
const NOTE_ROWS = 6;
const REVISIT_ROWS = 5;

const LINK_PRIMARY = linkButtonClass({ variant: "primary" });
const LINK_QUIET =
  "text-[12px] font-medium text-accent underline decoration-from-font underline-offset-2";
const CARD_TITLE = "text-[13.5px] font-semibold text-ink";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/* --------------------------------- copy ---------------------------------- */

function todayLine(solved: number, goal: number): string {
  if (goal <= 0) {
    return solved > 0
      ? `${solved} ${plural(solved, "problem", "problems")} solved today`
      : "No problems solved today";
  }
  if (solved >= goal) return `${solved} of ${goal} problems today — done`;
  const left = goal - solved;
  return `${solved} of ${goal} problems today — ${left} to go`;
}

/* ------------------------------ note rows -------------------------------- */

const KIND_LABEL: Record<NoteKind, string> = {
  markdown: "Note",
  text: "Text",
  image: "Image",
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  file: "File",
};

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

function NoteKindIcon({ kind }: { kind: NoteKind }) {
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

/** "OS/Unit 1/paging.pdf" -> "OS". A file at the vault root has no subject. */
const subjectOf = (rel: string) => {
  const parts = rel.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
};

const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,8}$/, "") || name;

/* --------------------------------- page ---------------------------------- */

export default async function DashboardPage() {
  const [dash, notes, classes] = await Promise.all([
    getDashboard(),
    recentFiles(NOTE_ROWS),
    listClasses(),
  ]);

  const {
    settings,
    activity,
    activeDays,
    streak,
    best,
    todayActivity,
    weekProblems,
    problems,
    byDifficulty,
    noteCount,
    revisitQueue,
  } = dash;

  const dailyProblems = settings.dailyProblems > 0 ? settings.dailyProblems : 0;
  const weeklyGoal = dailyProblems * 7;
  const weekPct = weeklyGoal > 0 ? Math.round((weekProblems / weeklyGoal) * 100) : 0;

  // Calendar-correct walk over the heatmap's own window, so the summary under
  // it can never disagree with the squares by a day at a DST boundary.
  const windowDays = dayRange(addDays(new Date(), -(WEEKS * 7 - 1)), new Date());
  let windowActive = 0;
  let windowProblems = 0;
  for (const day of windowDays) {
    if (activeDays.has(day)) windowActive += 1;
    windowProblems += activity.get(day)?.problems ?? 0;
  }

  const now = new Date();
  const todayWeekday = mondayIndex(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todaysClasses = classes.filter((c) => c.weekday === todayWeekday).sort(byStart);

  const revisits = revisitQueue.slice(0, REVISIT_ROWS);
  const totalSolved = problems.length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`${formatFullDay(today())} · ${todayLine(todayActivity.problems, dailyProblems)}`}
      />

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
          label="Problems this week"
          value={weekProblems}
          sub={
            weeklyGoal > 0
              ? `${weekPct}% of the ${weeklyGoal} a week your daily target implies`
              : "No daily problem target set"
          }
        />
        <StatTile
          label="Solved all time"
          value={totalSolved}
          sub={
            totalSolved
              ? `${byDifficulty.Hard} hard, ${byDifficulty.Medium} medium, ${byDifficulty.Easy} easy`
              : "Nothing logged yet"
          }
        />
        <StatTile
          label="Notes in the vault"
          value={noteCount}
          sub={
            notes.length
              ? `Last touched ${relativeTime(notes[0].modified)}`
              : "Nothing filed yet"
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
          <Heatmap
            activity={activity}
            goalProblems={dailyProblems || 2}
            weeks={WEEKS}
          />
          <p className="mt-3 text-[12px] leading-snug text-ink-3">
            {windowActive} active {plural(windowActive, "day", "days")} in the last {WEEKS}{" "}
            weeks · {windowProblems} {plural(windowProblems, "problem", "problems")} solved,
            shaded against {dailyProblems || 2} a day.
          </p>
        </CardBody>
      </Card>

      {/* -------------------- next up + revisit queue ---------------------- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className={CARD_TITLE}>Next up</h2>
            <Link href="/timetable" className={LINK_QUIET}>
              Timetable
            </Link>
          </CardHeader>
          {todaysClasses.length ? (
            <ul className="flex flex-col">
              {todaysClasses.map((c) => {
                const live = minutesOf(c.startsAt) <= nowMin && nowMin < minutesOf(c.endsAt);
                const done = minutesOf(c.endsAt) <= nowMin;
                return (
                  <li
                    key={c.id}
                    className={`border-b border-line-soft last:border-b-0 ${
                      live ? "bg-surface-3" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3 px-4 py-2.5">
                      <span
                        className={`w-[84px] shrink-0 font-mono text-[11.5px] leading-snug tabular-nums ${
                          done && !live ? "text-ink-3" : "text-ink-2"
                        }`}
                      >
                        {fmtRange(c.startsAt, c.endsAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13.5px] ${
                            live ? "font-semibold text-ink" : "font-medium text-ink"
                          }`}
                        >
                          {c.title}
                        </span>
                        {c.location ? (
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                            {c.location}
                          </span>
                        ) : null}
                      </span>
                      {live ? (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-[3px] text-[10px] font-semibold leading-none text-on-accent">
                          Now
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty
              title={`Nothing on ${DAY_LABELS[todayWeekday]}`}
              action={
                <Link href="/timetable" className={LINK_PRIMARY}>
                  Open the timetable
                </Link>
              }
            >
              A class is a weekly repeating slot. Add one and today&rsquo;s classes show up
              here in order.
            </Empty>
          )}
        </Card>

        <Card>
          <CardHeader>
            <h2 className={CARD_TITLE}>Revisit queue</h2>
            {revisitQueue.length > REVISIT_ROWS ? (
              <Link href="/leetcode" className={LINK_QUIET}>
                See all {revisitQueue.length}
              </Link>
            ) : null}
          </CardHeader>
          {revisits.length ? (
            <ul className="flex flex-col">
              {revisits.map(({ problem, reason }) => (
                <li key={problem.id} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={`/leetcode/${encodeURIComponent(problem.slug)}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">
                        {problem.number ? `${problem.number}. ` : ""}
                        {problem.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                        {reason}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <DifficultyChip difficulty={problem.difficulty} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="Nothing waiting"
              action={
                <Link href="/leetcode" className={LINK_PRIMARY}>
                  Open LeetCode
                </Link>
              }
            >
              Problems come back here once they go stale, or the moment you flag one as worth
              a second look.
            </Empty>
          )}
        </Card>
      </div>

      {/* ------------------- recent notes + leetcode ----------------------- */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className={CARD_TITLE}>Recent notes</h2>
            <Link href="/subjects" className={LINK_QUIET}>
              Subjects
            </Link>
          </CardHeader>
          {notes.length ? (
            <ul className="flex flex-col">
              {notes.map((n) => {
                const subject = subjectOf(n.rel);
                return (
                  <li key={n.rel} className="border-b border-line-soft last:border-b-0">
                    <Link
                      href={`/subjects?file=${encodeURIComponent(n.rel)}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                    >
                      <span className="shrink-0 text-ink-3" title={KIND_LABEL[n.kind]}>
                        <NoteKindIcon kind={n.kind} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          {stem(n.name)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
                          {subject ? `${subject} · ` : ""}
                          {KIND_LABEL[n.kind]}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                        {relativeTime(n.modified)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty
              title="No notes yet"
              action={
                <Link href="/subjects" className={LINK_PRIMARY}>
                  Open Subjects
                </Link>
              }
            >
              A subject is a folder in the vault. Make one, then type a note into it or drop a
              PDF straight in.
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
              Connect your LeetCode username in Setup to import everything you have already
              solved, or log one by hand.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
