import {
	Anchor, Box, Group, Text,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { Link } from "react-router-dom";
import type { StandingsPayload } from "../../api/standings.js";
import { formatLongDate } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { TeamSwatch } from "../team/TeamSwatch.js";
import classes from "./ChampionBox.module.css";

type Champion = NonNullable<StandingsPayload["champion"]>;

/**
 * The World Series box (S130 AC 4; standings-search-settings A9 "The World Series box"): the eyebrow
 * "<season> World Series champions", the winner's swatch and name in gold, "Won the World Series on
 * <day>" (`formatLongDate`, as the "as of" line writes its day), and, when `playoffsHref` is given,
 * "View the playoffs →". Whether it shows and whether it links are the page's (`championBoxShows`,
 * `standingsViews`). One gold sheen sweeps it as it appears, except for a fan whose device asks for
 * reduced motion, who gets it still, as the frames draw it: `useReducedMotion` (as `LiveIndicator` reads
 * it) leaves the sheen class off, and since that hook answers false on the first render, the stylesheet's
 * own `prefers-reduced-motion` rule stops the sweep before it has read the setting. The page keeps this
 * box mounted while the fan switches views, so the sheen runs once, when the box first appears (A9).
 * 420px wide on medium and desktop, full width on mobile.
 */
export function ChampionBox({
	champion, playoffsHref, variant,
}: { champion: Champion;
	playoffsHref: string | null;
	variant: LayoutVariant; })
{
	const reduceMotion = useReducedMotion();
	return (
		<Box
			className={reduceMotion ? classes.box : `${classes.box} ${classes.sheen}`}
			maw={variant === "mobile" ? undefined : 420}
			data-testid="world-series-box"
			data-sheen={reduceMotion ? undefined : "once"}
		>
			<Text fz={11} fw={600} tt="uppercase" c="var(--bt-accent)" style={{
				letterSpacing: "0.08em",
			}}
			>
				{`${champion.season} World Series champions`}
			</Text>
			<Group gap={10} wrap="nowrap" mt={6}>
				<TeamSwatch teamId={champion.teamId} size={12} />
				<Text fz={variant === "mobile" ? 22 : 24} fw={600} className={classes.name}>{champion.name}</Text>
			</Group>
			<Text fz={14} mt={6}>{`Won the World Series on ${formatLongDate(champion.wonOn)}`}</Text>
			{playoffsHref
				? (
					<Anchor component={Link} to={playoffsHref} fz={14} fw={600} c="var(--bt-primary-light)" mt={6} display="inline-block">
						View the playoffs →
					</Anchor>
				)
				: null}
		</Box>
	);
}
