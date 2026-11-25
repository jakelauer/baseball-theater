-- S219: hides every path-only owed purge (`/api/v1/…`, owed by S161's win-probability fill) from a Worker from before
-- S161, which lists owed purges by `retry_at` alone and sends what it lists as it is, a batch the edge refuses. Each
-- such row's retry time moves to the new `path_retry_at` (where the current Worker reads it), and its `retry_at` becomes
-- 'infinity', which `retry_at::timestamptz <= now` never reaches. The new column is nullable with no default, so adding
-- it rewrites no row; the UPDATE touches only path-only rows. The lock timeout comes first: a lock
-- this can't get in 5 seconds fails the deploy, which is re-run, rather than queueing the cron's reads behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "owed_edge_purges" ADD COLUMN "path_retry_at" text;
--> statement-breakpoint
UPDATE "owed_edge_purges" SET "path_retry_at" = "retry_at", "retry_at" = 'infinity' WHERE starts_with("url", '/');
