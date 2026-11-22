/**
 * `pnpm release:check <version>` (S131 AC 3): prints what `checkRelease` found and exits 0 only when
 * the release may deploy. `pnpm --filter @bt/functions exec` runs it in `functions/`, so it reads
 * `RELEASES_DIR`, found from the module's place in the repo, never from the working directory.
 */
import { checkRelease, RELEASES_DIR } from "./release-check.js";

const [tag, ...rest] = process.argv.slice(2);
if (tag === undefined || rest.length > 0)
{
	console.error("[release:check] usage: pnpm release:check <vMAJOR.MINOR.PATCH>");
	process.exit(2);
}
const result = await checkRelease(tag, RELEASES_DIR);
for (const line of result.lines) (result.ok ? console.log : console.error)(`[release:check] ${line}`);
process.exit(result.ok ? 0 : 1);
