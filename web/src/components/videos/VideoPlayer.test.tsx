/**
 * S70: the one video player and its dialog — the MLBAM disclaimer, closing on ✕ and Esc,
 * Space to play and pause, and the link to the clip's game.
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { PlayerDialog } from "./PlayerDialog.js";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";
import { PlayerProvider } from "./PlayerProvider.js";

const VIDEO: Video = {
	id: "conine-hr",
	playId: null,
	title: "Griffin Conine's two-run homer",
	blurb: null,
	duration: "00:00:48",
	imageUrl: null,
	playbackUrl: "https://example.test/clip.mp4",
};

/** jsdom has no media playback: play / pause flip `paused` and fire the events a browser would. */
beforeEach(() =>
{
	let paused = true;
	vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
	vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement)
	{
		paused = false;
		this.dispatchEvent(new Event("play"));
		return Promise.resolve();
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement)
	{
		paused = true;
		this.dispatchEvent(new Event("pause"));
	});
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

function wrap(node: React.ReactNode)
{
	return render(
		<MantineProvider>
			<MemoryRouter><PlayerProvider>{node}</PlayerProvider></MemoryRouter>
		</MantineProvider>,
	);
}

describe("VideoPlayer", () =>
{
	it("disclaimer: shows the MLBAM disclaimer verbatim under the clip, with the title", () =>
	{
		wrap(<VideoPlayer video={VIDEO} />);
		expect(screen.getByText("Disclaimer:")).toBeInTheDocument();
		expect(screen.getByText("This video is provided by MLBAM and MLB.com and has no affiliation with or connection to Baseball Theater. It has been displayed on your device via a public API provided by Major League Baseball.")).toBeInTheDocument();
		expect(screen.getByText(VIDEO.title)).toBeInTheDocument();
	});

	it("plays inline: iOS Safari keeps the clip in the page instead of taking it fullscreen", () =>
	{
		wrap(<VideoPlayer video={VIDEO} autoPlay />);
		const video = screen.getByTestId("video-player").querySelector("video");
		expect(video).toHaveAttribute("playsinline");
		expect(video).toHaveAttribute("webkit-playsinline");
	});

	it("Space plays and pauses, but not while typing in a field", async () =>
	{
		const user = userEvent.setup();
		wrap(<><input aria-label="Search videos" /><VideoPlayer video={VIDEO} /></>);
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole("textbox", {
			name: "Search videos",
		}));
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
	});
});

describe("VideoPlayer controls", () =>
{
	it("Space on the clip itself is left to its built-in controls (#579)", async () =>
	{
		wrap(<VideoPlayer video={VIDEO} />);
		const clip = screen.getByTestId("video-player").querySelector("video")!;
		clip.tabIndex = 0;
		clip.focus();
		await userEvent.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});

	it("a clip without a source or still still renders, and Space on a button is left to the button", async () =>
	{
		const user = userEvent.setup();
		wrap(<><button type="button">Elsewhere</button><VideoPlayer video={{
			...VIDEO,
			playbackUrl: null,
		}}
		/></>);
		screen.getByRole("button", {
			name: "Elsewhere",
		}).focus();
		await user.keyboard(" ");
		// The focused button's own Space press is its own; the player's listener plays nothing.
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});
});

