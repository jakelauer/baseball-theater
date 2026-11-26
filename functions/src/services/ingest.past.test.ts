/**
 * S212 AC 2: a stored past, finished day or game is served with no MLB request on read, from a fresh
 * `RefreshCoordinator` (a new isolate) and with its stamps far older than any ladder lifetime; anything else keeps
 * today's refresh-on-read rule.
 */
import {
	describe, expect, it,
} from "vitest";
import {
	countingMlb, finalDay, LONG_AGO, memoryDeps, NOW, PAST_DATE, storePastDay,
} from "../test/past-data.js";
import {
	getOrRefreshGame, getOrRefreshSchedule, storeSchedule,
} from "./ingest.js";
import { readScheduleDay } from "./game-state.js";

/** A stored past day whose MLB is then swapped for a counting one. */
async function pastDayCounting()
{
	const deps = memoryDeps();
	const gamePks = await storePastDay(deps);
	const counting = countingMlb();
	deps.mlb = counting.client;
	return {
		deps,
		gamePks,
		calls: counting.calls,
	};
}

/**
 * A day stored on `date`, its games' first pitch at `startTime` (out of their window) and final, or scheduled for a
 * future day, stamped long ago, its MLB counting.
 */
async function storedDayOn(date: string, startTime: string, scheduled = false)
{
	const deps = memoryDeps();
	const day = await finalDay(date, startTime);
	await storeSchedule(deps, {
		...day,
		games: scheduled ? day.games.map((game) => ({
			...game,
			status: {
				abstractGameState: "Preview",
				codedGameState: "S",
				detailedState: "Scheduled",
			},
		})) : day.games,
		fetchedAt: LONG_AGO,
		windowMode: "cache",
	});
	const counting = countingMlb();
	deps.mlb = counting.client;
	return {
		deps,
		calls: counting.calls,
	};
}

describe("past, finished reads (S212 AC 2)", () =>
{
	it("S212 AC 2 schedule zero: a stored past, finished day is served as stored with zero MLB requests", async () =>
	{
		const { deps, calls } = await pastDayCounting();
		const day = await getOrRefreshSchedule(deps, PAST_DATE);
		expect(calls).toEqual([]);
		expect(day).toEqual(await readScheduleDay(deps, PAST_DATE, NOW));
		expect(day.games.length).toBeGreaterThan(0);
	});

	it("S212 AC 2 game zero: a stored past, finished game is served with zero MLB requests", async () =>
	{
		const {
			deps, gamePks, calls,
		} = await pastDayCounting();
		for (const gamePk of gamePks) expect((await getOrRefreshGame(deps, gamePk))?.gamePk).toBe(gamePk);
		expect(calls).toEqual([]);
	});

	it("S212 AC 2 not stored: a day or game BT doesn't hold is asked of MLB once", async () =>
	{
		const { deps, calls } = await pastDayCounting();
		await getOrRefreshSchedule(deps, "2024-07-03");
		expect(calls).toEqual(["fetchSchedule 2024-07-03"]);
		const empty = memoryDeps();
		const counting = countingMlb();
		empty.mlb = counting.client;
		expect(await getOrRefreshGame(empty, 744834)).not.toBeNull();
		// The game once, and (S101) its uniforms once, asked as the game is first stored.
		expect(counting.calls).toEqual(["fetchGame 744834", "fetchGameUniforms 744834", "fetchGameRuleSettings 744834"]);
	});

	it("S212 AC 2 today stale: MLB's today, stale-stamped, still makes one MLB request", async () =>
	{
		const { deps, calls } = await storedDayOn("2026-11-15", "2026-11-14T23:00:00.000Z");
		await getOrRefreshSchedule(deps, "2026-11-15");
		expect(calls).toEqual(["fetchSchedule 2026-11-15"]);
	});

	it("S212 AC 2 future stale: a future day, stale-stamped, still makes one MLB request", async () =>
	{
		const { deps, calls } = await storedDayOn("2026-11-20", "2026-11-20T23:00:00.000Z", true);
		await getOrRefreshSchedule(deps, "2026-11-20");
		expect(calls).toEqual(["fetchSchedule 2026-11-20"]);
	});

	it("S212 AC 2 unfinished stale: a past day holding a suspended game that hasn't moved, stale-stamped, still makes one MLB request", async () =>
	{
		const {
			deps, gamePks, calls,
		} = await pastDayCounting();
		const row = (await deps.gameStates.getByPk(gamePks[0]!))!;
		await deps.gameStates.write([{
			...row,
			state: {
				...row.state,
				status: {
					abstractGameState: "Live",
					codedGameState: "U",
					detailedState: "Suspended: Rain",
				},
				version: row.state.version + 1,
			},
		}]);
		// The game first: the day's refresh may write the schedule's final state over the suspended one.
		await getOrRefreshGame(deps, gamePks[0]!);
		// S101 review: a final game stored without uniforms has them asked by each write that refreshes it (`askedExtraDue`).
		expect(calls).toEqual([`fetchGame ${gamePks[0]!}`, `fetchGameUniforms ${gamePks[0]!}`, `fetchGameRuleSettings ${gamePks[0]!}`]);
		await deps.gameStates.write([{
			...row,
			state: {
				...row.state,
				status: {
					abstractGameState: "Live",
					codedGameState: "U",
					detailedState: "Suspended: Rain",
				},
				version: row.state.version + 10,
			},
		}]);
		await getOrRefreshSchedule(deps, PAST_DATE);
		expect(calls).toEqual([`fetchGame ${gamePks[0]!}`, `fetchGameUniforms ${gamePks[0]!}`, `fetchGameRuleSettings ${gamePks[0]!}`, `fetchSchedule ${PAST_DATE}`]);
	});

	it("S212 AC 2 force: ?refresh=1 still asks MLB for a past, finished day and game", async () =>
	{
		const {
			deps, gamePks, calls,
		} = await pastDayCounting();
		await getOrRefreshSchedule(deps, PAST_DATE, {
			force: true,
		});
		await getOrRefreshGame(deps, gamePks[0]!, {
			force: true,
		});
		expect(calls).toEqual([`fetchSchedule ${PAST_DATE}`, `fetchGame ${gamePks[0]!}`, `fetchGameUniforms ${gamePks[0]!}`, `fetchGameRuleSettings ${gamePks[0]!}`]);
	});
});
