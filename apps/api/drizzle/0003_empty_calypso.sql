CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`raid` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounters_slug_unique` ON `encounters` (`slug`);--> statement-breakpoint
CREATE INDEX `encounters_raid_idx` ON `encounters` (`raid`);