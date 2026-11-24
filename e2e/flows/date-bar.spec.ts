// @bt-targets: web, functions
/**
 * The scoreboard's date bar keeps its day arrows beside the date button at every width (B425,
 * #425; owner, 2026-11-23: "the arrows to move between days on desktop are too far away from the
 * calendar and should be moved to be next to the calendar with some buffer space to avoid
 * accidentally hitting the calendar"). jsdom has no layout, so this is measured in the browser at
 * each of the config's three pairings; `pnpm e2e` runs it with the main flows.
 */
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** The horizontal gap allowed between an arrow and the date button: a buffer, never a spread. */
const MIN_GAP = 8;
const MAX_GAP = 40;

/** An element's left and right edges in the page, in CSS pixels. */
interface Edges
{
	left: number;
	right: number;
}

async function box(locator: Locator): Promise<Edges>
{
	const found = await locator.boundingBox();
	if (!found) throw new Error("not laid out");
	return {
		left: found.x,
		right: found.x + found.width,
	};
}

test("the day arrows sit beside the date button with a gap (#425)", async ({ page }) =>
{
	await page.goto("/games/2024-07-04");
	const bar = page.getByTestId("date-control");
	const selector = await box(bar.getByTestId("date-selector"));
	const previous = await box(bar.getByRole("link", {
		name: "Previous day",
	}));
	const next = await box(bar.getByRole("link", {
		name: "Next day",
	}));
	const gaps = [selector.left - previous.right, next.left - selector.right];
	for (const gap of gaps)
	{
		expect(gap).toBeGreaterThanOrEqual(MIN_GAP);
		expect(gap).toBeLessThanOrEqual(MAX_GAP);
	}
});
