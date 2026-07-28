-- Attack scope (plan §19.1): `encounter_id` becomes nullable and `plan_id`
-- joins it, with a CHECK that exactly one is set.
--
-- SQLite cannot relax NOT NULL in place, so this is the standard rebuild. Two
-- deviations from what drizzle-kit generated, both necessary:
--   * the SELECT reads `plan_id` as NULL rather than from the old table, which
--     has no such column yet — every existing row is an encounter's attack, and
--     that is exactly what NULL says here;
--   * the CHECK names its columns unqualified, so it survives the RENAME
--     without carrying `__new_attacks` in its stored text.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attacks` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text,
	`plan_id` text,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attacks_one_scope" CHECK((`encounter_id` is null) <> (`plan_id` is null))
);
--> statement-breakpoint
INSERT INTO `__new_attacks`("id", "encounter_id", "plan_id", "name", "version", "doc", "created_at", "updated_at") SELECT "id", "encounter_id", NULL, "name", "version", "doc", "created_at", "updated_at" FROM `attacks`;--> statement-breakpoint
DROP TABLE `attacks`;--> statement-breakpoint
ALTER TABLE `__new_attacks` RENAME TO `attacks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attacks_encounter_idx` ON `attacks` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `attacks_plan_idx` ON `attacks` (`plan_id`);
