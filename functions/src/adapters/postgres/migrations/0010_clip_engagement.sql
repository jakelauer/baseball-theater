-- S174: anonymous daily counts of clips started and finished, one row per clip (media_id), game, UTC day, event and
-- place in the game's ranked Videos list (shown_position, 0 when opened directly); count is the only other column, and
-- nothing here says who watched.
CREATE TABLE "clip_engagement" (
	"media_id" text NOT NULL,
	"game_pk" integer NOT NULL,
	"view_day" text NOT NULL,
	"event" text NOT NULL,
	"shown_position" integer NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "clip_engagement_game_pk_media_id_view_day_event_shown_position_pk" PRIMARY KEY("game_pk","media_id","view_day","event","shown_position"),
	CONSTRAINT "clip_engagement_view_day_format" CHECK ("clip_engagement"."view_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "clip_engagement_event" CHECK ("clip_engagement"."event" IN ('start', 'complete')),
	CONSTRAINT "clip_engagement_shown_position" CHECK ("clip_engagement"."shown_position" BETWEEN 0 AND 100),
	CONSTRAINT "clip_engagement_count" CHECK ("clip_engagement"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX "clip_engagement_view_day" ON "clip_engagement" USING btree ("view_day");