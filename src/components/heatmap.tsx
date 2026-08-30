/**
 * Activity heatmap — a Server Component.
 *
 * Cells shade by problems solved against the daily problem target; a day with
 * only note activity still shows at the lowest level.
 *
 * The day list is built with `dayRange`/`addDays`, never by adding 86_400_000ms:
 * a millisecond walk skips or repeats a calendar day at a DST boundary, which
 * quietly shifts every column after March.
 *
 * The tooltip is never the only way to read a day, but the cells are NOT each a
 * tab stop: 26 weeks is ~182 of them, and making every one focusable put about
 * 190 Tab presses between the dashboard header and the first card under it.
 * Instead the grid is decorative and the same day-by-day values are repeated
 * underneath as a visually-hidden list, which a screen reader reads linearly and
 * which costs the keyboard nothing.
 */
import { addDays, dayRange, formatFullDay, parseDay, today } from "@/lib/dates";

export type HeatmapDay = { problems: number; notes: number };

const HEAT = [
  "bg-heat-0",
  "bg-heat-1",
  "bg-heat-2",
  "bg-heat-3",
  "bg-heat-4",
] as const;

const CELL = "h-[11px] w-[11px] rounded-[2.5px]";

/**
 * Shade by problems solved against the daily target. A day with only a note on
 * it still reads as a day you turned up, so it never falls below level 1.
 */
function levelFor(a: HeatmapDay | undefined, goal: number): number {
  const solved = a?.problems ?? 0;
  if (solved <= 0) return (a?.notes ?? 0) > 0 ? 1 : 0;
  const r = solved / goal;
  return r < 0.5 ? 1 : r < 1 ? 2 : r < 1.75 ? 3 : 4;
}

function describe(a: HeatmapDay | undefined): string {
  const parts: string[] = [];
  if ((a?.problems ?? 0) > 0) parts.push(`${a!.problems} problem${a!.problems === 1 ? "" : "s"}`);
  if ((a?.notes ?? 0) > 0) parts.push(`${a!.notes} note${a!.notes === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "nothing logged";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Heatmap({
  activity,
  goalProblems,
  weeks = 26,
}: {
  activity: Map<string, HeatmapDay>;
  goalProblems: number;
  weeks?: number;
}) {
  const goal = Number.isFinite(goalProblems) && goalProblems > 0 ? goalProblems : 2;
  const span = Math.max(1, Math.round(weeks));
  const todayKey = today();
  const now = parseDay(todayKey);

  // Start on the Monday on or before the first day of the window, and run to
  // the Sunday of the current week so every column is a full seven rows.
  const mondayOffset = (d: Date) => (d.getDay() + 6) % 7;
  const first = addDays(now, -(span * 7 - 1));
  const start = addDays(first, -mondayOffset(first));
  const end = addDays(now, 6 - mondayOffset(now));

  const days = dayRange(start, end);
  const columns: string[][] = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));

  const labelFor = (day: string) =>
    `${formatFullDay(day)} — ${day > todayKey ? "upcoming" : describe(activity.get(day))}`;

  let prevMonth = -1;
  const monthLabels = columns.map((col) => {
    const d = parseDay(col[0]);
    const m = d.getMonth();
    if (m === prevMonth) return null;
    prevMonth = m;
    return MONTHS[m];
  });

  return (
    <div className="flex gap-2">
      <div className="flex shrink-0 flex-col gap-[3px] pt-[13px]">
        {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="h-[11px] text-[9px] leading-[11px] text-ink-3"
          >
            {l}
          </div>
        ))}
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div className="w-max">
          <div className="flex gap-[3px]">
            {monthLabels.map((label, i) => (
              <div key={i} className="relative h-[13px] w-[11px]">
                {label ? (
                  <span className="absolute left-0 top-0 whitespace-nowrap text-[9.5px] leading-[13px] text-ink-3">
                    {label}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {days.map((day) => {
              const future = day > todayKey;
              const lvl = future ? 0 : levelFor(activity.get(day), goal);
              const label = labelFor(day);
              return (
                <div
                  key={day}
                  aria-hidden="true"
                  title={label}
                  className={[
                    CELL,
                    HEAT[lvl],
                    future ? "opacity-35" : "",
                    day === todayKey ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* The same values, linearly. `sr-only` is out of flow, so it costs the
          flex row nothing and the keyboard no tab stops. */}
      <ul className="sr-only">
        {days.map((day) => (
          <li key={day}>{labelFor(day)}</li>
        ))}
      </ul>
    </div>
  );
}

export function HeatmapKey({ className }: { className?: string }) {
  return (
    <div className={["flex items-center gap-1.5 text-[10.5px] text-ink-3", className].filter(Boolean).join(" ")}>
      <span>Less</span>
      {HEAT.map((c) => (
        <span key={c} aria-hidden="true" className={`${CELL} ${c}`} />
      ))}
      <span>More</span>
    </div>
  );
}
