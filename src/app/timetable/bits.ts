/**
 * Timetable helpers shared by the page (a Server Component), the week grid and
 * the edit dialog (a Client Component). Nothing here touches the database or
 * the filesystem, so both sides can import it without dragging a `server-only`
 * module into the client bundle.
 */

/** Row shape the UI reads. Mirrors `TimetableRow` structurally. */
export interface ClassItem {
  id: string;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  startsAt: string;
  endsAt: string;
  title: string;
  subjectPath: string | null;
  location: string | null;
  note: string;
}

/** A subject folder, as the dialog's select needs it. */
export interface SubjectOption {
  rel: string;
  name: string;
}

export const DAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "HH:MM" -> minutes since midnight. Malformed input lands at 0 rather than NaN. */
export function minutesOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  if (!m) return 0;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const toHHMM = (mins: number) =>
  `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`;

/** 24-hour clock without the decorative leading zero: "09:05" reads as "9:05". */
export function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
  if (!m) return t ?? "";
  return `${Number(m[1])}:${m[2]}`;
}

export const fmtRange = (a: string, b: string) => `${fmtTime(a)}–${fmtTime(b)}`;

/** "1h 30m" — the duration a block's height is meant to convey. */
export function fmtDuration(startsAt: string, endsAt: string): string {
  const n = Math.max(0, minutesOf(endsAt) - minutesOf(startsAt));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** JS Sunday-first weekday -> our Monday-first index. */
export const mondayIndex = (d: Date = new Date()) => (d.getDay() + 6) % 7;

export const byStart = (a: ClassItem, b: ClassItem) =>
  a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt) ||
  a.title.localeCompare(b.title);

/* ------------------------------- layout ---------------------------------- */

export interface PlacedClass {
  item: ClassItem;
  /** column index within its day, 0-based */
  lane: number;
  /** how many lanes the day is split into around this entry */
  lanes: number;
  startMin: number;
  endMin: number;
}

/**
 * Split a day's column between entries that overlap.
 *
 * Entries are swept in start order into the first lane whose last entry has
 * already finished, which is the standard greedy interval colouring. The lane
 * COUNT is then taken per overlapping cluster rather than per day, so one
 * double-booked hour on Tuesday doesn't halve the width of every other class
 * that day.
 */
export function placeDay(items: ClassItem[]): PlacedClass[] {
  const sorted = [...items].sort(byStart);
  const out: PlacedClass[] = [];

  let cluster: PlacedClass[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];

  const closeCluster = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((p) => (p.lanes = lanes));
    out.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
    clusterEnd = -1;
  };

  for (const item of sorted) {
    const startMin = minutesOf(item.startsAt);
    const endMin = Math.max(startMin + 15, minutesOf(item.endsAt));

    // A gap with nothing running across it ends the cluster.
    if (cluster.length && startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endMin);
    } else {
      laneEnds[lane] = endMin;
    }

    cluster.push({ item, lane, lanes: 1, startMin, endMin });
    clusterEnd = Math.max(clusterEnd, endMin);
  }
  if (cluster.length) closeCluster();

  return out;
}

/**
 * The grid's vertical window, snapped out to whole hours so the labels down the
 * left land on the lines. Falls back to a plausible school day when there is
 * nothing to measure.
 */
export function timeBounds(items: ClassItem[]): { startMin: number; endMin: number } {
  if (!items.length) return { startMin: 8 * 60, endMin: 18 * 60 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of items) {
    lo = Math.min(lo, minutesOf(i.startsAt));
    hi = Math.max(hi, minutesOf(i.endsAt));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { startMin: 8 * 60, endMin: 18 * 60 };
  }
  const startMin = Math.floor(lo / 60) * 60;
  const endMin = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  // Never draw a grid so short it reads as a mistake.
  return { startMin, endMin: Math.max(endMin, startMin + 120) };
}

/** Is `now` (minutes since midnight) inside this entry, today? */
export const isNow = (item: ClassItem, weekday: number, nowMin: number) =>
  item.weekday === weekday &&
  minutesOf(item.startsAt) <= nowMin &&
  nowMin < minutesOf(item.endsAt);

/* --------------------------------- links ---------------------------------- */

/**
 * Where a subject FOLDER opens in the Subjects tab. Kept in one place because
 * the vault browser owns that URL shape — if it changes, it changes here.
 */
export const subjectHref = (rel: string) =>
  `/subjects?path=${encodeURIComponent(rel)}`;

/** The last segment of a vault path — the folder's own name. */
export const lastSegment = (rel: string) => rel.split("/").filter(Boolean).pop() ?? rel;
