/**
 * S74: when a stored copy was current, from its answer's `Date` and `Age` (`storedCopyTime`).
 */
import {
	describe, expect, it,
} from "vitest";
import { storedCopyTime } from "./freshness.js";

describe("storedCopyTime (S74 R3)", () =>
{
	it("is the Date less the Age, in ISO; a missing, unreadable or negative Age counts as 0", () =>
	{
		const date = "Tue, 24 Nov 2026 18:00:00 GMT";
		expect(storedCopyTime(new Headers({
			Date: date,
			Age: "600",
		}))).toBe("2026-11-24T17:50:00.000Z");
		expect(storedCopyTime(new Headers({
			Date: date,
		}))).toBe("2026-11-24T18:00:00.000Z");
		expect(storedCopyTime(new Headers({
			Date: date,
			Age: "soon",
		}))).toBe("2026-11-24T18:00:00.000Z");
		expect(storedCopyTime(new Headers({
			Date: date,
			Age: "-5",
		}))).toBe("2026-11-24T18:00:00.000Z");
	});

	it("is undefined with no readable Date", () =>
	{
		expect(storedCopyTime(new Headers())).toBeUndefined();
		expect(storedCopyTime(new Headers({
			Date: "yesterday-ish",
		}))).toBeUndefined();
	});

	it("S74: an Age so large the time can't be written is undefined, never a throw", () =>
	{
		expect(() => storedCopyTime(new Headers({
			Date: "Tue, 24 Nov 2026 18:00:00 GMT",
			Age: "1e13",
		}))).not.toThrow();
		expect(storedCopyTime(new Headers({
			Date: "Tue, 24 Nov 2026 18:00:00 GMT",
			Age: "1e13",
		}))).toBeUndefined();
	});
});
