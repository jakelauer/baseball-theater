/**
 * `pnpm release:bundle` (S132 AC 3): rewrites `functions/src/generated/release-notes.json` from
 * `releases/*.json`, so a release's notes pull request carries the bundle the Worker serves. Exits
 * nonzero, naming every problem, when a notes file doesn't parse or isn't named for its own version.
 */
import { writeReleaseBundle } from "./release-bundle.js";

try
{
	const file = await writeReleaseBundle();
	console.log(`[release:bundle] wrote ${file}`);
}
catch (error)
{
	console.error(`[release:bundle] ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
