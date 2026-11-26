import {
	Anchor, Group, SimpleGrid, Stack, Text, UnstyledButton,
} from "@mantine/core";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
	BoxscoreBatter, BoxscoreInfoLine, BoxscorePitcher,
} from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { HiddenValue } from "../HiddenValue.js";
import { TeamSwatch } from "../team/TeamSwatch.js";
import { ViewState } from "../ViewState.js";
import {
	batterLabel, gameInfoLines, infoValue, isRunsBearingLine,
} from "./format.js";
import { Linescore } from "./Linescore.js";
import { STAT_HEAD, StatTable } from "./StatTable.js";
import type { StatColumn } from "./StatTable.js";

type Side = "away" | "home";

/** The batting columns, as the live baseball.theater (v2) heads them: AB R H RBI BB K, then season AVG and OPS. */
const BATTING_COLUMNS: StatColumn<BoxscoreBatter>[] = [
	{
		label: "AB",
		cell: (b) => b.atBats,
	},
	{
		label: "R",
		cell: (b) => b.runs,
	},
	{
		label: "H",
		cell: (b) => b.hits,
	},
	{
		label: "RBI",
		cell: (b) => b.rbi,
	},
	{
		label: "BB",
		cell: (b) => b.baseOnBalls,
	},
	{
		label: "K",
		cell: (b) => b.strikeOuts,
	},
	{
		label: "AVG",
		cell: (b) => b.avg ?? "",
		width: 40,
	},
	{
		label: "OPS",
		cell: (b) => b.ops ?? "",
		width: 40,
	},
];

/**
 * The pitching columns, as the live baseball.theater heads them: IP H R ER BB SO HR, then season ERA
 * and WHIP. With Hide Scores on, the runs a pitcher gave up and his ERA are masked (S207 AC 5).
 */
function pitchingColumns(scoresHidden: boolean): StatColumn<BoxscorePitcher>[]
{
	const runs = (value: ReactNode) => (scoresHidden ? <HiddenValue kind="score" /> : value);
	return [
		{
			label: "IP",
			cell: (p) => p.inningsPitched,
		},
		{
			label: "H",
			cell: (p) => p.hits,
		},
		{
			label: "R",
			cell: (p) => runs(p.runs),
		},
		{
			label: "ER",
			cell: (p) => runs(p.earnedRuns),
		},
		{
			label: "BB",
			cell: (p) => p.baseOnBalls,
		},
		{
			label: "SO",
			cell: (p) => p.strikeOuts,
		},
		{
			label: "HR",
			cell: (p) => p.homeRuns,
		},
		{
			label: "ERA",
			cell: (p) => runs(p.era ?? ""),
			width: 40,
		},
		{
			label: "WHIP",
			cell: (p) => p.whip ?? "",
			width: 40,
		},
	];
}

/** A section's small muted title (`BATTING`, `PITCHING`, `GAME INFO`), the Box room's column-head type. */
function SectionTitle({ children }: { children: ReactNode })
{
	return <Text style={STAT_HEAD}>{children}</Text>;
}

/**
 * One `label: value` line of MLB's details, notes or Game info, the label bold as v2 prints it. With
 * `scoresHidden`, a runs-bearing line's value is masked (`isRunsBearingLine`, S207 AC 5). A line MLB
 * sends with no value (the game's date) shows as its label alone.
 */
function InfoLine({ line, scoresHidden }: { line: BoxscoreInfoLine;
	scoresHidden: boolean; })
{
	if (line.value === "") return <Text fz={12} data-testid="info-line">{line.label}</Text>;
	return (
		<Text fz={12} data-testid="info-line">
			<Text span inherit fw={600}>{line.label}: </Text>
			{scoresHidden && isRunsBearingLine(line.label) ? <HiddenValue kind="score" /> : infoValue(line.value)}
		</Text>
	);
}

/**
 * A batter's `PLAYER` cell, as v2 prints it: MLB's substitute marker in bold (`a-`), then
 * `batterLabel` (`Shaw (PH-DH)`), linking to his MLB player page; a substitute is indented under
 * the player he replaced.
 */
function BatterName({ batter }: { batter: BoxscoreBatter })
{
	return (
		<Text span fz={12} pl={batter.isSubstitute ? 12 : 0} data-substitute={batter.isSubstitute ? "" : undefined}>
			{batter.note ? <Text span inherit fw={700}>{batter.note}</Text> : null}
			<Anchor href={`https://www.mlb.com/player/${batter.id}`} target="_blank" rel="noreferrer nofollow" inherit c="inherit" underline="hover">
				{batterLabel(batter)}
			</Anchor>
		</Text>
	);
}

/** A pitcher's `PLAYER` cell: MLB's `Assad, J`, linking to his MLB player page, as v2 prints it. */
function PitcherName({ pitcher }: { pitcher: BoxscorePitcher })
{
	return (
		<Anchor href={`https://www.mlb.com/player/${pitcher.id}`} target="_blank" rel="noreferrer nofollow" fz={12} c="inherit" underline="hover">
			{pitcher.lastInitName}
		</Anchor>
	);
}

/**
 * One team's box score, in the live baseball.theater's order (S207): BATTING, PITCHING, the
 * lettered notes, then each of MLB's detail groups (BATTING, BASERUNNING, FIELDING) titled, every
 * line as MLB sent it. A part the game has none of (a game stored before S207, or a group MLB didn't
 * send for this team) is not drawn, so no section is ever empty.
 */
