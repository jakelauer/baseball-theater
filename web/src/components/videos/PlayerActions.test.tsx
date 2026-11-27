/**
 * The player's quality picker and action palette (owner, 2026-11-12: "video player needs a
 * quality selector for the several qualities the api shows" and "a palette of helpful
 * clickables (copy link, direct link, download, share)"), on the renditions MLB lists for a
 * 2026 clip (`fixtures/raw/content-823823.json`).
 */
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import {
	answerDownloadPing, DOWNLOAD_PING_TIMEOUT_MS, DOWNLOAD_READY, downloadHref,
} from "../../pwa/download.js";
import { setVideoQuality } from "../../settings/store.js";
import type { Video } from "./VideoCard.js";
import { loadHls } from "./hls-loader.js";
import { VideoPlayer } from "./VideoPlayer.js";

/** Every hls.js player the tests' stand-in made, newest last, and the stand-in itself. */
const hls = vi.hoisted(() =>
{
	const players: {
		loadSource: ReturnType<typeof vi.fn>;
		attachMedia: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		subtitleDisplay?: boolean;
		onError?: (event: string, data: { fatal: boolean }) => void;
	}[] = [];

	/**
	 * A stand-in for hls.js (#415): records what the player asks of it. Like the real one,
	 * destroying it detaches its stream, which resets the element's `currentTime`.
	 */
	class FakeHls
	{
		static Events = {
			ERROR: "hlsError",
		};

		media: HTMLMediaElement | null = null;
		loadSource = vi.fn();
		attachMedia = vi.fn((media: HTMLMediaElement) =>
		{
			this.media = media;
		});

		destroy = vi.fn(() =>
		{
			if (this.media) this.media.currentTime = 0;
			this.media = null;
		});

		onError?: (event: string, data: { fatal: boolean }) => void;

		constructor()
		{
			players.push(this);
		}

		on(event: string, handler: (event: string, data: { fatal: boolean }) => void)
		{
			if (event === "hlsError") this.onError = handler;
		}
	}
	return {
		players,
		FakeHls,
	};
});
const hlsPlayers = hls.players;

// `loadHls` resolves with the stand-in; a test can hold or refuse the load instead.
vi.mock("./hls-loader.js", () => ({
	loadHls: vi.fn(),
}));

const BASE = "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-09/05/68e1ef46-6669f6b0-5b1ac736-csvm-diamondgcp-asset";
const HLS = `${BASE}.m3u8`;
const MP4 = `${BASE}_1280x720_59_4000K.mp4`;
const HIGH = `${BASE}_1280x720_59_16000K.mp4`;

const VIDEO: Video = {
	id: "conforto-hr",
	playId: null,
	title: "Michael Conforto hits Cubs' 200th home run (14)",
	blurb: null,
	duration: "00:00:30",
	imageUrl: null,
	playbackUrl: MP4,
	renditions: [{
		name: "hlsCloud",
		url: HLS,
	}, {
		name: "mp4Avc",
		url: MP4,
	}, {
		name: "highBit",
		url: HIGH,
	}],
};

let paused = true;

beforeEach(() =>
{
	// No remembered quality (#416): each test starts on the clip's own default unless it chooses one.
	setVideoQuality(null);
	hlsPlayers.length = 0;
	vi.mocked(loadHls).mockImplementation(() => Promise.resolve({
		default: hls.FakeHls,
	} as unknown as Awaited<ReturnType<typeof loadHls>>));
	paused = true;
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
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function renderPlayer(video: Video = VIDEO, autoPlay = false)
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<VideoPlayer video={video} autoPlay={autoPlay} />
			</MemoryRouter>
		</MantineProvider>,
	);
	return screen.getByTestId("video-player").querySelector("video")!;
}

/** A worker in control that answers the download route's ping (S151's worker). */
function answeringWorker(): ServiceWorker
{
	return {
		postMessage: (message: unknown, transfer: MessagePort[]) => answerDownloadPing(message, transfer, () => true),
	} as unknown as ServiceWorker;
}

