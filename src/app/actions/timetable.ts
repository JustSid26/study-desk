"use server";

/**
 * Timetable mutations.
 *
 * An entry is a weekly repeating slot, so there is no date on it — only a
 * weekday (0 = Monday) and two "HH:MM" strings. Storing the times as strings
 * rather than minutes keeps what you typed and still sorts correctly, so the
 * only arithmetic here is the end > start check.
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { timetable } from "@/db/schema";
import { newId } from "@/lib/id";
import { insideVault } from "@/lib/paths";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

const fail = (error: string): Fail => ({ ok: false, error });

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" -> minutes since midnight. Only used for the ordering check. */
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function touch() {
  revalidatePath("/timetable");
  revalidatePath("/");
}

const schema = z
  .object({
    id: z.string().max(64).nullable(),
    weekday: z
      .number()
      .int("Pick a day of the week.")
      .min(0, "Pick a day of the week.")
      .max(6, "Pick a day of the week."),
    startsAt: z.string().regex(HHMM, "Give a start time like 09:30."),
    endsAt: z.string().regex(HHMM, "Give an end time like 11:00."),
    title: z
      .string()
      .trim()
      .min(1, "What is the class called?")
      .max(120, "That title is too long."),
    subjectPath: z.string().max(400).nullable(),
    location: z.string().trim().max(120, "That location is too long.").nullable(),
    note: z.string().max(5_000, "That note is too long to save."),
  })
  .refine((v) => minutesOf(v.endsAt) > minutesOf(v.startsAt), {
    message: "The class has to end after it starts.",
    path: ["endsAt"],
  });

export async function saveEntry(
  fd: FormData,
): Promise<Ok<{ id: string; created: boolean }> | Fail> {
  const weekdayRaw = str(fd, "weekday").trim();
  const weekday = Number(weekdayRaw);
  if (!weekdayRaw || !Number.isFinite(weekday)) return fail("Pick a day of the week.");

  const parsed = schema.safeParse({
    id: str(fd, "id").trim() || null,
    weekday: Math.trunc(weekday),
    startsAt: str(fd, "startsAt").trim(),
    endsAt: str(fd, "endsAt").trim(),
    title: str(fd, "title"),
    subjectPath: str(fd, "subjectPath").trim() || null,
    location: str(fd, "location").trim() || null,
    note: str(fd, "note"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That class isn't valid.");
  }

  const d = parsed.data;

  // A subject folder is a path off a form field, so it goes through the vault
  // boundary before it is ever written down.
  if (d.subjectPath) {
    try {
      insideVault(d.subjectPath);
    } catch {
      return fail("That subject folder is outside your notes.");
    }
  }

  try {
    if (d.id) {
      const existing = await db
        .select({ id: timetable.id })
        .from(timetable)
        .where(eq(timetable.id, d.id))
        .limit(1);
      if (!existing.length) return fail("That class is no longer on your timetable.");

      await db
        .update(timetable)
        .set({
          weekday: d.weekday,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          title: d.title,
          subjectPath: d.subjectPath,
          location: d.location,
          note: d.note,
        })
        .where(eq(timetable.id, d.id));

      touch();
      return { ok: true, id: d.id, created: false };
    }

    const id = newId();
    await db.insert(timetable).values({
      id,
      weekday: d.weekday,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      title: d.title,
      subjectPath: d.subjectPath,
      location: d.location,
      note: d.note,
      createdAt: Date.now(),
    });

    touch();
    return { ok: true, id, created: true };
  } catch {
    return fail("Couldn't save that class. Try again.");
  }
}

export async function deleteEntry(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That class is no longer on your timetable.");
  try {
    await db.delete(timetable).where(eq(timetable.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't remove that class. Try again.");
  }
}
