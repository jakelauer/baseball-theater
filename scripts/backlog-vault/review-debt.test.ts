/**
 * scripts/review-debt.sh decides whether a design intake review is due. The owner's rule that a
 * draft design never makes one due (owner, 2026-11-10: "So I would just avoid doing any design
 * reviews on draft designs.") is enforced only there, so these cases keep `pnpm verify` red if
 * its draft filter is deleted, inverted, matches too broadly, or misjudges a deleted amendment.
 * An amendment edit that only changes the URL on its `Source:` line doesn't make one due either
 * (owner, 2026-11-16: "Yes"); the cases below also break if that exemption grows past the URL.
 * Runs the real script in a throwaway git repository.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { LEDGER_MARKER } from "./ledger.ts";
import {
	renderFields, renderRecord, sha256,
} from "./text-records.ts";

const VAULT = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(VAULT, "..");
const ROOT = join(SCRIPTS, "..");
/** Each case spawns git and two `node cli.ts` runs. */
const TIMEOUT = 20_000;

const AMENDMENT = "docs/v3/visual/surface/amendments/A2.md";
const DRAFT = "# A2\n\nAmends the ratified design. **Draft, not ratified.**\n";
const RATIFIED = "# A2\n\nAmends the ratified design.\n\n## Ratification\n\nRatified by: Jake Lauer\nDate: 2026-11-10\nGo-ahead: \"Ratify it\"\n";
/** A draft whose body says "ratified by" in a sentence: still a draft. */
const DRAFT_MENTIONING = `${DRAFT}\nThe version line as ratified by A6 stays.\n`;
/** Both marks: counts as ratified, so a doubt runs the intake. */
const DOUBT = `${DRAFT}\n## Ratification\n\nRatified by: Jake Lauer\n`;

let repo: string;

function git(...args: string[]): string
{
	const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
	return run.stdout.trim();
}

function write(path: string, text: string): void
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), text);
}

function commit(message: string): void
{
	git("add", "-A");
	git("commit", "-q", "-m", message);
}

/**
 * A repo with the script, the ledger tool it calls, and a ledger whose one backlog review is
 * logged by the first commit, which also holds `files`; that commit is the script's base.
 */
function reviewed(files: Record<string, string> = {}): void
{
	git("init", "-q", "-b", "main");
	mkdirSync(join(repo, "scripts/backlog-vault"), {
		recursive: true,
	});
	copyFileSync(join(SCRIPTS, "review-debt.sh"), join(repo, "scripts/review-debt.sh"));
	copyFileSync(join(SCRIPTS, "parity-debt.sh"), join(repo, "scripts/parity-debt.sh"));
	mkdirSync(join(repo, "scripts/lib"));
	copyFileSync(join(SCRIPTS, "lib/story-notes.sh"), join(repo, "scripts/lib/story-notes.sh"));
	// Every module cli.ts may import; tests are left out.
	for (const name of readdirSync(VAULT).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")))
	{
		copyFileSync(join(VAULT, name), join(repo, "scripts/backlog-vault", name));
	}
	// The ledger tool imports `yaml`, resolved from the real repo's root dependencies.
	symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"));
	write(".gitignore", "node_modules\n");
	write("package.json", "{\"type\":\"module\",\"scripts\":{\"verify\":\"x\"}}\n");
	write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n`);
	for (const [path, text] of Object.entries(files)) write(path, text);
	commit("base: a backlog review");
}

/** An issue cache holding `issues` (none by default), as pnpm backlog:sync writes it; returns its folder. */
function cache(issues: unknown[] = []): string
{
	const dir = join(repo, ".test-cache");
	mkdirSync(dir, {
		recursive: true,
	});
	writeFileSync(join(dir, "issues.json"), JSON.stringify({
		repo: "o/r",
		trusted: ["o"],
		syncedAt: "x",
		issues,
	}));
	return dir;
}

function debt(script = "review-debt.sh", args: string[] = [], extra: Record<string, string> = {}): { status: number | null;
	stdout: string }
{
	const env: Record<string, string | undefined> = {
		...process.env,
		// The test's own issue cache (empty unless a test fills it), never the developer's .backlog-cache.
		BT_BACKLOG_CACHE: existsSync(join(repo, ".test-cache")) ? join(repo, ".test-cache") : cache(),
		...extra,
	};
	delete env.BT_AUDIT_LEDGER;
	const run = spawnSync("bash", [join(repo, "scripts", script), ...args], {
		cwd: repo,
		encoding: "utf8",
		env,
	});
	return {
		status: run.status,
		stdout: `${run.stdout}${run.stderr}`,
	};
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "review-debt-"));
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("review-debt.sh: drafts and Source-link-only edits never make a design intake due", () =>
{
	it("a draft amendment added after the review: not due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT);
		commit("draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a ratified amendment added: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, RATIFIED);
		commit("ratified");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a draft then ratified: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT);
		commit("draft");
		write(AMENDMENT, RATIFIED);
		commit("ratify");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a draft that says \"ratified by\" in a sentence is still a draft: not due", () =>
	{
		reviewed();
		write(AMENDMENT, DRAFT_MENTIONING);
		commit("draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
	}, TIMEOUT);

	it("a draft marker with a real \"Ratified by:\" line counts as ratified: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, DOUBT);
		commit("doubt");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a draft deleted after the review: not due", () =>
	{
		reviewed({
			[AMENDMENT]: DRAFT,
		});
		git("rm", "-q", AMENDMENT);
		commit("drop the draft");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
	}, TIMEOUT);

	it("a ratified amendment deleted after the review: intake due", () =>
	{
		reviewed({
			[AMENDMENT]: RATIFIED,
		});
		git("rm", "-q", AMENDMENT);
		commit("drop the amendment");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("design intake review is due");
	}, TIMEOUT);

	it("a ratified amendment whose only change is its Source: link: not due", () =>
	{
		reviewed({
			[AMENDMENT]: `${RATIFIED}\nSource: https://www.figma.com/design/f\n`,
		});
		write(AMENDMENT, `${RATIFIED}\nSource: https://www.figma.com/design/f?node-id=1-2\n`);
		commit("link only");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a ratified amendment whose Source: link and another line change: intake due", () =>
	{
		reviewed({
			[AMENDMENT]: `${RATIFIED}\nSource: https://www.figma.com/design/f\n`,
		});
		write(AMENDMENT, `${RATIFIED}\nSource: https://www.figma.com/design/f?node-id=1-2\nThe bar is gold.\n`);
		commit("link and a rule");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a ratified amendment whose Source: line names a different frame: intake due", () =>
	{
		reviewed({
			[AMENDMENT]: `${RATIFIED}\nSource: https://www.figma.com/design/f — frames \`a-mobile\` and \`a-desktop\`\n`,
		});
		write(AMENDMENT, `${RATIFIED}\nSource: https://www.figma.com/design/f — frames \`a-mobile\`, \`a-medium\` and \`a-desktop\`\n`);
		commit("another frame");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a ratified amendment whose Source: link changes and a line starting \"-- \" goes: intake due", () =>
	{
		reviewed({
			[AMENDMENT]: `${RATIFIED}\nSource: https://www.figma.com/design/f\n-- the bar is gold\n`,
		});
		write(AMENDMENT, `${RATIFIED}\nSource: https://www.figma.com/design/f?node-id=1-2\n`);
		commit("link and a dash line");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a ratified amendment added holding only a Source: line: intake due", () =>
	{
		reviewed();
		write(AMENDMENT, "Source: https://www.figma.com/design/f\n");
		commit("source only, new");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("A2.md added or changed");
	}, TIMEOUT);

	it("a surface's RATIFIED.md added: intake due", () =>
	{
		reviewed();
		write("docs/v3/visual/surface/RATIFIED.md", "Ratified.\n");
		commit("ratify the surface");
		const run = debt();
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("RATIFIED.md added or changed");
	}, TIMEOUT);
});