function TeamBox({
	game, side, scoresHidden,
}: { game: GamePayload;
	side: Side;
	scoresHidden: boolean; })
{
	const abbr = game.teams[side].abbreviation;
	const team = game.boxscore?.teams[side];
	const pitching = team?.pitching ?? [];
	const notes = team?.notes ?? [];
	const details = team?.details ?? [];
	return (
		<Stack gap="sm">
			<Stack gap={4}>
				<SectionTitle>BATTING</SectionTitle>
				<StatTable
					label={`${abbr} batting`}
					rows={team?.batting ?? []}
					rowKey={(b) => b.id}
					player={(b) => <BatterName batter={b} />}
					columns={BATTING_COLUMNS}
					testId="batting-row"
				/>
			</Stack>
			{pitching.length > 0 ? (
				<Stack gap={4}>
					<SectionTitle>PITCHING</SectionTitle>
					<StatTable
						label={`${abbr} pitching`}
						rows={pitching}
						rowKey={(p) => p.id}
						player={(p) => <PitcherName pitcher={p} />}
						columns={pitchingColumns(scoresHidden)}
						testId="pitching-row"
					/>
				</Stack>
			) : null}
			{notes.length > 0 ? (
				<Stack gap={2} component="section" aria-label={`${abbr} notes`}>
					{notes.map((line) => <InfoLine key={line.label} line={line} scoresHidden={scoresHidden} />)}
				</Stack>
			) : null}
			{details.map((group) => (
				<Stack key={group.title} gap={2} component="section" aria-label={`${abbr} ${group.title}`}>
					<SectionTitle>{group.title}</SectionTitle>
					{group.lines.map((line) => <InfoLine key={line.label} line={line} scoresHidden={scoresHidden} />)}
				</Stack>
			))}
		</Stack>
	);
}

/**
 * A team's swatch and name. The mobile switcher buttons (`heading` false) show the
 * abbreviation centered, as ratified `box-mobile` draws them; the side-by-side tables'
 * headings (`heading` true) show the full team name, aligned with the table's left edge
 * (B586, #586; owner, 2026-11-25: the titles "don't show the entire team name and they
 * are centered").
 */
function TeamLabel({
	game, side, heading = false,
}: { game: GamePayload;
	side: Side;
	heading?: boolean; })
{
	const team = game.teams[side];
	return (
		<Group gap={8} justify={heading ? "flex-start" : "center"} wrap="nowrap">
			<TeamSwatch teamId={team.id} size={8} />
			<Text size="sm" fw={600}>{heading ? team.name : team.abbreviation}</Text>
		</Group>
	);
}

/**
 * The Box room (S2; game-rooms `box-mobile` / `box-medium` / `box-desktop`): the
 * boxed-inning `Linescore`, each team's box score (`TeamBox`: batting, and since S207
 * pitching, notes and MLB's detail groups, laid out as the live baseball.theater lays
 * them out, owner, 2026-11-25: "S206 should match baseball.theater's live site, but
 * styled to look like v3") and the Game info block, every line MLB sends. On mobile a
 * team switcher (each team marked with its `TeamSwatch`) shows one team at a time, away
 * first, as drawn. At medium and desktop both teams show side by side, away on the left
 * and home on the right, each under its full team name (B433, #433; B586, #586; owner,
 * 2026-11-23: "on desktop and tablet, it should show you both teams side by side. The
 * home team is always on the right."). `variant` comes from the layout host
 * (VISUAL-DESIGN §5). Hide Scores leaves the linescore and batting as A3 draws them and
 * masks only the runs-bearing values S207 added (S207 AC 5). Before MLB has a box score,
 * the room's empty state.
 */
export function BoxRoom({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const [side, setSide] = useState<Side>("away");
	const scoresHidden = useScoresHidden(game);
	const { boxscore } = game;
	if (!boxscore)
	{
		return <ViewState kind="empty" message="No box score yet." />;
	}
	const info = gameInfoLines(boxscore.info);

	return (
		<Stack gap="md" data-testid="box-room" data-variant={variant}>
			<Linescore linescore={game.linescore} away={game.teams.away.abbreviation} home={game.teams.home.abbreviation} />

			{variant === "mobile" ? (
				<>
					<SimpleGrid cols={2} spacing="xs" role="group" aria-label="Team">
						{(["away", "home"] as const).map((s) =>
						{
							const selected = s === side;
							return (
								<UnstyledButton
									key={s}
									aria-pressed={selected}
									onClick={() => setSide(s)}
									className={selected ? undefined : "bt-hover"}
									h={38}
									style={{
										borderRadius: "var(--mantine-radius-md)",
										border: `1px solid ${selected ? "var(--bt-light)" : "var(--bt-hairline)"}`,
										background: selected ? "var(--bt-raised-current)" : "transparent",
									}}
								>
									<TeamLabel game={game} side={s} />
								</UnstyledButton>
							);
						})}
					</SimpleGrid>
					<TeamBox game={game} side={side} scoresHidden={scoresHidden} />
				</>
			) : (
				<SimpleGrid cols={2} spacing="lg">
					{(["away", "home"] as const).map((s) => (
						<Stack key={s} gap="xs" data-testid="box-team">
							<TeamLabel game={game} side={s} heading />
							<TeamBox game={game} side={s} scoresHidden={scoresHidden} />
						</Stack>
					))}
				</SimpleGrid>
			)}

			{info.length > 0 ? (
				<Stack gap={2} component="section" aria-label="Game info">
					<SectionTitle>GAME INFO</SectionTitle>
					{info.map((line) => <InfoLine key={line.label} line={line} scoresHidden={scoresHidden} />)}
				</Stack>
			) : null}
		</Stack>
	);
}
