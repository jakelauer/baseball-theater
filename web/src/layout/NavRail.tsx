import {
	Box, Stack, Text,
} from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { DevSessionControl } from "../session/DevSessionControl.js";
import { useSession } from "../session/session.js";
import { NAV, activeSection } from "./nav.js";
import { VERSION_LINE } from "./version.js";
import { HomeLink } from "./Wordmark.js";

/** The change log's address (S134; A9, owner 2026-11-10: "The changelog will just be at /changelog."). */
const CHANGELOG_PATH = "/changelog";

/** Whether `pathname` is the change log page; the query string is not part of it, so `/changelog?x=1` counts. */
function isChangelog(pathname: string): boolean
{
	return pathname === CHANGELOG_PATH || pathname.startsWith(`${CHANGELOG_PATH}/`);
}

/**
 * The menu's way to the change log (S134; Figma `changelog-link` 651:13388, shell-scoreboard A9):
 * a link reading "Changelog" at the foot of the rail and the drawer, 10px above the version line,
 * outside the nav list (the page isn't a section, so `activeSection` lights no item there). Plain
 * (Regular 13, Light) everywhere but the change log itself, where it is current: filled Primary and
 * SemiBold, as an active nav item, and `aria-current="page"`. In the drawer `onNavigate` closes it.
 * S135 adds its highlighted state; current wins over it.
 */
function ChangelogLink({ current, onNavigate }: { current: boolean;
	onNavigate?: () => void; })
{
	return (
		<Box
			component={Link}
			to={CHANGELOG_PATH}
			onClick={onNavigate}
			aria-current={current ? "page" : undefined}
			data-testid="changelog-link"
			data-current={current || undefined}
			className={current ? undefined : "bt-hover"}
			style={{
				display: "inline-block",
				padding: "4px 10px",
				borderRadius: 6,
				background: current ? "var(--bt-primary)" : "transparent",
			}}
		>
			<Text component="span" fz={13} fw={current ? 600 : 400} c="var(--bt-light)">
				Changelog
			</Text>
		</Box>
	);
}

/**
 * The 240px nav rail (S31 `nav-rail`): wordmark (the link home), sections with the active one
 * filled Primary and marked `aria-current`, and at its foot the change log link (S134) over the
 * build's version line, which has no label (S56 A2). The desktop host shows it beside the page; on
 * mobile and medium it is the drawer's content, and `onNavigate` closes the drawer.
 *
 * Values from the Figma `nav-rail` (Active=Scoreboard, 163:919; S83): 24px
 * padding, 32px from the wordmark to the list, items 8px apart, each 44px tall
 * with an 8px radius and 12px / 16px padding; a 4×20 marker (2px radius) 12px
 * before the label, Primary Light on the active item and transparent on the
 * others, so every label sits at the same inset; labels 15px Light, the active
 * one SemiBold; the active item filled Primary (`color/brand/primary`, #CE0F0F);
 * the version line 11px Light. An item that isn't active takes the Light wash on hover
 * (`.bt-hover`); the active one is already filled.
 */
export function NavRail({ onNavigate }: { onNavigate?: () => void })
{
	const { pathname } = useLocation();
	const signedIn = useSession().status === "signedIn";
	const active = activeSection(pathname);

	return (
		<Stack h="100%" justify="space-between" p={24} gap="md">
			<Stack gap={32}>
				<Box>
					<HomeLink onClick={onNavigate} />
				</Box>
				<Stack gap={8} component="ul" m={0} p={0} style={{
					listStyle: "none",
				}}>
					{NAV.filter((item) => signedIn || !item.signedInOnly).map((item) =>
					{
						const isActive = item.to === active;
						return (
							<li key={item.to}>
								<Box
									component={Link}
									to={item.to}
									onClick={onNavigate}
									aria-current={isActive ? "page" : undefined}
									data-active={isActive || undefined}
									className={isActive ? undefined : "bt-hover"}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 12,
										height: 44,
										padding: "12px 16px",
										borderRadius: 8,
										background: isActive ? "var(--bt-primary)" : "transparent",
									}}
								>
									<Box
										data-testid="nav-marker"
										aria-hidden
										style={{
											width: 4,
											height: 20,
											borderRadius: 2,
											flexShrink: 0,
											background: isActive ? "var(--bt-primary-light)" : "transparent",
										}}
									/>
									<Text component="span" fz={15} fw={isActive ? 600 : 400} c="var(--bt-light)">
										{item.label}
									</Text>
								</Box>
							</li>
						);
					})}
				</Stack>
			</Stack>
			<Stack gap="xs" align="flex-start">
				<DevSessionControl />
				<ChangelogLink current={isChangelog(pathname)} onNavigate={onNavigate} />
				<Text fz={11} c="var(--bt-light)" data-testid="version-line">
					{VERSION_LINE}
				</Text>
			</Stack>
		</Stack>
	);
}
