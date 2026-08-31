import { z } from "zod";

import { rejectCrossOrigin } from "@/lib/same-origin";
import { listPracticeFiles } from "@/lib/practice";
import { tracePractice, DEFAULT_MAX_STEPS, MAX_STEPS_ALLOWED } from "@/lib/tracer";

/**
 * Trace one Java practice file.
 *
 * Separate from /api/practice/run on purpose: tracing launches a second JVM and
 * pays a socket round-trip per line, so it is opt-in per press rather than
 * something every Run quietly does.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  file: z
    .string({ error: "Open a file before tracing it." })
    .trim()
    .min(1, "Open a file before tracing it.")
    .max(100, "That file name is too long.")
    .refine((v) => !/[/\\]/.test(v), "A practice file name can't contain a folder separator.")
    .refine((v) => v.endsWith(".java"), "Only Java files can be traced."),
  maxSteps: z
    .number({ error: "The step limit has to be a number." })
    .int()
    .min(1)
    .max(MAX_STEPS_ALLOWED)
    .optional(),
});

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return bad("That request wasn't readable.");
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message ?? "That request isn't valid.");
  }

  const { file, maxSteps } = parsed.data;

  // Confirm the file is one we list before spawning two JVMs for it.
  const listed = await listPracticeFiles("java");
  if (!listed.some((f) => f.name === file)) {
    return bad(`There's no ${file} in practicecode/java/ any more.`, 404);
  }

  try {
    const result = await tracePractice(file, maxSteps ?? DEFAULT_MAX_STEPS);
    return Response.json(result);
  } catch {
    return bad("Couldn't trace that file. Check that a JDK is installed and try again.", 500);
  }
}
