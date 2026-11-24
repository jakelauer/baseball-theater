import type {
	CadenceParams, GameSnapshot, GameStateRow, ScheduleDay, StoredScheduleDay, Unversioned,
} from "@bt/domain";
import {
	addDays, cacheLifetimeMs, DEFAULT_CADENCE, gameStateFromGame, gameStateFromSummary, isFinalStatus, isGameInActiveWindow, isScheduleDaySettled, mlbToday,
	normalizeStatusCode, projectGame, scheduleWindowMode, stampVersion, suspendedSince, toStoredScheduleDay,
} from "@bt/domain";
import type {
	GameProjectionRepository, GameRepository, GameStateRepository, MlbStatsClient, ScheduleRepository,
} from "@bt/ports";
import type { WindowedSummary } from "./game-state.js";
import {
	readJoinedScheduleDay, readScheduleDay, readServedGame, scheduleDayWindowMode, servedGame, switchGameState, withSuspendedAt,
} from "./game-state.js";
import type { RefreshCoordinator } from "./refresh.js";
import { CACHE_TTL_MS, isStale } from "./refresh.js";

export type IngestDeps = {
	mlb: MlbStatsClient;
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	/** Each game's one stored state (S150), written only through `switchGameState`. */
	gameStates: GameStateRepository;
	now?: () => Date;
	/**
   * Single-flight + cooldown coordinator for out-of-window refresh-on-read.
   * Owned by the long-lived server context (see `local-server.ts`); when absent
   * the read path refreshes directly, without dedup or cooldown.
   */
	refresh?: RefreshCoordinator;
	/**
	 * Where the standings read season calendars from (S139 AC 8): the MLB client's
	 * `fetchSeasonCalendar` kept for a day (`cachedSeasonCalendars`); the MLB client itself when absent.
	 */
	seasonCalendars?: SeasonCalendarSource;
};

/** The one MLB read the standings' calendar cache wraps (S139). */
export type SeasonCalendarSource = Pick<MlbStatsClient, "fetchSeasonCalendar">;

/**
 * Run one upstream refresh for `key`. With a coordinator this is single-flighted
 * and cooldown-gated (it may resolve `undefined` when the cooldown blocks it);
 * without one it just runs `fn`. `countsAsCheck` is passed to the coordinator
 * (`RefreshCoordinator.run`): whether a result counts as a check of `key`.
 *
 * Exported for the month view (S124), whose range fill shares the coordinator's
 * single-flight and cooldown with the day and game reads.
 */
export function runRefresh<T>(
	deps: IngestDeps,
	key: string,
	fn: () => Promise<T>,
	countsAsCheck?: (result: T) => boolean,
): Promise<T | undefined>
{
	return deps.refresh ? deps.refresh.run(key, fn, countsAsCheck) : fn();
}

/**
 * Stamp a fetched game against the stored one and store it if it changed
 * (ADR-022): an unchanged poll keeps its version and writes nothing. One
 * snapshot becomes five BT store documents. Callers read the projections,
 * never the upstream tree, so the snapshot upsert stays the raw-ish record and
 * the projection is what the UI binds to. Returns what is now stored, and the
 * game's state row.
 *
 * Every call, an unchanged snapshot included, first hands the feed's state with its feed
 * time (`feedTime`, never stored on the game) to `switchGameState` (S150 AC 5), so every
 * feed path reaches the switch. The row is written before the snapshot: the served game
 * (`servedGame`) takes its score from the row and its version from the snapshot, so a read
 * between the two writes gets the old version with the new score, and this poll's new
 * version, published after, is still newer than anything a viewer was sent. Written the
 * other way round, a read in between would get the new version with the old score, and the
 * publish of that version with the new score would be refused as not newer (by the hub and
 * the client). A stop between the writes, or a row backfilled from the schedule while the
 * game is live, is mended by the next poll.
 *
 * A feed copy the switch skips as older than the row's accepted feed time (strictly older;
 * a poll with no feed time never is) writes no snapshot either, when one is stored: its
 * plays are as stale as its score. With nothing stored it is written, so the game has one.
 *
 * Every game write passes here, so this is where `suspendedAt` is set (#79, #323): BT's own field,
 * from `suspendedSince` against the stored game, whatever the caller passed. It is set only by the
 * write that changes the status, already a new version, and carried unchanged after, so it never
 * bumps a version on its own; left out when there is none, so a game never suspended hashes as before.
 */
