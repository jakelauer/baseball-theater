/**
 * changelog.ts (S156 AC 6): a `done` story's changelog entry is its own `changelog.d/<ID>.md`,
 * and `pnpm changelog:build` assembles CHANGELOG.md from today's file, kept whole as history,
 * plus the fragments, newest first and grouped by effort.
 */
import { execFileSync } from "node:child_process";
import {
	mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import {
	BLOCK_END, BLOCK_START, buildChangelog, ChangelogFragmentError, changelogFragmentFor, changelogFragments, OTHER_CHANGES, parseChangelogFragment,
	renderChangelog,
} from "./changelog.ts";

const HISTORY = "# Changelog\n\nIntro.\n\n---\n\n## An old effort\n\n- **Before, old. Now, older.** Details: **S1**.\n\n## Another\n\n- **Old two.** Details: **S2**.\n";
const entry = (id: string, effort: string, extra = "") => `---\neffort: ${effort}\n${extra}---\n\n- **${id} before, nothing; now, something.** Details: **${id}**.\n`;

let root = "";
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", ...args], {
	cwd: root,
	encoding: "utf8",
});
/** Write `changelog.d/<id>.md` and commit it at `day` (2030-01-<day>). */
const add = (id: string, text: string, day: number) =>
{
	writeFileSync(join(root, "changelog.d", `${id}.md`), text);
	git("add", "-A");
	const date = `2030-01-0${day}T00:00:00Z`;
	execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-qm", id], {
		cwd: root,
		env: {
			...process.env,
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_DATE: date,
		},
	});
};

beforeEach(() =>
{
	root = mkdtempSync(join(tmpdir(), "changelog-"));
	mkdirSync(join(root, "changelog.d"));
	writeFileSync(join(root, "CHANGELOG.md"), HISTORY);
	writeFileSync(join(root, "changelog.d/README.md"), "Not a fragment.\n");
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", "history");
});

afterEach(() => rmSync(root, {
	recursive: true,
	force: true,
}));

describe("parseChangelogFragment", () =>
{
	it("reads an entry's effort, optional title and body, and a recorded skip", () =>
	{
		expect(parseChangelogFragment("S9", entry("S9", "\"Quoted effort\""))).toEqual({
			id: "S9",
			path: "changelog.d/S9.md",
			effort: "Quoted effort",
			body: "- **S9 before, nothing; now, something.** Details: **S9**.",
		});
		expect(parseChangelogFragment("S9", entry("S9", "none", "title: Its own header\n")).title).toBe("Its own header");
		expect(parseChangelogFragment("S9", "---\nskip: a grader-script fix nobody outside the team would notice\n---\n")).toMatchObject({
			skip: "a grader-script fix nobody outside the team would notice",
			body: "",
		});
	});

	it("refuses a fragment in any other shape", () =>
	{
		for (const text of [
			"- **No frontmatter.** Details: **S9**.\n",
			"---\ntitle: no effort\n---\n\n- **x** Details: S9.\n",
			"---\neffort: none\n---\n\nNot a bullet. Details: S9.\n",
			"---\neffort: none\n---\n\n- **No details line.**\n",
			"---\neffort: none\nauthor: me\n---\n\n- **x** Details: S9.\n",
			"---\nskip:\n---\n",
			"---\nskip: why\n---\n\n- **An entry too.** Details: S9.\n",
		])
		{
			expect(() => parseChangelogFragment("S9", text), text).toThrow(ChangelogFragmentError);
		}
	});
});

describe("changelogFragmentFor (what backlog:check asks of a done story)", () =>
{
	it("finds a story's fragment or recorded skip, and nothing for a story without one", () =>
	{
		writeFileSync(join(root, "changelog.d/S9.md"), entry("S9", "none"));
		writeFileSync(join(root, "changelog.d/B12.md"), "---\nskip: nothing to tell\n---\n");
		expect(changelogFragmentFor(root, "S9")?.effort).toBe("none");
		expect(changelogFragmentFor(root, "B12")?.skip).toBe("nothing to tell");
		expect(changelogFragmentFor(root, "S10")).toBeUndefined();
		expect(changelogFragments(root).map((f) => f.id)).toEqual(["B12", "S9"]);
	});
});

describe("pnpm changelog:build", () =>
{
	it("puts the fragments above the history, newest first, grouped by effort, and keeps every history line", () =>
	{
		add("S9101", entry("S9101", "Fixture effort"), 1);
		add("S9102", entry("S9102", "none"), 2);
		add("S9103", entry("S9103", "Fixture effort"), 3);
		add("S9104", entry("S9104", "none", "title: A standalone change\n"), 4);
		add("S9105", "---\nskip: nothing to tell\n---\n", 5);
		buildChangelog(root);
		const out = readFileSync(join(root, "CHANGELOG.md"), "utf8");
		const lines = out.split("\n");
		const at = (s: string) => lines.findIndex((l) => l.includes(s));
		expect(lines.filter((l) => l === "## Fixture effort")).toHaveLength(1);
		const order = ["## A standalone change", "S9104 before", "## Fixture effort", "S9103 before", "S9101 before", `## ${OTHER_CHANGES}`, "S9102 before", "## An old effort"].map(at);
		expect(order.every((x) => x >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(out).not.toContain("S9105");
		// The history survives whole, in order, outside the block.
		expect(out.replace(/<!-- changelog\.d: generated[\s\S]*?end of generated block -->\n\n/, "")).toBe(HISTORY);
		// Idempotent: a second build changes nothing.
		buildChangelog(root);
		expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toBe(out);
	});

	it("orders an uncommitted fragment by its file time", () =>
	{
		add("S1", entry("S1", "none"), 1);
		writeFileSync(join(root, "changelog.d/S2.md"), entry("S2", "none"));
		utimesSync(join(root, "changelog.d/S2.md"), new Date("2029-01-01"), new Date("2029-01-01"));
		buildChangelog(root);
		const out = readFileSync(join(root, "CHANGELOG.md"), "utf8");
		expect(out.indexOf("S1 before")).toBeLessThan(out.indexOf("S2 before"));
	});

	it("leaves the history alone when there are no entries, and removes a stale block", () =>
	{
		const stale = HISTORY.replace("## An old effort", `${BLOCK_START}\n\n## Gone\n\n- **Gone.** Details: S0.\n\n${BLOCK_END}\n\n## An old effort`);
		expect(renderChangelog(stale, [], new Map())).toBe(HISTORY);
		expect(renderChangelog(HISTORY, [], new Map())).toBe(HISTORY);
	});
});
