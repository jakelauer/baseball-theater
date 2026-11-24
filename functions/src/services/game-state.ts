/**
 * The one writer of `game_states` and its readers (S150). `switchGameState` is the only code that writes a game's
 * row (the baseball-data copy, `baseball-copy.ts`, aside): the schedule refresh (`storeSchedule`) and the game's
 * ingest (`storeGame`) hand it every state they fetch, with their source, and check nothing themselves; it asks the
 * switch (`gameStateSource`) once. The readers join the rows into the served day (`readScheduleDay`) and the served
 * game (`servedGame`), so every page reads a game's score from the one stored place.
 */
import type {
	CadenceParams, GameSnapshot, GameState, GameStateRow, GameStateSource, ScheduleDay, StoredScheduleDay, Unversioned,
} from "@bt/domain";
import {
	addDays, DEFAULT_CADENCE, gameStateFromGame, gameStateSource, isOtherDaysListing, isSuspendedStatus, joinScheduleDay, listingMovedAway, mlbToday, scheduleWindowMode,
	stampVersion, suspendedSince,
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
 * What the switch did with one game's write: the row as it is then stored (null when the game has none), whether
 * the write was skipped as a feed copy older than the row's accepted feed time (`storeGame` then stores no snapshot when
 * one is already stored), and whether it stored a new state version (S212: what tells the writers a served day or game
 * changed, so they purge its edge copy; a feed time moved on an unchanged state is not one). `before` is the row as the
 * switch read it before its write (null when the game had none), so a writer can tell whether what it changed was past
 * and finished before the write without another read (S212 review).
 */
export type SwitchOutcome = {
	row: GameStateRow | null;
	before: GameStateRow | null;
	staleFeed: boolean;
	stateChanged: boolean;
};

/**
 * The switch's decision for one write against its game's stored row (`row`, null when there is none): the row to
 * write, or why nothing is written. A game with no row takes its first state from either source; otherwise
 * `gameStateSource` alone decides whose the row is, and a state from the other source is dropped. Another day's
 * postponed or suspended listing of the game is dropped too (`isOtherDaysListing`: a postponed game's original day once
 * its makeup day holds the row; that day serves its own status, `joinScheduleDay`). A feed state older
 * than the row's accepted feed time is skipped (a stale copy of the feed). The state is stamped with `stampVersion`,
 * so an unchanged state isn't a new version; a changed official date or first pitch with an unchanged state is one,
 * since the window the switch reads moved; and an unchanged feed poll with a newer feed time is written with the stored
 * state itself, so the repository takes it as the same state and moves only the accepted feed time.
 */
function decide(row: GameStateRow | null, write: GameStateWrite, now: Date): GameStateRow | "otherSource" | "otherDaysListing" | "staleFeed" | "unchanged"
{
	const startTime = write.startTime ?? null;
	const may = gameStateSource(row, {
		state: write.state,
		officialDate: write.officialDate,
		startTime,
	}, now);
	if (row !== null && may !== write.source) return "otherSource";
	// Another day's postponed or suspended listing of the game, not its state (`isOtherDaysListing`): it never changes the
	// row, so the two days' refreshes can't flip it; that day shows its own status (`joinScheduleDay`).
	if (row !== null && write.source === "schedule" && isOtherDaysListing(row, {
		state: write.state,
		officialDate: write.officialDate,
	})) return "otherDaysListing";
	const feedTime = write.source === "feed" ? write.feedTime ?? null : null;
	if (row?.feedTime && feedTime !== null && feedTime < row.feedTime) return "staleFeed";

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
		else if (laterFeed) state = row.state;
		else return "unchanged";
	}
	return {
		gamePk: write.gamePk,
		source: write.source,
		feedTime,
		officialDate: write.officialDate,
		startTime,
		state,
	};
}

/** The row as the repository stores it once it has taken `next` over `row` (the port's write rule). */
function storedAfter(row: GameStateRow | null, next: GameStateRow): GameStateRow
{
	const feedTime = [row?.feedTime ?? null, next.feedTime].filter((t): t is string => t !== null).sort().at(-1) ?? null;
	const startTime = next.startTime ?? row?.startTime ?? null;
	if (row && next.state.version === row.state.version) return {
		...row,
		source: next.source,
		feedTime,
		startTime,
	};
	return {
		...next,
		feedTime,
		startTime,
	};
}

/**
 * Writes each of `writes` to its game's row if its source holds the switch at `now` (S150 AC 4, `decide`), and returns
 * each game's outcome by gamePk. The decision is `gameStateSource`'s alone, asked once per write: neither writer checks
 * anything itself.
 *
 * One read and one write for the whole batch (a schedule day's games together): the rows are read with `getMany`,
 * decided in memory and written in one `write`. The batch is de-duplicated by gamePk first (the last write for a game
 * wins: one statement can't write a row twice) and sorted by gamePk, so two batches lock the same rows in the same
 * order. A row the repository refuses (another writer stored a newer version, or the same version with another state,
 * between the read and the write) is read again and decided again from the start, the source and the feed time
 * included, once; a write refused twice leaves the row as the other writer stored it.
 */
