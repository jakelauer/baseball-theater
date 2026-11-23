import { useLayoutEffect } from "react";

/**
 * What the page under the shell tells the footer (S142): `"plain"`, the footer of links;
 * `"live"`, the same opened by A13's Live strip, while the page's live WebSocket is open; `"none"`,
 * no footer at all (the account-deleted Settings page, standings-search-settings A5).
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
 */
export function useFooterMode(setFooter: SetFooterMode | undefined, mode: FooterMode): void
{
	useLayoutEffect(() =>
	{
		if (!setFooter) return;
		setFooter(mode);
		return () => setFooter("plain");
	}, [setFooter, mode]);
}
