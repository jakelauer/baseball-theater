import { Group, Text } from "@mantine/core";
import { teamAbbreviation } from "@bt/domain";
import { TeamSwatch } from "./TeamSwatch.js";

/**
 * "NYY @ BOS" with each team's swatch (S61; search result rows, S5): away then
 * home, each abbreviation by `teamAbbreviation` (nothing for a club BT doesn't know).
 * Abbreviations are Light text and the swatches carry the team colors through
 * `TeamSwatch` (and so `contrastSafeTeamColor`) — team color is never type.
 */
export function MatchupAbbr({ awayId, homeId }: { awayId: number;
	homeId: number; })
{
	return (
		<Group gap={6} wrap="nowrap" data-testid="matchup-abbr">
			<TeamSwatch teamId={awayId} />
			<Text span size="sm">{teamAbbreviation(awayId) ?? ""}</Text>
			<Text span size="sm" c="dimmed">@</Text>
			<TeamSwatch teamId={homeId} />
			<Text span size="sm">{teamAbbreviation(homeId) ?? ""}</Text>
		</Group>
	);
}
