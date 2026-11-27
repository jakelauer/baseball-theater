import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { GameSnapshot } from "@bt/domain";
import { mlbToday } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { getOrRefreshGame, type IngestDeps } from "./ingest.js";
import {
	CACHE_TTL_MS, isStale, RefreshCoordinator,
} from "./refresh.js";

/**
 * MlbStatsClient that counts `fetchGame` calls and can hold each one open, so a
 * test can prove that concurrent reads collapse to a single in-flight call
 * (single-flight) rather than fanning out into shared MLB egress.
 */
function spyClient(): {
	client: MlbStatsClient;
	calls: () => number;
	release: () => void;
}
{
	const real = new FixtureMlbStatsClient();
	const fetchGame = vi.fn(async (gamePk: number) =>
	{
		await gate;
		const fetched = await real.fetchGame(gamePk);
		// Played on MLB's today, as `cached` is, so a refreshed game still follows refresh-on-read (S212).
		return {
			...fetched,
			game: {
				...fetched.game,
				officialDate: mlbToday(new Date()),
			},
		};
	});
	let open!: () => void;
	const gate = new Promise<void>((resolve) =>
	{
		open = resolve;
	});
	const client = {
		fetchSchedule: (d: string) => real.fetchSchedule(d),
		fetchScheduleRange: (from: string, to: string) => real.fetchScheduleRange(from, to),
		fetchGame,
		fetchGameContent: (pk: number) => real.fetchGameContent(pk),
		fetchPlayMetrics: (pk: number) => real.fetchPlayMetrics(pk),
		fetchGameGraphContent: (pk: number) => real.fetchGameGraphContent(pk),
		fetchPlayerOfTheGame: (pk: number) => real.fetchPlayerOfTheGame(pk),
		fetchGameUniforms: (pk: number) => real.fetchGameUniforms(pk),
		fetchGameRuleSettings: (pk: number) => real.fetchGameRuleSettings(pk),
		fetchStandings: (d: string) => real.fetchStandings(d),
		fetchFinalStandings: (season: number) => real.fetchFinalStandings(season),
		fetchSpringStandings: (season: number, d: string) => real.fetchSpringStandings(season, d),
		fetchSeasonCalendar: (season: number) => real.fetchSeasonCalendar(season),
		fetchPlayers: (ids: number[]) => real.fetchPlayers(ids),
		searchHighlights: (q: string) => real.searchHighlights(q),
		fetchGameTimestamps: (pk: number) => real.fetchGameTimestamps(pk),
		fetchGameDiffPatch: (pk: number, s: string, e: string) =>
			real.fetchGameDiffPatch(pk, s, e),
	} satisfies MlbStatsClient;
	return {
		client,
		calls: () => fetchGame.mock.calls.length,
		release: () => open(),
	};
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps
{
	return {
		mlb: new FixtureMlbStatsClient(),
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		...overrides,
	};
}

/**
 * The one wall clock every case reads (#642). `cached` and `spyClient` date their game to MLB's today at the wall
 * clock, and the read judges it against the clock again, so a real clock crossing US Eastern midnight (04:00–05:00 UTC)
 * between the two made the game past and finished and skipped the refresh a case expects (#564 fixed one case; #642
 * the rest). Midday Eastern, frozen for each case by the `beforeEach` below, keeps every date on one day at any hour.
 */
const NOW = new Date("2026-07-15T16:00:00Z");
const STALE = new Date(NOW.getTime() - CACHE_TTL_MS - 1_000).toISOString();
const FRESH = NOW.toISOString();

beforeEach(() =>
{
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	vi.setSystemTime(NOW);
});

/**
 * Every case proves it ran on the pinned clock before the clock is restored. The `#642` case below checks only its own
 * run, so a later case that called `vi.useRealTimers()` (or set another system time) would read the real clock again
 * and bring back the midnight flake unnoticed; failing here names that case. No case advances the faked `Date` (the
 * cooldown cases move their own `clock` through `now`), so the wall clock still reads exactly `NOW` at the end.
 */
afterEach(() =>
{
	const pinned = vi.isFakeTimers();
	const at = new Date().toISOString();
	vi.useRealTimers();
	expect(pinned, "this case switched back to the real clock (#642)").toBe(true);
	expect(at, "this case moved the pinned clock (#642)").toBe(NOW.toISOString());
});

/**
 * A final game played on MLB's today, so it is not past and finished (S212, `isPastFinishedGame`) and its read still
 * follows the refresh-on-read rule these cases prove.
 */
function cached(fetchedAt: string): GameSnapshot
{
	return {
		gamePk: 744834,
		officialDate: mlbToday(new Date()),
		status: {
			abstractGameState: "Final",
			detailedState: "Final",
			codedGameState: "F",
		},
		teams: {
			home: {
				id: 120,
				name: "Washington Nationals",
				abbreviation: "WSH",
				runs: 0,
			},
			away: {
				id: 121,
				name: "New York Mets",
				abbreviation: "NYM",
				runs: 0,
			},
		},
		venue: {
			id: 3309,
			name: "Nationals Park",
		},
		linescore: {
			currentInning: 9,
			inningState: "Bottom",
			balls: 0,
			strikes: 0,
			outs: 3,
		},
		plays: [],
		highlights: [],
		fetchedAt,
		windowMode: "cache",
	} as unknown as GameSnapshot;
}

describe("the file's clock (#642)", () =>
{
	it("pins one clock for every case, so STALE, FRESH and the helpers' MLB day never cross US Eastern midnight (#642)", () =>
	{
		expect(new Date().toISOString()).toBe(NOW.toISOString());
		expect(FRESH).toBe(NOW.toISOString());
		expect(Date.parse(STALE)).toBe(NOW.getTime() - CACHE_TTL_MS - 1_000);
		expect(cached(FRESH).officialDate).toBe(mlbToday(NOW));
	});
});

describe("isStale", () =>
{
	it("treats a missing or expired fetchedAt as stale, a recent one as fresh", () =>
	{
		const now = new Date();
		expect(isStale(undefined, now)).toBe(true);
		expect(isStale("not-a-date", now)).toBe(true);
		expect(isStale(STALE, now)).toBe(true);
		expect(isStale(FRESH, now)).toBe(false);
	});
});

describe("getOrRefreshGame staleness trigger", () =>
{
	it("does not refresh a fresh cache entry", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(FRESH));
		spy.release();
		const out = await getOrRefreshGame(
			deps({
				mlb: spy.client,
				games,
				refresh: new RefreshCoordinator(),
			}),
			744834,
		);
		expect(out?.fetchedAt).toBe(FRESH);
		expect(spy.calls()).toBe(0);
	});

	it("triggers exactly one upstream refresh for a stale cache entry", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		spy.release();
		const out = await getOrRefreshGame(
			deps({
				mlb: spy.client,
				games,
				refresh: new RefreshCoordinator(),
			}),
			744834,
		);
		expect(spy.calls()).toBe(1);
		expect(out?.fetchedAt).not.toBe(STALE);
	});
});

