import { z } from "zod";

import { isPracticeLang } from "@/lib/paths";
import { rejectCrossOrigin } from "@/lib/same-origin";
import { listPracticeFiles } from "@/lib/practice";
import { runPractice } from "@/lib/runner";

/**
 * Run one practice file.
 *
 * A route rather than a Server Action because the editor wants the result as
 * data — an exit code, a duration and a list of diagnostics to hang buttons off
 * — not as a re-rendered page. `runPractice` spawns real processes and owns the
 * timeout, the output cap and the process-group kill, so this handler's only
 * jobs are validating the request and making sure a failure comes back as a
 * sentence instead of a stack trace.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lang: z
    .string({ error: "Say which language to run." })
    .refine(isPracticeLang, "That isn't a language this app runs."),
  file: z
    .string({ error: "Open a file before running it." })
    .trim()
    .min(1, "Open a file before running it.")
    .max(100, "That file name is too long.")
    .refine(
      (v) => !/[/\\]/.test(v),
      "A practice file name can't contain a folder separator.",
    ),
  input: z
    .string({ error: "Program input has to be text." })
    .max(64_000, "That's more program input than this can pass along.")
    .optional(),
});

const bad = (error: string, status = 400) =>
  Response.json({ ok: false, error }, { status });

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

  const { lang, file, input } = parsed.data;
  if (!isPracticeLang(lang)) return bad("That isn't a language this app runs.");

  // Confirm the file is one we actually list before spawning anything. Without
  // this, running a file deleted from Finder a second ago hands the browser
  // `python3`'s own message, which is an absolute path and a POSIX errno.
  const listed = await listPracticeFiles(lang);
  if (!listed.some((f) => f.name === file)) {
    return bad(
      `There's no ${file} in practicecode/${lang}/ any more. Pick another file from the list.`,
      404,
    );
  }

  try {
    const result = await runPractice(lang, file, input);
    return Response.json({ ok: true, result });
  } catch (err) {
    // A missing file is the one failure worth naming precisely; everything else
    // stays generic so no path or stack ever reaches the browser.
    const missing =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
    return bad(
      missing
        ? "That file isn't on disk any more. Pick another one from the list."
        : "Couldn't run that file. Check that the toolchain is installed and try again.",
      missing ? 404 : 500,
    );
  }
}
