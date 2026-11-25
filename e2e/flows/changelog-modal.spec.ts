// @bt-targets: web, functions
/**
 * S193 (shell-scoreboard A17): after updating on a game page at a phone width, the "Update complete"
 * notice opens the change log in a modal over the game page, and the phone's Back closes it there
 * instead of leaving the game. The dev build has no known release, so the after-update moment is raised
 * through the development trigger (`btShowUpdated`, `src/pwa/afterUpdate.tsx`), as S135's captures do;
 * `/api/v1/releases` is stubbed with a few releases, enough to scroll. The history's length is never
 * asserted: the entry the modal adds for Back stays counted after it is popped (S193 AC 2).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const SCOREBOARD = "/games/2024-07-04";
const GAME = /\/game\/745001$/;

const RELEASES = ["v3.4.0", "v3.3.0", "v3.2.0"].map((version) => ({
	version,
	date: "2026-11-24",
	headline: [{
		title: `What ${version} added`,
		sentence: "Jump to any date since 1901, with each day's game count shown under it.",
	}],
	items: ["feature", "enhancement", "performance", "fix"].map((kind) => ({
		kind,
		title: `A ${kind} in ${version}`,
		sentence: "Standings show spring training records, labeled, until opening day.",
	})),
	fixesAndPolish: "Smaller fixes to the scoreboard, game pages and sign-in.",
}));

async function showUpdated(page: Page): Promise<void>
{
	await page.evaluate(() => (window as { btShowUpdated?: (release: string) => void }).btShowUpdated?.("v3.4.0"));
	await expect(page.getByTestId("after-update-notice")).toBeVisible();
}

test("S193: on a game page at a phone width the notice opens the change log over the game; Back closes it and stays, and nothing is left for Back after ✕", async ({ page }, testInfo) =>
{
	test.skip(testInfo.project.name !== "mobile", "A17's phone flow runs at the mobile pairing");
	await page.setViewportSize({
		width: 390,
		height: 844,
	});
	await page.route(/\/api\/v1\/releases(\?|$)/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			current: RELEASES[0],
			releases: RELEASES,
		}),
	}));
	await page.goto(SCOREBOARD);
	await page.locator("a[href=\"/game/745001\"]").click();
	await expect(page).toHaveURL(GAME);
	const top = page.getByRole("tablist");
	await expect(top).toBeVisible();

	// Open, scroll inside it, then Back: the modal closes and the game page stays, the URL unchanged.
	await showUpdated(page);
	await page.getByTestId("after-update-notice").click();
	const modal = page.getByTestId("changelog-modal");
	await expect(modal.getByText("A fix in v3.2.0")).toBeAttached();
	await expect(page).toHaveURL(GAME);
	await modal.getByText("A fix in v3.2.0").scrollIntoViewIfNeeded();
	await expect(modal.getByText("A fix in v3.2.0")).toBeInViewport();
	await page.goBack();
	await expect(modal).toHaveCount(0);
	await expect(page).toHaveURL(GAME);
	await expect(top).toBeVisible();

	// Open again and close with ✕: one Back then leaves the game page for the scoreboard.
	await showUpdated(page);
	await page.getByRole("button", {
		name: "Open the changelog",
	}).click();
	await expect(modal).toBeVisible();
	await page.getByRole("button", {
		name: "Close the change log",
	}).click();
	await expect(modal).toHaveCount(0);
	await expect(page).toHaveURL(GAME);
	// ✕ pops the entry the modal added; wait for that before pressing Back.
	await page.waitForFunction(() => !(history.state && typeof history.state === "object" && "btChangelogModal" in history.state));
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`${SCOREBOARD}$`));
});
