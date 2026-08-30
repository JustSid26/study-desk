import "server-only";

/**
 * LeetCode's public GraphQL endpoint.
 *
 * There is no official API and no documented schema. Everything here was
 * verified against the live endpoint; the queries are the same ones
 * leetcode.com's own frontend issues.
 *
 * Two modes:
 *
 *   PUBLIC   — username only. Gives aggregate solved counts by difficulty,
 *              per-topic counts, the submission calendar, and roughly the last
 *              20 accepted submissions. That is the entire public surface: there
 *              is deliberately no endpoint that lists everything a user solved.
 *
 *   SESSION  — your own LEETCODE_SESSION cookie. `questionList` then honours
 *              filters:{status:"AC"} and pages through your complete solved set,
 *              because the server resolves "solved" against the session's own
 *              account.
 *
 * The endpoint rejects cross-origin browser requests (405 to a CORS preflight,
 * no access-control-allow-origin), which is why every call here is server-side.
 */

const ENDPOINT = "https://leetcode.com/graphql";

/** LeetCode 403s a request with no plausible browser UA. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type SyncMode = "public" | "session";

export class LeetCodeError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "no-such-user"
      | "unauthorised"
      | "rate-limited"
      | "network"
      | "unexpected",
  ) {
    super(message);
    this.name = "LeetCodeError";
  }
}

export interface Credentials {
  session?: string | null;
  csrf?: string | null;
}

/** Read cookies from the environment; the UI can override per call. */
export function envCredentials(): Credentials {
  return {
    session: process.env.LEETCODE_SESSION || null,
    csrf: process.env.LEETCODE_CSRF || null,
  };
}

export const hasSession = (c: Credentials) => Boolean(c.session);

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  creds: Credentials = {},
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": UA,
    referer: "https://leetcode.com",
    origin: "https://leetcode.com",
  };

  if (creds.session) {
    const parts = [`LEETCODE_SESSION=${creds.session}`];
    if (creds.csrf) {
      parts.push(`csrftoken=${creds.csrf}`);
      headers["x-csrftoken"] = creds.csrf;
    }
    headers.cookie = parts.join("; ");
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal,
      cache: "no-store",
    });
  } catch {
    throw new LeetCodeError(
      "Couldn't reach leetcode.com. Check your connection and try again.",
      "network",
    );
  }

  if (res.status === 429) {
    throw new LeetCodeError(
      "LeetCode is rate-limiting the sync. Wait a few minutes and try again.",
      "rate-limited",
    );
  }
  if (res.status === 403) {
    throw new LeetCodeError(
      "LeetCode refused the request. Your session cookie has probably expired — paste a fresh one in Setup.",
      "unauthorised",
    );
  }
  if (!res.ok) {
    throw new LeetCodeError(
      `LeetCode returned HTTP ${res.status}.`,
      "unexpected",
    );
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    const msg = json.errors[0].message;
    if (/does not exist/i.test(msg)) {
      throw new LeetCodeError(
        "No LeetCode user with that username. Check the spelling — it's the name in your profile URL, not your email.",
        "no-such-user",
      );
    }
    throw new LeetCodeError(msg, "unexpected");
  }

  if (!json.data) throw new LeetCodeError("LeetCode returned no data.", "unexpected");
  return json.data;
}

/* -------------------------------------------------------------------------
 * Public profile — username only
 * ---------------------------------------------------------------------- */

export interface ProfileStats {
  username: string;
  realName: string | null;
  avatar: string | null;
  ranking: number | null;
  solved: { total: number; Easy: number; Medium: number; Hard: number };
  /** topic tag name -> problems solved */
  tagCounts: Record<string, number>;
  /** "YYYY-MM-DD" -> submissions that day */
  calendar: Record<string, number>;
}

const PROFILE_QUERY = `
query profile($u: String!) {
  matchedUser(username: $u) {
    username
    profile { realName userAvatar ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    tagProblemCounts {
      advanced { tagName problemsSolved }
      intermediate { tagName problemsSolved }
      fundamental { tagName problemsSolved }
    }
    userCalendar { submissionCalendar }
  }
}`;

