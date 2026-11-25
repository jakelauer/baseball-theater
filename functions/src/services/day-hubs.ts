/**
 * How a schedule write reaches the scoreboard's day hubs (S149 AC 2; ADR-020 as amended 2026-11-16). A game's own
 * updates reach a day hub through the leases it holds with each in-window game's ingest object; what no lease carries
 * is a change the schedule itself brings (a postponement, a new probable pitcher, a game added to the day), so every
 * writer of a stored day (`storeSchedule`'s callers, and the day read's refresh) calls the hub of each date it changed.
 *
 * Only a date whose day has a game in its live window before or after the write is called: no other day can have a
 * socket open (the live route refuses it), so a backfill's past days and a month fill's far days call nothing. The
 * calls are collected while the writes run and made once after them (`DayHubCalls`): one per refresh or fill, not one
 * per game or per day written. A hub with no viewers ignores the call; the local Node server has no hubs, so its
 * composition sets no notifier and the call is skipped.
 */
import type { GameIngestNamespace } from "../game-ingest-object.js";

/** The day hub's name (`DayHubObject`): one per date, so every writer and every viewer of that date reach the same instance. */
export function dayHubName(date: string): string
{
	return `day-hub:${date}`;
}

/** Tells the hub of each of `dates` that its day changed (the Worker: `dayHubNotifier`, one Durable Object call per date). */
export type DayHubNotifier = (dates: readonly string[]) => Promise<void>;

/**
 * The dates one refresh or fill has changed whose day has a game in its window, collected across its writes and sent
 * in one notifier call ({@link DayHubCalls.flush}). A writer that stores one day makes its own; the month fill and the
 * cron's refresh share one across their days.
 */
export class DayHubCalls
{
	private readonly dates = new Set<string>();

	add(date: string): void
	{
		this.dates.add(date);
	}

	/**
	 * Calls `notify` once with every date collected (nothing when none, or when there is no notifier), then forgets them.
	 * A failed call is logged, never thrown: the write it follows is stored, and each hub re-reads its day at its next
	 * lease renewal (at most half a lease later, `HUB_LEASE_MS`), pushing whatever it missed.
	 */
	async flush(notify: DayHubNotifier | undefined): Promise<void>
	{
		const dates = [...this.dates].sort();
		this.dates.clear();
		if (!notify || dates.length === 0) return;
		try
		{
			await notify(dates);
		}
		catch (error)
		{
			console.warn(`day hubs ${dates.join(", ")} not told of their change; each re-reads at its next renewal`, error);
		}
	}
}

/**
 * Tells each date's day hub its day changed, through the `DAY_HUB` binding (S149 AC 2): the Worker's
 * `IngestDeps.dayHubs`. Calls them one after another and rejects with the first failure after trying them all.
 */
export function dayHubNotifier(namespace: GameIngestNamespace): DayHubNotifier
{
	return async (dates) =>
	{
		const failures: string[] = [];
		for (const date of dates)
		{
			try
			{
				const response = await namespace.get(namespace.idFromName(dayHubName(date)) as never).fetch("https://day-hub/publish", {
					method: "POST",
				});
				if (!response.ok) failures.push(`${date}: ${response.status}`);
			}
			catch (error)
			{
				failures.push(`${date}: ${String(error)}`);
			}
		}
		if (failures.length > 0) throw new Error(`day hubs not told: ${failures.join("; ")}`);
	};
}
