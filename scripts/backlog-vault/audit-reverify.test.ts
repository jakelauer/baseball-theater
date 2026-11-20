/**
 * S84: a grader proves its own story. `audit.sh story <ID> --reverify` runs today's
 * grader in a worktree at the story's shipping commit, so a later, legitimate change
 * can't turn it red; `audit.sh design <ID>` records a design verdict without running
 * any grader, and the ledger readers don't count it as a completion. Runs the real
 * scripts in a throwaway git repository.
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { reviewDebtLine } from "./assemble.ts";
import { fragmentFiles, parseLedger } from "./ledger.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";
const STAMP = "2026-01-02T03:04:05Z";

let repo: string;

/** The text of the entries audit.sh wrote since S156: every fragment in docs/v3/audit/, in stamp order. */
function written(): string
{
	const dir = join(repo, "docs/v3/audit");
	return fragmentFiles(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
}

function git(...args: string[]): string
{
	const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", ...args], {
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

function audit(args: string[], input = ""): ReturnType<typeof spawnSync>
{
	return spawnSync("bash", [join(repo, "scripts/audit.sh"), ...args], {
		cwd: repo,
		input,
		encoding: "utf8",
		env: {
			...process.env,
			BT_REVERIFY_NO_INSTALL: "1",
		},
	});
}

/** A repo where S900 shipped, then a later commit made its grader fail at HEAD. Returns the shipping commit. */
function shippedThenBroken(): string
{
	git("init", "-q", "-b", "main");
	for (const f of ["audit.sh", "lib/checks.sh", "lib/reverify.sh", "backlog-vault/design-reference.ts"]) copyFileSync(join(SCRIPTS, f), join(mkdirOf(`scripts/${f}`), f.split("/").pop()!));
	write("scripts/verify-S900.sh", [
		"#!/usr/bin/env bash",
		"set -uo pipefail",
		"cd \"$(dirname \"$0\")/..\"",
		"source scripts/lib/checks.sh",
		"check 1 \"S900 never adds later.txt\"",
		"[ ! -f later.txt ] || bad 1 \"later.txt exists\"",
		"report \"verify-S900\"",
		"exit $?",
		"",
	].join("\n"));
	spawnSync("chmod", ["+x", join(repo, "scripts/verify-S900.sh")]);
	write("docs/v3/AUDIT.md", `# Ledger\n\n${MARKER}\n`);
	git("add", "-A");
	git("commit", "-q", "-m", "base");
	write("work.txt", "the story's work\n");
	write("docs/v3/AUDIT.md", `# Ledger\n\n${MARKER}\n\n---\n\n## 2026-01-02 — S900 completed\n\n| | |\n|---|---|\n| Entry | story completion |\n| Captured (UTC) | \`${STAMP}\` |\n| Shipped in | the commit that adds this entry |\n`);
	git("add", "-A");
	git("commit", "-q", "-m", "S900: the story");
	const ship = git("rev-parse", "--short", "HEAD");
	write("later.txt", "a later story's legitimate change\n");
	git("add", "-A");
	git("commit", "-q", "-m", "S901: a later story");
	return ship;
}

function mkdirOf(path: string): string
{
	const dir = dirname(join(repo, path));
	mkdirSync(dir, {
		recursive: true,
	});
	return dir;
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "audit-reverify-"));
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

describe("audit.sh story --reverify (S84)", () =>
{
	it("reverify: a grader that fails at HEAD re-verifies as passing at its shipping commit, and the worktree is removed", () =>
	{
		const ship = shippedThenBroken();
		expect(spawnSync("bash", [join(repo, "scripts/verify-S900.sh")]).status).not.toBe(0);

		const before = readFileSync(join(repo, "docs/v3/AUDIT.md"), "utf8");
		const run = audit(["story", "S900", "--reverify", "--no-verify"]);
		expect(run.status, String(run.stderr)).toBe(0);
		expect(readFileSync(join(repo, "docs/v3/AUDIT.md"), "utf8")).toBe(before);
		const ledger = written();
		// audit.sh heads entries with the local date (`date +%Y-%m-%d`), as the whole ledger is;
		// UTC would fail every evening west of Greenwich.
		const today = new Date().toLocaleDateString("en-CA");
		expect(ledger).toContain(`## ${today} — S900 re-verified at \`${ship}\``);
		expect(ledger).toContain("1/1 checks passed");
		expect(git("worktree", "list").split("\n")).toHaveLength(1);
	});

	it("reverify: refuses a story with no completion entry, and refuses a design verdict", () =>
	{
		shippedThenBroken();
		write("scripts/verify-S902.sh", "#!/usr/bin/env bash\nexit 0\n");
		spawnSync("chmod", ["+x", join(repo, "scripts/verify-S902.sh")]);
		expect(audit(["story", "S902", "--reverify", "--no-verify"]).status).toBe(2);
		expect(audit(["story", "S900", "--reverify", "--no-verify", "--design-match", "Matches"]).status).toBe(2);
	});
});

describe("audit.sh design mode (S84)", () =>
{
	it("design mode records the verdict and frame/capture pairs without running the grader, and is not a completion", () =>
	{
		shippedThenBroken();
		write("docs/v3/visual/surface/thing-mobile.png", "frame");
		write("docs/v3/design-checks/S900/thing-mobile.png", "capture");
		const run = audit(["design", "S900", "--design-match", "-"], "Matches\n");
		expect(run.status, String(run.stderr)).toBe(0);
		// The frozen ledger (holding S900's completion) then the new fragment, as ledger.ts reads them.
		const ledger = `${readFileSync(join(repo, "docs/v3/AUDIT.md"), "utf8")}\n${written()}`;
		expect(ledger).toMatch(/^## \S+ — S900 design match$/m);
		expect(ledger).toMatch(/^Owner: "Matches"$/m);
		expect(ledger).toContain("`docs/v3/visual/surface/thing-mobile.png`");
		// No grader ran: the grader would have failed at HEAD and printed its check line.
		expect(ledger).not.toContain("check 1 FAIL");
		// The ledger readers count completions only: the design entry adds none.
		expect(reviewDebtLine(parseLedger(ledger))).toContain(": S900.");
		expect(reviewDebtLine(parseLedger(ledger.replace(/^## \S+ — S900 completed$/m, "## x — note")))).toContain("0 of");
	});
});

/** A fresh repository with audit.sh, its libraries and in-flight.ts, and an empty frozen ledger. */
function plainRepo(): void
{
	git("init", "-q", "-b", "main");
	for (const f of ["audit.sh", "lib/checks.sh", "lib/reverify.sh", "backlog-vault/design-reference.ts", "backlog-vault/in-flight.ts"]) copyFileSync(join(SCRIPTS, f), join(mkdirOf(`scripts/${f}`), f.split("/").pop()!));
	write("docs/v3/AUDIT.md", `# Ledger\n\n${MARKER}\n`);
	git("add", "-A");
	git("commit", "-q", "-m", "base");
}

describe("audit.sh arguments and fragment writes (S156)", () =>
{
	const review = ["review", "--verdict", "continue", "--trigger", "manual", "--findings", "checked"];

	it("--in-flight takes the shared item IDs, a shared fix's F1 included, and nothing looser", () =>
	{
		plainRepo();
		const ok = audit([...review, "--in-flight", "S9,F1"]);
		expect(ok.status, String(ok.stderr)).toBe(0);
		expect(written()).toContain("| In flight | S9, F1 |");
		for (const bad of ["X1", "s9", "S9, B2"])
		{
			expect(audit([...review, "--in-flight", bad]).status, bad).toBe(2);
		}
		// Empty says none are in flight.
		expect(audit([...review, "--in-flight", ""]).status).toBe(0);
	});

	it("an option missing its value exits 2 at once instead of looping", () =>
	{
		plainRepo();
		for (const args of [[...review, "--in-flight"], ["review", "--verdict"], ["skip", "backlog", "--commit"], ["story", "S1", "--commit"]])
		{
			const run = spawnSync("bash", [join(repo, "scripts/audit.sh"), ...args], {
				cwd: repo,
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(run.signal, args.join(" ")).toBeNull();
			expect(run.status, args.join(" ")).toBe(2);
		}
	});

	it("an entry interrupted while it is written leaves no fragment ledger.ts reads, only a dot file", () =>
	{
		plainRepo();
		write("scripts/verify-S9001.sh", "#!/usr/bin/env bash\necho 'check 1 PASS: x'\nexit 0\n");
		spawnSync("chmod", ["+x", join(repo, "scripts/verify-S9001.sh")]);
		// `pnpm verify` passes at once; `tail`, which audit.sh runs inside the entry it is writing, kills it.
		const bin = mkdtempSync(join(tmpdir(), "audit-kill-bin-"));
		writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
		writeFileSync(join(bin, "tail"), "#!/bin/sh\nkill -9 $PPID\n");
		spawnSync("chmod", ["+x", join(bin, "pnpm"), join(bin, "tail")]);
		const run = spawnSync("bash", [join(repo, "scripts/audit.sh"), "story", "S9001"], {
			cwd: repo,
			encoding: "utf8",
			timeout: 30_000,
			env: {
				...process.env,
				PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
				TMPDIR: bin,
			},
		});
		rmSync(bin, {
			recursive: true,
			force: true,
		});
		expect(run.signal).toBe("SIGKILL");
		const dir = join(repo, "docs/v3/audit");
		expect(fragmentFiles(dir)).toEqual([]);
		const day = spawnSync("find", [dir, "-type", "f"], {
			encoding: "utf8",
		}).stdout.trim().split("\n");
		expect(day).toHaveLength(1);
		expect(day[0]).toMatch(/\/\.\d{8}T\d{6}Z-S9001-completed\.md\.\d+\.tmp$/);
	});
});
