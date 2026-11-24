/** S125 AC 8: the calendar's short-screen rule, read once from the window's height. */
import { renderHook } from "@testing-library/react";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { SHORT_SCREEN_HEIGHT, useShortScreen } from "./screenHeight.js";

const real = window.innerHeight;

afterEach(() =>
{
	window.innerHeight = real;
});

describe("useShortScreen (S125 AC 8)", () =>
{
	it("S125 AC 8: short below 640px, read when the caller mounts and never again", () =>
	{
		expect(SHORT_SCREEN_HEIGHT).toBe(640);
		window.innerHeight = 639;
		const { result, rerender } = renderHook(() => useShortScreen());
		expect(result.current).toBe(true);
		window.innerHeight = 900;
		rerender();
		expect(result.current).toBe(true);
		window.innerHeight = 640;
		expect(renderHook(() => useShortScreen()).result.current).toBe(false);
	});
});
