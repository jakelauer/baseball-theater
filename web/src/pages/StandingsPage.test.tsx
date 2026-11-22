/**
 * S4: Standings on the committed recording, `fixtures/standings-2026-09-05.json` (six
 * divisions, AL East first, Tampa Bay leading it), served as the API would; and the
 * generic loading, empty and error states.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { SeasonPhaseName, StandingsTeamRecord } from "@bt/domain";
import { blankRegularSeasonTable, playoffsTable } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import type { StandingsPayload } from "../api/standings.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { StandingsPage } from "./StandingsPage.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

const STANDINGS = JSON.parse(readFileSync(join(FIXTURES, "standings-2026-09-05.json"), "utf8")) as StandingsPayload;

function renderStandings(path = "/standings?date=2026-09-05")
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<StandingsPage />
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

function serve(response: () => Response)
{
	const fetchMock = vi.fn((_request: Request) => Promise.resolve(response()));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("StandingsPage (S4)", () =>
{
	it("names: the recording's teams, asked for the URL's day", async () =>
	{
		const fetchMock = serve(() => jsonResponse(STANDINGS));
		renderStandings();
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
		expect(screen.getByText("Tampa Bay Rays")).toBeInTheDocument();
		const url = new URL(fetchMock.mock.calls[0]![0].url);
		expect(url.pathname).toBe("/api/v1/standings");
		expect(url.searchParams.get("date")).toBe("2026-09-05");
	});

	it("table: one per division, headed by divisionName, each row swatch, name, abbreviation, W, L, PCT, GB", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderStandings();
		const tables = await screen.findAllByTestId("division-table");
		expect(tables).toHaveLength(6);
		expect(screen.getAllByRole("heading", {
			level: 3,
		}).map((h) => h.textContent)).toEqual(["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"]);
		const alEast = within(tables[0]!);
		expect(alEast.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
		const yankees = alEast.getAllByTestId("standings-row")[1]!;
		expect(within(yankees).getByTestId("team-swatch")).toBeInTheDocument();
		expect(within(yankees).getAllByRole("cell").map((c) => c.textContent)).toEqual(["New York Yankees", "NYY", "81", "61", ".570", "4.0"]);
	});

	it("leader: each division's leader reads — for games back, and no other row does", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderStandings();
		for (const table of await screen.findAllByTestId("division-table"))
		{
			const gb = within(table).getAllByTestId("games-back").map((c) => c.textContent);
			expect(gb[0]).toBe("—");
			expect(gb.slice(1)).not.toContain("—");
		}
	});

	it("table: a division the recording names but BT doesn't know keeps MLB's name; one with neither reads Division", async () =>
	{
		const [first, second] = STANDINGS.divisions;
		serve(() => jsonResponse({
			...STANDINGS,
			divisions: [{
				...first!,
				divisionId: null,
				name: "Spring League",
			}, {
				...second!,
				divisionId: 999,
				name: null,
			}],
		}));
		renderStandings();
		await screen.findAllByTestId("division-table");
		expect(screen.getAllByRole("heading", {
			level: 3,
		}).map((h) => h.textContent)).toEqual(["Spring League", "Division"]);
	});

	it("without a date in the URL, the server's today is asked for", async () =>
	{
		const fetchMock = serve(() => jsonResponse(STANDINGS));
		renderStandings("/standings");
		await screen.findAllByTestId("division-table");
		expect(new URL(fetchMock.mock.calls[0]![0].url).searchParams.has("date")).toBe(false);
	});

	it("loading: the title over ViewState's loader", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderStandings();
		// S130 AC 3: a day in the address that isn't today adds "as of" to the heading.
		expect(screen.getByRole("heading", {
			level: 1,
			name: "Standings as of September 5, 2026",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("empty: a day with no tables says so", async () =>
	{
		serve(() => jsonResponse({
			...STANDINGS,
			divisions: [],
		}));
		renderStandings();
		expect(await screen.findByText("No standings for this date.")).toBeInTheDocument();
		expect(screen.queryByTestId("division-table")).toBeNull();
	});

	it("error: Couldn't load standings, the hint, and Retry asks again", async () =>
	{
		const fetchMock = serve(() => jsonResponse({
			error: "unavailable",
		}, 503));
		const user = userEvent.setup();
		renderStandings();
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load standings")).toBeInTheDocument();
		expect(within(alert).getByText("Check your connection and try again")).toBeInTheDocument();
		fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(STANDINGS)));
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
	});
});

describe("StandingsPage before 1969 (S155 AC 4)", () =>
{
	const LEAGUES = JSON.parse(readFileSync(join(FIXTURES, "standings-1950-07-04.json"), "utf8")) as StandingsPayload;

	it("1950-07-04: two tables, the American League then the National League, through DivisionTable with W, L, PCT and GB", async () =>
	{
		serve(() => jsonResponse(LEAGUES));
		renderStandings("/standings?date=1950-07-04");
		const tables = await screen.findAllByTestId("division-table");
		expect(tables).toHaveLength(2);
		expect(screen.getAllByRole("heading", {
			level: 3,
		}).map((h) => h.textContent)).toEqual(["American League", "National League"]);
		for (const table of tables)
		{
			expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
			expect(within(table).getAllByTestId("standings-row")).toHaveLength(8);
		}
		const [al, nl] = tables;
		expect(within(within(al!).getAllByTestId("standings-row")[0]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Detroit Tigers", "DET", "46", "24", ".657", "—"]);
		expect(within(within(nl!).getAllByTestId("standings-row")[0]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["St. Louis Cardinals", "STL", "41", "27", ".603", "—"]);
	});
});

describe("StandingsPage footer (S148)", () =>
{
	it("S148 AC 1 Standings: it opens no socket, so it ends with no footer line: no 'Fetched … ago', no 'baseball.theater'", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		const { container } = render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={["/standings?date=2026-09-05"]}>
						<StandingsPage />
					</MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
		expect(screen.queryByRole("contentinfo")).toBeNull();
		expect(container).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});

	it("S148 AC 3: Standings never shows the Live marker or its strip", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderStandings();
		expect(await screen.findByText("New York Yankees")).toBeInTheDocument();
		expect(screen.queryByTestId("footer-live-strip")).toBeNull();
		expect(screen.queryByText("Live Data · Active")).toBeNull();
	});
});

/*
 * S130: the three views. Each answer is built the way the API builds it (S139): every phase's dates
 * always, a phase's table only when the request's `includePhases` names it, the top-level table S128's.
 */
