/**
 * S138: the scoreboard's date control and calendar on Standings (shell-scoreboard A8, as S125 built
 * them): where the control sits (AC 1), where a pick, a typed date, an arrow and Standings' own
 * `Today` go (AC 2), and which day the control and the heading's "as of" words read (AC 3). The API
 * is stubbed: the standings route answers what each test gives it, and the calendar's month route a
 * busy month. Only `Date` is faked, so the page's "today" (MLB's, `mlbToday`) is the test's.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes, useLocation, useNavigate,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { StandingsPayload } from "../api/standings.js";
import { formatDate } from "../format/datetime.js";
import { busyMonth } from "../test/calendar.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { StandingsPage } from "./StandingsPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

/** The committed recording: the regular season's table as of 2026-09-05, with no `phase` or `phases`. */
const RECORDING = JSON.parse(readFileSync(join(FIXTURES, "standings-2026-09-05.json"), "utf8")) as StandingsPayload;

type Answer = (date: string | null) => Response;

/** The recording as of `date`, with `phase` when given (no `phases`: S128's table, no switch). */
function table(date: string, phase?: string): StandingsPayload
{
	return {
		...RECORDING,
		date,
		...phase && {
			phase,
		},
	} as StandingsPayload;
}

const regularOn = (date: string | null) => jsonResponse(table(date ?? "2026-09-05", "regularSeason"));

/** Stubs the API: the standings route through `answer` (given the asked `date`), months busy. Returns the dates asked for. */
function serve(answer: Answer = regularOn): Array<string | null>
{
	const asked: Array<string | null> = [];
	vi.stubGlobal("fetch", (request: Request) =>
	{
		const url = new URL(request.url);
		const month = /^\/api\/v1\/schedule\/month\/(.+)$/.exec(url.pathname)?.[1];
		if (month) return Promise.resolve(jsonResponse(busyMonth(month)));
		if (url.pathname === "/api/v1/standings")
		{
			asked.push(url.searchParams.get("date"));
			return Promise.resolve(answer(url.searchParams.get("date")));
		}
		return Promise.resolve(jsonResponse({
			error: "not_found",
		}, 404));
	});
	return asked;
}

/** Today as MLB reads it. */
function today(day: string): void
{
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	vi.setSystemTime(new Date(`${day}T17:00:00Z`));
}

/** The address beside the page, every history entry visited, and the browser's Back and Forward. */
function Probe({ seen }: { seen: string[] })
{
	const location = useLocation();
	const navigate = useNavigate();
	if (seen.at(-1)?.split("|")[0] !== location.key) seen.push(`${location.key}|${location.pathname}${location.search}`);
	return (
		<>
			<output data-testid="address">{`${location.pathname}${location.search}`}</output>
			<button type="button" onClick={() => void navigate(-1)}>Browser back</button>
			<button type="button" onClick={() => void navigate(1)}>Browser forward</button>
		</>
	);
}

/** Standings at `path`; returns the addresses of every history entry visited, in order. */
function renderAt(path: string): () => string[]
{
	const seen: string[] = [];
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/standings" element={<><StandingsPage variant="medium" /><Probe seen={seen} /></>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return () => seen.map((entry) => entry.split("|")[1]!);
}

const address = () => screen.getByTestId("address").textContent;
const control = () => screen.getByTestId("date-selector");
const field = () => screen.getByLabelText("Date", {
	selector: "input",
});
const shownMonth = () => (screen.getByLabelText("Month") as HTMLSelectElement).value;
const heading = () => screen.getByRole("heading", {
	level: 1,
}).textContent;

