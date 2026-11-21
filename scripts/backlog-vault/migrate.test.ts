/**
 * `pnpm backlog:migrate` (S164 AC 4) against {@link FakeGithub}: one issue per story note, bug notes
 * folded into their issues, idempotent across a stop at any point, a rate limit waited out, the done
 * stories' `### Shipped` sections, the open stories' rewrites, and `--reconcile` keeping it current.
 */
import {
	describe, expect, it,
} from "vitest";
import type { IssueCache } from "./github.ts";
import { appliedRecords } from "./github.ts";
import { FakeGithub } from "./github-fake.ts";
import type {
	MigrateIO, ReconcileView, RecordRequest, Shipped,
} from "./migrate.ts";
import {
	migrate, noteItems, rewriteOpen, shippedSection, summaryText,
} from "./migrate.ts";
import type { TextRecord } from "./text-records.ts";
import {
	parseFields, parseRecord, renderRecord, sha256, textRecordProblems,
} from "./text-records.ts";

/** A story note as S156's notes are written. */
function story(id: string, status: string, extra = ""): [string, string]
{
	const body = [
		`**Gap:** ${id}'s gap.`,
		"",
		"**Source:** Feature: Backlog in GitHub issues",
		extra,
		"**Acceptance criteria**",
		"",
		`1. ${id}'s **Status** is \`done\` (its note's frontmatter \`status\`, the note in \`docs/v3/backlog/stories/done/\`).`,
		"",
		"```text",
		`/goal ${id} (docs/v3/backlog/stories/<status>/${id}.md). Work item 0 first.`,
		"```",
		"",
	].join("\n");
	return [`docs/v3/backlog/stories/${status}/${id}.md`, `---\nid: ${id}\ntitle: ${id} the story\ntable_title: ${id} short\npriority: ${Number(id.slice(1)) / 2}\nstatus: ${status}\n`
		+ `depends_on:\n  - "[[S1]]"\nscope_files:\n  - scripts/x/\nsource: feature\nturn_cap: 9\n---\n\n${body}`];
}
const bug = (n: number, status: string, priority: number): [string, string] =>
	[`docs/v3/backlog/bugs/${status}/B${n}.md`, `---\nid: B${n}\nissue: ${n}\ntitle: bug ${n}\npriority: ${priority}\nstatus: ${status}\n---\n\nhttps://example.test/issues/${n}\n`];

/** A harness: the fake, an in-memory ledger, and the IO the migration gets. */
function harness(fake = new FakeGithub())
{
	const records: TextRecord[] = [];
	const sleeps: number[] = [];
	const shipped: Record<string, Shipped> = {
		S1: {
			commit: "a".repeat(40),
			pr: 42,
			ledger: "docs/v3/audit/2026-11-01/x-S1-completed.md",
			grader: "scripts/verify-S1.sh",
			changelog: "changelog.d/S1.md",
		},
		S4: {
			commit: "b".repeat(40),
			frozenLine: 120,
		},
	};
	let clock = 0;
	let cache: IssueCache | undefined;
	const io: MigrateIO = {
		run: fake.run,
		sleep: (ms) => sleeps.push(ms),
		sync: () =>
		{
			const issues = [...fake.issues.values()].filter((i) => !i.gone).map((i) => fake.view(i)) as unknown as IssueCache["issues"];
			cache = {
				repo: fake.repo,
				trusted: [fake.owner, fake.viewer],
				syncedAt: "x",
				issues,
			};
			return cache;
		},
		recorded: () => records,
		record: (r: RecordRequest) =>
		{
			clock++;
			const stamp = `2026-11-21T02:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}Z`;
			const from = r.kind === "edit" ? records.filter((x) => x.id === r.id).at(-1)!.hash : undefined;
			records.push(parseRecord(renderRecord({
				kind: r.kind,
				id: r.id,
				date: "2026-11-21",
				stamp,
				head: "h",
				body: r.body,
				issue: r.issue,
				base: r.base,
				baseLabel: r.stage ? "Read from stage" : "Base",
				rewrites: r.rewrites,
				...(from ? {
					from,
				} : {}),
				...(r.title ? {
					title: r.title,
				} : {}),
			}), `2026-11-21/${stamp.replace(/[-:]/g, "")}-${r.id}-${r.kind}.md`));
		},
		shipped: (id) => shipped[id] ?? {},
		unshipped: (id) => (id === "S131" ? "scripts/verify-S131.sh" : undefined),
		repo: "owner/bt",
		log: () => undefined,
	};
	return {
		fake,
		io,
		records,
		sleeps,
	};
}

