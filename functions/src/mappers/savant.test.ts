/**
 * S103 AC 4: Savant's game feed projects to only what MLB's feeds lack, each pitch joined to the live feed's by `playId`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AtBat } from "@bt/domain";
import { SAVANT_FIELDS } from "@bt/domain";
import { parseSavantGameFeedResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { mapSavantGameFeed } from "./savant.js";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const VERSION = 1_788_649_200_000;

function recorded()
{
	return parseSavantGameFeedResponse(JSON.parse(readFileSync(`${FIXTURES}raw/savant-gf-823823.json`, "utf8")));
}

describe("mapSavantGameFeed (S103)", () =>
{
	it("S103 AC 4: on 823823, 52 batted balls carry xba, 150 swings batSpeed, 2 pitches are swords, the 5 ABS-challenged pitches sit in at-bats 34, 39, 69, 82, 83", () =>
	{
		const pitches = mapSavantGameFeed(recorded(), VERSION) ?? [];
		expect(pitches).toHaveLength(340);
		expect(pitches.filter((p) => p.xba !== undefined)).toHaveLength(52);
		expect(pitches.filter((p) => p.homeRunBallparks !== undefined)).toHaveLength(52);
		expect(pitches.filter((p) => p.x !== undefined && p.y !== undefined)).toHaveLength(52);
		expect(pitches.filter((p) => p.isBarrel === true)).toHaveLength(5);
		expect(pitches.filter((p) => p.batSpeed !== undefined)).toHaveLength(150);
		expect(pitches.filter((p) => p.isSword)).toHaveLength(2);
		expect(pitches.filter((p) => p.isAbsChallenge).map((p) => p.atBatIndex)).toEqual([34, 39, 69, 82, 83]);
		expect(pitches.every((p) => p.version === VERSION)).toBe(true);
	});

	it("S103 AC 4: a pitch carries exactly the kept figures (no trajectory, zone, box-score or season field), converted from Savant's form", () =>
	{
		const pitches = mapSavantGameFeed(recorded(), VERSION) ?? [];
		const allowed = new Set<string>(["playId", "atBatIndex", "version", ...SAVANT_FIELDS]);
		expect(pitches.flatMap((p) => Object.keys(p)).filter((key) => !allowed.has(key))).toEqual([]);
		const hit = pitches.find((p) => p.xba !== undefined);
		expect(typeof hit?.xba).toBe("number");
		expect(hit?.xba).toBeGreaterThanOrEqual(0);
		expect(hit?.xba).toBeLessThanOrEqual(1);
		expect(typeof hit?.isBarrel).toBe("boolean");
		// The automatic strike (no pitch thrown) keeps only what Savant gave it.
		expect(pitches.find((p) => p.playId === "10814e2d-99af-481c-877b-0d165503557c")).toEqual({
			playId: "10814e2d-99af-481c-877b-0d165503557c",
			atBatIndex: 2,
			version: VERSION,
			timesThroughOrder: 1,
		});
		// In the order the game threw them.
		expect(pitches.map((p) => p.atBatIndex)).toEqual([...pitches.map((p) => p.atBatIndex)].sort((a, b) => a - b));
	});

	it("S103 AC 4: each pitch joins the live feed's pitch of the same playId and at-bat", () =>
	{
		const plays = JSON.parse(readFileSync(`${FIXTURES}plays-823823.json`, "utf8")) as AtBat[];
		const atBatOf = new Map(plays.flatMap((atBat) => atBat.pitches.map((p) => [p.playId, atBat.about.atBatIndex] as const)));
		const joined = (mapSavantGameFeed(recorded(), VERSION) ?? []).filter((p) => atBatOf.get(p.playId) === p.atBatIndex);
		// Every pitch thrown; the one automatic strike is no pitch in the live feed's list.
		expect(joined).toHaveLength(339);
	});

	it("S103 AC 4: an xba that isn't a number is left out; a feed with no pitch maps to null", () =>
	{
		expect(mapSavantGameFeed({}, VERSION)).toBeNull();
		expect(mapSavantGameFeed({
			team_home: [{
				play_id: "a",
				ab_number: 2,
				xba: "",
				is_barrel: 0,
			}, {
				play_id: "b",
				ab_number: 1,
				xba: "n/a",
			}],
		}, VERSION)).toEqual([{
			playId: "b",
			atBatIndex: 0,
			version: VERSION,
		}, {
			playId: "a",
			atBatIndex: 1,
			version: VERSION,
			isBarrel: false,
		}]);
	});
});
