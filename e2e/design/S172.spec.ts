// @bt-targets: web, functions
/**
 * S172's design match (rule 22): the stage-mode player's inning row in standings-search-settings
 * A10's frames — `video-player-stage-pill-mobile` / `-medium` (a clip with a play: the `Top 6 →`
 * pill alone on a row above the video, left-aligned with it) and `video-player-stage-pill-noplay-
 * mobile` / `-medium` (a clip with no play: no pill, no row, as game-shell's stage frame draws it)
 * — on 823823 (CHC @ MIA), Stage chosen in Settings. The pill frames show the room's first clip
 * waiting (Griffin Conine's home run, bottom of the 5th, so `Bot 5 →`); the no-play frames choose
 * the game's condensed game, a clip with no play.
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"): the
 * frames' sample clip (Judge, NYY @ BOS, Top 6, paused at 0:12 of 0:48) versus the fixture's, so
 * the pill's words, the still, title and time differ (the capture rests on its poster at 0:00);
 * the clip keeps its 16:9 shape at medium (S70's match); below the stage, the Videos room is
 * S69's; the top bar and tabs are S40's and S60's; the footer's "Fetched … ago" is the real time.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

async function stage(page: Page, play: boolean): Promise<void>
{
	await page.route(/\/api\/v1\/me\/settings$/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			favoriteTeamIds: [],
			opensFirst: "videos",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "stage",
			version: 1,
		}),
	}));
	// Captures are stills: keep the clip from loading so it rests on its poster at 0:00.
	await page.route(/\.mp4(\?|$)/, (route) => route.abort());
	// The game page has the game's own top bar, not the header's Sign in; sign in on the scoreboard first.
	await signInDev(page, "/games/2026-09-05");
	await page.goto("/game/823823/videos");
	await page.getByTestId("videos-grid").first().waitFor();
	const region = page.getByRole("region", {
		name: "Video player",
	});
	await region.waitFor();
	if (play)
	{
		await region.getByTestId("stage-play-link").waitFor();
	}
	else
	{
		// The game's condensed game is a clip with no play.
		await page.getByRole("button", {
			name: /^Play Condensed Game/,
		}).first().click();
		await region.getByTestId("video-player").waitFor();
		await page.waitForTimeout(400);
	}
	await page.waitForLoadState("networkidle");
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
	// Choosing a card scrolls nothing, but start every shot from the top so the stage is in view.
	await page.evaluate(() => window.scrollTo(0, 0));
}

const FRAMES: { frame: string;
	play: boolean; }[] = [
	{
		frame: "video-player-stage-pill-mobile",
		play: true,
	},
	{
		frame: "video-player-stage-pill-noplay-mobile",
		play: false,
	},
	{
		frame: "video-player-stage-pill-medium",
		play: true,
	},
	{
		frame: "video-player-stage-pill-noplay-medium",
		play: false,
	},
];

for (const { frame, play } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await stage(page, play);
		await capture(page, testInfo, frame);
	});
}
