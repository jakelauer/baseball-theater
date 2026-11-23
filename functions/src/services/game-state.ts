/**
 * The one writer of `game_states` and its readers (S150). `switchGameState` is the only code that writes a game's
 * row (the baseball-data copy, `baseball-copy.ts`, aside): the schedule refresh (`storeSchedule`) and the game's
 * ingest (`storeGame`) hand it every state they fetch, with their source, and check nothing themselves; it asks the
 * switch (`gameStateSource`) once. The readers join the rows into the served day (`readScheduleDay`) and the served
 * game (`servedGame`), so every page reads a game's score from the one stored place.
 */
import type {
	GameSnapshot, GameState, GameStateRow, GameStateSource, ScheduleDay, StoredScheduleDay, Unversioned,
} from "@bt/domain";
import {
	addDays, gameStateFromGame, gameStateSource, isSuspendedStatus, joinScheduleDay, mlbToday, scheduleWindowMode, stampVersion, suspendedSince,
} from "@bt/domain";
import type {
	GameRepository, GameStateRepository, ScheduleRepository,
} from "@bt/ports";

/** What the game-state reads and writes need. */
export type GameStateDeps = {
	schedules: ScheduleRepository;
	games: GameRepository;
	gameStates: GameStateRepository;
};

/** One fetched state handed to the switch: whose it is, what it is, and what places the game in its window. */
export type GameStateWrite = {
	gamePk: number;
	source: GameStateSource;
	state: Unversioned<GameState>;
	officialDate: string;
	/** First pitch; absent when the source didn't carry one (a write without one never clears a stored one). */
	startTime?: string | null;
	/** The live feed's own time (`FetchedGame.feedTime`); only a feed write carries one. */
	feedTime?: string;
};

/**
 * Writes `write` to its game's row if its source holds the switch at `now` (S150 AC 4), and returns the row as it is
 * then stored (null when the game has none). The decision is `gameStateSource`'s alone, asked once: a game with no row
 * takes its first state from either source; otherwise a state from the other source is dropped. A feed state older
 * than the row's accepted feed time is skipped too (a stale copy of the feed). The state is stamped with
 * `stampVersion`, so an unchanged state isn't a new version, but an unchanged feed poll with a newer feed time is
 * still written, moving the row's accepted feed time (the repository's rule), so a stale copy between two polls is
 * then skipped. A changed official date or first pitch with an unchanged state is a new version too, since the
 * window the switch reads moved.
 */
export async function switchGameState(deps: Pick<GameStateDeps, "gameStates">, write: GameStateWrite, now: Date): Promise<GameStateRow | null>
{
	const row = await deps.gameStates.getByPk(write.gamePk);
	const startTime = write.startTime ?? null;
	const may = gameStateSource(row, {
		state: write.state,
		officialDate: write.officialDate,
		startTime,
	}, now);
	if (row !== null && may !== write.source) return row;
	const feedTime = write.source === "feed" ? write.feedTime ?? null : null;
	if (row?.feedTime && feedTime !== null && feedTime < row.feedTime) return row;

	const at = now.toISOString();
	let state = stampVersion<GameState>(row?.state ?? null, write.state, at);
	if (row && state.version === row.state.version)
	{
		const moved = write.officialDate !== row.officialDate || (startTime !== null && startTime !== row.startTime);
		const laterFeed = feedTime !== null && (row.feedTime === null || feedTime > row.feedTime);
		if (moved) state = {
			...state,
			version: row.state.version + 1,
			lastChangedAt: at,
		};
		else if (!laterFeed) return row;
	}
	const next: GameStateRow = {
		gamePk: write.gamePk,
		source: write.source,
		feedTime,
		officialDate: write.officialDate,
		startTime,
		state,
	};
	if (!await deps.gameStates.write(next)) return deps.gameStates.getByPk(write.gamePk);
	return {
		...next,
		feedTime: [row?.feedTime ?? null, feedTime].filter((t): t is string => t !== null).sort().at(-1) ?? null,
		startTime: startTime ?? row?.startTime ?? null,
	};
}

/**
 * A stored day and the day it is served as (S150 AC 6), or null when nothing is stored for `date`: `joinScheduleDay`
 * over the day's rows, a game with no row served from its stored snapshot (`gameStateFromGame`), or as scheduled.
 * The stored day is returned too, since its own `fetchedAt` and `lastChangedAt` (its schedule data) are what the day
 * read's refresh judges.
 */
