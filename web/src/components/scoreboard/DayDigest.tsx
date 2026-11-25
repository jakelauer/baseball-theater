import { Stack } from "@mantine/core";
import { useDayDigest } from "../../api/digest.js";
import { formatMonthDay } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { gameLabel } from "../videos/gameLabel.js";
import { LazyPlayerDialog } from "../videos/LazyPlayerDialog.js";
import { useOpenClip } from "../videos/openClip.js";
import { VideoCard } from "../videos/VideoCard.js";
import { VideoGrid } from "../videos/VideoGrid.js";
import { SectionHeading } from "../SectionHeading.js";

/**
 * "Best of <date> — Highlights" (S71; `digest-item` on every ratified scoreboard frame):
 * the day's top clips across its games, ranked by `dayDigest` on the server, drawn in the
 * game's Videos room highlight grid (`VideoGrid` of `VideoCard`s, 2 / 3 / 4 columns), in rank
 * order left to right, and with no "Watch first" label (#426; owner, 2026-11-23: "the best of
 * highlights thing should use the grid style highlight layout and the watch first label should
 * go away we don't need that"). That replaced the ranked rows with their rank numbers, their
 * one- or two-column split and the label. Each card keeps its kind and date line (#421 drops
 * the date only in a game's own room) and has no play pill: the digest's clips carry no plays.
 *
 * Choosing a clip (a link to this page with it open, `useOpenClip`, #424) plays it in S70's dialog, whatever the Video Player setting (there is no
 * stage on the scoreboard), with the link to its game (owner, 2026-10-21: "All videos which
 * have enough context to associate them to a game should show a link to the game unless
 * they are already being played from the game"). Hide Scores leaves the digest as it is,
 * titles as MLB writes them (shell-scoreboard A3: "there are probably too many ways to
 * detect this to make a reliable detector beyond the recap"). Nothing shows while it loads,
 * if it fails, or on a day with no videos: the games above are the page.
 */
export function DayDigest({ date, variant }: { date: string;
	variant: LayoutVariant; })
{
	const { data } = useDayDigest(date);
	const {
		playing, href, close,
	} = useOpenClip(data?.items, (item) => item.highlight.id);
	if (!data || data.items.length === 0) return null;
	return (
		<Stack gap="sm" data-testid="day-digest">
			<SectionHeading>
				Best of {formatMonthDay(data.date)} — Highlights
			</SectionHeading>
			<VideoGrid variant={variant}>
				{data.items.map((item) => <VideoCard key={item.highlight.id} video={item.highlight} layout="grid" href={href(item)} />)}
			</VideoGrid>
			{playing ? (
				<LazyPlayerDialog
					video={playing.highlight}
					onClose={close}
					game={{
						gamePk: playing.game.gamePk,
						label: gameLabel(playing.game),
					}}
				/>
			) : null}
		</Stack>
	);
}
