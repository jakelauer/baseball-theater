/**
 * S174 AC 6: only the Videos room's player counts views. With the sender stubbed (`sendClipView`), the dialog the room
 * opens sends `start` once per opening however often the fan pauses and plays, with the game and the clip's place in
 * the ranked list (0 when opened directly from a link), and `complete` once per opening, by `ended` or at 90% of a known
 * length, never for a clip stopped at 50%, and only after this opening's counted start, at the place it started from
 * (a clip expanded back from the corner keeps it); switching clips counts the new one. The stage, Search's and the day
 * digest's players send nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DigestGame, SearchHighlight } from "@bt/domain";
import {
	DEFAULT_SETTINGS, dayDigest, rankHighlightsByImpact,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	Link, MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { sendClipView } from "../../api/clipViews.js";
import type { DayDigestPayload } from "../../api/digest.js";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import { ScoreboardPage } from "../../pages/ScoreboardPage.js";
import { SearchPage } from "../../pages/SearchPage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { markPlaying } from "../../test/renderWithPlayer.js";
import { PlayerProvider } from "./PlayerProvider.js";
import { VideoPlayer } from "./VideoPlayer.js";
import { VideosRoom } from "./VideosRoom.js";

// The stubbed sender: every view the players would send lands here.
vi.mock("../../api/clipViews.js", () => ({
	sendClipView: vi.fn(),
}));
const sent = vi.mocked(sendClipView);

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function read<T>(name: string): T
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

/** 823823 as the server sends it: its clips impact-ranked, no plays. */
function game(): GamePayload
{
	const snapshot = read<GamePayload>("game-823823.json");
	return {
		...snapshot,
		plays: [],
		highlights: rankHighlightsByImpact(snapshot.highlights) as GamePayload["highlights"],
	};
}

const GAME = game();
const RANKED = GAME.highlights;

function renderRoom(entry = "/game/823823/videos")
{
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={[entry]}><PlayerProvider>
				{/* Another page to leave for: a playing clip goes to the corner. */}
				<Link to="/elsewhere">Leave</Link>
				<Routes>
					<Route path="/game/823823/videos" element={<VideosRoom game={GAME} variant="desktop" />} />
					<Route path="/elsewhere" element={<p>Elsewhere</p>} />
				</Routes>
			</PlayerProvider></MemoryRouter>
		</MantineProvider>,
	);
}

/** Opens the room's clip at 0-based `index` of the ranked list from its card, and returns the dialog's `<video>`. */
async function openCard(index: number): Promise<HTMLVideoElement>
{
	fireEvent.click(screen.getByRole("link", {
		name: `Play ${RANKED[index]!.title}`,
	}));
	return playerVideo();
}

/** The `<video>` of the open dialog, once its player has drawn. */
async function playerVideo(): Promise<HTMLVideoElement>
{
	const dialog = await screen.findByRole("dialog");
	return waitFor(() => within(dialog).getByTestId("video-player").querySelector("video")!);
}

/** Reports the element at `time` of a clip `duration` long, as the browser's `timeupdate` does. */
function playedTo(video: HTMLVideoElement, time: number, duration: number): void
{
	Object.defineProperty(video, "currentTime", {
		configurable: true,
		get: () => time,
		set: () => undefined,
	});
	Object.defineProperty(video, "duration", {
		configurable: true,
		value: duration,
	});
	fireEvent.timeUpdate(video);
}

/** The views sent so far, as `[mediaId, event, source]`. */
function views()
{
	return sent.mock.calls.map(([mediaId, event, source]) => [mediaId, event, source]);
}

afterEach(() =>
{
	cleanup();
	resetSettings();
	sent.mockClear();
	vi.unstubAllGlobals();
});

