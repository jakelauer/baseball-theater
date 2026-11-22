/**
 * S97 on 823823: a video's play link on its card and in the player (game-shell A5), no play
 * icon on any thumbnail, and the Plays room opened on the play with a `Video:` line above every
 * at-bat that has a clip (game-rooms A6). Rendered through the game page and its routes.
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
import { PlayerDialog } from "./PlayerDialog.js";
import { playInningLink } from "./playLink.js";

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
const atBatOf = (playId: string) => PLAYS.find((a) => a.pitches.some((p) => p.playId === playId))!;
const linked = GAME.highlights.filter((h) => h.playId && atBatOf(h.playId));
const CONINE = GAME.highlights.find((h) => h.title === "Griffin Conine's two-run home run (15)")!;
const conineAtBat = atBatOf(CONINE.playId!);
/** A top-of-the-6th clip on 823823 (Michael Busch's RBI single). */
const BUSCH = GAME.highlights.find((h) => h.title === "Michael Busch's RBI single")!;
// S145 (game-shell A6): the inning pill's words, the half-inning as a number and an arrow.
const conineLabel = `${conineAtBat.about.halfInning === "top" ? "Top" : "Bot"} ${conineAtBat.about.inning} →`;

function Where()
{
	const location = useLocation();
	return <div data-testid="where">{location.pathname + location.search}</div>;
}

async function hideScores(on: boolean): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		...DEFAULT_SETTINGS,
		hideScores: on,
		version: 1,
	}))));
	await hydrateSettings("test-user");
}

/** Renders the game page at `path` and resolves once `ready` (a test id, or the Plays room's inning sidebar) shows. */
async function open(path: string, ready: string): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(GAME))));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<><GamePage variant="mobile" /><Where /></>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	if (ready === "inning-sidebar") await screen.findByRole("navigation", {
		name: "Inning sidebar",
	});
	else await screen.findAllByTestId(ready);
}

afterEach(async () =>
{
	cleanup();
	vi.unstubAllGlobals();
	await resetSettings();
});