type Payload = StandingsPayload;
type Snapshot = NonNullable<NonNullable<Payload["phases"]["spring"]>["table"]>;

/** A season's phase dates and tables, the day's champion and S128's top-level phase, to answer requests from. */
interface Season {
	phase: "spring" | "regularSeason" | "final";
	spring: { startDate: string;
		endDate: string;
		table: Snapshot; } | null;
	regularSeason: { startDate: string;
		endDate: string;
		table: Snapshot; };
	playoffs: { startDate: string;
		endDate: string; } | null;
	champion: Payload["champion"];
}

const BASE_TABLE: Snapshot = {
	date: STANDINGS.date,
	divisions: STANDINGS.divisions,
	fetchedAt: STANDINGS.fetchedAt,
	windowMode: STANDINGS.windowMode,
};

/**
 * A 2026 final table for these tests, illustrative: the Rays `z`, the Guardians `y` and the Yankees `w`
 * are MLB's own letters for those three teams (`fixtures/raw/standings-2026-final.json`), but they are set
 * on the 2026-09-05 recording's records, so this is not a recorded final table; the others are not clinched.
 */
function finalTable(letters: Record<string, string | null | undefined> = {
	TB: "z",
	CLE: "y",
	NYY: "w",
}): Snapshot
{
	return {
		...BASE_TABLE,
		date: "2026-09-27",
		phase: "final",
		season: 2026,
		divisions: STANDINGS.divisions.map((division) => ({
			...division,
			teams: division.teams.map((team): StandingsTeamRecord =>
			{
				const abbreviation = team.abbreviation ?? "";
				if (!(abbreviation in letters)) return team;
				const letter = letters[abbreviation];
				return {
					...team,
					clinched: true,
					...(letter === undefined ? {} : {
						clinchIndicator: letter,
					}),
				};
			}),
		})),
	};
}

const SPRING_TABLE: Snapshot = {
	...BASE_TABLE,
	date: "2027-03-02",
	phase: "spring",
	season: 2027,
};

// The phase dates, the champion and its `wonOn` below are illustrative (as `e2e/design/S130.spec.ts`'s are),
// chosen to exercise S130's rules; they are not a recording of what MLB's calendar or the API served.
const SPRING_2027 = {
	startDate: "2027-02-19",
	endDate: "2027-03-24",
};
const REGULAR_2027 = {
	startDate: "2027-03-25",
	endDate: "2027-09-26",
};
const PLAYOFFS_2027 = {
	startDate: "2027-09-27",
	endDate: "2027-10-31",
};

const BREWERS = {
	teamId: 158,
	name: "Milwaukee Brewers",
	season: 2026,
	wonOn: "2026-10-28",
};

/** 2027's spring (March 2): spring's table, the new season's blank list. */
const SPRING_DAY: Season = {
	phase: "spring",
	spring: {
		...SPRING_2027,
		table: SPRING_TABLE,
	},
	regularSeason: {
		...REGULAR_2027,
		table: blankRegularSeasonTable(SPRING_TABLE, 2027, "2027-03-02"),
	},
	playoffs: PLAYOFFS_2027,
	champion: null,
};

