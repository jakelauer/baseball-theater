import {
	describe, expect, it,
} from "vitest";
import { playerOfTheGameExpected } from "./player-of-the-game.js";

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
