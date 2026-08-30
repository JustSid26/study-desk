/**
 * Day handling.
 *
 * A "day" here is a local calendar date string, YYYY-MM-DD — never a timestamp.
 * Walking days by adding 86_400_000ms is wrong twice a year: at a DST boundary
 * it skips or repeats a calendar day, which silently breaks a streak. Every
 * walk below goes through the Date constructor so the clock change is absorbed.
 */

export const DAY_MS = 86_400_000;

export function dayKey(d: Date | number = new Date()): string {
  const x = typeof d === "number" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate(),
  ).padStart(2, "0")}`;
}

export const today = () => dayKey(new Date());

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Calendar-correct day arithmetic — survives DST. */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const shiftDay = (key: string, n: number) => dayKey(addDays(parseDay(key), n));

/** Whole calendar days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = startOfDay(parseDay(b)).getTime() - startOfDay(parseDay(a)).getTime();
  return Math.round(ms / DAY_MS);
}

export const isValidDay = (k: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(parseDay(k).getTime());

/* -------------------------------- display -------------------------------- */

export function formatMins(total: number): string {
  const m = Math.max(0, Math.round(total || 0));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function formatDay(key: string): string {
  return parseDay(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatFullDay(key: string): string {
  return parseDay(key).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function relativeTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/* -------------------------------- streaks -------------------------------- */

/**
 * Consecutive active days ending today. Today not yet being active doesn't
 * break the streak — you might still study later — so the walk starts at
 * yesterday in that case.
 */
export function currentStreak(activeDays: Set<string>): number {
  let cursor = startOfDay();
  if (!activeDays.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let n = 0;
  while (activeDays.has(dayKey(cursor))) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function bestStreak(activeDays: Set<string>): number {
  const days = [...activeDays].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    out.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}
