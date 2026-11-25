/**
 * S71: "Best of <date> — Highlights" under the scoreboard's games. The digest is
 * `dayDigest` over the committed 2024-07-04 games (744834 NYM @ WSH with three clips,
 * 745001 NYY @ BOS with one), served as the API would; the schedule is that day's.
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
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { DigestGame } from "@bt/domain";
import { DEFAULT_SETTINGS, dayDigest } from "@bt/domain";
import type { DayDigestPayload } from "../../api/digest.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { ScoreboardPage } from "../../pages/ScoreboardPage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

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

/** Answers the schedule and the digest; the dev account's settings when asked. */
function serve(settings = DEFAULT_SETTINGS): void
{
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse(DIGEST));
		if (pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(settings));
		return Promise.resolve(jsonResponse(SCHEDULE));
	}));
}

async function renderScoreboard(variant: LayoutVariant = "mobile"): Promise<HTMLElement>
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/games/2024-07-04"]}>
					<Routes>
						<Route path="/games/:date" element={<ScoreboardPage variant={variant} />} />
						<Route path="/game/:gamePk" element={<p>game page</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return screen.findByTestId("day-digest");
}

/** Each digest card's text, in order. */
function rows(digest: HTMLElement): string[]
{
	return within(digest).getAllByTestId("video-card").map((card) => card.textContent ?? "");
}

// Each test starts with the full digest served (the hidden one re-serves with Hide Scores on).
beforeEach(() => serve());

afterEach(() =>
{
	cleanup();
	resetSettings();
	vi.unstubAllGlobals();
});

describe("Best of uses the highlight grid, with no Watch first (#426)", () =>
{
	it.each([
		["mobile", "2"],
		["medium", "3"],
		["desktop", "4"],
	] as const)("%s: the day's clips are VideoCards in the Videos room's %s-column grid, ranked order kept, and nothing reads Watch first", async (variant, cols) =>
	{
		const digest = await renderScoreboard(variant);
		const grid = within(digest).getByTestId("videos-grid");
		expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
		expect(within(grid).getAllByTestId("video-card").map((card) => card.getAttribute("aria-label"))).toEqual(DIGEST.items.map((item) => `Play ${item.highlight.title}`));
		expect(within(digest).queryAllByText(/watch first/i)).toEqual([]);
	});
});

describe("the day digest (S71)", () =>
{
	it("digest: Best of Jul 4, then still, title and duration per clip, the two home runs first", async () =>
	{
		const digest = await renderScoreboard();
		expect(within(digest).getByText("Best of Jul 4 — Highlights")).toBeInTheDocument();
		const items = within(digest).getAllByTestId("video-card");
		expect(items).toHaveLength(4);
		// The two home runs lead (the impact rule), the walk-off first by id.
		expect(within(items[0]!).getByText("Lane Thomas hits a walk-off home run")).toBeInTheDocument();
		expect(within(items[1]!).getByText("Judge hammers a two-run home run")).toBeInTheDocument();
		expect(within(items[0]!).getByTestId("video-duration")).toHaveTextContent("0:42");
		for (const row of items) expect(row.querySelector("[style*='aspect-ratio']")).not.toBeNull();
	});

	it("plays: choosing a clip opens the player dialog with its game link; Close returns to the scoreboard", async () =>
	{
		const user = userEvent.setup();
		const digest = await renderScoreboard();
		await user.click(within(digest).getByRole("link", {
			name: "Play Judge hammers a two-run home run",
		}));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toBeInTheDocument();
		const link = within(dialog).getByRole("link", {
			name: "Go to game: NYY @ BOS, Jul 4 →",
		});
		expect(link).toHaveAttribute("href", "/game/745001");
		// Closed only once it has finished opening and started the clip (#423), which every run reaches:
		// closing sooner made the test pass or fail on how fast the machine ran (#559).
		await waitFor(() => expect(within(dialog).getByTestId("video-player").querySelector("video")!.autoplay).toBe(true));
		await user.click(within(dialog).getByRole("button", {
			name: "Close video",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("day-digest")).toBeInTheDocument();
	});

	it("hidden: with Hide Scores on, the digest renders the same, titles as MLB writes them", async () =>
	{
		const shown = rows(await renderScoreboard());
		cleanup();

		serve({
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		});
		await hydrateSettings("test-user");
		const hidden = await renderScoreboard();
		expect(rows(hidden)).toEqual(shown);
		expect(within(hidden).getByText("Judge hammers a two-run home run")).toBeInTheDocument();
	});

	it("a clip MLB gives no duration shows its title alone", async () =>
	{
		const [top, ...rest] = DIGEST.items;
		vi.stubGlobal("fetch", vi.fn((request: Request) => Promise.resolve(jsonResponse(new URL(request.url).pathname === "/api/v1/digest" ? {
			...DIGEST,
			items: [{
				...top!,
				highlight: {
					...top!.highlight,
					duration: null,
				},
			}, ...rest],
		} : SCHEDULE))));
		const digest = await renderScoreboard();
		const [first] = within(digest).getAllByTestId("video-card");
		expect(within(first!).queryByTestId("video-duration")).toBeNull();
		expect(within(first!).getByText("Lane Thomas hits a walk-off home run")).toBeInTheDocument();
	});

	it("a day with no clips shows no digest", async () =>
	{
		vi.stubGlobal("fetch", vi.fn((request: Request) => Promise.resolve(jsonResponse(new URL(request.url).pathname === "/api/v1/digest" ? {
			date: "2024-07-04",
			items: [],
		} : SCHEDULE))));
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={["/games/2024-07-04"]}>
						<Routes>
							<Route path="/games/:date" element={<ScoreboardPage variant="mobile" />} />
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
		await screen.findAllByTestId("scoreboard-module");
		expect(screen.queryByTestId("day-digest")).toBeNull();
	});
});
