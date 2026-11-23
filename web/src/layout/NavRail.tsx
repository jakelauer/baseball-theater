import {
	Box, Stack, Text,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import type { Ref } from "react";
import { Link, useLocation } from "react-router-dom";
import { DevSessionControl } from "../session/DevSessionControl.js";
import { useSession } from "../session/session.js";
import type { AfterUpdate } from "../pwa/afterUpdate.js";
import { AfterUpdatePointer } from "../pwa/afterUpdate.js";
import {
	CHANGELOG_PATH, NAV, activeSection, isChangelog,
} from "./nav.js";
import { VERSION_LINE } from "./version.js";
import { HomeLink } from "./Wordmark.js";

/** The rail's width and padding (Figma `nav-rail`: 240px, 24px; `AppShellLayout` hosts it at that width). */
const RAIL_WIDTH = 240;
const RAIL_PAD = 24;
/** How far past the rail's edge the pointer's box starts (A9 `updated-pointer-desktop`: 11px; Popover adds its arrow's reach, 7px, to the offset). */
const RAIL_POINTER_GAP = 4;

/**
 * The menu's way to the change log (S134; Figma `changelog-link` 651:13388, shell-scoreboard A9):
 * a link reading "Changelog" at the foot of the rail and the drawer, 10px above the version line,
 * outside the nav list (the page isn't a section, so `activeSection` lights no item there). Plain
 * (Regular 13, Light) everywhere but the change log itself, where it is current: filled Primary and
 * SemiBold, as an active nav item, and `aria-current="page"`. In the drawer `onNavigate` closes it.
 * Highlighted (S135; `changelog-link` State=Highlighted) while the after-update pointer aims at it, or in
 * the drawer opened while the pointer showed: Raised current fill, a 1px Primary Light edge and Primary
 * Light SemiBold words. Current wins over highlighted (A9: on the page itself "the rail's link stays current").
 * It is the pointer's Popover target, so it takes the target's `ref` and `aria-describedby`.
 */
function ChangelogLink({
	current, highlighted, onNavigate, ref, ...target
}: {
	current: boolean;
	highlighted: boolean;
	onNavigate?: () => void;
	ref?: Ref<HTMLAnchorElement>;
	"aria-describedby"?: string;
})
{
	const lit = highlighted && !current;
	return (
		<Box
			{...target}
			ref={ref}
			component={Link}
			to={CHANGELOG_PATH}
			onClick={onNavigate}
			aria-current={current ? "page" : undefined}
			data-testid="changelog-link"
			data-current={current || undefined}
			data-highlighted={lit || undefined}
			className={current ? undefined : "bt-hover"}
			style={{
				display: "inline-block",
				padding: lit ? "3px 9px" : "4px 10px",
				borderRadius: 6,
				background: current ? "var(--bt-primary)" : lit ? "var(--bt-raised-current)" : "transparent",
				border: lit ? "1px solid var(--bt-primary-light)" : undefined,
			}}
		>
			<Text component="span" fz={13} fw={current || lit ? 600 : 400} c={lit ? "var(--bt-primary-light)" : "var(--bt-light)"}>
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
 * After an update (S135) the rail's host passes `pointer`, and the after-update pointer aims at the
 * change log link, highlighted while it shows; the drawer's host passes `highlight` instead, when the
 * drawer was opened while the pointer showed (A9's `updated-pointer-menu-open-*` frames).
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
export function NavRail({
	onNavigate, pointer = null, highlight = false,
}: {
	onNavigate?: () => void;
	pointer?: AfterUpdate | null;
	highlight?: boolean;
})
{
	const { pathname } = useLocation();
	// The link's width (its words in the loaded font), so the pointer's gap clears the rail's edge.
	const { ref: linkRef, width: linkWidth } = useElementSize<HTMLAnchorElement>();
	const signedIn = useSession().status === "signedIn";
	const active = activeSection(pathname);

	return (
		<Stack h="100%" justify="space-between" p={RAIL_PAD} gap="md">
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
				{/* Aimed at the link, the popover sits 11px past the rail's edge (A9 `updated-pointer-desktop`),
				    its foot level with the link: the gap is what the rail leaves right of the link, plus that. */}
				<AfterUpdatePointer pointer={pointer} position="right-end" offset={RAIL_WIDTH - RAIL_PAD - linkWidth + RAIL_POINTER_GAP}>
					<ChangelogLink ref={linkRef} current={isChangelog(pathname)} highlighted={highlight || pointer !== null} onNavigate={onNavigate} />
				</AfterUpdatePointer>
				<Text fz={11} c="var(--bt-light)" data-testid="version-line">
					{VERSION_LINE}
				</Text>
			</Stack>
		</Stack>
	);
}
