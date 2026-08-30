import "server-only";

import { asc } from "drizzle-orm";
import { db } from "@/db";
import { timetable } from "@/db/schema";
import type { ClassItem } from "./bits";

/**
 * The whole timetable, ordered the way both the week grid and the dashboard's
 * "Next up" card want it. It is a handful of rows by definition — a week only
 * has so many hours — so there is nothing to paginate or filter server-side.
 */
export async function listClasses(): Promise<ClassItem[]> {
  const rows = await db
    .select()
    .from(timetable)
    .orderBy(asc(timetable.weekday), asc(timetable.startsAt), asc(timetable.endsAt));

  return rows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    title: r.title,
    subjectPath: r.subjectPath,
    location: r.location,
    note: r.note,
  }));
}
