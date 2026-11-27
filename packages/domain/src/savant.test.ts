/**
 * S103 AC 5: Savant's figures merge into the stored pitches by `playId`, newer pull by version only, each figure empty
 * until it arrives (read as "not yet", never zero), its first sighting logged beside the live feed's time for the pitch;
 * and Savant is pulled at most once per interval while the game is live, then once more after the final.
 */
import {
	describe, expect, it,
} from "vitest";
import type { SavantPitch } from "./savant.js";
import {
	mergeSavantPitches, readSavantField, SAVANT_FIELDS, savantPullDue,
} from "./savant.js";
import { DEFAULT_CADENCE } from "./window.js";

const T1 = "2026-11-27T20:00:00.000Z";
const T2 = "2026-11-27T20:01:00.000Z";

function pitch(version: number, figures: Partial<SavantPitch> = {}): SavantPitch
{
	return {
		playId: "p1",
		atBatIndex: 4,
		version,
		...figures,
	};
}

describe("mergeSavantPitches (S103)", () =>
{
	it("S103 AC 5: a figure is absent until it arrives, and its first sighting is logged beside the live feed's time for the pitch", () =>
	{
		const first = mergeSavantPitches(undefined, [pitch(1, {
			batSpeed: 72,
		})], T1, new Map([["p1", "2026-11-27T19:59:50.000Z"]]));
		expect(first.changed).toBe(true);
		expect(first.pitches).toEqual([{
			playId: "p1",
			atBatIndex: 4,
			version: 1,
			batSpeed: 72,
			arrivedAt: {
				batSpeed: T1,
			},
			playEndTime: "2026-11-27T19:59:50.000Z",
		}]);
		expect(first.pitches[0]).not.toHaveProperty("xba");

		// The second pull brings xba: logged at T2, while batSpeed keeps its first sighting.
		const second = mergeSavantPitches(first.pitches, [pitch(2, {
			batSpeed: 72,
			xba: 0.78,
		})], T2);
		expect(second.changed).toBe(true);
		expect(second.pitches[0]?.arrivedAt).toEqual({
			batSpeed: T1,
			xba: T2,
		});
		expect(second.pitches[0]?.version).toBe(2);
		expect(second.pitches[0]?.playEndTime).toBe("2026-11-27T19:59:50.000Z");
	});

	it("S103 AC 5: a newer value replaces an older one only by version; an older or equal pull changes nothing", () =>
	{
		const stored = mergeSavantPitches(undefined, [pitch(5, {
			xba: 0.5,
		})], T1).pitches;
		const older = mergeSavantPitches(stored, [pitch(4, {
			xba: 0.9,
		})], T2);
		expect(older.changed).toBe(false);
		expect(older.pitches[0]?.xba).toBe(0.5);
		expect(mergeSavantPitches(stored, [pitch(5, {
			xba: 0.9,
		})], T2).changed).toBe(false);
		const newer = mergeSavantPitches(stored, [pitch(6, {
			xba: 0.9,
		})], T2);
		expect(newer.changed).toBe(true);
		expect(newer.pitches[0]?.xba).toBe(0.9);
		// A changed value keeps the time the figure first arrived.
		expect(newer.pitches[0]?.arrivedAt).toEqual({
			xba: T1,
		});
	});

	it("S103 AC 5: a newer pull that drops a figure keeps the stored one, and a newer pull with nothing new changes nothing", () =>
	{
		const stored = mergeSavantPitches(undefined, [pitch(1, {
			isSword: true,
			x: 10,
		})], T1).pitches;
		const dropped = mergeSavantPitches(stored, [pitch(2, {
			x: 10,
		})], T2);
		expect(dropped.changed).toBe(false);
		expect(dropped.pitches[0]).toBe(stored[0]);
		expect(dropped.pitches[0]?.isSword).toBe(true);
	});

	it("S103 AC 5: pitches join by playId: a new pitch is added, one the pull lacks stays, an at-bat correction is taken", () =>
	{
		const stored = mergeSavantPitches(undefined, [pitch(1, {
			batSpeed: 70,
		})], T1).pitches;
		const merged = mergeSavantPitches(stored, [{
			playId: "p2",
			atBatIndex: 5,
			version: 2,
		}, pitch(2, {
			atBatIndex: 3,
			batSpeed: 70,
		})], T2);
		expect(merged.changed).toBe(true);
		expect(merged.pitches.map((p) => [p.playId, p.atBatIndex])).toEqual([["p1", 3], ["p2", 5]]);
		expect(merged.pitches[1]).not.toHaveProperty("arrivedAt");
		expect(stored[0]?.atBatIndex).toBe(4);
	});

	it("S103 AC 5: the live feed's time is filled in once known, even from a pull no newer than the stored one", () =>
	{
		const stored = mergeSavantPitches(undefined, [pitch(3, {
			batSpeed: 70,
		})], T1).pitches;
		expect(stored[0]).not.toHaveProperty("playEndTime");
		const filled = mergeSavantPitches(stored, [pitch(3, {
			batSpeed: 70,
		})], T2, new Map([["p1", "2026-11-27T19:59:59.000Z"]]));
		expect(filled.changed).toBe(true);
		expect(filled.pitches[0]?.playEndTime).toBe("2026-11-27T19:59:59.000Z");
		expect(filled.pitches[0]?.version).toBe(3);
		// From a newer pull too; and once set it is kept.
		const newer = mergeSavantPitches(stored, [pitch(4, {
			batSpeed: 70,
		})], T2, new Map([["p1", "2026-11-27T19:59:59.000Z"]]));
		expect(newer.pitches[0]?.playEndTime).toBe("2026-11-27T19:59:59.000Z");
		expect(mergeSavantPitches(filled.pitches, [pitch(5, {
			batSpeed: 71,
		})], T2, new Map([["p1", "2026-11-27T20:30:00.000Z"]])).pitches[0]?.playEndTime).toBe("2026-11-27T19:59:59.000Z");
	});
});

