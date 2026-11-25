import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isFavoriteGame } from "@bt/domain";
import { BACKGROUND_PREFETCH_MS } from "../api/freshness.js";
import { gameQueryOptions } from "../api/game.js";
import { scheduleKey, scheduleQueryOptions } from "../api/schedule.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { useScoreboardDefaultDate } from "../api/scoreboardDate.js";
import { useSession } from "../session/session.js";
import { useSettings } from "../settings/store.js";

/**
 * Today's schedule, and for a signed-in fan their favorite teams' games on it, asked for ahead of
 * time (S74, ADR-023), so they are already in the worker's API cache (`pwa/options.ts`) when the
 * signal goes. `today` is the scoreboard's default day (S111). Through the resources' own query
 * descriptors, so a prefetch fills the same TanStack cache the pages read and asks nothing a fresh
 * copy already answers. Favorites exist only for signed-in fans (ADR-027): signed out, or with no
 * favorites, only the schedule is asked for. A favorite's game is the domain's `isFavoriteGame` (S213), the
 * scoreboard's own rule. A failed request is left alone: the page asks again
 * when it opens.
 */
export async function prefetchOnOpen(client: QueryClient, today: string, favoriteTeamIds: readonly number[] | null): Promise<void>
{
	await client.prefetchQuery(scheduleQueryOptions(today));
	if (!favoriteTeamIds?.length) return;
	const day = client.getQueryData<ScheduleDayPayload>(scheduleKey(today));
	const games = (day?.games ?? []).filter((game) => isFavoriteGame(game, favoriteTeamIds));
	await Promise.all(games.map((game) => client.prefetchQuery(gameQueryOptions(game.gamePk))));
}

/**
 * Runs {@link prefetchOnOpen} when the app opens, once the session and the default day are known,
 * again when a signed-in fan's favorites arrive or change, and on every wake: the tab shown again
 * after being hidden (an installed app brought back from the background). Mounted once, in `App`.
 */
export function usePrefetchOnOpen(): void
{
	const client = useQueryClient();
	const today = useScoreboardDefaultDate();
	const session = useSession();
	const { favoriteTeamIds } = useSettings();
	const known = session.status !== "loading" && today !== undefined;
	const favorites = session.status === "signedIn" ? favoriteTeamIds : null;
	// A primitive dependency, so a new settings object with the same favorites doesn't ask again.
	const favoritesKey = favorites?.join(",") ?? "";
	useEffect(() =>
	{
		if (!known || !today) return;
		const teams = favoritesKey ? favoritesKey.split(",").map(Number) : null;
		const run = () => void prefetchOnOpen(client, today, teams);
		run();
		const onVisible = () =>
		{
			if (document.visibilityState === "visible") run();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [client, known, today, favoritesKey]);
}

/** The tag the worker's handler answers (`sw.ts`). */
export const PREFETCH_TAG = "bt-prefetch";

/** What `registration.periodicSync` offers where a browser has it (Chromium's installed apps); absent from TypeScript's DOM types. */
interface PeriodicSyncManager
{
	register(tag: string, options: { minInterval: number }): Promise<void>;
}

/**
 * Asks for Periodic Background Sync where the browser offers it (S74, ADR-023): a feature check on
 * the registration, never a browser sniff. Where `periodicSync` is missing (Firefox, Safari, a tab
 * not installed) it does nothing and answers false; where registering is refused (no permission,
 * low engagement) it answers false too and the app still prefetches on open. The worker's handler
 * then refreshes today's schedule in the background (`sw.ts`).
 */
export async function registerPeriodicSync(registration: ServiceWorkerRegistration): Promise<boolean>
{
	const periodicSync = (registration as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }).periodicSync;
	if (!periodicSync) return false;
	try
	{
		await periodicSync.register(PREFETCH_TAG, {
			minInterval: BACKGROUND_PREFETCH_MS,
		});
		return true;
	}
	catch
	{
		return false;
	}
}
