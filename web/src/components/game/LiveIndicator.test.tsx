import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GameStatusMarkerKind } from "@bt/domain";
import { LiveIndicator } from "./LiveIndicator.js";
import type { MarkerPlace } from "./LiveIndicator.js";

/** Answers `matchMedia` as a browser whose reduced-motion preference is `reduce`. */
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

function renderIndicator(props: { kind?: GameStatusMarkerKind;
	place?: MarkerPlace;
	reason?: string;
	inning?: string | null; } = {})
{
	render(
		<MantineProvider>
			<LiveIndicator {...props} />
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("LiveIndicator (S60)", () =>
{
	it("blinks the dot beside the LIVE label", () =>
	{
		preferReducedMotion(false);
		renderIndicator();
		expect(screen.getByText("LIVE")).toBeInTheDocument();
		expect(screen.getByTestId("status-marker-dot").style.animation).toMatch(/bt-blink/);
	});

	it("stops blinking under prefers-reduced-motion", async () =>
	{
		preferReducedMotion(true);
		renderIndicator();
		await vi.waitFor(() => expect(screen.getByTestId("status-marker-dot").style.animation).toBe("none"));
	});
});

describe("the game status marker (S170; game-shell A7)", () =>
{
	const labels: [GameStatusMarkerKind, MarkerPlace, string | undefined, string | null, string][] = [
		["live", "topbar", undefined, null, "LIVE"],
		["delayed", "topbar", "Rain", null, "Delayed \u00b7 Rain"],
		["delayed", "topbar", undefined, null, "Delayed"],
		["delayedStart", "topbar", "Rain", null, "Delayed start \u00b7 Rain"],
		["delayedStart", "topbar", undefined, null, "Delayed start"],
		["suspended", "topbar", "Rain", null, "Suspended \u00b7 Rain"],
		["suspended", "topbar", undefined, null, "Suspended"],
		["live", "row", undefined, "Bot 7", "Bot 7"],
		["live", "row", undefined, null, "LIVE"],
		["delayed", "row", "Rain", "Bot 3", "Delayed \u00b7 Bot 3"],
		["delayed", "row", "Rain", null, "Delayed"],
		["delayedStart", "row", "Rain", null, "Delayed start \u00b7 Rain"],
		["delayedStart", "row", undefined, null, "Delayed start"],
		["suspended", "row", "Rain", "Bot 3", "Suspended \u00b7 Rain"],
		["suspended", "row", undefined, "Bot 3", "Suspended"],
	];
	for (const [kind, place, reason, inning, text] of labels)
	{
		it(`S170 AC 2 labels: ${kind} on the ${place}${reason ? ` (${reason})` : ""}${inning ? ` at ${inning}` : ""} reads "${text}"`, () =>
		{
			preferReducedMotion(false);
			renderIndicator({
				kind,
				place,
				reason,
				inning,
			});
			expect(screen.getByTestId("status-marker")).toHaveTextContent(new RegExp(`^${text}$`));
			expect(screen.getByText(text)).toBeInTheDocument();
		});
	}

	for (const kind of ["live", "delayed", "delayedStart", "suspended"] as const)
	{
		it(`S170 AC 2 text-transform: no element from the ${kind} label up to the marker's root is upper-cased`, () =>
		{
			preferReducedMotion(false);
			renderIndicator({
				kind,
				reason: "Rain",
			});
			const root = screen.getByTestId("status-marker");
			let el: HTMLElement | null = screen.getByText(kind === "live" ? "LIVE" : /Rain$/);
			let seen = 0;
			while (el)
			{
				expect(getComputedStyle(el).textTransform).not.toBe("uppercase");
				seen++;
				if (el === root) break;
				el = el.parentElement;
			}
			expect(el).toBe(root);
			expect(seen).toBeGreaterThan(1);
		});

		it(`S170 AC 2 aria-hidden: the ${kind} dot is decoration and the words are the marker`, () =>
		{
			preferReducedMotion(false);
			renderIndicator({
				kind,
				reason: "Rain",
			});
			expect(screen.getByTestId("status-marker-dot")).toHaveAttribute("aria-hidden");
			expect(screen.getByTestId("status-marker")).toHaveAttribute("data-kind", kind);
		});
	}

	it("S170 AC 2 labels: live is the Accent 2 dot; delayed and delayed start a gold dot; suspended a gold ring", () =>
	{
		preferReducedMotion(false);
		for (const kind of ["live", "delayed", "delayedStart", "suspended"] as const)
		{
			renderIndicator({
				kind,
			});
			const dot = screen.getByTestId("status-marker-dot");
			if (kind === "live") expect(dot.style.background).toBe("var(--bt-accent-2)");
			else if (kind === "suspended")
			{
				expect(dot.style.background).toBe("transparent");
				expect(dot.style.border).toContain("var(--bt-accent)");
			}
			else expect(dot.style.background).toBe("var(--bt-accent)");
			cleanup();
		}
	});

	for (const reduce of [false, true])
	{
		it(`S170 AC 5: only live blinks${reduce ? ", and not under reduced motion" : ""}; the other three never do`, async () =>
		{
			preferReducedMotion(reduce);
			for (const kind of ["live", "delayed", "delayedStart", "suspended"] as const)
			{
				renderIndicator({
					kind,
				});
				const dot = screen.getByTestId("status-marker-dot");
				if (kind === "live" && !reduce) expect(dot.style.animation).toMatch(/bt-blink/);
				else await vi.waitFor(() => expect(dot.style.animation).toBe("none"));
				cleanup();
			}
		});
	}
});
