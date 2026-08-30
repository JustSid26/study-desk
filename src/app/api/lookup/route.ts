import { or, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogue } from "@/db/schema";
import { problemUrl } from "@/lib/leetcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catalogue autocomplete for the "Log a problem" form: type a title or a
 * number, pick a row, and the problem arrives already carrying its number,
 * difficulty and topic tags.
 */

const LIMIT = 8;

/** LIKE treats % and _ as wildcards; a search box must not. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  // An empty box is not an error — it just has nothing to suggest yet.
  if (!q) return Response.json({ results: [] });

  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;

  const rows = await db
    .select()
    .from(catalogue)
    .where(
      or(
        sql`${catalogue.title} LIKE ${like} ESCAPE '\\'`,
        sql`${catalogue.slug} LIKE ${like} ESCAPE '\\'`,
        asNumber === null ? sql`0` : sql`${catalogue.number} = ${asNumber}`,
      ),
    )
    .orderBy(
      sql`CASE
            WHEN ${asNumber === null ? sql`NULL` : sql`${catalogue.number} = ${asNumber}`} THEN 0
            WHEN lower(${catalogue.title}) = lower(${q}) THEN 1
            WHEN ${catalogue.title} LIKE ${prefix} ESCAPE '\\' THEN 2
            ELSE 3
          END`,
      sql`length(${catalogue.title})`,
      catalogue.number,
    )
    .limit(LIMIT);

  return Response.json({
    results: rows.map((r) => ({
      slug: r.slug,
      number: r.number,
      title: r.title,
      difficulty: r.difficulty,
      paidOnly: r.paidOnly,
      acRate: r.acRate,
      tags: parseTags(r.topicTags),
      url: problemUrl(r.slug),
    })),
  });
}
