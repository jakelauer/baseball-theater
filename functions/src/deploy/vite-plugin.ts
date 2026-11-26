/**
 * S146: the Vite plugin that writes the module ids Vite's own graph reports for a build
 * (`getModuleIds`), never a hand list of folders, so the deploy can tell whether a later commit
 * changes anything the site is built from (`pnpm build:inputs record`, `build-inputs.ts`). Ids are
 * written as Vite gives them (absolute paths, queries, `\0` and `virtual:` ids); the recorder
 * normalizes them and leaves out what git holds no blob for.
 *
 * `web/vite.config.ts` places it twice, in the app's build and in the service worker's separate
 * `injectManifest` build, both sharing one `modules` set, so each build rewrites the union of what
 * every build in the process read. It lives here, beside the recorder, so its test runs with the
 * deploy's tests; it imports only `node:` modules and describes the hooks it uses itself, so the
 * functions package needs no `vite`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The part of Vite's (Rollup's) plugin context the plugin reads. */
export interface ModuleGraphContext
{
	getModuleIds(): IterableIterator<string>;
}

/** The plugin, as Vite takes it: build only (the dev server serves, it never deploys). */
export interface BuildInputsPlugin
{
	name: "bt-build-inputs";
	apply: "build";
	buildEnd(this: ModuleGraphContext): void;
	closeBundle(): void;
}

/** A `bt-build-inputs` plugin writing the sorted union of `modules` to `out` (its folder made) when each build ends. */
export function buildInputsPlugin(out: string, modules: Set<string>): BuildInputsPlugin
{
	return {
		name: "bt-build-inputs",
		apply: "build",
		buildEnd()
		{
			for (const id of this.getModuleIds()) modules.add(id);
		},
		closeBundle()
		{
			mkdirSync(dirname(out), {
				recursive: true,
			});
			writeFileSync(out, `${JSON.stringify([...modules].sort(), null, "\t")}\n`);
		},
	};
}
