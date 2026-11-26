/**
 * S5: Search Highlights. The API is stubbed with answers shaped as `GET /api/v1/search/highlights`
 * gives them for MLB's recorded "walk-off" search (`fixtures/search-walk-off.json`): a World Series
 * walk-off with its game, and a season montage MLB ties to no game.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	Link, MemoryRouter, Route, Routes, useLocation, useNavigate,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { DEFAULT_SETTINGS, SEARCH_QUERY_MAX_LENGTH } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import type { SearchHighlightsPayload } from "../api/search.js";
import { hydrateSettings, resetSettings } from "../settings/store.js";
import { expectInsetPlayer } from "../test/insetPlayer.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { SearchPage } from "./SearchPage.js";
import { PlayerProvider } from "../components/videos/PlayerProvider.js";
import { expectInCorner, markPlaying } from "../test/renderWithPlayer.js";

const WORLD_SERIES: SearchHighlightsPayload["highlights"][number] = {
	highlight: {
		id: "ws-g4",
		playId: null,
		title: "Ben Williamson's walk-off single to win Game 4",
		blurb: "Ben Williamson's walk-off single to win Game 4",
		duration: "00:00:44",
		imageUrl: null,
		playbackUrl: "https://mlb-cuts-diamond.mlb.com/ws-g4.mp4",
		renditions: [],
		kind: "highlight",
		date: "2026-10-27",
	},
	game: {
		gamePk: 849803,
		officialDate: "2026-10-27",
		away: "MIL",
		home: "TB",
		awayId: 158,
		homeId: 139,
	},
	halfInning: null,
	inning: null,
};

const MONTAGE: SearchHighlightsPayload["highlights"][number] = {
	highlight: {
		id: "montage",
		playId: null,
		title: "ALL walk-offs from the 2026 season",
		blurb: "Take a look at ALL the walk-offs from the 2026 season",
		duration: "00:55:30",
		imageUrl: null,
		playbackUrl: "https://mlb-cuts-diamond.mlb.com/montage.mp4",
		renditions: [],
		kind: "highlight",
		date: "2026-11-03",
	},
	game: null,
	halfInning: null,
	inning: null,
};

const WALK_OFF: SearchHighlightsPayload = {
	query: "walk-off",
	total: 3341,
	highlights: [WORLD_SERIES, MONTAGE],
};

/** Every search the page asks for, by its `q`. */
let asked: string[] = [];

/**
 * Answers each search with `answer(q)` (a body, or a `Response` for an error; a promise that never
 * settles keeps it loading) and the settings with `settings`.
 */
function serve(answer: (q: string) => SearchHighlightsPayload | Response | Promise<never>, settings = DEFAULT_SETTINGS): void
{
	asked = [];
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const url = new URL(request.url);
		if (url.pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(settings));
		if (url.pathname !== "/api/v1/search/highlights") return Promise.resolve(jsonResponse({
			error: "not_found",
		}, 404));
		const q = url.searchParams.get("q") ?? "";
		asked.push(q);
		const body = answer(q);
		if (body instanceof Promise) return body;
		return Promise.resolve(body instanceof Response ? body : jsonResponse(body));
	}));
}

/** Where the router is, so a test can see the words stay in the URL; Back and the nav's plain Search link, as the shell gives them. */
function Where()
{
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<span data-testid="where">{location.pathname + location.search}</span>
			<button type="button" onClick={() => void navigate(-1)}>Back</button>
			<Link to="/search">Search nav</Link>
		</>
	);
}

function renderSearch(entry = "/search")
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[entry]}><PlayerProvider>
					<Routes>
						<Route path="/search" element={<><SearchPage variant="desktop" /><Where /></>} />
						<Route path="/game/:gamePk" element={<p>game page</p>} />
						<Route path="/game/:gamePk/videos" element={<p>game videos</p>} />
						<Route path="/game/:gamePk/plays" element={<><p>plays room</p><Where /></>} />
					</Routes>
				</PlayerProvider></MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** Types `words` in the box and presses Enter, as a fan searches. */
async function searchFor(words: string): Promise<void>
{
	const box = screen.getByRole("searchbox", {
		name: "Search highlights",
	});
	await userEvent.clear(box);
	await userEvent.type(box, `${words}{Enter}`);
}

afterEach(() =>
{
	cleanup();
	resetSettings();
	vi.unstubAllGlobals();
});