/** A worker in control from before S151: it ignores the ping. */
function silentWorker(): ServiceWorker
{
	return {
		postMessage: vi.fn(),
	} as unknown as ServiceWorker;
}

/** A worker in control that holds each ping's port in `pending` and answers only when the test posts on it. */
function deferredWorker(pending: MessagePort[]): ServiceWorker
{
	return {
		postMessage: (_message: unknown, transfer: MessagePort[]) =>
		{
			pending.push(transfer[0]!);
		},
	} as unknown as ServiceWorker;
}

/** A worker in control that answers the ping at once with something other than ready: the page hears no. */
function refusingWorker(): ServiceWorker
{
	return {
		postMessage: (_message: unknown, transfer: MessagePort[]) => transfer[0]!.postMessage({
			type: "BT_NOT_READY",
		}),
	} as unknown as ServiceWorker;
}

/** Gives the page a service worker container whose controller is `controller` (plus any other navigator stubs); returns it so a test can swap the controller. */
function stubWorkers(controller: ServiceWorker | null, extra: Record<string, unknown> = {}): EventTarget & { controller: ServiceWorker | null }
{
	const container = Object.assign(new EventTarget(), {
		controller,
	});
	vi.stubGlobal("navigator", {
		...navigator,
		...extra,
		serviceWorker: container,
	});
	return container;
}

