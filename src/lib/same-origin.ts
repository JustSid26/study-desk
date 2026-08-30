/**
 * The origin check every state-changing route handler runs first.
 *
 * Next.js checks Origin against Host for Server Actions, but route handlers get
 * none of that — and these POSTs are not harmless. `/api/leetcode/submit` files
 * a real submission on the user's LeetCode profile using the session cookie the
 * server holds; `/api/sync` kicks off a paged import that takes half a minute;
 * `/api/practice/run` compiles and executes a file on this machine.
 *
 * Without a check, any page open in the same browser can drive all three. A
 * cross-origin `fetch` with `mode:"no-cors"` and a `text/plain` content type is
 * a CORS *simple* request: there is no preflight, the browser sends it, and the
 * handler runs. The attacker can't read the reply, but for a submission or a
 * sync they don't need to.
 *
 * Two conditions close it:
 *
 *  - `content-type` must be `application/json`. That alone takes the request out
 *    of the simple set, so a cross-origin sender must preflight, and no preflight
 *    is ever answered.
 *  - `Origin`, when present, must match the host the request arrived on. Browsers
 *    send `Origin` on every POST, same-origin included, so this is the real test;
 *    it is skipped when absent so curl and the app's own server-side calls work.
 *
 * GET routes under `/api/vault/*` need none of this — a cross-origin page can
 * fire those off but CORS already stops it reading the response, and they change
 * nothing.
 */

const deny = (status: number, error: string) =>
  Response.json({ ok: false, error, kind: "unexpected" }, { status });

/**
 * Returns a rejection Response when the request should not be served, or `null`
 * when it is fine to go ahead.
 */
export function rejectCrossOrigin(request: Request): Response | null {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return deny(415, "This endpoint only takes application/json.");
  }

  const origin = request.headers.get("origin");
  if (origin === null) return null; // not a browser-initiated cross-site POST

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return deny(403, "That request came from somewhere this app doesn't answer.");
  }

  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (originHost !== host) {
    return deny(403, "That request came from somewhere this app doesn't answer.");
  }

  return null;
}
