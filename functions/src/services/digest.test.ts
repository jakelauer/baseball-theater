import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import {
	countingMlb, memoryDeps, PAST_DATE, storePastDay,
} from "../test/past-data.js";
import { getDayDigest } from "./digest.js";
import { ingestScheduleDay } from "./ingest.js";

const NOW = new Date("2026-11-15T12:00:00Z");
const SETTLED = "2024-07-05T06:00:00.000Z";

/**
 * The 2024-07-04 fixture day, stored the way the route reads it, at a fixed clock, with the day
 * and every game marked out of the window, last changed the day after, and freshly checked, so each
 * test changes one thing.
 */
async function storedDay()
{
	const deps = {
		mlb: new FixtureMlbStatsClient(),
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		now: () => NOW,
	};
	await ingestScheduleDay(deps, "2024-07-04");
	const day = (await deps.schedules.getByDate("2024-07-04"))!;
	await deps.schedules.upsert({
		...day,
		version: day.version + 1,
		windowMode: "cache",
		lastChangedAt: SETTLED,
		fetchedAt: NOW.toISOString(),
	});
	for (const { gamePk } of day.games)
	{
		// Each game's one stored state (S150) settled too, so the joined day is out of its window.
		const row = (await deps.gameStates.getByPk(gamePk))!;
		await deps.gameStates.write([{
			...row,
			state: {
				...row.state,
				status: {
					abstractGameState: "Final",
					codedGameState: "F",
					detailedState: "Final",
				},
				live: null,
				version: row.state.version + 1,
				lastChangedAt: SETTLED,
			},
		}]);
		const game = (await deps.games.getByPk(gamePk))!;
		await deps.games.upsert({
			...game,
			version: game.version + 1,
			windowMode: "cache",
			lastChangedAt: SETTLED,
			fetchedAt: NOW.toISOString(),
		});
	}
	return deps;
}

describe("getDayDigest freshness (#61)", () =>
{
	it("a game that changed after its day did (a video posted after the final) moves the digest's last change", async () =>
	{
		const deps = await storedDay();
		const day = (await deps.schedules.getByDate("2024-07-04"))!;
		const pk = day.games[0]!.gamePk;
		const game = (await deps.games.getByPk(pk))!;
		const later = new Date(NOW.getTime() - 60_000).toISOString();
		await deps.games.upsert({
			...game,
			version: game.version + 1,
			lastChangedAt: later,
			fetchedAt: NOW.toISOString(),
		});

		const { freshness, digest } = await getDayDigest(deps, "2024-07-04");
		expect(freshness).toEqual({
			windowMode: "cache",
			lastChangedAt: later,
		});
		expect(digest.windowMode).toBe("cache");
	});

	it("with the day and every game out of the window and unchanged since, a day that changed last keeps its own time", async () =>
	{
		const deps = await storedDay();
		const day = (await deps.schedules.getByDate("2024-07-04"))!;
		await deps.schedules.upsert({
			...day,
			version: day.version + 1,
			lastChangedAt: "2024-07-05T07:00:00.000Z",
		});
		const { freshness, digest } = await getDayDigest(deps, "2024-07-04");
		expect(freshness).toEqual({
			windowMode: "cache",
			lastChangedAt: "2024-07-05T07:00:00.000Z",
		});
		expect(digest.windowMode).toBe("cache");
	});

	it("a live game makes the digest live, so the browser re-asks it and the edge doesn't keep it", async () =>
	{
		const deps = await storedDay();
		const day = (await deps.schedules.getByDate("2024-07-04"))!;
		const game = (await deps.games.getByPk(day.games[0]!.gamePk))!;
		await deps.games.upsert({
			...game,
			version: game.version + 1,
			windowMode: "active",
			fetchedAt: NOW.toISOString(),
		});

		const { freshness, digest } = await getDayDigest(deps, "2024-07-04");
		expect(freshness.windowMode).toBe("active");
		expect(digest.windowMode).toBe("active");
	});
});

describe("getDayDigest on past, finished data (S212 AC 2)", () =>
{
	it("S212 AC 2 digest zero: a stored past, finished day whose games are all stored makes zero MLB requests", async () =>
	{
		const deps = memoryDeps();
		const gamePks = await storePastDay(deps);
		const counting = countingMlb();
		deps.mlb = counting.client;
		const { digest, edgeLifetime } = await getDayDigest(deps, PAST_DATE);
		expect(counting.calls).toEqual([]);
		expect(gamePks.length).toBeGreaterThan(0);
		expect(digest.date).toBe(PAST_DATE);
		expect(edgeLifetime).toBe("past");
	});
});
