/**
 * A game's shared state, stored once (S150; owner, 2026-11-17: "seems like we should store game linescores in one
 * table that is referenced wherever it is needed"): what MLB's schedule and its live feed both carry for a game (its
 * status, linescore and on-field moment), held in one `game_states` row per game and written through one switch
 * (`gameStateSource`; owner, same day: "a single point which switches sources, as opposed to two separate places
 * independently checking"). Readers join it into the served day (`joinScheduleDay`) and the served game.
 *
 * MLB's schedule carries no time of its own per game, so the two sources can't be ordered by age: while a game is in
 * its live window the feed (polled every few seconds) owns its row; before and after it the schedule does (owner,
 * 2026-11-17: "I like your idea of a sort of "railroad switch" based on game state.").
 */
import type { AtBat } from "./plays.js";
import type {
	GameSnapshot, LinescoreSummary, ScheduleDay, ScheduleGameSummary, ScheduleLive,
} from "./types.js";
import type { Unversioned, VersionStamp } from "./versioning.js";
import type { CadenceParams } from "./window.js";
import {
	DEFAULT_CADENCE, isGameInActiveWindow, isLiveStatus, isPostponedStatus, isSuspendedStatus, scheduleWindowMode,
} from "./window.js";

/**
 * What the schedule and the live feed both carry for a game (S150 AC 1): its status, its linescore and its on-field
 * moment (runners, batter and pitcher with their names, the count; `null` unless the game is live), stamped with the
 * ADR-022 `version` and `lastChangedAt` of the `game_states` row that holds it.
 */
export type GameState = VersionStamp & {
	status: GameSnapshot["status"];
	linescore: LinescoreSummary | null;
	live: ScheduleLive | null;
};

/** Which source wrote a game's row: the live feed or the schedule. */
export type GameStateSource = "feed" | "schedule";

/**
 * One `game_states` row (S150 AC 3): the state, the source that wrote it, the newest feed time the row has accepted
 * (`null` until the feed writes one), and what the switch needs to place the game in its window: its official date
 * and first pitch (`null` when no write has carried one).
 */
export type GameStateRow = {
	gamePk: number;
	source: GameStateSource;
	feedTime: string | null;
	officialDate: string;
	startTime: string | null;
	state: GameState;
};

/**
 * A game as the port's game fetch returns it (S150 AC 2): the unversioned game beside the feed's own time (MLB's
 * `metaData.timeStamp` as an ISO instant), never merged into it, so no stored game or API response carries it. A
 * fetch with no feed time (fixtures, the dev seed, older recordings) leaves it out.
 */
export type FetchedGame = {
	game: Unversioned<GameSnapshot>;
	feedTime?: string;
};

/**
 * A scoreboard game as a stored day keeps it (S150 AC 5): everything but the shared state, which `game_states` holds.
 * A postponed or suspended listing also keeps its own status as `listingStatus` (owner, 2026-11-23, on a postponed game
 * made up on a later day: "Original day: Postponed (Recommended)"), which `joinScheduleDay` serves when the game has
 * since moved to another day; it is never named `status`, which only the game's row holds.
 */
export type StoredScheduleGame = Omit<ScheduleGameSummary, "status" | "linescore" | "live"> & {
	listingStatus?: ScheduleGameSummary["status"];
};

/**
 * A schedule day as `schedule_days` stores it (S150 AC 5): which games, their start times, probable pitchers,
 * decisions and records, with no status, linescore or live moment. The fetched and served day (`ScheduleDay`) keeps
 * its shape; `joinScheduleDay` builds it from this and the games' rows.
 */
export type StoredScheduleDay = Omit<ScheduleDay, "games"> & {
	games: StoredScheduleGame[];
};

/**
 * A fetched day as it is stored: each game without its status, linescore and live moment, a postponed or suspended
 * listing keeping its status as `listingStatus` (`StoredScheduleGame`). It is kept for every such listing, since the
 * listing alone can't say whether its game will be made up elsewhere; the join decides when to serve it.
 */
