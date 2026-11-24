/**
 * Shared set-up for S212's tests: an MLB client that counts every request, and the 2024-07-04 fixture day stored as a
 * past, finished day (every game final, out of its window), its rows stamped long ago so any ladder lifetime has run out.
 */
import type {
	GameSnapshot, ScheduleDay, Unversioned,
} from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { MemoryEdgeCachePurger } from "../adapters/memory/edge-cache-purger.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryGameStateRepository, InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import type { IngestDeps } from "../services/ingest.js";
import { ingestGame, storeSchedule } from "../services/ingest.js";
import { RefreshCoordinator } from "../services/refresh.js";

/** The fixture day every S212 test stores. */
export const PAST_DATE = "2024-07-04";
/** When the rows were stored: long before {@link NOW}, so every ladder lifetime has run out. */
export const LONG_AGO = "2024-07-05T06:00:00.000Z";
/** The tests' clock: MLB's today is 2026-11-15. */
export const NOW = new Date("2026-11-15T12:00:00Z");
/** The origin the purge URLs are built from. */
export const ORIGIN = "https://stage.baseball.theater";

const FINAL = {
	abstractGameState: "Final",
	codedGameState: "F",
	detailedState: "Final",
};

/** `mlb` with every method call recorded as `<method> <args>`, so a test can say exactly what was asked. */
export function countingMlb(mlb: MlbStatsClient = new FixtureMlbStatsClient()): { client: MlbStatsClient;
	calls: string[]; }
{
	const calls: string[] = [];
	const client = new Proxy(mlb, {
		get(target, key, receiver)
		{
			const value = Reflect.get(target, key, receiver) as unknown;
			if (typeof value !== "function") return value;
			return (...args: unknown[]) =>
			{
				calls.push(`${String(key)} ${args.join(",")}`);
				return (value as (...a: unknown[]) => unknown).apply(target, args);
			};
		},
	});
	return {
		client,
		calls,
	};
}

/** Fresh memory stores (the game store reading the state rows, as Postgres joins them), a memory purger and a clock. */
export function memoryDeps(mlb: MlbStatsClient = new FixtureMlbStatsClient()): IngestDeps & { purger: MemoryEdgeCachePurger }
{
	const gameStates = new InMemoryGameStateRepository();
	const purger = new MemoryEdgeCachePurger();
	return {
		mlb,
		schedules: new InMemoryScheduleRepository(gameStates),
		games: new InMemoryGameRepository(gameStates),
		projections: new InMemoryGameProjectionRepository(),
		gameStates,
		now: () => NOW,
		refresh: new RefreshCoordinator(() => NOW),
		edgePurge: {
			purger,
			origin: ORIGIN,
		},
		purger,
	};
}

/**
 * A fixture day with every game final, re-dated to `date` (its games' official dates too), each game's first pitch
 * `startTime` when given, so a day on or after MLB's today can be placed out of its window.
 */
export async function finalDay(date = PAST_DATE, startTime?: string): Promise<Unversioned<ScheduleDay>>
{
	const day = await new FixtureMlbStatsClient().fetchSchedule(PAST_DATE);
	return {
		...day,
		date,
		games: day.games.map((game) => ({
			...game,
			officialDate: date,
			status: FINAL,
			...startTime !== undefined && {
				startTime,
			},
		})),
	};
}

/** A fixture game, final, re-dated to `date`. */
export async function finalGame(gamePk: number, date = PAST_DATE): Promise<{ game: Unversioned<GameSnapshot>;
	feedTime?: string; }>
{
	const fetched = await new FixtureMlbStatsClient().fetchGame(gamePk);
	return {
		...fetched,
		game: {
			...fetched.game,
			officialDate: date,
			status: FINAL,
		},
	};
}

/**
 * Stores `date`'s final day and each of its games that has a fixture (final, `cache`), all stamped {@link LONG_AGO},
 * through the writers every path uses, then clears what the purger recorded. Returns the stored gamePks.
 */
export async function storePastDay(deps: IngestDeps & { purger: MemoryEdgeCachePurger }, date = PAST_DATE): Promise<number[]>
{
	const day = await finalDay(date);
	const stored: number[] = [];
	for (const summary of day.games)
	{
		const fetched = await finalGame(summary.gamePk, date).catch(() => null);
		if (!fetched) continue;
		await ingestGame(deps, {
			...fetched.game,
			fetchedAt: LONG_AGO,
			windowMode: "cache",
		});
		stored.push(summary.gamePk);
	}
	await storeSchedule(deps, {
		...day,
		fetchedAt: LONG_AGO,
		windowMode: "cache",
	});
	deps.purger.calls.length = 0;
	return stored;
}
