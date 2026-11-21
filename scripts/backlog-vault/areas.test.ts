/**
 * Areas and milestones (S165 AC 4): one pure {@link areaOf} from a story's recorded scope, and a done
 * story's milestone from the first published release containing its shipping commit, with the
 * containment check injected (no fixed commits from git history: CI's checkout is shallow).
 */
import { spawnSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import { FakeGithub } from "./github-fake.ts";
import type { CachedIssue, IssueCache } from "./github.ts";
import { readCache, removeLabel } from "./github.ts";
import {
	areaOf, main, milestoneFor, planAreas, publishedReleases,
} from "./areas.ts";
import { renderFields, renderRecord } from "./text-records.ts";

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

	it("the real ingest paths are area:ingest: the ingest services, the ingest Durable Object, mlb-api and fixtures", () =>
	{
		for (const path of ["functions/src/services/ingest.ts", "functions/src/services/game-ingest.ts", "functions/src/services/tick-ingest.test.ts", "functions/src/game-ingest-object.ts", "functions/src/game-ingest-object.test.ts", "functions/src/game-ingest.workerd.test.ts"])
		{
			expect(areaOf([path])).toBe("area:ingest");
		}
		expect(areaOf(["packages/mlb-api/"])).toBe("area:ingest");
		expect(areaOf(["fixtures/"])).toBe("area:ingest");
		expect(areaOf(["functions/src/services/schedule.ts"])).toBe("area:api");
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

	it("work shipped before the first release takes the first release that contains it", () =>
	{
		// "a" predates v3.0.0's commit, so v3.0.0 contains it: the first release that shipped it.
		expect(milestoneFor("a", releases, isAncestor)).toBe("v3.0.0");
	});

	it("a done story without a containing release keeps its milestone (none is planned)", () =>
	{
		expect(milestoneFor("c", releases, isAncestor)).toBeUndefined();
		expect(planAreas([{
			id: "S3",
			issue: issue(["story", "area:web"], "v3.3.0"),
			scopeFiles: ["web/"],
			status: "done",
		}], () => milestoneFor("c", releases, isAncestor))).toEqual([]);
	});

	it("a done story with no shipping commit keeps its milestone", () =>
	{
		expect(milestoneFor(undefined, releases, isAncestor)).toBeUndefined();
		expect(planAreas([{
			id: "S4",
			issue: issue(["story", "area:web"], "v3.3.0"),
			scopeFiles: ["web/"],
			status: "done",
		}], () => milestoneFor(undefined, releases, isAncestor))).toEqual([]);
	});

	it("a release tag that does not resolve fails, saying to fetch the tags", () =>
	{
		const repo = mkdtempSync(join(tmpdir(), "s165-tags-"));
		try
		{
			spawnSync("git", ["init", "-q"], {
				cwd: repo,
			});
			const fake = new FakeGithub();
			fake.releases = [{
				tag_name: "v3.0.0",
				draft: false,
				published_at: "2026-11-10T00:00:00Z",
			}];
			expect(() => publishedReleases(fake.run, repo)).toThrow(/release v3\.0\.0's tag does not resolve here: run git fetch --tags origin/);
		}
		finally
		{
			rmSync(repo, {
				recursive: true,
				force: true,
			});
		}
	});
});

describe("planAreas", () =>
{
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
		expect(plan.map((c) => [c.id, c.add, c.remove, c.milestone])).toEqual([["S1", ["area:web"], ["area:api"], "v3.1.0"]]);
	});

	it("areas adds and removes area labels without replacing a status label set after the sync", () =>
	{
		const top = mkdtempSync(join(tmpdir(), "s165-areas-"));
		try
		{
			const fake = new FakeGithub();
			const stale = fake.add({
				number: 12,
				title: "S12: a web story",
				labels: [{
					name: "story",
				}, {
					name: "status:todo",
				}, {
					name: "area:api",
				}],
			});
			const cache: IssueCache = {
				repo: "owner/bt",
				trusted: ["owner"],
				syncedAt: "2026-11-21T00:00:00Z",
				issues: [structuredClone(fake.view(stale)) as unknown as CachedIssue],
			};
			mkdirSync(join(top, "cache"));
			writeFileSync(join(top, "cache/issues.json"), JSON.stringify(cache));
			mkdirSync(join(top, "docs/v3/audit/2026-11-20"), {
				recursive: true,
			});
			writeFileSync(join(top, "docs/v3/audit/2026-11-20/20261120T000000Z-S12-migration.md"), renderRecord({
				kind: "migration",
				id: "S12",
				date: "2026-11-20",
				stamp: "2026-11-20T00:00:00Z",
				head: "h",
				issue: 12,
				body: `**Gap:** x\n\n${renderFields({
					priority: 5,
					scope_files: ["web/"],
				})}`,
			}));
			// After the sync, the coordinator starts the story on GitHub.
			stale.labels = [{
				name: "story",
			}, {
				name: "status:doing",
			}, {
				name: "area:api",
			}];
			const env = {
				BT_BACKLOG_CACHE: join(top, "cache"),
				BT_AUDIT_LEDGER: join(top, "docs/v3/AUDIT.md"),
			};
			expect(main([], fake.run, top, env)).toContain("S12 (#12): add area:web remove area:api");
			expect(fake.issues.get(12)!.labels.map((l) => l.name).sort()).toEqual(["area:web", "status:doing", "story"]);
			expect(fake.count("PATCH", /issues\/12$/)).toBe(0);
			// The cache holds the issue as GitHub has it now.
			expect(readCache(join(top, "cache"))!.issues.find((i) => i.number === 12)!.labels.map((l) => l.name).sort()).toEqual(["area:web", "status:doing", "story"]);
		}
		finally
		{
			rmSync(top, {
				recursive: true,
				force: true,
			});
		}
	});

	it("removeLabel treats a 404 as done, and other failures still throw", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			number: 7,
			title: "x",
			labels: [{
				name: "area:web",
			}],
		});
		expect(() => removeLabel({
			run: fake.run,
		}, 7, "area:api")).not.toThrow();
		removeLabel({
			run: fake.run,
		}, 7, "area:web");
		expect(fake.issues.get(7)!.labels).toEqual([]);
		expect(fake.calls.at(-1)!.path).toBe("repos/{owner}/{repo}/issues/7/labels/area%3Aweb");
		fake.intercept = (call) => (call.method === "DELETE" ? FakeGithub.respond(500, {
			message: "boom",
		}) : undefined);
		expect(() => removeLabel({
			run: fake.run,
		}, 7, "area:web")).toThrow(/HTTP 500/);
	});
});
