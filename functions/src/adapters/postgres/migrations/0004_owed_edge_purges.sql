CREATE SEQUENCE "public"."owed_edge_purges_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "owed_edge_purges" (
	"url" text PRIMARY KEY NOT NULL,
	"owed_at" text NOT NULL,
	"version" bigint DEFAULT nextval('owed_edge_purges_version_seq') NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_at" text
);
