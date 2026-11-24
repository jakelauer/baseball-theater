/**
 * S74: offline reading's marker (shell-scoreboard A1, game-rooms A1, A13, A14), through the shell as
 * `App` composes it: the update notice and the offline marker beside it. Each test loads a page
 * online, then the browser goes offline (`navigator.onLine` false, the `offline` event) and every
 * request fails as it would with no network and no stored copy; the page keeps the copy it has.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { DEFAULT_SETTINGS, fetchedAgo } from "@bt/domain";
import type { GamePayload } from "../api/game.js";
import { createQueryClient } from "../api/queryClient.js";
import { formatMomentSince } from "../format/datetime.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import type { LayoutVariant } from "../layout/variant.js";
import { GamePage } from "../pages/GamePage.js";
import { ScoreboardPage } from "../pages/ScoreboardPage.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { setSessionToken } from "../session/token.js";
import { SettingsSync } from "../settings/SettingsSync.js";
import { hydrateSettings, resetSettings } from "../settings/store.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { offlineMessage, useOfflineNotice } from "./offline.js";
import {
	announceUpdate, resetUpdates, useUpdateNotice,
} from "./updates.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/**
 * Every copy in these tests was got 18 minutes before the test runs (the page's load, `Date.now`
 * held there until the browser goes offline), while BT last changed it 9 hours before: the marker
 * dates the copy, not the change (S74 R3; an unchanged poll moves no `fetchedAt`).
 */
const GOT_AT = new Date(Date.now() - 18 * 60 * 1000).toISOString();
const CHANGED_AT = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

function scheduleDay()
{
	return {
		...read("schedule-2026-09-05.json"),
		fetchedAt: CHANGED_AT,
		windowMode: "cache",
		version: 1,
		lastChangedAt: CHANGED_AT,
	};
}

function finalGame(): GamePayload
{
	return {
		...read("game-823823.json"),
		plays: read("plays-823823.json"),
		fetchedAt: CHANGED_AT,
		windowMode: "cache",
		version: 1,
		lastChangedAt: CHANGED_AT,
	} as GamePayload;
}

function liveGame(): GamePayload
{
	return {
		...read("game-823823-live.json"),
		highlights: read("game-823823.json").highlights,
		fetchedAt: CHANGED_AT,
		windowMode: "active",
		version: 1,
		lastChangedAt: CHANGED_AT,
	} as GamePayload;
}

/** The browser WebSocket, stood in, so a live game's stream can open and drop. */
class FakeWebSocket
{
	static opened: FakeWebSocket[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	readonly close = vi.fn();

	constructor(readonly url: string)
	{
		FakeWebSocket.opened.push(this);
	}
}

let online = true;
/** `Date.now` held at `GOT_AT` while the page loads online, so its copies are 18 minutes old once offline. */
let loading: { mockRestore(): void } | undefined;

/** The API while online: signed out, the 2026-09-05 day, its empty digest and `game` for every game. */
function serveApi(game: GamePayload = finalGame()): void
{
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		if (!online) return Promise.reject(new TypeError("Failed to fetch"));
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return Promise.resolve(jsonResponse({
			error: "unauthorized",
		}, 401));
		if (pathname === "/api/v1/scoreboard/default-date") return Promise.resolve(jsonResponse({
			date: "2026-09-05",
		}));
		if (pathname === "/api/v1/schedule") return Promise.resolve(jsonResponse(scheduleDay()));
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse({
			date: "2026-09-05",
			items: [],
			windowMode: "cache",
		}));
		if (pathname.startsWith("/api/v1/games/")) return Promise.resolve(jsonResponse(game));
		return new Promise<Response>(() => undefined);
	}));
}

/** The viewport for `variant`, as the layout host reads it (`useLayoutVariant`: `sm` 48em, `lg` 75em). */
function viewport(variant: LayoutVariant): void
{
	const width = variant === "mobile" ? 390 : variant === "medium" ? 768 : 1200;
	window.matchMedia = ((query: string) => ({
		matches: Number(/min-width: ([\d.]+)em/.exec(query)?.[1] ?? 0) * 16 <= width,
		media: query,
		onchange: null,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		dispatchEvent: () => false,
	})) as typeof window.matchMedia;
}

/** The browser drops off the network: `navigator.onLine` false and the `offline` event. */
function goOffline(): void
{
	online = false;
	loading?.mockRestore();
	act(() =>
	{
		window.dispatchEvent(new Event("offline"));
	});
}

