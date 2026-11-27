import { describe, expect, it } from "vitest";
import config from "./vitest.config.js";

// B669 (#669): the type-aware ESLint rule tests build a TypeScript program on their first case, which on
// a push's full fresh run (every task in parallel on a shared runner) took past Vitest's default 5 s and
// turned `stage` red. Every other unit with slow tests sets its own timeout (functions 20 s, the backlog
// tool's 30 s); tools must too, so this pins it.
describe("tools' Vitest config (#669)", () =>
{
	it("gives each test at least 20 s, like the other units whose tests build programs or databases", () =>
	{
		expect(config.test.testTimeout).toBeGreaterThanOrEqual(20_000);
	});
});
