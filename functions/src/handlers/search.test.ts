/**
 * S5's route test: `GET /api/v1/search/highlights` in process, over the fixture MLB client, which
 * answers "walk-off" from MLB's recorded answer (`fixtures/search-walk-off.json`), so no network.
 */
import type { SearchHighlightsResponse } from "@bt/domain";
import { ApiRoutes } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it, vi,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { searchHighlightsRequest } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { handleApiRequest } from "./api.js";

/** One request to the API, answered in process over `mlb` (the fixtures unless a test gives its own). */
async function get(path: string, mlb: MlbStatsClient = new FixtureMlbStatsClient()): Promise<Response>
{
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	return handleApiRequest(new Request(`http://bt.test${path}`), {
		ingest: {
			mlb,
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	});
}

async function search(q: string): Promise<SearchHighlightsResponse>
{
	const response = await get(`/api/v1/search/highlights?q=${encodeURIComponent(q)}`);
	expect(response.status).toBe(200);
	return await response.json() as SearchHighlightsResponse;
}

describe("GET /api/v1/search/highlights (S5)", () =>
{
	it("S5 AC 1: answers walk-off with 200 and at least one highlight, from a route in the S26 table", async () =>
	{
		expect(ApiRoutes["GET /api/v1/search/highlights"]).toBe("SearchHighlightsResponse");
		const body = await search("walk-off");
		expect(body.query).toBe("walk-off");
		expect(body.highlights.length).toBeGreaterThanOrEqual(1);
		expect(body.total).toBeGreaterThanOrEqual(body.highlights.length);
	});

	it("S5 AC 2: a returned highlight's title or blurb says walk-off", async () =>
	{
		const body = await search("walk-off");
		expect(body.highlights.some(({ highlight }) => /walk-off/i.test(highlight.title) || /walk-off/i.test(highlight.blurb ?? ""))).toBe(true);
		// The recording of 2026-11-03's search (`fixtures/search-walk-off.json`) stands in for AC 2's `744834`: the same answer
		// AC 8 pins its World Series walk-off from.
		expect(body.highlights.map(({ highlight }) => highlight.title)).toContain("Ben Williamson's walk-off single to win Game 4");
		// Every result plays: a URL BT can hand the player.
		expect(body.highlights.every(({ highlight }) => highlight.playbackUrl)).toBe(true);
	});

	it("S5 AC 3: an empty, missing or blank q answers 400 query_required", async () =>
	{
		for (const path of ["/api/v1/search/highlights", "/api/v1/search/highlights?q=", "/api/v1/search/highlights?q=%20-%20"])
		{
			const response = await get(path);
			expect(response.status, path).toBe(400);
			expect((await response.json() as { error: string }).error, path).toBe("query_required");
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
	});

	it("S5 AC 8: each result carries its game's pk, teams and date, or no game when MLB ties it to none", async () =>
	{
		const body = await search("walk-off");
		const withGame = body.highlights.filter((h) => h.game);
		expect(withGame.length).toBeGreaterThan(0);
		for (const { game } of withGame)
		{
			expect(game!.gamePk).toBeGreaterThan(0);
			expect(game!.officialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(game!.awayId).toBeGreaterThan(0);
			expect(game!.homeId).toBeGreaterThan(0);
			expect(game!.away).toMatch(/^[A-Z]{2,3}$/);
			expect(game!.home).toMatch(/^[A-Z]{2,3}$/);
		}
		// The 2026 World Series Game 4 walk-off as recorded: MIL at TB, by MLB's playInfo.
		const ws = body.highlights.find((h) => h.highlight.title === "Ben Williamson's walk-off single to win Game 4");
		expect(ws?.game).toMatchObject({
			gamePk: 849803,
			officialDate: "2026-10-27",
			away: "MIL",
			home: "TB",
		});
		// A montage MLB ties to no game (`gamePk: -1`) shows no matchup and no game link.
		expect(body.highlights.some((h) => h.game === null)).toBe(true);
	});

	it("S5 AC 8: the request asks MLB's free-text search for each clip's guid and playInfo, sending walk-off as walk off", () =>
	{
		const { url } = searchHighlightsRequest("walk-off");
		const params = new URL(url).searchParams;
		expect(new URL(url).host).toBe("fastball-gateway.mlb.com");
		expect(params.get("query")).toMatch(/\bguid\b/);
		expect(params.get("query")).toMatch(/playInfo \{ inning inningHalf gamePk/);
		expect(JSON.parse(params.get("variables") ?? "{}")).toMatchObject({
			queryType: "FREETEXT",
			query: "walk off",
		});
	});

	it("answers 400 query_too_long, never cached, for more than 200 characters, and searches 200", async () =>
	{
		const long = await get(`/api/v1/search/highlights?q=${"a".repeat(201)}`);
		expect(long.status).toBe(400);
		expect((await long.json() as { error: string }).error).toBe("query_too_long");
		expect(long.headers.get("Cache-Control")).toBe("no-store");
		expect((await get(`/api/v1/search/highlights?q=${"a".repeat(200)}`)).status).toBe(200);
	});

	it("answers 502 search_unavailable, never cached, when MLB can't answer, and logs no search words", async () =>
	{
		const failing = Object.assign(Object.create(new FixtureMlbStatsClient()) as MlbStatsClient, {
			searchHighlights: async () =>
			{
				throw new Error("MLB Stats API 503 for https://fastball-gateway.mlb.com/graphql?q=secret");
			},
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const response = await get("/api/v1/search/highlights?q=secret", failing);
		expect(response.status).toBe(502);
		expect((await response.json() as { error: string }).error).toBe("search_unavailable");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
		log.mockRestore();
	});

	it("answers words with no recording with no results, and caches an answer five minutes", async () =>
	{
		const response = await get("/api/v1/search/highlights?q=nothing%20recorded");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
		expect(await response.json()).toEqual({
			query: "nothing recorded",
			total: 0,
			highlights: [],
		});
	});
});
