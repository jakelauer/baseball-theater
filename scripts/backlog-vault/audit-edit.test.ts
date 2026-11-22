/**
 * Story text recorded first, applied after merge (S164 AC 6): `audit.sh create|edit` write a text
 * record and never call GitHub; `apply` (github.ts applyRecords) sends only what isn't live yet,
 * marking each with a trusted `Applied` comment, so a re-run after a lost response or a crash sends
 * no body twice. Runs the real audit.sh in a throwaway repository and apply against {@link FakeGithub}.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import {
	appliedComment, applyRecords, syncIssues,
} from "./github.ts";
import type { FakeIssue } from "./github-fake.ts";
import { FakeGithub } from "./github-fake.ts";
import { runLiveCheck } from "./live-check.ts";
import type { TextRecord } from "./text-records.ts";
import {
	parseRecord, readRecords, renderFields, renderRecord, sha256, textRecordProblems,
} from "./text-records.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";
const body = (text: string, priority = 4) => `**Gap:** ${text}\n\n**Source:** Feature: X\n\n${renderFields({
	priority,
	scope_files: ["x/"],
})}`;

let repo = "";
beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "s164-audit-edit-"));
});
afterEach(() => rmSync(repo, {
	recursive: true,
	force: true,
}));

function git(...args: string[]): string
{
	const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "core.hooksPath=/dev/null", ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout.trim();
}

/** A repository with audit.sh and the record tooling, and a `gh` on PATH that only notes it was called. */
function setup(): string
{
	git("init", "-q", "-b", "stage");
	for (const f of ["audit.sh", "lib/reverify.sh", "lib/checks.sh", "backlog-vault/text-records.ts", "backlog-vault/ledger.ts", "backlog-vault/github.ts", "backlog-vault/run-directly.ts"])
	{
		mkdirSync(dirname(join(repo, "scripts", f)), {
			recursive: true,
		});
		copyFileSync(join(SCRIPTS, f), join(repo, "scripts", f));
	}
	spawnSync("ln", ["-s", join(SCRIPTS, "../node_modules"), join(repo, "node_modules")]);
	mkdirSync(join(repo, "docs/v3"), {
		recursive: true,
	});
	writeFileSync(join(repo, "docs/v3/AUDIT.md"), `# Ledger\n\n${MARKER}\n`);
	writeFileSync(join(repo, ".gitignore"), "node_modules\n");
	git("add", "-A");
	git("commit", "-q", "-m", "base");
	const bin = join(repo, ".bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh"), `#!/bin/sh\ntouch "${join(repo, ".gh-called")}"\nexit 1\n`);
	chmodSync(join(bin, "gh"), 0o755);
	return bin;
}

function audit(bin: string, args: string[]): ReturnType<typeof spawnSync>
{
	return spawnSync("bash", [join(repo, "scripts/audit.sh"), ...args], {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			// The test's own cache and stage ref, never the developer's .backlog-cache or origin/stage.
			BT_BACKLOG_CACHE: join(repo, "cache"),
			BT_STAGE_REF: "refs/heads/test-stage",
		},
	});
}

function records(): TextRecord[]
{
	return readRecords(join(repo, "docs/v3/audit"));
}

let clock = 0;
function rec(kind: TextRecord["kind"], id: string, text: string, extra: { from?: string;
	issue?: number;
	title?: string } = {}): TextRecord
{
	clock++;
	const stamp = `2026-11-21T01:00:${String(clock).padStart(2, "0")}Z`;
	return parseRecord(renderRecord({
		kind,
		id,
		date: "2026-11-21",
		stamp,
		head: "h",
		body: text,
		...extra,
	}), `2026-11-21/${stamp.replace(/[-:]/g, "")}-${id}-${kind}.md`);
}

/** apply's dependencies over the fake: a sync into a cache under the test's directory. */
function io(fake: FakeGithub)
{
	return {
		run: fake.run,
		sleep: () => undefined,
		sync: () => syncIssues(repo, {
			run: fake.run,
			env: {
				BT_BACKLOG_CACHE: join(repo, "cache"),
			},
		}).cache,
	};
}