/** The shell as `App` composes it: the update notice floating, the offline marker in the slot. */
function Shell()
{
	const notice = useUpdateNotice();
	const marker = useOfflineNotice();
	return (
		<AppShellLayout notice={notice} marker={marker}>
			{(variant, setFooter) => (
				<Routes>
					<Route path="/games/:date" element={<ScoreboardPage variant={variant} setFooter={setFooter} />} />
					<Route path="/game/:gamePk" element={<GamePage variant={variant} setFooter={setFooter} />} />
					<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} setFooter={setFooter} />} />
				</Routes>
			)}
		</AppShellLayout>
	);
}

/** The shell at `path`; with `sync`, the settings store follows the session as `App` has it (`SettingsSync`). */
function renderAt(path: string, sync = false)
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					{sync && <SettingsSync />}
					<MemoryRouter initialEntries={[path]}>
						<Shell />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** The marker in the slot: a status with no button, reading `message`. */
function expectMarker(message: string): HTMLElement
{
	const slot = screen.getByTestId("notice-slot");
	const marker = within(slot).getByRole("status");
	expect(marker).toHaveTextContent(message);
	expect(within(marker).queryAllByRole("button")).toHaveLength(0);
	expect(within(marker).queryByRole("link")).toBeNull();
	return marker;
}

/** The footer offline: its columns and copyright line only, no offline line, no age, no site address, no Live strip. */
function expectPlainFooter(): void
{
	const footer = screen.getByRole("contentinfo");
	expect(footer).not.toHaveTextContent(/Offline|saved|ago|baseball\.theater/);
	expect(within(footer).queryByTestId("footer-live-strip")).toBeNull();
	expect(footer).toHaveTextContent("Baseball Theater");
}

const SCORES = `You're offline. Scores as of ${formatMomentSince(GOT_AT, new Date())} — 18m ago.`;
const THIS_GAME = `You're offline. This game as of ${formatMomentSince(GOT_AT, new Date())} — 18m ago.`;

beforeEach(() =>
{
	online = true;
	loading = vi.spyOn(Date, "now").mockReturnValue(Date.parse(GOT_AT));
	setSessionToken(null);
	Object.defineProperty(navigator, "onLine", {
		configurable: true,
		get: () => online,
	});
	FakeWebSocket.opened = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
	viewport("mobile");
});

afterEach(() =>
{
	cleanup();
	resetUpdates();
	resetSettings();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	delete (navigator as { onLine?: boolean }).onLine;
	viewport("mobile");
});

describe("the offline marker's words (S74)", () =>
{
	it("names the copy's time and its age from fetchedAgo, or says only that the reader is offline", () =>
	{
		const now = new Date(Date.parse(GOT_AT) + 18 * 60 * 1000);
		expect(fetchedAgo(GOT_AT, now)).toBe("18m ago");
		expect(offlineMessage({
			kind: "scores",
			asOf: GOT_AT,
		}, now)).toBe(`You're offline. Scores as of ${formatMomentSince(GOT_AT, now)} — 18m ago.`);
		expect(offlineMessage({
			kind: "game",
			asOf: GOT_AT,
		}, now)).toBe(`You're offline. This game as of ${formatMomentSince(GOT_AT, now)} — 18m ago.`);
		expect(offlineMessage(null, now)).toBe("You're offline.");
	});

	it("S74 R3: a copy from another day names its date before the time; a same-day copy reads as drawn (owner, 2026-11-24)", () =>
	{
		const now = new Date(2026, 10, 24, 20, 0);
		expect(offlineMessage({
			kind: "scores",
			asOf: new Date(2026, 9, 3, 19, 42).toISOString(),
		}, now)).toBe("You're offline. Scores as of Oct 3, 7:42 PM — 52d ago.");
		expect(offlineMessage({
			kind: "game",
			asOf: new Date(2026, 10, 24, 19, 42).toISOString(),
		}, now)).toBe("You're offline. This game as of 7:42 PM — 18m ago.");
		expect(offlineMessage({
			kind: "scores",
			asOf: new Date(2026, 10, 23, 23, 50).toISOString(),
		}, now)).toBe("You're offline. Scores as of Nov 23, 11:50 PM — 20h ago.");
	});
});

