/**
 * S101 AC 5: the uniforms through the game write every one-game ingest path shares (`ingestGame` → `storeGames`), on
 * the recorded 823823 game and its recorded uniforms. Ingest asks them off the game fetch only when it first stores the
 * game or sees its status change while none is stored (`uniformsDue`), and once stored they are kept (`keepStoredExtras`):
 * a later write that didn't ask, or whose ask found nothing, neither drops them nor stamps a new version for their absence.
 */
import type { GameSnapshot, Unversioned } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { countingMlb, memoryDeps } from "../test/past-data.js";
import { ingestGame } from "./ingest.js";

const PK = 823823;

/** The recorded game as a poll at `at` fetched it, with its status code set to `coded`. */
async function polled(at: string, coded?: string): Promise<Unversioned<GameSnapshot>>
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(PK);
	return {
		...game,
		...coded !== undefined && {
			status: {
				...game.status,
				codedGameState: coded,
			},
		},
		fetchedAt: at,
		windowMode: "active",
	};
}

const asks = (calls: readonly string[]) => calls.filter((call) => call === `fetchGameUniforms ${PK}`).length;

describe("uniforms through storeGames (S101)", () =>
{
	it("S101 AC 5 keep: a stored game with uniforms and a refresh without them keeps the stored field and stamps no new version", async () =>
	{
		const { client, calls } = countingMlb();
		const deps = memoryDeps(client);
		const first = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		expect(asks(calls)).toBe(1);
		expect(first.snapshot.uniforms?.home?.[0]?.text).toBe("Marlins Home White Jersey");

		// The same game again, its status unchanged: nothing is asked, the stored field stays, no new version.
		const again = await ingestGame(deps, await polled("2026-09-05T23:00:15.000Z"));
		expect(asks(calls)).toBe(1);
		expect(again.changed).toBe(false);
		expect(again.snapshot.version).toBe(first.snapshot.version);
		expect(again.snapshot.uniforms).toEqual(first.snapshot.uniforms);

		// A write that asks nothing at all (no MLB client) keeps it too.
		const { mlb: _mlb, ...noMlb } = deps;
		const bare = await ingestGame(noMlb, await polled("2026-09-05T23:00:30.000Z"));
		expect(bare.changed).toBe(false);
		expect((await deps.games.getByPk(PK))?.uniforms).toEqual(first.snapshot.uniforms);
	});

	it("S101 AC 5 keep: a status change whose ask finds nothing keeps the stored uniforms; the new version is for the status alone", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		let answer = true;
		const { client, calls } = countingMlb(Object.assign(Object.create(fixture) as FixtureMlbStatsClient, {
			fetchGameUniforms: async (gamePk: number) => answer ? fixture.fetchGameUniforms(gamePk) : null,
		}));
		const deps = memoryDeps(client);
		const first = await ingestGame(deps, await polled("2026-09-05T20:00:00.000Z", "I"));
		expect(first.snapshot.uniforms).toBeDefined();
		answer = false;
		const final = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		// Uniforms are stored, so the status change asks nothing.
		expect(asks(calls)).toBe(1);
		expect(final.changed).toBe(true);
		expect(final.snapshot.uniforms).toEqual(first.snapshot.uniforms);
	});

	it("S101 AC 5 keep: with none stored, a poll whose status stays the same never asks again; a status change asks once", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		let answer = false;
		const { client, calls } = countingMlb(Object.assign(Object.create(fixture) as FixtureMlbStatsClient, {
			fetchGameUniforms: async (gamePk: number) => answer ? fixture.fetchGameUniforms(gamePk) : null,
		}));
		const deps = memoryDeps(client);
		await ingestGame(deps, await polled("2026-09-05T20:00:00.000Z", "I"));
		await ingestGame(deps, await polled("2026-09-05T20:00:15.000Z", "I"));
		await ingestGame(deps, await polled("2026-09-05T20:00:30.000Z", "I"));
		expect(asks(calls)).toBe(1);
		answer = true;
		const final = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		expect(asks(calls)).toBe(2);
		expect(final.snapshot.uniforms?.home?.[0]?.text).toBe("Marlins Home White Jersey");
	});
});
