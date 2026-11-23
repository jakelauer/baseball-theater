/**
 * S125: the calendar's month grid (shell-scoreboard A8): counts, dimmed and disabled days, the
 * loading, failed and unknown months, S159's off-day ✕ and its tooltip, and S136's off-season line
 * (AC 2); the native month and year pickers and the range they offer (AC 3).
 */
import {
	act, cleanup, fireEvent, screen, waitFor, within,
} from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { MonthAnswer } from "../../test/calendar.js";
import {
	METS, monthPayload, RAYS, renderControl, serveCalendar, YANKEES,
} from "../../test/calendar.js";
import { resetSettings, setFavoriteTeams } from "../../settings/store.js";
import classes from "./CalendarPanel.module.css";
import { HOLD_MS } from "./CalendarPanel.js";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetSettings();
	onlineManager.setOnline(true);
});

const OTHER_A = 111;
const OTHER_B = 112;

/**
 * September 2026 for the mark: the 4th neither the Yankees nor the Mets play (red), the 11th only
 * the Yankees (yellow), the 28th no games, the 15th unknown, the 20th a postseason-only day both
 * miss, every other day both play.
 */
const MARKED = monthPayload("2026-09", (date) =>
{
	switch (date.slice(8))
	{
		case "04": return {
			count: 2,
			teamIds: [OTHER_A, OTHER_B],
		};
		case "11": return {
			count: 2,
			teamIds: [YANKEES, OTHER_B],
		};
		case "15": return {
			count: null,
		};
		case "20": return {
			count: 2,
			teamIds: [OTHER_A, OTHER_B],
			regularSeason: false,
		};
		case "28": return {
			count: 0,
		};
		default: return {
			count: 10,
		};
	}
});

function day(iso: string): HTMLElement
{
	return screen.getByTestId(`day-${iso}`);
}

function dayButton(iso: string): HTMLButtonElement
{
	return day(iso).closest("button")!;
}

function path(): string
{
	return screen.getByTestId("path").textContent!;
}

async function open(months: Record<string, MonthAnswer>, at = "/games/2026-09-21", favorites: number[] = [], today = "2026-09-21"): Promise<ReturnType<typeof userEvent.setup>>
{
	serveCalendar(months, today);
	if (favorites.length > 0) await setFavoriteTeams(favorites);
	const user = userEvent.setup();
	renderControl([at], "medium", today);
	await user.click(screen.getByTestId("date-selector"));
	await screen.findByTestId("calendar-panel");
	return user;
}

function marks(): string[]
{
	return [...document.querySelectorAll("[data-testid^=off-mark-]")].map((mark) =>
	{
		const iso = mark.closest("[data-testid^=day-]")!.getAttribute("data-testid")!.slice(4);
		return `${iso}:${mark.getAttribute("data-testid")!.slice(9)}`;
	});
}