describe("single-flight", () =>
{
	it("collapses N concurrent stale reads for one key into 1 upstream call", async () =>
	{
		const spy = spyClient();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		const d = deps({
			mlb: spy.client,
			games,
			refresh: new RefreshCoordinator(),
		});

		const reads = Promise.all(
			Array.from({
				length: 8,
			}, () => getOrRefreshGame(d, 744834)),
		);
		// All eight are now parked on the same in-flight fetch.
		spy.release();
		const results = await reads;

		expect(spy.calls()).toBe(1);
		expect(results.every((r) => r?.gamePk === 744834)).toBe(true);
	});
});

describe("refresh cooldown", () =>
{
	it("suppresses a second upstream refresh inside REFRESH_COOLDOWN_MS", async () =>
	{
		const spy = spyClient();
		spy.release();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));

		// Start the clock exactly at the point the cached entry turns stale.
		let clock = new Date(Date.parse(STALE) + CACHE_TTL_MS + 1_000);
		const cooldown = new RefreshCoordinator(() => clock, 60_000);
		const d = deps({
			mlb: spy.client,
			games,
			refresh: cooldown,
			now: () => clock,
		});

		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// A forced refresh (`?refresh=1`) inside the cooldown is still blocked.
		clock = new Date(clock.getTime() + 30_000);
		const second = await getOrRefreshGame(d, 744834, {
			force: true,
		});
		expect(spy.calls()).toBe(1); // cooldown blocked the re-hit
		expect(second?.gamePk).toBe(744834); // still served from cache

		// Past the cooldown, a refresh is allowed again.
		clock = new Date(clock.getTime() + 60_000);
		await getOrRefreshGame(d, 744834, {
			force: true,
		});
		expect(spy.calls()).toBe(2);
	});

	it("counts an unchanged refresh as checked, so reads past the TTL don't re-pull until the TTL lapses again", async () =>
	{
		// The clock below runs ~7 minutes past `NOW`, the game dated MLB's today at the pinned wall clock (`cached`,
		// `spyClient`); from the real clock, a run just before US Eastern midnight crossed into MLB's next day and the
		// last read never refreshed (#564). The file's pinned midday clock keeps them on one day.
		const spy = spyClient();
		spy.release();
		const games = new InMemoryGameRepository();
		await games.upsert(cached(STALE));
		let clock = new Date(Date.parse(STALE) + CACHE_TTL_MS + 1_000);
		const d = deps({
			mlb: spy.client,
			games,
			refresh: new RefreshCoordinator(() => clock, 60_000),
			now: () => clock,
		});

		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// Past the cooldown but inside the TTL since that check: served from the store.
		clock = new Date(clock.getTime() + 2 * 60_000);
		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(1);

		// A full TTL after the check, the next read refreshes again.
		clock = new Date(clock.getTime() + CACHE_TTL_MS);
		await getOrRefreshGame(d, 744834);
		expect(spy.calls()).toBe(2);
	});
});

