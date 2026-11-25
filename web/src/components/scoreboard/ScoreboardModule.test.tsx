/**
 * S171: the scheduled scoreboard row as shell-scoreboard A16 draws it — no slot box with
 * Status, each probable pitcher beside his team (`J. Steele (L)` over `11-5, 3.12`), the
 * Room Menu box kept, and the box's space left empty. Over the recorded 2026-09-05 day,
 * whose 15 games are all final: one game (Braves @ Phillies, Martín Pérez left-handed,
 * Zack Wheeler right-handed) is set to pre-game here, MLB's `P` "Pre-Game" from
 * `fixtures/raw/gamestatus.json`, keeping its recorded probables and their hands.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameRowSlot as Setting } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import {
	resetSettings, setGameRowSlot, setHideScores,
} from "../../settings/store.js";
import { clearPersonalData } from "../../storage/storage.js";
import { SCHEDULED_GRID, ScoreboardModule } from "./ScoreboardModule.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const SCHEDULE = JSON.parse(readFileSync(join(FIXTURES, "schedule-2026-09-05.json"), "utf8")) as ScheduleDayPayload;
const PRE_GAME = (JSON.parse(readFileSync(join(FIXTURES, "raw/gamestatus.json"), "utf8")) as { statusCode: string;
	abstractGameState: string;
	codedGameState: string;
	detailedState: string; }[]).find((s) => s.statusCode === "P")!;

/** Braves @ Phillies from the recording, before first pitch. */
function scheduled(): ScoreboardGame
{
	const game = SCHEDULE.games.find((g) => g.gamePk === 823419)!;
	return {
		...game,
		status: {
			abstractGameState: PRE_GAME.abstractGameState,
			codedGameState: PRE_GAME.codedGameState,
			detailedState: PRE_GAME.detailedState,
		},
		linescore: null,
		decisions: null,
		live: null,
	};
}

function renderRow(game: ScoreboardGame)
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<ScoreboardModule game={game} />
			</MemoryRouter>
		</MantineProvider>,
	);
	return screen.getByTestId("scoreboard-module");
}

/** Each side's probable cell, away first, as its two lines of text. */
function probables(card: HTMLElement): string[][]
{
	return within(card).getAllByTestId("row-probable").map((cell) => [...cell.querySelectorAll("p")].map((p) => p.textContent ?? ""));
}

beforeEach(() =>
{
	// Settings changes save to the account; offline here, so the local change stands.
	vi.stubGlobal("fetch", vi.fn(async () =>
	{
		throw new Error("offline");
	}));
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	resetSettings();
	clearPersonalData();
});

