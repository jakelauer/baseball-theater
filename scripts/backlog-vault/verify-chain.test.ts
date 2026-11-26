/**
 * Law P8 (docs/v3/LAWS.md; S81, S85): `pnpm verify` starts no browser — Playwright
 * runs only through `pnpm design:capture` and S62's flows, never in the gate every
 * commit passes. Owner, 2026-10-28: "Yes: P1, P3, P5, P8".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	browserSteps, browserTasks, graphTasks, verifyChain,
} from "./verify-chain.ts";

const scripts = (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> }).scripts;

describe("pnpm verify starts no browser (law P8)", () =>
{
	it("no script in the verify chain runs playwright, design:capture or e2e/", () =>
	{
		expect(verifyChain(scripts).has("verify:run")).toBe(true);
		expect(browserSteps(scripts)).toEqual([]);
	});

	it("no task in the graph pnpm verify runs starts Playwright or Lighthouse (ADR-030)", () =>
	{
		const tasks = graphTasks();
		expect(tasks.some((t) => t.taskId === "@bt/e2e#test")).toBe(true);
		expect(browserTasks(tasks, scripts)).toEqual([]);
	}, 60_000);

	it("catches a task that runs Playwright", () =>
	{
		expect(browserTasks([{
			taskId: "@bt/e2e#test",
			command: "playwright test",
		}], {})).toEqual(["@bt/e2e#test"]);
	});

	it("catches a task whose command runs a root script that starts a browser (S168's pre-PR review)", () =>
	{
		// web's `size` task is `pnpm -w run size`: the command that runs is the root script's.
		expect(browserTasks([{
			taskId: "@bt/web#size",
			command: "pnpm -w run size",
		}], {
			size: "pnpm run measure",
			measure: "lhci autorun",
		})).toEqual(["@bt/web#size"]);
		expect(browserTasks([{
			taskId: "@bt/web#size",
			command: "pnpm -w run size",
		}], {
			size: "pnpm -w run size",
		})).toEqual([]);
	});

	it("catches a playwright step reached through the chain", () =>
	{
		expect(browserSteps({
			verify: "pnpm lint && pnpm e2e",
			lint: "eslint .",
			e2e: "playwright test --config e2e/playwright.config.ts",
		})).toEqual(["e2e"]);
	});

	it("catches a Lighthouse CI step too (S62)", () =>
	{
		expect(browserSteps({
			verify: "pnpm lint && pnpm lighthouse",
			lint: "eslint .",
			lighthouse: "cd e2e && lhci autorun --config=../lighthouserc.json",
		})).toEqual(["lighthouse"]);
	});
});
