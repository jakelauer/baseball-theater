import { readFileSync } from "node:fs";
import {
	describe, expect, it,
} from "vitest";
import { projectGame, projectGameBoxscore } from "./projections.js";
import type { AtBat } from "./plays.js";
import type { GameSnapshot } from "./types.js";

function atBat(
	half: "top" | "bottom",
	batter: { id: number;
		fullName: string },
	pitcher: { id: number;
		fullName: string },
): AtBat
{
	return {
		about: {
			atBatIndex: 0,
			halfInning: half,
			inning: 1,
			isComplete: true,
			isScoringPlay: false,
		},
		result: {
			event: "Single",
			description: "single",
			eventType: "single",
			isOut: false,
			rbi: 0,
			awayScore: null,
			homeScore: null,
		},
		matchup: {
			batter,
			pitcher,
			batSide: "R",
			pitchHand: "L",
		},
		count: {
			balls: 0,
			strikes: 0,
			outs: 0,
		},
		pitches: [],
	};
}

const lindor = {
	id: 1,
	fullName: "Francisco Lindor",
};
const abrams = {
	id: 2,
	fullName: "CJ Abrams",
};
const gore = {
	id: 3,
	fullName: "MacKenzie Gore",
};
const senga = {
	id: 4,
	fullName: "Kodai Senga",
};

const snapshot: GameSnapshot = {
	gamePk: 744834,
	gameDate: "2024-07-04",
	officialDate: "2024-07-04",
	status: {
		abstractGameState: "Final",
		codedGameState: "F",
		detailedState: "Final",
	},
	teams: {
		away: {
			id: 121,
			abbreviation: "NYM",
			name: "New York Mets",
			teamName: "Mets",
		},
		home: {
			id: 120,
			abbreviation: "WSH",
			name: "Washington Nationals",
			teamName: "Nationals",
		},
	},
	venue: {
		id: 3309,
		name: "Nationals Park",
	},
	linescore: null,
	highlights: [],
	plays: [
		atBat("top", lindor, gore),
		atBat("top", lindor, gore),
		atBat("bottom", abrams, senga),
	],
	fetchedAt: "2024-07-05T00:00:00.000Z",
	windowMode: "cache",
	version: 3,
	lastChangedAt: "2024-07-05T00:00:00.000Z",
};

describe("projectGame", () =>
{
	it("splits one snapshot into five documents that share meta", () =>
	{
		const projection = projectGame(snapshot);

		for (const doc of Object.values(projection))
		{
			expect(doc.gamePk).toBe(744834);
			expect(doc.fetchedAt).toBe(snapshot.fetchedAt);
			expect(doc.windowMode).toBe("cache");
			expect(doc.version).toBe(3);
		}
		expect(projection.header.venue?.name).toBe("Nationals Park");
		expect(projection.plays.playCount).toBe(3);
		expect(projection.linescore.linescore).toBeNull();
		expect(projection.media.highlights).toEqual([]);
	});
});

describe("projectGameBoxscore", () =>
{
	it("credits a batter to the half-inning their side bats in", () =>
	{
		const { teams } = projectGameBoxscore(snapshot);

		expect(teams.away.batting).toEqual([
			{
				playerId: 1,
				name: "Francisco Lindor",
				plateAppearances: 2,
			},
		]);
		expect(teams.home.batting).toEqual([
			{
				playerId: 2,
				name: "CJ Abrams",
				plateAppearances: 1,
			},
		]);
	});

	it("credits the pitcher on the other side of the same at-bat", () =>
	{
		const { teams } = projectGameBoxscore(snapshot);

		expect(teams.home.pitching).toEqual([
			{
				playerId: 3,
				name: "MacKenzie Gore",
				battersFaced: 2,
			},
		]);
		expect(teams.away.pitching).toEqual([
			{
				playerId: 4,
				name: "Kodai Senga",
				battersFaced: 1,
			},
		]);
	});

	it("returns empty tables when the snapshot carries no plays", () =>
	{
		const { teams } = projectGameBoxscore({
			...snapshot,
			plays: [],
		});

		expect(teams.away.batting).toEqual([]);
		expect(teams.home.pitching).toEqual([]);
	});

	it("S207 AC 1: on the recorded game the pitching rows are MLB's lines in MLB's order: Javier Assad first, 4.2 IP 3 H 3 R 3 ER 5 BB 3 SO 0 HR, ERA 3.58", () =>
	{
		// fixtures/game-823823.json is the recorded CHC @ MIA game as the recorder maps it (its plays live in plays-823823.json).
		const recorded = {
			...JSON.parse(readFileSync(new URL("../../../fixtures/game-823823.json", import.meta.url), "utf8")),
			plays: [],
		} as GameSnapshot;
		const { teams } = projectGameBoxscore(recorded);

		expect(teams.away.pitching[0]).toEqual({
			playerId: 665871,
			name: "Javier Assad",
			battersFaced: 20,
			inningsPitched: "4.2",
			hits: 3,
			runs: 3,
			earnedRuns: 3,
			baseOnBalls: 5,
			strikeOuts: 3,
			homeRuns: 0,
			era: "3.58",
			whip: "1.14",
		});
		expect(teams.away.pitching.map((p) => p.name)).toEqual(["Javier Assad", "Caleb Thielbar", "Trent Thornton", "Ryan Rolison", "Ryan Zeferjahn"]);
		expect(teams.home.pitching).toHaveLength(5);
	});

	it("S207 AC 1: a snapshot whose box score has no pitchers (stored before S207) keeps the at-bat rows", () =>
	{
		const { teams } = projectGameBoxscore({
			...snapshot,
			boxscore: {
				teams: {
					away: {
						batting: [],
					},
					home: {
						batting: [],
						pitching: [],
					},
				},
				info: [],
			},
		});

		expect(teams.home.pitching).toEqual([
			{
				playerId: 3,
				name: "MacKenzie Gore",
				battersFaced: 2,
			},
		]);
		expect(teams.away.pitching).toHaveLength(1);
	});
});
