import {
	ActionIcon, Box, Group, Text,
} from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
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
}

/**
 * The game view's whole header (S32 `game-topbar`): ← back to that day's
 * scoreboard · `AWY @ HOM` · the game status marker · date. No score and no venue —
 * the owner keeps them out of the header. The marker (game-shell A7, S170) shows for a
 * game in progress (`LIVE`), delayed or suspended, and for a start delayed before first
 * pitch; any other scheduled game and a final one show none, as ratified ("No status").
 * On a phone a delayed, delayed-start or suspended marker goes on its own line under the
 * team names, since its longer label met the date there (owner, 2026-11-22: "Marker on its
 * own line"), while `LIVE` stays beside them ("Keep LIVE beside the teams (Recommended)");
 * at medium and desktop every marker sits beside the teams (A7: "the top bar at medium is
 * the desktop one"). The date keeps its width and the teams' side narrows, so on a narrow phone
 * a reason longer than the frames' "Rain" wraps under the teams, up to two lines, and the bar
 * grows (owner, 2026-11-23: "It should wrap up to two lines and the space that takes should
 * expand to accompany it").
 */
export function GameTopBar({
	away, home, officialDate, status, variant,
}: GameTopBarProps)
{
	const marker = gameStatusMarker(status);
	const indicator = marker ? <LiveIndicator kind={marker.kind} place="topbar" reason={marker.reason} /> : null;
	const ownLine = marker !== null && marker.kind !== "live" && variant === "mobile";
	return (
		<Group component="header" aria-label="Game top bar" data-testid="game-topbar" justify="space-between" wrap="nowrap" py="xs">
			<Group gap="xs" wrap="nowrap" style={{
				flex: 1,
				minWidth: 0,
			}}
			>
				<ActionIcon component={Link} to={`/games/${officialDate}`} aria-label="Back to scoreboard" variant="subtle" color="gray">
					<IconChevronLeft size={20} />
				</ActionIcon>
				<Box style={{
					minWidth: 0,
				}}
				>
					<Group gap="xs" wrap="nowrap">
						<Text fw={700}>
							{away} @ {home}
						</Text>
						{ownLine ? null : indicator}
					</Group>
					{ownLine ? <Box data-testid="status-line">{indicator}</Box> : null}
				</Box>
			</Group>
			<Text size="sm" style={{
				flexShrink: 0,
			}}
			>{formatDate(officialDate)}</Text>
		</Group>
	);
}
