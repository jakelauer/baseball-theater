/** S18: the in-memory LiveGameHub — newer versions only, full state on connect when behind. */
import type { GameSnapshot } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { InMemoryLiveGameHub } from "./live-hub.js";
import { InMemoryGameRepository, InMemoryGameStateRepository } from "./repos.js";

const snap = (version: number) => ({
	gamePk: 999,
	version,
}) as unknown as GameSnapshot;

function viewer()
{
	const got: number[] = [];
	return {
		got,
		send: (message: string) => void got.push((JSON.parse(message) as GameSnapshot).version),
	};
}

describe("InMemoryLiveGameHub", () =>
{
	it("a connected viewer gets each newer version once; a repeat or older one is dropped; disconnecting stops delivery", async () =>
	{
		const hub = new InMemoryLiveGameHub({
			games: new InMemoryGameRepository(),
			gameStates: new InMemoryGameStateRepository(),
		});
		const v = viewer();
		const disconnect = await hub.connect(999, v);
		await hub.publish(999, snap(1));
		await hub.publish(999, snap(1));
		await hub.publish(999, snap(2));
		await hub.publish(999, snap(1));
		expect(v.got).toEqual([1, 2]);
		disconnect();
		await hub.publish(999, snap(3));
		expect(v.got).toEqual([1, 2]);
	});

	it("a viewer behind gets the full current state on connect; one already current gets nothing", async () =>
	{
		const hub = new InMemoryLiveGameHub({
			games: new InMemoryGameRepository(),
			gameStates: new InMemoryGameStateRepository(),
		});
		await hub.publish(999, snap(2));
		const behind = viewer();
		const fresh = viewer();
		const none = viewer();
		await hub.connect(999, behind, 1);
		await hub.connect(999, fresh, 2);
		await hub.connect(999, none);
		expect(behind.got).toEqual([2]);
		expect(fresh.got).toEqual([]);
		expect(none.got).toEqual([2]);
	});

	it("S150 AC 6 first send: a viewer's first send is the served game, its score from the game's one stored state", async () =>
	{
		const games = new InMemoryGameRepository();
		const gameStates = new InMemoryGameStateRepository();
		await games.upsert({
			gamePk: 999,
			version: 4,
			lastChangedAt: "2026-09-05T23:00:00.000Z",
			status: {
				abstractGameState: "Live",
				codedGameState: "I",
				detailedState: "In Progress",
			},
			linescore: null,
		} as unknown as GameSnapshot);
		await gameStates.write([{
			gamePk: 999,
			source: "feed",
			feedTime: null,
			officialDate: "2026-09-05",
			startTime: null,
			state: {
				status: {
					abstractGameState: "Final",
					codedGameState: "F",
					detailedState: "Final",
				},
				linescore: null,
				live: null,
				version: 2,
				lastChangedAt: "2026-09-06T02:00:00.000Z",
			},
		}]);
		const hub = new InMemoryLiveGameHub({
			games,
			gameStates,
		});
		const got: GameSnapshot[] = [];
		await hub.connect(999, {
			send: (message: string) => void got.push(JSON.parse(message) as GameSnapshot),
		});
		expect(got.map((game) => [game.version, game.status.codedGameState])).toEqual([[4, "F"]]);
	});
});
