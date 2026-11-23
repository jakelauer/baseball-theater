/**
 * What S125's calendar tests share: month answers built day by day, an API stub that counts the
 * month requests, and the scoreboard's date control mounted on `/games/:date` as the scoreboard
 * mounts it (keyed by the day), with a record of every location the router visits.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
	MemoryRouter, Route, Routes, useLocation, useNavigate, useParams,
} from "react-router-dom";
import { vi } from "vitest";
import { daysOfMonth } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import type { ScheduleMonthPayload } from "../api/scheduleMonth.js";
import { DateControl } from "../components/scoreboard/DateControl.js";
import type { LayoutVariant } from "../layout/variant.js";
import { ScoreboardPage } from "../pages/ScoreboardPage.js";
import { jsonResponse } from "./jsonResponse.js";

export const YANKEES = 147;
export const METS = 121;
export const RAYS = 139;

/** One day of a month answer; `teamIds` and `regularSeason` default from `count` as S124/S167 send them. */
export interface DayFill
{
	count: number | null;
	teamIds?: number[] | null;
	regularSeason?: boolean | null;
}

/** A month answer whose days `fill` describes (by date). */
export function monthPayload(month: string, fill: (date: string) => DayFill): ScheduleMonthPayload
{
	return {
		month,
		days: daysOfMonth(month).map((date) =>
		{
			const day = fill(date);
			return {
				date,
				count: day.count,
				teamIds: day.teamIds === undefined ? (day.count === null ? null : day.count > 0 ? [YANKEES, METS] : []) : day.teamIds,
				regularSeason: day.regularSeason === undefined ? (day.count === null ? null : day.count > 0) : day.regularSeason,
			};
		}),
	};
}

/** Ten games every day, the Yankees and Mets both playing: a month with no marks. */
export function busyMonth(month: string): ScheduleMonthPayload
{
	return monthPayload(month, () => ({
		count: 10,
	}));
}

/** A month answer: the payload, an HTTP status (with its error code), or `"pending"` (never answers). */
export type MonthAnswer = ScheduleMonthPayload | { status: number;
	error: string; } | "pending";

/**
 * Stubs `fetch`: each month from `months` (any other month answers {@link busyMonth}), the default
 * day as `defaultDate` (`null` never answers), an empty schedule day, and 404 for anything else.
 * Returns the months asked for, in order.
 */
export function serveCalendar(months: Record<string, MonthAnswer> = {}, defaultDate: string | null = "2026-09-21"): () => string[]
{
	const asked: string[] = [];
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const url = new URL(request.url);
		const month = /^\/api\/v1\/schedule\/month\/(.+)$/.exec(url.pathname)?.[1];
		if (month)
		{
			asked.push(month);
			const answer = months[month] ?? busyMonth(month);
			if (answer === "pending") return new Promise<Response>(() => undefined);
			if ("status" in answer) return Promise.resolve(jsonResponse({
				error: answer.error,
			}, answer.status));
			return Promise.resolve(jsonResponse(answer));
		}
		if (url.pathname === "/api/v1/scoreboard/default-date")
		{
			return defaultDate === null ? new Promise<Response>(() => undefined) : Promise.resolve(jsonResponse({
				date: defaultDate,
			}));
		}
		if (url.pathname === "/api/v1/schedule")
		{
			const date = url.searchParams.get("date")!;
			return Promise.resolve(jsonResponse({
				date,
				games: [],
				fetchedAt: `${date}T12:00:00.000Z`,
				windowMode: "inactive",
				version: 1,
				lastChangedAt: `${date}T12:00:00.000Z`,
			}));
		}
		return Promise.resolve(jsonResponse({
			error: "not_found",
		}, 404));
	}));
	return () => asked;
}

/** The date control as the scoreboard mounts it, keyed by the URL's day. */
function ControlForDay({ variant, today }: { variant: LayoutVariant;
	today: string | undefined; })
{
	const { date } = useParams();
	return <DateControl key={date} date={date!} variant={variant} today={today} />;
}

/** Records every location the router shows, and offers the browser's Back as a button. */
function Probe({ seen }: { seen: string[] })
{
	const location = useLocation();
	const navigate = useNavigate();
	if (seen.at(-1) !== `${location.key}|${location.pathname}`) seen.push(`${location.key}|${location.pathname}`);
	return (
		<>
			<output data-testid="path">{location.pathname}</output>
			<button type="button" onClick={() => void navigate(-1)}>Browser back</button>
			<button type="button">Outside</button>
		</>
	);
}

export interface Rendered
{
	client: QueryClient;
	/** The pathnames of every location visited, first included (one per history move). */
	visits: () => string[];
}

function mount(entries: string[], element: ReactNode): Rendered
{
	const client = createQueryClient();
	const seen: string[] = [];
	render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
					<Probe seen={seen} />
					<Routes>
						<Route path="/games/:date" element={element} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return {
		client,
		visits: () => seen.map((entry) => entry.split("|")[1]!),
	};
}

/** The date control alone on `/games/:date`, at `entries`' last path; `today` null is still loading. */
export function renderControl(entries: string[], variant: LayoutVariant = "medium", today: string | null = "2026-09-21"): Rendered
{
	return mount(entries, <ControlForDay variant={variant} today={today ?? undefined} />);
}

/** The whole scoreboard page on `/games/:date`, at `entries`' last path. */
export function renderScoreboard(entries: string[], variant: LayoutVariant = "medium"): Rendered
{
	return mount(entries, <ScoreboardPage variant={variant} />);
}
