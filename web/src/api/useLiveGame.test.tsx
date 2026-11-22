/**
 * S148: `useLiveGame` tells the page two things apart: whether the game is in its window (the
 * stream is in charge, so the game query stops refetching) and whether the stream's socket is
 * open right now (pushes are arriving, so the Live marker shows). A stand-in `WebSocket` drives it.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, renderHook, waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { gameKey, useGame } from "./game.js";
import { useLiveGame } from "./live.js";
import { createQueryClient } from "./queryClient.js";

const PK = 823823;

/** The browser WebSocket, stood in: every one opened is kept so the test can open or drop it. */
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

/** The page's pairing as GamePage wires it: the stream, and the game query fed its in-window flag. */
function useGamePage(inWindow: boolean)
{
	const live = useLiveGame(PK, inWindow);
	useGame(PK, live.inWindow);
	return live;
}

function renderPage(inWindow = true)
{
	const client = createQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const hook = renderHook(({ on }: { on: boolean }) => useGamePage(on), {
		wrapper,
		initialProps: {
			on: inWindow,
		},
	});
	/** The game query's refetch interval as its observer would schedule it now. */
	const refetchInterval = () =>
	{
		const query = client.getQueryCache().find({
			queryKey: gameKey(PK),
		})!;
		const option = query.observers[0]!.options.refetchInterval;
		return typeof option === "function" ? option(query as never) : option;
	};
	return {
		...hook,
		refetchInterval,
	};
}

beforeEach(() =>
{
	FakeWebSocket.opened = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		gamePk: PK,
		version: 1,
		windowMode: "active",
	}))));
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("useLiveGame (S148)", () =>
{
	it("S148 AC 2: returns the in-window flag and the open state: not open until the socket opens, open once it does, not open once it drops", async () =>
	{
		const { result } = renderPage();
		await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		expect(result.current).toEqual({
			inWindow: true,
			open: false,
		});
		act(() => FakeWebSocket.last().onopen?.({}));
		expect(result.current).toEqual({
			inWindow: true,
			open: true,
		});
		act(() => FakeWebSocket.last().onclose?.({}));
		expect(result.current).toEqual({
			inWindow: true,
			open: false,
		});
	});

	it("S148 AC 2: during a reconnect wait the game query starts no refetch interval", async () =>
	{
		const { result, refetchInterval } = renderPage();
		await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		await waitFor(() => expect(refetchInterval()).toBe(false));
		act(() => FakeWebSocket.last().onopen?.({}));
		act(() => FakeWebSocket.last().onclose?.({}));
		// The stream now waits to reconnect: not open, and the query still leaves freshness to the stream.
		expect(FakeWebSocket.opened).toHaveLength(1);
		expect(result.current.open).toBe(false);
		expect(refetchInterval()).toBe(false);
	});

	it("S148 AC 2: leaving the window (and so the stream) is not open, and the socket closes", async () =>
	{
		const { result, rerender } = renderPage();
		await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		act(() => FakeWebSocket.last().onopen?.({}));
		expect(result.current.open).toBe(true);
		const socket = FakeWebSocket.last();
		rerender({
			on: false,
		});
		expect(result.current).toEqual({
			inWindow: false,
			open: false,
		});
		expect(socket.close).toHaveBeenCalledTimes(1);
	});

	it("S148 AC 2: out of its window, no socket and not open", async () =>
	{
		const { result } = renderPage(false);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(FakeWebSocket.opened).toHaveLength(0);
		expect(result.current).toEqual({
			inWindow: false,
			open: false,
		});
	});
});
