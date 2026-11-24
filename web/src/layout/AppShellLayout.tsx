import { Box, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { AfterUpdate } from "../pwa/afterUpdate.js";
import { AppHeader } from "./AppHeader.js";
import { NavRail } from "./NavRail.js";
import type { Notice } from "./NoticeSlot.js";
import { NoticeSlot } from "./NoticeSlot.js";
import type { FooterMode, SetFooterMode } from "./footerMode.js";
import { RAIL_WIDTH } from "./nav.js";
import { SiteFooter } from "./SiteFooter.js";
import type { LayoutVariant } from "./variant.js";
import { useLayoutVariant } from "./variant.js";

/**
 * The one layout host (ADR-014 rule 8; S60). It is the only reader of the
 * viewport: it settles the pairing once and hands `variant` to the page through
 * `children`, so no page or room asks the viewport itself.
 *
 * - **mobile / medium:** the app header with the burger, which opens the nav
 *   rail as a drawer from the left over the page (S56 A2); following a link closes it.
 * - **desktop:** the 240px rail beside the page; the header has no burger and no wordmark,
 *   since the rail's wordmark is right beside it (owner, 2026-11-12).
 * - **game routes** (`/game/:pk`) draw the game top bar in place of the app
 *   header; on desktop the rail stays.
 *
 * The notice slot sits directly under the header (S31 `shell-notice-*`); the reload notice
 * floats fixed at the bottom of the screen instead (shell-scoreboard A6), which `NoticeSlot`
 * decides. The notices' owners pass them in: `notice`, the reload notice (`useUpdateNotice`), and
 * `marker`, the offline marker (S74, `useOfflineNotice`), so both can show at once (A6's
 * Interpretation: the marker stays under the header, only the reload notice floats). On a game
 * route the marker belongs under the game top bar (game-rooms A1), which the game page draws, so
 * the page draws the marker there and the shell leaves it out.
 *
 * After an update (S135, shell-scoreboard A9) `pointer` is the after-update pointer while it shows
 * (`useAfterUpdate`, which already keeps it away whenever A6's box is up). The shell aims it by its
 * own `variant`, never a second viewport read: at the rail's change log link on desktop, at the
 * burger on mobile and medium. Opening the drawer while it shows ends it, and the drawer's change
 * log link stays highlighted until the drawer closes (A9's `updated-pointer-menu-open-*` frames).
 * Game routes draw no app header, so on mobile and medium the pointer has nothing to aim at there
 * and only its time runs.
 *
 * The site footer (S142; shell-scoreboard A14) is the shell's, drawn after `<main>` so it is the
 * page's `contentinfo` and spans the content column edge to edge, never the rail, and never in
 * the drawer. What only the page knows (its live socket open, or the deleted page's "no footer")
 * reaches it through `setFooter`, the setter of a `useState` here that the render prop passes
 * beside `variant` (ADR-024: no store, no context); pages set it with `useFooterMode`. `<main>`
 * doesn't grow, so on a page shorter than the screen the footer follows the content and the
 * leftover height is left empty below it (A14 Short page; owner, 2026-11-19: "A13").
 */
export function AppShellLayout({
	children, notice = null, marker = null, pointer = null,
}: {
	children: (variant: LayoutVariant, setFooter: SetFooterMode) => ReactNode;
	notice?: Notice | null;
	marker?: Notice | null;
	pointer?: AfterUpdate | null;
})
{
	const variant = useLayoutVariant();
	const [opened, { open, close }] = useDisclosure();
	const [drawerHighlight, setDrawerHighlight] = useState(false);
	const [footer, setFooter] = useState<FooterMode>("plain");
	// However the drawer closes (the burger, a link, the overlay, Escape), its link's highlight goes with it.
	const closeDrawer = () =>
	{
		setDrawerHighlight(false);
		close();
	};
	const onBurger = () =>
	{
		if (opened)
		{
			closeDrawer();
			return;
		}
		if (pointer)
		{
			setDrawerHighlight(true);
			pointer.end();
		}
		open();
	};
	const { pathname } = useLocation();
	const desktop = variant === "desktop";
	const gameRoute = pathname.startsWith("/game/");

	return (
		<Box style={{
			display: "flex",
			minHeight: "100vh",
		}}>
			{desktop ? (
				<Box
					component="nav"
					aria-label="Main"
					style={{
						width: RAIL_WIDTH,
						flexShrink: 0,
						position: "sticky",
						top: 0,
						height: "100vh",
						borderRight: "1px solid var(--mantine-color-dark-4)",
					}}
				>
					<NavRail pointer={pointer} />
				</Box>
			) : (
				<Drawer
					opened={opened}
					onClose={closeDrawer}
					size={RAIL_WIDTH}
					padding={0}
					withCloseButton={false}
					title={null}
					aria-label="Navigation"
					styles={{
						body: {
							height: "100%",
						},
					}}
				>
					<nav aria-label="Main" style={{
						height: "100%",
					}}>
						<NavRail onNavigate={closeDrawer} highlight={drawerHighlight} />
					</nav>
				</Drawer>
			)}
			<Box style={{
				flex: 1,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
			}}>
				{gameRoute ? null : <AppHeader burger={!desktop} wordmark={!desktop} drawerOpened={opened} onBurger={onBurger} pointer={desktop ? null : pointer} />}
				<NoticeSlot notice={notice} />
				{gameRoute ? null : <NoticeSlot notice={marker} />}
				<Box component="main" px="md" pb="md" pt={gameRoute ? 0 : "md"}>
					{children(variant, setFooter)}
				</Box>
				{footer === "none" ? null : <SiteFooter live={footer === "live"} variant={variant} />}
			</Box>
		</Box>
	);
}
