/**
 * S148: the page's connection marker (shell-scoreboard A13 `live-marker`): the words are its
 * accessible text, the dot is decoration and blinks slowly, and holds still under reduced motion.
 */
import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { LiveMarker } from "./LiveMarker.js";

/** Answers `matchMedia` as a browser whose reduced-motion preference is `reduce` or not. */
function preferReducedMotion(reduce: boolean)
{
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
		matches: reduce && query.includes("prefers-reduced-motion: reduce"),
		media: query,
		onchange: null,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		dispatchEvent: () => false,
	}));
}

function renderMarker()
{
	render(
		<MantineProvider>
			<LiveMarker />
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("LiveMarker (S148)", () =>
{
	it("S148 AC 3: reads 'Live Data · Active' (a middle dot), the dot aria-hidden, red, glowing, blinking on the 2s bt-live-marker keyframe", () =>
	{
		preferReducedMotion(false);
		renderMarker();
		const words = screen.getByText("Live Data · Active");
		expect(words.textContent).toBe("Live Data · Active");
		const marker = screen.getByTestId("live-marker");
		expect(marker).toHaveTextContent(/^Live Data · Active$/);
		const dot = screen.getByTestId("live-marker-dot");
		expect(dot).toHaveAttribute("aria-hidden", "true");
		expect(dot.style.animation).toMatch(/^bt-live-marker 2s ease-in-out infinite$/);
		expect(dot.style.boxShadow).toBe("0 0 8px var(--bt-primary-light)");
	});

	it("S148 AC 4: under prefers-reduced-motion: reduce the dot still glows but doesn't blink", async () =>
	{
		preferReducedMotion(true);
		renderMarker();
		const dot = screen.getByTestId("live-marker-dot");
		await vi.waitFor(() => expect(dot.style.animation).toBe("none"));
		expect(dot.style.boxShadow).toBe("0 0 8px var(--bt-primary-light)");
		expect(screen.getByText("Live Data · Active")).toBeInTheDocument();
	});

	it("S148 AC 4: styles.css stops the dot's blink under prefers-reduced-motion itself, before the hook has read the preference", () =>
	{
		preferReducedMotion(false);
		renderMarker();
		expect(screen.getByTestId("live-marker-dot")).toHaveClass("bt-live-marker-dot");
		const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");
		const media = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
		// The inline animation outranks a stylesheet rule, so the rule needs !important to win.
		expect(media).toMatch(/\.bt-live-marker-dot\s*\{[^}]*animation:\s*none\s*!important/);
	});
});

