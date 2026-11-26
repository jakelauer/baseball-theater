/**
 * S146: the Vite plugin that lists what a web build read (`vite-plugin.ts`), driven with a stand-in
 * for Vite's plugin context, and its two placements in `web/vite.config.ts` (the app's build and the
 * service worker's `injectManifest` build). Without both, a change to a file only one build reads
 * would never reach the record, and `check` would skip a deploy that changes what staging serves.
 */
import {
	mkdtempSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	describe, expect, it,
} from "vitest";
import { buildInputsPlugin } from "./vite-plugin.js";

const VITE_CONFIG = readFileSync(new URL("../../../web/vite.config.ts", import.meta.url), "utf8");

describe("the bt-build-inputs Vite plugin (S146 AC 1)", () =>
{
	it("S146 AC 1: the Vite plugin runs only in builds and writes the union of every build's module ids, making its folder", () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "vite-plugin-"));
		const out = join(dir, "cache", "bt-build-inputs", "vite.json");
		const modules = new Set<string>();
		const app = buildInputsPlugin(out, modules);
		const sw = buildInputsPlugin(out, modules);
		expect(app).toMatchObject({
			name: "bt-build-inputs",
			apply: "build",
		});
		app.buildEnd.call({
			getModuleIds: () => ["/repo/web/src/main.tsx", "\0vite/preload-helper.js"].values(),
		});
		app.closeBundle();
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(["\0vite/preload-helper.js", "/repo/web/src/main.tsx"]);
		sw.buildEnd.call({
			getModuleIds: () => ["/repo/web/src/pwa/sw.ts", "/repo/web/src/main.tsx"].values(),
		});
		sw.closeBundle();
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(["\0vite/preload-helper.js", "/repo/web/src/main.tsx", "/repo/web/src/pwa/sw.ts"]);
		rmSync(dir, {
			recursive: true,
			force: true,
		});
	});

	it("S146 AC 1: web/vite.config.ts puts the plugin in both builds, the app's and the service worker's", () =>
	{
		expect(VITE_CONFIG).toMatch(/^import \{ buildInputsPlugin \} from "\.\.\/functions\/src\/deploy\/vite-plugin\.js";$/m);
		expect(VITE_CONFIG.match(/buildInputsPlugin\(/g)).toHaveLength(2);
		// One inside the service worker's own build (injectManifest), one in the app's plugins, after VitePWA.
		const placed = new RegExp([
			String.raw`\n\tplugins: \[react\(\), VitePWA\(\{\n`,
			String.raw`(?:\t\t.*\n)*?\t\tinjectManifest: \{\n`,
			String.raw`(?:\t\t\t.*\n)*?\t\t\tplugins: \[buildInputsPlugin\(VITE_MODULES_OUT, builtModules\)\],\n`,
			String.raw`\t\t\},\n\t\}\), buildInputsPlugin\(VITE_MODULES_OUT, builtModules\)\],\n`,
		].join(""));
		expect(VITE_CONFIG).toMatch(placed);
		// Neither placement is narrowed to the dev server.
		expect(VITE_CONFIG).not.toMatch(/apply:/);
	});
});