describe("the month grid (S125 AC 2)", () =>
{
	it("S125 AC 2: the weekday row, each day's count as `N gm`, and a 0 or null day dimmed but pickable", async () =>
	{
		const user = await open({
			"2026-09": MARKED,
		});
		await screen.findAllByText("10 gm");
		const weekdays = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
		expect(weekdays).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
		expect(within(day("2026-09-01")).getByText("10 gm")).toBeInTheDocument();
		expect(within(day("2026-09-04")).getByText("2 gm")).toBeInTheDocument();
		expect(dayButton("2026-09-28")).toHaveClass(classes.dimmed!);
		expect(within(day("2026-09-28")).queryByText(/gm$/)).toBeNull();
		expect(dayButton("2026-09-15")).toHaveClass(classes.dimmed!);
		expect(dayButton("2026-09-01")).not.toHaveClass(classes.dimmed!);
		expect(dayButton("2026-09-28")).toBeEnabled();
		await user.click(day("2026-09-28"));
		await waitFor(() => expect(path()).toBe("/games/2026-09-28"));
	});

	it("S125 AC 2: a day before 1901-04-18 is disabled, with no count, not focusable and never dimmed", async () =>
	{
		await open({}, "/games/1901-04-20");
		await screen.findAllByText("10 gm");
		const april17 = screen.getByRole("button", {
			name: "17 April 1901",
		});
		expect(april17).toBeDisabled();
		expect(april17).not.toHaveClass(classes.dimmed!);
		expect(april17).toHaveTextContent(/^17$/);
		expect(within(day("1901-04-18")).getByText("10 gm")).toBeInTheDocument();
	});

	it("S125 AC 2: a month still loading shows a bar per day, nothing dimmed or marked, and its days stay pickable", async () =>
	{
		const user = await open({
			"2026-08": "pending",
			"2026-09": MARKED,
		}, "/games/2026-09-21", [YANKEES, METS]);
		await screen.findAllByText("10 gm");
		await user.click(screen.getByRole("button", {
			name: "Previous month",
		}));
		expect(screen.getAllByTestId("count-loading")).toHaveLength(31);
		expect(document.querySelectorAll(`.${classes.dimmed}`)).toHaveLength(0);
		expect(marks()).toEqual([]);
		expect(screen.queryByText("No games this month.")).toBeNull();
		await user.click(day("2026-08-10"));
		await waitFor(() => expect(path()).toBe("/games/2026-08-10"));
	});

	it("S125 AC 2: a month whose counts failed (a 500) shows numbers only: no count, nothing dimmed or marked, no message, days pickable", async () =>
	{
		const user = await open({
			"2026-08": {
				status: 500,
				error: "unavailable",
			},
			"2026-09": MARKED,
		}, "/games/2026-09-21", [YANKEES, METS]);
		await screen.findAllByText("10 gm");
		await user.click(screen.getByRole("button", {
			name: "Previous month",
		}));
		await waitFor(() => expect(screen.queryAllByTestId("count-loading")).toHaveLength(0));
		expect(screen.queryAllByText(/gm$/)).toHaveLength(0);
		expect(document.querySelectorAll(`.${classes.dimmed}`)).toHaveLength(0);
		expect(marks()).toEqual([]);
		expect(screen.queryByText(/Couldn't|No games/)).toBeNull();
		await user.click(day("2026-08-10"));
		await waitFor(() => expect(path()).toBe("/games/2026-08-10"));
	});

	it("S125 AC 2: S159's ✕ — red when no favorite plays, yellow when some do, none when all do, on a no-game, unknown or non-regular-season day; on the selected day it sits on a badge", async () =>
	{
		await open({
			"2026-09": MARKED,
		}, "/games/2026-09-04", [YANKEES, METS]);
		await screen.findAllByText("10 gm");
		expect(marks()).toEqual(["2026-09-04:red", "2026-09-11:yellow"]);
		expect(day("2026-09-04").querySelector(`.${classes.badge}`)).not.toBeNull();
		expect(day("2026-09-11").querySelector(`.${classes.badge}`)).toBeNull();
	});

	it("S125 AC 2: with no favorite teams (every signed-out visitor) no day is marked", async () =>
	{
		await open({
			"2026-09": MARKED,
		});
		await screen.findAllByText("10 gm");
		expect(marks()).toEqual([]);
	});

	it("S125 AC 2: hovering a marked day shows 'Off day: ' and the off favorites' names in the fan's order", async () =>
	{
		const user = await open({
			"2026-09": MARKED,
		}, "/games/2026-09-21", [METS, YANKEES]);
		await screen.findAllByText("10 gm");
		await user.hover(day("2026-09-04"));
		expect(await screen.findByText("Off day: Mets, Yankees")).toBeInTheDocument();
		await user.unhover(day("2026-09-04"));
		await user.hover(day("2026-09-11"));
		expect(await screen.findByText("Off day: Mets")).toBeInTheDocument();
	});

	it("S125 AC 2: a favorite with no game in the shown month marks no day and is named in no tooltip (Rays and Yankees in 1997)", async () =>
	{
		const sept1997 = monthPayload("1997-09", (date) => (date === "1997-09-04"
			? {
				count: 2,
				teamIds: [OTHER_A, OTHER_B],
			}
			: {
				count: 10,
				teamIds: [YANKEES, OTHER_A],
			}));
		const user = await open({
			"1997-09": sept1997,
		}, "/games/1997-09-21", [RAYS, YANKEES]);
		await screen.findAllByText("10 gm");
		expect(marks()).toEqual(["1997-09-04:red"]);
		await user.hover(day("1997-09-04"));
		expect(await screen.findByText("Off day: Yankees")).toBeInTheDocument();
		expect(screen.queryByText(/Rays/)).toBeNull();
	});

	it("S125 AC 2: a long press on a marked day shows its tooltip without picking it; a plain tap still picks", async () =>
	{
		const user = await open({
			"2026-09": MARKED,
		}, "/games/2026-09-21", [YANKEES, METS]);
		await screen.findAllByText("10 gm");
		fireEvent.touchStart(day("2026-09-04"));
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50));
		});
		expect(screen.getByText("Off day: Yankees, Mets")).toBeInTheDocument();
		expect(dayButton("2026-09-04")).toHaveClass(classes.held!);
		fireEvent.touchEnd(day("2026-09-04"));
		fireEvent.click(day("2026-09-04"));
		expect(path()).toBe("/games/2026-09-21");
		expect(dayButton("2026-09-21")).toHaveAttribute("data-selected");
		expect(screen.getByTestId("calendar-panel")).toBeInTheDocument();
		// A hold on an unmarked day shows nothing and picks nothing; a touch that moves is no hold.
		fireEvent.touchStart(day("2026-09-10"));
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50));
		});
		expect(screen.queryByRole("tooltip")).toBeNull();
		fireEvent.touchEnd(day("2026-09-10"));
		fireEvent.click(day("2026-09-10"));
		expect(path()).toBe("/games/2026-09-21");
		fireEvent.touchStart(day("2026-09-04"));
		fireEvent.touchMove(day("2026-09-04"));
		fireEvent.contextMenu(day("2026-09-04"));
		await user.click(day("2026-09-04"));
		await waitFor(() => expect(path()).toBe("/games/2026-09-04"));
	});

	it("S125 AC 2: a hold that ends with no click (the finger moved) doesn't swallow the next tap", async () =>
	{
		const user = await open({
			"2026-09": MARKED,
		}, "/games/2026-09-21", [YANKEES, METS]);
		await screen.findAllByText("10 gm");
		fireEvent.touchStart(day("2026-09-04"));
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50));
		});
		fireEvent.touchMove(day("2026-09-04"));
		fireEvent.touchEnd(day("2026-09-04"));
		await user.click(day("2026-09-10"));
		await waitFor(() => expect(path()).toBe("/games/2026-09-10"));
	});

	it("S125 AC 2: offline, a month moved to shows numbers only, not loading bars forever", async () =>
	{
		const user = await open({
			"2026-09": MARKED,
		});
		await screen.findAllByText("10 gm");
		act(() => onlineManager.setOnline(false));
		// Since S74 a request still goes out offline (`networkMode: "offlineFirst"`), so the worker can answer
		// it from its stored copy; with no copy and no network it fails, as here.
		vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
		await user.click(screen.getByRole("button", {
			name: "Previous month",
		}));
		await waitFor(() => expect(screen.queryAllByTestId("count-loading")).toHaveLength(0));
		expect(await screen.findByTestId("day-2026-08-31")).toBeInTheDocument();
		expect(screen.queryAllByTestId("count-loading")).toHaveLength(0);
		expect(screen.queryAllByText(/gm$/)).toHaveLength(0);
		await user.click(day("2026-08-10"));
		await waitFor(() => expect(path()).toBe("/games/2026-08-10"));
	});

	it("S125 AC 2: a failed refetch keeps the counts the calendar already has", async () =>
	{
		serveCalendar({
			"2026-09": MARKED,
		});
		const user = userEvent.setup();
		const { client } = renderControl(["/games/2026-09-21"]);
		await user.click(screen.getByTestId("date-selector"));
		await screen.findAllByText("10 gm");
		vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", {
			status: 500,
		}))));
		await act(async () =>
		{
			await client.refetchQueries({
				queryKey: ["schedule-month", "2026-09"],
			});
		});
		expect(client.getQueryState(["schedule-month", "2026-09"])?.status).toBe("error");
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(screen.getAllByText("10 gm").length).toBeGreaterThan(0);
		expect(dayButton("2026-09-28")).toHaveClass(classes.dimmed!);
	});

	it.each([
		["every day 0", () => ({
			count: 0,
		}), true],
		["every day null", () => ({
			count: null,
		}), false],
		["0 and null mixed", (date: string) => ({
			count: Number(date.slice(8)) % 2 ? 0 : null,
		}), false],
	] as const)("S125 AC 2: off-season line through monthGamesState, %s", async (_name, fill, line) =>
	{
		await open({
			"2026-12": monthPayload("2026-12", fill),
		}, "/games/2026-12-10", [YANKEES]);
		await waitFor(() => expect(screen.queryAllByTestId("count-loading")).toHaveLength(0));
		expect(screen.queryByText("No games this month.") !== null).toBe(line);
		// Off-season: every day dimmed. Unknown: drawn like a failed month, nothing dimmed.
		expect(document.querySelectorAll(`.${classes.dimmed}`)).toHaveLength(line ? 31 : 0);
		expect(marks()).toEqual([]);
	});

	it("S125 AC 2: no off-season line while the month is still loading", async () =>
	{
		await open({
			"2026-12": "pending",
		}, "/games/2026-12-10");
		expect(screen.getAllByTestId("count-loading")).toHaveLength(31);
		expect(screen.queryByText("No games this month.")).toBeNull();
	});
});

