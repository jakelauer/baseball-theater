// @bt-targets: web, functions
/**
 * S198: a playing clip keeps playing in a corner mini-player while the fan browses, as YouTube's does
 * (owner, 2026-11-23: "a way to have the video playing like in the corner while you browse the site
 * kind of like YouTube has").
 *
 * AC 1: a clip played in a game's Videos room keeps playing, the same `<video>` element (marked, then
 * found again by its mark), as the fan goes to the Box room and then the scoreboard: `paused` stays
 * false and `currentTime` keeps advancing. AC 4: the corner sits at the bottom right, a third of the
 * width on a phone and 400px wider up, above the update notice (A6), the after-update notice (A17)
 * and the footer's Live strip (A13), their boxes never overlapping.
 *
 * MLB's clip files are on MLB's servers, which the flows never reach: every `.mp4` is answered with
 * `clip.webm` beside this spec (a 20-second test pattern Chromium plays), and HLS playlists are
 * refused, so the player falls back to the file.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const CLIP = readFileSync(new URL("./clip.webm", import.meta.url));

/** Answers every clip file with the test pattern, and refuses streams. */
async function serveClips(page: Page): Promise<void>
{
	await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({
		status: 200,
		contentType: "video/webm",
		body: CLIP,
	}));
	await page.route(/\.m3u8(\?|$)/, (route) => route.abort());
}

/** Waits until `video` is playing and past `after` seconds, and returns its time. */
async function playingPast(video: Locator, after: number): Promise<number>
{
	await expect.poll(() => video.evaluate((element: HTMLVideoElement, past: number) => !element.paused && element.currentTime > past, after), {
		timeout: 10_000,
	}).toBe(true);
	return video.evaluate((element: HTMLVideoElement) => element.currentTime);
}

/** Whether `video` carries the mark set on the element first played: the same element, moved. */
async function marked(video: Locator): Promise<boolean>
{
	return video.evaluate((element) => (element as HTMLVideoElement & { btMark?: string }).btMark === "S198");
}

/** Opens the first of `cards` (a clip's card or link) and returns the dialog's `<video>`, marked and playing. */
async function playFirst(page: Page, cards: Locator): Promise<Locator>
{
	await cards.first().click();
	const video = page.getByRole("dialog").locator("video");
	await playingPast(video, 0);
	await video.evaluate((element) =>
	{
		(element as HTMLVideoElement & { btMark?: string }).btMark = "S198";
	});
	return video;
}

/** The tool row's Mini player button: the clip to the corner, the fan staying on the page. */
async function toCorner(page: Page): Promise<Locator>
{
	await page.getByRole("dialog").getByRole("button", {
		name: "Mini player",
	}).click();
	const corner = page.getByTestId("corner-player");
	await expect(corner).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	return corner;
}

type Box = { x: number;
	y: number;
	width: number;
	height: number; };

