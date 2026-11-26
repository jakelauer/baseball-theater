/**
 * S198: the one player, held above the routes, and its corner mini-player, which behaves as YouTube's
 * does (owner, 2026-11-25: "it's just a floating video player in the corner and should use exactly the
 * same behaviors that YouTube's mini player uses"). Two pages that play clips through the real dialog
 * (`useOpenClip`'s `?clip=`, #424) under one router and one `PlayerProvider`; the four real hosts have
 * their own S198 AC 1 tests (VideosRoom, PlaysPanel, SearchPage, DayDigest).
 */
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	Link, MemoryRouter, Route, Routes, useLocation, useNavigate,
} from "react-router-dom";
import { useState } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { Notice } from "../../layout/NoticeSlot.js";
import { NoticeSlot } from "../../layout/NoticeSlot.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { resetSettings, setHideScores } from "../../settings/store.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import {
	corner, cornerShown, expectInCorner, markPlaying,
} from "../../test/renderWithPlayer.js";
import { useOpenClip } from "./openClip.js";
import { PlayerDialog } from "./PlayerDialog.js";
import { PlayerStage } from "./PlayerStage.js";
import { CornerSpace, PlayerProvider } from "./PlayerProvider.js";
import type { Video } from "./VideoCard.js";

const clip = (id: string, title: string): Video => ({
	id,
	playId: null,
	title,
	blurb: null,
	duration: "00:00:20",
	imageUrl: null,
	playbackUrl: `https://mlb-cuts-diamond.mlb.com/${id}.mp4`,
});

const JUDGE = clip("judge", "Judge homers");
const SOTO = clip("soto", "Soto doubles");
/** A game's recap, whose MLB title gives the result: "Recap (score hidden)" with Hide Scores on (S75). */
const RECAP: Video = {
	...clip("recap", "Yankees beat Red Sox 7-2"),
	tags: ["game-recap"],
};

/**
 * A page that plays its clips in the dialog, as Search and the digest do: a link per clip, `?clip=` open.
 * With `gamePk` it is that game's page, as the Videos room is: its dialog follows Hide Scores.
 */
function ClipsPage({
	name, clips, gamePk,
}: { name: string;
	clips: readonly Video[];
	gamePk?: number; })
{
	const {
		playing, href, close,
	} = useOpenClip(clips, (video) => video.id);
	const scoresHidden = useScoresHidden(gamePk === undefined ? undefined : {
		gamePk,
	});
	return (
		<>
			<h1>{name}</h1>
			{clips.map((video) => <Link key={video.id} to={href(video)} replace>{`Play ${video.title}`}</Link>)}
			{playing ? <PlayerDialog video={playing} onClose={close} {...gamePk === undefined ? {} : {
				fromGamePk: gamePk,
				scoresHidden,
			}} /> : null}
		</>
	);
}

/** Where the router is, and the browser's Back. */
function Chrome()
{
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<span data-testid="where">{location.pathname + location.search}</span>
			<Link to="/standings">Standings</Link>
			<Link to="/search">Search</Link>
			<Link to="/stage">Stage</Link>
			<Link to="/both">Both</Link>
			<Link to="/game">Game</Link>
			<button type="button" onClick={() => void navigate(-1)}>Back</button>
		</>
	);
}

function renderApp(variant: LayoutVariant = "desktop", extra: ReactNode = null)
{
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={["/videos"]}>
				<PlayerProvider variant={variant}>
					<Chrome />
					<Routes>
						<Route path="/videos" element={<ClipsPage name="Videos" clips={[JUDGE]} />} />
						<Route path="/search" element={<ClipsPage name="Search" clips={[SOTO]} />} />
						<Route path="/game" element={<ClipsPage name="Game" clips={[RECAP]} gamePk={823823} />} />
						{/* A stage waiting on its first clip, as the Videos room's is before a choice. */}
						<Route path="/stage" element={<PlayerStage video={JUDGE} autoPlay={false} />} />
						{/* A waiting stage beside a page that opens its clip in the dialog. */}
						<Route path="/both" element={<><PlayerStage video={JUDGE} autoPlay={false} /><ClipsPage name="Both" clips={[SOTO]} /></>} />
						<Route path="*" element={<h1>Standings</h1>} />
					</Routes>
					{extra}
				</PlayerProvider>
			</MemoryRouter>
		</MantineProvider>,
	);
}

