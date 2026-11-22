import {
	mkdtemp, readFile, rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	describe, expect, it,
} from "vitest";
import { searchFixtureName } from "../adapters/fixtures/fixture-client.js";
import { recordSearch } from "../services/recorder.js";
import { mapSearchResults, parseSearchResponse } from "./search.js";

/** One search hit as MLB answers it, with the fields BT asks for. */
function play(gamePk: number, teams: { away: { id: number;
	triCode: string; };
home: { id: number;
	triCode: string; }; } | null = null)
{
	return {
		id: `p${gamePk}`,
		gamePk,
		gameDate: gamePk > 0 ? "2026-09-19" : null,
		mediaPlayback: [{
			id: `m${gamePk}`,
			title: "A walk-off",
			blurb: "",
			description: "From the description",
			date: "2026-09-20",
			guid: null,
			playInfo: {
				teams,
			},
			feeds: [{
				duration: "00:00:31",
				image: {
					cuts: [{
						width: 320,
						src: "small.jpg",
					}, {
						width: 960,
						src: "big.jpg",
					}, {
						width: 640,
						src: "mid.jpg",
					}],
				},
				playbacks: [{
					name: "hlsCloud",
					url: "https://x/a.m3u8",
				}, {
					name: "mp4Avc",
					url: "https://x/a.mp4",
				}, {
					name: "trickplay",
					url: "https://x/%.jpg",
				}],
			}],
		}],
	};
}

const answer = (plays: unknown[]) => ({
	data: {
		search: {
			total: 99,
			plays,
		},
	},
});

describe("parseSearchResponse (S5)", () =>
{
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
		expect(() => parseSearchResponse(answer([{
			gamePk: "1",
		}]))).toThrow(/gamePk/);
		expect(() => parseSearchResponse(answer([{
			gamePk: 1,
			mediaPlayback: [{
				id: 1,
			}],
		}]))).toThrow(/id or title/);
	});
});

describe("mapSearchResults (S5)", () =>
{
	it("maps a play to a playable highlight with its game, by MLB's club ids", () =>
	{
		const page = mapSearchResults(parseSearchResponse(answer([play(823249, {
			away: {
				id: 146,
				triCode: "MIA",
			},
			home: {
				id: 135,
				triCode: "SD",
			},
		})])));
		expect(page.total).toBe(99);
		expect(page.highlights).toEqual([{
			highlight: {
				id: "m823249",
				playId: null,
				title: "A walk-off",
				blurb: "From the description",
				duration: "00:00:31",
				imageUrl: "mid.jpg",
				playbackUrl: "https://x/a.mp4",
				renditions: [{
					name: "hlsCloud",
					url: "https://x/a.m3u8",
				}, {
					name: "mp4Avc",
					url: "https://x/a.mp4",
				}],
				kind: "highlight",
				date: "2026-09-20",
			},
			game: {
				gamePk: 823249,
				officialDate: "2026-09-19",
				away: "MIA",
				home: "SD",
				awayId: 146,
				homeId: 135,
			},
		}]);
	});

	it("gives no game to a clip MLB ties to none, or whose clubs BT doesn't know; finds a club by tri-code", () =>
	{
		const page = mapSearchResults(parseSearchResponse(answer([
			play(-1),
			play(5, {
				away: {
					id: -1,
					triCode: "",
				},
				home: {
					id: -1,
					triCode: "",
				},
			}),
			play(6, {
				away: {
					id: 999,
					triCode: "NYY",
				},
				home: {
					id: 111,
					triCode: "BOS",
				},
			}),
			{
				id: "empty",
				gamePk: 7,
				mediaPlayback: [],
			},
		])));
		expect(page.highlights.map((h) => h.game?.away ?? null)).toEqual([null, null, "NYY"]);
	});
});

describe("recordSearch (S5)", () =>
{
	it("writes MLB's answer verbatim under the name the fixture client reads, and refuses an error", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-search-"));
		try
		{
			const text = JSON.stringify(answer([play(-1)]));
			const asked: string[] = [];
			const name = await recordSearch("Walk-Off", dir, {
				fetchImpl: async (input) =>
				{
					asked.push(String(input));
					return new Response(text);
				},
			});
			expect(name).toBe("search-walk-off.json");
			expect(searchFixtureName("walk off")).toBe(name);
			expect(asked[0]).toContain("fastball-gateway.mlb.com");
			expect(await readFile(path.join(dir, name), "utf8")).toBe(text);
			await expect(recordSearch("x", dir, {
				fetchImpl: async () => new Response("{}", {
					status: 500,
				}),
			})).rejects.toThrow(/500/);
			await expect(recordSearch("y", dir, {
				fetchImpl: async () => new Response(JSON.stringify({
					errors: [{
						message: "bad",
					}],
				})),
			})).rejects.toThrow(/bad/);
		}
		finally
		{
			await rm(dir, {
				recursive: true,
				force: true,
			});
		}
	});
});
