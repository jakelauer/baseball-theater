/**
 * `scripts/audit.sh story … --design-match` (S81, backlog rule 22): a UI story is
 * recorded as done only with the owner's verdict on its captures, and the entry
 * pairs each capture with its ratified frame by SHA-256. Runs the real script
 * against a throwaway ledger, backlog, story note, grader, frame and capture. Since S156 the
 * entry is a new ledger fragment beside the ledger (`audit/<date>/…`), never an append.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import { fragmentFiles } from "./ledger.ts";

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), "../audit.sh");
const MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";

let root: string;

/** A one-story world: ledger, backlog table row, note, passing grader, one frame and its capture. */
function world(design: boolean): Record<string, string>
{
	const dirs = {
		BT_AUDIT_LEDGER: join(root, "AUDIT.md"),
		BT_AUDIT_BACKLOG: join(root, "BACKLOG.md"),
		BT_AUDIT_STORIES: join(root, "stories"),
		BT_AUDIT_DESIGN_CHECKS: join(root, "checks"),
		BT_AUDIT_VISUAL: join(root, "visual"),
		BT_AUDIT_GRADERS: join(root, "graders"),
	};
	for (const d of ["stories", "checks/S900", "visual/surface/amendments", "graders"]) mkdirSync(join(root, d), {
		recursive: true,
	});
	writeFileSync(dirs.BT_AUDIT_LEDGER, `# Ledger\n\n${MARKER}\n`);
	writeFileSync(dirs.BT_AUDIT_BACKLOG, "| 1 | [S900](#s900) | Test story | `done` |\n");
	writeFileSync(join(dirs.BT_AUDIT_STORIES, "S900.md"), `---\nid: S900\n${design ? "design:\n  - \"[[S31]]\"" : "design: []"}\n---\n\nBody.\n`);
	const grader = join(dirs.BT_AUDIT_GRADERS, "verify-S900.sh");
	writeFileSync(grader, "#!/usr/bin/env bash\necho 'check 1 PASS: works'\necho '--- verify-S900: 1/1 checks passed ---'\n");
	chmodSync(grader, 0o755);
	writeFileSync(join(root, "visual/surface/amendments/thing-mobile.png"), "frame-bytes");
	writeFileSync(join(root, "checks/S900/thing-mobile.png"), "capture-bytes");
	return dirs;
}

function audit(env: Record<string, string>, args: string[], input = ""): ReturnType<typeof spawnSync>
{
	return spawnSync("bash", [AUDIT, "story", "S900", "--no-verify", ...args], {
		env: {
			...process.env,
			...env,
		},
		input,
		encoding: "utf8",
	});
}

/** The text of the entries audit.sh wrote: every fragment beside the ledger, in stamp order ("" when none). */
function written(): string
{
	const dir = join(root, "audit");
	return fragmentFiles(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

beforeEach(() =>
{
	root = mkdtempSync(join(tmpdir(), "audit-design-match-"));
});

afterEach(() =>
{
	rmSync(root, {
		recursive: true,
		force: true,
	});
});

describe("audit.sh story --design-match (rule 22)", () =>
{
	it("refuses to record a design story's completion without the owner's verdict", () =>
	{
		const env = world(true);
		const before = readFileSync(env.BT_AUDIT_LEDGER!, "utf8");
		const run = audit(env, []);
		expect(run.status).toBe(2);
		expect(String(run.stderr)).toMatch(/--design-match/);
		expect(readFileSync(env.BT_AUDIT_LEDGER!, "utf8")).toBe(before);
		expect(written()).toBe("");
	});

	it("finds the note in its status folder (stories/<status>/S<N>.md), not only flat", () =>
	{
		const env = world(true);
		mkdirSync(join(env.BT_AUDIT_STORIES!, "doing"));
		renameSync(join(env.BT_AUDIT_STORIES!, "S900.md"), join(env.BT_AUDIT_STORIES!, "doing/S900.md"));
		const run = audit(env, []);
		expect(run.status).toBe(2);
		expect(String(run.stderr)).toMatch(/--design-match/);
	});

	it("records each frame and capture with their SHA-256 and quotes the owner", () =>
	{
		const env = world(true);
		const before = readFileSync(env.BT_AUDIT_LEDGER!, "utf8");
		const run = audit(env, ["--design-match", "-"], "Matches, ship it\n");
		expect(run.status).toBe(0);
		expect(readFileSync(env.BT_AUDIT_LEDGER!, "utf8")).toBe(before);
		expect(fragmentFiles(join(root, "audit"))).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}\/\d{8}T\d{6}Z-S900-completed\.md$/)]);
		const ledger = written();
		expect(ledger).toContain("**Design match (rule 22)**");
		expect(ledger).toContain(`| \`${join(root, "visual/surface/amendments/thing-mobile.png")}\` | \`${sha("frame-bytes")}\` |`);
		expect(ledger).toContain(`\`${join(root, "checks/S900/thing-mobile.png")}\` | \`${sha("capture-bytes")}\` |`);
		expect(ledger).toMatch(/^Owner: "Matches, ship it"$/m);
	});

	it("names the written amendment that overrides a frame, not the frame it supersedes", () =>
	{
		const env = world(true);
		const amendment = "# A2\n\n**Overrides:** `thing-desktop` / `-mobile`: it moves.\n\n## Frames\n\nNone.\n";
		writeFileSync(join(root, "visual/surface/amendments/A2.md"), amendment);
		const run = audit(env, ["--design-match", "-"], "Matches A2\n");
		expect(run.status).toBe(0);
		const ledger = written();
		expect(ledger).toContain(`| \`${join(root, "visual/surface/amendments/A2.md")}\` | \`${sha(amendment)}\` |`);
		expect(ledger).not.toContain("amendments/thing-mobile.png");
	});

	it("refuses a verdict when the story has no captures", () =>
	{
		const env = world(true);
		rmSync(join(root, "checks/S900/thing-mobile.png"));
		expect(audit(env, ["--design-match", "Looks right"]).status).toBe(2);
	});

	it("records a story with no design list without a verdict", () =>
	{
		const env = world(false);
		expect(audit(env, []).status).toBe(0);
		expect(written()).toMatch(/^## \S+ — S900 completed$/m);
		expect(written()).not.toContain("Design match");
	});
});
