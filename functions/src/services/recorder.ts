/**
 * Fixture recorder — regenerates the committed corpus from upstream.
 *
 * Two recording paths, because the `MlbStatsClient` port returns domain types
 * and never surfaces upstream JSON (`packages/ports/src/mlb.ts`):
 *
 * - **raw** — verbatim upstream payloads. This one cannot go through the port,
 *   so `fetch` is injected directly. Bytes are written exactly as received
 *   (`response.text()`, no re-stringify) so `fixtures/raw/` stays byte-exact
 *   for the S23 coverage gate.
 * - **normalized** — `fixtures/`-shaped JSON, written through whichever
 *   `MlbStatsClient` adapter it is handed: `HttpMlbStatsClient` in production,
 *   a fake adapter under test. One exception, `recordStandingsDay` (S155): a
 *   day's standings alone is mapped from the raw answer it just recorded, with no
 *   client, so its two files come from one request.
 *
 * Neither path reaches the network on its own: the raw path fetches only
 * through the injected implementation, so a stubbed response records offline.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	AtBat,
	GameSnapshot,
	SearchFilters,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import { wholeFetchedGame } from "@bt/domain";
import type { StandingsResponse } from "@bt/mlb-api";
import { parseSearchResponse, parseStandingsResponse } from "@bt/mlb-api";
import type { MlbStatsClient } from "@bt/ports";
import {
	finalStandingsUrl, gameRuleSettingsUrl, gameUniformsUrl, graphContentRequest, playMetricsUrl, playerOfTheGameUrl, searchHighlightsRequest, seasonsUrl, springStandingsUrl,
	standingsUrl, worldSeriesUrl,
} from "../adapters/http/mlb.js";
import { searchFixtureName } from "../adapters/fixtures/fixture-client.js";
import { mapStandings } from "../mappers/standings.js";

const DEFAULT_BASE_URL = "https://statsapi.mlb.com";

const SCHEDULE_HYDRATE =
	"team,linescore(matchup,runners),flags,liveLookin,review,decisions,person,probablePitcher,stats,game(content(media(featured,epg),summary))";

export interface RecorderTarget {
	date: string;
	gamePk: number;
	/** Player ids for the people/players payloads; empty skips them. */
	playerIds?: number[];
}

export interface RawRecorderOptions {
	baseUrl?: string;
	/** Injected in tests; defaults to global `fetch`. */
	fetchImpl?: typeof fetch;
}

/** One raw upstream payload: the `fixtures/raw/` basename, its URL, and any headers it needs beyond `accept`. */
export interface RawEndpoint {
	name: string;
	url: string;
	headers?: Record<string, string>;
}

/**
 * The `fixtures/raw/<endpoint>-<key>.json` names consumed by
 * `packages/mlb-api/src/coverage.test.ts`. Re-recording keeps that gate and
 * the S22 prerequisite regenerable instead of orphaning them.
 */
export function rawEndpoints(
	target: RecorderTarget,
	baseUrl = DEFAULT_BASE_URL,
): RawEndpoint[]
{
	const { date, gamePk } = target;
	const ids = target.playerIds ?? [];
	const endpoints: RawEndpoint[] = [
		{
			name: `schedule-${date}`,
			url: `${baseUrl}/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`,
		},
		{
			name: `live-${gamePk}`,
			url: `${baseUrl}/api/v1.1/game/${gamePk}/feed/live`,
		},
		{
			name: `content-${gamePk}`,
			url: `${baseUrl}/api/v1/game/${gamePk}/content?language=en`,
		},
		{
			name: `timestamps-${gamePk}`,
			url: `${baseUrl}/api/v1.1/game/${gamePk}/feed/live/timestamps`,
		},
		{
			// MLB's play-metrics feed (S93), on its own host: the URL the HTTP client asks.
			name: `playmetrics-${gamePk}`,
			url: playMetricsUrl(gamePk),
		},
		{
			// MLB's player of the game (S99), an mlb.com app feed: the URL the HTTP client asks.
			name: `potg-${gamePk}`,
			url: playerOfTheGameUrl(gamePk),
		},
		{
			// The uniforms each team wore (S101): the URL the HTTP client asks.
			name: `uniforms-${gamePk}`,
			url: gameUniformsUrl(gamePk, baseUrl),
		},
		{
			// The rules the game was played under (S100): the URL the HTTP client asks.
			name: `rulesettings-${gamePk}`,
			url: gameRuleSettingsUrl(gamePk, baseUrl),
		},
		{
			// MLB's GraphQL game content (S94): the request the HTTP client makes, headers included.
			name: `graphql-content-${gamePk}`,
			...graphContentRequest(gamePk),
		},
		{
			name: `standings-${date}`,
			url: standingsUrl(date, baseUrl),
		},
	];
	if (ids.length > 0)
	{
		endpoints.push({
			name: `people-${gamePk}`,
			url: `${baseUrl}/api/v1/people?personIds=${ids.join(",")}`,
		});
	}
	return endpoints;
}