/** A story note as `pnpm backlog:build` writes it, enough for the debt scripts' checks. */
function note(status: string, { ac = "1. It works.", source = "Feature: Standings" } = {}): string
{
	return `---\nid: S7\npriority: 3\nstatus: ${status}\n---\n\n**Gap:** none.\n\n**Source:** ${source}\n\n**Acceptance criteria**\n\n${ac}\n\n**Turn cap:** 5\n`;
}

const STORIES = "docs/v3/backlog/stories";
const BUGS = "docs/v3/backlog/bugs";
/** A bug note for issue #74 (bugs.ts): a status and a priority, nothing a debt script reads. */
const bugNote = (status: string, priority: number) => `---\nid: B74\nissue: 74\ntitle: A bug\npriority: ${priority}\nstatus: ${status}\n---\n\nhttps://github.com/o/r/issues/74\n`;

/** `git mv`, as `pnpm backlog:build` moves a note: into its status folder, made if missing. */
function move(from: string, to: string): void
{
	mkdirSync(dirname(join(repo, to)), {
		recursive: true,
	});
	git("mv", from, to);
}

/**
 * Story notes sit in status folders and move when their status changes (owner, 2026-11-17: "I would
 * like the backlog folder organization to put stories into folders by state"). Both debt scripts
 * match notes by story ID, so a move alone is not a story added or removed, while an edit made with
 * a move still counts, including from a base that still had the flat layout.
 */
describe.each(["review-debt.sh", "parity-debt.sh"])("%s: story notes moved between status folders", (script) =>
{
	const dueFor = script === "review-debt.sh" ? "S7's acceptance criteria rewritten" : "S7's **Source:** changed";
	const edited = script === "review-debt.sh" ? note("done", {
		ac: "1. It works twice.",
	}) : note("done", {
		source: "Feature: Scoreboard",
	});

	it("a pure status move (todo → done): not due", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		move(`${STORIES}/todo/S7.md`, `${STORIES}/done/S7.md`);
		write(`${STORIES}/done/S7.md`, note("done"));
		commit("S7 done");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a bug note in the base, re-prioritized, then moved to done: not due (the debt scripts read story notes only)", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
			[`${BUGS}/todo/B74.md`]: bugNote("todo", 3),
		});
		write(`${BUGS}/todo/B74.md`, bugNote("todo", 1));
		commit("B74 re-prioritized");
		move(`${BUGS}/todo/B74.md`, `${BUGS}/done/B74.md`);
		write(`${BUGS}/done/B74.md`, bugNote("done", 1));
		commit("B74 fixed");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a bug note added: not due (the debt scripts read story notes only)", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		write(`${BUGS}/todo/B74.md`, bugNote("todo", 3));
		commit("B74 filed");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("not due");
	}, TIMEOUT);

	it("a move from the flat layout (base before status folders): not due", () =>
	{
		reviewed({
			[`${STORIES}/S7.md`]: note("todo"),
		});
		move(`${STORIES}/S7.md`, `${STORIES}/todo/S7.md`);
		commit("status folders");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(0);
	}, TIMEOUT);

	it("a move with an edit is an edit, not an add or remove: due", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		move(`${STORIES}/todo/S7.md`, `${STORIES}/done/S7.md`);
		write(`${STORIES}/done/S7.md`, edited);
		commit("S7 done, rewritten");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain(dueFor);
		expect(run.stdout).not.toMatch(/S7 (inserted|removed|added)/);
	}, TIMEOUT);

	it("a story really removed: due", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		git("rm", "-q", `${STORIES}/todo/S7.md`);
		commit("S7 dropped");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toMatch(/S7 (removed outside a review|removed)/);
	}, TIMEOUT);

	it("a priority change made with a move: a re-prioritization for the backlog review, nothing for parity", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		move(`${STORIES}/todo/S7.md`, `${STORIES}/blocked/S7.md`);
		write(`${STORIES}/blocked/S7.md`, note("blocked").replace("priority: 3", "priority: 9"));
		commit("S7 blocked and moved down");
		const run = debt(script);
		if (script === "review-debt.sh")
		{
			expect(run.status, run.stdout).toBe(1);
			expect(run.stdout).toContain("S7 re-prioritized outside a review");
		}
		else
		{
			expect(run.status, run.stdout).toBe(0);
		}
		expect(run.stdout).not.toMatch(/S7 (inserted|removed|added)/);
	}, TIMEOUT);

	it("an ID whose note sits in another folder with different text: compared as one story, edited", () =>
	{
		reviewed({
			[`${STORIES}/done/S7.md`]: note("done"),
		});
		git("rm", "-q", `${STORIES}/done/S7.md`);
		write(`${STORIES}/todo/S7.md`, script === "review-debt.sh" ? note("todo", {
			ac: "1. Something else entirely.",
		}) : note("todo", {
			source: "Feature: Scoreboard",
		}));
		commit("S7 reopened as different work");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain(dueFor);
		expect(run.stdout).not.toMatch(/S7 (inserted|removed|added)/);
	}, TIMEOUT);

	it("a story really added: due", () =>
	{
		reviewed();
		write(`${STORIES}/todo/S7.md`, note("todo"));
		commit("S7 added");
		const run = debt(script);
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toMatch(/S7 (inserted outside a review|added)/);
	}, TIMEOUT);
});