describe("the month and year pickers (S125 AC 3)", () =>
{
	/** 03:00 UTC on 2027-01-01: already January 1 in UTC, still December 31 for MLB. */
	function fixClock(): void
	{
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		vi.setSystemTime(new Date("2027-01-01T03:00:00Z"));
	}

	function years(): string[]
	{
		return [...(screen.getByLabelText("Year") as HTMLSelectElement).options].map((option) => option.value);
	}

	it("S125 AC 3: month and year are native selects, and choosing from either shows that month", async () =>
	{
		const user = await open({});
		const month = screen.getByLabelText("Month");
		const year = screen.getByLabelText("Year");
		expect(month.tagName).toBe("SELECT");
		expect(year.tagName).toBe("SELECT");
		await user.selectOptions(month, "3");
		expect(await screen.findByTestId("day-2026-03-31")).toBeInTheDocument();
		await user.selectOptions(year, "2019");
		expect(await screen.findByTestId("day-2019-03-31")).toBeInTheDocument();
		// Neither picker changes the day.
		expect(path()).toBe("/games/2026-09-21");
	});

	it("S125 AC 3: the years run 1901 through latestScheduleMonth's year of mlbToday (2027 on 2027-01-01T03:00Z, not 2028)", async () =>
	{
		fixClock();
		await open({}, "/games/2026-12-31", [], "2026-12-31");
		const list = years();
		expect(list[0]).toBe("1901");
		expect(list.at(-1)).toBe("2027");
		expect(list).toHaveLength(2027 - 1901 + 1);
	});

	it("S125 AC 3: choosing 1901 while January shows lands on April 1901, whose January to March are disabled", async () =>
	{
		const user = await open({}, "/games/2026-01-10");
		await user.selectOptions(screen.getByLabelText("Year"), "1901");
		expect(screen.getByLabelText("Month")).toHaveValue("4");
		expect(screen.getByLabelText("Year")).toHaveValue("1901");
		const months = [...(screen.getByLabelText("Month") as HTMLSelectElement).options];
		expect(months.filter((option) => option.disabled).map((option) => option.textContent)).toEqual(["January", "February", "March"]);
	});

	it("S125 AC 3: a month after latestScheduleMonth (a typed Jul 4, 2099; S124 answers 400 month_too_late) shows numbers only, its year as the last option, › disabled and ‹ working", async () =>
	{
		fixClock();
		const tooLate = {
			status: 400,
			error: "month_too_late",
		};
		const asked = serveCalendar({
			"2099-07": tooLate,
			"2099-06": tooLate,
		}, "2026-12-31");
		const user = userEvent.setup();
		renderControl(["/games/2026-12-31"], "medium", "2026-12-31");
		await user.click(screen.getByTestId("date-selector"));
		const field = await screen.findByLabelText("Date", {
			selector: "input",
		});
		await user.clear(field);
		await user.type(field, "Jul 4, 2099{Enter}");
		await waitFor(() => expect(path()).toBe("/games/2099-07-04"));
		await user.click(screen.getByTestId("date-selector"));
		await screen.findByTestId("calendar-panel");
		expect(screen.getByLabelText("Year")).toHaveValue("2099");
		expect(years().at(-1)).toBe("2099");
		expect(years().at(-2)).toBe("2027");
		expect(screen.getByRole("button", {
			name: "Next month",
		})).toBeDisabled();
		expect(screen.queryAllByText(/gm$/)).toHaveLength(0);
		expect(screen.queryAllByTestId("count-loading")).toHaveLength(0);
		expect(document.querySelectorAll(`.${classes.dimmed}`)).toHaveLength(0);
		await user.click(screen.getByRole("button", {
			name: "Previous month",
		}));
		expect(screen.getByLabelText("Month")).toHaveValue("6");
		expect(asked().filter((month) => month.startsWith("2099"))).toEqual([]);
	});

	it("S125 AC 3: future dates are pickable; a 400 for a month the server won't answer reads as numbers only", async () =>
	{
		const user = await open({
			"2027-03": {
				status: 400,
				error: "month_too_late",
			},
		});
		await user.selectOptions(screen.getByLabelText("Year"), "2027");
		await user.selectOptions(screen.getByLabelText("Month"), "3");
		await waitFor(() => expect(screen.queryAllByTestId("count-loading")).toHaveLength(0));
		expect(screen.queryAllByText(/gm$/)).toHaveLength(0);
		await user.click(day("2027-03-31"));
		await waitFor(() => expect(path()).toBe("/games/2027-03-31"));
	});
});
