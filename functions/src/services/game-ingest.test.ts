/**
 * S48: one game's ingest (ADR-020 layer 1) — ensured once, polled by its alarm through
 * `MlbStatsClient`, written before it is published, and stopped with the final state once
 * the game leaves its window. Fixture 745001 is a game in progress, so it is always in
 * its window.
 */
import type {
	GameSnapshot, PlayerOfTheGame, ScheduleDay,
} from "@bt/domain";
import {
	DEFAULT_CADENCE, isGameInActiveWindow, stampVersion,
} from "@bt/domain";
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import {
	ensureIngestRunning, GameIngest, gameIngestName,
} from "./game-ingest.js";
import type { IngestDeps } from "./ingest.js";
import { refreshTodaysWindow } from "./ingest.js";

const T0 = new Date("2026-10-30T12:00:00Z");

/** Ingest deps over the fixtures, with `fetchGame` counted and optionally rewritten. */
function setup(rewrite: (game: Awaited<ReturnType<FixtureMlbStatsClient["fetchGame"]>>["game"]) => typeof game = (game) => game)
{
	const real = new FixtureMlbStatsClient();
	const mlb = new FixtureMlbStatsClient();
	const fetchGame = vi.fn(async (pk: number) => ({
		game: rewrite((await real.fetchGame(pk)).game),
	}));
	mlb.fetchGame = fetchGame;
	const order: string[] = [];
	const games = new InMemoryGameRepository();
	// A snapshot write is one `upsertMany` (S216 AC 2), a day's games or one game alike.
	const upsertMany = games.upsertMany.bind(games);
	games.upsertMany = async (batch) =>
	{
		order.push("write");
		return upsertMany(batch);
	};
	const deps: IngestDeps = {
		mlb,
		...memoryScheduleStores(),
		games,
		projections: new InMemoryGameProjectionRepository(),
	};
	const published: { hubId: string;
		snapshot: GameSnapshot; }[] = [];
	const publish = vi.fn(async (hubId: string, snapshot: GameSnapshot) =>
	{
		order.push("publish");
		published.push({
			hubId,
			snapshot,
		});
	});
	const storage = new FakeDurableStorage();
	return {
		deps,
		fetchGame,
		games,
		order,
		publish,
		published,
		storage,
		ingest: new GameIngest(storage, deps, publish),
	};
}