/**
 * One season's recordings (S111, S128): its calendar and World Series (`seasons-<season>`,
 * `worldseries-<season>`), its final regular-season table (`standings-<season>-final`) and,
 * with `springDate`, its spring training table as of that day (`standings-<season>-spring`) —
 * each with the URL the HTTP client asks, so the fixtures answer what production would.
 */
export function seasonEndpoints(season: number, springDate?: string, baseUrl = DEFAULT_BASE_URL): RawEndpoint[]
{
	const endpoints: RawEndpoint[] = [
		{
			name: `seasons-${season}`,
			url: seasonsUrl(season, baseUrl),
		},
		{
			name: `worldseries-${season}`,
			url: worldSeriesUrl(season, baseUrl),
		},
		{
			name: `standings-${season}-final`,
			url: finalStandingsUrl(season, baseUrl),
		},
	];
	if (springDate)
	{
		endpoints.push({
			name: `standings-${season}-spring`,
			url: springStandingsUrl(season, springDate, baseUrl),
		});
	}
	return endpoints;
}

/**
 * One day's standings alone (S155): MLB's dated table, `standings-<date>`, with the URL the HTTP
 * client asks. The `--date` form without `--game` records this, so a day with no game worth
 * recording (1950-07-04's, say) still gets its table.
 */
export function standingsDayEndpoints(date: string, baseUrl = DEFAULT_BASE_URL): RawEndpoint[]
{
	return [
		{
			name: `standings-${date}`,
			url: standingsUrl(date, baseUrl),
		},
	];
}

/**
 * The `--date` form without `--game` (S155): records MLB's table for `date` verbatim, then writes
 * `standings-<date>.json` mapped from that same answer, so the two files never disagree (a second
 * request on a day with games in progress could answer a different table). The answer is parsed
 * (`parseStandingsResponse`) before anything is written: one that isn't JSON, or isn't MLB's shape,
 * throws and leaves both files as they were, rather than mapping a stale or empty fallback the way
 * `FixtureMlbStatsClient.fetchStandings` would read one. Returns the names written, raw first.
 */
export async function recordStandingsDay(date: string, outDir: string, options: RawRecorderOptions = {}): Promise<string[]>
{
	let payload: StandingsResponse | undefined;
	const raw = await recordEndpoints(standingsDayEndpoints(date, options.baseUrl ?? DEFAULT_BASE_URL), outDir, {
		...options,
		check: (text) =>
		{
			payload = parseStandingsResponse(JSON.parse(text));
		},
	});
	if (!payload) throw new Error(`no standings answer for ${date}`);
	const mapped = await writeStandings(outDir, date, mapStandings(payload, date));
	return [...raw.map((f) => `raw/${f}`), mapped];
}

/**
 * Raw path. Writes each upstream response verbatim into `<outDir>/raw/`.
 * Returns the basenames written, in order.
 */
export async function recordRaw(
	target: RecorderTarget,
	outDir: string,
	options: RawRecorderOptions = {},
): Promise<string[]>
{
	return recordEndpoints(rawEndpoints(target, options.baseUrl ?? DEFAULT_BASE_URL), outDir, options);
}

/**
 * Writes each endpoint's response verbatim into `<outDir>/raw/<name>.json`; returns the basenames, in
 * order. `check`, when given, sees each response's text first and throws to refuse it, so a refused
 * answer never replaces a recording (S155's `recordStandingsDay`).
 */
export async function recordEndpoints(
	endpoints: readonly RawEndpoint[],
	outDir: string,
	options: Pick<RawRecorderOptions, "fetchImpl"> & { check?: (text: string) => void } = {},
): Promise<string[]>
{
	const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const rawDir = path.join(outDir, "raw");
	await mkdir(rawDir, {
		recursive: true,
	});

	const written: string[] = [];
	for (const endpoint of endpoints)
	{
		const response = await doFetch(endpoint.url, {
			headers: {
				accept: "application/json",
				...endpoint.headers,
			},
		});
		if (!response.ok)
		{
			throw new Error(`MLB Stats API ${response.status} for ${endpoint.url}`);
		}
		// Verbatim bytes — `fixtures/raw` is in .prettierignore and must stay exact.
		const text = await response.text();
		options.check?.(text);
		await writeFile(path.join(rawDir, `${endpoint.name}.json`), text);
		written.push(`${endpoint.name}.json`);
	}
	return written;
}

