-- S161 (AC 4): only adds the column, nullable with no default, so it rewrites no row. Games stored before it get their
-- line from the separate fill step (`fillWinProbability`, which `migrateDatabaseAt` runs after migrating). The lock
-- timeout comes first: a lock this can't get in 5 seconds fails the deploy, which is re-run, rather than queueing every
-- read of the table behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "game_states" ADD COLUMN "win_probability" jsonb;
