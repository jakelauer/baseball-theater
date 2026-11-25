import type {
	FetchedGame,
	GameGraphContent,
	GamePlayMetrics,
	GameSnapshot,
	MediaHighlight,
	GameUniforms,
	PlayerOfTheGame,
	PlayerProfile,
	ScheduleDay,
	SearchFilters,
	SearchHighlightsPage,
	SeasonCalendar,
	StandingsSnapshot,
	AtBat,
	Unversioned,
} from "@bt/domain";
import {
	datesBetween, mlbSearchText, rankHighlightsByImpact,
} from "@bt/domain";
import type { GameDiffPatchResponse, ReplayPatchEntry } from "@bt/mlb-api";
import {
	parseGameTimestamps, parseGameUniformsResponse, parseGraphContentResponse, parsePlayMetricsResponse, parsePlayerOfTheGameResponse,
	parseRecordedReplayWalk, parseScheduleResponse, parseSearchResponse,
	parseSeasonsResponse, parseStandingsResponse,
} from "@bt/mlb-api";
import type {
	GameEditorial, MlbGameSources, MlbStatsClient,
} from "@bt/ports";
import { assembleGame } from "../../mappers/game-extras.js";
import { mapGraphContent } from "../../mappers/graph-content.js";
import { mapPlayMetrics } from "../../mappers/play-metrics.js";
import { mapPlayerOfTheGame } from "../../mappers/player-of-the-game.js";
import { mapGameUniforms } from "../../mappers/uniforms.js";
import { mapSearchResults } from "../../mappers/search.js";
import { mapSeasonCalendar } from "../../mappers/season-calendar.js";
import { mapStandings } from "../../mappers/standings.js";

type ScheduleFixture = {
	date: string;
	games: ScheduleDay["games"];
};

type GameFixture = Omit<Unversioned<GameSnapshot>, "fetchedAt" | "windowMode" | "plays"> & {
	plays?: AtBat[];
};

/**
 * The fixture name of a recorded highlight search (S5): `search-<words>.json`, the words MLB is sent
 * (`mlbSearchText`), lower-cased, each run of other characters a hyphen, so `walk-off` and
 * `Walk off` both read `search-walk-off.json`. `recordSearch` (`services/recorder.ts`, a library function
 * with no `pnpm record-fixtures` form yet) writes the same name. A filtered search (S72) adds one
 * `--<filter>-<value>` part per filter after the words (none when there are no words), in the order date,
 * team, tag: `search--team-147--tag-home-run.json` is every Yankees home run,
 * `search-judge--date-2026-09-14.json` Judge's clips that day. The words never hold `--` and no filter
 * value can (a `YYYY-MM-DD` date, a team id, an `isSearchTag` slug), so the first `--` ends the words and
 * the words "team 147 tag home run" (`search-team-147-tag-home-run.json`) never read a filtered recording.
 */
export function searchFixtureName(query: string, filters: SearchFilters = {}): string
{
	const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	const words = slug(mlbSearchText(query));
	let name = words ? `search-${words}` : "search";
	if (filters.date !== undefined) name += `--date-${slug(filters.date)}`;
	if (filters.teamId !== undefined) name += `--team-${filters.teamId}`;
	if (filters.tag !== undefined) name += `--tag-${slug(filters.tag)}`;
	return `${name}.json`;
}

/**
 * Where the committed fixtures come from: files under `fixtures/` (Node, `./mlb.ts`)
 * or JSON bundled into the Worker (`./bundled.ts`, ADR-017 — a Worker has no `node:fs`).
 * Names are relative to `fixtures/` (`game-744834.json`, `raw/timestamps-823823.json`).
 */
export interface FixtureFiles
{
	/** The parsed JSON of `name`; rejects when there is no such fixture. */
	read(name: string): Promise<unknown>;
	/** The top-level fixture names (`fixtures/*`, not `raw/`). */
	list(): Promise<string[]>;
}

