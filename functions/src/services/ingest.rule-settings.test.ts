/**
 * S100 AC 5: the rule settings through the game write every one-game ingest path shares (`ingestGame` → `storeGames`),
 * on the recorded 823823 game and its recorded settings. Ingest asks them off the game fetch, beside the uniforms, only
 * when it first stores the game or sees its status change while none is stored (`askedExtraDue`), and once stored they
 * are kept (`keepStoredExtras`): a later write that didn't ask, or whose ask found nothing, neither drops them nor stamps
 * a new version for their absence.
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

const asks = (calls: readonly string[]) => calls.filter((call) => call === `fetchGameRuleSettings ${PK}`).length;
const top = (game: Pick<GameSnapshot, "ruleSettings">) => game.ruleSettings?.find((setting) => setting.name === "strikeZoneTopFactor")?.value;

describe("rule settings through storeGames (S100)", () =>
{
	it("S100 AC 5 keep: a stored game with ruleSettings and a refresh without them keeps the stored field and stamps no new version", async () =>
	{
		const { client, calls } = countingMlb();
		const deps = memoryDeps(client);
		const first = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		expect(asks(calls)).toBe(1);
		expect(top(first.snapshot)).toBe(53.5);

		// The same game again, its status unchanged: nothing is asked, the stored field stays, no new version.
		const again = await ingestGame(deps, await polled("2026-09-05T23:00:15.000Z"));
		expect(asks(calls)).toBe(1);
		expect(again.changed).toBe(false);
		expect(again.snapshot.version).toBe(first.snapshot.version);
		expect(again.snapshot.ruleSettings).toEqual(first.snapshot.ruleSettings);

		// A write that asks nothing at all (no MLB client) keeps it too.
		const { mlb: _mlb, ...noMlb } = deps;
		const bare = await ingestGame(noMlb, await polled("2026-09-05T23:00:30.000Z"));
		expect(bare.changed).toBe(false);
		expect((await deps.games.getByPk(PK))?.ruleSettings).toEqual(first.snapshot.ruleSettings);
	});

	it("S100 AC 5 keep: a status change whose ask finds nothing keeps the stored settings; the new version is for the status alone", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		let answer = true;
		const { client, calls } = countingMlb(Object.assign(Object.create(fixture) as FixtureMlbStatsClient, {
			fetchGameRuleSettings: async (gamePk: number) => answer ? fixture.fetchGameRuleSettings(gamePk) : null,
		}));
		const deps = memoryDeps(client);
		const first = await ingestGame(deps, await polled("2026-09-05T20:00:00.000Z", "I"));
		expect(first.snapshot.ruleSettings).toBeDefined();
		answer = false;
		const final = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		// The settings are stored, so the status change asks them nothing.
		expect(asks(calls)).toBe(1);
		expect(final.changed).toBe(true);
		expect(final.snapshot.ruleSettings).toEqual(first.snapshot.ruleSettings);
	});

	it("S100 AC 5 keep: with none stored, a poll whose status stays the same never asks again; a status change asks once", async () =>
	{
		const fixture = new FixtureMlbStatsClient();
		let answer = false;
		const { client, calls } = countingMlb(Object.assign(Object.create(fixture) as FixtureMlbStatsClient, {
			fetchGameRuleSettings: async (gamePk: number) => answer ? fixture.fetchGameRuleSettings(gamePk) : null,
		}));
		const deps = memoryDeps(client);
		await ingestGame(deps, await polled("2026-09-05T20:00:00.000Z", "I"));
		await ingestGame(deps, await polled("2026-09-05T20:00:15.000Z", "I"));
		await ingestGame(deps, await polled("2026-09-05T20:00:30.000Z", "I"));
		expect(asks(calls)).toBe(1);
		answer = true;
		const final = await ingestGame(deps, await polled("2026-09-05T23:00:00.000Z"));
		expect(asks(calls)).toBe(2);
		expect(top(final.snapshot)).toBe(53.5);
	});
});
