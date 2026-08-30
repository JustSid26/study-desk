/**
 * The in-app problem screen: the statement on the left, an editor wired to
 * LeetCode's judge on the right.
 *
 * The description is cached in `question_cache` for a week (see
 * `./question.ts`), so opening a problem you looked at yesterday costs nothing
 * and still works with the network down. The HTML is stored raw and sanitised
 * here, at render time — caching a sanitised copy would bake today's allowlist
 * into the database and quietly keep whatever a laxer version once let through.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";

import { db } from "@/db";
import { drafts, submissions } from "@/db/schema";
import { LANG_LABELS, problemUrl } from "@/lib/leetcode";
import { formatFullDay, relativeTime } from "@/lib/dates";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Empty,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { Solver } from "@/components/solver";

import { DifficultyChip } from "../bits";
import { loadQuestion } from "./question";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 5;

/**
 * LeetCode's statement HTML. Everything outside this list is discarded — which
 * includes every `on*` handler, since an attribute that isn't named here cannot
 * survive — and script/style/iframe lose their contents too, not just their
 * tags. Images may only load over https.
 */
const CONTENT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "pre", "code", "ul", "ol", "li",
    "strong", "em", "b", "i", "sup", "sub",
    "img", "br", "hr",
    "table", "thead", "tbody", "tr", "th", "td",
    "blockquote", "span", "div", "font",
  ],
  allowedAttributes: {
    img: ["src", "alt", "width", "height"],
    code: ["class"],
    span: ["class"],
    div: ["class"],
    font: ["face"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["https"],
  allowedSchemesByTag: { img: ["https"] },
  allowedSchemesAppliedToAttributes: ["src", "href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed"],
};

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();

  const [loaded, draftRows, history] = await Promise.all([
    loadQuestion(slug),
    db.select().from(drafts).where(eq(drafts.slug, slug)),
    db
      .select()
      .from(submissions)
      .where(eq(submissions.slug, slug))
      .orderBy(desc(submissions.createdAt))
      .limit(HISTORY_LIMIT),
  ]);

  if (!loaded.ok) return <NotReachable slug={slug} message={loaded.error} />;

  const { view, topics, stale } = loaded;
  const url = problemUrl(slug);
  const html = sanitizeHtml(view.content, CONTENT_OPTIONS);

  const draftMap: Record<string, string> = {};
  let newestDraft: { lang: string; updatedAt: number } | null = null;
  for (const d of draftRows) {
    draftMap[d.lang] = d.code;
    if (!newestDraft || d.updatedAt > newestDraft.updatedAt) {
      newestDraft = { lang: d.lang, updatedAt: d.updatedAt };
    }
  }

  return (
    <>
      <PageHeader
        title={`${view.number}. ${view.title}`}
        sub={
          <>
            <span>Solve it here — Run and Submit go to LeetCode&rsquo;s own judge.</span>
            {stale ? (
              <span className="mt-1 block text-ink-3">
                {stale} Saved {relativeTime(view.fetchedAt)}.
              </span>
            ) : null}
          </>
        }
      >
        <LinkButton href="/leetcode">All problems</LinkButton>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2.5">
                <DifficultyChip difficulty={view.difficulty} />
                {view.acRate != null ? (
                  <span className="font-mono text-[11.5px] tabular-nums text-ink-3">
                    {view.acRate.toFixed(1)}% accepted
                  </span>
                ) : null}
              </div>
              <span className="lbl">#{view.number}</span>
            </CardHeader>

            {topics.length ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-4 py-3">
                {topics.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            ) : null}

            <CardBody>
              {html ? (
                <div
                  className="prose-note max-w-none"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <p className="text-[13px] leading-relaxed text-ink-2">
                  LeetCode didn&rsquo;t return a description for this problem — it is
                  probably premium-only. The editor still works if you know the
                  signature.
                </p>
              )}

              {view.hints.length ? (
                <div className="mt-5 flex flex-col gap-1.5">
                  <span className="lbl">
                    {view.hints.length} {view.hints.length === 1 ? "hint" : "hints"}
                  </span>
                  {view.hints.map((hint, i) => (
                    <details
                      key={i}
                      className="rounded-[8px] border border-line bg-surface-3 px-3 py-2"
                    >
                      <summary className="cursor-pointer text-[12.5px] font-medium text-ink-2">
                        Hint {i + 1}
                      </summary>
                      <div
                        className="prose-note mt-2 max-w-none text-[14.5px]"
                        dangerouslySetInnerHTML={{
                          __html: sanitizeHtml(hint, CONTENT_OPTIONS),
                        }}
                      />
                    </details>
                  ))}
                </div>
              ) : null}
            </CardBody>

            <div className="border-t border-line-soft px-4 py-3">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12.5px] font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-accent"
              >
                Open {view.title} on leetcode.com
              </a>
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Solver
            slug={slug}
            questionId={view.questionId}
            title={view.title}
            snippets={view.snippets}
            sampleTestCase={view.sampleTestCase}
            initialDrafts={draftMap}
            initialLang={newestDraft?.lang ?? null}
            langLabels={LANG_LABELS}
          />

          <Card>
            <CardHeader>
              <h2 className="text-[15px] font-semibold text-ink">Your submissions</h2>
              <span className="lbl">Newest first</span>
            </CardHeader>
            {history.length ? (
              <ul className="divide-y divide-line-soft">
                {history.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-[13px] font-medium text-ink">{s.verdict}</span>
                      <span
                        className="font-mono text-[11.5px] tabular-nums text-ink-3"
                        title={formatFullDay(s.day)}
                      >
                        {relativeTime(s.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
                      <span>{LANG_LABELS[s.lang] ?? s.lang}</span>
                      {s.runtime ? <span>{s.runtime}</span> : null}
                      {s.verdict !== "Accepted" && s.totalTestcases != null ? (
                        <span className="font-mono tabular-nums">
                          {s.totalCorrect ?? 0}/{s.totalTestcases} testcases
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing submitted yet">
                Every submit from this screen is recorded here, accepted or not, so the
                history stays honest about which problems fought back.
              </Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ------------------------------- error state ------------------------------- */

function NotReachable({ slug, message }: { slug: string; message: string }) {
  return (
    <>
      <PageHeader title="Problem unavailable" sub={slug} />
      <Card>
        <CardBody>
          <p role="alert" className="text-[13px] leading-relaxed">
            {message}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Nothing is cached for this problem yet, so there is no saved copy to fall
            back on. Retry once you&rsquo;re back online, or open it on leetcode.com.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* A plain anchor, not a Link: the point is to re-run the fetch. */}
            <LinkButton variant="primary" href={`/leetcode/${slug}`}>
              Retry
            </LinkButton>
            <LinkButton href={problemUrl(slug)} target="_blank" rel="noopener noreferrer">
              Open on leetcode.com
            </LinkButton>
            <Link
              href="/leetcode"
              className="text-[12.5px] font-medium text-accent underline underline-offset-2"
            >
              Back to all problems
            </Link>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
