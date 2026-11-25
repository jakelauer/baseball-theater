// @bt-targets: web, functions
/**
 * S193's design match (rule 22): shell-scoreboard A17's ten frames, on a game page at mobile and
 * medium (A17 draws no desktop frame: there the rail keeps A9's pointer). The game page is the Live
 * room of the in-progress fixture game, 745001 (NYY @ BOS), as A17's `game-page-backdrop` is game-shell's
 * Live room.
 *
 * - The notice: the dev build's release is `dev`, so a load never follows an update; the moment is
 *   raised through `btShowUpdated("v3.2.0")` (`src/pwa/afterUpdate.tsx`), the release the frames draw.
 *   Its countdown line is a 10-second CSS transition: once up, its animations are held a third of the
 *   way in, as S135's captures hold the pointer's, so the line shows part-shrunk and never runs out.
 * - The modal: a tap on the notice opens it. `/api/v1/releases` is stubbed: A9's illustrative release
 *   plus a second one, never answered (loading), an empty list (empty), or a 500 (error).
 *
 * Judge only S193's parts: the notice (no arrow, its words, link and countdown line, where it floats)
 * and the modal (its card or dialog, margin, corners, edge, shadow, scrim, the title row and ✕, and the
 * change log's states inside). Expected differences: the game page under them (the fixture game's
 * day, score and at-bat against the frames' sample), the illustrative releases' words, and the change log
 * page's own body as it now stands (its loading state draws the shared skeleton rows the layout-type
 * fixes gave every page, where A9's frames, which A17 places, draw a loader), since the modal holds the
 * page itself rather than a copy.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, signInDev,
} from "./helpers.js";

const GAME = "/game/745001/live";

/** A9's illustrative release, as S135's captures draw it, and an older one under it. */
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
	}, {
		kind: "enhancement",
		title: "Choose what the game row shows",
		sentence: "Pick pitchers, the count or win probability for the slot on each game.",
	}, {
		kind: "performance",
		title: "Faster scoreboard loading",
		sentence: "The scoreboard opens about twice as fast on a slow connection.",
	}, {
		kind: "fix",
		title: "Scores stay hidden after a reload",
		sentence: "Hide Scores now holds when the app reopens offline.",
	}],
	fixesAndPolish: "Smaller fixes to the scoreboard, game pages and sign-in.",
};
const OLDER = {
	version: "v3.1.1",
	date: null,
	headline: [],
	items: [],
	fixesAndPolish: "Smaller fixes to the box score.",
};

type Releases = "releases" | "loading" | "empty" | "error";

async function serveReleases(page: Page, kind: Releases): Promise<void>
{
	await page.route(/\/api\/v1\/releases(\?|$)/, async (route) =>
	{
		if (kind === "loading") return; // never answered: the loader stays
		if (kind === "error")
		{
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					error: "internal",
				}),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(kind === "empty" ? {
				current: null,
				releases: [],
			} : {
				current: RELEASE,
				releases: [RELEASE, OLDER],
			}),
		});
	});
}

/** The game page, its session and web fonts settled, the dev controls hidden. */
async function game(page: Page): Promise<void>
{
	await page.goto(GAME);
	await page.getByRole("status", {
		name: "Live status",
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

/** Raise the notice as a load right after updating to v3.2.0 would. */
async function showNotice(page: Page): Promise<void>
{
	await page.evaluate(() => (window as { btShowUpdated?: (release: string) => void }).btShowUpdated?.("v3.2.0"));
	await expect(page.getByTestId("after-update-notice")).toBeVisible();
}

/** Hold the countdown a third of the way in and finish every other non-looping animation. */
async function holdAnimations(page: Page): Promise<void>
{
	await page.waitForTimeout(400);
	await page.evaluate(() =>
	{
		for (const animation of document.getAnimations())
		{
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

const FRAMES: [string, (page: Page) => Promise<void>][] = [];
for (const pairing of ["mobile", "medium"])
{
	FRAMES.push([`game-updated-notice-${pairing}`, async (page) =>
	{
		await game(page);
		await showNotice(page);
		await holdAnimations(page);
	}]);
	for (const [suffix, kind] of [["", "releases"], ["-loading", "loading"], ["-empty", "empty"], ["-error", "error"]] as const)
	{
		FRAMES.push([`game-updated-changelog${suffix}-${pairing}`, async (page) =>
		{
			await serveReleases(page, kind);
			await game(page);
			await showNotice(page);
			await page.getByTestId("after-update-notice").click();
			const modal = page.getByTestId("changelog-modal");
			await modal.waitFor();
			if (kind === "releases") await modal.getByTestId("release").first().waitFor();
			if (kind === "empty") await modal.getByText("No release notes yet.").waitFor();
			if (kind === "error") await modal.getByText("Couldn't load the change log").waitFor({
				timeout: 15_000,
			});
			await expect(page.getByTestId("after-update-notice")).toHaveCount(0);
			await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
		}]);
	}
}

for (const [frame, open] of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		await freezeClock(page);
		// The game page has no app header to sign in from: sign in on the scoreboard first.
		await signInDev(page);
		await open(page);
		await capture(page, testInfo, frame);
	});
}