describe("RefreshCoordinator countsAsCheck (S124)", () =>
{
	const T = new Date("2026-11-09T17:00:00Z");

	it("without a predicate, a settled refresh counts as a check even when it throws", async () =>
	{
		const coordinator = new RefreshCoordinator(() => T);
		await expect(coordinator.run("k", async () =>
		{
			throw new Error("MLB unreachable");
		})).rejects.toThrow();
		expect(coordinator.lastRefreshedAt("k")).toBe(T.getTime());
		expect(coordinator.canRefresh("k")).toBe(false);
	});

	it("with a predicate, a result it rejects starts the cooldown but is not a check", async () =>
	{
		const coordinator = new RefreshCoordinator(() => T);
		expect(await coordinator.run("k", async () => false, (ok) => ok)).toBe(false);
		expect(coordinator.lastRefreshedAt("k")).toBeUndefined();
		expect(coordinator.canRefresh("k")).toBe(false);
		expect(await coordinator.run("k", async () => true, (ok) => ok)).toBeUndefined();
	});

	it("with a predicate, a refresh that throws starts the cooldown but is not a check", async () =>
	{
		const coordinator = new RefreshCoordinator(() => T);
		await expect(coordinator.run("k", async () =>
		{
			throw new Error("database down");
		}, () => true)).rejects.toThrow();
		expect(coordinator.lastRefreshedAt("k")).toBeUndefined();
		expect(coordinator.canRefresh("k")).toBe(false);
	});

	it("with a predicate, a result it accepts is a check", async () =>
	{
		const coordinator = new RefreshCoordinator(() => T);
		await coordinator.run("k", async () => true, (ok) => ok);
		expect(coordinator.lastRefreshedAt("k")).toBe(T.getTime());
	});
});
