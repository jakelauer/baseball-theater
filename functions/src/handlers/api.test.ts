import type {
	DayDigestResponse, ScoreboardDefaultDateResponse, SeasonCalendar, StandingsResponse, StandingsSnapshot,
} from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { createServer } from "node:http";
import {
	describe, expect, it, vi,
} from "vitest";
import { toNodeListener } from "../adapters/node/http.js";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameStateRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { handleApiRequest } from "./api.js";
import { edgeCacheControl } from "./cache-control.js";
import { ingestScheduleDay } from "../services/ingest.js";

/**
 * A server over the fixtures; `now` fixes the ingest clock (S111's default date reads it), and
 * `prepare` may change what is stored before the server starts.
 */
async function withServer(run: (base: string) => Promise<void>, now?: () => Date, prepare?: (repos: { schedules: InMemoryScheduleRepository;
	games: InMemoryGameRepository;
	gameStates: InMemoryGameStateRepository; }) => Promise<void>, mlb: MlbStatsClient = new FixtureMlbStatsClient()): Promise<void>
{
	const gameStates = new InMemoryGameStateRepository();
	const schedules = new InMemoryScheduleRepository(gameStates);
	const games = new InMemoryGameRepository();
	const projections = new InMemoryGameProjectionRepository();
	const ingest = {
		mlb,
		schedules,
		games,
		projections,
		gameStates,
		...now && {
			now,
		},
	};
	await ingestScheduleDay(ingest, "2024-07-04");
	await prepare?.({
		schedules,
		games,
		gameStates,
	});

	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const server = createServer(toNodeListener((request) => handleApiRequest(request, {
		ingest,
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	})));

	// On 127.0.0.1, where the requests go, so another process listening on this port elsewhere can't answer them (#116).
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("no port");
	const base = `http://127.0.0.1:${addr.port}`;
	try
	{
		await run(base);
	}
	finally
	{
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
}

describe("handleApiRequest", () =>
{
	it("serves schedule and game", async () =>
	{
		await withServer(async (base) =>
		{
			const schedule = await fetch(`${base}/api/v1/schedule?date=2024-07-04`);
			expect(schedule.status).toBe(200);
			const day = (await schedule.json()) as { games: unknown[] };
			expect(day.games.length).toBe(2);

			const game = await fetch(`${base}/api/v1/games/744834`);
			expect(game.status).toBe(200);
			const body = (await game.json()) as { gamePk: number;
				plays: unknown[] };
			expect(body.gamePk).toBe(744834);
			expect(body.plays.length).toBe(61);
		});
	});

	it("default date in season (S111): MLB's today, the Eastern date, cacheable for five minutes", async () =>
	{
		// 23:30 Eastern on 2026-09-05 is already 09-06 in UTC; MLB's day is still the 5th.
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/scoreboard/default-date`);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("public, max-age=300");
			expect((await response.json()) as ScoreboardDefaultDateResponse).toEqual({
				date: "2026-09-05",
			});
		}, () => new Date("2026-09-06T03:30:00Z"));
	});

	it("default date in the off-season (S111): the last World Series game until spring", async () =>
	{
		// After 2026's five-game Series ended on 10-28 (MLB's calendar still said 10-31).
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/scoreboard/default-date`)).json()) as ScoreboardDefaultDateResponse;
			expect(body.date).toBe("2026-10-28");
		}, () => new Date("2026-11-02T17:00:00Z"));
		// January, before 2026's spring: still 2025's final (Game 7, 11-01).
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/scoreboard/default-date`)).json()) as ScoreboardDefaultDateResponse;
			expect(body.date).toBe("2025-11-01");
		}, () => new Date("2026-01-15T17:00:00Z"));
	});

	it("serves the standings (S4): the 2026-09-05 recording's six divisions, each team with a name and its record", async () =>
	{
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/standings?date=2026-09-05`);
			expect(response.status).toBe(200);
			const standings = (await response.json()) as StandingsResponse;
			expect(standings.date).toBe("2026-09-05");
			expect(standings.divisions.length).toBeGreaterThanOrEqual(2);
			for (const division of standings.divisions)
			{
				expect(division.divisionId ?? division.name).not.toBeNull();
				expect(division.teams.length).toBeGreaterThan(0);
				for (const team of division.teams)
				{
					expect(typeof team.name).toBe("string");
					expect(typeof team.wins).toBe("number");
					expect(typeof team.losses).toBe("number");
				}
			}
			expect(standings.divisions[0]!.teams[0]).toMatchObject({
				name: "Tampa Bay Rays",
				gamesBack: null,
			});

			expect((await fetch(`${base}/api/v1/standings?date=July`)).status).toBe(400);
		});
	});

	it("standings follow the season (S128): the final table in the off-season, without a date on MLB's today, spring's in the spring", async () =>
	{
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/standings`)).json()) as StandingsResponse;
			expect(body).toMatchObject({
				phase: "final",
				season: 2026,
				date: "2026-09-27",
			});
			expect(body.divisions.map((d) => d.divisionId)).toEqual([201, 202, 200, 204, 205, 203]);
			const spring = (await (await fetch(`${base}/api/v1/standings?date=2026-03-01`)).json()) as StandingsResponse;
			expect(spring).toMatchObject({
				phase: "spring",
				season: 2026,
				date: "2026-03-01",
			});
			const regular = (await (await fetch(`${base}/api/v1/standings?date=2026-09-05`)).json()) as StandingsResponse;
			expect(regular).toMatchObject({
				phase: "regularSeason",
				season: 2026,
				date: "2026-09-05",
			});
		}, () => new Date("2026-11-08T03:00:00Z"));
	});

	it("S160 AC 3: the fixture server's in-season table (2026-09-12) carries x on TB and MIL, null on every other team, at the top and in phases.regularSeason", async () =>
	{
		await withServer(async (base) =>
		{
			const body = (await (await fetch(`${base}/api/v1/standings?date=2026-09-12&includePhases=regularSeason`)).json()) as StandingsResponse;
			for (const table of [body, body.phases.regularSeason!.table!])
			{
				const rows = table.divisions.flatMap((d) => d.teams);
				expect(rows).toHaveLength(30);
				for (const row of rows) expect(row).toHaveProperty("clinchIndicator");
				const lettered = Object.fromEntries(rows.filter((r) => r.clinchIndicator !== null).map((r) => [r.abbreviation, r.clinchIndicator]));
				expect(lettered).toEqual({
					TB: "x",
					MIL: "x",
				});
			}
		});
	});

	it("serves the day digest (S71): every game's videos ranked together, the first to watch first", async () =>
	{
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/digest?date=2024-07-04`);
			expect(response.status).toBe(200);
			const digest = (await response.json()) as DayDigestResponse;
			expect(digest.date).toBe("2024-07-04");
			// 744834 (NYM @ WSH) has three videos and 745001 (NYY @ BOS) one, so the digest holds four.
			expect(digest.items).toHaveLength(4);
			expect(digest.items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
			expect(digest.items.filter((i) => i.watchFirst)).toEqual([digest.items[0]]);
			expect(new Set(digest.items.map((i) => i.game.gamePk))).toEqual(new Set([744834, 745001]));
			expect(digest.items.find((i) => i.game.gamePk === 745001)!.game).toMatchObject({
				away: "NYY",
				home: "BOS",
			});

			expect((await fetch(`${base}/api/v1/digest`)).status).toBe(400);
			expect((await fetch(`${base}/api/v1/digest?date=July`)).status).toBe(400);
		});
	});

	it("caches the day digest by the latest change of the day and its games (#61)", async () =>
	{
		const now = new Date("2026-11-15T12:00:00Z");
		const gameChanged = "2026-11-15T11:00:00.000Z";
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/digest?date=2024-07-04`);
			expect(response.status).toBe(200);
			// One hour since the game changed, not two years since the day did.
			expect(response.headers.get("cache-control")).toBe(edgeCacheControl({
				windowMode: "cache",
				lastChangedAt: gameChanged,
			}, now));
			expect(((await response.json()) as DayDigestResponse).windowMode).toBe("cache");
		}, () => now, async ({
			schedules, games, gameStates,
		}) =>
		{
			// The day and its games out of the window long ago; then one game changed an hour ago. That game is left
			// suspended (never resumed), so the day isn't past and finished (S212) and keeps the graduated rule this proves.
			const day = (await schedules.getByDate("2024-07-04"))!;
			await schedules.upsert({
				...day,
				version: day.version + 1,
				windowMode: "cache",
				lastChangedAt: "2024-07-05T06:00:00.000Z",
				fetchedAt: now.toISOString(),
			});
			for (const [index, { gamePk }] of day.games.entries())
			{
				// Each game's one stored state (S150) settled too, so the joined day is out of its window.
				const row = (await gameStates.getByPk(gamePk))!;
				await gameStates.write([{
					...row,
					state: {
						...row.state,
						status: index === 0 ? {
							abstractGameState: "Live",
							codedGameState: "U",
							detailedState: "Suspended: Rain",
						} : {
							abstractGameState: "Final",
							codedGameState: "F",
							detailedState: "Final",
						},
						live: null,
						version: row.state.version + 1,
						lastChangedAt: "2024-07-05T06:00:00.000Z",
					},
				}]);
				const game = (await games.getByPk(gamePk))!;
				await games.upsert({
					...game,
					version: game.version + 1,
					windowMode: "cache",
					lastChangedAt: index === 0 ? gameChanged : "2024-07-05T06:00:00.000Z",
					fetchedAt: now.toISOString(),
				});
			}
		});
	});
});

/**
 * The fixture client with its standings answers changed by `change` (a table it returns, or an
 * error), counting every MLB call the standings make (S139) in `calls`, and every `fetch*` call
 * of any kind in `allFetches` (S140 AC 3), so a request through another port method shows up too.
 */
function standingsClient(change?: (table: StandingsSnapshot) => StandingsSnapshot | Promise<never>): { mlb: MlbStatsClient;
	calls: string[];
	allFetches: string[]; }
{
	const fixtures = new FixtureMlbStatsClient();
	const calls: string[] = [];
	const allFetches: string[] = [];
	const mlb = new Proxy(fixtures, {
		get(target, prop)
		{
			const value = Reflect.get(target, prop, target) as unknown;
			if (typeof value !== "function") return value;
			const name = String(prop);
			if (!name.startsWith("fetch")) return value.bind(target);
			const standings = /^fetch(Standings|FinalStandings|SpringStandings|SeasonCalendar)$/.test(name);
			return async (...args: unknown[]) =>
			{
				allFetches.push(name);
				if (standings) calls.push(name);
				const answer = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
				return change && standings && name !== "fetchSeasonCalendar" ? change(answer as StandingsSnapshot) : answer;
			};
		},
	});
	return {
		mlb,
		calls,
		allFetches,
	};
}

/** The fixture client with `fetchSeasonCalendar` answered by `answer` instead of the recordings (S139 AC 8). */
function calendarsAnswered(answer: (season: number, fixtures: FixtureMlbStatsClient) => Promise<SeasonCalendar | null>): MlbStatsClient
{
	const fixtures = new FixtureMlbStatsClient();
	return new Proxy(fixtures, {
		get(target, prop)
		{
			if (prop === "fetchSeasonCalendar") return async (season: number) => await answer(season, target);
			const value = Reflect.get(target, prop, target) as unknown;
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The fixture client with `fetchSeasonCalendar(season)` rejecting, as when MLB can't be reached for it (S139 AC 8). */
function calendarDown(season: number): MlbStatsClient
{
	return calendarsAnswered(async (asked, fixtures) => asked === season ? Promise.reject(new Error("MLB down")) : await fixtures.fetchSeasonCalendar(asked));
}

/** A standings answer without the fixture client's per-call `fetchedAt`, so two requests compare. */
function stable(body: unknown): unknown
{
	return JSON.parse(JSON.stringify(body, (key, value: unknown) => key === "fetchedAt" ? undefined : value));
}

async function standingsJson(base: string, query: string): Promise<StandingsResponse>
{
	const response = await fetch(`${base}/api/v1/standings${query}`);
	expect(response.status).toBe(200);
	return await response.json() as StandingsResponse;
}

describe("GET /api/v1/standings phases and includePhases (S139)", () =>
{
	const PHASES = ["spring", "regularSeason", "playoffs"] as const;
	const withTables = (body: StandingsResponse) => PHASES.filter((name) => body.phases[name]?.table !== undefined);

	it("standings no includePhases: every phase's dates and table on 2026-09-05, 2026-10-05, 2027-02-18 and 2027-02-19", async () =>
	{
		await withServer(async (base) =>
		{
			for (const day of ["2026-09-05", "2026-10-05", "2027-02-18", "2027-02-19"])
			{
				const body = await standingsJson(base, `?date=${day}`);
				expect(withTables(body)).toEqual(PHASES);
				for (const name of PHASES)
				{
					expect(body.phases[name]!.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
					expect(body.phases[name]!.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				}
			}
			// S128's fields at the top, unchanged beside `phases`, on each day.
			expect(await standingsJson(base, "?date=2026-09-05")).toMatchObject({
				phase: "regularSeason",
				season: 2026,
				date: "2026-09-05",
			});
			expect(await standingsJson(base, "?date=2027-02-18")).toMatchObject({
				phase: "final",
				season: 2026,
				date: "2026-09-27",
			});
			const offSeason = await standingsJson(base, "?date=2026-10-05");
			expect(offSeason).toMatchObject({
				phase: "final",
				season: 2026,
				date: "2026-09-27",
			});
			const firstSpring = await standingsJson(base, "?date=2027-02-19");
			expect(firstSpring).toMatchObject({
				phase: "final",
				season: 2026,
				date: "2026-09-27",
			});
			expect(firstSpring.phases.spring!.table!.divisions).toEqual([]);
			expect(firstSpring.phases.regularSeason!.table).toMatchObject({
				phase: "regularSeason",
				season: 2027,
			});
			expect(firstSpring.phases.playoffs!.table!.divisions).toEqual([]);
			const dayBefore = await standingsJson(base, "?date=2027-02-18");
			expect(PHASES.map((name) => dayBefore.phases[name]!.table!.season)).toEqual([2026, 2026, 2026]);
		}, () => new Date("2027-03-01T15:00:00Z"));
	});

	it("standings each phase alone: only the named phase carries a table, every phase its dates", async () =>
	{
		await withServer(async (base) =>
		{
			for (const name of PHASES)
			{
				const body = await standingsJson(base, `?date=2026-09-05&includePhases=${name}`);
				expect(withTables(body)).toEqual([name]);
				expect(PHASES.every((phase) => body.phases[phase]!.startDate !== null)).toBe(true);
			}
		});
	});

	it("standings comma, repeated and mixed forms give the same answer", async () =>
	{
		await withServer(async (base) =>
		{
			const comma = stable(await standingsJson(base, "?date=2026-09-05&includePhases=spring,playoffs"));
			const repeated = stable(await standingsJson(base, "?date=2026-09-05&includePhases=spring&includePhases=playoffs"));
			const mixed = stable(await standingsJson(base, "?includePhases=playoffs&date=2026-09-05&includePhases=spring,playoffs"));
			expect(repeated).toEqual(comma);
			expect(mixed).toEqual(comma);
			expect(withTables(comma as StandingsResponse)).toEqual(["spring", "playoffs"]);
		});
	});

	it("standings named twice counts once", async () =>
	{
		await withServer(async (base) =>
		{
			expect(stable(await standingsJson(base, "?date=2026-09-05&includePhases=regularSeason,regularSeason")))
				.toEqual(stable(await standingsJson(base, "?date=2026-09-05&includePhases=regularSeason")));
		});
	});

	it("standings invalid includePhases: 400 include_phases_invalid naming the phases, no-store, and MLB is asked nothing", async () =>
	{
		const { mlb, calls } = standingsClient();
		await withServer(async (base) =>
		{
			for (const value of ["Spring", "final", "views", "", "spring,", "spring,%20playoffs"])
			{
				const response = await fetch(`${base}/api/v1/standings?date=2026-09-05&includePhases=${value}`);
				expect(response.status, value).toBe(400);
				expect(response.headers.get("cache-control")).toBe("no-store");
				const body = await response.json() as { error: string;
					hint: string; };
				expect(body.error).toBe("include_phases_invalid");
				expect(body.hint).toBe("comma-separated phase names: spring,regularSeason,playoffs");
			}
		}, undefined, undefined, mlb);
		expect(calls).toEqual([]);
	});

	it("standings bad date before includePhases: date_invalid wins", async () =>
	{
		await withServer(async (base) =>
		{
			const response = await fetch(`${base}/api/v1/standings?date=July&includePhases=views`);
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: string }).error).toBe("date_invalid");
			// A date the calendar doesn't have is not a date either.
			const impossible = await fetch(`${base}/api/v1/standings?date=2026-02-30`);
			expect(impossible.status).toBe(400);
			expect(impossible.headers.get("cache-control")).toBe("no-store");
			expect(((await impossible.json()) as { error: string }).error).toBe("date_invalid");
		});
	});

	it("standings top-level fields identical whatever includePhases names", async () =>
	{
		await withServer(async (base) =>
		{
			const top = async (query: string) =>
			{
				const { phases: _phases, ...rest } = await standingsJson(base, `?date=2026-09-05${query}`);
				return stable(rest);
			};
			const all = await top("");
			for (const query of ["&includePhases=spring", "&includePhases=regularSeason", "&includePhases=playoffs", "&includePhases=spring,regularSeason,playoffs"])
			{
				expect(await top(query)).toEqual(all);
			}
		});
	});

	it("standings Cache-Control: ADR-021's ladder to a 30-day cap, counted from the end of the day asked", async () =>
	{
		const header = async (base: string, query: string) => (await fetch(`${base}/api/v1/standings${query}`)).headers.get("cache-control");
		const sMaxAge = (seconds: number) => `public, s-maxage=${seconds}, stale-while-revalidate=300`;
		const now = () => new Date("2026-11-13T15:00:00Z");
		await withServer(async (base) =>
		{
			// 2026-09-05's playoffs table has no division (no team clinched yet), and still gets 30 days.
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(30 * 24 * 3600));
			expect(await header(base, "?date=2026-11-10")).toBe(sMaxAge(7 * 24 * 3600)); // unchanged since 11-11T05:00Z: 58 hours
			expect(await header(base, "?date=2026-11-12")).toBe(sMaxAge(24 * 3600)); // unchanged 10 hours
			for (const query of ["", "?date=2026-11-13", "?date=2026-11-14"]) expect(await header(base, query)).toBe(sMaxAge(300));
			expect(await header(base, "?date=2026-09-05&includePhases=views")).toBe("no-store");
		}, now);

		// The HTTP adapter labels every table active; the header is still the edge's.
		const active = standingsClient((table) => ({
			...table,
			windowMode: "active",
		}));
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(30 * 24 * 3600));
		}, now, undefined, active.mlb);

		// MLB answering an empty table for a past day is "nothing yet": the floor.
		const empty = standingsClient((table) => ({
			...table,
			divisions: [],
		}));
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(300));
		}, now, undefined, empty.mlb);

		// An answer built while MLB couldn't give a calendar (either year's) is kept the floor, whatever its day.
		for (const season of [2026, 2025])
		{
			await withServer(async (base) =>
			{
				expect(await header(base, "?date=2026-09-05"), String(season)).toBe(sMaxAge(300));
			}, now, undefined, calendarDown(season));
		}

		// No calendar for the day's season (MLB answered, with none published): not known to be over, so ADR-021's
		// 48-hour ladder, not 30 days and not the floor.
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(48 * 3600));
		}, now, undefined, calendarsAnswered(async () => null));

		// A season not over yet: the floor in its postseason window (2026-09-27 through 2026-10-29), ADR-021's
		// 48-hour ladder before it.
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(300));
		}, () => new Date("2026-10-10T15:00:00Z"));
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-09-05")).toBe(sMaxAge(48 * 3600)); // unchanged 14 days, ADR-021's cap
		}, () => new Date("2026-09-20T15:00:00Z"));

		// The season judged is the answer's (the one its phases are for), not today's year: on 2026-10-10, inside 2026's
		// window, 2026-01-15 is 2025's off-season and 2025-09-05 is 2025's, both settled. The fixtures have no 2025
		// tables, so every table is filled with 2026-09-05's teams (an empty one would be "nothing yet").
		const september5 = await new FixtureMlbStatsClient().fetchStandings("2026-09-05");
		const filled = standingsClient((table) => table.divisions.some((d) => d.teams.length > 0) ? table : {
			...table,
			divisions: september5.divisions,
		});
		await withServer(async (base) =>
		{
			expect(await header(base, "?date=2026-01-15")).toBe(sMaxAge(30 * 24 * 3600));
			expect(await header(base, "?date=2025-09-05")).toBe(sMaxAge(30 * 24 * 3600));
		}, () => new Date("2026-10-10T15:00:00Z"), undefined, filled.mlb);

		// An MLB error: 502, never cached, and logged by the error's name.
		const failing = standingsClient(() => Promise.reject(new Error("MLB down")));
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try
		{
			await withServer(async (base) =>
			{
				const response = await fetch(`${base}/api/v1/standings?date=2026-09-05`);
				expect(response.status).toBe(502);
				expect(response.headers.get("cache-control")).toBe("no-store");
			}, now, undefined, failing.mlb);
			expect(logged).toHaveBeenCalledWith("standings failed:", "Error");
		}
		finally
		{
			logged.mockRestore();
		}
	});
});

describe("GET /api/v1/standings champion (S140)", () =>
{
	const dodgers = {
		season: 2025,
		teamId: 119,
		name: "Los Angeles Dodgers",
		wonOn: "2025-11-01",
	};
	const brewers = {
		season: 2026,
		teamId: 158,
		name: "Milwaukee Brewers",
		wonOn: "2026-10-28",
	};

	it("S140 AC 2: the off-season's winner from the day it was won, null on every other day", async () =>
	{
		await withServer(async (base) =>
		{
			expect((await standingsJson(base, "?date=2025-11-15")).champion).toEqual(dodgers);
			expect((await standingsJson(base, "?date=2026-11-10")).champion).toEqual(brewers);
			expect((await standingsJson(base, "?date=2026-10-28")).champion).toEqual(brewers);
			for (const day of ["2026-10-27", "2026-10-01", "2026-09-05", "2026-03-01"])
			{
				const body = await standingsJson(base, `?date=${day}`);
				expect(body).toHaveProperty("champion", null);
			}
			// Without a date it is MLB's today's answer: 2026-11-10 by the clock below.
			expect((await standingsJson(base, "")).champion).toEqual(brewers);
		}, () => new Date("2026-11-10T15:00:00Z"));
	});

	it("S140 AC 2: the same champion whatever includePhases names (S139 has shipped)", async () =>
	{
		await withServer(async (base) =>
		{
			for (const query of ["", "&includePhases=spring", "&includePhases=regularSeason", "&includePhases=playoffs", "&includePhases=spring,regularSeason,playoffs"])
			{
				expect((await standingsJson(base, `?date=2026-11-10${query}`)).champion).toEqual(brewers);
			}
		}, () => new Date("2026-11-18T15:00:00Z"));
	});

	it("S140 AC 3: a standings request asks MLB nothing more than before: the two calendars and the tables S139 reads", async () =>
	{
		// `allFetches` counts every `fetch*` call, so a new request through any port method fails this, not only a standings one.
		const { mlb, allFetches } = standingsClient();
		await withServer(async (base) =>
		{
			// The server's setup ingests 2024-07-04 (a schedule and its games) before `run`; only the request's calls count.
			allFetches.length = 0;
			const body = await standingsJson(base, "?date=2026-11-10");
			expect(body.champion).toEqual(brewers);
			expect([...allFetches].sort()).toEqual(["fetchFinalStandings", "fetchSeasonCalendar", "fetchSeasonCalendar", "fetchSpringStandings"]);
			allFetches.length = 0;
			await standingsJson(base, "?date=2026-11-10&includePhases=playoffs");
			expect([...allFetches].sort()).toEqual(["fetchFinalStandings", "fetchSeasonCalendar", "fetchSeasonCalendar"]);
		}, () => new Date("2026-11-18T15:00:00Z"), undefined, mlb);
	});
});

describe("GET /api/v1/standings before 1969 (S155 AC 3)", () =>
{
	/** Each table's league, name, team count and first and last team. */
	const outline = (table: StandingsSnapshot) => table.divisions.map((d) => [
		d.divisionId, d.leagueId, d.name, d.teams.length, d.teams[0]?.abbreviation, d.teams.at(-1)?.abbreviation,
	]);

	it("1950-07-04: the two league tables at the top and in the regular season phase", async () =>
	{
		await withServer(async (base) =>
		{
			const body = await standingsJson(base, "?date=1950-07-04");
			const leagues = [
				[null, 103, "American League", 8, "DET", "SLB"],
				[null, 104, "National League", 8, "STL", "PIT"],
			];
			expect(body).toMatchObject({
				phase: "regularSeason",
				season: 1950,
				date: "1950-07-04",
			});
			expect(outline(body)).toEqual(leagues);
			expect(outline(body.phases.regularSeason!.table!)).toEqual(leagues);
			// 1950 had no spring MLB records.
			expect(body.phases.spring).toBeNull();
		});
	});

	it("1950-12-01: after the season, 1950's final table, from its last regular-season day, as fetchFinalStandings(1950) maps it", async () =>
	{
		const final = await new FixtureMlbStatsClient().fetchFinalStandings(1950);
		await withServer(async (base) =>
		{
			const body = await standingsJson(base, "?date=1950-12-01");
			expect(body).toMatchObject({
				phase: "final",
				season: 1950,
				date: "1950-10-01",
			});
			expect(outline(body)).toEqual([
				[null, 103, "American League", 8, "NYY", "PHA"],
				[null, 104, "National League", 8, "PHI", "PIT"],
			]);
			expect(stable(body.divisions)).toEqual(stable(final.divisions));
			expect(stable(body.phases.regularSeason!.table!.divisions)).toEqual(stable(final.divisions));
		});
	});
});