describe("the copy's time (S74 R3)", () =>
{
	it("S74 R3 copy time: a day loaded online is dated when the page got it, not by BT's last change", async () =>
	{
		serveApi();
		renderAt("/games/2026-09-05");
		await screen.findAllByTestId("scoreboard-module");
		goOffline();
		expectMarker(SCORES);
		expect(screen.getByTestId("notice-slot")).not.toHaveTextContent("9h ago");
	});

	it("S74 R3 stored copy: opened offline, the worker's stored day is dated by its Date less its Age", async () =>
	{
		online = false;
		loading?.mockRestore();
		const servedAt = Date.now() - 20 * 60 * 1000;
		vi.stubGlobal("fetch", vi.fn((request: Request) =>
		{
			if (new URL(request.url).pathname !== "/api/v1/schedule") return Promise.reject(new TypeError("Failed to fetch"));
			const stored = jsonResponse(scheduleDay());
			stored.headers.set("Date", new Date(servedAt).toUTCString());
			stored.headers.set("Age", "120");
			stored.headers.set("BT-Stored-Copy", "1");
			return Promise.resolve(stored);
		}));
		renderAt("/games/2026-09-05");
		await screen.findAllByTestId("scoreboard-module");
		const asOf = new Date(Math.floor(servedAt / 1000) * 1000 - 120 * 1000).toISOString();
		expectMarker(`You're offline. Scores as of ${formatMomentSince(asOf, new Date())} — 22m ago.`);
	});
});

describe("offline, the scoreboard keeps its day and says how old it is (S74 AC 2)", () =>
{
	for (const variant of ["mobile", "medium", "desktop"] as const)
	{
		it(`S74 AC 2 scoreboard ${variant}: the marker under the header, the day as saved, a plain footer`, async () =>
		{
			viewport(variant);
			serveApi();
			renderAt("/games/2026-09-05");
			await screen.findAllByTestId("scoreboard-module");
			await screen.findByRole("contentinfo");
			expect(screen.queryByTestId("notice-slot")).toBeNull();

			goOffline();
			expectMarker(SCORES);
			expect(screen.getAllByTestId("scoreboard-module").length).toBeGreaterThan(0);
			expect(screen.queryByText("Couldn't load games")).toBeNull();
			expectPlainFooter();

			// Back online, the marker goes.
			online = true;
			act(() =>
			{
				window.dispatchEvent(new Event("online"));
			});
			expect(screen.queryByTestId("notice-slot")).toBeNull();
		});
	}
});