export function toStoredScheduleDay<T extends Pick<ScheduleDay, "games">>(day: T): Omit<T, "games"> & { games: StoredScheduleGame[] }
{
	return {
		...day,
		games: day.games.map(({
			status, linescore: _linescore, live: _live, ...game
		}) => isPostponedStatus(status.codedGameState) || isSuspendedStatus(status.codedGameState)
			? {
				...game,
				listingStatus: status,
			}
			: game),
	};
}

/** A scoreboard row's state (S150 AC 1): what the schedule fetch carries for the game. */
export function gameStateFromSummary(summary: Pick<ScheduleGameSummary, "status" | "linescore" | "live">): Unversioned<GameState>
{
	return {
		status: summary.status,
		linescore: summary.linescore,
		live: summary.live ?? null,
	};
}

/**
 * The name of the player `id` names, from the newest at-bat that has him as batter (`role` "batter") or pitcher. The
 * feed's current play is its last at-bat, so the moment's batter and pitcher are normally found there; `null` when no
 * at-bat names him.
 */
function nameIn(plays: GameStateFields["plays"], id: number | null, role: "batter" | "pitcher"): string | null
{
	if (id === null) return null;
	for (let i = plays.length - 1; i >= 0; i--)
	{
		const person = plays[i]!.matchup[role];
		if (person.id === id) return person.fullName;
	}
	return null;
}

/**
 * What `gameStateFromGame` reads of a game: its status, linescore and live moment, and the matchups of its at-bats
 * (for the batter's and pitcher's names). A stored game's are read alone (`GameRepository.getStateFields`), with only
 * its last at-bat, where the current batter and pitcher are normally found.
 */
export type GameStateFields = Pick<GameSnapshot, "gamePk" | "status" | "linescore" | "live"> & {
	plays: readonly Pick<AtBat, "matchup">[];
};

/**
 * A game's state (S150 AC 1) from what the feed fetch returns: runners, batter and pitcher from its `live`, their
 * names from its at-bats, the count from its linescore. Like the schedule's (`mapScheduleLive`), the moment is
 * `null` unless the game is live (`isLiveStatus`). Works on any already-mapped game, so MLB, recorded fixtures and the
 * dev seed give the same state.
 */
export function gameStateFromGame(game: Omit<GameStateFields, "gamePk">): Unversioned<GameState>
{
	const live = game.live && isLiveStatus(game.status.codedGameState)
		? {
			runners: {
				...game.live.runners,
			},
			batterId: game.live.batterId,
			pitcherId: game.live.pitcherId,
			batterName: nameIn(game.plays, game.live.batterId, "batter"),
			pitcherName: nameIn(game.plays, game.live.pitcherId, "pitcher"),
			balls: game.linescore?.balls ?? null,
			strikes: game.linescore?.strikes ?? null,
			outs: game.linescore?.outs ?? null,
		}
		: null;
	return {
		status: game.status,
		linescore: game.linescore,
		live,
	};
}

/**
 * What the switch reads of a row or of an incoming write: its status, first pitch and official date, and, for a stored
 * row, which source wrote it and when its state last changed (a write has neither).
 */
export type GameStateClock = {
	state: Pick<GameState, "status"> & Partial<Pick<GameState, "lastChangedAt">>;
	officialDate: string;
	startTime: string | null;
	source?: GameStateSource;
};

/**
 * The switch (S150 AC 4): which source may write a game's row at `now`. It asks the live window
 * (`isGameInActiveWindow`, measured from first pitch, a postponed game always out of it) with the row's stored status,
 * first pitch and official date, or `incoming`'s when there is no row yet: `"feed"` while the game is in its window (a
 * game in progress or delayed past its expected end, and a final game's trail, included), `"schedule"` before and
 * after it. A game with no row still takes its first state from either source (`switchGameState`).
 *
 * Reading the stored status is safe: inside the window only the feed writes it, and outside it a schedule write that
 * finds the game started (`I`) is let through, and that write puts the game in its window, handing the row to the feed.
 * The one place the rule lives: neither writer checks anything itself.
 *
 * A row the feed wrote final or suspended measures its window from when its state last changed as well as from first
 * pitch, whichever ends later: a final's trail runs from its change (`endedAt`), a suspended game's six hours too
 * (`suspendedAt`). Otherwise a game that went final, or was suspended, more than the usual window after first pitch (a
 * long rain delay) would be out of its window as soon as the feed wrote it, and a lagging schedule copy still showing
 * it in progress could put it back to live. Once that later window ends the schedule owns the row again, and nothing
 * polls the feed for it then, which is intended: the game is over or stopped.
 */
