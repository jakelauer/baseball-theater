/**
 * S212 AC 4: every writer that stores a past, finished day or game it changed (or stored for the first time) purges
 * its edge URLs, through `storeSchedule` and `storeGame`; nothing else is purged, and a purge never fails a write.
 */
import type { ScheduleDay, Unversioned } from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { InMemoryOwedEdgePurgeRepository } from "../adapters/memory/repos.js";
import { PAST_EDGE_TTL_S } from "../handlers/cache-control.js";
import {
	finalDay, finalGame, LONG_AGO, memoryDeps, NOW, ORIGIN, PAST_DATE, storePastDay,
} from "../test/past-data.js";
import { edgePurgeFor } from "../worker-app.js";
import {
	OWED_PURGE_FIRST_RETRY_MS, OWED_PURGE_GIVE_UP_MS, OWED_PURGE_MAX_RETRY_MS, owedPurgeRetryDelayMs, purgeGameEdge, retryOwedEdgePurges,
} from "./edge-purge.js";
import {
	getOrRefreshSchedule, ingestGame, storeSchedule,
} from "./ingest.js";
import { fillScheduleMonth } from "./schedule-month.js";

const GAME_URL = (gamePk: number) => `${ORIGIN}/api/v1/games/${gamePk}`;

/** The stored fixture day's games with `change` applied to the one game `gamePk`. */
function changingGame(gamePk: number, change: (game: Unversioned<ScheduleDay>["games"][number]) => Unversioned<ScheduleDay>["games"][number])
{
	return (day: Unversioned<ScheduleDay>): Unversioned<ScheduleDay> => ({
		...day,
		games: day.games.map((game) => game.gamePk === gamePk ? change(game) : game),
	});
}

