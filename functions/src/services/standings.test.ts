/**
 * The standings service (S128) on the committed recordings: `HttpMlbStatsClient` over
 * `fixtures/raw/` (`recordedClient`), so every table is MLB's own answer and every URL is the
 * one production asks. A test's own case (an empty table, a failed calendar) is an override.
 */
import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { recordedClient } from "../test/recorded-mlb.js";
import { getStandings, standingsNothingYet } from "./standings.js";

const AL_EAST_FIRST = [201, 202, 200, 204, 205, 203];
/** MLB's recorded regular-season table for 2026-09-05, served for a day with no recording of its own. */
const SEPTEMBER_5: unknown = JSON.parse(readFileSync(new URL("../../../fixtures/raw/standings-2026-09-05.json", import.meta.url), "utf8"));

/** The fixed answers a test can give a URL. */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
	status,
});
const emptyTable = () => json({
	copyright: "",
	records: [],
});

/** The answer alone: what every test but the calendar-completeness ones reads (S139 B2's `calendarsComplete` beside it). */
async function answerOf(...args: Parameters<typeof getStandings>)
{
	return (await getStandings(...args)).answer;
}

function teams(divisions: { teams: unknown[] }[]): number
{
	return divisions.reduce((n, d) => n + d.teams.length, 0);
}