async function storeGame(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates">,
	fetched: Unversioned<GameSnapshot>,
	feedTime?: string,
): Promise<{ snapshot: GameSnapshot;
	state: GameStateRow | null; }>
{
	const outcome = (await switchGameState(deps, [{
		gamePk: fetched.gamePk,
		source: "feed",
		state: gameStateFromGame(fetched),
		officialDate: fetched.officialDate,
		startTime: fetched.startTime ?? null,
		...feedTime !== undefined && {
			feedTime,
		},
	}], new Date(fetched.fetchedAt))).get(fetched.gamePk);
	const state = outcome?.row ?? null;
	const stored = await deps.games.getByPk(fetched.gamePk);
	if (stored && outcome?.staleFeed)
	{
		return {
			snapshot: stored,
			state,
		};
	}
	const { suspendedAt: _ignored, ...upstream } = fetched;
	const suspendedAt = suspendedSince(stored, fetched.status.codedGameState, fetched.fetchedAt);
	const stamped = stampVersion<GameSnapshot>(stored, suspendedAt === undefined ? upstream : {
		...upstream,
		suspendedAt,
	}, fetched.fetchedAt);
	const snapshot = stored && stamped.version === stored.version ? stored : stamped;
	if (snapshot !== stored)
	{
		await deps.games.upsert(snapshot);
		await deps.projections.upsert(projectGame(snapshot));
	}
	return {
		snapshot,
		state,
	};
}

/**
 * The schedule-day counterpart of {@link storeGame}. Exported for the backfill (S122), which
 * asks a day's games one source at a time and so can't go through {@link ingestScheduleDay},
 * and for the month view's range fill (S124), which stores schedule days without hydrating games.
 *
 * S150 AC 5: the day's games' states go to `switchGameState` first, all in one batch, before
 * the day is written and before the early return for an unchanged day, so an unchanged day
 * still hands over a postponement; the day is stored without its games' states
 * (`StoredScheduleDay`). A write that drops a game from the day raises the day's `served_base`
 * by that game's state version in the same write (the repository's `upsert`), so the served
 * day's version never falls. Returns the served day (`readScheduleDay`).
 */
export async function storeSchedule(deps: Pick<IngestDeps, "schedules" | "games" | "gameStates">, fetched: Unversioned<ScheduleDay>): Promise<ScheduleDay>
{
	const now = new Date(fetched.fetchedAt);
	await switchGameState(deps, fetched.games.map((game) => ({
		gamePk: game.gamePk,
		source: "schedule" as const,
		state: gameStateFromSummary(game),
		officialDate: game.officialDate,
		startTime: game.startTime ?? null,
	})), now);
	const stored = await deps.schedules.getByDate(fetched.date);
	const day = stampVersion<StoredScheduleDay>(stored, toStoredScheduleDay(fetched), fetched.fetchedAt);
	if (!stored || day.version !== stored.version) await deps.schedules.upsert(day);
	return (await readScheduleDay(deps, fetched.date, now))!;
}

/**
 * Stores one fetched game the way every ingest path does (`storeGame`: stamped, written
 * only when its content changed, ADR-022, its state handed to the switch with the feed's
 * `feedTime`, S150) and says whether the snapshot changed — the per-game ingest object (S48)
 * publishes only then, as the served game (`servedGame` of the snapshot and the returned row).
 *
 * A poll that changes only the row (it mends a row the migration or the baseball-data copy
 * wrote, or one the schedule wrote while the game was live) keeps the snapshot's version, so
 * it isn't published: the hub and the client take only a newer version, and the served game's
 * version is the snapshot's. Viewers see the mended score with the game's next snapshot change,
 * a few seconds later in play; a new HTTP read serves it at once. Since the row is written
 * first (`storeGame`), a poll never leaves a row behind its own snapshot.
 */
export async function ingestGame(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates">,
	fetched: Unversioned<GameSnapshot>,
	feedTime?: string,
): Promise<{ snapshot: GameSnapshot;
	state: GameStateRow | null;
	changed: boolean; }>
{
	const before = await deps.games.getByPk(fetched.gamePk);
	const { snapshot, state } = await storeGame(deps, fetched, feedTime);
	return {
		snapshot,
		state,
		changed: before?.version !== snapshot.version,
	};
}

