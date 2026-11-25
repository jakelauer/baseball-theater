/**
 * S216: an on-read refresh answers from the data it formed, reads a day's games in one batch, and writes what carries no
 * version of its answer after the response. Every count is taken through the counting repository double
 * (`countingDeps`), with the memory purger and an origin composed (`memoryDeps`), on the 15-game past day 2021-06-15
 * (`fifteenGameMlb`), and the deferred work flushed only where a test says so (`RecordedBackgroundWork`).
 *
 * The same counts on HEAD ea39e6ea (after S212), before S216 (the red-first run): a cold 15-game digest made 144 round
 * trips, a cold game 9, a cold day 24, a stored, fresh digest 32.
 */
import type { GameSnapshot, StoredScheduleDay } from "@bt/domain";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { RecordedBackgroundWork } from "../adapters/background-work.js";
import { countingDeps } from "../test/counting-repos.js";
import {
	FIFTEEN_GAME_DATE, FIFTEEN_GAME_PKS, fifteenGameDay, fifteenGameMlb,
} from "../test/fifteen-game-day.js";
import {
	memoryDeps, NOW, ORIGIN,
} from "../test/past-data.js";
import { getDayDigest } from "./digest.js";
import { readScheduleDay, readServedGame } from "./game-state.js";
import { getOrRefreshGame, getScheduleRead } from "./ingest.js";

const PK = FIFTEEN_GAME_PKS[0]!;

/** Fresh stores with the recorded background double, and the same stores counted. */
function cold(mlb = fifteenGameMlb())
{
	const stores = memoryDeps(mlb);
	const background = new RecordedBackgroundWork();
	stores.background = background;
	const { deps, log } = countingDeps(stores);
	return {
		stores,
		background,
		deps,
		log,
	};
}

/** How many calls of `name` (`<repo>.<method>`) the log holds. */
function callsOf(names: string[], name: string): number
{
	return names.filter((call) => call === name).length;
}

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("S216 AC 4: the round-trip bound", () =>
{
	it("S216 AC 4 cold digest: at most 7 round trips before its answer and 9 in all", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		await getDayDigest(deps, FIFTEEN_GAME_DATE);
		const before = log.count;
		expect(before).toBeLessThanOrEqual(7);
		await background.flush();
		const total = log.count;
		expect(total).toBeLessThanOrEqual(9);
	});

	it("S216 AC 4 cold game: at most 4 round trips before its answer and 6 in all", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		await getOrRefreshGame(deps, PK);
		const before = log.count;
		expect(before).toBeLessThanOrEqual(4);
		await background.flush();
		const total = log.count;
		expect(total).toBeLessThanOrEqual(6);
	});

	it("S216 AC 4 cold day: at most 4 round trips before its answer and 5 in all", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		await getScheduleRead(deps, FIFTEEN_GAME_DATE);
		const before = log.count;
		expect(before).toBeLessThanOrEqual(4);
		await background.flush();
		const total = log.count;
		expect(total).toBeLessThanOrEqual(5);
	});

	it("S216 AC 4 stored fresh digest: at most 4 round trips", async () =>
	{
		const { stores, background } = cold();
		await getDayDigest(stores, FIFTEEN_GAME_DATE);
		await background.flush();
		const { deps, log } = countingDeps(stores);
		await getDayDigest(deps, FIFTEEN_GAME_DATE);
		await background.flush();
		const stored = log.count;
		expect(stored).toBeLessThanOrEqual(4);
	});
});

