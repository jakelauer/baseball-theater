/**
 * S74: what the app asks for ahead of time so it reads offline (ADR-023). On open, today's
 * schedule, and for a signed-in fan the favorites' games on it (AC 4, the requests asserted);
 * Periodic Background Sync only where the browser offers it (AC 5, feature detection).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, waitFor,
} from "@testing-library/react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { DEFAULT_SETTINGS } from "@bt/domain";
import { BACKGROUND_PREFETCH_MS } from "../api/freshness.js";
import { createQueryClient } from "../api/queryClient.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { SettingsSync } from "../settings/SettingsSync.js";
import { resetSettings } from "../settings/store.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import {
	PREFETCH_TAG, registerPeriodicSync, usePrefetchOnOpen,
} from "./prefetch.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const SCHEDULE = JSON.parse(readFileSync(join(FIXTURES, "schedule-2026-09-05.json"), "utf8"));
const GAME = JSON.parse(readFileSync(join(FIXTURES, "game-823823.json"), "utf8"));

/** Miami (CHC @ MIA, 823823) and the Yankees (NYY @ SD, 823257): two of 2026-09-05's fifteen games. */
const FAVORITES = [146, 147];

/** Every request the app made, as `pathname?search`. */
let asked: string[] = [];

/** The API, signed in as the dev account when `signedIn`, its favorites `FAVORITES`; the default day 2026-09-05. */
function serveApi(signedIn: boolean): void
{
	setSessionToken(signedIn ? DEV_SIGN_IN_TOKEN : null);
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const url = new URL(request.url);
		asked.push(`${url.pathname}${url.search}`);
		if (url.pathname === "/api/v1/me") return Promise.resolve(signedIn ? jsonResponse(DEV_ACCOUNT) : jsonResponse({
			error: "unauthorized",
		}, 401));
		if (url.pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse({
			...DEFAULT_SETTINGS,
			favoriteTeamIds: FAVORITES,
			version: 1,
		}));
		if (url.pathname === "/api/v1/scoreboard/default-date") return Promise.resolve(jsonResponse({
			date: "2026-09-05",
		}));
		if (url.pathname === "/api/v1/schedule") return Promise.resolve(jsonResponse({
			...SCHEDULE,
			fetchedAt: "2026-09-05T23:00:00.000Z",
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2026-09-05T23:00:00.000Z",
		}));
		if (url.pathname.startsWith("/api/v1/games/")) return Promise.resolve(jsonResponse({
			...GAME,
			gamePk: Number(url.pathname.split("/").at(-1)),
			fetchedAt: "2026-09-05T23:00:00.000Z",
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2026-09-05T23:00:00.000Z",
		}));
		return new Promise<Response>(() => undefined);
	}));
}

function Prefetch()
{
	usePrefetchOnOpen();
	return null;
}

/** The app's providers as `App` mounts them, with nothing on screen but the prefetch; `client` when the test watches it. */
function renderApp(client = createQueryClient())
{
	return render(
		<QueryClientProvider client={client}>
			<SessionProvider>
				<SettingsSync />
				<Prefetch />
			</SessionProvider>
		</QueryClientProvider>,
	);
}

const games = () => asked.filter((path) => path.startsWith("/api/v1/games/")).sort();

beforeEach(() =>
{
	asked = [];
});

afterEach(() =>
{
	cleanup();
	resetSettings();
	setSessionToken(null);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("on open, today is asked for ahead of time (S74 AC 4)", () =>
{
	it("S74 AC 4 signed in: today's schedule and each favorite's game on it, and no other game", async () =>
	{
		serveApi(true);
		renderApp();
		await waitFor(() => expect(games()).toEqual(["/api/v1/games/823257", "/api/v1/games/823823"]));
		expect(asked).toContain("/api/v1/scoreboard/default-date");
		expect(asked).toContain("/api/v1/schedule?date=2026-09-05");
		// The schedule is asked once, not again for the favorites.
		expect(asked.filter((path) => path.startsWith("/api/v1/schedule"))).toHaveLength(1);
	});

	it("S74 AC 4 signed out: today's schedule only, no game", async () =>
	{
		serveApi(false);
		renderApp();
		await waitFor(() => expect(asked).toContain("/api/v1/schedule?date=2026-09-05"));
		// Give any game request a chance to go out before saying none did.
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(games()).toEqual([]);
		expect(asked).not.toContain("/api/v1/me/settings");
	});

	it("S74 AC 4 signed out: a wake (the tab shown again) runs the prefetch again", async () =>
	{
		serveApi(false);
		const client = createQueryClient();
		const prefetch = vi.spyOn(client, "prefetchQuery");
		renderApp(client);
		await waitFor(() => expect(asked).toContain("/api/v1/schedule?date=2026-09-05"));
		const before = prefetch.mock.calls.length;
		act(() =>
		{
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(prefetch.mock.calls.length).toBe(before + 1);
		expect(prefetch.mock.calls.at(-1)![0]).toMatchObject({
			queryKey: ["schedule", "2026-09-05"],
		});
	});
});

describe("Periodic Background Sync, where the browser offers it (S74 AC 5)", () =>
{
	it("S74 AC 5 supported: registers the worker's prefetch tag with the background cadence", async () =>
	{
		const register = vi.fn(() => Promise.resolve());
		const registration = {
			periodicSync: {
				register,
			},
		} as unknown as ServiceWorkerRegistration;
		await expect(registerPeriodicSync(registration)).resolves.toBe(true);
		expect(register).toHaveBeenCalledWith(PREFETCH_TAG, {
			minInterval: BACKGROUND_PREFETCH_MS,
		});
		expect(PREFETCH_TAG).toBe("bt-prefetch");
		const handler = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../public/sw-prefetch.js"), "utf8");
		expect(handler).toContain(`const PREFETCH_TAG = "${PREFETCH_TAG}";`);
	});

	it("S74 AC 5 supported: a refused registration (no permission) answers false and throws nothing", async () =>
	{
		const registration = {
			periodicSync: {
				register: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
			},
		} as unknown as ServiceWorkerRegistration;
		await expect(registerPeriodicSync(registration)).resolves.toBe(false);
	});

	it("S74 AC 5 unsupported: with no periodicSync on the registration, nothing is registered", async () =>
	{
		const registration = {} as ServiceWorkerRegistration;
		await expect(registerPeriodicSync(registration)).resolves.toBe(false);
	});
});
