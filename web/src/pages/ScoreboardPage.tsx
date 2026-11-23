import {
	Box, SimpleGrid, Stack, Text,
} from "@mantine/core";
import { useParams } from "react-router-dom";
import { scoreboardRows } from "@bt/domain";
import { useDayDigest } from "../api/digest.js";
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
import type { SetFooterMode } from "../layout/footerMode.js";
import { useFooterMode } from "../layout/footerMode.js";
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
 * `setFooter` holds the shell's footer back while the page loads (S142; `FooterMode`).
 */
export function ScoreboardPage({ variant, setFooter }: { variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const { date } = useParams();
	return date ? <ScoreboardDay date={date} variant={variant} setFooter={setFooter} /> : <DefaultScoreboardDay variant={variant} setFooter={setFooter} />;
}

/** No day in the URL: ask for the default; it is MLB's today if the server can't say. */
function DefaultScoreboardDay({ variant, setFooter }: { variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const date = useScoreboardDefaultDate();
	useFooterMode(setFooter, date ? null : "none");
	return date ? <ScoreboardDay date={date} variant={variant} setFooter={setFooter} /> : <ViewState kind="loading" />;
}

/**
 * One day's scoreboard: the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium and desktop, from the
 * host's `variant` — and the day digest under them (S71), or the loading, empty or
 * error state from `ViewState`. The
 * date control stays through every state so the reader can always move to another day.
 */
function ScoreboardDay({
	date, variant, setFooter,
}: { date: string;
	variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const {
		data: day, error, refetch,
	} = useScheduleDay(date);
	// The digest draws under the games once it answers (or nothing, if it fails), so the footer waits
	// for both: drawn earlier it would sit under the games and jump when the highlights arrive (S142).
	// The same query `DayDigest` reads, so asking here adds no request; it only starts it with the day's.
	const digestPending = useDayDigest(date).isPending;

	let body;
	// A failed background refetch keeps the day already shown (S28's one rule: a retired
	// version's 426 raises the update notice and leaves the screen readable).
	const screen = queryScreen({
		data: day,
		error,
	});
	useFooterMode(setFooter, screen === "error" || (screen !== "loading" && day && !digestPending) ? "plain" : "none");
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
				{/* The site footer is the shell's (S142). The scoreboard opens no WebSocket yet: S149 adds its live
				    connection and turns the footer's Live strip on through `useFooterMode`. */}
			</>
		);
	}

	return (
		<Stack gap="md">
			<DateControl date={date} />
			{body}
		</Stack>
	);
}
