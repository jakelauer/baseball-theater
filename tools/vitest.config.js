import { defineConfig } from "vitest/config";

// Tests for repo tooling (custom ESLint rules). Run by `pnpm test:tools`, part of `pnpm verify`.
export default defineConfig({
	test: {
		coverage: {
			// Floors (law L6; S168 made this a unit): the measured value rounded down, ratchet only.
			// Measured 2026-11-26: lines 93.52, branches 78.5, functions 92.85, statements 93.52.
			thresholds: {
				lines: 93,
				branches: 78,
				functions: 92,
				statements: 93,
			},
		},
		name: "tools",
		environment: "node",
		root: import.meta.dirname,
		include: ["**/*.test.js"],
		exclude: ["**/node_modules/**", "**/fixtures/**"],
	},
});