/** `deps`' repositories with every method call recorded as `<repo>.<method>`, in call order. */
function countingReads(deps: ReturnType<typeof memoryDeps>): string[]
{
	const reads: string[] = [];
	for (const name of ["schedules", "games", "gameStates", "projections"] as const)
	{
		const repo = deps[name] as unknown as Record<string, unknown>;
		deps[name] = new Proxy(repo, {
			get(target, key, receiver)
			{
				const value = Reflect.get(target, key, receiver) as unknown;
				if (typeof value !== "function") return value;
				return (...args: unknown[]) =>
				{
					reads.push(`${name}.${String(key)}`);
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			},
		}) as never;
	}
	return reads;
}

/** A purger that fails every request, counting them. */
function failingPurger()
{
	const sent: string[][] = [];
	return {
		sent,
		purge: async (urls: readonly string[]) =>
		{
			sent.push([...urls]);
			throw new Error("Cloudflare down");
		},
	};
}

const DAY_URLS = (date: string) => [`${ORIGIN}/api/v1/schedule?date=${date}`, `${ORIGIN}/api/v1/digest?date=${date}`];

/** An MLB whose schedule range is the fixture day and the empty day after, `change` applied to the fixture day. */
function monthMlb(change: (day: Unversioned<ScheduleDay>) => Unversioned<ScheduleDay> = (day) => day): MlbStatsClient & { change: typeof change }
{
	const fixture = new FixtureMlbStatsClient();
	const mlb = Object.assign(Object.create(fixture) as MlbStatsClient, {
		change,
		fetchScheduleRange: async () => [mlb.change(await finalDay()), {
			...await finalDay("2024-07-05"),
			games: [],
		}],
		fetchSchedule: async (date: string) => date === PAST_DATE ? mlb.change(await finalDay()) : fixture.fetchSchedule(date),
	});
	return mlb;
}

/** The fixture day with its first game's home team renamed: a change to the stored day itself. */
function renamed(day: Unversioned<ScheduleDay>): Unversioned<ScheduleDay>
{
	return {
		...day,
		games: day.games.map((game, i) => i === 0 ? {
			...game,
			teams: {
				...game.teams,
				home: {
					...game.teams.home,
					name: `${game.teams.home.name} (corrected)`,
				},
			},
		} : game),
	};
}

describe("purging the edge copy on a real change (S212 AC 4)", () =>
{
	it("S212 AC 4 month changes one day: a month refresh that changes one past day purges exactly that day's two URLs", async () =>
	{
		const mlb = monthMlb();
		const deps = memoryDeps(mlb);
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], NOW);
		deps.purger.calls.length = 0;
		mlb.change = renamed;
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], new Date(NOW.getTime() + 6 * 3600_000));
		expect(deps.purger.purged).toEqual(DAY_URLS(PAST_DATE));
	});

	it("S212 AC 4 month unchanged: a month refresh that changes nothing purges nothing", async () =>
	{
		const deps = memoryDeps(monthMlb());
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], NOW);
		deps.purger.calls.length = 0;
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], new Date(NOW.getTime() + 6 * 3600_000));
		expect(deps.purger.purged).toEqual([]);
	});

	it("S212 AC 4 first store: a past day stored for the first time purges its two URLs", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, {
			...await finalDay(),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(deps.purger.purged).toEqual(DAY_URLS(PAST_DATE));
	});

	it("S212 AC 4 today future: a change to today's or a future day purges nothing", async () =>
	{
		const deps = memoryDeps();
		for (const [date, startTime] of [["2026-11-15", "2026-11-14T23:00:00.000Z"], ["2026-11-20", "2026-11-20T23:00:00.000Z"]] as const)
		{
			await storeSchedule(deps, {
				...await finalDay(date, startTime),
				fetchedAt: NOW.toISOString(),
				windowMode: "cache",
			});
			await storeSchedule(deps, {
				...renamed(await finalDay(date, startTime)),
				fetchedAt: new Date(NOW.getTime() + 60_000).toISOString(),
				windowMode: "cache",
			});
		}
		expect(deps.purger.purged).toEqual([]);
	});

	it("S212 AC 4 game ingest change: a game ingest write that changes a past, finished game purges its URL and its day's two", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		const { game } = await finalGame(744834);
		await ingestGame(deps, {
			...game,
			status: {
				...game.status,
				detailedState: "Final: scoring change",
			},
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(deps.purger.purged).toEqual([`${ORIGIN}/api/v1/games/744834`, ...DAY_URLS(PAST_DATE)]);
	});

	it("S212 AC 4 unchanged poll: a game ingest write that changes nothing purges nothing", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		const { game } = await finalGame(744834);
		const { changed } = await ingestGame(deps, {
			...game,
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(changed).toBe(false);
		expect(deps.purger.purged).toEqual([]);
	});

	it("S212 AC 4 refresh read: a ?refresh=1 read of a past day that MLB has changed purges its two URLs", async () =>
	{
		const mlb = monthMlb();
		const deps = memoryDeps(mlb);
		await storePastDay(deps);
		mlb.change = renamed;
		await getOrRefreshSchedule(deps, PAST_DATE, {
			force: true,
		});
		expect(deps.purger.purged).toEqual(DAY_URLS(PAST_DATE));
	});

	it("S212 AC 4 no credentials: without the secrets or the origin the write succeeds and nothing is sent", async () =>
	{
		const fetcher = vi.fn(async () => Response.json({
			success: true,
		}));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		for (const env of [{}, {
			BT_CF_PURGE_TOKEN: "t",
			BT_CF_ZONE_ID: "z",
		}, {
			BT_CF_ZONE_ID: "z",
			BT_APP_ORIGIN: ORIGIN,
		}])
		{
			const deps = memoryDeps();
			deps.edgePurge = edgePurgeFor(env, fetcher);
			const day = await storeSchedule(deps, {
				...await finalDay(),
				fetchedAt: NOW.toISOString(),
				windowMode: "cache",
			});
			expect(day.games.length).toBeGreaterThan(0);
			expect(await deps.schedules.getByDate(PAST_DATE)).not.toBeNull();
		}
		expect(fetcher).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("S212 AC 4 purger rejects: a purge that fails leaves the write stored", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const deps = memoryDeps();
		deps.edgePurge = {
			purger: {
				purge: async () =>
				{
					throw new Error("Cloudflare down");
				},
			},
			origin: ORIGIN,
		};
		await storeSchedule(deps, {
			...await finalDay(),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(await deps.schedules.getByDate(PAST_DATE)).not.toBeNull();
		const { game } = await finalGame(744834);
		await ingestGame(deps, {
			...game,
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(await deps.games.getByPk(744834)).not.toBeNull();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("purging every URL that shows a change (S212 review)", () =>
{
	it("S212 review month linescore: a month refresh changing only one past game's state purges its game URL and its day's two URLs", async () =>
	{
		const mlb = monthMlb();
		const deps = memoryDeps(mlb);
		const [gamePk] = await storePastDay(deps);
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], NOW);
		deps.purger.calls.length = 0;
		mlb.change = changingGame(gamePk!, (game) => ({
			...game,
			status: {
				...game.status,
				detailedState: "Final: scoring change",
			},
		}));
		await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], new Date(NOW.getTime() + 6 * 3600_000));
		expect(deps.purger.purged).toEqual([GAME_URL(gamePk!), ...DAY_URLS(PAST_DATE)]);
		expect((await deps.gameStates.getByPk(gamePk!))?.state.status.detailedState).toBe("Final: scoring change");
	});

	it("S212 review listing days: a change to a game postponed on one day and played on another purges both days' URLs", async () =>
	{
		const deps = memoryDeps();
		await storePastDay(deps);
		const original = await finalDay("2024-07-03");
		const [listing] = (await finalDay()).games.filter((game) => game.gamePk === 744834);
		await storeSchedule(deps, {
			...original,
			games: [{
				...listing!,
				officialDate: "2024-07-03",
				status: {
					abstractGameState: "Final",
					codedGameState: "D",
					detailedState: "Postponed: Rain",
				},
			}],
			fetchedAt: LONG_AGO,
			windowMode: "cache",
		});
		deps.purger.calls.length = 0;
		const { game } = await finalGame(744834);
		await ingestGame(deps, {
			...game,
			highlights: [...game.highlights, ...game.highlights.slice(0, 1).map((clip) => ({
				...clip,
				id: `${clip.id}-late`,
			}))],
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(deps.purger.purged).toEqual([GAME_URL(744834), ...DAY_URLS(PAST_DATE), ...DAY_URLS("2024-07-03")]);
	});

	it("S212 review stops settling: a past day served settled whose game is then stored suspended purges the day's and the game's URLs", async () =>
	{
		const mlb = monthMlb();
		const deps = memoryDeps(mlb);
		const [gamePk] = await storePastDay(deps);
		mlb.change = changingGame(gamePk!, (game) => ({
			...game,
			status: {
				abstractGameState: "Live",
				codedGameState: "U",
				detailedState: "Suspended: Rain",
			},
		}));
		const day = await storeSchedule(deps, {
			...mlb.change(await finalDay()),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(day.games.find((game) => game.gamePk === gamePk)?.status.codedGameState).toBe("U");
		expect(deps.purger.purged).toEqual([GAME_URL(gamePk!), ...DAY_URLS(PAST_DATE)]);
	});

	it("S212 review late game: a change to yesterday's games that aren't settled (suspended, the schedule's rows) purges nothing and reads only one games.getMany more than with no purge (S216 AC 3: no hand-written pre-filter)", async () =>
	{
		const changing = async (detailedState: string, at: Date): Promise<Unversioned<ScheduleDay>> =>
		{
			// First pitch long enough ago that the schedule, not the feed, holds the rows (out of their live window).
			const day = await finalDay("2026-11-14", "2026-11-14T16:00:00.000Z");
			return {
				...day,
				games: day.games.map((game) => ({
					...game,
					status: {
						abstractGameState: "Live",
						codedGameState: "U",
						detailedState,
					},
				})),
				fetchedAt: at.toISOString(),
				windowMode: "active",
			};
		};
		const run = async (purge: boolean) =>
		{
			const deps = memoryDeps();
			if (!purge) delete deps.edgePurge;
			const first = await changing("Suspended: Rain", NOW);
			// The games' snapshots are stored (straight to the store, so the schedule still holds their rows).
			for (const summary of first.games)
			{
				const fetched = await finalGame(summary.gamePk, "2026-11-14").catch(() => null);
				if (fetched) await deps.games.upsert({
					...fetched.game,
					status: summary.status,
					fetchedAt: NOW.toISOString(),
					windowMode: "cache",
					version: 1,
					lastChangedAt: NOW.toISOString(),
				});
			}
			await storeSchedule(deps, first);
			const reads = countingReads(deps);
			await storeSchedule(deps, await changing("Suspended: Rain, resumes later", new Date(NOW.getTime() + 60_000)));
			expect((await deps.gameStates.getByPk(first.games[0]!.gamePk))?.state.status.detailedState).toBe("Suspended: Rain, resumes later");
			expect(deps.purger.purged).toEqual([]);
			return reads;
		};
		const withPurge = await run(true);
		const without = await run(false);
		// S216 AC 3: the judgement is `isPastFinishedGame` / `isPastFinishedDay` alone, with no hand-written pre-filter: the
		// changed games' snapshots in one `games.getMany`, and the before-verdict's window judgement of the suspended games.
		expect(withPurge.slice(0, without.length - 1)).toEqual(without.slice(0, -1));
		expect(withPurge.slice(without.length - 1, -1).filter((read) => read !== "games.getByPk")).toEqual(["games.getMany"]);
	});

	it("S212 review one listing read: purging several games reads their listing days in one query", async () =>
	{
		const deps = memoryDeps();
		const gamePks = await storePastDay(deps);
		expect(gamePks.length).toBeGreaterThan(1);
		const reads = countingReads(deps);
		await purgeGameEdge(deps, gamePks.map((gamePk) => ({
			gamePk,
			officialDate: PAST_DATE,
		})), NOW);
		expect(reads).toEqual(["schedules.listGameListings"]);
		expect(deps.purger.calls).toEqual([[...gamePks.flatMap((gamePk) => [GAME_URL(gamePk), ...DAY_URLS(PAST_DATE)])].filter((url, i, all) => all.indexOf(url) === i)]);
	});

	it("S212 review unchanged reads: a month refresh that changes nothing makes exactly the reads it makes with no purge at all", async () =>
	{
		const reads = async (purge: boolean) =>
		{
			const deps = memoryDeps(monthMlb());
			await storePastDay(deps);
			await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], NOW);
			deps.purger.calls.length = 0;
			if (!purge) delete deps.edgePurge;
			const counted = countingReads(deps);
			await fillScheduleMonth(deps, "2024-07", [PAST_DATE, "2024-07-05"], new Date(NOW.getTime() + 6 * 3600_000));
			expect(deps.purger.purged).toEqual([]);
			return counted;
		};
		const withPurge = await reads(true);
		expect(withPurge.length).toBeGreaterThan(0);
		expect(withPurge).toEqual(await reads(false));
	});

	it("S212 review first game store: a past, finished game stored for the first time purges its URLs, judging no earlier state", async () =>
	{
		const deps = memoryDeps();
		const { game } = await finalGame(744834);
		await ingestGame(deps, {
			...game,
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect(deps.purger.purged).toEqual([GAME_URL(744834), ...DAY_URLS(PAST_DATE)]);
	});
});

describe("owed purges (S212 review)", () =>
{
	it("S212 review owed: a purge that fails owes its URLs, and the cron's retry purges and clears them", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const deps = memoryDeps();
		const owed = new InMemoryOwedEdgePurgeRepository();
		const failing = failingPurger();
		deps.edgePurge = {
			purger: failing,
			origin: ORIGIN,
			owed,
		};
		await storeSchedule(deps, {
			...await finalDay(),
			fetchedAt: NOW.toISOString(),
			windowMode: "cache",
		});
		expect((await owed.listDue(NOW.toISOString(), 10)).map((purge) => purge.url)).toEqual(DAY_URLS(PAST_DATE).sort());
		deps.edgePurge = {
			purger: deps.purger,
			origin: ORIGIN,
			owed,
		};
		expect(await retryOwedEdgePurges(deps)).toBe(2);
		expect(deps.purger.calls).toEqual([DAY_URLS(PAST_DATE).sort()]);
		expect(await owed.listDue(NOW.toISOString(), 10)).toEqual([]);
		expect(await retryOwedEdgePurges(deps)).toBe(0);
		expect(deps.purger.calls).toHaveLength(1);
		warn.mockRestore();
	});

	it("S212 review owed again: a URL owed again while its retry is in flight stays owed after that retry settles", async () =>
	{
		const owed = new InMemoryOwedEdgePurgeRepository();
		const url = `${ORIGIN}/api/v1/games/744834`;
		await owed.owe([url], NOW.toISOString());
		const deps = {
			now: () => NOW,
			edgePurge: {
				origin: ORIGIN,
				owed,
				purger: {
					// Listed, then a write fails to purge the same URL again before this purge answers.
					purge: async () => owed.owe([url], new Date(NOW.getTime() + 1000).toISOString()),
				},
			},
		};
		expect(await retryOwedEdgePurges(deps)).toBe(1);
		expect(await owed.listDue(NOW.toISOString(), 10)).toEqual([{
			url,
			owedAt: new Date(NOW.getTime() + 1000).toISOString(),
			version: 2,
			failures: 0,
		}]);
	});

	it("S212 review owed backoff: a retry that keeps failing waits a minute, then twice as long each time up to 6 h, and is given up after 30 days", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		expect(OWED_PURGE_GIVE_UP_MS).toBe(PAST_EDGE_TTL_S * 1000);
		expect([1, 2, 3, 9, 10, 50].map(owedPurgeRetryDelayMs)).toEqual([
			OWED_PURGE_FIRST_RETRY_MS,
			2 * OWED_PURGE_FIRST_RETRY_MS,
			4 * OWED_PURGE_FIRST_RETRY_MS,
			256 * OWED_PURGE_FIRST_RETRY_MS,
			OWED_PURGE_MAX_RETRY_MS,
			OWED_PURGE_MAX_RETRY_MS,
		]);
		const owed = new InMemoryOwedEdgePurgeRepository();
		await owed.owe([`${ORIGIN}/api/v1/games/1`], NOW.toISOString());
		const failing = failingPurger();
		let clock = NOW.getTime();
		const deps = {
			now: () => new Date(clock),
			edgePurge: {
				origin: ORIGIN,
				owed,
				purger: failing,
			},
		};
		// Every minute (one cron tick) for 30 days: a request only when the backoff allows one.
		for (; clock < NOW.getTime() + OWED_PURGE_GIVE_UP_MS + 6 * 3600_000; clock += 60_000) await retryOwedEdgePurges(deps);
		// 1, 2, 4 … 256 minutes (9 requests, about 8.5 h), then one every 6 h until 30 days: far from one a minute.
		expect(failing.sent.length).toBeGreaterThan(100);
		expect(failing.sent.length).toBeLessThan(130);
		expect(await owed.listDue(new Date(clock).toISOString(), 10)).toEqual([]);
		warn.mockRestore();
	});
});
