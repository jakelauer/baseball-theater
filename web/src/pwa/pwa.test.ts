/**
 * S73, S74: what the build's service worker and manifest are told (`PWA_OPTIONS`, read by
 * `vite.config.ts`), and the worker itself (`sw.ts`), run against jsdom's window with Workbox's
 * routing and the storage-owned caches stood in. The S73 grader also inspects a real build.
 */
import {
	beforeEach, describe, expect, it, vi,
} from "vitest";
import { API_CACHE } from "../storage/storage.js";
import {
	APP_BACKGROUND, isRuntimeCached, PWA_OPTIONS, RUNTIME_CACHED,
} from "./options.js";
import { PREFETCH_TAG } from "./prefetch.js";

const worker = vi.hoisted(() =>
{
	const handle = vi.fn<(options: { request: Request }) => Promise<Response>>();
	return {
		handle,
		strategy: {
			cacheName: "bt-api-v1",
			handle,
		},
		registerRoute: vi.fn(),
		NavigationRoute: vi.fn(function NavigationRoute(this: object, handler: unknown, options: unknown)
		{
			Object.assign(this, {
				handler,
				options,
			});
		}),
		precacheShell: vi.fn(() => "shell-handler"),
		forgetPersonalCopies: vi.fn(async () => undefined),
	};
});
vi.mock("workbox-routing", () => ({
	registerRoute: worker.registerRoute,
	NavigationRoute: worker.NavigationRoute,
}));
vi.mock("../storage/workerCaches.js", () => ({
	apiStrategy: () => worker.strategy,
	precacheShell: worker.precacheShell,
	forgetPersonalCopies: worker.forgetPersonalCopies,
}));

// The worker, run once against jsdom's window (its `self`), with the stand-ins above.
await import("./sw.js");

describe("the installed app's configuration (S73)", () =>
{
	it("scope: the worker and the manifest both sit at /, so Web Push can attach later without moving it", () =>
	{
		expect(PWA_OPTIONS.scope).toBe("/");
		expect(PWA_OPTIONS.manifest && PWA_OPTIONS.manifest.scope).toBe("/");
		expect(PWA_OPTIONS.registerType).toBe("prompt");
	});

	it("precache: the built shell (scripts, styles, the page, icons), never an /api/ answer, from BT's own worker source", () =>
	{
		expect(PWA_OPTIONS.strategies).toBe("injectManifest");
		expect(PWA_OPTIONS.srcDir).toBe("src/pwa");
		expect(PWA_OPTIONS.filename).toBe("sw.ts");
		expect(PWA_OPTIONS.workbox).toBeUndefined();
		const inject = PWA_OPTIONS.injectManifest!;
		expect(inject.globPatterns).toEqual(["**/*.{js,css,html,svg,png,webmanifest}"]);
		for (const pattern of inject.globPatterns ?? []) expect(pattern).not.toMatch(/api/);
		expect(inject.rollupFormat).toBe("iife");
	});

	it("manifest: standalone, the flag mark at 192 and 512, on the app background", () =>
	{
		const manifest = PWA_OPTIONS.manifest;
		if (!manifest) throw new Error("no manifest");
		expect(manifest.display).toBe("standalone");
		expect(manifest.theme_color).toBe(APP_BACKGROUND);
		expect(APP_BACKGROUND).toBe("#10100F");
		expect(manifest.icons?.map((icon) => [icon.src, icon.sizes])).toEqual([["/icons/flag-192.png", "192x192"], ["/icons/flag-512.png", "512x512"]]);
	});

	it("S74 AC 1 runtime cache: the worker routes every /api/v1/* GET but /api/v1/me and below through the one storage-owned NetworkFirst strategy", () =>
	{
		const apiRoutes = worker.registerRoute.mock.calls.filter(([match]) => match === RUNTIME_CACHED);
		expect(apiRoutes).toHaveLength(1);
		expect(apiRoutes[0]).toEqual([RUNTIME_CACHED, worker.strategy, "GET"]);
		expect(worker.strategy.cacheName).toBe(API_CACHE.name);
		for (const path of ["/api/v1/schedule?date=2026-09-05", "/api/v1/games/823823", "/api/v1/standings", "/api/v1/scoreboard/default-date", "/api/v1/digest?date=2026-09-05",
			"/api/v1/meetings"])
		{
			expect(isRuntimeCached(`https://baseball.theater${path}`), path).toBe(true);
		}
		for (const path of ["/", "/games/2026-09-05", "/health", "/api/v2/schedule", "/assets/index.js"])
		{
			expect(isRuntimeCached(`https://baseball.theater${path}`), path).toBe(false);
		}
	});

	it("S74 AC 1 never /api/v1/me: the account, its settings, its download and deletion never enter the cache (ADR-028)", () =>
	{
		for (const path of ["/api/v1/me", "/api/v1/me?x=1", "/api/v1/me/settings", "/api/v1/me/download", "/api/v1/me/download/abc", "/api/v1/me/delete", "/api/v1/me#top"])
		{
			expect(isRuntimeCached(`http://localhost:5173${path}`), path).toBe(false);
		}
	});

	it("S74 AC 1 cache name: the background prefetch stores through the same strategy, so into the same cache", async () =>
	{
		worker.handle.mockImplementation(async ({ request }) => (new URL(request.url).pathname === "/api/v1/scoreboard/default-date"
			? new Response(JSON.stringify({
				date: "2026-09-05",
			}), {
				status: 200,
			})
			: new Response("{}", {
				status: 200,
			})));
		await wake(PREFETCH_TAG);
		expect(worker.handle.mock.calls.map(([{ request }]) => request.url)).toEqual([`${location.origin}/api/v1/scoreboard/default-date`,
			`${location.origin}/api/v1/schedule?date=2026-09-05`]);
		// The worker has no session: its requests carry no Authorization.
		for (const [{ request }] of worker.handle.mock.calls) expect(request.headers.get("Authorization")).toBeNull();
	});
});