describe("offline, a game already opened stays readable (S74 AC 2)", () =>
{
	it("S74 AC 2 game: the marker under the game top bar names the game's copy; the room stays", async () =>
	{
		serveApi();
		renderAt("/game/823823/box");
		await screen.findByTestId("game-topbar");
		await screen.findByRole("contentinfo");

		goOffline();
		const marker = expectMarker(THIS_GAME);
		// Under the top bar, not above it.
		expect(screen.getByTestId("game-topbar").compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.getByRole("tab", {
			name: "Box",
		})).toHaveAttribute("aria-selected", "true");
		// A refetch now fails; the room is kept, never replaced with the error room.
		await userEvent.click(screen.getByRole("tab", {
			name: "Plays",
		}));
		expect(screen.queryByText("Couldn't load this room")).toBeNull();
		expectPlainFooter();
	});

	it("S74 AC 2 live game: a streamed game whose socket drops and whose polls fail keeps the game and shows its age, with no Live strip", async () =>
	{
		loading?.mockRestore();
		vi.useFakeTimers({
			shouldAdvanceTime: true,
			now: Date.parse(GOT_AT),
		});
		try
		{
			serveApi(liveGame());
			renderAt("/game/823823/live");
			await screen.findByTestId("game-topbar");
			await waitFor(() => expect(FakeWebSocket.opened.length).toBeGreaterThan(0));
			act(() => FakeWebSocket.opened.at(-1)!.onopen?.({}));
			expect(await screen.findByTestId("footer-live-strip")).toBeInTheDocument();

			// The socket opened 18 minutes ago; now the browser drops off the network.
			vi.setSystemTime(Date.parse(GOT_AT) + 18 * 60 * 1000);
			goOffline();
			// Every reconnect fails until the stream falls back to polling, and the polls fail too.
			for (let i = 0; i < 6; i += 1)
			{
				act(() => FakeWebSocket.opened.at(-1)!.onclose?.({}));
				await act(async () =>
				{
					await vi.advanceTimersByTimeAsync(31 * 1000);
				});
			}
			// The fallen-back stream's minutes have passed too, so the age has moved on from 18m.
			expectMarker(`You're offline. This game as of ${formatMomentSince(GOT_AT, new Date())} — `);
			expect(screen.getByTestId("notice-slot")).toHaveTextContent(/— (19|2\d)m ago\.$/);
			expect(screen.getByTestId("game-topbar")).toBeInTheDocument();
			expect(screen.queryByText("Couldn't load this room")).toBeNull();
			expectPlainFooter();
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("S74 AC 2 never-viewed room: only \"You're offline.\" over empty content, no explanation, no error, a plain footer", async () =>
	{
		serveApi();
		renderAt("/games/2026-09-05");
		await screen.findAllByTestId("scoreboard-module");
		goOffline();

		// A game the scoreboard lists but nobody opened while online.
		await userEvent.click(within(screen.getAllByTestId("scoreboard-module")[0]!).getAllByRole("link")[0]!);
		const marker = await screen.findByText("You're offline.");
		expect(marker.closest("[data-testid=notice-slot]")).not.toBeNull();
		expect(screen.getByTestId("game-topbar")).toBeInTheDocument();
		expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
		expect(screen.queryAllByRole("tabpanel")).toHaveLength(0);
		expect(screen.queryByText("Couldn't load this room")).toBeNull();
		expect(screen.queryByText(/as of/)).toBeNull();
		expectPlainFooter();
	});

	it("S74 AC 2 never-viewed room, with no day in the cache: only the marker, still no error", async () =>
	{
		serveApi();
		online = false;
		renderAt("/game/823823/box");
		const marker = await screen.findByText("You're offline.");
		expect(marker.closest("[data-testid=notice-slot]")).not.toBeNull();
		expect(screen.queryByText("Couldn't load this room")).toBeNull();
	});

	it("S74 AC 2 with update: offline and the update notice show together, the marker in the slot and the notice floating", async () =>
	{
		serveApi();
		renderAt("/games/2026-09-05");
		await screen.findAllByTestId("scoreboard-module");
		goOffline();
		act(() => announceUpdate(null));
		expectMarker(SCORES);
		const float = screen.getByTestId("notice-float");
		expect(float).toHaveTextContent("An update to Baseball Theater is ready.");
		expect(within(float).getByRole("button", {
			name: "Update Now",
		})).toBeInTheDocument();
	});
});

describe("offline copies obey Hide Scores (S74 AC 3)", () =>
{
	/** Hide Scores on, as a signed-in reader's settings say (`useScoresHidden` reads the store). */
	async function hideScores(): Promise<void>
	{
		vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		}))));
		await hydrateSettings("test-user");
	}

	it("S74 AC 3 scoreboard: the saved day's scores stay masked offline, as online", async () =>
	{
		await hideScores();
		serveApi();
		renderAt("/games/2026-09-05");
		await screen.findAllByTestId("scoreboard-module");
		const online = screen.getAllByTestId(/^hidden-/).length;
		expect(online).toBeGreaterThan(0);
		goOffline();
		expectMarker(SCORES);
		expect(screen.getAllByTestId(/^hidden-/)).toHaveLength(online);
	});

	it("S74 AC 3 cold start: opened offline with a stored session BT can't confirm, the stored Hide Scores still masks the stored day", async () =>
	{
		await hideScores();
		setSessionToken(DEV_SIGN_IN_TOKEN);
		online = false;
		// The worker answers the day from its stored copy; /api/v1/me is never stored, so it fails.
		const fetchMock = vi.fn((request: Request) => (new URL(request.url).pathname === "/api/v1/schedule"
			? Promise.resolve(jsonResponse(scheduleDay()))
			: Promise.reject(new TypeError("Failed to fetch"))));
		vi.stubGlobal("fetch", fetchMock);
		renderAt("/games/2026-09-05", true);
		await screen.findAllByTestId("scoreboard-module");
		await waitFor(() => expect(fetchMock.mock.calls.some(([request]) => new URL(request.url).pathname === "/api/v1/me")).toBe(true));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(screen.getAllByTestId(/^hidden-/).length).toBeGreaterThan(0);
	});

	it("S74 AC 3 room: the saved game's linescore stays masked offline, as online", async () =>
	{
		await hideScores();
		serveApi();
		renderAt("/game/823823/plays");
		const cells = () => within(screen.getByRole("table", {
			name: "Linescore",
		})).getAllByRole("row").slice(1).flatMap((row) => [...row.querySelectorAll("td")].map((td) => td.textContent).filter((text) => text !== ""));
		await screen.findByRole("table", {
			name: "Linescore",
		});
		const online = cells();
		expect(online.length).toBeGreaterThan(0);
		expect(online.every((cell) => cell === "–")).toBe(true);
		goOffline();
		expectMarker(THIS_GAME);
		expect(cells()).toEqual(online);
	});
});
