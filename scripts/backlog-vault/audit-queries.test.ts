/**
 * S163 AC 8: a review records what it searched. Reviews start from a seed and read only what
 * `pnpm backlog:search` reaches (owner, 2026-11-20: "It makes more sense for agents to search issues
 * or something"), so `scripts/audit.sh review` and `parity` refuse findings with no `query:` line;
 * an answers or skip entry doesn't search and is unaffected. Runs the real script in a throwaway repo.
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
import { fragmentFiles, LEDGER_MARKER } from "./ledger.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

let repo: string;

function git(...args: string[]): void
{
	const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
}

function audit(args: string[]): { status: number | null;
	stderr: string }
{
	const run = spawnSync("bash", [join(repo, "scripts/audit.sh"), ...args], {
		cwd: repo,
		encoding: "utf8",
	});
	return {
		status: run.status,
		stderr: run.stderr,
	};
}

/** The fragments audit.sh wrote, joined. */
function written(): string
{
	const dir = join(repo, "docs/v3/audit");
	return fragmentFiles(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
}

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "audit-queries-"));
	git("init", "-q", "-b", "main");
	for (const f of ["audit.sh", "lib/checks.sh", "lib/reverify.sh", "backlog-vault/design-reference.ts", "backlog-vault/in-flight.ts", "backlog-vault/run-directly.ts"])
	{
		mkdirSync(dirname(join(repo, "scripts", f)), {
			recursive: true,
		});
		copyFileSync(join(SCRIPTS, f), join(repo, "scripts", f));
	}
	mkdirSync(join(repo, "docs/v3"), {
		recursive: true,
	});
	writeFileSync(join(repo, "docs/v3/AUDIT.md"), `# Ledger\n\n${LEDGER_MARKER}\n\n## 2026-11-01 — backlog review (\`continue\`)\n`);
	git("add", "-A");
	git("commit", "-q", "-m", "base");
});

afterEach(() =>
{
	rmSync(repo, {
		recursive: true,
		force: true,
	});
});

const WITH_QUERY = "Checked the seed.\nquery: seed backlog --since abc1234 → S9, S10";

describe("audit.sh review and parity need the review's query: lines (S163 AC 8)", () =>
{
	it.each(["review", "parity"])("%s with a query: line is written", (mode) =>
	{
		const run = audit([mode, "--verdict", "continue", "--trigger", "manual", "--findings", WITH_QUERY]);
		expect(run.status, run.stderr).toBe(0);
		expect(written()).toContain("query: seed backlog --since abc1234 → S9, S10");
	});

	it.each(["review", "parity"])("%s with no query: line is refused, exit 1, naming the rule, and writes nothing", (mode) =>
	{
		// "query:" inside a line doesn't count: the line must start with it.
		const run = audit([mode, "--verdict", "continue", "--trigger", "manual", "--findings", "Checked S9. The query: was skipped."]);
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("query:");
		expect(run.stderr).toContain("S163 AC 8");
		expect(written()).toBe("");
	});

	it("an answers entry needs no query: line", () =>
	{
		const run = audit(["answers", "backlog", "--review", "2026-11-01", "--answers", "Owner: \"Yes\". Applied it."]);
		expect(run.status, run.stderr).toBe(0);
		expect(written()).toContain("backlog review answers (2026-11-01)");
	});

	it("a skip entry needs no query: line", () =>
	{
		const run = audit(["skip", "backlog", "--answers", "Owner: \"No review needed.\""]);
		expect(run.status, run.stderr).toBe(0);
		expect(written()).toContain("backlog review skipped");
	});
});
