/**
 * #423: the floating player opens with a brief transition, not all at once, and the clip (and its
 * sound) starts only once that transition ends (owner, 2026-11-23: "It should feel almost instant,
 * but it should be not instant … the video shouldn't play until the animation is completed").
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { PlayerDialog } from "./PlayerDialog.js";
import type { Video } from "./VideoCard.js";

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

function renderDialog()
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<PlayerDialog video={VIDEO} onClose={() => undefined} />
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
		expect(play).toHaveBeenCalledTimes(1);
	});

	it("with reduced motion, opens at once and plays at once (#423)", async () =>
	{
		reducedMotion(true);
		// jsdom's `play` isn't implemented (it returns no promise), so stand in for the browser's.
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
		renderDialog();
		await waitFor(() => expect(screen.getByTestId("video-player").querySelector("video")!.autoplay).toBe(true));
		expect(screen.getByRole("dialog").style.opacity).not.toBe("0");
		expect(play).toHaveBeenCalledTimes(1);
	});
});