export function gameStateSource(row: GameStateClock | null, incoming: GameStateClock, now: Date, params: CadenceParams = DEFAULT_CADENCE): GameStateSource
{
	const clock = row ?? incoming;
	const fedChange = clock.source === "feed" ? clock.state.lastChangedAt ?? null : null;
	return isGameInActiveWindow({
		status: clock.state.status,
		officialDate: clock.officialDate,
		startTime: clock.startTime,
		suspendedAt: fedChange,
		endedAt: fedChange,
	}, now, params) ? "feed" : "schedule";
}

/**
 * Whether a stored listing is served with its own postponed or suspended status because its game has moved to another
 * day (S150 AC 6): it kept one (`listingStatus`), the game has a row, and the row's official date isn't the listing's
 * day. The join serves such a listing as that day's (`joinScheduleDay`), and a day whose other games are all settled
 * counts as settled with it (`isScheduleDaySettled`), since what is left of the game is the other day's.
 */
export function listingMovedAway(game: Pick<StoredScheduleGame, "listingStatus">, row: Pick<GameStateRow, "officialDate"> | undefined, date: string): boolean
{
	return listingStatusOf(game) !== undefined && row !== undefined && row.officialDate !== date;
}

/**
 * A stored listing's own postponed or suspended status: its `listingStatus`, or, for a game a day stored before S150
 * (whose games still carry their own `status`, which the stored type no longer names), that status when it is
 * postponed or suspended. Such days are re-stored in the new shape by their next refresh; until then a postponed
 * game's original day would otherwise serve its makeup's state.
 */
function listingStatusOf(game: Pick<StoredScheduleGame, "listingStatus">): ScheduleGameSummary["status"] | undefined
{
	if (game.listingStatus) return game.listingStatus;
	const old = (game as { status?: ScheduleGameSummary["status"] }).status;
	return old && (isPostponedStatus(old.codedGameState) || isSuspendedStatus(old.codedGameState)) ? old : undefined;
}

/**
 * Whether a schedule write is another day's listing of the game rather than the game's state (S150 AC 4), so it never
 * changes the row: the listing is itself postponed or suspended, its official date isn't the row's, and either the row
 * isn't postponed or suspended (the game is now listed to be played, or played, on the row's day) or the listing's date
 * is earlier than the row's (the game was postponed or suspended again on a later day, which holds it now). So a
 * postponed or suspended game's original day never takes the row back from its makeup or resumption day (owner,
 * 2026-11-23: "Original day: Postponed (Recommended)"), while a game MLB simply moves, earlier or later, takes its new
 * day's listing, and a makeup's or resumption's own listing takes over a row its original day wrote. The one case it
 * doesn't settle, MLB keeping the original official date on both listings, is #439.
 */
export function isOtherDaysListing(row: Pick<GameStateClock, "state" | "officialDate">, incoming: Pick<GameStateClock, "state" | "officialDate">): boolean
{
	const setAside = (code: string) => isPostponedStatus(code) || isSuspendedStatus(code);
	return setAside(incoming.state.status.codedGameState) && incoming.officialDate !== row.officialDate
		&& (!setAside(row.state.status.codedGameState) || incoming.officialDate < row.officialDate);
}

/** A game BT has no state for: scheduled, with no score. */
const SCHEDULED: Unversioned<GameState> = {
	status: {
		abstractGameState: "Preview",
		codedGameState: "S",
		detailedState: "Scheduled",
	},
	linescore: null,
	live: null,
};

