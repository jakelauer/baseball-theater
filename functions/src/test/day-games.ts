/**
 * Schedule games for S149's day hub tests: the 2024-07-04 fixture's first game re-dated and re-timed, live, scheduled
 * or postponed, with a home score when given, so a test can place each game in or out of its live window.
 */
import type { ScheduleGameSummary } from "@bt/domain";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";

const STATUS = {
	live: {
		abstractGameState: "Live",
		codedGameState: "I",
		detailedState: "In Progress",
	},
	scheduled: {
		abstractGameState: "Preview",
		codedGameState: "S",
		detailedState: "Scheduled",
	},
	postponed: {
		abstractGameState: "Final",
		codedGameState: "D",
		detailedState: "Postponed",
	},
};

/** Builds a game of `date` starting at `startTime`; `live` (or `status`) sets its status, `homeRuns` its score. */
export type GameFactory = (gamePk: number, date: string, opts: { startTime: string;
	live?: boolean;
	status?: keyof typeof STATUS;
	homeRuns?: number; }) => ScheduleGameSummary;

/** A {@link GameFactory} over the fixture's first game. */
export async function gameFactory(): Promise<GameFactory>
{
	const template = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games[0]!;
	return (gamePk, date, opts) => ({
		...template,
		gamePk,
		officialDate: date,
		gameDate: date,
		startTime: opts.startTime,
		status: STATUS[opts.status ?? (opts.live ? "live" : "scheduled")],
		linescore: opts.homeRuns === undefined ? null : {
			currentInning: 5,
			inningState: "Top",
			isTopInning: true,
			outs: 0,
			balls: 0,
			strikes: 0,
			teams: {
				home: {
					runs: opts.homeRuns,
					hits: 0,
					errors: 0,
				},
				away: {
					runs: 0,
					hits: 0,
					errors: 0,
				},
			},
		} as ScheduleGameSummary["linescore"],
	});
}
