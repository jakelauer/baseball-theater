import { contentHash } from "./content-hash.js";
import type { GameSnapshot } from "./types.js";
import { DEFAULT_CADENCE, isSuspendedStatus } from "./window.js";

/** Anything the live path ships as a whole state stamped with a per-game version (ADR-022). */
export type Versioned = {
	/** Monotonic per game: a higher number is always the newer state. */
	version: number;
};

/**
 * The ADR-022 apply-if-newer rule: keep whichever of the two states has the
 * higher version, so a duplicated or late update can never roll a game back.
 *
 * Every layer that holds a game state (Postgres conditional write, hub, client
 * cache) applies this same rule. It assumes updates are whole states, not
 * commands — applying "the game at version N" twice is harmless. A tie keeps
 * `current`, so re-delivering the version already held changes nothing.
 * `current` is null before the first update has been applied.
 */
export function applyIfNewer<T extends Versioned>(current: T | null, incoming: T): T
{
	if (current === null) return incoming;
	return incoming.version > current.version ? incoming : current;
}

/** The ADR-022 stamp BT puts on a stored state; upstream payloads arrive without it. */
export type VersionStamp = Versioned & {
	/** ISO time the content last changed. */
	lastChangedAt: string;
};

/** A state as fetched, before BT stamps it — what `MlbStatsClient` returns. */
export type Unversioned<T> = Omit<T, keyof VersionStamp>;

/** What counts as content: everything except the stamp and the poll time. */
function contentOf(value: object): unknown
{
	const {
		version: _v, lastChangedAt: _l, fetchedAt: _f, ...content
	} = value as Record<string, unknown>;
	return content;
}

/**
 * Stamps a freshly fetched state against the stored one (ADR-022): a new state
 * starts at version 1; a state whose content hash matches the stored one keeps
 * the stored version and `lastChangedAt`, so an unchanged poll is not a new
 * version; any other change is the stored version + 1, changed at `now`.
 * `fetchedAt` (the poll time) is left out of the hash, so polling alone never
 * bumps. Other fields, including `windowMode`, are content: a game leaving its
 * active window changes how readers cache it.
 */
export function stampVersion<T extends VersionStamp>(stored: T | null, incoming: Unversioned<T>, now: string): T
{
	if (stored && contentHash(contentOf(stored)) === contentHash(contentOf(incoming)))
	{
		return {
			...incoming,
			version: stored.version,
			lastChangedAt: stored.lastChangedAt,
		} as T;
	}
	return {
		...incoming,
		version: stored ? stored.version + 1 : 1,
		lastChangedAt: now,
	} as T;
}

/**
 * How long after its last change a state still in its active window may be its own ingest's to write: the longer of
 * the ADR-002 trail and a suspended game's window (`suspendedHours`, #79), plus an hour, so a game's last write as its
 * window closes is still covered, a suspended one included (it is polled for 6 hours from its suspension, usually with
 * no change). A game being polled in play changes every few minutes; one left `active` months ago, stuck mid-game
 * because nobody watched it to the end, is nobody's. Accepted race: a live game with no content change for longer than
 * this (a long rain delay) can be adopted while its ingest still runs. An ingest write that lands between the copy's
 * read and its write is kept (the copy's guarded write loses), but one that read the game before the copy's write and
 * lands after it at the same version is dropped by the guard, and its projection may land in place of the copy's;
 * ingest's next change restamps both.
 */
export const INGEST_OWNS_MS = (Math.max(DEFAULT_CADENCE.trailHours, DEFAULT_CADENCE.suspendedHours) + 1) * 60 * 60 * 1000;

/**
 * When a game turned suspended, as BT saw it (#79, #323): the `suspendedAt` a write of a game whose
 * status is `codedGameState` carries, given what is `stored`. The 6 hours a suspended game is polled
 * run from it (`isGameInActiveWindow`; owner, 2026-11-22: "From when it was suspended (Recommended)").
 *
 * - Not suspended: none, so a resumed game drops it and a second suspension gets its own.
 * - Already stored suspended (`T` or `U`, either way round): the stored time, unchanged, so a later
 *   change while suspended never extends the window (none stays none).
 * - Stored not suspended, `active` and changed within {@link INGEST_OWNS_MS} of `now`: `now`. BT was
 *   polling the game, so this write is the one that saw the change; it is the write's `lastChangedAt`
 *   too, since a status change is a content change (`stampVersion`).
 * - Otherwise none: nothing stored, a cached copy, or an `active` one left unchanged for longer (a
 *   stale snapshot BT stopped polling) didn't see when the game stopped, and a fresh 6 hours from a late
 *   read would be wrong; `isGameInActiveWindow` then counts from first pitch.
 *
 * One function for every path (ADR-025): the store (`storeGame`), the per-game ingest's window check
 * before it stores, and the schedule path, which asks it of the stored game for a summary listed suspended.
 */