/**
 * One highlight search (S5), recorded verbatim to `<outDir>/search-<words>.json`, or a filtered one's name (S72), by `searchFixtureName`,
 * the name `FixtureMlbStatsClient.searchHighlights` reads: the request the HTTP client makes
 * (`searchHighlightsRequest`), so the recording carries every field it asks for, `guid` and
 * `playInfo` among them. The answer is checked first (`parseSearchResponse`): MLB's `errors` or a
 * changed shape throws and leaves any earlier recording as it was. Returns the name written.
 * `options.filters` (S72) records a filtered search under its filtered name.
 *
 * A library function only: `pnpm record-fixtures` (`scripts/record-fixtures.ts`) has no search form
 * yet, so `fixtures/search-walk-off.json` was recorded by calling this directly (S5, 2026-11-22), as was
 * `fixtures/search--team-147--tag-home-run.json` (S72, 2026-11-23).
 */
export async function recordSearch(query: string, outDir: string, options: Pick<RawRecorderOptions, "fetchImpl"> & { filters?: SearchFilters } = {}): Promise<string>
{
	const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const { url, headers } = searchHighlightsRequest(query, options.filters);
	const response = await doFetch(url, {
		headers: {
			accept: "application/json",
			...headers,
		},
	});
	if (!response.ok) throw new Error(`MLB search ${response.status} for ${query}`);
	const text = await response.text();
	parseSearchResponse(JSON.parse(text));
	const name = searchFixtureName(query, options.filters);
	await mkdir(outDir, {
		recursive: true,
	});
	await writeFile(path.join(outDir, name), text);
	return name;
}

async function writeJson(file: string, data: unknown): Promise<void>
{
	await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Normalized path. Writes the `fixtures/`-shaped files `FixtureMlbStatsClient`
 * reads back.
 *
 * `plays` is written as its own `plays-<gamePk>.json` and stripped from the
 * game file: `fetchGame` overwrites embedded plays with that separate file, so
 * inlining them would round-trip silently to `plays: []`.
 */
export async function recordNormalized(
	client: MlbStatsClient,
	target: RecorderTarget,
	outDir: string,
): Promise<string[]>
{
	const { date, gamePk } = target;
	await mkdir(outDir, {
		recursive: true,
	});
	const written: string[] = [];

	const schedule = await client.fetchSchedule(date);
	await writeJson(path.join(outDir, `schedule-${date}.json`), {
		date: schedule.date,
		games: schedule.games,
	});
	written.push(`schedule-${date}.json`);

	// The game alone: its feed time (S150 AC 2) is never written to a fixture.
	// Its playMetrics waited for, however late (S216 AC 5): a fixture is the whole game.
	const { game } = await wholeFetchedGame(await client.fetchGame(gamePk));
	const {
		fetchedAt: _f, windowMode: _w, plays, ...rest
	} = game;
	await writeJson(path.join(outDir, `game-${gamePk}.json`), rest);
	written.push(`game-${gamePk}.json`);

	await writeJson(path.join(outDir, `plays-${gamePk}.json`), (plays ?? []) as AtBat[]);
	written.push(`plays-${gamePk}.json`);

	written.push(await recordStandings(client, date, outDir));

	const ids = target.playerIds ?? [];
	if (ids.length > 0)
	{
		await writeJson(
			path.join(outDir, `players-${gamePk}.json`),
			await client.fetchPlayers(ids),
		);
		written.push(`players-${gamePk}.json`);
	}
	return written;
}

/**
 * Writes `standings-<date>.json`, the day's table as `client` maps it, and returns its name.
 *
 * Precedence (S160): FixtureMlbStatsClient.fetchStandings serves `raw/standings-<date>.json` when
 * it can read it, and this mapped file only for a day with no recording. So this file is the
 * fallback, never a way to refresh a recorded day on its own: `record-fixtures`' game form records
 * the raw `standings-<date>` through `recordRaw` before `recordNormalized` calls this, in the same run,
 * and its day form uses `recordStandingsDay` instead, which records the raw table first and writes the
 * mapped file from that same answer rather than asking a client. A caller that runs this alone over
 * a recorded day leaves the old recording served.
 */
export async function recordStandings(client: MlbStatsClient, date: string, outDir: string): Promise<string>
{
	return writeStandings(outDir, date, await client.fetchStandings(date));
}

/** Writes a day's table as `standings-<date>.json` (its date and tables only) and returns the name. */
async function writeStandings(outDir: string, date: string, standings: StandingsSnapshot): Promise<string>
{
	await mkdir(outDir, {
		recursive: true,
	});
	await writeJson(path.join(outDir, `standings-${date}.json`), {
		date: standings.date,
		divisions: standings.divisions,
	});
	return `standings-${date}.json`;
}

export type RecordedGame = Omit<Unversioned<GameSnapshot>, "fetchedAt" | "windowMode">;
