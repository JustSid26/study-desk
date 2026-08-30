import { revalidatePath } from "next/cache";
import { z } from "zod";

import { LeetCodeError, envCredentials, type Credentials } from "@/lib/leetcode";
import {
  enrichFromCatalogue,
  getSettings,
  patchSettings,
  syncLeetCode,
} from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same work the runSync action does, as JSON, so Setup can kick off a sync
 * and report what happened without a full page reload.
 *
 * A LeetCode problem is not a crash: an unreachable profile, a stale cookie or
 * a rate limit all come back as 200 `{ok:false, error, kind}` so the client can
 * render them as guidance next to the field that needs fixing.
 */

const Body = z.object({
  username: z.string().trim().max(64).optional(),
  session: z.string().trim().max(4096).optional(),
  csrf: z.string().trim().max(4096).optional(),
  refreshCatalogue: z.boolean().optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "That request wasn't valid." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const settings = await getSettings();
  const username = (input.username || settings?.leetcodeUsername || "").trim();
  if (!username) {
    return Response.json(
      { ok: false, error: "Add your LeetCode username first." },
      { status: 400 },
    );
  }

  const env = envCredentials();
  const creds: Credentials = {
    session: input.session || env.session,
    csrf: input.csrf || env.csrf,
  };

  try {
    const result = await syncLeetCode(username, creds, {
      refreshCatalogue: input.refreshCatalogue ?? false,
    });
    const enriched = await enrichFromCatalogue();

    revalidatePath("/", "layout");

    return Response.json({ ok: true, result, enriched });
  } catch (err) {
    if (err instanceof LeetCodeError) {
      await patchSettings({ lcLastError: err.message }).catch(() => {});
      return Response.json({ ok: false, error: err.message, kind: err.kind });
    }
    const message =
      err instanceof Error && err.message ? err.message : "The sync didn't finish.";
    await patchSettings({ lcLastError: message }).catch(() => {});
    return Response.json({ ok: false, error: message, kind: "unexpected" }, { status: 500 });
  }
}
