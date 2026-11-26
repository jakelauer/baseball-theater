import {
	Anchor, Button, Group, Paper, Text,
} from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { bottomFloat } from "../components/videos/CornerPlayer.js";
import { CHANGELOG_PATH, isChangelog } from "./nav.js";

/**
 * An app-level notice (S31 `notice-banner`, 438:2959), in one of two places:
 *
 * - **The "reload to update" notice** (S28's retired version, S73's waiting worker) has
 *   `update`: shell-scoreboard A6 (ratified 2026-11-02) floats it in a box fixed at the
 *   bottom of the screen, its message on top and two right-aligned buttons underneath,
 *   Snooze then Update Now. A6 repealed its ✕ and `Reload` link and its place under the header.
 *   A9 (S135) puts the link "See the changelog" at the left of its button row (Figma `update-notice`
 *   762:22596, `Link=Yes`), the retired-version notice too, and leaves it off on the change log page
 *   itself (`Link=No`). It shows no addition from the release notes and asks the server nothing,
 *   so it is up the moment the update is known (owner, 2026-11-10).
 * - **A marker** with no actions (S74's offline marker) stays in the slot under the header
 *   and holds until its owner clears it.
 *
 * What Snooze remembers is the notice owner's business (`useUpdateNotice`), not the slot's.
 */
export interface Notice
{
	/** Identifies this notice (a React key, and what tests and captures tell apart). */
	id: string;
	message: string;
	/** A6's two buttons: Update Now moves to the new version; Snooze hides the notice for an hour. */
	update?: {
		onUpdate: () => void;
		onSnooze: () => void;
	};
}

/**
 * The notice itself: the message, then (for the reload notice) the change log link at the left
 * (A9, but not on the change log page), and Snooze as the secondary button and Update Now as the
 * primary one, right-aligned so Update Now sits at the far right (A6's interpretation). The one notice component (ADR-025): every notice in the app draws through it.
 */
export function NoticeBanner({ notice }: { notice: Notice })
{
	const onChangelog = isChangelog(useLocation().pathname);
	return (
		<Paper role="status" bg="var(--bt-raised)" radius="md" px="md" py="sm" withBorder shadow={notice.update ? "md" : undefined}>
			<Text size="sm">{notice.message}</Text>
			{notice.update ? (
				<Group gap="xs" mt="sm" wrap="nowrap">
					{onChangelog ? null : (
						<Anchor component={Link} to={CHANGELOG_PATH} fz={13} fw={600} c="var(--bt-primary-light)" underline="never">
							See the changelog
						</Anchor>
					)}
					<Group gap="xs" wrap="nowrap" ml="auto">
						<Button size="xs" variant="default" onClick={notice.update.onSnooze}>Snooze</Button>
						<Button size="xs" onClick={notice.update.onUpdate}>Update Now</Button>
					</Group>
				</Group>
			) : null}
		</Paper>
	);
}

/**
 * Where the shell draws its one notice (S31 `notice-slot`; A6). A reload notice floats fixed
 * at the bottom right, clear of the home indicator when installed (`env(safe-area-inset-bottom)`
 * is 0 in a browser tab), as wide as the screen's gutters allow on mobile and at most 420px
 * otherwise. Its z-index (150) is above the page, Plays' sticky inning sidebar included, and
 * below Mantine's modals and drawers (200), so the video player's scrim covers it. Its `bottomFloat` ref
 * keeps the corner mini-player above it (S198). Any other
 * notice sits in the slot directly under the header. `flush` is a slot drawn inside the page's own
 * content, already inset by `<main>`'s padding (S74: the offline marker under the game top bar,
 * game-rooms A1), so it adds no side inset of its own.
 */
export function NoticeSlot({ notice, flush = false }: { notice: Notice | null;
	flush?: boolean; })
{
	if (!notice) return null;
	if (notice.update)
	{
		return (
			<div data-testid="notice-float" ref={bottomFloat} style={{
				position: "fixed",
				right: 16,
				bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
				zIndex: 150,
				width: "min(420px, calc(100vw - 32px))",
			}}>
				<NoticeBanner notice={notice} />
			</div>
		);
	}
	return (
		<div data-testid="notice-slot" style={{
			padding: flush ? "12px 0 0" : "12px 16px 0",
		}}>
			<NoticeBanner notice={notice} />
		</div>
	);
}