async function openCalendar(user: ReturnType<typeof userEvent.setup>): Promise<void>
{
	await user.click(control());
	await screen.findByTestId("calendar-panel");
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("Standings' date control: where it sits (S138 AC 1)", () =>
{
	it("S138 AC 1: the scoreboard's control is first under the header, before the heading and the view switch, and opens S125's calendar", async () =>
	{
		today("2027-03-10");
		const spring = {
			startDate: "2027-02-19",
			endDate: "2027-03-24",
		};
		serve(() => jsonResponse({
			...table("2027-03-02", "spring"),
			phases: {
				spring: {
					...spring,
					table: table("2027-03-02"),
				},
				regularSeason: {
					startDate: "2027-03-25",
					endDate: "2027-09-26",
					table: table("2027-03-02"),
				},
				playoffs: null,
			},
		}));
		const user = userEvent.setup();
		renderAt("/standings?date=2027-03-02");
		const tablist = await screen.findByRole("tablist");
		const nav = screen.getByTestId("date-control");
		const title = screen.getByRole("heading", {
			level: 1,
		});
		expect(nav.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(nav.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.getByRole("link", {
			name: "Previous day",
		})).toBeInTheDocument();
		await openCalendar(user);
		expect(screen.getByTestId("calendar-panel")).toHaveAttribute("data-container", "dropdown");
		expect(shownMonth()).toBe("3");
	});
});

describe("Standings' date control: where it goes (S138 AC 2)", () =>
{
	it("S138 AC 2: picking a day goes to /standings?date=<day>, dropping ?view=, and the page asks for that day's standings", async () =>
	{
		today("2026-09-20");
		const asked = serve();
		const user = userEvent.setup();
		renderAt("/standings?date=2026-09-05&view=regularSeason");
		await screen.findAllByTestId("division-table");
		await openCalendar(user);
		await user.click(screen.getByTestId("day-2026-09-10"));
		expect(address()).toBe("/standings?date=2026-09-10");
		await waitFor(() => expect(asked).toContain("2026-09-10"));
		expect(await screen.findByText(/as of September 10, 2026/)).toBeInTheDocument();
		expect(screen.queryByTestId("calendar-panel")).not.toBeInTheDocument();
	});

	it("S138 AC 2: picking or typing the day already shown still goes to /standings?date=<day>, dropping ?view=", async () =>
	{
		today("2026-09-20");
		serve();
		const user = userEvent.setup();
		renderAt("/standings?date=2026-09-05&view=regularSeason");
		await screen.findAllByTestId("division-table");
		expect(address()).toBe("/standings?date=2026-09-05&view=regularSeason");
		await openCalendar(user);
		await user.click(screen.getByTestId("day-2026-09-05"));
		expect(address()).toBe("/standings?date=2026-09-05");
		cleanup();
		renderAt("/standings?date=2026-09-05&view=regularSeason");
		await screen.findAllByTestId("division-table");
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "Sep 5, 2026{Enter}");
		expect(address()).toBe("/standings?date=2026-09-05");
	});

	it("S138 AC 2: from ?date=garbage, picking or typing today (the day the control reads) goes to /standings?date=<today>", async () =>
	{
		today("2026-09-20");
		serve((date) => (date === "garbage"
			? jsonResponse({
				error: "date_invalid",
			}, 400)
			: regularOn(date)));
		const user = userEvent.setup();
		renderAt("/standings?date=garbage");
		await openCalendar(user);
		await user.click(screen.getByTestId("day-2026-09-20"));
		expect(address()).toBe("/standings?date=2026-09-20");
		cleanup();
		renderAt("/standings?date=garbage");
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "Sep 20, 2026{Enter}");
		expect(address()).toBe("/standings?date=2026-09-20");
	});

	it("S138 AC 2: a typed date goes to its day; an invalid one and one before 1901-04-18 show A8's states and stay put", async () =>
	{
		today("2026-09-20");
		serve();
		const user = userEvent.setup();
		const visits = renderAt("/standings?date=2026-09-05");
		await openCalendar(user);
		await user.clear(field());
		await user.type(field(), "garbage{Enter}");
		expect(await screen.findByText("Not a date.")).toBeInTheDocument();
		await user.clear(field());
		await user.type(field(), "Jan 1, 1850{Enter}");
		expect(await screen.findByText("No data before Apr 18, 1901.")).toBeInTheDocument();
		expect(address()).toBe("/standings?date=2026-09-05");
		expect(visits()).toEqual(["/standings?date=2026-09-05"]);
		await user.clear(field());
		await user.type(field(), "Sep 12, 2026{Enter}");
		expect(address()).toBe("/standings?date=2026-09-12");
	});

	it("S138 AC 2: the ‹ › arrows move one day, dropping ?view=; Back and Forward move between the days picked", async () =>
	{
		today("2026-09-20");
		serve();
		const user = userEvent.setup();
		const visits = renderAt("/standings?date=2026-09-05&view=regularSeason");
		await user.click(screen.getByRole("link", {
			name: "Next day",
		}));
		expect(address()).toBe("/standings?date=2026-09-06");
		await user.click(screen.getByRole("link", {
			name: "Previous day",
		}));
		expect(address()).toBe("/standings?date=2026-09-05");
		await openCalendar(user);
		await user.click(screen.getByTestId("day-2026-09-14"));
		expect(address()).toBe("/standings?date=2026-09-14");
		await user.click(screen.getByRole("button", {
			name: "Browser back",
		}));
		expect(address()).toBe("/standings?date=2026-09-05");
		expect(control()).toHaveAccessibleName(`Choose a date, ${formatDate("2026-09-05")}`);
		await user.click(screen.getByRole("button", {
			name: "Browser forward",
		}));
		expect(address()).toBe("/standings?date=2026-09-14");
		expect(visits()).toEqual([
			"/standings?date=2026-09-05&view=regularSeason",
			"/standings?date=2026-09-06",
			"/standings?date=2026-09-05",
			"/standings?date=2026-09-14",
			"/standings?date=2026-09-05",
			"/standings?date=2026-09-14",
		]);
	});

	it("S138 AC 2: opening and closing the calendar without choosing a day leaves the address and history unchanged", async () =>
	{
		today("2026-09-20");
		serve();
		const user = userEvent.setup();
		const visits = renderAt("/standings?date=2026-09-05&view=regularSeason");
		await screen.findAllByTestId("division-table");
		await openCalendar(user);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).not.toBeInTheDocument());
		await openCalendar(user);
		await user.click(control());
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).not.toBeInTheDocument());
		expect(address()).toBe("/standings?date=2026-09-05&view=regularSeason");
		expect(visits()).toEqual(["/standings?date=2026-09-05&view=regularSeason"]);
	});

	it("S138 AC 2: a day after today is pickable and opens whatever the API answers for it", async () =>
	{
		today("2026-09-05");
		const asked = serve();
		const user = userEvent.setup();
		renderAt("/standings");
		await screen.findAllByTestId("division-table");
		await openCalendar(user);
		await user.click(screen.getByTestId("day-2026-09-25"));
		expect(address()).toBe("/standings?date=2026-09-25");
		await waitFor(() => expect(asked).toContain("2026-09-25"));
		expect(await screen.findByText(/as of September 25, 2026/)).toBeInTheDocument();
	});

	it("S138 AC 2: Today on today's month goes to /standings with no date; with no date in the address it only closes, adding no history entry", async () =>
	{
		today("2026-09-20");
		const asked = serve();
		const user = userEvent.setup();
		const visits = renderAt("/standings?date=2026-09-05&view=regularSeason");
		await openCalendar(user);
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(address()).toBe("/standings");
		await waitFor(() => expect(asked).toContain(null));
		expect(heading()).toBe("Standings");
		expect(screen.queryByTestId("calendar-panel")).not.toBeInTheDocument();
		await openCalendar(user);
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		await waitFor(() => expect(screen.queryByTestId("calendar-panel")).not.toBeInTheDocument());
		expect(address()).toBe("/standings");
		expect(visits()).toEqual(["/standings?date=2026-09-05&view=regularSeason", "/standings"]);
	});

	it("S138 AC 2: Today off today's month moves the calendar there and leaves it open; the second press goes", async () =>
	{
		today("2026-09-20");
		serve();
		const user = userEvent.setup();
		renderAt("/standings?date=2026-07-04");
		await openCalendar(user);
		expect(shownMonth()).toBe("7");
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(shownMonth()).toBe("9");
		expect(screen.getByTestId("calendar-panel")).toBeInTheDocument();
		expect(address()).toBe("/standings?date=2026-07-04");
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(address()).toBe("/standings");
	});

	it("S138 AC 2: in the off-season, from a ?date= in an earlier month, the first Today moves the calendar and the second opens /standings with no date (Standings' own today)", async () =>
	{
		today("2026-11-19");
		const asked = serve((date) => jsonResponse(date ? table(date, "regularSeason") : table("2026-09-27", "final")));
		const user = userEvent.setup();
		renderAt("/standings?date=2026-09-05");
		await openCalendar(user);
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(shownMonth()).toBe("11");
		expect(address()).toBe("/standings?date=2026-09-05");
		await user.click(screen.getByRole("button", {
			name: "Today",
		}));
		expect(address()).toBe("/standings");
		await waitFor(() => expect(asked).toContain(null));
		expect(control()).toHaveAccessibleName(`Choose a date, ${formatDate("2026-11-19")}`);
	});
});

