/**
 * #424: every clip on the site is a link to the page it is on with that clip open (`?clip=<id>`), so
 * a middle-click opens it in a new tab (owner, 2026-11-23: "if you visit the link in a new tab, it
 * should open the page that you were on and then open the video that you opened, such that if you
 * close the video, you'd end up in the same page that you were on in the first tab"). A plain click
 * still opens the player in place. Checked on each surface that plays clips: the game's Videos room,
 * its Plays room's play buttons, Search and the scoreboard's day digest.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtBat, DigestGame } from "@bt/domain";
import { DEFAULT_SETTINGS, dayDigest } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { DayDigestPayload } from "../../api/digest.js";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import type { SearchHighlightsPayload } from "../../api/search.js";
import { GamePage } from "../../pages/GamePage.js";
import { ScoreboardPage } from "../../pages/ScoreboardPage.js";
import { SearchPage } from "../../pages/SearchPage.js";
import { resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
function read<T>(file: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as T;
}
const GAME: GamePayload = {
	...read<GamePayload>("game-823823.json"),
	plays: read<AtBat[]>("plays-823823.json"),
	fetchedAt: "2026-09-05T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T23:00:00.000Z",
} as GamePayload;
const SCHEDULE: ScheduleDayPayload = {
	...read<ScheduleDayPayload>("schedule-2024-07-04.json"),
	fetchedAt: "2024-07-04T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2024-07-04T23:00:00.000Z",
};
const DIGEST: DayDigestPayload = {
	date: "2024-07-04",
	items: dayDigest([read<DigestGame>("game-744834.json"), read<DigestGame>("game-745001.json")]),
	windowMode: "cache",
};
const SEARCH: SearchHighlightsPayload = {
	query: "walk-off",
	total: 1,
	highlights: [{
		highlight: {
			id: "ws-g4",
			playId: null,
			title: "Ben Williamson's walk-off single to win Game 4",
			blurb: null,
			duration: "00:00:44",
			imageUrl: null,
			playbackUrl: "https://mlb-cuts-diamond.mlb.com/ws-g4.mp4",
			renditions: [],
			kind: "highlight",
			date: "2026-10-27",
		},
		game: null,
		halfInning: null,
		inning: null,
	}],
};

/** Where the router is, so a test can see the clip come and go from the URL. */
function Where()
{
	const location = useLocation();
	return <div data-testid="where">{location.pathname + location.search}</div>;
}

/** Renders the app's routes for these surfaces at `path`, with the API answered from the fixtures above. */
function renderAt(path: string)
{
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse(DIGEST));
		if (pathname === "/api/v1/search/highlights") return Promise.resolve(jsonResponse(SEARCH));
		if (pathname.startsWith("/api/v1/schedule")) return Promise.resolve(jsonResponse(SCHEDULE));
		return Promise.resolve(jsonResponse(GAME));
	}));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<><GamePage variant="mobile" /><Where /></>} />
						<Route path="/games/:date" element={<><ScoreboardPage variant="mobile" /><Where /></>} />
						<Route path="/search" element={<><SearchPage /><Where /></>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

afterEach(async () =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await resetSettings();
});

const CLIP = GAME.highlights[0]!;

describe("clips are links (#424)", () =>
{
	it("a Videos room card links to the room with its clip open; a plain click opens it there, and closing it leaves the room as it was (#424)", async () =>
	{
		renderAt("/game/823823/videos");
		const card = (await screen.findAllByTestId("video-card")).find((element) => element.getAttribute("aria-label") === `Play ${CLIP.title}`)!;
		expect(card.tagName).toBe("A");
		expect(card).toHaveAttribute("href", `/game/823823/videos?clip=${CLIP.id}`);
		fireEvent.click(card);
		expect(await screen.findByRole("dialog")).toHaveTextContent(CLIP.title);
		expect(screen.getByTestId("where")).toHaveTextContent(`/game/823823/videos?clip=${CLIP.id}`);
		fireEvent.click(screen.getByRole("button", {
			name: "Close video",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("where").textContent).toBe("/game/823823/videos");
	});

	it("loading a room's link with a clip opens the page with that clip playing (#424)", async () =>
	{
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		renderAt(`/game/823823/videos?clip=${CLIP.id}`);
		// The room's data first, then the dialog it opens: each wait has its own time, so a slow run
		// doesn't spend the dialog's on the data (#559).
		expect((await screen.findAllByTestId("video-card")).length).toBeGreaterThan(0);
		expect(await screen.findByRole("dialog")).toHaveTextContent(CLIP.title);
		// Playing: once the dialog has finished opening, the clip starts (#423).
		await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	});

	it("a play button in Plays is a link to the room with its clip open, keeping the room's other params (#424)", async () =>
	{
		renderAt("/game/823823/plays?play=x");
		const button = (await screen.findAllByTestId("play-video"))[0]!;
		expect(button.tagName).toBe("A");
		expect(button.getAttribute("href")).toMatch(/^\/game\/823823\/plays\?play=x&clip=[^&]+$/);
		fireEvent.click(button);
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
	});

	it("a Search row links to the same search with its clip open, and loading that link opens it (#424)", async () =>
	{
		renderAt("/search?q=walk-off");
		const row = await screen.findByTestId("search-result");
		expect(row.tagName).toBe("A");
		expect(row).toHaveAttribute("href", "/search?q=walk-off&clip=ws-g4");
		cleanup();
		renderAt("/search?q=walk-off&clip=ws-g4");
		await screen.findByTestId("search-result");
		expect(await screen.findByRole("dialog")).toHaveTextContent("Ben Williamson's walk-off single to win Game 4");
	});

	it("a day digest row links to the scoreboard with its clip open, and loading that link opens it (#424)", async () =>
	{
		renderAt("/games/2024-07-04");
		const row = within(await screen.findByTestId("day-digest")).getAllByTestId("video-card")[0]!;
		const first = DIGEST.items[0]!.highlight;
		expect(row.tagName).toBe("A");
		expect(row).toHaveAttribute("href", `/games/2024-07-04?clip=${first.id}`);
		cleanup();
		renderAt(`/games/2024-07-04?clip=${first.id}`);
		await screen.findByTestId("day-digest");
		expect(within(await screen.findByRole("dialog")).getByText(first.title)).toBeInTheDocument();
	});
});
