import {
	describe, expect, it,
} from "vitest";
import type { AtBatMetrics, PlayerOfTheGame } from "./types.js";
import type { StoredExtras } from "./player-of-the-game.js";
import {
	keepPlayerOfTheGame, keepStoredExtras, lastMeasuredAtBat, playerOfTheGameComplete, playerOfTheGameExpected, askedExtraDue,
} from "./player-of-the-game.js";

describe("playerOfTheGameExpected (S99)", () =>
{
	const final = {
		gameType: "R",
		season: "2026",
		codedGameState: "F",
	};

	it("asks for a final regular-season or postseason game from 2024 on", () =>
	{
		expect(playerOfTheGameExpected(final)).toBe(true);
		for (const gameType of ["F", "D", "L", "W"]) expect(playerOfTheGameExpected({
			...final,
			gameType,
		})).toBe(true);
		expect(playerOfTheGameExpected({
			...final,
			season: "2024",
		})).toBe(true);
	});

	it("never asks for a game still being played or not started, so a live poll adds no request", () =>
	{
		for (const codedGameState of ["I", "P", "S"]) expect(playerOfTheGameExpected({
			...final,
			codedGameState,
		})).toBe(false);
	});

	it("never asks for spring training, an exhibition, a season before 2024, or a game whose type or season is unknown", () =>
	{
		expect(playerOfTheGameExpected({
			...final,
			gameType: "S",
		})).toBe(false);
		expect(playerOfTheGameExpected({
			...final,
			gameType: "E",
		})).toBe(false);
		expect(playerOfTheGameExpected({
			...final,
			season: "2023",
		})).toBe(false);
		expect(playerOfTheGameExpected({
			...final,
			gameType: undefined,
		})).toBe(false);
		expect(playerOfTheGameExpected({
			...final,
			season: undefined,
		})).toBe(false);
	});
});

describe("keepPlayerOfTheGame and playerOfTheGameComplete (S99 review)", () =>
{
	const media = {
		playerId: 666171,
		teamId: 112,
		summary: "1.2 IP, 0 ER, K, BB",
		winProbabilityAdded: 40.7,
	};
	const fan = {
		playerId: 664285,
		teamId: 146,
		summary: "2-4, 2B, RBI",
		winProbabilityAdded: 18.2,
	};

	/** A game as `keepPlayerOfTheGame` sees one: any fields, maybe a pick. */
	type Game = { gamePk: number;
		playerOfTheGame?: PlayerOfTheGame; };
	const keep = (stored: { playerOfTheGame?: PlayerOfTheGame } | null, incoming: Game) => keepPlayerOfTheGame<Game>(stored, incoming);

	it("keeps each stored side the new answer lacks, and takes each side the new answer has", () =>
	{
		expect(keep({
			playerOfTheGame: {
				media,
			},
		}, {
			gamePk: 1,
		})).toEqual({
			gamePk: 1,
			playerOfTheGame: {
				media,
			},
		});
		expect(keep({
			playerOfTheGame: {
				media,
			},
		}, {
			gamePk: 1,
			playerOfTheGame: {
				fan,
			},
		})).toEqual({
			gamePk: 1,
			playerOfTheGame: {
				media,
				fan,
			},
		});
		const changed = {
			...media,
			winProbabilityAdded: 41,
		};
		expect(keep({
			playerOfTheGame: {
				media,
			},
		}, {
			gamePk: 1,
			playerOfTheGame: {
				media: changed,
			},
		}).playerOfTheGame).toEqual({
			media: changed,
		});
	});

	it("leaves the answer alone when nothing is stored, or nothing is picked on either side", () =>
	{
		const incoming: Game = {
			gamePk: 1,
		};
		expect(keep(null, incoming)).toBe(incoming);
		expect(keep({}, incoming)).toBe(incoming);
	});

	it("is complete only with both sides", () =>
	{
		expect(playerOfTheGameComplete(undefined)).toBe(false);
		expect(playerOfTheGameComplete({
			media,
		})).toBe(false);
		expect(playerOfTheGameComplete({
			fan,
		})).toBe(false);
		expect(playerOfTheGameComplete({
			media,
			fan,
		})).toBe(true);
	});
});

