/**
 * `pnpm release:check <version>` (S131 AC 3): prints what `checkRelease` found and exits 0 only when
 * the release may deploy. `pnpm --filter @bt/functions exec` runs it in `functions/`, so `releases/`
 * is found from this file's place in the repo, never from the working directory.
 */
import { fileURLToPath } from "node:url";
import { checkRelease } from "./release-check.js";

const releasesDir = fileURLToPath(new URL("../../../releases/", import.meta.url));
const [tag, ...rest] = process.argv.slice(2);
if (tag === undefined || rest.length > 0)
{
	console.error("[release:check] usage: pnpm release:check <vMAJOR.MINOR.PATCH>");
	process.exit(2);
}
const result = await checkRelease(tag, releasesDir);
for (const line of result.lines) (result.ok ? console.log : console.error)(`[release:check] ${line}`);
process.exit(result.ok ? 0 : 1);
