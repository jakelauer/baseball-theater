/**
 * Games per day for a month (S124) and the teams playing each day (S136), which S125's calendar
 * date picker shows. Both come from the stored schedule days' game summaries, which list every
 * game on the day (scheduled, postponed, final, in or out of the live window), never from the
 * games table, which holds only the games ingest hydrated.
 */
import type { ScheduleDay } from "./types.js";

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
	 * once, ascending; S136), so a client can mark the days a fan's favorites don't play
	 * (`favoriteTeamsOff`, S159) without one request per day. `[]` for a stored day with no
	 * games; `null` exactly when `count` is.
	 * Every team is sent, not "a favorite plays", because favorites are personal and the month
	 * answer is one shared, cached response (ADR-021).
	 */
	teamIds: number[] | null;
	/**
	 * Whether the day has a regular-season game (S167; `dayRegularSeason`), so S125's calendar,
	 * through `favoriteTeamsOff` (S159), marks a favorite team's day off only during the regular
	 * season. `null` when it can't be told: BT holds no schedule for the day (`count` is `null`), or no game is regular
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
 * A stored schedule day's tally for the month view (ADR-025: the one implementation in code; the
 * Postgres adapter computes the same in SQL and the repository contract holds the two together).
 * The memory adapter's `listGameCounts` maps each stored day through it, and the month fill tallies
 * the days it just stored with it (#410) rather than reading the month again, which a caching
 * database could answer with its pre-fill result.
 */
export function scheduleDayTally(day: Pick<ScheduleDay, "date" | "games" | "fetchedAt" | "lastChangedAt">): ScheduleDayTally
{
	// One entry per game, `null` for an untyped one, as the Postgres adapter reads it (S167).
	const gameTypes = day.games.map((game) => storedGameType(game.gameType));
	return {
		date: day.date,
		gameCount: day.games.length,
		teamIds: distinctTeamIds(day.games.flatMap((game) => [game.teams.away.id, game.teams.home.id])),
		gameTypes,
		regularSeason: dayRegularSeason(gameTypes),
		fetchedAt: day.fetchedAt,
		lastChangedAt: day.lastChangedAt,
	};
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
 * A month view day as {@link favoriteTeamsOff} reads it: the teams playing it (S136) and whether it
 * has a regular-season game (S167). Both are optional and nullable so `ScheduleDayCount` fits, and
 * so does a day from an answer cached before S136 or S167 shipped, which lacks the field for up to
 * the cache cap (`CACHE_LIFETIME_CAP_MS`): such a day then carries no mark rather than breaking.
 */
export interface MonthDayTeams
{
	/** The MLB team IDs playing that day; `[]` for no games, `null` or missing when not known. */
	teamIds?: readonly number[] | null;
	/** Whether the day has a regular-season game; `null` or missing when that can't be told. */
	regularSeason?: boolean | null;
}

/**
 * A day's favorite-team off-day mark (S159; shell-scoreboard A8): `off` lists the favorites that
 * don't play, in the fan's order; `mark` is `red` when none of the counted favorites plays and
 * `yellow` when at least one plays but not all.
 */
export interface FavoriteTeamsOff
{
	mark: "red" | "yellow";
	off: number[];
}

/**
 * Which of a fan's favorite teams are off on a month view day, and whether S125's calendar marks
 * that day red or yellow (S159; ADR-025: the one implementation, the calendar only formats it,
 * naming the teams). Two owner rules decide which favorites count:
 *
 * - Only during the regular season (owner, 2026-11-21: "Only during the regular season"): only a
 *   day whose `regularSeason` is `true` can carry a mark. Spring training, exhibition, All-Star
 *   (owner, 2026-11-22: "No mark on the All-Star day") and postseason-only days are `false`, and a
 *   day stored before S167 is `null`; none of them is marked. "Regular season" is decided per
 *   day, from any of the day's games, not per team: on an opener day (MLB's overseas opening
 *   series) or a tiebreaker day, a favorite can be marked off although its own regular season
 *   hasn't started or is already over. A follow-up story is planned to make the mark follow each
 *   team's own season (owner, 2026-11-23: "Ship now, fix later"); it needs each game's type per
 *   team, which the month answer doesn't carry yet.
 * - Only the favorites with games that month (owner, 2026-11-21: "Only teams with games that
 *   month"): a favorite in no day's `teamIds` in `monthDays` (the shown month's days) is left out of
 *   the mark and of `off`, so a team that didn't exist yet marks nothing. Any game counts here,
 *   regular season or not, so a favorite whose only game that month is a postseason one still
 *   counts, and is named off on the month's regular-season days it doesn't play.
 *   A day whose `teamIds` is `null` or missing names no team, so it puts no favorite in the month.
 *
 * Returns `null` when the day carries no mark: not a regular-season day, no counted favorite (no
 * favorites, or none with a game that month), the day's teams unknown (`null` or missing) or none
 * (`[]`, a day A8 already dims), or every counted favorite plays. `off` lists each favorite once,
 * in `favoriteTeamIds`' order.
 */
export function favoriteTeamsOff(day: MonthDayTeams, favoriteTeamIds: readonly number[], monthDays: readonly MonthDayTeams[]): FavoriteTeamsOff | null
{
	if (day.regularSeason !== true || !day.teamIds || day.teamIds.length === 0) return null;
	const inMonth = new Set(monthDays.flatMap((monthDay) => monthDay.teamIds ?? []));
	const counted = [...new Set(favoriteTeamIds)].filter((id) => inMonth.has(id));
	const playing = day.teamIds;
	const off = counted.filter((id) => !playing.includes(id));
	if (off.length === 0) return null;
	return {
		mark: off.length === counted.length ? "red" : "yellow",
		off,
	};
}

/**
 * Whether every day of a month is known (#399): none has `count: null`, the mark of a day BT holds
 * no schedule for (a fill MLB didn't answer, or a past day nothing stored). The month route caches
 * an incomplete month only for the fill's cooldown and the web keeps it only that long, so both ask
 * this one question; unlike {@link monthGamesState}, one unknown day beside a day with games counts.
 */
export function monthComplete(days: readonly Pick<ScheduleDayCount, "count">[]): boolean
{
	return days.every((day) => day.count !== null);
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
