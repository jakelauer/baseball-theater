/**
 * The only code that touches browser storage (ADR-028; the `bt/no-browser-storage`
 * lint rule rejects `localStorage`, `sessionStorage`, `indexedDB` and `caches`
 * anywhere else). Every key BT stores is listed in {@link STORAGE_KEYS} with
 * whether it is personal, so sign-out and account deletion can clear all of a
 * user's browser data in one call without each feature hand-listing its keys.
 *
 * Storage can be missing or throw (private windows, blocked site data), so every
 * access is guarded: a failed read is "nothing stored", a failed write is lost.
 */

/**
 * Every key BT stores (ADR-028's "Browser" inventory row: session token, cached settings, and
 * Logto's sign-in keys), whether it is personal, and where it lives: `"shared"` is `localStorage`,
 * seen by every tab of the site; `"tab"` is the tab's own `sessionStorage`, which survives the
 * tab's trip to Logto and back but no other tab sees (S120: a sign-in started in a second tab
 * must not overwrite the first's). Logto's browser SDK would otherwise keep its tokens and sign-in
 * session under keys of its own; the `AuthClient` (S116) hands it a storage adapter over this
 * module instead, so every key it writes is listed here, labeled personal, and gone after sign-out
 * and account deletion. Four keys say nothing about the person (ADR-028's `none`): when the
 * update notice's Snooze runs out (S73, shell-scoreboard A6), the release this browser last
 * loaded (S135, A9's after-update pointer), that the Settings install tip was dismissed (S73,
 * standings-search-settings A8) and the video quality last chosen (#416). They belong to this
 * browser, survive sign-out, and never sync to the account.
 */
export const STORAGE_KEYS = {
	/** The S59 session bearer token; shared, so every tab is signed in. */
	"bt.session": {
		personal: true,
		area: "shared",
	},
	/** The S6 settings store's cached copy of the account's settings, so a reload shows them before the account answers. */
	"bt.settings": {
		personal: true,
		area: "shared",
	},
	/** Where a sign-in started (S116), so the callback can return there; set before leaving for Logto, cleared on return. This tab's. */
	"bt.signInReturnTo": {
		personal: true,
		area: "tab",
	},
	/** Logto's ID token for the moment between its sign-in and the hand-off to BT (S116); the `AuthClient` clears it right after. */
	"logto.idToken": {
		personal: true,
		area: "tab",
	},
	/** Logto's access and refresh tokens. BT asks Logto for neither, but the SDK may store them, so they are listed and cleared too. */
	"logto.accessToken": {
		personal: true,
		area: "tab",
	},
	"logto.refreshToken": {
		personal: true,
		area: "tab",
	},
	/** Logto's in-flight sign-in (its PKCE verifier and state), from leaving for Logto until the callback. This tab's (S120). */
	"logto.signInSession": {
		personal: true,
		area: "tab",
	},
	/** When the update notice's Snooze ends, in epoch ms (S73, shell-scoreboard A6), so a reload within the hour keeps it hidden. */
	"bt.updateSnoozedUntil": {
		personal: false,
		area: "shared",
	},
	/**
	 * The release this browser last loaded (S135, shell-scoreboard A9), written on every load of a build whose
	 * release is known, an older one after a rollback included, so a load of a newer one shows the after-update
	 * pointer. Not the snooze key.
	 */
	"bt.lastRelease": {
		personal: false,
		area: "shared",
	},
	/** Set once the Settings install tip is dismissed (S73, standings-search-settings A8): it stays gone in this browser. */
	"bt.installTipDismissed": {
		personal: false,
		area: "shared",
	},
	/**
	 * The video quality the reader last chose in the player (#416), by MLB's playback name (`highBit`), so the next clip starts
	 * there (`rememberedVideoQuality`). Written only by a choice in the picker, never by a fallback. The settings store keeps it.
	 */
	"bt.videoQuality": {
		personal: false,
		area: "shared",
	},
} as const satisfies Record<string, { personal: boolean;
	area: "shared" | "tab"; }>;

export type StorageKey = keyof typeof STORAGE_KEYS;