describe("readSavantField (S103)", () =>
{
	it("S103 AC 5: views read an absent figure as not yet, never as zero or false", () =>
	{
		const pitches = [pitch(1, {
			xba: 0,
			isSword: false,
		})];
		expect(readSavantField(pitches, "p1", "xba")).toEqual({
			arrived: true,
			value: 0,
		});
		expect(readSavantField(pitches, "p1", "isSword")).toEqual({
			arrived: true,
			value: false,
		});
		expect(readSavantField(pitches, "p1", "batSpeed")).toEqual({
			arrived: false,
		});
		expect(readSavantField(pitches, "other", "xba")).toEqual({
			arrived: false,
		});
		expect(readSavantField(undefined, "p1", "xba")).toEqual({
			arrived: false,
		});
		expect(SAVANT_FIELDS).toHaveLength(12);
	});
});

describe("savantPullDue (S103)", () =>
{
	const NOW = Date.parse(T2);
	const base = {
		finalPulled: false,
		now: NOW,
		intervalMs: DEFAULT_CADENCE.savantIntervalMs,
	};

	it("S103 AC 5: while live and in its window, at most once per configured interval", () =>
	{
		expect(DEFAULT_CADENCE.savantIntervalMs).toBe(60_000);
		const live = {
			...base,
			codedGameState: "I",
			inWindow: true,
		};
		expect(savantPullDue(live)).toBe(true);
		expect(savantPullDue({
			...live,
			lastPulledAt: NOW - 30_000,
		})).toBe(false);
		expect(savantPullDue({
			...live,
			lastPulledAt: NOW - 60_000,
		})).toBe(true);
		expect(savantPullDue({
			...live,
			lastPulledAt: NOW - 10_000,
			intervalMs: 5_000,
		})).toBe(true);
	});

	it("S103 AC 5: once final, only once more, on the run's last poll; never before first pitch", () =>
	{
		const final = {
			...base,
			codedGameState: "F",
		};
		expect(savantPullDue({
			...final,
			inWindow: true,
		})).toBe(false);
		expect(savantPullDue({
			...final,
			inWindow: false,
		})).toBe(true);
		expect(savantPullDue({
			...final,
			inWindow: false,
			finalPulled: true,
		})).toBe(false);
		expect(savantPullDue({
			...base,
			codedGameState: "S",
			inWindow: true,
		})).toBe(false);
		expect(savantPullDue({
			...base,
			codedGameState: "I",
			inWindow: false,
		})).toBe(false);
	});
});
