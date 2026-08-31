/**
 * Timetable — a Server Component.
 *
 * The week grid is the real view: seven day columns over 30-minute rows, with
 * every block drawn at its true height. It needs horizontal room to mean
 * anything, so under `md` it is dropped entirely and the "Today" list — which
 * sits under the grid on a wide screen — becomes the whole page. Each of the
 * two is rendered exactly once; the breakpoint decides which one paints.
 */
import { listSubjects } from "@/lib/vault";
import { Card, CardBody, CardHeader, Empty, PageHeader } from "@/components/ui";

import { listClasses } from "./data";
import { AddClassButton } from "./class-dialog";
import { TodayList, WeekGrid } from "./week-grid";
import {
  DAY_LABELS,
  byStart,
  fmtTime,
  minutesOf,
  mondayIndex,
  type SubjectOption,
} from "./bits";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the header says is happening today. */
function todayLine(
  todays: Array<{ title: string; startsAt: string; endsAt: string }>,
  nowMin: number,
  dayName: string,
): string {
  if (!todays.length) return `nothing on ${dayName}`;

  const live = todays.find(
    (e) => minutesOf(e.startsAt) <= nowMin && nowMin < minutesOf(e.endsAt),
  );
  if (live) return `${live.title} is on now until ${fmtTime(live.endsAt)}`;

  const next = todays.find((e) => minutesOf(e.startsAt) > nowMin);
  if (next) return `next up is ${next.title} at ${fmtTime(next.startsAt)}`;

  return `${todays.length} ${plural(todays.length, "class", "classes")} today, all finished`;
}

export default async function TimetablePage() {
  const [items, vaultEntries] = await Promise.all([listClasses(), listSubjects()]);

  const subjects: SubjectOption[] = vaultEntries
    .filter((e) => e.isDir)
    .map((e) => ({ rel: e.rel, name: e.name }));

  const now = new Date();
  const todayWeekday = mondayIndex(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todays = items.filter((i) => i.weekday === todayWeekday).sort(byStart);

  const sub = items.length
    ? `${items.length} ${plural(items.length, "class", "classes")} scheduled · ${todayLine(
        todays,
        nowMin,
        DAY_LABELS[todayWeekday],
      )}`
    : "Nothing scheduled yet";

  return (
    <>
      <PageHeader title="Timetable" sub={sub}>
        <AddClassButton subjects={subjects} defaultWeekday={todayWeekday} />
      </PageHeader>

      {items.length ? (
        <>
          <Card className="hidden md:block">
            <CardHeader>
              <h2 className="text-[13.5px] font-semibold text-ink">The week</h2>
              <span className="text-[11.5px] text-ink-3">
                {items.length} {plural(items.length, "class", "classes")} a week
              </span>
            </CardHeader>
            <CardBody>
              <WeekGrid
                items={items}
                subjects={subjects}
                todayWeekday={todayWeekday}
              />
            </CardBody>
          </Card>

          <Card>
            <TodayList
              items={items}
              subjects={subjects}
              todayWeekday={todayWeekday}
              nowMin={nowMin}
            />
          </Card>
        </>
      ) : (
        <Card>
          <Empty
            title="No classes yet"
            action={<AddClassButton subjects={subjects} defaultWeekday={todayWeekday} />}
          >
            A class is a weekly repeating slot — a day, a start and an end time — so you add
            it once and it stands every week. Point one at a subject folder and it links
            straight to those notes.
          </Empty>
        </Card>
      )}
    </>
  );
}
