import type { ReleaseNotes, ReleasesResponse } from "@bt/domain";
import { approvedReleasesNewestFirst, currentRelease } from "@bt/domain";
import bundle from "../generated/release-notes.json" with { type: "json" };

/**
 * Every release's notes this build carries (S132 AC 3): `releases/*.json` as `pnpm release:bundle`
 * parsed them with S131's parser, imported into the build so the Worker, which has no file system,
 * serves them and nothing is read at request time. The cast is safe because only the bundler writes
 * the file, from parsed notes, and its drift test fails `pnpm verify` when it is stale.
 */
export const BUNDLED_RELEASE_NOTES = bundle as unknown as readonly ReleaseNotes[];

/**
 * The releases API's answer (S132 AC 1) over `all` notes: `current` is the newest approved release
 * (`currentRelease`, S131), `releases` every approved one, newest first. Drafts never appear, even
 * one newer than every approved release; with none approved, `current` is null and `releases` empty.
 */
export function getReleases(all: readonly ReleaseNotes[]): ReleasesResponse
{
	return {
		current: currentRelease(all),
		releases: approvedReleasesNewestFirst(all),
	};
}
