/**
 * The one "was this file started as a command, or imported?" check for the backlog scripts that
 * guarded their command line by comparing paths (S166, issue #299): claims, github, search,
 * text-records, in-flight, areas, triage, migrate and runs. changelog.ts and design-reference.ts use
 * `import.meta.main`, which already resolves symlinks, and cli.ts always runs. Node gives
 * `import.meta.url` the file's real path but leaves `process.argv[1]` as typed, so a script started
 * through a symlink (on macOS every temp path is one: `/var` and `/tmp` link into `/private`) never
 * matched the old `resolve(argv[1]) === fileURLToPath(url)` comparison, never ran its `main`, and
 * exited 0 having done nothing.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `moduleUrl` (its `import.meta.url`) is the file Node was started with
 * (`argv1`, `process.argv[1]` by default). Compares both paths with every symlink resolved; when
 * either can't be resolved (it doesn't exist) it falls back to the plain comparison, which then
 * answers false rather than throwing. A missing or empty `argv1` (a REPL, `node -e`) is never a run.
 */
export function isRunDirectly(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean
{
	if (!argv1)
	{
		return false;
	}
	const file = fileURLToPath(moduleUrl);
	try
	{
		return realpathSync(argv1) === realpathSync(file);
	}
	catch
	{
		return resolve(argv1) === file;
	}
}
