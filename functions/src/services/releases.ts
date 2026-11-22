import type {
	PublicReleaseNotes, ReleaseNotes, ReleasesResponse,
} from "@bt/domain";
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
 * Neither carries `approval` (#327): `toPublicRelease` drops it from every entry.
 */
export function getReleases(all: readonly ReleaseNotes[]): ReleasesResponse
{
	const current = currentRelease(all);
	return {
		current: current === null ? null : toPublicRelease(current),
		releases: approvedReleasesNewestFirst(all).map(toPublicRelease),
	};
}

/**
 * The one place the releases API drops `approval` (#327): the owner's quoted approval words stay in
 * `releases/<version>.json` for `pnpm release:check` and the deploy, and are never published.
 */
function toPublicRelease(notes: ReleaseNotes): PublicReleaseNotes
{
	const { approval: _approval, ...published } = notes;
	return published;
}
