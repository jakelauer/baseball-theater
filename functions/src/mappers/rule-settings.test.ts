/**
 * The rules a game was played under (S100): the mapper on the recorded 823823 answer and on empty and partial answers,
 * the fixture client (Node files and the Worker's bundle) serving the recording, ingest attaching it off the game fetch
 * (`withAskedExtras`, beside the uniforms), and the field staying absent when the call fails, lists nothing or hangs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameRuleSetting, GameUniforms } from "@bt/domain";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { parseGameRuleSettingsResponse } from "@bt/mlb-api";
import { createBundledFixtureClient } from "../adapters/fixtures/bundled.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { recordedClient } from "../test/recorded-mlb.js";
import { withAskedExtras } from "../services/player-of-the-game.js";
import { mapGameRuleSettings } from "./rule-settings.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const recording = () => parseGameRuleSettingsResponse(JSON.parse(readFileSync(path.join(RAW, "rulesettings-823823.json"), "utf8")));
const byName = (settings: GameRuleSetting[] | null | undefined, name: string) => settings?.find((setting) => setting.name === name);
const isRuleSettings = (url: URL) => url.pathname.endsWith("/feed/live") && url.searchParams.get("hydrate") === "ruleSettings";

afterEach(() =>
{
	vi.useRealTimers();
});

describe("mapGameRuleSettings (S100)", () =>
{
	it("S100 AC 4: projects each setting by name with its value and unit; on 823823 the zone's top is 53.5% and its bottom 27%", () =>
	{
		const settings = mapGameRuleSettings(recording());
		expect(byName(settings, "strikeZoneTopFactor")).toEqual({
			name: "strikeZoneTopFactor",
			label: "Strike Zone Top",
			description: "Top of strike zone as a percentage of player height",
			value: 53.5,
			unit: "percent",
		});
		expect(byName(settings, "strikeZoneBottomFactor")).toMatchObject({
			value: 27,
			unit: "percent",
		});
		expect(byName(settings, "strikeZoneWidth")).toMatchObject({
			value: 17,
			unit: "number",
		});
		expect(byName(settings, "strikeZoneFlat")).toMatchObject({
			value: true,
			unit: "boolean",
		});
		expect(byName(settings, "absType")).toMatchObject({
			value: "challengeABS",
			unit: "text",
		});
		// Every recorded setting, in MLB's order.
		expect(settings?.map((setting) => setting.name)).toEqual(recording().gameData?.ruleSettings?.map((setting) => setting.settingName));
	});

	it("S100 AC 4: leaves out a setting missing its name or value, or of a value type BT doesn't know", () =>
	{
		expect(mapGameRuleSettings({
			gameData: {
				ruleSettings: [{
					settingValue: 1,
					valueType: "numeric",
				}, {
					settingName: "noValue",
					valueType: "numeric",
				}, {
					settingName: "oddType",
					valueType: "constructor",
					settingValue: 1,
				}, {
					settingName: "baseSize",
					valueType: "numeric",
					settingValue: 18,
				}],
			},
		})).toEqual([{
			name: "baseSize",
			label: "baseSize",
			description: "",
			value: 18,
			unit: "number",
		}]);
	});

	it("S100 AC 5: an answer listing nothing maps to null", () =>
	{
		expect(mapGameRuleSettings({})).toBeNull();
		expect(mapGameRuleSettings({
			gameData: {
				ruleSettings: [],
			},
		})).toBeNull();
	});
});

describe("fetchGameRuleSettings (S100)", () =>
{
	it("S100 AC 3: the fixture client reads the recording, in Node and from the Worker's bundle; null for a game with none", async () =>
	{
		const settings = mapGameRuleSettings(recording());
		expect(await new FixtureMlbStatsClient().fetchGameRuleSettings(823823)).toEqual(settings);
		expect(await createBundledFixtureClient().fetchGameRuleSettings(823823)).toEqual(settings);
		expect(await new FixtureMlbStatsClient().fetchGameRuleSettings(1)).toBeNull();
	});

	it("S100 AC 3: fetchGame never carries it; ingest attaches it (withAskedExtras) for a game not stored yet", async () =>
	{
		const client = createBundledFixtureClient();
		const { game } = await client.fetchGame(823823);
		expect(game).not.toHaveProperty("ruleSettings");
		expect(byName((await withAskedExtras(client, game, null)).ruleSettings, "strikeZoneTopFactor")?.value).toBe(53.5);
	});

	it("S100 AC 5: when the call fails, lists nothing or can't be parsed, the field is absent and the game is served as before", async () =>
	{
		for (const answer of [() => new Response("{}", {
			status: 500,
		}), () => new Response(JSON.stringify({
			gameData: {
				ruleSettings: [],
			},
		})), () => new Response("not json")])
		{
			const { mlb } = recordedClient((url) => isRuleSettings(url) ? answer() : undefined);
			expect(await mlb.fetchGameRuleSettings(823823)).toBeNull();
			const { game } = await mlb.fetchGame(823823);
			const asked = await withAskedExtras(mlb, game, null);
			expect(asked).not.toHaveProperty("ruleSettings");
			// The rest is served as before: the uniforms, asked beside it, still arrive.
			expect(asked.uniforms).toBeDefined();
		}
	});

	it("S100 AC 5: a call that hangs counts as none once PLAY_METRICS_LIMIT_MS passes, so ingest's write is held no longer", async () =>
	{
		const { mlb } = recordedClient();
		const { game } = await mlb.fetchGame(823823);
		vi.useFakeTimers();
		const worn: GameUniforms = {
			home: [{
				code: "146_jersey_1_2026",
				text: "Marlins Home White Jersey",
				type: "Jersey",
			}],
		};
		const hung = {
			fetchGameUniforms: async () => worn,
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
		expect(answered).toEqual({
			...game,
			uniforms: worn,
		});
	});
});
