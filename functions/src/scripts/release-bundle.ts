/**
 * The release-notes bundle behind `pnpm release:bundle` (S132 AC 3): every `releases/<version>.json`,
 * parsed once with S131's `parseReleaseNotes`, written as one JSON file under `functions/src/generated/`
 * that the releases API imports. The Worker has no file system, so the notes must be in the build; a
 * drift test (`release-bundle.test.ts`) fails `pnpm verify` when the committed bundle is stale against
 * `releases/`, as `web/src/api/codegen.test.ts` does for the generated client. Kept apart from its
 * command (`release-bundle-cli.ts`) so it can be tested over temporary folders, as `release-check.ts` is.
 */
import {
	mkdir, readdir, readFile, writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseNotes } from "@bt/domain";
import {
	compareReleaseVersions, parseReleaseNotes, parseReleaseVersion,
} from "@bt/domain";
import { format, resolveConfig } from "prettier";
import { RELEASES_DIR } from "./release-check.js";

/** The committed bundle the releases API imports (`services/releases.ts`). */
export const RELEASE_BUNDLE_FILE = fileURLToPath(new URL("../generated/release-notes.json", import.meta.url));

/**
 * Reads and parses every notes file in `dir`, newest version first. Refuses, naming every problem at
 * once, a file whose name isn't `<vMAJOR.MINOR.PATCH>.json`, that starts with a byte-order mark, isn't
 * JSON, doesn't parse as notes, or whose `version` isn't the one its name gives (so two files can't
 * claim one release). Drafts are kept: the API leaves them out (`approvedReleasesNewestFirst`), and
 * `checkReleasesDir` already fails `pnpm verify` on one. A folder that isn't there yet holds no notes.
 * Hidden files are skipped, as `checkReleasesDir` skips them.
 */
export async function readReleaseNotesDir(dir: string): Promise<ReleaseNotes[]>
{
	let names: string[];
	try
	{
		names = (await readdir(dir)).filter((name) => !name.startsWith(".")).sort();
	}
	catch (error)
	{
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const problems: string[] = [];
	const all: ReleaseNotes[] = [];
	for (const name of names)
	{
		const file = join(dir, name);
		const version = name.endsWith(".json") ? parseReleaseVersion(name.slice(0, -".json".length)) : null;
		if (!version)
		{
			problems.push(`${file} is not a release notes file: releases/ holds only <vMAJOR.MINOR.PATCH>.json`);
			continue;
		}
		const text = await readFile(file, "utf8");
		if (text.startsWith("\uFEFF"))
		{
			problems.push(`${file} starts with a byte-order mark: save it as UTF-8 without one`);
			continue;
		}
		let json: unknown;
		try
		{
			json = JSON.parse(text);
		}
		catch (error)
		{
			problems.push(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const parsed = parseReleaseNotes(json);
		if (!parsed.ok)
		{
			problems.push(...parsed.problems.map((p) => `${file}: ${p.field} ${p.problem}`));
			continue;
		}
		if (parsed.notes.version !== version.text)
		{
			problems.push(`${file}: version is ${parsed.notes.version}, not ${version.text}, the version its name gives`);
			continue;
		}
		all.push(parsed.notes);
	}
	if (problems.length > 0) throw new Error(`release notes can't be bundled:\n${problems.join("\n")}`);
	return all.sort((a, b) => compareReleaseVersions(b.version, a.version));
}

/**
 * The bundle's text for `dir`'s notes, formatted with the repo's Prettier config: the pre-commit hook
 * runs Prettier on JSON, so any other formatting would be rewritten on commit and fail the drift test.
 */
export async function renderReleaseBundle(dir: string = RELEASES_DIR): Promise<string>
{
	return format(JSON.stringify(await readReleaseNotesDir(dir)), {
		...await resolveConfig(RELEASE_BUNDLE_FILE),
		parser: "json",
	});
}

/** Renders `dir`'s notes and writes them to `file` (the committed bundle unless a test says otherwise); returns the path. */
export async function writeReleaseBundle(dir: string = RELEASES_DIR, file: string = RELEASE_BUNDLE_FILE): Promise<string>
{
	const text = await renderReleaseBundle(dir);
	await mkdir(dirname(file), {
		recursive: true,
	});
	await writeFile(file, text);
	return file;
}
