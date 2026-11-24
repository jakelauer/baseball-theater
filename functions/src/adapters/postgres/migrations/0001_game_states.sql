-- S150 (AC 3). Drizzle runs a database's pending migrations in one transaction, so every lock taken here is held to
-- its end. The lock timeout comes first, so it holds for every statement after it: a lock this migration can't get in
-- 5 seconds fails the deploy, which is then re-run, rather than queueing every read of the table behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "game_states" (
	"game_pk" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"feed_time" text,
	"official_date" text NOT NULL,
	"start_time" text,
	"document" jsonb NOT NULL,
	CONSTRAINT "game_states_source_check" CHECK ("game_states"."source" IN ('feed', 'schedule'))
);
--> statement-breakpoint
-- Every game a stored day lists gets its row from that day (its status, linescore and live moment, as the day stored
-- them), and for a game listed on several days (a suspended game, resumed later) the copy changed last. Each day's
-- document is read once (`jsonb_to_record`).
INSERT INTO "game_states" ("game_pk", "version", "source", "feed_time", "official_date", "start_time", "document")
SELECT DISTINCT ON ("game_pk") "game_pk", 1, 'schedule', NULL, "official_date", "start_time", "document"
FROM (
	SELECT (g->>'gamePk')::integer AS "game_pk",
		coalesce(g->>'officialDate', d."date") AS "official_date",
		g->>'startTime' AS "start_time",
		day."lastChangedAt" AS "changed",
		jsonb_build_object(
			'status', g->'status',
			'linescore', coalesce(g->'linescore', 'null'::jsonb),
			'live', coalesce(g->'live', 'null'::jsonb),
			'version', 1,
			'lastChangedAt', to_jsonb(day."lastChangedAt")
		) AS "document"
	FROM "schedule_days" d
	CROSS JOIN LATERAL jsonb_to_record(d."document") AS day("games" jsonb, "lastChangedAt" text)
	CROSS JOIN LATERAL jsonb_array_elements(day."games") g
	WHERE g->'status' IS NOT NULL
) listed
ORDER BY "game_pk", "changed" DESC NULLS LAST;
--> statement-breakpoint
-- A stored game's snapshot gives its row when no stored day lists the game, or when the day's copy isn't over and the
-- snapshot changed later (a day stored mid-game, its game finished since). A day's copy that is over (final, game
-- over, cancelled or forfeited: `F`, `O`, `C`, `Q`, `R`) is kept and its snapshot never read, which spares reading
-- nearly every stored game; a postponed (`D`) or suspended (`T`/`U`) copy isn't over, since the game may have been
-- played later under the same gamePk. A later scoring correction a final day copy missed is mended by the next schedule
-- refresh of that day, which the schedule owns after the game's window. Each snapshot is read once (`jsonb_to_record`).
-- The snapshot's moment has no names; the count comes from its linescore.
INSERT INTO "game_states" ("game_pk", "version", "source", "feed_time", "official_date", "start_time", "document")
SELECT gm."game_pk", 1, 'feed', NULL, gm."official_date", doc."startTime",
	jsonb_build_object(
		'status', doc."status",
		'linescore', coalesce(doc."linescore", 'null'::jsonb),
		'live', CASE WHEN jsonb_typeof(doc."live") = 'object' THEN doc."live" || jsonb_build_object(
			'batterName', 'null'::jsonb,
			'pitcherName', 'null'::jsonb,
			'balls', coalesce(doc."linescore"->'balls', 'null'::jsonb),
			'strikes', coalesce(doc."linescore"->'strikes', 'null'::jsonb),
			'outs', coalesce(doc."linescore"->'outs', 'null'::jsonb)
		) ELSE 'null'::jsonb END,
		'version', 1,
		'lastChangedAt', to_jsonb(doc."lastChangedAt")
	)
FROM "games" gm
CROSS JOIN LATERAL jsonb_to_record(gm."document") AS doc("status" jsonb, "linescore" jsonb, "live" jsonb, "startTime" text, "lastChangedAt" text)
WHERE NOT EXISTS (
	SELECT 1 FROM "game_states" s
	WHERE s."game_pk" = gm."game_pk" AND upper(s."document"->'status'->>'codedGameState') IN ('F', 'O', 'C', 'Q', 'R')
)
ON CONFLICT ("game_pk") DO UPDATE SET
	"source" = excluded."source",
	"official_date" = excluded."official_date",
	"start_time" = COALESCE(excluded."start_time", "game_states"."start_time"),
	"document" = excluded."document"
WHERE excluded."document"->>'lastChangedAt' > "game_states"."document"->>'lastChangedAt';
--> statement-breakpoint
-- Last, so `schedule_days` is held under its exclusive lock only for this, never while the fills above read.
ALTER TABLE "schedule_days" ADD COLUMN "served_base" integer DEFAULT 0 NOT NULL;
