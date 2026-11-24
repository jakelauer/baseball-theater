/**
 * design-reference.ts — the one rule for which ratified reference governs a design capture,
 * shared by `pnpm design:review` and `scripts/audit.sh --design-match`.
 */
import {
	mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";
import {
	captureReferences, designReferences, frameProblem, isDraftAmendment, overriddenNames,
} from "./design-reference.ts";

let root: string;

/** Writes `files` (path → text) under a throwaway visual dir. */
function visual(files: Record<string, string>): string
{
	for (const [path, text] of Object.entries(files))
	{
		mkdirSync(join(root, path, ".."), {
			recursive: true,
		});
		writeFileSync(join(root, path), text);
	}
	return root;
}

const written = (overrides: string) => `**Overrides:** ${overrides}: words.\n\n## Frames\n\nNone.\n`;

beforeEach(() =>
{
	root = mkdtempSync(join(tmpdir(), "design-reference-"));
});

afterEach(() =>
{
	rmSync(root, {
		recursive: true,
		force: true,
	});
});

describe("overriddenNames", () =>
{
	it("expands -medium shorthands against the name before them and keeps globs", () =>
	{
		expect(overriddenNames(written("`shell-notice-mobile` / `-medium` / `-desktop` and A1's `settings-*`")))
			.toEqual(["shell-notice-mobile", "shell-notice-medium", "shell-notice-desktop", "settings-*"]);
	});
});

describe("designReferences", () =>
{
	it("prefers an amendment frame over the original of the same name", () =>
	{
		const dir = visual({
			"s/a-mobile.png": "old",
			"s/amendments/a-mobile.png": "new",
		});
		expect(designReferences(dir, "a-mobile.png")).toEqual([{
			kind: "frame",
			path: join(dir, "s/amendments/a-mobile.png"),
		}]);
	});

	it("lets a written amendment that overrides the frame (by name, shorthand or glob) govern it", () =>
	{
		const dir = visual({
			"s/a-medium.png": "old",
			"s/amendments/a-medium.png": "redrawn",
			"s/amendments/A3.md": written("`a-mobile` / `-medium`"),
			"t/settings-x-mobile.png": "old",
			"t/amendments/A1.md": written("`settings-*`"),
		});
		expect(designReferences(dir, "a-medium.png")).toEqual([{
			kind: "amendment",
			path: join(dir, "s/amendments/A3.md"),
		}]);
		expect(designReferences(dir, "settings-x-mobile.png")[0]?.path).toBe(join(dir, "t/amendments/A1.md"));
	});

	it("lets a later amendment that draws the frame govern over an earlier written one", () =>
	{
		const dir = visual({
			"s/amendments/A1.md": written("`a-mobile`"),
			"s/amendments/A2.md": "## Frames\n\n- `a-mobile.png`\n",
			"s/amendments/a-mobile.png": "drawn",
		});
		expect(designReferences(dir, "a-mobile.png")).toEqual([{
			kind: "frame",
			path: join(dir, "s/amendments/a-mobile.png"),
		}]);
	});

	it("returns every original of an ambiguous name so the ledger can refuse it", () =>
	{
		const dir = visual({
			"s/live-mobile.png": "1",
			"t/live-mobile.png": "2",
		});
		expect(designReferences(dir, "live-mobile.png")).toHaveLength(2);
	});
});

describe("captureReferences (a story's frames.json map)", () =>
{
	const ratified = "## Frames\n\n- `page-mobile.png`\n\nRatified by: owner\n";

	/** A visual dir under root/visual and a checks dir under root/checks holding `map` (if any). */
	function story(map?: unknown): { visualDir: string;
		checksDir: string; }
	{
		visual({
			"visual/s/RATIFIED.md": "Ratified by: owner\n",
			"visual/s/a-mobile.png": "a",
			"visual/s/amendments/A1.md": ratified,
			"visual/s/amendments/page-mobile.png": "page",
			"visual/t/b-mobile.png": "b",
			"visual/u/a-mobile.png": "unratified surface",
		});
		mkdirSync(join(root, "checks"), {
			recursive: true,
		});
		if (map !== undefined) writeFileSync(join(root, "checks/frames.json"), JSON.stringify(map));
		return {
			visualDir: join(root, "visual"),
			checksDir: join(root, "checks"),
		};
	}

	it("keeps the same-name rule with no map, and refuses an ambiguous name", () =>
	{
		const { visualDir, checksDir } = story();
		expect(captureReferences(visualDir, checksDir, "page-mobile.png")).toEqual(designReferences(visualDir, "page-mobile.png"));
		expect(() => captureReferences(visualDir, checksDir, "a-mobile.png")).toThrow(/matches 2 ratified frames .*need exactly one/);
		expect(() => captureReferences(visualDir, checksDir, "none-mobile.png")).toThrow(/matches 0 ratified frames/);
	});

	it("returns every frame a map entry names, for a renamed or two-frame capture", () =>
	{
		const { visualDir, checksDir } = story({
			"about-mobile.png": "docs/v3/visual/s/amendments/page-mobile.png",
			"both-mobile.png": ["docs/v3/visual/s/amendments/page-mobile.png", "docs/v3/visual/s/a-mobile.png"],
		});
		expect(captureReferences(visualDir, checksDir, "about-mobile.png")).toEqual([{
			kind: "frame",
			path: join(visualDir, "s/amendments/page-mobile.png"),
		}]);
		expect(captureReferences(visualDir, checksDir, "both-mobile.png").map((r) => r.path))
			.toEqual([join(visualDir, "s/amendments/page-mobile.png"), join(visualDir, "s/a-mobile.png")]);
		expect(captureReferences(visualDir, checksDir, "page-mobile.png")[0]?.path).toBe(join(visualDir, "s/amendments/page-mobile.png"));
	});

	it.each([
		[["docs/v3/visual/../../etc/x.png"], /not under docs\/v3\/visual\//],
		[["visual/s/a-mobile.png"], /not under docs\/v3\/visual\//],
		[["docs/v3/visual/s/gone-mobile.png"], /does not exist/],
		[["docs/v3/visual/u/a-mobile.png"], /no RATIFIED\.md/],
		[[], /non-empty list/],
	])("refuses a bad map entry %j", (paths, message) =>
	{
		const { visualDir, checksDir } = story({
			"x-mobile.png": paths,
		});
		expect(() => captureReferences(visualDir, checksDir, "x-mobile.png")).toThrow(message);
	});

	it("refuses a frame only a draft amendment draws, or one nothing ratified, or one superseded", () =>
	{
		const { visualDir } = story();
		visual({
			"visual/s/amendments/A2.md": "**Draft**, not yet ratified.\n\n- `draft-mobile.png`\n",
			"visual/s/amendments/draft-mobile.png": "d",
			"visual/s/amendments/loose-mobile.png": "l",
			"visual/s/page-mobile.png": "old original",
		});
		expect(frameProblem(visualDir, "s/amendments/draft-mobile.png")).toMatch(/A2, still a draft/);
		expect(frameProblem(visualDir, "s/amendments/loose-mobile.png")).toMatch(/named by no amendment/);
		expect(frameProblem(visualDir, "s/page-mobile.png")).toMatch(/superseded/);
		expect(frameProblem(visualDir, "s/amendments/page-mobile.png")).toBeNull();
	});

	it("reads a draft the way review-debt.sh does", () =>
	{
		expect(isDraftAmendment("**Draft** amendment")).toBe(true);
		expect(isDraftAmendment("Not yet ratified.")).toBe(true);
		expect(isDraftAmendment("**Draft**\n\nRatified by: owner")).toBe(false);
		expect(isDraftAmendment("as ratified by A6")).toBe(false);
	});
});