/**
 * The served day (S150 AC 6): a stored day joined with its games' rows by the gamePks it lists. A game with no row
 * is served with `fallbacks`' state for it (what its stored snapshot holds, `gameStateFromGame`), or as scheduled
 * with no score when BT has neither.
 *
 * A listing with its own postponed or suspended status (`listingStatus`, or the old-shape status of a day stored
 * before S150, `listingStatusOf`) is served with that status when its game
 * has moved to another day (`listingMovedAway`: the row's official date isn't this day's), or has no row at all, so the
 * original day shows Postponed and only the makeup day shows the game (owner, 2026-11-23: "Original day: Postponed
 * (Recommended)"). It has no moment, and no linescore except a suspended listing's while the row is still suspended
 * (the game stopped and not yet resumed, whose score so far is the row's); once the game has resumed or finished, its
 * score belongs to the day it moved to. Its row's version still counts in the day's version below.
 *
 * A limit (#439): the test is the row's official date against the day's date. If MLB keeps a game's original official
 * date on both listings (as it may for a suspended game resumed on a later day), the row's date never moves, the two
 * days' listings both write the row, and both days can flip between the listings' states on every refresh.
 *
 * - `version` is the stored day's version plus `servedBase` (the day's `served_base`, raised by the state version of
 *   each game a refresh drops from it) plus the state versions of the games it lists, so it only rises: a state change
 *   raises it, and a dropped game doesn't lower it.
 * - `lastChangedAt` is the latest of the day's and its rows'.
 * - `windowMode` is judged here from the joined games by the clock alone (`scheduleWindowMode`), never taken from the
 *   stored day, whose games carry no status. A suspended game's window also depends on when BT saw it suspended, which
 *   only the stored game knows, so the service's day read (`readJoinedScheduleDay`) replaces it with
 *   `scheduleDayWindowMode` of the joined games.
 */
export function joinScheduleDay(
	day: StoredScheduleDay,
	servedBase: number,
	rows: ReadonlyMap<number, Pick<GameStateRow, "state" | "officialDate">>,
	fallbacks: ReadonlyMap<number, Unversioned<GameState>>,
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): ScheduleDay
{
	let version = day.version + servedBase;
	let lastChangedAt = day.lastChangedAt;
	const games: ScheduleGameSummary[] = day.games.map((game) =>
	{
		const { listingStatus: _own, ...listed } = game;
		const listingStatus = listingStatusOf(game);
		const row = rows.get(game.gamePk);
		if (row)
		{
			version += row.state.version;
			if (Date.parse(row.state.lastChangedAt) > Date.parse(lastChangedAt)) lastChangedAt = row.state.lastChangedAt;
		}
		const ownListing = listingStatus && (!row || listingMovedAway(game, row, day.date));
		const state = ownListing
			? {
				status: listingStatus,
				linescore: isSuspendedStatus(listingStatus.codedGameState) && row && isSuspendedStatus(row.state.status.codedGameState) ? row.state.linescore : null,
				live: null,
			}
			: row?.state ?? fallbacks.get(game.gamePk) ?? SCHEDULED;
		return {
			...listed,
			status: state.status,
			linescore: state.linescore,
			live: state.live,
		};
	});
	return {
		date: day.date,
		games,
		fetchedAt: day.fetchedAt,
		windowMode: scheduleWindowMode(games, now, params),
		version,
		lastChangedAt,
	};
}

/**
 * How far ahead of the fetch time a feed time may be and still be taken. The fetch time is read before the request,
 * so a real feed time is often seconds after it, and MLB's clock and ours differ a little; a time further ahead is
 * wrong, and taken as the row's accepted feed time it would make every real poll after it look stale.
 */
export const FEED_TIME_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The live feed's own time (MLB's `metaData.timeStamp`, `YYYYMMDD_HHMMSS` in UTC, e.g. `20260905_233435`) as an ISO
 * instant (S150 AC 2); `undefined` when there is none, it isn't in that form, a part is out of range (a month 13 or a
 * February 30 is refused, never rolled over into another date), or it is more than `FEED_TIME_TOLERANCE_MS` after
 * `fetchedAt`, the time the fetch began. A feed time left out is never skipped for its time and never moves the row's
 * accepted one.
 */
export function feedTimeToIso(timeStamp: string | undefined, fetchedAt: Date): string | undefined
{
	const match = timeStamp ? /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(timeStamp) : null;
	if (!match) return undefined;
	const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
	const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
	if (Number.isNaN(at.getTime())) return undefined;
	const roundTrips = at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
		&& at.getUTCHours() === h && at.getUTCMinutes() === mi && at.getUTCSeconds() === s;
	if (!roundTrips || at.getTime() > fetchedAt.getTime() + FEED_TIME_TOLERANCE_MS) return undefined;
	return at.toISOString();
}
