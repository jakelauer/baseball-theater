import {
	Box, Group, Paper, Text,
} from "@mantine/core";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
	formatGameTime, gamePhase, gameStatusMarker, inningShortLabel, probableLine, slotOccupant, teamRecordLabel,
} from "@bt/domain";
import type { GamePhase } from "@bt/domain";
import type { ScheduleDayPayload } from "../../api/schedule.js";
import { viewerTimeZone } from "../../format/datetime.js";
import { useSettings } from "../../settings/store.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { HiddenValue } from "../HiddenValue.js";
import { probableLabel, probableSpoken } from "../game/format.js";
import { LiveIndicator } from "../game/LiveIndicator.js";
import { TeamEdge } from "../team/TeamEdge.js";
import { GameRowSlot, SLOT_WIDTH } from "./GameRowSlot.js";

export type ScoreboardGame = ScheduleDayPayload["games"][number];

/** Name and record on the left, then R · H · E: the frames' 28px score columns. */
const SCORED_GRID = "minmax(0, 1fr) repeat(3, 28px)";

/** A scheduled row: each team, then its probable pitcher beside it (shell-scoreboard A16). */
export const SCHEDULED_GRID = "minmax(0, 1fr) minmax(0, 1fr)";

/**
 * The least width a delayed start's venue keeps beside the reason, in px (S170): room for "· "
 * and about eight letters before its ellipsis. With less free beside the reason the venue drops
 * to a line of its own below (owner, 2026-11-23: "Its own line below (Recommended)"). Set under
 * the 85px the frames' "Delayed start · Rain" row leaves at 390px, so that row keeps the venue
 * beside the reason, truncated, as drawn.
 */
export const VENUE_MIN_WIDTH = 64;

type Probable = NonNullable<ScoreboardGame["probablePitchers"]>["away"];

/**
 * The card link's accessible name. Its `aria-label` replaces the text inside it, so on a
 * scheduled row it also names the probables (S171), which are drawn inside the link:
 * `Braves at Phillies, probable pitchers M. Pérez, left-handed, and Z. Wheeler,
 * right-handed`, a side MLB names none for read as "to be announced".
 */
function cardLabel(game: ScoreboardGame, scored: boolean): string
{
	const matchup = `${game.teams.away.teamName} at ${game.teams.home.teamName}`;
	const { away, home } = game.probablePitchers ?? {};
	if (scored || (!away && !home)) return matchup;
	const spoken = (pitcher: Probable | undefined) => (pitcher ? probableSpoken(pitcher) : "to be announced");
	return `${matchup}, probable pitchers ${spoken(away)}, and ${spoken(home)}`;
}

const HEAD: CSSProperties = {
	color: "var(--bt-muted)",
	fontSize: 11,
	fontWeight: 700,
	textAlign: "center",
};

/**
 * The top-left status of a module (S31): `FINAL`, the game status marker (game-shell A7,
 * S170), or the start time in the viewer's zone and the venue. A live game's marker reads its
 * inning (`Bot 7`, `LIVE` with none yet), a delayed one keeps its inning (`Delayed · Bot 3`) and
 * a suspended one names MLB's reason (`Suspended · Rain`); a delayed start takes the start time's
 * place, before the venue (`Delayed start · Rain · Citi Field`). Venue shows on scheduled games
 * only (R8). A delayed start's line wraps: its reason takes up to two lines, and the venue stays
 * beside it while `VENUE_MIN_WIDTH` is free there, truncated, else drops to a line below, so the
 * row grows (owner, 2026-11-23: "Its own line below (Recommended)"). Other scheduled rows keep
 * the start time and venue on one line.
 */
function StatusLine({ game, phase }: { game: ScoreboardGame;
	phase: GamePhase; })
{
	const marker = gameStatusMarker(game.status);
	if (phase === "live" && marker)
	{
		return <LiveIndicator kind={marker.kind} place="row" reason={marker.reason} inning={inningShortLabel(game.linescore)} />;
	}
	if (phase === "final")
	{
		return <Text size="xs" fw={700}>FINAL</Text>;
	}
	const delayedStart = marker?.kind === "delayedStart";
	return (
		<Group gap={6} wrap={delayedStart ? "wrap" : "nowrap"} style={{
			minWidth: 0,
		}}
		>
			{/* The marker keeps a flex item's default (`0 1 auto`) and its own `minWidth: 0`: its text's width while that fits, narrower (wrapped) when not. */}
			{delayedStart ? <LiveIndicator kind="delayedStart" place="row" reason={marker.reason} /> : game.startTime ? (
				<Text size="xs" fw={700} c="var(--bt-accent)" style={{
					whiteSpace: "nowrap",
				}}
				>
					{formatGameTime(game.startTime, viewerTimeZone())}
				</Text>
			) : null}
			{game.venue ? <Text size="xs" truncate style={delayedStart ? {
				flex: `1 1 ${VENUE_MIN_WIDTH}px`,
				minWidth: VENUE_MIN_WIDTH,
			} : undefined}
			>· {game.venue.name}</Text> : null}
		</Group>
	);
}

