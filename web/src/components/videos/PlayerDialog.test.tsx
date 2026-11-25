/**
 * #423: the floating player opens with a brief transition, not all at once, and the clip (and its
 * sound) starts only once that transition ends (owner, 2026-11-23: "It should feel almost instant,
 * but it should be not instant … the video shouldn't play until the animation is completed").
 * S173: its pill row (standings-search-settings A10).
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { PlayerDialog } from "./PlayerDialog.js";
import type { PlayerGame } from "./PlayerDialog.js";
import type { Video } from "./VideoCard.js";
import { playInningLink } from "./playLink.js";
import type { PlayLink } from "./playLink.js";

const VIDEO: Video = {
	id: "clip",
	playId: null,
	title: "Judge homers",
	blurb: null,
	duration: "00:00:20",
	imageUrl: null,
	playbackUrl: "https://mlb-cuts-diamond.mlb.com/clip.mp4",
};

/** Answers `prefers-reduced-motion: reduce` with `reduce`, every other query false, as setup.ts does. */
function reducedMotion(reduce: boolean)
{
	const base = window.matchMedia;
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
		...base(query),
		matches: reduce && query.includes("prefers-reduced-motion"),
	}));
}

function renderDialog(game?: PlayerGame)
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<PlayerDialog video={VIDEO} onClose={() => undefined} game={game} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("PlayerDialog opening (#423)", () =>
{
	it("opens with a brief fade, and the clip starts only once it has finished opening (#423)", async () =>
	{
		reducedMotion(false);
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
		renderDialog();
		const dialog = await screen.findByRole("dialog");
		// Caught as it appears: still faded out, part way into its transition, and the clip isn't set to play.
		expect(dialog.style.opacity).toBe("0");
		expect(dialog.style.transitionDuration).not.toBe("0ms");
		const opening = screen.getByTestId("video-player").querySelector("video")!;
		expect(opening.autoplay).toBe(false);
		expect(play).not.toHaveBeenCalled();
		// Once open, the clip plays.
		await waitFor(() => expect(screen.getByTestId("video-player").querySelector("video")!.autoplay).toBe(true));
		expect(screen.getByRole("dialog").style.opacity).not.toBe("0");
		// The same element plays: opening doesn't replace it, so nothing reloads and a playing clip
		// survives (GamePage.live's update test holds the element it found as the dialog appeared).
		expect(screen.getByTestId("video-player").querySelector("video")).toBe(opening);
		// The player's effect plays it after React commits `autoplay`, and a slow run can let a check
		// in between, so wait for the play itself rather than assume it follows at once (#559).
		await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	});

	it("with reduced motion, opens at once and plays at once (#423)", async () =>
	{
		reducedMotion(true);
		// jsdom's `play` isn't implemented (it returns no promise), so stand in for the browser's.
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
		renderDialog();
		await waitFor(() => expect(screen.getByTestId("video-player").querySelector("video")!.autoplay).toBe(true));
		expect(screen.getByRole("dialog").style.opacity).not.toBe("0");
		await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
	});
});

/** NYY @ BOS, Sep 21: the game A10's frames play Judge's clip from. */
const GAME: PlayerGame = {
	gamePk: 823823,
	away: "NYY",
	home: "BOS",
	officialDate: "2026-09-21",
};

/** Judge's clip's inning pill: Top of the 6th, as A10 draws it. */
const TOP_6 = playInningLink({
	gamePk: 823823,
	playId: "judge-hr",
	halfInning: "top",
	inning: 6,
});

/** Where the router is, so a test sees a pill navigate. */
function Where()
{
	const location = useLocation();
	return <span data-testid="where">{location.pathname + location.search}</span>;
}

/** The dialog over a page that closes it as `onClose` asks, as Search and the digest do. */
function Host(props: { game?: PlayerGame;
	fromGamePk?: number;
	playLink?: PlayLink | null; })
{
	const [open, setOpen] = useState(true);
	return open ? <PlayerDialog video={VIDEO} onClose={() => setOpen(false)} {...props} /> : <p>closed</p>;
}