/** 2027-02-19, spring's first morning: spring's table has no team yet (S139 AC 4). */
const SPRING_MORNING: Season = {
	...SPRING_DAY,
	phase: "final",
	spring: {
		...SPRING_2027,
		table: {
			...SPRING_TABLE,
			date: "2027-02-19",
			divisions: [],
		},
	},
};

/** 2026-09-05: the regular season, nobody clinched. */
const REGULAR_DAY: Season = {
	phase: "regularSeason",
	spring: {
		startDate: "2026-02-20",
		endDate: "2026-03-24",
		table: {
			...SPRING_TABLE,
			season: 2026,
		},
	},
	regularSeason: {
		startDate: "2026-03-25",
		endDate: "2026-09-27",
		table: {
			...BASE_TABLE,
			phase: "regularSeason",
			season: 2026,
		},
	},
	playoffs: {
		startDate: "2026-09-28",
		endDate: "2026-10-28",
	},
	champion: null,
};

/** 2026's off-season once the Brewers won on 2026-10-28: the final table and the champion. */
function afterSeries(letters?: Record<string, string | null | undefined>): Season
{
	return {
		...REGULAR_DAY,
		phase: "final",
		regularSeason: {
			...REGULAR_DAY.regularSeason,
			table: finalTable(letters),
		},
		champion: BREWERS,
	};
}

/** The phases a request names, read from `includePhases` however it is written. */
function phasesOf(request: Request): string[]
{
	return new URL(request.url).searchParams.getAll("includePhases").flatMap((p) => p.split(","));
}

/** The answer the API would give `season` for `phases`. */
function answer(season: Season, phases: string[]): Payload
{
	const named = (phase: SeasonPhaseName) => phases.length === 0 || phases.includes(phase);
	const regular = season.regularSeason.table;
	const top = season.phase === "spring" && season.spring ? season.spring.table : regular;
	return {
		...top,
		phase: season.phase,
		champion: season.champion,
		phases: {
			spring: season.spring
				? {
					startDate: season.spring.startDate,
					endDate: season.spring.endDate,
					...named("spring") && {
						table: season.spring.table,
					},
				}
				: null,
			regularSeason: {
				startDate: season.regularSeason.startDate,
				endDate: season.regularSeason.endDate,
				...named("regularSeason") && {
					table: regular,
				},
			},
			playoffs: season.playoffs
				? {
					startDate: season.playoffs.startDate,
					endDate: season.playoffs.endDate,
					...named("playoffs") && {
						table: playoffsTable(regular),
					},
				}
				: null,
		},
	};
}

/**
 * Serves `season`, recording each request's phases. A request naming one of `held` waits until
 * `release()` is called, so a test can look at the page between two answers; the first `failing.times`
 * requests naming `failing.phase` answer 500.
 */
function serveSeason(season: Season, held: SeasonPhaseName[] = [], failing: { phase: SeasonPhaseName;
	times: number; } | null = null)
{
	let failures = 0;
	const asked: string[][] = [];
	let release = () => undefined as void;
	const gate = new Promise<void>((resolve) =>
	{
		release = resolve;
	});
	const fetchMock = vi.fn(async (request: Request) =>
	{
		const phases = phasesOf(request);
		asked.push(phases);
		if (phases.some((p) => held.includes(p as SeasonPhaseName))) await gate;
		if (failing && phases.includes(failing.phase) && failures < failing.times)
		{
			failures += 1;
			return jsonResponse({
				error: "unavailable",
			}, 500);
		}
		return jsonResponse(answer(season, phases));
	});
	vi.stubGlobal("fetch", fetchMock);
	return {
		asked,
		release: () => release(),
	};
}

/** The address and how the router last moved, and a Back button, beside the page. */
function Probe()
{
	const location = useLocation();
	const type = useNavigationType();
	const navigate = useNavigate();
	return (
		<>
			<output data-testid="search">{location.search}</output>
			<output data-testid="nav-type">{type}</output>
			<button type="button" onClick={() => void navigate(-1)}>Back</button>
			<Link to="/games/2026-09-05">Scoreboard</Link>
		</>
	);
}

