// @bt-targets: web, functions
/**
 * S142's design match (rule 22): shell-scoreboard A14's site footer (ratified 2026-11-19), the
 * footer of links the shell draws after every page's content.
 *
 * - `site-footer-mobile`, `-medium`, `-desktop`: the scoreboard signed in, the footer under the
 *   day's highlights. 2026-09-05's schedule and highlights (the fixtures), served from the cache.
 * - `site-footer-game-mobile`: a live game's Live room with its WebSocket open, as S148's spec
 *   opens it: `fixtures/game-823823-live.json` in its window, the live route answered by
 *   Playwright's WebSocket stand-in. The footer opens with A13's strip.
 * - `site-footer-short-desktop`: a page shorter than the screen, no socket: the same day with its
 *   first game alone (SF @ NYM, final) and its highlights left out (the digest answered empty), so
 *   the footer follows the card and the leftover height is empty below it.
 * - `site-footer-standalone-mobile`: `site-footer-mobile` in the installed app: Chromium told the
 *   display mode is standalone the way `S73.spec.ts` does (DevTools protocol).
 * - `site-footer-signed-out-mobile`: `site-footer-mobile` signed out: no "Your data", the "Legal"
 *   heading alone until S154.
 *
 * Reduced motion is emulated, so the strip's dot holds at `Phase=Bright` as the frames draw it.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"):
 * the About, Privacy policy and Terms of use links, which S154 adds with their pages (A14 No dead
 * links), so signed out the "Legal" column is its heading alone (owner, 2026-11-19: "Heading
 * alone"); the strip on the scoreboard frames, since the scoreboard opens no socket until S149's
 * `useLiveDay` (as S148 AC 6); the day, games and highlights are the fixture's (Sep 5, 2026)
 * versus the frames' Sep 20–21, 2026, and the game is the fixture's (CHC @ MIA, Top 3rd); the
 * header, rail, cards and top bar are their own stories'. `site-footer-offline-mobile` is S74's.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev, stubApi,
} from "./helpers.js";

const SCHEDULE = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
const LIVE = JSON.parse(readFileSync(new URL("../../fixtures/game-823823-live.json", import.meta.url), "utf8"));
const DAY = "/games/2026-09-05";

/** 2026-09-05's schedule from the cache, with only `games` when given (the short page's one final). */
async function schedule(page: Page, games?: unknown[]): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			...SCHEDULE,
			games: games ?? SCHEDULE.games,
			fetchedAt: new Date().toISOString(),
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2026-09-05T20:57:20.000Z",
		}),
	}));
}

/** Waits for fonts and hides the dev sign-in control, then photographs `frame`. */
async function settle(page: Page, testInfo: Parameters<typeof capture>[1], frame: string): Promise<void>
{
	await page.getByRole("contentinfo").waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
	await capture(page, testInfo, frame);
}

/** The scoreboard day with its highlights, signed in unless `signedOut`. */
async function scoreboard(page: Page, signedOut = false): Promise<void>
{
	await schedule(page);
	if (signedOut) await page.goto(DAY);
	else await signInDev(page, DAY);
	await page.getByTestId("scoreboard-module").first().waitFor();
	await page.getByTestId("digest-item").first().waitFor();
	if (!signedOut)
	{
		await page.getByRole("contentinfo").getByRole("link", {
			name: "Your data",
		}).waitFor();
	}
}

const FRAMES: [string, (page: Page) => Promise<void>][] = [
	["site-footer-mobile", (page) => scoreboard(page)],
	["site-footer-medium", (page) => scoreboard(page)],
	["site-footer-desktop", (page) => scoreboard(page)],
	["site-footer-signed-out-mobile", (page) => scoreboard(page, true)],
	["site-footer-standalone-mobile", async (page) =>
	{
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{
				name: "display-mode",
				value: "standalone",
			}],
		});
		await scoreboard(page);
	}],
	["site-footer-short-desktop", async (page) =>
	{
		await schedule(page, [SCHEDULE.games[0]]);
		await page.route(/\/api\/v1\/digest\?/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				date: "2026-09-05",
				items: [],
				windowMode: "cache",
			}),
		}));
		await signInDev(page, DAY);
		await page.getByTestId("scoreboard-module").first().waitFor();
		await page.getByRole("contentinfo").getByRole("link", {
			name: "Your data",
		}).waitFor();
	}],
	["site-footer-game-mobile", async (page) =>
	{
		const highlights = (await (await page.request.get("/api/v1/games/823823")).json()).highlights;
		const served = (version: number) => ({
			...LIVE,
			highlights,
			fetchedAt: new Date().toISOString(),
			windowMode: "active",
			version,
			lastChangedAt: "2026-09-05T20:57:20.000Z",
		});
		await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
		{
			socket.send(JSON.stringify(served(2)));
		});
		await stubApi(page, "/api/v1/games/823823", 200, served(1));
		// The game route draws the game top bar, not the header's "Sign in": sign in on the scoreboard first.
		await signInDev(page, DAY);
		await page.goto("/game/823823/live");
		await page.getByTestId("matchup-cards").first().waitFor();
		await page.getByTestId("footer-live-strip").waitFor();
	}],
];

for (const [frame, reach] of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		await reach(page);
		await settle(page, testInfo, frame);
	});
}