describe("review-debt.sh and parity-debt.sh: the done and in-flight counts (S156 AC 13)", () =>
{
	/** A ledger with `n` stories completed since the reviews `reviewed()` logs. */
	function completed(n: number): void
	{
		const lines = Array.from({
			length: n,
		}, (_, i) => `## 2026-11-0${i + 2} — S${i + 1} completed\n`).join("");
		write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n\n${lines}`);
		commit(`${n} done`);
	}

	it("5 done and 2 in flight (--in-flight): reports both, and that a review is due at the next done", () =>
	{
		reviewed();
		completed(5);
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const run = debt(script, ["--in-flight", "S201,S202"]);
			expect(run.stdout, script).toMatch(/5 of 6 stories done since the last (backlog|doc parity) review; 2 in flight \(S201, S202\)\./);
			expect(run.stdout, script).toContain("A review is due at the next `done`; it starts beside the in-flight items");
		}
	}, TIMEOUT);

	it("reads the in-flight items from the run's .run/claims/<ID>.json files when no --in-flight is given", () =>
	{
		reviewed();
		write(".gitignore", "node_modules\n.run/\n");
		write(".run/claims/S41.json", "{}\n");
		write(".run/claims/S300.json", "{}\n");
		write(".run/claims/notes.txt", "not a claim\n");
		commit("ignore .run");
		const run = debt();
		expect(run.status, run.stdout).toBe(0);
		expect(run.stdout).toContain("0 of 6 stories done since the last backlog review; 2 in flight (S41, S300).");
		// An explicit empty --in-flight says none are, whatever the claim files hold.
		expect(debt("review-debt.sh", ["--in-flight", ""]).stdout).toContain("; 0 in flight.");
	}, TIMEOUT);

	it("6 done is due by count and still prints the counts", () =>
	{
		reviewed();
		completed(6);
		const run = debt("review-debt.sh", ["--in-flight", "S201"]);
		expect(run.status, run.stdout).toBe(1);
		expect(run.stdout).toContain("6 stories done since (S1, S2, S3, S4, S5, S6)");
		expect(run.stdout).toContain("6 of 6 stories done since the last backlog review; 1 in flight (S201).");
	}, TIMEOUT);

	it("--in-flight with no value exits 2 at once instead of looping", () =>
	{
		reviewed();
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const run = spawnSync("bash", [join(repo, "scripts", script), "--in-flight"], {
				cwd: repo,
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(run.signal, script).toBeNull();
			expect(run.status, script).toBe(2);
			expect(run.stderr, script).toContain("usage:");
		}
	}, TIMEOUT);
});

/** A debt script's `--json` report (S163 AC 3). */
interface Report
{
	due: boolean;
	base: string;
	done: string[];
	inFlight: string[];
	events: { kind: string;
		id?: string;
		path?: string;
		adrs?: string[];
		done?: string[] }[];
}

function report(script: string, args: string[] = []): Report
{
	const run = debt(script, ["--json", ...args]);
	expect(run.status, run.stdout).toBe(0);
	return JSON.parse(run.stdout) as Report;
}

/**
 * The debt scripts as they were at S163's base commit (9bebb01f), committed as fixtures (README there):
 * their text output must not change. Read from files, not `git show`, which fails in CI's depth-1 checkout.
 */
const S163_BASE = join(VAULT, "fixtures/s163-base");

describe("review-debt.sh and parity-debt.sh --json: the events behind a review's seed (S163 AC 3)", () =>
{
	it("review-debt.sh: inserted, removed, reprioritized and ac-rewritten name the story", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
			[`${STORIES}/todo/S8.md`]: note("todo").replace("id: S7", "id: S8"),
		});
		write(`${STORIES}/todo/S7.md`, note("todo", {
			ac: "1. It works twice.",
		}).replace("priority: 3", "priority: 4"));
		git("rm", "-q", `${STORIES}/todo/S8.md`);
		write(`${STORIES}/todo/S9.md`, note("todo").replace("id: S7", "id: S9"));
		commit("edits");
		const r = report("review-debt.sh", ["--in-flight", "S9"]);
		expect(r.due).toBe(true);
		expect(r.inFlight).toEqual(["S9"]);
		expect(r.events).toEqual(expect.arrayContaining([
			{
				kind: "reprioritized",
				id: "S7",
			},
			{
				kind: "ac-rewritten",
				id: "S7",
			},
			{
				kind: "removed",
				id: "S8",
			},
			{
				kind: "inserted",
				id: "S9",
			},
		]));
		expect(r.events).toHaveLength(4);
	}, TIMEOUT);

	it("a story closed not_planned since the base is a removed event (read from the issue cache), in both scripts", () =>
	{
		reviewed();
		const later = new Date(Date.now() + 60_000).toISOString();
		const closed = (number: number, title: string, reason: string, at: string) => ({
			number,
			title,
			state: "closed",
			state_reason: reason,
			labels: [{
				name: "story",
			}],
			user: {
				login: "o",
			},
			body: "",
			closed_at: at,
			// A later touch moves updated_at; the removed event reads closed_at.
			updated_at: new Date(Date.now() + 120_000).toISOString(),
		});
		cache([closed(7, "S7: dropped", "not_planned", later), closed(8, "S8: shipped", "completed", later), closed(9, "S9: dropped long ago", "not_planned", "2020-01-01T00:00:00Z")]);
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const r = report(script);
			expect(r.events.filter((e) => e.kind === "removed"), script).toEqual([{
				kind: "removed",
				id: "S7",
			}]);
		}
	}, TIMEOUT);

	it("a note the migration deleted is not a removal, even under a sed that reads \\t as a literal t (BSD sed)", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		git("rm", "-q", `${STORIES}/todo/S7.md`);
		write("docs/v3/audit/2026-11-21/20261121T000001Z-S7-migration.md", renderRecord({
			kind: "migration",
			id: "S7",
			date: "2026-11-21",
			stamp: "2026-11-21T00:00:01Z",
			head: "h",
			body: `**Gap:** a\n\n${renderFields({
				priority: 3,
			})}`,
			issue: 7,
			base: "abc1234",
		}));
		commit("the migration");
		// A sed on PATH that, like BSD sed, reads "\t" in a script as a plain "t".
		const bin = join(repo, ".bsd-sed");
		mkdirSync(bin);
		const realSed = spawnSync("bash", ["-c", "command -v sed"], {
			encoding: "utf8",
		}).stdout.trim();
		write(".bsd-sed/sed", `#!/usr/bin/env bash\nargs=()\nfor a in "$@"; do args+=("\${a//\\\\t/t}"); done\nexec ${realSed} "\${args[@]}"\n`);
		spawnSync("chmod", ["+x", join(bin, "sed")]);
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const run = debt(script, ["--json"], {
				PATH: `${bin}:${process.env.PATH}`,
			});
			expect(run.status, run.stdout).toBe(0);
			const events = (JSON.parse(run.stdout) as Report).events;
			expect(events.filter((e) => e.kind === "removed"), script).toEqual([]);
		}
	}, TIMEOUT);

	it("a body line starting priority: outside the fields block isn't a re-prioritization (records read their fields block)", () =>
	{
		const text = (gap: string) => `**Gap:** ${gap}\n\n**Source:** Feature: X\n\n${renderFields({
			priority: 3,
		})}`;
		const fragment = (kind: "migration" | "edit", stamp: string, body: string, from?: string) => renderRecord({
			kind,
			id: "S7",
			date: "2026-11-21",
			stamp,
			head: "h",
			body,
			issue: 7,
			...(kind === "migration" ? {
				base: "abc1234",
			} : {}),
			...(from ? {
				from,
			} : {}),
		});
		reviewed({
			"docs/v3/audit/2026-11-21/20261121T000001Z-S7-migration.md": fragment("migration", "2026-11-21T00:00:01Z", text("a")),
		});
		write("docs/v3/audit/2026-11-21/20261121T000002Z-S7-edit.md", fragment("edit", "2026-11-21T00:00:02Z", text("a\npriority: 9 is a word here"), sha256(text("a"))));
		commit("an edit that keeps the priority");
		expect(report("review-debt.sh").events.filter((e) => e.kind === "reprioritized")).toEqual([]);
	}, TIMEOUT);

	it("no cache: removed events not counted, and the scripts say so", () =>
	{
		reviewed();
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const run = debt(script, [], {
				BT_BACKLOG_CACHE: join(repo, "no-such-cache"),
			});
			expect(run.stdout, script).toContain("no cache: removed events not counted");
		}
	}, TIMEOUT);

	it("review-debt.sh: amendment, surface-ratified, adr-changed, package-added and verify-changed name their path", () =>
	{
		reviewed({
			"docs/v3/ARCHITECTURE.md": "# ADRs\n",
		});
		write(AMENDMENT, RATIFIED);
		write("docs/v3/visual/surface/RATIFIED.md", "Ratified.\n");
		write("docs/v3/ARCHITECTURE.md", "# ADRs\n\nADR-020 changed. ADR-012 too.\n");
		write("packages/new/package.json", "{}\n");
		write("package.json", "{\"type\":\"module\",\"scripts\":{\"verify\":\"y\"}}\n");
		commit("design and platform changes");
		const r = report("review-debt.sh");
		expect(r.due).toBe(true);
		expect(r.events).toEqual(expect.arrayContaining([
			{
				kind: "amendment",
				path: AMENDMENT,
			},
			{
				kind: "surface-ratified",
				path: "docs/v3/visual/surface/RATIFIED.md",
			},
			{
				kind: "adr-changed",
				path: "docs/v3/ARCHITECTURE.md",
				adrs: ["ADR-012", "ADR-020"],
			},
			{
				kind: "package-added",
				path: "packages/new",
			},
			{
				kind: "verify-changed",
				path: "package.json",
			},
		]));
	}, TIMEOUT);

	it("review-debt.sh: a change to verify:run alone, the gate behind the verify lock, is verify-changed", () =>
	{
		const pkg = (gate: string) => `{\n"type": "module",\n"scripts": {\n"verify": "scripts/with-verify-lock.sh pnpm verify:run",\n"verify:run": "${gate}"\n}\n}\n`;
		reviewed({
			"package.json": pkg("pnpm build && pnpm size"),
		});
		write("package.json", pkg("pnpm build"));
		commit("the gate drops a step");
		expect(report("review-debt.sh").events).toEqual(expect.arrayContaining([
			{
				kind: "verify-changed",
				path: "package.json",
			},
		]));
	}, TIMEOUT);

	it("review-debt.sh: a change to the gate's own script alone is verify-changed, naming that path", () =>
	{
		// Since ADR-030 the gate lives in scripts/verify.sh and verify-plan.ts, not in package.json's line.
		reviewed({
			"scripts/verify.sh": "turbo run lint test\n",
		});
		write("scripts/verify.sh", "turbo run lint\n");
		commit("the gate drops a task");
		expect(report("review-debt.sh").events).toEqual(expect.arrayContaining([
			{
				kind: "verify-changed",
				path: "scripts/verify.sh",
			},
		]));
	}, TIMEOUT);

	it("review-debt.sh: turbo.json is the gate changing only when its tasks, edges or global inputs change, never a task's inputs", () =>
	{
		const turboJson = (tasks: string, inputs: string) => `{\n// tasks\n"globalDependencies": ["pnpm-lock.yaml"],\n"tasks": {${tasks}"test": {"dependsOn": ["^typecheck"], "inputs": [${inputs}]}}}\n`;
		reviewed({
			"turbo.json": turboJson("", "\"$TURBO_DEFAULT$\""),
		});
		// A story adds a task input (ADR-030 rule 6): not drift.
		write("turbo.json", turboJson("", "\"$TURBO_DEFAULT$\", \"$TURBO_ROOT$/fixtures/**\""));
		commit("an input");
		expect(report("review-debt.sh").events.filter((e: { kind: string }) => e.kind === "verify-changed")).toEqual([]);
		// A new task changes what the gate runs: drift.
		write("turbo.json", turboJson("\"size\": {\"dependsOn\": [\"build\"]}, ", "\"$TURBO_DEFAULT$\", \"$TURBO_ROOT$/fixtures/**\""));
		commit("a task");
		expect(report("review-debt.sh").events).toEqual(expect.arrayContaining([
			{
				kind: "verify-changed",
				path: "turbo.json",
			},
		]));
	}, TIMEOUT);

	it("review-debt.sh and parity-debt.sh: count carries the done IDs", () =>
	{
		reviewed();
		write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n\n${
			[1, 2, 3, 4, 5, 6].map((n) => `## 2026-11-02 — S${n} completed\n`).join("\n")}`);
		commit("6 done");
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const r = report(script);
			expect(r.done, script).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
			expect(r.events, script).toEqual([
				{
					kind: "count",
					done: ["S1", "S2", "S3", "S4", "S5", "S6"],
				},
			]);
		}
	}, TIMEOUT);

	it("parity-debt.sh: inserted, removed, source-changed, purpose-changed and doc-changed", () =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
			[`${STORIES}/todo/S8.md`]: note("todo", {
				source: "Pillar: Fast — why. Approved by owner 2026-11-01: \"ok\"",
			}).replace("id: S7", "id: S8"),
			[`${STORIES}/todo/S5.md`]: note("todo").replace("id: S7", "id: S5"),
			"docs/v3/FEATURES.md": "# Features\n",
		});
		write(`${STORIES}/todo/S7.md`, note("todo", {
			source: "Feature: Scoreboard",
		}));
		write(`${STORIES}/todo/S8.md`, note("todo", {
			source: "Pillar: Fast — why. Approved by owner 2026-11-01: \"ok\"",
			ac: "1. Faster.",
		}).replace("id: S7", "id: S8"));
		git("rm", "-q", `${STORIES}/todo/S5.md`);
		write(`${STORIES}/todo/S9.md`, note("todo").replace("id: S7", "id: S9"));
		write("docs/v3/FEATURES.md", "# Features\n\n| **Scoreboard** | x |\n");
		commit("edits");
		const r = report("parity-debt.sh");
		expect(r.due).toBe(true);
		expect(r.events).toEqual(expect.arrayContaining([
			{
				kind: "doc-changed",
				path: "docs/v3/FEATURES.md",
			},
			{
				kind: "source-changed",
				id: "S7",
			},
			{
				kind: "purpose-changed",
				id: "S8",
			},
			{
				kind: "removed",
				id: "S5",
			},
			{
				kind: "inserted",
				id: "S9",
			},
		]));
		expect(r.events).toHaveLength(5);
	}, TIMEOUT);

	it.each(["review-debt.sh", "parity-debt.sh"])("%s: a note moved to another status folder with no other change gives no event", (script) =>
	{
		reviewed({
			[`${STORIES}/todo/S7.md`]: note("todo"),
		});
		move(`${STORIES}/todo/S7.md`, `${STORIES}/done/S7.md`);
		write(`${STORIES}/done/S7.md`, note("done"));
		commit("S7 done");
		const r = report(script);
		expect(r).toMatchObject({
			due: false,
			events: [],
		});
	}, TIMEOUT);

	/**
	 * The scenarios the text output is compared under: the old script (at S163's base) and the new one
	 * must print the same words and exit the same way for each, so `--json` changed nothing else.
	 */
	const SCENARIOS: Record<string, () => void> = {
		"nothing changed": () => undefined,
		"story drift": () =>
		{
			write(`${STORIES}/todo/S7.md`, note("todo", {
				ac: "1. It works twice.",
				source: "Feature: Scoreboard",
			}).replace("priority: 3", "priority: 5"));
			git("rm", "-q", `${STORIES}/todo/S8.md`);
			write(`${STORIES}/todo/S9.md`, note("todo").replace("id: S7", "id: S9"));
			write("docs/v3/FEATURES.md", "# Features\n");
		},
		"a ratified amendment": () => write(AMENDMENT, RATIFIED),
		"a draft amendment": () => write(AMENDMENT, DRAFT),
		"an ADR body edit": () => write("docs/v3/ARCHITECTURE.md", "# ADRs\n\n### ADR-021 — x\n\nNew body.\n"),
		"a frontend ADR named": () => write("docs/v3/ARCHITECTURE.md", "# ADRs\n\nADR-020 changed.\n"),
		"a new package and pnpm verify changed": () =>
		{
			write("packages/new/package.json", "{}\n");
			write("package.json", "{\"type\":\"module\",\"scripts\":{\"verify\":\"y\"}}\n");
		},
		"6 done": () => write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n\n${
			[1, 2, 3, 4, 5, 6].map((n) => `## 2026-11-02 — S${n} completed\n`).join("\n")}`),
		"a pure move": () =>
		{
			move(`${STORIES}/todo/S7.md`, `${STORIES}/done/S7.md`);
			write(`${STORIES}/done/S7.md`, note("done"));
		},
	};

	describe.each(["review-debt.sh", "parity-debt.sh"])("%s: the text output is identical to the script at S163's base commit", (script) =>
	{
		it.each(Object.keys(SCENARIOS))("identical text for: %s", (scenario) =>
		{
			reviewed({
				[`${STORIES}/todo/S7.md`]: note("todo"),
				[`${STORIES}/todo/S8.md`]: note("todo").replace("id: S7", "id: S8"),
				"docs/v3/ARCHITECTURE.md": "# ADRs\n\n### ADR-021 — x\n\nOld body.\n",
			});
			write(`scripts/old-${script}`, readFileSync(join(S163_BASE, `${script}.txt`), "utf8"));
			write(".gitignore", "node_modules\nscripts/old-*\n");
			commit("ignore the old copy");
			SCENARIOS[scenario]!();
			if (git("status", "--porcelain") !== "")
			{
				commit(scenario);
			}
			const before = debt(`old-${script}`, ["--in-flight", "S8"]);
			const after = debt(script, ["--in-flight", "S8"]);
			expect(after.stdout).toBe(before.stdout);
			expect(after.status).toBe(before.status);
		}, TIMEOUT);
	});

	it("review-debt.sh --json: a draft amendment and a Source-link-only edit give no event; an intake-only ratification gives only its amendment", () =>
	{
		reviewed({
			[AMENDMENT]: `${RATIFIED}\nSource: https://www.figma.com/design/f\n`,
		});
		write(AMENDMENT, `${RATIFIED}\nSource: https://www.figma.com/design/f?node-id=1-2\n`);
		write("docs/v3/visual/other/amendments/A1.md", DRAFT);
		commit("link only, and a draft");
		expect(report("review-debt.sh")).toMatchObject({
			due: false,
			events: [],
		});
		write("docs/v3/visual/other/amendments/A1.md", RATIFIED);
		commit("ratify the draft");
		expect(report("review-debt.sh")).toMatchObject({
			due: true,
			events: [{
				kind: "amendment",
				path: "docs/v3/visual/other/amendments/A1.md",
			}],
		});
	}, TIMEOUT);

	it.each(["review-debt.sh", "parity-debt.sh"])("%s --json: 2 done stories are listed, with no count event below the backstop", (script) =>
	{
		reviewed();
		write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n\n## 2026-11-02 — S1 completed\n\n## 2026-11-02 — S2 completed\n`);
		commit("2 done");
		expect(report(script)).toMatchObject({
			due: false,
			done: ["S1", "S2"],
			events: [],
		});
	}, TIMEOUT);

	it.each(["review-debt.sh", "parity-debt.sh"])("%s --json --since <sha>: events measured from that commit, past a skip; --since without --json exits 2", (script) =>
	{
		reviewed({
			"docs/v3/FEATURES.md": "# Features\n",
		});
		const reviewSha = git("rev-parse", "--short", "HEAD");
		write(`${STORIES}/todo/S7.md`, note("todo"));
		commit("S7 inserted");
		write("docs/v3/AUDIT.md", `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n\n## 2026-11-01 — doc parity review (\`continue\`)\n\n## 2026-11-03 — backlog review skipped\n`);
		commit("skip");
		const kind = script === "review-debt.sh";
		// The ledger base moved to the skip (backlog) or stayed (parity); --since measures from the review regardless.
		expect(report(script).events.some((e) => e.id === "S7")).toBe(!kind);
		const since = report(script, ["--since", reviewSha]);
		expect(since.base).toBe(reviewSha);
		expect(since.events).toEqual(expect.arrayContaining([{
			kind: "inserted",
			id: "S7",
		}]));
		const text = debt(script, ["--since", reviewSha]);
		expect(text.status, text.stdout).toBe(2);
		expect(text.stdout).toContain("usage:");
		expect(debt(script, ["--json", "--since"]).status).toBe(2);
		expect(debt(script, ["--json", "--since", "--in-flight"]).status).toBe(2);
	}, TIMEOUT);

	it("review-debt.sh --json: a body edit under an ADR's section names that ADR; an edit in a later non-ADR section names none", () =>
	{
		reviewed({
			"docs/v3/ARCHITECTURE.md": "# ADRs\n\n### ADR-021 — Hub\n\nOld body.\n\n#### Detail\n\nOld detail.\n\n## Appendix\n\nOld appendix.\n",
		});
		write("docs/v3/ARCHITECTURE.md", "# ADRs\n\n### ADR-021 — Hub\n\nOld body.\n\n#### Detail\n\nNew detail.\n\n## Appendix\n\nOld appendix.\n");
		commit("ADR-021 body");
		const sectionSha = git("rev-parse", "--short", "HEAD");
		expect(report("review-debt.sh").events).toEqual([{
			kind: "adr-changed",
			path: "docs/v3/ARCHITECTURE.md",
			adrs: ["ADR-021"],
		}]);
		write("docs/v3/ARCHITECTURE.md", "# ADRs\n\n### ADR-021 — Hub\n\nOld body.\n\n#### Detail\n\nNew detail.\n\n## Appendix\n\nNew appendix.\n");
		commit("appendix");
		expect(report("review-debt.sh", ["--since", sectionSha]).events).toEqual([{
			kind: "adr-changed",
			path: "docs/v3/ARCHITECTURE.md",
			adrs: [],
		}]);
	}, TIMEOUT);
});