describe("S216 AC 1: answer from the data formed", () =>
{
	it("S216 AC 1 cold game no read-back: no read of what it wrote, no second read of a key", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		expect(await getOrRefreshGame(deps, PK)).not.toBeNull();
		await background.flush();
		expect(log.violations).toEqual([]);
	});

	it("S216 AC 1 cold day no read-back: no read of what it wrote, no second read of a key", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		expect((await getScheduleRead(deps, FIFTEEN_GAME_DATE)).day.games).toHaveLength(15);
		await background.flush();
		expect(log.violations).toEqual([]);
	});

	it("S216 AC 1 cold digest no read-back: no read of what it wrote, no second read of a key", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		expect((await getDayDigest(deps, FIFTEEN_GAME_DATE)).digest.items.length).toBeGreaterThan(0);
		await background.flush();
		expect(log.violations).toEqual([]);
	});

	it("S216 AC 1 answers equal a fresh read: game, day and digest, field for field, once the deferred writes flush", async () =>
	{
		const game = cold();
		const answered = await getOrRefreshGame(game.deps, PK);
		await game.background.flush();
		expect(answered).toEqual(await readServedGame(game.stores, PK, NOW));

		const day = cold();
		const read = await getScheduleRead(day.deps, FIFTEEN_GAME_DATE);
		await day.background.flush();
		expect(read.day).toEqual(await readScheduleDay(day.stores, FIFTEEN_GAME_DATE, NOW));
		expect(read.pastFinished).toBe(true);

		const digest = cold();
		const first = await getDayDigest(digest.deps, FIFTEEN_GAME_DATE);
		await digest.background.flush();
		expect(first).toEqual(await getDayDigest(digest.stores, FIFTEEN_GAME_DATE));
		// Every game's answered version is the one the store holds.
		for (const gamePk of FIFTEEN_GAME_PKS) expect((await digest.stores.games.getByPk(gamePk))?.version).toBe(1);
	});

	it("S216 AC 1 dropped game served base: a refresh whose listing drops a game answers the version a fresh read returns", async () =>
	{
		const full = await fifteenGameDay();
		let listing = full;
		const mlb = fifteenGameMlb();
		mlb.fetchSchedule = async () => listing;
		const { stores, background } = cold(mlb);
		await getScheduleRead(stores, FIFTEEN_GAME_DATE);
		await background.flush();
		const before = await readScheduleDay(stores, FIFTEEN_GAME_DATE, NOW);
		listing = {
			...full,
			games: full.games.slice(1),
		};
		// A later isolate: no cooldown left from the first refresh.
		delete stores.refresh;
		const { deps } = countingDeps(stores);
		const refreshed = await getScheduleRead(deps, FIFTEEN_GAME_DATE, {
			force: true,
		});
		await background.flush();
		const fresh = await readScheduleDay(stores, FIFTEEN_GAME_DATE, NOW);
		expect(refreshed.day.games).toHaveLength(14);
		expect(refreshed.day.version).toBe(fresh?.version);
		expect(refreshed.day).toEqual(fresh);
		// The dropped game's state version went into the served base, so the served version didn't fall.
		expect(refreshed.day.version).toBeGreaterThan(before!.version);
	});

	it("S216 AC 1 refused game write answers the stored version: another writer's newer snapshot, seeded between the read and the write", async () =>
	{
		const {
			stores, deps, log, background,
		} = cold();
		let seeded: GameSnapshot | null = null;
		log.beforeWrite = async (call) =>
		{
			if (call.repo !== "games" || seeded) return;
			const { game } = await fifteenGameMlb().fetchGame(PK);
			seeded = {
				...game,
				highlights: [],
				fetchedAt: NOW.toISOString(),
				windowMode: "cache",
				version: 7,
				lastChangedAt: NOW.toISOString(),
			};
			await stores.games.upsert(seeded);
		};
		const answered = await getOrRefreshGame(deps, PK);
		expect(seeded).not.toBeNull();
		expect(answered?.version).toBe(7);
		expect(answered?.highlights).toEqual([]);
		await background.flush();
		expect(answered).toEqual(await readServedGame(stores, PK, NOW));
		// The refused write's projection is not written over the other writer's (it wrote its own).
		expect((await stores.projections.getByPk(PK))?.header.version ?? 0).not.toBe(1);
	});

	it("S216 AC 1 refused day write answers the stored version: another writer's newer day, seeded between the read and the write", async () =>
	{
		const {
			stores, deps, log, background,
		} = cold();
		let seeded: StoredScheduleDay | null = null;
		log.beforeWrite = async (call) =>
		{
			if (call.repo !== "schedules" || seeded) return;
			const day = await fifteenGameDay();
			seeded = {
				date: day.date,
				fetchedAt: NOW.toISOString(),
				windowMode: "cache",
				games: day.games.slice(0, 3).map(({
					status: _status, linescore: _linescore, live: _live, ...game
				}) => game),
				version: 9,
				lastChangedAt: NOW.toISOString(),
			};
			await stores.schedules.upsert(seeded);
		};
		const read = await getScheduleRead(deps, FIFTEEN_GAME_DATE);
		expect(seeded).not.toBeNull();
		expect(read.day.games).toHaveLength(3);
		await background.flush();
		expect(read.day).toEqual(await readScheduleDay(stores, FIFTEEN_GAME_DATE, NOW));
	});
});

describe("S216 AC 2: one batched read per day", () =>
{
	it("S216 AC 2 one games.getMany and one gameStates.getMany for a cold digest's games, never one a game", async () =>
	{
		const {
			deps, log, background,
		} = cold();
		await getDayDigest(deps, FIFTEEN_GAME_DATE);
		await background.flush();
		const names = log.names();
		expect(callsOf(names, "games.getMany")).toBe(1);
		expect(callsOf(names, "gameStates.getMany")).toBe(1);
		expect(callsOf(names, "games.getByPk")).toBe(0);
		expect(callsOf(names, "gameStates.getByPk")).toBe(0);
		expect(callsOf(names, "games.upsertMany")).toBe(1);
		expect(callsOf(names, "projections.upsertMany")).toBe(1);
		const write = log.calls.find((call) => call.method === "upsertMany" && call.repo === "games");
		expect(write?.keys).toHaveLength(15);
	});
});

