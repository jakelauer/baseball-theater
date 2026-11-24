/**
 * S125 AC 2 and AC 8: the one month hook, and which months it may ask for; and its freshness (#399):
 * a month whose days are known is kept for five minutes, but one whose days BT couldn't say (a fill
 * that failed) is asked again on the next read, so the calendar doesn't hold a month with no game
 * labels for five minutes. S194 AC 7: the hook asks for a month with its year's version.
 */
import { CACHE_LIFETIME_FLOOR_MS, scheduleMonthVersion } from "@bt/domain";
import {
	focusManager, onlineManager, QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
	act, cleanup, renderHook,
} from "@testing-library/react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { createQueryClient } from "./queryClient.js";
import type { ScheduleMonthPayload } from "./scheduleMonth.js";
import {
	scheduleMonthAnswerable, scheduleMonthKey, scheduleMonthQueryOptions, scheduleMonthVersionsKey, useScheduleMonth,
} from "./scheduleMonth.js";

describe("scheduleMonth (S125)", () =>
{
	const now = new Date("2026-09-21T16:00:00Z");

	it.each([
		["1901-04", true],
		["2026-09", true],
		["2027-12", true],
		["1901-03", false],
		["1850-01", false],
		["2028-01", false],
		["2099-07", false],
		["2026-13", false],
	])("S125 AC 8: %s answerable: %s", (month, answerable) =>
	{
		expect(scheduleMonthAnswerable(month, now)).toBe(answerable);
	});

	it("S125 AC 2: one key per month, and a month S124 can't answer is never fetched", () =>
	{
		expect(scheduleMonthKey("2026-09")).toEqual(["schedule-month", "2026-09"]);
		expect(scheduleMonthQueryOptions("2026-09").enabled).toBe(true);
		expect(scheduleMonthQueryOptions("1850-01").enabled).toBe(false);
	});
});

/** A June 2026 answer whose every day has `count` (and teams and season flag to match). */
function june(count: number | null): ScheduleMonthPayload
{
	return {
		month: "2026-06",
		days: Array.from({
			length: 30,
		}, (_, i) => ({
			date: `2026-06-${String(i + 1).padStart(2, "0")}`,
			count,
			teamIds: count === null ? null : [],
			regularSeason: count === null ? null : false,
		})),
	};
}

/** How many requests two reads make, `apart` ms apart, when every request answers `payload`. */
async function requestsForTwoReads(payload: ScheduleMonthPayload, apart: number): Promise<number>
{
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	try
	{
		const client = createQueryClient();
		const queryFn = vi.fn(async () => payload);
		const options = {
			...scheduleMonthQueryOptions("2026-06"),
			queryFn,
		};
		await client.fetchQuery(options);
		vi.setSystemTime(Date.now() + apart);
		await client.fetchQuery(options);
		return queryFn.mock.calls.length;
	}
	finally
	{
		vi.useRealTimers();
	}
}

/** June 2026 with its 3rd stored (three games) and every other day unknown: a fill that failed around one held day. */
function partlyKnown(): ScheduleMonthPayload
{
	const month = june(null);
	month.days[2] = {
		...month.days[2]!,
		count: 3,
		teamIds: [],
		regularSeason: true,
	};
	return month;
}

const SECOND = 1000;

describe("schedule month freshness (#399)", () =>
{
	it("a month with unknown days is asked again a minute later, not held as a month with no game labels for five (#399)", async () =>
	{
		expect(await requestsForTwoReads(june(null), 61 * SECOND)).toBe(2);
	});

	it("a month only partly known is asked again a minute later too (#399)", async () =>
	{
		expect(await requestsForTwoReads(partlyKnown(), 61 * SECOND)).toBe(2);
	});

	it("a month with unknown days is not asked again within the minute, so focus and remounts don't hammer the API (#399)", async () =>
	{
		expect(await requestsForTwoReads(june(null), 30 * SECOND)).toBe(1);
	});

	it("a month whose days are known is read from the cache for five minutes", async () =>
	{
		expect(await requestsForTwoReads(june(0), 61 * SECOND)).toBe(1);
		expect(await requestsForTwoReads(june(3), 61 * SECOND)).toBe(1);
	});
});

/**
 * Serves the versions route with `versions()` (an answer, or a status to fail with, or a thrown
 * network error) and every month with `month()` (June with two games a day unless given); returns
 * the month requests' URLs.
 */
function serveVersions(versions: () => Record<string, string> | number | Error, month: () => ScheduleMonthPayload = () => june(2)): () => URL[]
{
	const months: URL[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/v1/schedule/month-versions/"))
		{
			const answer = versions();
			if (answer instanceof Error) throw answer;
			return typeof answer === "number" ? jsonResponse({
				error: "boom",
			}, answer) : jsonResponse({
				year: 2026,
				versions: answer,
			});
		}
		if (url.pathname.startsWith("/api/v1/schedule/month/"))
		{
			months.push(url);
			return jsonResponse(month());
		}
		return jsonResponse({}, 404);
	}));
	return () => months;
}

/** Mounts `useScheduleMonth("2026-06")` on a fresh client; resolves once the month has an answer. */
async function renderJune()
{
	const client = createQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	const hook = renderHook(() => useScheduleMonth("2026-06"), {
		wrapper,
	});
	await vi.waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
	return {
		client,
		hook,
	};
}