describe("Standings' date control: the day it reads (S138 AC 3)", () =>
{
	const reads = (day: string) => expect(control()).toHaveAccessibleName(`Choose a date, ${formatDate(day)}`);

	it.each([
		["a regular-season", table("2026-09-05", "regularSeason")],
		["a final", table("2026-09-27", "final")],
		["a spring", table("2027-03-02", "spring")],
		["a phase-less", table("2026-09-05")],
	])("S138 AC 3: with no ?date= and %s table, the control reads MLB's today, never the table's date", async (_name, payload) =>
	{
		today("2026-11-19");
		serve(() => jsonResponse(payload));
		renderAt("/standings");
		await screen.findAllByTestId("division-table");
		reads("2026-11-19");
		expect(heading()).toBe("Standings");
	});

	it("S138 AC 3: with a ?date= answered by the off-season's final table, the control reads the ?date= day, not the table's", async () =>
	{
		today("2026-12-10");
		serve(() => jsonResponse(table("2026-09-27", "final")));
		renderAt("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		reads("2026-12-01");
		expect(heading()).toBe("Standings as of December 1, 2026");
	});

	it("S138 AC 3: ?date=garbage is passed on unchanged and shows the 400's error state, while the control reads today and opens on today's month", async () =>
	{
		today("2026-09-20");
		const asked = serve(() => jsonResponse({
			error: "date_invalid",
		}, 400));
		const user = userEvent.setup();
		renderAt("/standings?date=garbage");
		expect(await screen.findByText("Couldn't load standings")).toBeInTheDocument();
		expect(asked).toContain("garbage");
		reads("2026-09-20");
		expect(heading()).toBe("Standings");
		await openCalendar(user);
		expect(shownMonth()).toBe("9");
	});

	it.each(["2026-02-30", "1850-01-01"])("S138 AC 3: ?date=%s is passed on unchanged and shows the empty answer, while the control reads today and the heading has no \"as of\"", async (date) =>
	{
		today("2026-09-20");
		const asked = serve(() => jsonResponse({
			...table("2026-09-20"),
			divisions: [],
		}));
		const user = userEvent.setup();
		renderAt(`/standings?date=${date}`);
		expect(await screen.findByText("No standings for this date.")).toBeInTheDocument();
		expect(asked).toContain(date);
		reads("2026-09-20");
		expect(heading()).toBe("Standings");
		await openCalendar(user);
		expect(shownMonth()).toBe("9");
	});

	it("S138 AC 3: 1901-04-17 gets no \"as of\" words and the control reads today; 1901-04-18 gets both", async () =>
	{
		today("2026-09-20");
		serve((date) => jsonResponse(table(date ?? "2026-09-20")));
		renderAt("/standings?date=1901-04-17");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings");
		reads("2026-09-20");
		cleanup();
		renderAt("/standings?date=1901-04-18");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings as of April 18, 1901");
		reads("1901-04-18");
	});
});
