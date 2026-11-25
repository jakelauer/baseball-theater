// @bt-targets: web, functions
/**
 * S173's design match (rule 22): the floating player's pill row, standings-search-settings A10's
 * `search-playing-pills-*` and `digest-playing-pills-*` (desktop at 1200px, owner 2026-10-28:
 * "Capture at 1200px"): `More from game →` then, 8px after it, the clip's inning pill at the top left;
 * the game pill alone for a clip with no play; no pill for a clip with no game; "Close ✕" top right.
 *
 * Search is the dev API's own `GET /api/v1/search/highlights?q=walk-off`, answered from MLB's recorded
 * answer (`fixtures/search-walk-off.json`): Game 4's walk-off has its play (`Bot 12 →`), the radio call
 * of Chourio's walk-off has a game and no play, and the season montage has no game. The digest is the dev
 * API's own `GET /api/v1/digest`: for a clip with a play, S66's day (2026-09-05, 823823 CHC @ MIA with its
 * recorded plays), whose top five clips are all plays; for a clip with no play, S71's 2024-07-04 (NYM @ WSH,
 * NYY @ BOS), whose first such clip is Judge's home run (745001 has no recorded plays) and has no still.
 *
 * Judge only the player's top row (owner, 2026-10-28: "Judge only the story's own parts"). Expected
 * differences: the frames' sample clips (Judge's `Top 6 →`, Cole's clip with no play) and game
 * (`NYY @ BOS`) versus the recordings'; the player's own parts (S70) and its size; and, because the
 * scrim is opaque, nothing of the page under it.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

/** Waits for the open player's pill row and fonts, and keeps the shot to one screen. */
async function settle(page: Page): Promise<void>
{
	const dialog = page.getByRole("dialog");
	await dialog.getByTestId("video-player").waitFor();
	await dialog.getByTestId("player-pills").waitFor({
		state: "attached",
	});
	// The dialog's 150ms opening (#423) has finished.
	await page.waitForTimeout(400);
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
	// The dialog focuses its first control as it opens, and a page reached by `goto` shows that focus ring;
	// the frames draw the pills at rest.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	// A full-page shot of a fixed dialog over a long page lands it mid-page; keep the shot to one screen.
	const height = page.viewportSize()?.height ?? 844;
	await page.addStyleTag({
		content: `html, body, #root { height: ${height}px !important; overflow: hidden !important; }`,
	});
}

/** Search's player playing the result titled like `title`. */
async function search(page: Page, title: RegExp): Promise<void>
{
	await page.goto("/search?q=walk-off");
	await page.getByTestId("search-result").first().waitFor();
	await page.getByRole("link", {
		name: title,
	}).first().click();
	await settle(page);
}

/** The digest's player playing its first clip that has (or hasn't) a play: each card's link opens it in turn. */
async function digest(page: Page, withPlay: boolean): Promise<void>
{
	await page.goto(withPlay ? "/games/2026-09-05" : "/games/2024-07-04");
	const cards = page.getByTestId("day-digest").getByTestId("video-card");
	await cards.first().waitFor();
	const hrefs = await page.getByTestId("day-digest").locator("a[href*='clip=']").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
	for (const href of hrefs)
	{
		await page.goto(href);
		await page.getByRole("dialog").getByTestId("player-pills").waitFor({
			state: "attached",
		});
		const hasPlay = await page.getByRole("dialog").getByTestId("player-play-link").count() > 0;
		if (hasPlay === withPlay)
		{
			await settle(page);
			return;
		}
	}
	throw new Error(`the digest has no clip ${withPlay ? "with" : "without"} a play`);
}

const FRAMES: { frame: string;
	open: (page: Page) => Promise<void>; }[] = [
	...["mobile", "medium", "desktop"].flatMap((size) => [
		{
			frame: `search-playing-pills-${size}`,
			open: (page: Page) => search(page, /^Play .+walk-off single to win Game 4$/),
		},
		{
			frame: `search-playing-pills-noplay-${size}`,
			open: (page: Page) => search(page, /^Play Radio call of Jackson Chourio's walk-off single$/),
		},
		{
			frame: `digest-playing-pills-${size}`,
			open: (page: Page) => digest(page, true),
		},
		{
			frame: `digest-playing-pills-noplay-${size}`,
			open: (page: Page) => digest(page, false),
		},
	]),
	{
		frame: "search-playing-pills-nogame-mobile",
		open: (page: Page) => search(page, /^Play ALL walk-offs from the 2026 season$/),
	},
];

for (const { frame, open } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		// Captures are stills: keep a playing clip on its poster at 0:00.
		await page.route(/\.(mp4|m3u8)(\?|$)/, (route) => route.abort());
		await open(page);
		await capture(page, testInfo, frame);
	});
}