describe("S194 AC 7 the versioned month (web)", () =>
{
	afterEach(() =>
	{
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		onlineManager.setOnline(true);
	});

	it("S194 AC 7 offline other year: offline, a month of a year whose versions aren't held is asked without v and pauses, so the calendar shows numbers, not loading bars forever", async () =>
	{
		const months = serveVersions(() => ({
			"2026-06": "abc",
		}));
		const client = createQueryClient();
		const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
		const hook = renderHook(({ month }) => useScheduleMonth(month), {
			wrapper,
			initialProps: {
				month: "2026-06",
			},
		});
		await vi.waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
		act(() => onlineManager.setOnline(false));
		hook.rerender({
			month: "2025-06",
		});
		// The calendar reads a paused month with no data as bare numbers (`monthPhase`), never as loading.
		await vi.waitFor(() => expect(hook.result.current.fetchStatus).toBe("paused"));
		expect(hook.result.current.data).toBeUndefined();
		expect(client.getQueryState(["schedule-month", "2025-06"])?.fetchStatus).toBe("paused");
		expect(months()).toHaveLength(1);
	});

	it("S194 AC 7 key: with no version the month's key stays [\"schedule-month\", month]; with one it adds the version", () =>
	{
		expect(scheduleMonthKey("2026-06")).toEqual(["schedule-month", "2026-06"]);
		expect(scheduleMonthQueryOptions("2026-06").queryKey).toEqual(["schedule-month", "2026-06"]);
		expect(scheduleMonthQueryOptions("2026-06", "abc").queryKey).toEqual(["schedule-month", "2026-06", "abc"]);
		expect(scheduleMonthVersionsKey("2026")).toEqual(["schedule-month-versions", "2026"]);
	});

	it("S194 AC 7 with v: the month is asked with ?v= from its year's versions answer, one shared query per year", async () =>
	{
		const months = serveVersions(() => ({
			"2026-06": "abc",
		}));
		const { client } = await renderJune();
		expect(months().map((url) => `${url.pathname}${url.search}`)).toEqual(["/api/v1/schedule/month/2026-06?v=abc"]);
		expect(client.getQueryData(["schedule-month", "2026-06", "abc"])).toEqual(june(2));
		expect(client.getQueryData(["schedule-month-versions", "2026"])).toEqual({
			year: 2026,
			versions: {
				"2026-06": "abc",
			},
		});
	});

	it("S194 AC 7 after the floor: once the versions answer is older than the floor, a changed version makes a new month request", async () =>
	{
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		// The first version is the hash of what the month answers, so that answer is never asked again.
		const first = scheduleMonthVersion(june(2));
		let version = first;
		const months = serveVersions(() => ({
			"2026-06": version,
		}));
		const { hook } = await renderJune();
		version = "def";
		// Inside the floor a focus asks nothing again.
		await act(async () =>
		{
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		expect(months().map((url) => url.search)).toEqual([`?v=${first}`]);
		vi.setSystemTime(Date.now() + CACHE_LIFETIME_FLOOR_MS + 1000);
		await act(async () =>
		{
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		await vi.waitFor(() => expect(months().map((url) => url.search)).toEqual([`?v=${first}`, "?v=def"]));
		// The previous answer for the same month stays meanwhile, never a loading state.
		expect(hook.result.current.data).toEqual(june(2));
		focusManager.setFocused(undefined);
	});

	it("S194 AC 7 mismatched answer: a ?v= answer that doesn't hash to its version is asked again after five minutes", async () =>
	{
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		// The versions name the month after a change, but its first ?v= read lagged the write (a query
		// cache), answering the days from before it.
		const version = scheduleMonthVersion(june(3));
		let answer = june(2);
		const months = serveVersions(() => ({
			"2026-06": version,
		}), () => answer);
		const { hook } = await renderJune();
		expect(hook.result.current.data).toEqual(june(2));
		answer = june(3);
		// Inside five minutes a focus asks nothing again.
		await act(async () =>
		{
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		expect(months().map((url) => url.search)).toEqual([`?v=${version}`]);
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
		await act(async () =>
		{
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		await vi.waitFor(() => expect(months().map((url) => url.search)).toEqual([`?v=${version}`, `?v=${version}`]));
		await vi.waitFor(() => expect(hook.result.current.data).toEqual(june(3)));
		focusManager.setFocused(undefined);
	});

	it("S194 AC 7 left out: a month the versions answer leaves out is asked without v, under its plain key", async () =>
	{
		const months = serveVersions(() => ({
			"2026-05": "abc",
		}));
		const { client } = await renderJune();
		expect(months().map((url) => `${url.pathname}${url.search}`)).toEqual(["/api/v1/schedule/month/2026-06"]);
		expect(client.getQueryData(["schedule-month", "2026-06"])).toEqual(june(2));
	});

	const failures: [string, () => number | Error][] = [["an error answer", () => 500], ["a network failure", () => new Error("offline")]];
	it.each(failures)("S194 AC 7 versions fail: %s for the versions asks for the month without v", async (_name, answer) =>
	{
		const months = serveVersions(answer);
		const { client } = await renderJune();
		expect(months().map((url) => url.search)).toEqual([""]);
		expect(client.getQueryData(["schedule-month", "2026-06"])).toEqual(june(2));
	});
});