export function suspendedSince(
	stored: (Pick<GameSnapshot, "windowMode" | "suspendedAt" | "lastChangedAt"> & { status: Pick<GameSnapshot["status"], "codedGameState"> }) | null,
	codedGameState: string,
	now: string,
): string | undefined
{
	if (!isSuspendedStatus(codedGameState) || stored === null) return undefined;
	if (isSuspendedStatus(stored.status.codedGameState)) return stored.suspendedAt;
	const changedAt = Date.parse(stored.lastChangedAt);
	const fresh = !Number.isNaN(changedAt) && Date.parse(now) - changedAt < INGEST_OWNS_MS;
	return stored.windowMode === "active" && fresh ? now : undefined;
}

/** What {@link compareAcrossStores} needs of the stored state: its stamp, and its window when it has one. */
export type StoredStamp = Pick<VersionStamp, "version" | "lastChangedAt"> & { windowMode?: string };

/**
 * How a state from *another database* compares with the one stored here (the baseball-data copy, S117; owner,
 * 2026-11-13: "option A"). `version` counts changes in one database only, so it is never compared across two; what
 * both measure the same way is `lastChangedAt`, the time BT saw the content change. Assumes both times come from
 * synced clocks (a few seconds of skew only matters for two different changes inside those seconds).
 *
 * - `new`: nothing is stored;
 * - `unreadable`: either time isn't one `Date.parse` reads, so neither can be called newer;
 * - `notLater`: the incoming state changed earlier, or at the same instant (a tie keeps what is stored);
 * - `ingesting`: the stored state is in its active window and changed within {@link INGEST_OWNS_MS} of `now`, so
 *   this database's ingest may be writing it right now (ADR-022: one writer per game);
 * - `later`: the incoming state changed strictly later.
 */
export function compareAcrossStores(stored: StoredStamp | null, incoming: Pick<VersionStamp, "lastChangedAt">, now: Date): "new" | "unreadable" | "notLater" | "ingesting" | "later"
{
	if (stored === null) return "new";
	const storedAt = Date.parse(stored.lastChangedAt);
	const incomingAt = Date.parse(incoming.lastChangedAt);
	if (Number.isNaN(storedAt) || Number.isNaN(incomingAt)) return "unreadable";
	if (incomingAt <= storedAt) return "notLater";
	if (stored.windowMode === "active" && now.getTime() - storedAt < INGEST_OWNS_MS) return "ingesting";
	return "later";
}

/**
 * {@link compareAcrossStores} for whole states, deciding what to store: a `new` state as it is (its own version;
 * there is no counter here to stay ahead of); a `later` one with the same content (version, `lastChangedAt` and
 * `fetchedAt` aside, as {@link stampVersion} counts it) is `same` and stores nothing, so copying again writes
 * nothing; any other `later` one is restamped at the stored version + 1, keeping its `lastChangedAt`, so this
 * database's counter only moves forward and every reader holding the stored version takes it (ADR-022).
 */
export function adoptAcrossStores<T extends VersionStamp>(stored: T | null, incoming: T, now: Date): { outcome: ReturnType<typeof compareAcrossStores> | "same";
	state: T | null; }
{
	const outcome = compareAcrossStores(stored, incoming, now);
	if (outcome === "new") return {
		outcome,
		state: incoming,
	};
	if (outcome !== "later" || stored === null) return {
		outcome,
		state: null,
	};
	if (contentHash(contentOf(stored)) === contentHash(contentOf(incoming))) return {
		outcome: "same",
		state: null,
	};
	return {
		outcome,
		state: {
			...incoming,
			version: stored.version + 1,
		},
	};
}
