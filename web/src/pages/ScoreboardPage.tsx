import {
	Box, Group, Menu, SimpleGrid, Stack,
} from "@mantine/core";
import { IconArrowsSort } from "@tabler/icons-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { scoreboardRows, sortScoreboardGames } from "@bt/domain";
import type { ScoreboardSort } from "@bt/domain";
import { useDayDigest } from "../api/digest.js";
import { useScheduleDay } from "../api/schedule.js";
import { useScoreboardDefaultDate } from "../api/scoreboardDate.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { ViewState } from "../components/ViewState.js";
import { FilterPill } from "../components/videos/QuickFilters.js";
import { queryScreen } from "../components/queryScreen.js";
import { CollapsedBar } from "../components/scoreboard/CollapsedBar.js";
import { DayDigest } from "../components/scoreboard/DayDigest.js";
import { DateControl } from "../components/scoreboard/DateControl.js";
import { ScoreboardModule } from "../components/scoreboard/ScoreboardModule.js";
import { formatDate } from "../format/datetime.js";
import type { SetFooterMode } from "../layout/footerMode.js";
import { useFooterMode } from "../layout/footerMode.js";
import type { LayoutVariant } from "../layout/variant.js";
import { useSavedCopy } from "../pwa/offline.js";
import { useSettings } from "../settings/store.js";
import { SectionHeading } from "../components/SectionHeading.js";

/**
 * The scoreboard's columns: one on mobile, two on medium, three on desktop (B429, #429; owner,
 * 2026-11-23: "baseball theater right now fits three and then it at a certain size it drops down to
 * two and then down to one"); the games and their loading skeleton share it.
 */
function scoreboardColumns(variant: LayoutVariant): number
{
	if (variant === "mobile") return 1;
	return variant === "medium" ? 2 : 3;
}

/** The sort control's labels (B430, #430), in the order its menu lists them; the default first. */
const SORT_LABELS: Readonly<Record<ScoreboardSort, string>> = {
	default: "Favorites, live first",
	startTime: "Start time",
};

/**
 * The day's games under their `GAMES — SEP 21, 2026` label, or the empty sentence. They are in
 * the order the sort control beside the label picks (`sortScoreboardGames`; B430, #430): the
 * default, favorites then live games first, or start time. The choice is the page's own state, so
 * a new visit opens on the default (the issue: not remembered between visits). With
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
	const [sort, setSort] = useState<ScoreboardSort>("default");
	if (day.games.length === 0)
	{
		return <ViewState kind="empty" message="No games scheduled for this date." />;
	}
	const rows = scoreboardRows(sortScoreboardGames(day.games, favoriteTeamIds, sort), favoriteTeamIds, collapseNonFavorites);
	const wide = variant !== "mobile" && rows.some((row) => row.collapsed);
	return (
		<Stack gap="sm">
			<Group justify="space-between" align="center" wrap="nowrap" gap={8}>
				<SectionHeading>
					Games — {formatDate(day.date)}
				</SectionHeading>
				{/* The Videos room's sort control, reused (S69): a pill naming the order, opening a menu of the choices. */}
				<Menu position="bottom-end">
					<Menu.Target>
						<FilterPill leftSection={<IconArrowsSort size={14} />} aria-label={`Sort: ${SORT_LABELS[sort]}`}>
							{SORT_LABELS[sort]}
						</FilterPill>
					</Menu.Target>
					<Menu.Dropdown>
						{(Object.keys(SORT_LABELS) as ScoreboardSort[]).map((value) => (
							<Menu.Item key={value} onClick={() => setSort(value)}>{SORT_LABELS[value]}</Menu.Item>
						))}
					</Menu.Dropdown>
				</Menu>
			</Group>
			<SimpleGrid cols={scoreboardColumns(variant)} spacing="md" verticalSpacing="md" data-testid="scoreboard-grid">
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
 * server's default day (S111) — `ViewState`'s loading skeleton of game cards until it is known (#431).
 * `setFooter` holds the shell's footer back while the page loads (S142; `FooterMode`).
 */
export function ScoreboardPage({ variant, setFooter }: { variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const { date } = useParams();
	// Asked once here, above the day: it is the undated page's day and the calendar's `Today`
	// (S125). A second reader inside the day would remount on an error and refetch it in a loop.
	const today = useScoreboardDefaultDate();
	const shown = date ?? today;
	// No day in the URL and the default not known yet: hold the footer back (S142).
	useFooterMode(setFooter, shown ? null : "none");
	// No day in the URL: the default; it is MLB's today if the server can't say.
	return shown ? <ScoreboardDay date={shown} variant={variant} today={today} setFooter={setFooter} /> : <ViewState kind="loading" cards={scoreboardColumns(variant)} />;
}

/**
 * One day's scoreboard: the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium, three on desktop, from the
 * host's `variant` — and the day digest under them (S71), or the loading, empty or
 * error state from `ViewState`. Offline (S74) it draws the day as last stored, and tells the
 * shell's offline marker its time (`useSavedCopy`). The
 * date control stays through every state so the reader can always move to another day; its
 * calendar's `Today` is the server's default day (S125, shell-scoreboard A8).
 */
function ScoreboardDay({
	date, variant, today, setFooter,
}: { date: string;
	variant: LayoutVariant;
	today: string | undefined;
	setFooter?: SetFooterMode; })
{
	const {
		data: day, error, refetch, dataUpdatedAt,
	} = useScheduleDay(date);
	// The digest draws under the games once it answers (or nothing, if it fails), so the footer waits
	// for both: drawn earlier it would sit under the games and jump when the highlights arrive (S142).
	// The same query `DayDigest` reads, so asking here adds no request; it only starts it with the day's.
	const digestPending = useDayDigest(date).isPending;
	// Offline (S74): the shell's marker names this day's copy, "Scores as of …": a stored copy's own
	// time, or when this page last got the day.
	useSavedCopy(day ? {
		kind: "scores",
		asOf: day.copyAsOf ?? new Date(dataUpdatedAt).toISOString(),
	} : null);

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
		body = <ViewState kind="loading" title={`${formatDate(date)} Scoreboard`} cards={scoreboardColumns(variant)} />;
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
			{/* Keyed by the day, so a change of day (a pick, an arrow, Back) closes the calendar (S125). */}
			<DateControl key={date} date={date} variant={variant} today={today} />
			{body}
		</Stack>
	);
}
