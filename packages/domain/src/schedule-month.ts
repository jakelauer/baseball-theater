/**
 * Games per day for a month (S124) and the teams playing each day (S136), which S125's calendar
 * date picker shows. Both come from the stored schedule days' game summaries, which list every
 * game on the day (scheduled, postponed, final, in or out of the live window), never from the
 * games table, which holds only the games ingest hydrated.
 */

/**
 * One stored schedule day as the month view needs it: its game count, the teams playing it
 * (S136), its games' types and whether it has a regular-season game (S167), and its ADR-021/022
 * stamps.
 */
export interface ScheduleDayTally
{
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/** How many games the stored schedule day lists. */
	gameCount: number;
	/**
	 * The MLB team IDs of the away and home team of every game the day lists, each once, in
	 * ascending order ({@link distinctTeamIds}); `[]` for a day with no games.
	 */
	teamIds: number[];
	/**
	 * Each game's MLB `gameType` as stored (S167), one entry per game, so the list is as long as
	 * `gameCount`; `null` for a game stored without one (before S167, or MLB sent none), as
	 * {@link storedGameType} reads it.
	 */
	gameTypes: (string | null)[];
	/** {@link dayRegularSeason} of `gameTypes`, which both repository adapters call. */
	regularSeason: boolean | null;
	/** When the day was last fetched (`ScheduleDay.fetchedAt`). */
	fetchedAt: string;
	/** When the day's content last changed (`ScheduleDay.lastChangedAt`, ADR-022). */
	lastChangedAt: string;
}

/** A day of the month view: its date, its number of games and the teams playing it (S136). */
export interface ScheduleDayCount
{
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/**
	 * How many games the day has; `0` for a stored day with none. `null` when BT holds no
	 * schedule for the day (a past day nothing has stored, or one MLB couldn't be asked for),
	 * so a client can tell "no games" from "not known".
	 */
	count: number | null;
	/**
	 * The MLB team IDs playing that day (away and home of every game counted in `count`, each
	 * once, ascending; S136), so a client can mark the days a fan's favorites play without one
	 * request per day. `[]` for a stored day with no games; `null` exactly when `count` is.
	 * Every team is sent, not "a favorite plays", because favorites are personal and the month
	 * answer is one shared, cached response (ADR-021).
	 */
	teamIds: number[] | null;
	/**
	 * Whether the day has a regular-season game (S167; `dayRegularSeason`), so S159's
	 * calendar marks a favorite team's day off only during the regular season. `null` when it
	 * can't be told: BT holds no schedule for the day (`count` is `null`), or no game is regular
	 * season and at least one was stored without a game type (a day stored before S167, until the
	 * backfill re-stores it). Per day rather than per game, since the calendar needs only the day's
	 * answer and the month answer stays one small, shared, cached response (ADR-021).
	 */
	regularSeason: boolean | null;
}

/**
 * A day's team IDs as the month view sends them: each once, in ascending numeric order, keeping
 * only integers. The one place both schedule repository adapters de-duplicate, sort and drop what
 * isn't a team ID (S136), so the Postgres and memory answers can't drift apart. It takes `unknown`
 * because the IDs come out of a stored schedule document, whose type can't vouch for an older or
 * hand-edited row: a `null` or string ID adds no team rather than a team `0`, `NaN` or `"111"`.
 */
export function distinctTeamIds(ids: Iterable<unknown>): number[]
{
	return [...new Set(ids)].filter((id): id is number => Number.isInteger(id)).sort((a, b) => a - b);
}

/**
 * Whether a stored day has a regular-season game, from its games' MLB game types (S167; ADR-025:
 * the one implementation, which both schedule repository adapters call). `true` when any game is
 * `R`; `false` when every game carries a type and none is `R`, which includes a day with no games
 * and the All-Star Game's day (`A`); `null` when no game is `R` and at least one has no type (a
 * game stored before S167), since that game could have been regular season. It takes `unknown`
 * because the types come out of a stored document: anything but a string counts as no type.
 */
export function dayRegularSeason(gameTypes: readonly unknown[]): boolean | null
{
	if (gameTypes.includes("R")) return true;
	return gameTypes.every((type) => storedGameType(type) !== null) ? false : null;
}

/**
 * A stored game's MLB game type (S167), or `null` when it has none. Anything but a string counts
 * as untyped: missing (a game stored before S167, or MLB sent none), or a value a hand-edited or
 * older document holds. ADR-025: the one test of "this game is typed", which both schedule
 * repository adapters, {@link dayRegularSeason} and `scheduleDayLacksGameType` use.
 */
