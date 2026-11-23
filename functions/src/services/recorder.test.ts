/**
 * Drives both recording paths into a temp dir and reads the result back through
 * the real `FixtureMlbStatsClient`. No network: the raw path gets an injected
 * stub `fetch`, the normalized path a fake `MlbStatsClient` adapter.
 *
 * The asserts are deliberately non-empty rather than non-throwing —
 * `FixtureMlbStatsClient.fetchSchedule` swallows read errors, and `fetchStandings`
 * swallows them for both the recording and the mapped table (S160: it throws only
 * on a recording of the wrong shape), returning empty shells, so "it loaded" would
 * pass against a recorder that wrote nothing.
 */
import {
	mkdir, mkdtemp, readFile, readdir, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type {
	AtBat,
	GameSnapshot,
	MediaHighlight,
	PlayerProfile,
	SearchHighlightsPage,
	ScheduleDay,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import { datesBetween } from "@bt/domain";
import type { GameDiffPatchResponse } from "@bt/mlb-api";
import { parseStandingsResponse } from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	finalStandingsUrl, graphContentRequest, seasonsUrl, springStandingsUrl, standingsUrl, worldSeriesUrl,
} from "../adapters/http/mlb.js";
import { mapStandings } from "../mappers/standings.js";
import {
	rawEndpoints, recordEndpoints, recordNormalized, recordRaw, recordStandingsDay, seasonEndpoints, standingsDayEndpoints,
} from "./recorder.js";

const FIXTURES = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures",
);

const DATE = "2024-07-04";
const GAME_PK = 744834;

async function readFixture<T>(name: string): Promise<T>
{
	return JSON.parse(await readFile(path.join(FIXTURES, name), "utf8")) as T;
}

/** Serves committed fixture shapes for any date, so both paths see real data. */
class FakeMlbStatsClient implements MlbStatsClient
{
	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const day = await readFixture<{ games: ScheduleDay["games"] }>(
			"schedule-2024-07-04.json",
		);
		return {
			date,
			games: day.games,
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		return Promise.all(datesBetween(startDate, endDate).map((date) => this.fetchSchedule(date)));
	}

	async fetchGame(gamePk: number): Promise<{ game: GameSnapshot;
		feedTime: string; }>
	{
		const game = await readFixture<GameSnapshot>("game-744834.json");
		const plays = await readFixture<AtBat[]>("plays-744834.json");
		return {
			game: {
				...game,
				gamePk,
				plays,
				fetchedAt: "",
				windowMode: "cache",
			},
			// S150 AC 2: a feed time beside the game, which the recorder never writes to the fixture.
			feedTime: "2024-07-05T03:00:00.000Z",
		};
	}

	async fetchGameContent(): Promise<MediaHighlight[]>
	{
		return [];
	}

	async fetchPlayMetrics(): Promise<null>
	{
		return null;
	}

	async fetchGameGraphContent(): Promise<null>
	{
		return null;
	}

	async fetchPlayerOfTheGame(): Promise<null>
	{
		return null;
	}

	async fetchSeasonCalendar(): Promise<null>
	{
		return null;
	}

	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		const table = await readFixture<StandingsSnapshot>("standings-2026-09-05.json");
		return {
			...table,
			date,
			fetchedAt: "",
			windowMode: "cache",
		};
	}

	async fetchFinalStandings(season: number): Promise<StandingsSnapshot>
	{
		return this.fetchStandings(`${season}-12-31`);
	}

	async fetchSpringStandings(_season: number, date: string): Promise<StandingsSnapshot>
	{
		return this.fetchStandings(date);
	}

	async fetchPlayers(): Promise<PlayerProfile[]>
	{
		return [];
	}

	async searchHighlights(): Promise<SearchHighlightsPage>
	{
		return {
			total: 0,
			highlights: [],
		};
	}

	async fetchGameTimestamps(): Promise<string[]>
	{
		return [];
	}

	async fetchGameDiffPatch(): Promise<GameDiffPatchResponse>
	{
		return [{
			diff: [],
		}];
	}
}