function renderPage(path: string, variant: "mobile" | "medium" | "desktop" = "desktop")
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/standings" element={<><StandingsPage variant={variant} /><Probe /></>} />
						<Route path="/games/:date" element={<p>The scoreboard</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** Today as MLB reads it: only `Date` is faked, so timers and promises run as usual. */
function today(day: string)
{
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	vi.setSystemTime(new Date(`${day}T17:00:00Z`));
}

const tabs = () => screen.queryAllByRole("tab").map((t) => t.textContent);
const marked = () => screen.getByRole("tab", {
	selected: true,
}).textContent;
const columns = () => within(screen.getAllByTestId("division-table")[0]!).getAllByRole("columnheader").map((h) => h.textContent);
const search = () => screen.getByTestId("search").textContent;

/** Every request names `includePhases`, and nothing but the regular season and the given phases. */
function onlyAsked(asked: string[][], allowed: string[])
{
	for (const phases of asked)
	{
		expect(phases.length).toBeGreaterThan(0);
		for (const phase of phases) expect(["regularSeason", ...allowed]).toContain(phase);
	}
}

describe("StandingsPage: which views, the requests and the switch (S130 AC 1)", () =>
{
	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("S130 AC 1: no ?view= on a regular-season day asks once, for the regular season alone, and draws no switch", async () =>
	{
		const { asked } = serveSeason(REGULAR_DAY);
		renderPage("/standings?date=2026-09-05");
		await screen.findAllByTestId("division-table");
		expect(asked).toEqual([["regularSeason"]]);
		expect(tabs()).toEqual([]);
		expect(columns()).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
	});

	it("S130 AC 1: no ?view= on a spring day asks again for spring, and the regular season's table is never drawn first", async () =>
	{
		const server = serveSeason(SPRING_DAY, ["spring"]);
		renderPage("/standings?date=2027-03-02");
		await waitFor(() => expect(server.asked).toEqual([["regularSeason"], ["regularSeason", "spring"]]));
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.queryByTestId("division-table")).toBeNull();
		server.release();
		await screen.findAllByTestId("division-table");
		expect(columns()).toEqual(["Team", "", "W", "L", "PCT"]);
		expect(tabs()).toEqual(["Spring training", "Regular season"]);
		expect(marked()).toBe("Spring training");
		expect(search()).toBe("?date=2027-03-02");
	});

	it("S130 AC 1: in the playoffs' first week, no ?view= asks again for the playoffs and opens them", async () =>
	{
		const server = serveSeason(afterSeries(), ["playoffs"]);
		renderPage("/standings?date=2026-10-29");
		await waitFor(() => expect(server.asked).toEqual([["regularSeason"], ["regularSeason", "playoffs"]]));
		expect(screen.queryByTestId("division-table")).toBeNull();
		server.release();
		await screen.findAllByTestId("division-table");
		expect(marked()).toBe("Playoffs");
		expect(tabs()).toEqual(["Regular season", "Playoffs"]);
		onlyAsked(server.asked, ["playoffs"]);
	});

	it("S130 AC 1: ?view=spring on a spring day and ?view=playoffs ask once, naming the regular season and that phase", async () =>
	{
		const spring = serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02&view=spring");
		await screen.findAllByTestId("division-table");
		expect(spring.asked).toEqual([["regularSeason", "spring"]]);
		cleanup();
		const playoffs = serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-04&view=playoffs");
		await screen.findAllByTestId("division-table");
		expect(playoffs.asked).toEqual([["regularSeason", "playoffs"]]);
		expect(marked()).toBe("Playoffs");
	});

	it("S130 AC 1: ?view=default and ?view=bogus ask first for the regular season alone, show the default and correct the address with no history entry", async () =>
	{
		for (const view of ["default", "bogus"])
		{
			const server = serveSeason(REGULAR_DAY);
			renderPage(`/standings?date=2026-09-05&view=${view}`);
			await screen.findAllByTestId("division-table");
			await waitFor(() => expect(search()).toBe("?date=2026-09-05"));
			expect(screen.getByTestId("nav-type").textContent).toBe("REPLACE");
			expect(server.asked[0]).toEqual(["regularSeason"]);
			onlyAsked(server.asked, []);
			expect(screen.getAllByTestId("division-table")).toHaveLength(6);
			expect(screen.queryByLabelText("Loading")).toBeNull();
			cleanup();
		}
	});

	it("S130 AC 1: an address asking for a view the day doesn't offer shows the default and is corrected in place", async () =>
	{
		const server = serveSeason(afterSeries());
		renderPage("/standings?date=2026-12-01&view=playoffs");
		await screen.findAllByTestId("division-table");
		await waitFor(() => expect(search()).toBe("?date=2026-12-01"));
		expect(screen.getByTestId("nav-type").textContent).toBe("REPLACE");
		expect(tabs()).toEqual([]);
		expect(columns()).toContain("GB");
		expect(screen.queryByLabelText("Loading")).toBeNull();
		onlyAsked(server.asked, ["playoffs"]);
	});

	it("S130 AC 1: an address with no ?view= on a day whose default isn't the regular season is left as it is", async () =>
	{
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02");
		await screen.findAllByTestId("division-table");
		expect(search()).toBe("?date=2027-03-02");
		expect(screen.getByTestId("nav-type").textContent).toBe("POP");
	});

	it("S130 AC 1: choosing a view keeps ?date=, keeps the old table until the new one is drawn, and Back returns to the one before", async () =>
	{
		const server = serveSeason(afterSeries(), ["playoffs"]);
		const user = userEvent.setup();
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		expect(marked()).toBe("Regular season");
		await user.click(screen.getByRole("tab", {
			name: "Playoffs",
		}));
		expect(search()).toBe("?date=2026-11-04&view=playoffs");
		await waitFor(() => expect(server.asked.at(-1)).toEqual(["regularSeason", "playoffs"]));
		expect(columns()).toContain("GB");
		// The tab title follows the marked tab while the new view's table is on its way (A9's title table).
		expect(document.title).toBe("Standings as of November 4, 2026 · Playoffs · Baseball Theater");
		expect(screen.queryByLabelText("Loading")).toBeNull();
		server.release();
		await waitFor(() => expect(columns()).toEqual(["Team", ""]));
		expect(marked()).toBe("Playoffs");
		await user.click(screen.getByRole("button", {
			name: "Back",
		}));
		expect(search()).toBe("?date=2026-11-04");
		await waitFor(() => expect(columns()).toContain("GB"));
		expect(screen.queryByLabelText("Loading")).toBeNull();
		onlyAsked(server.asked, ["playoffs"]);
	});

	it("S130 AC 1: a switch whose phase fails shows the error state with no switch, and Retry asks for that view again until it comes", async () =>
	{
		const server = serveSeason(afterSeries(), [], {
			phase: "playoffs",
			times: 2,
		});
		const user = userEvent.setup();
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		await user.click(screen.getByRole("tab", {
			name: "Playoffs",
		}));
		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Couldn't load standings")).toBeInTheDocument();
		expect(search()).toBe("?date=2026-11-04&view=playoffs");
		expect(tabs()).toEqual([]);
		expect(screen.queryByTestId("division-table")).toBeNull();
		expect(screen.queryByTestId("world-series-box")).toBeNull();
		expect(document.title).not.toContain("Regular season");
		const playoffAsks = () => server.asked.filter((phases) => phases.includes("playoffs")).length;
		expect(playoffAsks()).toBe(1);
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		await waitFor(() => expect(playoffAsks()).toBe(2));
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		expect(screen.queryByTestId("division-table")).toBeNull();
		await user.click(within(screen.getByRole("alert")).getByRole("button", {
			name: "Retry",
		}));
		await waitFor(() => expect(columns()).toEqual(["Team", ""]));
		expect(playoffAsks()).toBe(3);
		expect(server.asked.at(-1)).toEqual(["regularSeason", "playoffs"]);
		expect(marked()).toBe("Playoffs");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("S130 AC 1: an empty ?date= reads as no day: the day's views and default are today's", async () =>
	{
		today("2027-03-02");
		const server = serveSeason(SPRING_DAY);
		renderPage("/standings?date=");
		await screen.findAllByTestId("division-table");
		expect(tabs()).toEqual(["Spring training", "Regular season"]);
		expect(marked()).toBe("Spring training");
		expect(server.asked).toEqual([["regularSeason"], ["regularSeason", "spring"]]);
	});

	it("S130 AC 1: choosing the view already shown adds no history entry and asks for nothing", async () =>
	{
		const server = serveSeason(afterSeries());
		const user = userEvent.setup();
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		const asks = server.asked.length;
		await user.click(screen.getByRole("tab", {
			name: "Regular season",
		}));
		expect(search()).toBe("?date=2026-11-04");
		expect(screen.getByTestId("nav-type").textContent).toBe("POP");
		expect(server.asked).toHaveLength(asks);
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-04&view=playoffs");
		await screen.findAllByTestId("division-table");
		await user.click(screen.getByRole("tab", {
			name: "Playoffs",
		}));
		expect(search()).toBe("?date=2026-11-04&view=playoffs");
		expect(screen.getByTestId("nav-type").textContent).toBe("POP");
	});

	it("S130 AC 1: each tab names a panel that exists, and the tables are in the marked tab's panel", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		for (const tab of screen.getAllByRole("tab"))
		{
			const id = tab.getAttribute("aria-controls");
			expect(id).toBeTruthy();
			expect(document.getElementById(id!)).not.toBeNull();
		}
		const panel = screen.getByRole("tabpanel");
		expect(within(panel).getAllByTestId("division-table")).toHaveLength(6);
		expect(panel).toHaveAttribute("aria-labelledby", screen.getByRole("tab", {
			selected: true,
		}).id);
	});

	it("S130 AC 1: each set of views S129 draws, and all three when the day offers them", async () =>
	{
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02");
		await screen.findAllByRole("tab");
		expect(tabs()).toEqual(["Spring training", "Regular season"]);
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByRole("tab");
		expect(tabs()).toEqual(["Regular season", "Playoffs"]);
		cleanup();
		const three = serveSeason({
			...SPRING_DAY,
			phase: "regularSeason",
			regularSeason: {
				...REGULAR_2027,
				table: finalTable(),
			},
			playoffs: {
				startDate: "2027-03-28",
				endDate: "2027-03-29",
			},
		});
		renderPage("/standings?date=2027-03-30&view=regularSeason");
		await screen.findAllByRole("tab");
		expect(tabs()).toEqual(["Spring training", "Regular season", "Playoffs"]);
		expect(three.asked).toEqual([["regularSeason"]]);
	});

	it("S130 AC 1: an answer without phases (cached before S139) draws S128's table with no switch", async () =>
	{
		serve(() => jsonResponse(STANDINGS));
		renderPage("/standings?date=2026-09-05&view=spring");
		await screen.findAllByTestId("division-table");
		expect(tabs()).toEqual([]);
		expect(columns()).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
	});
});

describe("StandingsPage: each view and the clinch marks (S130 AC 2)", () =>
{
	const rowCells = (abbreviation: string) =>
	{
		const row = screen.getAllByTestId("standings-row").find((r) => within(r).queryByText(abbreviation));
		return row!;
	};

	it("S130 AC 2: spring has no GB column; the regular season before its first game is 0-0 with dashes", async () =>
	{
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02&view=spring");
		await screen.findAllByTestId("division-table");
		expect(columns()).toEqual(["Team", "", "W", "L", "PCT"]);
		expect(screen.queryByTestId("clinch-legend")).toBeNull();
		cleanup();
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02&view=regularSeason");
		await screen.findAllByTestId("division-table");
		expect(columns()).toEqual(["Team", "", "W", "L", "PCT", "GB"]);
		expect(within(rowCells("BAL")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Baltimore Orioles", "BAL", "0", "0", "—", "—"]);
		expect(screen.queryByTestId("clinch-legend")).toBeNull();
		expect(marked()).toBe("Regular season");
	});

	it("S130 AC 2: the playoffs list, teams from two divisions with their letters and no numbers", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-10-29&view=playoffs");
		const tables = await screen.findAllByTestId("division-table");
		expect(tables).toHaveLength(2);
		expect(columns()).toEqual(["Team", ""]);
		expect(screen.getAllByTestId("standings-row").map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["z-Tampa Bay Rays", "w-New York Yankees", "y-Cleveland Guardians"]);
		expect(screen.getAllByTestId("clinch-legend-line").map((l) => l.textContent)).toEqual([
			"z Clinched the league's best record",
			"y Clinched the division",
			"w Clinched a wild card",
		]);
	});

	it("S130 AC 2: the final table marks z, y and w teams bold with their letters, the legend lists exactly those three", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		const rays = rowCells("TB");
		expect(within(rays).getAllByRole("cell")[0]!.textContent).toBe("z-Tampa Bay Rays");
		expect(rays).toHaveAttribute("data-clinched", "true");
		expect(within(rays).getByText("z-Tampa Bay Rays")).toHaveStyle({
			fontWeight: "700",
		});
		expect(within(rays).getByText("85")).toHaveStyle({
			fontWeight: "700",
		});
		const sox = rowCells("BOS");
		expect(within(sox).getAllByRole("cell")[0]!.textContent).toBe("Boston Red Sox");
		expect(sox).not.toHaveAttribute("data-clinched");
		expect(within(sox).getByText("Boston Red Sox")).not.toHaveStyle({
			fontWeight: "700",
		});
		expect(screen.getAllByTestId("clinch-legend-line").map((l) => l.textContent?.charAt(0))).toEqual(["z", "y", "w"]);
	});

	it("S130 AC 2: a letter outside z, y, w and x prints before its team with no legend line; a clinched team with no letter is bold with no prefix", async () =>
	{
		serveSeason(afterSeries({
			NYY: "e",
			CLE: null,
			BOS: undefined,
			TB: "y",
		}));
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		expect(within(rowCells("NYY")).getAllByRole("cell")[0]!.textContent).toBe("e-New York Yankees");
		expect(within(rowCells("CLE")).getAllByRole("cell")[0]!.textContent).toBe("Cleveland Guardians");
		expect(rowCells("CLE")).toHaveAttribute("data-clinched", "true");
		expect(within(rowCells("BOS")).getAllByRole("cell")[0]!.textContent).toBe("Boston Red Sox");
		expect(rowCells("BOS")).toHaveAttribute("data-clinched", "true");
		expect(screen.getAllByTestId("clinch-legend-line").map((l) => l.textContent?.charAt(0))).toEqual(["y"]);
	});

	it("S130 AC 2: a team with a letter that hasn't clinched shows no prefix, isn't bold and adds no legend line", async () =>
	{
		const season = afterSeries({
			TB: "z",
		});
		season.regularSeason.table = {
			...season.regularSeason.table,
			divisions: season.regularSeason.table.divisions.map((division) => ({
				...division,
				teams: division.teams.map((team) => (team.abbreviation === "BAL"
					? {
						...team,
						clinched: false,
						clinchIndicator: "x",
					}
					: team)),
			})),
		};
		serveSeason(season);
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		expect(within(rowCells("BAL")).getAllByRole("cell")[0]!.textContent).toBe("Baltimore Orioles");
		expect(rowCells("BAL")).not.toHaveAttribute("data-clinched");
		expect(screen.getAllByTestId("clinch-legend-line").map((l) => l.textContent?.charAt(0))).toEqual(["z"]);
	});

	it("S130 AC 2: on mobile each team is its abbreviation after its letter, the table full width with no abbreviation column (A7, A9)", async () =>
	{
		const season = afterSeries();
		const teams = season.regularSeason.table.divisions[0]!.teams;
		teams[2] = {
			...teams[2]!,
			abbreviation: null,
		};
		serveSeason(season);
		renderPage("/standings?date=2026-10-29&view=regularSeason", "mobile");
		await screen.findAllByTestId("division-table");
		expect(columns()).toEqual(["Team", "W", "L", "PCT", "GB"]);
		expect(within(rowCells("z-TB")).getAllByRole("cell").map((c) => c.textContent)).toEqual(["z-TB", "85", "57", ".599", "—"]);
		expect(screen.getByText("Boston Red Sox")).toBeInTheDocument();
		expect(within(screen.getByTestId("world-series-box")).getByText("Milwaukee Brewers")).toBeInTheDocument();
		expect(screen.getByRole("heading", {
			level: 1,
		}).textContent).toBe("Standings as of October 29, 2026");
	});

	it("S130 AC 2: a page with no clinched team has no legend", async () =>
	{
		serveSeason(REGULAR_DAY);
		renderPage("/standings?date=2026-09-05");
		await screen.findAllByTestId("division-table");
		expect(screen.queryByTestId("clinch-legend")).toBeNull();
	});

	it("S130 AC 2: spring's first morning draws S129's empty-spring text with the switch", async () =>
	{
		serveSeason(SPRING_MORNING);
		renderPage("/standings?date=2027-02-19");
		expect(await screen.findByText("Spring training starts today")).toBeInTheDocument();
		expect(screen.getByText("Its standings show here once the first spring game is final.")).toBeInTheDocument();
		expect(tabs()).toEqual(["Spring training", "Regular season"]);
		expect(marked()).toBe("Spring training");
		expect(screen.queryByText("No standings for this date.")).toBeNull();
	});

	it("S130 AC 2: the first load and the error state draw no switch and no box", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderPage("/standings?date=2026-10-29");
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(tabs()).toEqual([]);
		expect(screen.queryByTestId("world-series-box")).toBeNull();
		cleanup();
		serve(() => jsonResponse({
			error: "unavailable",
		}, 503));
		renderPage("/standings?date=2026-10-29");
		await screen.findByRole("alert");
		expect(tabs()).toEqual([]);
		expect(screen.queryByTestId("world-series-box")).toBeNull();
	});
});

