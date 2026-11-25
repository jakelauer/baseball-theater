/**
 * Storage ports (ADR-018): every durable read and write goes through one of
 * these, so the in-memory test doubles and the Postgres adapter (S50) are
 * interchangeable. All of them are held to one shared contract
 * (`functions/src/adapters/repository-contract.ts`, S46): values round-trip as
 * JSON, reads return copies, and an upsert whose `version` is not newer than
 * the stored one is a no-op (ADR-022 apply-if-newer).
 */
import type {
	AccountSettings, GameProjection, GameRecheckCandidate, GameSnapshot, GameStateFields, GameStateRow, ScheduleDayTally, ScheduleMonthCheck, StoredScheduleDay,
} from "@bt/domain";
import type { ReplayPatchEntry } from "@bt/mlb-api";

/**
 * Stored schedule days (S150 AC 5: `StoredScheduleDay`, no game's status, linescore or live moment, which
 * `GameStateRepository` holds; a postponed or suspended listing keeps its own status as `listingStatus`). Beside each
 * day's document is its `served_base` (S150 AC 6), a counter of this database's own, outside the document so it isn't
 * hashed: the served day's version adds it, so dropping a game from a day never lowers that version. An adapter reads the games' state versions itself, from the same store as
 * `GameStateRepository`.
 */
export interface ScheduleRepository {
	getByDate(date: string): Promise<StoredScheduleDay | null>;
	/** The day and its `served_base` in one read, so the served version is never summed from two different moments. */
	getWithServedBase(date: string): Promise<{ day: StoredScheduleDay;
		servedBase: number; } | null>;
	/**
	 * Writes the day if its version is newer (ADR-022). The same write raises its `served_base` by the state versions,
	 * as stored at that moment, of the games the stored day lists and `day` doesn't, so a stop can never leave one
	 * without the other and no state write in between can make the served version fall.
	 *
	 * S216: reports what it stored, so a caller answers from the day it formed without reading it back: the day's
	 * `served_base` as this write left it (raised or not), or null when the write was refused because another writer
	 * stored this version or a newer one first (then, and only then, the caller reads the stored day).
	 */
	upsert(day: StoredScheduleDay): Promise<number | null>;
	/**
	 * Every stored day from `from` to `to` (both included, `YYYY-MM-DD`) as its game count, its
	 * teams' IDs (S136; each once, ascending), its games' types with whether it has a
	 * regular-season game (S167; one type per game, `null` for an untyped one), the teams of its
	 * regular-season games (`regularSeasonTeamIds`, S191; `null` exactly when `regularSeason` is) and
	 * stamps, in date order, in one read (S124's month view): days nothing stored are left out.
	 */
	listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>;
	/**
	 * Every recorded schedule month from `from` to `to` (both included, `YYYY-MM`), in month order, in
	 * one read (S194): when BT last checked each against MLB and when a refresh last claimed it. Months
	 * never recorded are left out.
	 */
	listScheduleMonthChecks(from: string, to: string): Promise<ScheduleMonthCheck[]>;
	/**
	 * Records that BT checked `month` against MLB at `checkedAt` (an ISO instant), moving the stored
	 * `checkedAt` only forward: the later of the stored and the given time stays, so a fill that
	 * finishes late never moves it back (S194 AC 1).
	 */
	recordScheduleMonthCheck(month: string, checkedAt: string): Promise<void>;
	/**
	 * Claims `month` for a refresh at `at` (an ISO instant), in one conditional write: it succeeds,
	 * and returns true, only when the month is still due (never checked, or checked at least
	 * `SCHEDULE_MONTH_REFRESH_INTERVAL_MS` before `at`) and is unclaimed or its claim is at least
	 * `SCHEDULE_MONTH_CLAIM_LEASE_MS` older than `at`; otherwise it changes nothing and returns false
	 * (S194 AC 1), so two refreshes racing for a month never both take it, and a month another tick
	 * checked after this one read the records isn't filled twice.
	 */
	claimScheduleMonth(month: string, at: string): Promise<boolean>;
	/**
	 * Moves `month`'s claim forward to `claimedAt` (an ISO instant, possibly in the future), never
	 * back: how a refresh whose fill MLB didn't answer keeps the month from being claimed again for
	 * `SCHEDULE_MONTH_FAILED_LEASE_MS` (S194 review), since a claim holds until `claimedAt` plus the lease.
	 */
	holdScheduleMonth(month: string, claimedAt: string): Promise<void>;
	/**
	 * Every listing of one of `gamePks` by a stored day in `from`..`to` (inclusive), as `{ date, gamePk }`, in date then
	 * gamePk order, in one read (S212): a game postponed or suspended on one day and played on another is listed by both,
	 * and each day's digest shows its clips, so a change to the game purges every one of those days' edge URLs. The
	 * caller bounds the range (the games' seasons), so the read never scans every stored day.
	 */
	listGameListings(gamePks: readonly number[], from: string, to: string): Promise<{ date: string;
		gamePk: number; }[]>;
}

/**
 * One `game_states` row per game (S150 AC 3): the one stored copy of a game's status, linescore and live moment.
 * Only `switchGameState` writes it (the baseball-data copy aside).
 */
