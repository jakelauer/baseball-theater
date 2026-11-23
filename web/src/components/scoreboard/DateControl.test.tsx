/**
 * S125: the scoreboard's date button and how its calendar opens, closes and moves
 * (shell-scoreboard A8): the typed date (AC 1), the sheet and the dropdown, Back, `Today` and the
 * month arrows (AC 7), and the month asked for ahead, six week rows and the short screen (AC 8).
 */
import {
	act, cleanup, fireEvent, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	busyMonth, renderControl, renderScoreboard, serveCalendar,
} from "../../test/calendar.js";
import { resetSettings } from "../../settings/store.js";

const realInnerHeight = window.innerHeight;
const realMatchMedia = window.matchMedia;

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetSettings();
	window.innerHeight = realInnerHeight;
	window.matchMedia = realMatchMedia;
});

function dateButton(): HTMLElement
{
	return screen.getByTestId("date-selector");
}

function field(): HTMLInputElement
{
	return screen.getByLabelText("Date", {
		selector: "input",
	});
}

function path(): string
{
	return screen.getByTestId("path").textContent!;
}

async function openCalendar(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement>
{
	await user.click(dateButton());
	return screen.findByTestId("calendar-panel");
}

describe("the typed date (S125 AC 1)", () =>
{
	it("S125 AC 1: the date button (date-selector) opens the calendar and is Raised current while open", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		renderControl(["/games/2026-09-21"]);
		expect(dateButton()).toHaveTextContent("Sep 21, 2026");
		expect(dateButton()).toHaveAttribute("aria-expanded", "false");
		expect(dateButton().style.background).toBe("transparent");
		await openCalendar(user);
		expect(dateButton()).toHaveAttribute("aria-expanded", "true");
		expect(dateButton()).toHaveAttribute("data-open");
		expect(dateButton().style.background).toBe("var(--bt-raised-current)");
		expect(field().value).toBe("Sep 21, 2026");
	});

	it("S125 AC 1: typing 9/21/2026 one character at a time navigates once, on Enter, to the 21st", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-05"]);
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "9/21/2026");
		expect(visits()).toEqual(["/games/2026-09-05"]);
		await user.keyboard("{Enter}");
		await waitFor(() => expect(path()).toBe("/games/2026-09-21"));
		expect(visits()).toEqual(["/games/2026-09-05", "/games/2026-09-21"]);
		// The day changed, so the calendar closed with it.
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
	});

	it("S125 AC 1: the same, read when the field loses focus", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-05"]);
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "9/21/2026");
		expect(visits()).toEqual(["/games/2026-09-05"]);
		fireEvent.blur(field());
		await waitFor(() => expect(visits()).toEqual(["/games/2026-09-05", "/games/2026-09-21"]));
	});

	it("S125 AC 1: Feb 30, 2026 shows 'Not a date.' without navigating, and leaving the field keeps the text and the error", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"]);
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "Feb 30, 2026{Enter}");
		expect(await screen.findByText("Not a date.")).toBeInTheDocument();
		expect(field()).toHaveAttribute("aria-invalid", "true");
		fireEvent.blur(field());
		expect(field().value).toBe("Feb 30, 2026");
		expect(screen.getByText("Not a date.")).toBeInTheDocument();
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});

	it("S125 AC 1: Apr 17, 1901 shows 'No data before Apr 18, 1901.' without navigating; a valid date then clears it", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"]);
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "Apr 17, 1901{Enter}");
		expect(await screen.findByText("No data before Apr 18, 1901.")).toBeInTheDocument();
		expect(visits()).toEqual(["/games/2026-09-21"]);
		await user.clear(field());
		await user.type(field(), "Sep 21, 2026{Enter}");
		expect(screen.queryByText("No data before Apr 18, 1901.")).toBeNull();
		// Unchanged: nothing navigates.
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});

	it("S125 AC 1: focusing the field without changing it and closing by an outside tap navigates nowhere and adds no history entry", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"]);
		await openCalendar(user);
		await user.click(field());
		await user.keyboard("{Enter}");
		await user.click(screen.getByRole("button", {
			name: "Outside",
		}));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});
});

