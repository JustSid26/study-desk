/**
 * The week grid — a Server Component that renders client triggers.
 *
 * Rows are 30-minute slots, so a block's HEIGHT is its real duration: a two
 * hour lab is visibly twice a one hour lecture, which is the whole reason this
 * is a grid and not a list. The vertical window is measured from the data
 * (snapped out to whole hours so the labels land on the rules), not hard-coded
 * to 9-5, because a 7am lab or a 9pm tutorial has to be visible.
 *
 * Overlaps split the day's column: `placeDay` colours the intervals into lanes
 * per overlapping cluster, and the day column carries the lowest common number
 * of sub-columns those clusters need, so a lane always spans a whole number of
 * them and one double-booked hour doesn't narrow the rest of the day.
 */
import Link from "next/link";

import { Empty } from "@/components/ui";
import { AddClassButton, ClassTrigger } from "./class-dialog";
import {
  DAY_LABELS,
  DAY_SHORT,
  fmtDuration,
  fmtRange,
  lastSegment,
  minutesOf,
  placeDay,
  subjectHref,
  timeBounds,
  type ClassItem,
  type SubjectOption,
} from "./bits";

/** One 30-minute slot, in pixels. An hour is twice this. */
const SLOT = 28;
const GUTTER = 52;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function WeekGrid({
  items,
  subjects,
  todayWeekday,
  className,
}: {
  items: ClassItem[];
  subjects: SubjectOption[];
  todayWeekday: number;
  className?: string;
}) {
  const { startMin, endMin } = timeBounds(items);
  const slots = Math.max(4, Math.round((endMin - startMin) / 30));
  const rows = `repeat(${slots}, ${SLOT}px)`;
  const columns = `${GUTTER}px repeat(7, minmax(74px, 1fr))`;

  const hours: number[] = [];
  for (let m = startMin; m < endMin; m += 60) hours.push(m);

  // An hour rule every two slots. Painted as a background so it sits under the
  // blocks without a stack of empty cells in the DOM.
  const ruled = {
    backgroundImage:
      "repeating-linear-gradient(to bottom, var(--color-line-soft) 0, var(--color-line-soft) 1px, transparent 1px, transparent " +
      SLOT * 2 +
      "px)",
  } as const;

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <div className="min-w-[660px]">
          {/* ------------------------------ header ------------------------- */}
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <div aria-hidden="true" />
            {DAY_SHORT.map((label, day) => {
              const isToday = day === todayWeekday;
              return (
                <div
                  key={label}
                  className={[
                    "border-b px-2 pb-1.5 pt-0.5 text-[11.5px] leading-none",
                    isToday
                      ? "border-line-strong font-semibold text-ink"
                      : "border-line-soft font-medium text-ink-3",
                  ].join(" ")}
                >
                  <span className="block truncate">{label}</span>
                  {isToday ? (
                    <span className="mt-1 block font-mono text-[9px] uppercase leading-[9px] tracking-[0.13em] text-ink-2">
                      Today
                    </span>
                  ) : (
                    <span aria-hidden="true" className="mt-1 block h-[9px]" />
                  )}
                </div>
              );
            })}
          </div>

          {/* ------------------------------- body -------------------------- */}
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            {/* hour labels */}
            <div className="grid" style={{ gridTemplateRows: rows }}>
              {hours.map((m) => (
                <div
                  key={m}
                  className="-translate-y-[6px] pr-2 text-right font-mono text-[10px] leading-none text-ink-3"
                  style={{
                    gridRow: `${Math.round((m - startMin) / 30) + 1} / span 2`,
                  }}
                >
                  {String(Math.floor(m / 60)).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {DAY_LABELS.map((dayName, day) => {
              const placed = placeDay(items.filter((i) => i.weekday === day));
              const dayCols = clamp(
                placed.reduce((acc, p) => lcm(acc, Math.max(1, p.lanes)), 1),
                1,
                12,
              );
              const isToday = day === todayWeekday;

              return (
                <div
                  key={dayName}
                  className={[
                    "relative grid border-l border-line-soft",
                    isToday ? "bg-surface-3" : "",
                  ].join(" ")}
                  style={{
                    ...ruled,
                    gridTemplateRows: rows,
                    gridTemplateColumns: `repeat(${dayCols}, minmax(0, 1fr))`,
                  }}
                >
                  {placed.map((p) => {
                    const rowStart = clamp(
                      Math.round((p.startMin - startMin) / 30) + 1,
                      1,
                      slots,
                    );
                    const rowEnd = clamp(
                      Math.round((p.endMin - startMin) / 30) + 1,
                      rowStart + 1,
                      slots + 1,
                    );
                    const span = rowEnd - rowStart;
                    // Whole sub-columns only: a fractional `span` is invalid CSS
                    // and would drop the placement, stacking the overlap again.
                    const width = Math.max(1, Math.round(dayCols / Math.max(1, p.lanes)));
                    const colStart = Math.min(dayCols, p.lane * width + 1);
                    const colSpan = Math.max(1, Math.min(width, dayCols - colStart + 1));
                    const e = p.item;
                    const range = fmtRange(e.startsAt, e.endsAt);

                    return (
                      <div
                        key={e.id}
                        className="relative min-w-0 p-[2px]"
                        style={{
                          gridRow: `${rowStart} / ${rowEnd}`,
                          gridColumn: `${colStart} / span ${colSpan}`,
                        }}
                      >
                        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[7px] border border-line bg-surface px-1.5 py-1 shadow-[var(--shadow-card)]">
                          {/* The stretched trigger: a real button, its hit area
                              pushed out over the whole block by ::after so the
                              subject link can still sit above it. */}
                          <ClassTrigger
                            entry={e}
                            subjects={subjects}
                            label={`Edit ${e.title}, ${dayName} ${range}${
                              e.location ? `, ${e.location}` : ""
                            }`}
                            className="block w-full min-w-0 cursor-pointer text-left after:absolute after:inset-0 after:content-['']"
                          >
                            <span className="block truncate text-[11.5px] font-semibold leading-tight text-ink">
                              {e.title}
                            </span>
                            {span >= 2 ? (
                              <span className="mt-[3px] block truncate font-mono text-[9.5px] leading-tight text-ink-3">
                                {range}
                              </span>
                            ) : null}
                            {span >= 3 && e.location ? (
                              <span className="mt-[2px] block truncate text-[10px] leading-tight text-ink-2">
                                {e.location}
                              </span>
                            ) : null}
                          </ClassTrigger>

                          {span >= 4 && e.subjectPath ? (
                            <Link
                              href={subjectHref(e.subjectPath)}
                              className="relative z-10 mt-auto block truncate text-[10px] leading-tight text-ink-2 underline decoration-from-font underline-offset-2"
                            >
                              {lastSegment(e.subjectPath)}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11.5px] leading-snug text-ink-3">
        Blocks are drawn to scale — a taller block is a longer class. A short one drops the
        time and the room to fit; hover or select any block to see its full detail and edit
        it.
      </p>
    </div>
  );
}

/* -------------------------------- today ----------------------------------- */

/**
 * The compact read for a phone. It is the ONLY thing rendered under the grid's
 * breakpoint — the week grid needs about 660px to be legible at all, and a
 * squeezed one is worse than no grid.
 */
export function TodayList({
  items,
  subjects,
  todayWeekday,
  nowMin,
  className,
}: {
  items: ClassItem[];
  subjects: SubjectOption[];
  todayWeekday: number;
  nowMin: number;
  className?: string;
}) {
  const todays = items.filter((i) => i.weekday === todayWeekday);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-soft px-4 py-3">
        <h2 className="text-[13.5px] font-semibold text-ink">
          Today · {DAY_LABELS[todayWeekday]}
        </h2>
        <span className="text-[11.5px] text-ink-3">
          {todays.length
            ? `${todays.length} ${todays.length === 1 ? "class" : "classes"}`
            : "Nothing scheduled"}
        </span>
      </div>

      {todays.length ? (
        <ul className="flex flex-col">
          {todays.map((e) => {
            const live = minutesOf(e.startsAt) <= nowMin && nowMin < minutesOf(e.endsAt);
            const past = minutesOf(e.endsAt) <= nowMin;
            return (
              <li
                key={e.id}
                className={[
                  "relative border-b border-line-soft last:border-b-0",
                  live ? "bg-surface-3" : "",
                ].join(" ")}
              >
                <div className="flex items-start gap-3 px-4 py-2.5">
                  <span
                    className={[
                      "w-[86px] shrink-0 font-mono text-[11.5px] leading-snug tabular-nums",
                      past && !live ? "text-ink-3" : "text-ink-2",
                    ].join(" ")}
                  >
                    {fmtRange(e.startsAt, e.endsAt)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <ClassTrigger
                      entry={e}
                      subjects={subjects}
                      label={`Edit ${e.title}`}
                      className="block w-full cursor-pointer truncate text-left text-[13.5px] font-medium text-ink after:absolute after:inset-0 after:content-['']"
                    >
                      {e.title}
                    </ClassTrigger>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-3">
                      <span>{fmtDuration(e.startsAt, e.endsAt)}</span>
                      {e.location ? <span>· {e.location}</span> : null}
                      {e.subjectPath ? (
                        <Link
                          href={subjectHref(e.subjectPath)}
                          className="relative z-10 text-ink-2 underline decoration-from-font underline-offset-2"
                        >
                          {lastSegment(e.subjectPath)}
                        </Link>
                      ) : null}
                    </div>
                  </div>
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
          title="No classes today"
          action={<AddClassButton subjects={subjects} defaultWeekday={todayWeekday} />}
        >
          Nothing is on for {DAY_LABELS[todayWeekday]}. Add a class and it will show up here
          every week.
        </Empty>
      )}
    </div>
  );
}
