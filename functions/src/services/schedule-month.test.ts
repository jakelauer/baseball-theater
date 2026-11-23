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
import { storeSchedule } from "./ingest.js";
import { getScheduleMonth } from "./schedule-month.js";
import { RefreshCoordinator } from "./refresh.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** In the 2026 off-season: 2026 is the current season, 2024 a past one. */
const T0 = new Date("2026-11-09T17:00:00Z");
const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");

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
					regularSeason: boolean | null;
					regularSeasonTeamIds: number[] | null;
					inSeasonTeamIds: number[] | null; }[]; };
			return {
				body,
				count: (date: string) => body.days.find((day) => day.date === date)?.count,
				teams: (date: string) => body.days.find((day) => day.date === date)?.teamIds,
				regularSeason: (date: string) => body.days.find((day) => day.date === date)?.regularSeason,
				regularSeasonTeams: (date: string) => body.days.find((day) => day.date === date)?.regularSeasonTeamIds,
				inSeason: (date: string) => body.days.find((day) => day.date === date)?.inSeasonTeamIds,
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

/**
 * Stores every other day of `month`'s calendar year the way ingest does (`store`, fetched and
 * changed at `at`, `T0` by default), as MLB publishes a season: one regular-season game on the
 * 15th of each month from March through October, none on the other days. A test of the month's own
 * fill then sees only the month's days to ask: the year holds no missing day and no season month
 * stored without games, the two kinds S191 adds to the one request. `leaveOut` names other months
 * (`YYYY-MM`) to leave unstored.
 */
async function holdRestOfYear(repos: Repos, month: string, leaveOut: string[] = [], at: Date = T0): Promise<void>
{
	const [game] = await mixedGames();
	for (const date of datesBetween(`${month.slice(0, 4)}-01-01`, `${month.slice(0, 4)}-12-31`))
	{
		if (date.startsWith(month) || leaveOut.some((other) => date.startsWith(other))) continue;
		const seasonMonth = date.slice(5, 7) >= "03" && date.slice(5, 7) <= "10";
		await store(repos, date, seasonMonth && date.endsWith("-15") ? [game!] : [], at);
	}
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
			regularSeasonTeamIds: null,
			inSeasonTeamIds: null,
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
			regularSeasonTeamIds: null,
			inSeasonTeamIds: null,
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

/**
 * Stores every day of `year` the way ingest does, with no games except on `regular`'s days, where
 * each listed `[away, home]` pair plays a regular-season game (S191), and on `spring`'s, a spring one.
 */
async function storeYear(repos: Repos, year: number, regular: Record<string, [number, number][]>, spring: Record<string, [number, number][]> = {}): Promise<void>
{
	const [template] = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games;
	let gamePk = 900000;
	const game = (gameType: string, [away, home]: [number, number]): ScheduleGameSummary => ({
		...template!,
		gamePk: gamePk++,
		gameType,
		teams: {
			away: {
				...template!.teams.away,
				id: away,
			},
			home: {
				...template!.teams.home,
				id: home,
			},
		},
	});
	for (const date of datesBetween(`${year}-01-01`, `${year}-12-31`))
	{
		await store(repos, date, [
			...(regular[date] ?? []).map((pair) => game("R", pair)),
			...(spring[date] ?? []).map((pair) => game("S", pair)),
		]);
	}
}

describe.each([["memory", async () => memoryRepos()], ["PGlite", pgliteRepos]] as const)("S191 %s", (_name, makeRepos) =>
{
	// 2024, modelled: the Seoul series (Dodgers 119 – Padres 135) on March 20 and 21 beside a spring
	// game (Yankees 147 – Red Sox 111 on the 20th), then everyone from March 28 through September 29.
	const regular: Record<string, [number, number][]> = {
		"2024-03-20": [[119, 135]],
		"2024-03-21": [[135, 119]],
		"2024-03-28": [[119, 135], [147, 111]],
		"2024-09-29": [[119, 135], [147, 111]],
	};
	const spring: Record<string, [number, number][]> = {
		"2024-03-20": [[147, 111]],
	};

	it("S191 AC 4 fields: each day carries regularSeasonTeamIds and inSeasonTeamIds; the Seoul opener's in-season teams are the Dodgers and Padres, read from the year", async () =>
	{
		const repos = await makeRepos();
		await storeYear(repos, 2024, regular, spring);
		const {
			regularSeasonTeams, inSeason, teams,
		} = await api(repos).month("2024-03");
		expect(teams("2024-03-20")).toEqual([111, 119, 135, 147]);
		expect(regularSeasonTeams("2024-03-20")).toEqual([119, 135]);
		expect(inSeason("2024-03-20")).toEqual([119, 135]);
		expect(regularSeasonTeams("2024-03-25")).toEqual([]);
		expect(inSeason("2024-03-25")).toEqual([119, 135]);
		expect(inSeason("2024-03-28")).toEqual([111, 119, 135, 147]);
		expect(inSeason("2024-03-01")).toEqual([]);
		// September's answer reads the same year: the season's last day, then none.
		const september = await api(repos).month("2024-09");
		expect(september.inSeason("2024-09-29")).toEqual([111, 119, 135, 147]);
		expect(september.inSeason("2024-09-30")).toEqual([]);
	});

	it("S191 AC 4 unknown: a month whose year isn't fully stored answers inSeasonTeamIds null where it can't tell, and regularSeasonTeamIds null on an unstored day", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games);
		const { regularSeasonTeams, inSeason } = await api(repos).month("2024-07");
		expect(regularSeasonTeams("2024-07-04")).toEqual([111, 120, 121, 147]);
		expect(inSeason("2024-07-04")).toBeNull();
		expect(regularSeasonTeams("2024-07-05")).toBeNull();
		expect(inSeason("2024-07-05")).toBeNull();
	});

	it("S191 AC 4 shared: the answer is one public, cached response that names no favorites (ADR-021)", async () =>
	{
		const repos = await makeRepos();
		await storeYear(repos, 2024, regular, spring);
		const response = await api(repos).get("/api/v1/schedule/month/2024-03");
		expect(response.status).toBe(200);
		expect(await response.text()).not.toMatch(/favorite/i);
		expect(response.headers.get("Cache-Control")).toMatch(/public/);
	});
});

