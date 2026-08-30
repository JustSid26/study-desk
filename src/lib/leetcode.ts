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
  // agrees with the days your own solves are recorded under.
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

/* -------------------------------------------------------------------------
 * Problem detail — for the in-app problem screen
 * ---------------------------------------------------------------------- */

export interface QuestionDetail {
  questionId: string;
  number: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  /** raw HTML — sanitise at render time, never store pre-sanitised */
  content: string;
  hints: string[];
  topicTags: string[];
  snippets: Record<string, string>;
  sampleTestCase: string;
  exampleTestcases: string;
  acRate: number | null;
  likes: number;
  dislikes: number;
}

const QUESTION_QUERY = `
query question($slug: String!) {
  question(titleSlug: $slug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    content
    hints
    likes
    dislikes
    stats
    sampleTestCase
    exampleTestcases
    topicTags { name }
    codeSnippets { langSlug code }
  }
}`;

export async function fetchQuestion(
  slug: string,
  creds: Credentials = {},
  signal?: AbortSignal,
): Promise<QuestionDetail> {
  const data = await gql<{
    question: {
      questionId: string;
      questionFrontendId: string;
      title: string;
      titleSlug: string;
      difficulty: string;
      content: string | null;
      hints: string[];
      likes: number;
      dislikes: number;
      stats: string;
      sampleTestCase: string | null;
      exampleTestcases: string | null;
      topicTags: Array<{ name: string }>;
      codeSnippets: Array<{ langSlug: string; code: string }> | null;
    } | null;
  }>(QUESTION_QUERY, { slug }, creds, signal);

  const q = data.question;
  if (!q) throw new LeetCodeError("No LeetCode problem with that name.", "no-such-user");

  let acRate: number | null = null;
  try {
    acRate = parseFloat(String(JSON.parse(q.stats).acRate).replace("%", ""));
    if (Number.isNaN(acRate)) acRate = null;
  } catch {
    /* stats is best-effort */
  }

  return {
    questionId: q.questionId,
    number: Number(q.questionFrontendId) || 0,
    slug: q.titleSlug,
    title: q.title,
    difficulty: (["Easy", "Medium", "Hard"].includes(q.difficulty)
      ? q.difficulty
      : "Medium") as QuestionDetail["difficulty"],
    content: q.content ?? "",
    hints: q.hints ?? [],
    topicTags: (q.topicTags ?? []).map((t) => t.name),
    snippets: Object.fromEntries((q.codeSnippets ?? []).map((s) => [s.langSlug, s.code])),
    sampleTestCase: q.sampleTestCase ?? "",
    exampleTestcases: q.exampleTestcases ?? "",
    acRate,
    likes: q.likes ?? 0,
    dislikes: q.dislikes ?? 0,
  };
}

/* -------------------------------------------------------------------------
 * Run and submit
 *
 * These are the site's own REST endpoints, not GraphQL. Both need the session
 * cookie AND an x-csrftoken header matching the csrftoken cookie, plus a referer
 * pointing at the problem page — LeetCode rejects the request otherwise.
 *
 * Both are asynchronous: they return an id, and the verdict is polled from
 * /submissions/detail/<id>/check/ until `state` becomes SUCCESS.
 * ---------------------------------------------------------------------- */

const BASE = "https://leetcode.com";

async function post(
  url: string,
  slug: string,
  body: unknown,
  creds: Credentials,
  signal?: AbortSignal,
): Promise<Response> {
  if (!creds.session) {
    throw new LeetCodeError(
      "Running and submitting need your LeetCode session cookie. Add it in Setup.",
      "unauthorised",
    );
  }
  const cookie = [`LEETCODE_SESSION=${creds.session}`];
  if (creds.csrf) cookie.push(`csrftoken=${creds.csrf}`);

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      origin: BASE,
      referer: `${BASE}/problems/${slug}/`,
      cookie: cookie.join("; "),
      ...(creds.csrf ? { "x-csrftoken": creds.csrf } : {}),
    },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
}

export interface JudgeResult {
  state: string;
  verdict: string;
  ok: boolean;
  /** compile/runtime error text, when the verdict is a failure */
  error: string | null;
  runtime: string | null;
  memory: string | null;
  totalCorrect: number | null;
  totalTestcases: number | null;
  /** Run Code only: what your code printed vs what was expected */
  codeAnswer: string[] | null;
  expectedAnswer: string[] | null;
  stdout: string | null;
  lastTestcase: string | null;
  raw: Record<string, unknown>;
}

