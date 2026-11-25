/**
 * S149: the scoreboard's live connection. `useLiveDay` opens one socket to the shown day while the cached day has a
 * game in its live window (re-judged each minute), writes each newer push into the day's cache at once (a push is the
 * whole day, so a gap is no reason to refetch), reports whether its socket is open, and closes it when the day leaves
 * its window, the day changes or the page unmounts; the day query stops re-asking while the day streams. A stand-in
 * `WebSocket` and fake timers drive it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	act, cleanup, renderHook,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import {
	isDayInWindow, LIVE_DAY_RECHECK_MS, useLiveDay,
} from "./live-day.js";
import { LIVE_TIMING, liveDayUrl } from "./live-stream.js";
import { createQueryClient } from "./queryClient.js";
import type { ScheduleDayPayload } from "./schedule.js";
import {
	scheduleKey, useScheduleDay, writeScheduleDay,
} from "./schedule.js";

const DATE = "2026-09-05";
const OTHER = "2026-09-06";
const NOW = new Date(`${DATE}T18:00:00Z`);
const HOUR = 60 * 60 * 1000;

type Game = ScheduleDayPayload["games"][number];

const template = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/schedule-2026-09-05.json"), "utf8")) as { games: Game[] }).games[0]!;

const STATUS = {
	live: {
		abstractGameState: "Live",
		codedGameState: "I",
		detailedState: "In Progress",
	},
	scheduled: {
		abstractGameState: "Preview",
		codedGameState: "S",
		detailedState: "Scheduled",
	},
	final: {
		abstractGameState: "Final",
		codedGameState: "F",
		detailedState: "Final",
	},
};

/** A game of `date` in `status`, first pitch at `startTime`, the home side on `runs`. */
function game(status: keyof typeof STATUS, startTime: string, runs = 0, date = DATE): Game
{
	return {
		...template,
		officialDate: date,
		gameDate: date,
		startTime,
		status: STATUS[status],
		linescore: template.linescore && {
			...template.linescore,
			teams: {
				...template.linescore.teams,
				home: {
					...template.linescore.teams.home,
					runs,
				},
			},
		},
	};
}

function day(version: number, games: Game[], date = DATE): ScheduleDayPayload
{
	return {
		date,
		games,
		fetchedAt: NOW.toISOString(),
		windowMode: "active",
		version,
		lastChangedAt: NOW.toISOString(),
	};
}

const liveDay = (version = 1, runs = 0, date = DATE) => day(version, [game("live", new Date(NOW.getTime() - HOUR).toISOString(), runs, date)], date);
const pastDay = (version = 1) => ({
	...day(version, [game("final", `${DATE}T02:00:00Z`)]),
	windowMode: "cache" as const,
});

/** The browser WebSocket, stood in: every one opened is kept so the test can open, push to or drop it. */
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

	push(payload: ScheduleDayPayload): void
	{
		this.onmessage?.({
			data: JSON.stringify(payload),
		});
	}
}

let served: Map<string, ScheduleDayPayload>;
let fetchMock: ReturnType<typeof vi.fn>;

/** The scoreboard's pairing as `ScoreboardDay` wires it: the live day, and the day query fed its in-window flag. */
function useScoreboard(date: string)
{
	const live = useLiveDay(date);
	useScheduleDay(date, live.inWindow);
	return live;
}

/** Renders the pairing for `date` over a cache already holding `cached` (as a fetch would leave it). */
function renderScoreboard(cached: ScheduleDayPayload)
{
	const client: QueryClient = createQueryClient();
	served.set(cached.date, cached);
	writeScheduleDay(client, cached);
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const hook = renderHook(({ date }: { date: string }) => useScoreboard(date), {
		wrapper,
		initialProps: {
			date: cached.date,
		},
	});
	/** The day query's refetch interval as its observer would schedule it now. */
	const refetchInterval = (date = cached.date) =>
	{
		const query = client.getQueryCache().find({
			queryKey: scheduleKey(date),
		})!;
		const option = query.observers[0]!.options.refetchInterval;
		return typeof option === "function" ? option(query as never) : option;
	};
	const cachedDay = (date = cached.date) => client.getQueryData<ScheduleDayPayload>(scheduleKey(date));
	return {
		...hook,
		client,
		refetchInterval,
		cachedDay,
	};
}

