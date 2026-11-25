/**
 * S149 AC 2: which day hubs the writers call. A schedule write (every `storeSchedule` caller: the cron's refresh, the
 * month fill, backfill's day writes) calls the hub of each date it changed whose day has a game in its live window
 * before or after the write, once per refresh or fill; a game's ingest publishes a mend (a changed row under an
 * unchanged snapshot) to its registered hubs, a day hub among them. Memory stores and a fixed clock.
 */
import type {
	ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import { addDays, mlbToday } from "@bt/domain";
import {
	beforeAll, describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { MemoryEdgeCachePurger } from "../adapters/memory/edge-cache-purger.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { GameFactory } from "../test/day-games.js";
import { gameFactory } from "../test/day-games.js";
import { finalDay } from "../test/past-data.js";
import {
	DayHubCalls, dayHubName, dayHubNotifier,
} from "./day-hubs.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import { GameIngest } from "./game-ingest.js";
import { switchGameState } from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import { refreshTodaysWindow, storeSchedule } from "./ingest.js";
import { fillScheduleMonth } from "./schedule-month.js";

const NOON = new Date("2026-07-15T16:00:00Z");
const DATE = mlbToday(NOON);
const NEXT = addDays(DATE, 1);
const FAR = addDays(DATE, 10);
const PAST = "2024-07-04";

let game: GameFactory;

beforeAll(async () =>
{
	game = await gameFactory();
});

/** Memory stores at {@link NOON} with a recording day hub notifier. */
function setup(mlb = new FixtureMlbStatsClient())
{
	const calls: string[][] = [];
	const deps: IngestDeps = {
		mlb,
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		now: () => NOON,
		dayHubs: async (dates) =>
		{
			calls.push([...dates]);
		},
	};
	return {
		calls,
		deps,
	};
}

const day = (date: string, games: ScheduleGameSummary[], at = NOON): Unversioned<ScheduleDay> => ({
	date,
	games,
	fetchedAt: at.toISOString(),
	windowMode: "active",
});
const inAnHour = (date: string) => game(1, date, {
	startTime: new Date(NOON.getTime() + 60 * 60 * 1000).toISOString(),
});
const farGame = (gamePk: number, date: string) => game(gamePk, date, {
	startTime: `${date}T23:05:00Z`,
});

describe("day hub calls from schedule writes", () =>
{
	it("S149 AC 2 postponement reaches the hub: a refresh that postpones the day's only in-window game calls its day's hub, with no game update", async () =>
	{
		const { calls, deps } = setup();
		await storeSchedule(deps, day(DATE, [inAnHour(DATE)]));
		calls.length = 0;
		await storeSchedule(deps, day(DATE, [{
			...inAnHour(DATE),
			status: {
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed",
			},
		}], new Date(NOON.getTime() + 1000)));
		expect(calls).toEqual([[DATE]]);
		// Unchanged: no call.
		await storeSchedule(deps, day(DATE, [{
			...inAnHour(DATE),
			status: {
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed",
			},
		}], new Date(NOON.getTime() + 2000)));
		expect(calls).toEqual([[DATE]]);
	});

	it("S149 AC 2 month fill: a fill that changes an in-window day and a far day calls the in-window day's hub alone, once", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchScheduleRange = async () => [day(DATE, [inAnHour(DATE)]), day(NEXT, [farGame(2, NEXT)]), day(FAR, [farGame(3, FAR)])];
		const { calls, deps } = setup(mlb);
		await fillScheduleMonth(deps, DATE.slice(0, 7), [DATE, FAR], NOON);
		expect(calls).toEqual([[DATE]]);
	});

	it("S149 AC 2 month fill calls once: a fill that changes two in-window days calls both days' hubs in one call", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchScheduleRange = async () => [day(DATE, [inAnHour(DATE)]), day(NEXT, [{
			...inAnHour(NEXT),
			gamePk: 2,
		}]), day(FAR, [farGame(3, FAR)])];
		const { calls, deps } = setup(mlb);
		await fillScheduleMonth(deps, DATE.slice(0, 7), [DATE, FAR], NOON);
		expect(calls).toEqual([[DATE, NEXT]]);
	});

	it("the day as it was before a write is read once for both the edge purge's judge and the hub's, and a failed read reaches both", async () =>
	{
		const { calls, deps } = setup();
		const withPurge: IngestDeps = {
			...deps,
			edgePurge: {
				purger: new MemoryEdgeCachePurger(),
				origin: "https://stage.baseball.theater",
			},
		};
		await storeSchedule(withPurge, day(FAR, [farGame(3, FAR), farGame(4, FAR)]));
		const getMany = vi.spyOn(deps.gameStates, "getMany");
		// Game 4 dropped and game 3 moved: neither judge can decide from the day after the write alone.
		await storeSchedule(withPurge, day(FAR, [game(3, FAR, {
			startTime: `${FAR}T20:05:00Z`,
		})], new Date(NOON.getTime() + 1000)));
		expect(getMany.mock.calls.filter(([pks]) => pks.length === 1 && pks[0] === 4)).toHaveLength(1);
		expect(calls).toEqual([]);
		getMany.mockImplementation(async (pks) =>
		{
			if (pks.includes(3) && pks.length === 1) throw new Error("database gone");
			return [];
		});
		const purger = withPurge.edgePurge!.purger as MemoryEdgeCachePurger;
		purger.calls.length = 0;
		await expect(storeSchedule(withPurge, day(FAR, [game(5, FAR, {
			startTime: `${FAR}T20:05:00Z`,
		})], new Date(NOON.getTime() + 2000)))).rejects.toThrow(AggregateError);
		// The purge purges the day anyway; the hub check recorded its error and called nothing.
		expect(purger.calls.flat().some((url) => String(url).includes(FAR))).toBe(true);
		expect(calls).toEqual([]);
	});

	it("S149 AC 2 no game in its window calls no hub: a fill of far days and backfill's write of a past day call nothing", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchScheduleRange = async () => [day(NEXT, [farGame(2, NEXT)]), day(FAR, [farGame(3, FAR)])];
		const { calls, deps } = setup(mlb);
		await fillScheduleMonth(deps, DATE.slice(0, 7), [NEXT, FAR], NOON);
		// A far day changed again (its first pitch moved): out of its window before and after.
		await storeSchedule(deps, day(FAR, [game(3, FAR, {
			startTime: `${FAR}T20:05:00Z`,
		})], new Date(NOON.getTime() + 1000)));
		// Backfill's day write: a past day, every game final.
		await storeSchedule(deps, {
			...await finalDay(PAST),
			fetchedAt: NOON.toISOString(),
			windowMode: "cache",
		});
		expect(calls).toEqual([]);
	});

	it("S149 AC 2 once per refresh: the cron's refresh of today and the day before calls both days' hubs in one call after both writes", async () =>
	{
		const before = addDays(DATE, -1);
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchSchedule = async (date) => date === DATE ? day(DATE, [inAnHour(DATE)]) : day(before, [game(7, before, {
			startTime: `${before}T23:00:00Z`,
			live: true,
		})]);
		const { calls, deps } = setup(mlb);
		await refreshTodaysWindow(deps, NOON);
		expect(calls).toEqual([[before, DATE]]);
	});

	it("S149 AC 2 state change calls only the dates it names: a game moved to another day calls its old date's hub (in window) and not its new one's (out), nor any other day's", async () =>
	{
		const { calls, deps } = setup();
		await storeSchedule(deps, day(DATE, [game(1, DATE, {
			startTime: `${DATE}T15:00:00Z`,
			live: true,
		}), game(5, DATE, {
			startTime: `${DATE}T23:50:00Z`,
		})]));
		await storeSchedule(deps, day(FAR, [game(8, FAR, {
			startTime: `${FAR}T15:00:00Z`,
			live: true,
		})]));
		calls.length = 0;
		// Game 5 (out of its window, so the schedule's) moves to the next day.
		await storeSchedule(deps, day(NEXT, [game(5, NEXT, {
			startTime: `${NEXT}T23:50:00Z`,
		})], new Date(NOON.getTime() + 1000)));
		expect(calls).toEqual([[DATE]]);
	});

	it("DayHubCalls: no notifier or no dates calls nothing; a failing notifier is logged, not thrown", async () =>
	{
		const calls = new DayHubCalls();
		await calls.flush(undefined);
		const notify = vi.fn(async () => undefined);
		await calls.flush(notify);
		expect(notify).not.toHaveBeenCalled();
		calls.add(DATE);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await calls.flush(async () =>
		{
			throw new Error("down");
		});
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("dayHubNotifier posts to each date's day hub and rejects naming the ones that failed", async () =>
	{
		const posted: string[] = [];
		const namespace = (status: number) => ({
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					posted.push(`${String(id)} ${input}`);
					return new Response(null, {
						status,
					});
				},
			}),
		});
		await dayHubNotifier(namespace(204))([DATE]);
		expect(posted).toEqual([`${dayHubName(DATE)} https://day-hub/publish`]);
		await expect(dayHubNotifier(namespace(500))([DATE, NEXT])).rejects.toThrow(`${DATE}: 500; ${NEXT}: 500`);
		await expect(dayHubNotifier({
			idFromName: (name: string) => name,
			get: () => ({
				fetch: async () =>
				{
					throw new Error("gone");
				},
			}),
		})([DATE])).rejects.toThrow("gone");
	});
});

