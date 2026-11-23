import {
	ActionIcon, Drawer, Group, Popover, Text, UnstyledButton,
} from "@mantine/core";
import { useReducedMotion, useWindowEvent } from "@mantine/hooks";
import {
	IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays } from "@bt/domain";
import { useScheduleMonth } from "../../api/scheduleMonth.js";
import { formatDate } from "../../format/datetime.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useSettings } from "../../settings/store.js";
import { CalendarPanel } from "./CalendarPanel.js";

/** The scoreboard's day path, `/games/<date>`: where the arrows, a pick and `Today` go by default. */
function scoreboardPath(date: string): string
{
	return `/games/${date}`;
}

export interface DateControlProps
{
	/** The day shown, `YYYY-MM-DD`. */
	date: string;
	/** The host's pairing (`useLayoutVariant()` in `AppShellLayout`): a sheet on mobile, a dropdown otherwise. */
	variant: LayoutVariant;
	/** A8's "today" for the calendar's `Today` (`useScoreboardDefaultDate`); `undefined` while it loads. */
	today: string | undefined;
	/** Where a day goes; the scoreboard's `/games/<date>` unless a page (S138) gives its own. */
	dayPath?: (date: string) => string;
}

/**
 * The scoreboard's date control (S31; S66; S125): ‹ [calendar glyph `SEP 21, 2026` ▾] › on a
 * hairline bar under the header, edge to edge. Previous and next are links to the day before and
 * after (`addDays`), so the day lives in the URL and back / forward work. The middle is A8's
 * `date-selector` button, Raised current while open, which opens `CalendarPanel`: a bottom sheet
 * on mobile sliding up in 200ms (in place, no slide, when the device asks for reduced motion) and a
 * dropdown under the button on medium and desktop. Neither adds to the URL or the history; a click
 * outside or Esc closes it without changing the day.
 *
 * The open state is this component's own, and the scoreboard gives it a `key` of the day, so any
 * change of day (a pick, an arrow, the browser's Back) remounts it closed (A8, "Back"). It asks for
 * the shown day's month (`useScheduleMonth`) as the page loads, so the calendar opens already
 * filled (owner, 2026-11-10: "It should already be loaded.").
 */
export function DateControl({
	date, variant, today, dayPath = scoreboardPath,
}: DateControlProps)
{
	const [open, setOpen] = useState(false);
	const reduceMotion = useReducedMotion();
	const navigate = useNavigate();
	const { favoriteTeamIds } = useSettings();
	useScheduleMonth(date.slice(0, 7));
	// Esc closes the calendar without changing the day wherever focus is (owner, 2026-11-10); the
	// dropdown's own Esc handling only hears it while focus is inside it.
	useWindowEvent("keydown", (event) =>
	{
		if (event.key === "Escape") setOpen(false);
	});

	function goTo(day: string): void
	{
		setOpen(false);
		if (day !== date) void navigate(dayPath(day));
	}

	const panel = (
		<CalendarPanel
			date={date}
			today={today}
			favoriteTeamIds={favoriteTeamIds}
			container={variant === "mobile" ? "sheet" : "dropdown"}
			onPick={goTo}
			onClose={() => setOpen(false)}
		/>
	);

	const button = (
		<UnstyledButton
			data-testid="date-selector"
			data-open={open || undefined}
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-label={`Choose a date, ${formatDate(date)}`}
			onClick={() => setOpen((was) => !was)}
			px={12}
			py={8}
			style={{
				border: "1px solid var(--bt-hairline)",
				borderRadius: 8,
				background: open ? "var(--bt-raised-current)" : "transparent",
			}}
		>
			<Group gap={8} wrap="nowrap">
				<IconCalendar size={16} aria-hidden />
				<Text size="sm" fw={700} tt="uppercase">{formatDate(date)}</Text>
				<IconChevronDown size={14} aria-hidden />
			</Group>
		</UnstyledButton>
	);

	return (
		<Group
			component="nav"
			aria-label="Date"
			data-testid="date-control"
			justify="space-between"
			wrap="nowrap"
			px="md"
			py={8}
			mx="calc(var(--mantine-spacing-md) * -1)"
			mt="calc(var(--mantine-spacing-md) * -1)"
			style={{
				borderBottom: "1px solid var(--bt-hairline)",
			}}
		>
			<ActionIcon component={Link} to={dayPath(addDays(date, -1))} aria-label="Previous day" variant="subtle" color="gray">
				<IconChevronLeft size={20} />
			</ActionIcon>
			{variant === "mobile"
				? (
					<>
						{button}
						<Drawer
							opened={open}
							onClose={() => setOpen(false)}
							position="bottom"
							size="auto"
							withCloseButton={false}
							overlayProps={{
								backgroundOpacity: 0.7,
								color: "var(--bt-dark)",
							}}
							transitionProps={{
								transition: "slide-up",
								duration: reduceMotion ? 0 : 200,
								timingFunction: "ease-out",
							}}
							styles={{
								// The sheet is as tall as the calendar, not the screen (A8 `scoreboard-calendar-open-mobile`).
								content: {
									height: "auto",
									flex: "0 0 auto",
									borderTopLeftRadius: 16,
									borderTopRightRadius: 16,
									background: "var(--bt-raised)",
								},
								body: {
									padding: 0,
								},
							}}
						>
							{panel}
						</Drawer>
					</>
				)
				: (
					<Popover opened={open} onChange={setOpen} position="bottom" width={344} transitionProps={{
						duration: 0,
					}}
					>
						<Popover.Target>{button}</Popover.Target>
						<Popover.Dropdown p={0} bg="var(--bt-raised)" aria-label="Calendar" role="dialog">
							{panel}
						</Popover.Dropdown>
					</Popover>
				)}
			<ActionIcon component={Link} to={dayPath(addDays(date, 1))} aria-label="Next day" variant="subtle" color="gray">
				<IconChevronRight size={20} />
			</ActionIcon>
		</Group>
	);
}