describe("recording (AC 6)", () =>
{
	it("a create and an edit write their fragments, chained, with no GitHub call", () =>
	{
		const bin = setup();
		writeFileSync(join(repo, "v1.md"), body("one"));
		writeFileSync(join(repo, "v2.md"), body("two"));
		const c = audit(bin, ["create", "S170", "--title", "a new story", "--body-file", "v1.md", "--reason", "the owner asked"]);
		expect(c.status, String(c.stderr)).toBe(0);
		const e = audit(bin, ["edit", "S170", "--body-file", "v2.md", "--reason", "review answer"]);
		expect(e.status, String(e.stderr)).toBe(0);
		const [create, edit] = records();
		expect(create!.kind).toBe("create");
		expect(create!.title).toBe("a new story");
		expect(edit!.from).toBe(sha256(body("one")));
		expect(edit!.body).toBe(body("two"));
		expect(textRecordProblems(records(), [])).toEqual([]);
		expect(existsSync(join(repo, ".gh-called"))).toBe(false);
		expect(audit(bin, ["create", "S170", "--title", "again", "--body-file", "v1.md", "--reason", "r"]).status).toBe(2);
		expect(audit(bin, ["edit", "S170", "--body-file", "v2.md", "--reason", "same"]).status).toBe(2);
		const status = audit(bin, ["edit", "S170", "--body-file", "v1.md", "--reason", "r", "--status", "done"]);
		expect(status.status).toBe(2);
		expect(String(status.stderr)).toContain("GitHub owns state");
	});

	it("an accepted bug's create B<N> --issue records its fields block alone, never the symptoms", () =>
	{
		const bin = setup();
		writeFileSync(join(repo, "bug.md"), `Steps: open the scoreboard.\n\n${renderFields({
			priority: 61.5,
		})}`);
		const r = audit(bin, ["create", "B140", "--issue", "140", "--body-file", "bug.md"]);
		expect(r.status, String(r.stderr)).toBe(0);
		const [bug] = records();
		expect(bug!.issue).toBe(140);
		expect(bug!.body.startsWith("### Backlog fields")).toBe(true);
		expect(bug!.body).not.toContain("Steps");
		expect(existsSync(join(repo, ".gh-called"))).toBe(false);
	});

	it("two branches' edits of one story are reported as a fork naming both fragments, until one is recorded again on top of stage", () =>
	{
		const bin = setup();
		writeFileSync(join(repo, "v1.md"), body("one"));
		audit(bin, ["create", "S171", "--title", "t", "--body-file", "v1.md", "--reason", "r"]);
		git("add", "-A");
		git("commit", "-q", "-m", "create");
		git("switch", "-q", "-c", "a");
		writeFileSync(join(repo, "a.md"), body("from a"));
		audit(bin, ["edit", "S171", "--body-file", "a.md", "--reason", "a"]);
		git("add", "docs");
		git("commit", "-q", "-m", "a");
		git("switch", "-q", "stage");
		git("switch", "-q", "-c", "b");
		spawnSync("sleep", ["1"]);
		writeFileSync(join(repo, "b.md"), body("from b"));
		audit(bin, ["edit", "S171", "--body-file", "b.md", "--reason", "b"]);
		git("add", "docs");
		git("commit", "-q", "-m", "b");
		const bFile = records().find((r) => r.reason === "b")!.file;
		git("switch", "-q", "stage");
		git("merge", "-q", "a");
		git("merge", "-q", "--no-edit", "b");
		const problems = textRecordProblems(records(), []).join("\n");
		expect(problems).toMatch(/forks/);
		expect(problems).toContain(bFile);
		expect(problems).toContain(records().find((r) => r.reason === "a")!.file);
		// The recovery: delete the unmerged fragment, then re-run the same command on top of stage.
		rmSync(join(repo, "docs/v3/audit", bFile));
		expect(audit(bin, ["edit", "S171", "--body-file", "b.md", "--reason", "b"]).status).toBe(0);
		expect(textRecordProblems(records(), [])).toEqual([]);
		expect(readFileSync(join(repo, "b.md"), "utf8")).toBe(body("from b"));
	});
});

