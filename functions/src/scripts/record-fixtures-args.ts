/**
 * `record-fixtures`' arguments, parsed apart from the command (S155) so they can be tested without
 * running it: the command touches live MLB and is never run by CI, and this module touches nothing.
 * Each form takes only its own flags, and a flag no form would read is refused rather than ignored,
 * so a mistyped command can't record something other than what was asked for (`--players` without
 * `--game` used to record the day's standings alone, silently dropping the players).
 */
import { isCalendarDate } from "@bt/domain";

/** What the command records: a season's calendar and tables, one day's standings, or one game. */
export type RecordFixturesArgs =
	| { form: "season";
		season: number;
		springDate?: string;
		out?: string; }
	| { form: "day";
		date: string;
		out?: string; }
	| { form: "game";
		date: string;
		gamePk: number;
		playerIds: number[];
		out?: string; };

/** Printed with every argument error, so a mistyped command shows what it takes. */
export const RECORD_FIXTURES_USAGE =
	"usage: record-fixtures --date=YYYY-MM-DD [--game=<gamePk> [--players=1,2,3]] [--out=<dir>] | --season=YYYY [--spring-date=YYYY-MM-DD] [--out=<dir>]";

const FLAGS = new Set(["season", "spring-date", "date", "game", "players", "out"]);

function fail(message: string): never
{
	throw new Error(`${message}\n${RECORD_FIXTURES_USAGE}`);
}

/** A whole number above zero, or a usage error naming `flag`. */
function positiveInteger(flag: string, value: string): number
{
	const n = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n <= 0) fail(`--${flag} must be a whole number, not ${value}`);
	return n;
}

/** A real calendar day, or a usage error naming `flag`. */
function calendarDate(flag: string, value: string): string
{
	if (!isCalendarDate(value)) fail(`--${flag} must be a real date, YYYY-MM-DD, not ${value}`);
	return value;
}

/** Parses `argv` (without node and the script; a bare `--` from pnpm is skipped); throws with {@link RECORD_FIXTURES_USAGE}. */
export function parseRecordFixturesArgs(argv: readonly string[]): RecordFixturesArgs
{
	const values = new Map<string, string>();
	for (const arg of argv)
	{
		if (arg === "--") continue;
		const match = /^--([a-z-]+)=(.*)$/s.exec(arg);
		if (!match || !FLAGS.has(match[1]!)) fail(`unknown argument ${arg}`);
		// A second value would otherwise quietly replace the first.
		if (values.has(match[1]!)) fail(`--${match[1]} is given more than once`);
		values.set(match[1]!, match[2]!);
	}
	const out = values.get("out");
	const outPart = out === undefined ? {} : {
		out,
	};
	const season = values.get("season");
	const springDate = values.get("spring-date");
	if (season !== undefined)
	{
		for (const flag of ["date", "game", "players"])
		{
			if (values.has(flag)) fail(`--${flag} can't be used with --season`);
		}
		return {
			form: "season",
			season: positiveInteger("season", season),
			...(springDate === undefined ? {} : {
				springDate: calendarDate("spring-date", springDate),
			}),
			...outPart,
		};
	}
	if (springDate !== undefined) fail("--spring-date needs --season");
	const date = values.get("date");
	if (date === undefined) fail("--date or --season is required");
	calendarDate("date", date);
	const game = values.get("game");
	const players = values.get("players");
	if (game === undefined)
	{
		if (players !== undefined) fail("--players needs --game");
		return {
			form: "day",
			date,
			...outPart,
		};
	}
	return {
		form: "game",
		date,
		gamePk: positiveInteger("game", game),
		playerIds: players === undefined || players === "" ? [] : players.split(",").map((id) => positiveInteger("players", id)),
		...outPart,
	};
}
