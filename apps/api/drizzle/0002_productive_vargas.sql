CREATE TABLE `icon_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`build` text,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `icons` (
	`id` text PRIMARY KEY NOT NULL,
	`file_data_id` integer,
	`display_name` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`url_56` text NOT NULL,
	`url_112` text NOT NULL,
	`content_hash` text NOT NULL,
	`source` text NOT NULL,
	`first_seen_build` text,
	`deprecated` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `icons_category_idx` ON `icons` (`category`);--> statement-breakpoint
CREATE INDEX `icons_deprecated_idx` ON `icons` (`deprecated`);