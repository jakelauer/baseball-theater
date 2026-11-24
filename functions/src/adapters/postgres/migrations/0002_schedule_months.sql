CREATE TABLE "schedule_months" (
	"month" text PRIMARY KEY NOT NULL,
	"checked_at" text,
	"claimed_at" text,
	CONSTRAINT "schedule_months_month_format" CHECK ("schedule_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
