/**
 * S212 AC 3: the schedule, game and digest routes answer past, finished data with `PAST_CACHE_CONTROL`, a past digest
 * missing a game it couldn't read with the floor, and everything else with exactly the header it got before S212.
 */
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { InMemorySettingsRepository } from "../adapters/memory/repos.js";
import type { IngestDeps } from "../services/ingest.js";
import { ingestGame, storeSchedule } from "../services/ingest.js";
import {
	finalDay, finalGame, LONG_AGO, memoryDeps, NOW, PAST_DATE, storePastDay,
} from "../test/past-data.js";
import { handleApiRequest } from "./api.js";
import {
	edgeCacheControl, PAST_CACHE_CONTROL, STALE_WHILE_REVALIDATE_S,
} from "./cache-control.js";

/** The API over `ingest`, read at {@link NOW}. */
function api(ingest: IngestDeps)
{
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx = {
		ingest,
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return async (path: string) =>
	{
		const response = await handleApiRequest(new Request(`http://localhost:8787${path}`), ctx);
		expect(response.status).toBe(200);
		return {
			header: response.headers.get("Cache-Control"),
			body: await response.json() as { windowMode?: "active" | "cache";
				lastChangedAt?: string; },
		};
	};
}

/** Today's header for a body's entity: ADR-021's ladder (`edgeCacheControl`), what the routes sent before S212. */
function ladder(body: { windowMode?: "active" | "cache";
	lastChangedAt?: string; }): string
{
	return edgeCacheControl(body, NOW);
}

describe("past, finished responses' edge lifetime (S212 AC 3)", () =>
{
	it("S212 AC 3 schedule past: a past, finished day gets max-age 3600, s-maxage 30 days and a day's stale window", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		const { header } = await api(deps)(`/api/v1/schedule?date=${PAST_DATE}`);
		expect(header).toBe("public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400");
		expect(header).toBe(PAST_CACHE_CONTROL);
	});

	it("S212 AC 3 game past: a past, finished game gets the long lifetime", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		expect((await api(deps)("/api/v1/games/744834")).header).toBe(PAST_CACHE_CONTROL);
	});

	it("S212 AC 3 digest past: a past, finished day whose games are all past, finished and read gets the long lifetime", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		expect((await api(deps)(`/api/v1/digest?date=${PAST_DATE}`)).header).toBe(PAST_CACHE_CONTROL);
	});

	it("S212 AC 3 today: MLB's today, final and out of its window, keeps the ladder header, and so does its digest", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, {
			...await finalDay("2026-11-15", "2026-11-14T23:00:00.000Z"),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		const get = api(deps);
		const { header, body } = await get("/api/v1/schedule?date=2026-11-15");
		expect(header).toBe(ladder(body));
		expect(header).not.toBe(PAST_CACHE_CONTROL);
		expect(header).toMatch(/^public, s-maxage=\d+, stale-while-revalidate=300$/);
		expect((await get("/api/v1/digest?date=2026-11-15")).header).not.toBe(PAST_CACHE_CONTROL);
	});

	it("S212 AC 3 future: a future day keeps the ladder header", async () =>
	{
		const deps = memoryDeps();
		const day = await finalDay("2026-11-20", "2026-11-20T23:00:00.000Z");
		await storeSchedule(deps, {
			...day,
			games: day.games.map((game) => ({
				...game,
				status: {
					abstractGameState: "Preview",
					codedGameState: "S",
					detailedState: "Scheduled",
				},
			})),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		const { header, body } = await api(deps)("/api/v1/schedule?date=2026-11-20");
		expect(header).toBe(ladder(body));
		expect(header).not.toBe(PAST_CACHE_CONTROL);
	});

	it("S212 AC 3 live game: a game in its window keeps no-store", async () =>
	{
		const deps = memoryDeps();
		const { game } = await finalGame(744834, "2026-11-15");
		await ingestGame(deps, {
			...game,
			status: {
				abstractGameState: "Live",
				codedGameState: "I",
				detailedState: "In Progress",
			},
			fetchedAt: NOW.toISOString(),
			windowMode: "active",
		});
		expect((await api(deps)("/api/v1/games/744834")).header).toBe("no-store");
	});

	it("S212 AC 3 digest unfinished game: a past day's digest holding a game still in its window keeps today's header", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		const stored = (await deps.games.getByPk(744834))!;
		await deps.games.upsert({
			...stored,
			windowMode: "active",
			version: stored.version + 1,
		});
		const { header, body } = await api(deps)(`/api/v1/digest?date=${PAST_DATE}`);
		expect(header).toBe("no-store");
		expect(body.windowMode).toBe("active");
	});

	it("S212 AC 3 digest partial: a past digest with one game it couldn't read gets the floor", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		const mlb = Object.assign(Object.create(fixture) as MlbStatsClient, {
			fetchGame: async (gamePk: number) =>
			{
				if (gamePk === 745001) throw new Error("MLB down");
				return fixture.fetchGame(gamePk);
			},
		});
		const deps = memoryDeps(mlb);
		const { game } = await finalGame(744834);
		await ingestGame(deps, {
			...game,
			fetchedAt: LONG_AGO,
			windowMode: "cache",
		});
		await storeSchedule(deps, {
			...await finalDay(),
			fetchedAt: LONG_AGO,
			windowMode: "cache",
		});
		expect((await api(deps)(`/api/v1/digest?date=${PAST_DATE}`)).header).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});
});