/** One team's row: its color edge, club name, and the record line under it (masked with scores hidden). */
function TeamCell({
	team, phase, hidden,
}: { team: ScoreboardGame["teams"]["away"];
	phase: GamePhase;
	hidden: boolean; })
{
	const record = hidden ? <>{team.abbreviation} (<HiddenValue kind="record" />)</> : teamRecordLabel(team, phase);
	return (
		<Group gap={8} wrap="nowrap" mih={36} data-testid="team-row" style={{
			minWidth: 0,
		}}
		>
			<TeamEdge teamId={team.id} />
			<Box style={{
				minWidth: 0,
			}}
			>
				<Text fw={700} tt="uppercase" lh={1.2} truncate>{team.teamName}</Text>
				{record ? <Text size="xs" lh={1.3}>{record}</Text> : null}
			</Box>
		</Group>
	);
}

/**
 * A side's probable pitcher on a scheduled row (S171; A16): his `probableLabel` over his
 * season line `11-5, 3.12`, or `TBD` when MLB names none. Hide Scores leaves it as it
 * is (A3): a probable and his line give nothing of a result away.
 */
function ProbableCell({ pitcher }: { pitcher: Probable | undefined })
{
	const line = pitcher ? probableLine(pitcher) : null;
	return (
		<Box data-testid="row-probable" style={{
			minWidth: 0,
		}}
		>
			<Text fz={14} fw={600} lh={1.2} truncate>{pitcher ? probableLabel(pitcher) : "TBD"}</Text>
			{line ? <Text size="xs" lh={1.3}>{line}</Text> : null}
		</Box>
	);
}

/**
 * A game on the scoreboard — the ratified `Rich Scoreboard Module` (S31, S66), one
 * component for final, live and scheduled games. Final and live rows show R · H · E
 * beside each team and the abbreviation with its record (R7); a scheduled row shows
 * the record with its percentage, the start time and the venue, and each side's probable
 * pitcher beside its team (S171; A16). Team color is a 4px
 * edge only; names and numbers stay Light. Every label comes from `packages/domain`
 * (phase, inning, record, start time); this only lays them out. The right-hand slot
 * (S67) shows what the user's Game-Row Slot setting picks; where it picks none (Status
 * on a scheduled row) the box's width stays empty, so the row's left area is the same
 * width with and without it (A16: "the space the box took stays empty"). The whole module is the link
 * to the game (owner, 2026-11-12: "the entire game card should be clickable in the games
 * list"): the link's box is stretched over the card (`.bt-card-link`), so the slot and the
 * padding click through to it, while the Room Menu's own links sit above it
 * (`.bt-above-card-link`) — one link, no link nested in another. The card lifts on hover
 * (`.bt-card`). With Hide Scores on (S68, `useScoresHidden`) the R · H · E cells,
 * records and pitchers of record are masked by `HiddenValue` in place, so the module
 * keeps its size; collapsed bars are `CollapsedBar`.
 */
export function ScoreboardModule({ game }: { game: ScoreboardGame })
{
	const phase = gamePhase(game.status.codedGameState);
	const teams = [game.teams.away, game.teams.home];
	const lines = [game.linescore?.teams.away, game.linescore?.teams.home];
	const probables = [game.probablePitchers?.away, game.probablePitchers?.home];
	const scored = phase !== "pregame";
	const { gameRowSlot } = useSettings();
	const slotless = slotOccupant(gameRowSlot, phase) === null;
	const hidden = useScoresHidden(game);
	return (
		<Paper
			data-testid="scoreboard-module"
			data-phase={phase}
			bg="var(--bt-raised)"
			radius="md"
			p={12}
			className="bt-card"
			style={{
				position: "relative",
				display: "flex",
				gap: 12,
				border: "1px solid var(--bt-hairline)",
			}}
		>
			<Box
				component={Link}
				to={`/game/${game.gamePk}`}
				aria-label={cardLabel(game, scored)}
				className="bt-card-link"
				style={{
					flex: 1,
					minWidth: 0,
					color: "inherit",
					textDecoration: "none",
					display: "grid",
					gridTemplateColumns: scored ? SCORED_GRID : SCHEDULED_GRID,
					alignItems: "center",
					rowGap: 8,
				}}
			>
				<Box mih={20} style={{
					display: "flex",
					alignItems: "center",
					minWidth: 0,
					gridColumn: scored ? undefined : "1 / -1",
				}}
				>
					<StatusLine game={game} phase={phase} />
				</Box>
				{scored ? ["R", "H", "E"].map((h) => <Text key={h} span style={HEAD}>{h}</Text>) : null}
				{teams.map((team, i) => (
					<Box key={team.id} style={{
						display: "contents",
					}}
					>
						<TeamCell team={team} phase={phase} hidden={hidden} />
						{scored ? (
							<>
								<Text ta="center" fz={18} fw={700} data-testid="runs">{hidden ? <HiddenValue kind="score" /> : lines[i]?.runs ?? "–"}</Text>
								<Text ta="center" fz={14} data-testid="hits">{hidden ? <HiddenValue kind="score" /> : lines[i]?.hits ?? "–"}</Text>
								<Text ta="center" fz={14} data-testid="errors">{hidden ? <HiddenValue kind="score" /> : lines[i]?.errors ?? "–"}</Text>
							</>
						) : <ProbableCell pitcher={probables[i]} />}
					</Box>
				))}
			</Box>
			{slotless ? <Box data-testid="game-row-slot-space" aria-hidden w={SLOT_WIDTH} style={{
				flexShrink: 0,
			}}
			/> : <GameRowSlot game={game} setting={gameRowSlot} scoresHidden={hidden} />}
		</Paper>
	);
}
