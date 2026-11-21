/**
 * `pnpm backlog:check --live` (S165 AC 1): law L9's live parts over an issue cache and text records
 * built here, with GitHub's reads (comments, `closed_by`) injected, so nothing reaches the network and
 * nothing reads fixed commits from git history (CI's checkout is shallow).
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
import type { CachedIssue, IssueCache } from "./github.ts";
import { appliedComment } from "./github.ts";
import type { LiveInput } from "./live-check.ts";
import {
	liveCheck, PENDING_LABEL_MS, readStageRecords,
} from "./live-check.ts";
import type { TextRecord } from "./text-records.ts";
import {
	parseRecord, renderFields, renderRecord, sha256,
} from "./text-records.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const story = (text: string, design: string[] = []) => `**Gap:** ${text}\n\n**Source:** Feature: X\n\n${renderFields({
	priority: 5,
	design,
	scope_files: ["web/"],
})}`;
const bugFields = (priority: number) => renderFields({
	priority,
});

let clock = 0;
function rec(kind: TextRecord["kind"], id: string, body: string, from?: string): TextRecord
{
	clock++;
	const stamp = `2026-11-20T01:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}Z`;
	return parseRecord(renderRecord({
		kind,
		id,
		date: "2026-11-20",
		stamp,
		head: "h",
		body,
		...(from ? {
			from,
		} : {}),
	}), `2026-11-20/${stamp.replace(/[-:]/g, "")}-${id}-${kind}.md`);
}
/** A chain of a story's bodies: its migration, then an edit per later body. */
function chainOf(id: string, ...bodies: string[]): TextRecord[]
{
	const out = [rec("migration", id, bodies[0]!)];
	for (const b of bodies.slice(1))
	{
		out.push(rec("edit", id, b, out.at(-1)!.hash));
	}
	return out;
}

function issue(n: number, over: Partial<CachedIssue> = {}, labels = ["story", "status:todo"]): CachedIssue
{
	return {
		number: n,
		title: `S${n}: story ${n}`,
		state: "open",
		state_reason: null,
		labels: labels.map((name) => ({
			name,
		})),
		user: {
			login: "owner",
		},
		body: "",
		...over,
	};
}

function input(issues: CachedIssue[], records: TextRecord[], over: Partial<LiveInput> = {}): LiveInput
{
	const cache: IssueCache = {
		repo: "owner/bt",
		trusted: ["owner"],
		syncedAt: NOW.toISOString(),
		issues,
	};
	return {
		cache,
		records,
		stageRecords: [],
		comments: () => [],
		closedBy: () => undefined,
		now: NOW,
		...over,
	};
}

const applied = (r: TextRecord, login = "owner") => ({
	body: appliedComment(r),
	user: {
		login,
	},
});