describe("getStandings (S128)", () =>
{
	it("after the regular season it is the final table, dated the season's regularSeasonEndDate", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await answerOf({
			mlb,
		}, "2026-11-08");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(table.divisions.map((d) => d.divisionId)).toEqual(AL_EAST_FIRST);
		const standings = new URL(asked.find((u) => u.includes("/api/v1/standings"))!);
		expect(standings.searchParams.get("season")).toBe("2026");
		expect(standings.searchParams.has("date")).toBe(false);
		expect(standings.searchParams.has("standingsTypes")).toBe(false);
	});

	it("in the spring it is the spring table as of the day, in the regular season's division order", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await answerOf({
			mlb,
		}, "2026-03-01");
		expect(table).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-01",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(table.divisions.map((d) => d.divisionId)).toEqual(AL_EAST_FIRST);
		const standings = new URL(asked.find((u) => u.includes("/api/v1/standings"))!);
		expect(standings.searchParams.get("standingsTypes")).toBe("springTraining");
		expect(standings.searchParams.get("season")).toBe("2026");
		expect(standings.searchParams.get("date")).toBe("2026-03-01");
	});

	it("in the regular season it is the regular-season table for the day (standingsUrl)", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await answerOf({
			mlb,
		}, "2026-09-05");
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-05",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(asked).toContain("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026&date=2026-09-05&hydrate=team");
	});

	it("a past date is judged against its own year's and the year before's calendars (2019-11-01: 2019's final table)", async () =>
	{
		const calendar2019 = {
			copyright: "",
			seasons: [{
				seasonId: "2019",
				springStartDate: "2019-02-21",
				regularSeasonStartDate: "2019-03-20",
				regularSeasonEndDate: "2019-09-29",
				postSeasonEndDate: "2019-10-30",
			}],
		};
		const { mlb, asked } = recordedClient((url) => url.pathname === "/api/v1/seasons/2019" ? json(calendar2019) : undefined);
		const table = await answerOf({
			mlb,
		}, "2019-11-01");
		expect(table).toMatchObject({
			phase: "final",
			season: 2019,
			date: "2019-09-29",
		});
		expect(asked.some((u) => u.includes("/api/v1/seasons/2018"))).toBe(true);
		expect(asked.some((u) => u.includes("/api/v1/seasons/2019"))).toBe(true);
		expect(asked.some((u) => u.includes("season=2019&hydrate=team"))).toBe(true);
	});

	it("without a date it is MLB's today, not the UTC day (03:00 UTC on 09-28 is still the last regular-season day)", async () =>
	{
		// No 09-27 recording is committed, so that day is served 09-05's table (a full regular-season one).
		const { mlb, asked } = recordedClient((url) => url.searchParams.get("date") === "2026-09-27" ? json(SEPTEMBER_5) : undefined);
		const table = await answerOf({
			mlb,
			now: () => new Date("2026-09-28T03:00:00.000Z"),
		});
		expect(asked.some((u) => u.includes("season=2026&date=2026-09-27&hydrate=team"))).toBe(true);
		expect(asked.some((u) => u.includes("date=2026-09-28"))).toBe(false);
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an empty mid-season or mid-spring table has no fallback: it is returned as it is, labelled with its own phase (AC 3)", async () =>
	{
		const midSeason = recordedClient((url) => url.searchParams.get("date") === "2026-07-01" ? emptyTable() : undefined);
		// No phases asked (S139), so this counts S128's own table alone.
		expect(await answerOf({
			mlb: midSeason.mlb,
		}, "2026-07-01", [])).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-07-01",
			divisions: [],
		});
		expect(midSeason.asked.filter((u) => u.includes("/api/v1/standings"))).toHaveLength(1);
		// With every phase (S139), the mid-season regular season stays MLB's empty table: the 0-0 list is only for before the first game.
		const withPhases = recordedClient((url) => url.searchParams.get("date") === "2026-07-01" ? emptyTable() : undefined);
		expect((await answerOf({
			mlb: withPhases.mlb,
		}, "2026-07-01")).phases.regularSeason!.table!.divisions).toEqual([]);

		const midSpring = recordedClient((url) => url.searchParams.get("date") === "2026-03-01" ? emptyTable() : undefined);
		expect(await answerOf({
			mlb: midSpring.mlb,
		}, "2026-03-01", [])).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-01",
			divisions: [],
		});
		expect(midSpring.asked.filter((u) => u.includes("/api/v1/standings"))).toHaveLength(1);
	});

	it("an empty spring table falls back to the previous season's final table (2027-02-19 morning)", async () =>
	{
		const { mlb } = recordedClient();
		const table = await answerOf({
			mlb,
		}, "2027-02-19");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an empty opening-day table falls back to spring's as of the last spring day", async () =>
	{
		const { mlb, asked } = recordedClient();
		const table = await answerOf({
			mlb,
		}, "2026-03-25");
		expect(table).toMatchObject({
			phase: "spring",
			season: 2026,
			date: "2026-03-24",
		});
		expect(teams(table.divisions)).toBe(30);
		expect(asked.some((u) => u.includes("standingsTypes=springTraining&date=2026-03-24"))).toBe(true);
	});

	it("an empty table with nothing before it is returned as it is", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname === "/api/v1/standings" ? emptyTable() : undefined);
		const table = await answerOf({
			mlb,
		}, "2026-11-08");
		expect(table).toMatchObject({
			phase: "final",
			season: 2026,
			divisions: [],
		});
	});

	it("request budget: S128's own table: two calendars (four requests) and one table, one more only for the fallback", async () =>
	{
		// No phases asked (S139): S128's table alone; S139's budget with phases is its own test.
		const final = recordedClient();
		await answerOf({
			mlb: final.mlb,
		}, "2026-11-08", []);
		expect(final.asked.filter((u) => !u.includes("/api/v1/standings"))).toHaveLength(4);
		expect(final.asked).toHaveLength(5);

		const fallback = recordedClient();
		await answerOf({
			mlb: fallback.mlb,
		}, "2027-02-19", []);
		expect(fallback.asked).toHaveLength(6);
	});

	it("with no calendar (the seasons request failed) it is the day's regular-season table", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname.startsWith("/api/v1/seasons/") ? json({}, 500) : undefined);
		const table = await answerOf({
			mlb,
		}, "2026-09-05");
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-05",
		});
		expect(teams(table.divisions)).toBe(30);
	});

	it("an unreachable calendar for the day's year is no calendar, not an unpublished one: mid-season is the day's table, not last season's final (AC 7)", async () =>
	{
		const seasonsDown = recordedClient((url) => url.pathname === "/api/v1/seasons/2026" ? json({}, 500) : undefined);
		const table = await answerOf({
			mlb: seasonsDown.mlb,
		}, "2026-07-01");
		expect(table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-07-01",
		});
		expect(seasonsDown.asked.some((u) => u.includes("season=2026&date=2026-07-01&hydrate=team"))).toBe(true);
	});

	it("an unreachable World Series schedule for the day's year is likewise no calendar: mid-season is the day's table (AC 7)", async () =>
	{
		const worldSeriesDown = recordedClient((url) => url.searchParams.get("gameType") === "W" && url.searchParams.get("season") === "2026" ? json({}, 500) : undefined);
		expect(await answerOf({
			mlb: worldSeriesDown.mlb,
		}, "2026-07-01")).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-07-01",
		});
	});

	it("an unreachable calendar for the year before never puts another season's final in its place (January: the day's own table)", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname === "/api/v1/seasons/2026" ? json({}, 500) : undefined);
		expect(await answerOf({
			mlb,
		}, "2027-01-15")).toMatchObject({
			phase: "regularSeason",
			season: 2027,
			date: "2027-01-15",
		});
	});

	it("an unpublished next season (MLB's empty seasons list) keeps the last season's final table (2027-03-01 with 2027 unpublished)", async () =>
	{
		const { mlb } = recordedClient((url) =>
		{
			if (url.pathname === "/api/v1/seasons/2027") return json({
				copyright: "",
				seasons: [],
			});
			if (url.searchParams.get("gameType") === "W" && url.searchParams.get("season") === "2027") return json({
				copyright: "",
				totalItems: 0,
				totalEvents: 0,
				totalGames: 0,
				totalGamesInProgress: 0,
				dates: [],
			});
			return undefined;
		});
		expect(await answerOf({
			mlb,
		}, "2027-03-01")).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
	});

	it("an MLB error on the table is an error, not an empty table", async () =>
	{
		const { mlb } = recordedClient((url) => url.pathname === "/api/v1/standings" ? json({}, 500) : undefined);
		await expect(answerOf({
			mlb,
		}, "2026-11-08")).rejects.toThrow();
	});
});

