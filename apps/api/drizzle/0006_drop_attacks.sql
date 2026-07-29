-- Reusable attacks are gone (plan §17-§19 removed). The table and its indexes
-- go with them.
--
-- Destructive on purpose: `doc` held the only copy of every stored `AttackDef`,
-- and nothing reads it any more. The definitions are recoverable only from the
-- `archive/attack-system` tag, not from a database that has run this.
--
-- Indexes are dropped first and explicitly. SQLite would drop them with the
-- table anyway, but naming them keeps this readable as the inverse of 0004/0005
-- and makes a partial run easy to reason about.
DROP INDEX IF EXISTS `attacks_encounter_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `attacks_plan_idx`;--> statement-breakpoint
DROP TABLE IF EXISTS `attacks`;
