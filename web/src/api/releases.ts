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
 * S132), so they change only with a deploy, and a deploy reaches a reader through a fresh load
 * (A6's update notice): one fetch per load is enough, so the answer never goes stale.
 */
export function releasesQueryOptions()
{
	return queryOptions({
		queryKey: releasesKey(),
		queryFn: (): Promise<ReleasesPayload> => fetchReleases(),
		staleTime: Infinity,
	});
}

/** Every approved release's notes, newest first, and the newest as `current` (S132). */
export function useReleases(): UseQueryResult<ReleasesPayload, Error>
{
	return useQuery(releasesQueryOptions());
}
