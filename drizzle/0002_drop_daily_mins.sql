-- Study-time tracking was removed in 0001; the goal that drove it outlived the
-- feature. Dropping it keeps the database matching src/db/schema.ts, so the next
-- `drizzle-kit generate` diffs against a truthful baseline.
ALTER TABLE `settings` DROP COLUMN `daily_mins`;
