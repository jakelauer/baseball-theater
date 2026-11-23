// @bt-targets: web, functions
/**
 * S170's design match (rule 22): game-shell A7's game status marker (ratified 2026-11-22), at
 * mobile and desktop (desktop at 1200px, owner 2026-10-28: "Capture at 1200px").
 * `status-marker-game-<state>-*`: the recorded live game `fixtures/game-823823-live.json` (CHC @
 * MIA) served in a recorded status from MLB's list, `fixtures/raw/gamestatus.json`: `I` "In
 * Progress" (live), `IR` "Delayed: Rain" (delayed) and `TR` "Suspended: Rain" (suspended) on its
 * Live room, and `PR` "Delayed Start: Rain" before first pitch on its Videos room (the pre-game
 * tabs, no Live room). `status-marker-scoreboard-*`: the recorded 2026-09-05 day cut to four
 * games, as A7 draws them: SF @ NYM suspended (`TR`), CHC @ MIA in progress in the bottom of the
 * 7th (`I`), ATL @ PHI in a rain delay in the bottom of the 3rd (`IR`) and DET @ CLE with its start
 * delayed by rain (`PR`), a scheduled row.
 *
 * Reduced motion is emulated, so the live dot holds still (it blinks otherwise, and two captures
 * would differ). Games are served from the cache (no live socket), so no footer strip shows.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"): the
 * video grid of the desktop delayed-start frame (a copy of a final game's Videos room, which A7
 * says it doesn't ratify), and anything outside the top bar and the scoreboard rows, which covers
 * pieces other stories change or have yet to build (S149's footer strip, A13's "Live Data ·
 * Active" line, the rooms' content); the fixture's teams, innings, scores and day (CHC @ MIA,
 * Sep 5, 2026) versus the frames' sample games (NYY @ BOS, Sep 21, 2026).
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, stubApi,
} from "./helpers.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
const ROWS = read("raw/gamestatus.json") as { statusCode: string;
	abstractGameState: string;
	codedGameState: string;
	detailedState: string; }[];
const LIVE = read("game-823823-live.json");
const SCHEDULE = read("schedule-2026-09-05.json");

/** The recorded status for an MLB status code, as a game carries it. */
function status(code: string)
{
	const row = ROWS.find((r) => r.statusCode === code)!;
	return {
		abstractGameState: row.abstractGameState,
		codedGameState: row.codedGameState,
		detailedState: row.detailedState,
	};
}

const served = {
	fetchedAt: new Date().toISOString(),
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

async function settle(page: Page): Promise<void>
{
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const GAME_STATES: [string, string, string][] = [
	["live", "I", "live"],
	["delayed", "IR", "live"],
	["suspended", "TR", "live"],
	["delayed-start", "PR", "videos"],
];

for (const pairing of ["mobile", "desktop"] as const)
{
	for (const [state, code, room] of GAME_STATES)
	{
		const frame = `status-marker-game-${state}-${pairing}`;
		test(frame, async ({ page }, testInfo) =>
		{
			test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
			await page.emulateMedia({
				reducedMotion: "reduce",
			});
			const pregame = room === "videos";
			await stubApi(page, "/api/v1/games/823823", 200, {
				...LIVE,
				...served,
				status: status(code),
				...(pregame ? {
					linescore: null,
					plays: [],
					live: null,
				} : {}),
			});
			await page.goto(`/game/823823/${room}`);
			await page.getByTestId("game-topbar").getByTestId("status-marker").waitFor();
			if (!pregame) await page.getByTestId("matchup-cards").first().waitFor();
			await settle(page);
			await capture(page, testInfo, frame);
		});
	}

	const frame = `status-marker-scoreboard-${pairing}`;
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		const pick = (gamePk: number) => SCHEDULE.games.find((g: { gamePk: number }) => g.gamePk === gamePk);
		const inGame = (gamePk: number, code: string, inning: number) =>
		{
			const game = pick(gamePk);
			return {
				...game,
				status: status(code),
				linescore: {
					...game.linescore,
					currentInning: inning,
					inningState: "Bottom",
					isTopInning: false,
				},
				decisions: null,
			};
		};
		const games = [
			{
				...pick(823577),
				status: status("TR"),
				decisions: null,
			},
			inGame(823823, "I", 7),
			inGame(823419, "IR", 3),
			{
				...pick(824389),
				status: status("PR"),
				linescore: null,
				decisions: null,
				live: null,
			},
		];
		await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				...SCHEDULE,
				games,
				...served,
			}),
		}));
		await page.goto("/games/2026-09-05");
		await page.getByTestId("scoreboard-module").nth(3).waitFor();
		await settle(page);
		await capture(page, testInfo, frame);
	});
}
