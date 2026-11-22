// @bt-targets: web, functions
/**
 * S145's design match (rule 22): a video's play link as the inning pill after the date —
 * game-shell A6's `game-videos-{grid,list}-playmeta-*` and `video-player-dialog-playmeta-*`
 * (desktop at 1200px, owner 2026-10-28; A6's `search-playmeta-*` frames are S153's). The page
 * reads the fixture API (`pnpm dev`) for 823823, the final game, as S97's spec does.
 *
 * Judge only S145's parts (owner, 2026-10-28: "Judge only the story's own parts"): each linked
 * clip's meta line reading its date then the `Top 6 →` pill (no kind word, no line under the
 * card), in grid and list; a clip with no play keeping `Highlight · <date>`; the pill at top left
 * of the player. Expected differences are earlier stories' (the fixture's CHC @ MIA clips and
 * innings versus the frames' NYY @ BOS; which clips have plays), A6's desktop grid frame drawing
 * no duration badge though A6 keeps it, and the site footer (S142's).
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

const GAME = JSON.parse(readFileSync(new URL("../../fixtures/game-823823.json", import.meta.url), "utf8"));
/** The clip the player frames open: Griffin Conine's two-run home run. */
const CONINE = (GAME.highlights as { title: string;
	playId: string | null }[]).find((h) => h.title === "Griffin Conine's two-run home run (15)")!;

async function settle(page: Page): Promise<void>
{
	await page.waitForLoadState("networkidle");
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

async function signIn(page: Page): Promise<void>
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
			videoPlayer: "dialog",
			version: 1,
		}),
	}));
	// Captures are stills: keep a clip from loading so it rests on its poster at 0:00.
	await page.route(/\.mp4(\?|$)/, (route) => route.abort());
	await signInDev(page, "/games/2026-09-05");
}

const frames: [string, (page: Page) => Promise<void>][] = [];
for (const pairing of ["mobile", "medium", "desktop"])
{
	frames.push([`game-videos-grid-playmeta-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		await page.getByTestId("play-link").first().waitFor();
	}]);
	frames.push([`game-videos-list-playmeta-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		// The segmented control's radio is hidden under its icon label; click the label (as S69's spec does).
		await page.locator("label[for$='-list']").click();
		await page.getByTestId("videos-list").first().waitFor();
		await page.getByTestId("play-link").first().waitFor();
	}]);
}
for (const pairing of ["mobile", "medium"])
{
	frames.push([`video-player-dialog-playmeta-${pairing}`, async (page) =>
	{
		await page.goto("/game/823823/videos");
		await page.getByRole("button", {
			name: `Play ${CONINE.title}`,
		}).first().click();
		await page.getByRole("dialog").getByTestId("player-play-link").waitFor();
		await page.waitForTimeout(400);
	}]);
}

for (const [frame, open] of frames)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await signIn(page);
		await open(page);
		await settle(page);
		await capture(page, testInfo, frame);
	});
}