/**
 * The Cache Storage cache BT's service worker keeps at runtime (S74, ADR-023): the last answer to
 * each `/api/v1/*` GET but `/api/v1/me` and below (`RUNTIME_CACHED`, `pwa/options.ts`), so anything
 * already viewed stays readable offline. The worker writes it only through `workerCaches.ts`, which
 * keys every entry by its URL alone, so no request header (the session's `Authorization`) is ever
 * stored. It is not a `localStorage` key, so it is not in {@link STORAGE_KEYS}. Labeled personal:
 * ADR-028's Browser row lists offline caches among what sign-out and deletion remove, and its URLs
 * can carry what a reader searched for (`/api/v1/search/highlights?q=`), so {@link clearPersonalData}
 * deletes it. The worker stores the newest copy it was given and never decides freshness (ADR-014 rule 3).
 */
export const API_CACHE = {
	name: "bt-api-v1",
	area: "cache",
	personal: true,
} as const;

/**
 * The worker's precache of the built app (S73; installed through `workerCaches.ts`): scripts,
 * styles, the page and icons, the same for every visitor, so not personal and kept on sign-out.
 * Listed so every cache BT's worker keeps is labeled here. `name` is a prefix: Workbox names the
 * cache itself, `workbox-precache-v2-<scope>`.
 */
export const SHELL_CACHE = {
	name: "workbox-precache",
	area: "cache",
	personal: false,
} as const;

/**
 * The message sign-out sends the controlling service worker (S74): it then forgets its personal
 * copies itself (`forgetPersonalCopies`, `workerCaches.ts`), including any answer still on its way
 * when the page deleted the cache, which would otherwise land in a re-created cache after sign-out.
 */
export const CLEAR_PERSONAL_MESSAGE = {
	type: "CLEAR_PERSONAL",
} as const;

/** Every Cache Storage cache BT keeps, each labeled; {@link clearPersonalData} deletes the personal ones. */
const CACHES = [API_CACHE, SHELL_CACHE] as const;

/** Deletes every cache labeled personal. Cache Storage can be missing (no worker support, jsdom) or refuse; either is "nothing to delete". */
async function deletePersonalCaches(): Promise<void>
{
	if (typeof caches === "undefined") return;
	for (const cache of CACHES)
	{
		if (cache.personal) await caches.delete(cache.name);
	}
}

/** The browser store `key` lives in. Reading the global can itself throw (blocked site data), so callers guard it. */
function areaOf(key: StorageKey): Storage
{
	return STORAGE_KEYS[key].area === "tab" ? sessionStorage : localStorage;
}

/** What `key` holds in its area (`STORAGE_KEYS`), or null when nothing is stored or storage is unavailable. */
export function readStored(key: StorageKey): string | null
{
	try
	{
		return areaOf(key).getItem(key);
	}
	catch
	{
		return null;
	}
}

/** Stores `value` under `key` in its area (`STORAGE_KEYS`), or removes the key when `value` is null. */
export function writeStored(key: StorageKey, value: string | null): void
{
	try
	{
		if (value === null) areaOf(key).removeItem(key);
		else areaOf(key).setItem(key, value);
	}
	catch
	{
		// Unavailable storage: the caller keeps its in-memory copy for this page load.
	}
}

/**
 * Removes every key labeled personal, in both areas, starts deleting every cache labeled personal,
 * and tells the controlling worker to do the same (`CLEAR_PERSONAL_MESSAGE`), so an answer it was
 * still fetching isn't stored after (sign-out and account deletion, which signs out). Non-personal
 * keys and caches stay.
 * The keys are gone when it returns; the caches go a moment later (Cache Storage is async), and a
 * refused delete is dropped, as a failed key write is.
 */
export function clearPersonalData(): void
{
	for (const [key, { personal }] of Object.entries(STORAGE_KEYS))
	{
		if (personal) writeStored(key as StorageKey, null);
	}
	deletePersonalCaches().catch(() => undefined);
	try
	{
		navigator.serviceWorker?.controller?.postMessage(CLEAR_PERSONAL_MESSAGE);
	}
	catch
	{
		// No worker reachable: the page's own delete above is all there is.
	}
}