describe("VideoPlayer built-in controls (#579, #581, #589)", () =>
{
	it("uses the browser's own controls, inline on iPhone, with BT's tools still below (#579)", () =>
	{
		wrap(<VideoPlayer video={{
			...VIDEO,
			renditions: [{
				name: "mp4Avc",
				url: "https://example.test/clip_1280x720_59_4000K.mp4",
			}, {
				name: "highBit",
				url: "https://example.test/clip_1280x720_59_16000K.mp4",
			}],
		}}
		/>);
		const player = screen.getByTestId("video-player");
		const clip = player.querySelector("video");
		// Seek, mute and volume, fullscreen, captions, AirPlay and picture-in-picture come with `controls`.
		expect(clip).toHaveAttribute("controls");
		expect(clip).toHaveAttribute("playsinline");
		expect(clip).toHaveAttribute("webkit-playsinline");
		// The custom bar is gone: no play button, no display-only progress line, no clock.
		expect(screen.queryByRole("button", {
			name: /^(Play|Pause)$/,
		})).toBeNull();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.queryByText("0:00 / 0:00")).toBeNull();
		// BT's own tools stay in the row below the video.
		expect(screen.getByRole("button", {
			name: /^Quality:/,
		})).toBeInTheDocument();
		const actions = screen.getByRole("toolbar", {
			name: "Video actions",
		});
		expect(within(actions).getByRole("button", {
			name: "Copy link",
		})).toBeInTheDocument();
		expect(within(actions).getByRole("link", {
			name: "Direct link",
		})).toBeInTheDocument();
	});

	it("at the end of a clip the picture keeps its source and still, and play starts it again from the start (#581)", async () =>
	{
		const user = userEvent.setup();
		wrap(<VideoPlayer video={{
			...VIDEO,
			imageUrl: "https://example.test/still.jpg",
		}}
		/>);
		const clip = screen.getByTestId("video-player").querySelector("video")!;
		clip.currentTime = 48;
		fireEvent.ended(clip);
		expect(clip).toHaveAttribute("src", VIDEO.playbackUrl);
		expect(clip).toHaveAttribute("poster", "https://example.test/still.jpg");
		await user.keyboard(" ");
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		expect(clip.currentTime).toBe(0);
	});

	it("the disclaimer is no smaller than the player's other small text, Mantine xs, not 10px (#589)", () =>
	{
		wrap(<VideoPlayer video={VIDEO} />);
		for (const text of ["Disclaimer:", /^This video is provided by MLBAM/])
		{
			const style = screen.getByText(text).getAttribute("style") ?? "";
			expect(style).not.toMatch(/0\.625rem/);
			expect(style).toMatch(/--mantine-font-size-(xs|sm)/);
		}
	});
});

describe("PlayerDialog", () =>
{
	it("closes on ✕ and on Esc", async () =>
	{
		const user = userEvent.setup();
		const onClose = vi.fn();
		wrap(<PlayerDialog video={VIDEO} onClose={onClose} />);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toBeInTheDocument();
		await user.click(within(dialog).getByRole("button", {
			name: "Close video",
		}));
		expect(onClose).toHaveBeenCalledTimes(1);
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("Close is a labeled button inside the modal, and a press on the title or the player doesn't close it (S196)", async () =>
	{
		const user = userEvent.setup();
		const onClose = vi.fn();
		wrap(<PlayerDialog video={VIDEO} onClose={onClose} />);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("button", {
			name: "Close video",
		})).toHaveTextContent("Close");
		await user.click(within(dialog).getByText(VIDEO.title));
		await user.click(within(dialog).getByTestId("video-player"));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("game pill (S173; A10): shown when the clip carries its game and plays elsewhere (Search, the digest); absent from that game's own page or without a game", async () =>
	{
		const game = {
			gamePk: 823823,
			away: "CHC",
			home: "MIA",
			officialDate: "2026-09-05",
		};
		const { unmount } = wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} game={game} />);
		const link = await screen.findByRole("link", {
			name: "More from game: CHC @ MIA, Sep 5",
		});
		expect(link).toHaveAttribute("href", "/game/823823/videos");
		unmount();

		const own = wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} game={game} fromGamePk={823823} />);
		await screen.findByRole("dialog");
		// No game pill; the player's own Direct link is its only link.
		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Direct link"]);
		own.unmount();

		wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} />);
		await screen.findByRole("dialog");
		// No game pill; the player's own Direct link is its only link.
		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Direct link"]);
	});

	it("plays larger: the modal is as wide as the screen allows up to a 1280px clip, held to 90% of the screen (owner, 2026-11-12; S196)", async () =>
	{
		wrap(<PlayerDialog video={VIDEO} onClose={() => undefined} />);
		await screen.findByTestId("video-player");
		// The rule itself is pinned in styles.test.ts; jsdom drops `min()` from inline styles.
		const content = document.querySelector(".mantine-Modal-content")!;
		expect(content).toHaveClass("bt-player-modal");
		expect(content.getAttribute("style") ?? "").not.toMatch(/max-width/);
	});
});
