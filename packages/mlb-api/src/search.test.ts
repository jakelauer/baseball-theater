import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { parseSearchPlay, parseSearchResponse } from "./search.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

/** A recorded MLB search answer (S5, S72), as committed. */
function recorded(name: string): unknown
{
	return JSON.parse(readFileSync(fixtures + name, "utf8"));
}

describe("parseSearchResponse (S153; moved from functions/src/mappers/search.ts, #347)", () =>
{
	it("reads each recorded answer's envelope, and every recorded play with clips parses whole", () =>
	{
		for (const name of ["search-walk-off.json", "search--team-147--tag-home-run.json"])
		{
			const answer = parseSearchResponse(recorded(name));
			expect(answer.data.search.total, name).toBeGreaterThan(0);
			const withClips = answer.data.search.plays.filter((p) => (p as { mediaPlayback: unknown[] }).mediaPlayback.length > 0);
			expect(withClips.length, name).toBeGreaterThan(0);
			for (const play of withClips) expect(parseSearchPlay(play), name).not.toBeNull();
		}
	});

	it("refuses MLB's errors and an answer that isn't the search's shape", () =>
	{
		expect(() => parseSearchResponse({
			errors: [{
				message: "Unknown Query Field",
			}],
		})).toThrow(/Unknown Query Field/);
		expect(() => parseSearchResponse({
			errors: [{}],
		})).toThrow(/query refused/);
		expect(() => parseSearchResponse(null)).toThrow(/not an object/);
		expect(() => parseSearchResponse({
			data: {},
		})).toThrow(/no data.search/);
	});
});

describe("parseSearchPlay (S153)", () =>
{
	it("keeps the play's guid and playInfo inning fields as MLB writes them", () =>
	{
		const play = parseSearchPlay({
			id: "p1",
			gamePk: 1,
			gameDate: "2026-09-19",
			mediaPlayback: [{
				id: "m1",
				title: "A hit",
				guid: "abc",
				playInfo: {
					inning: 6,
					inningHalf: "Top",
					gamePk: 1,
				},
			}],
		});
		expect(play?.mediaPlayback[0]).toMatchObject({
			guid: "abc",
			playInfo: {
				inning: 6,
				inningHalf: "Top",
			},
		});
	});

	it("answers null for a play BT can't map", () =>
	{
		expect(parseSearchPlay(null)).toBeNull();
		expect(parseSearchPlay({
			gamePk: "1",
			mediaPlayback: [],
		})).toBeNull();
		expect(parseSearchPlay({
			gamePk: 1,
			mediaPlayback: [{
				id: "m",
				title: null,
			}],
		})).toBeNull();
	});
});
