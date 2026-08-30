import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogue, problems, problemTags, settings } from "@/db/schema";
import { newId } from "./id";
import { dayKey } from "./dates";
import {
  fetchCatalogue,
  fetchProfile,
  fetchRecentSolves,
  fetchSolvedProblems,
  hasSession,
  problemUrl,
  type CatalogueItem,
  type Credentials,
  type SyncMode,
} from "./leetcode";

export interface SyncResult {
  mode: SyncMode;
  username: string;
  imported: number;
  updated: number;
  skipped: number;
  totals: { total: number; Easy: number; Medium: number; Hard: number };
  catalogueRows: number;
  /** set when we could only reach the public profile */
  limitation?: string;
}

/**
 * Refresh the local copy of LeetCode's public problem catalogue.
 * Cheap to re-run; upserts by slug so it never duplicates.
 */
export async function syncCatalogue(
  onProgress?: (loaded: number, total: number) => void,
): Promise<number> {
  const items = await fetchCatalogue(onProgress);
  if (!items.length) return 0;

  const fetchedAt = Date.now();
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    await db
      .insert(catalogue)
      .values(
        chunk.map((q) => ({
          slug: q.slug,
          number: q.number,
          title: q.title,
          difficulty: q.difficulty,
          paidOnly: q.paidOnly,
          topicTags: JSON.stringify(q.topicTags),
          acRate: q.acRate,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: catalogue.slug,
        set: {
          number: sql`excluded.number`,
          title: sql`excluded.title`,
          difficulty: sql`excluded.difficulty`,
          paidOnly: sql`excluded.paid_only`,
          topicTags: sql`excluded.topic_tags`,
          acRate: sql`excluded.ac_rate`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  await patchSettings({ catalogueSyncedAt: fetchedAt, catalogueCount: items.length });
  return items.length;
}

/** Read the singleton settings row, creating it on first use. */
export async function getSettings() {
  const rows = await db.select().from(settings).where(eq(settings.id, "singleton")).limit(1);
  if (rows.length) return rows[0];
  await db.insert(settings).values({ id: "singleton" }).onConflictDoNothing();
  const created = await db.select().from(settings).where(eq(settings.id, "singleton")).limit(1);
  return created[0];
}

export async function patchSettings(patch: Partial<typeof settings.$inferInsert>) {
  await getSettings();
  await db.update(settings).set(patch).where(eq(settings.id, "singleton"));
}

/**
 * Merge solved problems into the local table.
 *
 * The contract that makes re-syncing safe: LeetCode owns the *identity* of a
 * problem (number, title, difficulty, tags) and nothing else. Your `status`,
 * `minutes`, `lang`, `notes`, `confidence` and `attempts` are yours, and an
 * existing row keeps them. `solvedDay` is only ever set on insert, so a
 * re-sync doesn't rewrite your history to today and flatten the heatmap.
 */
async function mergeSolved<T extends CatalogueItem>(
  items: T[],
  solvedDayFor: (item: T) => string,
  source: "leetcode",
): Promise<{ imported: number; updated: number }> {
  if (!items.length) return { imported: 0, updated: 0 };

  const slugs = items.map((i) => i.slug);
  const existing = new Map<string, { id: string }>();
  for (let i = 0; i < slugs.length; i += 400) {
    const rows = await db
      .select({ id: problems.id, slug: problems.slug })
      .from(problems)
      .where(inArray(problems.slug, slugs.slice(i, i + 400)));
    rows.forEach((r) => existing.set(r.slug, { id: r.id }));
  }

  let imported = 0;
  let updated = 0;
  const now = Date.now();

  for (const item of items) {
    const prior = existing.get(item.slug);

    if (prior) {
      // Identity fields only — never touch the columns you own.
      await db
        .update(problems)
        .set({
          number: item.number,
          title: item.title,
          difficulty: item.difficulty,
          url: problemUrl(item.slug),
          updatedAt: now,
        })
        .where(eq(problems.id, prior.id));
      await replaceTags(prior.id, item.topicTags);
      updated++;
      continue;
    }

    const id = newId();
    await db.insert(problems).values({
      id,
      slug: item.slug,
      number: item.number,
      title: item.title,
      url: problemUrl(item.slug),
      difficulty: item.difficulty,
      status: "solved",
      solvedDay: solvedDayFor(item),
      source,
      createdAt: now,
      updatedAt: now,
    });
    await replaceTags(id, item.topicTags);
    imported++;
  }

  return { imported, updated };
}

async function replaceTags(problemId: string, tags: string[]) {
  await db.delete(problemTags).where(eq(problemTags.problemId, problemId));
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (clean.length) {
    await db
      .insert(problemTags)
      .values(clean.map((tag) => ({ problemId, tag })))
      .onConflictDoNothing();
  }
}

/**
 * The full sync.
 *
 * With a session cookie this imports every solved problem. Without one it still
 * records your totals, per-topic counts and calendar, and imports the ~20
 * recent solves LeetCode exposes publicly — then says plainly what it couldn't get.
 */
export async function syncLeetCode(
  username: string,
  creds: Credentials,
  opts: { refreshCatalogue?: boolean } = {},
): Promise<SyncResult> {
  const name = username.trim();
  if (!name) throw new Error("Add your LeetCode username first.");

  const profile = await fetchProfile(name, creds);

  let catalogueRows = 0;
  if (opts.refreshCatalogue) {
    catalogueRows = await syncCatalogue();
  }

  const mode: SyncMode = hasSession(creds) ? "session" : "public";
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let limitation: string | undefined;

  if (mode === "session") {
    const solved = await fetchSolvedProblems(creds);
    // LeetCode doesn't say *when* each problem was solved in this listing, so
    // recent solves supply real dates where we have them and everything else
    // lands on today. The heatmap reflects your own logged activity from here on.
    const recent = await fetchRecentSolves(name, 20, creds).catch(() => []);
    const dateBySlug = new Map(recent.map((r) => [r.slug, dayKey(r.at)]));
    const todayKey = dayKey();

    const res = await mergeSolved(
      solved,
      (item) => dateBySlug.get(item.slug) ?? todayKey,
      "leetcode",
    );
    imported = res.imported;
    updated = res.updated;

    if (imported && !dateBySlug.size) {
      limitation =
        "LeetCode doesn't publish the date you solved each problem, so imported solves are dated today. New solves you sync from now on keep their real date.";
    }
  } else {
    const recent = await fetchRecentSolves(name, 20, creds);
    const res = await mergeSolved(recent.map(toCatalogueItem), (i) => i.solvedDay, "leetcode");
    imported = res.imported;
    updated = res.updated;
    skipped = Math.max(0, profile.solved.total - recent.length);
    limitation =
      `Your public profile only exposes your ${recent.length} most recent solves, so ${skipped} earlier ones couldn't be imported. ` +
      "Add your LeetCode session cookie in Setup to import the full history.";
  }

  await patchSettings({
    leetcodeUsername: profile.username,
    lcTotalSolved: profile.solved.total,
    lcEasySolved: profile.solved.Easy,
    lcMediumSolved: profile.solved.Medium,
    lcHardSolved: profile.solved.Hard,
    lcCalendar: JSON.stringify(profile.calendar),
    lcSyncedAt: Date.now(),
    lcSyncMode: mode,
    lcLastError: null,
  });

  return {
    mode,
    username: profile.username,
    imported,
    updated,
    skipped,
    totals: profile.solved,
    catalogueRows,
    limitation,
  };
}

/** Recent-solve rows carry no difficulty; enrich from the local catalogue later. */
function toCatalogueItem(r: { title: string; slug: string; at: number }): CatalogueItem & {
  solvedDay: string;
} {
  return {
    slug: r.slug,
    number: 0,
    title: r.title,
    difficulty: "Medium",
    paidOnly: false,
    topicTags: [],
    acRate: null,
    status: "ac",
    solvedDay: dayKey(r.at),
  };
}

/**
 * Fill in number/difficulty/tags for any problem that arrived without them
 * (the public path) using the locally cached catalogue.
 */
export async function enrichFromCatalogue(): Promise<number> {
  const rows = await db
    .select({ id: problems.id, slug: problems.slug })
    .from(problems)
    .where(sql`${problems.number} IS NULL OR ${problems.number} = 0`);
  if (!rows.length) return 0;

  let fixed = 0;
  for (const row of rows) {
    const hit = await db
      .select()
      .from(catalogue)
      .where(eq(catalogue.slug, row.slug))
      .limit(1);
    if (!hit.length) continue;
    const c = hit[0];
    await db
      .update(problems)
      .set({
        number: c.number,
        title: c.title,
        difficulty: c.difficulty,
        updatedAt: Date.now(),
      })
      .where(eq(problems.id, row.id));
    await replaceTags(row.id, JSON.parse(c.topicTags) as string[]);
    fixed++;
  }
  return fixed;
}
