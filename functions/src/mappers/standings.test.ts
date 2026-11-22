import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseStandingsResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import {
	mapStandings, mapStandingsTeam, normalizeDash,
} from "./standings.js";

const raw = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../../../fixtures/raw/standings-2026-09-05.json", import.meta.url),
		),
		"utf8",
	),
);

describe("normalizeDash", () =>
{
	it("turns MLB's not-applicable dash into null", () =>
	{
		expect(normalizeDash("-")).toBeNull();
		expect(normalizeDash(undefined)).toBeNull();
		expect(normalizeDash("2.5")).toBe("2.5");
	});
});

describe("mapStandings", () =>
{
	const snapshot = mapStandings(
		parseStandingsResponse(raw),
		"2026-09-05",
		"2026-09-05T00:00:00Z",
	);

	it("maps every division group in the fixture", () =>
	{
		expect(snapshot.divisions.length).toBe(raw.records.length);
		expect(snapshot.date).toBe("2026-09-05");
		expect(snapshot.windowMode).toBe("cache");
	});

	it("gives every division a name, an id and a full team list", () =>
	{
		for (const division of snapshot.divisions)
		{
			expect(division.divisionId).toBeTypeOf("number");
			expect(division.name).toBeTruthy();
			expect(division.teams.length).toBeGreaterThan(0);
		}
	});

	it("carries name, wins and losses for every team", () =>
	{
		const teams = snapshot.divisions.flatMap((division) => division.teams);
		expect(teams.length).toBe(30);
		for (const team of teams)
		{
			expect(team.name).toBeTruthy();
			expect(team.wins).toBeTypeOf("number");
			expect(team.losses).toBeTypeOf("number");
			expect(team.teamId).toBeGreaterThan(0);
		}
	});

	it("orders each division by division rank", () =>
	{
		for (const division of snapshot.divisions)
		{
			const ranks = division.teams.map((team) => team.divisionRank);
			expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
		}
	});

	it("normalizes the games-back dash on the division leader", () =>
	{
		const leader = snapshot.divisions
			.flatMap((division) => division.teams)
			.find((team) => team.divisionLeader);

		expect(leader).toBeDefined();
		expect(leader?.gamesBack).toBeNull();
	});
});

describe("division order (S128)", () =>
{
	const ids = (name: string) => mapStandings(parseStandingsResponse(JSON.parse(readFileSync(
		fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)),
		"utf8",
	))), "2026-03-01").divisions.map((d) => d.divisionId);

	it("division order: the spring recording (West first) comes out AL East, Central, West, then NL East, Central, West", () =>
	{
		const asRecorded = (JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/raw/standings-2026-spring.json", import.meta.url)), "utf8")) as {
			records: { division: { id: number } }[];
		}).records.map((r) => r.division.id);
		expect(asRecorded).toEqual([200, 201, 202, 205, 203, 204]);
		expect(ids("raw/standings-2026-spring.json")).toEqual([201, 202, 200, 204, 205, 203]);
		expect(ids("raw/standings-2026-final.json")).toEqual([201, 202, 200, 204, 205, 203]);
	});

	it("division order: the regular-season fixture standings-2026-09-05.json keeps the order it has", () =>
	{
		const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/standings-2026-09-05.json", import.meta.url)), "utf8")) as {
			divisions: { divisionId: number }[];
		};
		expect(ids("raw/standings-2026-09-05.json")).toEqual(fixture.divisions.map((d) => d.divisionId));
	});
});

describe("mapStandingsTeam", () =>
{
	it("falls back to the league record when the row omits the top-level line", () =>
	{
		const mapped = mapStandingsTeam({
			team: {
				id: 1,
				name: "Test",
			},
			leagueRecord: {
				wins: 9,
				losses: 3,
				pct: ".750",
			},
		});

		expect(mapped.wins).toBe(9);
		expect(mapped.losses).toBe(3);
		expect(mapped.pct).toBe(".750");
	});
});

/** A recorded standings payload, mapped as the service maps it. */
function mapped(file: string)
{
	const payload = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/raw/${file}`, import.meta.url)), "utf8"));
	return {
		raw: payload as { records: { teamRecords: { team: { id: number };
			clinched?: boolean;
			clinchIndicator?: string }[] }[] },
		teams: mapStandings(parseStandingsResponse(payload), "2026-09-27", "2026-09-27T00:00:00Z").divisions.flatMap((d) => d.teams),
	};
}

/** How many mapped teams carry each letter, `null` for none. */
function letterCounts(teams: { clinchIndicator?: string | null }[]): Record<string, number>
{
	const counts: Record<string, number> = {};
	for (const team of teams)
	{
		const key = String(team.clinchIndicator);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

describe("clinch letter (S160)", () =>
{
	it("S160 AC 1: the 2026 final table carries MLB's z, y and w on its clinched teams as sent, null on the rest, clinched unchanged", () =>
	{
		const { raw, teams } = mapped("standings-2026-final.json");
		expect(letterCounts(teams)).toEqual({
			z: 2,
			y: 4,
			w: 6,
			null: 18,
		});
		const rows = new Map(raw.records.flatMap((r) => r.teamRecords).map((row) => [row.team.id, row]));
		for (const team of teams)
		{
			const row = rows.get(team.teamId)!;
			expect(team.clinched).toBe(row.clinched ?? false);
			expect(team.clinchIndicator).toBe(team.clinched ? row.clinchIndicator : null);
		}
	});

	it("S160 AC 1: 2026-09-12's two clinched teams carry x", () =>
	{
		const { teams } = mapped("standings-2026-09-12.json");
		expect(letterCounts(teams)).toEqual({
			x: 2,
			null: 28,
		});
		expect(teams.filter((t) => t.clinchIndicator === "x").every((t) => t.clinched)).toBe(true);
	});

	const row = (clinched: boolean, clinchIndicator?: string) => mapStandingsTeam({
		team: {
			id: 1,
			name: "Test",
		},
		clinched,
		...(clinchIndicator === undefined ? {} : {
			clinchIndicator,
		}),
	});

	it("S160 AC 1: hand-built rows: an unknown letter is printed as sent, no letter or an empty one is null, and an unclinched row's letter is null", () =>
	{
		expect(row(true, "e")).toMatchObject({
			clinched: true,
			clinchIndicator: "e",
		});
		expect(row(true)).toMatchObject({
			clinched: true,
			clinchIndicator: null,
		});
		expect(row(true, "")).toMatchObject({
			clinched: true,
			clinchIndicator: null,
		});
		// A letter of only whitespace is no letter either.
		expect(row(true, " ")).toMatchObject({
			clinched: true,
			clinchIndicator: null,
		});
		expect(row(false, "x")).toMatchObject({
			clinched: false,
			clinchIndicator: null,
		});
	});
});
