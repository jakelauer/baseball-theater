/**
 * The browser harness (S81; ADR-026 as amended 2026-10-28, backlog rule 22).
 * It runs the app the way `pnpm dev` does — fixture-backed API on :8787 and the
 * Vite app on :5173 — and opens it at the three host pairings. Desktop is
 * 1200px wide, where the app's layout host switches to the rail (owner,
 * 2026-10-28: "Capture at 1200px"), not the frames' 1008px.
 *
 * Not part of `pnpm verify`: browsers start only through `pnpm design:capture`
 * and S62's flows. `BT_E2E_OUTPUT` moves Playwright's own output (traces,
 * failure shots) out of the tree, which graders need (they may not write it).
 * `BT_WEB_PORT` (a worktree's `.env.worktree`, S156) moves the app off :5173, as it moves
 * Vite's dev server, so two checkouts can each run their own.
 */
import { defineConfig } from "@playwright/test";

/** Where `pnpm dev` serves the app: Vite's port, read the way `web/vite.config.ts` reads it. */
const APP_URL = `http://localhost:${process.env.BT_WEB_PORT ?? 5173}`;

export default defineConfig({
	testDir: ".",
	// Only the browser specs: the spec selector's unit tests (`select-specs.test.ts`, S152) sit in
	// this folder too and run under Vitest (`pnpm test:selector`), never in a browser.
	testMatch: "**/*.spec.ts",
	outputDir: process.env.BT_E2E_OUTPUT ?? "test-results",
	fullyParallel: false,
	// One worker for the design specs, which share the dev account and its settings; `pnpm e2e`
	// runs the flows with --workers=4 (S89), since each flow keeps its state in its own browser.
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: APP_URL,
	},
	webServer: {
		command: "pnpm dev",
		cwd: "..",
		url: APP_URL,
		reuseExistingServer: true,
		timeout: 60_000,
	},
	projects: [
		{
			name: "mobile",
			use: {
				viewport: {
					width: 390,
					height: 844,
				},
			},
		},
		{
			name: "medium",
			use: {
				viewport: {
					width: 768,
					height: 1024,
				},
			},
		},
		{
			name: "desktop",
			use: {
				viewport: {
					width: 1200,
					height: 844,
				},
			},
		},
	],
});
