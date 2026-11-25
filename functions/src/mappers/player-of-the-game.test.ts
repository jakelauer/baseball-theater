/**
 * MLB's player of the game (S99): the mapper on the recorded 823823 answer and on the feed's
 * empty and malformed picks, and the fixture client (Node files and the Worker's bundle) serving the
 * recording on `fetchPlayerOfTheGame` and `fetchGame`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { parsePlayerOfTheGameResponse } from "@bt/mlb-api";
import { createBundledFixtureClient } from "../adapters/fixtures/bundled.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { withAskedPlayerOfTheGame } from "../services/player-of-the-game.js";
import { mapPlayerOfTheGame } from "./player-of-the-game.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const recording = () => parsePlayerOfTheGameResponse(JSON.parse(readFileSync(path.join(RAW, "potg-823823.json"), "utf8")));

const ZEFERJAHN = {
	playerId: 666171,
	teamId: 112,
	summary: "1.2 IP, 0 ER, K, BB",
	winProbabilityAdded: 40.7,
};

/** A pick as the feed sends one nobody has made: every field null. */
const NOBODY = {
	playerId: null,
	feedId: null,
	boxscoreName: null,
	WPA: null,
	teamID: null,
	summary: null,
	summaryES: null,
};

describe("mapPlayerOfTheGame (S99)", () =>
{
	it("S99 AC 4: on 823823 the media pick is Ryan Zeferjahn (666171) of team 112, '1.2 IP, 0 ER, K, BB', 40.7, and the fan pick is absent", () =>
	{
		const mapped = mapPlayerOfTheGame(recording());

		expect(mapped).toEqual({
			media: ZEFERJAHN,
		});
		expect(mapped).not.toHaveProperty("fan");
	});

	it("S99 AC 4: both picks when MLB names both, each with its own player, team, line and win probability added", () =>
	{
		expect(mapPlayerOfTheGame({
			...recording(),
			fanWinner: {
				playerId: 9,
				feedId: "660271",
				boxscoreName: "Ohtani",
				WPA: 12.5,
				teamID: "119",
				summary: "2-4, HR, 3 RBI",
				summaryES: "2-4, HR, 3 CI",
			},
		})).toEqual({
			media: ZEFERJAHN,
			fan: {
				playerId: 660271,
				teamId: 119,
				summary: "2-4, HR, 3 RBI",
				winProbabilityAdded: 12.5,
			},
		});
	});

	it("S99 AC 5: an answer that names nobody (both picks empty, or none at all) maps to null, so the game has no field", () =>
	{
		expect(mapPlayerOfTheGame({
			gamePK: "823823",
			fanWinner: NOBODY,
			mediaWinner: NOBODY,
		})).toBeNull();
		expect(mapPlayerOfTheGame({})).toBeNull();
	});

	it("S99 AC 5: a pick whose player id isn't an MLB id is absent, and a missing team, line or WPA is null", () =>
	{
		expect(mapPlayerOfTheGame({
			mediaWinner: {
				...NOBODY,
				feedId: "abc",
			},
			fanWinner: {
				...NOBODY,
				feedId: "666171",
			},
		})).toEqual({
			fan: {
				playerId: 666171,
				teamId: null,
				summary: null,
				winProbabilityAdded: null,
			},
		});
	});
});

describe("the fixture client's player of the game (S99)", () =>
{
	it("S99 AC 3: fetchPlayerOfTheGame reads the recording, in Node and from the Worker's bundle", async () =>
	{
		expect(await new FixtureMlbStatsClient().fetchPlayerOfTheGame(823823)).toEqual({
			media: ZEFERJAHN,
		});
		expect(await createBundledFixtureClient().fetchPlayerOfTheGame(823823)).toEqual({
			media: ZEFERJAHN,
		});
	});

	it("S99 AC 4: the game ingest stores carries it as GameSnapshot.playerOfTheGame (fetchGame says it is due; ingest asks)", async () =>
	{
		const client = createBundledFixtureClient();
		const fetched = await client.fetchGame(823823);
		expect(fetched.playerOfTheGameDue).toBe(true);
		const { game } = await withAskedPlayerOfTheGame(client, fetched, undefined);
		expect(game.playerOfTheGame).toEqual({
			media: ZEFERJAHN,
		});
	});

	it("S99 AC 5: a game with no recording has no field and is served as before", async () =>
	{
		const client = new FixtureMlbStatsClient();
		expect(await client.fetchPlayerOfTheGame(744834)).toBeNull();
		const fetched = await client.fetchGame(744834);
		expect(fetched.playerOfTheGameDue).toBeUndefined();
		const { game } = await withAskedPlayerOfTheGame(client, fetched, undefined);
		expect(game).not.toHaveProperty("playerOfTheGame");
		expect(game.gamePk).toBe(744834);
	});
});
