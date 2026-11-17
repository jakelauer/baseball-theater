/**
 * The ADR-002 active window measured on games as the mappers really shape them (#71).
 * The mappers set `gameDate` to the official date alone, so a window read from it began at
 * midnight UTC: a night game never got its lead and its trail ended before it went final.
 * These tests run the recorded schedule and live feed through their mappers, never a
 * hand-built ISO `gameDate`, so they fail whenever the window stops reading first pitch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isGameInActiveWindow } from "@bt/domain";
import type { ScheduleGameSummary } from "@bt/domain";
import { parseLiveFeedResponse, parseScheduleResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { mapLiveFeed } from "./live.js";
import { mapScheduleGame } from "./schedule.js";

const rawDir = fileURLToPath(new URL("../../../fixtures/raw/", import.meta.url));

function readRaw(name: string): unknown
{
	return JSON.parse(readFileSync(rawDir + name, "utf8"));
}

/** A recorded 2026-09-05 game with a 23:05Z first pitch (7:05 PM Eastern). */
const NIGHT_GAME_PK = 824795;

function nightGame(): ScheduleGameSummary
{
	const schedule = parseScheduleResponse(readRaw("schedule-2026-09-05.json"));
	const game = schedule.dates.flatMap((d) => d.games).find((g) => g.gamePk === NIGHT_GAME_PK);
	if (!game) throw new Error(`recorded schedule lost game ${NIGHT_GAME_PK}`);
	return mapScheduleGame(game);
}

/** The same mapped game before it starts: the recording is final, the clock is what matters. */
function scheduled(game: ScheduleGameSummary): ScheduleGameSummary
{
	return {
		...game,
		status: {
			abstractGameState: "Preview",
			codedGameState: "S",
			detailedState: "Scheduled",
		},
	};
}

describe("isGameInActiveWindow on a mapped night game (#71)", () =>
{
	it("maps the recording as a 23:05Z first pitch on a date-only gameDate", () =>
	{
		const game = nightGame();
		expect(game.startTime).toBe("2026-09-05T23:05:00Z");
		expect(game.gameDate).toBe("2026-09-05");
		expect(game.status.codedGameState).toBe("F");
	});

	it("opens the window inside the 2h lead before first pitch (21:10Z)", () =>
	{
		expect(isGameInActiveWindow(scheduled(nightGame()), new Date("2026-09-05T21:10:00Z"))).toBe(true);
	});

	it("keeps the game out before the lead begins (20:55Z)", () =>
	{
		expect(isGameInActiveWindow(scheduled(nightGame()), new Date("2026-09-05T20:55:00Z"))).toBe(false);
	});

	it("keeps a final in its trail at 02:00Z the next day", () =>
	{
		expect(isGameInActiveWindow(nightGame(), new Date("2026-09-06T02:00:00Z"))).toBe(true);
	});

	it("falls back to the mid-afternoon assumption, not midnight, for a date-only game", () =>
	{
		const { startTime: _drop, ...dateOnly } = scheduled(nightGame());
		// Assumed start 17:00Z, lead 2h: in at 16:00Z, out at 23:00Z the day before.
		expect(isGameInActiveWindow(dateOnly, new Date("2026-09-05T16:00:00Z"))).toBe(true);
		expect(isGameInActiveWindow(dateOnly, new Date("2026-09-04T23:00:00Z"))).toBe(false);
	});
});

describe("isGameInActiveWindow on a mapped live-feed snapshot (#71)", () =>
{
	// The recorded feed's first pitch is 20:10Z; the game route and the per-game ingest
	// object judge the window on the snapshot, not on the schedule summary.
	const snapshot = mapLiveFeed(parseLiveFeedResponse(readRaw("live-823823.json")), "2026-09-05T18:15:00Z");

	it("carries first pitch as startTime", () =>
	{
		expect(snapshot.startTime).toBe("2026-09-05T20:10:00Z");
	});

	it("measures the window from that first pitch", () =>
	{
		const before = {
			...snapshot,
			status: {
				...snapshot.status,
				codedGameState: "S",
			},
		};
		expect(isGameInActiveWindow(before, new Date("2026-09-05T18:15:00Z"))).toBe(true);
		expect(isGameInActiveWindow(before, new Date("2026-09-05T18:05:00Z"))).toBe(false);
	});
});