/** The standings requests a run asked (the calendars left out). */
const standingsAsked = (asked: string[]) => asked.filter((u) => u.includes("/api/v1/standings"));

describe("getStandings phases (S139)", () =>
{
	it("every phase's dates and tables on a regular-season day (2026-09-05); S128's fields unchanged at the top", async () =>
	{
		const { mlb } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2026-09-05");
		expect(answer).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-05",
		});
		expect(answer.phases.spring).toMatchObject({
			startDate: "2026-02-20",
			endDate: "2026-03-24",
			table: {
				phase: "spring",
				season: 2026,
				date: "2026-03-24",
			},
		});
		expect(answer.phases.regularSeason).toMatchObject({
			startDate: "2026-03-25",
			endDate: "2026-09-27",
			table: {
				phase: "regularSeason",
				date: "2026-09-05",
			},
		});
		expect(teams(answer.phases.regularSeason!.table!.divisions)).toBe(30);
		expect(answer.phases.playoffs).toMatchObject({
			startDate: "2026-09-28",
			endDate: "2026-10-28", // the World Series final, from its schedule
		});
	});

	it("playoffs list: 2026-09-12's clinched teams in their divisions, and 2026-09-05's table with no division", async () =>
	{
		const { mlb } = recordedClient();
		const september12 = await answerOf({
			mlb,
		}, "2026-09-12", ["playoffs"]);
		const playoffs = september12.phases.playoffs!.table!;
		expect(playoffs).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-09-12",
		});
		expect(playoffs.divisions.map((d) => [d.divisionId, d.teams.map((t) => t.abbreviation)])).toEqual([[201, ["TB"]], [205, ["MIL"]]]);
		const september5 = await answerOf({
			mlb,
		}, "2026-09-05", ["playoffs"]);
		expect(september5.phases.playoffs!.table!.divisions).toEqual([]);
	});

	it("blank regular season from spring teams: on a spring day the regular season lists spring's teams by name at 0-0", async () =>
	{
		const { mlb } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2026-03-10");
		const regular = answer.phases.regularSeason!.table!;
		expect(regular).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-03-10",
		});
		expect(regular.divisions.map((d) => d.divisionId)).toEqual(AL_EAST_FIRST);
		expect(teams(regular.divisions)).toBe(30);
		for (const division of regular.divisions)
		{
			const names = division.teams.map((t) => t.name);
			expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
			for (const team of division.teams)
			{
				expect(team).toMatchObject({
					wins: 0,
					losses: 0,
					pct: null,
					gamesBack: null,
					divisionRank: null,
					streak: null,
					runsScored: null,
					runsAllowed: null,
					runDifferential: null,
					divisionLeader: false,
					clinched: false,
					eliminationNumber: null,
				});
			}
		}
		expect(answer.phases.playoffs!.table!.divisions).toEqual([]);
		expect(answer.phase).toBe("spring");
	});

	it("blank regular season from spring teams on opening day's morning, while its table is still empty", async () =>
	{
		const { mlb } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2026-03-25");
		expect(answer.phases.regularSeason!.table).toMatchObject({
			phase: "regularSeason",
			season: 2026,
			date: "2026-03-25",
		});
		expect(teams(answer.phases.regularSeason!.table!.divisions)).toBe(30);
	});

	it("first spring morning (2027-02-19): an empty spring, 2027's blank teams, playoffs with no division, last season's final at the top; the day before is 2026's", async () =>
	{
		const { mlb, asked } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2027-02-19");
		expect(answer).toMatchObject({
			phase: "final",
			season: 2026,
			date: "2026-09-27",
		});
		expect(answer.phases.spring!.table!.divisions).toEqual([]);
		const regular = answer.phases.regularSeason!.table!;
		expect(regular).toMatchObject({
			phase: "regularSeason",
			season: 2027,
		});
		expect(teams(regular.divisions)).toBe(30);
		expect(regular.divisions.flatMap((d) => d.teams).every((t) => t.wins === 0 && t.losses === 0)).toBe(true);
		// The teams come from 2027's season table with no date, never 2026's final.
		expect(asked).toContain("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2027&hydrate=team");
		expect(answer.phases.playoffs!.table!.divisions).toEqual([]);

		const dayBefore = await answerOf({
			mlb,
		}, "2027-02-18");
		expect(dayBefore.phases.spring!.table).toMatchObject({
			season: 2026,
			date: "2026-03-24",
		});
		expect(dayBefore.phases.regularSeason!.table).toMatchObject({
			phase: "final",
			season: 2026,
		});
		expect(dayBefore.phases.playoffs).toMatchObject({
			startDate: "2026-09-28",
			endDate: "2026-10-28", // the World Series final, from its schedule
		});
		expect(dayBefore.phases.playoffs!.table!.divisions.flatMap((d) => d.teams)).toHaveLength(12);
	});

	it("request budget, with phases (counting client)", async () =>
	{
		// The counts verified against MLB on 2026-11-18: one request naming springTraining,regularSeason
		// answers only the table the day has (spring on 2026-03-10, the regular season on 2026-04-05), so
		// spring and the regular season are two requests; the playoffs cost none (MLB's clinched flags).
		// Each count is standings requests beyond the two calendars (four requests).
		const count = async (day: string, include?: Parameters<typeof getStandings>[2], override?: Parameters<typeof recordedClient>[0]) =>
		{
			const { mlb, asked } = recordedClient(override);
			await answerOf({
				mlb,
			}, day, include);
			return standingsAsked(asked).length;
		};
		expect(await count("2026-09-05")).toBe(2); // an ordinary regular-season day: the day's table, spring's last day
		expect(await count("2026-03-10")).toBe(1); // a spring day: spring's table, shared by the blank regular season
		expect(await count("2026-11-08")).toBe(2); // the off-season: the final, spring's last day
		expect(await count("2027-02-19")).toBe(3); // the first spring morning: spring, last season's final, the new season's teams
		expect(await count("2026-09-05", undefined, (url) => url.pathname.startsWith("/api/v1/seasons/") ? json({}, 500) : undefined)).toBe(1); // no calendar
		expect(await count("2026-09-05", ["playoffs"])).toBe(1); // the playoffs alone: the day's table, shared with S128's
		expect(await count("2026-09-05", ["regularSeason"])).toBe(1); // the regular season alone: the same table
		expect(await count("2026-03-10", ["spring"])).toBe(1); // spring alone on a spring day: spring's table, which is S128's too
	});

	it("calendars complete: false when MLB couldn't give either calendar, true when it answered (an unpublished season included)", async () =>
	{
		const down = (season: number) => recordedClient((url) => url.pathname === `/api/v1/seasons/${season}` ? json({}, 500) : undefined).mlb;
		expect((await getStandings({
			mlb: recordedClient().mlb,
		}, "2026-09-05")).calendarsComplete).toBe(true);
		expect((await getStandings({
			mlb: down(2026),
		}, "2026-09-05")).calendarsComplete).toBe(false);
		expect((await getStandings({
			mlb: down(2025),
		}, "2026-09-05")).calendarsComplete).toBe(false);
		const unpublished = recordedClient((url) => url.pathname === "/api/v1/seasons/2027" ? json({
			copyright: "",
			seasons: [],
		}) : undefined).mlb;
		expect((await getStandings({
			mlb: unpublished,
		}, "2027-03-01")).calendarsComplete).toBe(true);
	});

	it("nothing yet: an empty included table counts, except spring's on its first morning", async () =>
	{
		// 2027-02-19: spring's table is empty on purpose (no spring game is final yet), so the answer is not "nothing yet".
		expect(standingsNothingYet(await answerOf({
			mlb: recordedClient().mlb,
		}, "2027-02-19"), "2027-02-19")).toBe(false);
		// 2026-09-05 with only spring's table empty: S128's table is full, but an included phase's table has no team.
		const springEmpty = (url: URL) => url.searchParams.get("standingsTypes") === "springTraining" ? emptyTable() : undefined;
		expect(standingsNothingYet(await answerOf({
			mlb: recordedClient(springEmpty).mlb,
		}, "2026-09-05"), "2026-09-05")).toBe(true);
		// Left out by includePhases, the empty spring table isn't in the answer, so it doesn't count.
		expect(standingsNothingYet(await answerOf({
			mlb: recordedClient(springEmpty).mlb,
		}, "2026-09-05", ["regularSeason"]), "2026-09-05")).toBe(false);
		// A spring day other than the first: an empty spring table is "nothing yet".
		expect(standingsNothingYet(await answerOf({
			mlb: recordedClient(springEmpty).mlb,
		}, "2026-03-10"), "2026-03-10")).toBe(true);
		// The full recordings: nothing missing.
		expect(standingsNothingYet(await answerOf({
			mlb: recordedClient().mlb,
		}, "2026-09-05"), "2026-09-05")).toBe(false);
	});
});