describe("every pnpm command the rules name exists", () =>
{
	/** pnpm's own commands, which need no root script. */
	const BUILT_INS = new Set(["install", "exec", "run", "dlx", "add", "remove", "update", "why", "list", "store"]);

	it("names only root package.json scripts or pnpm built-ins (CLAUDE.md, the skills, the agents, non-grader scripts/*.sh)", () =>
	{
		const scripts = Object.keys((JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts);
		expect(scripts).toContain("review:debt");
		const dirFiles = (dir: string, keep: (name: string) => boolean, path: (name: string) => string) =>
			readdirSync(join(ROOT, dir)).filter(keep).map((n) => join(dir, path(n)));
		const files = [
			"CLAUDE.md",
			...dirFiles(".claude/skills", () => true, (n) => `${n}/SKILL.md`),
			...dirFiles(".claude/agents", (n) => n.endsWith(".md"), (n) => n),
			// Graders are frozen at their own commits, so they may name a command since renamed.
			...dirFiles("scripts", (n) => n.endsWith(".sh") && !n.startsWith("verify-"), (n) => n),
		].filter((f) => existsSync(join(ROOT, f)));
		const missing: string[] = [];
		for (const file of files)
		{
			const text = readFileSync(join(ROOT, file), "utf8");
			// A backticked `pnpm <name>`, or `pnpm <name>` starting a line (a shell comment's included).
			for (const m of [...text.matchAll(/`pnpm ([a-z][\w:.-]*)/g), ...text.matchAll(/^[\s#]*pnpm ([a-z][\w:.-]*)/gm)])
			{
				const name = m[1] ?? "";
				if (!scripts.includes(name) && !BUILT_INS.has(name))
				{
					missing.push(`${file}: pnpm ${name}`);
				}
			}
		}
		expect([...new Set(missing)]).toEqual([]);
	});
});

describe("review-debt.sh: a turn cap hit makes a backlog review due until a review lists it (S158 AC 7)", () =>
{
	const A = "2026-11-21T10:00:00.000Z";
	const B = "2026-11-21T11:00:00.000Z";
	const hits = (...h: [string, string][]) => h.map(([id, at]) => `${id} @ ${at}`).join(", ") || "none";
	const runEntry = (run: string, row: string) => write(`docs/v3/audit/2026-11-21/20261121T120000Z-${run}-run.md`,
		`## 2026-11-21 — run ${run}\n\n| | |\n|---|---|\n| C | 2 |\n| Turn-cap hits | ${row} |\n| Counted | no |\n| Clean | no |\n`);
	const reviewEntry = (stamp: string, row: string) => write(`docs/v3/audit/2026-11-21/${stamp}-backlog-review.md`,
		`## 2026-11-21 — backlog review (\`continue\`)\n\n| | |\n|---|---|\n| Turn-cap hits read | ${row} |\n`);
	const journal = (path: string, events: { kind: string;
		id?: string;
		at: string }[]) => write(path, JSON.stringify({
		id: "R20261121T090000Z",
		n: 4,
		c: 2,
		startedAt: "2026-11-21T09:00:00.000Z",
		events,
	}));
	const turnCap = (id: string, at: string) => ({
		kind: "turn-cap",
		id,
		at,
	});
	const capEvents = () => (JSON.parse(debt("review-debt.sh", ["--json"]).stdout) as { events: { kind: string;
		id?: string;
		hits?: string[] }[] }).events.filter((e) => e.kind === "turn-cap");

	it("turn cap: an unlisted run-entry hit is due, naming the ID", () =>
	{
		reviewed();
		runEntry("R20261121T090000Z", hits(["S9", A]));
		commit("a run");
		const r = debt();
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("turn cap hit: S9");
	});

	it("turn cap: a hit a review lists is not due", () =>
	{
		reviewed();
		runEntry("R20261121T090000Z", hits(["S9", A]));
		reviewEntry("20261121T130000Z", hits(["S9", A]));
		commit("a run and the review that read it");
		expect(debt().status).toBe(0);
	});

	it("turn cap: a skip and an answers entry do not clear a hit", () =>
	{
		reviewed();
		runEntry("R20261121T090000Z", hits(["S9", A]));
		commit("a run");
		write("docs/v3/audit/2026-11-21/20261121T130000Z-backlog-skip.md", "## 2026-11-21 — backlog review skipped\n\n| Turn-cap hits read | S9 @ 2026-11-21T10:00:00.000Z |\n");
		write("docs/v3/audit/2026-11-21/20261121T130001Z-backlog-answers.md", "## 2026-11-21 — backlog review answers (2026-11-01)\n\n| Turn-cap hits read | S9 @ 2026-11-21T10:00:00.000Z |\n");
		commit("a skip and an answers entry");
		const r = debt();
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("turn cap hit: S9");
	});

	it("turn cap: a hit stamped after the review's commit but listed is not due", () =>
	{
		reviewed();
		reviewEntry("20261121T080000Z", hits(["S9", B]));
		commit("a review that read a live journal's hit");
		journal(".run/run.json", [turnCap("S9", B)]);
		expect(debt().status).toBe(0);
	});

	it("turn cap: a run entry committed after the review that listed its hit is not due", () =>
	{
		reviewed();
		reviewEntry("20261121T080000Z", hits(["S9", A]));
		commit("the review");
		runEntry("R20261121T090000Z", hits(["S9", A]));
		commit("the run's entry, merged later");
		expect(debt().status).toBe(0);
	});

	it("turn cap: a hit in the main checkout's run.json is read from a linked worktree (inside that run, the tracker weighs it)", () =>
	{
		reviewed();
		const wt = `${repo}-wt`;
		git("worktree", "add", "-q", "-b", "story/S9", wt);
		try
		{
			symlinkSync(join(ROOT, "node_modules"), join(wt, "node_modules"));
			journal(".run/run.json", [turnCap("S9", A)]);
			const env: Record<string, string | undefined> = {
				...process.env,
				BT_BACKLOG_CACHE: cache(),
			};
			delete env.BT_AUDIT_LEDGER;
			const r = spawnSync("bash", [join(wt, "scripts/review-debt.sh")], {
				cwd: wt,
				encoding: "utf8",
				env,
			});
			// The open run is found through git's common dir too, so the review tracker decides (owner, 2026-11-24).
			expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
			expect(r.stdout).toContain("inside run R20261121T090000Z");
			expect(r.stdout).toContain("turn cap hit: S9");
		}
		finally
		{
			rmSync(wt, {
				recursive: true,
				force: true,
			});
		}
	});

	it("turn cap: a live run.json hit is listed for the review tracker, not due by itself inside that run (owner, 2026-11-24)", () =>
	{
		reviewed();
		journal(".run/run.json", [turnCap("S9", A)]);
		const r = debt();
		expect(r.status, r.stdout).toBe(0);
		expect(r.stdout).toContain("what the review tracker weighs");
		expect(r.stdout).toContain("turn cap hit: S9");
	});

	it("turn cap: an ended journal's hit is due while its entry has not merged", () =>
	{
		reviewed();
		journal(".run/ended/R20261121T090000Z.json", [turnCap("S12", A)]);
		const r = debt();
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("turn cap hit: S12");
	});

	it("turn cap: the same hit from three places is one", () =>
	{
		reviewed();
		runEntry("R20261121T090000Z", hits(["S9", A]));
		commit("a run");
		journal(".run/run.json", [turnCap("S9", A)]);
		journal(".run/ended/R20261121T090000Z.json", [turnCap("S9", A)]);
		expect(capEvents()).toEqual([{
			kind: "turn-cap",
			id: "S9",
			hits: [A],
		}]);
	});

	it("turn cap: two hits on one ID are one event with both times", () =>
	{
		reviewed();
		journal(".run/run.json", [turnCap("S9", A), turnCap("S9", B)]);
		expect(capEvents()).toEqual([{
			kind: "turn-cap",
			id: "S9",
			hits: [A, B],
		}]);
		expect(debt().stdout.match(/turn cap hit: S9/g)).toHaveLength(1);
	});

	it("turn cap: a run with no turn-cap event is not due on its account", () =>
	{
		reviewed();
		runEntry("R20261121T090000Z", "none");
		commit("a run");
		journal(".run/run.json", [{
			kind: "item-start",
			id: "S9",
			at: A,
		}]);
		expect(debt().status).toBe(0);
	});

	it("turn cap: --json prints the event, due (outside a run: an ended journal's hit)", () =>
	{
		reviewed();
		// An ended journal, not a live one: inside an open run the review tracker decides instead (owner, 2026-11-24).
		journal(".run/ended/R20261121T090000Z.json", [turnCap("S9", A)]);
		const report = JSON.parse(debt("review-debt.sh", ["--json"]).stdout) as { due: boolean;
			events: unknown[] };
		expect(report.due).toBe(true);
		expect(report.events).toContainEqual({
			kind: "turn-cap",
			id: "S9",
			hits: [A],
		});
	});
});

describe("review-debt.sh and parity-debt.sh inside an open /run-backlog run: the review tracker and its ceiling decide (owner, 2026-11-24)", () =>
{
	const journal = (events: Record<string, unknown>[]) => write(".run/run.json", JSON.stringify({
		id: "R20261124T090000Z",
		n: 10,
		c: 2,
		startedAt: "2026-11-24T09:00:00.000Z",
		events,
	}));
	const at = (m: number) => new Date(Date.parse("2026-11-24T09:00:00.000Z") + m * 60_000).toISOString();
	const score = (m: number, review: string, value: number, threshold: number) => ({
		kind: "review-score",
		review,
		score: value,
		threshold,
		due: value >= threshold,
		reason: `focus ${review} ${value}`,
		at: at(m),
	});
	const jsonDue = (script: string) => (JSON.parse(debt(script, ["--json"]).stdout) as { due: boolean }).due;

	it("with nothing scored and nothing changed, neither review is due, and both say they are inside the run", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		journal([]);
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const r = debt(script);
			expect(r.status, r.stdout).toBe(0);
			expect(r.stdout).toContain("inside run R20261124T090000Z");
			expect(r.stdout).toContain("has scored nothing");
		}
	});

	it("a drift event that would make the backlog review due outside a run is only weighed inside one", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		write("packages/new/package.json", "{}\n");
		commit("a new workspace package");
		expect(debt().status).toBe(1);
		journal([]);
		const r = debt();
		expect(r.status, r.stdout).toBe(0);
		expect(r.stdout).toContain("what the review tracker weighs");
		expect(r.stdout).toContain("new workspace package: packages/new");
		expect(jsonDue("review-debt.sh")).toBe(false);
	});

	it("the tracker's newest score over its threshold makes that review due, and only that one; a later review-start clears it", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		journal([score(1, "parity", 8, 6)]);
		const parity = debt("parity-debt.sh");
		expect(parity.status, parity.stdout).toBe(1);
		expect(parity.stdout).toContain("newest score is 8/10 against its threshold 6");
		expect(parity.stdout).toContain("focus parity 8");
		expect(jsonDue("parity-debt.sh")).toBe(true);
		expect(debt().status).toBe(0);
		expect(jsonDue("review-debt.sh")).toBe(false);
		journal([score(1, "parity", 8, 6), {
			kind: "review-start",
			review: "parity",
			at: at(2),
		}]);
		expect(debt("parity-debt.sh").status).toBe(0);
	});

	it("the ceiling: a rule change since the review last logged forces both, whatever the score", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
			".claude/agents/x.md": "one\n",
		});
		write(".claude/agents/x.md", "two\n");
		commit("an agent definition changed");
		journal([score(1, "backlog", 0, 9), score(1, "parity", 0, 9)]);
		for (const script of ["review-debt.sh", "parity-debt.sh"])
		{
			const r = debt(script);
			expect(r.status, r.stdout).toBe(1);
			expect(r.stdout).toContain("ceiling reached: .claude/agents/x.md changed");
		}
	});

	it("the ceiling: frame note 00's review log (its Last review / Earlier review entries) changing alone forces neither review; a rule edit there forces both", () =>
	{
		// Every backlog review rewrites these entries, so counting them made each backlog review force another doc
		// parity review (owner, 2026-11-26: "Skip this one, fix it in S221's rules PR (Recommended)").
		const frame = "docs/v3/backlog/frame/00 Baseball Theater v3 — Checkable backlog.md";
		const note = (rule: string, log: string) =>
			`# Backlog\n\n1. ${rule}\n\n### Backlog reviews\n\n**Last review:** ${log}\n\n- **Amended:** S1.\n\n**Earlier review:** 2026-11-01.\n\n**Next review due:** by count.\n\n- a chore\n`;
		reviewed({
			".gitignore": "node_modules\n.run/\n",
			[frame]: note("Rule one.", "2026-11-02."),
		});
		write(frame, note("Rule one.", "2026-11-03, focused.\n\n- **Amended:** S2.\n\n**Earlier review:** 2026-11-02."));
		commit("a backlog review's log entry");
		journal([score(1, "backlog", 0, 9), score(1, "parity", 0, 9)]);
		for (const script of ["parity-debt.sh", "review-debt.sh"])
		{
			const r = debt(script);
			expect(r.status, r.stdout).toBe(0);
			expect(r.stdout).not.toContain("ceiling reached");
		}
		write(frame, note("Rule one, amended.", "2026-11-03, focused.\n\n- **Amended:** S2.\n\n**Earlier review:** 2026-11-02."));
		commit("a backlog rule changed");
		for (const script of ["parity-debt.sh", "review-debt.sh"])
		{
			const r = debt(script);
			expect(r.status, r.stdout).toBe(1);
			expect(r.stdout).toContain(`ceiling reached: ${frame} changed`);
		}
	});

	it("the ceiling: pnpm verify itself changing forces it", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		write("package.json", "{\"type\":\"module\",\"scripts\":{\"verify\":\"y\"}}\n");
		commit("the gate moved");
		journal([]);
		const r = debt("parity-debt.sh");
		expect(r.status, r.stdout).toBe(1);
		expect(r.stdout).toContain("ceiling reached: package.json (pnpm verify itself) changed");
	});

	it("the ceiling: ten stories merged since the run started force it; bugs don't count", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		const merged = (prefix: string, n: number) => Array.from({
			length: n,
		}, (_, k) => ({
			kind: "merged",
			id: `${prefix}${k + 1}`,
			at: at(k + 1),
		}));
		journal([...merged("S", 9), ...merged("B", 4)]);
		expect(debt().status).toBe(0);
		journal(merged("S", 10));
		const r = debt();
		expect(r.status, r.stdout).toBe(1);
		expect(r.stdout).toContain("10 stories merged since the backlog review last ran in this run");
	});

	it("the baseline: rule changes count from the review's start base; a rules pull request merged between its start and its log still forces it, its own rule edits don't", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
			"CLAUDE.md": "one\n",
			"docs/v3/LOOP.md": "one\n",
		});
		const start = git("rev-parse", "HEAD");
		journal([{
			kind: "review-start",
			review: "backlog",
			base: start,
			at: at(1),
		}]);
		expect(debt().status).toBe(0);
		// A rules pull request merges while the review runs.
		write("CLAUDE.md", "two\n");
		commit("a rules pull request");
		let r = debt();
		expect(r.status, r.stdout).toBe(1);
		expect(r.stdout).toContain("ceiling reached: CLAUDE.md changed");
		// The review's own pull request, branched from its start: an edit to LOOP.md and its verdict entry, stamped
		// after its start, merged after the rules pull request.
		git("checkout", "-q", "-b", "review", start);
		write("docs/v3/LOOP.md", "two\n");
		write("docs/v3/audit/2026-11-24/20261124T100000Z-backlog-review.md", "## 2026-11-24 — backlog review (`continue`)\n\n| | |\n|---|---|\n");
		commit("the review's own pull request");
		git("checkout", "-q", "main");
		git("merge", "-q", "--no-ff", "-m", "merge the review", "review");
		r = debt();
		expect(r.status, r.stdout).toBe(1);
		expect(r.stdout).toContain("ceiling reached: CLAUDE.md changed");
		expect(r.stdout).not.toContain("LOOP.md");
	});

	it("the baseline: before the review's first start, its own entry; a start base this checkout doesn't contain is no change", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
			"CLAUDE.md": "one\n",
		});
		write("CLAUDE.md", "two\n");
		commit("a rules change after the last review");
		journal([]);
		expect(debt().status).toBe(1);
		journal([{
			kind: "review-start",
			review: "backlog",
			base: "0123456789abcdef0123456789abcdef01234567",
			at: at(1),
		}]);
		const r = debt();
		expect(r.status, r.stdout).toBe(0);
		expect(r.stdout).not.toContain("ceiling reached");
	});

	it("a journal that doesn't parse stops the script (exit 2), never a silent not-due", () =>
	{
		reviewed({
			".gitignore": "node_modules\n.run/\n",
		});
		write(".run/run.json", "{ not json");
		expect(debt().status).toBe(2);
		expect(debt("parity-debt.sh").status).toBe(2);
	});
});
