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
import type {
	GameSnapshot, LinescoreSummary, ScheduleDay, ScheduleGameSummary, ScheduleLive,
} from "./types.js";
import type { Unversioned, VersionStamp } from "./versioning.js";
import type { CadenceParams } from "./window.js";
import {
	DEFAULT_CADENCE, isGameInActiveWindow, isLiveStatus, scheduleWindowMode,
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

/** A scoreboard game as a stored day keeps it (S150 AC 5): everything but the shared state, which `game_states` holds. */
export type StoredScheduleGame = Omit<ScheduleGameSummary, "status" | "linescore" | "live">;

/**
 * A schedule day as `schedule_days` stores it (S150 AC 5): which games, their start times, probable pitchers,
 * decisions and records, with no status, linescore or live moment. The fetched and served day (`ScheduleDay`) keeps
 * its shape; `joinScheduleDay` builds it from this and the games' rows.
 */
export type StoredScheduleDay = Omit<ScheduleDay, "games"> & {
	games: StoredScheduleGame[];
};

/** A fetched day as it is stored: each game without its status, linescore and live moment. */
export function toStoredScheduleDay<T extends Pick<ScheduleDay, "games">>(day: T): Omit<T, "games"> & { games: StoredScheduleGame[] }
{
	return {
		...day,
		games: day.games.map(({
			status: _status, linescore: _linescore, live: _live, ...game
		}) => game),
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
function nameIn(plays: GameSnapshot["plays"], id: number | null, role: "batter" | "pitcher"): string | null
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
 * A game's state (S150 AC 1) from what the feed fetch returns: runners, batter and pitcher from its `live`, their
 * names from its at-bats, the count from its linescore. Like the schedule's (`mapScheduleLive`), the moment is
 * `null` unless the game is live (`isLiveStatus`). Works on any already-mapped game, so MLB, recorded fixtures and the
 * dev seed give the same state.
 */
export function gameStateFromGame(game: Pick<GameSnapshot, "status" | "linescore" | "live" | "plays">): Unversioned<GameState>
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

/** What the switch reads of a row or of an incoming write: its status, first pitch and official date. */
export type GameStateClock = {
	state: Pick<GameState, "status">;
	officialDate: string;
	startTime: string | null;
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
 */
export function gameStateSource(row: GameStateClock | null, incoming: GameStateClock, now: Date, params: CadenceParams = DEFAULT_CADENCE): GameStateSource
{
	const clock = row ?? incoming;
	return isGameInActiveWindow({
		status: clock.state.status,
		officialDate: clock.officialDate,
		startTime: clock.startTime,
	}, now, params) ? "feed" : "schedule";
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
 * - `version` is the stored day's version plus `servedBase` (the day's `served_base`, raised by the state version of
 *   each game a refresh drops from it) plus the state versions of the games it lists, so it only rises: a state change
 *   raises it, and a dropped game doesn't lower it.
 * - `lastChangedAt` is the latest of the day's and its rows'.
 * - `windowMode` is computed here from the joined games (`scheduleWindowMode`), never taken from the stored day,
 *   whose games carry no status.
 */
export function joinScheduleDay(
	day: StoredScheduleDay,
	servedBase: number,
	rows: ReadonlyMap<number, GameState>,
	fallbacks: ReadonlyMap<number, Unversioned<GameState>>,
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): ScheduleDay
{
	let version = day.version + servedBase;
	let lastChangedAt = day.lastChangedAt;
	const games: ScheduleGameSummary[] = day.games.map((game) =>
	{
		const row = rows.get(game.gamePk);
		if (row)
		{
			version += row.version;
			if (Date.parse(row.lastChangedAt) > Date.parse(lastChangedAt)) lastChangedAt = row.lastChangedAt;
		}
		const state = row ?? fallbacks.get(game.gamePk) ?? SCHEDULED;
		return {
			...game,
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
 * The live feed's own time (MLB's `metaData.timeStamp`, `YYYYMMDD_HHMMSS` in UTC, e.g. `20260905_233435`) as an ISO
 * instant (S150 AC 2); `undefined` when there is none or it isn't in that form.
 */
export function feedTimeToIso(timeStamp: string | undefined): string | undefined
{
	const match = timeStamp ? /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(timeStamp) : null;
	if (!match) return undefined;
	const [, y, mo, d, h, mi, s] = match;
	const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
	return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}
