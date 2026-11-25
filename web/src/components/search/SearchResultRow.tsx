import { Text, UnstyledButton } from "@mantine/core";
import { IconVideo } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import type { SearchHighlightsPayload } from "../../api/search.js";
import { MatchupAbbr } from "../team/MatchupAbbr.js";
import { PlayInningPill } from "../videos/PlayInningPill.js";
import { videoMeta } from "../videos/videoMeta.js";
import { resultPlayLink } from "./resultPlayLink.js";

export type SearchResult = SearchHighlightsPayload["highlights"][number];

/**
 * One search result as the ratified frames draw it (standings-search-settings `search-*`): a
 * typographic row, never a still or a photo (VISUAL-DESIGN §5), with the video icon in Accent,
 * the clip's title as MLB writes it (Search is unaffected by Hide Scores; owner, 2026-10-21), its
 * meta line from `videoMeta` (the one meta-line rule, ADR-025), and at the right the game's matchup
 * as swatch + abbreviation (`MatchupAbbr`), or nothing for a clip MLB ties to no game. The row is a
 * link to this search with its clip open (`href`, `useOpenClip`, #424), so a click plays it in place
 * and a middle-click opens it in a new tab; rows are split by hairlines.
 *
 * The meta line follows game-shell A6's `search-playmeta-*` (S153): a result with a play reads its
 * date in `--bt-muted`, then S145's inning pill (`Top 6 →`), which opens the play in the game's Plays
 * room; one with no play reads `Highlight · <date>` in the primary text colour. A link inside the
 * row's link would also play the clip, so, as on `VideoCard`, the pill is the row link's next sibling
 * laid over its meta row: the row is a grid the link spans as a subgrid, so the date (in the link)
 * and the pill (outside it, above it) share one row's columns, the pill 6px after the date. The
 * columns are the icon, the date, the pill, the rest and the matchup, which keeps the meta line
 * clear of the matchup at the narrowest width (S153's note on A6's 358px Figma row). The first and
 * last rows are the row's 16px padding (12px plus the 4px gap), inside the link so they still play.
 */
export function SearchResultRow({ result, href }: { result: SearchResult;
	/** This search with the clip open (`useOpenClip`'s `href`, #424). */
	href: string; })
{
	const { highlight, game } = result;
	const meta = videoMeta(highlight, resultPlayLink(result));
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "36px auto auto 1fr auto",
				gridTemplateRows: "12px auto auto 12px",
				rowGap: 4,
				position: "relative",
				borderBottom: "1px solid var(--bt-hairline)",
			}}
		>
			<UnstyledButton
				component={Link}
				to={href}
				replace
				data-testid="search-result"
				aria-label={`Play ${highlight.title}`}
				className="bt-hover"
				style={{
					gridColumn: "1 / -1",
					gridRow: "1 / -1",
					display: "grid",
					gridTemplateColumns: "subgrid",
					gridTemplateRows: "subgrid",
					rowGap: 4,
					minWidth: 0,
					color: "var(--bt-light)",
				}}
			>
				<IconVideo size={24} stroke={1.75} color="var(--bt-accent)" aria-hidden style={{
					gridColumn: 1,
					gridRow: "2 / 4",
					alignSelf: "center",
				}}
				/>
				<Text fw={700} lh={1.3} style={{
					gridColumn: game ? "2 / 5" : "2 / -1",
					gridRow: 2,
					minWidth: 0,
				}}
				>
					{highlight.title}
				</Text>
				{meta?.text ? (
					<Text size="sm" c={meta.pill ? "var(--bt-muted)" : "var(--bt-light)"} data-testid="search-result-meta" style={{
						gridColumn: 2,
						gridRow: 3,
						minWidth: 0,
					}}
					>
						{meta.text}
					</Text>
				) : null}
				{game ? (
					<div style={{
						gridColumn: 5,
						gridRow: "2 / 4",
						alignSelf: "center",
						marginLeft: 12,
					}}
					>
						<MatchupAbbr awayId={game.awayId} homeId={game.homeId} />
					</div>
				) : null}
			</UnstyledButton>
			{meta?.pill ? (
				<PlayInningPill link={meta.pill} testId="search-play-link" style={{
					gridColumn: 3,
					gridRow: 3,
					alignSelf: "center",
					justifySelf: "start",
					marginLeft: meta.text ? 6 : 0,
				}}
				/>
			) : null}
		</div>
	);
}
