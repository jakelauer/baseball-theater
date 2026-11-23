/**
 * S124: games per day for a month, from BT's stored schedule days, through the API route.
 * Every test runs at a fixed clock in November 2026, so 2026 is the current season: its days
 * and later ones may be filled from MLB (a counting fake), earlier seasons never are.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import { datesBetween, scheduleWindowMode } from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, MlbStatsClient, ScheduleRepository,
} from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { migratedPglite } from "../adapters/postgres/migrate.js";
import {
	PostgresGameProjectionRepository, PostgresGameRepository, PostgresScheduleRepository,
} from "../adapters/postgres/repos.js";
import { STALE_WHILE_REVALIDATE_S } from "../handlers/cache-control.js";
import { handleApiRequest } from "../handlers/api.js";
import { recordedClient } from "../test/recorded-mlb.js";
import type { IngestDeps } from "./ingest.js";
import { scheduleDayWindowMode, storeSchedule } from "./ingest.js";
import { fillScheduleMonth, getScheduleMonth } from "./schedule-month.js";
import { RefreshCoordinator } from "./refresh.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** In the 2026 off-season: 2026 is the current season, 2024 a past one. */
const T0 = new Date("2026-11-09T17:00:00Z");
const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
/** What a month with an unknown day is sent with (#399): kept for the fill's one-minute cooldown, nothing stale after. */
const INCOMPLETE_MONTH_CACHE = "public, s-maxage=60";

type Repos = {
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
};

/** An MLB client that counts what it is asked, answering a range with `gamesOn`'s games (none by default). */
class CountingClient extends FixtureMlbStatsClient
{
	readonly ranges: [string, string][] = [];
	days = 0;
	games = 0;
	fail = false;
	readonly gamesOn = new Map<string, ScheduleGameSummary[]>();

	override async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		this.ranges.push([startDate, endDate]);
		if (this.fail) throw new Error("MLB unreachable");
		return datesBetween(startDate, endDate).map((date) => ({
			date,
			games: this.gamesOn.get(date) ?? [],
			fetchedAt: "",
			windowMode: "cache",
		}));
	}

	override async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		this.days++;
		return super.fetchSchedule(date);
	}

	override async fetchGame(gamePk: number): ReturnType<FixtureMlbStatsClient["fetchGame"]>
	{
		this.games++;
		return super.fetchGame(gamePk);
	}
}

/** `repo`'s month record methods (S194), for a hand-built schedule repository that wraps it. */
function monthChecks(repo: ScheduleRepository): Pick<ScheduleRepository, "listScheduleMonthChecks" | "recordScheduleMonthCheck" | "claimScheduleMonth">
{
	return {
		listScheduleMonthChecks: (from, to) => repo.listScheduleMonthChecks(from, to),
		recordScheduleMonthCheck: (month, checkedAt) => repo.recordScheduleMonthCheck(month, checkedAt),
		claimScheduleMonth: (month, at) => repo.claimScheduleMonth(month, at),
	};
}

function memoryRepos(): Repos
{
	return {
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
	};
}

async function pgliteRepos(): Promise<Repos>
{
	const { db } = await migratedPglite();
	return {
		schedules: new PostgresScheduleRepository(db),
		games: new PostgresGameRepository(db),
		projections: new PostgresGameProjectionRepository(db),
	};
}