describe("the Videos room's player counts views (S174 AC 6)", () =>
{
	it("S174 AC 6: one start per opening, with the game and the clip's ranked place, however often the fan pauses and plays", async () =>
	{
		renderRoom();
		const video = await openCard(2);
		fireEvent.play(video);
		for (let i = 0; i < 3; i++)
		{
			fireEvent.pause(video);
			fireEvent.play(video);
		}
		expect(views()).toEqual([[RANKED[2]!.id, "start", {
			gamePk: 823823,
			shownPosition: 3,
		}]]);
	});

	it("S174 AC 6: one complete per opening, at 90% of a known length or on ended, and none for a clip stopped at 50%", async () =>
	{
		renderRoom();
		const video = await openCard(0);
		fireEvent.play(video);
		playedTo(video, 50, 100);
		fireEvent.pause(video);
		expect(views().map(([, event]) => event)).toEqual(["start"]);
		fireEvent.play(video);
		playedTo(video, 89.9, 100);
		expect(views().map(([, event]) => event)).toEqual(["start"]);
		playedTo(video, 90, 100);
		expect(views().map(([, event]) => event)).toEqual(["start", "complete"]);
		playedTo(video, 99, 100);
		fireEvent.ended(video);
		fireEvent.play(video);
		fireEvent.ended(video);
		expect(views()).toEqual([[RANKED[0]!.id, "start", {
			gamePk: 823823,
			shownPosition: 1,
		}], [RANKED[0]!.id, "complete", {
			gamePk: 823823,
			shownPosition: 1,
		}]]);
	});

	it("S174 AC 6: a clip whose length is 0 or NaN completes only by ended", async () =>
	{
		renderRoom();
		const video = await openCard(1);
		fireEvent.play(video);
		playedTo(video, 1000, Number.NaN);
		playedTo(video, 1000, 0);
		expect(views().map(([, event]) => event)).toEqual(["start"]);
		fireEvent.ended(video);
		expect(views().map(([, event]) => event)).toEqual(["start", "complete"]);
	});

	it("S174 AC 6: switching clips counts the new clip, and opening a clip again after it closed is a new opening", async () =>
	{
		renderRoom();
		const first = await openCard(0);
		fireEvent.play(first);
		// The cards stay links under the dialog: choosing another clip swaps the player to it.
		const second = await openCard(4);
		expect(second).not.toBe(first);
		fireEvent.play(second);
		playedTo(second, 95, 100);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", {
			name: /close/i,
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		const again = await openCard(4);
		fireEvent.play(again);
		expect(views().map(([mediaId, event, source]) => [mediaId, event, (source as { shownPosition: number }).shownPosition])).toEqual([
			[RANKED[0]!.id, "start", 1],
			[RANKED[4]!.id, "start", 5],
			[RANKED[4]!.id, "complete", 5],
			[RANKED[4]!.id, "start", 5],
		]);
	});

	it("S174 AC 6: a clip opened directly from a link counts at shown position 0", async () =>
	{
		renderRoom(`/game/823823/videos?clip=${encodeURIComponent(RANKED[6]!.id)}`);
		const video = await playerVideo();
		fireEvent.play(video);
		expect(views()).toEqual([[RANKED[6]!.id, "start", {
			gamePk: 823823,
			shownPosition: 0,
		}]]);
	});

	it("S174 AC 6: a clip opened directly, closed, then opened from its card counts at its ranked place, not 0", async () =>
	{
		renderRoom(`/game/823823/videos?clip=${encodeURIComponent(RANKED[6]!.id)}`);
		fireEvent.play(await playerVideo());
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", {
			name: /close/i,
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.play(await openCard(6));
		expect(views().map(([mediaId, event, source]) => [mediaId, event, (source as { shownPosition: number }).shownPosition])).toEqual([
			[RANKED[6]!.id, "start", 0],
			[RANKED[6]!.id, "start", 7],
		]);
	});

	it("S174 AC 6: a clip left to the corner and expanded back completes at the place it started from", async () =>
	{
		renderRoom();
		const video = await openCard(2);
		markPlaying(video, 3);
		fireEvent.play(video);
		// Leaving the room while it plays moves the clip to the corner.
		fireEvent.click(screen.getByRole("link", {
			name: "Leave",
		}));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		// Expanding it goes to the clip's own link: the room draws again with it open, as if opened directly.
		fireEvent.click(screen.getByRole("button", {
			name: "Expand mini player",
		}));
		const dialog = await screen.findByRole("dialog");
		await waitFor(() => expect(within(dialog).getByTestId("video-player").querySelector("video")).toBe(video));
		playedTo(video, 95, 100);
		expect(views()).toEqual([[RANKED[2]!.id, "start", {
			gamePk: 823823,
			shownPosition: 3,
		}], [RANKED[2]!.id, "complete", {
			gamePk: 823823,
			shownPosition: 3,
		}]]);
	});

	it("S174 AC 6: a clip already playing when counting begins (Search's player, taken to the Videos room) completes nothing", () =>
	{
		const clip = RANKED[0]!;
		const source = {
			gamePk: 823823,
			shownPosition: 1,
		};
		const { rerender } = render(
			<MantineProvider>
				<MemoryRouter><PlayerProvider><VideoPlayer video={clip} /></PlayerProvider></MemoryRouter>
			</MantineProvider>,
		);
		const video = screen.getByTestId("video-player").querySelector("video")!;
		fireEvent.play(video);
		rerender(
			<MantineProvider>
				<MemoryRouter><PlayerProvider><VideoPlayer video={clip} countViews={source} /></PlayerProvider></MemoryRouter>
			</MantineProvider>,
		);
		expect(screen.getByTestId("video-player").querySelector("video")).toBe(video);
		playedTo(video, 95, 100);
		fireEvent.ended(video);
		expect(sent).not.toHaveBeenCalled();
	});

	it("S174 AC 6: nothing on screen changes: the dialog's player draws the same with and without counting", async () =>
	{
		renderRoom();
		const video = await openCard(0);
		fireEvent.play(video);
		playedTo(video, 95, 100);
		const player = within(await screen.findByRole("dialog")).getByTestId("video-player");
		expect(player.querySelectorAll("[role=status], [role=alert]")).toHaveLength(0);
		expect(player).toHaveTextContent(RANKED[0]!.title);
	});
});

