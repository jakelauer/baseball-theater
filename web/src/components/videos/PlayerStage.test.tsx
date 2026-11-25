/**
 * S172 on 823823: the stage-mode player's inning row (standings-search-settings A10). With Stage
 * chosen in Settings, the clip the stage shows, the waiting first clip or a chosen one, gets S145's
 * inning pill alone on a row above the video; a clip with no play gets no row; the pill opens the
 * play in the Plays room; Hide Scores leaves the row as it is. Rendered through the game page and
 * its routes, so the room's wiring is what's tested.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtBat } from "@bt/domain";
import { DEFAULT_SETTINGS } from "@bt/domain";
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
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import { GamePage } from "../../pages/GamePage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const read = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
const PLAYS: AtBat[] = read("plays-823823.json");
const GAME: GamePayload = {
	...read("game-823823.json"),
	plays: PLAYS,
	fetchedAt: "2026-09-05T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T23:00:00.000Z",
} as GamePayload;

/** The at-bat a pitch id is in, found independently of the code under test. */
const atBatOf = (playId: string) => PLAYS.find((a) => a.pitches.some((p) => p.playId === playId));
/** The room's first clip, which the stage shows waiting: Griffin Conine's home run, bottom of the 5th. */
const FIRST = GAME.highlights[0]!;
/** A top-of-the-6th clip (Michael Busch's RBI single). */
const BUSCH = GAME.highlights.find((h) => h.title === "Michael Busch's RBI single")!;
/** A clip with no play. */
const NO_PLAY = GAME.highlights.find((h) => !h.playId)!;

function Where()
{
	const location = useLocation();
	return <div data-testid="where">{location.pathname + location.search}</div>;
}

/** Signs a reader in with Stage chosen (S70's setting) and Hide Scores as given, then opens 823823's Videos room. */
async function openStage(hideScores = false): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
	{
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		return Promise.resolve(jsonResponse(url.includes("/me/settings")
			? {
				...DEFAULT_SETTINGS,
				videoPlayer: "stage",
				hideScores,
				version: 1,
			}
			: GAME));
	}));
	await hydrateSettings("test-user");
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/game/823823/videos"]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<><GamePage variant="mobile" /><Where /></>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findAllByTestId("video-card");
}

const stage = () => screen.getByRole("region", {
	name: "Video player",
});

/** The stage's pill, checked to sit alone on its own row, which comes before the video. */
function rowPill(): HTMLElement
{
	const row = within(stage()).getByTestId("stage-play-row");
	const pill = within(row).getByRole("link");
	expect(row.children).toHaveLength(1);
	expect(row.firstElementChild).toBe(pill);
	const video = within(stage()).getByTestId("video-player");
	expect(row.contains(video)).toBe(false);
	// The row precedes the video in the document: above it.
	expect(row.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	return pill;
}

afterEach(async () =>
{
	cleanup();
	vi.unstubAllGlobals();
	await resetSettings();
});

describe("the stage's inning row (S172)", () =>
{
	it("S172 AC 1: the waiting first clip with a play shows its inning pill alone on a row above the video", async () =>
	{
		await openStage();
		expect(atBatOf(FIRST.playId!)?.about).toMatchObject({
			halfInning: "bottom",
			inning: 5,
		});
		await waitFor(() => expect(within(stage()).queryByTestId("stage-play-row")).not.toBeNull());
		const pill = rowPill();
		expect(pill.textContent).toBe("Bot 5 →");
		expect(pill.getAttribute("aria-label")).toBe("Bot 5: open play, bottom of 5th inning");
		expect(pill.getAttribute("href")).toBe(`/game/823823/plays?play=${encodeURIComponent(FIRST.playId!)}`);
		expect(pill.className).toMatch(/\bbt-play-pill\b/);
		// S172 AC 3: no game pill in the stage, the game is open.
		expect(within(stage()).queryByText(/More from game/)).toBeNull();
		// The only pill in the stage is the row's (the player's own Direct link is no pill).
		expect(stage().querySelectorAll(".bt-play-pill")).toHaveLength(1);
	});

	it("S172 AC 1: a chosen clip with a play shows its own inning pill on the row", async () =>
	{
		await openStage();
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${BUSCH.title}`,
		}));
		await waitFor(() => expect(within(stage()).getByTestId("stage-play-row").textContent).toBe("Top 6 →"));
		const pill = rowPill();
		expect(pill.getAttribute("aria-label")).toBe("Top 6: open play, top of 6th inning");
		expect(pill.getAttribute("href")).toBe(`/game/823823/plays?play=${encodeURIComponent(BUSCH.playId!)}`);
		expect(within(stage()).queryByText(/More from game/)).toBeNull();
	});

	it("S172 AC 1: a clip with no play shows no pill and no row", async () =>
	{
		await openStage();
		fireEvent.click(screen.getAllByRole("link", {
			name: `Play ${NO_PLAY.title}`,
		})[0]!);
		await waitFor(() => expect(within(stage()).getByTestId("video-player")).toHaveTextContent(NO_PLAY.title));
		expect(within(stage()).queryByTestId("stage-play-row")).toBeNull();
		expect(stage().querySelector(".bt-play-pill")).toBeNull();
		expect(stage().querySelector("a[href*='/plays?play=']")).toBeNull();
	});

	it("S172 AC 2: choosing the pill opens the play in the Plays room, leaving the Videos room and its stage", async () =>
	{
		await openStage();
		fireEvent.click(screen.getByRole("link", {
			name: `Play ${BUSCH.title}`,
		}));
		await waitFor(() => expect(within(stage()).getByTestId("stage-play-row").textContent).toBe("Top 6 →"));
		fireEvent.click(rowPill());
		await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/game/823823/plays?play=${encodeURIComponent(BUSCH.playId!)}`));
		await waitFor(() => expect(screen.queryByRole("region", {
			name: "Video player",
		})).toBeNull());
	});

	it("S172 AC 6: Hide Scores leaves the row unchanged", async () =>
	{
		await openStage(false);
		await waitFor(() => expect(within(stage()).queryByTestId("stage-play-row")).not.toBeNull());
		const shown = within(stage()).getByTestId("stage-play-row").outerHTML;
		cleanup();
		await resetSettings();
		await openStage(true);
		await waitFor(() => expect(within(stage()).queryByTestId("stage-play-row")).not.toBeNull());
		expect(within(stage()).getByTestId("stage-play-row").outerHTML).toBe(shown);
	});
});

describe("the stage keeps its layout beside the inset dialog (S196)", () =>
{
	it("S196 AC 4: the stage draws its pill row above the <video> and its title under it, at sm, with the browser's controls", async () =>
	{
		await openStage();
		await waitFor(() => expect(within(stage()).queryByTestId("stage-play-row")).not.toBeNull());
		const row = within(stage()).getByTestId("stage-play-row");
		const player = within(stage()).getByTestId("video-player");
		const clip = player.querySelector("video")!;
		const title = within(player).getByText(FIRST.title);
		expect(row.compareDocumentPosition(clip) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(clip.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(title.getAttribute("style") ?? "").toMatch(/--mantine-font-size-sm/);
		// One title, under the clip: none drawn above it.
		expect(within(player).getAllByText(FIRST.title)).toHaveLength(1);
		expect(clip).toHaveAttribute("controls");
	});
});
