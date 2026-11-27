-- S209: the players BT has seen and their FanGraphs and Baseball-Reference ids (`player_ids`), resolved lazily by
-- the cron, with the index its resolve step orders by; the seeding pass's one-row keyset cursor (no row until the
-- pass's first page, which writes it); and each account's stats site, its constant default added without rewriting a row, so a row written before reads
-- 'mlb'. The lock timeout comes first: a lock this can't get in 5 seconds fails the deploy, which is re-run, rather
-- than queueing settings reads behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "player_id_seed_cursor" (
	"id" integer PRIMARY KEY NOT NULL,
	"official_date" text NOT NULL,
	"game_pk" integer NOT NULL,
	CONSTRAINT "player_id_seed_cursor_one_row" CHECK ("player_id_seed_cursor"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "player_ids" (
	"person_id" integer PRIMARY KEY NOT NULL,
	"checked_at" text,
	"fangraphs_id" text,
	"bbref_id" text
);
--> statement-breakpoint
ALTER TABLE "account_settings" ADD COLUMN "stats_provider" text DEFAULT 'mlb' NOT NULL;
--> statement-breakpoint
CREATE INDEX "player_ids_checked_at" ON "player_ids" USING btree ("checked_at" NULLS FIRST);
