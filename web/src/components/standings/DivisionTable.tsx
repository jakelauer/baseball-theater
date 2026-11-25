import {
	Box, Group, Stack, Table, Text, Title,
} from "@mantine/core";
import type { StandingsPayload } from "../../api/standings.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { TeamSwatch } from "../team/TeamSwatch.js";

type Division = StandingsPayload["divisions"][number];
type Team = Division["teams"][number];

/**
 * Which columns a table draws (standings-search-settings A9, `standings-division`'s `Columns`):
 * `full` is the regular season's W, L, PCT and GB; `spring` leaves out GB (owner, 2026-11-10:
 * "Just don't show the column."); `teams` is the playoffs list, the teams with no numbers.
 */
export type DivisionColumns = "full" | "spring" | "teams";

/** A muted column head, as the frames draw `TEAM  W  L  PCT  GB`. */
function Head({ children, align = "right" }: { children: string;
	align?: "left" | "right"; })
{
	return (
		<Table.Th ta={align} fz={11} fw={700} c="var(--bt-muted)" tt="uppercase">
			{children}
		</Table.Th>
	);
}

/**
 * The team as its row names it: the full name, or on mobile its abbreviation (A7), after MLB's clinch
 * letter and a hyphen when the team has clinched (A9: `z-New York Yankees`, `z-NYY`). Any letter MLB
 * sends is printed (owner, 2026-11-20: "Print it anyway"); a clinched team with none (`null`, or an
 * answer cached before S160 that lacks the field) gets no prefix.
 */
function teamLabel(team: Team, short: boolean): string
{
	const name = short ? team.abbreviation ?? team.name : team.name;
	const letter = team.clinched ? team.clinchIndicator ?? null : null;
	return letter ? `${letter}-${name}` : name;
}

/**
 * One division's table (S4; standings-search-settings `standings-*`, A7, A9): the division name as
 * its heading, then each team in rank order — color swatch and name, abbreviation, then the figures
 * `columns` names. The leader's GB is "—": MLB's `"-"` arrives as `null` (the standings mapper), so
 * the dash is drawn here, never stored. The heading is MLB's short name for the division, `nameShort`
 * (`AL East`, the text the ratified frames show; S102), and otherwise the table's full `name` (a league
 * table before 1969 has no division, so it is `American League`).
 *
 * Every variant fills its column's width (owner, 2026-11-25, #587: "The standings should also not be
 * floating mini columns on desktop; they should expand their widths."), the team column taking the
 * spare room so the figures stay packed at the right. On medium and desktop that column is at least
 * 166px, or 192px in a table with a clinched team so a bold name with its letter fits (A7, A9), and the
 * table scrolls inside its own box when its column is narrower than that; on mobile each team is its
 * abbreviation beside its swatch, with no abbreviation column (A9). A clinched team's row is bold
 * throughout (A9 "Clinched teams"); the other rows keep the regular figures.
 */
export function DivisionTable({
	division, columns = "full", variant = "desktop",
}: { division: Division;
	columns?: DivisionColumns;
	variant?: LayoutVariant; })
{
	const heading = division.nameShort ?? division.name ?? "Division";
	const short = variant === "mobile";
	const anyClinched = division.teams.some((team) => team.clinched);
	const figures = columns !== "teams";
	return (
		<Stack gap={4} data-testid="division-table">
			<Title order={3} fz={18}>{heading}</Title>
			{/* A table wider than its column (two leagues side by side at 768px, #434) scrolls here, so the
			box takes focus and is named for its table, letting a keyboard reach and scroll it. */}
			<Box
				tabIndex={0}
				role="region"
				aria-label={`${heading} standings`}
				style={{
					overflowX: "auto",
				}}
			>
				<Table
					verticalSpacing={8}
					horizontalSpacing={8}
					borderColor="var(--bt-hairline)"
					aria-label={`${heading} standings`}
					w="100%"
				>
					<Table.Thead>
						<Table.Tr>
							<Head align="left">Team</Head>
							{short ? null : <Table.Th aria-label="Abbreviation" />}
							{figures ? <Head>W</Head> : null}
							{figures ? <Head>L</Head> : null}
							{figures ? <Head>PCT</Head> : null}
							{columns === "full" ? <Head>GB</Head> : null}
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{division.teams.map((team) =>
						{
							const weight = team.clinched ? 700 : 400;
							return (
								<Table.Tr key={team.teamId} data-testid="standings-row" data-clinched={team.clinched || undefined}>
									<Table.Td w="100%">
										{/* The 166/192px minimum sits on the cell's content, less the cell's 8px padding each
										side, since browsers don't reliably honour a table cell's own min-width. */}
										<Group gap={10} wrap="nowrap" miw={short ? undefined : anyClinched ? 192 - 16 : 166 - 16}>
											<TeamSwatch teamId={team.teamId} />
											<Text fz={13} fw={team.clinched ? 700 : 500} style={{
												whiteSpace: "nowrap",
											}}
											>
												{teamLabel(team, short)}
											</Text>
										</Group>
									</Table.Td>
									{short ? null : <Table.Td ta="right" fz={12} fw={weight} c="var(--bt-muted)">{team.abbreviation}</Table.Td>}
									{figures ? <Table.Td ta="right" fz={13} fw={weight}>{team.wins}</Table.Td> : null}
									{figures ? <Table.Td ta="right" fz={13} fw={weight}>{team.losses}</Table.Td> : null}
									{figures ? <Table.Td ta="right" fz={13} fw={weight}>{team.pct ?? "—"}</Table.Td> : null}
									{columns === "full"
										? <Table.Td ta="right" fz={13} fw={weight} c="var(--bt-muted)" data-testid="games-back">{team.gamesBack ?? "—"}</Table.Td>
										: null}
								</Table.Tr>
							);
						})}
					</Table.Tbody>
				</Table>
			</Box>
		</Stack>
	);
}
