import {
	describe, expect, it,
} from "vitest";
import {
	BUILD_RELEASE, VERSION_LINE, buildInfo, knownRelease, versionLine,
} from "./version.js";

describe("versionLine (S60, S56 A2, #47)", () =>
{
	it("prints {release} ({7-char commit}) with no label, as A2 draws it", () =>
	{
		expect(versionLine("v3.2.0", "c46e8531f0a2b9d7e6c5")).toBe("v3.2.0 (c46e853)");
	});

	it("prints unreleased for a deployed commit no pull request merged", () =>
	{
		expect(versionLine("unreleased", "c46e8531f0a2b9d7e6c5")).toBe("unreleased (c46e853)");
	});

	it("falls back to dev when nothing was injected (tests skip vite.config.ts)", () =>
	{
		expect(VERSION_LINE).toBe("dev (unknown)");
	});
});

describe("buildInfo (#47): what vite.config.ts injects", () =>
{
	const git = () => "abc1234";

	it("takes the release a deploy looked up, and the commit Actions names", () =>
	{
		expect(buildInfo({
			BT_RELEASE: "v3.2.0",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git)).toEqual({
			release: "v3.2.0",
			commit: "40767e9",
		});
	});

	it("says dev for any build that looked nothing up, whatever the run number", () =>
	{
		expect(buildInfo({
			GITHUB_RUN_NUMBER: "193",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git).release).toBe("dev");
		expect(buildInfo({
			BT_RELEASE: "  ",
		}, git).release).toBe("dev");
	});

	it("keeps a milestone name with spaces, trimmed", () =>
	{
		expect(buildInfo({
			BT_RELEASE: " Spring cleanup 2 ",
		}, git).release).toBe("Spring cleanup 2");
	});

	it("prefers BT_COMMIT (a preview's head commit) over GITHUB_SHA (its test merge)", () =>
	{
		expect(buildInfo({
			BT_COMMIT: "1111111222222233333334444444555555566666",
			GITHUB_SHA: "40767e905e0717628d110902c1d45d3de9625e1a",
		}, git).commit).toBe("1111111");
	});

	it("asks git outside Actions, and says unknown when git can't answer", () =>
	{
		expect(buildInfo({}, git).commit).toBe("abc1234");
		expect(buildInfo({}, () =>
		{
			throw new Error("not a checkout");
		}).commit).toBe("unknown");
	});
});

describe("knownRelease (S135 AC 1): the build's release, only when it is a release version", () =>
{
	it("S135 AC 1: keeps v3.2.0 and nulls unreleased, dev, blank, v3.2 and a milestone named Next release", () =>
	{
		expect(knownRelease("v3.2.0")).toBe("v3.2.0");
		for (const label of ["unreleased", "dev", "", "v3.2", "Next release"])
		{
			expect(knownRelease(label)).toBeNull();
		}
	});

	it("S135 AC 1: buildInfo with BT_RELEASE=v3.2.0 gives the release label knownRelease reads; with none it is null", () =>
	{
		const info = buildInfo({
			BT_RELEASE: "v3.2.0",
		}, () => "abc1234");
		expect(info.release).toBe("v3.2.0");
		expect(knownRelease(info.release)).toBe("v3.2.0");
		expect(knownRelease(buildInfo({}, () => "abc1234").release)).toBeNull();
		// Tests skip vite.config.ts's injection, so this build's release is dev: no known release.
		expect(BUILD_RELEASE).toBeNull();
	});
});

describe("the rail's version line, kept as #47 built it (S135 AC 4)", () =>
{
	it("S135 AC 4: prints the release with its commit, or unreleased / dev with the commit", () =>
	{
		expect(versionLine("v3.2.0", "c46e8531f0a2b9d7e6c5")).toBe("v3.2.0 (c46e853)");
		expect(versionLine("unreleased", "c46e8531f0a2b9d7e6c5")).toBe("unreleased (c46e853)");
		expect(versionLine("dev", "c46e8531f0a2b9d7e6c5")).toBe("dev (c46e853)");
	});
});
