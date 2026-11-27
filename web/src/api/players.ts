/**
 * Players' stats-site pages (S209): one cache entry per player, so every name link to the same player shares it and
 * a growing roster (the Live room's plays) never moves a link to a new key. Asked only for a site whose own id BT
 * must look up (FanGraphs, Baseball-Reference); MLB.com and Savant need only the MLB id the name already has.
 *
 * Names shown together pass their `roster`, and the first of them to ask fetches every roster player with no fresh
 * entry and no request in flight in one request (`loadPlayerPages`), filling each asked player's entry from the answer, so
 * a box score asks once and the Live room asks only about a player new to the game.
 */
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PLAYER_PROFILES_MAX_IDS } from "@bt/domain";
import { fetchPlayerProfiles } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type PlayerPages = components["schemas"]["PlayerPages"];

/** The cache key for one player's pages (null: BT has no row for them). Only this module builds it. */
export function playerPagesKey(personId: number)
{
	return ["player-pages", personId] as const;
}

/**
 * The route answers for a day (the ids are synced from the register at most daily), so an entry counts as fresh for
 * an hour: long enough that a game's names ask once, short enough that a day's change reaches an open tab.
 */
const FRESH_MS = 60 * 60 * 1000;

/**
 * The request each player's pages are on their way in, per query client (the app has one; each test its own), so
 * names asking together share it and a request one client still waits on never holds up another's.
 */
const inFlightByClient = new WeakMap<QueryClient, Map<number, Promise<Map<number, PlayerPages>>>>();

function inFlightOf(client: QueryClient): Map<number, Promise<Map<number, PlayerPages>>>
{
	let inFlight = inFlightByClient.get(client);
	if (!inFlight)
	{
		inFlight = new Map();
		inFlightByClient.set(client, inFlight);
	}
	return inFlight;
}

/**
 * The ids one request asks about for `personId`: the player, then the roster's players with no fresh entry and no
 * request in flight, at most `PLAYER_PROFILES_MAX_IDS`, sorted (so names asking alike share the edge's copy). An entry
 * past `FRESH_MS` (or invalidated) is asked again with the rest, by TanStack's own staleness rule (`isStaleByTime`, the
 * one `staleTime` applies), so when a refocused tab refetches a box score's stale names the first asks for them all
 * and the others wait on its request, rather than each asking alone.
 */
export function idsToAsk(client: QueryClient, personId: number, roster: readonly number[]): number[]
{
	const inFlight = inFlightOf(client);
	const ids = new Set([personId]);
	for (const id of roster)
	{
		if (ids.size >= PLAYER_PROFILES_MAX_IDS) break;
		if (inFlight.has(id) || client.getQueryCache().find({
			queryKey: playerPagesKey(id),
		})?.isStaleByTime(FRESH_MS) === false) continue;
		ids.add(id);
	}
	return [...ids].sort((a, b) => a - b);
}

/**
 * One player's pages, or null when BT has no row for them: awaited from a request already asking about them, else
 * fetched with the rest of `roster` that nothing holds yet ({@link idsToAsk}), every other asked player's entry
 * filled from the same answer. A failed request rejects for every name that waited on it, so none caches "no row".
 */
export async function loadPlayerPages(client: QueryClient, personId: number, roster: readonly number[]): Promise<PlayerPages | null>
{
	const inFlight = inFlightOf(client);
	const waiting = inFlight.get(personId);
	if (waiting) return (await waiting).get(personId) ?? null;
	const ids = idsToAsk(client, personId, roster);
	const request = fetchPlayerProfiles(ids).then((answer) => new Map(answer.players.map((pages) => [pages.ids.mlbam, pages])));
	for (const id of ids) inFlight.set(id, request);
	try
	{
		const found = await request;
		for (const id of ids) if (id !== personId) client.setQueryData(playerPagesKey(id), found.get(id) ?? null);
		return found.get(personId) ?? null;
	}
	finally
	{
		for (const id of ids) if (inFlight.get(id) === request) inFlight.delete(id);
	}
}

/** One player's pages and ids, or null when BT has no row for them; not asked while `enabled` is false. */
export function usePlayerPages(personId: number, roster: readonly number[], enabled: boolean): UseQueryResult<PlayerPages | null, Error>
{
	const client = useQueryClient();
	return useQuery({
		queryKey: playerPagesKey(personId),
		queryFn: () => loadPlayerPages(client, personId, roster),
		staleTime: FRESH_MS,
		retry: false,
		enabled,
	});
}