function shapeJudge(d: Record<string, unknown>): JudgeResult {
  const msg = String(d.status_msg ?? "Unknown");
  const error =
    (d.compile_error as string) ??
    (d.runtime_error as string) ??
    (d.full_compile_error as string) ??
    (d.full_runtime_error as string) ??
    null;
  return {
    state: String(d.state ?? ""),
    verdict: msg,
    ok: msg === "Accepted",
    error,
    runtime: (d.status_runtime as string) ?? null,
    memory: (d.status_memory as string) ?? null,
    totalCorrect: (d.total_correct as number) ?? null,
    totalTestcases: (d.total_testcases as number) ?? null,
    codeAnswer: (d.code_answer as string[]) ?? null,
    expectedAnswer: (d.expected_code_answer as string[]) ?? null,
    stdout: Array.isArray(d.std_output_list)
      ? (d.std_output_list as string[]).filter(Boolean).join("\n")
      : ((d.std_output as string) ?? null),
    lastTestcase: (d.last_testcase as string) ?? null,
    raw: d,
  };
}

/** Poll the judge until it settles. LeetCode answers in a few seconds. */
export async function pollJudge(
  id: string,
  creds: Credentials,
  opts: { tries?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<JudgeResult> {
  const tries = opts.tries ?? 40;
  const cookie = [`LEETCODE_SESSION=${creds.session}`];
  if (creds.csrf) cookie.push(`csrftoken=${creds.csrf}`);

  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 900));
    const res = await fetch(`${BASE}/submissions/detail/${id}/check/`, {
      headers: { "user-agent": UA, referer: BASE, cookie: cookie.join("; ") },
      signal: opts.signal,
      cache: "no-store",
    });
    if (!res.ok) continue;
    const d = (await res.json()) as Record<string, unknown>;
    if (d.state === "SUCCESS") return shapeJudge(d);
  }
  throw new LeetCodeError(
    "LeetCode's judge didn't answer in time. The code may still have been submitted — check your profile.",
    "network",
  );
}

/** Run against the sample tests. Does NOT create a submission on your profile. */
export async function runCode(
  args: { slug: string; questionId: string; lang: string; code: string; input?: string },
  creds: Credentials,
  signal?: AbortSignal,
): Promise<JudgeResult> {
  const res = await post(
    `${BASE}/problems/${args.slug}/interpret_solution/`,
    args.slug,
    {
      lang: args.lang,
      question_id: args.questionId,
      typed_code: args.code,
      data_input: args.input ?? "",
    },
    creds,
    signal,
  );

  if (!res.ok) {
    throw new LeetCodeError(
      res.status === 403
        ? "LeetCode rejected the request — your session cookie has probably expired. Paste a fresh one in Setup."
        : `LeetCode returned HTTP ${res.status} when running the code.`,
      res.status === 403 ? "unauthorised" : "unexpected",
    );
  }

  const body = (await res.json()) as { interpret_id?: string };
  if (!body.interpret_id) {
    throw new LeetCodeError("LeetCode didn't start a run. Try again in a moment.", "unexpected");
  }
  return pollJudge(body.interpret_id, creds, { signal });
}

/**
 * Submit for real. This DOES appear on your LeetCode profile, including a
 * failure — callers should make that obvious before firing it.
 */
export async function submitCode(
  args: { slug: string; questionId: string; lang: string; code: string },
  creds: Credentials,
  signal?: AbortSignal,
): Promise<JudgeResult & { submissionId: string }> {
  const res = await post(
    `${BASE}/problems/${args.slug}/submit/`,
    args.slug,
    { lang: args.lang, question_id: args.questionId, typed_code: args.code },
    creds,
    signal,
  );

  if (res.status === 429) {
    throw new LeetCodeError(
      "LeetCode is rate-limiting submissions. Wait a minute and try again.",
      "rate-limited",
    );
  }
  if (!res.ok) {
    throw new LeetCodeError(
      res.status === 403
        ? "LeetCode rejected the submission — your session cookie has probably expired. Paste a fresh one in Setup."
        : `LeetCode returned HTTP ${res.status} on submit.`,
      res.status === 403 ? "unauthorised" : "unexpected",
    );
  }

  const body = (await res.json()) as { submission_id?: number | string };
  if (!body.submission_id) {
    throw new LeetCodeError("LeetCode didn't accept the submission. Try again.", "unexpected");
  }
  const id = String(body.submission_id);
  const verdict = await pollJudge(id, creds, { signal });
  return { ...verdict, submissionId: id };
}

/** LeetCode's language slug for our practice languages and the common ones. */
export const LANG_LABELS: Record<string, string> = {
  python3: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript",
  typescript: "TypeScript", golang: "Go", rust: "Rust", kotlin: "Kotlin",
  swift: "Swift", csharp: "C#", ruby: "Ruby", scala: "Scala", php: "PHP",
};
