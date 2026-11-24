/**
 * How fresh a cached payload is expected to be (ADR-014: freshness is declared by
 * the server, not guessed per call site).
 *
 * BT tells the client what it is holding via `windowMode` on every payload:
 * `active` means the ingest loop is pulling this resource on a cadence, so the
 * client re-asks while it is on screen; `cache` means the server itself is not
 * refreshing, so polling would only add load without adding news.
 *
 * This is the **only** module in `web/` allowed to name an interval. A resource
 * that wants different timing states the reason here rather than sprinkling a
 * number into its descriptor.
 */

/** What a payload declares about the server's own refresh behaviour. */
export type WindowMode = "active" | "cache";

export interface Freshness
{
	/** How long a cached payload is served without a background re-fetch. */
	staleTime: number;
	/** Background re-fetch cadence while a reader is mounted, or `false` for none. */
	refetchInterval: number | false;
}

const SECOND = 1000;

/**
 * How often an in-window payload is re-asked while a reader is on screen (S20): the
 * scoreboard's in-progress games stay current without a reload. 15s follows ADR-002's
 * ingest cadence closely enough to feel live without asking faster than BT can change.
 */
export const LIVE_REFRESH_MS = 15 * SECOND;

/**
 * The least time the installed app asks the browser to leave between background wakes (S74,
 * Periodic Background Sync's `minInterval`): a request, not a schedule, since the browser picks
 * the real cadence (often far longer) by how much the app is used. It decides when today's schedule
 * is asked for again in the background, never how long a stored copy may be shown (the worker
 * keeps the newest answer it got, ADR-014 rule 3). An hour, so a fan opening the app offline
 * during a game day finds that day's schedule from earlier in it.
 */
export const BACKGROUND_PREFETCH_MS = 60 * 60 * SECOND;

/** In-window: the ingest cadence is writing; follow it closely enough to feel live. */
const ACTIVE: Freshness = {
	staleTime: 10 * SECOND,
	refetchInterval: LIVE_REFRESH_MS,
};

/** Out-of-window: the server is not refreshing, so re-asking cannot produce news. */
const CACHED: Freshness = {
	staleTime: 5 * 60 * SECOND,
	refetchInterval: false,
};

/**
 * A refetch cadence that pauses while the tab is hidden (S20): a hidden page re-asks
 * nothing, because nobody is looking. TanStack re-asks a stale query when the tab comes
 * back (refetch on focus), and that fetch re-arms the interval.
 */
export function whileVisible(interval: number | false): number | false
{
	return document.hidden ? false : interval;
}

/** Nothing loaded yet — treat as cached; the first successful payload settles it. */
export function freshnessPolicy(windowMode: WindowMode | undefined): Freshness
{
	return windowMode === "active" ? ACTIVE : CACHED;
}

/**
 * The header the service worker adds to an answer it served from its stored copy rather than the
 * network (S74, `markStoredCopy` in `storage/workerCaches.ts`): the page dates such a copy by its
 * own `Date` and `Age` ({@link storedCopyTime}), and every other answer by when it arrived.
 */
export const STORED_COPY_HEADER = "BT-Stored-Copy";

/**
 * When a stored copy was current (S74), as ISO, from the answer's `Date` minus its `Age` (seconds a
 * cache held it before), or undefined when it has no readable `Date`. The payload's own `fetchedAt`
 * can't say it: BT writes nothing on an unchanged poll, so it is the last change, which can be hours
 * older than the copy. `Date − Age` errs old, never new: an edge that restamps `Date` when it serves
 * makes it the time BT produced the answer, and one that keeps BT's `Date` makes it a little earlier.
 * A missing or unreadable `Age` counts as 0; one so large the time can't be written gives undefined.
 */
export function storedCopyTime(headers: Headers): string | undefined
{
	const date = Date.parse(headers.get("Date") ?? "");
	if (Number.isNaN(date)) return undefined;
	const age = Number(headers.get("Age"));
	const at = new Date(date - (Number.isFinite(age) && age > 0 ? age * SECOND : 0));
	return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}
