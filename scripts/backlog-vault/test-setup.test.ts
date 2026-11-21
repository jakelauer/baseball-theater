/** test-setup.ts loads for every test file: each test is followed by one yield to the event loop. */
import {
	describe, expect, it,
} from "vitest";

const yields = () => (globalThis as { __btEventLoopYields?: number }).__btEventLoopYields;

describe("the event-loop yield after each test (test-setup.ts)", () =>
{
	it("is registered: no yield has run before the first test", () =>
	{
		expect(yields()).toBe(0);
	});

	it("ran after the first test", () =>
	{
		expect(yields()).toBe(1);
	});
});
