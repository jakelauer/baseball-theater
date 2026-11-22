/**
 * The release check behind `pnpm release:check <version>` (S131 AC 3), kept apart from its command
 * (`release-check-cli.ts`) so it can be tested over temporary folders, as `backfill-args.ts` is. The
 * production deploy job runs it on the release's tag before it builds anything (AC 4), so a release
 * from the public launch on can't publish without notes the owner approved in the tagged commit.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	isApproved, parseReleaseNotes, parseReleaseVersion,
} from "@bt/domain";

/**
 * The first release with fan-facing notes: the change log starts at the public launch (owner,
 * 2026-11-19, asked whether it starts at v4.0.0 or v3.1.0: "Start at v4.0.0 (Recommended)"). A
 * release below it carries none, so the check passes it without reading `releases/`.
 */
export const FIRST_NOTED_MAJOR = 4;

/** The check's verdict: whether the release may deploy, and the lines to print (each problem, or why it passed). */
export interface ReleaseCheck
{
	ok: boolean;
	lines: string[];
}

/**
 * Checks `tag` against `releasesDir`: the tag must be a release version (`parseReleaseVersion`); a
 * pre-launch version (below v4.0.0) then passes untouched; from v4.0.0 on, `<tag>.json` must exist,
 * parse (`parseReleaseNotes`), be approved (`isApproved`: a real date and a non-empty quote) and name
 * its own version. Every problem found is listed, not just the first.
 */
export async function checkRelease(tag: string, releasesDir: string): Promise<ReleaseCheck>
{
	const version = parseReleaseVersion(tag);
	if (!version) return {
		ok: false,
		lines: [`"${tag}" is not a release version: it must be vMAJOR.MINOR.PATCH, each part a number with no leading zero`],
	};
	if (version.major < FIRST_NOTED_MAJOR)
	{
		return {
			ok: true,
			lines: [`${tag} is a pre-launch release: fan-facing notes start with v${FIRST_NOTED_MAJOR}.0.0, so it carries none`],
		};
	}

	const file = join(releasesDir, `${tag}.json`);
	let text: string;
	try
	{
		text = await readFile(file, "utf8");
	}
	catch
	{
		return {
			ok: false,
			lines: [`${file} is missing: draft the release's notes and land them, approved, before publishing it`],
		};
	}
	let json: unknown;
	try
	{
		json = JSON.parse(text);
	}
	catch (error)
	{
		return {
			ok: false,
			lines: [`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`],
		};
	}

	const parsed = parseReleaseNotes(json);
	if (!parsed.ok) return {
		ok: false,
		lines: parsed.problems.map((p) => `${file}: ${p.field} ${p.problem}`),
	};
	const lines: string[] = [];
	if (parsed.notes.version !== tag) lines.push(`${file}: version is ${parsed.notes.version}, not ${tag}, the version its name gives`);
	if (!isApproved(parsed.notes)) lines.push(`${file}: is a draft: it needs the owner's in-session approval, dated and quoted, in approval`);
	if (lines.length > 0) return {
		ok: false,
		lines,
	};
	return {
		ok: true,
		lines: [`${tag}: notes approved ${parsed.notes.approval!.date}: "${parsed.notes.approval!.quote}"`],
	};
}
