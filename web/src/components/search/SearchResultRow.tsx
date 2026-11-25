import {
	Group, Stack, Text, UnstyledButton,
} from "@mantine/core";
import { IconVideo } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import type { SearchHighlightsPayload } from "../../api/search.js";
import { MatchupAbbr } from "../team/MatchupAbbr.js";
import { videoMeta } from "../videos/videoMeta.js";

export type SearchResult = SearchHighlightsPayload["highlights"][number];

/**
 * One search result as the ratified frames draw it (standings-search-settings `search-*`): a
 * typographic row, never a still or a photo (VISUAL-DESIGN §5), with the video icon in Accent,
 * the clip's title as MLB writes it (Search is unaffected by Hide Scores; owner, 2026-10-21), its
 * meta line `Highlight · Sep 21, 2026` from `videoMeta` (the one meta-line rule, ADR-025), and at
 * the right the game's matchup as swatch + abbreviation (`MatchupAbbr`), or nothing for a clip MLB
 * ties to no game. The whole row is a link to this search with its clip open (`href`, `useOpenClip`,
 * #424), so a click plays it in place and a middle-click opens it in a new tab; rows are split by hairlines.
 */
export function SearchResultRow({ result, href }: { result: SearchResult;
	/** This search with the clip open (`useOpenClip`'s `href`, #424). */
	href: string; })
{
	const { highlight, game } = result;
	const meta = videoMeta(highlight, null);
	return (
		<UnstyledButton
			component={Link}
			to={href}
			replace
			data-testid="search-result"
			aria-label={`Play ${highlight.title}`}
			className="bt-hover"
			py={16}
			px={0}
			style={{
				display: "block",
				width: "100%",
				borderBottom: "1px solid var(--bt-hairline)",
				color: "var(--bt-light)",
			}}
		>
			<Group gap={12} wrap="nowrap" align="center">
				<IconVideo size={24} stroke={1.75} color="var(--bt-accent)" aria-hidden style={{
					flexShrink: 0,
				}}
				/>
				<Stack gap={4} style={{
					flex: 1,
					minWidth: 0,
				}}
				>
					<Text fw={700} lh={1.3}>{highlight.title}</Text>
					{meta?.text ? <Text size="sm" c="dimmed" data-testid="search-result-meta">{meta.text}</Text> : null}
				</Stack>
				{game ? <MatchupAbbr awayId={game.awayId} homeId={game.homeId} /> : null}
			</Group>
		</UnstyledButton>
	);
}