describe("Search Highlights (S5)", () =>
{
	it("S5 AC 4: searching walk-off shows a walk-off result's title", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch();
		await searchFor("walk-off");
		expect(await screen.findByText("Ben Williamson's walk-off single to win Game 4")).toBeInTheDocument();
		expect(asked).toEqual(["walk-off"]);
		expect(screen.getByTestId("where")).toHaveTextContent("/search?q=walk-off");
	});

	it("S5 AC 8: cards with kind · date after both teams' MatchupAbbr, with no count; a clip with no game has no matchup (#588)", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch("/search?q=walk-off");
		const rows = await screen.findAllByTestId("search-result");
		expect(rows).toHaveLength(2);
		expect(within(rows[0]!).getByTestId("video-meta")).toHaveTextContent(/^Highlight · Oct 27, 2026$/);
		expect(within(rows[0]!).getByTestId("matchup-abbr")).toHaveTextContent("MIL@TB");
		expect(within(rows[0]!).getByTestId("video-duration")).toHaveTextContent("0:44");
		expect(within(rows[1]!).getByTestId("video-meta")).toHaveTextContent(/^Highlight · Nov 3, 2026$/);
		expect(within(rows[1]!).queryByTestId("matchup-abbr")).toBeNull();
	});

	it("S5 AC 8: no number shows until paging, neither the clips listed nor MLB's total (owner, 2026-11-22)", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch("/search?q=walk-off");
		await screen.findAllByTestId("search-result");
		expect(screen.queryByText(/results? found/i)).toBeNull();
		expect(screen.queryByTestId("search-count")).toBeNull();
		expect(document.body.textContent).not.toMatch(/3,?341/);
		cleanup();
		serve(() => ({
			...WALK_OFF,
			highlights: [MONTAGE],
		}));
		renderSearch("/search?q=walk-off");
		await screen.findAllByTestId("search-result");
		expect(screen.queryByText(/results? found/i)).toBeNull();
	});

	it("S5 AC 9: the page is Search Highlights with the hint Search highlights…", () =>
	{
		serve(() => WALK_OFF);
		renderSearch();
		expect(screen.getByRole("heading", {
			name: "Search Highlights",
		})).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Search highlights…")).toBeInTheDocument();
		// Nothing is asked until there are words.
		expect(asked).toEqual([]);
	});

	it("S5 AC 9: a tapped result plays in the floating player even with the stage setting, with its game pill (S173); Close returns to the same results and words", async () =>
	{
		serve(() => WALK_OFF, {
			...DEFAULT_SETTINGS,
			videoPlayer: "stage",
			version: 1,
		});
		await hydrateSettings("test-user");
		renderSearch();
		await searchFor("walk-off");
		await userEvent.click(await screen.findByRole("link", {
			name: "Play Ben Williamson's walk-off single to win Game 4",
		}));
		const link = await screen.findByRole("link", {
			name: "More from game: MIL @ TB, Oct 27",
		});
		expect(link).toHaveAttribute("href", "/game/849803/videos");
		await userEvent.click(screen.getByRole("button", {
			name: "Close video",
		}));
		await waitFor(() => expect(screen.queryByRole("button", {
			name: "Close video",
		})).toBeNull());
		expect(screen.getAllByTestId("search-result")).toHaveLength(2);
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toHaveValue("walk-off");
		expect(screen.getByTestId("where")).toHaveTextContent("/search?q=walk-off");
		expect(asked).toEqual(["walk-off"]);
	});

	it("S5 AC 9: Esc closes the player back to the results; a clip with no game shows no game pill; the game pill opens the game's videos", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch("/search?q=walk-off");
		await userEvent.click(await screen.findByRole("link", {
			name: "Play ALL walk-offs from the 2026 season",
		}));
		await screen.findByRole("button", {
			name: "Close video",
		});
		expect(screen.queryByRole("link", {
			name: /More from game/,
		})).toBeNull();
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("button", {
			name: "Close video",
		})).toBeNull());
		expect(screen.getAllByTestId("search-result")).toHaveLength(2);

		await userEvent.click(screen.getByRole("link", {
			name: "Play Ben Williamson's walk-off single to win Game 4",
		}));
		await userEvent.click(await screen.findByRole("link", {
			name: "More from game: MIL @ TB, Oct 27",
		}));
		expect(await screen.findByText("game videos")).toBeInTheDocument();
	});

	it("a query of only hyphens asks nothing and shows no error, as an empty box does", async () =>
	{
		serve(() => jsonResponse({
			error: "query_required",
		}, 400));
		renderSearch("/search?q=-");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(asked).toEqual([]);
		expect(screen.queryByText("Couldn't search highlights")).toBeNull();
		expect(screen.queryByLabelText("Loading")).toBeNull();
	});

	it("the box follows the URL: Back restores the earlier words, and the plain Search link empties it", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch();
		await searchFor("walk off");
		expect(await screen.findAllByTestId("search-result")).toHaveLength(2);
		await searchFor("homer");
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/search?q=homer"));
		await userEvent.click(screen.getByRole("button", {
			name: "Back",
		}));
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/search?q=walk+off"));
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toHaveValue("walk off");
		await userEvent.click(screen.getByRole("link", {
			name: "Search nav",
		}));
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/search$/));
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toHaveValue("");
	});

	it("the box keeps focus after a search, so a keyboard user can search again at once", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch();
		await searchFor("walk off");
		expect(await screen.findAllByTestId("search-result")).toHaveLength(2);
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toHaveFocus();
	});

	it("words longer than the route takes are never asked: the box stops at the limit, and a too-long URL shows an empty page", async () =>
	{
		serve(() => jsonResponse({
			error: "query_too_long",
		}, 400));
		renderSearch(`/search?q=${"a".repeat(SEARCH_QUERY_MAX_LENGTH + 1)}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(asked).toEqual([]);
		expect(screen.queryByText("Couldn't search highlights")).toBeNull();
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toHaveAttribute("maxlength", String(SEARCH_QUERY_MAX_LENGTH));
	});

	it("S5 AC 10: no results draws ViewState's empty sentence", async () =>
	{
		serve((q) => ({
			query: q,
			total: 0,
			highlights: [],
		}));
		renderSearch("/search?q=zzzz");
		expect(await screen.findByText("No highlights found for “zzzz”.")).toBeInTheDocument();
		expect(screen.queryByText(/results? found/)).toBeNull();
	});

	it("S5 AC 10: loading draws ViewState's loader under the title", async () =>
	{
		serve(() => new Promise<never>(() => undefined));
		renderSearch("/search?q=walk-off");
		expect(await screen.findByLabelText("Loading")).toBeInTheDocument();
		expect(screen.getByRole("heading", {
			name: "Search Highlights",
		})).toBeInTheDocument();
	});

	it("loading: a skeleton of result rows (an icon, a title line, a meta line), with the search box still there (#584)", async () =>
	{
		serve(() => new Promise<never>(() => undefined));
		renderSearch("/search?q=walk-off");
		const loading = await screen.findByLabelText("Loading");
		expect(loading).toHaveAttribute("data-skeleton", "results");
		const rows = within(loading).getAllByTestId("skeleton-result");
		expect(rows.length).toBeGreaterThan(1);
		expect(screen.getByRole("searchbox", {
			name: "Search highlights",
		})).toBeInTheDocument();
	});

	it("S5 AC 10: an error draws ViewState's error with Retry, which asks again", async () =>
	{
		let fail = true;
		serve(() => (fail ? jsonResponse({
			error: "search_unavailable",
		}, 502) : WALK_OFF));
		renderSearch("/search?q=walk-off");
		expect(await screen.findByText("Couldn't search highlights")).toBeInTheDocument();
		fail = false;
		await userEvent.click(screen.getByRole("button", {
			name: "Retry",
		}));
		expect(await screen.findAllByTestId("search-result")).toHaveLength(2);
	});

	it("S5 AC 11: with Hide Scores on, each result keeps MLB's title, in its row and in the player, recap included", async () =>
	{
		const recap = {
			highlight: {
				...WORLD_SERIES.highlight,
				id: "recap",
				title: "Recap: MIL 7, TB 6",
				blurb: "Brewers walk off the Rays",
				tags: ["game-recap"],
			},
			game: WORLD_SERIES.game,
			halfInning: null,
			inning: null,
		};
		serve(() => ({
			...WALK_OFF,
			highlights: [recap, ...WALK_OFF.highlights],
		}), {
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		});
		await hydrateSettings("test-user");
		renderSearch("/search?q=walk-off");
		expect(await screen.findByText("Recap: MIL 7, TB 6")).toBeInTheDocument();
		expect(screen.getByText("Ben Williamson's walk-off single to win Game 4")).toBeInTheDocument();
		expect(screen.queryByText(/score hidden/i)).toBeNull();
		await userEvent.click(screen.getByRole("link", {
			name: "Play Recap: MIL 7, TB 6",
		}));
		await screen.findByRole("button", {
			name: "Close video",
		});
		// The player is labelled with the clip's title: MLB's, not "Recap (score hidden)".
		expect(document.querySelector("[aria-label='Recap: MIL 7, TB 6']")).not.toBeNull();
		expect(document.querySelector("[aria-label='Recap (score hidden)']")).toBeNull();
	});
});

describe("Search's results draw as the shared video cards, in a grid or a list (#588)", () =>
{
	it("draws each result as the Videos room's VideoCard in its VideoGrid, with no search-only video markup, and the Layout control switches to the list and back (#588)", async () =>
	{
		const user = userEvent.setup();
		serve(() => ({
			...WALK_OFF,
			highlights: [MESA, WORLD_SERIES],
		}));
		renderSearch("/search?q=walk-off");
		const grid = await screen.findByTestId("videos-grid");
		// The shared VideoCard (its `data-layout`, still and meta line), keeping the old rows' test id for S5/S72/S153's design specs.
		const cards = within(grid).getAllByTestId("search-result");
		expect(cards).toHaveLength(2);
		expect(cards.every((card) => card.dataset.layout === "grid")).toBe(true);
		expect(cards.every((card) => card.classList.contains("bt-zoom-host"))).toBe(true);
		// The matchup the old rows showed stays, at the start of the meta line.
		expect(within(cards[0]!).getByTestId("matchup-abbr")).toHaveTextContent("TB@NYY");
		expect(within(cards[1]!).getByTestId("matchup-abbr")).toHaveTextContent("MIL@TB");
		// In a phone's ~170px grid card the matchup line wraps and may shrink, so matchup · date and the pill never overflow.
		const line = within(cards[0]!).getByTestId("video-meta-line");
		expect(line.getAttribute("style")).toMatch(/--group-wrap: wrap/);
		expect(line.getAttribute("style")).toMatch(/min-width: 0/);
		// Each card keeps its date line and, with a play, its inning pill (S153).
		expect(within(rowOf(MESA.highlight.title)).getByTestId("video-meta")).toHaveTextContent(/^Oct 7, 2026$/);
		expect(within(rowOf(MESA.highlight.title)).getByTestId("search-play-link")).toHaveAttribute("href", "/game/849838/plays?play=4f687124-5ec9-337b-a32b-2dedc930bcee");
		expect(within(rowOf(WORLD_SERIES.highlight.title)).getByTestId("video-meta")).toHaveTextContent(/^Highlight · Oct 27, 2026$/);

		await user.click(screen.getByRole("radio", {
			name: "List",
		}));
		expect(screen.queryByTestId("videos-grid")).toBeNull();
		const rows = within(screen.getByTestId("videos-list")).getAllByTestId("search-result");
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.dataset.layout === "list")).toBe(true);
		await user.click(screen.getByRole("radio", {
			name: "Grid",
		}));
		expect(within(screen.getByTestId("videos-grid")).getAllByTestId("search-result")).toHaveLength(2);
	});
});

describe("Search's list mode draws the Videos room's Best of rows (S200)", () =>
{
	it("S200 AC 3 search: in list mode each result is the shared VideoCard's Best of row, with no rank number", async () =>
	{
		const user = userEvent.setup();
		serve(() => ({
			...WALK_OFF,
			highlights: [MESA, WORLD_SERIES],
		}));
		renderSearch("/search?q=walk-off");
		await screen.findByTestId("videos-grid");
		await user.click(screen.getByRole("radio", {
			name: "List",
		}));
		const list = screen.getByTestId("videos-list");
		// Desktop lists the rows in three columns, as the Videos room's list does (S200 AC 3).
		expect(getComputedStyle(list).getPropertyValue("--sg-cols")).toBe("3");
		const rows = within(list).getAllByTestId("search-result");
		expect(rows).toHaveLength(2);
		for (const row of rows)
		{
			expect(row.dataset.layout).toBe("list");
			// The row's raised card is VideoCard's list layout, the one row markup (S200).
			expect(row.parentElement).toHaveClass("bt-card");
			expect(row.parentElement!.style.background).toBe("var(--bt-raised)");
			// No rank number: the still comes first in the row, and nothing in the card is a bare number.
			expect(row.firstElementChild!.querySelector(".bt-zoom")).not.toBeNull();
			expect(within(row.parentElement!).queryAllByText(/^\d+$/)).toHaveLength(0);
		}
	});
});

describe("Search's active filter chips (S72)", () =>
{
	/** Every search asked, as its query string; answered by `answer` from the request's parameters. */
	let requests: string[] = [];

	function serveFiltered(answer: (params: URLSearchParams) => SearchHighlightsPayload): void
	{
		requests = [];
		vi.stubGlobal("fetch", vi.fn((request: Request) =>
		{
			const url = new URL(request.url);
			if (url.pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
			if (url.pathname !== "/api/v1/search/highlights") return Promise.resolve(jsonResponse({
				error: "not_found",
			}, 404));
			const params = new URLSearchParams(url.search);
			params.sort();
			requests.push(params.toString());
			return Promise.resolve(jsonResponse(answer(params)));
		}));
	}

	/** Both clips while the tag filter is set's opposite: with `tag` only the World Series clip matches. */
	const byTag = (params: URLSearchParams): SearchHighlightsPayload => ({
		query: params.get("q") ?? "",
		total: params.has("tag") ? 1 : 2,
		highlights: params.has("tag") ? [WORLD_SERIES] : [WORLD_SERIES, MONTAGE],
	});

	it("S72 AC 2: draws a chip with ✕ per active filter; removing one asks again without it and the results update", async () =>
	{
		serveFiltered(byTag);
		renderSearch("/search?date=2026-10-27&team=147&tag=home-run");
		expect(await screen.findAllByTestId("search-result")).toHaveLength(1);
		const chips = screen.getByTestId("search-filters");
		expect(chips).toHaveTextContent("Active filters");
		for (const label of ["Oct 27, 2026", "NYY", "Home Runs"])
		{
			expect(within(chips).getByText(label)).toBeInTheDocument();
			expect(within(chips).getByRole("button", {
				name: `Remove filter ${label}`,
			})).toBeInTheDocument();
		}
		expect(requests).toEqual(["date=2026-10-27&q=&tag=home-run&team=147"]);

		await userEvent.click(within(chips).getByRole("button", {
			name: "Remove filter Home Runs",
		}));
		await waitFor(() => expect(screen.getAllByTestId("search-result")).toHaveLength(2));
		expect(requests.at(-1)).toBe("date=2026-10-27&q=&team=147");
		expect(within(screen.getByTestId("search-filters")).queryByText("Home Runs")).toBeNull();
		expect(screen.getByTestId("where")).toHaveTextContent("/search?date=2026-10-27&team=147");
		// Still no number drawn (owner, 2026-11-22: "Don’t show any number until we support paging").
		expect(screen.queryByText(/results? found/i)).toBeNull();
	});

	it("S72 AC 2: words and filters search together; a new search keeps the filters; removing the last filter with no words empties the page", async () =>
	{
		serveFiltered(byTag);
		renderSearch("/search?tag=home-run");
		await screen.findAllByTestId("search-result");
		await searchFor("walk-off");
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/search?q=walk-off&tag=home-run"));
		await waitFor(() => expect(requests.at(-1)).toBe("q=walk-off&tag=home-run"));
		await userEvent.clear(screen.getByRole("searchbox", {
			name: "Search highlights",
		}));
		await userEvent.type(screen.getByRole("searchbox", {
			name: "Search highlights",
		}), "{Enter}");
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/search?tag=home-run"));
		await userEvent.click(screen.getByRole("button", {
			name: "Remove filter Home Runs",
		}));
		await waitFor(() => expect(screen.queryByTestId("search-filters")).toBeNull());
		expect(screen.queryByTestId("search-result")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("draws no chips and asks nothing for a malformed filter, as an empty box does", async () =>
	{
		serveFiltered(byTag);
		renderSearch("/search?team=NYY");
		await screen.findByRole("searchbox", {
			name: "Search highlights",
		});
		expect(screen.queryByTestId("search-filters")).toBeNull();
		expect(requests).toEqual([]);
	});

	it("a new search from a URL with a malformed filter drops it and searches the words alone", async () =>
	{
		for (const entry of ["/search?team=NYY", "/search?date=2026-09-14&tag=Bad"])
		{
			serveFiltered(byTag);
			renderSearch(entry);
			await searchFor("walk-off");
			await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/search\?q=walk-off$/));
			await waitFor(() => expect(requests).toEqual(["q=walk-off"]));
			cleanup();
		}
	});

	it("says no highlights match the filters when a filter-only search finds none", async () =>
	{
		serveFiltered(() => ({
			query: "",
			total: 0,
			highlights: [],
		}));
		renderSearch("/search?team=147");
		expect(await screen.findByText("No highlights match these filters.")).toBeInTheDocument();
	});
});

/**
 * A result with its play (S153), as the route gives it for S72's recording
 * (`fixtures/search--team-147--tag-home-run.json`): MLB's `guid` as the play id, `inningHalf: "Top"`, `inning: 6`.
 */
const MESA: SearchHighlightsPayload["highlights"][number] = {
	highlight: {
		id: "mesa-hr",
		playId: "4f687124-5ec9-337b-a32b-2dedc930bcee",
		title: "Victor Mesa Jr.'s two-run home run",
		blurb: "Victor Mesa Jr. hits a two-run home run",
		duration: "00:00:25",
		imageUrl: null,
		playbackUrl: "https://mlb-cuts-diamond.mlb.com/mesa.mp4",
		renditions: [],
		kind: "highlight",
		date: "2026-10-07",
	},
	game: {
		gamePk: 849838,
		officialDate: "2026-10-07",
		away: "TB",
		home: "NYY",
		awayId: 139,
		homeId: 147,
	},
	halfInning: "top",
	inning: 6,
};

/** The row's outer box: the row link and, beside it, the inning pill. */
function rowOf(title: string): HTMLElement
{
	return screen.getByRole("link", {
		name: `Play ${title}`,
	}).parentElement!;
}

describe("Search's inning pill (S153; game-shell A6 search-playmeta-*)", () =>
{
	it("S153 AC 2: a result with a play reads its date in --bt-muted, then the inning pill to its play, with no kind word", async () =>
	{
		serve(() => ({
			...WALK_OFF,
			highlights: [MESA],
		}));
		renderSearch("/search?q=home-run");
		await screen.findAllByTestId("search-result");
		const row = rowOf(MESA.highlight.title);
		const meta = within(row).getByTestId("video-meta");
		expect(meta).toHaveTextContent(/^Oct 7, 2026$/);
		expect(meta.getAttribute("style")).toMatch(/color: var\(--bt-muted\)/);
		expect(row.textContent).not.toMatch(/Highlight/);
		const pill = within(row).getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		});
		expect(pill).toHaveTextContent(/^Top 6 →$/);
		expect(pill).toHaveAttribute("href", "/game/849838/plays?play=4f687124-5ec9-337b-a32b-2dedc930bcee");
		expect(pill).toHaveClass("bt-play-pill");
		// The pill follows the date: the row link (holding the date) comes first, the pill straight after it.
		expect(pill.previousElementSibling).toBe(screen.getByRole("link", {
			name: `Play ${MESA.highlight.title}`,
		}));
	});

	it("S153 AC 3: the pill opens the play without the player; the rest of the row opens the player; the pill is in no button", async () =>
	{
		serve(() => ({
			...WALK_OFF,
			highlights: [MESA],
		}));
		renderSearch("/search?q=home-run");
		await screen.findAllByTestId("search-result");
		const pill = screen.getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		});
		expect(pill.closest("button")).toBeNull();
		expect(pill.closest("[data-testid='search-result']")).toBeNull();
		await userEvent.click(pill);
		expect(await screen.findByText("plays room")).toBeInTheDocument();
		expect(screen.getByTestId("where")).toHaveTextContent("/game/849838/plays?play=4f687124-5ec9-337b-a32b-2dedc930bcee");
		expect(screen.queryByRole("dialog")).toBeNull();
		cleanup();
		serve(() => ({
			...WALK_OFF,
			highlights: [MESA],
		}));
		renderSearch("/search?q=home-run");
		await userEvent.click(await screen.findByText(MESA.highlight.title));
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/search\?q=home-run&clip=mesa-hr$/);
	});

	it("S153 AC 4: a result with no play, a play id and inning but no half, or no game keeps Highlight · date, with no pill", async () =>
	{
		const noHalf = {
			...MESA,
			highlight: {
				...MESA.highlight,
				id: "no-half",
				title: "No half",
			},
			halfInning: null,
		};
		const noGame = {
			...MESA,
			highlight: {
				...MESA.highlight,
				id: "no-game",
				title: "No game",
			},
			game: null,
		};
		const noPlayId = {
			...MESA,
			highlight: {
				...MESA.highlight,
				id: "no-play-id",
				title: "No play id",
				playId: null,
			},
		};
		const noInning = {
			...MESA,
			highlight: {
				...MESA.highlight,
				id: "no-inning",
				title: "No inning",
			},
			inning: null,
		};
		serve(() => ({
			...WALK_OFF,
			highlights: [WORLD_SERIES, MONTAGE, noHalf, noGame, noPlayId, noInning],
		}));
		renderSearch("/search?q=walk-off");
		await screen.findAllByTestId("search-result");
		for (const result of [WORLD_SERIES, MONTAGE, noHalf, noGame, noPlayId, noInning])
		{
			const row = rowOf(result.highlight.title);
			const meta = within(row).getByTestId("video-meta");
			expect(meta, result.highlight.id).toHaveTextContent(/^Highlight · \w{3} \d{1,2}, 2026$/);
			expect(within(row).queryAllByRole("link")).toHaveLength(1);
		}
		expect(document.querySelector(".bt-play-pill")).toBeNull();
		expect(screen.queryByText(/→/)).toBeNull();
	});

	it("a result with a play but no date shows the pill alone; one with neither kind nor date has no meta line", async () =>
	{
		const undated = {
			...MESA,
			highlight: {
				...MESA.highlight,
				id: "undated",
				title: "Undated",
				date: null,
			},
		};
		const bare = {
			...MONTAGE,
			highlight: {
				...MONTAGE.highlight,
				id: "bare",
				title: "Bare",
				date: null,
				kind: undefined,
			},
		};
		serve(() => ({
			...WALK_OFF,
			highlights: [undated, bare],
		}));
		renderSearch("/search?q=walk-off");
		await screen.findAllByTestId("search-result");
		expect(within(rowOf("Undated")).queryByTestId("video-meta")).toBeNull();
		// The matchup still starts the meta row (#588), so the pill keeps its 6px after it.
		expect(within(rowOf("Undated")).getByTestId("matchup-abbr")).toHaveTextContent("TB@NYY");
		expect(within(rowOf("Undated")).getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		}).style.marginLeft).toBe("6px");
		expect(within(rowOf("Bare")).queryByTestId("video-meta")).toBeNull();
		expect(rowOf("Bare").querySelector(".bt-play-pill")).toBeNull();
	});

	it("S153 AC 6: with Hide Scores on, every result's meta line is unchanged", async () =>
	{
		const lines = async (hideScores: boolean) =>
		{
			serve(() => ({
				...WALK_OFF,
				highlights: [MESA, WORLD_SERIES, MONTAGE],
			}), {
				...DEFAULT_SETTINGS,
				hideScores,
				version: 1,
			});
			await hydrateSettings("test-user");
			renderSearch("/search?q=walk-off");
			await screen.findAllByTestId("search-result");
			const seen = [MESA, WORLD_SERIES, MONTAGE].map((result) =>
			{
				const row = rowOf(result.highlight.title);
				const pill = row.querySelector(".bt-play-pill");
				return [within(row).getByTestId("video-meta").textContent, pill?.textContent ?? null, pill?.getAttribute("href") ?? null, pill?.getAttribute("aria-label") ?? null];
			});
			cleanup();
			resetSettings();
			return seen;
		};
		const shown = await lines(false);
		expect(shown[0]).toEqual(["Oct 7, 2026", "Top 6 →", "/game/849838/plays?play=4f687124-5ec9-337b-a32b-2dedc930bcee", "Top 6: open play, top of 6th inning"]);
		expect(await lines(true)).toEqual(shown);
	});
});

/**
 * Three results of MLB's recorded "walk-off" search (`fixtures/search-walk-off.json`) as the route gives
 * them (S173): Game 4's walk-off with its play (MLB's `guid`, `inningHalf: "Bottom"`, `inning: 12`), a
 * radio call with its game but no play, and the season montage MLB ties to no game (`gamePk: -1`).
 */
const WS_PLAY: SearchHighlightsPayload["highlights"][number] = {
	...WORLD_SERIES,
	highlight: {
		...WORLD_SERIES.highlight,
		playId: "2c372a74-a8c3-3c0f-bec5-f1098f389117",
	},
	halfInning: "bottom",
	inning: 12,
};

const CHOURIO: SearchHighlightsPayload["highlights"][number] = {
	highlight: {
		id: "c75b5bbe-a715-4f8b-a4c7-0af1c243faa3",
		playId: null,
		title: "Radio call of Jackson Chourio's walk-off single",
		blurb: "Radio call of Jackson Chourio's walk-off single",
		duration: "00:00:41",
		imageUrl: null,
		playbackUrl: "https://mlb-cuts-diamond.mlb.com/chourio.mp4",
		renditions: [],
		kind: "highlight",
		date: "2026-10-04",
	},
	game: {
		gamePk: 849825,
		officialDate: "2026-10-04",
		away: "SD",
		home: "MIL",
		awayId: 135,
		homeId: 158,
	},
	halfInning: null,
	inning: null,
};

/** Opens the result titled `title` from the three, with `settings`; the player's pills by spoken name. */
async function searchPills(title: string, settings = DEFAULT_SETTINGS): Promise<string[]>
{
	serve(() => ({
		...WALK_OFF,
		highlights: [WS_PLAY, CHOURIO, MONTAGE],
	}), settings);
	if (settings !== DEFAULT_SETTINGS) await hydrateSettings("test-user");
	renderSearch("/search?q=walk-off");
	await userEvent.click(await screen.findByRole("link", {
		name: `Play ${title}`,
	}));
	const dialog = await screen.findByRole("dialog");
	const row = await within(dialog).findByTestId("player-pills");
	return within(row).queryAllByRole("link").map((link) => link.getAttribute("aria-label") ?? "");
}

describe("Search's player pills (S173; standings-search-settings A10 search-playing-pills-*)", () =>
{
	it("S173 AC 4: a result with a play shows More from game, then its inning pill, as its row builds it", async () =>
	{
		expect(await searchPills(WS_PLAY.highlight.title)).toEqual(["More from game: MIL @ TB, Oct 27", "Bot 12: open play, bottom of 12th inning"]);
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByRole("link", {
			name: "Bot 12: open play, bottom of 12th inning",
		})).toHaveAttribute("href", "/game/849803/plays?play=2c372a74-a8c3-3c0f-bec5-f1098f389117");
		expect(within(dialog).queryByText(/Go to game/)).toBeNull();
	});

	it("S173 AC 4: a result with a game and no play shows the game pill alone", async () =>
	{
		expect(await searchPills(CHOURIO.highlight.title)).toEqual(["More from game: SD @ MIL, Oct 4"]);
	});

	it("S173 AC 4: a result with no game (gamePk -1) shows no pill", async () =>
	{
		expect(await searchPills(MONTAGE.highlight.title)).toEqual([]);
		expect(screen.getByRole("button", {
			name: "Close video",
		})).toBeInTheDocument();
	});

	it("S173 AC 6: Hide Scores changes neither pill in Search's player", async () =>
	{
		const shown = await searchPills(WS_PLAY.highlight.title);
		cleanup();
		resetSettings();
		const hidden = await searchPills(WS_PLAY.highlight.title, {
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		});
		expect(hidden).toEqual(shown);
		expect(hidden).toHaveLength(2);
	});
});

describe("Search's player is the inset modal (S196)", () =>
{
	it("S196 AC 1: opened from Search, an inset modal over the dimmed site, title above the clip, tools after it, disclaimer last, A10's pills kept", async () =>
	{
		expect(await searchPills(WS_PLAY.highlight.title)).toEqual(["More from game: MIL @ TB, Oct 27", "Bot 12: open play, bottom of 12th inning"]);
		await expectInsetPlayer(screen.getByRole("dialog"), WS_PLAY.highlight.title);
	});
});

describe("the corner mini-player from Search (S198)", () =>
{
	it("S198 AC 1: a clip playing from Search keeps playing in the corner after its game pill leaves for the game, the same element", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch();
		await searchFor("walk-off");
		await userEvent.click(await screen.findByRole("link", {
			name: "Play Ben Williamson's walk-off single to win Game 4",
		}));
		const dialog = await screen.findByRole("dialog");
		const video = within(dialog).getByTestId("video-player").querySelector("video")!;
		markPlaying(video, 4);
		// A link in the player: the game pill, to the game's Videos room.
		fireEvent.click(within(dialog).getByRole("link", {
			name: "More from game: MIL @ TB, Oct 27",
		}));
		expect(await screen.findByText("game videos")).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expectInCorner(video, 4);
	});
});
