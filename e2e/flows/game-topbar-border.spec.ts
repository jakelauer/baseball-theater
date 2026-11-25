// @bt-targets: web, functions
/**
 * The game page's top bar draws its bottom border across the whole content column, like the site
 * header's, at every width (B585, #585; owner, 2026-11-25: "the top bar on games has a bottom
 * border, but the border doesn't extend the entire way like it should."). jsdom has no layout, so
 * this is measured in the browser at each of the config's three pairings; `pnpm e2e` runs it with
 * the main flows.
 *
 * "Edge to edge" is the content column's edges, the `main` element's box: the viewport at phone and
 * medium, and right of the nav rail at desktop, where the site header's border starts too.
 */
import { expect, test } from "@playwright/test";

/** A drawn horizontal line: an element (or its `::before`/`::after`) with a bottom border, in page pixels. */
interface Line
{
	left: number;
	width: number;
}

test("the game top bar's bottom border runs edge to edge (#585)", async ({ page }) =>
{
	await page.goto("/game/744834");
	const bar = page.getByTestId("game-topbar");
	await expect(bar).toBeVisible();

	// Every bottom border drawn in the bar, its own and its children's (pseudo-elements included).
	const lines = await bar.evaluate((root): Line[] =>
	{
		const found: Line[] = [];
		for (const element of [root, ...root.querySelectorAll("*")])
		{
			const rect = element.getBoundingClientRect();
			for (const pseudo of [null, "::before", "::after"])
			{
				const style = getComputedStyle(element, pseudo);
				if (pseudo && style.content === "none") continue;
				const width = parseFloat(style.borderBottomWidth);
				if (width > 0 && style.borderBottomStyle !== "none" && style.borderBottomColor !== "rgba(0, 0, 0, 0)" && style.display !== "none")
				{
					found.push({
						left: rect.left,
						width: rect.width,
					});
				}
			}
		}
		return found;
	});
	const column = await page.locator("main").boundingBox();
	if (!column) throw new Error("main not laid out");

	// The widest line drawn is the bar's border; it spans the content column.
	expect(lines.length).toBeGreaterThan(0);
	const widest = lines.reduce((a, b) => (b.width > a.width ? b : a));
	expect(widest.left).toBeCloseTo(column.x, 0);
	expect(widest.width).toBeCloseTo(column.width, 0);
	const viewport = page.viewportSize();
	if (viewport && viewport.width < 1200)
	{
		expect(widest.left).toBeCloseTo(0, 0);
		expect(widest.width).toBeCloseTo(viewport.width, 0);
	}
});