function renderPills(props: Parameters<typeof Host>[0])
{
	reducedMotion(true);
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={["/search"]}>
				<Routes>
					<Route path="*" element={<><Host {...props} /><Where /></>} />
				</Routes>
			</MemoryRouter>
		</MantineProvider>,
	);
}

/** The pills at the dialog's top left, in order, by their spoken names. */
async function pills(): Promise<string[]>
{
	const row = await screen.findByTestId("player-pills");
	return within(row).queryAllByRole("link").map((link) => link.getAttribute("aria-label") ?? "");
}

describe("PlayerDialog's pills (S173; standings-search-settings A10)", () =>
{
	it("S173 AC 3: a clip with a game and a play: More from game, then 8px after it the inning pill, both PlayInningPill, at top left; no Go to game", async () =>
	{
		renderPills({
			game: GAME,
			playLink: TOP_6,
		});
		expect(await pills()).toEqual(["More from game: NYY @ BOS, Sep 21", "Top 6: open play, top of 6th inning"]);
		const row = screen.getByTestId("player-pills");
		expect(row.style.getPropertyValue("--group-gap")).toBe("calc(0.5rem * var(--mantine-scale))");
		const game = within(row).getByRole("link", {
			name: "More from game: NYY @ BOS, Sep 21",
		});
		expect(game).toHaveTextContent(/^More from game →$/);
		expect(game).toHaveAttribute("href", "/game/823823/videos");
		for (const pill of within(row).getAllByRole("link")) expect(pill).toHaveClass("bt-play-pill");
		// The pills come first in the top row, "Close ✕" after them.
		expect(row.nextElementSibling).toBe(screen.getByRole("button", {
			name: "Close video",
		}));
		expect(screen.queryByText(/Go to game/)).toBeNull();
	});

	it("S173 AC 3: a clip with a game and no play shows the game pill alone", async () =>
	{
		renderPills({
			game: GAME,
			playLink: null,
		});
		expect(await pills()).toEqual(["More from game: NYY @ BOS, Sep 21"]);
	});

	it("S173 AC 3: a clip with no game (gamePk -1) and no play shows no pill, only Close", async () =>
	{
		renderPills({});
		expect(await pills()).toEqual([]);
		expect(screen.getByRole("button", {
			name: "Close video",
		})).toBeInTheDocument();
	});

	it("S173 AC 3: opened from the game's own Videos room, the inning pill alone", async () =>
	{
		renderPills({
			game: GAME,
			fromGamePk: 823823,
			playLink: TOP_6,
		});
		expect(await pills()).toEqual(["Top 6: open play, top of 6th inning"]);
	});

	it("S173 AC 3: each pill navigates and closes the player", async () =>
	{
		renderPills({
			game: GAME,
			playLink: TOP_6,
		});
		await userEvent.click(await screen.findByRole("link", {
			name: "More from game: NYY @ BOS, Sep 21",
		}));
		expect(await screen.findByText("closed")).toBeInTheDocument();
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/game\/823823\/videos$/);
		cleanup();

		renderPills({
			game: GAME,
			playLink: TOP_6,
		});
		await userEvent.click(await screen.findByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		}));
		expect(await screen.findByText("closed")).toBeInTheDocument();
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/game\/823823\/plays\?play=judge-hr$/);
	});
});

describe("PlayerDialog's first focus (#582)", () =>
{
	// A clip's link opened in a new tab (#424) opens the dialog on a page the reader hasn't touched, so the
	// browser counts focus placed on open as keyboard focus and rings it: on a phone the player opened with a
	// red box around its first control (a pill or Close). So no control takes it.
	it("opens with focus inside the dialog but on none of its controls, so a fresh page rings nothing (#582)", async () =>
	{
		vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
		renderPills({
			game: GAME,
			playLink: TOP_6,
		});
		const dialog = await screen.findByRole("dialog");
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
		const focused = document.activeElement as HTMLElement;
		expect(focused.closest("a, button, [role=button]")).toBeNull();
		expect(focused.tabIndex).toBe(-1);
	});
});
