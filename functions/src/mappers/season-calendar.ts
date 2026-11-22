/**
 * Pure upstream → BT mapper for one season's calendar (S111): the first spring game's day
 * from MLB's season calendar (or, for a season MLB gives no spring for, its first regular-season
 * day, S155), and the last postseason game's day from that season's World
 * Series schedule. MLB's `postSeasonEndDate` is the scheduled end of the window and is
 * corrected to the real final only later (2026 read 10-31 after a 10-28 final), so the
 * World Series' last game wins once one is listed; before the Series is scheduled the
 * calendar's date stands in. An unpublished season (`seasons: []`) maps to null. The regular
 * season's first and last days (S128) are carried when MLB lists them; standings need both. The
 * World Series winner and the day it was won (S140) come from the same schedule, so they cost no
 * request of their own.
 *
 * A season MLB gives no `springStartDate` for (such as 1950: MLB gives none for the early seasons
 * the recordings show; what counts is the field being absent, not the year) but whose
 * regular-season days it does give starts on its first regular-season day: it had no spring MLB
 * records, and without a calendar an off-season day would fall to that day's own table, which MLB
 * doesn't keep. With one, the day after `regularSeasonEndDate` answers the season's final table
 * (S155 AC 3; owner, 2026-11-22: "Use the season's last day (Recommended)").
 */
import type { SeasonCalendar, SeasonChampion } from "@bt/domain";
import type {
	ScheduleGame, ScheduleResponse, SeasonsResponse,
} from "@bt/mlb-api";

/** The World Series games that are still on (not cancelled), each with its day, earliest first. */
function seriesGamesOn(worldSeries: ScheduleResponse): { date: string;
	game: ScheduleGame; }[]
{
	return worldSeries.dates
		.flatMap((day) => day.games.filter((game) => game.status.detailedState !== "Cancelled").map((game) => ({
			date: day.date,
			game,
		})))
		.sort((a, b) => a.date.localeCompare(b.date) || a.game.gameDate.localeCompare(b.game.gameDate));
}

/** The last day the World Series lists a game that is still on (not cancelled), if any. */
function worldSeriesFinal(worldSeries: ScheduleResponse): string | undefined
{
	return seriesGamesOn(worldSeries).at(-1)?.date;
}

/**
 * Who won the World Series (S140 AC 1), from the schedule `mapSeasonCalendar` already reads: the side
 * whose wins in the series, as of the season's last final game that wasn't cancelled, are more than
 * half of that game's `gamesInSeries` (4 of 7; 5 of 9 in 1903 and 1919–1921). A postponed game is
 * "Final" in MLB's abstract state but was never played, so it doesn't count. `wonOn` is that game's
 * day. Null while the series is under way, for a season with no Series or an empty schedule, and
 * when the game lacks `gamesInSeries` or either side's series record: never a guess.
 */
export function worldSeriesChampion(worldSeries: ScheduleResponse): SeasonChampion | null
{
	const last = seriesGamesOn(worldSeries)
		.filter(({ game }) => game.status.abstractGameState === "Final" && game.status.detailedState !== "Postponed")
		.at(-1);
	if (!last) return null;
	const { gamesInSeries, teams: { away, home } } = last.game;
	// Both sides' records, not just the winner's: one missing record means MLB's answer is incomplete.
	if (!gamesInSeries || !away.leagueRecord || !home.leagueRecord) return null;
	const winner = away.leagueRecord.wins > gamesInSeries / 2 ? away : home.leagueRecord.wins > gamesInSeries / 2 ? home : undefined;
	if (!winner) return null;
	return {
		teamId: winner.team.id,
		name: winner.team.name,
		wonOn: last.date,
	};
}

export function mapSeasonCalendar(seasons: SeasonsResponse, worldSeries: ScheduleResponse): SeasonCalendar | null
{
	const season = seasons.seasons[0];
	const lastGameDate = worldSeriesFinal(worldSeries) ?? season?.postSeasonEndDate ?? season?.seasonEndDate;
	const firstDay = season?.springStartDate ?? (season?.regularSeasonEndDate ? season.regularSeasonStartDate : undefined);
	if (!season || !firstDay || !lastGameDate) return null;
	const champion = worldSeriesChampion(worldSeries);
	return {
		season: Number(season.seasonId),
		springStartDate: firstDay,
		lastGameDate,
		...(season.regularSeasonStartDate ? {
			regularSeasonStartDate: season.regularSeasonStartDate,
		} : {}),
		...(season.regularSeasonEndDate ? {
			regularSeasonEndDate: season.regularSeasonEndDate,
		} : {}),
		...(champion ? {
			champion,
		} : {}),
	};
}
