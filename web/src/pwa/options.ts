import type { VitePWAOptions } from "vite-plugin-pwa";
import { API_CACHE } from "../storage/storage.js";

/** The app's own ground (S55: the installed status bar takes it; `#10100F`, VISUAL-DESIGN). */
export const APP_BACKGROUND = "#10100F";

/**
 * The `/api/v1/*` GETs the worker keeps the last answer to (S74), as a whole URL (workbox tests a
 * same-origin route's pattern against `url.href`): every one except `/api/v1/me` and everything
 * under it (the account, its settings and its export carry personal data, ADR-028), which never
 * enter Cache Storage. A literal, because workbox copies the pattern into the generated worker,
 * where nothing from this module exists.
 */
export const RUNTIME_CACHED = /^https?:\/\/[^/]+\/api\/v1\/(?!me(?:[/?#]|$))/;

/** Whether the worker keeps the last answer to a GET of `href` (S74): the test reads the same pattern the worker gets. */
export function isRuntimeCached(href: string): boolean
{
	return RUNTIME_CACHED.test(href);
}

/**
 * The installed app (ADR-023, S73): `vite-plugin-pwa`'s options, kept here so a test can read
 * what `vite.config.ts` builds. The manifest makes it standalone with the flag mark at 192
 * and 512 (`public/icons/`, rendered from `favicon.svg`). The worker registers at scope `/`,
 * so Web Push can attach later without moving it; it precaches the built shell (scripts,
 * styles, the page, icons), and navigations fall back to the page except under `/api/`,
 * whose answers are never precached: BT's data stays fresh and personal data never sits in
 * Cache Storage (ADR-028). It waits rather than taking over (`prompt`), so the app can say
 * an update is ready (S55) and the reader chooses when to reload.
 *
 * Offline reading (S74, ADR-023): at runtime the worker keeps the last answer to each `/api/v1/*`
 * GET but `/api/v1/me` and below ({@link RUNTIME_CACHED}) in `API_CACHE` (`storage/storage.ts`),
 * network first: online, every request goes to BT and its answer replaces the stored one; only a
 * request the network can't answer gets the stored copy. The worker never decides freshness (ADR-014
 * rule 3): no expiry, no timeout, no age limit, and only a 200 is kept, so an error never replaces a
 * readable copy. `sw-prefetch.js` (`public/`) adds the Periodic Background Sync handler (`prefetch.ts`).
 */
export const PWA_OPTIONS: Partial<VitePWAOptions> = {
	registerType: "prompt",
	injectRegister: false,
	scope: "/",
	manifest: {
		name: "Baseball Theater",
		short_name: "Baseball Theater",
		description: "Every game's videos, pitches, plays and box score.",
		display: "standalone",
		start_url: "/",
		scope: "/",
		theme_color: APP_BACKGROUND,
		background_color: APP_BACKGROUND,
		icons: [
			{
				src: "/icons/flag-192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/icons/flag-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any maskable",
			},
		],
	},
	workbox: {
		globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
		navigateFallback: "/index.html",
		navigateFallbackDenylist: [/^\/api\//],
		runtimeCaching: [
			{
				urlPattern: RUNTIME_CACHED,
				method: "GET",
				handler: "NetworkFirst",
				options: {
					cacheName: API_CACHE.name,
					cacheableResponse: {
						statuses: [200],
					},
				},
			},
		],
		importScripts: ["/sw-prefetch.js"],
	},
};
