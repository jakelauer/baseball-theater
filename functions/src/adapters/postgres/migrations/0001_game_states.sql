CREATE TABLE "game_states" (
	"game_pk" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"feed_time" text,
	"official_date" text NOT NULL,
	"start_time" text,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_days" ADD COLUMN "served_base" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- S150 AC 3: every game a stored day lists gets its row from that day (its status, linescore and live moment, as the
-- day stored them), and for a game listed on several days (a suspended game, resumed later) the copy changed last.
INSERT INTO "game_states" ("game_pk", "version", "source", "feed_time", "official_date", "start_time", "document")
SELECT DISTINCT ON ("game_pk") "game_pk", 1, 'schedule', NULL, "official_date", "start_time", "document"
FROM (
	SELECT (g->>'gamePk')::integer AS "game_pk",
		coalesce(g->>'officialDate', d."date") AS "official_date",
		g->>'startTime' AS "start_time",
		d."document"->>'lastChangedAt' AS "changed",
		jsonb_build_object(
			'status', g->'status',
			'linescore', coalesce(g->'linescore', 'null'::jsonb),
			'live', coalesce(g->'live', 'null'::jsonb),
			'version', 1,
			'lastChangedAt', d."document"->'lastChangedAt'
		) AS "document"
	FROM "schedule_days" d, jsonb_array_elements(d."document"->'games') g
	WHERE g->'status' IS NOT NULL
) listed
ORDER BY "game_pk", "changed" DESC NULLS LAST;
--> statement-breakpoint
-- A stored game no stored day lists gets its row from its snapshot, so no stored game loses its score. The snapshot's
-- moment has no names; the count comes from its linescore.
INSERT INTO "game_states" ("game_pk", "version", "source", "feed_time", "official_date", "start_time", "document")
SELECT gm."game_pk", 1, 'feed', NULL, gm."official_date", gm."document"->>'startTime',
	jsonb_build_object(
		'status', gm."document"->'status',
		'linescore', coalesce(gm."document"->'linescore', 'null'::jsonb),
		'live', CASE WHEN jsonb_typeof(gm."document"->'live') = 'object' THEN gm."document"->'live' || jsonb_build_object(
			'batterName', 'null'::jsonb,
			'pitcherName', 'null'::jsonb,
			'balls', coalesce(gm."document"->'linescore'->'balls', 'null'::jsonb),
			'strikes', coalesce(gm."document"->'linescore'->'strikes', 'null'::jsonb),
			'outs', coalesce(gm."document"->'linescore'->'outs', 'null'::jsonb)
		) ELSE 'null'::jsonb END,
		'version', 1,
		'lastChangedAt', gm."document"->'lastChangedAt'
	)
FROM "games" gm
ON CONFLICT ("game_pk") DO NOTHING;