describe("ingest publishes a mend", () =>
{
	it("S149 AC 2 feed mend: a poll that changes the game's row but not its snapshot is published to a registered day hub", async () =>
	{
		const real = new FixtureMlbStatsClient();
		const { game: fixture } = await real.fetchGame(745001);
		let feedTime = "2026-07-15T16:00:00Z";
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchGame = async () => ({
			game: fixture,
			feedTime,
		});
		const { deps } = setup(mlb);
		const published: string[] = [];
		const ingest = new GameIngest(new FakeDurableStorage(), deps, async (hubId) =>
		{
			published.push(hubId);
		});
		await ingest.ensureRunning(745001, NOON);
		await ingest.hubs.register(dayHubName(fixture.officialDate), NOON);
		await ingest.alarm(NOON);
		expect(published).toEqual([dayHubName(fixture.officialDate)]);
		// An unchanged poll publishes nothing.
		feedTime = "2026-07-15T16:00:05Z";
		await ingest.alarm(new Date(NOON.getTime() + 5000));
		expect(published).toHaveLength(1);
		// Another writer moves the row on; the next poll of the same game mends it with no new snapshot.
		const row = (await deps.gameStates.getByPk(745001))!;
		await switchGameState(deps, [{
			gamePk: 745001,
			source: "feed",
			state: {
				status: row.state.status,
				linescore: row.state.linescore && {
					...row.state.linescore,
					teams: {
						...row.state.linescore.teams,
						home: {
							...row.state.linescore.teams.home,
							runs: (row.state.linescore.teams.home.runs ?? 0) + 7,
						},
					},
				},
				live: row.state.live,
			},
			officialDate: row.officialDate,
			startTime: row.startTime,
			feedTime: "2026-07-15T16:00:08Z",
		}], new Date(NOON.getTime() + 8000));
		const snapshot = await deps.games.getByPk(745001);
		feedTime = "2026-07-15T16:00:10Z";
		await ingest.alarm(new Date(NOON.getTime() + 10000));
		expect((await deps.games.getByPk(745001))?.version).toBe(snapshot?.version);
		expect(published).toHaveLength(2);
	});
});
