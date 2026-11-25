import {
	Box, Image, Text, UnstyledButton,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { clipDuration, highlightTitle } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { PlayInningPill } from "./PlayInningPill.js";
import type { PlayLink } from "./playLink.js";
import { videoMeta } from "./videoMeta.js";

export type Video = GamePayload["highlights"][number];

/** Light on Dark at 50% behind the duration (owner, 2026-10-14: "Light on Dark 50%"). */
const OVERLAY = "rgb(16 16 15 / 50%)";

/**
 * A clip's 16:9 still (6px radius) with the duration at the bottom right. No play mark on any
 * thumbnail (game-shell A5; owner, 2026-11-04: "No thumbnails should have a play icon").
 * `bare` drops the duration too, for a row that writes it beside the still instead (the day
 * digest, S71). The frame is a `.bt-zoom`: inside a `.bt-zoom-host` (the card that plays it)
 * the still zooms on hover while the frame keeps its size (owner, 2026-11-12: "hover effects
 * that zoom an image inside its container").
 */
export function VideoStill({
	video, width, bare = false,
}: { video: Video;
	width: number | "100%";
	bare?: boolean; })
{
	const duration = bare ? null : clipDuration(video.duration);
	return (
		<Box pos="relative" w={width} className="bt-zoom" style={{
			flexShrink: 0,
			aspectRatio: "16 / 9",
			borderRadius: 6,
			overflow: "hidden",
			background: "var(--bt-raised)",
		}}
		>
			{video.imageUrl ? <Image src={video.imageUrl} alt="" h="100%" w="100%" fit="cover" loading="lazy" /> : null}
			{duration ? (
				<Text
					pos="absolute"
					bottom={6}
					right={6}
					px={5}
					fz={11}
					fw={700}
					data-testid="video-duration"
					style={{
						borderRadius: 4,
						background: OVERLAY,
						color: "var(--bt-light)",
					}}
				>
					{duration}
				</Text>
			) : null}
		</Box>
	);
}

/**
 * One video (S69; game-shell Videos frames): the still with its duration, the title and the
 * meta line (`videoMeta`). One component for both modes — a grid cell (still above the text)
 * and a list row (a small still beside it). The card is one link, its still zooming on hover
 * (`.bt-zoom-host`): `href` is this page with the clip open (`useOpenClip`, #424), so a click opens
 * S70's player in place and a middle-click opens the page with the clip in a new tab.
 *
 * A clip with a play gets the inning pill after its date (S145; game-shell A6), which opens the
 * play. A link inside the card's link would also start the clip (S97), so the pill is the card link's next
 * sibling, laid over its meta row: the card is a grid and the link spans it as a
 * subgrid, so the date (in the link, playing the clip) and the pill (outside it, above it) share
 * one row's columns, the pill sitting 6px after the date. Hovering the pill leaves the still
 * unzoomed, since it isn't in the zoom host. The title is `highlightTitle`'s: the game page
 * passes `scoresHidden`, so there the recap clip reads "Recap (score hidden)" (S75).
 * `noDate` drops the date from the meta line (`videoMeta`'s option; the game's own room, #421).
 */
export function VideoCard({
	video, layout, href, scoresHidden = false, playLink, noDate = false,
}: { video: Video;
	layout: "grid" | "list";
	/** This page with the clip open (`useOpenClip`'s `href`, #424). */
	href: string;
	scoresHidden?: boolean;
	playLink?: PlayLink | null;
	/** Leave the date out of the meta line: only the game's own Videos room passes it (#421). */
	noDate?: boolean; })
{
	const title = highlightTitle(video, scoresHidden);
	const meta = videoMeta(video, playLink, {
		noDate,
	});
	const grid = layout === "grid";
	// Grid: rows still, title, meta; the meta row's columns are the text, the pill and the rest.
	// List: the still beside the title and meta rows (2 and 3), centred by the two 1fr rows around
	// them; columns still (112px + the 12px gap), text, pill, rest. `text` is the text's column.
	const text = grid ? 1 : 2;
	const row = 3;
	return (
		<div
			data-layout={layout}
			style={{
				display: "grid",
				gridTemplateColumns: grid ? "auto auto 1fr" : "124px auto auto 1fr",
				gridTemplateRows: grid ? "auto auto auto" : "1fr auto auto 1fr",
				rowGap: 2,
				position: "relative",
				minWidth: 0,
				// In the room's grid, pin the card to the top so a one-line title's still lines up with its row.
				alignSelf: "start",
			}}
		>
			<UnstyledButton
				component={Link}
				to={href}
				replace
				data-testid="video-card"
				data-layout={layout}
				className="bt-zoom-host"
				aria-label={`Play ${title}`}
				style={{
					gridColumn: "1 / -1",
					gridRow: "1 / -1",
					display: "grid",
					gridTemplateColumns: "subgrid",
					gridTemplateRows: "subgrid",
					rowGap: 2,
					minWidth: 0,
					color: "inherit",
				}}
			>
				<Box style={grid ? {
					gridColumn: "1 / -1",
					gridRow: 1,
					marginBottom: 6,
				} : {
					gridColumn: 1,
					gridRow: "1 / -1",
					alignSelf: "center",
				}}
				>
					<VideoStill video={video} width={grid ? "100%" : 112} />
				</Box>
				<Text fw={700} lh={1.3} lineClamp={2} style={{
					gridColumn: `${text} / -1`,
					gridRow: 2,
					minWidth: 0,
				}}
				>
					{title}
				</Text>
				{meta?.text ? (
					<Text size="sm" c="var(--bt-muted)" data-testid="video-meta" style={{
						gridColumn: text,
						gridRow: row,
						minWidth: 0,
					}}
					>
						{meta.text}
					</Text>
				) : null}
			</UnstyledButton>
			{meta?.pill ? (
				<PlayInningPill link={meta.pill} testId="play-link" style={{
					gridColumn: text + 1,
					gridRow: row,
					alignSelf: "center",
					justifySelf: "start",
					marginLeft: meta.text ? 6 : 0,
				}}
				/>
			) : null}
		</div>
	);
}
