import {
	describe, expect, it,
} from "vitest";
import { fittingFilters } from "./fit-filters.js";

describe("fittingFilters (S69)", () =>
{
	it("shows every pill when they all fit, without a Filters button", () =>
	{
		expect(fittingFilters([100, 80], 70, 188, 8)).toEqual([0, 1]);
	});

	it("otherwise every pill, in order, that fits with the Filters button kept at the end", () =>
	{
		expect(fittingFilters([100, 80, 90], 70, 266, 8)).toEqual([0, 1]);
		expect(fittingFilters([100, 80, 90], 70, 180, 8)).toEqual([0]);
	});

	it("the pinned pill (the Featured team control) always shows, however wide, never behind the Filters button (#583)", () =>
	{
		expect(fittingFilters([120, 60], 70, 160, 8, 0)).toEqual([0]);
		expect(fittingFilters([160, 60], 70, 180, 8, 0)).toEqual([0]);
		expect(fittingFilters([100, 80], 70, 120, 8, 0)).toEqual([0]);
		// Its width is reserved first, so a later pill that would fit on its own gives way to it.
		expect(fittingFilters([60, 160], 70, 220, 8, 1)).toEqual([1]);
	});

	it("with no pill pinned (the Kind pill, grouped by team) a pill wider than the row still falls back to the Filters button (#583)", () =>
	{
		expect(fittingFilters([400, 60], 70, 320, 8)).toEqual([1]);
		expect(fittingFilters([400, 60], 70, 320, 8, -1)).toEqual([1]);
	});

	it("a row not laid out yet shows all", () =>
	{
		expect(fittingFilters([100, 80], 70, 0, 8)).toEqual([0, 1]);
	});
});
