import {
	Anchor, Box, Group, Stack, Text,
} from "@mantine/core";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { copyrightYear } from "@bt/domain";
import { useSession } from "../session/session.js";
import { LiveMarker } from "./LiveMarker.js";
import type { LayoutVariant } from "./variant.js";

/** The Support & Community link's address, the r/BaseballTheater subreddit (owner, 2026-11-19; A14 Support & Community). */
const SUPPORT_URL = "https://www.reddit.com/r/BaseballTheater/";

/** One column's heading (A14: 11px IBM Plex Sans Medium, uppercase, muted). */
function Heading({ children }: { children: ReactNode })
{
	return (
		<Text fz={11} fw={500} tt="uppercase" c="var(--bt-muted)" lh="14px" style={{
			letterSpacing: "0.04em",
		}}>
			{children}
		</Text>
	);
}

/**
 * A link to a BT page: same tab, 13px Regular in Light, a link by its place in the column rather
 * than its colour (A14 Columns). A Mantine `Anchor`, so it gets the site-wide hover timing and an
 * underline on hover and focus (owner, 2026-11-12: "Anything that is clickable needs at least a
 * basic hover effect").
 */
function PageLink({ to, children }: { to: string;
	children: ReactNode; })
{
	return (
		<Anchor component={Link} to={to} fz={13} c="var(--bt-light)" lh="18px">
			{children}
		</Anchor>
	);
}

/**
 * The site footer (S142; shell-scoreboard A14, ratified 2026-11-19), the one footer every page
 * the shell draws ends in (ADR-025): `AppShellLayout` renders it after `<main>`, never a page.
 * On a page whose live WebSocket is open (`live`) it opens with A13's `footer-live-strip` (S148):
 * a band edge to edge, 10px above and below, black at 40% over the page, `LiveMarker` centred and
 * nothing beside it. Then a hairline (Light at 12%), two columns of links under their headings,
 * 48px apart at mobile and 64px at medium and desktop, inset 16px or 24px (A14's `Width=Mobile` /
 * `Width=Wide`; owner, 2026-11-19: "24px, as drawn"), and last a centred, muted
 * "© {year} Baseball Theater", the year from `copyrightYear`. Nothing else: no age, no logo, no
 * site address (A14 Nothing else).
 *
 * The list is A14's, all six links: "Baseball Theater" reads About, Changelog, Support & Community,
 * and "Legal" Privacy policy, Terms of use, then Your data (S154 added About, Privacy policy and
 * Terms of use once their pages were served, so no link is dead; A14 No dead links). "Your data"
 * (`/settings`) shows for a signed-in fan only; signed out or while the session loads it is left
 * out, so it never offers a link `SignedInOnly` would bounce, and "Legal" then holds the two policy
 * links alone, as `site-footer-signed-out-mobile` draws.
 */
export function SiteFooter({ live, variant }: { live: boolean;
	variant: LayoutVariant; })
{
	const session = useSession();
	const wide = variant !== "mobile";
	return (
		<Box component="footer" data-testid="site-footer">
			{live ? (
				<Box
					data-testid="footer-live-strip"
					py={10}
					style={{
						background: "rgb(0 0 0 / 40%)",
					}}
				>
					<LiveMarker />
				</Box>
			) : null}
			<Box
				px={wide ? 24 : 16}
				style={{
					borderTop: "1px solid rgb(255 242 211 / 12%)",
				}}
			>
				<Group align="flex-start" gap={wide ? 64 : 48} pt={24}>
					<Stack gap={10}>
						<Heading>Baseball Theater</Heading>
						<PageLink to="/about">About</PageLink>
						<PageLink to="/changelog">Changelog</PageLink>
						{/* It leaves BT, so it opens in a new tab, with no external-link icon (A14 Support & Community). */}
						<Anchor href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" fz={13} c="var(--bt-light)" lh="18px">
							Support & Community
						</Anchor>
					</Stack>
					<Stack gap={10}>
						<Heading>Legal</Heading>
						<PageLink to="/privacy">Privacy policy</PageLink>
						<PageLink to="/terms">Terms of use</PageLink>
						{session.status === "signedIn" ? <PageLink to="/settings">Your data</PageLink> : null}
					</Stack>
				</Group>
				<Text fz={12} c="var(--bt-muted)" ta="center" py={24} lh="16px">
					© {copyrightYear(new Date())} Baseball Theater
				</Text>
			</Box>
		</Box>
	);
}
