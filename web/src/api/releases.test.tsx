/**
 * S134: the releases hook asks again once its answer is older than the API's whole cache budget
 * (`max-age=240` plus `stale-while-revalidate=60`, S132), so a tab open across a deploy reads the new
 * notes on its next focus, and doesn't ask again before then.
 */
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { createQueryClient } from "./queryClient.js";
import { useReleases } from "./releases.js";

afterEach(() =>
{
	vi.useRealTimers();
	vi.unstubAllGlobals();
	focusManager.setFocused(undefined);
});

async function focusAfter(ms: number)
{
	vi.setSystemTime(Date.now() + ms);
	focusManager.setFocused(false);
	focusManager.setFocused(true);
	// Give a refetch, if any, a turn to start.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useReleases freshness (S134)", () =>
{
	it("S134 AC 1: refetches on focus after 300s, not before", async () =>
	{
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
			current: null,
			releases: [],
		})));
		vi.stubGlobal("fetch", fetchMock);
		const client = createQueryClient();
		const { result } = renderHook(() => useReleases(), {
			wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await focusAfter(299_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await focusAfter(2_000);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});
});