describe("opening, closing and moving (S125 AC 7)", () =>
{
	it("S125 AC 7: mobile is a bottom sheet with a ✕, sliding up in 200ms; the ✕ closes it without touching the URL", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"], "mobile");
		const panel = await openCalendar(user);
		expect(panel).toHaveAttribute("data-container", "sheet");
		const content = document.querySelector<HTMLElement>(".mantine-Drawer-content")!;
		expect(content.style.transitionDuration).toBe("200ms");
		await user.click(screen.getByRole("button", {
			name: "Close calendar",
		}));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});

	it("S125 AC 7: under reduced motion the sheet shows at once, already filled, with no transition", async () =>
	{
		window.matchMedia = ((query: string) => ({
			...realMatchMedia(query),
			matches: query.includes("prefers-reduced-motion"),
		})) as typeof window.matchMedia;
		serveCalendar();
		const user = userEvent.setup();
		const { client } = renderControl(["/games/2026-09-21"], "mobile");
		await waitFor(() => expect(client.getQueryData(["schedule-month", "2026-09"])).toBeDefined());
		await user.click(dateButton());
		const content = document.querySelector<HTMLElement>(".mantine-Drawer-content")!;
		expect(content.style.transitionDuration).toBe("");
		expect(within(content).getAllByText("10 gm").length).toBeGreaterThan(0);
	});

	it.each(["medium", "desktop"] as const)("S125 AC 7: %s is a dropdown under the button, with no ✕", async (variant) =>
	{
		serveCalendar();
		const user = userEvent.setup();
		renderControl(["/games/2026-09-21"], variant);
		const panel = await openCalendar(user);
		expect(panel).toHaveAttribute("data-container", "dropdown");
		expect(panel.closest(".mantine-Popover-dropdown")).not.toBeNull();
		expect(screen.queryByRole("button", {
			name: "Close calendar",
		})).toBeNull();
	});

	it.each(["mobile", "medium", "desktop"] as const)("S125 AC 7: %s: an outside click and Esc each close it without changing the day", async (variant) =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"], variant);
		await openCalendar(user);
		if (variant === "mobile")
		{
			await user.click(document.querySelector<HTMLElement>(".mantine-Drawer-overlay")!);
		}
		else
		{
			await user.click(screen.getByRole("button", {
				name: "Outside",
			}));
		}
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		await openCalendar(user);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});

	it("S125 AC 7: Back with the sheet open goes to the previous day, which opening never pushed, and the calendar is closed there", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		renderControl(["/games/2026-09-20", "/games/2026-09-21"], "mobile");
		await openCalendar(user);
		await user.click(screen.getByRole("button", {
			name: "Browser back",
			hidden: true,
		}));
		await waitFor(() => expect(path()).toBe("/games/2026-09-20"));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(dateButton()).toHaveAttribute("aria-expanded", "false");
	});

	it("S125 AC 7: picking a day navigates and closes the calendar", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"], "mobile");
		await openCalendar(user);
		await user.click(await screen.findByTestId("day-2026-09-14"));
		await waitFor(() => expect(path()).toBe("/games/2026-09-14"));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(visits()).toEqual(["/games/2026-09-21", "/games/2026-09-14"]);
	});

	it("S125 AC 7: picking the day already shown just closes the calendar", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-09-21"]);
		await openCalendar(user);
		await user.click(await screen.findByTestId("day-2026-09-21"));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
		expect(visits()).toEqual(["/games/2026-09-21"]);
	});

	it("S125 AC 7: Today on today's month goes to today and closes; on another month it shows today's month and stays open", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-07-04"], "medium", "2026-09-21");
		await openCalendar(user);
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(screen.getByLabelText("Month")).toHaveValue("9");
		expect(screen.getByTestId("calendar-panel")).toBeInTheDocument();
		expect(visits()).toEqual(["/games/2026-07-04"]);
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		await waitFor(() => expect(path()).toBe("/games/2026-09-21"));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).toBeNull());
	});

	it("S125 AC 7: Today is muted and does nothing while the scoreboard's today is still loading", async () =>
	{
		serveCalendar();
		const user = userEvent.setup();
		const { visits } = renderControl(["/games/2026-07-04"], "medium", null);
		await openCalendar(user);
		const today = screen.getByRole("button", {
			name: "Today",
		});
		expect(today).toHaveAttribute("data-muted");
		await user.click(today);
		expect(screen.getByLabelText("Month")).toHaveValue("7");
		expect(visits()).toEqual(["/games/2026-07-04"]);
	});

	it("S125 AC 7: ‹ and › move one month, across a year's end into the neighbouring year, and stop at April 1901 and at latestScheduleMonth", async () =>
	{
		vi.useFakeTimers({
			toFake: ["Date"],
		});
		vi.setSystemTime(new Date("2026-09-21T16:00:00Z"));
		serveCalendar();
		const user = userEvent.setup();
		renderControl(["/games/2026-07-04"]);
		await openCalendar(user);
		const month = () => (screen.getByLabelText("Month") as HTMLSelectElement).value;
		const year = () => (screen.getByLabelText("Year") as HTMLSelectElement).value;
		const prev = () => screen.getByRole("button", {
			name: "Previous month",
		});
		const next = () => screen.getByRole("button", {
			name: "Next month",
		});
		await user.click(next());
		expect([month(), year()]).toEqual(["8", "2026"]);
		await user.click(prev());
		await user.click(prev());
		expect([month(), year()]).toEqual(["6", "2026"]);
		await user.selectOptions(screen.getByLabelText("Month"), "1");
		await user.click(prev());
		expect([month(), year()]).toEqual(["12", "2025"]);
		await user.click(next());
		expect([month(), year()]).toEqual(["1", "2026"]);
		await user.selectOptions(screen.getByLabelText("Month"), "12");
		await user.click(next());
		expect([month(), year()]).toEqual(["1", "2027"]);
		// latestScheduleMonth of 2026-09-21 is 2027-12: › stops there.
		await user.selectOptions(screen.getByLabelText("Month"), "12");
		expect(next()).toBeDisabled();
		await user.selectOptions(screen.getByLabelText("Year"), "1901");
		expect([month(), year()]).toEqual(["12", "1901"]);
		await user.selectOptions(screen.getByLabelText("Month"), "4");
		expect(prev()).toBeDisabled();
		expect(next()).toBeEnabled();
	});
});

