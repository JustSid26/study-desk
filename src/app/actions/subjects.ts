"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { subjects, topics, sessions, TOPIC_STATUS } from "@/db/schema";
import { newId } from "@/lib/id";
import { isValidDay, today } from "@/lib/dates";
import { SUBJECT_COLORS } from "@/components/subject-color";

const HEX = /^#[0-9a-fA-F]{6}$/;

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

function fail(error: string): Fail {
  return { ok: false, error };
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "That input isn't valid.";
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function touch() {
  revalidatePath("/");
  revalidatePath("/subjects");
}

/* -------------------------------- subjects -------------------------------- */

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the subject a name.")
  .max(80, "Keep the name under 80 characters.");

const colorSchema = z
  .string()
  .trim()
  .regex(HEX, "Pick a colour from the palette.");

const createSubjectSchema = z.object({
  name: nameSchema,
  color: colorSchema.default(SUBJECT_COLORS[0]),
  goalMins: z
    .number()
    .int("Give the weekly goal in whole minutes.")
    .positive("A weekly goal has to be more than zero minutes.")
    .max(10080, "A week only holds 10,080 minutes.")
    .nullable(),
  topics: z.string(),
});

function optionalInt(raw: string): number | null | "bad" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "bad";
  return Math.trunc(n);
}

export async function createSubject(
  fd: FormData,
): Promise<Ok<{ id: string; topicCount: number }> | Fail> {
  const goalRaw = optionalInt(str(fd, "goalMins"));
  if (goalRaw === "bad") return fail("The weekly goal has to be a number of minutes.");

  const parsed = createSubjectSchema.safeParse({
    name: str(fd, "name"),
    color: str(fd, "color").trim() || undefined,
    goalMins: goalRaw,
    topics: str(fd, "topics"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const seeds = [
    ...new Set(
      parsed.data.topics
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.slice(0, 80)),
    ),
  ];

  try {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${subjects.position}), -1)` })
      .from(subjects);

    const id = newId();
    await db.insert(subjects).values({
      id,
      name: parsed.data.name,
      color: parsed.data.color,
      goalMins: parsed.data.goalMins,
      position: (Number(max) || 0) + 1,
    });

    if (seeds.length) {
      await db.insert(topics).values(
        seeds.map((name, i) => ({
          id: newId(),
          subjectId: id,
          name,
          position: i,
          updatedAt: Date.now(),
        })),
      );
    }

    touch();
    return { ok: true, id, topicCount: seeds.length };
  } catch {
    return fail("Couldn't save that subject. Try again.");
  }
}

export async function renameSubject(
  id: string,
  name: string,
): Promise<{ ok: true } | Fail> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (!id) return fail("That subject no longer exists.");

  try {
    await db.update(subjects).set({ name: parsed.data }).where(eq(subjects.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't rename that subject. Try again.");
  }
}

export async function recolorSubject(
  id: string,
  color: string,
): Promise<{ ok: true } | Fail> {
  const parsed = colorSchema.safeParse(color);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (!id) return fail("That subject no longer exists.");

  try {
    await db.update(subjects).set({ color: parsed.data }).where(eq(subjects.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't change that colour. Try again.");
  }
}

/**
 * Topics and sessions go with the subject (FK cascade); notes survive with
 * their subject unset (FK set null). That is the schema's call, not ours.
 */
export async function deleteSubject(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That subject no longer exists.");
  try {
    await db.delete(subjects).where(eq(subjects.id, id));
    revalidatePath("/");
    revalidatePath("/subjects");
    revalidatePath("/notes");
    return { ok: true };
  } catch {
    return fail("Couldn't delete that subject. Try again.");
  }
}

/* --------------------------------- topics --------------------------------- */

const topicNameSchema = z
  .string()
  .trim()
  .min(1, "Give the topic a name.")
  .max(80, "Keep the topic name under 80 characters.");

export async function addTopic(
  subjectId: string,
  name: string,
): Promise<Ok<{ id: string }> | Fail> {
  const parsed = topicNameSchema.safeParse(name);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (!subjectId) return fail("Pick a subject for this topic.");

  try {
    const owner = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .limit(1);
    if (!owner.length) return fail("That subject no longer exists.");

    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${topics.position}), -1)` })
      .from(topics)
      .where(eq(topics.subjectId, subjectId));

    const id = newId();
    await db.insert(topics).values({
      id,
      subjectId,
      name: parsed.data,
      position: (Number(max) || 0) + 1,
      updatedAt: Date.now(),
    });

    touch();
    return { ok: true, id };
  } catch {
    return fail("Couldn't add that topic. Try again.");
  }
}