describe("GameIngest", () =>
{
	it("ensureRunning: called twice for one game arms exactly one alarm", async () =>
	{
		const { ingest, storage } = setup();
		expect(gameIngestName(745001)).toBe("game-ingest:745001");
		expect(await ingest.ensureRunning(745001, T0)).toBe(true);
		expect(await ingest.ensureRunning(745001, T0)).toBe(false);
		expect(storage.armed).toEqual([T0.getTime()]);
	});

	it("unchanged: the alarm polls 745001 through MlbStatsClient; a second, unchanged payload makes no new version and publishes nothing", async () =>
	{
		const {
			ingest, fetchGame, games, publish,
		} = setup();
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		const first = await games.getByPk(745001);
		expect(first?.version).toBe(1);
		await ingest.alarm(new Date(T0.getTime() + DEFAULT_CADENCE.intervalMs));
		expect(fetchGame).toHaveBeenCalledTimes(2);
		expect((await games.getByPk(745001))?.version).toBe(1);
		expect(publish).toHaveBeenCalledTimes(1);
	});

	it("write before publish: the store holds the change before any hub hears of it, and the next alarm is armed", async () =>
	{
		const {
			ingest, order, published, storage,
		} = setup();
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual(["write", "publish"]);
		expect(published.map((p) => [p.hubId, p.snapshot.gamePk, p.snapshot.version])).toEqual([["hub-a", 745001, 1]]);
		expect(storage.alarmAt).toBe(T0.getTime() + DEFAULT_CADENCE.intervalMs);
	});

	it("S216 AC 3 game ingest writes before it publishes: an active game's writes stay with its ingest object, the projection too, all stored before the hub hears", async () =>
	{
		const {
			deps, ingest, order, storage,
		} = setup();
		const projected: number[] = [];
		const upsertMany = deps.projections.upsertMany.bind(deps.projections);
		deps.projections.upsertMany = async (batch) =>
		{
			order.push("projection");
			projected.push(...batch.map((projection) => projection.header.version));
			return upsertMany(batch);
		};
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		// No background work: the ingest object writes the row, the snapshot and the projection, then publishes.
		expect(order).toEqual(["write", "projection", "publish"]);
		expect(projected).toEqual([1]);
		expect(storage.alarmAt).toBe(T0.getTime() + DEFAULT_CADENCE.intervalMs);
	});

	it("no hubs: a change is written and nothing is published", async () =>
	{
		const {
			ingest, order, publish,
		} = setup();
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual(["write"]);
		expect(publish).not.toHaveBeenCalled();
	});

	it("a hub that fails to take three publishes in a row is dropped", async () =>
	{
		let n = 0;
		const { ingest, publish } = setup((game) => ({
			...game,
			status: {
				...game.status,
				detailedState: `In Progress ${n++}`,
			},
		}));
		publish.mockRejectedValue(new Error("hub down"));
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		for (let i = 0; i < 4; i++) await ingest.alarm(new Date(T0.getTime() + i * 1000));
		expect(publish).toHaveBeenCalledTimes(3);
		expect(await ingest.hubs.live(T0)).toEqual([]);
	});

	it("end of the window: the last poll publishes the final state, clears the alarm and arms no other", async () =>
	{
		const {
			ingest, published, storage,
		} = setup((game) => ({
			...game,
			status: {
				abstractGameState: "Final",
				detailedState: "Final",
				codedGameState: "F",
			},
		}));
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(published.map((p) => p.snapshot.status.codedGameState)).toEqual(["F"]);
		expect(published[0]?.snapshot.windowMode).toBe("cache");
		expect(storage.alarmAt).toBeNull();
		expect(storage.armed).toEqual([T0.getTime()]);
		// Nothing left to poll: a stray alarm does nothing.
		await ingest.alarm(T0);
		expect(published).toHaveLength(1);
	});

	it("a postponed game (`D`) stops its ingest on the next poll, whatever the clock (#72)", async () =>
	{
		const { ingest, storage } = setup((game) => ({
			...game,
			status: {
				abstractGameState: "Final",
				detailedState: "Postponed: Rain",
				codedGameState: "D",
			},
		}));
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(storage.alarmAt).toBeNull();
		expect(storage.armed).toEqual([T0.getTime()]);
	});

	it("a failed MLB call writes nothing and keeps the cadence", async () =>
	{
		const {
			ingest, fetchGame, order, storage,
		} = setup();
		fetchGame.mockRejectedValueOnce(new Error("MLB down"));
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect(order).toEqual([]);
		expect(storage.alarmAt).toBe(T0.getTime() + DEFAULT_CADENCE.intervalMs);
	});
});

describe("ensureIngestRunning", () =>
{
	it("ensures an ingest object for each in-window game of today's schedule and stores the schedule; one that won't start doesn't stop the rest", async () =>
	{
		const now = new Date("2024-07-04T23:00:00Z");
		const { deps } = setup();
		const day = await new FixtureMlbStatsClient().fetchSchedule("2024-07-04");
		const inWindow = day.games.filter((g) => isGameInActiveWindow(g, now)).map((g) => g.gamePk);
		expect(inWindow).toContain(745001);
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual(inWindow);
		expect(ensure.mock.calls.map(([pk]) => pk)).toEqual(inWindow);
		expect(await deps.schedules.getByDate("2024-07-04")).not.toBeNull();
		ensure.mockRejectedValueOnce(new Error("object busy"));
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual(inWindow.slice(1));
	});
});

