import { useLayoutEffect } from "react";

/**
 * What the page under the shell tells the footer (S142): `"plain"`, the footer of links;
 * `"live"`, the same opened by A13's Live strip, while the page's live WebSocket is open; `"none"`,
 * no footer: on the account-deleted Settings page for good (standings-search-settings A5), and on
 * any page while it shows its loading state. A footer drawn under a loading page sits at the
 * window's bottom (`<main>` fills the leftover height, B525) and is pushed down when taller content
 * arrives, a layout shift (CI's Lighthouse budget, CLS ≤ 0.1); drawn only once the page has settled, it
 * appears below the content and nothing moves.
 */
export type FooterMode = "plain" | "live" | "none";

/** The setter `AppShellLayout` hands each page beside `variant` (`children(variant, setFooter)`). */
export type SetFooterMode = (mode: FooterMode) => void;

/**
 * A page's say over the shell's footer (S142): sets `mode` while the page is mounted and puts the
 * footer back to `"plain"` when it unmounts, so the next page never inherits a strip or a missing
 * footer. `setFooter` is optional because a page rendered on its own (a test with no shell) has no
 * footer to tell. A layout effect, so the deleted page never paints one frame with the footer. The
 * shell's `useState` setter is stable, so this runs again only when `mode` does.
 *
 * `null` is no say at all: a wrapper (the default day, the session gate) that only holds the footer
 * back while it waits passes `null` once it renders the page, since a parent's layout effect runs
 * after its child's and would otherwise overwrite the page's own mode.
 */
export function useFooterMode(setFooter: SetFooterMode | undefined, mode: FooterMode | null): void
{
	useLayoutEffect(() =>
	{
		if (!setFooter || mode === null) return;
		setFooter(mode);
		return () => setFooter("plain");
	}, [setFooter, mode]);
}
