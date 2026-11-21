/**
 * scripts/review-gate.sh's words (S156 AC 13): a due review starts beside a parallel run's in-flight
 * items, never pausing them, and a blocked one points at the ledger's fragments, not at the frozen
 * AUDIT.md. Runs the real gate in a clean throwaway repository whose debt scripts and ledger CLI are stubs.
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

function write(path: string, text: string, exec = false): void
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), text);
	if (exec) chmodSync(join(repo, path), 0o755);
}

/** A clean repository holding the gate, debt scripts that say `review` and `parity` debts, and a ledger CLI answering `blocked`. */
function world(reviewDue: boolean, blocked: string): void
{
	copyFileSync(GATE, join(mkdirOf("scripts/review-gate.sh"), "review-gate.sh"));
	write("scripts/review-debt.sh", reviewDue ? "#!/bin/sh\necho 'A backlog review is due: 6 stories done.'\nexit 1\n" : "#!/bin/sh\nexit 0\n", true);
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

const prompt = () => spawnSync("bash", [join(repo, "scripts/review-gate.sh"), "prompt"], {
	cwd: repo,
	encoding: "utf8",
	input: "",
}).stdout;

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "review-gate-"));
});

afterEach(() => rmSync(repo, {
	recursive: true,
	force: true,
}));

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
