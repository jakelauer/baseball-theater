import { defineConfig } from "vitest/config";

// The spec selector's unit tests (S152), e2e's `test` task in `pnpm verify` (ADR-030). Only
// that one file: every `*.spec.ts` here starts a browser, which `pnpm verify` never does (law P8).
export default defineConfig({
	test: {
		coverage: {
			// Floors (law L6; S168 made this a unit): the measured value rounded down, ratchet only.
			// Measured 2026-11-26: lines 22.45, branches 94.44, functions 92.85, statements 22.45.
			thresholds: {
				lines: 22,
				branches: 94,
				functions: 92,
				statements: 22,
			},
		},
		root: import.meta.dirname,
		include: ["select-specs.test.ts"],
	},
});
