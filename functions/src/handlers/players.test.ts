/**
 * `GET /api/v1/players/:personId/profiles` (S209 AC 3): a player's four stats pages from the player-id table, null for
 * a site whose id is unknown, 404 for a player BT has no row for, a day's caching once checked and minutes before.
 */
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryPlayerIdRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { handleApiRequest } from "./api.js";
import type { ApiContext } from "./api.js";
import { PLAYER_PROFILES_CHECKED_CACHE_CONTROL, PLAYER_PROFILES_PENDING_CACHE_CONTROL } from "./cache-control.js";

async function context(): Promise<ApiContext>
{
	const playerIds = new InMemoryPlayerIdRepository();
	await playerIds.addPlayers([665871, 700001, 700002]);
	await playerIds.recordChecked([665871, 700001], new Map([[665871, {
		fangraphsId: "21741",
		bbrefId: "assadja01",
	}]]), "2026-11-27T12:00:00.000Z");
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	return {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			playerIds,
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
}

async function profiles(personId: string): Promise<Response>
{
	return handleApiRequest(new Request(`http://localhost:8787/api/v1/players/${personId}/profiles`), await context());
}

describe("GET /api/v1/players/:personId/profiles (S209 AC 3)", () =>
{
	it("S209 AC 3: a known player's four pages, cacheable for a day", async () =>
	{
		const response = await profiles("665871");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe(PLAYER_PROFILES_CHECKED_CACHE_CONTROL);
		expect(await response.json()).toEqual({
			ids: {
				mlbam: 665871,
				fangraphs: "21741",
				bbref: "assadja01",
			},
			profiles: {
				mlb: "https://www.mlb.com/player/665871",
				fangraphs: "https://www.fangraphs.com/statss.aspx?playerid=21741",
				bbref: "https://www.baseball-reference.com/players/a/assadja01.shtml",
				savant: "https://baseballsavant.mlb.com/savant-player/665871",
			},
			checked: true,
		});
	});

	it("S209 AC 3: a checked player with no cross-reference answers null for FanGraphs and Baseball-Reference", async () =>
	{
		const response = await profiles("700001");
		expect(response.status).toBe(200);
		expect((await response.json() as { profiles: Record<string, string | null> }).profiles).toEqual({
			mlb: "https://www.mlb.com/player/700001",
			fangraphs: null,
			bbref: null,
			savant: "https://baseballsavant.mlb.com/savant-player/700001",
		});
	});

	it("S209 AC 3: a player not yet checked is cached only minutes, and an unknown id is a 404 cached as briefly", async () =>
	{
		const pending = await profiles("700002");
		expect(pending.status).toBe(200);
		expect(pending.headers.get("Cache-Control")).toBe(PLAYER_PROFILES_PENDING_CACHE_CONTROL);
		expect((await pending.json() as { checked: boolean }).checked).toBe(false);
		const missing = await profiles("123");
		expect(missing.status).toBe(404);
		expect(missing.headers.get("Cache-Control")).toBe(PLAYER_PROFILES_PENDING_CACHE_CONTROL);
		expect((await profiles("abc")).status).toBe(404);
	});
});
