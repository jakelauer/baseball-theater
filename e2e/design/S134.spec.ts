// @bt-targets: web, functions
/**
 * S134's design match (rule 22): the change log page and the menu's link, shell-scoreboard A9's
 * `changelog-*` (three releases, empty, loading, error), `drawer-changelog-link-{mobile,medium}` and
 * `rail-version-release-desktop` (desktop at 1200px, owner 2026-10-28). The update notice and
 * pointer frames are S135's.
 *
 * `/api/v1/releases` is stubbed with `page.route`, as S73's spec stubs its routes: fulfilled with
 * the three releases A9 draws (illustrative, not real releases), with none (empty), never answered
 * (loading) or a 500 (error). Signed in as the dev account, as the frames draw Settings in the rail.
 *
 * Judge only S134's parts: the page's title, releases, Major Feature headers, kind labels, fixes
 * line and states, and the rail's and drawer's foot (the Changelog link over the version line).
 * Expected differences: the version line's words (`dev (<commit>)` locally against the frames'
 * `v3.2.0 (c46e853)`; S135 and #47 own that line), the scoreboard behind the drawer and beside the
 * rail (the fixture day against the frames' sample day), the footer the scoreboard frames draw
 * (S141/S142), and the chrome A9 says later amendments repealed (the desktop burger, A2; the
 * desktop header wordmark, A11; the digest's gold, A10; `A9.md:25-29`).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, signInDev,
} from "./helpers.js";

const SCOREBOARD = "/games/2024-07-04";

/** The three releases A9's `changelog-*` frames draw, newest first. */
const RELEASES = [
	{
		version: "v3.2.0",
		date: "2026-11-24",
		headline: [
			{
				title: "Pick any day from a calendar",
				sentence: "Jump to any date since 1901, with each day's game count shown under it.",
			},
		],
		items: [
			{
				kind: "feature",
				title: "Spring training standings",
				sentence: "Standings show spring training records, labeled, until opening day.",
			},
			{
				kind: "enhancement",
				title: "Choose what the game row shows",
				sentence: "Pick pitchers, the count or win probability for the slot on each game.",
			},
			{
				kind: "performance",
				title: "Faster scoreboard loading",
				sentence: "The scoreboard opens about twice as fast on a slow connection.",
			},
			{
				kind: "fix",
				title: "Scores stay hidden after a reload",
				sentence: "Hide Scores now holds when the app reopens offline.",
			},
		],
		fixesAndPolish: "Smaller fixes to the scoreboard, game pages and sign-in.",
	},
	{
		version: "v3.1.1",
		headline: [],
		items: [],
		fixesAndPolish: "Faster loading on slow connections, and smaller fixes to video playback.",
	},
	{
		version: "v3.1.0",
		date: "2026-11-10",
		headline: [],
		items: [
			{
				kind: "enhancement",
				title: "A calmer update notice",
				sentence: "The update notice floats at the bottom with Snooze and Update Now.",
			},
			{
				kind: "fix",
				title: "Videos resume where you left off",
				sentence: "Closing and reopening a highlight no longer restarts it.",
			},
		],
	},
];

type ReleasesAnswer = "releases" | "empty" | "loading" | "error";

/** Answer `/api/v1/releases` as the state needs; "loading" never answers. */
async function stubReleases(page: Page, answer: ReleasesAnswer): Promise<void>
{
	await page.route(/\/api\/v1\/releases(\?|$)/, async (route) =>
	{
		if (answer === "loading") return;
		if (answer === "error")
		{
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					error: "unavailable",
				}),
			});
			return;
		}
		const releases = answer === "empty" ? [] : RELEASES;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				current: releases[0] ?? null,
				releases,
			}),
		});
	});
}

/** Wait for the session, the web fonts and any finite animation (a drawer's slide-in), then hide the dev controls. */
async function settle(page: Page): Promise<void>
{
	// Each page load asks for the session again: once the header's Account button is back the dev
	// control has rendered too, so hiding it now can't miss it.
	await page.getByRole("button", {
		name: "Account",
	}).waitFor();
	await page.evaluate(async () =>
	{
		await document.fonts.ready;
	});
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
	// The rail (desktop) or the open drawer draws the dev control; on a closed-drawer page there is none.
	await page.getByRole("button", {
		name: /^Dev sign-out/,
	}).first().waitFor({
		timeout: 2000,
	}).catch(() => undefined);
	await hideDevControls(page);
}

const STATE_READY: Record<ReleasesAnswer, (page: Page) => Promise<void>> = {
	releases: (page) => page.getByTestId("release").first().waitFor(),
	empty: (page) => page.getByText("No release notes yet.").waitFor(),
	loading: (page) => page.getByLabel("Loading").first().waitFor(),
	error: (page) => page.getByText("Couldn't load the change log").waitFor(),
};

const FRAMES: [string, (page: Page) => Promise<void>][] = [];
for (const pairing of ["mobile", "medium", "desktop"])
{
	for (const [suffix, answer] of [["", "releases"], ["-empty", "empty"], ["-loading", "loading"], ["-error", "error"]] as const)
	{
		FRAMES.push([`changelog${suffix}-${pairing}`, async (page) =>
		{
			await stubReleases(page, answer);
			await page.goto("/changelog");
			await page.getByRole("heading", {
				level: 1,
				name: "Change log",
			}).waitFor();
			await STATE_READY[answer](page);
		}]);
	}
}
for (const pairing of ["mobile", "medium"])
{
	FRAMES.push([`drawer-changelog-link-${pairing}`, async (page) =>
	{
		await page.goto(SCOREBOARD);
		await page.getByRole("button", {
			name: "Open navigation",
		}).click();
		await expect(page.getByRole("dialog").getByRole("link", {
			name: "Changelog",
		})).toBeInViewport({
			ratio: 1,
		});
	}]);
}
FRAMES.push(["rail-version-release-desktop", async (page) =>
{
	await page.goto(SCOREBOARD);
	// The rail's link; the site footer has a "Changelog" link too since S142.
	await page.getByRole("navigation", {
		name: "Main",
	}).getByRole("link", {
		name: "Changelog",
	}).waitFor();
	await page.getByRole("link", {
		name: "Scoreboard",
	}).waitFor();
}]);

for (const [frame, open] of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await freezeClock(page);
		await signInDev(page, SCOREBOARD);
		await open(page);
		await settle(page);
		await capture(page, testInfo, frame);
	});
}