export async function readJoinedScheduleDay(deps: GameStateDeps, date: string, now: Date): Promise<{ stored: StoredScheduleDay;
	served: ScheduleDay; } | null>
{
	const held = await deps.schedules.getWithServedBase(date);
	if (!held) return null;
	const gamePks = held.day.games.map((game) => game.gamePk);
	const rows = new Map((await deps.gameStates.getMany(gamePks)).map((row) => [row.gamePk, row.state]));
	const fallbacks = new Map<number, Unversioned<GameState>>();
	for (const gamePk of gamePks.filter((pk) => !rows.has(pk)))
	{
		const snapshot = await deps.games.getByPk(gamePk);
		if (snapshot) fallbacks.set(gamePk, gameStateFromGame(snapshot));
	}
	const served = joinScheduleDay(held.day, held.servedBase, rows, fallbacks, now);
	// The joined games' window, a suspended game's judged from when BT saw it suspended, as every stored day's is.
	return {
		stored: held.day,
		served: {
			...served,
			windowMode: scheduleWindowMode(await withSuspendedAt(deps, date, served.games, now), now),
		},
	};
}

/** A schedule summary as the window judges it: with its game's `suspendedAt` when it is listed suspended (#323). */
export type WindowedSummary = ScheduleDay["games"][number] & { suspendedAt?: string };

/**
 * A schedule day's games with each suspended one's `suspendedAt` (#79, #323), so the schedule path
 * judges a suspended game's window as its own ingest does: a schedule row carries no such time, so it
 * is `suspendedSince` of the stored game, read only for a game listed suspended. When the schedule
 * sees the suspension before the game's ingest has stored it (the stored game still in progress and
 * polled), that is `now`, which holds the game in its window until the ingest's next poll stores
 * the real time, within one interval.
 *
 * Only for a day the cron polls, MLB's today or the day before: any other day's games are returned
 * as they are and judged by the clock alone. A game suspended on an older day and resumed since under
 * the same gamePk is stored in progress and polled, and `now` would keep that old day `active` on
 * every re-read with nothing to clear it. A later day listing the game for its resumption would
 * borrow today's suspension time and be stored `active`, which the read path never refreshes
 * (`needsRefresh`) until the cron reaches it. It also spares those days the reads.
 */
export async function withSuspendedAt(deps: Pick<GameStateDeps, "games">, date: string, games: readonly ScheduleDay["games"][number][], now: Date): Promise<WindowedSummary[]>
{
	const today = mlbToday(now);
	if (date < addDays(today, -1) || date > today) return [...games];
	const windowed: WindowedSummary[] = [];
	for (const game of games)
	{
		if (!isSuspendedStatus(game.status.codedGameState))
		{
			windowed.push(game);
			continue;
		}
		const suspendedAt = suspendedSince(await deps.games.getByPk(game.gamePk), game.status.codedGameState, now.toISOString());
		windowed.push(suspendedAt === undefined ? game : {
			...game,
			suspendedAt,
		});
	}
	return windowed;
}

/** The served day for `date` (S150 AC 6), read only: never asks MLB. Null when nothing is stored for it. */
export async function readScheduleDay(deps: GameStateDeps, date: string, now: Date = new Date()): Promise<ScheduleDay | null>
{
	return (await readJoinedScheduleDay(deps, date, now))?.served ?? null;
}

/**
 * The served game (S150 AC 6): the stored snapshot with its status and linescore from its row (the snapshot's own
 * when there is none), keeping the snapshot's `version`, so the HTTP read and the game hub's pushes compare as before,
 * and taking the later `lastChangedAt` of the two, so its cache headers (ADR-021) follow a state change.
 */
export function servedGame(snapshot: GameSnapshot, row: Pick<GameStateRow, "state"> | null): GameSnapshot
{
	if (!row) return snapshot;
	return {
		...snapshot,
		status: row.state.status,
		linescore: row.state.linescore,
		lastChangedAt: Date.parse(row.state.lastChangedAt) > Date.parse(snapshot.lastChangedAt) ? row.state.lastChangedAt : snapshot.lastChangedAt,
	};
}

/** The served game for `gamePk` from the store (`servedGame`), or null when no snapshot is stored. */
export async function readServedGame(deps: Pick<GameStateDeps, "games" | "gameStates">, gamePk: number): Promise<GameSnapshot | null>
{
	const snapshot = await deps.games.getByPk(gamePk);
	return snapshot ? servedGame(snapshot, await deps.gameStates.getByPk(gamePk)) : null;
}