describe("S191 AC 2 one read", () =>
{
	it("S191 AC 2 one read: a past month reads its whole calendar year with one repository query, never one per day or per month", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2024-07-04", await mixedGames());
		const calls: [string, string][] = [];
		let days = 0;
		const schedules: ScheduleRepository = {
			getByDate: (date) =>
			{
				days++;
				return repos.schedules.getByDate(date);
			},
			upsert: (day) => repos.schedules.upsert(day),
			listGameCounts: (from, to) =>
			{
				calls.push([from, to]);
				return repos.schedules.listGameCounts(from, to);
			},
		};
		await api({
			...repos,
			schedules,
		}).month("2024-07");
		expect(calls).toEqual([["2024-01-01", "2024-12-31"]]);
		expect(days).toBe(0);
	});
});

describe("S191 AC 2 year fill (owner, 2026-11-23: \"Fetch the year (Recommended)\")", () =>
{
	/** The schedule repository over `repos`, recording each `listGameCounts` range. */
	function countingSchedules(repos: Repos, calls: [string, string][]): ScheduleRepository
	{
		return {
			getByDate: (date) => repos.schedules.getByDate(date),
			upsert: (day) => repos.schedules.upsert(day),
			listGameCounts: (from, to) =>
			{
				calls.push([from, to]);
				return repos.schedules.listGameCounts(from, to);
			},
		};
	}

	it("S191 AC 2 year fill: a month inside the window with nothing stored asks MLB once for its whole year, so its days can tell their in-season teams", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		// 2027, modelled: an opener on March 20 (121 at 120, 147 at 111, both R), the same teams on the
		// 15th of each month through September, and the season's last day, October 3.
		mlb.gamesOn.set("2027-03-20", await mixedGames());
		for (const month of ["04", "05", "06", "07", "08", "09"]) mlb.gamesOn.set(`2027-${month}-15`, await mixedGames());
		mlb.gamesOn.set("2027-10-03", await mixedGames());
		const { inSeason, count } = await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-01-01", "2027-12-31"]]);
		expect(mlb.days).toBe(0);
		expect(mlb.games).toBe(0);
		expect(count("2027-04-01")).toBe(0);
		expect(inSeason("2027-04-01")).toEqual([111, 120, 121, 147]);
		expect(await repos.schedules.listGameCounts("2027-01-01", "2027-12-31")).toHaveLength(365);
		// The year is held now: another month of it asks nothing and answers from what is stored.
		const march = await api(repos, mlb).month("2027-03");
		expect(mlb.ranges).toHaveLength(1);
		expect(march.inSeason("2027-03-19")).toEqual([]);
		expect(march.inSeason("2027-03-20")).toEqual([111, 120, 121, 147]);
	});

	it("S191 AC 2 year fill: with the month held and fresh, only the year's missing days are asked, in one range", async () =>
	{
		const repos = memoryRepos();
		for (const date of datesBetween("2027-01-01", "2027-06-30")) await store(repos, date, []);
		for (const date of datesBetween("2027-09-01", "2027-12-31")) await store(repos, date, []);
		const mlb = new CountingClient();
		await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-07-01", "2027-08-31"]]);
	});

	it("S191 AC 2 year fill: a stale month and the year's missing days share the one range, from the first to the last", async () =>
	{
		const repos = memoryRepos();
		// December is missing: the stale April and the missing December make one range.
		await holdRestOfYear(repos, "2027-04", ["2027-12"]);
		for (const date of datesBetween("2027-04-01", "2027-04-30")) await store(repos, date, [], new Date(T0.getTime() - 30 * DAY));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-12-31"]]);
	});

	it("S191 AC 2 year fill: once the year is held, production-shaped rows, a fresh isolate per read and the cron changing today never ask for the whole year again", async () =>
	{
		const repos = memoryRepos();
		const games = await mixedGames();
		const mlb = new CountingClient();
		// A published 2026: a regular-season game on the 15th of each month, March through October.
		for (const month of ["03", "04", "05", "06", "07", "08", "09", "10"]) mlb.gamesOn.set(`2026-${month}-15`, games);
		// The first read holds nothing of the year, so it asks for the whole year once.
		await api(repos, mlb).month("2026-07");
		expect(mlb.ranges).toEqual([["2026-01-01", "2026-12-31"]]);
		for (let step = 1; step <= 4; step++)
		{
			const at = new Date(T0.getTime() + step * 7 * MINUTE);
			// The cron stores today (2026-11-09) again with changed content, as `store` writes it.
			await store(repos, "2026-11-09", step % 2 === 1 ? games.slice(0, 1) : games.slice(1), at);
			// Each read in a fresh isolate: its own refresh coordinator, remembering nothing.
			await api(repos, mlb, at).month("2026-07");
			await api(repos, mlb, at).month("2026-04");
		}
		for (const [from, to] of mlb.ranges.slice(1))
		{
			expect([from, to]).not.toEqual(["2026-01-01", "2026-12-31"]);
			expect(from.slice(0, 7), `${from}..${to}`).toBe(to.slice(0, 7));
		}
	});

	it("S191 AC 2 year fill: other months stored empty long ago (before MLB published) are asked again with the month, so April 30 never drops a team still in season", async () =>
	{
		const repos = memoryRepos();
		const longAgo = new Date(T0.getTime() - 400 * DAY);
		for (const date of datesBetween("2027-01-01", "2027-12-31")) await store(repos, date, [], longAgo);
		// April is held fresh with its games (121 at 120, 147 at 111, R) on the 1st through the 29th.
		const games = await mixedGames();
		for (const date of datesBetween("2027-04-01", "2027-04-29")) await store(repos, date, games);
		// MLB has since published the rest of the season: the same teams play again on September 26.
		const mlb = new CountingClient();
		for (const date of datesBetween("2027-04-01", "2027-04-29")) mlb.gamesOn.set(date, games);
		mlb.gamesOn.set("2027-09-26", games);
		const { inSeason } = await api(repos, mlb).month("2027-04");
		const lastDay = inSeason("2027-04-30");
		// Refreshed (the Yankees in season) or can't tell (null): never a list without 147.
		expect(lastDay === null || lastDay!.includes(147)).toBe(true);
		expect(lastDay).toEqual([111, 120, 121, 147]);
		// The season's months stored with no games (March, May through October), in one range.
		expect(mlb.ranges).toEqual([["2027-03-01", "2027-10-31"]]);
	});

	it("S191 AC 2 year fill: a season month MLB keeps answering empty (a lockout) is asked once, under its own key, and not again inside its lifetime", async () =>
	{
		const repos = memoryRepos();
		// A published 2027 but for April, stored empty a day ago; MLB still answers April with no games.
		await holdRestOfYear(repos, "2027-06", ["2027-04"]);
		for (const date of datesBetween("2027-06-01", "2027-06-30")) await store(repos, date, []);
		for (const date of datesBetween("2027-04-01", "2027-04-30")) await store(repos, date, [], new Date(T0.getTime() - DAY));
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		await reader.month("2027-06");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-04-30"]]);
		// Past the coordinator's one-minute cooldown, inside the lifetime April's check earned: nothing is asked.
		reader.clock.now = new Date(T0.getTime() + 2 * MINUTE);
		await reader.month("2027-06");
		await reader.month("2027-08");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-04-30"]]);
	});

	it("S191 AC 2 year fill: a season month already past (before MLB's today's month) stored empty was cancelled, and is never asked for", async () =>
	{
		const repos = memoryRepos();
		// 2026 is the current season (MLB's today is 2026-11-09): July stored empty long ago, the rest published.
		await holdRestOfYear(repos, "2026-09", ["2026-07"]);
		for (const date of datesBetween("2026-09-01", "2026-09-30")) await store(repos, date, []);
		for (const date of datesBetween("2026-07-01", "2026-07-31")) await store(repos, date, [], new Date(T0.getTime() - 30 * DAY));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-09");
		expect(mlb.ranges).toEqual([]);
	});

	it("S191 AC 2 outside window: a month of an earlier season asks MLB nothing, however little of its year is stored", async () =>
	{
		const repos = memoryRepos();
		await store(repos, "2025-07-04", await mixedGames());
		const mlb = new CountingClient();
		const { inSeason } = await api(repos, mlb).month("2025-07");
		expect(mlb.ranges).toEqual([]);
		expect(inSeason("2025-07-04")).toBeNull();
	});

	it("S191 AC 2 fill read: a filled month reads its year once, then only the filled range, and answers with the filled days", async () =>
	{
		const repos = memoryRepos();
		for (const date of datesBetween("2027-01-01", "2027-03-31")) await store(repos, date, []);
		const mlb = new CountingClient();
		mlb.gamesOn.set("2027-04-12", await mixedGames());
		const calls: [string, string][] = [];
		const { count } = await api({
			...repos,
			schedules: countingSchedules(repos, calls),
		}, mlb).month("2027-04");
		expect(mlb.ranges).toEqual([["2027-04-01", "2027-12-31"]]);
		expect(calls).toEqual([["2027-01-01", "2027-12-31"], ["2027-04-01", "2027-12-31"]]);
		expect(count("2027-04-12")).toBe(2);
		expect(count("2027-04-13")).toBe(0);
	});

	it("S191 AC 2 fill read: a fill MLB didn't answer reads nothing more", async () =>
	{
		const repos = memoryRepos();
		const mlb = new CountingClient();
		mlb.fail = true;
		const calls: [string, string][] = [];
		await api({
			...repos,
			schedules: countingSchedules(repos, calls),
		}, mlb).month("2027-04");
		expect(calls).toEqual([["2027-01-01", "2027-12-31"]]);
	});

	it("S191 AC 2 year lifetime: a past month unchanged for a month drops to the floor when a day in another month of its year changes now", async () =>
	{
		const repos = memoryRepos();
		const longAgo = new Date(T0.getTime() - 30 * DAY);
		for (const date of datesBetween("2024-01-01", "2024-12-31")) await store(repos, date, [], longAgo);
		const reader = api(repos);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=172800, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
		// A backfill corrects a March day now: July's answer reads March (its in-season teams), so it changes too.
		await store(repos, "2024-03-20", await mixedGames(), T0);
		expect((await reader.month("2024-07")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});
});

describe("S124 AC 2", () =>
{
	it("S124 AC 2 empty month: one schedule request for the whole month, no game request", async () =>
	{
		const repos = memoryRepos();
		await holdRestOfYear(repos, "2026-12");
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
		await holdRestOfYear(repos, "2026-12");
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
		await holdRestOfYear(repos, "2027-04");
		// The ends it holds have a game each, as an April of a published season does.
		const [game] = await mixedGames();
		await store(repos, "2027-04-01", [game!]);
		await store(repos, "2027-04-30", [game!]);
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
		const lateRepos = memoryRepos();
		await holdRestOfYear(lateRepos, "2026-12", [], new Date("2027-01-01T03:00:00Z"));
		await api(lateRepos, late, new Date("2027-01-01T03:00:00Z")).month("2026-12");
		expect(late.ranges).toEqual([["2026-12-01", "2026-12-31"]]);
	});

	it("S124 AC 2 store failure: a schedule write that fails rejects the read, rather than passing for MLB being unreachable", async () =>
	{
		const repos = memoryRepos();
		await holdRestOfYear(repos, "2026-12");
		let writes = 0;
		const schedules: ScheduleRepository = {
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
		expect(asked).toHaveLength(1);
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
		await holdRestOfYear(repos, "2026-12");
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
		await holdRestOfYear(repos, "2027-04");
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
		await holdRestOfYear(repos, "2026-09");
		const { count } = await api(repos, mlb).month("2026-09");
		expect(urls).toHaveLength(1);
		expect(new URL(urls[0]!).searchParams.get("startDate")).toBe("2026-09-01");
		expect(count("2026-09-05")).toBe(15);
		expect(count("2026-09-04")).toBe(0);
		expect(count("2026-09-30")).toBe(0);
		expect((await repos.schedules.getByDate("2026-09-04"))?.games).toEqual([]);
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

	it("S124 AC 3 headers reset: a month with an unknown day is checked again at the floor", async () =>
	{
		expect((await api(await makeRepos()).month("2019-05")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
	});

	it("S124 AC 3 headers reset: a partly stored past month is checked again at the floor, not by its stored day's age", async () =>
	{
		const repos = await makeRepos();
		await store(repos, "2024-07-04", [], new Date(T0.getTime() - 30 * DAY));
		expect((await api(repos).month("2024-07")).cacheControl).toBe(`public, s-maxage=300, stale-while-revalidate=${STALE_WHILE_REVALIDATE_S}`);
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

	it("S124 AC 3 lifetime: a month whose every day was fetched a minute ago is not asked, even by a fresh isolate", async () =>
	{
		const repos = await makeRepos();
		await holdRestOfYear(repos, "2026-12");
		for (const date of datesBetween("2026-12-01", "2026-12-31")) await store(repos, date, [], new Date(T0.getTime() - MINUTE));
		const mlb = new CountingClient();
		await api(repos, mlb).month("2026-12");
		expect(mlb.ranges).toEqual([]);
	});

	it("S124 AC 3 oldest check: the month counts as checked at its oldest day's fetch, so one old day makes it stale", async () =>
	{
		const repos = await makeRepos();
		await holdRestOfYear(repos, "2026-12");
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

	it("S124 AC 3 gains games after expiry: a future month stored empty gains its games once its lifetime has run out, with one schedule request and no game request", async () =>
	{
		const repos = await makeRepos();
		await holdRestOfYear(repos, "2027-03");
		const mlb = new CountingClient();
		const reader = api(repos, mlb);
		expect((await reader.month("2027-03")).body.days.every((day) => day.count === 0)).toBe(true);
		expect(mlb.ranges).toHaveLength(1);
		// Inside its lifetime nothing is asked again.
		expect((await reader.month("2027-03")).count("2027-03-26")).toBe(0);
		expect(mlb.ranges).toHaveLength(1);
		// MLB publishes the schedule; past the floor's five minutes the next read asks once more.
		mlb.gamesOn.set("2027-03-26", await mixedGames());
		reader.clock.now = new Date(T0.getTime() + 6 * MINUTE);
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
		const repos = memoryRepos();
		await holdRestOfYear(repos, "2027-12");
		const { get, month } = api(repos, mlb);
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
