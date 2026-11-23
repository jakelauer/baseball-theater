import {
	ActionIcon, Box, Button, CloseButton, Group, NativeSelect, Stack, Text, Tooltip,
} from "@mantine/core";
import {
	DateInput, DatesProvider, Month,
} from "@mantine/dates";
import {
	IconChevronDown, IconChevronLeft, IconChevronRight,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
	BACKFILL_EARLIEST_DATE, EARLIEST_CALENDAR_MONTH, favoriteTeamsOff, latestScheduleMonth, MLB_TEAMS, mlbToday, monthGamesState,
} from "@bt/domain";
import type { FavoriteTeamsOff } from "@bt/domain";
import { scheduleMonthAnswerable, useScheduleMonth } from "../../api/scheduleMonth.js";
import type { ScheduleMonthPayload } from "../../api/scheduleMonth.js";
import { useShortScreen } from "../../layout/screenHeight.js";
import classes from "./CalendarPanel.module.css";
import { parseTypedDate } from "./dateParser.js";

/** Where the calendar sits: the phone's bottom sheet (with its ✕) or the dropdown under the date (A8). */
export type CalendarContainer = "sheet" | "dropdown";

/** How long a finger must stay on a day for the off-day tooltip (the platform's long-press, A8). */
export const HOLD_MS = 500;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-09-21` as Mantine's dates read it: midnight of that day on the device's clock. */
function localDate(iso: string): Date
{
	return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** The `YYYY-MM-DD` of a Mantine day (local midnight), the inverse of {@link localDate}. */
function isoDate(date: Date): string
{
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** `YYYY-MM` stepped by `months`, across years. */
function stepMonth(month: string, months: number): string
{
	const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** What the shown month's counts are: still loading, drawn (a month with games, or an off-season one), or numbers only. */
type MonthPhase = "loading" | "games" | "none" | "bare";

/**
 * The phase A8 draws for a month: `loading` while its counts are on the way; `bare` (bold numbers,
 * nothing dimmed or marked, no message) for a month S124 doesn't answer for, one whose counts
 * failed, and one S136's `monthGamesState` calls unknown; otherwise `games` or `none`.
 */
function monthPhase(answerable: boolean, data: ScheduleMonthPayload | undefined, failed: boolean): MonthPhase
{
	if (!answerable || failed) return "bare";
	if (!data) return "loading";
	const state = monthGamesState(data.days);
	return state === "unknown" ? "bare" : state;
}

/** "Off day: Yankees, Mets": the off favorites by their `MLB_TEAMS` names, in the fan's order (A8). */
function offDayLabel(off: FavoriteTeamsOff): string
{
	return `Off day: ${off.off.map((id) => MLB_TEAMS.find((team) => team.id === id)?.name ?? String(id)).join(", ")}`;
}

/** The tiny ✕, red (Primary Light) or yellow (Accent). */
function OffMark({ mark, selected }: { mark: FavoriteTeamsOff["mark"];
	selected: boolean; })
{
	const icon = (
		<svg className={classes.mark} viewBox="0 0 8 8" aria-hidden data-testid={`off-mark-${mark}`}>
			<path d="M1 1 7 7M7 1 1 7" stroke={mark === "red" ? "var(--bt-primary-light)" : "var(--bt-accent)"} strokeWidth="1.75" strokeLinecap="round" />
		</svg>
	);
	return selected ? <span className={classes.badge}>{icon}</span> : icon;
}

export interface CalendarPanelProps
{
	/** The day the scoreboard shows, `YYYY-MM-DD`: the selected day, and the month the calendar opens on. */
	date: string;
	/** A8's "today", the day the scoreboard opens on (`useScoreboardDefaultDate`); `undefined` while it loads. */
	today: string | undefined;
	/** The fan's favorite teams, in their order (`useSettings`). */
	favoriteTeamIds: readonly number[];
	container: CalendarContainer;
	/** Go to a day (a pick, a typed date, `Today` on today's month); the caller navigates and closes. */
	onPick: (date: string) => void;
	/** The sheet's ✕. */
	onClose: () => void;
}

/**
 * The calendar date picker (S125; shell-scoreboard A8 `calendar-panel`): the date field, read only
 * on Enter or blur through `parseTypedDate`; the header ‹ [month] [year] › with native pickers;
 * Mantine's `Month` with six week rows, each day's count from `useScheduleMonth`, no-game days
 * dimmed, days before 1901-04-18 disabled, S159's off-day ✕ and its tooltip (hover, or a
 * tap-and-hold on touch); and the `Today` footer with S136's off-season line.
 */
export function CalendarPanel({
	date, today, favoriteTeamIds, container, onPick, onClose,
}: CalendarPanelProps)
{
	const [shown, setShown] = useState(date.slice(0, 7));
	// One Date for the field's value for the panel's life (the day can't change under it: the
	// control remounts on a new day). DateInput rewrites its text whenever its value changes
	// identity, which would wipe what the fan is typing on any re-render.
	const [value] = useState(() => localDate(date));
	const [error, setError] = useState<string | null>(null);
	const [held, setHeld] = useState<string | null>(null);
	const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	// A hold that ended: the click the touch then makes must pick nothing.
	const swallowClick = useRef(false);
	const short = useShortScreen() && container === "sheet";
	const answerable = scheduleMonthAnswerable(shown);
	const { data, isError } = useScheduleMonth(shown);
	const phase = monthPhase(answerable, data, isError);
	const latest = latestScheduleMonth(mlbToday(new Date()));
	const latestYear = Number(latest.slice(0, 4));
	const shownYear = Number(shown.slice(0, 4));
	// 1901 through the last year S124 answers for; a later year reached by typing a date is added
	// as the last option while it is shown (A8, "A month after December of next year").
	const years: number[] = [];
	for (let year = 1901; year <= latestYear; year++) years.push(year);
	if (shownYear > latestYear) years.push(shownYear);
	const days = new Map((phase === "games" || phase === "none" ? data!.days : []).map((day) => [day.date, day]));

	/** Read the field's text: go to its day, or show why not. A day already shown does nothing. */
	function commit(text: string): void
	{
		const typed = parseTypedDate(text);
		if ("error" in typed)
		{
			setError(typed.error);
			return;
		}
		setError(null);
		if (typed.date !== date) onPick(typed.date);
	}

	function showMonth(month: string): void
	{
		setShown(month < EARLIEST_CALENDAR_MONTH ? EARLIEST_CALENDAR_MONTH : month);
	}

	function pick(iso: string): void
	{
		if (swallowClick.current)
		{
			swallowClick.current = false;
			return;
		}
		onPick(iso);
	}

	function startHold(iso: string, off: FavoriteTeamsOff | null): void
	{
		clearTimeout(holdTimer.current);
		holdTimer.current = setTimeout(() =>
		{
			swallowClick.current = true;
			if (off) setHeld(iso);
		}, HOLD_MS);
	}

	function endHold(): void
	{
		clearTimeout(holdTimer.current);
		setHeld(null);
	}

	function renderDay(day: Date): ReactNode
	{
		const iso = isoDate(day);
		// A day before the bound is disabled, and a neighbouring month's day is hidden: the number alone.
		if (iso < BACKFILL_EARLIEST_DATE || iso.slice(0, 7) !== shown) return <span className={classes.number}>{day.getDate()}</span>;
		const known = days.get(iso);
		const off = known ? favoriteTeamsOff(known, favoriteTeamIds, data!.days) : null;
		let under: ReactNode = null;
		if (phase === "loading") under = <span className={classes.bar} data-testid="count-loading" />;
		else if (!short && known?.count) under = <span className={classes.count}>{known.count} gm</span>;
		const content = (
			<span
				className={classes.inner}
				data-testid={`day-${iso}`}
				onTouchStart={() => startHold(iso, off)}
				onTouchMove={endHold}
				onTouchEnd={endHold}
				onContextMenu={(event) => event.preventDefault()}
			>
				<span className={classes.number}>{day.getDate()}</span>
				{under}
				{off && <OffMark mark={off.mark} selected={iso === date} />}
			</span>
		);
		if (!off) return content;
		return (
			<Tooltip
				label={offDayLabel(off)}
				opened={held === iso || undefined}
				withArrow
				withinPortal={false}
				transitionProps={{
					duration: 0,
				}}
				// A8's `offday-tooltip`: Light fill, Dark Medium 12px text, 6px corners.
				styles={{
					tooltip: {
						background: "var(--bt-light)",
						color: "var(--bt-dark)",
						fontWeight: 500,
						fontSize: 12,
						borderRadius: 6,
					},
					arrow: {
						background: "var(--bt-light)",
					},
				}}
			>
				{content}
			</Tooltip>
		);
	}

	const header: ReactNode = (
		<Group justify="space-between" wrap="nowrap" gap={8}>
			<ActionIcon variant="subtle" color="gray" aria-label="Previous month" disabled={shown <= EARLIEST_CALENDAR_MONTH} onClick={() => showMonth(stepMonth(shown, -1))}>
				<IconChevronLeft size={18} />
			</ActionIcon>
			<Group gap={8} wrap="nowrap">
				<NativeSelect
					aria-label="Month"
					size="xs"
					rightSection={<IconChevronDown size={12} />}
					classNames={{
						input: classes.select,
					}}
					value={String(Number(shown.slice(5, 7)))}
					onChange={(event) => showMonth(`${shown.slice(0, 4)}-${event.currentTarget.value.padStart(2, "0")}`)}
					data={MONTH_NAMES.map((name, index) => ({
						value: String(index + 1),
						label: name,
						disabled: `${shown.slice(0, 4)}-${String(index + 1).padStart(2, "0")}` < EARLIEST_CALENDAR_MONTH,
					}))}
				/>
				<NativeSelect
					aria-label="Year"
					size="xs"
					rightSection={<IconChevronDown size={12} />}
					classNames={{
						input: classes.select,
					}}
					value={String(shownYear)}
					onChange={(event) => showMonth(`${event.currentTarget.value}-${shown.slice(5, 7)}`)}
					data={years.map(String)}
				/>
			</Group>
			<ActionIcon variant="subtle" color="gray" aria-label="Next month" disabled={shown >= latest} onClick={() => showMonth(stepMonth(shown, 1))}>
				<IconChevronRight size={18} />
			</ActionIcon>
		</Group>
	);

	return (
		<Stack gap={12} p={container === "sheet" ? 16 : 12} className={classes.scroll} data-testid="calendar-panel" data-container={container}>
			<Box>
				<Group justify="space-between" wrap="nowrap" mb={4}>
					<Text component="label" htmlFor="calendar-date-field" size="xs" fw={700} tt="uppercase" c="var(--bt-muted)">Date</Text>
					{container === "sheet" && <CloseButton size="sm" aria-label="Close calendar" onClick={onClose} data-autofocus />}
				</Group>
				<DateInput
					id="calendar-date-field"
					value={value}
					valueFormat="MMM D, YYYY"
					dateParser={(text) =>
					{
						const typed = parseTypedDate(text);
						return "date" in typed ? localDate(typed.date) : null;
					}}
					popoverProps={{
						disabled: true,
					}}
					fixOnBlur={false}
					error={error}
					onKeyDown={(event: KeyboardEvent<HTMLInputElement>) =>
					{
						if (event.key === "Enter") commit(event.currentTarget.value);
					}}
					onBlur={(event) => commit(event.currentTarget.value)}
				/>
			</Box>
			{header}
			<DatesProvider settings={{
				consistentWeeks: true,
				firstDayOfWeek: 0,
				locale: "en",
			}}
			>
				<Month
					month={localDate(`${shown}-01`)}
					weekdayFormat="dd"
					withCellSpacing={false}
					hideOutsideDates
					minDate={localDate(BACKFILL_EARLIEST_DATE)}
					classNames={{
						month: classes.month,
						weekday: classes.weekday,
						monthCell: classes.cell,
						day: classes.day,
					}}
					style={{
						"--calendar-cell-height": short ? "36px" : "48px",
					}}
					getDayProps={(day) =>
					{
						const iso = isoDate(day);
						const known = days.get(iso);
						const dimmed = iso >= BACKFILL_EARLIEST_DATE && known !== undefined && !known.count;
						return {
							selected: iso === date,
							className: [dimmed && classes.dimmed, held === iso && classes.held].filter(Boolean).join(" "),
							onClick: () => pick(iso),
						};
					}}
					renderDay={renderDay}
				/>
			</DatesProvider>
			<Group justify="space-between" wrap="nowrap">
				<Button
					variant="subtle"
					size="compact-sm"
					c={today ? "var(--bt-primary-light)" : "var(--bt-muted)"}
					data-muted={today ? undefined : true}
					onClick={() =>
					{
						if (!today) return;
						if (today.slice(0, 7) === shown) onPick(today);
						else setShown(today.slice(0, 7));
					}}
				>
					Today
				</Button>
				{phase === "none" && <Text size="xs" c="var(--bt-muted)">No games this month.</Text>}
			</Group>
		</Stack>
	);
}