const NOTES = () => new Map([story("S1", "done"), story("S2", "superseded"), story("S3", "todo"), story("S4", "done"), bug(50, "todo", 12.5)]);

/** The fake with bug #50 filed by an outsider and labelled by the owner. */
function withBug(): FakeGithub
{
	const fake = new FakeGithub();
	fake.add({
		number: 50,
		title: "Scores freeze",
		labels: [{
			name: "bug",
		}],
		user: {
			login: "stranger",
		},
		body: "Steps: open a live game.",
	});
	return fake;
}

/**
 * A reconcile's view of git: these note paths changed on stage (`M`, or `D` for a deletion), the
 * statuses at the merge-base are NOTES()'s, HEAD contains stage, and stage holds no migration yet.
 */
const view = (changed: string[], over: Partial<ReconcileView> = {}): ReconcileView => ({
	changed: changed.map((path) => ({
		letter: path.startsWith("D ") ? "D" : "M",
		path: path.replace(/^D /, ""),
	})),
	branchChanged: [],
	baseStatus: new Map(noteItems(NOTES()).map((i) => [i.id, i.status])),
	headContainsStage: true,
	stageMigrated: false,
	...over,
});

const byTitle = (fake: FakeGithub, id: string) => [...fake.issues.values()].filter((i) => i.title.startsWith(`${id}: `));

