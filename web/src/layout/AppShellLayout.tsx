import { Box, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	Component, Suspense, lazy, useState,
} from "react";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { AfterUpdate } from "../pwa/afterUpdate.js";
import { UpdatedNotice } from "../pwa/UpdatedNotice.js";
import { CornerSpace, PlayerProvider } from "../components/videos/PlayerProvider.js";
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
 * The change log modal and the page it holds, loaded the first time the game page's notice opens it, so
 * neither is in the entry chunk (S193; S110). A fresh `lazy` each time, since one whose load failed keeps
 * the failure: after a failed load the shell takes a new one, so the next opening tries again.
 */
function loadChangelogModal()
{
	return lazy(() => import("../pwa/ChangelogModal.js").then((m) => ({
		default: m.ChangelogModal,
	})));
}

/**
 * Catches a failed load of the change log modal (a dropped connection right after an update, Claude's
 * review of PR #566): without it `lazy` rethrows during render and, with no boundary above, React
 * unmounts the whole app. It draws nothing and tells the shell, which closes the modal and readies a
 * retry, so the game page stays as it was.
 */
class ChangelogLoadBoundary extends Component<{ onFail: () => void;
	children: ReactNode; }, { failed: boolean }>
{
	override state = {
		failed: false,
	};

	static getDerivedStateFromError(): { failed: boolean }
	{
		return {
			failed: true,
		};
	}

	override componentDidCatch(): void
	{
		this.props.onFail();
	}

	override render(): ReactNode
	{
		return this.state.failed ? null : this.props.children;
	}
}

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
 * Game routes draw no app header, so on mobile and medium the pointer has nothing to aim at there;
 * the shell draws A17's notice in its place (S193, `UpdatedNotice`), which a tap turns into the change
 * log over the game page (`ChangelogModal`). Both are the same `pointer`, so moving between a game page
 * and another page hands the rest of its 10 seconds over either way (A17, "Moving between pages"), as
 * does turning a tablet to the desktop layout, where the rail's pointer takes over. Whether the modal is
 * open is the shell's state, not the notice's, so it stays open when the notice ends (A6's box coming
 * up, A17's "the modal, once the fan has opened it, stays open").
 *
 * The site footer (S142; shell-scoreboard A14) is the shell's, drawn after `<main>` so it is the
 * page's `contentinfo` and spans the content column edge to edge, never the rail, and never in
 * the drawer. What only the page knows (its live socket open, or the deleted page's "no footer")
 * reaches it through `setFooter`, the setter of a `useState` here that the render prop passes
 * beside `variant` (ADR-024: no store, no context); pages set it with `useFooterMode`. The footer is
 * never pinned (A14 Short page), but `<main>` grows to fill the window's leftover height, so on a
 * page shorter than the screen the footer sits at the window's bottom, and on a taller one it follows
 * the content (B525, #525; owner, 2026-11-24: "It's never pinned, but the content's minimum height
 * should be either a percentage of the viewport height or something similar to avoid a highwater
 * footer"). The shell's `.bt-shell` class (`styles.css`) makes it at least the window's height,
 * `100dvh` after a `100vh` fallback, which an inline style can't express.
 *
 * The shell holds the one video player (S198, `PlayerProvider`) around the header, the pages and the
 * footer, so a route change never unmounts it and a playing clip carries on in the corner player
 * while the fan browses. While the corner shows, `CornerSpace` after the footer leaves room for it, so
 * the footer, its Live strip included, scrolls clear above it.
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
	const [changelogOpen, setChangelogOpen] = useState(false);
	// Mounted from its first opening on, so its close transition still runs after it closes.
	const [changelogUsed, setChangelogUsed] = useState(false);
	const [ChangelogModal, setChangelogModal] = useState(loadChangelogModal);
	// A failed load: closed, unmounted, and a new `lazy` ready for the next opening.
	const changelogFailed = () =>
	{
		setChangelogOpen(false);
		setChangelogUsed(false);
		setChangelogModal(() => loadChangelogModal());
	};
	const openChangelog = () =>
	{
		setChangelogUsed(true);
		setChangelogOpen(true);
	};
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
		<PlayerProvider variant={variant}>
			<Box className="bt-shell">
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
					<Box component="main" px="md" pb="md" pt={gameRoute ? 0 : "md"} style={{
						flexGrow: 1,
					}}>
						{children(variant, setFooter)}
					</Box>
					{footer === "none" ? null : <SiteFooter live={footer === "live"} variant={variant} />}
					{gameRoute && !desktop ? <UpdatedNotice pointer={pointer} variant={variant} onOpen={openChangelog} /> : null}
					{changelogUsed ? (
						<ChangelogLoadBoundary onFail={changelogFailed}>
							<Suspense fallback={null}>
								<ChangelogModal opened={changelogOpen} onClose={() => setChangelogOpen(false)} variant={variant} />
							</Suspense>
						</ChangelogLoadBoundary>
					) : null}
					<CornerSpace variant={variant} />
				</Box>
			</Box>
		</PlayerProvider>
	);
}
