/**
 * `pnpm backlog:migrate` (S164 AC 4) against {@link FakeGithub}: one issue per story note, bug notes
 * folded into their issues, idempotent across a stop at any point, a rate limit waited out, the done
 * stories' `### Shipped` sections, the open stories' rewrites, and `--reconcile` keeping it current.
 */
import {
	describe, expect, it,
} from "vitest";
import type { IssueCache } from "./github.ts";
import { appliedHashes } from "./github.ts";
import { FakeGithub } from "./github-fake.ts";
import type {
	MigrateIO, RecordRequest, Shipped,
} from "./migrate.ts";
import {
	migrate, rewriteOpen, shippedSection, summaryText,
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
			ledger: "docs/v3/AUDIT.md#L120",
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
		expect(s4).toContain(`[\`docs/v3/AUDIT.md\`](https://github.com/owner/bt/blob/${"b".repeat(40)}/docs/v3/AUDIT.md#L120)`);
		expect(shippedSection({}, "o/r")).toContain("not recorded in the ledger");
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
		expect(h.sleeps).toEqual([7000]);
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
			reconcile: true,
		});
		const added = h.records.slice(before);
		expect(added.map((r) => `${r.id} ${r.kind}`).sort()).toEqual(["S3 edit", "S4 edit", "S9 create"]);
		expect(added.every((r) => r.base === "stage456")).toBe(true);
		expect(byTitle(fake, "S3")[0]!.body).toContain("a review added this");
		const s3 = byTitle(fake, "S3")[0]!;
		expect(appliedHashes(s3.comments, "S3", ["owner"]).has(sha256(s3.body!))).toBe(true);
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
		migrate(NOTES(), "stage1", h.io, {
			reconcile: true,
		});
		const records = h.records.length;
		const calls = fake.calls.length;
		const s = migrate(NOTES(), "stage1", h.io, {
			reconcile: true,
		});
		expect(h.records).toHaveLength(records);
		expect(fake.calls.slice(calls).filter((c) => c.method !== "GET")).toEqual([]);
		expect(s.recorded).toEqual([]);
	});
});
