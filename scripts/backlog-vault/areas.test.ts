/**
 * Areas and milestones (S165 AC 4): one pure {@link areaOf} from a story's recorded scope, and a done
 * story's milestone from the first published release containing its shipping commit, with the
 * containment check injected (no fixed commits from git history: CI's checkout is shallow).
 */
import {
	describe, expect, it,
} from "vitest";
import type { CachedIssue } from "./github.ts";
import {
	areaOf, milestoneFor, planAreas,
} from "./areas.ts";

describe("areaOf", () =>
{
	it("a web or e2e path is area:web", () =>
	{
		expect(areaOf(["web/src/routes.tsx", "docs/v3/backlog/"])).toBe("area:web");
		expect(areaOf(["e2e/game.spec.ts"])).toBe("area:web");
	});

	it("a functions or packages path is area:api", () =>
	{
		expect(areaOf(["functions/src/handlers/api.ts"])).toBe("area:api");
		expect(areaOf(["packages/domain/src/"])).toBe("area:api");
	});

	it("an ingest, mlb-api or fixtures path is area:ingest", () =>
	{
		expect(areaOf(["functions/src/ingest/", "packages/mlb-api/"])).toBe("area:ingest");
		expect(areaOf(["fixtures/"])).toBe("area:ingest");
	});

	it("a docs/v3/visual path is area:design", () =>
	{
		expect(areaOf(["docs/v3/visual/game/"])).toBe("area:design");
	});

	it("scripts, CI, CLAUDE.md and the backlog alone are area:process", () =>
	{
		expect(areaOf(["scripts/backlog-vault/", ".github/workflows/ci.yml", "CLAUDE.md"])).toBe("area:process");
		expect(areaOf([])).toBe("area:process");
	});

	it("a story spanning two areas takes the first by scope order, past process paths", () =>
	{
		expect(areaOf(["docs/v3/backlog/", "functions/src/x.ts", "web/src/y.tsx"])).toBe("area:api");
		expect(areaOf(["web/src/y.tsx", "functions/src/x.ts"])).toBe("area:web");
	});
});

describe("milestoneFor", () =>
{
	const releases = [{
		title: "v3.0.0",
		commit: "r1",
	}, {
		title: "v3.1.0",
		commit: "r2",
	}];
	// r1 contains a; r2 contains a and b.
	const contains: Record<string, string[]> = {
		r1: ["a"],
		r2: ["a", "b"],
	};
	const isAncestor = (x: string, y: string) => (contains[y] ?? []).includes(x);

	it("a done story with a containing release gets the first one that contains it", () =>
	{
		expect(milestoneFor("a", releases, isAncestor)).toBe("v3.0.0");
		expect(milestoneFor("b", releases, isAncestor)).toBe("v3.1.0");
	});

	it("a done story without a containing release (shipped after the last, or before the first) gets none", () =>
	{
		expect(milestoneFor("c", releases, isAncestor)).toBeUndefined();
		expect(milestoneFor(undefined, releases, isAncestor)).toBeUndefined();
	});
});

describe("planAreas", () =>
{
	const issue = (labels: string[], milestone?: string): CachedIssue => ({
		number: 1,
		title: "S1: x",
		state: "closed",
		labels: labels.map((name) => ({
			name,
		})),
		user: null,
		body: "",
		milestone: milestone ? {
			number: 1,
			title: milestone,
		} : null,
	});

	it("sets a missing or wrong area label and a done story's milestone, and leaves a correct one alone", () =>
	{
		const plan = planAreas([
			{
				id: "S1",
				issue: issue(["story", "status:done", "area:api"]),
				scopeFiles: ["web/"],
				status: "done",
			},
			{
				id: "S2",
				issue: issue(["story", "area:web"], "v3.0.0"),
				scopeFiles: ["web/"],
				status: "done",
			},
		], (id) => (id === "S1" ? "v3.1.0" : "v3.0.0"));
		expect(plan.map((c) => [c.id, c.labels, c.milestone])).toEqual([["S1", ["story", "status:done", "area:web"], "v3.1.0"]]);
	});
});
