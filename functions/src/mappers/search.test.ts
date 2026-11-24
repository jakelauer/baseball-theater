import {
	mkdtemp, readFile, rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	describe, expect, it, vi,
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

describe("one malformed play (S5)", () =>
{
	it("is left out, its id logged, and the rest still answer", () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const badPlayback = play(9);
		badPlayback.id = "bad-playback";
		(badPlayback.mediaPlayback[0]!.feeds[0]!.playbacks[0] as { name: unknown }).name = null;
		const page = mapSearchResults(parseSearchResponse(answer([
			badPlayback,
			{
				id: "no-media",
				gamePk: 1,
				mediaPlayback: null,
			},
			{
				id: "no-title",
				gamePk: 2,
				mediaPlayback: [{
					id: "m2",
					title: null,
				}],
			},
			{
				id: "no-game-pk",
				mediaPlayback: [{
					id: "m3",
					title: "x",
				}],
			},
			{
				...play(4),
				id: "date-not-string",
				gameDate: 20260919,
			},
			{
				...play(5),
				id: "cuts-not-list",
				mediaPlayback: [{
					...play(5).mediaPlayback[0]!,
					feeds: [{
						image: {
							cuts: "x",
						},
						playbacks: [],
					}],
				}],
			},
			{
				id: "no-clips",
				gamePk: 6,
				mediaPlayback: [],
			},
			play(-1),
		])));
		expect(page.highlights.map((h) => h.highlight.id)).toEqual(["m-1"]);
		// A play with no clips is skipped silently, as MLB lists some; only a malformed one is logged.
		expect(JSON.stringify(warn.mock.calls)).not.toContain("no-clips");
		expect(JSON.stringify(warn.mock.calls)).toMatch(/date-not-string[\s\S]*cuts-not-list/);
		expect(page.total).toBe(99);
		expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toMatch(/bad-playback[\s\S]*no-media[\s\S]*no-title[\s\S]*no-game-pk/);
		warn.mockRestore();
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

	it("names a filtered search apart from any words-only one (S72): the words end at the first --", () =>
	{
		expect(searchFixtureName("team 147 tag home run")).toBe("search-team-147-tag-home-run.json");
		expect(searchFixtureName("", {
			teamId: 147,
			tag: "home-run",
		})).toBe("search--team-147--tag-home-run.json");
		expect(searchFixtureName("judge", {
			date: "2026-09-14",
		})).toBe("search-judge--date-2026-09-14.json");
	});

	it("records a filtered search under its filtered name, asking MLB's STRUCTURED filter language (S72)", async () =>
	{
		const dir = await mkdtemp(path.join(tmpdir(), "bt-search-"));
		try
		{
			const text = JSON.stringify(answer([play(-1)]));
			const asked: string[] = [];
			const name = await recordSearch("", dir, {
				filters: {
					teamId: 147,
					tag: "home-run",
				},
				fetchImpl: async (input) =>
				{
					asked.push(String(input));
					return new Response(text);
				},
			});
			expect(name).toBe("search--team-147--tag-home-run.json");
			expect(await readFile(path.join(dir, name), "utf8")).toBe(text);
			const variables = JSON.parse(new URL(asked[0] ?? "").searchParams.get("variables") ?? "{}") as { queryType: string;
				query: string; };
			expect(variables.queryType).toBe("STRUCTURED");
			expect(variables.query).toBe("TeamId = [147] AND ContentTags = [\"home-run\"] Order By Timestamp DESC");
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
