/**
 * scripts/review-gate.sh's words (S156 AC 13): a due review starts beside a parallel run's in-flight
 * items, never pausing them, and a blocked one points at the ledger's fragments, not at the frozen
 * AUDIT.md. Its Stop loop guard (B481) lets a forced turn stop once per HEAD + due set in Claude Code
 * and in Cursor, which runs the same hook but sends `loop_count` instead of `stop_hook_active`, and since
 * 2026-11-24 it blocks at most once per HEAD + due set even across unforced turns; a due review whose entry
 * already sits on an open pull request counts as handled (owner, 2026-11-24: "Do all 6 token savers").
 * Runs the real gate in a clean throwaway repository whose debt scripts, ledger CLI and `gh` are stubs.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "../review-gate.sh");

let repo = "";
let bin = "";

function write(path: string, text: string, exec = false): void
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), text);
	if (exec) chmodSync(join(repo, path), 0o755);
}

/**
 * A clean repository holding the gate, debt scripts that say `review` and `parity` debts, and a ledger CLI answering `blocked`.
 * `events` are the due backlog review's `--json` event kinds (a drift event by default; `count` is a due-by-count review).
 */
function world(reviewDue: boolean, blocked: string, events: string[] = ["inserted"]): void
{
	copyFileSync(GATE, join(mkdirOf("scripts/review-gate.sh"), "review-gate.sh"));
	const json = JSON.stringify({
		due: true,
		events: events.map((kind) => ({
			kind,
		})),
	});
	write("scripts/review-debt.sh", reviewDue
		? `#!/bin/sh\nif [ "$1" = "--json" ]; then echo '${json}'; exit 0; fi\necho 'A backlog review is due: 6 stories done.'\nexit 1\n`
		: "#!/bin/sh\nexit 0\n", true);
	write("scripts/parity-debt.sh", "#!/bin/sh\nexit 0\n", true);
	write("scripts/backlog-vault/cli.ts", `const kind = process.argv.at(-1); console.log(kind === ${JSON.stringify(blocked)} ? "blocked" : "clear");\n`);
	write("docs/v3/AUDIT.md", "# Ledger\n");
	for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "base"]])
	{
		spawnSync("git", args, {
			cwd: repo,
		});
	}
}

function mkdirOf(path: string): string
{
	const dir = dirname(join(repo, path));
	mkdirSync(dir, {
		recursive: true,
	});
	return dir;
}

/**
 * A fake `gh` on PATH: the open pull requests list answers `1`, and pull request 1's added files are `files`;
 * `fail` makes every call fail, as `gh` does offline or signed out.
 */
function fakeGh(files: string[], fail = false): void
{
	writeFileSync(join(bin, "gh"), fail
		? "#!/bin/sh\nexit 1\n"
		: `#!/bin/sh\ncase "$*" in\n  */files*) printf '%s\\n' ${files.map((f) => `'${f}'`).join(" ")} ;;\n  *) echo 1 ;;\nesac\n`);
	chmodSync(join(bin, "gh"), 0o755);
}

/** The fake `gh` lives outside the repository, which must stay clean for the gate to speak. */
const env = () => ({
	...process.env,
	PATH: `${bin}:${process.env.PATH ?? ""}`,
});

const prompt = () => spawnSync("bash", [join(repo, "scripts/review-gate.sh"), "prompt"], {
	cwd: repo,
	encoding: "utf8",
	input: "",
	env: env(),
}).stdout;

const stop = (input: object) => spawnSync("bash", [join(repo, "scripts/review-gate.sh"), "stop"], {
	cwd: repo,
	encoding: "utf8",
	input: JSON.stringify(input),
	env: env(),
}).stdout;

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "review-gate-"));
	bin = mkdtempSync(join(tmpdir(), "review-gate-bin-"));
	fakeGh([], true);
});

afterEach(() =>
{
	for (const dir of [repo, bin])
	{
		rmSync(dir, {
			recursive: true,
			force: true,
		});
	}
});

describe("review-gate.sh prompt", () =>
{
	it("starts a due review beside a parallel run's in-flight items instead of before any story continues", () =>
	{
		world(true, "none");
		const out = prompt();
		expect(out).toContain("BACKLOG REVIEW");
		expect(out).toContain("beside the in-flight items and never pauses them");
		expect(out).not.toContain("before starting or continuing any story");
	});

	it("points a blocked review's questions at its ledger fragment, not at the frozen AUDIT.md", () =>
	{
		world(false, "parity");
		const out = prompt();
		expect(out).toContain("Blocked, waiting for the owner's answers");
		expect(out).toContain("a fragment under docs/v3/audit/");
		expect(out).not.toContain("AUDIT.md");
	});
});

describe("review-gate.sh stop loop guard", () =>
{
	it("lets Claude Code stop after one forced turn that committed no review", () =>
	{
		world(true, "none");
		expect(stop({
			stop_hook_active: false,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			stop_hook_active: true,
		})).toBe("");
	});

	it("lets Cursor stop after one forced turn that committed no review (B481)", () =>
	{
		world(true, "none");
		expect(stop({
			status: "completed",
			loop_count: 0,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			status: "completed",
			loop_count: 1,
		})).toBe("");
	});

	it("still blocks a forced Cursor turn the gate has not yet blocked for this HEAD and due set", () =>
	{
		world(true, "none");
		expect(stop({
			status: "completed",
			loop_count: 3,
		})).toContain("\"decision\":\"block\"");
	});

	it("blocks at most once per HEAD and due set, not at every turn's end (owner, 2026-11-24: \"Do all 6 token savers\")", () =>
	{
		world(true, "none");
		expect(stop({
			stop_hook_active: false,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			stop_hook_active: false,
		})).toBe("");
	});
});

describe("review-gate.sh with the due review already on an open pull request", () =>
{
	it("treats a backlog review recorded on an open pull request as handled", () =>
	{
		world(true, "none", ["count"]);
		fakeGh(["docs/v3/audit/2026-11-24/20261124T040541Z-backlog-review.md"]);
		expect(prompt()).toBe("");
		expect(stop({
			stop_hook_active: false,
		})).toBe("");
	});

	it("treats a skip on an open pull request as handling a drift event", () =>
	{
		world(true, "none", ["inserted"]);
		fakeGh(["docs/v3/audit/2026-11-24/20261124T045520Z-backlog-skip.md"]);
		expect(prompt()).toBe("");
	});

	it("still asks for the review when only a skip is pending but the review is due by story count, which a skip never clears", () =>
	{
		world(true, "none", ["count"]);
		fakeGh(["docs/v3/audit/2026-11-24/20261124T045520Z-backlog-skip.md"]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("ignores another kind's entry: a pending parity review leaves a due backlog review due", () =>
	{
		world(true, "none");
		fakeGh(["docs/v3/audit/2026-11-24/20261124T004216Z-parity-review.md"]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("falls back to asking for the review when gh can't answer (offline)", () =>
	{
		world(true, "none");
		fakeGh([], true);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});
});
