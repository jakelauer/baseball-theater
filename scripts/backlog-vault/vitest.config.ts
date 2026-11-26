import { resolve } from "node:path";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			// The unit's root is backlog-vault/, so the two entry-point modules beside it (the local check's
			// narrowing and its ledger record, ADR-030 rules 7 and 9) are named here to fall under the floors.
			// With allowExternal, files are matched by absolute path, so each pattern is absolute, and the
			// default exclude's dot-folder pattern is dropped: a worktree lives under .claude/worktrees/, so
			// it would exclude every file and report 0/0, which passes any floor.
			allowExternal: true,
			include: [`${import.meta.dirname}/**/*.ts`, resolve(import.meta.dirname, "../verify-plan.ts"), resolve(import.meta.dirname, "../verify-record.ts")],
			exclude: coverageConfigDefaults.exclude.filter((p) => p !== "**/[.]**"),
			// Floors (law L6; S168 made this a unit): the measured value rounded down, ratchet only.
			// Measured 2026-11-26: lines 76.53, branches 89.57, functions 88, statements 76.53; with verify-plan.ts
			// and verify-record.ts counted (S168 pre-PR review): lines 76.56, branches 89.62, functions 88.16.
			thresholds: {
				lines: 76,
				branches: 89,
				functions: 88,
				statements: 76,
			},
		},
		root: import.meta.dirname,
		include: ["*.test.ts"],
		// Each test yields to the event loop afterwards, so long synchronous git and script calls can't
		// starve the worker's progress messages (test-setup.ts).
		setupFiles: ["./test-setup.ts"],
		// These tests run git, audit.sh and the debt scripts in temporary repositories; on a shared CI
		// runner one such test took 7.3 s, past Vitest's 5 s default (#298's CI).
		testTimeout: 30_000,
		// Their setup hooks build the same temporary repositories, and `pnpm verify` runs this suite beside
		// every other unit's tests at once: check-at-commit.test.ts's beforeAll passed Vitest's 10 s
		// hook default alone and hit it under that load (2026-11-21).
		hookTimeout: 30_000,
	},
});