describe("apply (AC 6)", () =>
{
	it("sends only what isn't live yet: a migrated body and an applied edit are skipped", () =>
	{
		const fake = new FakeGithub();
		const migrated = rec("migration", "S20", body("v1"), {
			issue: 1,
		});
		fake.add({
			number: 1,
			title: "S20: twenty",
			labels: [{
				name: "story",
			}],
			body: body("v1"),
		});
		const e1 = rec("edit", "S20", body("v2"), {
			from: migrated.hash,
		});
		const e2 = rec("edit", "S20", body("v3"), {
			from: e1.hash,
		});
		fake.issues.get(1)!.body = body("v2");
		fake.issues.get(1)!.comments.push({
			body: appliedComment(e1),
			user: {
				login: "owner",
			},
		});
		const result = applyRecords([migrated, e1, e2], io(fake));
		expect(result.sent).toEqual(["S20 edit"]);
		expect(fake.issues.get(1)!.body).toBe(body("v3"));
		expect(fake.issues.get(1)!.comments.at(-1)!.body).toBe(appliedComment(e2));
	});

	it("a lost POST response: the re-run finds the issue by its ID, sends no body and posts the missing comment", () =>
	{
		const fake = new FakeGithub();
		const create = rec("create", "S21", body("new"), {
			title: "twenty-one",
		});
		let lose = true;
		fake.intercept = (call, f) =>
		{
			if (lose && call.method === "POST" && call.path.endsWith("/issues"))
			{
				lose = false;
				f.intercept = undefined;
				(f as unknown as { answer: (c: typeof call) => string }).answer(call);
				return "HTTP/2.0 502 Bad Gateway\n\n{}";
			}
			return undefined;
		};
		expect(() => applyRecords([create], io(fake))).toThrow(/502/);
		expect(fake.issues.size).toBe(1);
		const before = fake.calls.length;
		applyRecords([create], io(fake));
		const after = fake.calls.slice(before);
		expect(after.filter((c) => c.method === "POST" && c.path.endsWith("/issues"))).toHaveLength(0);
		expect(after.filter((c) => c.method === "PATCH")).toHaveLength(0);
		expect(fake.issues.size).toBe(1);
		expect(fake.issues.get(1)!.title).toBe("S21: twenty-one");
		expect(fake.issues.get(1)!.comments.map((c) => c.body)).toEqual([appliedComment(create)]);
	});

	it("a crash after a PATCH: the re-run sends no body and posts the missing Applied comment", () =>
	{
		const fake = new FakeGithub();
		const migrated = rec("migration", "S22", body("v1"), {
			issue: 1,
		});
		const edit = rec("edit", "S22", body("v2"), {
			from: migrated.hash,
		});
		fake.add({
			number: 1,
			title: "S22: x",
			labels: [{
				name: "story",
			}],
			body: body("v1"),
		});
		fake.intercept = (call, f) =>
		{
			if (call.method === "POST" && call.path.endsWith("/comments"))
			{
				f.intercept = undefined;
				throw new Error("crashed");
			}
			return undefined;
		};
		expect(() => applyRecords([migrated, edit], io(fake))).toThrow("crashed");
		expect(fake.issues.get(1)!.body).toBe(body("v2"));
		const before = fake.calls.length;
		applyRecords([migrated, edit], io(fake));
		expect(fake.calls.slice(before).filter((c) => c.method === "PATCH")).toHaveLength(0);
		expect(fake.issues.get(1)!.comments.map((c) => c.body)).toEqual([appliedComment(edit)]);
	});

	it("an Applied comment written by an outsider doesn't count: the record is applied again", () =>
	{
		const fake = new FakeGithub();
		const migrated = rec("migration", "S23", body("v1"), {
			issue: 1,
		});
		const edit = rec("edit", "S23", body("v2"), {
			from: migrated.hash,
		});
		fake.add({
			number: 1,
			title: "S23: x",
			labels: [{
				name: "story",
			}],
			body: body("owner's revert"),
			comments: [{
				body: appliedComment(edit),
				user: {
					login: "stranger",
				},
			}],
		});
		expect(applyRecords([migrated, edit], io(fake)).sent).toEqual(["S23 edit"]);
		expect(fake.issues.get(1)!.body).toBe(body("v2"));
	});

	it("a returned-body mismatch fails naming the item, then a second apply succeeds", () =>
	{
		const fake = new FakeGithub();
		const migrated = rec("migration", "S24", body("v1"), {
			issue: 1,
		});
		const edit = rec("edit", "S24", body("v2"), {
			from: migrated.hash,
		});
		fake.add({
			number: 1,
			title: "S24: x",
			labels: [{
				name: "story",
			}],
			body: body("v1"),
		});
		fake.intercept = (call, f) =>
		{
			if (call.method === "PATCH")
			{
				f.intercept = undefined;
				const issue = f.issues.get(1)!;
				// Not what was sent (a CRLF copy would count as live: GitHub's web editor saves CRLF).
				issue.body = body("v2, mangled in between");
				return FakeGithub.respond(200, f.view(issue));
			}
			return undefined;
		};
		expect(() => applyRecords([migrated, edit], io(fake))).toThrow(/S24: issue #1's body .* does not hash/);
		expect(fake.issues.get(1)!.comments).toHaveLength(0);
		expect(applyRecords([migrated, edit], io(fake)).sent).toEqual(["S24 edit"]);
		expect(fake.issues.get(1)!.body).toBe(body("v2"));
	});

	it("a second apply sends nothing, since each record has its trusted Applied comment", () =>
	{
		const fake = new FakeGithub();
		const create = rec("create", "S25", body("a"), {
			title: "x",
		});
		const edit = rec("edit", "S25", body("b"), {
			from: create.hash,
		});
		const first = applyRecords([create, edit], io(fake));
		expect(first.created).toEqual(["S25"]);
		expect(first.sent).toEqual(["S25 edit"]);
		const before = fake.calls.length;
		const second = applyRecords([create, edit], io(fake));
		expect(second).toEqual({
			sent: [],
			commented: [],
			created: [],
		});
		expect(fake.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
	});

	it("an accepted bug's fields block is set on its issue, leaving the symptoms", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			number: 140,
			title: "Video stalls",
			labels: [{
				name: "bug",
			}],
			body: "Steps: play a clip.",
			user: {
				login: "stranger",
			},
		});
		const fields = rec("create", "B140", renderFields({
			priority: 61.5,
		}), {
			issue: 140,
		});
		applyRecords([fields], io(fake));
		expect(fake.issues.get(140)!.body).toBe(`Steps: play a clip.\n\n${renderFields({
			priority: 61.5,
		})}`);
	});

	it("a bug's symptoms ending in newlines get the fields block after one blank line, as the migration writes it", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			number: 141,
			title: "Clip stalls",
			labels: [{
				name: "bug",
			}],
			body: "Steps: play a clip.\n\n",
		});
		const fields = rec("create", "B141", renderFields({
			priority: 2,
		}), {
			issue: 141,
		});
		applyRecords([fields], io(fake));
		expect(fake.issues.get(141)!.body).toBe(`Steps: play a clip.\n\n${renderFields({
			priority: 2,
		})}`);
	});

	it("A→B→A→C applies all three edits in order, each keyed to its own record", () =>
	{
		const fake = new FakeGithub();
		const a = rec("migration", "S24", body("A"), {
			issue: 1,
		});
		fake.add({
			number: 1,
			title: "S24: x",
			labels: [{
				name: "story",
			}],
			body: body("A"),
		});
		const toB = rec("edit", "S24", body("B"), {
			from: a.hash,
		});
		const toA = rec("edit", "S24", body("A"), {
			from: toB.hash,
		});
		const toC = rec("edit", "S24", body("C"), {
			from: toA.hash,
		});
		expect(textRecordProblems([a, toB, toA, toC], [])).toEqual([]);
		const result = applyRecords([a, toB, toA, toC], io(fake));
		expect(result.commented).toEqual(["S24 edit", "S24 edit", "S24 edit"]);
		expect(fake.issues.get(1)!.comments.map((c) => c.body)).toEqual([appliedComment(toB), appliedComment(toA), appliedComment(toC)]);
		expect(fake.issues.get(1)!.body).toBe(body("C"));
		const before = fake.calls.length;
		applyRecords([a, toB, toA, toC], io(fake));
		expect(fake.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
	});

	it("apply refuses a create colliding with another issue carrying its ID", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			number: 1,
			title: "S25: someone else's story",
			labels: [{
				name: "story",
			}],
			body: body("theirs"),
		});
		const create = rec("create", "S25", body("mine"), {
			title: "mine",
		});
		expect(() => applyRecords([create], io(fake))).toThrow(/S25: issue #1 already carries S25 with other text/);
		expect(fake.calls.filter((c) => c.method !== "GET")).toEqual([]);
		expect(fake.issues.get(1)!.body).toBe(body("theirs"));
	});

	it("apply skips listing comments for a chain whose only record is the migration", () =>
	{
		const fake = new FakeGithub();
		fake.add({
			number: 1,
			title: "S26: x",
			labels: [{
				name: "story",
			}],
			body: body("v1"),
		});
		applyRecords([rec("migration", "S26", body("v1"), {
			issue: 1,
		})], io(fake));
		expect(fake.calls.filter((c) => c.path.includes("/comments"))).toEqual([]);
	});

	it("apply refuses a dirty tree under docs/v3/audit (an untracked record fragment included), and not an unrelated edit elsewhere", () =>
	{
		const bin = setup();
		const apply = () => spawnSync("bash", [join(repo, "scripts/audit.sh"), "apply"], {
			cwd: repo,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				BT_APPLY_ANY_HEAD: "1",
				BT_BACKLOG_CACHE: join(repo, "cache"),
			},
		});
		mkdirSync(join(repo, "docs/v3/audit/2026-11-21"), {
			recursive: true,
		});
		writeFileSync(join(repo, "docs/v3/audit/2026-11-21/20261121T000000Z-S1-edit.md"), "unmerged\n");
		const r = apply();
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/clean tree under docs\/v3\/audit/);
		expect(existsSync(join(repo, ".gh-called"))).toBe(false);
		rmSync(join(repo, "docs/v3/audit"), {
			recursive: true,
		});
		writeFileSync(join(repo, ".gitignore"), "node_modules\nchanged\n");
		const elsewhere = apply();
		expect(elsewhere.stderr).not.toMatch(/clean tree/);
		// It went on to apply (here the stub gh fails the sync).
		expect(existsSync(join(repo, ".gh-called"))).toBe(true);
	});
});

