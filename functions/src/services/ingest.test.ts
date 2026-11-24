import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryGameStateRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { GameSnapshot, Unversioned } from "@bt/domain";
import {
	getOrRefreshGame, getOrRefreshSchedule, ingestGame, ingestScheduleDay, refreshTodaysWindow, storeSchedule,
} from "./ingest.js";
import { RefreshCoordinator } from "./refresh.js";

describe("ingest with fixtures", () =>
{
	it("loads schedule and games into memory", async () =>
	{
		const { schedules, gameStates } = memoryScheduleStores();
		const games = new InMemoryGameRepository();
		const projections = new InMemoryGameProjectionRepository();
		const mlb = new FixtureMlbStatsClient();
		const day = await ingestScheduleDay(
			{
				mlb,
				schedules,
				games,
				projections,
				gameStates,
			},
			"2024-07-04",
		);
		expect(day.games.length).toBe(2);
		expect(await schedules.getByDate("2024-07-04")).not.toBeNull();
		const game = await getOrRefreshGame({
			mlb,
			schedules,
			games,
			projections,
			gameStates,
		}, 744834);
		expect(game?.teams.home.abbreviation).toBe("WSH");
		expect(game?.highlights[0]?.title.toLowerCase()).toContain("walk-off");
	});
});

describe("ingest versioning (ADR-022)", () =>
{
	/** A fixture client whose game 744834 can be edited between polls. */
	class EditableClient extends FixtureMlbStatsClient
	{
		detailedState: string | null = null;

		override async fetchGame(gamePk: number)
		{
			const { game } = await super.fetchGame(gamePk);
			return this.detailedState === null ? {
				game,
			} : {
				game: {
					...game,
					status: {
						...game.status,
						detailedState: this.detailedState,
					},
				},
			};
		}
	}

	it("keeps the version when the same fixture is ingested twice, and bumps it on a changed payload", async () =>
	{
		const mlb = new EditableClient();
		const games = new InMemoryGameRepository();
		const projections = new InMemoryGameProjectionRepository();
		let clock = new Date("2024-07-05T12:00:00.000Z");
		const deps = {
			mlb,
			...memoryScheduleStores(),
			games,
			projections,
			now: () => clock,
		};

		const first = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(first?.version).toBe(1);
		expect(first?.lastChangedAt).toBe("2024-07-05T12:00:00.000Z");

		clock = new Date("2024-07-05T12:10:00.000Z");
		const same = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(same?.version).toBe(1);
		expect(same?.lastChangedAt).toBe("2024-07-05T12:00:00.000Z");
		expect((await games.getByPk(744834))?.version).toBe(1);

		mlb.detailedState = "Final: revised";
		clock = new Date("2024-07-05T12:20:00.000Z");
		const changed = await getOrRefreshGame(deps, 744834, {
			force: true,
		});
		expect(changed?.version).toBe(2);
		expect(changed?.lastChangedAt).toBe("2024-07-05T12:20:00.000Z");
		expect((await games.getByPk(744834))?.status.detailedState).toBe("Final: revised");
		expect((await projections.getByPk(744834))?.header.version).toBe(2);
	});

	it("keeps a schedule day's version across identical re-ingests", async () =>
	{
		const { schedules, gameStates } = memoryScheduleStores();
		const deps = {
			mlb: new FixtureMlbStatsClient(),
			schedules,
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			gameStates,
			now: () => new Date("2024-07-05T12:00:00.000Z"),
		};
		const first = await ingestScheduleDay(deps, "2024-07-04");
		const again = await ingestScheduleDay({
			...deps,
			now: () => new Date("2024-07-05T12:30:00.000Z"),
		}, "2024-07-04");
		// The served version (S150 AC 6) adds the games' state versions; it stays put when nothing changed.
		expect(again.version).toBe(first.version);
		expect((await schedules.getByDate("2024-07-04"))?.version).toBe(1);
	});
});

