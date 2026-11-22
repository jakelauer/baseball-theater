import { Box } from "@mantine/core";
import { LiveMarker } from "./LiveMarker.js";

/**
 * The foot of a page (S148; shell-scoreboard A13), replacing the `footer-meta` line's
 * "Fetched {age} · baseball.theater" line, which A13 removes whole. While the page's live
 * WebSocket is open (`live`), it is A13's `footer-live-strip`: a band spanning the content
 * column edge to edge, 10px above and below, filled slightly darker than the page (black at
 * 40% over `Dark`), with `LiveMarker` centred in it and nothing beside it. Otherwise it draws
 * nothing: until S142 builds S141's footer of links (A14) into this same component, a page
 * with no open socket ends with no footer line at all (A13 No socket). This is the only place
 * the strip is drawn (ADR-025); a page passes whether its socket is open and nothing else.
 */
export function SiteFooter({ live }: { live: boolean })
{
	if (!live) return null;
	return (
		// The page's main column pads its content by `md` on each side (`AppShellLayout`); the
		// footer bleeds through that padding so the strip spans the column edge to edge, as A13 draws it.
		<Box component="footer" data-testid="site-footer" mx="calc(var(--mantine-spacing-md) * -1)">
			<Box
				data-testid="footer-live-strip"
				py={10}
				style={{
					background: "rgb(0 0 0 / 40%)",
				}}
			>
				<LiveMarker />
			</Box>
		</Box>
	);
}