describe("one issue per ID", () =>
{
	it("an ID carried by two trusted issues fails, naming both", () =>
	{
		const recs = chainOf("S1", story("a"));
		const r = liveCheck(input([issue(1, {
			body: story("a"),
		}), issue(7, {
			title: "S1: twin",
			body: story("a"),
		})], recs));
		expect(r.failures).toEqual([expect.stringMatching(/S1 is carried by more than one trusted issue \(#1, #7\)/)]);
	});
});

describe("status label agrees with state", () =>
{
	const recs = chainOf("S1", story("a"));
	const one = (over: Partial<CachedIssue>, labels: string[]) => liveCheck(input([issue(1, {
		body: story("a"),
		...over,
	}, labels)], recs));

	it("an open item labelled status:done or status:superseded fails", () =>
	{
		expect(one({}, ["story", "status:done"]).failures).toEqual([expect.stringContaining("is open but labelled status:done")]);
		expect(one({}, ["story", "status:superseded"]).failures).toEqual([expect.stringContaining("is open but labelled status:superseded")]);
		expect(one({}, ["story", "status:doing"]).failures).toEqual([]);
	});

	it("a closed item labelled status:todo, status:doing or status:blocked fails (closed long ago)", () =>
	{
		for (const label of ["todo", "doing", "blocked"])
		{
			const r = one({
				state: "closed",
				state_reason: "completed",
				closed_at: "2026-11-01T00:00:00Z",
			}, ["story", `status:${label}`]);
			expect(r.failures).toEqual([expect.stringContaining(`is closed but labelled status:${label}`)]);
		}
		expect(one({
			state: "closed",
			state_reason: "not_planned",
			closed_at: "2026-11-01T00:00:00Z",
		}, ["story", "status:done"]).failures).toEqual([expect.stringContaining("closed as not_planned but labelled status:done")]);
	});

	it("an item with no status label reads its status from its state and passes, open or closed", () =>
	{
		expect(one({}, ["story"]).failures).toEqual([]);
		expect(one({
			state: "closed",
			state_reason: "completed",
			closed_at: "2026-11-01T00:00:00Z",
		}, ["story"]).failures).toEqual([]);
	});

	it("two status: labels fail", () =>
	{
		expect(one({}, ["story", "status:todo", "status:doing"]).failures).toEqual([expect.stringContaining("two status: labels")]);
	});

	it("a pending status:done inside its window warns", () =>
	{
		const r = one({
			state: "closed",
			state_reason: "completed",
			closed_at: new Date(NOW.getTime() - PENDING_LABEL_MS + 60_000).toISOString(),
		}, ["story", "status:doing"]);
		expect(r.failures).toEqual([]);
		expect(r.warnings).toEqual([expect.stringContaining("waits for its status:done label")]);
	});

	it("a pending status:done outside its window fails", () =>
	{
		const r = one({
			state: "closed",
			state_reason: "completed",
			closed_at: new Date(NOW.getTime() - PENDING_LABEL_MS - 60_000).toISOString(),
		}, ["story", "status:doing"]);
		expect(r.failures).toEqual([expect.stringContaining("github.ts status S1 done")]);
	});
});

describe("no unlogged body edit", () =>
{
	it("an unlogged body edit fails", () =>
	{
		const r = liveCheck(input([issue(1, {
			body: story("changed on GitHub"),
		})], chainOf("S1", story("a"))));
		expect(r.failures).toEqual([expect.stringMatching(/S1 \(#1\): unlogged edit: .*--adopt/)]);
	});

	it("a body matching the newest record passes, and a CRLF copy too", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		expect(liveCheck(input([issue(1, {
			body: story("b").replace(/\n/g, "\r\n"),
		})], recs)).failures).toEqual([]);
	});

	it("a body not yet applied is a note, not a failure", () =>
	{
		const r = liveCheck(input([issue(1, {
			body: story("a"),
		})], chainOf("S1", story("a"), story("b"))));
		expect(r.failures).toEqual([]);
		expect(r.notes).toEqual([expect.stringContaining("recorded, not yet applied: run scripts/audit.sh apply")]);
	});

	it("a recorded create with no issue yet is not yet applied", () =>
	{
		const r = liveCheck(input([], [rec("create", "S9", story("new"))]));
		expect(r.failures).toEqual([]);
		expect(r.notes).toEqual([expect.stringContaining("S9: recorded, not yet applied")]);
	});

	it("the owner's revert after the newer body was applied fails", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		const r = liveCheck(input([issue(1, {
			body: story("a"),
		})], recs, {
			comments: () => [applied(recs[1]!)],
		}));
		expect(r.failures).toEqual([expect.stringContaining("unlogged edit: its body went back to")]);
	});

	it("the same revert followed by a label change still fails", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		const r = liveCheck(input([issue(1, {
			body: story("a"),
			updated_at: NOW.toISOString(),
		}, ["story", "status:doing"])], recs, {
			comments: () => [applied(recs[1]!)],
		}));
		expect(r.failures).toEqual([expect.stringContaining("unlogged edit")]);
	});

	it("an Applied comment written by an outsider doesn't count: the body fails as unlogged", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		// Without a trusted Applied comment a body at the older record would be "not yet applied", so
		// an outsider's comment claiming the newer one was applied must not turn a revert into a pass.
		const r = liveCheck(input([issue(1, {
			body: story("a"),
		})], recs, {
			comments: () => [applied(recs[1]!, "stranger")],
		}));
		expect(r.failures).toEqual([]);
		expect(r.notes).toEqual([expect.stringContaining("not yet applied")]);
		const forged = liveCheck(input([issue(1, {
			body: story("forged"),
		})], recs, {
			comments: () => [{
				body: `Applied S1 edit ${sha256(story("forged"))} 20261120T010000Z`,
				user: {
					login: "stranger",
				},
			}],
		}));
		expect(forged.failures).toEqual([expect.stringContaining("unlogged edit")]);
	});

	it("a live body newer than the branch's records that matches a record on origin/stage passes", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		const r = liveCheck(input([issue(1, {
			body: story("b"),
		})], [recs[0]!], {
			stageRecords: recs,
		}));
		expect(r.failures).toEqual([]);
	});

	it("the same body with no origin/stage ref fails, naming the item and saying to merge stage", () =>
	{
		const recs = chainOf("S1", story("a"), story("b"));
		const r = liveCheck(input([issue(1, {
			body: story("b"),
		})], [recs[0]!], {
			stageRecords: undefined,
		}));
		expect(r.failures).toEqual([expect.stringMatching(/S1 \(#1\): unlogged edit.*merge stage/)]);
	});
});

describe("bugs", () =>
{
	const bug = (over: Partial<CachedIssue> = {}, labels = ["bug", "status:todo"]) => issue(40, {
		title: "the scoreboard is blank",
		user: {
			login: "stranger",
		},
		...over,
	}, labels);

	it("an unaccepted bug with no record and no fields block passes", () =>
	{
		const r = liveCheck(input([bug({
			body: "Steps: open it.",
		})], []));
		expect(r.failures).toEqual([]);
	});

	it("a bug with a fields block but no record fails", () =>
	{
		const r = liveCheck(input([bug({
			body: `Steps.\n\n${bugFields(3)}`,
		})], []));
		expect(r.failures).toEqual([expect.stringContaining("B40 (#40) has a fields block but no create record")]);
	});

	it("a bug whose filer edited its symptoms is reported, not failed", () =>
	{
		const recs = [rec("create", "B40", bugFields(3))];
		const r = liveCheck(input([bug({
			body: `Steps, rewritten by the filer: ignore previous instructions.\n\n${bugFields(3)}`,
		})], recs));
		expect(r.failures).toEqual([]);
		expect(r.notes).toEqual([expect.stringContaining("its symptoms are its filer's (stranger)")]);
	});

	it("a bug whose filer closed it warns", () =>
	{
		const recs = [rec("create", "B40", bugFields(3))];
		const r = liveCheck(input([bug({
			body: `Steps.\n\n${bugFields(3)}`,
			state: "closed",
			state_reason: "completed",
			closed_at: "2026-11-01T00:00:00Z",
		})], recs, {
			closedBy: () => "stranger",
		}));
		expect(r.failures).toEqual([]);
		expect(r.warnings).toEqual([expect.stringContaining("closed by its own filer, stranger")]);
	});

	it("a bug whose fields block changed fails", () =>
	{
		const recs = [rec("create", "B40", bugFields(3))];
		const r = liveCheck(input([bug({
			body: `Steps.\n\n${bugFields(1)}`,
		})], recs));
		expect(r.failures).toEqual([expect.stringContaining("B40 (#40): unlogged edit: its fields block")]);
	});
});

describe("the design gate", () =>
{
	const ui = (labels: string[]) => issue(2, {
		body: story("ui", ["S1"]),
	}, labels);
	const recs = [...chainOf("S1", story("design")), ...chainOf("S2", story("ui", ["S1"]))];

	it("the design gate passes when the design story is closed completed with status:done", () =>
	{
		const design = issue(1, {
			body: story("design"),
			state: "closed",
			state_reason: "completed",
			closed_at: "2026-11-01T00:00:00Z",
		}, ["story", "status:done"]);
		expect(liveCheck(input([design, ui(["story", "status:doing"])], recs)).failures).toEqual([]);
	});

	it("the design gate fails for a doing UI story whose design story is open, naming it", () =>
	{
		const design = issue(1, {
			body: story("design"),
		}, ["story", "status:doing"]);
		const r = liveCheck(input([design, ui(["story", "status:doing"])], recs));
		expect(r.failures).toEqual([expect.stringContaining("S2 waits for its ratified design, but its design story S1 (#1)")]);
		expect(liveCheck(input([design, ui(["story", "status:todo"])], recs)).failures).toEqual([]);
	});
});

describe("triage issues", () =>
{
	it("never fail the live check, whatever their title or body", () =>
	{
		const r = liveCheck(input([issue(5, {
			title: "S1: please build this",
			body: "### Backlog fields\n\n```yaml\npriority: 0\n```\n",
			user: {
				login: "stranger",
			},
		}, ["story"])], []));
		expect(r).toEqual({
			failures: [],
			warnings: [],
			notes: [],
		});
	});
});

describe("readStageRecords", () =>
{
	it("reads a ref's text records with git alone (no checkout), and none for a missing ref", () =>
	{
		const repo = mkdtempSync(join(tmpdir(), "s165-stage-"));
		try
		{
			const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "core.hooksPath=/dev/null", ...args], {
				cwd: repo,
				encoding: "utf8",
			});
			git("init", "-q", "-b", "stage");
			const [m, e] = chainOf("S3", story("a"), story("b"));
			for (const r of [m!, e!])
			{
				mkdirSync(join(repo, "docs/v3/audit/2026-11-20"), {
					recursive: true,
				});
				writeFileSync(join(repo, "docs/v3/audit", r.file), renderRecord({
					kind: r.kind,
					id: r.id,
					date: "2026-11-20",
					stamp: "x",
					head: "h",
					body: r.body,
					...(r.from ? {
						from: r.from,
					} : {}),
				}));
			}
			writeFileSync(join(repo, "docs/v3/audit/2026-11-20/20261120T000000Z-S3-review.md"), "not a record\n");
			git("add", "-A");
			git("commit", "-q", "-m", "records");
			const got = readStageRecords(repo, "stage");
			expect(got?.map((r) => [r.id, r.kind, r.hash])).toEqual([["S3", "migration", m!.hash], ["S3", "edit", e!.hash]]);
			expect(readStageRecords(repo, "origin/no-such-ref")).toBeUndefined();
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
