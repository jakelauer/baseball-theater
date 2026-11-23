// @bt-targets: web, functions
/**
 * S135's design match (rule 22): shell-scoreboard A9's update notice with its link
 * (`update-notice-link-*`, `update-notice-on-changelog-*`) and the pointer after updating
 * (`updated-pointer-*`, `updated-pointer-on-changelog-*`, `updated-pointer-menu-open-{mobile,medium}`),
 * desktop at 1200px (owner, 2026-10-28). The `updated-pointer-with-marker-*` frames wait for S74's
 * offline marker; until it ships, `web/src/pwa/afterUpdate.test.tsx` stands for them with a passed marker.
 *
 * - The update notice: the dev server runs no service worker, so A6's box is raised through the
 *   app's development trigger (`btShowUpdate`, `src/pwa/updates.ts`), as S73's captures do.
 * - The pointer: the dev build's release is `dev` (no known release), so a load never follows an
 *   update; the pointer is raised through `btShowUpdated("v3.2.0")` (`src/pwa/afterUpdate.tsx`), the
 *   release the frames draw. Its countdown line is a 10-second CSS transition: once the pointer is up
 *   its animations are paused a third of the way in, so the capture shows the line part-shrunk (as the
 *   frames draw it) and never waits out the 10 seconds, after which the pointer would be gone.
 * - `/api/v1/releases` is stubbed on the change log page, with one illustrative release, as S134's
 *   spec stubs it.
 *
 * Judge only S135's parts: the notice's link and button row, the pointer (its arrow, words, link and
 * countdown line), where it aims (the rail's `Changelog` link on desktop, the menu button on mobile and
 * medium) and the link's highlighted state. Expected differences: the version line's words (`dev
 * (<commit>)` locally against the frames' `v3.2.0 (c46e853)` and `v3.1.0 (9d2f417)`), the page under
 * the box and the pointer (the fixture day against the frames' sample day, the change log's
 * illustrative releases, the footer), and the chrome A9 says later amendments repealed (`A9.md:25-29`)
 * and the pre-game win probability bar A7 repealed (`A9.md:15`).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, signInDev,
} from "./helpers.js";

const SCOREBOARD = "/games/2024-07-04";

/** One illustrative release for the change log page under the notice and the pointer. */
const RELEASE = {
	version: "v3.2.0",
	date: "2026-11-24",
	headline: [{
		title: "Pick any day from a calendar",
		sentence: "Jump to any date since 1901, with each day's game count shown under it.",
	}],
	items: [{
		kind: "feature",
		title: "Spring training standings",
		sentence: "Standings show spring training records, labeled, until opening day.",
	}],
	fixesAndPolish: "Smaller fixes to the scoreboard, game pages and sign-in.",
};

async function scoreboard(page: Page): Promise<void>
{
	await page.goto(SCOREBOARD);
	await page.getByTestId("scoreboard-module").first().waitFor();
}

async function changelog(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/releases(\?|$)/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			current: RELEASE,
			releases: [RELEASE],
		}),
	}));
	await page.goto("/changelog");
	await page.getByTestId("release").first().waitFor();
}

async function showUpdate(page: Page): Promise<void>
{
	await page.evaluate(() => (window as { btShowUpdate?: () => void }).btShowUpdate?.());
	await page.getByRole("button", {
		name: "Update Now",
	}).waitFor();
}

/** Raise the pointer as a load right after updating to v3.2.0 would, then hold its countdown part-way. */
async function showPointer(page: Page): Promise<void>
{
	await page.evaluate(() => (window as { btShowUpdated?: (release: string) => void }).btShowUpdated?.("v3.2.0"));
	await expect(page.getByTestId("after-update-pointer")).toBeVisible();
	await page.waitForTimeout(400);
	await page.evaluate(() =>
	{
		for (const animation of document.getAnimations())
		{
			// Leave looping animations (the live marker's pulse) running; hold the countdown, finish the rest.
			if (animation.effect?.getTiming().iterations === Infinity) continue;
			const total = Number(animation.effect?.getTiming().duration) || 0;
			if (total >= 5000)
			{
				animation.pause();
				animation.currentTime = total / 3;
			}
			else animation.finish();
		}
	});
}

/** Wait for the session and the web fonts, then hide the dev controls. */
async function settle(page: Page): Promise<void>
{
	await page.getByRole("button", {
		name: "Account",
	}).waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await page.getByRole("button", {
		name: /^Dev sign-out/,
	}).first().waitFor({
		timeout: 2000,
	}).catch(() => undefined);
	await hideDevControls(page);
}

const FRAMES: [string, (page: Page) => Promise<void>][] = [];
for (const pairing of ["mobile", "medium", "desktop"])
{
	FRAMES.push([`update-notice-link-${pairing}`, async (page) =>
	{
		await scoreboard(page);
		await settle(page);
		await showUpdate(page);
		await page.getByRole("link", {
			name: "See the changelog",
		}).waitFor();
	}]);
	FRAMES.push([`update-notice-on-changelog-${pairing}`, async (page) =>
	{
		await changelog(page);
		await settle(page);
		await showUpdate(page);
	}]);
	FRAMES.push([`updated-pointer-${pairing}`, async (page) =>
	{
		await scoreboard(page);
		await settle(page);
		await showPointer(page);
	}]);
	FRAMES.push([`updated-pointer-on-changelog-${pairing}`, async (page) =>
	{
		await changelog(page);
		await settle(page);
		await showPointer(page);
	}]);
}
for (const pairing of ["mobile", "medium"])
{
	FRAMES.push([`updated-pointer-menu-open-${pairing}`, async (page) =>
	{
		await scoreboard(page);
		await settle(page);
		await page.evaluate(() => (window as { btShowUpdated?: (release: string) => void }).btShowUpdated?.("v3.2.0"));
		await expect(page.getByTestId("after-update-pointer")).toBeVisible();
		await page.getByRole("button", {
			name: "Open navigation",
		}).click();
		const link = page.getByRole("dialog").getByTestId("changelog-link");
		await expect(link).toHaveAttribute("data-highlighted", "true");
		await expect(link).toBeInViewport({
			ratio: 1,
		});
		await expect(page.getByTestId("after-update-pointer")).toHaveCount(0);
		await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
		await settle(page);
	}]);
}

for (const [frame, open] of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await freezeClock(page);
		await signInDev(page, SCOREBOARD);
		await open(page);
		await capture(page, testInfo, frame);
	});
}
