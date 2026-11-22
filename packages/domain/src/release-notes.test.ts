import {
	describe, expect, it,
} from "vitest";
import {
	compareReleaseVersions, currentRelease, isApproved, parseReleaseNotes, parseReleaseVersion, type ReleaseNotes,
} from "./release-notes.js";

/** A complete, approved notes file; each test changes one thing about it. */
const valid = () => ({
	version: "v4.0.0",
	date: "2027-03-26",
	headline: [{
		title: "Baseball Theater is open",
		sentence: "Every game, every pitch, for everyone.",
	}],
	items: [
		{
			kind: "feature",
			title: "Change log",
			sentence: "See what changed in each release.",
		},
		{
			kind: "performance",
			title: "Faster scoreboard",
			sentence: "The scoreboard loads in half the time.",
		},
	],
	fixesAndPolish: "Lots of small fixes and polish.",
	approval: {
		date: "2027-03-25",
		quote: "Looks good",
	},
});

/** The fields every problem names, so a test says which field failed. */
const fields = (input: unknown) =>
{
	const result = parseReleaseNotes(input);
	return result.ok ? [] : result.problems.map((p) => p.field);
};

describe("parseReleaseNotes (S131 AC 1)", () =>
{
	it("S131 AC 1 valid file: parses into the notes, every bucket kept", () =>
	{
		const result = parseReleaseNotes(valid());
		expect(result).toEqual({
			ok: true,
			notes: valid(),
		});
	});

	it("S131 AC 1 bad version: rejects a version that isn't vMAJOR.MINOR.PATCH", () =>
	{
		expect(fields({
			...valid(),
			version: "4.0",
		})).toEqual(["version"]);
		expect(fields({
			...valid(),
			version: 4,
		})).toEqual(["version"]);
	});

	it("S131 AC 1 leading zero: rejects v3.01.0 rather than reading it as v3.1.0", () =>
	{
		expect(fields({
			...valid(),
			version: "v3.01.0",
		})).toEqual(["version"]);
	});

	it("S131 AC 1 v3.0.0: zero parts are valid", () =>
	{
		expect(parseReleaseNotes({
			...valid(),
			version: "v3.0.0",
		}).ok).toBe(true);
	});

	it("S131 AC 1 impossible date: rejects a date the calendar doesn't have, in the notes and in the approval", () =>
	{
		expect(fields({
			...valid(),
			date: "2027-02-30",
		})).toEqual(["date"]);
		expect(fields({
			...valid(),
			approval: {
				date: "2027-13-01",
				quote: "Yes",
			},
		})).toEqual(["approval.date"]);
	});

	it("S131 AC 1 unknown kind: rejects an item kind outside feature, enhancement, performance and fix", () =>
	{
		const notes = valid();
		notes.items[0]!.kind = "setting";
		expect(fields(notes)).toEqual(["items[0].kind"]);
		for (const kind of ["feature", "enhancement", "performance", "fix"])
		{
			notes.items[0]!.kind = kind;
			expect(parseReleaseNotes(notes).ok).toBe(true);
		}
	});

	it("S131 AC 1 empty title: rejects an entry with an empty or blank title", () =>
	{
		const notes = valid();
		notes.headline[0]!.title = "  ";
		notes.items[1]!.title = "";
		expect(fields(notes)).toEqual(["headline[0].title", "items[1].title"]);
	});

	it("S131 AC 1 empty sentence: rejects an entry with an empty sentence", () =>
	{
		const notes = valid();
		notes.items[0]!.sentence = "";
		expect(fields(notes)).toEqual(["items[0].sentence"]);
		expect(fields({
			...valid(),
			fixesAndPolish: " ",
		})).toEqual(["fixesAndPolish"]);
	});

	it("S131 AC 1 approval with no quote: rejects an approval missing or blank in its quote", () =>
	{
		expect(fields({
			...valid(),
			approval: {
				date: "2027-03-25",
			},
		})).toEqual(["approval.quote"]);
		expect(fields({
			...valid(),
			approval: {
				date: "2027-03-25",
				quote: "",
			},
		})).toEqual(["approval.quote"]);
	});

	it("S131 AC 1 headline and items: rejects the same title in both buckets", () =>
	{
		const notes = valid();
		notes.items[0]!.title = " baseball theater is OPEN ";
		expect(fields(notes)).toEqual(["items[0].title"]);
	});

	it("S131 AC 1 nothing in any bucket: rejects notes with no headline, no item and no fixesAndPolish", () =>
	{
		expect(fields({
			version: "v4.0.0",
			headline: [],
			items: [],
		})).toEqual(["(notes)"]);
		expect(fields({
			version: "v4.0.0",
		})).toEqual(["(notes)"]);
	});

	it("S131 AC 1 only fixesAndPolish: a fixes-only release's notes are valid, their missing buckets empty lists", () =>
	{
		const result = parseReleaseNotes({
			version: "v4.0.1",
			fixesAndPolish: "Small fixes.",
		});
		expect(result).toEqual({
			ok: true,
			notes: {
				version: "v4.0.1",
				fixesAndPolish: "Small fixes.",
				headline: [],
				items: [],
			},
		});
	});

	it("returns every problem it found, by field, not just the first", () =>
	{
		expect(fields({
			version: "v3.01.0",
			date: "nope",
			items: [{
				kind: "x",
				title: "",
				sentence: "",
			}],
			extra: 1,
		})).toEqual([
			"extra", "version", "date", "items[0].title", "items[0].sentence", "items[0].kind",
		]);
	});

	it("rejects what isn't notes at all, lists that aren't lists, and unknown entry or approval fields", () =>
	{
		expect(fields(null)).toEqual(["(notes)"]);
		expect(fields([])).toEqual(["(notes)"]);
		expect(fields({
			...valid(),
			headline: "big",
			items: {},
		})).toEqual(["headline", "items"]);
		expect(fields({
			...valid(),
			headline: ["x"],
		})).toEqual(["headline[0]"]);
		expect(fields({
			...valid(),
			headline: [{
				title: "A",
				sentence: "B",
				kind: "feature",
			}],
		})).toEqual(["headline[0].kind"]);
		expect(fields({
			...valid(),
			approval: "yes",
		})).toEqual(["approval"]);
		expect(fields({
			...valid(),
			approval: {
				date: "2027-03-25",
				quote: "Yes",
				by: "owner",
			},
		})).toEqual(["approval.by"]);
	});
});

