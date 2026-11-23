/**
 * S170 AC 4: the scoreboard row's status marker (game-shell A7) per kind. Over the recorded
 * 2026-09-05 day: Giants @ Mets (final in the recording, put back in the bottom of the 3rd) is
 * set to each in-game status, and Braves @ Phillies to a delayed start, each status a recorded
 * row of MLB's status list, `fixtures/raw/gamestatus.json` (`I`, `IR`, `T`, `TR`, `PR`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import { resetSettings } from "../../settings/store.js";
import { ScoreboardModule } from "./ScoreboardModule.js";
import type { ScoreboardGame } from "./ScoreboardModule.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const SCHEDULE = JSON.parse(readFileSync(join(FIXTURES, "schedule-2026-09-05.json"), "utf8")) as ScheduleDayPayload;
const ROWS = JSON.parse(readFileSync(join(FIXTURES, "raw/gamestatus.json"), "utf8")) as { statusCode: string;
	abstractGameState: string;
	codedGameState: string;
	detailedState: string; }[];

function status(code: string): ScoreboardGame["status"]
{
	const row = ROWS.find((r) => r.statusCode === code)!;
	return {
		abstractGameState: row.abstractGameState,
		codedGameState: row.codedGameState,
		detailedState: row.detailedState,
	};
}

/** Giants @ Mets in the bottom of the 3rd (or with no inning yet), in the given status. */
function inGame(code: string, inning: number | null = 3): ScoreboardGame
{
	const game = SCHEDULE.games.find((g) => g.gamePk === 823577)!;
	return {
		...game,
		status: status(code),
		linescore: {
			...game.linescore!,
			currentInning: inning,
			inningState: inning === null ? null : "Bottom",
			isTopInning: inning === null ? null : false,
		} as ScoreboardGame["linescore"],
	};
}

/** Braves @ Phillies before first pitch, in the given status. */
function preGame(code: string): ScoreboardGame
{
	const game = SCHEDULE.games.find((g) => g.gamePk === 823419)!;
	return {
		...game,
		status: status(code),
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

beforeEach(() =>
{
	vi.stubGlobal("fetch", vi.fn(async () =>
	{
		throw new Error("offline");
	}));
	resetSettings();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

/** A scored row: its R · H · E cells and its slot are there, as on a live row. */
function expectScored(card: HTMLElement)
{
	expect(card).toHaveAttribute("data-phase", "live");
	expect(within(card).getAllByTestId("runs").map((c) => c.textContent)).toEqual(["9", "5"]);
	expect(within(card).getByTestId("game-row-slot")).toBeInTheDocument();
}

describe("ScoreboardModule's status marker (S170)", () =>
{
	it("S170 AC 4 live: I reads the inning, Bot 3, blinking green", () =>
	{
		const card = renderRow(inGame("I"));
		const marker = within(card).getByTestId("status-marker");
		expect(marker).toHaveAttribute("data-kind", "live");
		expect(marker).toHaveTextContent(/^Bot 3$/);
		expectScored(card);
	});

	it("S170 AC 4 delayed: IR keeps its inning, Delayed · Bot 3, with its score and slot", () =>
	{
		const card = renderRow(inGame("IR"));
		const marker = within(card).getByTestId("status-marker");
		expect(marker).toHaveAttribute("data-kind", "delayed");
		expect(marker).toHaveTextContent(/^Delayed · Bot 3$/);
		expectScored(card);
	});

	it("S170 AC 4 delayed no inning: IR with no inning yet reads Delayed", () =>
	{
		const card = renderRow(inGame("IR", null));
		expect(within(card).getByTestId("status-marker")).toHaveTextContent(/^Delayed$/);
	});

	it("S170 AC 4 suspended: TR names the reason, Suspended · Rain, with its score and slot", () =>
	{
		const card = renderRow(inGame("TR"));
		const marker = within(card).getByTestId("status-marker");
		expect(marker).toHaveAttribute("data-kind", "suspended");
		expect(marker).toHaveTextContent(/^Suspended · Rain$/);
		expectScored(card);
	});

	it("S170 AC 4 suspended: T, with no reason, reads Suspended", () =>
	{
		const card = renderRow(inGame("T"));
		expect(within(card).getByTestId("status-marker")).toHaveTextContent(/^Suspended$/);
	});

	it("S170 AC 4 delayed start: PR replaces the start time, Delayed start · Rain · venue, and stays a scheduled row", () =>
	{
		const card = renderRow(preGame("PR"));
		const marker = within(card).getByTestId("status-marker");
		expect(marker).toHaveAttribute("data-kind", "delayedStart");
		expect(marker).toHaveTextContent(/^Delayed start · Rain$/);
		expect(within(card).getByText("· Citizens Bank Park")).toBeInTheDocument();
		expect(marker.parentElement).toHaveTextContent(/^Delayed start · Rain· Citizens Bank Park$/);
		// Still a scheduled row (S171): the probables beside the teams, no score, no slot box with Status.
		expect(card).toHaveAttribute("data-phase", "pregame");
		expect(within(card).getAllByTestId("row-probable")).toHaveLength(2);
		expect(within(card).queryAllByTestId("runs")).toHaveLength(0);
		expect(within(card).queryByTestId("game-row-slot")).toBeNull();
	});

	it("S170 AC 4 delayed start: PO, with no reason, reads Delayed start · venue", () =>
	{
		const card = renderRow(preGame("PO"));
		const marker = within(card).getByTestId("status-marker");
		expect(marker).toHaveTextContent(/^Delayed start$/);
		expect(marker.parentElement).toHaveTextContent(/^Delayed start· Citizens Bank Park$/);
	});

	it("S170 AC 4 delayed start: a plain pre-game P keeps its start time and no marker", () =>
	{
		const card = renderRow(preGame("P"));
		expect(within(card).queryByTestId("status-marker")).toBeNull();
	});
});
