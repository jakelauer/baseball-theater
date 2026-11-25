/**
 * The scoreboard's live connection (S149; ADR-020 as amended 2026-11-16, ADR-022, ADR-014): one WebSocket per shown
 * day to `GET /api/v1/schedule/live?date=`, open only while the day has a game in its live window (2 hours before
 * first pitch to 3 hours after the game, the domain's `scheduleWindowMode`). Each push is the whole served day with
 * its `version`; a newer one reaches the cache only through `writeScheduleDay`, so the scoreboard re-renders in place,
 * and since a push is the whole day any newer version is applied at once (`LiveDayStream`). The reconnect, backoff,
 * `?since=` and polling fallback are the game stream's own (`LiveStream`, `live-stream.ts`), loaded on first use.
 *
 * The window is judged on the cached day's games at the current time, re-judged at least once a minute, so a day
 * loaded before its first game's window opens connects when it does. The wire carries no `suspendedAt`, so a game
 * suspended late and held in its window only by its suspension time is judged by the clock alone here: the scoreboard
 * keeps polling that day instead (the story's accepted gap).
 */
import { scheduleWindowMode } from "@bt/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LiveDayStream } from "./live-stream.js";
import type { ScheduleDayPayload } from "./schedule.js";
import {
	scheduleKey, useCachedScheduleDay, writeScheduleDay,
} from "./schedule.js";

/** How often the window is judged again with no push or fetch to prompt it. */
export const LIVE_DAY_RECHECK_MS = 60 * 1000;

/** What `useLiveDay` tells the scoreboard (as `useLiveGame` tells a game page, S148). */
export type LiveDayState = {
	/** The day has a game in its live window, so the stream is in charge of its freshness (the day query stops re-asking). */
	inWindow: boolean;
	/** The stream's socket is open right now, so pushes are arriving (the footer's Live marker shows). */
	open: boolean;
};

/** Whether `day` has a game in its live window at `now` (the domain's one rule, ADR-025). */
export function isDayInWindow(day: Pick<ScheduleDayPayload, "games"> | undefined, now: Date): boolean
{
	return day !== undefined && scheduleWindowMode(day.games, now) === "active";
}

/**
 * Streams `date` while the cached day has a game in its window: the socket opens when that becomes true (on a fetch,
 * a push, or the minute's re-check), and closes when it turns false (a pushed day out of its window), the day changes
 * or the page unmounts. Returns whether the stream is in charge (`inWindow`), for `useScheduleDay`'s `streaming`, and
 * whether its socket is open (`open`), for the Live marker; the query is fed `inWindow`, never `open`, so a reconnect
 * wait doesn't start query polling on top of the stream's own fallback.
 */
export function useLiveDay(date: string): LiveDayState
{
	const client = useQueryClient();
	const [now, setNow] = useState(() => Date.now());
	const [open, setOpen] = useState(false);
	useEffect(() =>
	{
		const timer = setInterval(() => setNow(Date.now()), LIVE_DAY_RECHECK_MS);
		return () => clearInterval(timer);
	}, []);
	const inWindow = isDayInWindow(useCachedScheduleDay(date), new Date(now));
	useEffect(() =>
	{
		if (!inWindow) return undefined;
		let stream: LiveDayStream<ScheduleDayPayload> | undefined;
		let left = false;
		void import("./live-stream.js").then(({ LiveDayStream: Stream }) =>
		{
			if (left) return;
			stream = new Stream<ScheduleDayPayload>({
				date,
				queryKey: scheduleKey(date),
				client,
				write: (day) => writeScheduleDay(client, day),
				onOpenChange: (isOpen) =>
				{
					if (!left) setOpen(isOpen);
				},
			});
			stream.start();
		});
		return () =>
		{
			left = true;
			stream?.stop();
			setOpen(false);
		};
	}, [date, inWindow, client]);
	return {
		inWindow,
		open,
	};
}
