// @bt-targets: web, functions
/**
 * S149's design match (rule 22): shell-scoreboard A13's `live-marker-scoreboard-live-*` frames
 * (ratified 2026-11-19 by S147), which S148 left to this story: a scoreboard day with a game in its
 * live window and its day socket open, the footer opening with the darker `footer-live-strip` and
 * "● Live Data · Active" centred in it. The day is 2026-09-05 as the scoreboard's tests serve it
 * (`schedule-2026-09-05.json`'s SF @ NYM final, `schedule-823823-moments.json`'s CHC @ MIA in
 * progress and the same game before first pitch), served `active`; the day's live route
 * (`GET /api/v1/schedule/live?date=`) is answered by Playwright's WebSocket stand-in, which opens
 * the socket and pushes the same day as version 2 (Vite's dev proxy doesn't carry WebSockets, so
 * the socket is routed here, as S148's and S19's specs do).
 *
 * Reduced motion is emulated, so the marker's dot holds at `Phase=Bright` as the frames draw it
 * (it blinks otherwise, and two captures would differ).
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"): the
 * link columns the frames draw below the strip are A14's site footer, which S142 builds (A13
 * Frames: "A13 does not ratify them"); where the page is shorter than the screen, the footer sits
 * right after the content rather than at the window's bottom (A13 Placement; owner, 2026-11-19:
 * "A13"); the day, games and highlights are the fixtures' (Sep 5, 2026) versus the frames' Sep 21,
 * 2026; the header, rail and date control are S60's and S125's.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import { capture, hideDevControls } from "./helpers.js";

const SCHEDULE = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
const MOMENTS = JSON.parse(readFileSync(new URL("../../fixtures/schedule-823823-moments.json", import.meta.url), "utf8"));
const served = (version: number) => ({
	...SCHEDULE,
	games: [SCHEDULE.games[0], MOMENTS.live, {
		...MOMENTS.pregame,
		gamePk: 1,
	}],
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

for (const pairing of ["mobile", "desktop"] as const)
{
	const frame = `live-marker-scoreboard-live-${pairing}`;
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		let pushed: () => void = () => undefined;
		const arrived = new Promise<void>((resolve) =>
		{
			pushed = resolve;
		});
		await page.routeWebSocket(/\/api\/v1\/schedule\/live\?date=2026-09-05/, (socket) =>
		{
			socket.send(JSON.stringify(served(2)));
			pushed();
		});
		await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(served(1)),
		}));
		await page.goto("/games/2026-09-05");
		await page.getByTestId("scoreboard-module").first().waitFor();
		await arrived;
		await page.getByTestId("footer-live-strip").waitFor();
		// The frame draws the day's highlights above the strip: wait for them, not a fixed time.
		await page.getByTestId("day-digest").getByTestId("video-card").first().waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});
}