export async function switchGameState(deps: Pick<GameStateDeps, "gameStates">, writes: readonly GameStateWrite[], now: Date): Promise<Map<number, SwitchOutcome>>
{
	const latest = new Map<number, GameStateWrite>();
	for (const write of writes) latest.set(write.gamePk, write);
	const pending = [...latest.values()].sort((a, b) => a.gamePk - b.gamePk);
	const outcomes = new Map<number, SwitchOutcome>();
	let todo = pending;
	for (let attempt = 0; attempt < 2 && todo.length > 0; attempt++)
	{
		const rows = new Map((await deps.gameStates.getMany(todo.map((write) => write.gamePk))).map((row) => [row.gamePk, row]));
		const nexts: GameStateRow[] = [];
		for (const write of todo)
		{
			const row = rows.get(write.gamePk) ?? null;
			const decided = decide(row, write, now);
			if (typeof decided === "string") outcomes.set(write.gamePk, {
				row,
				before: row,
				staleFeed: decided === "staleFeed",
				stateChanged: false,
			});
			else nexts.push(decided);
		}
		if (nexts.length === 0) break;
		const taken = new Set(await deps.gameStates.write(nexts));
		for (const next of nexts)
		{
			if (taken.has(next.gamePk)) outcomes.set(next.gamePk, {
				row: storedAfter(rows.get(next.gamePk) ?? null, next),
				before: rows.get(next.gamePk) ?? null,
				staleFeed: false,
				stateChanged: rows.get(next.gamePk)?.state.version !== next.state.version,
			});
		}
		todo = todo.filter((write) => !outcomes.has(write.gamePk));
	}
	// Writes refused on both tries: the row as the other writer left it.
	const refused = pending.filter((write) => !outcomes.has(write.gamePk));
	if (refused.length > 0)
	{
		const stored = new Map((await deps.gameStates.getMany(refused.map((write) => write.gamePk))).map((row) => [row.gamePk, row]));
		// Another writer stored the row; its own write purged what it changed.
		for (const write of refused) outcomes.set(write.gamePk, {
			row: stored.get(write.gamePk) ?? null,
			before: stored.get(write.gamePk) ?? null,
			staleFeed: false,
			stateChanged: false,
		});
	}
	return outcomes;
}

/**
 * A stored day and the day it is served as (S150 AC 6), or null when nothing is stored for `date`: `joinScheduleDay`
 * over the day's rows, a game with no row served from its stored snapshot (`gameStateFromGame` of the fields
 * `GameRepository.getStateFields` reads, all such games in one read), or as scheduled. Its `windowMode` is
 * `scheduleDayWindowMode` of the joined games, which judges a suspended game from when BT saw it suspended.
 * The stored day is returned too, since its own `fetchedAt` and `lastChangedAt` (its schedule data) are what the day
 * read's refresh judges, and so are the gamePks of the listings served as this day's because their games moved to
 * another day (`listingMovedAway`), which the day's settledness counts as settled (`isScheduleDaySettled`).
 */
export async function readJoinedScheduleDay(deps: GameStateDeps, date: string, now: Date): Promise<{ stored: StoredScheduleDay;
	served: ScheduleDay;
	moved: ReadonlySet<number>; } | null>
{
	const held = await deps.schedules.getWithServedBase(date);
	if (!held) return null;
	const gamePks = held.day.games.map((game) => game.gamePk);
	const rows = new Map((await deps.gameStates.getMany(gamePks)).map((row) => [row.gamePk, row]));
	return joinStoredScheduleDay(deps, held.day, held.servedBase, rows, now);
}

/**
 * {@link readJoinedScheduleDay}'s join of a stored day over the game rows given (`rows`, by gamePk; a game without one
 * is served from its stored snapshot's fields, read here, or as scheduled). Also how `storeSchedule` judges whether a
 * day it changed was past and finished before its write (S212 review): the stored day as it read it, over the rows as
 * the switch read them.
 */
export async function joinStoredScheduleDay(deps: Pick<GameStateDeps, "games">, day: StoredScheduleDay, servedBase: number, rows: ReadonlyMap<number, GameStateRow>, now: Date): Promise<{ stored: StoredScheduleDay;
	served: ScheduleDay;
	moved: ReadonlySet<number>; }>
{
	const missing = day.games.map((game) => game.gamePk).filter((pk) => !rows.has(pk));
	const fallbacks = new Map<number, Unversioned<GameState>>(missing.length === 0
		? []
		: (await deps.games.getStateFields(missing)).map((fields) => [fields.gamePk, gameStateFromGame(fields)]));
	const served = joinScheduleDay(day, servedBase, rows, fallbacks, now);
	// The joined games' window, a suspended game's judged from when BT saw it suspended, as every stored day's is.
	return {
		stored: day,
		served: {
			...served,
			windowMode: await scheduleDayWindowMode(deps, served, now),
		},
		moved: new Set(day.games.filter((game) => listingMovedAway(game, rows.get(game.gamePk), day.date)).map((game) => game.gamePk)),
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

/**
 * {@link scheduleWindowMode} of a day's games, its suspended games judged by {@link withSuspendedAt}: what every path
 * that stores or serves a schedule day uses as its `windowMode`, so they judge a day alike (ADR-025).
 */
export async function scheduleDayWindowMode(
	deps: Pick<GameStateDeps, "games">,
	day: Pick<ScheduleDay, "date" | "games">,
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<ScheduleDay["windowMode"]>
{
	return scheduleWindowMode(await withSuspendedAt(deps, day.date, day.games, now), now, params);
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