describe("StandingsPage: the \"as of\" line (S130 AC 3)", () =>
{
	afterEach(() =>
	{
		vi.useRealTimers();
	});

	const heading = () => screen.getByRole("heading", {
		level: 1,
	}).textContent;

	it("S130 AC 3: a past day in each view reads \"Standings as of\" the day asked for, its month in full", async () =>
	{
		today("2027-03-10");
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings as of March 2, 2027");
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings as of December 1, 2026");
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-10-29&view=playoffs");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings as of October 29, 2026");
	});

	it("S130 AC 3: a ?date= that isn't a calendar day gets no \"as of\" words in the heading or the tab", async () =>
	{
		for (const date of ["bogus", "2027-02-30"])
		{
			serveSeason(REGULAR_DAY);
			renderPage(`/standings?date=${date}`);
			await screen.findAllByTestId("division-table");
			expect(heading()).toBe("Standings");
			expect(document.title).not.toContain("as of");
			cleanup();
		}
	});

	it("S130 AC 3: today's date in the address, or none, reads just Standings", async () =>
	{
		today("2027-03-02");
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings");
		cleanup();
		serveSeason(SPRING_DAY);
		renderPage("/standings");
		await screen.findAllByTestId("division-table");
		expect(heading()).toBe("Standings");
		expect(marked()).toBe("Spring training");
	});
});