describe("ensureIngestRunning reads MLB's dates, not the UTC date (#73)", () =>
{
	// The recorded 2026-09-05 slate runs to a 01:40Z (6:40 PM PDT) first pitch, on the next UTC day.
	const EVENING = "2026-09-05";
	const LATEST = 823094;

	function counted()
	{
		const { deps } = setup();
		const real = new FixtureMlbStatsClient();
		const fetchSchedule = vi.fn((date: string) => real.fetchSchedule(date));
		deps.mlb.fetchSchedule = fetchSchedule;
		return {
			deps,
			fetchSchedule,
		};
	}

	async function expectedInWindow(now: Date): Promise<number[]>
	{
		const day = await new FixtureMlbStatsClient().fetchSchedule(EVENING);
		return day.games.filter((g) => isGameInActiveWindow(g, now)).map((g) => g.gamePk);
	}

	it("at 01:00Z (9 PM EDT) the evening's in-window games are ensured and its stored day refreshed", async () =>
	{
		const now = new Date("2026-09-06T01:00:00Z");
		const { deps, fetchSchedule } = counted();
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		const ensured = await ensureIngestRunning(deps, ensure, now);
		expect(ensured).toContain(LATEST);
		expect(ensured).toEqual(await expectedInWindow(now));
		expect(fetchSchedule.mock.calls.map(([date]) => date)).toContain(EVENING);
		const stored = await deps.schedules.getByDate(EVENING);
		expect(stored?.fetchedAt).toBe(now.toISOString());
		expect(stored?.windowMode).toBe("active");
	});

	it("after US midnight (05:00Z) the day before's game still in its trail stays ensured", async () =>
	{
		const now = new Date("2026-09-06T05:00:00Z");
		const { deps, fetchSchedule } = counted();
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		const ensured = await ensureIngestRunning(deps, ensure, now);
		expect(ensured).toContain(LATEST);
		expect(fetchSchedule.mock.calls.map(([date]) => date).sort()).toEqual([EVENING, "2026-09-06"]);
	});

	it("run minute by minute past the last trail, the day before is re-stored as cache, then skipped", async () =>
	{
		const { deps, fetchSchedule } = counted();
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		// 823094's trail ends 08:40Z (01:40Z + 4h assumed end + 3h).
		for (let t = Date.parse("2026-09-06T05:00:00Z"); t <= Date.parse("2026-09-06T12:00:00Z"); t += 60_000)
		{
			await ensureIngestRunning(deps, ensure, new Date(t));
		}
		expect((await deps.schedules.getByDate(EVENING))?.windowMode).toBe("cache");
		fetchSchedule.mockClear();
		// 15:00Z: every 2026-09-05 game is final and past its trail, and the stored day says so.
		expect(await ensureIngestRunning(deps, ensure, new Date("2026-09-06T15:00:00Z"))).toEqual([]);
		expect(fetchSchedule.mock.calls.map(([date]) => date)).toEqual(["2026-09-06"]);
	}); // 421 cron runs: well under a second, within the default timeout even under coverage.

	it("a stored day before that is settled but still has a game in its trail is fetched again", async () =>
	{
		const { deps, fetchSchedule } = counted();
		const recorded = await new FixtureMlbStatsClient().fetchSchedule(EVENING);
		// Every game final, stored as cache: only 823094's trail (to 08:40Z) keeps the day in play.
		await deps.schedules.upsert(stampVersion<ScheduleDay>(null, {
			...recorded,
			windowMode: "cache",
		}, "2026-09-06T04:00:00Z"));
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		const ensured = await ensureIngestRunning(deps, ensure, new Date("2026-09-06T05:00:00Z"));
		expect(fetchSchedule.mock.calls.map(([date]) => date)).toContain(EVENING);
		expect(ensured).toContain(LATEST);
	});

	it("a failed day-before fetch still refreshes today, and the next run retries it", async () =>
	{
		const { deps, fetchSchedule } = counted();
		const real = new FixtureMlbStatsClient();
		fetchSchedule.mockImplementation(async (date: string) =>
		{
			if (date === EVENING) throw new Error("MLB down");
			return real.fetchSchedule(date);
		});
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		const now = new Date("2026-09-06T05:00:00Z");
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual([]);
		expect((await deps.schedules.getByDate("2026-09-06"))?.fetchedAt).toBe(now.toISOString());
		fetchSchedule.mockImplementation((date: string) => real.fetchSchedule(date));
		expect(await ensureIngestRunning(deps, ensure, new Date(now.getTime() + 60_000))).toContain(LATEST);
	});

	it("a game listed on both dates (a suspended game resumed) is ensured once", async () =>
	{
		const { deps, fetchSchedule } = counted();
		const recorded = await new FixtureMlbStatsClient().fetchSchedule(EVENING);
		const resumed = {
			...recorded.games[0]!,
			status: {
				abstractGameState: "Live",
				codedGameState: "I",
				detailedState: "In Progress",
			},
		};
		const now = new Date("2026-09-06T18:00:00Z");
		// Both copies in window: ensured once.
		fetchSchedule.mockImplementation(async (date: string) => ({
			...recorded,
			date,
			games: [resumed],
		}));
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual([resumed.gamePk]);
		expect(ensure).toHaveBeenCalledTimes(1);

		// Today's copy in window, the day before's (the suspended original, final, its
		// trail long over) out: active once, and never also counted as skipped.
		const original = recorded.games[0]!;
		expect(isGameInActiveWindow(original, now)).toBe(false);
		fetchSchedule.mockImplementation(async (date: string) => ({
			...recorded,
			date,
			games: [date === EVENING ? original : resumed],
		}));
		const { active, skipped } = await refreshTodaysWindow(deps, now);
		expect(active.map((g) => g.gamePk)).toEqual([resumed.gamePk]);
		expect(skipped).not.toContain(resumed.gamePk);
	});
});

