/**
 * The fixture client's season calendars (S111): the recorded calendar and World Series
 * for a season, mapped as the HTTP client maps them, offline; null for one never recorded.
 * And its final and spring standings (S128), from the season's recorded tables. And a game's
 * videos and recap on their own (S122), null when the game has neither or no recording.
 */
import {
	describe, expect, it,
} from "vitest";
import { createBundledFixtureClient } from "./bundled.js";
import { FixtureClient } from "./fixture-client.js";
import { FixtureMlbStatsClient } from "./mlb.js";

describe("FixtureClient season calendar (S111)", () =>
{
	it("season calendar: serves the recorded seasons from files and from the Worker bundle", async () =>
	{
		for (const mlb of [new FixtureMlbStatsClient(), createBundledFixtureClient()])
		{
			expect(await mlb.fetchSeasonCalendar(2026)).toEqual({
				season: 2026,
				springStartDate: "2026-02-20",
				lastGameDate: "2026-10-28",
				regularSeasonStartDate: "2026-03-25",
				regularSeasonEndDate: "2026-09-27",
				champion: {
					teamId: 158,
					name: "Milwaukee Brewers",
					wonOn: "2026-10-28",
				},
			});
			expect((await mlb.fetchSeasonCalendar(2027))?.springStartDate).toBe("2027-02-19");
			expect((await mlb.fetchSeasonCalendar(2025))?.lastGameDate).toBe("2025-11-01");
			// S140: the bundle serves the 2025 Series too, so the Worker's fixture names its winner.
			expect((await mlb.fetchSeasonCalendar(2025))?.champion?.name).toBe("Los Angeles Dodgers");
		}
	});

	it("season calendar: a season with no recording is null", async () =>
	{
		expect(await new FixtureMlbStatsClient().fetchSeasonCalendar(2031)).toBeNull();
	});
});

describe("FixtureClient final and spring standings (S128)", () =>
{
	it("standings: serves 2026's recorded final and spring tables from files and from the Worker bundle", async () =>
	{
		for (const mlb of [new FixtureMlbStatsClient(), createBundledFixtureClient()])
		{
			const final = await mlb.fetchFinalStandings(2026);
			const spring = await mlb.fetchSpringStandings(2026, "2026-03-01");
			for (const table of [final, spring])
			{
				expect(table.divisions.map((d) => d.divisionId)).toEqual([201, 202, 200, 204, 205, 203]);
				expect(table.divisions.reduce((n, d) => n + d.teams.length, 0)).toBe(30);
			}
			expect(spring.date).toBe("2026-03-01");
		}
	});

	it("standings: a season with no recording is an empty table, as MLB answers before it starts", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		expect((await mlb.fetchFinalStandings(2031)).divisions).toEqual([]);
		expect((await mlb.fetchSpringStandings(2027, "2027-02-19")).divisions).toEqual([]);
	});
});

describe("FixtureClient dated standings (S160)", () =>
{
	/** A fixture source holding only `files`; any other name rejects, like a missing file. */
	const only = (files: Record<string, unknown>) => new FixtureClient({
		read: async (name) =>
		{
			if (!(name in files)) throw new Error(`no fixture ${name}`);
			return files[name];
		},
		list: async () => Object.keys(files),
	});

	it("S160 AC 3: a dated table is MLB's recording mapped, from files and from the Worker bundle: 2026-09-12's x on TB and MIL, 2026-09-05's divisions named", async () =>
	{
		for (const mlb of [new FixtureMlbStatsClient(), createBundledFixtureClient()])
		{
			const rows = (await mlb.fetchStandings("2026-09-12")).divisions.flatMap((d) => d.teams);
			expect(rows).toHaveLength(30);
			expect(Object.fromEntries(rows.filter((r) => r.clinchIndicator !== null).map((r) => [r.abbreviation, r.clinchIndicator]))).toEqual({
				TB: "x",
				MIL: "x",
			});
			const september5 = await mlb.fetchStandings("2026-09-05");
			expect(september5.date).toBe("2026-09-05");
			expect(september5.divisions[0]!.name).toBe("American League East");
		}
	});

	it("S160: with no recording a dated table is the mapped file the normalized recorder writes; with neither it is empty", async () =>
	{
		const mapped = {
			date: "2026-09-12",
			divisions: [{
				divisionId: 201,
				name: null,
				leagueId: 103,
				teams: [],
			}],
		};
		expect((await only({
			"standings-2026-09-12.json": mapped,
		}).fetchStandings("2026-09-12")).divisions).toEqual(mapped.divisions);
		expect((await only({}).fetchStandings("2026-09-12")).divisions).toEqual([]);
	});

	it("S160: a recording of the wrong shape throws rather than falling back to the mapped file", async () =>
	{
		await expect(only({
			"raw/standings-2026-09-12.json": {
				records: "not a list",
			},
			"standings-2026-09-12.json": {
				date: "2026-09-12",
				divisions: [],
			},
		}).fetchStandings("2026-09-12")).rejects.toThrow();
	});
});

describe("FixtureClient fetchGameEditorial (S122)", () =>
{
	it("a game with no videos and no recap is null, a missing game is null, a recorded one is its videos and recap", async () =>
	{
		const empty = new FixtureClient({
			read: async (name) =>
			{
				if (name !== "game-1.json") throw new Error(`no fixture ${name}`);
				return {
					gamePk: 1,
					highlights: [],
				};
			},
			list: async () => ["game-1.json"],
		});
		expect(await empty.fetchGameEditorial(1)).toBeNull();
		expect(await empty.fetchGameEditorial(2)).toBeNull();

		const recorded = await new FixtureMlbStatsClient().fetchGameEditorial(823823);
		expect(recorded?.highlights).toHaveLength(40);
		expect(recorded?.recap).toBeTruthy();
	});
});

describe("FixtureClient schedule range (S124)", () =>
{
	it("answers each day of the range as fetchSchedule does: its fixture, or no games", async () =>
	{
		const client = new FixtureMlbStatsClient();
		const days = await client.fetchScheduleRange("2024-07-03", "2024-07-05");
		expect(days.map((day) => day.date)).toEqual(["2024-07-03", "2024-07-04", "2024-07-05"]);
		expect(days[1]!.games).toEqual((await client.fetchSchedule("2024-07-04")).games);
		expect(days[0]!.games).toEqual([]);
		expect(days[2]!.games).toEqual([]);
	});
});