describe("backlog:migrate (AC 4)", () =>
{
	it("a fresh run makes one issue per story with its state, folds the bug, and records what GitHub returned", () =>
	{
		const {
			fake, io, records,
		} = harness(withBug());
		migrate(NOTES(), "base123", io);
		const s1 = byTitle(fake, "S1")[0]!;
		expect(s1.state).toBe("closed");
		expect(s1.state_reason).toBe("completed");
		expect(s1.labels.map((l) => l.name)).toEqual(["story", "status:done"]);
		expect(byTitle(fake, "S3")[0]!.state).toBe("open");
		expect(parseFields(s1.body!, "S1")).toMatchObject({
			priority: 0.5,
			depends_on: ["S1"],
			scope_files: ["scripts/x/"],
			turn_cap: 9,
		});
		expect(records.map((r) => `${r.id} ${r.kind}`)).toEqual(["S1 migration", "S2 migration", "S3 migration", "S4 migration", "B50 migration"]);
		for (const r of records.filter((x) => x.id.startsWith("S")))
		{
			expect(r.hash).toBe(sha256(byTitle(fake, r.id)[0]!.body!));
			expect(r.base).toBe("base123");
		}
		expect(textRecordProblems(records, [])).toEqual([]);
	});

	it("a done story's ### Shipped section with a pull request, and without a pull request (pushed directly)", () =>
	{
		const { fake, io } = harness(withBug());
		migrate(NOTES(), "b", io);
		const s1 = byTitle(fake, "S1")[0]!.body!;
		expect(s1).toContain("### Shipped");
		expect(s1).toContain("- **Pull request:** #42");
		expect(s1).toContain(`[\`scripts/verify-S1.sh\`](https://github.com/owner/bt/blob/${"a".repeat(40)}/scripts/verify-S1.sh)`);
		expect(s1).toContain("changelog.d/S1.md");
		const s4 = byTitle(fake, "S4")[0]!.body!;
		expect(s4).toContain("- **Pull request:** pushed directly, before S121");
		expect(s4).toContain("[`docs/v3/AUDIT.md` line 120](https://github.com/owner/bt/blob/b/docs/v3/AUDIT.md?plain=1#L120)");
		expect(shippedSection({}, "o/r", "b")).toContain("not recorded in the ledger");
	});

	it("closes a superseded story not_planned with status:superseded", () =>
	{
		const { fake, io } = harness(withBug());
		migrate(NOTES(), "b", io);
		const s2 = byTitle(fake, "S2")[0]!;
		expect(s2.state_reason).toBe("not_planned");
		expect(s2.labels.map((l) => l.name)).toEqual(["story", "status:superseded"]);
		expect(s2.body).not.toContain("### Shipped");
	});

	it("an open story's rewrite: its Status criterion reads the snapshot and its /goal line names the bare ID, each diff recorded", () =>
	{
		const {
			fake, io, records,
		} = harness(withBug());
		migrate(new Map([...NOTES(), story("S131", "todo")]), "b", io);
		const s3 = byTitle(fake, "S3")[0]!.body!;
		expect(s3).toContain("S3's **Status** is `done`: its snapshot records `done`, the status it ships with, written by `audit.sh story` (`story_snapshot_status`).");
		expect(s3).toContain("/goal S3 (S3). Work item 0 first.");
		expect(s3).not.toContain("docs/v3/backlog/stories/");
		const rec = records.find((r) => r.id === "S3")!;
		expect(rec.rewrites).toHaveLength(2);
		expect(rec.rewrites[1]).toMatch(/^-\/goal S3 \(docs\/v3\/backlog\/stories\/<status>\/S3\.md\)[\s\S]*\n\+\/goal S3 \(S3\)/);
		expect(records.find((r) => r.id === "S131")!.rewrites.at(-1)).toMatch(/scripts\/verify-S131\.sh exists but hasn't shipped/);
		expect(rewriteOpen("S1", "nothing to do").diffs).toEqual([]);
	});

	it("a bug: its priority goes into its fields block, its status into its labels, the symptoms stay, and only the fields block is recorded", () =>
	{
		const {
			fake, io, records,
		} = harness(withBug());
		migrate(NOTES(), "b", io);
		const b = fake.issues.get(50)!;
		expect(b.body!.startsWith("Steps: open a live game.\n\n### Backlog fields")).toBe(true);
		expect(parseFields(b.body!, "B50").priority).toBe(12.5);
		expect(b.labels.map((l) => l.name)).toEqual(["bug", "status:todo"]);
		const rec = records.find((r) => r.id === "B50")!;
		expect(rec.body.startsWith("### Backlog fields")).toBe(true);
		expect(rec.issue).toBe(50);
	});

	it("a run stopped after 50 issues resumes with no duplicates", () =>
	{
		const fake = new FakeGithub();
		const notes = new Map(Array.from({
			length: 60,
		}, (_, k) => story(`S${k + 1}`, "todo")));
		const h = harness(fake);
		let posts = 0;
		fake.intercept = (call) =>
		{
			if (call.method === "POST" && call.path.endsWith("/issues") && ++posts > 50)
			{
				throw new Error("stopped");
			}
			return undefined;
		};
		expect(() => migrate(notes, "b", h.io)).toThrow("stopped");
		expect(fake.issues.size).toBe(50);
		fake.intercept = undefined;
		migrate(notes, "b", h.io);
		expect(fake.issues.size).toBe(60);
		for (let k = 1; k <= 60; k++)
		{
			expect(byTitle(fake, `S${k}`)).toHaveLength(1);
		}
		expect(new Set(h.records.map((r) => r.id)).size).toBe(60);
		expect(h.records).toHaveLength(60);
	});

	it("a run stopped between create and close is brought into line", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		fake.intercept = (call) =>
		{
			if (call.method === "PATCH")
			{
				throw new Error("stopped before closing");
			}
			return undefined;
		};
		expect(() => migrate(NOTES(), "b", h.io)).toThrow("stopped before closing");
		expect(byTitle(fake, "S1")[0]!.state).toBe("open");
		fake.intercept = undefined;
		migrate(NOTES(), "b", h.io);
		expect(byTitle(fake, "S1")).toHaveLength(1);
		expect(byTitle(fake, "S1")[0]!.state_reason).toBe("completed");
		expect(h.records.filter((r) => r.id === "S1")).toHaveLength(1);
	});

	it("waits out a rate-limit response and carries on", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		let limited = false;
		fake.intercept = (call) =>
		{
			if (!limited && call.method === "POST")
			{
				limited = true;
				return "HTTP/2.0 403 Forbidden\nretry-after: 7\n\n{\"message\":\"secondary rate limit\"}";
			}
			return undefined;
		};
		migrate(NOTES(), "b", h.io);
		expect(h.sleeps.filter((ms) => ms !== 1000)).toEqual([7000]);
		expect(byTitle(fake, "S1")).toHaveLength(1);
	});

	it("--dry-run sends nothing and records nothing, and says what it would do", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		const s = migrate(NOTES(), "b", h.io, {
			dryRun: true,
		});
		expect(fake.calls.filter((c) => c.method !== "GET")).toEqual([]);
		expect(h.records).toEqual([]);
		expect(s.created).toEqual(["S1", "S2", "S3", "S4"]);
		expect(summaryText(s, true)).toContain("issues to create: 4");
	});

	it("--reconcile after a note edit, a status flip and a new note on stage records an edit, sets the state, and creates the new one", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const before = h.records.length;
		const stage = NOTES();
		const [p3, t3] = story("S3", "todo", "\n**Notes:** a review added this.\n");
		stage.set(p3, t3);
		const flipped = story("S4", "done");
		stage.delete(flipped[0]);
		const [p4, t4] = story("S4", "todo");
		stage.set(p4, t4.replace("status: todo", "status: blocked").replace("/todo/", "/blocked/"));
		stage.set(...story("S9", "todo"));
		const s = migrate(stage, "stage456", h.io, {
			reconcile: view([p3, flipped[0], p4.replace("/todo/", "/blocked/"), story("S9", "todo")[0]]),
		});
		const added = h.records.slice(before);
		expect(added.map((r) => `${r.id} ${r.kind}`).sort()).toEqual(["S3 edit", "S4 edit", "S9 create"]);
		expect(added.every((r) => r.base === "stage456")).toBe(true);
		expect(byTitle(fake, "S3")[0]!.body).toContain("a review added this");
		const s3 = byTitle(fake, "S3")[0]!;
		const s3edit = added.find((r) => r.id === "S3")!;
		expect(appliedRecords(s3.comments, "S3", ["owner"]).has(`${sha256(s3.body!)} ${s3edit.file.split("/")[1]!.split("-")[0]}`)).toBe(true);
		expect(byTitle(fake, "S4")[0]!.state).toBe("open");
		expect(byTitle(fake, "S4")[0]!.labels.map((l) => l.name)).toContain("status:blocked");
		expect(byTitle(fake, "S9")).toHaveLength(1);
		expect(added.find((r) => r.id === "S9")!.rewrites.length).toBeGreaterThan(0);
		expect(textRecordProblems(h.records, [])).toEqual([]);
		expect(s.edits.sort()).toEqual(["S3", "S4"]);
	});

	it("a second --reconcile with nothing new records and sends nothing", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const stage = NOTES();
		const [p3, t3] = story("S3", "todo", "\n**Notes:** edited on stage.\n");
		stage.set(p3, t3);
		migrate(stage, "stage1", h.io, {
			reconcile: view([p3]),
		});
		const records = h.records.length;
		const calls = fake.calls.length;
		const s = migrate(stage, "stage1", h.io, {
			reconcile: view([p3]),
		});
		expect(h.records).toHaveLength(records);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
		expect(s.recorded).toEqual([]);
	});

	it("reconcile at a stage moved since the migration, with no note changed, records and sends nothing (relative and frozen-ledger links)", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		const notes = NOTES();
		notes.set(...story("S7", "todo", "\nSee [VD](./VISUAL-DESIGN.md#videos).\n"));
		migrate(notes, "b", h.io);
		const calls = fake.calls.length;
		const s = migrate(notes, "stage9", h.io, {
			reconcile: view([]),
		});
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
		expect(s.recorded).toEqual([]);
	});

	it("reconcile twice with stage moved between them records nothing the second time, a relative-link story in scope both times", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		const notes = NOTES();
		const [p7] = story("S7", "todo");
		notes.set(p7, story("S7", "todo", "\nSee [VD](./VISUAL-DESIGN.md#videos).\n")[1]);
		migrate(notes, "b", h.io);
		notes.set(p7, story("S7", "todo", "\nSee [VD](./VISUAL-DESIGN.md#videos), changed on stage.\n")[1]);
		migrate(notes, "stage1", h.io, {
			reconcile: view([p7]),
		});
		const edit = h.records.at(-1)!;
		expect(`${edit.id} ${edit.kind} ${edit.base}`).toBe("S7 edit stage1");
		expect(edit.body).toContain("blob/stage1/docs/v3/VISUAL-DESIGN.md#videos");
		const records = h.records.length;
		const calls = fake.calls.length;
		const s = migrate(notes, "stage2", h.io, {
			reconcile: view([p7]),
		});
		expect(h.records).toHaveLength(records);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
		expect(s.recorded).toEqual([]);
	});

	it("reconcile stopped after the first of two changed notes records the second on re-run", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const stage = NOTES();
		const [p1, t1] = story("S1", "done", "\n**Notes:** one.\n");
		const [p3, t3] = story("S3", "todo", "\n**Notes:** three.\n");
		stage.set(p1, t1);
		stage.set(p3, t3);
		const s3 = byTitle(fake, "S3")[0]!;
		fake.intercept = (call) =>
		{
			if (call.method === "PATCH" && call.path.endsWith(`/issues/${s3.number}`))
			{
				throw new Error("connection reset");
			}
			return undefined;
		};
		expect(() => migrate(stage, "stage1", h.io, {
			reconcile: view([p1, p3]),
		})).toThrow("connection reset");
		expect(h.records.filter((r) => r.kind === "edit").map((r) => r.id)).toEqual(["S1"]);
		fake.intercept = undefined;
		const s = migrate(stage, "stage1", h.io, {
			reconcile: view([p1, p3]),
		});
		expect(s.recorded).toEqual(["S3 edit"]);
		expect(h.records.filter((r) => r.kind === "edit").map((r) => r.id)).toEqual(["S1", "S3"]);
		expect(textRecordProblems(h.records, [])).toEqual([]);
	});

	it("reconcile of a status-only move patches labels and state only: no body, no record, even over a hand-edited body", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const s3 = byTitle(fake, "S3")[0]!;
		s3.body = "hand-edited on GitHub";
		const stage = NOTES();
		const [p3, t3] = story("S3", "todo");
		stage.delete(p3);
		const doing = p3.replace("/todo/", "/doing/");
		stage.set(doing, t3.replace("status: todo", "status: doing"));
		const records = h.records.length;
		const calls = fake.calls.length;
		migrate(stage, "stage1", h.io, {
			reconcile: view([`D ${p3}`, doing]),
		});
		const patches = fake.calls.slice(calls).filter((c) => c.method === "PATCH");
		expect(patches).toHaveLength(1);
		expect(patches[0]!.fields.map(([n]) => n)).not.toContain("body");
		expect(s3.labels.map((l) => l.name)).toContain("status:doing");
		expect(s3.body).toBe("hand-edited on GitHub");
		expect(h.records).toHaveLength(records);
	});

	it("reconcile prints a note deleted on stage and sends nothing", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const stage = NOTES();
		const [p3] = story("S3", "todo");
		stage.delete(p3);
		const calls = fake.calls.length;
		const s = migrate(stage, "stage1", h.io, {
			reconcile: view([`D ${p3}`]),
		});
		expect(s.deleted).toEqual(["S3"]);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
		expect(summaryText(s, false)).toContain("notes deleted on stage (nothing sent): 1 (S3)");
	});

	it("reconcile refuses to touch an ID the branch itself changed, and reports it", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const stage = NOTES();
		const [p3, t3] = story("S3", "todo", "\n**Notes:** stale copy.\n");
		stage.set(p3, t3);
		const calls = fake.calls.length;
		const s = migrate(stage, "stage1", h.io, {
			reconcile: view([p3], {
				branchChanged: ["S3"],
			}),
		});
		expect(s.refused).toEqual(["S3"]);
		expect(s.recorded).toEqual([]);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
	});

	it("reconcile refuses unless HEAD contains the stage commit", () =>
	{
		const h = harness(withBug());
		expect(() => migrate(NOTES(), "stage1", h.io, {
			reconcile: view([], {
				headContainsStage: false,
			}),
		})).toThrow(/merge stage into this branch first/);
	});

	it("reconcile refuses once stage holds a migration fragment (S164 merged)", () =>
	{
		const h = harness(withBug());
		expect(() => migrate(NOTES(), "stage1", h.io, {
			reconcile: view([], {
				stageMigrated: true,
			}),
		})).toThrow(/stage already holds a migration fragment/);
	});

	it("a CRLF issue body is PATCHed to the LF body, and the record holds LF", () =>
	{
		const fake = withBug();
		fake.issues.get(50)!.body = "Steps: open a live game.\r\nThen wait.\r\n";
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		expect(fake.issues.get(50)!.body).not.toContain("\r");
		expect(h.records.every((r) => !r.body.includes("\r"))).toBe(true);
		const s3 = byTitle(fake, "S3")[0]!;
		s3.body = s3.body!.replace(/\n/g, "\r\n");
		const records = h.records.length;
		migrate(NOTES(), "b", h.io);
		expect(s3.body).not.toContain("\r");
		expect(h.records).toHaveLength(records);
	});

	it("links a frozen-ledger entry at the migration's base commit as plain text (?plain=1), not at the shipping commit", () =>
	{
		const { fake, io } = harness(withBug());
		migrate(NOTES(), "base123", io);
		const s4 = byTitle(fake, "S4")[0]!.body!;
		expect(s4).toContain("https://github.com/owner/bt/blob/base123/docs/v3/AUDIT.md?plain=1#L120");
		expect(s4).not.toContain(`blob/${"b".repeat(40)}/docs/v3/AUDIT.md`);
		// The fragment, grader and changelog links stay at the shipping commit.
		expect(byTitle(fake, "S1")[0]!.body).toContain(`blob/${"a".repeat(40)}/docs/v3/audit/2026-11-01/x-S1-completed.md`);
	});

	it("a second run makes no write for a bug whose symptoms end in a newline", () =>
	{
		const fake = withBug();
		fake.issues.get(50)!.body = "Steps: open a live game.\n\n";
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const calls = fake.calls.length;
		migrate(NOTES(), "b", h.io);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
	});

	it("throws when a write returns an issue that no longer carries the item's ID, rather than leave a duplicate for the next run", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		fake.intercept = (call, f) =>
		{
			if (call.method === "POST" && call.path.endsWith("/issues"))
			{
				f.intercept = undefined;
				const issue = f.add({
					title: "S1: x",
					labels: [],
				});
				return FakeGithub.respond(201, f.view(issue));
			}
			return undefined;
		};
		expect(() => migrate(NOTES(), "b", h.io)).toThrow(/S1: issue #\d+ as GitHub returned it carries no trusted ID S1/);
		expect(h.records).toEqual([]);
	});

	it("rewrites links relative to the backlog into links at the base commit, keeping anchors and leaving absolute URLs alone", () =>
	{
		const { fake, io } = harness(withBug());
		migrate(new Map([story("S7", "todo", "\nSee [VD](./VISUAL-DESIGN.md#videos), [A5](./visual/game-shell/amendments/A5.md), [web](https://example.test/a) and [here](#local).\n")]), "base9", io);
		const body = byTitle(fake, "S7")[0]!.body!;
		expect(body).toContain("[VD](https://github.com/owner/bt/blob/base9/docs/v3/VISUAL-DESIGN.md#videos)");
		expect(body).toContain("[A5](https://github.com/owner/bt/blob/base9/docs/v3/visual/game-shell/amendments/A5.md)");
		expect(body).toContain("[web](https://example.test/a)");
		expect(body).toContain("[here](#local)");
	});

	it("a bug note with no issue on GitHub is skipped and named, and nothing is recorded for it", () =>
	{
		const h = harness(withBug());
		const s = migrate(new Map([bug(60, "todo", 3)]), "b", h.io);
		expect(s.missing).toEqual(["B60"]);
		expect(h.records).toEqual([]);
		expect(summaryText(s, false)).toContain("bug notes with no issue: 1 (B60)");
	});

	it("paces writes: one second between write requests", () =>
	{
		const fake = withBug();
		const h = harness(fake);
		migrate(NOTES(), "b", h.io);
		const writes = fake.calls.filter((c) => c.method !== "GET").length;
		expect(writes).toBeGreaterThan(4);
		expect(h.sleeps.filter((ms) => ms === 1000)).toHaveLength(writes - 1);
	});
});