describe("other players send nothing (S174 AC 6)", () =>
{
	it("S174 AC 6: the Videos room's stage sends nothing", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
			...DEFAULT_SETTINGS,
			videoPlayer: "stage",
			version: 1,
		}))));
		await hydrateSettings("test-user");
		renderRoom();
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${RANKED[1]!.title}`,
		}));
		const stage = await screen.findByRole("region", {
			name: "Video player",
		});
		const video = await waitFor(() => stage.querySelector("video")!);
		fireEvent.play(video);
		playedTo(video, 95, 100);
		fireEvent.ended(video);
		expect(sent).not.toHaveBeenCalled();
	});

	it("S174 AC 6: Search's player sends nothing", async () =>
	{
		const clip = RANKED[0]!;
		const result: SearchHighlight = {
			highlight: clip,
			game: null,
			halfInning: null,
			inning: null,
		} as unknown as SearchHighlight;
		vi.stubGlobal("fetch", vi.fn((request: Request) =>
		{
			const url = new URL(request.url);
			if (url.pathname === "/api/v1/search/highlights") return Promise.resolve(jsonResponse({
				query: "walk-off",
				total: 1,
				highlights: [result],
			}));
			return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
		}));
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={[`/search?q=walk-off&clip=${encodeURIComponent(clip.id)}`]}><PlayerProvider>
						<Routes>
							<Route path="/search" element={<SearchPage variant="desktop" />} />
						</Routes>
					</PlayerProvider></MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
		const video = await playerVideo();
		fireEvent.play(video);
		playedTo(video, 95, 100);
		fireEvent.ended(video);
		expect(sent).not.toHaveBeenCalled();
	});

	it("S174 AC 6: the day digest's player sends nothing", async () =>
	{
		const schedule: ScheduleDayPayload = {
			...read<ScheduleDayPayload>("schedule-2024-07-04.json"),
			fetchedAt: "2024-07-04T23:00:00.000Z",
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2024-07-04T23:00:00.000Z",
		};
		const digest: DayDigestPayload = {
			date: "2024-07-04",
			items: dayDigest([read<DigestGame>("game-744834.json"), read<DigestGame>("game-745001.json")]),
			windowMode: "cache",
		};
		vi.stubGlobal("fetch", vi.fn((request: Request) =>
		{
			const { pathname } = new URL(request.url);
			if (pathname === "/api/v1/digest") return Promise.resolve(jsonResponse(digest));
			if (pathname === "/api/v1/me/settings") return Promise.resolve(jsonResponse(DEFAULT_SETTINGS));
			return Promise.resolve(jsonResponse(schedule));
		}));
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<MemoryRouter initialEntries={[`/games/2024-07-04?clip=${encodeURIComponent(digest.items[0]!.highlight.id)}`]}><PlayerProvider>
						<Routes>
							<Route path="/games/:date" element={<ScoreboardPage variant="desktop" />} />
						</Routes>
					</PlayerProvider></MemoryRouter>
				</QueryClientProvider>
			</MantineProvider>,
		);
		const video = await playerVideo();
		fireEvent.play(video);
		playedTo(video, 95, 100);
		fireEvent.ended(video);
		expect(sent).not.toHaveBeenCalled();
	});
});
