// @bt-targets: web, functions
/**
 * S154's design match (rule 22): S154 draws no frames of its own. Its three pages of words (About,
 * Privacy policy, Terms of use) follow the change log page's ratified layout (S133's A9 frames;
 * owner, 2026-11-19: "Reuse change log layout (Recommended)"), and the footer with all six links is
 * shell-scoreboard A14's (ratified 2026-11-19).
 *
 * - `site-footer-mobile`, `site-footer-desktop`: the scoreboard signed in, the footer under the
 *   day's highlights, as S142's spec reaches it (2026-09-05's fixtures, from the cache), now with
 *   About, Privacy policy and Terms of use in their A14 places. Desktop at 1200px (owner,
 *   2026-10-28: "Capture at 1200px").
 * - `site-footer-signed-out-mobile`: the same signed out: "Legal" holds Privacy policy and Terms of
 *   use only.
 * - `<page>-<frame>` for each of `about`, `privacy` and `terms`: that page at the frame's width,
 *   signed in for the signed-in frames and signed out for the signed-out one, the footer at its end.
 *
 * Reduced motion is emulated. Expected differences, not judged (owner, 2026-10-28: "Judge only the
 * story's own parts"): the day, games and highlights are the fixture's (Sep 5, 2026) versus A14's
 * Sep 20–21, 2026; the scoreboard frames show no Live strip, as S142's captures; the header, rail
 * and cards are their own stories'; and each page's words are its own (approved by the owner,
 * 2026-11-23: "Approve all three as drafted"), where A9 draws release notes.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, signInDev,
} from "./helpers.js";

const SCHEDULE = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
const DAY = "/games/2026-09-05";

/** The three pages and each one's heading. */
const PAGES: [string, string][] = [["about", "About"], ["privacy", "Privacy policy"], ["terms", "Terms of use"]];

/** A14's footer frames S154 captures, each with whether it is drawn signed out. */
const FOOTER_FRAMES: [string, boolean][] = [["site-footer-mobile", false], ["site-footer-desktop", false], ["site-footer-signed-out-mobile", true]];

/** 2026-09-05's schedule from the cache. */
async function schedule(page: Page): Promise<void>
{
	await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			...SCHEDULE,
			fetchedAt: new Date().toISOString(),
			windowMode: "cache",
			version: 1,
			lastChangedAt: "2026-09-05T20:57:20.000Z",
		}),
	}));
}

/** Goes to `path`, signed in (the dev sign-in, on the scoreboard first) unless `signedOut`, and waits for the footer to show its signed-in state. */
async function open(page: Page, path: string, signedOut: boolean): Promise<void>
{
	await schedule(page);
	if (signedOut)
	{
		await page.goto(path);
	}
	else
	{
		await signInDev(page, DAY);
		if (path !== DAY) await page.goto(path);
		await page.getByRole("contentinfo").getByRole("link", {
			name: "Your data",
		}).waitFor();
	}
	await page.getByRole("contentinfo").getByRole("link", {
		name: "Terms of use",
	}).waitFor();
}

/** Waits for fonts and hides the dev sign-in control, then photographs `frame`. */
async function settle(page: Page, testInfo: Parameters<typeof capture>[1], frame: string): Promise<void>
{
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await hideDevControls(page);
	await capture(page, testInfo, frame);
}

for (const [frame, signedOut] of FOOTER_FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		await open(page, DAY, signedOut);
		await page.getByTestId("scoreboard-module").first().waitFor();
		await page.getByTestId("digest-item").first().waitFor();
		await settle(page, testInfo, frame);
	});

	for (const [name, heading] of PAGES)
	{
		const shot = `${name}-${frame}`;
		test(shot, async ({ page }, testInfo) =>
		{
			test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${shot} is drawn at another pairing`);
			await page.emulateMedia({
				reducedMotion: "reduce",
			});
			await open(page, `/${name}`, signedOut);
			await page.getByRole("heading", {
				level: 1,
				name: heading,
			}).waitFor();
			await settle(page, testInfo, shot);
		});
	}
}
