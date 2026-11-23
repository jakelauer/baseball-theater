/**
 * S73: what the build's service worker and manifest are told (`PWA_OPTIONS`, read by
 * `vite.config.ts`). The grader also inspects a real build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { API_CACHE } from "../storage/storage.js";
import {
	APP_BACKGROUND, isRuntimeCached, PWA_OPTIONS, RUNTIME_CACHED,
} from "./options.js";

describe("the installed app's configuration (S73)", () =>
{
	it("scope: the worker and the manifest both sit at /, so Web Push can attach later without moving it", () =>
	{
		expect(PWA_OPTIONS.scope).toBe("/");
		expect(PWA_OPTIONS.manifest && PWA_OPTIONS.manifest.scope).toBe("/");
		expect(PWA_OPTIONS.registerType).toBe("prompt");
	});

	it("precache: the built shell (scripts, styles, the page, icons), never an /api/ answer", () =>
	{
		const workbox = PWA_OPTIONS.workbox!;
		expect(workbox.globPatterns).toEqual(["**/*.{js,css,html,svg,png,webmanifest}"]);
		for (const pattern of workbox.globPatterns ?? []) expect(pattern).not.toMatch(/api/);
		expect(workbox.navigateFallback).toBe("/index.html");
		expect(workbox.navigateFallbackDenylist!.some((deny) => deny.test("/api/v1/schedule"))).toBe(true);
		expect(workbox.navigateFallbackDenylist!.some((deny) => deny.test("/games/2026-09-05"))).toBe(false);
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

	it("S74 AC 1 runtime cache: one NetworkFirst rule keeps the last answer to /api/v1/* GETs in the cache web/src/storage/ names, with no lifetime of its own", () =>
	{
		const rules = PWA_OPTIONS.workbox!.runtimeCaching!;
		expect(rules).toHaveLength(1);
		const [rule] = rules;
		expect(rule!.handler).toBe("NetworkFirst");
		expect(rule!.method).toBe("GET");
		expect(rule!.urlPattern).toBe(RUNTIME_CACHED);
		expect(rule!.options?.cacheName).toBe(API_CACHE.name);
		// Only a 200 is kept, and nothing on the client decides how old is too old (ADR-014 rule 3).
		expect(rule!.options?.cacheableResponse).toEqual({
			statuses: [200],
		});
		expect(rule!.options?.expiration).toBeUndefined();
		expect(rule!.options?.networkTimeoutSeconds).toBeUndefined();
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

	it("S74 AC 1 cache name: the worker's Periodic Background Sync handler stores into the same cache, and is loaded into the worker", () =>
	{
		const handler = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../public/sw-prefetch.js"), "utf8");
		expect(handler).toContain(`const API_CACHE_NAME = "${API_CACHE.name}";`);
		expect(handler).not.toMatch(/maxAgeSeconds|expiration|networkTimeoutSeconds/);
		expect(PWA_OPTIONS.workbox!.importScripts).toEqual(["/sw-prefetch.js"]);
	});
});
