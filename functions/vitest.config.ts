import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "functions",
		environment: "node",
		include: ["src/**/*.test.ts"],
		// `*.workerd.test.ts` run inside workerd under vitest.workers.config.ts (S45).
		exclude: ["src/**/*.workerd.test.ts"],
		// One migrated PGlite per run, copied for each test file instead of migrating per file
		// (src/test/pglite-snapshot.ts).
		globalSetup: ["./src/test/pglite-snapshot.ts"],
		setupFiles: ["./src/test/use-pglite-snapshot.ts"],
		// Many tests build their own migrated PGlite (S51): ~1 s locally, but 5–6 s on a loaded
		// 2-core CI runner, which the 5 s default timed out (live.test.ts, worker-app.test.ts).
		// No test asserts on speed; this only stops slow setup reading as a failure.
		testTimeout: 20_000,
		// The same for `beforeAll(useNodeDatabase)` hooks, which build that PGlite: the 10 s default timed
		// out when two worktrees' `pnpm verify` ran at once (#116).
		hookTimeout: 20_000,
		// Vitest starts a fork per core but one, and Turborepo runs this suite beside web's, so two worktrees'
		// gates started ~68 workers on 18 cores; that start-up burst slowed a migrated PGlite from ~0.5 s to
		// 4–9 s. Four each let two gates pass at once (~75 s) and a solo run is no slower (58 s vs 63 s) (#116).
		// At most four, and never more than Vitest's own default (a core but one), which a bare number
		// would override: on a 4-core CI runner that stays 3.
		maxWorkers: Math.min(4, Math.max(availableParallelism() - 1, 1)),
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/*.d.ts",
				"src/local-server.ts",
				"src/scripts/**",
			],
			// S152: a CI shard job (`BT_COVERAGE_SHARD`, set only there) holds part of the suite, so its
			// coverage is partial and would fail these floors; the merge job checks them on the merged
			// shards' coverage instead, so they mean what they always have.
			thresholds: process.env.BT_COVERAGE_SHARD ? undefined : {
				// Ratchet (S54, ADR-026; backlog rule 21): floors sit at the measured value
				// rounded down and only ever go up. Measured 2026-10-20: lines 80.01, functions 87.77, branches 78.21, statements 80.01.
				// Raised 2026-10-23 by S46 (repository contract + versioning tests; S44's gain folded in):
				// lines 82.45, functions 90, branches 80.04, statements 82.45. Target: 85 lines / 80 branches.
				// Raised 2026-10-23 by S8 (session, sign-in and /me tests): lines 87.99, functions 92.53, branches 82.61,
				// statements 87.99. Target met: 85 lines / 80 branches.
				// Raised 2026-10-24 by S77 (S76's lag folded in; export/delete, deletion log and manifest tests):
				// lines 89.85, branches 85.54, statements 89.85.
				// Raised 2026-10-24 by S6 (settings routes, repository and deletion case (i)): lines 90.26, functions 93.4,
				// branches 85.98, statements 90.26.
				// Raised 2026-10-28 by S80 (download routes, stores and mailer; S6's branch lag folded in): lines 91.33,
				// functions 94.58, branches 86.57, statements 91.33.
				// Raised 2026-10-29 by S63 (live fixture, mapLive, the HTTP client's recorded-fixture
				// test and the box score / recap mappers): lines 95.62, functions 95.08, statements 95.62.
				// Raised 2026-10-29 by S65 (scoreboard summary mappers, folded summaries, schedule route): lines 96.04,
				// branches 88.36, statements 96.04.
				// Raised 2026-11-07 by S120 (sign-in hardening's tests; S116's Logto adapters folded in): lines 97.25,
				// functions 96.43, statements 97.25.
				// Raised 2026-11-23 by S194 (the schedule month record, refresh and versioned month route, with earlier lag
				// folded in): lines 98.04, functions 97.09, statements 98.04.
				lines: 98,
				functions: 97,
				// Raised 2026-10-29 by S87 (deletion cookie and cookie-law tests): branches 87.18.
				// Raised 2026-10-30 by S67 (S45's Worker composition and S69's keyword mapping folded in): branches 89.62.
				// Raised 2026-10-30 by S48 (the per-game ingest object, hub leases and their tests): branches 90.62.
				// Raised 2026-10-30 by S18 (the live hub, its route and their tests): branches 91.19.
				// Raised 2026-11-07 by S120: branches 92.28.
				// Raised 2026-11-23 by S194: branches 93.74.
				// Raised 2026-11-24 by S212 (past, finished reads, the edge purge, the recent-game re-check): branches 94.13.
				branches: 94,
				statements: 98,
			},
		},
	},
});