export async function renameTopic(
  id: string,
  name: string,
): Promise<{ ok: true } | Fail> {
  const parsed = topicNameSchema.safeParse(name);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (!id) return fail("That topic no longer exists.");

  try {
    await db
      .update(topics)
      .set({ name: parsed.data, updatedAt: Date.now() })
      .where(eq(topics.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't rename that topic. Try again.");
  }
}

export async function deleteTopic(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That topic no longer exists.");
  try {
    await db.delete(topics).where(eq(topics.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't delete that topic. Try again.");
  }
}

/** new -> learning -> revising -> solid -> new. */
export async function cycleTopicStatus(
  id: string,
): Promise<Ok<{ status: (typeof TOPIC_STATUS)[number] }> | Fail> {
  if (!id) return fail("That topic no longer exists.");
  try {
    const rows = await db
      .select({ status: topics.status })
      .from(topics)
      .where(eq(topics.id, id))
      .limit(1);
    if (!rows.length) return fail("That topic no longer exists.");

    const at = TOPIC_STATUS.indexOf(rows[0].status);
    const next = TOPIC_STATUS[(at + 1) % TOPIC_STATUS.length];

    await db
      .update(topics)
      .set({ status: next, updatedAt: Date.now() })
      .where(eq(topics.id, id));

    touch();
    return { ok: true, status: next };
  } catch {
    return fail("Couldn't update that topic. Try again.");
  }
}

/* -------------------------------- sessions -------------------------------- */

const sessionSchema = z.object({
  subjectId: z.string().nullable(),
  minutes: z
    .number()
    .int("Log whole minutes.")
    .min(1, "Log at least one minute.")
    .max(1440, "A single session tops out at 1,440 minutes."),
  day: z.string().refine(isValidDay, "That isn't a real date."),
  note: z.string().max(500, "Keep the session note under 500 characters."),
});

export async function createSession(
  fd: FormData,
): Promise<Ok<{ id: string; day: string; minutes: number }> | Fail> {
  const rawMinutes = str(fd, "minutes").trim();
  const minutes = Number(rawMinutes);
  if (!rawMinutes || !Number.isFinite(minutes)) {
    return fail("How many minutes was it?");
  }

  const parsed = sessionSchema.safeParse({
    subjectId: str(fd, "subjectId").trim() || null,
    minutes: Math.trunc(minutes),
    day: str(fd, "day").trim() || today(),
    note: str(fd, "note").trim(),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    if (parsed.data.subjectId) {
      const owner = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.id, parsed.data.subjectId))
        .limit(1);
      if (!owner.length) return fail("That subject no longer exists.");
    }

    const id = newId();
    await db.insert(sessions).values({
      id,
      subjectId: parsed.data.subjectId,
      minutes: parsed.data.minutes,
      day: parsed.data.day,
      note: parsed.data.note,
    });

    touch();
    return { ok: true, id, day: parsed.data.day, minutes: parsed.data.minutes };
  } catch {
    return fail("Couldn't log that session. Try again.");
  }
}

export async function deleteSession(id: string): Promise<{ ok: true } | Fail> {
  if (!id) return fail("That session no longer exists.");
  try {
    await db.delete(sessions).where(eq(sessions.id, id));
    touch();
    return { ok: true };
  } catch {
    return fail("Couldn't delete that session. Try again.");
  }
}
