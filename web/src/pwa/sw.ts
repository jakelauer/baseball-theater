/**
 * BT's service worker (ADR-023; S73 installed it, S74 made it its own source): built by
 * `vite-plugin-pwa`'s `injectManifest` mode (`options.ts`) into `/sw.js`, with the build's precache
 * list in place of `self.__WB_MANIFEST`. It lives under `web/src/` so law L1's lint
 * (`bt/no-browser-storage`) reads it, and it touches no Cache Storage itself: every cache it keeps
 * comes from `storage/workerCaches.ts`, which `storage/` labels and sign-out clears (ADR-028).
 *
 * What it does, as the generated worker did before S74:
 * - waits as the new version until the page asks it to take over (`SKIP_WAITING`, S73's update
 *   notice, `registerType: "prompt"`), and on sign-out's `CLEAR_PERSONAL` forgets its personal copies;
 * - precaches the built shell and answers navigations with the page, except under `/api/`;
 * - keeps the last answer to each `/api/v1/*` GET but `/api/v1/me` and below, network first
 *   (`RUNTIME_CACHED`, `apiStrategy`);
 * - (S151) answers `/download/clip` by streaming MLB's MP4 through as an attachment, only for
 *   MLB's clip MP4s, and answers the page's ping for that route (`download.ts`), so the player shows
 *   Download only while this worker is the one in control;
 * and, new with S74, answers Periodic Background Sync (`registerPeriodicSync`, `prefetch.ts`):
 * when the browser wakes the installed app with `bt-prefetch`, it asks BT for the scoreboard's
 * default day (S111) and that day's schedule through the same strategy, so today's scoreboard
 * opens offline. It can't read the session (that is in `localStorage`), so it never asks for a
 * favorite's game: the page does that on open (`prefetchOnOpen`). A failed request leaves the last copy.
 */
import type { PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CLEAR_PERSONAL_MESSAGE } from "../storage/storage.js";
import {
	apiStrategy, forgetPersonalCopies, precacheShell,
} from "../storage/workerCaches.js";
import {
	answerDownloadPing, DOWNLOAD_PATH, downloadResponse,
} from "./download.js";
import { RUNTIME_CACHED } from "./options.js";

/** A worker event that can hold the worker open (`ExtendableEvent`; the web tsconfig has the DOM lib, not WebWorker's). */
interface WorkerEvent extends Event
{
	waitUntil(promise: Promise<unknown>): void;
}

/** A Periodic Background Sync wake (`PeriodicSyncEvent`), naming the tag the page registered. */
interface PeriodicSyncEvent extends WorkerEvent
{
	tag: string;
}

/** What this worker uses of its global scope (`ServiceWorkerGlobalScope`). */
interface WorkerScope
{
	__WB_MANIFEST: (string | PrecacheEntry)[];
	location: Location;
	skipWaiting(): Promise<void>;
	addEventListener(type: "message", listener: (event: MessageEvent & WorkerEvent) => void): void;
	addEventListener(type: "periodicsync", listener: (event: PeriodicSyncEvent) => void): void;
}

declare const self: WorkerScope;

/** The tag `registerPeriodicSync` asks for (`PREFETCH_TAG` in `prefetch.ts`; a literal, since that module brings React). */
const PREFETCH_TAG = "bt-prefetch";

self.addEventListener("message", (event) =>
{
	const type = (event.data as { type?: unknown } | null)?.type;
	if (type === "SKIP_WAITING") void self.skipWaiting();
	// Sign-out (S74, `clearPersonalData`): forget the personal copies, answers still on their way included.
	if (type === CLEAR_PERSONAL_MESSAGE.type) event.waitUntil(forgetPersonalCopies().catch(() => undefined));
	// S151: the page asks whether this worker answers the download route before it shows Download.
	answerDownloadPing(event.data, event.ports);
});

// S151: the download route, registered before the navigation fallback (workbox takes the first match),
// which also denies it, so a link to it is never answered with the page.
registerRoute(({ url, sameOrigin }) => sameOrigin && url.pathname === DOWNLOAD_PATH, ({ request }) => downloadResponse(request.url, fetch));

/** The paths a navigation never gets the page for: BT's API (S73) and the download route (S151). */
const NAVIGATION_DENYLIST = [/^\/api\//, new RegExp(`^${DOWNLOAD_PATH}(?:[/?#]|$)`)];

registerRoute(new NavigationRoute(precacheShell(self.__WB_MANIFEST), {
	denylist: NAVIGATION_DENYLIST,
}));

const api = apiStrategy();
registerRoute(RUNTIME_CACHED, api, "GET");

/** GETs `path` from BT through the API strategy (stored on a 200); the answer, or null when it isn't a 200. */
async function fetchAndStore(path: string, event: PeriodicSyncEvent): Promise<Response | null>
{
	const response = await api.handle({
		event: event as never,
		request: new Request(new URL(path, self.location.origin).href),
	});
	return response.status === 200 ? response : null;
}

/** Today's schedule: the default day first, then that day. */
async function prefetchToday(event: PeriodicSyncEvent): Promise<void>
{
	const answer = await fetchAndStore("/api/v1/scoreboard/default-date", event);
	if (!answer) return;
	const { date } = await answer.json() as { date?: unknown };
	if (typeof date === "string") await fetchAndStore(`/api/v1/schedule?date=${encodeURIComponent(date)}`, event);
}

self.addEventListener("periodicsync", (event) =>
{
	if (event.tag === PREFETCH_TAG) event.waitUntil(prefetchToday(event).catch(() => undefined));
});
