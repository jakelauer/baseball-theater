-- S209: MLB's players and their FanGraphs and Baseball-Reference ids (`player_ids`), preseeded from the Chadwick
-- register and kept in step with it by the cron's per-file ETag sync, whose state is `player_register_files`; and
-- each account's stats site, its constant default added without rewriting a row, so a row written before reads
-- 'mlb'. The lock timeout comes first: a lock this can't get in 5 seconds fails the deploy, which is re-run, rather
-- than queueing settings reads behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "player_ids" (
	"person_id" integer PRIMARY KEY NOT NULL,
	"fangraphs_id" text,
	"bbref_id" text,
	"register_file" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_register_files" (
	"file" text PRIMARY KEY NOT NULL,
	"etag" text,
	"synced_at" text,
	"tried_at" text
);
--> statement-breakpoint
ALTER TABLE "account_settings" ADD COLUMN "stats_provider" text DEFAULT 'mlb' NOT NULL;