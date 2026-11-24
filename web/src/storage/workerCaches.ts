/**
 * The service worker's Cache Storage, owned here (S74; law L1, ADR-028): the worker
 * (`pwa/sw.ts`) never touches `caches` itself. It installs the shell's precache and gets its
 * `/api/v1/*` strategy from this module, so every cache it keeps is labeled in `storage.ts`
 * (`SHELL_CACHE`, `API_CACHE`) and the personal one is deleted on sign-out (`clearPersonalData`).
 * Only the worker imports this module: Workbox's runtime stays out of the page's bundle.
 */
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import type { PrecacheEntry } from "workbox-precaching";
import {
	cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute,
} from "workbox-precaching";
import { NetworkFirst } from "workbox-strategies";
import { STORED_COPY_HEADER } from "../api/freshness.js";
import { API_CACHE } from "./storage.js";

/** A Workbox strategy plugin, as `NetworkFirst` takes it (`workbox-core`'s type, read through the strategy so web needs no `workbox-core` dependency). */
type WorkboxPlugin = NonNullable<NonNullable<ConstructorParameters<typeof NetworkFirst>[0]>["plugins"]>[number];

/**
 * Keys every stored answer by its URL alone (S74, ADR-028). Workbox would otherwise keep the page's
 * own `Request`, and Cache Storage keeps a request's headers with it: the session's
 * `Authorization: Bearer …` (`api/client.ts`) would sit in the cache, past sign-out, for as long as
 * the token lasts. A string key becomes a header-less `Request`, for writes and matches alike, so
 * a signed-in and a signed-out read of the same URL share one entry, as the answers are the same.
 */
export const urlOnlyKey: WorkboxPlugin = {
	cacheKeyWillBeUsed: async ({ request }) => request.url,
};

/**
 * Marks an answer served from the cache rather than the network (S74) with `STORED_COPY_HEADER`,
 * so the page can tell a stored copy from a fresh one and date it by its `Date` and `Age` headers
 * (`storedCopyTime`): a fresh answer is dated by when the page got it. The stored entry itself is
 * left as it is.
 */
export const markStoredCopy: WorkboxPlugin = {
	cachedResponseWillBeUsed: async ({ cachedResponse }) =>
	{
		if (!cachedResponse) return cachedResponse;
		const headers = new Headers(cachedResponse.headers);
		headers.set(STORED_COPY_HEADER, "1");
		return new Response(cachedResponse.body, {
			status: cachedResponse.status,
			statusText: cachedResponse.statusText,
			headers,
		});
	},
};

/** Bumped each time sign-out reaches the worker (`forgetPersonalCopies`): an answer asked for before it is never stored. */
let signOuts = 0;

/**
 * Stores an answer only if no sign-out reached the worker while it was being fetched (S74, ADR-028):
 * the page deletes the cache at sign-out, and an answer landing after would re-create it holding,
 * say, a search the signed-out reader made. Workbox keeps `state` per plugin per request.
 */
export const noStoreAcrossSignOut: WorkboxPlugin = {
	requestWillFetch: async ({ request, state }) =>
	{
		if (state) state.signOuts = signOuts;
		return request;
	},
	cacheWillUpdate: async ({ response, state }) => (state?.signOuts === signOuts ? response : null),
};

/**
 * Forgets every personal copy the worker keeps (S74, on sign-out's `CLEAR_PERSONAL_MESSAGE`):
 * answers still on their way stop being stored ({@link noStoreAcrossSignOut}), then the personal
 * cache is deleted, so nothing that landed between the page's own delete and this message stays.
 */
export async function forgetPersonalCopies(): Promise<void>
{
	signOuts += 1;
	await caches.delete(API_CACHE.name);
}

/**
 * The worker's strategy for the `/api/v1/*` GETs it keeps (S74, ADR-023): network first, so online
 * every request goes to BT and a 200 replaces the stored copy; only a request the network can't
 * answer gets the stored copy. It decides nothing about freshness (ADR-014 rule 3): no expiry, no
 * timeout, no age limit, and only a 200 is kept, so an error never replaces a readable copy. One
 * instance serves both the routed requests and the background prefetch (`sw.ts`).
 */
export function apiStrategy(): NetworkFirst
{
	return new NetworkFirst({
		cacheName: API_CACHE.name,
		plugins: [
			new CacheableResponsePlugin({
				statuses: [200],
			}),
			noStoreAcrossSignOut,
			urlOnlyKey,
			markStoredCopy,
		],
	});
}

/**
 * Installs the built app's precache (S73: `manifest` is the build's list, injected as
 * `self.__WB_MANIFEST`) and drops precaches an older Workbox left, then answers navigations with
 * the precached page, as the generated worker did before S74. Answers the handler for `/index.html`.
 */
export function precacheShell(manifest: (string | PrecacheEntry)[]): ReturnType<typeof createHandlerBoundToURL>
{
	precacheAndRoute(manifest);
	cleanupOutdatedCaches();
	return createHandlerBoundToURL("/index.html");
}
