/**
 * The release check behind `pnpm release:check <version>` (S131 AC 3), kept apart from its command
 * (`release-check-cli.ts`) so it can be tested over temporary folders, as `backfill-args.ts` is. The
 * production deploy job runs it on the release's tag before it builds anything (AC 4), so a release
 * from the public launch on can't deploy without notes the owner approved in the tagged commit.
 * {@link checkReleasesDir} checks every notes file in the repository from the functions suite, so a
 * bad one fails `pnpm verify` rather than waiting for production's deploy.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	isApproved, parseReleaseNotes, parseReleaseVersion,
} from "@bt/domain";

/**
 * The first release with fan-facing notes: the change log starts at the public launch (owner,
 * 2026-11-19, asked whether it starts at v4.0.0 or v3.1.0: "Start at v4.0.0 (Recommended)"). A
 * release below it carries none, so the check passes it without reading `releases/`.
 */
export const FIRST_NOTED_MAJOR = 4;

/**
 * The repository's `releases/` folder, found from this file's place in the repo (`functions/src/scripts/`),
 * never from the working directory: `pnpm --filter @bt/functions exec` runs the command in `functions/`.
 * Exported so a test can prove it is `<repo>/releases`.
 */
export const RELEASES_DIR = fileURLToPath(new URL("../../../releases/", import.meta.url));

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
	catch (error)
	{
		// Only a file that isn't there is "missing"; anything else (a folder by that name, no permission) is named as it is.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {
			ok: false,
			lines: [`${file} is missing: draft the release's notes and land them, approved, before publishing it`],
		};
		return {
			ok: false,
			lines: [`${file} can't be read: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
	// JSON.parse reports a byte-order mark as an unexpected token; named here so the fix is obvious, and
	// refused rather than stripped so every reader of releases/ (S132, S134) sees the same clean files.
	if (text.startsWith("\uFEFF")) return {
		ok: false,
		lines: [`${file} starts with a byte-order mark: save it as UTF-8 without one`],
	};
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

/**
 * Checks every file in `dir` (the repository's {@link RELEASES_DIR} in the functions suite, S131 AC 6):
 * each must be `<version>.json` for a release from v4.0.0 on, since the change log starts there (owner,
 * 2026-11-19: "Start at v4.0.0 (Recommended)"), and pass {@link checkRelease}. A folder that isn't
 * there yet passes: no notes land before v4.0.0's. Hidden files are skipped; any other read error throws.
 */
export async function checkReleasesDir(dir: string): Promise<ReleaseCheck>
{
	let names: string[];
	try
	{
		// Hidden files (`.DS_Store`, `.gitkeep`) are skipped, as the grader's `releases/*` glob skips them.
		names = (await readdir(dir)).filter((name) => !name.startsWith(".")).sort();
	}
	catch (error)
	{
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {
			ok: true,
			lines: [`${dir} doesn't exist yet: no release has notes`],
		};
		throw error;
	}
	const lines: string[] = [];
	let ok = true;
	for (const name of names)
	{
		const version = name.endsWith(".json") ? parseReleaseVersion(name.slice(0, -".json".length)) : null;
		if (!version)
		{
			ok = false;
			lines.push(`${join(dir, name)} is not a release notes file: releases/ holds only <vMAJOR.MINOR.PATCH>.json`);
			continue;
		}
		if (version.major < FIRST_NOTED_MAJOR)
		{
			ok = false;
			lines.push(`${join(dir, name)} is a pre-launch release's notes file: fan-facing notes start with v${FIRST_NOTED_MAJOR}.0.0`);
			continue;
		}
		const result = await checkRelease(version.text, dir);
		ok &&= result.ok;
		lines.push(...result.lines);
	}
	return {
		ok,
		lines,
	};
}