describe("filled when it opens (S125 AC 8)", () =>
{
	it("S125 AC 8: the page asks for the shown day's month as it loads, so the open calendar's first render has the counts and no loading state", async () =>
	{
		const asked = serveCalendar();
		const user = userEvent.setup();
		const { client } = renderScoreboard(["/games/2026-09-21"]);
		await waitFor(() => expect(client.getQueryData(["schedule-month", "2026-09"])).toEqual(busyMonth("2026-09")));
		expect(asked()).toEqual(["2026-09"]);
		await user.click(await screen.findByTestId("date-selector"));
		// No waiting: the first render after the click.
		expect(screen.getAllByText("10 gm")).toHaveLength(30);
		expect(screen.queryAllByTestId("count-loading")).toHaveLength(0);
		expect(asked()).toEqual(["2026-09"]);
	});

	it("S125 AC 8: counts that haven't arrived show the loading state and fill in place", async () =>
	{
		let answer: (response: Response) => void = () => undefined;
		serveCalendar();
		const served = globalThis.fetch;
		vi.stubGlobal("fetch", (request: Request) => new URL(request.url).pathname.startsWith("/api/v1/schedule/month/")
			? new Promise<Response>((resolve) =>
			{
				answer = resolve;
			})
			: served(request));
		const user = userEvent.setup();
		renderControl(["/games/2026-09-21"]);
		await openCalendar(user);
		expect(screen.getAllByTestId("count-loading")).toHaveLength(30);
		await act(async () =>
		{
			answer(new Response(JSON.stringify(busyMonth("2026-09")), {
				headers: {
					"Content-Type": "application/json",
				},
			}));
		});
		expect(await screen.findAllByText("10 gm")).toHaveLength(30);
		expect(screen.queryAllByTestId("count-loading")).toHaveLength(0);
	});

	it.each(["/games/2099-07-04", "/games/1850-01-01"])("S125 AC 8: %s asks for no month as the page loads", async (page) =>
	{
		const asked = serveCalendar();
		renderScoreboard([page]);
		expect(await screen.findByTestId("date-selector")).toBeInTheDocument();
		await act(async () =>
		{
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(asked()).toEqual([]);
	});

	it.each([["2026-02", "2026-02-10"], ["2026-08", "2026-08-10"]])("S125 AC 8: %s renders six week rows", async (_month, day) =>
	{
		serveCalendar();
		const user = userEvent.setup();
		renderControl([`/games/${day}`]);
		const panel = await openCalendar(user);
		expect(panel.querySelectorAll("tbody tr")).toHaveLength(6);
	});

	it.each([[600, false], [800, true]] as const)("S125 AC 8: a phone %ipx tall shows the counts: %s", async (height, counts) =>
	{
		window.innerHeight = height;
		serveCalendar();
		const user = userEvent.setup();
		const { client } = renderControl(["/games/2026-09-21"], "mobile");
		await waitFor(() => expect(client.getQueryData(["schedule-month", "2026-09"])).toBeDefined());
		const panel = await openCalendar(user);
		expect(screen.queryAllByText("10 gm")).toHaveLength(counts ? 30 : 0);
		expect(panel.querySelector<HTMLElement>("table")!.style.getPropertyValue("--calendar-cell-height")).toBe(counts ? "48px" : "36px");
	});

	it("S125 AC 8: the short rule is the phone's alone; the dropdown keeps its counts on a short window", async () =>
	{
		window.innerHeight = 500;
		serveCalendar();
		const user = userEvent.setup();
		const { client } = renderControl(["/games/2026-09-21"], "medium");
		await waitFor(() => expect(client.getQueryData(["schedule-month", "2026-09"])).toBeDefined());
		await openCalendar(user);
		expect(screen.getAllByText("10 gm")).toHaveLength(30);
	});
});
