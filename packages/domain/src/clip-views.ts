/**
 * Clip engagement (S174): BT counts, anonymously, how often each video in a game's Videos room is started and watched to
 * the end, one count per clip, day, event and place in the list, so a later model (S185) can learn which clips fans want
 * first. These are the rules every part of it shares: what a view event is, when a view counts as finished, which day a
 * count lands on and what a request to count one looks like. Nothing here, or in what stores the counts, says anything
 * about who watched (S174 AC 5; the Privacy policy says so).
 */
import type { ClipViewRequest } from "./api-routes.js";

/** What a fan did with a clip: began playing it (`start`) or watched it to the end (`complete`). */
export type ClipViewEvent = "start" | "complete";

/** Every {@link ClipViewEvent}, as a runtime list (the route's check, the table's check constraint). */
export const CLIP_VIEW_EVENTS: readonly ClipViewEvent[] = ["start", "complete"];

/** Whether `value` is a {@link ClipViewEvent}. */
export function isClipViewEvent(value: unknown): value is ClipViewEvent
{
	return (CLIP_VIEW_EVENTS as readonly unknown[]).includes(value);
}

/** The share of a clip that must have played for the view to count as finished (S174 AC 2). */
export const CLIP_COMPLETE_SHARE = 0.9;

/**
 * Whether a view of a clip counts as finished by how far it played: true when the clip's length is known (finite and
 * positive) and at least {@link CLIP_COMPLETE_SHARE} of it has played. A length of 0, `NaN`, `Infinity` or unknown
 * (`undefined`, as a `<video>` reports before its metadata loads or for a live stream) is never finished by this rule;
 * the player's other way to finish is the element's `ended` event (S174 AC 6).
 */
export function clipCompleted(positionSeconds: number, durationSeconds: number | undefined): boolean
{
	if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
	return positionSeconds >= durationSeconds * CLIP_COMPLETE_SHARE;
}

/**
 * The highest shown position a count may carry: a clip's 1-based place in its game's ranked Videos list (the order
 * `rankHighlightsByImpact` gives), or 0 when it was opened directly from a link. A game's list holds far fewer clips,
 * so the bound only stops a caller inventing rows.
 */
export const CLIP_SHOWN_POSITION_MAX = 100;

/** Whether `value` is a shown position: a whole number from 0 to {@link CLIP_SHOWN_POSITION_MAX}. */
export function isClipShownPosition(value: unknown): value is number
{
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= CLIP_SHOWN_POSITION_MAX;
}

/**
 * A clip's shown position in its game's ranked Videos list (`ranked`, as the game arrives: `rankHighlightsByImpact`'s
 * order, whatever sort or filter the room shows): its 1-based place, or null when it isn't in the list or sits past
 * {@link CLIP_SHOWN_POSITION_MAX}, which the route refuses, so such a view is not counted. A clip opened directly from a
 * link is position 0, which the caller knows and this doesn't.
 */
export function clipShownPosition(ranked: readonly { id: string }[], mediaId: string): number | null
{
	const place = ranked.findIndex((clip) => clip.id === mediaId) + 1;
	return place >= 1 && place <= CLIP_SHOWN_POSITION_MAX ? place : null;
}

/**
 * The day a count lands on: the UTC calendar day (`YYYY-MM-DD`) of `at`, the moment the server took the request. UTC,
 * not a fan's zone or MLB's, so the day says nothing about where the viewer is, and every count of one moment lands on
 * the same day whichever server takes it. `2026-11-22T23:59:59Z` is `2026-11-22`; a second later is `2026-11-23`.
 */
export function clipViewDay(at: Date): string
{
	return at.toISOString().slice(0, 10);
}

/**
 * The largest MLB game id the route accepts: Postgres `integer`'s top, which every game id is far below. The spec states
 * it too, as `ClipViewRequest.gamePk`'s `@maximum` (`openapi.test.ts` checks they agree).
 */
export const CLIP_VIEW_GAME_PK_MAX = 2147483647;

/** The keys a {@link ClipViewRequest} has, and the only ones it may have. */
const CLIP_VIEW_REQUEST_KEYS: readonly string[] = ["gamePk", "event", "shownPosition"];

/**
 * `body` as a {@link ClipViewRequest}, or null when it isn't exactly that shape: an object whose `gamePk` is a positive
 * whole number, whose `event` is a {@link ClipViewEvent} and whose `shownPosition` passes {@link isClipShownPosition}.
 * Any other key makes it null, as the spec's `additionalProperties: false` says. The route answers 400 for null and
 * counts nothing.
 */
export function parseClipViewRequest(body: unknown): ClipViewRequest | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	if (Object.keys(body).some((key) => !CLIP_VIEW_REQUEST_KEYS.includes(key))) return null;
	const {
		gamePk, event, shownPosition,
	} = body as Record<string, unknown>;
	if (!Number.isInteger(gamePk) || (gamePk as number) < 1 || (gamePk as number) > CLIP_VIEW_GAME_PK_MAX) return null;
	if (!isClipViewEvent(event) || !isClipShownPosition(shownPosition)) return null;
	return {
		gamePk: gamePk as number,
		event,
		shownPosition,
	};
}
