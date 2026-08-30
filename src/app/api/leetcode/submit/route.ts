/**
 * Submit for real.
 *
 * Unlike Run, this creates a submission on the LeetCode account — a wrong
 * answer included — which is why the UI puts a confirmation in front of it.
 *
 * Every settled verdict is written to `submissions`, not just the accepted
 * ones. A history that quietly drops the failures would flatter you and tell
 * you nothing about which problems actually fought back.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { submissions, SUBMISSION_VERDICT } from "@/db/schema";
import { today } from "@/lib/dates";
import { newId } from "@/lib/id";
import { LeetCodeError, envCredentials, submitCode } from "@/lib/leetcode";

import { rejectCrossOrigin } from "@/lib/same-origin";

import { JudgeBody, readBody } from "../judge-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KNOWN = new Set<string>(SUBMISSION_VERDICT);

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const parsed = JudgeBody.safeParse(await readBody(request));
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "That request wasn't valid.",
        kind: "unexpected",
      },
      { status: 400 },
    );
  }

  const { slug, questionId, lang, code } = parsed.data;

  let result: Awaited<ReturnType<typeof submitCode>>;
  try {
    result = await submitCode({ slug, questionId, lang, code }, envCredentials(), request.signal);
  } catch (err) {
    if (err instanceof LeetCodeError) {
      return Response.json({ ok: false, error: err.message, kind: err.kind });
    }
    if (request.signal.aborted) {
      return Response.json({
        ok: false,
        error:
          "The submission was cancelled here, but LeetCode may still have received it — check your profile.",
        kind: "network",
      });
    }
    return Response.json(
      {
        ok: false,
        error: "The submission didn't finish. Check your LeetCode profile before resending.",
        kind: "unexpected",
      },
      { status: 500 },
    );
  }

  const known = KNOWN.has(result.verdict);

  // Writing the row must never cost you the verdict you just waited for.
  let logged = true;
  try {
    await db
      .insert(submissions)
      .values({
        id: newId(),
        slug,
        lang,
        code,
        verdict: known ? result.verdict : "Unknown",
        remoteId: result.submissionId,
        runtime: result.runtime,
        memory: result.memory,
        totalCorrect: result.totalCorrect,
        totalTestcases: result.totalTestcases,
        errorText:
          result.error ?? (known ? null : `LeetCode reported "${result.verdict}".`),
        day: today(),
        createdAt: Date.now(),
      })
      .onConflictDoNothing();

    revalidatePath(`/leetcode/${slug}`);
  } catch {
    logged = false;
  }

  return Response.json({ ok: true, result, logged });
}