describe("getStandings clinch letter (S160)", () =>
{
	type Row = { clinched: boolean;
		clinchIndicator?: string | null };
	/** Every row of a table: each holds the field, a letter only on a clinched team, else null. */
	function rowsOf(table: { divisions: { teams: Row[] }[] } | undefined): Row[]
	{
		const rows = (table?.divisions ?? []).flatMap((d) => d.teams);
		for (const row of rows)
		{
			expect(row).toHaveProperty("clinchIndicator");
			expect(row.clinchIndicator === null || (row.clinched && typeof row.clinchIndicator === "string" && row.clinchIndicator !== "")).toBe(true);
		}
		return rows;
	}
	const letters = (rows: Row[]) => rows.map((r) => r.clinchIndicator).filter((l) => l !== null).sort();

	it("S160 AC 3: on the 2026 final fixture asking every phase, the top table and phases.spring, regularSeason and playoffs all carry the field", async () =>
	{
		const { mlb } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2026-11-08", ["spring", "regularSeason", "playoffs"]);
		const final = ["w", "w", "w", "w", "w", "w", "y", "y", "y", "y", "z", "z"];
		expect(answer.phase).toBe("final");
		expect(letters(rowsOf(answer))).toEqual(final);
		expect(rowsOf(answer.phases.spring!.table)).toHaveLength(30);
		expect(letters(rowsOf(answer.phases.regularSeason!.table))).toEqual(final);
		const playoffs = rowsOf(answer.phases.playoffs!.table);
		expect(playoffs).toHaveLength(12);
		expect(letters(playoffs)).toEqual(final);
	});

	it("S160 AC 3: blank rows (the regular season before its first game) carry null", async () =>
	{
		const { mlb } = recordedClient();
		const answer = await answerOf({
			mlb,
		}, "2026-03-10");
		const blank = rowsOf(answer.phases.regularSeason!.table);
		expect(blank).toHaveLength(30);
		expect(blank.every((r) => r.clinchIndicator === null)).toBe(true);
	});
});