describe("StandingsPage: the World Series box (S130 AC 4)", () =>
{
	const box = () => screen.queryByTestId("world-series-box");

	it("S130 AC 4: the first day after the Series: above the playoffs with no link, above the regular season with one that keeps ?date=", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-10-29");
		await screen.findAllByTestId("division-table");
		expect(marked()).toBe("Playoffs");
		expect(within(box()!).getByText("2026 World Series champions")).toBeInTheDocument();
		expect(within(box()!).getByText("Milwaukee Brewers")).toBeInTheDocument();
		expect(within(box()!).getByText("Won the World Series on October 28, 2026")).toBeInTheDocument();
		expect(within(box()!).queryByRole("link")).toBeNull();
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-10-29&view=regularSeason");
		await screen.findAllByTestId("division-table");
		const link = within(box()!).getByRole("link", {
			name: "View the playoffs →",
		});
		const href = new URL(link.getAttribute("href")!, "http://bt.test");
		expect(href.pathname).toBe("/standings");
		expect(href.searchParams.get("date")).toBe("2026-10-29");
		expect(href.searchParams.get("view")).toBe("playoffs");
	});

	it("S130 AC 4: the seventh day after it, with its link; the eighth, without one", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		expect(marked()).toBe("Regular season");
		expect(within(box()!).getByRole("link", {
			name: "View the playoffs →",
		})).toBeInTheDocument();
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-11-05");
		await screen.findAllByTestId("division-table");
		expect(box()).toBeInTheDocument();
		expect(within(box()!).queryByRole("link")).toBeNull();
		expect(tabs()).toEqual([]);
	});

	it("S130 AC 4: no champion, or a day S129's rule leaves out: no box", async () =>
	{
		serveSeason(REGULAR_DAY);
		renderPage("/standings?date=2026-09-05");
		await screen.findAllByTestId("division-table");
		expect(box()).toBeNull();
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2027-02-01");
		await screen.findAllByTestId("division-table");
		expect(box()).toBeNull();
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-10-28");
		await screen.findAllByTestId("division-table");
		expect(box()).toBeNull();
	});

	it("S130 AC 4: switching views keeps the same box on screen, so its sheen doesn't run again", async () =>
	{
		const server = serveSeason(afterSeries(), ["playoffs"]);
		const user = userEvent.setup();
		renderPage("/standings?date=2026-11-04");
		await screen.findAllByTestId("division-table");
		const before = box();
		expect(before).toHaveAttribute("data-sheen", "once");
		await user.click(screen.getByRole("tab", {
			name: "Playoffs",
		}));
		expect(box()).toBe(before);
		server.release();
		await waitFor(() => expect(columns()).toEqual(["Team", ""]));
		expect(box()).toBe(before);
	});

	it("S130 AC 4: the stylesheet itself stops the sheen under reduced motion, before the component reads the setting", () =>
	{
		// jsdom applies no media queries and Vitest stands in for CSS modules, so this reads the file's text.
		const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/standings/ChampionBox.module.css"), "utf8");
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.sheen::after\s*\{[^}]*animation: none/);
	});

	it("S130 AC 4: its sheen runs once, and not at all for a fan whose device asks for reduced motion", async () =>
	{
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		expect(box()).toHaveAttribute("data-sheen", "once");
		cleanup();
		const original = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			...original(query),
			matches: query.includes("prefers-reduced-motion"),
		})) as typeof window.matchMedia;
		try
		{
			serveSeason(afterSeries());
			renderPage("/standings?date=2026-12-01");
			await screen.findAllByTestId("division-table");
			await waitFor(() => expect(box()).not.toHaveAttribute("data-sheen"));
		}
		finally
		{
			window.matchMedia = original;
		}
	});
});

