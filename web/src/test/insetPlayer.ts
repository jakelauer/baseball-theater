/**
 * S196 AC 1's check of the dialog player's frame and order, shared by the tests of each host that
 * opens it (PlayerDialog itself, Search, the day digest).
 */
import { waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/** True when `a` comes before `b` in document order. */
export function precedes(a: Element, b: Element): boolean
{
	return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * S196 AC 1's frame and order, shared with Search's and the digest's tests: an inset modal (not full
 * screen, the 90%-of-the-viewport `.bt-player-modal`, rounded) over an overlay that dims the site
 * without hiding it, holding the title (Mantine `md`, one up from `sm`) above the clip, the tool row
 * after it and the disclaimer last. Waits out the opening fade.
 */
export async function expectInsetPlayer(dialog: HTMLElement, title: string): Promise<void>
{
	const content = dialog.closest(".mantine-Modal-content") ?? dialog;
	expect(content).not.toHaveAttribute("data-full-screen");
	expect(content).toHaveClass("bt-player-modal");
	expect(content.getAttribute("style") ?? "").toMatch(/--paper-radius: calc\(0\.75rem/);
	const overlay = document.querySelector<HTMLElement>(".mantine-Modal-overlay")!;
	const background = overlay.style.getPropertyValue("--overlay-bg");
	expect(background).not.toBe("");
	expect(overlayOpacity(background)).toBeLessThan(1);
	// Once its opening fade has run, the overlay shows (the dim is its background's alpha, not this).
	await waitFor(() => expect(Number(overlay.style.opacity || "1")).toBeGreaterThan(0));
	const player = within(dialog).getByTestId("video-player");
	const clip = player.querySelector("video")!;
	const heading = within(player).getByText(title);
	expect(heading.getAttribute("style") ?? "").toMatch(/--mantine-font-size-md/);
	const tools = within(player).getByRole("toolbar", {
		name: "Video actions",
	});
	const disclaimer = within(player).getByText(/^This video is provided by MLBAM/);
	expect(precedes(heading, clip)).toBe(true);
	expect(precedes(clip, tools)).toBe(true);
	expect(precedes(tools, disclaimer)).toBe(true);
	// The disclaimer is the last thing in the player.
	expect(player.lastElementChild!.contains(disclaimer)).toBe(true);
	// The pills ride with the clip, above it, inside the same frame (A10).
	expect(precedes(within(dialog).getByTestId("player-pills"), clip)).toBe(true);
}

/** The alpha of Mantine's overlay background: `rgba(…, a)` or a `color-mix(…, transparent N%)`. */
function overlayOpacity(background: string): number
{
	const rgba = /rgba\([^)]*,\s*([\d.]+)\)/.exec(background);
	if (rgba) return Number(rgba[1]);
	const mix = /transparent\s+([\d.]+)%/.exec(background);
	if (mix) return 1 - Number(mix[1]) / 100;
	return 1;
}
