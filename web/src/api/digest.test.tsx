/**
 * #61: the day digest follows the `windowMode` the server declares, as the schedule does (S20).
 * A live day's digest is re-asked every `LIVE_REFRESH_MS` while the tab is visible; a finished
 * day's is asked once.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
	act, cleanup, renderHook,
} from "@testing-library/react";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { useDayDigest } from "./digest.js";
import type { DayDigestPayload } from "./digest.js";
import { LIVE_REFRESH_MS } from "./freshness.js";
import { createQueryClient } from "./queryClient.js";
import { jsonResponse } from "../test/jsonResponse.js";

/** Serves `payload` to every digest request; returns how many were asked. */
function serve(payload: DayDigestPayload): () => number
{
	const fetch = vi.fn((request: Request) => Promise.resolve(new URL(request.url).pathname === "/api/v1/digest" ? jsonResponse(payload) : jsonResponse({}, 404)));
	vi.stubGlobal("fetch", fetch);
	return () => fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === "/api/v1/digest").length;
}

async function renderDigest(): Promise<void>
{
	const client = createQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const { result } = renderHook(() => useDayDigest("2026-09-05"), {
		wrapper,
	});
	await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
}

beforeEach(() =>
{
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("useDayDigest refresh (#61)", () =>
{
	it("a live day's digest is asked again after one refresh interval", async () =>
	{
		const asked = serve({
			date: "2026-09-05",
			items: [],
			windowMode: "active",
		});
		await renderDigest();
		expect(asked()).toBe(1);
		await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
		await vi.waitFor(() => expect(asked()).toBe(2));
	});

	it("a finished day's digest is not asked again on an interval", async () =>
	{
		const asked = serve({
			date: "2026-09-05",
			items: [],
			windowMode: "cache",
		});
		await renderDigest();
		await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3));
		expect(asked()).toBe(1);
	});
});