describe("StandingsPage: the title (S130 AC 5)", () =>
{
	afterEach(() =>
	{
		vi.useRealTimers();
		document.title = "Baseball Theater";
	});

	it("S130 AC 5: today, each view's heading is Standings and the tab names the view", async () =>
	{
		today("2027-03-02");
		serveSeason(SPRING_DAY);
		renderPage("/standings");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings · Spring training · Baseball Theater");
		cleanup();
		today("2026-09-05");
		serveSeason(REGULAR_DAY);
		renderPage("/standings");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings · Regular season · Baseball Theater");
		cleanup();
		today("2026-10-29");
		serveSeason(afterSeries());
		renderPage("/standings");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings · Playoffs · Baseball Theater");
		expect(screen.getByRole("heading", {
			level: 1,
		}).textContent).toBe("Standings");
	});

	it("S130 AC 5: a past day names it in the heading and the tab", async () =>
	{
		today("2027-03-10");
		serveSeason(SPRING_DAY);
		renderPage("/standings?date=2027-03-02");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings as of March 2, 2027 · Spring training · Baseball Theater");
		cleanup();
		serveSeason(afterSeries());
		renderPage("/standings?date=2026-12-01");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings as of December 1, 2026 · Regular season · Baseball Theater");
	});

	it("S130 AC 5: leaving for the scoreboard puts back the app's title", async () =>
	{
		document.title = "Baseball Theater";
		serveSeason(REGULAR_DAY);
		const user = userEvent.setup();
		renderPage("/standings?date=2026-09-05");
		await screen.findAllByTestId("division-table");
		expect(document.title).toBe("Standings as of September 5, 2026 · Regular season · Baseball Theater");
		await user.click(screen.getByRole("link", {
			name: "Scoreboard",
		}));
		expect(await screen.findByText("The scoreboard")).toBeInTheDocument();
		expect(document.title).toBe("Baseball Theater");
	});
});
