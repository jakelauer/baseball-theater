/**
 * `GET /api/v1/players/profiles?personIds=…` (S209 AC 3): the asked players' four stats pages from the player-id
 * table, null for a site whose id is unknown, a player with no row left out (an id past Postgres's integer range
 * included, never a 500), a malformed list a 400, and a day's caching. The Postgres adapter's read of an out-of-range
 * id is the shared contract's (`describePlayerIdContract`).
 */
import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryPlayerIdRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { COMMITTED_SPEC } from "../services/openapi.js";
import { handleApiRequest } from "./api.js";
import type { ApiContext } from "./api.js";
import { PLAYER_PROFILES_CACHE_CONTROL } from "./cache-control.js";

async function context(): Promise<ApiContext>
{
	const playerIds = new InMemoryPlayerIdRepository();
	await playerIds.replaceRegisterFile("people-0.csv", [{
		personId: 665871,
		fangraphsId: "21741",
		bbrefId: "assadja01",
	}, {
		personId: 700001,
		fangraphsId: null,
		bbrefId: "someo01",
	}], "\"e1\"", "2026-11-27T12:00:00.000Z");
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

async function profiles(query: string): Promise<Response>
{
	return handleApiRequest(new Request(`http://localhost:8787/api/v1/players/profiles${query}`), await context());
}

const ASSAD = {
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
};

describe("GET /api/v1/players/profiles (S209 AC 3)", () =>
{
	it("S209 AC 3: a known player's four pages, cacheable for a day", async () =>
	{
		const response = await profiles("?personIds=665871");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe(PLAYER_PROFILES_CACHE_CONTROL);
		expect(await response.json()).toEqual({
			players: [ASSAD],
		});
	});

	it("S209 AC 3: many players in one request; one site's unknown id is null, and an unknown id, 0 or one past 2147483647 is left out", async () =>
	{
		const response = await profiles("?personIds=700001,123,0,99999999999,665871,665871");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe(PLAYER_PROFILES_CACHE_CONTROL);
		expect(await response.json()).toEqual({
			players: [ASSAD, {
				ids: {
					mlbam: 700001,
					fangraphs: null,
					bbref: "someo01",
				},
				profiles: {
					mlb: "https://www.mlb.com/player/700001",
					fangraphs: null,
					bbref: "https://www.baseball-reference.com/players/s/someo01.shtml",
					savant: "https://baseballsavant.mlb.com/savant-player/700001",
				},
			}],
		});
	});

	it("S209 AC 3: a missing, malformed or over-long list is a 400", async () =>
	{
		for (const query of ["", "?personIds=", "?personIds=abc", "?personIds=1,,2", "?personIds=-1", `?personIds=${Array.from({
			length: 101,
		}, (_, i) => i + 1).join(",")}`])
		{
			const response = await profiles(query);
			expect(response.status, query).toBe(400);
			expect((await response.json() as { error: string }).error).toBe("person_ids_invalid");
		}
		expect((await profiles(`?personIds=${Array.from({
			length: 100,
		}, (_, i) => i + 1).join(",")}`)).status).toBe(200);
	});

	it("S209 AC 3: the committed spec's personIds pattern accepts exactly the lists the route answers", async () =>
	{
		const spec = JSON.parse(readFileSync(COMMITTED_SPEC, "utf8")) as {
			paths: Record<string, { get: { parameters: { name: string;
				schema: { pattern: string }; }[]; }; }>;
		};
		const pattern = new RegExp(spec.paths["/api/v1/players/profiles"]!.get.parameters.find((parameter) => parameter.name === "personIds")!.schema.pattern);
		for (const ids of ["1", "665871,1", "1".repeat(16), "1".repeat(17), `1,${"2".repeat(17)}`, "", "1,,2", "-1", "abc", "1,"])
		{
			const response = await profiles(`?personIds=${ids}`);
			expect(pattern.test(ids), ids).toBe(response.status === 200);
		}
	});
});
