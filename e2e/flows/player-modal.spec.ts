// @bt-targets: web, functions
/**
 * S196 AC 2: the video player is an inset modal over the dimmed site, and a press outside its border
 * closes it (owner, 2026-11-23: closed "with the close button the escape key or clicking outside the
 * border of the modal"). It opens a clip from the scoreboard's day digest (the dev API's own
 * `GET /api/v1/digest` for 2024-07-04), checks the modal leaves a margin of site showing around it,
 * presses the dimmed site in that margin and sees the player gone, with the scoreboard still there.
 */
import { expect, test } from "@playwright/test";

test("S196: a clip opens as an inset modal, and a press on the dimmed site outside its border closes it", async ({ page }) =>
{
	await page.emulateMedia({
		reducedMotion: "reduce",
	});
	await page.goto("/games/2024-07-04");
	const card = page.getByTestId("day-digest").getByTestId("video-card").first();
	await card.waitFor();
	await card.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByTestId("video-player")).toBeVisible();

	// Inset: the modal's border sits inside the viewport on every side, the site showing round it.
	const viewport = page.viewportSize()!;
	const box = (await page.locator(".mantine-Modal-content").boundingBox())!;
	expect(box.x).toBeGreaterThan(0);
	expect(box.y).toBeGreaterThan(0);
	expect(box.x + box.width).toBeLessThan(viewport.width);
	expect(box.y + box.height).toBeLessThan(viewport.height);

	// A press inside, on the clip's title, leaves it open.
	await dialog.getByTestId("video-player").locator("p").first().click();
	await expect(dialog).toBeVisible();

	// A press on the dimmed site, in the margin left of the modal, closes it.
	await page.locator(".mantine-Modal-overlay").click({
		position: {
			x: Math.max(1, Math.floor(box.x / 2)),
			y: Math.floor(viewport.height / 2),
		},
	});
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("day-digest")).toBeVisible();
});
