import {
	useEffect, useLayoutEffect, useState, useSyncExternalStore,
} from "react";
import { fetchedAgo } from "@bt/domain";
import { formatMomentSince } from "../format/datetime.js";
import type { Notice } from "../layout/NoticeSlot.js";

/**
 * Offline reading's marker (S74; shell-scoreboard A1, game-rooms A1, A13, A14). Offline, the page
 * keeps showing the copy it has (the worker's last stored answer, `pwa/options.ts`, or the one
 * already on screen) and the notice slot says so: "You're offline. Scores as of 7:42 PM — 18m ago."
 * on the scoreboard, "You're offline. This game as of …" in a game, and only "You're offline." where
 * there is no copy at all (a room never opened while online, owner 2026-10-21: no explanation). It
 * has no action and no ✕: it holds while offline and goes once the browser is back online. The
 * footer says nothing about it (A13, A14).
 *
 * Whether the browser is online is `navigator.onLine` and its `online`/`offline` events. What the
 * page shows is the page's to say: each page tells this module the copy it draws
 * ({@link useSavedCopy}), as `useUpdateNotice` learns of a waiting worker, through a window event,
 * since the shell draws the slot and the page holds the data (ADR-024: no context, no store).
 */

/**
 * What the page on screen draws: its kind decides the wording, `asOf` (ISO) its time and age. `asOf`
 * is when this copy was current, never the payload's `fetchedAt` (BT's last change, which an
 * unchanged poll doesn't move): for a copy the worker served from storage, its `Date` less its `Age`
 * (`copyAsOf`, `api/client.ts`); otherwise when the page last got it (the query's `dataUpdatedAt`).
 */
export interface SavedCopy
{
	kind: "scores" | "game";
	asOf: string;
}

const CHANGED = "bt:saved-copy-changed";
/** The copy the page on screen draws, or null (no page reported one, or it has none). */
let saved: SavedCopy | null = null;

/** Whether the browser says it is online; re-renders on every `online` and `offline` event. */
export function useOnline(): boolean
{
	return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

function subscribeOnline(onChange: () => void): () => void
{
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () =>
	{
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

/**
 * A page's say over the offline marker: the copy it draws while mounted, cleared when it unmounts
 * (so the next page never inherits another's age), or `null` while it has none. A layout effect, so
 * the marker's wording is right on the first paint.
 */
export function useSavedCopy(copy: SavedCopy | null): void
{
	const kind = copy?.kind;
	const asOf = copy?.asOf;
	useLayoutEffect(() =>
	{
		saved = kind && asOf ? {
			kind,
			asOf,
		} : null;
		window.dispatchEvent(new Event(CHANGED));
		return () =>
		{
			saved = null;
			window.dispatchEvent(new Event(CHANGED));
		};
	}, [kind, asOf]);
}

/**
 * The marker's words for `copy` at `now`: "You're offline." then, with a copy, "Scores as of" or
 * "This game as of", the copy's time in the reader's zone, with its date when it isn't today
 * (`formatMomentSince`), and its age from `fetchedAgo` (ADR-025: the one implementation; this only
 * formats it).
 */
export function offlineMessage(copy: SavedCopy | null, now: Date): string
{
	if (!copy) return "You're offline.";
	const what = copy.kind === "scores" ? "Scores" : "This game";
	return `You're offline. ${what} as of ${formatMomentSince(copy.asOf, now)} — ${fetchedAgo(copy.asOf, now)}.`;
}

/** How often the marker's age is re-read while it shows, so "18m ago" moves on. */
const AGE_TICK_MS = 30 * 1000;

/**
 * The offline marker, or null while online. A message-only notice (`NoticeSlot`: no `update`, so it
 * sits in the slot under the header, never floats, and has no buttons). While it shows, its age is
 * re-read every half minute.
 */
export function useOfflineNotice(): Notice | null
{
	const online = useOnline();
	const copy = useSyncExternalStore(subscribeSaved, () => saved, () => null);
	useAgeTick(!online);
	if (online) return null;
	return {
		id: "offline",
		message: offlineMessage(copy, new Date()),
	};
}

function subscribeSaved(onChange: () => void): () => void
{
	window.addEventListener(CHANGED, onChange);
	return () => window.removeEventListener(CHANGED, onChange);
}

/** Re-renders the caller every `AGE_TICK_MS` while `ticking`, so a time read in its render moves on. */
function useAgeTick(ticking: boolean): void
{
	const [, setTick] = useState(0);
	useEffect(() =>
	{
		if (!ticking) return;
		const timer = setInterval(() => setTick((n) => n + 1), AGE_TICK_MS);
		return () => clearInterval(timer);
	}, [ticking]);
}