export function storedGameType(type: unknown): string | null
{
	return typeof type === "string" ? type : null;
}

/**
 * One count per date of `dates`, in order, from the stored days' tallies (ADR-025: the one
 * implementation of a day's game count and teams for the month view): a date with no stored day
 * is `null` for all three, so `teamIds` is `null` exactly when `count` is; `regularSeason` is also
 * `null` for a stored day whose answer {@link dayRegularSeason} can't give.
 */
export function monthGameCounts(dates: readonly string[], stored: readonly Pick<ScheduleDayTally, "date" | "gameCount" | "teamIds" | "regularSeason">[]): ScheduleDayCount[]
{
	const byDate = new Map(stored.map((day) => [day.date, day]));
	return dates.map((date) =>
	{
		const day = byDate.get(date);
		return {
			date,
			count: day?.gameCount ?? null,
			teamIds: day ? [...day.teamIds] : null,
			regularSeason: day ? day.regularSeason : null,
		};
	});
}

/**
 * Whether one of the fan's favorite teams plays on a month view day (S136; S125's calendar marks
 * those days): its `teamIds` include any of `favoriteTeamIds`. The day-level twin of
 * `scoreboardRows`' per-game favorite test. False for a day BT holds no schedule for (`null`), a
 * day with no games (`[]`), a fan with no favorites, and a day with no `teamIds` at all, which an
 * answer cached before S136 shipped can hold for up to the cache cap (`CACHE_LIFETIME_CAP_MS`):
 * the mark is then missing for a while rather than the calendar breaking.
 */
export function dayHasFavoriteTeam(teamIds: readonly number[] | null | undefined, favoriteTeamIds: readonly number[]): boolean
{
	if (!teamIds) return false;
	return teamIds.some((id) => favoriteTeamIds.includes(id));
}

/**
 * What a month's days say about its games (S136; S125's calendar shows the off-season line from
 * it): `"games"` when any day's count is above 0; `"none"` when there is at least one day and
 * every day's count is 0; `"unknown"` otherwise, that is a `null` day with no day above 0 (BT
 * holds no schedule for it, so the month can't be called empty) or no days at all (the calendar
 * passes `[]` while the month loads or after its request fails). What an unknown month shows is
 * S123's design to say, not this function's.
 */
export function monthGamesState(days: readonly Pick<ScheduleDayCount, "count">[]): "games" | "none" | "unknown"
{
	if (days.some((day) => day.count !== null && day.count > 0)) return "games";
	if (days.length > 0 && days.every((day) => day.count === 0)) return "none";
	return "unknown";
}

/**
 * When a month's stored data last changed (ADR-021's input for its cache lifetime): the latest
 * `lastChangedAt` among its stored days, or undefined when it holds none. A day a backfill fills
 * or MLB corrects moves it, so a past month that changes drops back to the ladder's floor.
 */
export function monthLastChangedAt(stored: readonly Pick<ScheduleDayTally, "lastChangedAt">[]): string | undefined
{
	let latest: string | undefined;
	for (const day of stored)
	{
		// Every writer stamps a day (`storeSchedule`), but a stamp read back from a jsonb document is
		// only as good as the document: one that doesn't parse can't say when the month changed.
		if (Number.isNaN(Date.parse(day.lastChangedAt))) continue;
		if (latest === undefined || Date.parse(day.lastChangedAt) > Date.parse(latest)) latest = day.lastChangedAt;
	}
	return latest;
}

/**
 * The days the month view may ask MLB for, given MLB's today (`mlbToday`, `YYYY-MM-DD`): from the
 * first day of the current season (MLB's calendar year), whose days can still change, through
 * December 31 of next year, the furthest MLB publishes a schedule for (it releases next season's
 * during the current one). Earlier seasons show what the backfill (S122) stored; later months are
 * refused (owner, 2026-11-09: "Reject past next year"), see {@link latestScheduleMonth}.
 */
export function scheduleFillWindow(today: string): { first: string;
	last: string; }
{
	const year = Number(today.slice(0, 4));
	return {
		first: `${today.slice(0, 4)}-01-01`,
		last: `${String(year + 1).padStart(4, "0")}-12-31`,
	};
}

/**
 * The latest month the month view answers for (`YYYY-MM`), given MLB's today: December of next
 * year, the end of {@link scheduleFillWindow}. A later month is rejected rather than answered as
 * unknown or asked of MLB (owner, 2026-11-09: "Reject past next year"), so walking the far future
 * costs no MLB request and no stored row.
 */
export function latestScheduleMonth(today: string): string
{
	return scheduleFillWindow(today).last.slice(0, 7);
}
