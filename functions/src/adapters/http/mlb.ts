/**
 * Live MLB Stats API adapter.
 *
 * Opt-in only: `local-server.ts` keeps `FixtureMlbStatsClient` as the default
 * and constructs this one when `BT_USE_LIVE_MLB=1`. Fixtures stay the CI path
 * so `pnpm verify` never needs network.
 *
 * Highlights come from the content endpoint (`/api/v1/game/{gamePk}/content`);
 * the live feed hydrate carries no playback URLs.
 */
import type {
	FetchedGame,
	GameGraphContent,
	GamePlayMetrics,
	GameSnapshot,
	PlayerOfTheGame,
	PlayerProfile,
	ScheduleDay,
	SearchFilters,
	SearchHighlightsPage,
	SeasonCalendar,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import {
	datesBetween, feedTimeToIso, mlbSearchQuery, playerOfTheGameExpected, rankHighlightsByImpact,
} from "@bt/domain";
import type {
	GameContentResponse, GameDiffPatchResponse, LiveFeedResponse,
} from "@bt/mlb-api";
import {
	parseGameContentResponse,
	parseGameDiffPatchResponse,
	parseGraphContentResponse,
	parseGameTimestamps,
	parseLiveFeedResponse,
	parsePeopleResponse,
	parsePlayMetricsResponse,
	parsePlayerOfTheGameResponse,
	parseScheduleResponse,
	parseSearchResponse,
	parseSeasonsResponse,
	parseStandingsResponse,
} from "@bt/mlb-api";
import type {
	GameEditorial, MlbGameSources, MlbStatsClient,
} from "@bt/ports";
import { inPool } from "../in-pool.js";
import { mapContentHighlights, mapRecap } from "../../mappers/content.js";
import { assembleGame } from "../../mappers/game-extras.js";
import { mapGraphContent } from "../../mappers/graph-content.js";
import { mapPeople } from "../../mappers/players.js";
import { mapSearchResults } from "../../mappers/search.js";
import { mapStandings } from "../../mappers/standings.js";
import { mapLiveFeed } from "../../mappers/live.js";
import { mapPlayMetrics } from "../../mappers/play-metrics.js";
import { mapPlayerOfTheGame } from "../../mappers/player-of-the-game.js";
import { mapScheduleRange, mapScheduleResponse } from "../../mappers/schedule.js";
import { mapSeasonCalendar } from "../../mappers/season-calendar.js";

const DEFAULT_BASE_URL = "https://statsapi.mlb.com";

/** An upstream request: the URL, and any headers it needs beyond `accept`. */
export type MlbRequest = {
	url: string;
	headers?: Record<string, string>;
};

/**
 * MLB's GraphQL game content for one game (S94): the persisted query `getGamesByGamePks`
 * on `data-graph.mlb.com`, as mlb.com's game pages ask it. The hash, the variables and the
 * `x-client-name: mlb` and `content-type: application/json` headers (without either the
 * gateway answers 400 with an empty body) live
 * only here; the recorder (S14) records the same request. MLB can retire the hash at any time,
 * so callers treat the answer as optional.
 */
export function graphContentRequest(gamePk: number): MlbRequest
{
	const extensions = {
		persistedQuery: {
			operationName: "getGamesByGamePks",
			sha256Hash: "e12a5c2692406844d5f15f52ce7754208f53da81867de7d3e9e773611f4a040a",
			version: 1,
		},
	};
	const variables = {
		gameRecapTags: ["game-recap"],
		relatedArticleTags: ["storytype-article"],
		gamePks: [gamePk],
		locale: "EN_US",
		contentSource: "MLB",
	};
	const query = new URLSearchParams({
		operationName: "getGamesByGamePks",
		extensions: JSON.stringify(extensions),
		variables: JSON.stringify(variables),
	});
	return {
		url: `https://data-graph.mlb.com/graphql/?${query}`,
		headers: {
			"x-client-name": "mlb",
			"content-type": "application/json",
		},
	};
}

/** How many clips one search asks for: the prior site's page (36), which AC 8 leaves open. */
export const SEARCH_PAGE_SIZE = 36;

/**
 * MLB's highlight search (S5, S72; ADR-029): the `search` query on `fastball-gateway.mlb.com`, as the
 * prior site's search page asks it, newest first. Words alone go as `queryType: FREETEXT` (without it MLB
 * reads the words as Film Room filters and refuses them). With a `date`, `team` or `tag` filter it is
 * `mlbSearchQuery`'s `STRUCTURED` query instead (`Date`, `TeamId` and `ContentTags` clauses, the words as
 * `Description ~ [...]`), since MLB's free-text search ignores filters written into it. `query` goes out
 * as `mlbSearchText` words, so `walk-off` is sent as `walk off`, which MLB matches (a hyphenated word matches nothing). The gateway
 * answers a GET, so this is an `MlbRequest` the client's one sender sends, like
 * `graphContentRequest`. Each clip's `guid` and `playInfo { inning inningHalf gamePk teams }` are asked
 * for beside its `id`: the clubs give the row's matchup, and the play id and inning its inning pill
 * (S153). `recordSearch` (`services/recorder.ts`) records the same request; it is a
 * library function, with no `pnpm record-fixtures` form yet, so a recording is made by calling it.
 */
export function searchHighlightsRequest(query: string, filters: SearchFilters = {}): MlbRequest
{
	const graphql = `query Search($queryType: QueryType!, $query: String!, $page: Int, $limit: Int, $languagePreference: LanguagePreference, $contentPreference: ContentPreference) {
	search(queryType: $queryType, languagePreference: $languagePreference, contentPreference: $contentPreference, limit: $limit, page: $page, query: $query) {
		total
		plays {
			id
			gamePk
			gameDate
			mediaPlayback {
				id
				title
				blurb
				description
				date
				guid
				playInfo { inning inningHalf gamePk teams { away { id triCode } home { id triCode } } }
				feeds { duration image { cuts { width src } } playbacks { name url } }
			}
		}
	}
}`;
	// Free text, or MLB's filter language once a filter is set (S72): `mlbSearchQuery` is the one rule.
	const asked = mlbSearchQuery(query, filters);
	const params = new URLSearchParams({
		operationName: "Search",
		query: graphql,
		variables: JSON.stringify({
			queryType: asked.queryType,
			query: asked.query,
			limit: SEARCH_PAGE_SIZE,
			page: 0,
			languagePreference: "EN",
			contentPreference: "MIXED",
		}),
	});
	return {
		url: `https://fastball-gateway.mlb.com/graphql?${params}`,
	};
}

/**
 * MLB's play-metrics feed (S93): an internal mlb.com source on its own host, not the Stats
 * API, asked for every category. `highLeverage=false` only empties the top-level list; each
 * at-bat still says `isHighLeverage`. The recorder (S14) records the same URL.
 */
export function playMetricsUrl(gamePk: number): string
{
	return `https://bdfed.stitch.mlbinfra.com/bdfed/playMetrics/${gamePk}?keyMoments=true&scoringPlays=true&homeRuns=true&strikeouts=true&hardHits=true&highLeverage=false&leadChange=true&winProb=true&absChallenge=true`;
}

/**
 * MLB's player of the game (S99): an mlb.com app feed on its own host, not the Stats API, as
 * `playMetricsUrl` is. The recorder (S14) records the same URL.
 */
export function playerOfTheGameUrl(gamePk: number): string
{
	return `https://www.mlb.com/apps/player-of-the-game/game/json/winners/${gamePk}.json`;
}

/** One season's calendar (S111); the recorder (S14) records the same URL. */
export function seasonsUrl(season: number, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/seasons/${season}?sportId=1`;
}

/**
 * Both leagues' standings as of `date` (S4), with each team and each record group's division hydrated
 * (S102: `division` names the group, `American League East` / `AL East` / `ALE`, so BT keeps no table of
 * division names). MLB answers a `date` only
 * together with its `season` — as of 2026-11-07, `date` without `season` gets a 500 for every date (found smoke-testing v3.0.0)
 * — so the season is the date's year. The recorder (S14) records the same URL.
 */
export function standingsUrl(date: string, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/standings?leagueId=103,104&season=${date.slice(0, 4)}&date=${date}&hydrate=team,division`;
}

/**
 * A season's final regular-season table (S128): MLB's standings for the season with no `date`,
 * which after the regular season is how it finished (checked 2026-11-07: 6 records, 30 teams;
 * every date after the regular season answers 0). Divisions hydrated as `standingsUrl`'s are (S102).
 * The recorder (S14) records the same URL.
 */
export function finalStandingsUrl(season: number, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/standings?leagueId=103,104&season=${season}&hydrate=team,division`;
}

/**
 * A season's spring training standings as of `date` (S128): `standingsTypes=springTraining`,
 * which MLB groups by spring league (Cactus / Grapefruit divisions) under the same division ids.
 * Divisions hydrated as `standingsUrl`'s are (S102). The recorder (S14) records the same URL.
 */
export function springStandingsUrl(season: number, date: string, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=springTraining&date=${date}&hydrate=team,division`;
}

/** One season's World Series schedule (S111): its last listed game is the season's final. */
export function worldSeriesUrl(season: number, baseUrl = DEFAULT_BASE_URL): string
{
	return `${baseUrl}/api/v1/schedule?sportId=1&gameType=W&season=${season}`;
}

/** The content payload as BT keeps it: its mapped videos and recap. */
function editorialOf(content: GameContentResponse): GameEditorial
{
	return {
		highlights: mapContentHighlights(content),
		recap: mapRecap(content),
	};
}

/** The single-day schedule hydrate, the one the recorder records with (`services/recorder.ts`). */
const SCHEDULE_HYDRATE =
	"team,linescore(matchup,runners),flags,liveLookin,review,decisions,person,probablePitcher,stats,game(content(media(featured,epg),summary))";

/**
 * What a schedule range request hydrates (#399): {@link SCHEDULE_HYDRATE} without the four parts
 * `mapScheduleGame` never reads (flags, live look-in, review and game content), so a day stored
 * from a range maps the same as one from a single-day request (the tests pin the exact difference
 * and strip those parts from the recording to compare). With them a month's answer was 20–29 MB
 * and 10–15 s cold, and a staging month read came back with no days at all.
 */
const SCHEDULE_RANGE_HYDRATE = "team,linescore(matchup,runners),decisions,person,probablePitcher,stats";

/**
 * The longest span one schedule request asks for (#399). The `stats` hydrate the probables need is
 * still ~0.5 MB a day, so a month in one request was ~15 MB and ~6 s cold even without content;
 * a week is ~4 MB and ~1.5–2 s.
 */
const SCHEDULE_RANGE_DAYS = 7;

/**
 * How many of a range's week-long requests are in flight at once (#399): a month's five go out
 * together, and a longer range (a year is 53) never holds more than five bodies, ~20 MB, at a time
 * in a Worker's 128 MB.
 */
const SCHEDULE_RANGE_CONCURRENCY = 5;

/**
 * How long a game fetch waits for MLB's playMetrics before answering without them (S216 AC 5): 750 ms. The latency probe
 * of 2026-11-24 (`.run/reports/latency-1124.md`) measured playMetrics at 0.71–0.78 s, the slowest of a game's four
 * calls, so a cold game's answer waited on it; at this limit most answers still carry them, and a slower one is
 * answered without them while the same request finishes after the response (`FetchedGame.playMetricsLate`).
 */
export const PLAY_METRICS_LIMIT_MS = 750;

export interface HttpMlbStatsClientOptions {
	baseUrl?: string;
	/** Injected in tests; defaults to global `fetch`. */
	fetchImpl?: typeof fetch;
	now?: () => Date;
}

export class HttpMlbStatsClient implements MlbStatsClient, MlbGameSources
{
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly now: () => Date;

	constructor(options: HttpMlbStatsClientOptions = {})
	{
		this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		this.now = options.now ?? (() => new Date());
	}

	async fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>
	{
		const url = `${this.baseUrl}/api/v1/schedule?sportId=1&date=${date}&hydrate=${SCHEDULE_HYDRATE}`;
		const payload = parseScheduleResponse(await this.getJson(url));
		return mapScheduleResponse(payload, date, this.now().toISOString(), "active");
	}

	/**
	 * The range (S124) as requests of at most {@link SCHEDULE_RANGE_DAYS} days, at most
	 * {@link SCHEDULE_RANGE_CONCURRENCY} in flight, each parsed and mapped before the next starts in
	 * its place (#399), with {@link SCHEDULE_RANGE_HYDRATE}, so a stored day reads the same as one
	 * from the single-day request. Any one failing rejects the whole range, as one request failing did.
	 */
	async fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>
	{
		const fetchedAt = this.now().toISOString();
		const dates = datesBetween(startDate, endDate);
		const spans: [string, string][] = [];
		for (let i = 0; i < dates.length; i += SCHEDULE_RANGE_DAYS)
		{
			spans.push([dates[i]!, dates[Math.min(i + SCHEDULE_RANGE_DAYS, dates.length) - 1]!]);
		}
		const parts = await inPool(spans, SCHEDULE_RANGE_CONCURRENCY, async ([first, last]) =>
		{
			const url = `${this.baseUrl}/api/v1/schedule?sportId=1&startDate=${first}&endDate=${last}&hydrate=${SCHEDULE_RANGE_HYDRATE}`;
			return mapScheduleRange(parseScheduleResponse(await this.getJson(url)), first, last, fetchedAt, "active");
		});
		return parts.flat();
	}

	/**
	 * The live feed, then its three extras (content, playMetrics, GraphQL content) at once, assembled into one game
	 * (`assembleGame`). S216 AC 5: playMetrics get {@link PLAY_METRICS_LIMIT_MS}; when they haven't arrived by then and
	 * by the time the other two have, the game is built without them, as when their request fails, and the same request
	 * keeps running as `playMetricsLate`, the game assembled with them once they come (null if they never do). An
	 * on-read refresh answers the first and stores the second after the response; every other caller waits for the
	 * whole game (`wholeFetchedGame`).
	 *
	 * S99: beside the game, `playerOfTheGameDue` from the feed's game type and season (`playerOfTheGameExpected`); the
	 * pick itself is never asked here, so a fetch costs no extra request: the ingest paths ask it
	 * (`withAskedPlayerOfTheGame`) only while a due game's stored pick lacks a side.
	 */
	async fetchGame(gamePk: number): Promise<FetchedGame>
	{
		const { raw, fetched: { game: feed, feedTime } } = await this.liveFeed(gamePk);
		const playMetrics = this.fetchPlayMetrics(gamePk);
		let arrived: { value: GamePlayMetrics | null } | undefined;
		void playMetrics.then((value) =>
		{
			arrived = {
				value,
			};
		});
		let timer: ReturnType<typeof setTimeout> | undefined;
		const limit = new Promise<void>((resolve) =>
		{
			timer = setTimeout(resolve, PLAY_METRICS_LIMIT_MS);
		});
		const extras = Promise.all([this.fetchContent(gamePk), this.fetchGameGraphContent(gamePk), Promise.race([playMetrics, limit])]);
		const [content, graph] = await extras.finally(() => clearTimeout(timer));
		const editorial = content ? editorialOf(content) : null;
		const late = arrived === undefined;
		const build = (metrics: GamePlayMetrics | null) => assembleGame(feed, editorial, metrics, graph);
		const playerOfTheGameDue = playerOfTheGameExpected({
			gameType: raw.gameData.game?.type,
			season: raw.gameData.game?.season,
			codedGameState: feed.status.codedGameState,
		});
		return {
			game: build(arrived?.value ?? null),
			...feedTime !== undefined && {
				feedTime,
			},
			...playerOfTheGameDue && {
				playerOfTheGameDue,
			},
			...late && {
				playMetricsLate: playMetrics.then((value) => value ? build(value) : null),
			},
		};
	}

	/**
	 * The live feed alone (S122): what `fetchGame` adds its extras to. Beside the game, the feed's own time (MLB's
	 * `metaData.timeStamp`) as an ISO instant (S150 AC 2), left out when the feed has none or it can't be right
	 * (`feedTimeToIso`).
	 */
	async fetchGameFeed(gamePk: number): Promise<FetchedGame>
	{
		return (await this.liveFeed(gamePk)).fetched;
	}

	/** The live feed as MLB sent it (`fetchGame` reads its game type and season, S99) and as `fetchGameFeed` answers it. */
	private async liveFeed(gamePk: number): Promise<{ raw: LiveFeedResponse;
		fetched: FetchedGame; }>
	{
		const feedUrl = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live`;
		const raw = parseLiveFeedResponse(await this.getJson(feedUrl));
		// Read after the response, so the tolerance only has to cover the two clocks' difference.
		const now = this.now();
		const feedTime = feedTimeToIso(raw.metaData?.timeStamp, now);
		return {
			raw,
			fetched: {
				game: mapLiveFeed(raw, now.toISOString(), "active"),
				...feedTime !== undefined && {
					feedTime,
				},
			},
		};
	}

	/** The content endpoint's videos and recap (S122); null when it fails or has neither. */
	async fetchGameEditorial(gamePk: number): Promise<GameEditorial | null>
	{
		const content = await this.fetchContent(gamePk);
		if (!content) return null;
		const editorial = editorialOf(content);
		return editorial.highlights.length > 0 || editorial.recap ? editorial : null;
	}

	async fetchStandings(date: string): Promise<StandingsSnapshot>
	{
		return this.standingsAt(standingsUrl(date, this.baseUrl), date);
	}

	/** Dated by the season's year until the caller (the standings service) names its `regularSeasonEndDate`. */
	async fetchFinalStandings(season: number): Promise<StandingsSnapshot>
	{
		return this.standingsAt(finalStandingsUrl(season, this.baseUrl), `${season}-12-31`);
	}

	async fetchSpringStandings(season: number, date: string): Promise<StandingsSnapshot>
	{
		return this.standingsAt(springStandingsUrl(season, date, this.baseUrl), date);
	}

	/** One standings request, mapped; `date` is the day the table is labelled with. */
	private async standingsAt(url: string, date: string): Promise<StandingsSnapshot>
	{
		const payload = parseStandingsResponse(await this.getJson(url));
		return {
			...mapStandings(payload, date, this.now().toISOString()),
			windowMode: "active",
		};
	}

	async fetchPlayers(ids: number[]): Promise<PlayerProfile[]>
	{
		if (ids.length === 0) return [];
		const season = this.now().getUTCFullYear();
		const hydrate = `stats(group=[hitting,pitching],type=[season],season=${season})`;
		const url = `${this.baseUrl}/api/v1/people?personIds=${ids.join(",")}&hydrate=${encodeURIComponent(hydrate)}`;
		return mapPeople(parsePeopleResponse(await this.getJson(url)));
	}

	/**
	 * MLB's highlight search (S5, S72): free text, or `mlbSearchQuery`'s filtered `STRUCTURED` query once a
	 * filter is set; rejects when MLB errors or answers something that isn't the search's shape.
	 */
	async searchHighlights(query: string, filters?: SearchFilters): Promise<SearchHighlightsPage>
	{
		const { url, headers } = searchHighlightsRequest(query, filters);
		return mapSearchResults(parseSearchResponse(await this.getJson(url, headers)));
	}

	async fetchGameTimestamps(gamePk: number): Promise<string[]>
	{
		const url = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live/timestamps`;
		return parseGameTimestamps(await this.getJson(url));
	}

	async fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>
	{
		const url = `${this.baseUrl}/api/v1.1/game/${gamePk}/feed/live/diffPatch?startTimecode=${startTimecode}&endTimecode=${endTimecode}`;
		return parseGameDiffPatchResponse(await this.getJson(url));
	}

	/** Content is best-effort: a game with no cut highlights still resolves. */
	async fetchGameContent(gamePk: number): Promise<GameSnapshot["highlights"]>
	{
		const content = await this.fetchContent(gamePk);
		return content ? rankHighlightsByImpact(mapContentHighlights(content)) : [];
	}

	/**
	 * The game's content payload (highlights and the editorial recap, S10), or
	 * `undefined` when it can't be had — content is best-effort, never a reason a
	 * game fails to load.
	 */
	/** MLB's GraphQL game content, mapped; null when the call fails, can't be parsed or adds nothing (S94 AC 5). */
	async fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>
	{
		try
		{
			const { url, headers } = graphContentRequest(gamePk);
			return mapGraphContent(parseGraphContentResponse(await this.getJson(url, headers)), gamePk);
		}
		catch
		{
			return null;
		}
	}

	/** The play-metrics feed, mapped; null when it fails, can't be parsed or has no at-bats (S93 AC 5). */
	async fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>
	{
		try
		{
			return mapPlayMetrics(parsePlayMetricsResponse(await this.getJson(playMetricsUrl(gamePk))));
		}
		catch
		{
			return null;
		}
	}

	/** MLB's player of the game, mapped; null when it fails, can't be parsed or names nobody (S99 AC 5). */
	async fetchPlayerOfTheGame(gamePk: number): Promise<PlayerOfTheGame | null>
	{
		try
		{
			return mapPlayerOfTheGame(parsePlayerOfTheGameResponse(await this.getJson(playerOfTheGameUrl(gamePk))));
		}
		catch
		{
			return null;
		}
	}

	/**
	 * The season's calendar with its World Series final (S111) and its regular season's first and
	 * last days (S128, which the dev seed's default range also reads); null when MLB answers that
	 * the season is unpublished (an empty seasons list). A failed request (an HTTP error, no
	 * answer, an unparseable one) rejects instead of answering null: the standings must not
	 * mistake an unreachable calendar for an unpublished one, which would keep last season's
	 * final table on a mid-season day (S128 AC 7).
	 */
	async fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>
	{
		const [seasons, worldSeries] = await Promise.all([
			this.getJson(seasonsUrl(season, this.baseUrl)),
			this.getJson(worldSeriesUrl(season, this.baseUrl)),
		]);
		return mapSeasonCalendar(parseSeasonsResponse(seasons), parseScheduleResponse(worldSeries));
	}

	private async fetchContent(gamePk: number): Promise<GameContentResponse | undefined>
	{
		const url = `${this.baseUrl}/api/v1/game/${gamePk}/content?language=en`;
		try
		{
			return parseGameContentResponse(await this.getJson(url));
		}
		catch
		{
			return undefined;
		}
	}

	private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown>
	{
		const response = await this.fetchImpl(url, {
			headers: {
				accept: "application/json",
				...headers,
			},
		});
		if (!response.ok)
		{
			throw new Error(`MLB Stats API ${response.status} for ${url}`);
		}
		return await response.json();
	}
}
