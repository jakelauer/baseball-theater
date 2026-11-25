import { Stack } from "@mantine/core";
import { useDayDigest } from "../../api/digest.js";
import { formatMonthDay } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { LazyPlayerDialog } from "../videos/LazyPlayerDialog.js";
import { useOpenClip } from "../videos/openClip.js";
import { playInningLink } from "../videos/playLink.js";
import { VideoCard } from "../videos/VideoCard.js";
import { VideoGrid } from "../videos/VideoGrid.js";
import { SectionHeading } from "../SectionHeading.js";
import { ViewState } from "../ViewState.js";

/**
 * "Best of <date> — Highlights" (S71; the ratified scoreboard frames' digest, now the `day-digest` section of `video-card`s):
 * the day's top clips across its games, ranked by `dayDigest` on the server, drawn in the
 * game's Videos room highlight grid (`VideoGrid` of `VideoCard`s, 2 / 3 / 4 columns), in rank
 * order left to right, and with no "Watch first" label (#426; owner, 2026-11-23: "the best of
 * highlights thing should use the grid style highlight layout and the watch first label should
 * go away we don't need that"). That replaced the ranked rows with their rank numbers, their
 * one- or two-column split and the label. Each card keeps its kind and date line (#421 drops
 * the date only in a game's own room) and has no play pill: A10 draws the digest's inning pill only in its player.
 *
 * Choosing a clip (a link to this page with it open, `useOpenClip`, #424) plays it in S70's dialog, whatever the Video Player setting (there is no
 * stage on the scoreboard), with A10's pills (S173): the game pill (owner, 2026-10-21: "All
 * videos which have enough context to associate them to a game should show a link to the game
 * unless they are already being played from the game"), then the inning pill when the item carries
 * its play (`playInningLink` over the route's `play`). Hide Scores leaves the digest as it is,
 * titles as MLB writes them (shell-scoreboard A3: "there are probably too many ways to
 * detect this to make a reliable detector beyond the recap"). While it loads, its heading (its words
 * need only the day) over a skeleton of the grid's cards holds its place, so it doesn't pop in seconds
 * later with no sign it was coming (B578, #578; owner: "generally when we're loading stuff, we should
 * use a skeleton style loading"), and the shell's footer under it needn't wait for it (#577). That is
 * on a day that lists games (`expected`); a day with none draws no skeleton. Nothing shows if it fails
 * or answers with no videos: then the skeleton collapses and what is under it (the footer) moves up,
 * a rare shift accepted so the common day never pops in. The games above are the page.
 */
export function DayDigest({
	date, variant, expected,
}: { date: string;
	variant: LayoutVariant;
	/**
	 * Whether the day lists any game. The digest ranks every game's clips, pregame ones (lineups, bullpens)
	 * included, so any listed game may bring one; a day with none gets no skeleton.
	 */
	expected: boolean; })
{
	const { data, isPending } = useDayDigest(date);
	const {
		playing, href, close,
	} = useOpenClip(data?.items, (item) => item.highlight.id);
	if (isPending && expected)
	{
		return (
			<Stack gap="sm" data-testid="day-digest-loading">
				<SectionHeading>
					Best of {formatMonthDay(date)} — Highlights
				</SectionHeading>
				<ViewState kind="loading" shape="videos" variant={variant} />
			</Stack>
		);
	}
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
					game={playing.game}
					playLink={playing.play ? playInningLink({
						gamePk: playing.game.gamePk,
						...playing.play,
					}) : null}
				/>
			) : null}
		</Stack>
	);
}
