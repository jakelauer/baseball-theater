import {
	Box, SimpleGrid, Stack, Text,
} from "@mantine/core";
import { useParams } from "react-router-dom";
import { scoreboardRows } from "@bt/domain";
import { useScheduleDay } from "../api/schedule.js";
import { useScoreboardDefaultDate } from "../api/scoreboardDate.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import { CollapsedBar } from "../components/scoreboard/CollapsedBar.js";
import { DayDigest } from "../components/scoreboard/DayDigest.js";
import { DateControl } from "../components/scoreboard/DateControl.js";
import { ScoreboardModule } from "../components/scoreboard/ScoreboardModule.js";
import { formatDate } from "../format/datetime.js";
import { SiteFooter } from "../layout/SiteFooter.js";
import type { LayoutVariant } from "../layout/variant.js";
import { useSettings } from "../settings/store.js";

/**
 * The day's games under their `GAMES — SEP 21, 2026` label, or the empty sentence. With
 * Collapse Non-Favorites on, `scoreboardRows` folds games without a favorite team into
 * `CollapsedBar`s after the favorites; choosing a bar opens its game (S126). While
 * anything is collapsed, a favorite's module spans the whole row at medium and desktop
 * (owner, 2026-10-30: "on desktop, when the collapsed mode is on, make the favorite one
 * full-width").
 */
function Games({ day, variant }: { day: ScheduleDayPayload;
	variant: LayoutVariant; })
{
	const { favoriteTeamIds, collapseNonFavorites } = useSettings();
	if (day.games.length === 0)
	{
		return <ViewState kind="empty" message="No games scheduled for this date." />;
	}
	const rows = scoreboardRows(day.games, favoriteTeamIds, collapseNonFavorites);
	const wide = variant !== "mobile" && rows.some((row) => row.collapsed);
	return (
		<Stack gap="sm">
			<Text size="xs" fw={700} tt="uppercase">
				Games — {formatDate(day.date)}
			</Text>
			<SimpleGrid cols={variant === "mobile" ? 1 : 2} spacing="md" verticalSpacing="md" data-testid="scoreboard-grid">
				{rows.map(({ game, collapsed }) =>
				{
					if (collapsed)
					{
						return <CollapsedBar key={game.gamePk} game={game} />;
					}
					return wide ? (
						<Box key={game.gamePk} data-testid="scoreboard-wide" style={{
							gridColumn: "1 / -1",
						}}
						>
							<ScoreboardModule game={game} />
						</Box>
					) : <ScoreboardModule key={game.gamePk} game={game} />;
				})}
			</SimpleGrid>
		</Stack>
	);
}

/**
 * The scoreboard (S31 frames; S66) for the URL's day, or, with none in the URL, the
 * server's default day (S111) — `ViewState`'s loading treatment until it is known.
 */
export function ScoreboardPage({ variant }: { variant: LayoutVariant })
{
	const { date } = useParams();
	// Asked once here, above the day: it is the undated page's day and the calendar's `Today`
	// (S125). A second reader inside the day would remount on an error and refetch it in a loop.
	const today = useScoreboardDefaultDate();
	if (date) return <ScoreboardDay date={date} variant={variant} today={today} />;
	// No day in the URL: the default; it is MLB's today if the server can't say.
	return today ? <ScoreboardDay date={today} variant={variant} today={today} /> : <ViewState kind="loading" />;
}

/**
 * One day's scoreboard: the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium and desktop, from the
 * host's `variant` — and the day digest under them (S71), or the loading, empty or
 * error state from `ViewState`. The
 * date control stays through every state so the reader can always move to another day; its
 * calendar's `Today` is the server's default day (S125, shell-scoreboard A8).
 */
function ScoreboardDay({
	date, variant, today,
}: { date: string;
	variant: LayoutVariant;
	today: string | undefined; })
{
	const {
		data: day, error, refetch,
	} = useScheduleDay(date);

	let body;
	// A failed background refetch keeps the day already shown (S28's one rule: a retired
	// version's 426 raises the update notice and leaves the screen readable).
	const screen = queryScreen({
		data: day,
		error,
	});
	if (screen === "error")
	{
		body = <ViewState kind="error" title="Couldn't load games" onRetry={() => void refetch()} />;
	}
	else if (screen === "loading" || !day)
	{
		body = <ViewState kind="loading" title={`${formatDate(date)} Scoreboard`} />;
	}
	else
	{
		body = (
			<>
				<Games day={day} variant={variant} />
				<DayDigest date={day.date} variant={variant} />
				{/* The scoreboard opens no WebSocket yet: S149 adds its live connection and wires this. */}
				<SiteFooter live={false} />
			</>
		);
	}

	return (
		<Stack gap="md">
			{/* Keyed by the day, so a change of day (a pick, an arrow, Back) closes the calendar (S125). */}
			<DateControl key={date} date={date} variant={variant} today={today} />
			{body}
		</Stack>
	);
}
