/**
 * S66: the scoreboard to the ratified shell-scoreboard frames, on the S65 fixtures —
 * a finished game from `schedule-2026-09-05.json` and 823823 before first pitch and in
 * progress from `schedule-823823-moments.json` (folded from its recording, never typed).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { contrastSafeTeamColor, formatGameTime } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import { writeScheduleDay } from "../api/schedule.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { viewerTimeZone } from "../format/datetime.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import type { LayoutVariant } from "../layout/variant.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { resetSettings, setFavoriteTeams } from "../settings/store.js";
import { createRenderCounter } from "../test/renderCount.js";
import { ScoreboardPage } from "./ScoreboardPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

type Game = ScheduleDayPayload["games"][number];

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

/**
 * 2026-09-05 with one game in each phase: SF @ NYM final 9–5, and 823823 (CHC @ MIA)
 * in progress and before first pitch. The pre-game copy is the same game at another
 * moment, so it gets its own key to render beside the live one.
 */
function day(games?: Game[]): ScheduleDayPayload
{
	const schedule = read<ScheduleDayPayload>("schedule-2026-09-05.json");
	const moments = read<{ pregame: Game;
		live: Game; }>("schedule-823823-moments.json");
	return {
		...schedule,
		games: games ?? [schedule.games[0]!, moments.live, {
			...moments.pregame,
			gamePk: 1,
		}],
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version: 1,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	};
}

