import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
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

// The dev server's port and the API it proxies to: today's 5173 and 8787, unless a worktree's
// `.env.worktree` (S156, `scripts/worktree-for.sh`) gives this checkout its own, so two
// checkouts' `pnpm dev` can run at once. The same variables set `functions`' `dev` port and
// Playwright's base URL. Set but empty counts as unset (`||`), never port 0 or a URL with no port.
const WEB_PORT = Number(process.env.BT_WEB_PORT || 5173);
const API_ORIGIN = `http://localhost:${process.env.BT_API_PORT || 8787}`;

export default defineConfig({
	// The installed app (ADR-023, S73): manifest, icons and the service worker, from src/pwa/options.ts.
	plugins: [react(), VitePWA(PWA_OPTIONS)],
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
