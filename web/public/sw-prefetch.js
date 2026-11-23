/* global self, caches, fetch, Request, URL */
/**
 * The service worker's Periodic Background Sync handler (S74, ADR-023), loaded into the generated
 * worker by `importScripts` (`src/pwa/options.ts`). When the browser wakes the installed app in the
 * background (`registerPeriodicSync` in `src/pwa/prefetch.ts` asked for the `bt-prefetch` tag), it
 * asks BT for the scoreboard's default day (S111, "today") and that day's schedule, and stores both
 * answers in the API runtime cache, so today's scoreboard opens offline. The worker can't read the
 * session (it is in `localStorage`), so it never asks for a favorite's game: the page does that on
 * open (`prefetchOnOpen`). It stores the answer it was given and decides nothing about freshness
 * (ADR-014 rule 3); a failed request stores nothing and leaves the last copy.
 *
 * `API_CACHE_NAME` must equal `API_CACHE.name` in `src/storage/storage.ts`: this file is copied into
 * the build as it is, so it can import nothing; `pwa.test.ts` holds the two equal.
 */
const API_CACHE_NAME = "bt-api-v1";
const PREFETCH_TAG = "bt-prefetch";

/** GETs `path` from BT and, on a 200, stores the answer in the API cache. Resolves to the answer, or null. */
async function fetchAndStore(path)
{
	const request = new Request(new URL(path, self.location.origin).href);
	const response = await fetch(request);
	if (response.status !== 200) return null;
	const cache = await caches.open(API_CACHE_NAME);
	await cache.put(request, response.clone());
	return response;
}

/** Today's schedule: the default day first, then that day. */
async function prefetchToday()
{
	const answer = await fetchAndStore("/api/v1/scoreboard/default-date");
	if (!answer) return;
	const { date } = await answer.json();
	if (typeof date === "string") await fetchAndStore(`/api/v1/schedule?date=${encodeURIComponent(date)}`);
}

self.addEventListener("periodicsync", (event) =>
{
	if (event.tag === PREFETCH_TAG) event.waitUntil(prefetchToday().catch(() => undefined));
});
