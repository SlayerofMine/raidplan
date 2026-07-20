CREATE TABLE `attacks` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attacks_encounter_idx` ON `attacks` (`encounter_id`);