// @bt-targets: web, functions
/**
 * S171's design match (rule 22): shell-scoreboard A16's `scoreboard-scheduled-row-mobile`
 * and `scoreboard-scheduled-row-desktop` (desktop at 1200px, owner 2026-10-28: "Capture at
 * 1200px") — one scheduled row with the default Status setting: no slot box, each probable
 * pitcher beside his team with his throwing hand over his season line, the box's space
 * left empty. The day is the recorded 2026-09-05 schedule cut to one game, Braves @
 * Phillies, set to pre-game (MLB's `P` "Pre-Game"), keeping its recorded probables
 * (Martín Pérez, left-handed; Zack Wheeler, right-handed).
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own
 * parts"): the frames draw the row alone on the scoreboard's ground, the capture is the
 * whole scoreboard page around it (header, date control, footer); the frames' sample game
 * (Cubs @ Brewers, `J. Steele (L)`, `F. Peralta (R)`) versus the fixture's; the start time
 * is shown in the viewer's zone; the team edges are the fixture teams' colors.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const SCHEDULE = read("schedule-2026-09-05.json");
const PRE_GAME = (read("raw/gamestatus.json") as { statusCode: string;
	abstractGameState: string;
	codedGameState: string;
	detailedState: string; }[]).find((s) => s.statusCode === "P")!;
const GAME = SCHEDULE.games.find((g: { gamePk: number }) => g.gamePk === 823419);

const DAY = {
	...SCHEDULE,
	games: [{
		...GAME,
		status: {
			abstractGameState: PRE_GAME.abstractGameState,
			codedGameState: PRE_GAME.codedGameState,
			detailedState: PRE_GAME.detailedState,
		},
		linescore: null,
		decisions: null,
		live: null,
	}],
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

async function scheduledRow(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(DAY),
	}));
	await page.goto("/games/2026-09-05");
	await page.getByTestId("row-probable").first().waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

for (const frame of ["scoreboard-scheduled-row-mobile", "scoreboard-scheduled-row-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await scheduledRow(page);
		await capture(page, testInfo, frame);
	});
}