describe("keepStoredExtras and askedExtraDue (S101, S100)", () =>
{
	const WORN = {
		home: [{
			code: "146_jersey_1_2026",
			text: "Marlins Home White Jersey",
			type: "Jersey",
		}],
	};
	const MEDIA = {
		playerId: 1,
		teamId: 2,
		summary: null,
		winProbabilityAdded: null,
	};

	it("keeps the stored uniforms an incoming game lacks, takes an incoming one, and keeps the pick side by side as before", () =>
	{
		const refresh: { gamePk: number } & StoredExtras = {
			gamePk: 1,
		};
		expect(keepStoredExtras({
			uniforms: WORN,
			playerOfTheGame: {
				media: MEDIA,
			},
		}, refresh)).toEqual({
			gamePk: 1,
			uniforms: WORN,
			playerOfTheGame: {
				media: MEDIA,
			},
		});
		const newer = {
			away: WORN.home,
		};
		expect(keepStoredExtras({
			uniforms: WORN,
		}, {
			uniforms: newer,
		})).toEqual({
			uniforms: newer,
		});
		const bare: { gamePk: number } & StoredExtras = {
			gamePk: 1,
		};
		expect(keepStoredExtras(null, bare)).toBe(bare);
	});

	it("asks only while none is stored, and then for a new game, a changed status or a final game", () =>
	{
		expect(askedExtraDue("uniforms", null, "P")).toBe(true);
		expect(askedExtraDue("uniforms", undefined, "P")).toBe(true);
		expect(askedExtraDue("uniforms", {
			status: {
				codedGameState: "P",
			},
		}, "P")).toBe(false);
		expect(askedExtraDue("uniforms", {
			status: {
				codedGameState: "P",
			},
		}, "I")).toBe(true);
		expect(askedExtraDue("uniforms", {
			uniforms: WORN,
			status: {
				codedGameState: "P",
			},
		}, "I")).toBe(false);
		// A final game still lacking them is asked on each write, its status unchanged (S101 review); one with them never.
		expect(askedExtraDue("uniforms", {
			status: {
				codedGameState: "F",
			},
		}, "F")).toBe(true);
		expect(askedExtraDue("uniforms", {
			uniforms: WORN,
			status: {
				codedGameState: "F",
			},
		}, "F")).toBe(false);
	});
	const RULES = [{
		name: "strikeZoneTopFactor",
		label: "Strike Zone Top",
		description: "Top of strike zone as a percentage of player height",
		value: 53.5,
		unit: "percent" as const,
	}];

	it("S100: keeps the stored rule settings an incoming game lacks beside the uniforms, and takes an incoming one", () =>
	{
		const refresh: { gamePk: number } & StoredExtras = {
			gamePk: 1,
		};
		expect(keepStoredExtras({
			uniforms: WORN,
			ruleSettings: RULES,
		}, refresh)).toEqual({
			gamePk: 1,
			uniforms: WORN,
			ruleSettings: RULES,
		});
		const newer = [{
			...RULES[0]!,
			value: 54,
		}];
		expect(keepStoredExtras({
			ruleSettings: RULES,
		}, {
			ruleSettings: newer,
		})).toEqual({
			ruleSettings: newer,
		});
	});

	it("S100: decides each extra on its own: stored uniforms don't stop a rule-settings ask", () =>
	{
		const stored = {
			uniforms: WORN,
			status: {
				codedGameState: "F",
			},
		};
		expect(askedExtraDue("uniforms", stored, "F")).toBe(false);
		expect(askedExtraDue("ruleSettings", stored, "F")).toBe(true);
		expect(askedExtraDue("ruleSettings", {
			ruleSettings: RULES,
			status: {
				codedGameState: "P",
			},
		}, "I")).toBe(false);
		expect(askedExtraDue("ruleSettings", {
			status: {
				codedGameState: "I",
			},
		}, "I")).toBe(false);
	});
});

describe("lastMeasuredAtBat (B577 review)", () =>
{
	it("is the last entry's at-bat index, -1 for no at-bats", () =>
	{
		// Only the index is read.
		const metric = (atBatIndex: number) => ({
			atBatIndex,
		}) as AtBatMetrics;
		expect(lastMeasuredAtBat({
			atBats: [metric(0), metric(1), metric(41)],
		})).toBe(41);
		expect(lastMeasuredAtBat({
			atBats: [],
		})).toBe(-1);
	});
});