describe("the scheduled row (S171, shell-scoreboard A16)", () =>
{
	it("S171 AC 4 Status: no slot box; each probable beside his team, label over season line", () =>
	{
		const game = scheduled();
		expect(game.probablePitchers?.away?.pitchHand).toBe("L");
		const card = renderRow(game);
		expect(card).toHaveAttribute("data-phase", "pregame");
		expect(within(card).queryByTestId("game-row-slot")).toBeNull();
		expect(probables(card)).toEqual([["M. Pérez (L)", "8-9, 3.25"], ["Z. Wheeler (R)", "12-5, 3.23"]]);
		// Each probable sits in the row's body beside his team: the same link, right after the team's cell.
		const link = within(card).getByRole("link");
		const teams = within(link).getAllByTestId("team-row");
		const cells = within(link).getAllByTestId("row-probable");
		teams.forEach((team, i) => expect(team.nextElementSibling).toBe(cells[i]));
		// …in a two-column grid, team then probable, so each pitcher is beside his team, not under it.
		expect(SCHEDULED_GRID.match(/minmax\(/g)).toHaveLength(2);
		expect(link.style.gridTemplateColumns).toBe(SCHEDULED_GRID);
	});

	it("S171 AC 4 Status: the card's accessible name carries the probables, which its label would otherwise hide", () =>
	{
		const card = renderRow(scheduled());
		expect(within(card).getByRole("link", {
			name: "Braves at Phillies, probable pitchers M. Pérez, left-handed, and Z. Wheeler, right-handed",
		})).toBeInTheDocument();
	});

	it("S171 AC 4 TBD: a side with no probable is spoken as to be announced; no probables at all leaves the matchup", () =>
	{
		const game = scheduled();
		renderRow({
			...game,
			probablePitchers: {
				away: null,
				home: game.probablePitchers!.home,
			},
		});
		expect(screen.getByRole("link", {
			name: "Braves at Phillies, probable pitchers to be announced, and Z. Wheeler, right-handed",
		})).toBeInTheDocument();
		cleanup();
		renderRow({
			...game,
			probablePitchers: {
				away: null,
				home: null,
			},
		});
		expect(screen.getByRole("link", {
			name: "Braves at Phillies",
		})).toBeInTheDocument();
	});

	it.each(["status", "roomMenu"] as Setting[])("S171 AC 4 Status / Room Menu both draw the probables in the body (%s)", async (setting) =>
	{
		await setGameRowSlot(setting);
		const card = renderRow(scheduled());
		expect(probables(card).map(([name]) => name)).toEqual(["M. Pérez (L)", "Z. Wheeler (R)"]);
	});

	it("S171 AC 4 Room Menu: the box shows Videos, Plays and Box, and no Recap", async () =>
	{
		await setGameRowSlot("roomMenu");
		const card = renderRow(scheduled());
		const slot = within(card).getByTestId("game-row-slot");
		expect(slot).toHaveAttribute("data-occupant", "roomMenu");
		expect(within(slot).getAllByRole("link").map((l) => l.textContent)).toEqual(["Videos", "Plays", "Box"]);
		expect(within(slot).queryByText("Recap")).toBeNull();
	});

	it("S171 AC 4 TBD: a side MLB names no probable for reads TBD", () =>
	{
		const game = scheduled();
		const card = renderRow({
			...game,
			probablePitchers: {
				away: game.probablePitchers!.away,
				home: null,
			},
		});
		expect(probables(card)).toEqual([["M. Pérez (L)", "8-9, 3.25"], ["TBD"]]);
	});

	it("S171 AC 4 no hand: a pitcher MLB sent no hand for reads without a suffix", () =>
	{
		const game = scheduled();
		const card = renderRow({
			...game,
			probablePitchers: {
				away: {
					...game.probablePitchers!.away!,
					pitchHand: null,
				},
				home: game.probablePitchers!.home,
			},
		});
		expect(probables(card).map(([name]) => name)).toEqual(["M. Pérez", "Z. Wheeler (R)"]);
	});

	it("S171 AC 4 width: the left area keeps its width with and without the box; the box's space stays empty", async () =>
	{
		const statusCard = renderRow(scheduled());
		const statusLink = within(statusCard).getByRole("link");
		const space = within(statusCard).getByTestId("game-row-slot-space");
		expect(space).toBeEmptyDOMElement();
		expect(space).toHaveAttribute("aria-hidden", "true");
		const [statusArea, spaceWidth] = [statusLink.style.cssText, space.style.width];
		cleanup();

		await setGameRowSlot("roomMenu");
		const menuCard = renderRow(scheduled());
		const menuLink = within(menuCard).getAllByRole("link")[0]!;
		expect(menuLink).toHaveClass("bt-card-link");
		expect(within(menuCard).queryByTestId("game-row-slot-space")).toBeNull();
		expect(menuLink.style.cssText).toBe(statusArea);
		expect(within(menuCard).getByTestId("game-row-slot").style.width).toBe(spaceWidth);
		expect(spaceWidth).not.toBe("");
	});

	it("S171 AC 5: Hide Scores leaves the probables and their lines as they are", async () =>
	{
		await setHideScores(true);
		const card = renderRow(scheduled());
		expect(within(card).getByText((_, el) => el?.textContent === "ATL (▒▒-▒▒)" && el.tagName === "P")).toBeInTheDocument();
		expect(probables(card)).toEqual([["M. Pérez (L)", "8-9, 3.25"], ["Z. Wheeler (R)", "12-5, 3.23"]]);
	});
});

describe("ScoreboardModule's game id", () =>
{
	// The design capture specs find a game by this attribute, not by its place in the scoreboard's order (S218).
	it("S218 AC 1: a module rendered for a fixture game carries its gamePk", () =>
	{
		expect(renderRow(scheduled()).dataset.gamePk).toBe("823419");
		cleanup();
		const final = SCHEDULE.games.find((g) => g.gamePk === 823577)!;
		expect(renderRow(final).dataset.gamePk).toBe("823577");
	});
});
