/**
 * Games per day for a month (S124) and the teams playing each day (S136), which S125's calendar
 * date picker shows. Both come from the stored schedule days' game summaries, which list every
 * game on the day (scheduled, postponed, final, in or out of the live window), never from the
 * games table, which holds only the games ingest hydrated.
 */
import { datesBetween } from "./calendar-date.js";
import type { StoredScheduleDay } from "./game-state.js";

/**
 * One stored schedule day as the month view needs it: its game count, the teams playing it
 * (S136), its games' types and whether it has a regular-season game (S167), the teams of its
 * regular-season games (S191), and its ADR-021/022 stamps.
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
	/** {@link dayRegularSeasonTeamIds} of the day's games, which both repository adapters call (S191). */
	regularSeasonTeamIds: number[] | null;
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
	 * through `favoriteTeamsOff` (S159), marks a favorite team's day off only on a regular-season
	 * day. `null` when it can't be told: BT holds no schedule for the day (`count` is `null`), or no game is regular
	 * season and at least one was stored without a game type (a day stored before S167, until the
	 * backfill re-stores it). Per day rather than per game, since the calendar needs only the day's
	 * answer and the month answer stays one small, shared, cached response (ADR-021).
	 */
	regularSeason: boolean | null;
	/**
	 * The MLB team IDs of the day's regular-season games (S191; `dayRegularSeasonTeamIds`): away
	 * and home of every game whose type is `R`, each once, ascending. `[]` for a stored day with no
	 * regular-season game; `null` exactly when `regularSeason` is.
	 */
	regularSeasonTeamIds: number[] | null;
	/**
	 * The MLB team IDs in their own regular season that day (S191; `teamsInOwnSeason`): each team
	 * whose first regular-season game of the calendar year is on or before the day and whose last is
	 * on or after it, worked out from the year's stored days, not only this month's. With it a
	 * favorite's off-day mark (`favoriteTeamsOff`) follows that team's own season, so an overseas
	 * opener or a tiebreaker day marks no team whose season hasn't started or is already over.
	 * `null` when the year's stored days can't tell (a day of the year untyped or not stored where
	 * it matters); `favoriteTeamsOff` then keeps S159's per-day rule. Every in-season team is sent,
	 * never "a favorite is in season", for the same shared, cached answer (ADR-021).
	 */
	inSeasonTeamIds: number[] | null;
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
 * The teams of a stored day's regular-season games (S191; ADR-025: the one implementation, which
 * both schedule repository adapters call): away and home of every game whose type is `R`, through
 * {@link distinctTeamIds}; `[]` for a day with none; `null` exactly when {@link dayRegularSeason}
 * of the same games is `null` (no `R` game and one untyped, so the day's regular-season teams
 * can't be told). On a day with an `R` game and an untyped one, the untyped game's teams are left
 * out: only a typed `R` game proves a team plays a regular-season game. It takes `unknown` because
 * the types and IDs come out of a stored document, as its two helpers do.
 */
export function dayRegularSeasonTeamIds(games: readonly { gameType: unknown;
	teamIds: readonly unknown[]; }[]): number[] | null
{
	if (dayRegularSeason(games.map((game) => game.gameType)) === null) return null;
	return distinctTeamIds(games.filter((game) => storedGameType(game.gameType) === "R").flatMap((game) => game.teamIds));
}

/**
 * Which teams are in their own regular season on each date of `dates` (S191; ADR-025: the one
 * implementation, which the month answer's `inSeasonTeamIds` carries), from `yearDays`, the stored
 * days of the dates' calendar year(s) (each with its {@link dayRegularSeasonTeamIds}). A team's own
 * season is the span from its first regular-season game's day through its last, in that calendar
 * year, so it is read from the whole year, not the shown month (a team's first game can fall in
 * the month before). One answer per date, in order: the in-season team IDs ascending, or `null`
 * when the stored days can't tell.
 *
 * "Can't tell" is decided per date. A day of the year that isn't stored, whose
 * `regularSeasonTeamIds` is `null` (untyped, stored before S167), or that has an untyped game
 * beside its `R` ones (a `null` in `gameTypes`), is unknown, since it could hold a regular-season
 * game of a team it doesn't list; the last kind still proves its `R` games' teams played. A team counts as in season only when known days prove a regular-season
 * game of it on or before the date and one on or after it. A team left out must be proven out
 * too: either no day from January 1 through the date is unknown and none holds its regular-season
 * game, or no day from the date through December 31 is unknown and none holds one. When some
 * team seen in the year can't be proven either way, or neither side of the date is fully known
 * (so a team never seen could be in season), the date's answer is `null`.
 *
 * The answer is only as fresh as the other months' stored days: a team's first or last game that
 * MLB moved (a postponement at a season's edge) shows once that day is stored again. The month
 * route asks MLB only for the shown month; the rest of the current and next year is stored and kept
 * fresh by the scheduled refresh (S194), every month about every six hours, and an earlier season's
 * days are as the backfill left them. Until a month of the year is stored, the dates it leaves
 * unknown answer `null` here.
 */
export function teamsInOwnSeason(
	yearDays: readonly Pick<ScheduleDayTally, "date" | "gameTypes" | "regularSeasonTeamIds">[],
	dates: readonly string[],
): (number[] | null)[]
{
	const byYear = new Map<string, { first: Map<number, string>;
		last: Map<number, string>;
		firstUnknown: string | undefined;
		lastUnknown: string | undefined; }>();
	const yearOf = (year: string) =>
	{
		const known = byYear.get(year);
		if (known) return known;
		const stored = new Map(yearDays.filter((day) => day.date.startsWith(`${year}-`)).map((day) => [day.date, day]));
		const first = new Map<number, string>();
		const last = new Map<number, string>();
		let firstUnknown: string | undefined;
		let lastUnknown: string | undefined;
		// Walked in date order, so the first sighting is a team's first game and the last its last.
		for (const date of datesBetween(`${year}-01-01`, `${year}-12-31`))
		{
			const day = stored.get(date);
			if (!day || day.regularSeasonTeamIds === null || day.gameTypes.includes(null))
			{
				firstUnknown ??= date;
				lastUnknown = date;
			}
			// An R day with an untyped game is unknown above, yet its R games' teams still played one.
			for (const team of day?.regularSeasonTeamIds ?? [])
			{
				if (!first.has(team)) first.set(team, date);
				last.set(team, date);
			}
		}
		const summary = {
			first,
			last,
			firstUnknown,
			lastUnknown,
		};
		byYear.set(year, summary);
		return summary;
	};
	return dates.map((date) =>
	{
		const {
			first, last, firstUnknown, lastUnknown,
		} = yearOf(date.slice(0, 4));
		const beforeKnown = firstUnknown === undefined || firstUnknown > date;
		const afterKnown = lastUnknown === undefined || lastUnknown < date;
		if (!beforeKnown && !afterKnown) return null;
		const inSeason: number[] = [];
		for (const [team, start] of first)
		{
			const started = start <= date;
			const notOver = last.get(team)! >= date;
			if (started && notOver) inSeason.push(team);
			else if (!((!started && beforeKnown) || (!notOver && afterKnown))) return null;
		}
		return inSeason.sort((a, b) => a - b);
	});
}

/**
 * A stored schedule day's tally for the month view (ADR-025: the one implementation in code; the
 * Postgres adapter computes the same in SQL and the repository contract holds the two together).
 * The memory adapter's `listGameCounts` maps each stored day through it, and the month fill tallies
 * the days it just stored with it (#410) rather than reading the month again, which a caching
 * database could answer with its pre-fill result. It reads only what a stored day keeps (S150:
 * `StoredScheduleDay`, no game statuses), so a fetched `ScheduleDay` passes as well.
 */
export function scheduleDayTally(day: Pick<StoredScheduleDay, "date" | "games" | "fetchedAt" | "lastChangedAt">): ScheduleDayTally
{
	// One `{ gameType, teamIds }` per game, read exactly as the Postgres adapter reads its query's
	// list (S191): count, teams (S136), types (S167, `null` for an untyped one) and the teams of the
	// day's regular-season games (`dayRegularSeasonTeamIds`).
	const games = day.games.map((game) => ({
		gameType: game.gameType as unknown,
		teamIds: [game.teams.away.id, game.teams.home.id] as unknown[],
	}));
	const gameTypes = games.map((game) => storedGameType(game.gameType));
	return {
		date: day.date,
		gameCount: games.length,
		teamIds: distinctTeamIds(games.flatMap((game) => game.teamIds)),
		gameTypes,
		regularSeason: dayRegularSeason(gameTypes),
		regularSeasonTeamIds: dayRegularSeasonTeamIds(games),
		fetchedAt: day.fetchedAt,
		lastChangedAt: day.lastChangedAt,
	};
}

/**
 * One count per date of `dates`, in order, from the stored days' tallies (ADR-025: the one
 * implementation of a day's game count and teams for the month view): a date with no stored day
 * is `null` for all of them, so `teamIds` is `null` exactly when `count` is; `regularSeason` and
 * `regularSeasonTeamIds` are also `null` for a stored day whose answer {@link dayRegularSeason}
 * can't give. `stored` may hold more than the dates' days: the month service passes the whole
 * calendar year, from which {@link teamsInOwnSeason} works out each date's `inSeasonTeamIds`.
 */
export function monthGameCounts(
	dates: readonly string[],
	stored: readonly Pick<ScheduleDayTally, "date" | "gameCount" | "teamIds" | "gameTypes" | "regularSeason" | "regularSeasonTeamIds">[],
): ScheduleDayCount[]
{
	const byDate = new Map(stored.map((day) => [day.date, day]));
	const inSeason = teamsInOwnSeason(stored, dates);
	return dates.map((date, index) =>
	{
		const day = byDate.get(date);
		return {
			date,
			count: day?.gameCount ?? null,
			teamIds: day ? [...day.teamIds] : null,
			regularSeason: day ? day.regularSeason : null,
			regularSeasonTeamIds: day?.regularSeasonTeamIds ? [...day.regularSeasonTeamIds] : null,
			inSeasonTeamIds: inSeason[index] ?? null,
		};
	});
}

/**
 * A month view day as {@link favoriteTeamsOff} reads it: the teams playing it (S136), whether it
 * has a regular-season game (S167) and the teams in their own regular season that day (S191). All
 * are optional and nullable so `ScheduleDayCount` fits, and so does a day from an answer cached
 * before S136, S167 or S191 shipped, which lacks the field for up to the cache cap
 * (`CACHE_LIFETIME_CAP_MS`): such a day then carries no mark, or S159's mark, rather than breaking.
 */
export interface MonthDayTeams
{
	/** The MLB team IDs playing that day; `[]` for no games, `null` or missing when not known. */
	teamIds?: readonly number[] | null;
	/** Whether the day has a regular-season game; `null` or missing when that can't be told. */
	regularSeason?: boolean | null;
	/** The teams in their own regular season that day (`teamsInOwnSeason`); `null` or missing when that can't be told. */
	inSeasonTeamIds?: readonly number[] | null;
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
 * naming the teams). Three owner rules decide which favorites count:
 *
 * - Only during the regular season (owner, 2026-11-21: "Only during the regular season"): only a
 *   day whose `regularSeason` is `true` can carry a mark. Spring training, exhibition, All-Star
 *   (owner, 2026-11-22: "No mark on the All-Star day") and postseason-only days are `false`, and a
 *   day stored before S167 is `null`; none of them is marked.
 * - Only during the favorite's own regular season (S191; owner, 2026-11-23, asked whether the mark
 *   should follow each team's own regular season: chose the follow-up that makes it do so): when
 *   the day's `inSeasonTeamIds` is a list, a favorite not in it (its own season hasn't started or
 *   is already over, as on an overseas opener day or a tiebreaker day) is left out of the mark and
 *   of `off`. When it is `null` or missing (the year's stored days can't tell, or an answer cached
 *   before S191), this rule is skipped and the mark follows the day's `regularSeason` alone, as
 *   S159 shipped it.
 * - Only the favorites with games that month (owner, 2026-11-21: "Only teams with games that
 *   month"): a favorite in no day's `teamIds` in `monthDays` (the shown month's days) is left out of
 *   the mark and of `off`, so a team that didn't exist yet marks nothing. Any game counts here,
 *   regular season or not, so a favorite whose only game that month is a postseason one still
 *   counts, and is named off on the month's regular-season days it doesn't play.
 *   A day whose `teamIds` is `null` or missing names no team, so it puts no favorite in the month.
 *
 * Returns `null` when the day carries no mark: not a regular-season day, no counted favorite (no
 * favorites, none with a game that month, or none in its own season that day), the day's teams
 * unknown (`null` or missing) or none (`[]`, a day A8 already dims), or every counted favorite
 * plays. `off` lists each favorite once, in `favoriteTeamIds`' order.
 */
export function favoriteTeamsOff(day: MonthDayTeams, favoriteTeamIds: readonly number[], monthDays: readonly MonthDayTeams[]): FavoriteTeamsOff | null
{
	if (day.regularSeason !== true || !day.teamIds || day.teamIds.length === 0) return null;
	const inMonth = new Set(monthDays.flatMap((monthDay) => monthDay.teamIds ?? []));
	const inSeason = day.inSeasonTeamIds;
	const counted = [...new Set(favoriteTeamIds)].filter((id) => inMonth.has(id) && (!inSeason || inSeason.includes(id)));
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
 * When a month's or year's stored data last changed (ADR-021's input for its cache lifetime): the latest
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
