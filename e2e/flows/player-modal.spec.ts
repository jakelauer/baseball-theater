// @bt-targets: web, functions
/**
 * S196 AC 2: the video player is an inset modal over the dimmed site, and a press outside its border
 * closes it (owner, 2026-11-23: closed "with the close button the escape key or clicking outside the
 * border of the modal"). It opens a clip from the scoreboard's day digest (the dev API's own
 * `GET /api/v1/digest` for 2024-07-04), checks the modal leaves a margin of site showing around it,
 * presses the dimmed site in that margin and sees the player gone, with the scoreboard still there.
 *
 * Then, at a landscape phone, a portrait phone, a tablet and a laptop, a Search result (the recorded
 * walk-off search, whose clips have URLs, so the tools row draws): the whole player fits on screen
 * without scrolling inside the modal: the clip (its built-in controls at its foot), the tools row and
 * the disclaimer (pre-PR review: on a 640x390 phone the clip ran past the bottom edge).
 */
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

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

/** A locator's bottom edge, in viewport pixels. */
async function bottomOf(locator: Locator): Promise<number>
{
	const box = (await locator.boundingBox())!;
	return box.y + box.height;
}

for (const size of [{
	width: 640,
	height: 390,
}, {
	width: 390,
	height: 640,
}, {
	width: 768,
	height: 1024,
}, {
	width: 1280,
	height: 800,
}])
{
	test(`S196: at ${size.width}x${size.height} the clip, its tools and the disclaimer all fit on screen`, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== "desktop", "sets its own viewport; once is enough");
		await page.setViewportSize(size);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		await page.goto("/search?q=walk-off");
		await page.getByRole("link", {
			name: /^Play /,
		}).first().click();
		const player = page.getByRole("dialog").getByTestId("video-player");
		const tools = player.getByRole("toolbar", {
			name: "Video actions",
		});
		await expect(tools).toBeVisible();
		const bottom = size.height;
		expect(await bottomOf(player.locator("video"))).toBeLessThanOrEqual(bottom);
		expect(await bottomOf(tools)).toBeLessThanOrEqual(bottom);
		expect(await bottomOf(player.getByText(/^This video is provided by MLBAM/))).toBeLessThanOrEqual(bottom);
		// Nothing hidden behind a scroll inside the modal.
		const content = page.locator(".mantine-Modal-content");
		expect(await content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
	});
}
