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
import {
	finalDay, finalGame, memoryDeps, NOW, ORIGIN, PAST_DATE, storePastDay,
} from "../test/past-data.js";
import { edgePurgeFor } from "../worker-app.js";
import {
	getOrRefreshSchedule, ingestGame, storeSchedule,
} from "./ingest.js";
import { fillScheduleMonth } from "./schedule-month.js";

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
