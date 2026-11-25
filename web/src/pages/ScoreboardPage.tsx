import {
	Box, Group, Menu, SimpleGrid, Skeleton, Stack,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import type { ReactNode } from "react";
import { IconArrowsSort } from "@tabler/icons-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { scoreboardRows, sortScoreboardGames } from "@bt/domain";
import type { ScoreboardSort } from "@bt/domain";
import { useDayDigest } from "../api/digest.js";
import { useLiveDay } from "../api/live-day.js";
import { useScheduleDay } from "../api/schedule.js";
import { useScoreboardDefaultDate } from "../api/scoreboardDate.js";
import type { ScheduleDayPayload } from "../api/schedule.js";
import { ViewState } from "../components/ViewState.js";
import { FilterPill } from "../components/videos/QuickFilters.js";
import { queryScreen } from "../components/queryScreen.js";
import { CollapsedBar } from "../components/scoreboard/CollapsedBar.js";
import { DayDigest } from "../components/scoreboard/DayDigest.js";
import { DateControl, DateControlSkeleton } from "../components/scoreboard/DateControl.js";
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
 * The games' `GAMES — SEP 21, 2026` label and, beside it, `control` (the sort control). Its words need
 * only the day, so the loading skeleton draws it too and nothing above the games changes when they land
 * (B584, #584; owner, 2026-11-25: "the header … change[s] after the content loads even though the text
 * shows similar content that isn't dependent on the data").
 */
function GamesHeading({ date, control }: { date: string;
	control: ReactNode; })
{
	return (
		<Group justify="space-between" align="center" wrap="nowrap" gap={8}>
			<SectionHeading>
				Games — {formatDate(date)}
			</SectionHeading>
			{control}
		</Group>
	);
}

/**
 * The day's games while they load (B584, #584): the games' own heading, a pill's place where the sort
 * control goes (it is drawn only over games), and a skeleton of game cards in the page's columns.
 */
function GamesLoading({ date, variant }: { date: string;
	variant: LayoutVariant; })
{
	const animate = !useReducedMotion();
	return (
		<Stack gap="sm">
			<GamesHeading date={date} control={<Skeleton h={28} w={160} radius="xl" animate={animate} />} />
			<ViewState kind="loading" shape="games" columns={scoreboardColumns(variant)} />
		</Stack>
	);
}

/**
 * The day's games under their `GAMES — SEP 21, 2026` label (`GamesHeading`), or the empty sentence. They are in
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
			<GamesHeading
				date={day.date}
				control={(
					// The Videos room's sort control, reused (S69): a pill naming the order, opening a menu of the choices.
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
				)}
			/>
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
 * server's default day (S111). Until that day is known the date bar's place and a skeleton of game cards
 * stand in (#431, B584), so the bar is there from the start. `setFooter` holds the shell's footer back
 * while the page loads (S142; `FooterMode`).
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
	if (shown) return <ScoreboardDay date={shown} variant={variant} today={today} setFooter={setFooter} />;
	return (
		<Stack gap="md">
			<DateControlSkeleton />
			<ViewState kind="loading" shape="games" columns={scoreboardColumns(variant)} />
		</Stack>
	);
}

/**
 * One day's scoreboard: the date control, then the day's games as
 * `ScoreboardModule`s — one column on mobile, two on medium, three on desktop, from the
 * host's `variant` — and the day digest under them (S71), or the loading (`GamesLoading`), empty or
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
	// S149: the day's live connection while it has a game in its window; the query stops re-asking it then.
	const live = useLiveDay(date);
	const {
		data: day, error, refetch, dataUpdatedAt,
	} = useScheduleDay(date, live.inWindow);
	// The same query `DayDigest` reads, so asking here adds no request; it only starts it with the day's.
	// The footer no longer waits for it (#577): while it loads, Best of's skeleton holds its place under
	// the games (#578), so a footer drawn once the games are has nothing to jump over.
	useDayDigest(date);
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
	// The footer opens with A13's Live strip exactly while the day's socket is open (S149 AC 7, S148's `LiveMarker`).
	useFooterMode(setFooter, screen === "error" || (screen !== "loading" && day) ? live.open ? "live" : "plain" : "none");
	if (screen === "error")
	{
		body = <ViewState kind="error" title="Couldn't load games" onRetry={() => void refetch()} />;
	}
	else if (screen === "loading" || !day)
	{
		body = <GamesLoading date={date} variant={variant} />;
	}
	else
	{
		body = (
			<>
				<Games day={day} variant={variant} />
				<DayDigest date={day.date} variant={variant} />
				{/* The site footer is the shell's (S142); its Live strip follows `useLiveDay` through `useFooterMode` (S149). */}
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
