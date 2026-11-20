/**
 * The standings client (S139 AC 7): the phase list goes out in the comma form, and the cache key
 * carries it in the season's order, reading as every phase when none is given.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { fetchStandings } from "./client.js";
import { createQueryClient } from "./queryClient.js";
import {
	standingsKey, standingsQueryOptions, useStandings,
} from "./standings.js";

/** The path and query of the one request the client sent through the stubbed fetch. */
function requestedPath(): string
{
	const request = vi.mocked(fetch).mock.calls[0]?.[0] as Request;
	const url = new URL(request.url);
	return decodeURIComponent(url.pathname + url.search);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("fetchStandings phases (S139)", () =>
{
	it("sends the phases comma-joined beside the date", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		await fetchStandings("2026-09-05", ["spring", "playoffs"]);
		expect(requestedPath()).toBe("/api/v1/standings?date=2026-09-05&includePhases=spring,playoffs");
	});

	it("with no phases asks as it did before: no includePhases", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		await fetchStandings("2026-09-05");
		expect(requestedPath()).toBe("/api/v1/standings?date=2026-09-05");
		vi.unstubAllGlobals();
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		await fetchStandings();
		expect(requestedPath()).toBe("/api/v1/standings");
	});

	it("an empty phase list asks as none does: every phase (the API has no \"no tables\" form)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		await fetchStandings("2026-09-05", []);
		expect(requestedPath()).toBe("/api/v1/standings?date=2026-09-05");
	});
});

describe("standingsQueryOptions and useStandings phases (S139)", () =>
{
	it("the query's fetch sends the phases it is keyed by", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		const options = standingsQueryOptions("2026-09-05", ["playoffs"]);
		expect(options.queryKey).toEqual(["standings", "2026-09-05", "playoffs"]);
		await (options.queryFn as () => Promise<unknown>)();
		expect(requestedPath()).toBe("/api/v1/standings?date=2026-09-05&includePhases=playoffs");
	});

	it("useStandings asks for the phases it is given", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
		const client = createQueryClient();
		const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, {
			client,
		}, children);
		const { result } = renderHook(() => useStandings("2026-09-05", ["playoffs"]), {
			wrapper,
		});
		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(requestedPath()).toBe("/api/v1/standings?date=2026-09-05&includePhases=playoffs");
	});
});

describe("standingsKey (S139)", () =>
{
	it("writes the phases in the season's order, so either order shares one entry", () =>
	{
		expect(standingsKey("2026-09-05", ["playoffs", "spring"])).toEqual(standingsKey("2026-09-05", ["spring", "playoffs"]));
		expect(standingsKey("2026-09-05", ["playoffs", "spring"])).toEqual(["standings", "2026-09-05", "spring,playoffs"]);
	});

	it("with no phases reads as every phase, and a different list is a different entry", () =>
	{
		expect(standingsKey(undefined)).toEqual(["standings", "today", "spring,regularSeason,playoffs"]);
		expect(standingsKey(undefined)).toEqual(standingsKey(undefined, ["playoffs", "regularSeason", "spring"]));
		expect(standingsKey("2026-09-05", ["spring"])).not.toEqual(standingsKey("2026-09-05"));
		expect(standingsKey("2026-09-05", [])).toEqual(standingsKey("2026-09-05")); // [] asks for every phase, so it is that entry
	});
});