describe("GameIngest between alarms", () =>
{
	it("ensureRunning: while an alarm is due (the runtime reports none) it arms nothing; once alarms have stopped for two intervals it restarts them", async () =>
	{
		const { ingest, storage } = setup();
		await ingest.ensureRunning(745001, T0);
		storage.alarmAt = null;
		expect(await ingest.ensureRunning(745001, new Date(T0.getTime() + 1000))).toBe(false);
		expect(await ingest.ensureRunning(745001, new Date(T0.getTime() + 2 * DEFAULT_CADENCE.intervalMs))).toBe(true);
		expect(storage.armed).toEqual([T0.getTime(), T0.getTime() + 2 * DEFAULT_CADENCE.intervalMs]);
	});
});

/**
 * #79, #323: a suspended game is polled for `suspendedHours` from when BT saw it turn suspended
 * (owner, 2026-11-22: "From when it was suspended (Recommended)"), not from first pitch.
 */
describe("a suspended game's ingest (#79, #323)", () =>
{
	const at = (iso: string) => new Date(iso);
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

	/** 745001 as a summary of the 2026-07-04 night game (first pitch 23:05Z), with `codedGameState`. */
	async function summary(codedGameState: string): Promise<ScheduleDay["games"][number]>
	{
		const recorded = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games.find((g) => g.gamePk === 745001)!;
		return {
			...recorded,
			officialDate: "2026-07-04",
			gameDate: "2026-07-04T23:05:00Z",
			startTime: "2026-07-04T23:05:00Z",
			status: {
				...SUSPENDED,
				codedGameState,
			},
		};
	}

	/** Stores 745001 as `status`, last changed at `changedAt`, in `windowMode`, with `suspendedAt` when given. */
	async function storeAs(deps: IngestDeps, status: typeof IN_PROGRESS, changedAt: string, windowMode: "active" | "cache", suspendedAt?: string)
	{
		const game = (await new FixtureMlbStatsClient().fetchGame(745001)).game;
		await deps.games.upsert(stampVersion<GameSnapshot>(null, {
			...game,
			officialDate: "2026-07-04",
			startTime: "2026-07-04T23:05:00Z",
			status,
			windowMode,
			fetchedAt: changedAt,
			...(suspendedAt ? {
				suspendedAt,
			} : {}),
		}, changedAt));
	}

	/** Deps whose schedule lists `games` on 2026-07-04 and nothing on 2026-07-05. */
	function withSchedule(deps: IngestDeps, games: ScheduleDay["games"])
	{
		deps.mlb.fetchSchedule = async (date: string) => ({
			date,
			games: date === "2026-07-04" ? games : [],
			fetchedAt: "",
			windowMode: "cache",
		});
	}

	it("late suspension: first pitch 23:05Z, suspended at 05:10Z, it is polled until 11:10:00.000Z and stopped at 11:10:00.001Z; a later change doesn't extend it", async () =>
	{
		let status = IN_PROGRESS;
		const {
			ingest, games, storage,
		} = setup((game) => ({
			...game,
			officialDate: "2026-07-04",
			startTime: "2026-07-04T23:05:00Z",
			status,
		}));
		await ingest.ensureRunning(745001, at("2026-07-05T05:09:30Z"));
		await ingest.alarm(at("2026-07-05T05:09:30Z"));
		expect((await games.getByPk(745001))?.suspendedAt).toBeUndefined();

		status = SUSPENDED;
		await ingest.alarm(at("2026-07-05T05:10:00Z"));
		expect(storage.alarmAt).toBe(Date.parse("2026-07-05T05:10:30Z"));
		const suspended = (await games.getByPk(745001))!;
		expect(suspended.suspendedAt).toBe("2026-07-05T05:10:00.000Z");
		expect(suspended.windowMode).toBe("active");

		status = {
			...SUSPENDED,
			detailedState: "Suspended: Rain (to resume tomorrow)",
		};
		await ingest.alarm(at("2026-07-05T08:00:00Z"));
		const changed = (await games.getByPk(745001))!;
		expect(changed.version).toBe(suspended.version + 1);
		expect(changed.suspendedAt).toBe("2026-07-05T05:10:00.000Z");

		await ingest.alarm(at("2026-07-05T11:10:00.000Z"));
		expect(storage.alarmAt).toBe(Date.parse("2026-07-05T11:10:30Z"));
		await ingest.alarm(at("2026-07-05T11:10:00.001Z"));
		expect(storage.alarmAt).toBeNull();
		expect((await games.getByPk(745001))?.windowMode).toBe("cache");
	});

	it("the cron keeps ensuring a game suspended at 06:00Z at 07:00Z, past first pitch + 6h, and keeps its day active", async () =>
	{
		const now = at("2026-07-05T07:00:00Z");
		const { deps } = setup();
		withSchedule(deps, [await summary("U")]);
		await storeAs(deps, SUSPENDED, "2026-07-05T06:00:00.000Z", "active", "2026-07-05T06:00:00.000Z");
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual([745001]);
		expect((await deps.schedules.getByDate("2026-07-04"))?.windowMode).toBe("active");
	});

	it("when the schedule sees the suspension before the game's own ingest does, the game stays ensured (anchored on now)", async () =>
	{
		const now = at("2026-07-05T07:00:00Z");
		const { deps } = setup();
		withSchedule(deps, [await summary("T")]);
		await storeAs(deps, IN_PROGRESS, "2026-07-05T06:59:30.000Z", "active");
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual([745001]);
	});

	it("with no suspension time BT saw (a cached copy), it falls back to first pitch + 6h and is let go", async () =>
	{
		const now = at("2026-07-05T07:00:00Z");
		const { deps } = setup();
		withSchedule(deps, [await summary("U")]);
		await storeAs(deps, IN_PROGRESS, "2026-07-05T06:59:30.000Z", "cache");
		const ensure = vi.fn(async (_gamePk: number) => undefined);
		expect(await ensureIngestRunning(deps, ensure, now)).toEqual([]);
		expect((await deps.schedules.getByDate("2026-07-04"))?.windowMode).toBe("cache");
	});
});