/** Two boxes overlap when they share any area. */
function overlap(a: Box, b: Box): boolean
{
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The corner sits at the bottom right at its pairing's width (S198 AC 4). */
async function expectCornerPlaced(page: Page, corner: Locator, project: string): Promise<Box>
{
	const box = (await corner.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(Math.round(viewport.width - (box.x + box.width))).toBe(16);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	expect(box.y).toBeGreaterThan(viewport.height / 2);
	if (project === "mobile") expect(Math.abs(box.width - viewport.width * 0.33)).toBeLessThanOrEqual(2);
	else expect(Math.round(box.width)).toBe(400);
	return box;
}

/** Checks the corner sits above `other`, their boxes apart. */
async function expectAbove(corner: Locator, other: Locator): Promise<void>
{
	const mine = (await corner.boundingBox())!;
	const theirs = (await other.boundingBox())!;
	expect(overlap(mine, theirs)).toBe(false);
	expect(mine.y + mine.height).toBeLessThanOrEqual(theirs.y);
}

test("S198 AC 1: a clip playing in the Videos room keeps playing, the same element, through the Box room and the scoreboard", async ({ page }) =>
{
	await serveClips(page);
	await page.goto("/game/823823/videos");
	const video = await playFirst(page, page.getByRole("link", {
		name: /^Play Griffin Conine's two-run home run/,
	}));
	const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);

	// The modal covers the page, so the fan sends the clip to the corner first (the tool row's Mini
	// player button), then goes to the Box room: a route change, the clip playing on in the corner.
	const corner = await toCorner(page);
	await page.getByRole("tab", {
		name: "Box",
	}).click();
	await expect(page).toHaveURL(/\/game\/823823\/box/);
	await expect(corner).toBeVisible();
	const mini = corner.locator("video");
	expect(await marked(mini)).toBe(true);
	const inBox = await playingPast(mini, before);

	// The scoreboard, through the game top bar's link: still the same element, still playing.
	await page.getByRole("link", {
		name: "Back to scoreboard",
	}).click();
	await expect(page).toHaveURL(/\/games/);
	await page.getByTestId("scoreboard-module").first().waitFor();
	await expect(corner).toBeVisible();
	expect(await marked(mini)).toBe(true);
	await playingPast(mini, inBox);
	expect(await page.locator("video").count()).toBe(1);
});

test("S198 AC 1: a link in the player (its inning pill) leaves for the Plays room, the clip playing on in the corner, the same element", async ({ page }) =>
{
	await serveClips(page);
	await page.goto("/game/823823/videos");
	const video = await playFirst(page, page.getByRole("link", {
		name: /^Play Griffin Conine's two-run home run/,
	}));
	const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
	await page.getByRole("dialog").getByTestId("player-play-link").click();
	await expect(page).toHaveURL(/\/game\/823823\/plays/);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const corner = page.getByTestId("corner-player");
	await expect(corner).toBeVisible();
	const mini = corner.locator("video");
	expect(await marked(mini)).toBe(true);
	await playingPast(mini, before);
});

test("S198 AC 4: the corner player sits above the update notice (notice-float), clear of it", async ({ page }, testInfo) =>
{
	await serveClips(page);
	await page.goto("/game/823823/videos");
	await playFirst(page, page.getByRole("link", {
		name: /^Play Griffin Conine's two-run home run/,
	}));
	const corner = await toCorner(page);
	await expectCornerPlaced(page, corner, testInfo.project.name);
	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
	const notice = page.getByTestId("notice-float");
	await expect(notice).toBeVisible();
	await expect.poll(async () => overlap((await corner.boundingBox())!, (await notice.boundingBox())!)).toBe(false);
	await expectAbove(corner, notice);
});

test("S198 AC 4: on a game page at mobile and medium widths the corner player sits above the after-update notice (after-update-notice)", async ({ page }, testInfo) =>
{
	test.skip(testInfo.project.name === "desktop", "the after-update notice shows on game pages at mobile and medium widths only (A17)");
	await serveClips(page);
	await page.goto("/game/823823/videos");
	await playFirst(page, page.getByRole("link", {
		name: /^Play Griffin Conine's two-run home run/,
	}));
	const corner = await toCorner(page);
	await expectCornerPlaced(page, corner, testInfo.project.name);
	await page.evaluate(() => (window as { btShowUpdated?: (release: string) => void }).btShowUpdated?.("v3.2.0"));
	const notice = page.getByTestId("after-update-notice");
	await expect(notice).toBeVisible();
	await expect.poll(async () => overlap((await corner.boundingBox())!, (await notice.boundingBox())!)).toBe(false);
	await expectAbove(corner, notice);
});

test("S198 AC 4: the footer's Live strip (footer-live-strip) scrolls clear above the corner player", async ({ page }, testInfo) =>
{
	// The day in its live window, as S149's spec serves it: the scoreboard's socket open, the strip drawn.
	const schedule = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
	const moments = JSON.parse(readFileSync(new URL("../../fixtures/schedule-823823-moments.json", import.meta.url), "utf8"));
	const served = (version: number) => ({
		...schedule,
		games: [schedule.games[0], moments.live],
		fetchedAt: new Date().toISOString(),
		windowMode: "active",
		version,
		lastChangedAt: "2026-09-05T20:57:20.000Z",
	});
	await page.routeWebSocket(/\/api\/v1\/schedule\/live\?date=2026-09-05/, (socket) =>
	{
		socket.send(JSON.stringify(served(2)));
	});
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(served(1)),
	}));
	await serveClips(page);
	await page.goto("/games/2026-09-05");
	const strip = page.getByTestId("footer-live-strip");
	await strip.waitFor();
	await playFirst(page, page.getByTestId("day-digest").getByTestId("video-card"));
	const corner = await toCorner(page);
	await expectCornerPlaced(page, corner, testInfo.project.name);
	// At the page's end, where the footer rests: the strip and the corner apart.
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await expect.poll(async () => overlap((await corner.boundingBox())!, (await strip.boundingBox())!)).toBe(false);
	// The whole footer clears the corner: room is left after it.
	const footer = (await page.getByTestId("site-footer").boundingBox())!;
	expect(footer.y + footer.height).toBeLessThanOrEqual((await corner.boundingBox())!.y);
});