/**
 * Whether a stored game's projection is current: present, and of its snapshot's version.
 * {@link storeGame} writes the snapshot, then the projection, so a stop between the two
 * leaves a snapshot ahead of its projection (S122 AC 4).
 */
export async function isProjectionCurrent(deps: Pick<IngestDeps, "projections">, snapshot: GameSnapshot): Promise<boolean>
{
	const projection = await deps.projections.getByPk(snapshot.gamePk);
	return projection !== null && projection.header.version === snapshot.version;
}

/**
 * Finishes {@link storeGame}'s second write for a stored snapshot whose projection is missing
 * or older (S122 AC 4), from the stored snapshot, without asking MLB again. Says whether it
 * wrote anything.
 */
export async function repairProjection(deps: Pick<IngestDeps, "projections">, snapshot: GameSnapshot): Promise<boolean>
{
	if (await isProjectionCurrent(deps, snapshot)) return false;
	await deps.projections.upsert(projectGame(snapshot));
	return true;
}

/**
 * Asks MLB for one day's schedule, once, and stores it (`storeSchedule`: its games' states handed to the switch in one
 * batch, the day written only when it changed, ADR-022), its `windowMode` judged as every stored day's is. Returns the
 * served day. It fetches no game: the day read (`getOrRefreshSchedule`) needs only this, since a scoreboard is the
 * schedule's summaries and the games' stored states (#419: hydrating each final game here made a past day's first
 * read ask MLB for every game's feed in turn, 25–45 s on staging for a 15-game day).
 */
async function refreshScheduleDay(deps: IngestDeps, date: string, now: Date): Promise<ScheduleDay>
{
	const fetched = await deps.mlb.fetchSchedule(date);
	return storeSchedule(deps, {
		...fetched,
		fetchedAt: now.toISOString(),
		windowMode: await scheduleDayWindowMode(deps, fetched, now),
	});
}

/**
 * A day's schedule ({@link refreshScheduleDay}) and then each of its games in their window or finished, fetched and
 * stored one by one: the seed paths' fill (`seed.ts`, `dev-seed.ts`), which want the games stored too. The day read
 * doesn't use it (#419).
 */
export async function ingestScheduleDay(
	deps: IngestDeps,
	date: string,
): Promise<ScheduleDay>
{
	const now = deps.now?.() ?? new Date();
	const day = await refreshScheduleDay(deps, date, now);

	// The joined day (S150 AC 6): each game's status as its one stored state says.
	for (const summary of await withSuspendedAt(deps, day.date, day.games, now))
	{
		// A finished game (final, game over, completed early) is worth storing even out of its window (ADR-025: one decision).
		if (!isGameInActiveWindow(summary, now) && !isFinalStatus(normalizeStatusCode(summary.status.codedGameState)))
		{
			continue;
		}
		try
		{
			const { game, feedTime } = await deps.mlb.fetchGame(summary.gamePk);
			await storeGame(deps, {
				...game,
				fetchedAt: now.toISOString(),
				windowMode: day.windowMode,
			}, feedTime);
		}
		catch
		{
			// Fixture may omit some gamePks; schedule summary still useful.
		}
	}

	return (await readScheduleDay(deps, date, now)) ?? day;
}

/**
 * A cached entity is served as-is unless the caller forces a refresh or it has
 * gone stale: missing, or `windowMode: "cache"` and last checked longer ago than
 * the lifetime that check earned, `cacheLifetimeMs(checkedAt − lastChangedAt)`
 * (ADR-021, S47; the same ladder the edge's `s-maxage` uses), or {@link CACHE_TTL_MS},
 * the floor, without the timestamps. The lifetime is fixed at the check, not at the
 * read: measured from `now` it would always outgrow the time since the check, and
 * nothing would be re-checked before the cap. So each check that finds nothing new
 * lengthens the wait before the next, and one that finds new content resets
 * `lastChangedAt` and drops it back to the floor. An `active`-window entity is never treated as stale
 * here — the cadence loop (S16) owns its freshness.
 *
 * Exported for the month view (S124), which judges a whole month's stored days the same way.
 *
 * "Last checked" is the later of the stored `fetchedAt` and the coordinator's
 * last refresh of `key` that counted as a check (`RefreshCoordinator.lastRefreshedAt`;
 * the month view's failed fill doesn't): an unchanged poll writes nothing (ADR-022), so the
 * stored `fetchedAt` stays at the last change, and without the coordinator's
 * time every read past the TTL would pull MLB again.
 */
