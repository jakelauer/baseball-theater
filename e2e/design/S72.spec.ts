// @bt-targets: web, functions
/**
 * S72's design match (rule 22): Search's "ACTIVE FILTERS" chips in the frames that draw them —
 * standings-search-settings `search-medium` and `search-desktop` (desktop at 1200px, owner 2026-10-28)
 * and A2's `search-retitled-mobile` (A2 retitles every pairing "Search Highlights"). The page is
 * `/search?team=147&tag=home-run`, answered by the dev API from MLB's recorded filtered search
 * (`fixtures/search-team-147-tag-home-run.json`: every home run in a Yankees game, newest first), so the
 * chips read `NYY` (filled in Primary) and `Home Runs`, each with its ✕.
 *
 * Judge only S72's parts (owner, 2026-10-28: "Judge only the story's own parts"): the "ACTIVE FILTERS"
 * label and the chips under the box. Expected differences: the frames' "All Dates" chip, which BT draws
 * only for a date that is set (no date is set here, so there is no date chip); the frames' count line
 * ("5 RESULTS FOUND"), which Search leaves out until it pages through MLB's matches (owner, 2026-11-22:
 * "Don’t show any number until we support paging"); the rows themselves, which are S5's (MLB's recorded
 * 36, not the frames' five samples); and the frames' "Fetched … ago" footer line, which shell-scoreboard
 * A13 removed (S148).
 */
import { test } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

for (const frame of ["search-retitled-mobile", "search-medium", "search-desktop"])
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.goto("/search?team=147&tag=home-run");
		await page.getByTestId("search-filters").waitFor();
		await page.getByTestId("search-result").first().waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
