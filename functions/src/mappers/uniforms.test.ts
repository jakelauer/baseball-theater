/**
 * The uniforms each team wore (S101): the mapper on the recorded 823823 answer and on empty and partial
 * answers, the fixture client (Node files and the Worker's bundle) serving the recording, ingest attaching
 * it off the game fetch (`withAskedExtras`, S100's generalization), and the field staying absent when the call fails, lists
 * nothing or hangs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameRuleSetting, GameUniforms } from "@bt/domain";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { parseGameUniformsResponse } from "@bt/mlb-api";
import { createBundledFixtureClient } from "../adapters/fixtures/bundled.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { recordedClient } from "../test/recorded-mlb.js";
import { withAskedExtras } from "../services/player-of-the-game.js";
import { mapGameUniforms } from "./uniforms.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const recording = () => parseGameUniformsResponse(JSON.parse(readFileSync(path.join(RAW, "uniforms-823823.json"), "utf8")));

/** What the recording maps to: each side's jersey, pants and cap, in MLB's order. */
const WORN: GameUniforms = {
	home: [
		{
			code: "146_jersey_1_2026",
			text: "Marlins Home White Jersey",
			type: "Jersey",
		},
		{
			code: "146_pants_1_2026",
			text: "Marlins Home White Pants",
			type: "Pants",
		},
		{
			code: "146_hat_1_2026",
			text: "Marlins Primary Black Hat",
			type: "Cap",
		},
	],
	away: [
		{
			code: "112_jersey_3_2026",
			text: "Cubs Alt 1 Blue Jersey",
			type: "Jersey",
		},
		{
			code: "112_pants_2_2026",
			text: "Cubs Away Grey Pants",
			type: "Pants",
		},
		{
			code: "112_hat_1_2026",
			text: "Cubs Primary Blue Hat",
			type: "Cap",
		},
	],
};

const isUniforms = (url: URL) => url.pathname === "/api/v1/uniforms/game";

afterEach(() =>
{
	vi.useRealTimers();
});

describe("mapGameUniforms (S101)", () =>
{
	it("S101 AC 4: projects each side's assets (code, text, type); the home side includes the Marlins Home White Jersey", () =>
	{
		const uniforms = mapGameUniforms(recording(), 823823);
		expect(uniforms).toEqual(WORN);
		expect(uniforms?.home?.map((asset) => asset.text)).toContain("Marlins Home White Jersey");
	});

	it("S101 AC 4: leaves out an asset missing its code, name or kind, and a side with none left", () =>
	{
		expect(mapGameUniforms({
			uniforms: [{
				gamePk: 1,
				home: {
					uniformAssets: [{
						uniformAssetCode: "x",
						uniformAssetText: "No kind",
					}, {
						uniformAssetCode: "1_jersey",
						uniformAssetText: "Home Jersey",
						uniformAssetType: {
							uniformAssetTypeText: "Jersey",
						},
					}],
				},
				away: {
					uniformAssets: [],
				},
			}],
		}, 1)).toEqual({
			home: [{
				code: "1_jersey",
				text: "Home Jersey",
				type: "Jersey",
			}],
		});
	});

	it("S101 AC 5: an answer listing nothing, or not for this game, maps to null", () =>
	{
		expect(mapGameUniforms({}, 823823)).toBeNull();
		expect(mapGameUniforms({
			uniforms: [],
		}, 823823)).toBeNull();
		expect(mapGameUniforms(recording(), 1)).toBeNull();
	});
});

describe("fetchGameUniforms (S101)", () =>
{
	it("S101 AC 3: the fixture client reads the recording, in Node and from the Worker's bundle; null for a game with none", async () =>
	{
		expect(await new FixtureMlbStatsClient().fetchGameUniforms(823823)).toEqual(WORN);
		expect(await createBundledFixtureClient().fetchGameUniforms(823823)).toEqual(WORN);
		expect(await new FixtureMlbStatsClient().fetchGameUniforms(1)).toBeNull();
	});

	it("S101 AC 3: fetchGame never carries it; ingest attaches it (withAskedExtras) for a game not stored yet", async () =>
	{
		const client = createBundledFixtureClient();
		const { game } = await client.fetchGame(823823);
		expect(game).not.toHaveProperty("uniforms");
		expect((await withAskedExtras(client, game, null)).uniforms).toEqual(WORN);
	});

	it("S101 AC 5: when the call fails, lists nothing or can't be parsed, the field is absent and the game is served as before", async () =>
	{
		for (const answer of [() => new Response("{}", {
			status: 500,
		}), () => new Response(JSON.stringify({
			uniforms: [],
		})), () => new Response("not json")])
		{
			const { mlb } = recordedClient((url) => isUniforms(url) ? answer() : undefined);
			expect(await mlb.fetchGameUniforms(823823)).toBeNull();
			const { game } = await mlb.fetchGame(823823);
			expect(await withAskedExtras(mlb, game, null)).not.toHaveProperty("uniforms");
		}
	});

	it("S101 AC 5: a call that hangs counts as none once PLAY_METRICS_LIMIT_MS passes, so ingest's write is held no longer", async () =>
	{
		const { mlb } = recordedClient();
		const { game } = await mlb.fetchGame(823823);
		vi.useFakeTimers();
		const hung = {
			fetchGameUniforms: () => new Promise<GameUniforms | null>(() => undefined),
			fetchGameRuleSettings: () => new Promise<GameRuleSetting[] | null>(() => undefined),
		};
		let answered: typeof game | undefined;
		void withAskedExtras(hung, game, null).then((value) =>
		{
			answered = value;
		});
		await vi.advanceTimersByTimeAsync(PLAY_METRICS_LIMIT_MS - 1);
		expect(answered).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(answered).toEqual(game);
	});
});