describe("recording guards (AC 6)", () =>
{
	it("edit B<N> records only the fields block, and a body whose fields block is unchanged is already its text", () =>
	{
		const bin = setup();
		const fields = (priority: number) => renderFields({
			priority,
		});
		writeFileSync(join(repo, "b1.md"), `Steps: one.\n\n${fields(3)}`);
		expect(audit(bin, ["create", "B150", "--issue", "150", "--body-file", "b1.md"]).status).toBe(0);
		writeFileSync(join(repo, "b2.md"), `Steps: one, now with more.\n\n${fields(4)}`);
		const e = audit(bin, ["edit", "B150", "--body-file", "b2.md", "--reason", "re-prioritized"]);
		expect(e.status, String(e.stderr)).toBe(0);
		const edit = records().find((r) => r.kind === "edit")!;
		expect(edit.body).toBe(fields(4));
		expect(textRecordProblems(records(), [])).toEqual([]);
		writeFileSync(join(repo, "b3.md"), `Different symptoms.\n\n${fields(4)}`);
		const same = audit(bin, ["edit", "B150", "--body-file", "b3.md", "--reason", "nothing new"]);
		expect(same.status).toBe(2);
		expect(same.stderr).toContain("already");
	});

	it("create S<N> refuses an ID already taken (an issue, a stage fragment) or with leading zeros", () =>
	{
		const bin = setup();
		writeFileSync(join(repo, "v1.md"), body("one"));
		mkdirSync(join(repo, "cache"));
		writeFileSync(join(repo, "cache/issues.json"), JSON.stringify({
			repo: "o/r",
			trusted: ["o"],
			syncedAt: "x",
			issues: [{
				number: 9,
				title: "S172: on GitHub",
				state: "open",
				labels: [{
					name: "story",
				}],
				user: {
					login: "o",
				},
				body: body("x"),
			}],
		}));
		git("switch", "-q", "-c", "test-stage");
		mkdirSync(join(repo, "docs/v3/audit/2026-11-21"), {
			recursive: true,
		});
		writeFileSync(join(repo, "docs/v3/audit/2026-11-21/20261121T000000Z-S173-create.md"), "x");
		git("add", "docs");
		git("commit", "-q", "-m", "stage's record");
		git("switch", "-q", "stage");
		const onGithub = audit(bin, ["create", "S172", "--title", "t", "--body-file", "v1.md", "--reason", "r"]);
		expect(onGithub.status).toBe(2);
		expect(onGithub.stderr).toContain("issue #9 carries S172");
		expect(audit(bin, ["create", "S173", "--title", "t", "--body-file", "v1.md", "--reason", "r"]).stderr).toContain("stage's 20261121T000000Z-S173-create.md");
		expect(audit(bin, ["create", "S0174", "--title", "t", "--body-file", "v1.md", "--reason", "r"]).status).toBe(2);
		const free = audit(bin, ["create", "S174", "--title", "t", "--body-file", "v1.md", "--reason", "r"]);
		expect(free.status, String(free.stderr)).toBe(0);
		// An interrupted reconcile made #9 live first: its own create records S172 against it, and only it.
		expect(audit(bin, ["create", "S172", "--title", "t", "--body-file", "v1.md", "--reason", "r", "--issue", "8"]).stderr).toContain("issue #9 carries S172");
		const own = audit(bin, ["create", "S172", "--title", "t", "--body-file", "v1.md", "--reason", "r", "--issue", "9"]);
		expect(own.status, String(own.stderr)).toBe(0);
		expect(existsSync(join(repo, ".gh-called"))).toBe(false);
	});
});