describe("refresh-on-read cache lifetime (S47, ADR-021)", () =>
{
	it("lifetime: each unchanged check earns a longer wait before MLB is asked again, up the ladder", async () =>
	{
		const MINUTE = 60_000;
		const real = new FixtureMlbStatsClient();
		let calls = 0;
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchGame = async (pk: number) =>
		{
			calls += 1;
			return real.fetchGame(pk);
		};
		let clock = new Date("2026-10-30T12:00:00Z");
		const deps = {
			mlb,
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			refresh: new RefreshCoordinator(() => clock, 0),
			now: () => clock,
		};
		const at = async (minutes: number) =>
		{
			clock = new Date(Date.parse("2026-10-30T12:00:00Z") + minutes * MINUTE);
			await getOrRefreshGame(deps, 823823);
			return calls;
		};
		// Stored at 0 (changed then): the floor, 5 minutes.
		expect(await at(0)).toBe(1);
		expect(await at(4)).toBe(1);
		// Checked at 5 (5m unchanged: still the floor), then at 10 (10m unchanged: 15m earned).
		expect(await at(5)).toBe(2);
		expect(await at(10)).toBe(3);
		expect(await at(24)).toBe(3);
		// Checked at 25 (25m unchanged: 30m earned), so 54 is served from the store and 55 asks again.
		expect(await at(25)).toBe(4);
		expect(await at(54)).toBe(4);
		expect(await at(55)).toBe(5);
		// 55m unchanged earned 2h: nothing until 175.
		expect(await at(174)).toBe(5);
		expect(await at(175)).toBe(6);
	});
});

describe("which games ingest fetches (S48 AC 8, ADR-025)", () =>
{
	it("game-over: out of its window, a game-over (O) game is fetched like a final (F) one, and a scheduled (S) one is not", async () =>
	{
		const fetchedFor = async (codedGameState: string) =>
		{
			const real = new FixtureMlbStatsClient();
			const mlb = new FixtureMlbStatsClient();
			const day = await real.fetchSchedule("2024-07-04");
			mlb.fetchSchedule = async () => ({
				...day,
				games: day.games.filter((g) => g.gamePk === 744834).map((g) => ({
					...g,
					status: {
						...g.status,
						codedGameState,
					},
				})),
			});
			const pks: number[] = [];
			mlb.fetchGame = async (pk: number) =>
			{
				pks.push(pk);
				return real.fetchGame(pk);
			};
			// Two years on, the day is far outside every window.
			await ingestScheduleDay({
				mlb,
				...memoryScheduleStores(),
				games: new InMemoryGameRepository(),
				projections: new InMemoryGameProjectionRepository(),
				now: () => new Date("2026-10-30T12:00:00Z"),
			}, "2024-07-04");
			return pks;
		};
		expect(await fetchedFor("F")).toEqual([744834]);
		expect(await fetchedFor("O")).toEqual([744834]);
		expect(await fetchedFor("S")).toEqual([]);
	});
});

describe("ingest skips a settled day before S167's game types (S167 AC 4)", () =>
{
	it("S167 AC 4 ingest: a settled stored day before today whose games have no gameType is still skipped, asking MLB only for today", async () =>
	{
		const real = new FixtureMlbStatsClient();
		const stored = await real.fetchSchedule("2024-07-04");
		const { schedules, gameStates } = memoryScheduleStores();
		// The day as stored before S167: settled (every game final), cached, and no game carries a gameType.
		await schedules.upsert({
			...stored,
			games: stored.games.map(({ gameType: _dropped, ...game }) => ({
				...game,
				status: {
					abstractGameState: "Final",
					codedGameState: "F",
					detailedState: "Final",
				},
			})),
			fetchedAt: "2024-07-05T06:00:00.000Z",
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2024-07-05T06:00:00.000Z",
		});
		// Each game's final state, as the S150 migration fills it from such a day.
		for (const game of stored.games)
		{
			await gameStates.write([{
				gamePk: game.gamePk,
				source: "schedule",
				feedTime: null,
				officialDate: game.officialDate,
				startTime: game.startTime ?? null,
				state: {
					status: {
						abstractGameState: "Final",
						codedGameState: "F",
						detailedState: "Final",
					},
					linescore: game.linescore,
					live: null,
					version: 1,
					lastChangedAt: "2024-07-05T06:00:00.000Z",
				},
			}]);
		}
		const asked: string[] = [];
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchSchedule = async (date: string) =>
		{
			asked.push(date);
			return {
				date,
				games: [],
				fetchedAt: "2024-07-05T17:00:00.000Z",
				windowMode: "cache",
			};
		};
		await refreshTodaysWindow({
			mlb,
			schedules,
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			gameStates,
		}, new Date("2024-07-05T17:00:00.000Z"));
		expect(asked).toEqual(["2024-07-05"]);
		expect((await schedules.getByDate("2024-07-04"))!.games.every((game) => game.gameType === undefined)).toBe(true);
	});
});

