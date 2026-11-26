import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { buildInputsPlugin } from "../functions/src/deploy/vite-plugin.js";
import { buildInfo } from "./src/layout/version.js";
import { PWA_OPTIONS } from "./src/pwa/options.js";

/** A local build's commit, short form; throws outside a checkout (`buildInfo` then says "unknown"). */
function gitShort(): string
{
	return execSync("git rev-parse --short=7 HEAD", {
		encoding: "utf8",
	}).trim();
}

const BUILD = buildInfo(process.env, gitShort);

/**
 * Where a build leaves the list of modules it read (S146): `pnpm build:inputs record` reads it
 * (`functions/src/deploy/build-inputs.ts`). Under the root `node_modules/`, which git ignores and the
 * deploy never serves, unless `BT_BUILD_INPUTS_VITE` names another file.
 */
const VITE_MODULES_OUT = process.env.BT_BUILD_INPUTS_VITE || resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/.cache/bt-build-inputs/vite.json");

/** Every module id any build in this process read: the app's, and the service worker's separate build. */
const builtModules = new Set<string>();

// The dev server's port and the API it proxies to: today's 5173 and 8787, unless a worktree's
// `.env.worktree` (S156, `scripts/worktree-for.sh`) gives this checkout its own, so two
// checkouts' `pnpm dev` can run at once. The same variables set `functions`' `dev` port and
// Playwright's base URL. Set but empty counts as unset (`||`), never port 0 or a URL with no port.
const WEB_PORT = Number(process.env.BT_WEB_PORT || 5173);
const API_ORIGIN = `http://localhost:${process.env.BT_API_PORT || 8787}`;

export default defineConfig({
	// The installed app (ADR-023, S73): manifest, icons and the service worker, from src/pwa/options.ts.
	// buildInputsPlugin (S146, functions/src/deploy/vite-plugin.ts) lists what the app's build and the
	// service worker's own build (injectManifest) read; both share builtModules, so each writes the union.
	plugins: [react(), VitePWA({
		...PWA_OPTIONS,
		injectManifest: {
			...PWA_OPTIONS.injectManifest,
			plugins: [buildInputsPlugin(VITE_MODULES_OUT, builtModules)],
		},
	}), buildInputsPlugin(VITE_MODULES_OUT, builtModules)],
	// The rail's version line (S60, #47, `src/layout/version.ts`): the release a
	// deploy looked up (its pull request's milestone, `scripts/build-release.sh`)
	// and the commit, the same for the same code on staging and production; any
	// build that looked nothing up says "dev". Nothing is written to package.json.
	define: {
		__BT_RELEASE__: JSON.stringify(BUILD.release),
		__BT_COMMIT__: JSON.stringify(BUILD.commit),
	},
	server: {
		port: WEB_PORT,
		// Bind all interfaces so the dev server is reachable from another device
		// on the LAN (phone, tablet) — Vite's default is loopback only.
		host: true,
		// Vite 403s any request whose Host header isn't allow-listed (DNS-rebinding
		// protection). `.local` permits mDNS hostnames like `jake-macbook-m5.local`
		// without disabling the check outright.
		allowedHosts: [".local"],
		proxy: {
			"/api": {
				target: API_ORIGIN,
				changeOrigin: true,
			},
			"/health": {
				target: API_ORIGIN,
				changeOrigin: true,
			},
		},
	},
});
