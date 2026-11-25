import {
	describe, expect, it,
} from "vitest";
import type { PlayerOfTheGame } from "./types.js";
import {
	keepPlayerOfTheGame, playerOfTheGameComplete, playerOfTheGameExpected,
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
