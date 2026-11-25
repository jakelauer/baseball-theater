import type {
	FetchedGame,
	GameGraphContent,
	GamePlayMetrics,
	GameRecap,
	MediaHighlight,
	PlayerOfTheGame,
	PlayerProfile,
	ScheduleDay,
	SearchFilters,
	SearchHighlightsPage,
	SeasonCalendar,
	StandingsSnapshot,
	Unversioned,
} from "@bt/domain";
import type { GameDiffPatchResponse } from "@bt/mlb-api";

/**
 * Upstream MLB Stats API–shaped client. Implementations: live HTTP or fixtures.
 * Schedules and games come back unversioned: ingest stamps them against the
 * stored state (`stampVersion`, ADR-022).
 */
export interface MlbStatsClient {
	fetchSchedule(date: string): Promise<Unversioned<ScheduleDay>>;
	/**
	 * Every day from `startDate` to `endDate` (both included) in one call (S124), one entry per day
	 * in order, each shaped as {@link fetchSchedule} shapes its day; the live client asks MLB in
	 * week-long requests, at most five at a time (#399). A day MLB's answer leaves out (it lists only
	 * days with games) comes back with no games. Rejects when any request fails, so a caller can tell
	 * "no games" from "not answered".
	 */
	fetchScheduleRange(startDate: string, endDate: string): Promise<Unversioned<ScheduleDay>[]>;
	/**
	 * The game, with the feed's own time beside it (S150 AC 2, `FetchedGame`): ingest hands that time to the game-state
	 * switch and stores the game without it.
	 */
	fetchGame(gamePk: number): Promise<FetchedGame>;
	/** Highlights + editorial for one game; the only payload with playback URLs. */
	fetchGameContent(gamePk: number): Promise<MediaHighlight[]>;
	/**
	 * MLB's per-at-bat win probability and key-moment flags (S93), from an internal mlb.com
	 * feed: null when it fails or has nothing, never a throw, so a game is served without it.
	 * Ingest calls it (ADR-002); `fetchGame` attaches it as `playMetrics`.
	 */
	fetchPlayMetrics(gamePk: number): Promise<GamePlayMetrics | null>;
	/**
	 * Each video's pitch link and the game's related articles, from MLB's GraphQL game content
	 * (S94; a persisted query MLB may retire): null when it fails or adds nothing, never a
	 * throw. Ingest calls it (ADR-002); `fetchGame` attaches `videoPlayRefs` / `relatedArticles`.
	 */
	fetchGameGraphContent(gamePk: number): Promise<GameGraphContent | null>;
	/**
	 * MLB's player of the game (S99; an mlb.com app feed): the media's and the fans' picks, null when
	 * it fails, can't be parsed or names nobody, never a throw. Ingest calls it (ADR-002), and
	 * `fetchGame` asks it only for a game `playerOfTheGameExpected` says has one, attaching it as
	 * `playerOfTheGame`.
	 */
	fetchPlayerOfTheGame(gamePk: number): Promise<PlayerOfTheGame | null>;
	/** The regular season's standings as of `date` (S4); MLB has none outside the regular season. */
	fetchStandings(date: string): Promise<StandingsSnapshot>;
	/** A season's final regular-season table (S128): MLB's standings for the season with no date. */
	fetchFinalStandings(season: number): Promise<StandingsSnapshot>;
	/** A season's spring training standings as of `date` (S128); empty before its first spring game is final. */
	fetchSpringStandings(season: number, date: string): Promise<StandingsSnapshot>;
	/**
	 * One season's calendar — its first spring game and its last postseason game (S111) — or
	 * null when MLB has not published the season. Rejects when it can't be had (MLB unreachable
	 * or erroring), so a caller can tell unreachable from unpublished (S128 standings); callers
	 * that treat both alike catch the rejection as null.
	 */
	fetchSeasonCalendar(season: number): Promise<SeasonCalendar | null>;
	/** Identity + season lines for the given player ids, in the order returned. */
	fetchPlayers(ids: number[]): Promise<PlayerProfile[]>;
	/**
	 * MLB's free-text highlight search for `query` (S5; ADR-029: asked per search, server-side, as
	 * the prior site asked it), the first page, newest first. `query` is what the fan typed; the
	 * adapter sends it as `mlbSearchText` words. `filters` (S72) narrow it by MLB's own date, team and
	 * content-tag filters, asked as `mlbSearchQuery` forms them (words may then be empty). Rejects when
	 * MLB can't answer, so the route can say so rather than show "no results".
	 */
	searchHighlights(query: string, filters?: SearchFilters): Promise<SearchHighlightsPage>;
	/**
   * `GET /api/v1.1/game/{gamePk}/feed/live/timestamps` — every recorded
   * timecode for a game, oldest first. Used by the post-game replay walk (S22).
   */
	fetchGameTimestamps(gamePk: number): Promise<string[]>;
	/**
   * `GET /api/v1.1/game/{gamePk}/feed/live/diffPatch?startTimecode=&endTimecode=`
   * — the RFC6902 delta between two timecodes, in MLB's one-element wrapper.
   */
	fetchGameDiffPatch(
		gamePk: number,
		startTimecode: string,
		endTimecode: string,
	): Promise<GameDiffPatchResponse>;
}

/** A game's content-endpoint payload as BT keeps it: its videos and its editorial recap (S10). */
export type GameEditorial = {
	highlights: MediaHighlight[];
	recap?: GameRecap;
};

/**
 * A game's sources one at a time (S122), for the backfill: it must tell, per source, whether
 * it answered, and stop asking one it has given up, which `fetchGame`'s fan-out can't do.
 * `fetchGame` is the live feed with all three extras attached; these are its parts.
 */
export interface MlbGameSources extends Pick<MlbStatsClient, "fetchSchedule" | "fetchPlayMetrics" | "fetchGameGraphContent" | "fetchPlayerOfTheGame"> {
	/**
	 * The live feed alone, mapped, with no highlights or extras, and `playerOfTheGameDue` as `fetchGame` says it (S99:
	 * the backfill asks a due game's pick once); throws when it can't be had.
	 */
	fetchGameFeed(gamePk: number): Promise<FetchedGame>;
	/** The content endpoint's videos and recap; null when it fails or has neither, never a throw. */
	fetchGameEditorial(gamePk: number): Promise<GameEditorial | null>;
}
