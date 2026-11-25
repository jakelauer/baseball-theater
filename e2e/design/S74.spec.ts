// @bt-targets: web, functions
/**
 * S74's design match (rule 22): offline reading's marker, shell-scoreboard A1 (ratified 2026-10-21)
 * as A13 and A14 (ratified 2026-11-19) leave it, and game-rooms A1 (ratified 2026-10-21).
 *
 * - `scoreboard-offline-mobile`, `-medium`, `-desktop`: the scoreboard signed in, loaded online, then
 *   the browser goes offline (Playwright's `setOffline`, which fires the `offline` event and fails
 *   every request): the day as saved and A1's `notice-banner` under the header, "You're offline.
 *   Scores as of {time} — {age}." with no action and no ✕.
 * - `site-footer-offline-mobile` (A14): the same mobile state, photographed for its footer: the
 *   columns and the copyright line, no offline line, no age, no strip.
 * - `room-offline-mobile`: the Box room of a game opened online (CHC @ MIA, final), then offline:
 *   the marker under the game top bar, "You're offline. This game as of …".
 * - `room-offline-unviewed-mobile`: offline, a game the saved scoreboard lists but nobody opened
 *   online (SF @ NYM): "You're offline." alone over an empty room, the top bar and tabs from the
 *   saved day, no explanation.
 *
 * Every copy was got 18 minutes before the browser goes offline: the page loads on a clock set 18
 * minutes back (Playwright's `clock.install`), which jumps forward to now as it goes offline, so each
 * marker's time is the load's and its age reads 18m (S74 R3: the marker dates the copy by when the
 * page got it, not by the payload's `fetchedAt`).
 * The dev server runs no service worker, so "as saved" here is the copy the page already holds; the
 * worker's stored copies (a reload offline) answer the same page the same way.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"): the
 * footer's "Offline · saved … ago · baseball.theater" line on A1's and game-rooms A1's frames, which
 * A13 and A14 removed (`site-footer-offline-mobile` is the frame that draws it as it now stands);
 * the About, Privacy policy and Terms of use links, which S154 adds with their pages (A14 No dead
 * links); the age's wording comes from `fetchedAgo` ("18m ago", AC 2), where A1's frames read
 * "18 min ago"; the time is the capture's own clock; the day, games and highlights are the
 * fixture's (Sep 5, 2026) versus the frames' Sep 20–21, and the game is the fixture's (CHC @ MIA);
 * the header, rail, cards, rooms and top bar are their own stories'.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

const SCHEDULE = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
const DAY = "/games/2026-09-05";
/** How long before going offline every copy was got: the page's clock starts this far back. */
const AGE_MS = 18 * 60 * 1000;
/** Every payload's own fetch time, the moment the page loads. */
const FETCHED_AT = new Date(Date.now() - AGE_MS).toISOString();

/** 2026-09-05's schedule and the 823823 game, each stamped `FETCHED_AT`. */
async function serve(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			...SCHEDULE,
			fetchedAt: FETCHED_AT,
			windowMode: "cache",
			version: 1,
			lastChangedAt: FETCHED_AT,
		}),
	}));
	await page.route(/\/api\/v1\/games\/823823$/, async (route) =>
	{
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: JSON.stringify({
				...await response.json(),
				fetchedAt: FETCHED_AT,
			}),
		});
	});
}

/** The scoreboard signed in, loaded online (on a clock 18 minutes back), with its highlights. */
async function scoreboard(page: Page): Promise<void>
{
	await page.clock.install({
		time: Date.now() - AGE_MS,
	});
	await serve(page);
	await signInDev(page, DAY);
	await page.getByTestId("scoreboard-module").first().waitFor();
	await page.getByTestId("day-digest").getByTestId("video-card").first().waitFor();
	await page.getByRole("contentinfo").getByRole("link", {
		name: "Your data",
	}).waitFor();
}

/** The browser drops off the network and the clock reaches now, 18 minutes on; waits for the marker. */
async function goOffline(page: Page, words: string): Promise<void>
{
	await page.context().setOffline(true);
	await page.clock.fastForward(AGE_MS);
	await page.getByTestId("notice-slot").getByText(words).waitFor();
	await page.getByTestId("notice-slot").getByText("— 18m ago.", {
		exact: false,
	}).waitFor();
}

const offlineScoreboard = async (page: Page) =>
{
	await scoreboard(page);
	await goOffline(page, "You're offline. Scores as of");
};

const FRAMES: [string, (page: Page) => Promise<void>][] = [
	["scoreboard-offline-mobile", offlineScoreboard],
	["scoreboard-offline-medium", offlineScoreboard],
	["scoreboard-offline-desktop", offlineScoreboard],
	["site-footer-offline-mobile", offlineScoreboard],
	["room-offline-mobile", async (page) =>
	{
		await scoreboard(page);
		await page.goto("/game/823823/box");
		await page.getByTestId("game-topbar").waitFor();
		await page.getByRole("table", {
			name: "Linescore",
		}).waitFor();
		await goOffline(page, "You're offline. This game as of");
	}],
	["room-offline-unviewed-mobile", async (page) =>
	{
		await scoreboard(page);
		// The game page is its own chunk (S110), which the dev server (no worker to precache it) can't
		// send offline: open another game online first, so the chunk is loaded, then come back.
		await page.getByRole("link", {
			name: /Cubs|CHC/,
		}).first().click();
		await page.getByTestId("game-topbar").waitFor();
		await page.getByRole("link", {
			name: "Back to scoreboard",
		}).click();
		await page.getByTestId("scoreboard-module").first().waitFor();
		await page.context().setOffline(true);
		await page.getByTestId("notice-slot").waitFor();
		// SF @ NYM, the day's first game, never opened online; a link, so the app moves without a reload.
		await page.getByTestId("scoreboard-module").first().getByRole("link").first().click();
		await page.getByTestId("game-topbar").waitFor();
		await page.getByTestId("notice-slot").getByText("You're offline.", {
			exact: true,
		}).waitFor();
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
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