/**
 * #79, #323: every game write stamps when BT saw the game turn suspended (`suspendedAt`), carries
 * it while the game stays suspended, and drops it when play resumes (owner, 2026-11-22: "From when
 * it was suspended (Recommended)").
 */
describe("a suspended game's stored suspension time (#79, #323)", () =>
{
	const IN_PROGRESS = {
		abstractGameState: "Live",
		codedGameState: "I",
		detailedState: "In Progress",
	};
	const SUSPENDED = {
		abstractGameState: "Live",
		codedGameState: "U",
		detailedState: "Suspended: Rain",
	};

	async function polls()
	{
		const base = (await new FixtureMlbStatsClient().fetchGame(745001)).game;
		const deps = {
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			gameStates: new InMemoryGameStateRepository(),
		};
		const poll = (status: typeof IN_PROGRESS, fetchedAt: string, windowMode: "active" | "cache" = "active") => ingestGame(deps, {
			...base,
			status,
			fetchedAt,
			windowMode,
		} as Unversioned<GameSnapshot>);
		return poll;
	}

	it("stamps the write that sees an actively polled game turn suspended, keeps it through later changes, and drops it on resume", async () =>
	{
		const poll = await polls();
		expect((await poll(IN_PROGRESS, "2026-07-05T05:09:30.000Z")).snapshot.suspendedAt).toBeUndefined();
		const flipped = (await poll(SUSPENDED, "2026-07-05T05:10:00.000Z")).snapshot;
		expect(flipped.suspendedAt).toBe("2026-07-05T05:10:00.000Z");
		expect(flipped.suspendedAt).toBe(flipped.lastChangedAt);
		const unchanged = await poll(SUSPENDED, "2026-07-05T05:10:30.000Z");
		expect(unchanged.changed).toBe(false);
		expect(unchanged.snapshot.version).toBe(flipped.version);
		const later = (await poll({
			...SUSPENDED,
			codedGameState: "T",
			detailedState: "Suspended",
		}, "2026-07-05T08:00:00.000Z")).snapshot;
		expect(later.version).toBe(flipped.version + 1);
		expect(later.suspendedAt).toBe("2026-07-05T05:10:00.000Z");
		const resumed = (await poll(IN_PROGRESS, "2026-07-06T20:00:00.000Z")).snapshot;
		expect(resumed.suspendedAt).toBeUndefined();
		expect("suspendedAt" in resumed).toBe(false);
	});

	it("leaves no time when BT didn't see the change: first stored already suspended, or flipped from a cached copy", async () =>
	{
		const first = await polls();
		expect((await first(SUSPENDED, "2026-07-05T05:10:00.000Z")).snapshot.suspendedAt).toBeUndefined();
		const cached = await polls();
		await cached(IN_PROGRESS, "2026-07-05T05:09:30.000Z", "cache");
		expect((await cached(SUSPENDED, "2026-07-05T05:10:00.000Z")).snapshot.suspendedAt).toBeUndefined();
	});

	it("a later day listing the game to resume (07-07) is judged by the clock alone: stored cache, and the game isn't fetched", async () =>
	{
		const real = new FixtureMlbStatsClient();
		const recorded = await real.fetchSchedule("2024-07-04");
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchSchedule = async () => ({
			...recorded,
			date: "2026-07-07",
			games: recorded.games.filter((g) => g.gamePk === 745001).map((g) => ({
				...g,
				officialDate: "2026-07-07",
				gameDate: "2026-07-07T17:00:00Z",
				startTime: "2026-07-07T17:00:00Z",
				status: SUSPENDED,
			})),
		});
		const fetched: number[] = [];
		mlb.fetchGame = async (pk: number) =>
		{
			fetched.push(pk);
			return real.fetchGame(pk);
		};
		const games = new InMemoryGameRepository();
		await games.upsert({
			...(await real.fetchGame(745001)).game,
			startTime: "2026-07-04T23:05:00Z",
			status: SUSPENDED,
			windowMode: "active",
			suspendedAt: "2026-07-05T05:10:00.000Z",
			version: 3,
			lastChangedAt: "2026-07-05T05:10:00.000Z",
		});
		const day = await ingestScheduleDay({
			mlb,
			...memoryScheduleStores(),
			games,
			projections: new InMemoryGameProjectionRepository(),
			now: () => new Date("2026-07-05T06:00:00Z"),
		}, "2026-07-07");
		expect(day.windowMode).toBe("cache");
		expect(fetched).toEqual([]);
	});

	it("ingestScheduleDay fetches and stores a game suspended at 06:00Z at 07:00Z, past first pitch + 6h", async () =>
	{
		const real = new FixtureMlbStatsClient();
		const recorded = await real.fetchSchedule("2024-07-04");
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchSchedule = async () => ({
			...recorded,
			date: "2026-07-04",
			games: recorded.games.filter((g) => g.gamePk === 745001).map((g) => ({
				...g,
				officialDate: "2026-07-04",
				gameDate: "2026-07-04T23:05:00Z",
				startTime: "2026-07-04T23:05:00Z",
				status: SUSPENDED,
			})),
		});
		const fetched: number[] = [];
		mlb.fetchGame = async (pk: number) =>
		{
			fetched.push(pk);
			return {
				game: {
					...(await real.fetchGame(pk)).game,
					startTime: "2026-07-04T23:05:00Z",
					status: SUSPENDED,
				},
			};
		};
		const games = new InMemoryGameRepository();
		const game = (await real.fetchGame(745001)).game;
		await games.upsert({
			...game,
			startTime: "2026-07-04T23:05:00Z",
			status: SUSPENDED,
			windowMode: "active",
			suspendedAt: "2026-07-05T06:00:00.000Z",
			version: 3,
			lastChangedAt: "2026-07-05T06:00:00.000Z",
		});
		const day = await ingestScheduleDay({
			mlb,
			...memoryScheduleStores(),
			games,
			projections: new InMemoryGameProjectionRepository(),
			now: () => new Date("2026-07-05T07:00:00Z"),
		}, "2026-07-04");
		expect(fetched).toEqual([745001]);
		expect(day.windowMode).toBe("active");
		expect((await games.getByPk(745001))?.suspendedAt).toBe("2026-07-05T06:00:00.000Z");
	});
});

