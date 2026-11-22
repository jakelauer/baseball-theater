// @bt-targets: web, functions
/**
 * S148's design match (rule 22): the footers of shell-scoreboard A13 (ratified 2026-11-19).
 * `live-marker-game-*`: a live game's Live room with its WebSocket open, the footer opening with
 * the darker `footer-live-strip` and "● Live Data · Active" centred in it. The game route is
 * answered with `fixtures/game-823823-live.json` served in its window (as S19's spec does), and
 * the live route by Playwright's WebSocket stand-in, which opens the socket and pushes the same
 * moment as version 2 (Vite's dev proxy doesn't carry WebSockets, so the socket is routed here).
 * `live-marker-scoreboard-quiet-*`: a scoreboard day with no game in its live window, so no
 * socket and no footer line at all: 2026-09-05's schedule answered with its first game alone,
 * SF @ NYM final (`schedule-2026-09-05.json`), served from the cache, as A13 draws a day whose
 * only game ended long ago.
 * The scoreboard's own live connection (`useLiveDay`) is S149's, so `live-marker-scoreboard-live-*`
 * are S149's frames, not captured here.
 *
 * Reduced motion is emulated, so the marker's dot holds at `Phase=Bright` as the frames draw it
 * (it blinks otherwise, and two captures would differ).
 *
 * Expected differences, not judged (owner, 2026-10-28: "Judge only the story's own parts"):
 * the link columns the frames draw below the strip, or in its place on the quiet scoreboard,
 * are A14's site footer, which S142 builds (A13 Frames: "A13 does not ratify them"); where a
 * page is shorter than the screen, the footer sits right after the content rather than at the
 * window's bottom as the desktop frames draw it (A13 Placement; owner, 2026-11-19: "A13");
 * the game's teams, inning and rooms are the fixture's (CHC @ MIA, Top 3rd) versus the frames'
 * sample game, and the scoreboard's day, game and highlights are the fixture's (Sep 5, 2026, SF @ NYM)
 * versus the frames' Sep 20, 2026; the header, rail and top bar are S60's and S40's.
 */
import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
	capture, hideDevControls, stubApi,
} from "./helpers.js";

const SCHEDULE = JSON.parse(readFileSync(new URL("../../fixtures/schedule-2026-09-05.json", import.meta.url), "utf8"));
const LIVE = JSON.parse(readFileSync(new URL("../../fixtures/game-823823-live.json", import.meta.url), "utf8"));
let highlights: unknown[] = [];
const served = (version: number) => ({
	...LIVE,
	highlights,
	fetchedAt: new Date().toISOString(),
	windowMode: "active",
	version,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
});

for (const pairing of ["mobile", "desktop"] as const)
{
	const frame = `live-marker-game-${pairing}`;
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		highlights = (await (await page.request.get("/api/v1/games/823823")).json()).highlights;
		let pushed: () => void = () => undefined;
		const arrived = new Promise<void>((resolve) =>
		{
			pushed = resolve;
		});
		await page.routeWebSocket(/\/api\/v1\/games\/823823\/live/, (socket) =>
		{
			socket.send(JSON.stringify(served(2)));
			pushed();
		});
		await stubApi(page, "/api/v1/games/823823", 200, served(1));
		await page.goto("/game/823823/live");
		await page.getByTestId("matchup-cards").first().waitFor();
		await arrived;
		await page.getByTestId("footer-live-strip").waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, frame);
	});

	const quiet = `live-marker-scoreboard-quiet-${pairing}`;
	test(quiet, async ({ page }, testInfo) =>
	{
		test.skip(testInfo.project.name !== pairing, `${quiet} is drawn at another pairing`);
		await page.emulateMedia({
			reducedMotion: "reduce",
		});
		await page.route(/\/api\/v1\/schedule\?/, (route) => route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				...SCHEDULE,
				games: [SCHEDULE.games[0]],
				fetchedAt: new Date().toISOString(),
				windowMode: "cache",
				version: 1,
				lastChangedAt: "2026-09-05T20:57:20.000Z",
			}),
		}));
		await page.goto("/games/2026-09-05");
		await page.getByTestId("scoreboard-module").first().waitFor();
		await page.waitForTimeout(500);
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await hideDevControls(page);
		await capture(page, testInfo, quiet);
	});
}
