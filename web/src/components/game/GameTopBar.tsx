import {
	ActionIcon, Box, Group, Text,
} from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { gameStatusMarker } from "@bt/domain";
import { formatDate } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { LiveIndicator } from "./LiveIndicator.js";

interface GameTopBarProps
{
	away: string;
	home: string;
	officialDate: string;
	/** The game's MLB status; `gameStatusMarker` reads which marker it gets. */
	status: { codedGameState: string;
		detailedState: string; };
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
 */
export function GameTopBar({
	away, home, officialDate, status, variant, tabs,
}: GameTopBarProps)
{
	const marker = gameStatusMarker(status);
	const indicator = marker ? <LiveIndicator kind={marker.kind} place="topbar" reason={marker.reason} /> : null;
	const phone = variant === "mobile";
	const ownLine = marker !== null && marker.kind !== "live" && phone;
	return (
		<Group component="header" aria-label="Game top bar" data-testid="game-topbar" justify="space-between" wrap={phone ? "wrap" : "nowrap"} gap="xs" py="xs">
			<Group gap="xs" wrap="nowrap" data-testid="topbar-back" style={{
				flexShrink: 0,
			}}
			>
				<ActionIcon component={Link} to={`/games/${officialDate}`} aria-label="Back to scoreboard" variant="subtle" color="gray">
					<IconChevronLeft size={20} />
				</ActionIcon>
				<Text size="sm" style={{
					whiteSpace: "nowrap",
				}}
				>{formatDate(officialDate)}</Text>
			</Group>
			{tabs && !phone ? (
				<Box style={{
					flex: 1,
					minWidth: 0,
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
						<Text fw={700} style={{
							whiteSpace: "nowrap",
						}}
						>
							{away} @ {home}
						</Text>
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
				}}
				>{tabs}</Box>
			) : null}
		</Group>
	);
}