describe("parseReleaseVersion (S131 AC 2)", () =>
{
	it("reads each numeric part", () =>
	{
		expect(parseReleaseVersion("v3.10.2")).toEqual({
			text: "v3.10.2",
			major: 3,
			minor: 10,
			patch: 2,
		});
		expect(parseReleaseVersion("v3.0.0")).toEqual({
			text: "v3.0.0",
			major: 3,
			minor: 0,
			patch: 0,
		});
	});

	it("S131 AC 2 v3.01.0: a leading zero is not a version", () =>
	{
		expect(parseReleaseVersion("v3.01.0")).toBeNull();
		expect(parseReleaseVersion("v03.1.0")).toBeNull();
	});

	it("S131 AC 2 3.1.0: a version with no v is not one", () =>
	{
		expect(parseReleaseVersion("3.1.0")).toBeNull();
		expect(parseReleaseVersion("v3.1")).toBeNull();
		expect(parseReleaseVersion("v3.1.0-rc1")).toBeNull();
	});

	it("S131 AC 2 empty string: is not a version", () =>
	{
		expect(parseReleaseVersion("")).toBeNull();
	});

	it("rejects a part too big to be a safe integer, so comparing two versions never gives NaN or a false tie", () =>
	{
		expect(parseReleaseVersion("v9007199254740991.0.0")?.major).toBe(Number.MAX_SAFE_INTEGER);
		expect(parseReleaseVersion("v9007199254740993.0.0")).toBeNull();
		expect(parseReleaseVersion(`v4.${"9".repeat(400)}.0`)).toBeNull();
		expect(() => compareReleaseVersions("v9007199254740993.0.0", "v9007199254740992.0.0")).toThrow("v9007199254740993.0.0");
	});
});

describe("compareReleaseVersions (S131 AC 2)", () =>
{
	it("S131 AC 2 v3.10.0 newer than v3.9.0: compares each part as a number", () =>
	{
		expect(compareReleaseVersions("v3.10.0", "v3.9.0")).toBeGreaterThan(0);
		expect(compareReleaseVersions("v3.9.0", "v3.10.0")).toBeLessThan(0);
		expect(compareReleaseVersions("v4.0.0", "v3.99.99")).toBeGreaterThan(0);
		expect(compareReleaseVersions("v3.2.10", "v3.2.9")).toBeGreaterThan(0);
		expect(compareReleaseVersions("v3.2.1", "v3.2.1")).toBe(0);
	});

	it("throws on a string that isn't a version", () =>
	{
		expect(() => compareReleaseVersions("v3.01.0", "v3.1.0")).toThrow("v3.01.0");
		expect(() => compareReleaseVersions("v3.1.0", "3.1.0")).toThrow("3.1.0");
	});
});

describe("currentRelease (S131 AC 2)", () =>
{
	const notes = (version: string, approved: boolean): ReleaseNotes => ({
		version,
		headline: [],
		items: [],
		fixesAndPolish: "Fixes.",
		...approved && {
			approval: {
				date: "2027-03-25",
				quote: "Yes",
			},
		},
	});

	it("is the newest approved notes, compared numerically", () =>
	{
		expect(currentRelease([notes("v4.9.0", true), notes("v4.10.0", true), notes("v4.2.0", true)])?.version).toBe("v4.10.0");
	});

	it("S131 AC 2 newer draft ignored: a draft newer than the newest approved notes doesn't count", () =>
	{
		expect(currentRelease([notes("v4.0.0", true), notes("v4.1.0", false)])?.version).toBe("v4.0.0");
	});

	it("S131 AC 2 no approved notes: is null with no notes or only drafts", () =>
	{
		expect(currentRelease([])).toBeNull();
		expect(currentRelease([notes("v4.0.0", false)])).toBeNull();
	});

	it("isApproved needs a real date and a non-empty quote", () =>
	{
		expect(isApproved(notes("v4.0.0", true))).toBe(true);
		expect(isApproved({
			...notes("v4.0.0", true),
			approval: {
				date: "2027-02-30",
				quote: "Yes",
			},
		})).toBe(false);
		expect(isApproved({
			...notes("v4.0.0", true),
			approval: {
				date: "2027-03-25",
				quote: " ",
			},
		})).toBe(false);
	});
});
