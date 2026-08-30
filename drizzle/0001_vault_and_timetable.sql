-- Notes move out of the database and onto the filesystem: a subject is now a
-- real directory under data/subjects, and a note is a real file inside it.
-- Study-time sessions are dropped along with them.
DROP TABLE IF EXISTS `note_tags`;--> statement-breakpoint
DROP TABLE IF EXISTS `notes`;--> statement-breakpoint
DROP TABLE IF EXISTS `files`;--> statement-breakpoint
DROP TABLE IF EXISTS `sessions`;--> statement-breakpoint
DROP TABLE IF EXISTS `topics`;--> statement-breakpoint
DROP TABLE IF EXISTS `subjects`;--> statement-breakpoint

CREATE TABLE `timetable` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`title` text NOT NULL,
	`subject_path` text,
	`location` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE INDEX `timetable_day_idx` ON `timetable` (`weekday`,`starts_at`);--> statement-breakpoint

CREATE TABLE `question_cache` (
	`slug` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`hints` text DEFAULT '[]' NOT NULL,
	`snippets` text DEFAULT '{}' NOT NULL,
	`sample_test_case` text DEFAULT '' NOT NULL,
	`example_testcases` text DEFAULT '' NOT NULL,
	`ac_rate` real,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint

CREATE TABLE `drafts` (
	`slug` text NOT NULL,
	`lang` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`slug`, `lang`)
);--> statement-breakpoint

CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`lang` text NOT NULL,
	`code` text NOT NULL,
	`verdict` text DEFAULT 'Unknown' NOT NULL,
	`remote_id` text,
	`runtime` text,
	`memory` text,
	`total_correct` integer,
	`total_testcases` integer,
	`error_text` text,
	`day` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE INDEX `submissions_slug_idx` ON `submissions` (`slug`);--> statement-breakpoint
CREATE INDEX `submissions_day_idx` ON `submissions` (`day`);
