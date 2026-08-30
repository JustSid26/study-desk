/**
 * Run against sample tests. This is LeetCode's `interpret_solution` endpoint —
 * it does NOT create a submission and never shows up on the profile.
 *
 * The judge takes a few seconds, so this is a POST the client awaits with an
 * AbortController rather than anything streaming.
 */
import { LeetCodeError, envCredentials, runCode } from "@/lib/leetcode";

import { rejectCrossOrigin } from "@/lib/same-origin";

import { JudgeBody, readBody } from "../judge-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const { slug, questionId, lang, code, input } = parsed.data;

  try {
    const result = await runCode(
      { slug, questionId, lang, code, input: input ?? "" },
      envCredentials(),
      request.signal,
    );
    // `result.ok` is the judge's own verdict; the envelope's `ok` is whether we
    // reached the judge at all. Keeping them on separate levels is what lets the
    // UI tell "Wrong Answer" apart from "your cookie expired".
    return Response.json({ ok: true, result });
  } catch (err) {
    // A LeetCode problem is guidance, not a crash: 200 so the client renders the
    // sentence instead of a network error.
    if (err instanceof LeetCodeError) {
      return Response.json({ ok: false, error: err.message, kind: err.kind });
    }
    if (request.signal.aborted) {
      return Response.json({ ok: false, error: "Run cancelled.", kind: "network" });
    }
    return Response.json(
      {
        ok: false,
        error: "The run didn't finish. Try again in a moment.",
        kind: "unexpected",
      },
      { status: 500 },
    );
  }
}