export function needsRefresh(
	deps: IngestDeps,
	key: string,
	entity: { fetchedAt?: string;
		lastChangedAt?: string;
		windowMode?: "active" | "cache" } | null,
	now: Date,
	force: boolean,
): boolean
{
	if (force || !entity) return true;
	if (entity.windowMode !== "cache") return false;
	const refreshedAt = deps.refresh?.lastRefreshedAt(key);
	const fetchedAt = entity.fetchedAt ? Date.parse(entity.fetchedAt) : Number.NaN;
	const checkedAt = refreshedAt !== undefined && !(fetchedAt >= refreshedAt) ? new Date(refreshedAt).toISOString() : entity.fetchedAt;
	const changedAt = entity.lastChangedAt ? Date.parse(entity.lastChangedAt) : Number.NaN;
	const checkedMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
	const lifetime = Number.isNaN(changedAt) || Number.isNaN(checkedMs) ? CACHE_TTL_MS : cacheLifetimeMs(checkedMs - changedAt);
	return isStale(checkedAt, now, lifetime);
}

/**
 * The day read (`GET /api/v1/schedule`): the served day (S150 AC 6, `readJoinedScheduleDay`), refreshed from MLB first
 * when the stored day is missing or stale (`needsRefresh` on the joined day's `windowMode` and the stored day's own
 * stamps, its schedule data). A game's score is kept current by its writers, not by this refresh, and the refresh
 * fetches no game (#419): one schedule request, whatever the day holds. A game is fetched when it is read itself
 * (`getOrRefreshGame`) or by the cron's window (`tickIngest`).
 */
export async function getOrRefreshSchedule(
	deps: IngestDeps,
	date: string,
	opts?: { force?: boolean },
): Promise<ScheduleDay>
{
	const now = deps.now?.() ?? new Date();
	const existing = await readJoinedScheduleDay(deps, date, now);
	// S150 AC 6: the joined day's window, with the stored day's own stamps (its schedule data); a game's score is kept
	// current by its writers, not by the day's refresh.
	if (existing && !needsRefresh(deps, `schedule:${date}`, {
		fetchedAt: existing.stored.fetchedAt,
		lastChangedAt: existing.stored.lastChangedAt,
		windowMode: existing.served.windowMode,
	}, now, opts?.force ?? false)) return existing.served;

	const refreshed = await runRefresh(deps, `schedule:${date}`, () =>
		refreshScheduleDay(deps, date, now),
	);
	return refreshed ?? existing?.served ?? refreshScheduleDay(deps, date, now);
}

/**
 * The game read: the stored snapshot, refreshed from MLB first when it is missing or stale, served as `servedGame`
 * (S150 AC 6: its status and linescore from the game's one stored state, the snapshot's version).
 */
export async function getOrRefreshGame(
	deps: IngestDeps,
	gamePk: number,
	opts?: { force?: boolean },
): Promise<GameSnapshot | null>
{
	const now = deps.now?.() ?? new Date();
	const existing = await deps.games.getByPk(gamePk);
	if (!needsRefresh(deps, `game:${gamePk}`, existing, now, opts?.force ?? false)) return existing && servedGame(existing, await deps.gameStates.getByPk(gamePk));

	await runRefresh(deps, `game:${gamePk}`, async () =>
	{
		try
		{
			const { game, feedTime } = await deps.mlb.fetchGame(gamePk);
			await storeGame(deps, {
				...game,
				fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
				windowMode: "cache",
			}, feedTime);
		}
		catch
		{
			// MLB failed: the stored game, if any, is served as it is.
		}
	});
	// S150 AC 6: the served game, its status and linescore from the game's one stored state.
	return readServedGame(deps, gamePk);
}

