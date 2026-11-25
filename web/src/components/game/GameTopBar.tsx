import {
	ActionIcon, Box, Group, Skeleton, Text,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { IconChevronLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { gameStatusMarker } from "@bt/domain";
import { formatDate } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { LiveIndicator } from "./LiveIndicator.js";

/** The bar's bottom border, in px: Mantine's default tab line (2px), which the active tab's underline matches. */
const TAB_LINE = 2;

/** What the bar shows of one game: its teams, its day and its MLB status. */
export interface GameTopBarGame
{
	away: string;
	home: string;
	officialDate: string;
	/** The game's MLB status; `gameStatusMarker` reads which marker it gets. */
	status: { codedGameState: string;
		detailedState: string; };
}

interface GameTopBarProps
{
	/**
	 * The game, or `null` while the page knows nothing of it yet (opened by its address, before the game
	 * answers and with no cached day listing it): then the date and matchup are skeletons and Back goes to
	 * the scoreboard's default day (B584, #584).
	 */
	game: GameTopBarGame | null;
	/** True while the game itself is still loading (`aria-busy`): the bar may already show what a cached day listed. */
	busy?: boolean;
	/** The host pairing, from the layout host (views never read the viewport, ADR-014). */
	variant: LayoutVariant;
	/** The room tabs (`Tabs.List`), drawn in the bar's own row (B528); the page owns the `Tabs` around it. */
	tabs?: ReactNode;
}

/**
 * The game view's whole header (S32 `game-topbar`), one row: ← back · that day's date · the room
 * tabs · `AWY @ HOM` · the game status marker. The date sits beside back so back reads as returning
 * to that day's game list, and the matchup takes the date's old place at the right (B530; owner,
 * 2026-11-24: "The team @ team label and the date label in the top bar should swap, to show that the
 * back button returns to the game list", design waived 2026-11-25). The tabs share the row (B528;
 * owner, 2026-11-24: "I'd prefer that to be all one row", design waived 2026-11-25) at medium and
 * desktop. On a phone they can't fit beside the rest, so they wrap to a full-width line of their own
 * inside the bar, scrolling sideways as before (the agent's choice, put to the owner in `.pending`).
 * No score and no venue — the owner keeps them out of the header.
 *
 * The marker (game-shell A7, S170) shows for a game in progress (`LIVE`), delayed or suspended, and
 * for a start delayed before first pitch; any other scheduled game and a final one show none, as
 * ratified ("No status"). It follows the matchup. On a phone a delayed, delayed-start or suspended
 * marker goes on its own line under the team names, right-aligned with them since the swap puts them
 * at the right (owner, 2026-11-22: "Marker on its own line"), while `LIVE` stays beside them ("Keep
 * LIVE beside the teams (Recommended)"); at medium and desktop every marker sits beside the teams
 * (A7: "the top bar at medium is the desktop one"). The date keeps its width and the teams' side
 * narrows, so on a narrow phone a reason longer than the frames' "Rain" wraps under the teams, up to
 * two lines, and the bar grows (owner, 2026-11-23: "It should wrap up to two lines and the space that
 * takes should expand to accompany it").
 *
 * The bar draws before the game answers, from what the page already knows (B584, #584; owner,
 * 2026-11-25: "A game detail is the weirdest one, because the entire navigation chrome goes away"):
 * Back and the tabs are there at once, and only the date and matchup it doesn't know yet are skeletons.
 */
export function GameTopBar({
	game, busy, variant, tabs,
}: GameTopBarProps)
{
	const animate = !useReducedMotion();
	const marker = game ? gameStatusMarker(game.status) : null;
	const indicator = marker ? <LiveIndicator kind={marker.kind} place="topbar" reason={marker.reason} /> : null;
	const phone = variant === "mobile";
	const ownLine = marker !== null && marker.kind !== "live" && phone;
	return (
		// The bottom border runs edge to edge, like the site header's (B585; owner, 2026-11-25: "the
		// border doesn't extend the entire way like it should"): the negative inline margin undoes the
		// shell main's `px="md"` and the bar pads itself back in. With tabs there's no bottom padding,
		// so the tab list sits on the border, and its 2px overlap lets the active tab's underline cover
		// the border, as Mantine's own tab line did (the list draws none of its own; `RoomTabList`).
		<Group component="header" aria-label="Game top bar" data-testid="game-topbar" aria-busy={busy || undefined} justify="space-between" wrap={phone ? "wrap" : "nowrap"} gap="xs" px="md" pt="xs" pb={tabs ? 0 : "xs"} style={{
			marginInline: "calc(var(--mantine-spacing-md) * -1)",
			borderBottom: `${TAB_LINE}px solid var(--mantine-color-dark-4)`,
		}}
		>
			<Group gap="xs" wrap="nowrap" data-testid="topbar-back" style={{
				flexShrink: 0,
			}}
			>
				<ActionIcon component={Link} to={game ? `/games/${game.officialDate}` : "/games"} aria-label="Back to scoreboard" variant="subtle" color="gray">
					<IconChevronLeft size={20} />
				</ActionIcon>
				{game ? (
					<Text size="sm" style={{
						whiteSpace: "nowrap",
					}}
					>{formatDate(game.officialDate)}</Text>
				) : <Skeleton h={12} w={84} radius="sm" animate={animate} />}
			</Group>
			{tabs && !phone ? (
				<Box style={{
					flex: 1,
					minWidth: 0,
					marginBottom: -TAB_LINE,
				}}
				>{tabs}</Box>
			) : null}
			<Group justify="flex-end" wrap="nowrap" data-testid="topbar-matchup" style={{
				flex: tabs && !phone ? "0 1 auto" : 1,
				minWidth: 0,
			}}
			>
				<Box style={{
					minWidth: 0,
					textAlign: "right",
				}}
				>
					<Group gap="xs" wrap="nowrap" justify="flex-end">
						{game ? (
							<Text fw={700} style={{
								whiteSpace: "nowrap",
							}}
							>
								{game.away} @ {game.home}
							</Text>
						) : <Skeleton h={14} w={96} radius="sm" animate={animate} />}
						{ownLine ? null : indicator}
					</Group>
					{ownLine ? (
						<Box data-testid="status-line" style={{
							display: "flex",
							justifyContent: "flex-end",
						}}
						>{indicator}</Box>
					) : null}
				</Box>
			</Group>
			{/* A phone's tabs: their own full-width line, last in the bar (the agent's choice; see the doc comment). */}
			{tabs && phone ? (
				<Box style={{
					flexBasis: "100%",
					minWidth: 0,
					marginBottom: -TAB_LINE,
				}}
				>{tabs}</Box>
			) : null}
		</Group>
	);
}