describe("video play links (S97)", () =>
{
	it("S97 AC 1: every video with a play gets 'Play · <half> <inning> →' under its meta line, in grid and list; the rest get none", async () =>
	{
		await open("/game/823823/videos", "video-card");
		expect(linked).toHaveLength(20);
		for (const mode of ["Grid", "List"])
		{
			if (mode === "List") fireEvent.click(screen.getByRole("radio", {
				name: "List",
			}));
			const links = screen.getAllByTestId("play-link");
			expect(links).toHaveLength(20);
			const conine = screen.getByRole("button", {
				name: `Play ${CONINE.title}`,
			});
			// S145: the pill on the meta line, the card button's next sibling, not inside it.
			expect(conine.contains(links[0]!)).toBe(false);
			expect(conine.nextElementSibling?.textContent).toBe(conineLabel);
			const recap = GAME.highlights.find((h) => !h.playId)!;
			expect(screen.getAllByRole("button", {
				name: `Play ${recap.title}`,
			})[0]!.nextElementSibling?.getAttribute("data-testid")).not.toBe("play-link");
		}
	});

	it("S97 AC 1: choosing the link opens the play without opening the player", async () =>
	{
		await open("/game/823823/videos", "video-card");
		fireEvent.click(screen.getByRole("button", {
			name: `Play ${CONINE.title}`,
		}).nextElementSibling!);
		await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("S97 AC 2: the floating player shows the play link top left; choosing it closes the player and opens the play", async () =>
	{
		await open("/game/823823/videos", "video-card");
		fireEvent.click(screen.getByRole("button", {
			name: `Play ${CONINE.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		const link = await within(dialog).findByTestId("player-play-link");
		expect(link.textContent).toBe(conineLabel);
		expect(within(dialog).queryByText(/Go to game/)).toBeNull();
		fireEvent.click(link);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("where").textContent).toBe(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`);
	});

	it.each([false, true])("S97 AC 3: no thumbnail has a play icon and each keeps its duration, grid and list (Hide Scores %s)", async (hidden) =>
	{
		if (hidden) await hideScores(true);
		await open("/game/823823/videos", "video-card");
		for (const mode of ["Grid", "List"])
		{
			if (mode === "List") fireEvent.click(screen.getByRole("radio", {
				name: "List",
			}));
			const cards = screen.getAllByTestId("video-card");
			expect(cards.length).toBe(GAME.highlights.length);
			for (const card of cards) expect(card.querySelector(".tabler-icon-player-play, .tabler-icon")).toBeNull();
			expect(screen.getAllByTestId("video-duration").length).toBe(GAME.highlights.filter((h) => h.duration).length);
		}
	});

	it("S97 AC 4: ?play= chooses the play's inning, opens and marks its at-bat, and scrolls it into view", async () =>
	{
		const scrolled = vi.fn();
		Element.prototype.scrollIntoView = scrolled;
		await open(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`, "inning-sidebar");
		const nav = screen.getByRole("navigation", {
			name: "Inning sidebar",
		});
		expect(within(nav).getByRole("button", {
			name: String(conineAtBat.about.inning),
		})).toHaveAttribute("aria-current", "true");
		const item = document.getElementById(`at-bat-${conineAtBat.about.atBatIndex}`)!;
		expect(item).toHaveAttribute("data-marked", "true");
		expect(item.getAttribute("style") ?? "").toMatch(/border-left: 3px solid/);
		// Its own accordion control (the first button in it) is the expanded one.
		expect(within(item).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
		expect(document.querySelectorAll("[data-marked]")).toHaveLength(1);
		await waitFor(() => expect(scrolled).toHaveBeenCalled());
		expect(scrolled.mock.contexts[0]).toBe(item);
	});

	it("S97 AC 4: an unknown play opens the room as usual", async () =>
	{
		await open("/game/823823/plays?play=not-a-pitch", "inning-sidebar");
		const nav = screen.getByRole("navigation", {
			name: "Inning sidebar",
		});
		expect(within(nav).getByRole("button", {
			name: "9",
		})).toHaveAttribute("aria-current", "true");
		expect(document.querySelectorAll("[data-marked]")).toHaveLength(0);
	});

	it("S97 AC 5: 'Video: <clip title>' above every at-bat with a clip, one per at-bat, with or without ?play=", async () =>
	{
		const byAtBat = new Map<number, string>();
		for (const h of linked)
		{
			const index = atBatOf(h.playId!).about.atBatIndex;
			if (!byAtBat.has(index)) byAtBat.set(index, h.title);
		}
		await open("/game/823823/plays", "inning-sidebar");
		const nav = screen.getByRole("navigation", {
			name: "Inning sidebar",
		});
		let total = 0;
		for (const inning of new Set(PLAYS.map((a) => a.about.inning)))
		{
			fireEvent.click(within(nav).getByRole("button", {
				name: String(inning),
			}));
			const lines = screen.queryAllByTestId("video-line");
			// In game order, as the room lists its at-bats.
			const want = [...byAtBat].filter(([index]) => PLAYS.find((a) => a.about.atBatIndex === index)!.about.inning === inning).sort(([a], [b]) => a - b);
			expect(lines.map((l) => l.textContent), `inning ${inning}`).toEqual(want.map(([, title]) => `Video: ${title}`));
			for (const [index] of want)
			{
				// The line sits right above its at-bat.
				expect(lines.find((l) => l.nextElementSibling?.id === `at-bat-${index}`)).toBeTruthy();
			}
			total += lines.length;
		}
		expect(total).toBe(byAtBat.size);
		expect(total).toBeGreaterThan(0);
		expect(total).toBeLessThanOrEqual(20);
	});
});

describe("the inning pill in the player and on the game page's cards (S145)", () =>
{
	it("S145 AC 1: on the game page a top-of-the-6th clip's card and player pill are named 'Open play - Top of 6th inning' and read Top 6 →", async () =>
	{
		expect(atBatOf(BUSCH.playId!).about).toMatchObject({
			halfInning: "top",
			inning: 6,
		});
		await open("/game/823823/videos", "video-card");
		const card = screen.getByRole("button", {
			name: `Play ${BUSCH.title}`,
		});
		const pill = within(card.parentElement!).getByRole("link", {
			name: "Open play - Top of 6th inning",
		});
		expect(pill.textContent).toBe("Top 6 →");
		fireEvent.click(card);
		const dialog = await screen.findByRole("dialog");
		expect((await within(dialog).findByRole("link", {
			name: "Open play - Top of 6th inning",
		})).textContent).toBe("Top 6 →");
	});

	it("S145 AC 1: the player's pill for a bottom-of-the-3rd play reads Bot 3 → and is named 'Open play - Bottom of 3rd inning'", () =>
	{
		render(
			<MantineProvider>
				<MemoryRouter>
					<PlayerDialog video={BUSCH} onClose={() => undefined} fromGamePk={823823} playLink={playInningLink({
						gamePk: 823823,
						playId: "p",
						halfInning: "bottom",
						inning: 3,
					})}
					/>
				</MemoryRouter>
			</MantineProvider>,
		);
		const pill = within(screen.getByRole("dialog")).getByRole("link", {
			name: "Open play - Bottom of 3rd inning",
		});
		expect(pill.textContent).toBe("Bot 3 →");
		expect(pill.getAttribute("href")).toBe("/game/823823/plays?play=p");
	});

	it("S145 AC 4: the floating player shows the pill in place of the play link; choosing it closes the player and opens the play", async () =>
	{
		await open("/game/823823/videos", "video-card");
		fireEvent.click(screen.getByRole("button", {
			name: `Play ${CONINE.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		// Conine's home run came in the bottom of the 5th.
		expect(conineAtBat.about).toMatchObject({
			halfInning: "bottom",
			inning: 5,
		});
		const pill = await within(dialog).findByRole("link", {
			name: "Open play - Bottom of 5th inning",
		});
		expect(pill.textContent).toBe("Bot 5 →");
		expect(pill.className).toMatch(/\bbt-play-pill\b/);
		expect(pill.getAttribute("href")).toBe(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`);
		expect(within(dialog).queryByText(/Play ·/)).toBeNull();
		fireEvent.click(pill);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByTestId("where").textContent).toBe(`/game/823823/plays?play=${encodeURIComponent(CONINE.playId!)}`);
	});
});