/** The API over `repos`, read at whatever `clock.now` says (from `start`), with a fresh refresh coordinator. */
function api(repos: Repos, mlb: MlbStatsClient = new CountingClient(), start: Date = T0)
{
	const clock = {
		now: start,
	};
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx = {
		ingest: {
			mlb,
			...repos,
			now: () => clock.now,
			refresh: new RefreshCoordinator(() => clock.now),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return {
		clock,
		get: (route: string) => handleApiRequest(new Request(`http://localhost:8787${route}`), ctx),
		month: async (month: string) =>
		{
			const response = await handleApiRequest(new Request(`http://localhost:8787/api/v1/schedule/month/${month}`), ctx);
			expect(response.status).toBe(200);
			const body = await response.json() as { month: string;
				days: { date: string;
					count: number | null;
					teamIds: number[] | null;
					regularSeason: boolean | null; }[]; };
			return {
				body,
				count: (date: string) => body.days.find((day) => day.date === date)?.count,
				teams: (date: string) => body.days.find((day) => day.date === date)?.teamIds,
				regularSeason: (date: string) => body.days.find((day) => day.date === date)?.regularSeason,
				cacheControl: response.headers.get("Cache-Control"),
			};
		},
	};
}

/** A day's games, the first not yet played and the second postponed, as a stored schedule lists them. */
async function mixedGames(): Promise<ScheduleGameSummary[]>
{
	const [first, second] = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games;
	return [
		{
			...first!,
			status: {
				...first!.status,
				abstractGameState: "Preview",
				codedGameState: "S",
				detailedState: "Scheduled",
			},
		},
		{
			...second!,
			status: {
				...second!.status,
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed",
			},
		},
	];
}

/** Stores a schedule day the way ingest does (version-guarded, ADR-022; its window judged at `at`). */
async function store(repos: Repos, date: string, games: ScheduleGameSummary[], at: Date = T0): Promise<void>
{
	await storeSchedule(repos, {
		date,
		games,
		fetchedAt: at.toISOString(),
		windowMode: scheduleWindowMode(games, at),
	});
}

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S124 AC 1 %s", (_name, makeRepos) =>
{
	it("counts every day of the month from its stored schedule day, scheduled and postponed games included, with no game snapshots stored", async () =>
	{
		const repos = await makeRepos();
		const games = await mixedGames();
		await store(repos, "2024-07-04", games);
		await store(repos, "2024-07-05", []);
		const mlb = new CountingClient();
		const { body, count } = await api(repos, mlb).month("2024-07");
		expect(body.month).toBe("2024-07");
		expect(body.days.map((day) => day.date)).toEqual(datesBetween("2024-07-01", "2024-07-31"));
		expect(count("2024-07-04")).toBe(2);
		expect(count("2024-07-05")).toBe(0);
		expect(count("2024-07-06")).toBeNull();
		expect(await repos.games.listByDate("2024-07-04")).toEqual([]);
		// A past season is never asked of MLB here.
		expect(mlb.ranges).toEqual([]);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S136 AC 1 %s", (_name, makeRepos) =>
{
	it("S136 AC 1 teams: each stored day names its games' away and home teams once each, ascending (postponed and unplayed games included); a day with none is []", async () =>
	{
		const repos = await makeRepos();
		// 121 at 120 (not yet played) and 147 at 111 (postponed).
		await store(repos, "2024-07-04", await mixedGames());
		await store(repos, "2024-07-05", []);
		const { teams, count } = await api(repos).month("2024-07");
		expect(count("2024-07-04")).toBe(2);
		expect(teams("2024-07-04")).toEqual([111, 120, 121, 147]);
		expect(count("2024-07-05")).toBe(0);
		expect(teams("2024-07-05")).toEqual([]);
	});

	it("S136 AC 1 route null: a day BT holds no schedule for answers count null and teamIds null, and only such a day", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", await mixedGames());
		const { body } = await api(repos).month("2024-07");
		const day = body.days.find((d) => d.date === "2024-07-06");
		expect(day).toEqual({
			date: "2024-07-06",
			count: null,
			teamIds: null,
			regularSeason: null,
		});
		for (const d of body.days) expect(d.teamIds === null, d.date).toBe(d.count === null);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S167 %s", (_name, makeRepos) =>
{
	it("S167 AC 3 route null: a day BT holds no schedule for answers regularSeason null beside count null; a stored day answers its own", async () =>
	{
		const repos = await makeRepos();
		const [first, second] = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games;
		await store(repos, "2024-07-04", [{
			...first!,
			gameType: "R",
		}, {
			...second!,
			gameType: "S",
		}]);
		await store(repos, "2024-07-09", [{
			...first!,
			gameType: "A",
		}]);
		await store(repos, "2024-07-10", []);
		const { body, regularSeason } = await api(repos).month("2024-07");
		expect(body.days.find((d) => d.date === "2024-07-06")).toEqual({
			date: "2024-07-06",
			count: null,
			teamIds: null,
			regularSeason: null,
		});
		expect(regularSeason("2024-07-04")).toBe(true);
		expect(regularSeason("2024-07-09")).toBe(false);
		expect(regularSeason("2024-07-10")).toBe(false);
		for (const d of body.days) if (d.count === null) expect(d.regularSeason, d.date).toBeNull();
	});

	it("S167 AC 5: over the committed fixtures, the July 2024 month answer says regularSeason true for 2024-07-04", async () =>
	{
		const repos = await makeRepos();
		// The fixture day as the fixture client serves it, its gameType from fixtures/schedule-2024-07-04.json.
		await store(repos, "2024-07-04", (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games);
		const { regularSeason, count } = await api(repos).month("2024-07");
		expect(count("2024-07-04")).toBe(2);
		expect(regularSeason("2024-07-04")).toBe(true);
	});
});

describe("S124 AC 1 one query", () =>
{
	it("S136 AC 1 one query: reads a month's counts and teams with one repository query, never one per day", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2024-07-04", await mixedGames());
		const calls = {
			list: 0,
			day: 0,
		};
		const schedules: ScheduleRepository = {
			...monthChecks(repos.schedules),
			getByDate: (date) =>
			{
				calls.day++;
				return repos.schedules.getByDate(date);
			},
			upsert: (day) => repos.schedules.upsert(day),
			listGameCounts: (from, to) =>
			{
				calls.list++;
				return repos.schedules.listGameCounts(from, to);
			},
		};
		const { teams } = await api({
			...repos,
			schedules,
		}).month("2024-07");
		expect(teams("2024-07-04")).toEqual([111, 120, 121, 147]);
		expect(calls).toEqual({
			list: 1,
			day: 0,
		});
	});
});

describe("S124 AC 2", () =>
{
	it("S124 AC 2 empty month: one schedule request for the whole month, no game request", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const { count } = await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
		expect(count("2026-12-12")).toBe(2);
		expect(count("2026-12-13")).toBe(0);
		expect((await repos.schedules.getByDate("2026-12-12"))?.version).toBe(1);
		// Each filled day's window is judged at the fill (`scheduleWindowMode`), day by day.
		const twelfth = await repos.schedules.getByDate("2026-12-12");
		expect(twelfth?.windowMode).toBe(scheduleWindowMode(twelfth!.games, T0));
		expect((await repos.schedules.getByDate("2026-12-13"))?.windowMode).toBe("cache");
	});

	it("S136 AC 2 fill teams: a day the fill stores answers with its teams in the same response, with one schedule request and no game request", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const { count, teams } = await api(repos, mlb).month("2026-12");
		expect(count("2026-12-12")).toBe(2);
		expect(teams("2026-12-12")).toEqual([111, 120, 121, 147]);
		expect(teams("2026-12-13")).toEqual([]);
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
	});

	it("S124 AC 2 holding the ends: only the span between the days it holds is asked", async () =>
	{
		const repos = memoryRepos();
		// Checked an hour ago (S194): only the missing days need asking.
		await repos.schedules.recordScheduleMonthCheck("2027-04", new Date(T0.getTime() - 60 * MINUTE).toISOString());
		await store(repos, "2027-04-01", []);
		await store(repos, "2027-04-30", []);
		const mlb = new CountingClient();
		await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-02", "2027-04-29"]]);
	});

	it("S124 AC 2 season start: a month of an earlier season is never asked; MLB's today, not UTC's, sets the season", async () =>
	{
		const mlb = new CountingClient();
		const { body } = await api(memoryRepos(), mlb).month("2025-12");
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(mlb.ranges).toEqual([]);
		// 03:00 UTC on 2027-01-01 is still 2026-12-31 for MLB, so 2026 is still the current season.
		const late = new CountingClient();
		await api(memoryRepos(), late, new Date("2027-01-01T03:00:00Z")).month("2026-12");
		expect(late.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});

	it("S124 AC 2 store failure: a schedule write that fails rejects the read, rather than passing for MLB being unreachable", async () =>
	{
		const repos = memoryRepos();
		let writes = 0;
		const schedules: ScheduleRepository = {
			...monthChecks(repos.schedules),
			getByDate: (date) => repos.schedules.getByDate(date),
			upsert: async (day) =>
			{
				if (++writes === 3) throw new Error("database down");
				await repos.schedules.upsert(day);
			},
			listGameCounts: (from, to) => repos.schedules.listGameCounts(from, to),
		};
		const deps: IngestDeps = {
			...repos,
			schedules,
			mlb: new CountingClient(),
			now: () => T0,
		};
		await expect(getScheduleMonth(deps, "2026-12")).rejects.toThrow("database down");
		// The two days written before it stay (each write is version-guarded on its own).
		expect(await repos.schedules.listGameCounts("2026-12-01", "2026-12-31")).toHaveLength(2);
	});

	it("S124 AC 2 recorded range: the recorded client answers a range from its recorded days", async () =>
	{
		const { mlb, asked } = recordedClient();
		const { count } = await api(memoryRepos(), mlb).month("2026-09");
		// One range read: the month's five week-long requests (#399).
		expect(asked).toHaveLength(5);
		expect(count("2026-09-05")).toBe(15);
		expect(count("2026-09-06")).toBe(0);
	});

	it("S124 AC 2 concurrent: two reads at once share one request through the coordinator", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const reader = api(repos, mlb);
		const [a, b] = await Promise.all([reader.month("2026-12"), reader.month("2026-12")]);
		expect(mlb.ranges).toHaveLength(1);
		expect(a.count("2026-12-12")).toBe(2);
		expect(b.count("2026-12-12")).toBe(2);
	});

	it("S124 AC 2 concurrent without a coordinator: each read asks for itself, and both answers are right", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const deps: IngestDeps = {
			...repos,
			mlb,
			now: () => T0,
		};
		const [a, b] = await Promise.all([getScheduleMonth(deps, "2026-12"), getScheduleMonth(deps, "2026-12")]);
		expect(mlb.ranges).toHaveLength(2);
		for (const answer of [a, b]) expect(answer.days.find((day) => day.date === "2026-12-12")?.count).toBe(2);
		// Stored once: the second write of the same content kept its version (ADR-022).
		expect((await repos.schedules.getByDate("2026-12-12"))?.version).toBe(1);
		// Inside the lifetime a later read asks nothing.
		await getScheduleMonth(deps, "2026-12");
		expect(mlb.ranges).toHaveLength(2);
	});

	it("S124 AC 2 holding one day: the days around it are filled with one schedule request, no game request", async () =>
	{
		const repos = memoryRepos();
		const games = await mixedGames();
		await store(repos, "2027-04-05", games);
		const mlb = new CountingClient();
		mlb.gamesOn.set("2027-04-05", games);
		mlb.gamesOn.set("2027-04-20", games.slice(0, 1));
		const { count } = await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-04-30"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
		expect(count("2027-04-05")).toBe(2);
		expect(count("2027-04-20")).toBe(1);
		expect(count("2027-04-01")).toBe(0);
		// The day it held was unchanged, so the version guard wrote nothing new (ADR-022).
		expect((await repos.schedules.getByDate("2027-04-05"))?.version).toBe(1);
	});

	it("S124 AC 2 null: a day still unknown after the request (it failed) is null, distinct from a stored day with no games", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2026-12-25", []);
		const mlb = new CountingClient();
		mlb.fail = true;
		const { count, body } = await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toHaveLength(1);
		expect(count("2026-12-25")).toBe(0);
		expect(count("2026-12-24")).toBeNull();
		expect(body.days.filter((day) => day.count === null)).toHaveLength(30);
	});

	it("S124 AC 2 null: a past month nothing stored is all null, and MLB is not asked", async () =>
	{
		const mlb = new CountingClient();
		const { body } = await api(memoryRepos(), mlb).month("2019-05");
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(mlb.ranges).toEqual([]);
		expect(mlb.days).toBe(0);
	});

	it("S124 AC 2 absent day: MLB's range answer lists only days with games; the others are stored with none, not another day's games", async () =>
	{
		const urls: string[] = [];
		const mlb = new HttpMlbStatsClient({
			now: () => T0,
			fetchImpl: async (input) =>
			{
				urls.push(String(input));
				return new Response(readFileSync(path.join(RAW, "schedule-2026-09-05.json")));
			},
		});
		const repos = memoryRepos();
		const { count } = await api(repos, mlb).month("2026-09");
		// One range, asked as week-long requests (#399).
		expect(urls.map((url) => new URL(url).searchParams.get("startDate")).sort()).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
		expect(count("2026-09-05")).toBe(15);
		expect(count("2026-09-04")).toBe(0);
		expect(count("2026-09-30")).toBe(0);
		expect((await repos.schedules.getByDate("2026-09-04"))?.games).toEqual([]);
	});
});

/**
 * #410: Hyperdrive caches read queries for up to a minute (#408), so the month read after a fill,
 * the same query with the same range as the read before it, came back as the pre-fill answer and a
 * freshly filled month was sent with every day unknown. The fake below answers `listGameCounts`
 * the way that cache did: always its first answer for a range.
 */
describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("a month read through a caching database (#410) %s", (_name, makeRepos) =>
{
	it("a fill answers every day it stored, even when the month read keeps returning its pre-fill answer (#410)", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2026-12-25", []);
		const cached = new Map<string, ReturnType<ScheduleRepository["listGameCounts"]>>();
		let reads = 0;
		const schedules: ScheduleRepository = {
			...monthChecks(repos.schedules),
			getByDate: (date) => repos.schedules.getByDate(date),
			upsert: (day) => repos.schedules.upsert(day),
			listGameCounts: (from, to) =>
			{
				reads++;
				const key = `${from}..${to}`;
				if (!cached.has(key)) cached.set(key, repos.schedules.listGameCounts(from, to));
				return cached.get(key)!;
			},
		};
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-12-12", await mixedGames());
		const {
			body, count, teams, cacheControl,
		} = await api({
			...repos,
			schedules,
		}, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
		expect(body.days.filter((day) => day.count === null).map((day) => day.date)).toEqual([]);
		expect(count("2026-12-12")).toBe(2);
		expect(teams("2026-12-12")).toEqual([111, 120, 121, 147]);
		expect(count("2026-12-25")).toBe(0);
		// A complete month just changed: the ladder's floor, not the incomplete month's cooldown.
		expect(cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		// The answer comes from what the fill stored, not from a second month read.
		expect(reads).toBe(1);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S124 AC 3 %s", (_name, makeRepos) =>
{
	it("S124 AC 3 headers reset: a past month unchanged for a month is cached for the cap, and one that changes drops to the floor", async () =>
	{
		const repos = await makeRepos();
		const longAgo = new Date(T0.getTime() - 30 * DAY);
		for (const date of datesBetween("2024-07-01", "2024-07-31")) await store(repos, date, [], longAgo);
		const reader = api(repos);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=172800, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		// A backfill fills a day of it now.
		await store(repos, "2024-07-04", await mixedGames(), T0);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("S124 AC 3 headers reset: a month with an unknown day is cached only as long as the fill's cooldown, with nothing stale served after (#399)", async () =>
	{
		expect((await api(await makeRepos()).month("2019-05")).cacheControl).toBe(INCOMPLETE_MONTH_CACHE);
	});

	it("S124 AC 3 headers reset: a partly stored past month is cached only as long as the fill's cooldown, whatever its stored day's age (#399)", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", [], new Date(T0.getTime() - 30 * DAY));
		expect((await api(repos).month("2024-07")).cacheControl).toBe(INCOMPLETE_MONTH_CACHE);
	});

	it("a fill MLB didn't answer is cached at the edge only as long as the fill's cooldown, not as a month with no games (#399)", async () =>
	{
		const mlb = new CountingClient();
		mlb.fail = true;
		const { body, cacheControl } = await api(await makeRepos(), mlb).month("2026-06");
		expect(mlb.ranges).toHaveLength(1);
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(cacheControl).toBe(INCOMPLETE_MONTH_CACHE);
	});

	it("a fill one of whose week requests fails stores nothing and answers the month unknown (#399)", async () =>
	{
		const mlb = new HttpMlbStatsClient({
			now: () => T0,
			fetchImpl: async (input) =>
				new URL(String(input)).searchParams.get("startDate") === "2026-09-15" ? new Response("{}", {
					status: 500,
				}) : new Response(readFileSync(path.join(RAW, "schedule-2026-09-05.json"))),
		});
		const repos = await makeRepos();
		const { body, cacheControl } = await api(repos, mlb).month("2026-09");
		expect(body.days.every((day) => day.count === null)).toBe(true);
		expect(await repos.schedules.getByDate("2026-09-05")).toBeNull();
		expect(cacheControl).toBe(INCOMPLETE_MONTH_CACHE);
	});

	it("S124 AC 3 lifetime: past the cooldown but inside the month's lifetime, nothing is asked again", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		await reader.month("2027-03");
		expect(mlb.ranges).toHaveLength(1);
		// Two minutes on: past the coordinator's one-minute cooldown, inside the five-minute floor.
		reader.clock.now = new Date(T0.getTime() + 2 * MINUTE);
		await reader.month("2027-03");
		expect(mlb.ranges).toHaveLength(1);
	});

	it("S124 AC 3 lifetime: a month checked a minute ago is not asked, even by a fresh isolate (S194: by its durable check record)", async () =>
	{
		const repos = await makeRepos();
		for (const date of datesBetween("2026-12-01", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - MINUTE));
		await repos.schedules.recordScheduleMonthCheck("2026-12", new Date(T0.getTime() - MINUTE).toISOString());
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([]);
	});

	it("S124 AC 3 oldest check (S194: a month with no check record is asked whole, however recently its days were fetched)", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2026-12-01", [], new Date(T0.getTime() - 30 * DAY));
		for (const date of datesBetween("2026-12-02", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - MINUTE));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});

	it("S124 AC 3 failed refresh: a fill MLB didn't answer isn't a check, so the month is asked again once the cooldown passes", async () =>
	{
		const repos = await makeRepos();
		// Every day stored and last changed three days ago: once checked now, the ladder would
		// give the month its 48-hour cap, so a failure counted as a check would hide it for two days.
		for (const date of datesBetween("2026-12-01", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - 3 * DAY));
		const mlb = new CountingClient();
		mlb.fail = true;
		const reader = api(repos, mlb);
		await reader.month("2026-12");
		expect(mlb.ranges).toHaveLength(1);
		mlb.fail = false;
		reader.clock.now = new Date(T0.getTime() + 2 * MINUTE);
		await reader.month("2026-12");
		expect(mlb.ranges).toHaveLength(2);
	});

	it("S124 AC 3 gains games after expiry: a future month stored empty gains its games once its check has run out, with one schedule request and no game request", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		expect((await reader.month("2027-03")).body.days.every((day) => day.count === 0)).toBe(true);
		expect(mlb.ranges).toHaveLength(1);
		// Inside its lifetime nothing is asked again.
		expect((await reader.month("2027-03")).count("2027-03-26")).toBe(0);
		expect(mlb.ranges).toHaveLength(1);
		// MLB publishes the schedule; once the month's check is older than the refresh interval and its
		// margin (S194: 6 h 30 min, a refresh that fell behind) the next read asks once more.
		mlb.gamesOn.set("2027-03-26", await mixedGames());
		reader.clock.now = new Date(T0.getTime() + 6 * 60 * MINUTE + 31 * MINUTE);
		const later = await reader.month("2027-03");
		expect(mlb.ranges).toEqual([["2027-03-01", "2027-03-31"], ["2027-03-01", "2027-03-31"]]);
		expect(mlb.games).toBe(0);
		expect(mlb.days).toBe(0);
		expect(later.count("2027-03-26")).toBe(2);
		expect(later.cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});
});

describe("S124 AC 5", () =>
{
	it("rejects a month before 1901-04, or a malformed one, with a 400", async () =>
	{
		const { get } = api(memoryRepos());
		for (const month of ["1901-03", "1900-12", "1901-4", "2026-13", "2026-00", "2026-1", "202601", "2026-01-01"])
		{
			const response = await get(`/api/v1/schedule/month/${month}`);
			expect(response.status, month).toBe(400);
			expect(await response.json()).toEqual({
				error: "month_invalid",
				hint: "YYYY-MM, 1901-04 or later",
			});
		}
	});

	it("S124 AC 5 horizon: a month after December of next year is a 400 and asks MLB nothing; December itself is answered", async () =>
	{
		const mlb = new CountingClient();
		const { get, month } = api(memoryRepos(), mlb);
		for (const tooLate of ["2028-01", "2099-07", "9999-12"])
		{
			const response = await get(`/api/v1/schedule/month/${tooLate}`);
			expect(response.status, tooLate).toBe(400);
			expect(await response.json()).toEqual({
				error: "month_too_late",
				hint: "YYYY-MM, 2027-12 or earlier",
			});
		}
		expect(mlb.ranges).toEqual([]);
		const { body } = await month("2027-12");
		expect(body.days).toHaveLength(31);
		expect(mlb.ranges).toEqual([["2027-12-01", "2027-12-31"]]);
	});

	it("S124 AC 5 horizon: next year is MLB's, not UTC's", async () =>
	{
		// 03:00 UTC on 2027-01-01 is 2026-12-31 for MLB: next year is still 2027.
		const early = api(memoryRepos(), new CountingClient(), new Date("2027-01-01T03:00:00Z"));
		expect((await early.get("/api/v1/schedule/month/2028-01")).status).toBe(400);
		expect((await early.month("2027-12")).body.days).toHaveLength(31);
		// By 06:00 UTC it is 2027-01-01 for MLB too, and 2028 is next year.
		const later = api(memoryRepos(), new CountingClient(), new Date("2027-01-01T06:00:00Z"));
		expect((await later.month("2028-01")).body.days).toHaveLength(31);
	});

	it("answers 1901-04, the earliest month, with every day", async () =>
	{
		const { body } = await api(memoryRepos()).month("1901-04");
		expect(body.days).toHaveLength(30);
	});
});

/**
 * #79, #323: the month fill judges a day's window the way the cron does, so a game suspended late
 * today keeps the day active for 6 hours from its suspension; an older day is judged by the clock
 * alone, since nothing polls it.
 */
describe("the month fill and suspended games (#79, #323)", () =>
{
	const SUSPENDED = {
		abstractGameState: "Live",
		codedGameState: "U",
		detailedState: "Suspended: Rain",
	};
	const IN_PROGRESS = {
		abstractGameState: "Live",
		codedGameState: "I",
		detailedState: "In Progress",
	};

	/** Fixture game `gamePk` on `date`, first pitch `startTime`, as the schedule lists it suspended. */
	async function suspendedOn(gamePk: number, date: string, startTime: string): Promise<ScheduleGameSummary>
	{
		const recorded = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games.find((g) => g.gamePk === gamePk)!;
		return {
			...recorded,
			officialDate: date,
			gameDate: startTime,
			startTime,
			status: SUSPENDED,
		};
	}

	async function storeGame(repos: Repos, gamePk: number, status: typeof SUSPENDED, changedAt: string, suspendedAt?: string)
	{
		await repos.games.upsert({
			...await new FixtureMlbStatsClient().fetchGame(gamePk),
			status,
			windowMode: "active",
			version: 1,
			lastChangedAt: changedAt,
			...(suspendedAt ? {
				suspendedAt,
			} : {}),
		});
	}

	function deps(repos: Repos, mlb: CountingClient): IngestDeps
	{
		return {
			mlb,
			...repos,
			now: () => T0,
		};
	}

	it("today: a game suspended at 12:00Z after a 01:00Z first pitch keeps the day active at 17:00Z", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-11-09", [await suspendedOn(745001, "2026-11-09", "2026-11-09T01:00:00Z")]);
		await storeGame(repos, 745001, SUSPENDED, "2026-11-09T12:00:00.000Z", "2026-11-09T12:00:00.000Z");
		await getScheduleMonth(deps(repos, mlb), "2026-11");
		expect((await repos.schedules.getByDate("2026-11-09"))?.windowMode).toBe("active");
	});

	it("an older day still listing a suspended game, resumed since under the same gamePk (stored in progress, active), stays cache", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-11-01", [await suspendedOn(744834, "2026-11-01", "2026-11-01T23:05:00Z")]);
		await storeGame(repos, 744834, IN_PROGRESS, new Date(T0.getTime() - 60 * MINUTE).toISOString());
		await getScheduleMonth(deps(repos, mlb), "2026-11");
		expect((await repos.schedules.getByDate("2026-11-01"))?.windowMode).toBe("cache");
	});
});

/** Stores every day of `month` with no games (or `gamesOn`'s), fetched and changed at `at`. */
async function storeMonth(repos: Repos, month: string, at: Date, gamesOn: Map<string, ScheduleGameSummary[]> = new Map()): Promise<void>
{
	const [year, m] = month.split("-").map(Number);
	const last = new Date(Date.UTC(year!, m!, 0)).getUTCDate();
	for (const date of datesBetween(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`)) await store(repos, date, gamesOn.get(date) ?? [], at);
}

/** The month record's `checkedAt` of `month`, or undefined with none. */
async function checkedAt(repos: Repos, month: string): Promise<string | null | undefined>
{
	return (await repos.schedules.listScheduleMonthChecks(month, month))[0]?.checkedAt;
}

const HOUR = 60 * MINUTE;
const FLOOR_CACHE = `public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;
const CAP_CACHE = `public, s-maxage=172800, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;
const PAST_YEAR_CACHE = `public, s-maxage=2147483647, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`;

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S194 AC 2 one fill %s", (_name, makeRepos) =>
{
	it("S194 AC 2 windowMode: a day the refresh's fill stores reads back with the windowMode scheduleDayWindowMode gives", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		const games = await mixedGames();
		mlb.gamesOn.set("2026-11-09", games);
		const deps: IngestDeps = {
			...repos,
			mlb,
			now: () => T0,
		};
		await fillScheduleMonth(deps, "2026-11", ["2026-11-01", "2026-11-30"], T0);
		const stored = await repos.schedules.getByDate("2026-11-09");
		expect(stored?.windowMode).toBe(await scheduleDayWindowMode(repos, {
			date: "2026-11-09",
			games,
		}, T0));
		expect(stored?.fetchedAt).toBe(T0.toISOString());
		expect(await checkedAt(repos, "2026-11")).toBe(T0.toISOString());
	});

	it("S194 AC 2 gap: a fill of only the missing days (rangeToAsk's gap span) leaves checkedAt as it was", async () =>
	{
		const repos = await makeRepos();
		const before = new Date(T0.getTime() - HOUR).toISOString();
		await repos.schedules.recordScheduleMonthCheck("2027-04", before);
		await store(repos, "2027-04-01", []);
		await store(repos, "2027-04-30", []);
		const mlb = new CountingClient();
		await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-02", "2027-04-29"]]);
		expect(await checkedAt(repos, "2027-04")).toBe(before);
	});

	it("S194 AC 2 MLB fails: a fill whose MLB request fails records no check", async () =>
	{
		const repos = await makeRepos();
		const mlb = new CountingClient();
		mlb.fail = true;
		expect(await fillScheduleMonth({
			...repos,
			mlb,
			now: () => T0,
		}, "2026-06", ["2026-06-01", "2026-06-30"], T0)).toBeNull();
		await api(repos, mlb).month("2026-07");
		expect(mlb.ranges).toHaveLength(2);
		expect(await repos.schedules.listScheduleMonthChecks("2026-01", "2027-12")).toEqual([]);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S194 AC 3 the route trusts the refresh %s", (_name, makeRepos) =>
{
	/** 2026-12 fully stored three days ago, its newest day changed a minute ago (today's games move it every tick). */
	async function busyMonth(): Promise<Repos>
	{
		const repos = await makeRepos();
		await storeMonth(repos, "2026-12", new Date(T0.getTime() - 3 * DAY));
		await store(repos, "2026-12-25", await mixedGames(), new Date(T0.getTime() - MINUTE));
		return repos;
	}

	it("S194 AC 3 checked 1 h: a fully stored month checked an hour ago, whose newest day changed a minute ago, makes zero MLB requests", async () =>
	{
		const repos = await busyMonth();
		await repos.schedules.recordScheduleMonthCheck("2026-12", new Date(T0.getTime() - HOUR).toISOString());
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([]);
	});

	it("S194 AC 3 checked 7 h: the same month checked seven hours ago makes one fill of its whole fillable range", async () =>
	{
		const repos = await busyMonth();
		await repos.schedules.recordScheduleMonthCheck("2026-12", new Date(T0.getTime() - 7 * HOUR).toISOString());
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
		expect(await checkedAt(repos, "2026-12")).toBe(T0.toISOString());
	});

	it("S194 AC 3 never checked: the same month never checked, every fetchedAt older than its ADR-021 lifetime, makes one fill", async () =>
	{
		const repos = await makeRepos();
		await storeMonth(repos, "2026-12", new Date(T0.getTime() - 30 * DAY));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S194 AC 7 versioned month URL %s", (_name, makeRepos) =>
{
	/** The versions answer for `year`, with its status and header. */
	async function versionsOf(reader: ReturnType<typeof api>, year: number | string)
	{
		const response = await reader.get(`/api/v1/schedule/month-versions/${year}`);
		return {
			status: response.status,
			cacheControl: response.headers.get("Cache-Control"),
			body: await response.json() as { year: number;
				versions: Record<string, string>; },
		};
	}

	/** The month route's `Cache-Control` for `month` asked with `?v=<v>`. */
	async function headerWith(reader: ReturnType<typeof api>, month: string, v: string): Promise<string | null>
	{
		const response = await reader.get(`/api/v1/schedule/month/${month}?v=${encodeURIComponent(v)}`);
		expect(response.status).toBe(200);
		return response.headers.get("Cache-Control");
	}

	/** Repos holding complete months, every in-window one checked an hour ago so reads ask MLB nothing. */
	async function stocked(months: string[]): Promise<Repos>
	{
		const repos = await makeRepos();
		for (const month of months)
		{
			await storeMonth(repos, month, new Date(T0.getTime() - 10 * DAY));
			await repos.schedules.recordScheduleMonthCheck(month, new Date(T0.getTime() - HOUR).toISOString());
		}
		return repos;
	}

	it("S194 AC 7 versions route: gives a version for each complete stored month of the year, one floor-cached answer, 400 outside 1901 through next year", async () =>
	{
		const repos = await stocked(["2024-07"]);
		await store(repos, "2024-08-04", []);
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		const {
			status, cacheControl, body,
		} = await versionsOf(reader, 2024);
		expect(status).toBe(200);
		expect(cacheControl).toBe(FLOOR_CACHE);
		expect(body.year).toBe(2024);
		expect(Object.keys(body.versions)).toEqual(["2024-07"]);
		expect(body.versions["2024-07"]).toMatch(/^[0-9a-f]{16}$/);
		expect(mlb.ranges).toEqual([]);
		for (const year of [1901, 2027]) expect((await versionsOf(reader, year)).status).toBe(200);
		for (const year of ["1900", "2028", "abcd", "202"])
		{
			const response = await reader.get(`/api/v1/schedule/month-versions/${year}`);
			expect(response.status, year).toBe(400);
			expect(await response.json()).toEqual({
				error: "year_invalid",
				hint: "YYYY, 1901 through 2027",
			});
		}
	});

	it("S194 AC 7 48 h: a month of the current or next year asked with its version is cached 48 h", async () =>
	{
		const reader = api(await stocked(["2026-05", "2027-03"]));
		const current = (await versionsOf(reader, 2026)).body.versions["2026-05"]!;
		const next = (await versionsOf(reader, 2027)).body.versions["2027-03"]!;
		expect(await headerWith(reader, "2026-05", current)).toBe(CAP_CACHE);
		expect(await headerWith(reader, "2027-03", next)).toBe(CAP_CACHE);
	});

	it("S194 AC 7 past year: a past year's month asked with its version is kept at the edge as long as it allows, with no max-age", async () =>
	{
		const reader = api(await stocked(["2024-07"]));
		const header = await headerWith(reader, "2024-07", (await versionsOf(reader, 2024)).body.versions["2024-07"]!);
		expect(header).toBe(PAST_YEAR_CACHE);
		expect(header).not.toMatch(/(^|[\s,])max-age=/);
	});

	it("S194 AC 7 wrong v: a version that doesn't match the answer is cached for the floor only", async () =>
	{
		const reader = api(await stocked(["2024-07", "2026-05"]));
		expect(await headerWith(reader, "2024-07", "0000000000000000")).toBe(FLOOR_CACHE);
		expect(await headerWith(reader, "2026-05", "")).toBe(FLOOR_CACHE);
	});

	it("S194 AC 7 January 1: at 03:00 UTC on January 1 (MLB's December 31), last year's months still count as the current year", async () =>
	{
		const repos = await stocked([]);
		await storeMonth(repos, "2026-07", new Date(T0.getTime() - 10 * DAY));
		await repos.schedules.recordScheduleMonthCheck("2026-07", "2026-12-31T20:00:00.000Z");
		const reader = api(repos, new CountingClient(), new Date("2027-01-01T03:00:00.000Z"));
		expect(await headerWith(reader, "2026-07", (await versionsOf(reader, 2026)).body.versions["2026-07"]!)).toBe(CAP_CACHE);
	});

	it("S194 AC 7 refresh changes: a refresh that changes a day's count changes the version of that month only (the other year's months keep theirs)", async () =>
	{
		const repos = await stocked(["2026-04", "2026-05", "2025-04"]);
		const reader = api(repos);
		const before = {
			...(await versionsOf(reader, 2026)).body.versions,
			...(await versionsOf(reader, 2025)).body.versions,
		};
		const mlb = new CountingClient();
		mlb.gamesOn.set("2026-04-10", await mixedGames());
		await fillScheduleMonth({
			...repos,
			mlb,
			now: () => T0,
		}, "2026-04", ["2026-04-01", "2026-04-30"], T0);
		const after = {
			...(await versionsOf(reader, 2026)).body.versions,
			...(await versionsOf(reader, 2025)).body.versions,
		};
		expect(after["2026-04"]).not.toBe(before["2026-04"]);
		expect(after["2026-05"]).toBe(before["2026-05"]);
		expect(after["2025-04"]).toBe(before["2025-04"]);
		// The new version is what the month route now sends: its URL is kept long.
		expect(await headerWith(reader, "2026-04", after["2026-04"]!)).toBe(CAP_CACHE);
		expect(await headerWith(reader, "2026-04", before["2026-04"]!)).toBe(FLOOR_CACHE);
	});

	it("S194 AC 7 unchanged: a refresh that changes nothing leaves every version as it was", async () =>
	{
		const repos = await stocked(["2026-04", "2026-05"]);
		const reader = api(repos);
		const before = (await versionsOf(reader, 2026)).body.versions;
		await fillScheduleMonth({
			...repos,
			mlb: new CountingClient(),
			now: () => T0,
		}, "2026-04", ["2026-04-01", "2026-04-30"], T0);
		expect((await versionsOf(reader, 2026)).body.versions).toEqual(before);
	});

	it("S194 AC 7 game state: a change to a game's state alone leaves the version as it was", async () =>
	{
		const repos = await stocked(["2026-04"]);
		const games = await mixedGames();
		await store(repos, "2026-04-10", games, new Date(T0.getTime() - HOUR));
		const reader = api(repos);
		const before = (await versionsOf(reader, 2026)).body.versions["2026-04"];
		const dayBefore = await repos.schedules.getByDate("2026-04-10");
		await store(repos, "2026-04-10", games.map((game) => ({
			...game,
			status: {
				...game.status,
				detailedState: "Warmup",
			},
		})), T0);
		expect((await repos.schedules.getByDate("2026-04-10"))?.lastChangedAt).not.toBe(dayBefore?.lastChangedAt);
		expect((await versionsOf(reader, 2026)).body.versions["2026-04"]).toBe(before);
	});

	it("S194 AC 7 backfill: re-storing a past year's day with a different count changes that month's version", async () =>
	{
		const repos = await stocked(["2024-07"]);
		const reader = api(repos);
		const before = (await versionsOf(reader, 2024)).body.versions["2024-07"];
		await store(repos, "2024-07-04", await mixedGames(), T0);
		const after = (await versionsOf(reader, 2024)).body.versions["2024-07"];
		expect(after).not.toBe(before);
		expect(await headerWith(reader, "2024-07", after!)).toBe(PAST_YEAR_CACHE);
	});
});

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S194 AC 8 without v %s", (_name, makeRepos) =>
{
	it("S194 AC 8 ladder: a complete month of any year asked without v stays on ADR-021's ladder, capped at 48 h", async () =>
	{
		const repos = await makeRepos();
		for (const month of ["2024-07", "2026-05"])
		{
			await storeMonth(repos, month, new Date(T0.getTime() - 10 * DAY));
			await repos.schedules.recordScheduleMonthCheck(month, new Date(T0.getTime() - HOUR).toISOString());
		}
		const reader = api(repos);
		expect((await reader.month("2024-07")).cacheControl).toBe(CAP_CACHE);
		expect((await reader.month("2026-05")).cacheControl).toBe(CAP_CACHE);
		// Changed a minute ago: the floor, whatever its year.
		await store(repos, "2024-07-04", await mixedGames(), new Date(T0.getTime() - MINUTE));
		expect((await reader.month("2024-07")).cacheControl).toBe(FLOOR_CACHE);
	});

	it("S194 AC 8 incomplete: an incomplete month keeps the short cache, with or without v", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", [], new Date(T0.getTime() - 30 * DAY));
		const reader = api(repos);
		expect((await reader.month("2024-07")).cacheControl).toBe(INCOMPLETE_MONTH_CACHE);
		const response = await reader.get("/api/v1/schedule/month/2024-07?v=0000000000000000");
		expect(response.headers.get("Cache-Control")).toBe(INCOMPLETE_MONTH_CACHE);
	});
});