function Location()
{
	return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderScoreboard(variant: LayoutVariant = "mobile", client: QueryClient = createQueryClient(), wrap = (node: React.ReactNode) => node)
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/games/2026-09-05"]}>
					{wrap(
						<Routes>
							<Route path="/games/:date" element={<><ScoreboardPage variant={variant} /><Location /></>} />
						</Routes>,
					)}
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** The day digest (S71) is asked beside the schedule; these tests answer it with none. */
function orDigest(request: Request, body: unknown): Response
{
	return new URL(request.url).pathname === "/api/v1/digest" ? jsonResponse({
		date: "2026-09-05",
		items: [],
	}) : jsonResponse(body);
}

function serve(body: ScheduleDayPayload = day())
{
	const fetchMock = vi.fn((request: Request) => Promise.resolve(orDigest(request, body)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function modules(): Promise<HTMLElement[]>
{
	return screen.findAllByTestId("scoreboard-module");
}

function byPhase(all: HTMLElement[], phase: string): HTMLElement
{
	return all.find((m) => m.dataset.phase === phase)!;
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("ScoreboardModule (S66)", () =>
{
	it("final: FINAL, R·H·E per team and ABBR (W-L) via teamRecordLabel", async () =>
	{
		serve();
		renderScoreboard();
		const final = byPhase(await modules(), "final");
		const m = within(final);
		expect(m.getByText("FINAL")).toBeInTheDocument();
		expect(m.getByText("Giants")).toBeInTheDocument();
		expect(m.getByText("SF (59-84)")).toBeInTheDocument();
		expect(m.getByText("NYM (64-78)")).toBeInTheDocument();
		expect(m.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["9", "5"]);
		expect(m.getAllByTestId("hits").map((c) => c.textContent)).toEqual(["10", "5"]);
		expect(m.getAllByTestId("errors").map((c) => c.textContent)).toEqual(["1", "0"]);
		expect(m.getByRole("link", {
			name: "Giants at Mets",
		})).toHaveAttribute("href", "/game/823577");
	});

	it("live: the blinking LiveIndicator labeled with inningShortLabel, R·H·E and records", async () =>
	{
		serve();
		renderScoreboard();
		const m = within(byPhase(await modules(), "live"));
		expect(m.getByTestId("status-marker-dot")).toBeInTheDocument();
		expect(m.getByText("Top 3")).toBeInTheDocument();
		expect(m.getByText("CHC (81-62)")).toBeInTheDocument();
		expect(m.getAllByTestId("runs").map((c) => c.textContent)).toEqual(["1", "0"]);
		expect(m.getAllByTestId("hits").map((c) => c.textContent)).toEqual(["5", "0"]);
	});

	it("scheduled: start time via formatGameTime, the venue, and records as W - L (.pct); no R·H·E", async () =>
	{
		serve();
		renderScoreboard();
		const m = within(byPhase(await modules(), "pregame"));
		expect(m.getByText(formatGameTime("2026-09-05T20:10:00Z", viewerTimeZone()))).toBeInTheDocument();
		expect(m.getByText("· loanDepot park")).toBeInTheDocument();
		expect(m.getByText("81 - 62 (.566)")).toBeInTheDocument();
		expect(m.queryByText("R")).toBeNull();
		expect(m.queryAllByTestId("runs")).toHaveLength(0);
	});

	it("venue renders on the scheduled module only", async () =>
	{
		serve();
		renderScoreboard();
		const all = await modules();
		expect(within(byPhase(all, "pregame")).getByText(/loanDepot park/)).toBeInTheDocument();
		expect(within(byPhase(all, "live")).queryByText(/loanDepot park/)).toBeNull();
		expect(within(byPhase(all, "final")).queryByText(/Citi Field/)).toBeNull();
	});

	it("edge: each team row has a TeamEdge in contrastSafeTeamColor", async () =>
	{
		serve();
		renderScoreboard();
		const final = byPhase(await modules(), "final");
		const edges = within(final).getAllByTestId("team-edge");
		expect(edges).toHaveLength(2);
		expect(edges[0]).toHaveStyle({
			background: contrastSafeTeamColor(137),
		});
		expect(edges[1]).toHaveStyle({
			background: contrastSafeTeamColor(121),
		});
		for (const row of screen.getAllByTestId("team-row"))
		{
			expect(within(row).getByTestId("team-edge")).toBeInTheDocument();
		}
	});
});

describe("ScoreboardPage layout (S66)", () =>
{
	it.each([
		["mobile", "1"],
		["medium", "2"],
		["desktop", "3"],
	] as const)("columns: %s lays modules in %s column(s)", async (variant, cols) =>
	{
		serve();
		renderScoreboard(variant);
		await modules();
		const grid = screen.getByTestId("scoreboard-grid");
		expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
	});

	it("columns: three games per row on wide screens, then two, then one as the width shrinks, and the loading skeleton matches (#429)", async () =>
	{
		const counts: string[] = [];
		for (const variant of ["desktop", "medium", "mobile"] as const)
		{
			serve();
			const { unmount } = renderScoreboard(variant);
			await modules();
			counts.push(getComputedStyle(screen.getByTestId("scoreboard-grid")).getPropertyValue("--sg-cols"));
			unmount();
		}
		expect(counts).toEqual(["3", "2", "1"]);
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderScoreboard("desktop");
		expect(getComputedStyle(screen.getByRole("status", {
			name: "Loading",
		})).getPropertyValue("--sg-cols")).toBe("3");
	});

	it("date control: previous and next go to the day before and after", async () =>
	{
		serve();
		const user = userEvent.setup();
		renderScoreboard();
		const control = await screen.findByTestId("date-control");
		expect(within(control).getByText("Sep 5, 2026")).toBeInTheDocument();
		await user.click(within(control).getByRole("link", {
			name: "Next day",
		}));
		expect(screen.getByTestId("location")).toHaveTextContent("/games/2026-09-06");
		await user.click(within(screen.getByTestId("date-control")).getByRole("link", {
			name: "Previous day",
		}));
		await user.click(within(screen.getByTestId("date-control")).getByRole("link", {
			name: "Previous day",
		}));
		expect(screen.getByTestId("location")).toHaveTextContent("/games/2026-09-04");
	});
});

describe("ScoreboardPage game order (#430)", () =>
{
	/**
	 * Three games given earliest first, as MLB sends them: CHC @ MIA before first pitch at 17:00,
	 * SF @ NYM final from 20:10, and CHC @ MIA in progress from 21:00 (start times set here, so the
	 * order is the test's own).
	 */
	function ordered(): ScheduleDayPayload
	{
		const schedule = read<ScheduleDayPayload>("schedule-2026-09-05.json");
		const moments = read<{ pregame: Game;
			live: Game; }>("schedule-823823-moments.json");
		return day([{
			...moments.pregame,
			gamePk: 1,
			startTime: "2026-09-05T17:00:00Z",
		}, {
			...schedule.games[0]!,
			startTime: "2026-09-05T20:10:00Z",
		}, {
			...moments.live,
			startTime: "2026-09-05T21:00:00Z",
		}]);
	}

	afterEach(() => resetSettings());

	it("default order: a favorite team's game first, then games in progress, then by start time, earliest first (#430)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
		await setFavoriteTeams([137]);
		serve(ordered());
		renderScoreboard("medium");
		expect((await modules()).map((m) => m.dataset.phase)).toEqual(["final", "live", "pregame"]);
	});

	it("sort control: offers the default and start time; start time orders every game earliest first, and a new visit opens on the default (#430)", async () =>
	{
		serve(ordered());
		const user = userEvent.setup();
		const { unmount } = renderScoreboard("medium");
		expect((await modules()).map((m) => m.dataset.phase)).toEqual(["live", "pregame", "final"]);
		await user.click(screen.getByRole("button", {
			name: "Sort: Favorites, live first",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "Start time",
		}));
		expect(screen.getAllByTestId("scoreboard-module").map((m) => m.dataset.phase)).toEqual(["pregame", "final", "live"]);
		expect(screen.getByRole("button", {
			name: "Sort: Start time",
		})).toBeInTheDocument();
		unmount();
		renderScoreboard("medium");
		expect((await modules()).map((m) => m.dataset.phase)).toEqual(["live", "pregame", "final"]);
	});
});

describe("ScoreboardPage states (S66, ViewState)", () =>
{
	it("empty: one muted sentence when the day has no games", async () =>
	{
		serve(day([]));
		renderScoreboard();
		expect(await screen.findByText("No games scheduled for this date.")).toBeInTheDocument();
		expect(screen.queryAllByTestId("scoreboard-module")).toHaveLength(0);
		expect(screen.getByTestId("date-control")).toBeInTheDocument();
	});

	it("loading: the page title is kept above the loader", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderScoreboard();
		expect(screen.getByRole("heading", {
			name: "Sep 5, 2026 Scoreboard",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.getByTestId("date-control")).toBeInTheDocument();
	});

	it("loading: an animated skeleton of the day's game cards, not a spinner (#431)", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderScoreboard();
		const loading = screen.getByLabelText("Loading");
		expect(loading.querySelector(".mantine-Loader-root")).toBeNull();
		const cards = within(loading).getAllByTestId("skeleton-card");
		expect(cards.length).toBeGreaterThan(1);
		for (const card of cards)
		{
			expect(card).toHaveClass("mantine-Skeleton-root");
			expect(card).toHaveAttribute("data-animate", "true");
		}
	});

	it("error: Couldn't load games, the hint, and Retry refetches", async () =>
	{
		const fetchMock = vi.fn((_request: Request) => Promise.resolve(jsonResponse({
			error: "unavailable",
		}, 503)));
		vi.stubGlobal("fetch", fetchMock);
		const user = userEvent.setup();
		renderScoreboard();
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load games")).toBeInTheDocument();
		expect(within(alert).getByText("Check your connection and try again")).toBeInTheDocument();
		const calls = fetchMock.mock.calls.length;
		fetchMock.mockImplementation((request: Request) => Promise.resolve(orDigest(request, day())));
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
		expect(await modules()).toHaveLength(3);
	});
});

describe("ScoreboardPage render count (S66, ADR-026)", () =>
{
	it("render count: one schedule update commits the scoreboard a fixed number of times", async () =>
	{
		// Count with reduced motion on, so the page arms no animation timer that can land in the
		// counting window (#394, B394). The date control's closed mobile Drawer (S125) otherwise starts
		// Mantine's 200 ms scroll-lock timer on mount (`useLockScroll`, from its transition duration);
		// its same-value state update commits the Drawer once, and on a loaded machine that commit
		// arrives after `counter.reset()`, counting 2 for a schedule update that committed once. With
		// reduced motion the duration is 0 and the timer is cleared during mount.
		const matchMedia = window.matchMedia;
		vi.stubGlobal("matchMedia", (query: string) => ({
			...matchMedia(query),
			matches: query === "(prefers-reduced-motion: reduce)",
		}));
		serve();
		const client = createQueryClient();
		const counter = createRenderCounter("scoreboard");
		renderScoreboard("mobile", client, (node) => <counter.Counted>{node}</counter.Counted>);
		await modules();
		// Let the page's other answers land before counting: the day digest's (S71), and the
		// calendar's month and default day (S125), which a loaded machine can deliver late.
		await waitFor(() => expect(client.isFetching()).toBe(0));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		counter.reset();
		const next = day();
		await act(async () =>
		{
			writeScheduleDay(client, {
				...next,
				version: 2,
			});
		});
		// The cache notifies its readers on the next tick; then let any follow-up commits land.
		await waitFor(() => expect(counter.count()).toBeGreaterThan(0));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
		// Baseline (S66, ADR-026), measured 2026-10-30: one cache update commits the
		// scoreboard once. A rise means a schedule refresh re-renders more than it should.
		expect(counter.count()).toBe(1);
	});
});

describe("ScoreboardPage without a date (S111)", () =>
{
	/** `/games` with no day: the page asks the server for its default day. */
	function renderUndated()
	{
		return render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={["/games"]}>
						<Routes>
							<Route path="/games" element={<ScoreboardPage variant="mobile" />} />
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
	}

	/** Answers the default-date route with `defaultDate` (a status for a failure, null to never answer). */
	function serveUndated(defaultDate: string | number | null)
	{
		const fetchMock = vi.fn((request: Request) =>
		{
			if (new URL(request.url).pathname !== "/api/v1/scoreboard/default-date") return Promise.resolve(orDigest(request, day()));
			if (defaultDate === null) return new Promise<Response>(() => undefined);
			return Promise.resolve(typeof defaultDate === "number" ? jsonResponse({
				error: "upstream",
			}, defaultDate) : jsonResponse({
				date: defaultDate,
			}));
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	/** The `date` each schedule request asked for. */
	function scheduleDates(fetchMock: ReturnType<typeof vi.fn>): string[]
	{
		return fetchMock.mock.calls
			.map(([request]) => new URL((request as Request).url))
			.filter((url) => url.pathname === "/api/v1/schedule")
			.map((url) => url.searchParams.get("date")!);
	}

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("without a date: opens the server's default day", async () =>
	{
		const fetchMock = serveUndated("2026-09-05");
		renderUndated();
		expect(await modules()).toHaveLength(3);
		expect(scheduleDates(fetchMock)).toEqual(["2026-09-05"]);
	});

	it("default date loading: ViewState's loader until the day is known, no date control yet", () =>
	{
		serveUndated(null);
		renderUndated();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.queryByTestId("date-control")).toBeNull();
	});

	it("default date fails: opens MLB's today, the Eastern date", async () =>
	{
		// 23:30 Eastern on 2026-09-05 (already the 6th in UTC).
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		vi.setSystemTime(new Date("2026-09-06T03:30:00Z"));
		const fetchMock = serveUndated(503);
		renderUndated();
		await modules();
		expect(scheduleDates(fetchMock)).toEqual(["2026-09-05"]);
	});
});

describe("ScoreboardPage footer (S148)", () =>
{
	it("S148 AC 1 scoreboard: a day with a game in progress draws no footer of its own (the shell does, S142) and no strip until S149 opens its socket: no 'Fetched … ago', no 'baseball.theater'", async () =>
	{
		serve();
		const { container } = renderScoreboard();
		await modules();
		expect(screen.queryByRole("contentinfo")).toBeNull();
		expect(container).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});
});

/** The browser WebSocket, stood in: every one opened is kept so a test can open or drop it. */
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

	static last(): FakeWebSocket
	{
		return FakeWebSocket.opened.at(-1)!;
	}
}

/**
 * The scoreboard inside the shell, which draws the site footer (S142): the page tells it through `setFooter` whether
 * its day's socket is open. Signed out: `/api/v1/me` answers 401; every other request as `serve` set it.
 */
function renderScoreboardInShell(client: QueryClient = createQueryClient())
{
	setSessionToken(null);
	const served = vi.mocked(fetch);
	vi.stubGlobal("fetch", vi.fn((request: Request) => new URL(request.url).pathname === "/api/v1/me"
		? Promise.resolve(jsonResponse({
			error: "unauthorized",
		}, 401))
		: served(request)));
	return render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<SessionProvider>
					<MemoryRouter initialEntries={["/games/2026-09-05"]}>
						<AppShellLayout>
							{(variant, setFooter) => (
								<Routes>
									<Route path="/games/:date" element={<ScoreboardPage variant={variant} setFooter={setFooter} />} />
								</Routes>
							)}
						</AppShellLayout>
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

describe("ScoreboardPage live marker (S149)", () =>
{
	beforeEach(() =>
	{
		FakeWebSocket.opened = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});

	const strip = () => screen.queryByTestId("footer-live-strip");

	it("S149 AC 7 open shows the Live marker: a day in its window opens its socket, and the footer's Live strip shows exactly while it is open", async () =>
	{
		serve();
		renderScoreboardInShell();
		await modules();
		await vi.waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		expect(FakeWebSocket.last().url).toContain("/api/v1/schedule/live?date=2026-09-05");
		expect(strip()).toBeNull();
		act(() => FakeWebSocket.last().onopen?.({}));
		await waitFor(() => expect(strip()).not.toBeNull());
		expect(within(strip()!).getByText("Live Data · Active")).toBeInTheDocument();
	});

	it("S149 AC 6 the day query starts no refetch interval while its day is in its window, open or waiting to reconnect", async () =>
	{
		serve();
		const client = createQueryClient();
		renderScoreboardInShell(client);
		await modules();
		await vi.waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		const intervals = () =>
		{
			const query = client.getQueryCache().find({
				queryKey: ["schedule", "2026-09-05"],
			})!;
			return query.observers.map((observer) =>
			{
				const option = observer.options.refetchInterval;
				return typeof option === "function" ? option(query as never) : option;
			});
		};
		await waitFor(() => expect(intervals()).toEqual([false]));
		act(() => FakeWebSocket.last().onopen?.({}));
		expect(intervals()).toEqual([false]);
		act(() => FakeWebSocket.last().onclose?.({}));
		expect(intervals()).toEqual([false]);
	});

	it("S149 AC 7 closed, reconnecting, polling and out-of-window show no marker: a dropped socket hides it, and a finished day never opens one", async () =>
	{
		serve();
		const { unmount } = renderScoreboardInShell();
		await modules();
		await vi.waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		act(() => FakeWebSocket.last().onopen?.({}));
		await waitFor(() => expect(strip()).not.toBeNull());
		// Closed: the stream waits to reconnect (and, after enough drops, polls); neither is open.
		act(() => FakeWebSocket.last().onclose?.({}));
		await waitFor(() => expect(strip()).toBeNull());
		unmount();
		FakeWebSocket.opened = [];
		// Out of its window: only the finished game, long over.
		serve(day([read<ScheduleDayPayload>("schedule-2026-09-05.json").games[0]!]));
		renderScoreboardInShell();
		await modules();
		await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
		expect(FakeWebSocket.opened).toHaveLength(0);
		expect(strip()).toBeNull();
	});
});