/** Opens a clip from the page shown and returns its `<video>`, marked playing at `time`. */
async function play(title: string, time: number): Promise<HTMLVideoElement>
{
	fireEvent.click(screen.getByRole("link", {
		name: `Play ${title}`,
	}));
	const dialog = await screen.findByRole("dialog");
	const video = within(dialog).getByTestId("video-player").querySelector("video")!;
	markPlaying(video, time);
	return video;
}

/** Plays Judge's clip on the Videos page, then leaves for Standings: the clip in the corner. */
async function judgeInCorner(): Promise<HTMLVideoElement>
{
	const video = await play(JUDGE.title, 5);
	fireEvent.click(screen.getByRole("link", {
		name: "Standings",
	}));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expectInCorner(video, 5);
	return video;
}

const where = () => screen.getByTestId("where").textContent;

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	resetSettings();
});

describe("S198: leaving a playing clip (AC 1)", () =>
{
	it("S198 AC 1: the mini-player button moves a playing clip to the corner, the same element, leaving the fan on the page beneath", async () =>
	{
		renderApp();
		const video = await play(JUDGE.title, 3);
		fireEvent.click(within(screen.getByRole("toolbar", {
			name: "Video actions",
		})).getByRole("button", {
			name: "Mini player",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expectInCorner(video, 3);
		// Still on the page: no route change, only the clip's `?clip=` gone.
		expect(where()).toBe("/videos");
		expect(screen.getByRole("heading", {
			name: "Videos",
		})).toBeInTheDocument();
		// The corner draws the clip alone: no tool row, no Mini player button.
		expect(within(corner()).queryByRole("toolbar")).toBeNull();
	});

	it("S198 AC 1: a paused clip leaving its page closes, as before, with no corner player", async () =>
	{
		renderApp();
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${JUDGE.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		const video = within(dialog).getByTestId("video-player").querySelector("video")!;
		// jsdom's element is paused: nothing plays.
		expect(video.paused).toBe(true);
		fireEvent.click(screen.getByRole("link", {
			name: "Standings",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(cornerShown()).toBe(false);
		expect(video.isConnected).toBe(false);
		expect(document.querySelector("video")).toBeNull();
	});
});

describe("S198: the corner player's controls (AC 2)", () =>
{
	it("S198 AC 2: one corner player, named by the clip's title, with play / pause, expand and close", async () =>
	{
		renderApp();
		const video = await judgeInCorner();
		expect(screen.getAllByTestId("corner-player")).toHaveLength(1);
		const mini = screen.getByRole("region", {
			name: JUDGE.title,
		});
		expect(mini).toBe(corner());
		// The clip alone: the corner's own controls, not the browser's.
		expect(video.controls).toBe(false);
		fireEvent.click(within(mini).getByRole("button", {
			name: "Pause",
		}));
		expect(video.paused).toBe(true);
		fireEvent.click(within(mini).getByRole("button", {
			name: "Play",
		}));
		expect(video.paused).toBe(false);
		expect(within(mini).getByRole("button", {
			name: "Expand mini player",
		})).toBeInTheDocument();
		expect(within(mini).getByRole("button", {
			name: "Close mini player",
		})).toBeInTheDocument();
	});

	it("S198 AC 2: expand goes to the video's own page and shows it in the modal, the same element, playing on", async () =>
	{
		renderApp();
		const video = await judgeInCorner();
		fireEvent.click(within(corner()).getByRole("button", {
			name: "Expand mini player",
		}));
		expect(where()).toBe("/videos?clip=judge");
		const dialog = await screen.findByRole("dialog");
		await waitFor(() => expect(within(dialog).getByTestId("video-player").querySelector("video")).toBe(video));
		expect(cornerShown()).toBe(false);
		expect(video.paused).toBe(false);
		expect(video.currentTime).toBeGreaterThanOrEqual(5);
		// The full player again: the browser's controls back.
		expect(video.controls).toBe(true);
	});

	it("S198 AC 2: Back to the video's page expands it the same way", async () =>
	{
		renderApp();
		const video = await judgeInCorner();
		fireEvent.click(screen.getByRole("button", {
			name: "Back",
		}));
		expect(where()).toBe("/videos?clip=judge");
		const dialog = await screen.findByRole("dialog");
		await waitFor(() => expect(within(dialog).getByTestId("video-player").querySelector("video")).toBe(video));
		expect(cornerShown()).toBe(false);
		expect(video.paused).toBe(false);
	});

	it("S198 AC 2: close stops the clip and removes the corner player", async () =>
	{
		renderApp();
		const video = await judgeInCorner();
		fireEvent.click(within(corner()).getByRole("button", {
			name: "Close mini player",
		}));
		expect(video.paused).toBe(true);
		expect(cornerShown()).toBe(false);
		expect(video.isConnected).toBe(false);
		expect(where()).toBe("/standings");
	});

	it("S198 AC 2: another video opened while one plays in the corner replaces it in the full player, and the corner closes", async () =>
	{
		renderApp();
		const judge = await judgeInCorner();
		const soto = await openSoto();
		expect(soto).not.toBe(judge);
		expect(judge.paused).toBe(true);
		expect(judge.isConnected).toBe(false);
		expect(cornerShown()).toBe(false);
		expect(within(screen.getByRole("dialog")).getByTestId("video-player")).toHaveTextContent(SOTO.title);
		expect(screen.getAllByTestId("corner-player")).toHaveLength(1);
	});
});

/** Goes to Search (a fresh page) and opens Soto's clip there, returning its `<video>`. */
async function openSoto(): Promise<HTMLVideoElement>
{
	fireEvent.click(screen.getByRole("link", {
		name: "Search",
	}));
	await screen.findByRole("heading", {
		name: "Search",
	});
	fireEvent.click(screen.getByRole("link", {
		name: `Play ${SOTO.title}`,
	}));
	const dialog = await screen.findByRole("dialog");
	return within(dialog).getByTestId("video-player").querySelector("video")!;
}

describe("S198: out of the way (AC 4)", () =>
{
	const UPDATE: Notice = {
		id: "update",
		message: "An update to Baseball Theater is ready.",
		update: {
			onUpdate: () => undefined,
			onSnooze: () => undefined,
		},
	};

	it("S198 AC 4: at the bottom right, a third of the width on a phone and 400px wider up, above the update notice without overlapping it, with room left after the footer", async () =>
	{
		for (const variant of ["mobile", "desktop"] as const)
		{
			renderApp(variant, (
				<>
					<footer data-testid="footer">Footer</footer>
					<CornerSpace variant={variant} />
					<NoticeSlot notice={UPDATE} />
				</>
			));
			// The notice floats 16px up from the bottom of an 844px screen, 120px tall.
			const float = screen.getByTestId("notice-float");
			vi.spyOn(float, "getBoundingClientRect").mockReturnValue({
				top: 844 - 16 - 120,
				bottom: 844 - 16,
				height: 120,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			});
			vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
			await judgeInCorner();
			const box = corner().style;
			expect(box.position).toBe("fixed");
			expect(box.right).toBe("16px");
			expect(box.width).toBe(variant === "mobile" ? "33vw" : "400px");
			// Its bottom edge sits a 12px gap above the notice's top edge.
			const bottom = 844 - Number.parseFloat(box.bottom);
			expect(bottom).toBeLessThanOrEqual(844 - 16 - 120 - 12);
			// After the footer, room for the corner's height, inset and gap.
			const space = screen.getByTestId("corner-space");
			expect(screen.getByTestId("footer").nextElementSibling).toBe(space);
			// The corner's 16:9 clip at its width, its 38px controls row, 16px inset and 12px gap.
			expect(space.style.height.replace(/\s/g, "")).toMatch(variant === "mobile" ? /^calc\(66px\+18\.5625vw\)$/ : /291px/);
			cleanup();
			vi.restoreAllMocks();
		}
	});
});

describe("S198: one player above the routes (AC 3)", () =>
{
	it("S198 AC 3: a stage waiting on its first clip never takes the player from the corner, and takes it once the corner closes", async () =>
	{
		renderApp();
		const soto = await openSoto();
		markPlaying(soto, 2);
		fireEvent.click(screen.getByRole("link", {
			name: "Stage",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expectInCorner(soto, 2);
		// The waiting stage draws nothing while the corner plays another clip.
		expect(where()).toBe("/stage");
		const waiting = document.querySelector<HTMLElement>("section[aria-label='Video player']");
		expect(waiting).not.toBeNull();
		expect(waiting!.style.display).toBe("none");
		fireEvent.click(within(corner()).getByRole("button", {
			name: "Close mini player",
		}));
		const stage = await screen.findByRole("region", {
			name: "Video player",
		});
		expect(stage).toHaveTextContent(JUDGE.title);
		expect(cornerShown()).toBe(false);
	});

	it("S198 AC 3: a host outside a PlayerProvider says so", () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => render(
			<MantineProvider>
				<MemoryRouter>
					<PlayerStage video={JUDGE} autoPlay={false} />
				</MemoryRouter>
			</MantineProvider>,
		)).toThrow("usePlayerSlot needs a PlayerProvider above it");
	});

	it("S198 AC 3: the player loads as its own chunk once the provider mounts, and a clip chosen before it arrives plays once it does", async () =>
	{
		// A fresh module, as on a fresh page load: the player not loaded yet.
		vi.resetModules();
		const fresh = await import("./PlayerProvider.js");
		const { PlayerStage: FreshStage } = await import("./PlayerStage.js");
		const tree = (
			<MantineProvider>
				<MemoryRouter>
					<fresh.PlayerProvider>
						<FreshStage video={JUDGE} autoPlay />
					</fresh.PlayerProvider>
				</MemoryRouter>
			</MantineProvider>
		);
		// Gone before the chunk arrives: nothing is set on an unmounted provider.
		render(tree).unmount();
		render(tree);
		expect(screen.queryByTestId("video-player")).toBeNull();
		expect(await screen.findByTestId("video-player")).toHaveTextContent(JUDGE.title);
	});

	it("S198 AC 3: a player chunk that fails to load (a dropped connection) is tried again on the next ask", async () =>
	{
		vi.resetModules();
		vi.doMock("./VideoPlayer.js", () =>
		{
			throw new Error("offline");
		});
		const fresh = await import("./PlayerProvider.js");
		await expect(fresh.loadPlayer()).rejects.toThrow();
		vi.doUnmock("./VideoPlayer.js");
		expect(await fresh.loadPlayer()).toBeTypeOf("function");
	});

	it("S198 AC 3: a clip chosen in the dialog takes the one player from a waiting stage, which waits drawn as nothing", async () =>
	{
		renderApp();
		fireEvent.click(screen.getByRole("link", {
			name: "Both",
		}));
		const stage = await screen.findByRole("region", {
			name: "Video player",
		});
		const waiting = within(stage).getByTestId("video-player").querySelector("video")!;
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${SOTO.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		const soto = within(dialog).getByTestId("video-player").querySelector("video")!;
		expect(soto).not.toBe(waiting);
		expect(within(dialog).getByTestId("video-player")).toHaveTextContent(SOTO.title);
		expect(stage.style.display).toBe("none");
	});
});

describe("S198: the pre-PR review's nits", () =>
{
	it("S198 AC 2: the Mini player button moves focus to the corner's first control, so a keyboard is never stranded", async () =>
	{
		renderApp();
		await play(JUDGE.title, 3);
		const button = within(screen.getByRole("toolbar", {
			name: "Video actions",
		})).getByRole("button", {
			name: "Mini player",
		});
		button.focus();
		fireEvent.click(button);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(within(corner()).getByRole("button", {
			name: "Pause",
		})));
	});

	it("S198 AC 2: leaving the page by a link leaves focus to the page, not the corner", async () =>
	{
		renderApp();
		await play(JUDGE.title, 3);
		const link = screen.getByRole("link", {
			name: "Standings",
		});
		link.focus();
		fireEvent.click(link);
		await waitFor(() => expect(cornerShown()).toBe(true));
		expect(corner().contains(document.activeElement)).toBe(false);
	});

	it("S198 AC 2: a game's recap in the corner follows Hide Scores as it changes (`highlightTitle`)", async () =>
	{
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		renderApp();
		fireEvent.click(screen.getByRole("link", {
			name: "Game",
		}));
		const video = await play(RECAP.title, 4);
		fireEvent.click(screen.getByRole("link", {
			name: "Standings",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expectInCorner(video, 4);
		expect(corner()).toHaveAccessibleName(RECAP.title);
		await act(() => setHideScores(true));
		expect(corner()).toHaveAccessibleName("Recap (score hidden)");
		expect(corner()).not.toHaveTextContent(RECAP.title);
		await act(() => setHideScores(false));
		expect(corner()).toHaveAccessibleName(RECAP.title);
	});

	it("S198 AC 2: a clip from Search keeps MLB's title in the corner whatever Hide Scores says", async () =>
	{
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		renderApp();
		fireEvent.click(screen.getByRole("link", {
			name: "Search",
		}));
		await screen.findByRole("heading", {
			name: "Search",
		});
		await play(SOTO.title, 2);
		fireEvent.click(screen.getByRole("link", {
			name: "Standings",
		}));
		await waitFor(() => expect(cornerShown()).toBe(true));
		await act(() => setHideScores(true));
		expect(corner()).toHaveAccessibleName(SOTO.title);
	});

	it("S198 AC 2: Esc in the first frame of another clip's dialog closes only that dialog, the corner's clip playing on", async () =>
	{
		renderApp();
		const judge = await judgeInCorner();
		fireEvent.click(screen.getByRole("link", {
			name: "Search",
		}));
		await screen.findByRole("heading", {
			name: "Search",
		});
		// Opened, and Esc pressed before the dialog's slot has attached (it opens a frame later).
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${SOTO.title}`,
		}));
		fireEvent.keyDown(window, {
			key: "Escape",
		});
		expect(where()).toBe("/search");
		expectInCorner(judge, 5);
	});
});

describe("S198: measured only when a notice comes or goes (AC 4)", () =>
{
	const UPDATE: Notice = {
		id: "update",
		message: "An update to Baseball Theater is ready.",
		update: {
			onUpdate: () => undefined,
			onSnooze: () => undefined,
		},
	};

	/** The update notice, shown once its button is pressed. */
	function LateNotice()
	{
		const [shown, setShown] = useState(false);
		return (
			<>
				<button type="button" onClick={() => setShown(true)}>Show the notice</button>
				<NoticeSlot notice={shown ? UPDATE : null} />
			</>
		);
	}

	it("S198 AC 4: a notice arriving under the corner lifts it, and other changes to the page never re-measure", async () =>
	{
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
		const original = HTMLElement.prototype.getBoundingClientRect;
		let reads = 0;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			if (this.dataset.testid !== "notice-float") return original.call(this);
			reads += 1;
			return {
				top: 844 - 16 - 120,
				bottom: 844 - 16,
				height: 120,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			};
		});
		renderApp("desktop", <LateNotice />);
		await judgeInCorner();
		expect(corner().style.bottom).not.toBe("140px");
		fireEvent.click(screen.getByRole("button", {
			name: "Show the notice",
		}));
		await waitFor(() => expect(corner().style.bottom).toBe(`${16 + 120 + 12}px`));
		const before = reads;
		// A change elsewhere on the page: nothing to measure.
		const elsewhere = document.createElement("div");
		document.body.appendChild(elsewhere);
		elsewhere.textContent = "changed";
		await new Promise((done) => setTimeout(done, 0));
		expect(reads).toBe(before);
		elsewhere.remove();
	});
});
