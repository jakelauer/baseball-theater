import type {
	CadenceParams, FetchedGame, GameProjection, GameSnapshot, GameStateRow, ScheduleDay, StoredScheduleDay, Unversioned,
} from "@bt/domain";
import {
	addDays, cacheLifetimeMs, DEFAULT_CADENCE, gameStateFromGame, gameStateFromSummary, isFinalStatus, isGameInActiveWindow, isPastFinishedDay, isPastFinishedGame,
	isScheduleDaySettled, keepStoredExtras, lastMeasuredAtBat, mlbToday, normalizeStatusCode, playerOfTheGameComplete, projectGame, scheduleWindowMode, scoreboardWinProbability,
	stampVersion, suspendedSince, toStoredScheduleDay,
	wholeFetchedGame,
} from "@bt/domain";
import type {
	BackgroundWork, GameProjectionRepository, GameRepository, GameStateRepository, MlbStatsClient, PlayerIdRepository, PlayerRegister, PlayerXrefSource,
	ScheduleRepository, VenueFieldRepository,
} from "@bt/ports";
import { withLatePlayMetrics } from "../mappers/game-extras.js";
import type { AskLimit, ExtraAsker } from "./player-of-the-game.js";
import {
	askDueExtras, askPlayerOfTheGame, askPlayMetrics, LATE_ASK_LIMIT_MS, startExtraAsks, withAskedExtras, withAskedPlayerOfTheGame,
} from "./player-of-the-game.js";
import type { DayHubNotifier } from "./day-hubs.js";
import { DayHubCalls } from "./day-hubs.js";
import type { EdgePurge } from "./edge-purge.js";
import { purgeGameAndDayEdge, purgeGameEdge } from "./edge-purge.js";
import type {
	JoinedScheduleDay, SwitchOutcome, WindowedSummary,
} from "./game-state.js";
import {
	joinStoredScheduleDay, readJoinedScheduleDay, readScheduleDay, readServedGame, scheduleDayWindowMode, servedGame, switchGameState, withSuspendedAt,
} from "./game-state.js";
import type { RefreshCoordinator } from "./refresh.js";
import { CACHE_TTL_MS, isStale } from "./refresh.js";
import type { VenueFieldAsk } from "./venue-fields.js";
import { keepVenueFields } from "./venue-fields.js";

