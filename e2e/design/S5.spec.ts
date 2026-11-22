// @bt-targets: web, functions
/**
 * S5's design match (rule 22): Search Highlights in the frames that draw it — standings-search-settings
 * `search-medium` and `search-desktop` (desktop at 1200px, owner 2026-10-28), A2's
 * `search-retitled-mobile` (the page retitled "Search Highlights", hint "Search highlights…"; A2
 * overrides the title in the medium and desktop frames too), and A6's
 * `search-playing-floating-mobile` (a tapped result playing in the floating player over the fully
 * dimmed results, "Go to game: … →" top left, "Close ✕" top right). The search is the dev API's own
 * `GET /api/v1/search/highlights?q=walk-off`, answered from MLB's recorded answer
 * (`fixtures/search-walk-off.json`), so the rows, count and matchups are the real route's.
 *
 * Judge only S5's parts (owner, 2026-10-28: "Judge only the story's own parts"): the title, the box
 * and its hint, the count line, the typographic rows (video icon, title, `Highlight · date`, the
 * matchup as swatch + abbreviation, hairlines between) and the floating player with its game link.
 * Expected differences: the frames' "ACTIVE FILTERS" chips (All Dates · NYY · Home Runs), which are
 * S72's; the frames' five sample results versus MLB's recorded 36 (one page, newest first, a clip MLB
 * ties to no game showing no matchup); the player's own parts, which are S70's. The footer's
 * "Fetched … ago" is the real time.
 */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

async function results(page: Page, playing: boolean): Promise<void>
{
	// Captures are stills: keep a playing clip on its poster at 0:00.
	await page.route(/\.(mp4|m3u8)(\?|$)/, (route) => route.abort());
	await page.goto("/search?q=walk-off");
	await page.getByTestId("search-result").first().waitFor();
	if (playing)
	{
		await page.getByRole("button", {
			name: /^Play .+walk-off single to win Game 4$/,
		}).click();
		await page.getByRole("dialog").getByTestId("video-player").waitFor();
		await page.waitForTimeout(400);
	}
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
}

const FRAMES: { frame: string;
	playing: boolean; }[] = [
	{
		frame: "search-retitled-mobile",
		playing: false,
	},
	{
		frame: "search-medium",
		playing: false,
	},
	{
		frame: "search-desktop",
		playing: false,
	},
	{
		frame: "search-playing-floating-mobile",
		playing: true,
	},
];

for (const { frame, playing } of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await results(page, playing);
		if (playing)
		{
			// A full-page shot of a fixed dialog over a long page lands it mid-page; keep the shot to one screen.
			await page.addStyleTag({
				content: "html, body, #root { height: 844px !important; overflow: hidden !important; }",
			});
		}
		await capture(page, testInfo, frame);
	});
}
