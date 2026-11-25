// @bt-targets: web, functions
/**
 * S153's design match (rule 22): Search's result rows with the inning pill, in game-shell A6's
 * `search-playmeta-mobile`, `search-playmeta-medium` and `search-playmeta-desktop` (desktop at 1200px,
 * owner 2026-10-28: "Capture at 1200px"). The search is the dev API's own
 * `GET /api/v1/search/highlights?q=walk-off`, answered from MLB's recorded answer
 * (`fixtures/search-walk-off.json`), so each row's play id, half-inning and inning are the real
 * route's: a result with a play reads its date, muted, then the pill (`Bot 12 →`); a result with no
 * play keeps `Highlight · <date>` in the primary text colour.
 *
 * Judge only the rows' meta line (owner, 2026-10-28: "Judge only the story's own parts"). Expected
 * differences: A6's Search frames are copies of pre-A2 frames, titled "Search Plays & Highlights" with
 * the hint "Search games, players…" and an "ACTIVE FILTERS" chip row, where S5 builds
 * standings-search-settings A2's "Search Highlights" / "Search highlights…" and the chips are S72's
 * (none here: a words-only search); the frames' sample results and innings versus MLB's recorded 36
 * (walk-offs, so every pill is a bottom half); the frames' count line, which S5 leaves out; and the
 * site footer, which is S142's.
 */
import { test } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

const FRAMES = ["search-playmeta-mobile", "search-playmeta-medium", "search-playmeta-desktop"];

for (const frame of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.goto("/search?q=walk-off");
		await page.getByTestId("search-result").first().waitFor();
		await page.getByTestId("search-play-link").first().waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