export type IngestDeps = {
	mlb: MlbStatsClient;
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	/** Each game's one stored state (S150), written only through `switchGameState`. */
	gameStates: GameStateRepository;
	/**
	 * Where each ballpark's field drawing is kept (S105): a game's first write asks Savant for its venue's drawing when
	 * none is kept (`keepVenueFields`, an after-step, so deferred past the response on a read). Absent (most tests, the
	 * backfill, the seed paths), nothing is asked.
	 */
	venueFields?: VenueFieldRepository;
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
	/**
	 * Where a write of a past, finished day or game drops its edge copy (S212 AC 4): the purger, origin and owed-purge
	 * store the Worker and the Node server compose (`edgePurgeFor`; without credentials a no-op that logs once); absent
	 * (most tests, the backfill, the baseball-data copy), nothing is purged.
	 */
	edgePurge?: EdgePurge;
	/**
	 * Where an on-read refresh hands the writes that carry no version of its answer (S216 AC 3: the projections, the
	 * request's one edge purge, the late answers' writes: S216's playMetrics, B577's digest asks), to run after the response. Absent (tests, the seed paths), they
	 * run before the read returns, in the same order.
	 */
	background?: BackgroundWork;
	/**
	 * Where a schedule write tells the scoreboard's day hubs that a day with a game in its window changed (S149 AC 2,
	 * `DayHubCalls`): the Worker's `DAY_HUB` binding (`dayHubNotifier`); absent (the Node server, which has no hubs, and
	 * tests), nothing is called.
	 */
	dayHubs?: DayHubNotifier;
	/**
	 * MLB's players and their outside ids (S209): the profiles route reads it, and the cron's player-id job keeps it in
	 * step with the register (`syncPlayerRegister`). Absent (most tests), the route answers no player.
	 */
	playerIds?: PlayerIdRepository;
	/**
	 * The player-id job's sources (S209 AC 1): the Chadwick register and MLB's cross-references, both set with live MLB
	 * data only (`createWorkerApp`), so local fixture runs and tests never fetch the register; absent, the job never runs.
	 */
	playerRegister?: PlayerRegister;
	playerXrefs?: PlayerXrefSource;
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
 * What a request's writes leave to do once the writes that carry its answer's version are stored (S216 AC 3): the
 * projections, the edge-purge judgement with its one purge request, and the late answers' writes. An on-read refresh
 * hands them to `BackgroundWork` after the response (`handOff`); every other writer runs them at once after its writes
 * (`runAfterWrites`), so its purge still follows its write as S212 shipped it.
 *
 * The purge judgement (`isPastFinishedGame` / `isPastFinishedDay` alone, ADR-025) reads the snapshots and rows the
 * request already holds (`held`) and reads only what it doesn't: at most one `games.getMany` for the games whose state a
 * schedule write changed and whose snapshots the request never read, and a day's before-verdict's own reads.
 */
class AfterWrites
{
	/** Projections of the snapshots this request stored, written in one `upsertMany`. */
	readonly projections: GameProjection[] = [];
	/** Each game whose snapshot this request read or wrote (null: read, none stored), latest first-hand copy. */
	readonly held = new Map<number, GameSnapshot | null>();
	/** Games already judged changed and past and finished (or so before the write): their URLs are purged. */
	readonly purgeGames = new Map<number, GameSnapshot>();
	/** Games a schedule write changed the state of, judged once their snapshots are known. */
	readonly changedStates = new Map<number, SwitchOutcome>();
	/**
	 * Each changed day and its verdict, judged after the writes: whether its URLs are to be purged. A verdict that fails
	 * purges the day anyway (S216 review: over-purging is cheap, under-purging isn't).
	 */
	readonly dayChecks: { date: string;
		judge: () => Promise<boolean>; }[] = [];
	/** Late answers' writes (S216 AC 5's playMetrics, B577's digest asks: `storeLateAnswers`), each after the rest. */
	readonly followUps: (() => Promise<void>)[] = [];
	/** The venues of the games this request stored for the first time (S105): their field drawings are kept, last. */
	readonly venues = new Set<number>();
	/**
	 * Each date a schedule write changed, and whether its day has a game in its window before or after the write (S149
	 * AC 2): judged after the writes, the true ones added to `hubCalls`.
	 */
	readonly hubChecks: { date: string;
		judge: () => Promise<boolean>; }[] = [];

	/**
	 * `at` is the writes' time: what the purge judges "past" against and records an owed purge at. `shared` is a
	 * refresh's or fill's own {@link DayHubCalls}, flushed by it once after all its days (S149 AC 2); without one, these
	 * writes' hub calls are made by `runAfterWrites` itself.
	 */
	constructor(readonly at: Date, shared?: DayHubCalls)
	{
		this.hubCalls = shared ?? new DayHubCalls();
		this.ownsHubCalls = shared === undefined;
	}

	/** Where the day hub calls go: the caller's shared collector, else this request's own. */
	readonly hubCalls: DayHubCalls;
	/** Whether `runAfterWrites` makes the hub calls itself (no refresh or fill shares a collector). */
	readonly ownsHubCalls: boolean;

	get empty(): boolean
	{
		return this.projections.length === 0 && this.purgeGames.size === 0 && this.changedStates.size === 0 && this.dayChecks.length === 0
			&& this.followUps.length === 0 && this.hubChecks.length === 0 && this.venues.size === 0;
	}
}

/**
 * Runs what {@link AfterWrites} holds, in order: the projections in one write (a projection a newer stored version
 * refuses is logged and dropped, never written over it), the purge judgement and its one `purgeGameEdge` request for
 * every game and day the request stored, then the late answers' writes, then the field drawings of the venues of the
 * games stored for the first time (S105, `keepVenueFields`, with `venueFields` composed). Each step runs whether or not an earlier
 * one failed (S216 review), so a failed projection write or day verdict never costs the purge or a follow-up; when the
 * judgement's snapshot read or the purge's listing read fails, the candidates' own URLs are purged without it (or owed,
 * `purgeGameAndDayEdge`). Then it rejects with every failure (`AggregateError`), so a caller that runs it at once fails
 * as its own write would; deferred, `BackgroundWork` logs it.
 */
async function runAfterWrites(
	deps: Pick<IngestDeps, "projections" | "games" | "gameStates" | "schedules" | "edgePurge" | "dayHubs"> & VenueFieldAsk,
	after: AfterWrites,
): Promise<void>
{
	const errors: unknown[] = [];
	const step = async (work: () => Promise<void>) =>
	{
		try
		{
			await work();
		}
		catch (error)
		{
			errors.push(error);
		}
	};
	if (after.projections.length > 0) await step(() => writeProjections(deps, after.projections));
	if (deps.edgePurge)
	{
		const days: string[] = [];
		for (const check of after.dayChecks)
		{
			await step(async () =>
			{
				let purge = true;
				try
				{
					purge = await check.judge();
				}
				finally
				{
					if (purge) days.push(check.date);
				}
			});
		}
		const unheld = [...after.changedStates.keys()].filter((gamePk) => !after.held.has(gamePk) && !after.purgeGames.has(gamePk));
		// Games whose snapshots couldn't be read: their URLs are purged unjudged, from the official date the switch knew.
		const unjudged: { gamePk: number;
			officialDate: string; }[] = [];
		if (unheld.length > 0) await step(async () =>
		{
			try
			{
				for (const snapshot of await deps.games.getMany(unheld)) after.held.set(snapshot.gamePk, snapshot);
			}
			catch (error)
			{
				for (const gamePk of unheld)
				{
					const outcome = after.changedStates.get(gamePk)!;
					// The row the switch stored, else the one it read: whichever there is names the game's official date.
					unjudged.push(...[outcome.row, outcome.before].filter((row) => row !== null).slice(0, 1).map((row) => ({
						gamePk,
						officialDate: row.officialDate,
					})));
				}
				throw error;
			}
		});
		for (const [gamePk, outcome] of after.changedStates)
		{
			// A game with no stored snapshot has no game response at the edge to purge.
			const snapshot = after.held.get(gamePk);
			if (!snapshot || after.purgeGames.has(gamePk)) continue;
			const pastFinished = (row: GameStateRow | null) => isPastFinishedGame(servedGame(snapshot, row, after.at), after.at);
			if (pastFinished(outcome.row) || pastFinished(outcome.before)) after.purgeGames.set(gamePk, snapshot);
		}
		const games = [...after.purgeGames.values()];
		if (games.length > 0 || days.length > 0) await step(async () =>
		{
			try
			{
				await purgeGameEdge(deps, games, after.at, days);
			}
			catch (error)
			{
				// Its listing read failed: the games' own days at least, purged or owed.
				await purgeGameAndDayEdge(deps, games, after.at, days);
				throw error;
			}
		});
		if (unjudged.length > 0) await purgeGameAndDayEdge(deps, unjudged, after.at);
	}
	// S149 AC 2: the day hubs of the changed dates with a game in their window, after every write they read.
	for (const check of after.hubChecks)
	{
		await step(async () =>
		{
			if (await check.judge()) after.hubCalls.add(check.date);
		});
	}
	if (after.ownsHubCalls) await after.hubCalls.flush(deps.dayHubs);
	for (const followUp of after.followUps) await step(followUp);
	const { mlb, venueFields } = deps;
	if (mlb?.fetchVenueField && venueFields && after.venues.size > 0)
	{
		const fetchVenueField = mlb.fetchVenueField.bind(mlb);
		await step(() => keepVenueFields({
			mlb: {
				fetchVenueField,
			},
			venueFields,
		}, after.venues, after.at));
	}
	if (errors.length > 0) throw new AggregateError(errors, `after-write steps failed: ${errors.map(String).join("; ")}`);
}

/**
 * Writes `projections` in one `upsertMany`; one a newer stored version refuses is logged and dropped, never written over
 * it (S216 AC 3: another writer stored a newer snapshot and its own projection).
 */
export async function writeProjections(deps: Pick<IngestDeps, "projections">, projections: readonly GameProjection[]): Promise<void>
{
	const taken = new Set(await deps.projections.upsertMany(projections));
	const refused = projections.filter((projection) => !taken.has(projection.header.gamePk));
	if (refused.length > 0) console.warn(`projections of ${refused.map((projection) => projection.header.gamePk).join(", ")} refused by a newer stored version; dropped`);
}

/**
 * Hands an on-read refresh's {@link AfterWrites} to `BackgroundWork`, to run after the response (S216 AC 3); with none
 * composed, runs them before the read returns, a failure logged rather than failing the read, as the deferred work's is.
 */
async function handOff(deps: IngestDeps, after: AfterWrites): Promise<void>
{
	if (after.empty) return;
	if (deps.background)
	{
		deps.background.defer("on-read refresh writes", () => runAfterWrites(deps, after));
		return;
	}
	try
	{
		await runAfterWrites(deps, after);
	}
	catch (error)
	{
		console.error("[background] on-read refresh writes failed", error);
	}
}

/**
 * What {@link storeGames} stored for one game: the snapshot now stored, its state row, and whether the switch stored a
 * new state version for it (S149 AC 2: a mend, a changed row under an unchanged snapshot, is published too). `ours`
 * (B577 review) says whether `snapshot` holds this write's own content: true when it stored it or the store already held
 * the same content (`stampVersion`'s one rule); false when another writer's newer version refused it, or the stored copy
 * was kept over a feed the switch skipped as stale. A late write over a snapshot that isn't ours only adds what it lacks.
 */
type StoredGame = {
	snapshot: GameSnapshot;
	state: GameStateRow | null;
	stateChanged: boolean;
	ours: boolean;
};

/** One fetched game to store, with the snapshot its caller read (null: none stored), and its feed time. */
type GameWrite = {
	fetched: Unversioned<GameSnapshot>;
	feedTime?: string;
	stored: GameSnapshot | null;
};

/**
 * Stamps each fetched game against the stored one its caller read and stores those that changed (ADR-022): an
 * unchanged poll keeps its version and writes nothing. Returns, by gamePk, what is now stored and the game's state row.
 * One snapshot becomes five BT store documents: callers read the projections, never the upstream tree, so the snapshot
 * upsert stays the raw-ish record and the projection is what the UI binds to. S216: a batch (a digest's games, which
 * share one fetch time `at`) is one switch write and one `games.upsertMany`; the projections and the edge purge go to
 * `after`, written after the snapshots (`runAfterWrites`), deferred past the response on a read.
 *
 * Every game, an unchanged snapshot included, first hands the feed's state with its feed time (`feedTime`, never stored
 * on the game) and its win-probability line (S161, `scoreboardWinProbability`; the switch stores it on the game's row
 * whichever source holds it) to `switchGameState` (S150 AC 5), so every feed path reaches the switch; `known` is the rows the request
 * already holds (S216), which the switch then doesn't read again. The row is written before the snapshot: the served
 * game (`servedGame`) takes its score from the row and its version from the snapshot, so a read between the two writes
 * gets the old version with the new score, and this poll's new version, published after, is still newer than anything a
 * viewer was sent. Written the other way round, a read in between would get the new version with the old score, and
 * the publish of that version with the new score would be refused as not newer (by the hub and the client). A stop
 * between the writes, or a row backfilled from the schedule while the game is live, is mended by the next poll.
 *
 * A feed copy the switch skips as older than the row's accepted feed time (strictly older; a poll with no feed time
 * never is) writes no snapshot either, when one is stored: its plays are as stale as its score. With nothing stored it
 * is written, so the game has one.
 *
 * A snapshot write a newer stored version refuses (another writer stored this version or a newer one first, S216 AC 1)
 * is reported by `upsertMany`, and only then is the stored snapshot read and returned, so the caller answers the
 * stored one; the other writer's own write wrote its projection.
 *
 * Every game write passes here, so this is where `suspendedAt` is set (#79, #323): BT's own field, from
 * `suspendedSince` against the stored game, whatever the caller passed. It is set only by the write that changes the
 * status, already a new version, and carried unchanged after, so it never bumps a version on its own; left out when
 * there is none, so a game never suspended hashes as before.
 *
 * S212 AC 4: when the write stores a game for the first time, or changes its snapshot or state, and the served game
 * (`servedGame`) is past and finished (`isPastFinishedGame`) after the write, or was before it (S212 review: a final
 * game MLB turns suspended leaves the edge holding the final one), its edge URL and the schedule and digest URLs of
 * every day that shows it are purged (`purgeGameEdge`, through `after`), whichever path wrote it. A game stored for the
 * first time was not past and finished before.
 */
async function storeGames(
	deps: Pick<IngestDeps, "games" | "gameStates">,
	writes: readonly GameWrite[],
	at: Date,
	after: AfterWrites,
	known?: ReadonlyMap<number, GameStateRow | null>,
): Promise<Map<number, StoredGame>>
{
	const stored = new Map<number, StoredGame>();
	if (writes.length === 0) return stored;
	const outcomes = await switchGameState(deps, writes.map(({ fetched, feedTime }) => ({
		gamePk: fetched.gamePk,
		source: "feed" as const,
		state: gameStateFromGame(fetched),
		officialDate: fetched.officialDate,
		startTime: fetched.startTime ?? null,
		...feedTime !== undefined && {
			feedTime,
		},
		// S161: the scoreboard's line, worked out here as the game's play metrics are written, never per read.
		winProbability: scoreboardWinProbability(fetched),
	})), at, known);
	const stamped = writes.map((write) =>
	{
		const outcome = outcomes.get(write.fetched.gamePk);
		if (write.stored && outcome?.staleFeed) return {
			write,
			outcome,
			snapshot: write.stored,
		};
		// S99, S101, S100: a stored extra (a player-of-the-game side, the uniforms, the rule settings) the fetch lacks (not asked,
		// failed, slow) is kept, never cleared.
		const { suspendedAt: _ignored, ...upstream } = keepStoredExtras(write.stored, write.fetched);
		const suspendedAt = suspendedSince(write.stored, write.fetched.status.codedGameState, write.fetched.fetchedAt);
		const next = stampVersion<GameSnapshot>(write.stored, suspendedAt === undefined ? upstream : {
			...upstream,
			suspendedAt,
		}, write.fetched.fetchedAt);
		return {
			write,
			outcome,
			snapshot: write.stored && next.version === write.stored.version ? write.stored : next,
		};
	});
	const changed = stamped.filter(({ write, snapshot }) => snapshot !== write.stored).map(({ snapshot }) => snapshot);
	const taken = new Set(changed.length === 0 ? [] : await deps.games.upsertMany(changed));
	const refused = changed.filter((snapshot) => !taken.has(snapshot.gamePk)).map((snapshot) => snapshot.gamePk);
	const storedFirst = new Map(refused.length === 0 ? [] : (await deps.games.getMany(refused)).map((snapshot) => [snapshot.gamePk, snapshot]));
	for (const {
		write, outcome, snapshot: formed,
	} of stamped)
	{
		const gamePk = formed.gamePk;
		const state = outcome?.row ?? null;
		const written = formed !== write.stored && taken.has(gamePk);
		const first = storedFirst.get(gamePk);
		const snapshot = first ?? formed;
		const kept = write.stored !== null && outcome?.staleFeed === true;
		const ours = !kept && (!first || stampVersion<GameSnapshot>(first, unversionedGame(formed), at.toISOString()).version === first.version);
		after.held.set(gamePk, snapshot);
		if (written) after.projections.push(projectGame(snapshot));
		// S105: a game stored for the first time asks for its venue's field drawing, if none is kept.
		if (written && write.stored === null && snapshot.venue) after.venues.add(snapshot.venue.id);
		const wasPastFinished = write.stored !== null && isPastFinishedGame(servedGame(write.stored, outcome?.before ?? null, at), at);
		if ((written || outcome?.stateChanged) && (isPastFinishedGame(servedGame(snapshot, state, at), at) || wasPastFinished))
		{
			after.purgeGames.set(gamePk, snapshot);
		}
		stored.set(gamePk, {
			snapshot,
			state,
			stateChanged: outcome?.stateChanged ?? false,
			ours,
		});
	}
	return stored;
}

/**
 * One fetched game through {@link storeGames} with its projection and purge written at once after it
 * (`runAfterWrites`): every writer but an on-read refresh (game ingest, the recent-game re-check, the cron's tick, the
 * seed paths), so the purge stays awaited after its write. With `venueFields` composed, a game stored for the first
 * time also asks for its venue's field drawing, last among those steps (S105, `keepVenueFields`), awaited too: a new
 * venue can hold the write (and a game's ingest object, its poll's publish) up to `VENUE_FIELD_LIMIT_MS` (3 s). `stored`
 * is what the caller read (S216: never read again).
 */
async function storeGame(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates" | "schedules" | "edgePurge" | "dayHubs"> & VenueFieldAsk,
	fetched: Unversioned<GameSnapshot>,
	feedTime: string | undefined,
	stored: GameSnapshot | null,
): Promise<StoredGame>
{
	const at = new Date(fetched.fetchedAt);
	const after = new AfterWrites(at);
	const result = (await storeGames(deps, [{
		fetched,
		stored,
		...feedTime !== undefined && {
			feedTime,
		},
	}], at, after)).get(fetched.gamePk)!;
	await runAfterWrites(deps, after);
	return result;
}

/**
 * The schedule-day counterpart of {@link storeGame}. Exported for the backfill (S122), which asks a day's games one
 * source at a time and so can't go through {@link ingestScheduleDay}, for the month view's range fill (S124), which
 * stores schedule days without hydrating games, and for the cron's `refreshTodaysWindow`. `held` is the stored day and
 * its served base when the caller read them (S216: then not read again); left out, they are read here. Its purges run at
 * once after its writes (`runAfterWrites`). Returns the served day, formed from what it stored ({@link storeScheduleDay}).
 * `hubCalls` is a refresh's or fill's shared collector of day hub calls (S149 AC 2), which it flushes once after all its
 * days; left out, this write's own hub calls are made after it.
 */
export async function storeSchedule(
	deps: Pick<IngestDeps, "schedules" | "games" | "gameStates" | "projections" | "edgePurge" | "dayHubs">,
	fetched: Unversioned<ScheduleDay>,
	held?: { day: StoredScheduleDay;
		servedBase: number; } | null,
	hubCalls?: DayHubCalls,
): Promise<ScheduleDay>
{
	const now = new Date(fetched.fetchedAt);
	const after = new AfterWrites(now, hubCalls);
	const stored = held === undefined ? await deps.schedules.getWithServedBase(fetched.date) : held;
	const joined = await storeScheduleDay(deps, fetched, stored, undefined, after);
	await runAfterWrites(deps, after);
	return joined.served;
}

/**
 * Stores one fetched schedule day and forms the day it is served as, with no read-back (S216 AC 1). S150 AC 5: the
 * day's games' states go to `switchGameState` first, all in one batch (`known`: the rows the request already joined,
 * not read again), before the day is written and whether or not it changed, so an unchanged day still hands over a
 * postponement; the day is stored without its games' states (`StoredScheduleDay`). A write that drops a game from the
 * day raises the day's `served_base` by that game's state version in the same write (the repository's `upsert`), so
 * the served day's version never falls; the upsert reports the base it stored, and the served day is
 * `joinStoredScheduleDay` of the day it stored, that base and the rows the switch stored. A day write a newer stored
 * version refuses is reported (null), and only then is the stored day read and answered (`readJoinedScheduleDay`).
 *
 * S212 AC 4: when the write stores a day for the first time, or changes its served version (the stored day's version,
 * or a listed game's state version), and the day is past and finished (`isPastFinishedDay`) after the write or was
 * before it (S212 review: a day that stops being settled leaves the edge holding the settled one), its schedule and
 * digest URLs are purged; each game whose state it changed and whose served game is or was past and finished (its
 * stored snapshot over the new or the old row) has its own URL and every day showing it purged too: its game route
 * serves that state. All are judged and purged through `after` (`runAfterWrites`, one purge request), after the writes;
 * the before-verdict only when something changed, from the stored day as read and the rows as the switch read them,
 * so a month refresh that changes nothing reads no more and purges nothing; a day stored for the first time was not
 * past and finished before.
 *
 * S149 AC 2: when the write changes something and a day hub notifier is composed, the hub of each date it changed is
 * called after the writes (`after.hubChecks`), if that day has a game in its live window (`scheduleDayWindowMode`)
 * before or after the write: this date, judged from the day it formed and, only when that has none, from the stored day
 * over the rows the switch read; and, for a game whose state it changed, the game's official date before and after
 * the write when it differs from this one (a game moved between days), judged from that day as now stored and the
 * moved game's row before the write. No stored day is searched for the game: the leases carry its state to every hub
 * watching it.
 */
async function storeScheduleDay(
	deps: Pick<IngestDeps, "schedules" | "games" | "gameStates" | "edgePurge" | "dayHubs">,
	fetched: Unversioned<ScheduleDay>,
	held: { day: StoredScheduleDay;
		servedBase: number; } | null,
	known: ReadonlyMap<number, GameStateRow | null> | undefined,
	after: AfterWrites,
): Promise<JoinedScheduleDay>
{
	const now = new Date(fetched.fetchedAt);
	const outcomes = await switchGameState(deps, fetched.games.map((game) => ({
		gamePk: game.gamePk,
		source: "schedule" as const,
		state: gameStateFromSummary(game),
		officialDate: game.officialDate,
		startTime: game.startTime ?? null,
	})), now, known);
	const stored = held?.day ?? null;
	const day = stampVersion<StoredScheduleDay>(stored, toStoredScheduleDay(fetched), fetched.fetchedAt);
	const dayChanged = !stored || day.version !== stored.version;
	let joined: JoinedScheduleDay | null = null;
	let servedBase = held?.servedBase ?? 0;
	if (dayChanged)
	{
		const base = await deps.schedules.upsert(day);
		// Refused: another writer stored this version or a newer one first, so the stored day is the answer.
		if (base === null) joined = await readJoinedScheduleDay(deps, fetched.date, now);
		else servedBase = base;
	}
	if (!joined)
	{
		const rows = new Map<number, GameStateRow>();
		for (const [gamePk, outcome] of outcomes) if (outcome.row) rows.set(gamePk, outcome.row);
		joined = await joinStoredScheduleDay(deps, day, servedBase, rows, now);
	}
	const changedGames = [...outcomes].filter(([, outcome]) => outcome.stateChanged);
	// The day as served before the write, read at most once for both judges below (the purge's and the hub's), and only
	// when one needs it; a failed read reaches both (the purge then purges anyway; the hub check records the error).
	let beforeRead: Promise<JoinedScheduleDay> | undefined;
	const before = stored === null ? null : () => beforeRead ??= joinedBefore(deps, stored, outcomes, now);
	if (deps.edgePurge && (dayChanged || changedGames.length > 0))
	{
		const formed = joined;
		after.dayChecks.push({
			date: fetched.date,
			judge: async () => isPastFinishedDay(formed.served, now, formed.moved) || (before !== null && wasPastFinishedDay(await before(), now)),
		});
		for (const [gamePk, outcome] of changedGames) after.changedStates.set(gamePk, outcome);
	}
	if (deps.dayHubs && (dayChanged || changedGames.length > 0)) addHubChecks(deps, fetched.date, joined, before, changedGames, now, after);
	return joined;
}

/** {@link storeScheduleDay}'s day hub checks (S149 AC 2): the dates the write changed, each judged after the writes. */
function addHubChecks(
	deps: Pick<IngestDeps, "games" | "gameStates" | "schedules">,
	date: string,
	formed: JoinedScheduleDay,
	before: (() => Promise<JoinedScheduleDay>) | null,
	changedGames: readonly [number, SwitchOutcome][],
	now: Date,
	after: AfterWrites,
): void
{
	after.hubChecks.push({
		date,
		judge: async () => formed.served.windowMode === "active" || (before !== null && (await before()).served.windowMode === "active"),
	});
	const others = new Map<string, GameStateRow | null>();
	for (const [, outcome] of changedGames)
	{
		for (const row of [outcome.before, outcome.row])
		{
			if (row && row.officialDate !== date && !others.has(row.officialDate)) others.set(row.officialDate, outcome.before);
		}
	}
	for (const [other, before] of others)
	{
		after.hubChecks.push({
			date: other,
			judge: async () => (before !== null && isGameInActiveWindow({
				officialDate: before.officialDate,
				startTime: before.startTime,
				status: before.state.status,
			}, now)) || (await readScheduleDay(deps, other, now))?.windowMode === "active",
		});
	}
}

/**
 * Whether a day was past and finished before a schedule write changed it (S212 review), from {@link joinedBefore}'s
 * day. S216: judged by `isPastFinishedDay` alone, with no hand-written date or settledness pre-filter (ADR-025); it
 * runs only after a write changed something, after the response on a read.
 */
function wasPastFinishedDay(before: JoinedScheduleDay, now: Date): boolean
{
	return isPastFinishedDay(before.served, now, before.moved);
}

/**
 * The day as it was served before a schedule write (S212 review; S149 AC 2 judges its window from it): the stored day
 * as the write read it, joined over each listed game's row as the switch read it (`SwitchOutcome.before`), a game the
 * write didn't list read as it stands (the write didn't touch it). Served base 0: no caller reads its version.
 */
async function joinedBefore(deps: Pick<IngestDeps, "games" | "gameStates">, stored: StoredScheduleDay, outcomes: ReadonlyMap<number, SwitchOutcome>, now: Date): Promise<JoinedScheduleDay>
{
	const rows = new Map<number, GameStateRow>();
	for (const [gamePk, outcome] of outcomes) if (outcome.before) rows.set(gamePk, outcome.before);
	const untouched = stored.games.map((game) => game.gamePk).filter((gamePk) => !outcomes.has(gamePk));
	if (untouched.length > 0) for (const row of await deps.gameStates.getMany(untouched)) rows.set(row.gamePk, row);
	return joinStoredScheduleDay(deps, stored, 0, rows, now);
}

/**
 * Stores one fetched game the way every ingest path does (`storeGame`: stamped, written
 * only when its content changed, ADR-022, its state handed to the switch with the feed's
 * `feedTime`, S150) and says whether the snapshot changed — the per-game ingest object (S48)
 * publishes only then, as the served game (`servedGame` of the snapshot and the returned row).
 * It reads the stored snapshot once and hands it to `storeGame` (S216: not read again there).
 *
 * A poll that changes only the row (it mends a row the migration or the baseball-data copy
 * wrote, or one the schedule wrote while the game was live) keeps the snapshot's version and
 * reports `stateChanged` (S149 AC 2): the ingest object publishes it too, which a game hub drops
 * (the served game's version is the snapshot's, and a hub takes only a newer one; its viewers see
 * the mended score with the game's next snapshot change) and a day hub turns into a push of its
 * day, whose served version the row's new state version raised. Since the row is written
 * first (`storeGame`), a poll never leaves a row behind its own snapshot.
 *
 * S101, S100: with `mlb`, the game's uniforms and rule settings are asked here, at once, against the stored game it
 * already read (`withAskedExtras`, each bounded by `PLAY_METRICS_LIMIT_MS`): each only while none is stored, and then
 * when the game is new to the store, its status changed, or it is final (`askedExtraDue`). So every path that writes one
 * game (the ingest object's poll, the cron tick, the day seed, the re-check) asks them off the game fetch; a live poll at
 * an unchanged status never asks again, and a final game still lacking one is asked it once per write (a re-check fills
 * one stored before its story). The backfill asks them itself, as extra sources it can give up (`EXTRA_SOURCES` in
 * `backfill.ts`), and writes without `mlb`; it writes only games not already stored as final, so a stored final past its
 * re-check window stays without them (#619's scope). Without `mlb` (the backfill, tests) nothing is asked.
 */
export async function ingestGame(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates" | "schedules" | "edgePurge" | "dayHubs"> & { mlb?: ExtraAsker & VenueFieldAsk["mlb"] } & Pick<VenueFieldAsk, "venueFields">,
	fetched: Unversioned<GameSnapshot>,
	feedTime?: string,
): Promise<StoredGame & { changed: boolean }>
{
	const before = await deps.games.getByPk(fetched.gamePk);
	const asked = deps.mlb ? await withAskedExtras(deps.mlb, fetched, before) : fetched;
	const stored = await storeGame(deps, asked, feedTime, before);
	return {
		...stored,
		changed: before?.version !== stored.snapshot.version,
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
 * Asks MLB for one day's schedule, once, and stores it ({@link storeScheduleDay}: its games' states handed to the
 * switch in one batch, the day written only when it changed, ADR-022), its `windowMode` judged as every stored day's
 * is. `existing` is the day as the read joined it (S216: its stored day, served base and rows are not read again);
 * `after` takes the purges. Returns the served day formed from what it stored. It fetches no game: the day read
 * (`getOrRefreshSchedule`) needs only this, since a scoreboard is the schedule's summaries and the games' stored states
 * (#419: hydrating each final game here made a past day's first read ask MLB for every game's feed in turn, 25–45 s on
 * staging for a 15-game day).
 */
async function refreshScheduleDay(deps: IngestDeps, date: string, now: Date, existing: JoinedScheduleDay | null, after: AfterWrites): Promise<JoinedScheduleDay>
{
	const fetched = await deps.mlb.fetchSchedule(date);
	const known = existing ? new Map<number, GameStateRow | null>(existing.stored.games.map((game) => [game.gamePk, existing.rows.get(game.gamePk) ?? null])) : undefined;
	return storeScheduleDay(deps, {
		...fetched,
		fetchedAt: now.toISOString(),
		windowMode: await scheduleDayWindowMode(deps, fetched, now),
	}, existing ? {
		day: existing.stored,
		servedBase: existing.servedBase,
	} : null, known, after);
}

/**
 * A day's schedule, fetched and stored ({@link storeSchedule}), and then each of its games in their window or finished,
 * fetched and stored one by one (`ingestGame`, each game waited for whole, its playMetrics however late): the seed
 * paths' fill (`seed.ts`, `dev-seed.ts`), which want the games stored too. The day read doesn't use it (#419).
 */
export async function ingestScheduleDay(
	deps: IngestDeps,
	date: string,
): Promise<ScheduleDay>
{
	const now = deps.now?.() ?? new Date();
	const fetchedDay = await deps.mlb.fetchSchedule(date);
	const day = await storeSchedule(deps, {
		...fetchedDay,
		fetchedAt: now.toISOString(),
		windowMode: await scheduleDayWindowMode(deps, fetchedDay, now),
	});

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
			// S99: one bounded ask for a due game's pick (the seed paths, rarely run, read the stored game only after).
			const { game, feedTime } = await withAskedPlayerOfTheGame(deps.mlb, await wholeFetchedGame(await deps.mlb.fetchGame(summary.gamePk)), undefined);
			await ingestGame(deps, {
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
 *
 * S212: it no longer decides a past, finished read. A stored day or game that is past and finished
 * (`isPastFinishedDay` / `isPastFinishedGame`) is served without asking MLB whatever its stamps say, since the cron's
 * writes own its freshness (ADR-021's 2026-11-24 amendment). This rule still judges today's and future days, unfinished
 * days and games, and the month view's fill.
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
 * A day as the day read serves it, and whether it is past and finished (`isPastFinishedDay`, S212). `rows` (S216) are
 * the day's games' state rows as the read holds them (joined, or just stored by its refresh; null: known to have none),
 * which the digest's game reads reuse instead of reading them again.
 */
export type ScheduleRead = {
	day: ScheduleDay;
	pastFinished: boolean;
	rows: ReadonlyMap<number, GameStateRow | null>;
};

/**
 * The day read with its past-and-finished verdict (S212 AC 2–3): {@link getOrRefreshSchedule}'s rule, returning also
 * whether the served day is past and finished, so the route and the digest pick its cache header from the same rule
 * (`isPastFinishedDay`, ADR-025) without a second judgment. A stored past, finished day is served with no MLB request
 * (unless `force`). S216: after a refresh the verdict is the formed day's, with no read of the day just written, and
 * the refresh's purges run after the response (`BackgroundWork`).
 */
export async function getScheduleRead(
	deps: IngestDeps,
	date: string,
	opts?: { force?: boolean },
): Promise<ScheduleRead>
{
	const now = deps.now?.() ?? new Date();
	const after = new AfterWrites(now);
	const read = await readSchedule(deps, date, now, opts?.force ?? false, after);
	await handOff(deps, after);
	return read;
}

/**
 * {@link getScheduleRead}'s work, its writes' after-work left in `after` for the caller to hand off once (the digest
 * hands off its day's and its games' together). The stored day is read once, joined with its rows
 * (`readJoinedScheduleDay`); a refresh hands that day, its served base and its rows to {@link refreshScheduleDay}, and
 * the day it serves is the one the refresh formed.
 */
async function readSchedule(deps: IngestDeps, date: string, now: Date, force: boolean, after: AfterWrites): Promise<ScheduleRead>
{
	const existing = await readJoinedScheduleDay(deps, date, now);
	const rowsOf = (joined: JoinedScheduleDay) => new Map<number, GameStateRow | null>(joined.stored.games.map((game) => [game.gamePk, joined.rows.get(game.gamePk) ?? null]));
	if (existing && !force && isPastFinishedDay(existing.served, now, existing.moved))
	{
		return {
			day: existing.served,
			pastFinished: true,
			rows: rowsOf(existing),
		};
	}
	// S150 AC 6: the joined day's window, with the stored day's own stamps (its schedule data); a game's score is kept
	// current by its writers, not by the day's refresh.
	if (existing && !needsRefresh(deps, `schedule:${date}`, {
		fetchedAt: existing.stored.fetchedAt,
		lastChangedAt: existing.stored.lastChangedAt,
		windowMode: existing.served.windowMode,
	}, now, force))
	{
		return {
			day: existing.served,
			pastFinished: false,
			rows: rowsOf(existing),
		};
	}

	const refreshed = await runRefresh(deps, `schedule:${date}`, () =>
		refreshScheduleDay(deps, date, now, existing, after),
	);
	const joined = refreshed ?? existing ?? await refreshScheduleDay(deps, date, now, null, after);
	return {
		day: joined.served,
		pastFinished: isPastFinishedDay(joined.served, now, joined.moved),
		rows: rowsOf(joined),
	};
}

/**
 * The day read (`GET /api/v1/schedule`): the served day (S150 AC 6, `readJoinedScheduleDay`). S212: a stored day that
 * is past and finished (`isPastFinishedDay`) is served as stored with no MLB request, whatever its stamps say, since the
 * cron's writes own its freshness and purge its edge copy on a change (ADR-021's 2026-11-24 amendment); `force`
 * (`?refresh=1`) still asks MLB. Any other day is refreshed from MLB first when it is missing or stale (`needsRefresh`
 * on the joined day's `windowMode` and the stored day's own stamps, its schedule data). A game's score is kept current
 * by its writers, not by this refresh, and the refresh fetches no game (#419): one schedule request, whatever the day
 * holds. A game is fetched when it is read itself (`getOrRefreshGame`) or by the cron's window (`tickIngest`). S216: a
 * refreshed day is answered from the day the refresh formed (no read-back), and its edge purge runs after the response.
 */
export async function getOrRefreshSchedule(
	deps: IngestDeps,
	date: string,
	opts?: { force?: boolean },
): Promise<ScheduleDay>
{
	return (await getScheduleRead(deps, date, opts)).day;
}

/**
 * The game read: the stored snapshot, refreshed from MLB first when it is missing or stale, served as `servedGame`
 * (S150 AC 6: its status and linescore from the game's one stored state, the snapshot's version). S212: a stored game
 * that is past and finished (`isPastFinishedGame` of the served game) is served with no MLB request, whatever its
 * stamps say; the cron's recent-game re-check (`recheckDueGame`) keeps it fresh and purges its edge copy on a change.
 * `force` (`?refresh=1`) still asks MLB. S216: a refreshed game is answered as `servedGame` of the snapshot it stamped
 * and the row the switch stored, with no read-back; its state row and snapshot are stored before the answer, its
 * projection, its edge purge and any late playMetrics write after the response (`BackgroundWork`).
 */
export async function getOrRefreshGame(
	deps: IngestDeps,
	gamePk: number,
	opts?: { force?: boolean },
): Promise<GameSnapshot | null>
{
	const now = deps.now?.() ?? new Date();
	const after = new AfterWrites(now);
	const [game] = await readGames(deps, [gamePk], undefined, now, opts?.force ?? false, after, false);
	await handOff(deps, after);
	return game ?? null;
}

/**
 * A day and each of its games, read as the day read and the game read do (S216: the digest's reads): the day
 * ({@link getScheduleRead}'s rule), then every game at once (`readGames`: one `games.getMany`, the day's rows reused,
 * the stale or missing ones fetched and stored in one batch, their feed switch deciding from the rows the day's switch
 * read and wrote). Every write's after-work goes to `BackgroundWork` together, after the response: one projection
 * write and one edge purge for the whole request. Games come back in the day's order, null for one that couldn't be read.
 *
 * B577: a game it fetches is asked only what the digest ranks with (`dayDigest`: the feed, its content and GraphQL
 * content), and its playMetrics, uniforms, rule settings and player of the game after the response (`readGames`'
 * `askAfter`), since a Worker queues every request past six open connections and a day's asks held its answer for
 * seconds. A cold game's answer ranks without the playMetrics (a stale stored one keeps its stored ones meanwhile);
 * for a past, finished game their late write purges the day's digest URL at the edge, so the next read re-ranks with
 * them (`storeLateAnswers`); any other day's digest holds only its shorter graduated edge lifetime (ADR-021), so a
 * later read re-ranks with them.
 */
export async function readDayAndGames(deps: IngestDeps, date: string): Promise<ScheduleRead & { games: (GameSnapshot | null)[] }>
{
	const now = deps.now?.() ?? new Date();
	const after = new AfterWrites(now);
	const read = await readSchedule(deps, date, now, false, after);
	const games = await readGames(deps, read.day.games.map((game) => game.gamePk), read.rows, now, false, after, true);
	await handOff(deps, after);
	return {
		...read,
		games,
	};
}

/**
 * Reads `gamePks` the way the game read does ({@link getOrRefreshGame}), every game in one batch (S216 AC 2): their
 * snapshots in one `games.getMany`, the rows of the stored ones the caller doesn't already hold (`known`) in one
 * `gameStates.getMany`, each stale or missing game asked of MLB (all at once, each single-flighted by the coordinator),
 * and every fetched game stored in one {@link storeGames} batch. Returns the served games in `gamePks`' order, null for
 * one neither stored nor fetched. The writes' after-work (projections, purges, late answers) goes to `after`.
 *
 * `askAfter` (B577, the digest's batch): each fetched game is asked only its feed, content and GraphQL content before
 * the answer, its feed first, and keeps its stored playMetrics meanwhile; its playMetrics, uniforms, rule settings and
 * player of the game are asked after the response, each within `LATE_ASK_LIMIT_MS`, by the request that ran its fetch
 * alone, and written as its next version (`askAfterResponse`, `storeLateAnswers`). Without it (the game read) the game
 * is answered with them, as S99, S100, S101 and S216 shipped it. Not repaired here: when the after-response work is cut
 * off (the Worker evicted before it ends), a past, finished game stays stored without what it hadn't stored yet, since
 * such a game is served from the store and never asked again; telling that apart from a game MLB has no playMetrics
 * for needs a stored mark, so it is left to its own change (#577's review).
 */
async function readGames(
	deps: IngestDeps,
	gamePks: readonly number[],
	known: ReadonlyMap<number, GameStateRow | null> | undefined,
	now: Date,
	force: boolean,
	after: AfterWrites,
	askAfter: boolean,
): Promise<(GameSnapshot | null)[]>
{
	const unique = [...new Set(gamePks)];
	const stored = new Map((unique.length === 0 ? [] : await deps.games.getMany(unique)).map((snapshot) => [snapshot.gamePk, snapshot]));
	for (const gamePk of unique) after.held.set(gamePk, stored.get(gamePk) ?? null);
	const rows = new Map<number, GameStateRow | null>(known ?? []);
	const unread = [...stored.keys()].filter((gamePk) => !rows.has(gamePk));
	if (unread.length > 0)
	{
		for (const gamePk of unread) rows.set(gamePk, null);
		for (const row of await deps.gameStates.getMany(unread)) rows.set(row.gamePk, row);
	}

	const answers = new Map<number, GameSnapshot | null>();
	const due: number[] = [];
	for (const gamePk of unique)
	{
		const snapshot = stored.get(gamePk);
		if (snapshot && !force)
		{
			const served = servedGame(snapshot, rows.get(gamePk) ?? null, now);
			if (isPastFinishedGame(served, now) || !needsRefresh(deps, `game:${gamePk}`, snapshot, now, false))
			{
				answers.set(gamePk, served);
				continue;
			}
		}
		// Not stored, forced, or stale: asked of MLB (`needsRefresh` is always true for the first two).
		due.push(gamePk);
	}

	// The game read's fetch (a digest's batch returns at once, below). S99: a stored game with one pick side (so MLB picks
	// for it) missing the other has it asked beside the fetch, so the two run at once; any other game is asked after the
	// fetch only if the fetch says it is due (one bounded wait, on its first reads after it ends) and never once both
	// sides are stored.
	const fetchWithPick = async (gamePk: number): Promise<FetchedGame> =>
	{
		// B577: a digest's batch asks the feed, content and GraphQL content alone (the feed first); the rest after its answer.
		if (askAfter) return deps.mlb.fetchGame(gamePk, {
			skipPlayMetrics: true,
		});
		const snapshot = stored.get(gamePk);
		const pick = snapshot?.playerOfTheGame;
		const early = pick && !playerOfTheGameComplete(pick) ? askPlayerOfTheGame(deps.mlb, gamePk) : undefined;
		// S101, S100: a game not stored yet has its uniforms and rule settings asked beside the fetch; a stored one lacking
		// one is asked it after the fetch when `askedExtraDue` says so. Every ask after the fetch runs together (S101
		// review), so a read waits one bounded limit at most, never one per extra.
		const earlyExtras = snapshot ? undefined : startExtraAsks(deps.mlb, gamePk);
		const fetched = await deps.mlb.fetchGame(gamePk);
		const [picked, extras] = await Promise.all([
			withAskedPlayerOfTheGame(deps.mlb, fetched, snapshot?.playerOfTheGame, early),
			askDueExtras(deps.mlb, fetched.game, snapshot, earlyExtras),
		]);
		return {
			...picked,
			game: {
				...picked.game,
				...extras,
			},
		};
	};
	// B577 review: the games whose fetch this request ran itself. A request that joined another's in-flight fetch of the
	// same game (the coordinator's single-flight) leaves the late work to the one that ran it, so a game's late asks and
	// write happen once however many viewers read it at once (ADR-002). So a game read that joins a digest's fetch answers
	// the game without its playMetrics and extras until that digest's late write stores them, seconds later; and when the
	// request that ran it never gets to its late work (its store failed, or its Worker was cancelled or evicted first),
	// the extras wait for the next read that finds the game stale and fetches it (a past, finished one: see above).
	const ran = new Set<number>();
	const fetched = await Promise.all(due.map((gamePk) => runRefresh(deps, `game:${gamePk}`, () =>
	{
		ran.add(gamePk);
		return fetchWithPick(gamePk);
	}).then(
		(game) => game ?? "cooldown" as const,
		// MLB failed: the stored game, if any, is served as it is.
		() => "failed" as const,
	)));
	const at = deps.now?.() ?? new Date();
	const writes: (GameWrite & { late?: FetchedGame["playMetricsLate"];
		playerOfTheGameDue?: boolean;
		needsPlayMetrics?: boolean; })[] = [];
	for (const [i, gamePk] of due.entries())
	{
		const answer = fetched[i]!;
		const snapshot = stored.get(gamePk) ?? null;
		if (answer === "failed" || answer === "cooldown")
		{
			// In the cooldown another request refreshed it just now; with nothing stored when this one read, it is read now
			// (a failed read is that game's null, never the request's failure).
			answers.set(gamePk, snapshot ? servedGame(snapshot, rows.get(gamePk) ?? null, now) : answer === "cooldown" ? await readServedGame(deps, gamePk, now).catch(() => null) : null);
			continue;
		}
		// B577 review: a digest's game that came without playMetrics of its own keeps the stored ones until its late write
		// brings fresh ones (`withLatePlayMetrics`, matched by at-bat), so neither its answer nor its store loses them.
		const needsPlayMetrics = askAfter && !answer.game.playMetrics;
		const game = needsPlayMetrics && snapshot?.playMetrics ? withLatePlayMetrics(answer.game, snapshot.playMetrics) : answer.game;
		writes.push({
			fetched: {
				...game,
				fetchedAt: at.toISOString(),
				windowMode: "cache",
			},
			stored: snapshot,
			...answer.feedTime !== undefined && {
				feedTime: answer.feedTime,
			},
			...answer.playMetricsLate && {
				late: answer.playMetricsLate,
			},
			...answer.playerOfTheGameDue && {
				playerOfTheGameDue: true,
			},
			...needsPlayMetrics && {
				needsPlayMetrics,
			},
		});
	}
	const written = await storeBatchOrEach(deps, writes, at, after, rows);
	const lates: ((purge: GameSnapshot[]) => Promise<void>)[] = [];
	for (const write of writes)
	{
		const result = written.get(write.fetched.gamePk);
		if (!result)
		{
			// Its store failed: answered as stored when this read began (stale, not an error), null with nothing stored.
			answers.set(write.fetched.gamePk, write.stored ? servedGame(write.stored, rows.get(write.fetched.gamePk) ?? null, now) : null);
			continue;
		}
		answers.set(write.fetched.gamePk, servedGame(result.snapshot, result.state, now));
		if (!ran.has(write.fetched.gamePk)) continue;
		const {
			snapshot, state, ours,
		} = result;
		const late = write.late;
		if (late) lates.push((purge) => storeLateAnswers(deps, snapshot, ours, state, late, at, purge));
		// B577: asked only now, inside the follow-up, so after the response. The playMetrics are asked unless another
		// writer's newer version, which this read answered, already has its own (review).
		else if (askAfter) lates.push((purge) => storeLateAnswers(deps, snapshot, ours, state, askAfterResponse(deps.mlb, snapshot, write.stored, {
			playerOfTheGameDue: write.playerOfTheGameDue ?? false,
			playMetrics: (write.needsPlayMetrics ?? false) && (ours || !snapshot.playMetrics),
		}), at, purge));
	}
	// Every game's late write at once (B577: a day's asks run together, not one game after another), then one edge purge
	// for every past, finished game they stored (B577 review), sent before any failure is reported, each failure kept.
	if (lates.length > 0) after.followUps.push(async () =>
	{
		const purge: GameSnapshot[] = [];
		const failed = (await Promise.allSettled(lates.map((late) => late(purge)))).filter((result) => result.status === "rejected").map((result) => result.reason as unknown);
		if (purge.length > 0) await purgeGameAndDayEdge(deps, purge, at);
		if (failed.length > 0) throw new AggregateError(failed, `late writes of ${failed.length} games failed`);
	});
	return gamePks.map((gamePk) => answers.get(gamePk) ?? null);
}

/** The after-response asks' limit and log name (B577). */
const LATE_ASK: AskLimit = {
	ms: LATE_ASK_LIMIT_MS,
	name: "late answers",
};

/**
 * B577: what a digest's batch left off a game's answer, asked of MLB after the response, all at once, each within
 * {@link LATE_ASK_LIMIT_MS} (counted with its wait in the Worker's connection queue; an ask that runs out is logged and
 * left out, and a failed one too, never costing the game's other answers): its playMetrics when `asks.playMetrics` (its
 * fetch got none of its own; stored ones carried over are replaced), the uniforms and rule settings it is due
 * (`askDueExtras`, judged against `stored`, the snapshot the read began with, as the game read judges them) and its
 * player of the game when it is due one (`withAskedPlayerOfTheGame`). Returns the answered game with whatever came, or
 * null when nothing did.
 */
async function askAfterResponse(
	mlb: MlbStatsClient,
	answered: GameSnapshot,
	stored: GameSnapshot | null,
	asks: { playerOfTheGameDue: boolean;
		playMetrics: boolean; },
): Promise<Unversioned<GameSnapshot> | null>
{
	const game = unversionedGame(answered);
	const [playMetrics, extras, picked] = await Promise.all([
		asks.playMetrics ? askPlayMetrics(mlb, game.gamePk, LATE_ASK) : null,
		askDueExtras(mlb, game, stored, undefined, LATE_ASK),
		withAskedPlayerOfTheGame(mlb, {
			game,
			playerOfTheGameDue: asks.playerOfTheGameDue,
		}, answered.playerOfTheGame, undefined, LATE_ASK),
	]);
	if (!playMetrics && Object.keys(extras).length === 0 && picked.game === game) return null;
	const whole = {
		...picked.game,
		...extras,
	};
	return playMetrics ? withLatePlayMetrics(whole, playMetrics) : whole;
}

/**
 * {@link storeGames} for a read's batch, degrading per game (S216 review): the batch is one store; if it fails, each game
 * is stored on its own, its rows read again (the batch may have written some), and a game whose store still fails is
 * logged and left out of the result, so the caller answers it as it was stored (or null) and the rest of a digest
 * stands.
 */
async function storeBatchOrEach(
	deps: Pick<IngestDeps, "games" | "gameStates">,
	writes: readonly GameWrite[],
	at: Date,
	after: AfterWrites,
	known: ReadonlyMap<number, GameStateRow | null>,
): Promise<Map<number, Pick<StoredGame, "snapshot" | "state" | "ours">>>
{
	try
	{
		return await storeGames(deps, writes, at, after, known);
	}
	catch (error)
	{
		console.warn(`storing ${writes.length} games in one batch failed; storing each on its own`, error);
	}
	const stored = new Map<number, Pick<StoredGame, "snapshot" | "state" | "ours">>();
	for (const write of writes)
	{
		try
		{
			for (const [gamePk, result] of await storeGames(deps, [write], at, after)) stored.set(gamePk, result);
		}
		catch (error)
		{
			console.warn(`storing game ${write.fetched.gamePk} failed; answered as stored`, error);
		}
	}
	return stored;
}

/**
 * Stores what a read's game got after its response, once it arrives: its late playMetrics (S216 AC 5), and for a
 * digest's batch (B577, `askAfterResponse`) its uniforms, rule settings and player of the game too. `late` is the game
 * with them (null: nothing came). When the game as answered (`answered`) is this read's own content (`ours`), it becomes
 * that game, its extras kept (`keepStoredExtras`), as its next version (ADR-022), and its projection with it; when it is
 * another writer's newer version (B577 review), or a newer stored version refuses the first write (one retry, over the
 * newer stored snapshot), only what that snapshot lacks is added ({@link lateAdditions}), so a newer feed is never
 * written over by this read's older one; when it lacks nothing, or on a second refusal (logged), nothing is written.
 * Once stored, the game's row gets the win-probability line the playMetrics give (S161, a line-only switch write). A
 * past, finished game is then added to `purge` (B577 review: the caller sends one purge of its game's URL and its day's
 * schedule and digest URLs for every late write, `purgeGameAndDayEdge`), since the answer without them may hold S212's
 * long edge lifetime; it is added once the snapshot is stored, even when the projection or line write after it fails.
 * Past and finished is judged of the game as served, over the state row the line write stored, else `row`, the one its
 * read stored.
 */
async function storeLateAnswers(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates">,
	answered: GameSnapshot,
	ours: boolean,
	row: GameStateRow | null,
	late: Promise<Unversioned<GameSnapshot> | null>,
	at: Date,
	purge: GameSnapshot[],
): Promise<void>
{
	const whole = await late;
	if (!whole) return;
	let base = answered;
	for (let attempt = 0; attempt < 2; attempt++)
	{
		// S99, S101: a late game built without the extras asked off the fetch keeps the answered game's (`keepStoredExtras`).
		const content: Unversioned<GameSnapshot> = attempt === 0 && ours
			? keepStoredExtras(answered, {
				...whole,
				fetchedAt: answered.fetchedAt,
				windowMode: answered.windowMode,
				...answered.suspendedAt !== undefined && {
					suspendedAt: answered.suspendedAt,
				},
			})
			: lateAdditions(base, whole);
		const next = stampVersion<GameSnapshot>(base, content, at.toISOString());
		// Nothing `base` lacks: it is left as it is.
		if (next.version === base.version) return;
		if ((await deps.games.upsertMany([next])).includes(next.gamePk))
		{
			let lined = row;
			try
			{
				await writeProjections(deps, [projectGame(next)]);
				// S161: the line the answered write couldn't work out without them, set on the game's row alone.
				const line = scoreboardWinProbability(next);
				if (line) lined = (await switchGameState(deps, [{
					gamePk: next.gamePk,
					source: "feed",
					winProbability: line,
				}], at)).get(next.gamePk)?.row ?? row;
			}
			finally
			{
				// Judged as served, its status from the game's stored state row (S150), as every other purge is.
				if (isPastFinishedGame(servedGame(next, lined, at), at)) purge.push(next);
			}
			return;
		}
		if (attempt === 1)
		{
			console.warn(`late answers: game ${next.gamePk} refused twice by newer stored versions; dropped`);
			return;
		}
		const stored = (await deps.games.getMany([next.gamePk]))[0];
		if (!stored) return;
		base = stored;
	}
}

/**
 * B577 review: what a late game (`whole`) adds over a stored snapshot that isn't the read's own (`base`): the extras
 * `base` lacks (`keepStoredExtras`, the pick side by side), and `whole`'s playMetrics when `base` has none or they reach
 * a later at-bat than `base`'s (`lastMeasuredAtBat`: a set a digest read carried over a newer feed), never a set that
 * reaches fewer. A set reaching the same at-bat whose figures differ doesn't replace `base`'s either, on purpose: the
 * other writer's are as new, and swapping one for the other would only make versions with no news in them.
 */
function lateAdditions(base: GameSnapshot, whole: Unversioned<GameSnapshot>): Unversioned<GameSnapshot>
{
	const content = unversionedGame(base);
	const fresher = whole.playMetrics && (!base.playMetrics || lastMeasuredAtBat(whole.playMetrics) > lastMeasuredAtBat(base.playMetrics)) ? whole.playMetrics : undefined;
	return keepStoredExtras(whole, fresher ? withLatePlayMetrics(content, fresher) : content);
}

/** A stored snapshot without its version stamps: the content a re-stamp starts from. */
export function unversionedGame(snapshot: GameSnapshot): Unversioned<GameSnapshot>
{
	const {
		version: _version, lastChangedAt: _changed, ...content
	} = snapshot;
	return content;
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
	// S149 AC 2: both days' day hub calls made once, after both writes.
	const hubCalls = new DayHubCalls();
	const refresh = async (day: string) =>
	{
		const fetched = await deps.mlb.fetchSchedule(day);
		const windowed = await withSuspendedAt(deps, fetched.date, fetched.games, now);
		await storeSchedule(deps, {
			...fetched,
			fetchedAt: now.toISOString(),
			windowMode: scheduleWindowMode(windowed, now, params),
		}, undefined, hubCalls);
		games.push(...windowed);
	};

	try
	{
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
	}
	finally
	{
		await hubCalls.flush(deps.dayHubs);
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
 * size of the day's schedule. Each game is stored whole (`wholeFetchedGame`: its playMetrics waited for however late,
 * S216 AC 5) through `ingestGame`, its projection and purge written before the next game, not deferred.
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
			// S99: one bounded ask for a due game's pick; this cron path reads the stored game only after the fetch.
			const { game, feedTime } = await withAskedPlayerOfTheGame(deps.mlb, await wholeFetchedGame(await deps.mlb.fetchGame(summary.gamePk)), undefined);
			await ingestGame(deps, {
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
