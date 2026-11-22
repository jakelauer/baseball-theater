/**
 * The releases resource (S132; read by the change log page, S134): one key, one descriptor and
 * one hook, so the page and anything later that asks for the notes share one cache entry.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { fetchReleases } from "./client.js";
import type { components } from "./generated/bt-api.v1.js";

export type ReleasesPayload = components["schemas"]["ReleasesResponse"];

/** One release's public notes, as the change log page draws it (`PublicReleaseNotes`; no `approval`, #327). */
export type PublicRelease = components["schemas"]["PublicReleaseNotes"];

/** The cache key for every release's notes. Only this module builds it. */
export function releasesKey()
{
	return ["releases"] as const;
}

/**
 * The notes are frozen in the build that serves them (`functions/src/generated/release-notes.json`,
 * S132), but the API's answer may be cached for up to five minutes after a deploy (`max-age=240`
 * plus `stale-while-revalidate=60`). So the answer counts as fresh for exactly that budget and is
 * asked again on the next focus or mount after it: a tab open across a deploy then reads the new
 * notes. Asking again costs little, since the answer is bundled and edge-cached.
 */
export function releasesQueryOptions()
{
	return queryOptions({
		queryKey: releasesKey(),
		queryFn: (): Promise<ReleasesPayload> => fetchReleases(),
		staleTime: 5 * 60 * 1000,
	});
}

/** Every approved release's notes, newest first, and the newest as `current` (S132). */
export function useReleases(): UseQueryResult<ReleasesPayload, Error>
{
	return useQuery(releasesQueryOptions());
}