describe("getStandings empty tables, judged by the domain's standingsHasNoTeams (S175)", () =>
{
	/** The three shapes each empty-table check must tell apart: two with no team, one with a single team. */
	type Recorded = { records: { teamRecords: unknown[] }[] };
	const recorded = SEPTEMBER_5 as Recorded;
	const SHAPES = {
		noDivisions: () => emptyTable(),
		noTeams: () => json({
			...recorded,
			records: recorded.records.map((r) => ({
				...r,
				teamRecords: [],
			})),
		}),
		oneTeam: () => json({
			...recorded,
			records: recorded.records.map((r, i) => ({
				...r,
				teamRecords: i === 0 ? r.teamRecords.slice(0, 1) : [],
			})),
		}),
	};
	type Shape = keyof typeof SHAPES;
	/** Answers one day's table with `shape`: its spring table (`standingsTypes=springTraining`) or its regular-season one. */
	const tableOn = (date: string, spring: boolean, shape: Shape) => (url: URL) =>
		url.pathname === "/api/v1/standings" && url.searchParams.get("date") === date && (url.searchParams.get("standingsTypes") === "springTraining") === spring
			? SHAPES[shape]()
			: undefined;
	const rows = (table: { divisions: { teams: { wins: number;
		losses: number; }[] }[] }) => table.divisions.flatMap((d) => d.teams);

	it("S175 AC 2: opening day's own table: no divisions or divisions with no team give the 0-0 list from spring's teams; one team is MLB's table as it is", async () =>
	{
		for (const shape of ["noDivisions", "noTeams"] as const)
		{
			const regular = (await answerOf({
				mlb: recordedClient(tableOn("2026-03-25", false, shape)).mlb,
			}, "2026-03-25", ["regularSeason"])).phases.regularSeason!.table!;
			expect(regular).toMatchObject({
				phase: "regularSeason",
				season: 2026,
				date: "2026-03-25",
			});
			expect(rows(regular)).toHaveLength(30);
			expect(rows(regular).every((t) => t.wins === 0 && t.losses === 0)).toBe(true);
		}
		const one = (await answerOf({
			mlb: recordedClient(tableOn("2026-03-25", false, "oneTeam")).mlb,
		}, "2026-03-25", ["regularSeason"])).phases.regularSeason!.table!;
		expect(rows(one)).toHaveLength(1);
		expect(rows(one)[0]!.wins).toBeGreaterThan(0);
	});

	it("S175 AC 2: the first spring morning's spring table: with no team the 0-0 list comes from the new season's team list; with one team it comes from spring's", async () =>
	{
		const NEW_SEASON_TEAMS = "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2027&hydrate=team";
		for (const shape of ["noDivisions", "noTeams"] as const)
		{
			const { mlb, asked } = recordedClient(tableOn("2027-02-19", true, shape));
			const regular = (await answerOf({
				mlb,
			}, "2027-02-19", ["regularSeason"])).phases.regularSeason!.table!;
			expect(asked).toContain(NEW_SEASON_TEAMS);
			expect(regular).toMatchObject({
				phase: "regularSeason",
				season: 2027,
			});
			expect(rows(regular)).toHaveLength(30);
		}
		const { mlb, asked } = recordedClient(tableOn("2027-02-19", true, "oneTeam"));
		const regular = (await answerOf({
			mlb,
		}, "2027-02-19", ["regularSeason"])).phases.regularSeason!.table!;
		expect(asked).not.toContain(NEW_SEASON_TEAMS);
		expect(rows(regular)).toHaveLength(1);
		expect(rows(regular).every((t) => t.wins === 0 && t.losses === 0)).toBe(true);
	});

	it("S175 AC 2: S128's table: with no team it is the previous phase's table (spring's last day); with one team it is the day's own", async () =>
	{
		for (const shape of ["noDivisions", "noTeams"] as const)
		{
			const top = await answerOf({
				mlb: recordedClient(tableOn("2026-03-25", false, shape)).mlb,
			}, "2026-03-25", []);
			expect(top).toMatchObject({
				phase: "spring",
				season: 2026,
				date: "2026-03-24",
			});
			expect(rows(top)).toHaveLength(30);
		}
		const top = await answerOf({
			mlb: recordedClient(tableOn("2026-03-25", false, "oneTeam")).mlb,
		}, "2026-03-25", []);
		expect(top).toMatchObject({
			phase: "regularSeason",
			date: "2026-03-25",
		});
		expect(rows(top)).toHaveLength(1);
	});

	it("S175 AC 2: nothing yet: an included spring table with no team counts, one with a single team doesn't, and the first spring morning's empty spring still reads as not missing", async () =>
	{
		// 2026-09-05 asks spring's table as of its last day, 2026-03-24.
		const nothingYet = async (day: string, springDate: string, shape: Shape) => standingsNothingYet(await answerOf({
			mlb: recordedClient(tableOn(springDate, true, shape)).mlb,
		}, day), day);
		expect(await nothingYet("2026-09-05", "2026-03-24", "noDivisions")).toBe(true);
		expect(await nothingYet("2026-09-05", "2026-03-24", "noTeams")).toBe(true);
		expect(await nothingYet("2026-09-05", "2026-03-24", "oneTeam")).toBe(false);
		expect(await nothingYet("2027-02-19", "2027-02-19", "noDivisions")).toBe(false);
		expect(await nothingYet("2027-02-19", "2027-02-19", "noTeams")).toBe(false);
	});
});