export interface GameStateRepository {
	getByPk(gamePk: number): Promise<GameStateRow | null>;
	/** The rows of `gamePks` that exist, in no particular order. */
	getMany(gamePks: readonly number[]): Promise<GameStateRow[]>;
	/**
	 * Writes `rows` (distinct gamePks) in one write and returns the gamePks it took. A row is taken when its state's
	 * version is newer than the stored one (replacing the state, the source and the official date), or when its version
	 * is the same, its state is equal to the stored one (`version` and `lastChangedAt` included) and its feed time is
	 * newer: then only the accepted feed time and the source move (only a feed write carries a feed time, so the row is
	 * then the feed's), never the state, so one version never stands for two states (ADR-022). The accepted feed time
	 * never moves back, and a row with no first pitch never clears a stored one.
	 */
	write(rows: readonly GameStateRow[]): Promise<number[]>;
}

export interface GameRepository {
	getByPk(gamePk: number): Promise<GameSnapshot | null>;
	/**
	 * The stored snapshots of `gamePks` in one read (S216 AC 2: a day's games read at once, not one query a game), in no
	 * particular order; games not stored are left out.
	 */
	getMany(gamePks: readonly number[]): Promise<GameSnapshot[]>;
	/**
	 * Writes `games` in one write, each only if its version is newer than the stored one (ADR-022), and returns the
	 * gamePks it took (S216 AC 2): a game left out was refused, another writer having stored that version or a newer
	 * one first. Given one gamePk twice, only its newest version is written.
	 */
	upsertMany(games: readonly GameSnapshot[]): Promise<number[]>;
	/**
	 * What `gameStateFromGame` reads of each stored game of `gamePks` (S150 AC 6: a game with no `game_states` row is
	 * served from its snapshot), in one read and without the rest of the document; games not stored are left out.
	 */
	getStateFields(gamePks: readonly number[]): Promise<GameStateFields[]>;
	upsert(game: GameSnapshot): Promise<void>;
	listByDate(date: string): Promise<GameSnapshot[]>;
	/**
	 * The recent-game re-check's one read (S212 AC 5): each stored game whose official date is in `from`..`to`
	 * (inclusive), with its `windowMode`, its served status (its `game_states` row's, else its snapshot's) and its
	 * re-check record (`checkedAt`, `claimedAt`, null when never), in gamePk order, without the rest of the document.
	 */
	listRecheckCandidates(from: string, to: string): Promise<GameRecheckCandidate[]>;
	/**
	 * Claims `gamePk` for a re-check at `at` (an ISO instant) in one conditional write: it succeeds, and returns true,
	 * only when the game is still due (never re-checked, or last re-checked at least `SCHEDULE_MONTH_REFRESH_INTERVAL_MS`
	 * before `at`) and has no claim or one at least `GAME_RECHECK_CLAIM_LEASE_MS` older than `at`, so two isolates
	 * never re-check one game at once.
	 */
	claimGameRecheck(gamePk: number, at: string): Promise<boolean>;
	/** Records that `gamePk` was re-checked against MLB at `checkedAt` (an ISO instant), moving the record forward only. */
	recordGameRecheck(gamePk: number, checkedAt: string): Promise<void>;
	/**
	 * Moves `gamePk`'s re-check claim forward to `claimedAt` (an ISO instant, possibly in the future), never back: how a
	 * re-check MLB didn't answer keeps the game from being claimed again for `GAME_RECHECK_FAILED_HOLD_MS`, since a claim
	 * holds until `claimedAt` plus the lease (as `holdScheduleMonth`, S194).
	 */
	holdGameRecheck(gamePk: number, claimedAt: string): Promise<void>;
}

/** The five projected store documents per game; versioned by `header.version`. */
export interface GameProjectionRepository {
	upsert(projection: GameProjection): Promise<void>;
	/**
	 * Writes `projections` in one write, each only if its `header.version` is newer than the stored one (ADR-022), and
	 * returns the gamePks it took (S216 AC 2); one left out was refused by a newer stored version. Given one gamePk
	 * twice, only its newest version is written.
	 */
	upsertMany(projections: readonly GameProjection[]): Promise<number[]>;
	getByPk(gamePk: number): Promise<GameProjection | null>;
}

/**
 * One game's replay: a pointer to the base feed timecode plus the ordered,
 * idle-collapsed patch sequence that walks it to the final state. The base feed
 * bytes are not stored here — the reconstructor is handed them separately.
 */
export interface ReplayArtifact {
	gamePk: number;
	/** The timecode the patch chain roots at (`timestamps[0]`). */
	baseTimecode: string;
	/** End timecode of each retained patch, in order. */
	timecodes: string[];
	/** Retained (non-empty-diff) patches, oldest first. */
	patches: ReplayPatchEntry[];
	/**
	 * ADR-022 version: the number of retained patches. A capture that walked
	 * further along the game is newer; re-capturing the same walk is a no-op.
	 */
	version: number;
}

export interface ReplayArtifactRepository {
	upsert(artifact: ReplayArtifact): Promise<void>;
	getByPk(gamePk: number): Promise<ReplayArtifact | null>;
}

/**
 * Each user's settings document (ADR-027), keyed by BT `uid`. Apply-if-newer
 * on `version` like every other store (ADR-022). Personal data (ADR-028's
 * `BT database: settings`): it also exports and deletes one user's document.
 */
export interface SettingsRepository {
	get(uid: string): Promise<AccountSettings | null>;
	upsert(uid: string, settings: AccountSettings): Promise<void>;
	/** The user's settings for their data download; null when they never saved any. */
	exportFor(uid: string): Promise<AccountSettings | null>;
	/** Removes the user's settings; a no-op when there are none. */
	deleteFor(uid: string): Promise<void>;
}
