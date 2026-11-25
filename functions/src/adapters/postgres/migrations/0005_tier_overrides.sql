CREATE TABLE "tier_overrides" (
	"uid" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tier_overrides" ADD CONSTRAINT "tier_overrides_uid_users_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;