describe("adopting the owner's GitHub edit (S165 AC 2)", () =>
{
	/** A `gh` on PATH that answers from a {@link FakeGithub} kept in a JSON file, so audit.sh's own calls reach the fake. */
	function shim(fake: FakeGithub): { bin: string;
		state: string;
		load: () => void;
		save: () => void; }
	{
		const bin = join(repo, ".fake-gh");
		const state = join(repo, "fake-gh.json");
		mkdirSync(bin, {
			recursive: true,
		});
		writeFileSync(join(bin, "shim.ts"), `import { readFileSync, writeFileSync } from "node:fs";
import { FakeGithub } from ${JSON.stringify(join(SCRIPTS, "backlog-vault/github-fake.ts"))};
const file = process.env.FAKE_GH_STATE!;
const saved = JSON.parse(readFileSync(file, "utf8"));
const fake = new FakeGithub(saved.owner, saved.viewer, saved.repo);
fake.tick = saved.tick;
for (const i of saved.issues) fake.issues.set(i.number, i);
process.stdout.write(fake.run(process.argv.slice(2)));
writeFileSync(file, JSON.stringify({ owner: fake.owner, viewer: fake.viewer, repo: fake.repo, tick: fake.tick, issues: [...fake.issues.values()] }));
`);
		writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec node ${JSON.stringify(join(bin, "shim.ts"))} "$@"\n`);
		chmodSync(join(bin, "gh"), 0o755);
		const save = () => writeFileSync(state, JSON.stringify({
			owner: fake.owner,
			viewer: fake.viewer,
			repo: fake.repo,
			tick: fake.tick,
			issues: [...fake.issues.values()],
		}));
		const load = () =>
		{
			const saved = JSON.parse(readFileSync(state, "utf8")) as { tick: number;
				issues: FakeIssue[] };
			fake.tick = saved.tick;
			fake.issues = new Map(saved.issues.map((i) => [i.number, i]));
		};
		return {
			bin,
			state,
			load,
			save,
		};
	}

	const env = () => ({
		BT_BACKLOG_CACHE: join(repo, "cache"),
		BT_AUDIT_LEDGER: join(repo, "docs/v3/AUDIT.md"),
		BT_STAGE_REF: "refs/heads/no-such-stage",
	});

	/** A story recorded, applied to the fake, then changed by the owner on GitHub. */
	function ownerEdited(): { fake: FakeGithub;
		gh: ReturnType<typeof shim>; }
	{
		const bin = setup();
		writeFileSync(join(repo, "v1.md"), body("one"));
		expect(audit(bin, ["create", "S170", "--title", "t", "--body-file", "v1.md", "--reason", "r"]).status).toBe(0);
		const fake = new FakeGithub();
		applyRecords(records(), io(fake));
		fake.issues.get(1)!.body = body("the owner's own words");
		return {
			fake,
			gh: shim(fake),
		};
	}

	function adopt(gh: ReturnType<typeof shim>, id = "S170"): ReturnType<typeof spawnSync>
	{
		gh.save();
		const r = spawnSync("bash", [join(repo, "scripts/audit.sh"), "edit", id, "--adopt", "--reason", "owner, 2026-11-21: \"keep my wording\""], {
			cwd: repo,
			encoding: "utf8",
			env: {
				...process.env,
				...env(),
				PATH: `${gh.bin}:${process.env.PATH}`,
				FAKE_GH_STATE: gh.state,
			},
		});
		gh.load();
		return r;
	}

	it("an adopt records the live body, posts its Applied comment and turns a failing --live check green", () =>
	{
		const { fake, gh } = ownerEdited();
		syncIssues(repo, {
			run: fake.run,
			env: env(),
		});
		expect(runLiveCheck(repo, env(), fake.run).failures).toEqual([expect.stringContaining("S170 (#1): unlogged edit")]);
		const r = adopt(gh);
		expect(r.status, String(r.stderr)).toBe(0);
		const edit = records().at(-1)!;
		expect(edit.kind).toBe("edit");
		expect(edit.body).toBe(body("the owner's own words"));
		expect(edit.from).toBe(sha256(body("one")));
		expect(edit.reason).toContain("keep my wording");
		expect(fake.issues.get(1)!.comments.at(-1)!.body).toBe(appliedComment(edit));
		syncIssues(repo, {
			run: fake.run,
			env: env(),
		});
		expect(runLiveCheck(repo, env(), fake.run).failures).toEqual([]);
	});

	it("an adopt is refused when GitHub already matches the newest record", () =>
	{
		const { fake, gh } = ownerEdited();
		fake.issues.get(1)!.body = body("one");
		syncIssues(repo, {
			run: fake.run,
			env: env(),
		});
		const before = records().length;
		const r = adopt(gh);
		expect(r.status).toBe(2);
		expect(String(r.stderr)).toContain("nothing to adopt");
		expect(records().length).toBe(before);
	});

	/** An outside bug, B140, accepted in place (its fields block recorded), with the live body `live`. */
	function bugWith(live: (fields: string) => string): { fake: FakeGithub;
		gh: ReturnType<typeof shim>; }
	{
		const bin = setup();
		const fields = renderFields({
			priority: 61.5,
		});
		writeFileSync(join(repo, "bug.md"), `Steps: play a clip.\n\n${fields}`);
		expect(audit(bin, ["create", "B140", "--issue", "140", "--body-file", "bug.md"]).status).toBe(0);
		const fake = new FakeGithub();
		fake.add({
			number: 140,
			title: "Video stalls",
			labels: [{
				name: "bug",
			}],
			body: live(fields),
			user: {
				login: "stranger",
			},
		});
		syncIssues(repo, {
			run: fake.run,
			env: env(),
		});
		return {
			fake,
			gh: shim(fake),
		};
	}

	it("an adopt of a bug records only its fields block, never the symptoms", () =>
	{
		const { fake, gh } = bugWith(() => `Steps, as the filer wrote them.\n\n${renderFields({
			priority: 2,
		})}`);
		const r = adopt(gh, "B140");
		expect(r.status, String(r.stderr)).toBe(0);
		const edit = records().at(-1)!;
		expect(edit.kind).toBe("edit");
		expect(edit.body).toBe(renderFields({
			priority: 2,
		}));
		expect(edit.body).not.toContain("Steps");
		expect(fake.issues.get(140)!.comments.at(-1)!.body).toBe(appliedComment(edit));
	});

	it.each([
		["in its symptoms", (f: string) => `Steps: play a clip.  \n\n\n\n${f}`],
		["a missing final newline", (f: string) => `Steps: play a clip.\n\n${f.replace(/\n$/, "")}`],
	])("an adopt is refused when a bug differs only by whitespace (%s)", (_what, live) =>
	{
		const { gh } = bugWith(live);
		const before = records().length;
		const r = adopt(gh, "B140");
		expect(r.status).toBe(2);
		expect(String(r.stderr)).toContain("nothing to adopt");
		expect(records().length).toBe(before);
	});
});