/**
 * The MLB client over committed fixtures (local dev and CI never touch the network).
 * Reads go through a `FixtureFiles` source, so the same client serves Node and the Worker.
 */
export class FixtureClient implements MlbStatsClient, MlbGameSources
{
	/** The recorded diffPatch walk is 5+ MB; the capture command asks for every
   * adjacent pair, so parse it once per gamePk and index the pairs. */
	private readonly diffPatchWalks = new Map<number, Map<string, ReplayPatchEntry>>();

	constructor(private readonly files: FixtureFiles) {}

	private async readJson<T>(name: string): Promise<T>
	{
		return await this.files.read(name) as T;
	}

	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const file = `schedule-${date}.json`;
		try
		{
			const data = await this.readJson<ScheduleFixture>(file);
			const now = new Date().toISOString();
			return {
				date: data.date,
				games: data.games,
				fetchedAt: now,
				windowMode: "cache",
			};
		}
		catch
		{
			return {
				date,
				games: [],
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
			};
		}
	}

	/** Each day of the range as {@link fetchSchedule} reads it (S124): its fixture, or no games without one. */
	async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		return Promise.all(datesBetween(startDate, endDate).map((date) => this.fetchSchedule(date)));
	}

	/**
	 * The committed game with its extras; a fixture carries no feed time (S150 AC 2). Like the HTTP client it never asks
	 * for the player of the game (S99); it says the game is due one when there is a recording,
	 * `fixtures/raw/potg-<gamePk>.json`, since a game file keeps no game type or season and only a game MLB picks for has
	 * a recording.
	 */
	async fetchGame(gamePk: number): Promise<FetchedGame>
	{
		const { game: feed, playerOfTheGameDue } = await this.fetchGameFeed(gamePk);
		const editorial = await this.fetchGameEditorial(gamePk);
		const playMetrics = await this.fetchPlayMetrics(gamePk);
		const graph = await this.fetchGameGraphContent(gamePk);
		return {
			game: assembleGame(feed, editorial, playMetrics, graph),
			...playerOfTheGameDue && {
				playerOfTheGameDue,
			},
		};
	}

	/**
	 * The committed game without its videos or recap (S122): what the live feed alone gives, with S99's
	 * `playerOfTheGameDue` when the game has a player-of-the-game recording (see `fetchGame`).
	 */
	async fetchGameFeed(gamePk: number): Promise<FetchedGame>
	{
		const {
			highlights: _highlights, recap: _recap, ...data
		} = await this.readJson<GameFixture>(`game-${gamePk}.json`);
		const playerOfTheGameDue = await this.files.read(`raw/potg-${gamePk}.json`).then(() => true, () => false);
		return {
			game: {
				...data,
				plays: await this.loadPlays(gamePk),
				highlights: [],
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
			},
			...playerOfTheGameDue && {
				playerOfTheGameDue,
			},
		};
	}

	/** The committed game's videos and recap (S122); null for a game with neither or no fixture. */
	async fetchGameEditorial(gamePk: number): Promise<GameEditorial | null>
	{
		try
		{
			const data = await this.readJson<GameFixture>(`game-${gamePk}.json`);
			const highlights = data.highlights ?? [];
			if (highlights.length === 0 && !data.recap) return null;
			return {
				highlights,
				...data.recap && {
					recap: data.recap,
				},
			};
		}
		catch
		{
			return null;
		}
	}

	/** Highlights are already ranked onto the committed game fixture. */
	async fetchGameContent(gamePk: number): Promise<MediaHighlight[]>
	{
		const file = `game-${gamePk}.json`;
		try
		{
			const data = await this.readJson<GameFixture>(file);
			return rankHighlightsByImpact(data.highlights ?? []);
		}
		catch
		{
			return [];
		}
	}

	/**
	 * A day's table (S160): MLB's recording `fixtures/raw/standings-<date>.json`, mapped as the
	 * HTTP client maps it, so it carries what the mapper adds (the clinch letter among them). A day
	 * with no readable recording falls back to `standings-<date>.json`, the mapped table the
	 * normalized recorder writes (`recordNormalized`), and then, matching `fetchSchedule`, to an
	 * empty table rather than a throw, so a local day with no committed fixture still renders.
	 * "No readable recording" is a read that fails, which in Node includes a file that is not
	 * valid JSON (`nodeFixtureFiles` parses as it reads); valid JSON of the wrong shape throws.
	 */
	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		return this.recordedStandings(`raw/standings-${date}.json`, date, async () =>
		{
			try
			{
				const data = await this.readJson<StandingsSnapshot>(`standings-${date}.json`);
				return {
					...data,
					fetchedAt: new Date().toISOString(),
					windowMode: "cache",
				};
			}
			catch
			{
				return undefined;
			}
		});
	}

	/**
   * The committed player fixtures are keyed by the game they were recorded
   * from, so this scans them and returns the requested ids in the order asked.
   */
	async fetchPlayers(ids: number[]): Promise<PlayerProfile[]>
	{
		const players = await this.loadPlayers();
		const byId = new Map(players.map((player) => [player.playerId, player]));
		return ids
			.map((id) => byId.get(id))
			.filter((player): player is PlayerProfile => player !== undefined);
	}

	private async loadPlayers(): Promise<PlayerProfile[]>
	{
		const dir = await this.files.list().catch(() => [] as string[]);
		const files = dir.filter(
			(name) => name.startsWith("players-") && name.endsWith(".json"),
		);
		const loaded = await Promise.all(
			files.map((name) =>
				this.readJson<PlayerProfile[]>(name).catch(() => []),
			),
		);
		return loaded.flat();
	}

	/**
	 * A recorded highlight search (MLB's answer verbatim), mapped as the HTTP client maps it:
	 * `fixtures/search-<words>.json` for words alone (S5), or with S72's filters the filtered name,
	 * such as `fixtures/search--team-147--tag-home-run.json` (`searchFixtureName`, one rule for both). No
	 * results for a search with no recording, so local search answers offline. A recording that reads but
	 * isn't the search's shape throws, as MLB's would.
	 */
	async searchHighlights(query: string, filters?: SearchFilters): Promise<SearchHighlightsPage>
	{
		let payload: unknown;
		try
		{
			payload = await this.readJson(searchFixtureName(query, filters));
		}
		catch
		{
			return {
				total: 0,
				highlights: [],
			};
		}
		return mapSearchResults(parseSearchResponse(payload));
	}

	/**
	 * The recorded GraphQL game content, `fixtures/raw/graphql-content-<gamePk>.json` (S94),
	 * mapped; null for a game with no recording, as the HTTP client answers when the call fails.
	 */
	async fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>
	{
		try
		{
			return mapGraphContent(parseGraphContentResponse(await this.readJson(`raw/graphql-content-${gamePk}.json`)), gamePk);
		}
		catch
		{
			return null;
		}
	}

	/**
	 * The recorded play-metrics feed, `fixtures/raw/playmetrics-<gamePk>.json` (S93), mapped;
	 * null for a game with no recording, as the HTTP client answers when the feed fails.
	 */
	async fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>
	{
		try
		{
			return mapPlayMetrics(parsePlayMetricsResponse(await this.readJson(`raw/playmetrics-${gamePk}.json`)));
		}
		catch
		{
			return null;
		}
	}

	/**
	 * The recorded player of the game, `fixtures/raw/potg-<gamePk>.json` (S99), mapped; null for a
	 * game with no recording, as the HTTP client answers when the feed fails.
	 */
	async fetchPlayerOfTheGame(gamePk: number): Promise<PlayerOfTheGame | null>
	{
		try
		{
			return mapPlayerOfTheGame(parsePlayerOfTheGameResponse(await this.readJson(`raw/potg-${gamePk}.json`)));
		}
		catch
		{
			return null;
		}
	}

	/**
	 * The recorded uniforms, `fixtures/raw/uniforms-<gamePk>.json` (S101), mapped; null for a game
	 * with no recording, as the HTTP client answers when the call fails.
	 */
	async fetchGameUniforms(gamePk: number): Promise<GameUniforms | null>
	{
		try
		{
			return mapGameUniforms(parseGameUniformsResponse(await this.readJson(`raw/uniforms-${gamePk}.json`)), gamePk);
		}
		catch
		{
			return null;
		}
	}

	/**
	 * A season's final table from the recording `fixtures/raw/standings-<season>-final.json`
	 * (S128), mapped as the HTTP client maps it; an empty table for a season with no recording.
	 */
	async fetchFinalStandings(season: number): Promise<StandingsSnapshot>
	{
		return this.recordedStandings(`raw/standings-${season}-final.json`, `${season}-12-31`);
	}

	/**
	 * A season's spring table from `fixtures/raw/standings-<season>-spring.json` (S128): one
	 * recording per season, served for every spring day; an empty table for a season with none.
	 */
	async fetchSpringStandings(season: number, date: string): Promise<StandingsSnapshot>
	{
		return this.recordedStandings(`raw/standings-${season}-spring.json`, date);
	}

	/**
	 * A recorded MLB standings response, `file`, mapped as the HTTP client maps it. When it can't be
	 * read, `fallback`'s table if it gives one, else an empty table. A recording that reads but
	 * isn't MLB's shape throws (`parseStandingsResponse`), never falling back.
	 */
	private async recordedStandings(
		file: string,
		date: string,
		fallback: () => Promise<StandingsSnapshot | undefined> = async () => undefined,
	): Promise<StandingsSnapshot>
	{
		let records: unknown;
		try
		{
			records = await this.readJson(file);
		}
		catch
		{
			const table = await fallback();
			if (table) return table;
			records = {
				records: [],
			};
		}
		return mapStandings(parseStandingsResponse(records), date);
	}

	/**
	 * The recorded calendar and World Series, `fixtures/raw/seasons-<season>.json` and
	 * `worldseries-<season>.json` (S111), mapped as the HTTP client maps them; null for a
	 * season with no recording, as MLB answers for one it hasn't published.
	 */
	async fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>
	{
		try
		{
			const [seasons, worldSeries] = await Promise.all([
				this.readJson(`raw/seasons-${season}.json`),
				this.readJson(`raw/worldseries-${season}.json`),
			]);
			return mapSeasonCalendar(parseSeasonsResponse(seasons), parseScheduleResponse(worldSeries));
		}
		catch
		{
			return null;
		}
	}

	/** Recorded timecode list from `fixtures/raw/timestamps-<gamePk>.json`. */
	async fetchGameTimestamps(gamePk: number): Promise<string[]>
	{
		const file = `raw/timestamps-${gamePk}.json`;
		return parseGameTimestamps(await this.readJson(file));
	}

	/**
   * The recorded walk in `fixtures/raw/diffpatch-<gamePk>.json` holds one entry
   * per adjacent timecode pair, so a lookup by `(start, end)` reproduces what
   * `/feed/live/diffPatch` returned. An unknown pair means no change.
   */
	async fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>
	{
		let byPair = this.diffPatchWalks.get(gamePk);
		if (!byPair)
		{
			const file = `raw/diffpatch-${gamePk}.json`;
			const walk = parseRecordedReplayWalk(await this.readJson(file));
			byPair = new Map(
				walk.map((step) => [`${step.startTimecode}:${step.endTimecode}`, step]),
			);
			this.diffPatchWalks.set(gamePk, byPair);
		}
		const entry = byPair.get(`${startTimecode}:${endTimecode}`);
		return [{
			diff: entry?.diff ?? [],
		}];
	}

	private async loadPlays(gamePk: number): Promise<AtBat[]>
	{
		const file = `plays-${gamePk}.json`;
		try
		{
			return await this.readJson<AtBat[]>(file);
		}
		catch
		{
			return [];
		}
	}
}
