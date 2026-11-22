import {
	describe, expect, it,
} from "vitest";
import { parseRecordFixturesArgs, RECORD_FIXTURES_USAGE } from "./record-fixtures-args.js";

describe("parseRecordFixturesArgs (S155)", () =>
{
	it("reads the three forms, with --out, and skips pnpm's bare --", () =>
	{
		expect(parseRecordFixturesArgs(["--", "--season=1950"])).toEqual({
			form: "season",
			season: 1950,
		});
		expect(parseRecordFixturesArgs(["--season=2026", "--spring-date=2026-03-01", "--out=/tmp/x"])).toEqual({
			form: "season",
			season: 2026,
			springDate: "2026-03-01",
			out: "/tmp/x",
		});
		expect(parseRecordFixturesArgs(["--date=1950-07-04"])).toEqual({
			form: "day",
			date: "1950-07-04",
		});
		expect(parseRecordFixturesArgs(["--date=2024-07-04", "--game=744834", "--players=1,2"])).toEqual({
			form: "game",
			date: "2024-07-04",
			gamePk: 744834,
			playerIds: [1, 2],
		});
		expect(parseRecordFixturesArgs(["--date=2024-07-04", "--game=744834"])).toMatchObject({
			playerIds: [],
		});
	});

	it.each([
		[["--date=1950-07-04", "--players=1"], "--players needs --game"],
		[["--season=1950", "--players=1"], "--players can't be used with --season"],
		[["--season=1950", "--game=744834"], "--game can't be used with --season"],
		[["--season=1950", "--date=1950-07-04"], "--date can't be used with --season"],
		[["--spring-date=2026-03-01"], "--spring-date needs --season"],
		[["--date=2026-03-01", "--spring-date=2026-03-01"], "--spring-date needs --season"],
	])("refuses a flag its form would ignore: %j", (argv, message) =>
	{
		expect(() => parseRecordFixturesArgs(argv)).toThrow(message);
		expect(() => parseRecordFixturesArgs(argv)).toThrow(RECORD_FIXTURES_USAGE);
	});

	it.each([
		[[], "--date or --season is required"],
		[["--game=744834"], "--date or --season is required"],
		[["--date=2026-02-30"], "--date must be a real date"],
		[["--season=19x0"], "--season must be a whole number"],
		[["--date=2024-07-04", "--game=abc"], "--game must be a whole number"],
		[["--date=2024-07-04", "--game=744834", "--players=1,x"], "--players must be a whole number"],
		[["--date"], "unknown argument --date"],
		[["--dates=2024-07-04"], "unknown argument --dates=2024-07-04"],
		[["--date=2024-07-04", "--date=2024-07-05"], "--date is given more than once"],
		[["--season=1950", "--out=/a", "--out=/b"], "--out is given more than once"],
	])("refuses what it can't read: %j", (argv, message) =>
	{
		expect(() => parseRecordFixturesArgs(argv)).toThrow(message);
	});
});