/** Lets the stream's lazy import and any queued promise settle under fake timers. */
const settle = () => act(async () =>
{
	await vi.advanceTimersByTimeAsync(0);
});
const sockets = (n: number) => vi.waitFor(() => expect(FakeWebSocket.opened).toHaveLength(n));

beforeEach(() =>
{
	vi.useFakeTimers({
		now: NOW,
	});
	FakeWebSocket.opened = [];
	served = new Map();
	vi.stubGlobal("WebSocket", FakeWebSocket);
	fetchMock = vi.fn((request: Request) => Promise.resolve(jsonResponse(served.get(new URL(request.url).searchParams.get("date") ?? "") ?? {})));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("useLiveDay (S149)", () =>
{
	it("S149 AC 6 in-window day connects and a push updates the scoreboard: one socket to the day's route, the push written to the day's cache", async () =>
	{
		const { cachedDay } = renderScoreboard(liveDay(1));
		await sockets(1);
		expect(FakeWebSocket.last().url).toBe(liveDayUrl(DATE, 1));
		expect(FakeWebSocket.last().url).toContain(`/api/v1/schedule/live?date=${DATE}&since=1`);
		act(() => FakeWebSocket.last().push(liveDay(2, 4)));
		expect(cachedDay()?.version).toBe(2);
		expect(cachedDay()?.games[0]?.linescore?.teams.home.runs).toBe(4);
	});

	it("S149 AC 6 open reports open: not open until the socket opens, open once it does", async () =>
	{
		const { result } = renderScoreboard(liveDay(1));
		await sockets(1);
		expect(result.current).toEqual({
			inWindow: true,
			open: false,
		});
		act(() => FakeWebSocket.last().onopen?.({}));
		expect(result.current).toEqual({
			inWindow: true,
			open: true,
		});
	});

	it("S149 AC 6 close, reconnect waits and polling report not open: a drop, each wait and the polling fallback are not open", async () =>
	{
		const { result } = renderScoreboard(liveDay(1));
		await sockets(1);
		act(() => FakeWebSocket.last().onopen?.({}));
		for (let i = 0; i < LIVE_TIMING.maxFailures; i++)
		{
			act(() => FakeWebSocket.last().onclose?.({}));
			expect(result.current.open).toBe(false);
			if (i < LIVE_TIMING.maxFailures - 1)
			{
				await act(async () =>
				{
					await vi.advanceTimersByTimeAsync(LIVE_TIMING.maxDelayMs);
				});
				expect(result.current.open).toBe(false);
			}
		}
		// Fallen back to polling the day: no new socket, still not open, and the stream polls.
		const fetches = fetchMock.mock.calls.length;
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(LIVE_TIMING.pollMs);
		});
		expect(FakeWebSocket.opened).toHaveLength(LIVE_TIMING.maxFailures);
		expect(fetchMock.mock.calls.length).toBeGreaterThan(fetches);
		expect(result.current).toEqual({
			inWindow: true,
			open: false,
		});
	});

	it("S149 AC 6 out-of-window day doesn't connect: a finished day opens no socket and isn't in its window", async () =>
	{
		const { result } = renderScoreboard(pastDay());
		await settle();
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(LIVE_DAY_RECHECK_MS);
		});
		expect(FakeWebSocket.opened).toHaveLength(0);
		expect(result.current).toEqual({
			inWindow: false,
			open: false,
		});
	});

	it("S149 AC 6 window opens 5 minutes later: a day whose only game's window opens in 5 minutes connects once the clock passes it", async () =>
	{
		const opensAt = NOW.getTime() + 5 * 60 * 1000;
		const { result } = renderScoreboard(day(1, [game("scheduled", new Date(opensAt + 2 * HOUR).toISOString())]));
		await settle();
		expect(FakeWebSocket.opened).toHaveLength(0);
		expect(result.current.inWindow).toBe(false);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
		});
		await sockets(1);
		expect(result.current.inWindow).toBe(true);
	});

	it("S149 AC 6 leaving its window closes the socket: a pushed day with no game in its window closes it, and the query settles to that day's polling policy", async () =>
	{
		const { result, refetchInterval } = renderScoreboard(liveDay(1));
		await sockets(1);
		act(() => FakeWebSocket.last().onopen?.({}));
		const socket = FakeWebSocket.last();
		expect(refetchInterval()).toBe(false);
		act(() => socket.push(pastDay(2)));
		// The cache tells its observers on the query client's next tick.
		await settle();
		expect(socket.close).toHaveBeenCalledTimes(1);
		expect(result.current).toEqual({
			inWindow: false,
			open: false,
		});
		// A `cache` day is not re-asked on the live cadence.
		expect(refetchInterval()).toBe(false);
		await settle();
		expect(FakeWebSocket.opened).toHaveLength(1);
	});

	it("S149 AC 6 switching days closes the old socket: the next day opens its own", async () =>
	{
		const { rerender, client } = renderScoreboard(liveDay(1));
		await sockets(1);
		const first = FakeWebSocket.last();
		served.set(OTHER, liveDay(1, 0, OTHER));
		writeScheduleDay(client, liveDay(1, 0, OTHER));
		rerender({
			date: OTHER,
		});
		expect(first.close).toHaveBeenCalledTimes(1);
		await sockets(2);
		expect(FakeWebSocket.last().url).toContain(`date=${OTHER}`);
	});

	it("S149 AC 6 no refetch interval during a reconnect wait: the day query leaves freshness to the stream", async () =>
	{
		const { result, refetchInterval } = renderScoreboard(liveDay(1));
		await sockets(1);
		expect(refetchInterval()).toBe(false);
		act(() => FakeWebSocket.last().onopen?.({}));
		act(() => FakeWebSocket.last().onclose?.({}));
		expect(FakeWebSocket.opened).toHaveLength(1);
		expect(result.current.open).toBe(false);
		expect(refetchInterval()).toBe(false);
	});

	it("S149 AC 4 five versions ahead: a push five versions ahead is applied at once, with no refetch", async () =>
	{
		const { cachedDay } = renderScoreboard(liveDay(1));
		await sockets(1);
		await settle();
		const fetches = fetchMock.mock.calls.length;
		act(() => FakeWebSocket.last().push(liveDay(6, 9)));
		await settle();
		expect(cachedDay()?.version).toBe(6);
		expect(cachedDay()?.games[0]?.linescore?.teams.home.runs).toBe(9);
		expect(fetchMock.mock.calls.length).toBe(fetches);
	});

	it("S149 AC 4 client: a duplicate and an older push change nothing; a newer one is written", async () =>
	{
		const { cachedDay } = renderScoreboard(liveDay(3, 3));
		await sockets(1);
		const held = cachedDay();
		act(() => FakeWebSocket.last().push(liveDay(3, 7)));
		expect(cachedDay()).toBe(held);
		act(() => FakeWebSocket.last().push(liveDay(2, 1)));
		expect(cachedDay()).toBe(held);
		act(() => FakeWebSocket.last().push(liveDay(4, 5)));
		expect(cachedDay()?.version).toBe(4);
		expect(cachedDay()?.games[0]?.linescore?.teams.home.runs).toBe(5);
	});

	it("S149 AC 4 reconnect passes since: after a push is applied, the reconnect asks for the day since that version", async () =>
	{
		renderScoreboard(liveDay(1));
		await sockets(1);
		act(() => FakeWebSocket.last().onopen?.({}));
		act(() => FakeWebSocket.last().push(liveDay(3, 2)));
		act(() => FakeWebSocket.last().onclose?.({}));
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(LIVE_TIMING.maxDelayMs);
		});
		await sockets(2);
		expect(FakeWebSocket.last().url).toBe(liveDayUrl(DATE, 3));
	});

	it("liveDayUrl: the day's live route on the page's host, wss under https, with since when known", () =>
	{
		expect(liveDayUrl(DATE, undefined, {
			protocol: "http:",
			host: "localhost:5173",
		})).toBe(`ws://localhost:5173/api/v1/schedule/live?date=${DATE}`);
		expect(liveDayUrl(DATE, 4, {
			protocol: "https:",
			host: "baseball.theater",
		})).toBe(`wss://baseball.theater/api/v1/schedule/live?date=${DATE}&since=4`);
	});

	it("isDayInWindow: no day is out of its window; a live game puts its day in", () =>
	{
		expect(isDayInWindow(undefined, NOW)).toBe(false);
		expect(isDayInWindow(liveDay(), NOW)).toBe(true);
		expect(isDayInWindow(pastDay(), NOW)).toBe(false);
	});
});
