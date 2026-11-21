/**
 * Law L12 (docs/v3/LAWS.md; S156 AC 2; owner, 2026-11-20, asked whether S156 may add it: "Add both
 * (Recommended)"): no workflow runs a story grader. `scripts/claude-review/plan-review.py`'s
 * `is_reviewer_path` leaves graders (`scripts/verify-S<N>.sh`, `-B<N>`, `-V<N>`) out of the CI and
 * deploy machinery that is re-reviewed on every push, so a branch whose only machinery is its grader
 * gets an `unchanged` review after a merge from stage. That is honest only while nothing CI runs can
 * run a grader, or the helpers graders source (`scripts/lib/checks.sh`), since a pull request's grader
 * could then change what CI does. So any file under `.github/` that names one fails, on its whole text.
 *
 * Since the pre-PR review of S156 the test also looks where else CI's commands live, every tracked
 * `package.json`'s scripts and `turbo.json`, and for the ways a grader is run indirectly:
 * `audit.sh story` (which runs one), `reverify-all.sh` and `scripts/lib/reverify.sh` (which run them at
 * their shipping commits). Those added tokens are matched with full-line `#` comments left out, since
 * a workflow may mention `scripts/audit.sh story` in a comment (design-capture.yml does) without
 * running it.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** What a workflow would write to run a grader or source its helpers, matched anywhere. */
const GRADER_TOKENS = ["scripts/verify-", "verify-S", "verify-B", "verify-V", "scripts/lib/checks.sh"];
/** What runs a grader indirectly, matched outside full-line comments. */
const RUNNER_TOKENS = ["audit.sh story", "reverify-all.sh", "scripts/lib/reverify.sh"];

/** Each line of `text` that names a grader, `checks.sh` or a grader runner, as `<line>: <token>`. */
export function graderMentions(text: string): string[]
{
	const found: string[] = [];
	text.split("\n").forEach((line, i) =>
	{
		for (const token of GRADER_TOKENS) if (line.includes(token)) found.push(`${i + 1}: ${token}`);
		if (/^\s*#/.test(line)) return;
		for (const token of RUNNER_TOKENS) if (line.includes(token)) found.push(`${i + 1}: ${token}`);
	});
	return found;
}

/** Every file under `dir`, recursively (`.github/` holds workflows, actions and their scripts). */
function filesUnder(dir: string): string[]
{
	return readdirSync(dir, {
		withFileTypes: true,
	}).flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

/** Each script of a package.json's text that names a grader or a runner, as `<script>: <token>`. */
export function packageScriptMentions(json: string): string[]
{
	const scripts = (JSON.parse(json) as { scripts?: Record<string, string> }).scripts ?? {};
	return Object.entries(scripts).flatMap(([name, cmd]) => graderMentions(cmd).map((m) => `${name}: ${m.replace(/^1: /, "")}`));
}

describe("no workflow runs a story grader (law L12)", () =>
{
	it("no file under .github/ names a grader, scripts/lib/checks.sh or a grader runner", () =>
	{
		const problems = filesUnder(join(ROOT, ".github")).flatMap((file) =>
			graderMentions(readFileSync(file, "utf8")).map((m) => `${relative(ROOT, file)}:${m}`));
		expect(problems).toEqual([]);
	});

	it("no package.json script and nothing in turbo.json does either", () =>
	{
		const packages = execFileSync("git", ["ls-files", "-z", "--", "package.json", "**/package.json"], {
			cwd: ROOT,
			encoding: "utf8",
		}).split("\0").filter((p) => p !== "" && !p.includes("node_modules/"));
		expect(packages).toContain("package.json");
		const problems = packages.flatMap((p) => packageScriptMentions(readFileSync(join(ROOT, p), "utf8")).map((m) => `${p}: ${m}`));
		problems.push(...graderMentions(readFileSync(join(ROOT, "turbo.json"), "utf8")).map((m) => `turbo.json:${m}`));
		expect(problems).toEqual([]);
	});

	it("catches a step that runs a grader, sources its helpers or runs one through a runner", () =>
	{
		for (const run of ["bash scripts/verify-S1.sh", "run: ./verify-V3.sh", "./verify-B87.sh", "source scripts/lib/checks.sh",
			"bash scripts/audit.sh story S1 --no-verify", "bash scripts/reverify-all.sh", "source scripts/lib/reverify.sh"])
		{
			expect(graderMentions(`jobs:\n  x:\n    steps:\n      - run: ${run}\n`), run).not.toEqual([]);
		}
		expect(graderMentions("jobs:\n  x:\n    steps:\n      - run: pnpm verify\n")).toEqual([]);
		// A comment that mentions a runner is not a step that runs it; a grader named even in a comment still fails.
		expect(graderMentions("# The owner's design match happens in a session (`scripts/audit.sh story <ID> --design-match -`).\n")).toEqual([]);
		expect(graderMentions("    # runs scripts/verify-S1.sh\n")).not.toEqual([]);
	});

	it("catches a package.json script or a turbo.json task that runs one", () =>
	{
		expect(packageScriptMentions(JSON.stringify({
			scripts: {
				x: "bash scripts/audit.sh story S1",
				y: "pnpm verify",
			},
		}))).toEqual(["x: audit.sh story"]);
		expect(graderMentions(JSON.stringify({
			tasks: {
				reverify: {
					command: "scripts/reverify-all.sh",
				},
			},
		}, null, "\t"))).not.toEqual([]);
	});
});
