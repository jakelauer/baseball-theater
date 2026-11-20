/**
 * Law L12 (docs/v3/LAWS.md; S156 AC 2; owner, 2026-11-20, asked whether S156 may add it: "Add both
 * (Recommended)"): no workflow runs a story grader. `scripts/claude-review/plan-review.py`'s
 * `is_reviewer_path` leaves graders (`scripts/verify-S<N>.sh`, `-B<N>`, `-V<N>`) out of the CI and
 * deploy machinery that is re-reviewed on every push, so a branch whose only machinery is its grader
 * gets an `unchanged` review after a merge from stage. That is honest only while nothing under
 * `.github/` runs a grader, or the helpers graders source (`scripts/lib/checks.sh`), since a pull
 * request's grader could then change what CI does. So any file under `.github/` that names one fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** What a workflow would write to run a grader or source its helpers. */
const GRADER_TOKENS = ["scripts/verify-", "verify-S", "verify-B", "verify-V", "scripts/lib/checks.sh"];

/** Each line of `text` that names a grader or `checks.sh`, as `<line>: <token>`. */
export function graderMentions(text: string): string[]
{
	const found: string[] = [];
	text.split("\n").forEach((line, i) =>
	{
		for (const token of GRADER_TOKENS) if (line.includes(token)) found.push(`${i + 1}: ${token}`);
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

describe("no workflow runs a story grader (law L12)", () =>
{
	it("no file under .github/ names a grader or scripts/lib/checks.sh", () =>
	{
		const problems = filesUnder(join(ROOT, ".github")).flatMap((file) =>
			graderMentions(readFileSync(file, "utf8")).map((m) => `${relative(ROOT, file)}:${m}`));
		expect(problems).toEqual([]);
	});

	it("catches a step that runs a grader or sources its helpers", () =>
	{
		for (const run of ["bash scripts/verify-S1.sh", "run: ./verify-V3.sh", "./verify-B87.sh", "source scripts/lib/checks.sh"])
		{
			expect(graderMentions(`jobs:\n  x:\n    steps:\n      - run: ${run}\n`), run).not.toEqual([]);
		}
		expect(graderMentions("jobs:\n  x:\n    steps:\n      - run: pnpm verify\n")).toEqual([]);
	});
});
