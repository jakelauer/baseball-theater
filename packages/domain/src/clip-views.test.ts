import {
	describe, expect, it,
} from "vitest";
import {
	CLIP_COMPLETE_SHARE, CLIP_SHOWN_POSITION_MAX, clipCompleted, clipShownPosition, clipViewDay, isClipShownPosition, isClipViewEvent, parseClipViewRequest,
} from "./clip-views.js";

describe("clipCompleted (S174 AC 2)", () =>
{
	it("S174 AC 2: 90% of a known length is the bar, as a named constant", () =>
	{
		expect(CLIP_COMPLETE_SHARE).toBe(0.9);
	});

	it.each([
		["a duration of 0", 0, 0],
		["a NaN duration", 5, Number.NaN],
		["an Infinity duration (a live stream)", 1e9, Number.POSITIVE_INFINITY],
		["an unknown duration", 30, undefined],
		["a negative duration", 30, -10],
	])("S174 AC 2: %s is never complete by this rule", (_label, position, duration) =>
	{
		expect(clipCompleted(position, duration)).toBe(false);
	});

	it.each([
		["exactly 90%", 90, 100, true],
		["89.9%", 89.9, 100, false],
		["the whole clip", 100, 100, true],
		["past the end", 101, 100, true],
		["half", 50, 100, false],
		["the start", 0, 100, false],
		["a NaN position", Number.NaN, 100, false],
	])("S174 AC 2: %s of a 100-second clip → %s", (_label, position, duration, complete) =>
	{
		expect(clipCompleted(position, duration)).toBe(complete);
	});
});

describe("clip view request (S174 AC 4)", () =>
{
	it("knows the two events", () =>
	{
		expect(isClipViewEvent("start")).toBe(true);
		expect(isClipViewEvent("complete")).toBe(true);
		expect(isClipViewEvent("pause")).toBe(false);
		expect(isClipViewEvent(undefined)).toBe(false);
	});

	it("takes whole shown positions from 0 to 100 only", () =>
	{
		expect(CLIP_SHOWN_POSITION_MAX).toBe(100);
		for (const ok of [0, 1, 100]) expect(isClipShownPosition(ok)).toBe(true);
		for (const bad of [-1, 101, 1.5, Number.NaN, "3", null]) expect(isClipShownPosition(bad)).toBe(false);
	});

	it("parses exactly { gamePk, event, shownPosition }", () =>
	{
		expect(parseClipViewRequest({
			gamePk: 823823,
			event: "complete",
			shownPosition: 3,
			extra: "ignored",
		})).toEqual({
			gamePk: 823823,
			event: "complete",
			shownPosition: 3,
		});
		for (const bad of [
			null,
			"text",
			[],
			{},
			{
				gamePk: 823823,
				event: "pause",
				shownPosition: 1,
			},
			{
				gamePk: "823823",
				event: "start",
				shownPosition: 1,
			},
			{
				gamePk: 0,
				event: "start",
				shownPosition: 1,
			},
			{
				gamePk: 2147483648,
				event: "start",
				shownPosition: 1,
			},
			{
				gamePk: 823823,
				event: "start",
				shownPosition: 101,
			},
			{
				gamePk: 823823,
				event: "start",
			},
		]) expect(parseClipViewRequest(bad)).toBeNull();
	});
});

describe("clipShownPosition (S174 AC 3)", () =>
{
	const ranked = Array.from({
		length: 102,
	}, (_, i) => ({
		id: `hl-${i + 1}`,
	}));

	it("is the clip's 1-based place in the ranked list, or null when it isn't there or sits past 100", () =>
	{
		expect(clipShownPosition(ranked, "hl-1")).toBe(1);
		expect(clipShownPosition(ranked, "hl-100")).toBe(100);
		expect(clipShownPosition(ranked, "hl-101")).toBeNull();
		expect(clipShownPosition(ranked, "hl-404")).toBeNull();
		expect(clipShownPosition([], "hl-1")).toBeNull();
	});
});

describe("clipViewDay (S174 AC 3)", () =>
{
	it("is the UTC calendar day: one second apart across midnight lands on two days", () =>
	{
		expect(clipViewDay(new Date("2026-11-22T23:59:59Z"))).toBe("2026-11-22");
		expect(clipViewDay(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");
		// A moment written in another zone is still counted on its UTC day.
		expect(clipViewDay(new Date("2026-11-22T20:30:00-05:00"))).toBe("2026-11-23");
	});
});