describe("the day read refreshes the schedule, not each game (#419)", () =>
{
	it("B419: a stale stored past day of 15 final games is refreshed with one schedule request and no game feeds (#419)", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		const asked: string[] = [];
		const mlb = Object.assign(Object.create(fixture) as FixtureMlbStatsClient, {
			fetchSchedule: async (date: string) =>
			{
				asked.push(`schedule ${date}`);
				return fixture.fetchSchedule(date);
			},
			fetchGame: async (gamePk: number) =>
			{
				asked.push(`game ${gamePk}`);
				return fixture.fetchGame(gamePk);
			},
		});
		const { schedules, gameStates } = memoryScheduleStores();
		const deps = {
			mlb,
			schedules,
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			gameStates,
			now: () => new Date("2026-11-24T12:00:00.000Z"),
			refresh: new RefreshCoordinator(() => new Date("2026-11-24T12:00:00.000Z")),
		};
		// Stored as the month fill leaves a day (S124): its schedule only, last checked days ago, so it is stale.
		await storeSchedule(deps, {
			...await fixture.fetchSchedule("2026-09-05"),
			fetchedAt: "2026-11-20T12:00:00.000Z",
			windowMode: "cache",
		});
		const day = await getOrRefreshSchedule(deps, "2026-09-05");
		expect(day.games).toHaveLength(15);
		expect(asked).toEqual(["schedule 2026-09-05"]);
	});
});
