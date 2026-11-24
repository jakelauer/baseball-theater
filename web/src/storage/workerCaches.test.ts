/**
 * S74: the worker's Cache Storage, through Workbox's real `NetworkFirst` against a stand-in Cache
 * Storage (jsdom has none). The stand-in keeps each entry's key `Request` as Cache Storage does,
 * headers included, so a key that carries the session's token shows here.
 */
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { STORED_COPY_HEADER } from "../api/freshness.js";
import { API_CACHE } from "./storage.js";
import {
	apiStrategy, forgetPersonalCopies, markStoredCopy, noStoreAcrossSignOut, precacheShell, urlOnlyKey,
} from "./workerCaches.js";

const precache = vi.hoisted(() => ({
	precacheAndRoute: vi.fn(),
	cleanupOutdatedCaches: vi.fn(),
	createHandlerBoundToURL: vi.fn(() => "handler"),
}));
vi.mock("workbox-precaching", () => precache);

/** One stand-in cache: entries keyed by URL, each keeping the `Request` it was stored under. */
class FakeCache
{
	readonly entries = new Map<string, { key: Request;
		response: Response; }>();

	async put(key: Request | string, response: Response): Promise<void>
	{
		const request = typeof key === "string" ? new Request(key) : key;
		this.entries.set(request.url, {
			key: request,
			response,
		});
	}

	async match(key: Request | string): Promise<Response | undefined>
	{
		const url = typeof key === "string" ? key : key.url;
		return this.entries.get(url)?.response.clone();
	}
}

let cache: FakeCache;
const URL_ = "https://baseball.theater/api/v1/schedule?date=2026-09-05";

/** A worker event, as jsdom has none: enough of `FetchEvent` for Workbox's `handle`. */
class WorkerEvent
{
	readonly waitUntil = vi.fn();

	constructor(readonly request?: Request)
	{}
}

/** An event as the worker's fetch handler gets it. */
function event(request: Request)
{
	return new WorkerEvent(request) as never;
}

beforeEach(() =>
{
	cache = new FakeCache();
	// Workbox's development build checks the event's class; jsdom has no worker events.
	vi.stubGlobal("ExtendableEvent", WorkerEvent);
	vi.stubGlobal("FetchEvent", WorkerEvent);
	vi.stubGlobal("caches", {
		delete: vi.fn(async () =>
		{
			cache = new FakeCache();
			return true;
		}),
		open: vi.fn(async () => cache),
		match: vi.fn(async (key: Request | string) => cache.match(key)),
	});
});

afterEach(() =>
{
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("the worker's API cache (S74)", () =>
{
	it("S74 AC 1 runtime cache: network first into the cache storage.ts names, keeping only a 200, with no lifetime", async () =>
	{
		const strategy = apiStrategy();
		expect(strategy.cacheName).toBe(API_CACHE.name);
		// Its plugins are the 200-only rule and this module's two; no expiry plugin, no network timeout.
		expect(strategy.plugins.map((plugin) => plugin.constructor.name)).toEqual(["CacheableResponsePlugin", "Object", "Object", "Object"]);
		expect(strategy.plugins.slice(1)).toEqual([noStoreAcrossSignOut, urlOnlyKey, markStoredCopy]);
		expect((strategy as unknown as { _networkTimeoutSeconds: number })._networkTimeoutSeconds).toBe(0);
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{\"v\":1}", {
			status: 200,
		})));
		const request = new Request(URL_);
		await strategy.handle({
			request,
			event: event(request),
		});
		await vi.waitFor(() => expect(cache.entries.size).toBe(1));
		vi.stubGlobal("fetch", vi.fn(async () => new Response("down", {
			status: 503,
		})));
		const failed = await strategy.handle({
			request,
			event: event(request),
		});
		// A 503 is handed back but never replaces the stored copy.
		expect(failed.status).toBe(503);
		expect(await (await cache.match(URL_))!.text()).toBe("{\"v\":1}");
	});

	it("S74 R1: an answer is stored under its URL alone, never under the page's request with its Authorization header", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
			status: 200,
		})));
		const request = new Request(URL_, {
			headers: {
				Authorization: "Bearer secret-session",
			},
		});
		await apiStrategy().handle({
			request,
			event: event(request),
		});
		await vi.waitFor(() => expect(cache.entries.size).toBe(1));
		const [stored] = [...cache.entries.values()];
		expect(stored!.key.url).toBe(URL_);
		expect(stored!.key.headers.get("Authorization")).toBeNull();
		expect([...stored!.key.headers.keys()]).toEqual([]);
		expect(await urlOnlyKey.cacheKeyWillBeUsed!({
			request,
			mode: "read",
		} as never)).toBe(URL_);
	});

	it("S74 R3: a copy served from the cache is marked as stored, its headers kept; a network answer is not", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
			status: 200,
			headers: {
				Date: "Tue, 24 Nov 2026 18:00:00 GMT",
			},
		})));
		const request = new Request(URL_);
		const fresh = await apiStrategy().handle({
			request,
			event: event(request),
		});
		expect(fresh.headers.get(STORED_COPY_HEADER)).toBeNull();
		await vi.waitFor(() => expect(cache.entries.size).toBe(1));
		vi.stubGlobal("fetch", vi.fn(async () =>
		{
			throw new TypeError("Failed to fetch");
		}));
		const stored = await apiStrategy().handle({
			request,
			event: event(request),
		});
		expect(stored.headers.get(STORED_COPY_HEADER)).toBe("1");
		expect(stored.headers.get("Date")).toBe("Tue, 24 Nov 2026 18:00:00 GMT");
		expect(await stored.text()).toBe("{}");
		expect(await markStoredCopy.cachedResponseWillBeUsed!({
			cachedResponse: undefined,
		} as never)).toBeUndefined();
	});
});

describe("sign-out reaches the worker (S74)", () =>
{
	it("S74 R1: an answer that lands after sign-out cleared the cache is not stored; one asked for afterwards is", async () =>
	{
		let land: (response: Response) => void = () => undefined;
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) =>
		{
			land = resolve;
		})));
		const request = new Request("https://baseball.theater/api/v1/search/highlights?q=secret");
		const inFlight = apiStrategy().handle({
			request,
			event: event(request),
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		await forgetPersonalCopies();
		expect(caches.delete).toHaveBeenCalledWith(API_CACHE.name);
		land(new Response("{}", {
			status: 200,
		}));
		await inFlight;
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(cache.entries.size).toBe(0);

		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
			status: 200,
		})));
		const after = new Request(URL_);
		await apiStrategy().handle({
			request: after,
			event: event(after),
		});
		await vi.waitFor(() => expect(cache.entries.size).toBe(1));
	});
});

describe("the worker's shell precache (S73, S74)", () =>
{
	it("precaches the build's list, drops outdated precaches and answers navigations with /index.html", () =>
	{
		const manifest = [{
			url: "index.html",
			revision: "1",
		}];
		expect(precacheShell(manifest)).toBe("handler");
		expect(precache.precacheAndRoute).toHaveBeenCalledWith(manifest);
		expect(precache.cleanupOutdatedCaches).toHaveBeenCalledOnce();
		expect(precache.createHandlerBoundToURL).toHaveBeenCalledWith("/index.html");
	});
});
