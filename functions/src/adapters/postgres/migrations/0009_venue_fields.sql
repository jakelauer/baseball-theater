-- S105: each ballpark's field drawing, by MLB venue id: Savant's SVG after sanitizeFieldSvg, or null when BT asked and
-- got none; fetched_at (ISO) is when BT asked, the row's version.
CREATE TABLE "venue_fields" (
	"venue_id" integer PRIMARY KEY NOT NULL,
	"svg" text,
	"fetched_at" text NOT NULL
);