/**
 * Reads from MLB every schedule day that can hold a game in its window at `now`, stores
 * each (`windowMode` active while any of its games is in its window), and splits their
 * games by the ADR-002 window. The cron's two consumers share it: `tickIngest` fetches the
 * active games itself, and the per-game ingest objects (S48) are ensured for them instead.
 *
 * Those days are MLB's today (`mlbToday`, the US Eastern date, never the UTC one: from
 * 00:00Z the UTC date is already tomorrow while the evening's games are still to come, #73)
 * and the day before, whose late games stay in their trail past US midnight. The day
 * before is skipped once its joined day (S150: each game's status from `game_states`) is
 * settled (`isScheduleDaySettled`), none of its games is in its window, and the stored day
 * was last stored as `cache`: the fetch that finds it out of
 * window is what stores it as `cache`, so a day last stored `active` is never left that way
 * (which would keep it uncached at the edge). So it is usually one schedule request per
 * run, at most two (ADR-002: requests scale with dates in play, not viewers).
 *
 * Today is read first and its failure fails the run, as before. A failed day-before fetch
 * is dropped on its own; the next run retries it. A game on both days (a suspended game
 * resumed the next day keeps its gamePk) is listed once: active if either day's copy is in
 * its window (today's copy first), so it is ensured and fetched once.
 */
export async function refreshTodaysWindow(
	deps: IngestDeps,
	now: Date,
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<{ date: string;
	active: ScheduleDay["games"];
	skipped: number[]; }>
{
	const date = mlbToday(now);
	const dayBefore = addDays(date, -1);
	const games: WindowedSummary[] = [];
	const refresh = async (day: string) =>
	{
		const fetched = await deps.mlb.fetchSchedule(day);
		const windowed = await withSuspendedAt(deps, fetched.date, fetched.games, now);
		await storeSchedule(deps, {
			...fetched,
			fetchedAt: now.toISOString(),
			windowMode: scheduleWindowMode(windowed, now, params),
		});
		games.push(...windowed);
	};

	await refresh(date);
	// The stored day's own `windowMode` says whether it was last stored out of its window; its games' statuses are the
	// joined day's (S150 AC 6), since the stored day has none.
	const held = await readJoinedScheduleDay(deps, dayBefore, now);
	// Read without `withSuspendedAt`: a day listing a suspended game is settled only once the game has moved to another
	// day (`held.moved`), whose own listing then carries its window, so its suspension time can't matter here.
	const dayBeforeDone = held !== null && held.stored.windowMode === "cache" && isScheduleDaySettled(held.served, date, held.moved)
		&& !held.served.games.some((g) => isGameInActiveWindow(g, now, params));
	if (!dayBeforeDone)
	{
		try
		{
			await refresh(dayBefore);
		}
		catch (error)
		{
			// Today is already in hand. A skipped day before is retried by the next cron run, a minute later.
			console.warn(`refreshTodaysWindow: day before ${dayBefore} not refreshed; retrying next run`, error);
		}
	}
	// One entry per gamePk: in window if either day's copy is, else skipped once. A suspended game's
	// window counts from its stored `suspendedAt` (#323); `active` lists the summaries as MLB sent them.
	const active: ScheduleDay["games"] = [];
	for (const game of games)
	{
		if (!isGameInActiveWindow(game, now, params) || active.some((g) => g.gamePk === game.gamePk)) continue;
		const { suspendedAt: _windowOnly, ...summary } = game;
		active.push(summary);
	}
	const skipped = [...new Set(games.map((g) => g.gamePk))].filter((pk) => !active.some((g) => g.gamePk === pk));
	return {
		date,
		active,
		skipped,
	};
}

/** What one cadence tick touched. `skipped` are the games left unfetched. */
export type TickResult = {
	date: string;
	ingested: number[];
	skipped: number[];
};

/**
 * One ADR-002 active-window tick.
 *
 * Selects only the games inside the cadence window at `now` and fetches those.
 * Games outside the window are never fetched — that bound is the whole point:
 * MLB egress scales with concurrent game windows, not with viewers or with the
 * size of the day's schedule.
 */
export async function tickIngest(
	deps: IngestDeps,
	now: Date = deps.now?.() ?? new Date(),
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<TickResult>
{
	const {
		date, active, skipped,
	} = await refreshTodaysWindow(deps, now, params);
	const fetchedAt = now.toISOString();
	const ingested: number[] = [];

	for (const summary of active)
	{
		try
		{
			const { game, feedTime } = await deps.mlb.fetchGame(summary.gamePk);
			await storeGame(deps, {
				...game,
				fetchedAt,
				windowMode: "active",
			}, feedTime);
			ingested.push(summary.gamePk);
		}
		catch
		{
			// A single unavailable game must not stop the rest of the tick.
		}
	}

	return {
		date,
		ingested,
		skipped,
	};
}