describe("GameIngest player of the game (S99 review)", () =>
{
	/** 823823 (final, regular season 2026) polled inside its trail window, then after it. */
	const IN = new Date("2026-09-05T23:30:00Z");
	const OUT = new Date("2026-09-07T12:00:00Z");
	const MEDIA = {
		playerId: 666171,
		teamId: 112,
		summary: "1.2 IP, 0 ER, K, BB",
		winProbabilityAdded: 40.7,
	};
	const FAN = {
		playerId: 664285,
		teamId: 146,
		summary: "2-4, 2B, RBI",
		winProbabilityAdded: 18.2,
	};

	/** The fixtures' 823823, due a pick, its pick asked of `pick` (counted) rather than the recording. */
	function pollable(pick: () => Promise<PlayerOfTheGame | null>)
	{
		const setupResult = setup();
		const real = new FixtureMlbStatsClient();
		const mlb = setupResult.deps.mlb as FixtureMlbStatsClient;
		mlb.fetchGame = async (pk: number) =>
		{
			const { playerOfTheGame: _recorded, ...game } = (await real.fetchGame(pk)).game;
			return {
				game,
				playerOfTheGameDue: true,
			};
		};
		const fetchPlayerOfTheGame = vi.fn(pick);
		mlb.fetchPlayerOfTheGame = fetchPlayerOfTheGame;
		// S101, S100: the uniforms and the rule settings (asked by the write for a game not stored yet) answer at once, so only
		// the pick's timing counts.
		mlb.fetchGameUniforms = async () => null;
		mlb.fetchGameRuleSettings = async () => null;
		return {
			...setupResult,
			fetchPlayerOfTheGame,
		};
	}

	it("S99 review poll: a pick asked between the fetch and the write is in that poll's one write and one publish; once both sides are stored, later polls ask no more", async () =>
	{
		const {
			ingest, order, published, storage, fetchPlayerOfTheGame,
		} = pollable(async () => ({
			media: MEDIA,
			fan: FAN,
		}));
		await ingest.hubs.register("hub-a", IN);
		await ingest.ensureRunning(823823, IN);
		await ingest.alarm(IN);
		expect(isGameInActiveWindow(published[0]!.snapshot, IN)).toBe(true);
		expect(order).toEqual(["write", "projection", "publish"].filter((step) => order.includes(step)));
		expect(order.filter((step) => step === "write")).toHaveLength(1);
		expect(order.filter((step) => step === "publish")).toHaveLength(1);
		expect(published[0]!.snapshot.playerOfTheGame).toEqual({
			media: MEDIA,
			fan: FAN,
		});
		expect(await storage.get("potgComplete")).toBe(true);
		await ingest.alarm(new Date(IN.getTime() + DEFAULT_CADENCE.intervalMs));
		expect(fetchPlayerOfTheGame).toHaveBeenCalledTimes(1);
		// Out of its window: the last poll clears the flag with the game's other keys.
		await ingest.alarm(OUT);
		expect(await storage.get("potgComplete")).toBeUndefined();
	});

	it("S101 review poll uniforms: a final game with no uniforms is asked once per poller run, not on every poll of its trail", async () =>
	{
		const {
			ingest, storage, deps,
		} = pollable(async () => ({
			media: MEDIA,
			fan: FAN,
		}));
		const fetchGameUniforms = vi.fn(async () => null);
		(deps.mlb as FixtureMlbStatsClient).fetchGameUniforms = fetchGameUniforms;
		// S100: the rule settings ride the same guard.
		const fetchGameRuleSettings = vi.fn(async () => null);
		(deps.mlb as FixtureMlbStatsClient).fetchGameRuleSettings = fetchGameRuleSettings;
		await ingest.ensureRunning(823823, IN);
		await ingest.alarm(IN);
		expect(fetchGameUniforms).toHaveBeenCalledTimes(1);
		expect(fetchGameRuleSettings).toHaveBeenCalledTimes(1);
		await ingest.alarm(new Date(IN.getTime() + DEFAULT_CADENCE.intervalMs));
		await ingest.alarm(new Date(IN.getTime() + 2 * DEFAULT_CADENCE.intervalMs));
		expect(fetchGameUniforms).toHaveBeenCalledTimes(1);
		expect(fetchGameRuleSettings).toHaveBeenCalledTimes(1);
		// Out of its window: the last poll clears the key with the game's other keys.
		await ingest.alarm(OUT);
		expect(await storage.get("uniformsAsked")).toBeUndefined();
	});

	it("S99 review poll per side: with only the media pick named, the next poll asks again and adds the fan pick", async () =>
	{
		let answer: PlayerOfTheGame = {
			media: MEDIA,
		};
		const {
			ingest, games, storage, fetchPlayerOfTheGame,
		} = pollable(async () => answer);
		await ingest.ensureRunning(823823, IN);
		await ingest.alarm(IN);
		expect(await storage.get("potgComplete")).toBeUndefined();
		answer = {
			fan: FAN,
		};
		await ingest.alarm(new Date(IN.getTime() + DEFAULT_CADENCE.intervalMs));
		expect(fetchPlayerOfTheGame).toHaveBeenCalledTimes(2);
		expect((await games.getByPk(823823))?.playerOfTheGame).toEqual({
			media: MEDIA,
			fan: FAN,
		});
	});

	it("S99 review poll hung: a pick that never answers doesn't stall the alarm: the game is written without it within PLAY_METRICS_LIMIT_MS and the next alarm armed", async () =>
	{
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout"],
		});
		try
		{
			let asked!: () => void;
			const askedNow = new Promise<void>((resolve) =>
			{
				asked = resolve;
			});
			const {
				ingest, games, storage,
			} = pollable(() =>
			{
				asked();
				return new Promise<PlayerOfTheGame | null>(() => undefined);
			});
			await ingest.ensureRunning(823823, IN);
			let done = false;
			void ingest.alarm(IN).then(() =>
			{
				done = true;
			});
			// The fixture reads are real file I/O, so the limit's clock starts once the pick is asked.
			await askedNow;
			await vi.advanceTimersByTimeAsync(PLAY_METRICS_LIMIT_MS);
			expect(done).toBe(true);
			const stored = await games.getByPk(823823);
			expect(stored).not.toBeNull();
			expect(stored).not.toHaveProperty("playerOfTheGame");
			expect(storage.alarmAt).toBe(IN.getTime() + DEFAULT_CADENCE.intervalMs);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});
