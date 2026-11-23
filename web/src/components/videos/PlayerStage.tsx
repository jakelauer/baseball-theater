import { Box, Stack } from "@mantine/core";
import { highlightTitle } from "@bt/domain";
import { PlayInningPill } from "./PlayInningPill.js";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";
import { videoPlayLink } from "./playLink.js";

/** The game whose Videos room holds the stage: what `videoPlayLink` needs to find the clip's play. */
export type StageGame = Parameters<typeof videoPlayLink>[1];

/**
 * The persistent player (S70; game-shell `video-player-stage-*`): the `VideoPlayer` fixed
 * at the top of the Videos room, above the list, for readers who choose Stage in
 * Settings → Game Detail → Video Player. It shows the chosen clip, playing, or until one
 * is chosen the room's first, waiting. Keyed by clip so a new choice starts fresh.
 *
 * Above the video, for a clip with a play, sits S145's inning pill (`Top 6 →`) alone on a
 * row of its own, left-aligned with the video (S172; standings-search-settings A10: the stage
 * has no top row to hold it; owner, 2026-11-22: "Yes, a row above the video (Recommended)").
 * The link is built here from the clip the stage shows, so the waiting first clip gets one
 * too, not only a chosen clip. A clip with no play has no row at all. No game pill: the
 * stage only plays inside the game it belongs to (A10, Stage player). Choosing the pill
 * leaves the Videos room for the Plays room, so the stage stops with the room. The inning
 * carries no score, so Hide Scores leaves the row as it is.
 */
export function PlayerStage({
	video, autoPlay, scoresHidden = false, game,
}: { video: Video;
	autoPlay: boolean;
	/** With scores hidden the recap clip is retitled (`highlightTitle`, S75). */
	scoresHidden?: boolean;
	/** The room's game, for the clip's inning pill; without it the stage draws no row. */
	game?: StageGame; })
{
	const link = game ? videoPlayLink(video, game) : null;
	return (
		<Stack component="section" aria-label="Video player" gap={2}>
			{link ? (
				<Box data-testid="stage-play-row" style={{
					display: "flex",
				}}
				>
					<PlayInningPill link={link} testId="stage-play-link" />
				</Box>
			) : null}
			<VideoPlayer key={video.id} video={video} title={highlightTitle(video, scoresHidden)} autoPlay={autoPlay} />
		</Stack>
	);
}