describe("fixture recorder", () =>
{
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	it("raw path writes verbatim upstream bytes through the injected fetch", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-raw-"));
		const body = '{"copyright":"  spaced  ","totalGames":1}';
		const seen: string[] = [];
		const fakeFetch = (async (input: string | URL | Request) =>
		{
			seen.push(String(input));
			return new Response(body, {
				status: 200,
			});
		}) as unknown as typeof fetch;

		const written = await recordRaw(
			{
				date: DATE,
				gamePk: GAME_PK,
				playerIds: [1],
			},
			out,
			{
				baseUrl: "",
				fetchImpl: fakeFetch,
			},
		);

		// The nine names packages/mlb-api/src/coverage.test.ts consumes (play metrics since S93, GraphQL content since S94,
		// player of the game since S99).
		expect(written).toEqual([
			`schedule-${DATE}.json`,
			`live-${GAME_PK}.json`,
			`content-${GAME_PK}.json`,
			`timestamps-${GAME_PK}.json`,
			`playmetrics-${GAME_PK}.json`,
			`potg-${GAME_PK}.json`,
			`graphql-content-${GAME_PK}.json`,
			`standings-${DATE}.json`,
			`people-${GAME_PK}.json`,
		]);
		expect(seen).toHaveLength(9);
		expect(await readdir(path.join(out, "raw"))).toHaveLength(9);

		// Byte-exact: not re-stringified through JSON.parse.
		const onDisk = await readFile(path.join(out, "raw", `live-${GAME_PK}.json`), "utf8");
		expect(onDisk).toBe(body);
	});

	it("graphql: the GraphQL content is recorded with the HTTP client's own request, headers included (S94)", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-gql-"));
		const asked = new Map<string, Headers>();
		const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) =>
		{
			asked.set(String(input), new Headers(init?.headers));
			return new Response("{}", {
				status: 200,
			});
		}) as unknown as typeof fetch;
		await recordRaw({
			date: DATE,
			gamePk: GAME_PK,
		}, out, {
			baseUrl: "",
			fetchImpl: fakeFetch,
		});
		const request = graphContentRequest(GAME_PK);
		const headers = asked.get(request.url);
		expect(headers?.get("x-client-name")).toBe("mlb");
		expect(headers?.get("content-type")).toBe("application/json");
		expect(headers?.get("accept")).toBe("application/json");
	});

	it("names every raw endpoint the coverage gate expects", () =>
	{
		const names = rawEndpoints({
			date: DATE,
			gamePk: GAME_PK,
			playerIds: [1],
		}).map(
			(e) => e.name,
		);
		expect(names).toContain(`schedule-${DATE}`);
		expect(names).toContain(`live-${GAME_PK}`);
		expect(names).toContain(`content-${GAME_PK}`);
		expect(names).toContain(`timestamps-${GAME_PK}`);
		expect(names).toContain(`playmetrics-${GAME_PK}`);
		expect(names).toContain(`graphql-content-${GAME_PK}`);
		expect(names).toContain(`standings-${DATE}`);
		expect(names).toContain(`people-${GAME_PK}`);
	});

	it("records a season's calendar, World Series, final and spring standings with the URLs the client asks (S128)", async () =>
	{
		expect(seasonEndpoints(2026, "2026-03-24")).toEqual([
			{
				name: "seasons-2026",
				url: seasonsUrl(2026),
			},
			{
				name: "worldseries-2026",
				url: worldSeriesUrl(2026),
			},
			{
				name: "standings-2026-final",
				url: finalStandingsUrl(2026),
			},
			{
				name: "standings-2026-spring",
				url: springStandingsUrl(2026, "2026-03-24"),
			},
		]);
		expect(seasonEndpoints(2027).map((e) => e.name)).toEqual(["seasons-2027", "worldseries-2027", "standings-2027-final"]);
		const out = await mkdtemp(path.join(tmpdir(), "bt-season-rec-"));
		const written = await recordEndpoints(seasonEndpoints(2027), out, {
			fetchImpl: async (input) => new Response(`{"url":"${String(input)}"}`),
		});
		expect(written).toEqual(["seasons-2027.json", "worldseries-2027.json", "standings-2027-final.json"]);
		expect(await readFile(path.join(out, "raw", "standings-2027-final.json"), "utf8")).toBe(`{"url":"${finalStandingsUrl(2027)}"}`);
	});

	it("records standings with the same URL the client asks, season included", () =>
	{
		const standings = rawEndpoints({
			date: DATE,
			gamePk: GAME_PK,
			playerIds: [1],
		}).find((e) => e.name === `standings-${DATE}`);
		const url = new URL(standings?.url ?? "");
		expect(url.pathname).toBe("/api/v1/standings");
		expect(url.searchParams.get("season")).toBe(DATE.slice(0, 4));
		expect(url.searchParams.get("date")).toBe(DATE);
	});

	it("normalized path round-trips non-empty through FixtureMlbStatsClient", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-norm-"));
		await recordNormalized(
			new FakeMlbStatsClient(),
			{
				date: DATE,
				gamePk: GAME_PK,
			},
			out,
		);

		const client = new FixtureMlbStatsClient(out);

		const schedule = await client.fetchSchedule(DATE);
		expect(schedule.games.length).toBeGreaterThan(0);

		const standings = await client.fetchStandings(DATE);
		expect(standings.divisions.length).toBeGreaterThan(0);

		const game = (await client.fetchGame(GAME_PK)).game;
		expect(game.gamePk).toBe(GAME_PK);
		// plays-<gamePk>.json must be its own file; fetchGame overwrites inlined plays.
		expect(game.plays.length).toBeGreaterThan(0);
	});

	it("S160: re-recording a recorded day refreshes raw/standings-<date> first, and that recording, not the mapped file, is what fetchStandings serves", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-standings-precedence-"));
		const stale = await readFile(path.join(FIXTURES, "raw", "standings-2026-09-05.json"), "utf8");
		const fresh = await readFile(path.join(FIXTURES, "raw", "standings-2026-09-12.json"), "utf8");
		// The day is already recorded (as 2026-09-05 and 2026-09-12 are in fixtures/raw).
		await mkdir(path.join(out, "raw"), {
			recursive: true,
		});
		await writeFile(path.join(out, "raw", `standings-${DATE}.json`), stale);

		// record-fixtures' run, in its order: the raw path, then the normalized path.
		await recordRaw({
			date: DATE,
			gamePk: GAME_PK,
		}, out, {
			baseUrl: "",
			fetchImpl: (async (input: string | URL | Request) => new Response(String(input).includes("/api/v1/standings") ? fresh : "{}")) as unknown as typeof fetch,
		});
		await recordNormalized(new FakeMlbStatsClient(), {
			date: DATE,
			gamePk: GAME_PK,
		}, out);

		const served = await new FixtureMlbStatsClient(out).fetchStandings(DATE);
		const recorded = await new FixtureMlbStatsClient(FIXTURES).fetchStandings("2026-09-12");
		const stalePrior = await new FixtureMlbStatsClient(FIXTURES).fetchStandings("2026-09-05");
		const mapped = JSON.parse(await readFile(path.join(out, `standings-${DATE}.json`), "utf8")) as StandingsSnapshot;
		expect(served.divisions).toEqual(recorded.divisions);
		expect(served.divisions).not.toEqual(stalePrior.divisions);
		// The mapped file the normalized path just wrote is on disk and differs; it is only the fallback.
		expect(mapped.divisions.length).toBeGreaterThan(0);
		expect(served.divisions).not.toEqual(mapped.divisions);
	});

	it("S155: one day's standings alone, MLB's raw table then the mapped one from it, with no game", async () =>
	{
		expect(standingsDayEndpoints("1950-07-04")).toEqual([{
			name: "standings-1950-07-04",
			url: standingsUrl("1950-07-04", "https://statsapi.mlb.com"),
		}]);
		const out = await mkdtemp(path.join(tmpdir(), "bt-standings-day-"));
		const recording = await readFile(path.join(FIXTURES, "raw", "standings-1950-07-04.json"), "utf8");
		// A second request, on the live network or anywhere else, would answer a different table.
		const other = await readFile(path.join(FIXTURES, "raw", "standings-1950-final.json"), "utf8");
		const globalFetch = vi.fn(async () => new Response(other));
		vi.stubGlobal("fetch", globalFetch);
		let injectedCalls = 0;
		const fetchImpl = (async () =>
		{
			injectedCalls += 1;
			return new Response(injectedCalls === 1 ? recording : other);
		}) as unknown as typeof fetch;
		expect(await recordStandingsDay("1950-07-04", out, {
			fetchImpl,
		})).toEqual(["raw/standings-1950-07-04.json", "standings-1950-07-04.json"]);
		expect(injectedCalls).toBe(1);
		expect(globalFetch).not.toHaveBeenCalled();
		expect(await readFile(path.join(out, "raw", "standings-1950-07-04.json"), "utf8")).toBe(recording);
		// The mapped file is the mapper's output on that one recording, and so the committed one.
		const expected = mapStandings(parseStandingsResponse(JSON.parse(recording)), "1950-07-04");
		const mapped: unknown = JSON.parse(await readFile(path.join(out, "standings-1950-07-04.json"), "utf8"));
		expect(mapped).toEqual({
			date: expected.date,
			divisions: expected.divisions,
		});
		expect(mapped).toEqual(await readFixture("standings-1950-07-04.json"));
	});

	it("S155: a day's answer that isn't JSON fails loudly and leaves the mapped file as it was", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-standings-day-bad-"));
		const stale = "{\"date\":\"1950-07-04\",\"divisions\":[]}\n";
		await writeFile(path.join(out, "standings-1950-07-04.json"), stale);
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{\"records\":[]}")));
		await expect(recordStandingsDay("1950-07-04", out, {
			fetchImpl: (async () => new Response("<html>maintenance</html>")) as unknown as typeof fetch,
		})).rejects.toThrow();
		expect(await readFile(path.join(out, "standings-1950-07-04.json"), "utf8")).toBe(stale);
		expect(await readdir(path.join(out, "raw"))).toEqual([]);
	});

	it("writes plays as a separate file, not inlined into the game", async () =>
	{
		const out = await mkdtemp(path.join(tmpdir(), "bt-plays-"));
		await recordNormalized(
			new FakeMlbStatsClient(),
			{
				date: DATE,
				gamePk: GAME_PK,
			},
			out,
		);

		const written = JSON.parse(
			await readFile(path.join(out, `game-${GAME_PK}.json`), "utf8"),
		) as Record<string, unknown>;
		expect(written.plays).toBeUndefined();
		// S150 AC 2: the fetch's feed time is beside the game, and the recorder writes the game alone.
		expect(written).not.toHaveProperty("feedTime");
		expect(written).not.toHaveProperty("game");
		expect(written.gamePk).toBe(GAME_PK);

		const plays = JSON.parse(
			await readFile(path.join(out, `plays-${GAME_PK}.json`), "utf8"),
		) as AtBat[];
		expect(plays.length).toBeGreaterThan(0);
	});
});
