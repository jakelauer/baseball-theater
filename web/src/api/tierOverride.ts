/**
 * Staging's backer tier override (S215) as a resource (ADR-014): one descriptor, one query hook,
 * one write. For testing only: the server offers it only where its deploy-time config allows
 * (staging), answering 404 everywhere else, production included, so production refuses it on the
 * server rather than the page hiding it. The read is keyed under `ACCOUNT_QUERY_KEY`, so signing
 * out drops it with the rest of the account's data. Choosing a tier never changes the real tier
 * or touches Patreon.
 */
import type { PatronTier } from "@bt/domain";
import {
	queryOptions, useMutation, useQuery, useQueryClient,
} from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { ACCOUNT_QUERY_KEY, useSession } from "../session/session.js";
import { getSessionToken } from "../session/token.js";
import { fetchTierOverride, saveTierOverride } from "./client.js";

export type TierOverride = Awaited<ReturnType<typeof fetchTierOverride>>;

const tierOverrideQuery = queryOptions({
	queryKey: [...ACCOUNT_QUERY_KEY, "tier-override"] as const,
	queryFn: (): Promise<TierOverride> => fetchTierOverride(),
	// A 404 is an answer (null), not a failure; a failed request shows nothing, so there is nothing to retry for.
	retry: false,
});

/** The chosen tier and the real one, or null where the server doesn't offer the override (404). */
export function useTierOverride(): UseQueryResult<TierOverride, Error>
{
	return useQuery(tierOverrideQuery);
}

/**
 * Chooses the tier to test as (null: the real tier). The answer's new session token goes through
 * the session's keep path, which reloads `/api/v1/me` and the account's data, so every check that
 * reads `account.entitlements` sees the chosen tier at once.
 */
export function useSetTierOverride(): UseMutationResult<void, Error, PatronTier | null>
{
	const client = useQueryClient();
	const session = useSession();
	return useMutation({
		mutationFn: async (tier: PatronTier | null) =>
		{
			const { token, ...answer } = await saveTierOverride(tier);
			client.setQueryData(tierOverrideQuery.queryKey, answer);
			await session.keepSession(token);
		},
		// The server may have saved the choice before the request failed: keep the session there is, which reloads
		// `/api/v1/me` (its entitlements read the stored choice) and asks for the choice again, so both match the server.
		onError: async () =>
		{
			const token = getSessionToken();
			if (token) await session.keepSession(token);
		},
	});
}
