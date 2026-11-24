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
 * The `long reason …` tests capture nothing: they check, at phone widths, the owner's rule for a
 * reason longer than A7's "Rain" (2026-11-23: "It should wrap up to two lines and the space that
 * takes should expand to accompany it"; the venue "Its own line below (Recommended)"), over MLB's
 * recorded `TI` "Suspended: Inclement Weather" and `PI` "Delayed Start: Inclement Weather". CI runs
 * no design spec, so they are a manual check (`pnpm e2e:design design/S170.spec.ts --project mobile`).
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"): the
 * video grid of the desktop delayed-start frame (a copy of a final game's Videos room, which A7
 * says it doesn't ratify), and anything outside the top bar and the scoreboard rows, which covers
 * pieces other stories change or have yet to build (S149's footer strip, A13's "Live Data ·
 * Active" line, the rooms' content); the fixture's teams, innings, scores and day (CHC @ MIA,
 * Sep 5, 2026) versus the frames' sample games (NYY @ BOS, Sep 21, 2026).
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
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

/** Where a long reason must stay, measured in the page: each value is a pixel overrun, 0 when it fits. */
interface Fit
{
	text: string;
	lines: number;
	pastCard: number;
	pastHeads: number;
	pastLine: number;
}

/**
 * How a row's or the top bar's status marker sits: its label's text and line count, and how far it
 * runs past the card link, under the R \u00b7 H \u00b7 E heads (a scored row) and past its own box.
 */
async function fit(page: Page, scope: string): Promise<Fit>
{
	return page.locator(scope).evaluate((root) =>
	{
		const marker = root.querySelector<HTMLElement>("[data-testid=status-marker]")!;
		const label = marker.lastElementChild as HTMLElement;
		const box = label.getBoundingClientRect();
		const link = root.querySelector(".bt-card-link") ?? root;
		const head = [...link.querySelectorAll("span")].find((s) => s.textContent === "R");
		const over = (a: number, b: number) => Math.max(0, Math.round(a - b));
		return {
			text: label.textContent ?? "",
			lines: Math.round(box.height / parseFloat(getComputedStyle(label).lineHeight)),
			pastCard: over(box.right, link.getBoundingClientRect().right),
			pastHeads: head ? over(box.right, head.getBoundingClientRect().left) : 0,
			pastLine: over(label.scrollWidth, label.clientWidth),
		};
	});
}

for (const width of [390, 375, 360])
{
	test(`long reason on a scoreboard row at ${width}px wraps to two lines inside its row`, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== "mobile", "a phone check");
		await page.setViewportSize({
			width,
			height: 844,
		});
		const pick = (gamePk: number) => SCHEDULE.games.find((g: { gamePk: number }) => g.gamePk === gamePk);
		const games = [
			{
				...pick(823577),
				status: status("TI"),
				decisions: null,
			},
			{
				...pick(824389),
				status: status("PI"),
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
		await page.getByTestId("scoreboard-module").nth(1).waitFor();
		await settle(page);
		const suspended = await fit(page, "[data-testid=scoreboard-module] >> nth=0");
		const delayed = await fit(page, "[data-testid=scoreboard-module] >> nth=1");
		expect(suspended).toMatchObject({
			text: "Suspended \u00b7 Inclement Weather",
			pastCard: 0,
			pastHeads: 0,
			pastLine: 0,
		});
		expect(delayed).toMatchObject({
			text: "Delayed start \u00b7 Inclement Weather",
			pastCard: 0,
			pastLine: 0,
		});
		for (const marker of [suspended, delayed]) expect(marker.lines).toBeLessThanOrEqual(2);
		// The venue isn't squeezed out: it keeps its whole line below the wrapped reason, inside the card.
		const venue = await page.getByTestId("scoreboard-module").nth(1).evaluate((root) =>
		{
			const marker = root.querySelector("[data-testid=status-marker]")!.getBoundingClientRect();
			const name = [...root.querySelectorAll("p")].find((p) => p.textContent?.startsWith("\u00b7 "))!.getBoundingClientRect();
			return {
				width: Math.round(name.width),
				below: name.top >= marker.bottom - 1,
				inside: name.right <= root.querySelector(".bt-card-link")!.getBoundingClientRect().right + 0.5,
			};
		});
		expect(venue.width).toBeGreaterThan(0);
		expect(venue.below).toBe(true);
		expect(venue.inside).toBe(true);
	});
}

for (const width of [390, 375, 360, 320])
{
	test(`long reason in the game top bar at ${width}px wraps under the teams and keeps the date`, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== "mobile", "a phone check");
		await page.setViewportSize({
			width,
			height: 844,
		});
		await stubApi(page, "/api/v1/games/823823", 200, {
			...LIVE,
			...served,
			status: status("PI"),
			linescore: null,
			plays: [],
			live: null,
		});
		await page.goto("/game/823823/videos");
		await page.getByTestId("game-topbar").getByTestId("status-marker").waitFor();
		await settle(page);
		const bar = await page.getByTestId("game-topbar").evaluate((header) =>
		{
			const line = header.querySelector("[data-testid=status-line]")!.getBoundingClientRect();
			const date = header.lastElementChild as HTMLElement;
			return {
				overflow: Math.max(0, header.scrollWidth - header.clientWidth),
				intoDate: Math.max(0, Math.round(line.right - date.getBoundingClientRect().left)),
				dateClipped: date.scrollWidth > date.clientWidth,
			};
		});
		expect(bar).toEqual({
			overflow: 0,
			intoDate: 0,
			dateClipped: false,
		});
		const marker = await fit(page, "[data-testid=game-topbar]");
		expect(marker).toMatchObject({
			text: "Delayed start \u00b7 Inclement Weather",
			pastLine: 0,
		});
		expect(marker.lines).toBeLessThanOrEqual(2);
	});
}
