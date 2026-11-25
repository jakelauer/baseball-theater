/**
 * S5: Search Highlights. The API is stubbed with answers shaped as `GET /api/v1/search/highlights`
 * gives them for MLB's recorded "walk-off" search (`fixtures/search-walk-off.json`): a World Series
 * walk-off with its game, and a season montage MLB ties to no game.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
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
import { jsonResponse } from "../test/jsonResponse.js";
import { SearchPage } from "./SearchPage.js";

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
				<MemoryRouter initialEntries={[entry]}>
					<Routes>
						<Route path="/search" element={<><SearchPage /><Where /></>} />
						<Route path="/game/:gamePk" element={<p>game page</p>} />
					</Routes>
				</MemoryRouter>
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

	it("S5 AC 8: rows with kind · date and both teams' MatchupAbbr, with no count; a clip with no game has no matchup", async () =>
	{
		serve(() => WALK_OFF);
		renderSearch("/search?q=walk-off");
		const rows = await screen.findAllByTestId("search-result");
		expect(rows).toHaveLength(2);
		expect(within(rows[0]!).getByTestId("search-result-meta")).toHaveTextContent("Highlight · Oct 27, 2026");
		const matchup = within(rows[0]!).getByTestId("matchup-abbr");
		expect(matchup).toHaveTextContent("MIL@TB");
		expect(within(rows[1]!).getByTestId("search-result-meta")).toHaveTextContent("Highlight · Nov 3, 2026");
		expect(within(rows[1]!).queryByTestId("matchup-abbr")).toBeNull();
		// Typographic rows: no still, no photo.
		expect(document.querySelector("[data-testid='search-result'] img")).toBeNull();
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

	it("S5 AC 9: a tapped result plays in the floating player even with the stage setting, linking to its game; Close returns to the same results and words", async () =>
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
			name: "Go to game: MIL @ TB, Oct 27 →",
		});
		expect(link).toHaveAttribute("href", "/game/849803");
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

	it("S5 AC 9: Esc closes the player back to the results; a clip with no game shows no game link; the game link opens the game", async () =>
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
			name: /Go to game/,
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
			name: "Go to game: MIL @ TB, Oct 27 →",
		}));
		expect(await screen.findByText("game page")).toBeInTheDocument();
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