/** Lets the ping's answer (a message on a channel) arrive. */
async function settle(): Promise<void>
{
	await act(async () =>
	{
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

/** Stubs whether this browser can play HLS in a plain `<video>`. */
function hlsSupport(supported: boolean)
{
	vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type) => (supported && type === "application/vnd.apple.mpegurl" ? "maybe" : ""));
}

/** Stubs Media Source Extensions playing H.264, as desktop Chrome and Firefox do, so hls.js can play HLS. */
function mseSupport()
{
	vi.stubGlobal("MediaSource", {
		isTypeSupported: (type: string) => type.startsWith("video/mp4"),
	});
}

/**
 * Plays or pauses as a reader's Space press does (the player's own play button gave way to the
 * browser's controls, #579), from the page rather than the quality button the picker leaves focused.
 */
async function pressSpace()
{
	(document.activeElement as HTMLElement | null)?.blur();
	await userEvent.keyboard(" ");
}

/** Opens the quality picker and chooses `name`. */
async function choose(name: string)
{
	await userEvent.click(screen.getByRole("button", {
		name: /^Quality:/,
	}));
	await userEvent.click(await screen.findByRole("menuitem", {
		name,
	}));
}

describe("quality picker", () =>
{
	it("starts on the standard MP4 and lists the MP4 qualities MLB gives, sharpest first; no HLS where the browser can't play it", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		expect(video).toHaveAttribute("src", MP4);
		await userEvent.click(screen.getByRole("button", {
			name: "Quality: Standard · 720p, 4 Mbps",
		}));
		const items = await screen.findAllByRole("menuitem");
		expect(items.map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps"]);
		expect(items[1]).toHaveAttribute("aria-current", "true");
	});

	it("offers the HLS stream too where the browser plays it", async () =>
	{
		hlsSupport(true);
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps", "Auto (HLS)"]);
	});

	it("lists every quality MLB gives, the HLS stream too, where the browser can't play HLS natively (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps", "Auto (HLS)"]);
	});

	it("where the browser can't play HLS natively, Auto plays through hls.js, and leaving it destroys the player (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		const video = renderPlayer();
		expect(hlsPlayers).toHaveLength(0);
		await choose("Auto (HLS)");
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		const [player] = hlsPlayers;
		expect(player!.loadSource).toHaveBeenCalledWith(HLS);
		expect(player!.attachMedia).toHaveBeenCalledWith(video);
		// hls.js attaches its own stream, so the element carries no playlist URL it can't play.
		expect(video).not.toHaveAttribute("src");
		await choose("High · 720p, 16 Mbps");
		expect(video).toHaveAttribute("src", HIGH);
		expect(player!.destroy).toHaveBeenCalledTimes(1);
	});

	it("Auto through hls.js starts with captions off, so the built-in CC button turns them on (#580)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
		});
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		// Proves the player sets `subtitleDisplay` off, not that captions render off: the light
		// build hls-loader.ts loads has no subtitle controller, so it never shows captions anyway.
		expect(hlsPlayers[0]!.subtitleDisplay).toBe(false);
	});

	it("where the browser plays HLS itself, Auto sets the playlist on the element and loads no library (#415)", async () =>
	{
		hlsSupport(true);
		mseSupport();
		const video = renderPlayer();
		await choose("Auto (HLS)");
		expect(video).toHaveAttribute("src", HLS);
		await Promise.resolve();
		expect(hlsPlayers).toHaveLength(0);
	});

	it("a clip starting on HLS plays it through hls.js, and closing the player destroys it (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
		});
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		cleanup();
		expect(hlsPlayers[0]!.destroy).toHaveBeenCalledTimes(1);
	});

	it("when hls.js fails, the clip goes on from the same moment in the same cut's MP4, and Auto leaves the picker (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		const video = renderPlayer();
		await pressSpace();
		video.currentTime = 12;
		await choose("Auto (HLS)");
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		const [player] = hlsPlayers;
		// A non-fatal error is hls.js's to recover from.
		act(() => player!.onError!("hlsError", {
			fatal: false,
		}));
		expect(video).not.toHaveAttribute("src");
		act(() => player!.onError!("hlsError", {
			fatal: true,
		}));
		expect(player!.destroy).toHaveBeenCalled();
		expect(video).toHaveAttribute("src", HIGH);
		paused = true;
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
		expect(play).toHaveBeenCalledTimes(1);
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps"]);
	});

	it("a fatal hls.js error mid-clip goes on in the MP4 from where it was, though destroying hls.js resets the time (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		const video = renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
		});
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		fireEvent(video, new Event("loadedmetadata"));
		video.currentTime = 30;
		act(() => hlsPlayers[0]!.onError!("hlsError", {
			fatal: true,
		}));
		expect(video).toHaveAttribute("src", HIGH);
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(30);
	});

	it("leaving Auto before hls.js has loaded never attaches it (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		let release = () => {};
		vi.mocked(loadHls).mockImplementation(() => new Promise((resolve) =>
		{
			release = () => resolve({
				default: hls.FakeHls,
			} as unknown as Awaited<ReturnType<typeof loadHls>>);
		}));
		const video = renderPlayer();
		await choose("Auto (HLS)");
		await choose("High · 720p, 16 Mbps");
		await act(async () =>
		{
			release();
			await Promise.resolve();
		});
		expect(hlsPlayers).toHaveLength(0);
		expect(video).toHaveAttribute("src", HIGH);
	});

	it("when hls.js won't load, the clip plays the MP4 and Auto leaves the picker (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		vi.mocked(loadHls).mockImplementation(() => Promise.reject(new Error("chunk failed")));
		const video = renderPlayer();
		await choose("Auto (HLS)");
		await vi.waitFor(() => expect(video).toHaveAttribute("src", HIGH));
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["High · 720p, 16 Mbps", "Standard · 720p, 4 Mbps"]);
	});

	it("a paused portrait stream with no portrait MP4 falls back to the sharpest MP4 without autoplaying it (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		const PORTRAIT_HLS = "https://darkroom-clips.mlb.com/portrait.m3u8";
		// MLB's landscape MP4s plus a portrait stream, and no portrait_mp4Avc.
		const video = renderPlayer({
			...VIDEO,
			playbackUrl: PORTRAIT_HLS,
			renditions: [{
				name: "mp4Avc",
				url: MP4,
			}, {
				name: "highBit",
				url: HIGH,
			}, {
				name: "portrait_hlsCloud",
				url: PORTRAIT_HLS,
			}],
		}, true);
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		fireEvent(video, new Event("play"));
		fireEvent(video, new Event("pause"));
		act(() => hlsPlayers[0]!.onError!("hlsError", {
			fatal: true,
		}));
		expect(video).toHaveAttribute("src", HIGH);
		expect(video.autoplay).toBe(false);
	});

	it("a stream-only clip hls.js fails on waits for no reload (#415)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		const video = renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		}, true);
		await vi.waitFor(() => expect(hlsPlayers).toHaveLength(1));
		fireEvent(video, new Event("play"));
		video.currentTime = 9;
		act(() => hlsPlayers[0]!.onError!("hlsError", {
			fatal: true,
		}));
		// No resume is pending, so a later load doesn't seek.
		video.currentTime = 3;
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(3);
	});

	it("choosing a quality plays that file from the same moment, still playing", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await pressSpace();
		video.currentTime = 12;
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "High · 720p, 16 Mbps",
		}));
		expect(video).toHaveAttribute("src", HIGH);
		paused = true;
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
		expect(play).toHaveBeenCalledTimes(1);
		// The actions follow the quality being played.
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HIGH);
	});

	/** Opens the quality picker and chooses High, then returns `play`'s spy, cleared. */
	async function chooseHigh(video: HTMLVideoElement)
	{
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "High · 720p, 16 Mbps",
		}));
		expect(video).toHaveAttribute("src", HIGH);
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		return play;
	}

	it("a paused clip stays paused after a quality switch, and the reload doesn't autoplay", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		expect(video.autoplay).toBe(true);
		// The clip had started, then the reader paused it at 0:12.
		fireEvent(video, new Event("play"));
		fireEvent(video, new Event("pause"));
		video.currentTime = 12;
		const play = await chooseHigh(video);
		expect(video.autoplay).toBe(false);
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
		expect(play).not.toHaveBeenCalled();
	});

	it("an autoplaying clip switched before it started still plays", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		const play = await chooseHigh(video);
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).toHaveBeenCalledTimes(1);
	});

	it("a press on Play while the new quality loads isn't undone when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		video.currentTime = 12;
		const play = await chooseHigh(video);
		await pressSpace();
		// The press itself plays the element, which also starts a load the browser may not have begun.
		expect(play).toHaveBeenCalledTimes(1);
		const pause = vi.mocked(HTMLMediaElement.prototype.pause);
		pause.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(pause).not.toHaveBeenCalled();
		// The load follows the press: it plays on.
		expect(play).toHaveBeenCalledTimes(2);
	});

	it("a pause while the new quality loads keeps the clip paused when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await pressSpace();
		const play = await chooseHigh(video);
		fireEvent(video, new Event("pause"));
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("Pause pressed while a playing clip's new quality loads keeps it paused when it loads", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await pressSpace();
		const play = await chooseHigh(video);
		// The reload leaves the element paused without a pause event, so the press follows what the reader wants.
		paused = true;
		await pressSpace();
		expect(play).not.toHaveBeenCalled();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("Play then Pause during one reload leaves the clip paused", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await chooseHigh(video);
		await pressSpace();
		await pressSpace();
		expect(video.paused).toBe(true);
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("an autoplaying clip switched before it starts: a press then pauses it", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer(VIDEO, true);
		const play = await chooseHigh(video);
		await pressSpace();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("autoplay the browser blocks: after a switch a refused play drops the wish to play, so the next reload stays paused", async () =>
	{
		hlsSupport(false);
		// Autoplay refused: no play event, the clip sits paused.
		const video = renderPlayer(VIDEO, true);
		const play = await chooseHigh(video);
		play.mockImplementation(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
		await act(async () =>
		{
			fireEvent(video, new Event("loadedmetadata"));
		});
		expect(play).toHaveBeenCalledTimes(1);
		await choose("Standard · 720p, 4 Mbps");
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).not.toHaveBeenCalled();
	});

	it("a play aborted by a newer load keeps the reader's intent", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		await pressSpace();
		const play = await chooseHigh(video);
		play.mockImplementation(() => Promise.reject(new DOMException("replaced", "AbortError")));
		await act(async () =>
		{
			fireEvent(video, new Event("loadedmetadata"));
		});
		// The next load still plays.
		await choose("Standard · 720p, 4 Mbps");
		play.mockClear();
		fireEvent(video, new Event("loadedmetadata"));
		expect(play).toHaveBeenCalledTimes(1);
	});

	it("two quick switches keep the first switch's place", async () =>
	{
		hlsSupport(false);
		const video = renderPlayer();
		video.currentTime = 12;
		await chooseHigh(video);
		video.currentTime = 0;
		await userEvent.click(screen.getByRole("button", {
			name: /^Quality:/,
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Standard · 720p, 4 Mbps",
		}));
		fireEvent(video, new Event("loadedmetadata"));
		expect(video.currentTime).toBe(12);
	});

	it("a clip with one quality (recorded before renditions were kept) has no picker", () =>
	{
		renderPlayer({
			...VIDEO,
			renditions: undefined,
		});
		expect(screen.queryByRole("button", {
			name: /^Quality:/,
		})).toBeNull();
		expect(screen.getByTestId("player-actions")).toBeInTheDocument();
	});

	it("a chosen quality is remembered for the next clip; one without it plays the nearest lower quality, and the choice stays (#416)", async () =>
	{
		hlsSupport(false);
		renderPlayer();
		await choose("High · 720p, 16 Mbps");
		cleanup();
		// The next clip starts on the remembered High.
		expect(renderPlayer()).toHaveAttribute("src", HIGH);
		cleanup();
		// A clip MLB gave no High plays the next quality down, Standard.
		expect(renderPlayer({
			...VIDEO,
			id: "no-high",
			renditions: VIDEO.renditions!.filter((rendition) => rendition.name !== "highBit"),
		})).toHaveAttribute("src", MP4);
		cleanup();
		// That fallback was not recorded: a clip with High starts on High again.
		expect(renderPlayer()).toHaveAttribute("src", HIGH);
		expect(localStorage.getItem("bt.videoQuality")).toBe("highBit");
	});

	it("a remembered Auto plays through hls.js where the browser needs it, and falls to the sharpest MP4 where it can't play HLS at all (#416)", async () =>
	{
		hlsSupport(false);
		mseSupport();
		renderPlayer();
		await choose("Auto (HLS)");
		cleanup();
		renderPlayer();
		await act(async () => undefined);
		expect(hlsPlayers.at(-1)?.loadSource).toHaveBeenCalledWith(HLS);
		cleanup();
		vi.unstubAllGlobals();
		expect(renderPlayer()).toHaveAttribute("src", HIGH);
		expect(localStorage.getItem("bt.videoQuality")).toBe("hlsCloud");
	});
});

describe("action palette", () =>
{
	it("Copy link puts the playing file's URL on the clipboard and says Copied, then goes back", async () =>
	{
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		vi.useFakeTimers();
		await act(async () =>
		{
			fireEvent.click(screen.getByRole("button", {
				name: "Copy link",
			}));
		});
		expect(writeText).toHaveBeenCalledWith(MP4);
		expect(screen.getByRole("button", {
			name: "Copied",
		})).toBeInTheDocument();
		act(() =>
		{
			vi.advanceTimersByTime(2000);
		});
		expect(screen.getByRole("button", {
			name: "Copy link",
		})).toBeInTheDocument();
	});

	it("Direct link opens the file in a new tab; with no service worker in control there is no Download (S151 AC 4)", () =>
	{
		renderPlayer();
		const palette = within(screen.getByRole("toolbar", {
			name: "Video actions",
		}));
		const direct = palette.getByRole("link", {
			name: "Direct link",
		});
		expect(direct).toHaveAttribute("href", MP4);
		expect(direct).toHaveAttribute("target", "_blank");
		expect(direct).toHaveAttribute("rel", "noopener noreferrer");
		expect(palette.queryByRole("link", {
			name: "Download",
		})).toBeNull();
		expect(palette.queryByRole("button", {
			name: "Download",
		})).toBeNull();
	});

	it("S151 AC 4: with a worker in control that answers the download route, Download links to it for the clip's MP4, beside Copy link, Direct link and Share", async () =>
	{
		const share = vi.fn(() => Promise.resolve());
		stubWorkers(answeringWorker(), {
			share,
		});
		renderPlayer();
		const palette = within(screen.getByRole("toolbar", {
			name: "Video actions",
		}));
		const download = await palette.findByRole("link", {
			name: "Download",
		});
		expect(download).toHaveAttribute("href", downloadHref(MP4, VIDEO.title));
		expect(download).toHaveAttribute("download");
		expect(download).not.toHaveAttribute("target");
		expect(palette.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", MP4);
		expect(palette.getByRole("button", {
			name: "Copy link",
		})).toBeInTheDocument();
		expect(palette.getByRole("button", {
			name: "Share",
		})).toBeInTheDocument();
	});

	it("S151 AC 4: playing the HLS stream, Download saves the same cut's MP4; a stream-only clip or an MP4 off MLB's clip hosts has none", async () =>
	{
		hlsSupport(true);
		stubWorkers(answeringWorker());
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}, {
				name: "mp4Avc",
				url: MP4,
			}],
		});
		expect(await screen.findByRole("link", {
			name: "Download",
		})).toHaveAttribute("href", downloadHref(MP4, VIDEO.title));
		cleanup();
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		});
		await settle();
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
		cleanup();
		const elsewhere = "https://fastball-clips.mlb.com/849838/network/4f687124-5ec9-337b-a32b-2dedc930bcee.mp4";
		renderPlayer({
			...VIDEO,
			playbackUrl: elsewhere,
			renditions: [],
		});
		await settle();
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", elsewhere);
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("S151 AC 4: no worker in control (a first visit, a private window) shows no Download", async () =>
	{
		stubWorkers(null);
		renderPlayer();
		await settle();
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", MP4);
	});

	it("S151 AC 4: an older worker that never answers shows no Download; once the new one takes control (controllerchange) it is asked again and Download appears", async () =>
	{
		const container = stubWorkers(silentWorker());
		vi.useFakeTimers();
		renderPlayer();
		await act(async () =>
		{
			vi.advanceTimersByTime(DOWNLOAD_PING_TIMEOUT_MS);
		});
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
		vi.useRealTimers();
		container.controller = answeringWorker();
		act(() =>
		{
			container.dispatchEvent(new Event("controllerchange"));
		});
		expect(await screen.findByRole("link", {
			name: "Download",
		})).toHaveAttribute("href", downloadHref(MP4, VIDEO.title));
		// And back: an older worker in control again (another tab rolled back) hides it.
		container.controller = silentWorker();
		vi.useFakeTimers();
		await act(async () =>
		{
			container.dispatchEvent(new Event("controllerchange"));
			vi.advanceTimersByTime(DOWNLOAD_PING_TIMEOUT_MS);
		});
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("S151 AC 4: an answer that comes after the player is gone changes nothing", async () =>
	{
		stubWorkers(answeringWorker());
		renderPlayer();
		cleanup();
		await settle();
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("S151 AC 4: a slow yes to an older question can't show Download after a newer question was answered no", async () =>
	{
		const pending: MessagePort[] = [];
		const container = stubWorkers(deferredWorker(pending));
		renderPlayer();
		await settle();
		expect(pending).toHaveLength(1);
		container.controller = refusingWorker();
		act(() =>
		{
			container.dispatchEvent(new Event("controllerchange"));
		});
		await settle();
		// The first worker answers yes only now, after the newer worker's no.
		pending[0]!.postMessage(DOWNLOAD_READY);
		await settle();
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("S151 AC 4: under StrictMode (main.tsx) the first mount's late yes changes nothing once its effect is cleaned up and the newer question was answered no", async () =>
	{
		const pending: MessagePort[] = [];
		const container = stubWorkers(deferredWorker(pending));
		// StrictMode mounts, cleans up and mounts again: two questions, the first from an effect that is gone.
		render(
			<StrictMode>
				<MantineProvider>
					<MemoryRouter>
						<VideoPlayer video={VIDEO} autoPlay={false} />
					</MemoryRouter>
				</MantineProvider>
			</StrictMode>,
		);
		await settle();
		expect(pending).toHaveLength(2);
		container.controller = refusingWorker();
		act(() =>
		{
			container.dispatchEvent(new Event("controllerchange"));
		});
		await settle();
		// The cleaned-up effect's question is answered yes only now.
		pending[0]!.postMessage(DOWNLOAD_READY);
		await settle();
		expect(screen.queryByRole("link", {
			name: "Download",
		})).toBeNull();
	});

	it("playing the HLS stream, Direct link opens the MP4 MLB also gives; a stream-only clip opens the stream", () =>
	{
		hlsSupport(true);
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}, {
				name: "mp4Avc",
				url: MP4,
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", MP4);
		cleanup();
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HLS);
	});

	it("Share opens the device's share sheet with the title and URL", async () =>
	{
		const share = vi.fn(() => Promise.resolve());
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			share,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(share).toHaveBeenCalledWith({
			title: VIDEO.title,
			url: MP4,
		});
		expect(writeText).not.toHaveBeenCalled();
	});

	it("playing an HLS stream, Copy link, Direct link and Share all use the MP4 of the same cut, not the playlist", async () =>
	{
		hlsSupport(true);
		const share = vi.fn(() => Promise.resolve());
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal("navigator", {
			...navigator,
			share,
			clipboard: {
				writeText,
			},
		});
		const video = renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
		});
		expect(video).toHaveAttribute("src", HLS);
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HIGH);
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(writeText).toHaveBeenCalledWith(HIGH);
		await userEvent.click(screen.getByRole("button", {
			name: "Share",
		}));
		expect(share).toHaveBeenCalledWith({
			title: VIDEO.title,
			url: HIGH,
		});
		cleanup();

		// A portrait stream gives the portrait MP4, never the landscape one.
		renderPlayer({
			...VIDEO,
			playbackUrl: "https://darkroom-clips.mlb.com/b.m3u8",
			renditions: [{
				name: "mp4Avc",
				url: "https://darkroom-clips.mlb.com/a.mp4",
			}, {
				name: "portrait_hlsCloud",
				url: "https://darkroom-clips.mlb.com/b.m3u8",
			}, {
				name: "portrait_mp4Avc",
				url: "https://darkroom-clips.mlb.com/b.mp4",
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", "https://darkroom-clips.mlb.com/b.mp4");
		cleanup();

		// With no MP4 at all, the stream is all there is.
		renderPlayer({
			...VIDEO,
			playbackUrl: HLS,
			renditions: [{
				name: "hlsCloud",
				url: HLS,
			}],
		});
		expect(screen.getByRole("link", {
			name: "Direct link",
		})).toHaveAttribute("href", HLS);
	});

	it("Copy link says \"Couldn't copy\" when the browser has no clipboard, or refuses the write", async () =>
	{
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: undefined,
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(await screen.findByRole("button", {
			name: "Couldn't copy",
		})).toBeInTheDocument();
		cleanup();

		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
			},
		});
		renderPlayer();
		await userEvent.click(screen.getByRole("button", {
			name: "Copy link",
		}));
		expect(await screen.findByRole("button", {
			name: "Couldn't copy",
		})).toBeInTheDocument();
	});

	it("Share shows only where the browser can share the clip: no share sheet, or one that can't share it, draws no Share (#417)", () =>
	{
		const writeText = vi.fn(() => Promise.resolve());
		// No share sheet (most desktop browsers): Copy link already copies, so Share isn't drawn.
		vi.stubGlobal("navigator", {
			...navigator,
			share: undefined,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		expect(screen.getByRole("button", {
			name: "Copy link",
		})).toBeInTheDocument();
		expect(screen.queryByRole("button", {
			name: "Share",
		})).toBeNull();
		cleanup();

		// A share sheet that says it can't take this clip's title and URL.
		const canShare = vi.fn(() => false);
		vi.stubGlobal("navigator", {
			...navigator,
			share: vi.fn(() => Promise.resolve()),
			canShare,
			clipboard: {
				writeText,
			},
		});
		renderPlayer();
		expect(canShare).toHaveBeenCalledWith({
			title: VIDEO.title,
			url: MP4,
		});
		expect(screen.queryByRole("button", {
			name: "Share",
		})).toBeNull();
	});
});