/** The browser wakes the worker for Periodic Background Sync with `tag`; resolves once its work is done. */
async function wake(tag: string): Promise<void>
{
	let work: Promise<unknown> = Promise.resolve();
	const event = Object.assign(new Event("periodicsync"), {
		tag,
		waitUntil: vi.fn((promise: Promise<unknown>) =>
		{
			work = promise;
		}),
	});
	window.dispatchEvent(event);
	await work;
}

describe("the service worker (S74, sw.ts)", () =>
{
	beforeEach(() =>
	{
		worker.handle.mockReset();
	});

	it("precaches the build's shell and answers navigations with it, except under /api/", () =>
	{
		expect(worker.precacheShell).toHaveBeenCalledOnce();
		const [navigation] = worker.registerRoute.mock.calls.find(([route]) => route instanceof worker.NavigationRoute)!;
		const { handler, options } = navigation as { handler: unknown;
			options: { denylist: RegExp[] }; };
		expect(handler).toBe("shell-handler");
		expect(options.denylist.some((deny) => deny.test("/api/v1/schedule"))).toBe(true);
		expect(options.denylist.some((deny) => deny.test("/games/2026-09-05"))).toBe(false);
	});

	it("takes over only when the page asks (SKIP_WAITING, S73's update notice)", () =>
	{
		const skipWaiting = vi.fn(async () => undefined);
		Object.assign(window, {
			skipWaiting,
		});
		window.dispatchEvent(new MessageEvent("message", {
			data: {
				type: "other",
			},
		}));
		window.dispatchEvent(new MessageEvent("message", {
			data: null,
		}));
		expect(skipWaiting).not.toHaveBeenCalled();
		window.dispatchEvent(new MessageEvent("message", {
			data: {
				type: "SKIP_WAITING",
			},
		}));
		expect(skipWaiting).toHaveBeenCalledOnce();
	});

	it("S74 R1: sign-out's CLEAR_PERSONAL message makes the worker forget its personal copies, held open until done", () =>
	{
		const waitUntil = vi.fn();
		window.dispatchEvent(Object.assign(new MessageEvent("message", {
			data: {
				type: "CLEAR_PERSONAL",
			},
		}), {
			waitUntil,
		}));
		expect(worker.forgetPersonalCopies).toHaveBeenCalledOnce();
		expect(waitUntil).toHaveBeenCalledOnce();
	});

	it("a wake for another tag does nothing; a failed or non-200 default day asks for no schedule; a failure is swallowed", async () =>
	{
		await wake("someone-else");
		expect(worker.handle).not.toHaveBeenCalled();
		worker.handle.mockResolvedValueOnce(new Response("down", {
			status: 503,
		}));
		await wake(PREFETCH_TAG);
		expect(worker.handle).toHaveBeenCalledOnce();
		worker.handle.mockReset();
		worker.handle.mockResolvedValueOnce(new Response(JSON.stringify({
			date: 20260905,
		}), {
			status: 200,
		}));
		await wake(PREFETCH_TAG);
		expect(worker.handle).toHaveBeenCalledOnce();
		worker.handle.mockReset();
		worker.handle.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		await expect(wake(PREFETCH_TAG)).resolves.toBeUndefined();
	});
});
