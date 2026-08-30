CREATE TABLE `catalogue` (
	`slug` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`paid_only` integer DEFAULT false NOT NULL,
	`topic_tags` text DEFAULT '[]' NOT NULL,
	`ac_rate` real,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_number_idx` ON `catalogue` (`number`);--> statement-breakpoint
CREATE INDEX `catalogue_difficulty_idx` ON `catalogue` (`difficulty`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`sha256` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `note_tags` (
	`note_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`note_id`, `tag`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_tags_tag_idx` ON `note_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`file_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_subject_idx` ON `notes` (`subject_id`);--> statement-breakpoint
CREATE INDEX `notes_updated_idx` ON `notes` (`updated_at`);--> statement-breakpoint
CREATE TABLE `problem_tags` (
	`problem_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`problem_id`, `tag`),
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_tags_tag_idx` ON `problem_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`number` integer,
	`title` text NOT NULL,
	`url` text,
	`difficulty` text DEFAULT 'Medium' NOT NULL,
	`status` text DEFAULT 'solved' NOT NULL,
	`solved_day` text NOT NULL,
	`minutes` integer,
	`lang` text,
	`notes` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`confidence` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_slug_idx` ON `problems` (`slug`);--> statement-breakpoint
CREATE INDEX `problems_day_idx` ON `problems` (`solved_day`);--> statement-breakpoint
CREATE INDEX `problems_status_idx` ON `problems` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text,
	`minutes` integer NOT NULL,
	`day` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_day_idx` ON `sessions` (`day`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`daily_mins` integer DEFAULT 90 NOT NULL,
	`daily_problems` integer DEFAULT 2 NOT NULL,
	`goal_easy` integer DEFAULT 150 NOT NULL,
	`goal_medium` integer DEFAULT 250 NOT NULL,
	`goal_hard` integer DEFAULT 75 NOT NULL,
	`revisit_days` integer DEFAULT 30 NOT NULL,
	`leetcode_username` text,
	`lc_total_solved` integer,
	`lc_easy_solved` integer,
	`lc_medium_solved` integer,
	`lc_hard_solved` integer,
	`lc_calendar` text,
	`lc_synced_at` integer,
	`lc_sync_mode` text,
	`lc_last_error` text,
	`catalogue_synced_at` integer,
	`catalogue_count` integer
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#275C4B' NOT NULL,
	`goal_mins` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_subject_idx` ON `topics` (`subject_id`);