interface RawProfile {
  matchedUser: {
    username: string;
    profile: { realName: string | null; userAvatar: string | null; ranking: number | null };
    submitStatsGlobal: { acSubmissionNum: Array<{ difficulty: string; count: number }> };
    tagProblemCounts: Record<
      "advanced" | "intermediate" | "fundamental",
      Array<{ tagName: string; problemsSolved: number }>
    > | null;
    userCalendar: { submissionCalendar: string | null } | null;
  } | null;
}

export async function fetchProfile(
  username: string,
  creds: Credentials = {},
  signal?: AbortSignal,
): Promise<ProfileStats> {
  const data = await gql<RawProfile>(PROFILE_QUERY, { u: username }, creds, signal);
  const u = data.matchedUser;
  if (!u) throw new LeetCodeError("No LeetCode user with that username.", "no-such-user");

  const solved = { total: 0, Easy: 0, Medium: 0, Hard: 0 };
  for (const row of u.submitStatsGlobal?.acSubmissionNum ?? []) {
    if (row.difficulty === "All") solved.total = row.count;
    else if (row.difficulty in solved) {
      solved[row.difficulty as "Easy" | "Medium" | "Hard"] = row.count;
    }
  }

  const tagCounts: Record<string, number> = {};
  const tp = u.tagProblemCounts;
  if (tp) {
    for (const group of [tp.fundamental, tp.intermediate, tp.advanced]) {
      for (const t of group ?? []) {
        if (t.problemsSolved > 0) tagCounts[t.tagName] = t.problemsSolved;
      }
    }
  }

  // submissionCalendar is a JSON string of { "<unix seconds>": count }.
  // The keys are UTC midnights; convert to a local calendar day so the heatmap
  // agrees with the days your own sessions were logged under.
  const calendar: Record<string, number> = {};
  const rawCal = u.userCalendar?.submissionCalendar;
  if (rawCal) {
    try {
      const parsed = JSON.parse(rawCal) as Record<string, number>;
      for (const [secs, count] of Object.entries(parsed)) {
        const d = new Date(Number(secs) * 1000);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
          d.getUTCDate(),
        ).padStart(2, "0")}`;
        calendar[key] = (calendar[key] ?? 0) + count;
      }
    } catch {
      /* a malformed calendar shouldn't fail the whole sync */
    }
  }

  return {
    username: u.username,
    realName: u.profile?.realName ?? null,
    avatar: u.profile?.userAvatar ?? null,
    ranking: u.profile?.ranking ?? null,
    solved,
    tagCounts,
    calendar,
  };
}

/* -------------------------------------------------------------------------
 * Recent accepted submissions — username only, capped at ~20 by LeetCode
 * ---------------------------------------------------------------------- */

export interface RecentSolve {
  title: string;
  slug: string;
  /** epoch ms */
  at: number;
  lang: string | null;
}

const RECENT_QUERY = `
query recent($u: String!, $n: Int!) {
  recentAcSubmissionList(username: $u, limit: $n) {
    title titleSlug timestamp lang
  }
}`;

export async function fetchRecentSolves(
  username: string,
  limit = 20,
  creds: Credentials = {},
  signal?: AbortSignal,
): Promise<RecentSolve[]> {
  const data = await gql<{
    recentAcSubmissionList: Array<{
      title: string;
      titleSlug: string;
      timestamp: string;
      lang: string | null;
    }> | null;
  }>(RECENT_QUERY, { u: username, n: limit }, creds, signal);

  return (data.recentAcSubmissionList ?? []).map((s) => ({
    title: s.title,
    slug: s.titleSlug,
    at: Number(s.timestamp) * 1000,
    lang: s.lang ?? null,
  }));
}

/* -------------------------------------------------------------------------
 * The problem catalogue — public, no auth, ~4,000 rows
 * ---------------------------------------------------------------------- */

export interface CatalogueItem {
  slug: string;
  number: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  paidOnly: boolean;
  topicTags: string[];
  acRate: number | null;
  /** only ever "ac" when the request carried a session cookie */
  status: string | null;
}

const LIST_QUERY = `
query problems($categorySlug: String!, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      acRate
      status
      topicTags { name }
    }
  }
}`;

interface RawList {
  problemsetQuestionList: {
    total: number;
    questions: Array<{
      questionFrontendId: string;
      title: string;
      titleSlug: string;
      difficulty: string;
      isPaidOnly: boolean;
      acRate: number | null;
      status: string | null;
      topicTags: Array<{ name: string }>;
    }>;
  } | null;
}

/**
 * Page through `questionList`.
 *
 * With `filters: {status: "AC"}` and a session cookie this returns exactly the
 * problems that account has solved — the complete-history path. Without a
 * cookie the same filter matches nothing (verified: total 0), because the
 * server has no account to resolve "solved" against.
 *
 * `onProgress` fires per page so a long sync can report as it goes.
 */
export async function fetchProblemList(
  opts: {
    filters?: Record<string, unknown>;
    pageSize?: number;
    max?: number;
    onProgress?: (loaded: number, total: number) => void;
  } = {},
  creds: Credentials = {},
  signal?: AbortSignal,
): Promise<CatalogueItem[]> {
  const pageSize = opts.pageSize ?? 100;
  const out: CatalogueItem[] = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    if (signal?.aborted) throw new LeetCodeError("Sync cancelled.", "network");

    const data = await gql<RawList>(
      LIST_QUERY,
      {
        categorySlug: "",
        limit: pageSize,
        skip,
        filters: opts.filters ?? {},
      },
      creds,
      signal,
    );

    const page = data.problemsetQuestionList;
    if (!page) break;
    total = Math.min(page.total, opts.max ?? Infinity);

    for (const q of page.questions) {
      out.push({
        slug: q.titleSlug,
        number: Number(q.questionFrontendId),
        title: q.title,
        difficulty: (["Easy", "Medium", "Hard"].includes(q.difficulty)
          ? q.difficulty
          : "Medium") as CatalogueItem["difficulty"],
        paidOnly: Boolean(q.isPaidOnly),
        topicTags: q.topicTags.map((t) => t.name),
        acRate: q.acRate ?? null,
        status: q.status ?? null,
      });
      if (out.length >= total) break;
    }

    opts.onProgress?.(out.length, total);

    if (page.questions.length === 0) break; // defensive: never spin forever
    skip += pageSize;

    // Be a polite client. This is someone's free API.
    if (skip < total) await new Promise((r) => setTimeout(r, 250));
  }

  return out;
}

/** The full public catalogue, for seeding the local problem table. */
export const fetchCatalogue = (
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) => fetchProblemList({ onProgress }, {}, signal);

/** Every problem the session's account has solved. Requires a session cookie. */
export async function fetchSolvedProblems(
  creds: Credentials,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CatalogueItem[]> {
  if (!hasSession(creds)) {
    throw new LeetCodeError(
      "Importing your full solved history needs your LeetCode session cookie. Add it in Setup, or sync with your username alone for totals only.",
      "unauthorised",
    );
  }
  const solved = await fetchProblemList(
    { filters: { status: "AC" }, onProgress },
    creds,
    signal,
  );

  // A stale cookie doesn't 403 — the server just treats you as anonymous and
  // returns an empty AC set. Say so plainly rather than reporting "0 imported".
  if (solved.length === 0) {
    throw new LeetCodeError(
      "LeetCode returned no solved problems, which usually means the session cookie has expired. Paste a fresh one in Setup.",
      "unauthorised",
    );
  }
  return solved;
}

/** Does this cookie still work? Used by Setup to show live status. */
export async function checkSession(
  creds: Credentials,
  signal?: AbortSignal,
): Promise<{ valid: boolean; username: string | null }> {
  if (!hasSession(creds)) return { valid: false, username: null };
  try {
    const data = await gql<{ userStatus: { isSignedIn: boolean; username: string | null } | null }>(
      `query { userStatus { isSignedIn username } }`,
      {},
      creds,
      signal,
    );
    return {
      valid: Boolean(data.userStatus?.isSignedIn),
      username: data.userStatus?.username ?? null,
    };
  } catch {
    return { valid: false, username: null };
  }
}

export const problemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;