describe("S216 AC 3: writes that don't change the answer run after it", () =>
{
	it("S216 AC 3 answer complete before the flush: state row and snapshot stored at its version, no projection or purge yet", async () =>
	{
		const {
			stores, deps, background,
		} = cold();
		const answered = await getOrRefreshGame(deps, PK);
		expect(answered?.status.codedGameState).toBe("F");
		expect(background.pending.length).toBeGreaterThan(0);
		expect((await stores.games.getByPk(PK))?.version).toBe(answered?.version);
		expect((await stores.gameStates.getByPk(PK))?.state.status.codedGameState).toBe("F");
		expect(await stores.projections.getByPk(PK)).toBeNull();
		expect(stores.purger.calls).toEqual([]);
		await background.flush();
		expect((await stores.projections.getByPk(PK))?.header.version).toBe(answered?.version);
		expect(stores.purger.purged).toContain(`${ORIGIN}/api/v1/games/${PK}`);
	});

	it("S216 AC 3 refused deferred write logged: a newer stored projection is kept, the refusal logged", async () =>
	{
		const {
			stores, deps, background,
		} = cold();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const answered = await getOrRefreshGame(deps, PK);
		const { projectGame } = await import("@bt/domain");
		const newer = projectGame({
			...answered!,
			version: 5,
		});
		await stores.projections.upsert(newer);
		await background.flush();
		expect((await stores.projections.getByPk(PK))?.header.version).toBe(5);
		expect(warn.mock.calls.some((args) => String(args[0]).includes("refused by a newer stored version"))).toBe(true);
	});

	it("S216 AC 3 failed deferred write never fails the request: the answer stands and the failure is logged", async () =>
	{
		const {
			stores, deps, background,
		} = cold();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		stores.projections.upsertMany = async () =>
		{
			throw new Error("database down");
		};
		const answered = await getOrRefreshGame(deps, PK);
		expect(answered?.gamePk).toBe(PK);
		await expect(background.flush()).resolves.toBeUndefined();
		expect(error.mock.calls.some((args) => String(args[0]).includes("on-read refresh writes failed"))).toBe(true);
	});

	it("S216 AC 3 one deferred purge: a cold digest's games and day go to the purger in one request, after one listing read", async () =>
	{
		const {
			stores, deps, log, background,
		} = cold();
		await getDayDigest(deps, FIFTEEN_GAME_DATE);
		expect(stores.purger.calls).toEqual([]);
		await background.flush();
		expect(stores.purger.calls).toHaveLength(1);
		expect(callsOf(log.names(), "schedules.listGameListings")).toBe(1);
		const urls = stores.purger.calls[0]!;
		for (const gamePk of FIFTEEN_GAME_PKS) expect(urls).toContain(`${ORIGIN}/api/v1/games/${gamePk}`);
		expect(urls).toContain(`${ORIGIN}/api/v1/digest?date=${FIFTEEN_GAME_DATE}`);
	});
});

describe("S216 read paths' edges", () =>
{
	it("S216 a day with no games: its digest reads no game and writes no game", async () =>
	{
		const mlb = fifteenGameMlb();
		const empty = await fifteenGameDay();
		mlb.fetchSchedule = async () => ({
			...empty,
			games: [],
		});
		const {
			deps, log, background,
		} = cold(mlb);
		const { digest } = await getDayDigest(deps, FIFTEEN_GAME_DATE);
		await background.flush();
		expect(digest.items).toEqual([]);
		expect(log.names().filter((name) => name.startsWith("games."))).toEqual([]);
	});

	it("S216 a game MLB can't answer: nothing stored is null, a stored one is served as stored", async () =>
	{
		const mlb = fifteenGameMlb();
		const { stores, background } = cold(mlb);
		await getOrRefreshGame(stores, PK);
		await background.flush();
		mlb.fetchGame = async () =>
		{
			throw new Error("MLB down");
		};
		delete stores.refresh;
		expect(await getOrRefreshGame(stores, FIFTEEN_GAME_PKS[1]!)).toBeNull();
		expect((await getOrRefreshGame(stores, PK, {
			force: true,
		}))?.version).toBe(1);
	});

	it("S216 a game in its refresh cooldown: another request's stored copy is read, none is null", async () =>
	{
		const { stores, background } = cold();
		await getOrRefreshGame(stores, PK);
		await background.flush();
		// The coordinator just refreshed this game in this isolate: a forced read in the cooldown serves what is stored.
		expect((await getOrRefreshGame(stores, PK, {
			force: true,
		}))?.version).toBe(1);
		const other = FIFTEEN_GAME_PKS[2]!;
		await stores.refresh!.run(`game:${other}`, async () => undefined);
		expect(await getOrRefreshGame(stores, other)).toBeNull();
	});
});
