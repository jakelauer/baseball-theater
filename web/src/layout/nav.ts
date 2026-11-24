/** The app's sections, in rail order (S31 `nav-rail`). */
export const NAV = [
	{
		to: "/games",
		label: "Scoreboard",
	},
	{
		to: "/standings",
		label: "Standings",
	},
	{
		to: "/search",
		label: "Search",
	},
	{
		to: "/settings",
		label: "Settings",
		/** Settings are signed-in only (ADR-027), so signed out the item isn't shown (S56 A2). */
		signedInOnly: true,
	},
];

/**
 * The section a path belongs to, by prefix: a game (`/game/:pk`) is opened from
 * the scoreboard, so it lights Scoreboard (S31 `nav-rail` `Active`). The home page `/` (also the
 * PWA's `start_url`) shows the scoreboard in place with no redirect (#412), so it lights Scoreboard too.
 */
export function activeSection(pathname: string): string | null
{
	if (pathname === "/" || pathname.startsWith("/game/")) return "/games";
	return NAV.find((item) => pathname.startsWith(item.to))?.to ?? null;
}

/**
 * The nav rail's width at every pairing it shows (S31 `nav-rail`), in px, not Mantine's scaled rem:
 * `AppShellLayout` hosts the rail and sizes the drawer at it, and `NavRail` aims the after-update
 * pointer just past it (S135), so the two can't drift apart.
 */
export const RAIL_WIDTH = 240;

/** The change log's address (S134; A9, owner 2026-11-10: "The changelog will just be at /changelog."). */
export const CHANGELOG_PATH = "/changelog";

/**
 * Whether `pathname` is the change log page, matched as React Router matches its route: the whole
 * path, any letter case, a trailing slash allowed. The query string is not part of it, so
 * `/changelog?x=1` counts; `/changelog/x` does not. The menu's link (S134) is current there, and the
 * update notice and the after-update pointer drop their links there (S135, A9's `*-on-changelog-*` frames).
 */
export function isChangelog(pathname: string): boolean
{
	return pathname.toLowerCase().replace(/\/+$/, "") === CHANGELOG_PATH;
}
