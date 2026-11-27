import {
	describe, expect, it,
} from "vitest";
import { entitlementsForTier, PATRON_TIERS } from "./entitlements.js";
import type { PlayerIds, StatsProvider } from "./player-links.js";
import {
	effectiveStatsProvider, gamePersonIds, playerProfileUrl, STATS_PROVIDERS,
} from "./player-links.js";
import type { GameSnapshot } from "./types.js";

/**
 * Javier Assad (MLBAM 665871), who pitched in the 823823 fixture game: his ids as the Chadwick
 * register records them (`fixtures/chadwick-register-823823.csv`).
 */
const ASSAD: PlayerIds = {
	mlbam: 665871,
	fangraphs: "21741",
	bbref: "assadja01",
};

describe("playerProfileUrl (S209 AC 2)", () =>
{
	// Each expected URL was opened on the live site once (2026-11-27): MLB.com and Savant redirect to the
	// player's slugged page, Baseball-Reference answers his page; FanGraphs answers automated clients with
	// a bot check, so its expected value is its long-standing player-id address.
	it.each<[StatsProvider, string]>([
		["mlb", "https://www.mlb.com/player/665871"],
		["savant", "https://baseballsavant.mlb.com/savant-player/665871"],
		["fangraphs", "https://www.fangraphs.com/statss.aspx?playerid=21741"],
		["bbref", "https://www.baseball-reference.com/players/a/assadja01.shtml"],
	])("S209 AC 2: %s is built from ids alone", (provider, url) =>
	{
		expect(playerProfileUrl(provider, ASSAD)).toBe(url);
	});

	it("S209 AC 2: a player with no FanGraphs or Baseball-Reference id links to neither", () =>
	{
		const unknown = {
			...ASSAD,
			fangraphs: null,
			bbref: null,
		};
		expect(playerProfileUrl("fangraphs", unknown)).toBeNull();
		expect(playerProfileUrl("bbref", unknown)).toBeNull();
		expect(playerProfileUrl("mlb", unknown)).toBe("https://www.mlb.com/player/665871");
		expect(playerProfileUrl("savant", unknown)).toBe("https://baseballsavant.mlb.com/savant-player/665871");
	});

	it("S209 AC 2: no URL carries a name, so a renamed player's link still works", () =>
	{
		for (const provider of STATS_PROVIDERS) expect(playerProfileUrl(provider, ASSAD)).not.toMatch(/javier|assad-/i);
	});
});

describe("effectiveStatsProvider (S209 AC 9)", () =>
{
	it.each(STATS_PROVIDERS)("S209 AC 9: a patron's saved %s is used", (provider) =>
	{
		expect(effectiveStatsProvider({
			statsProvider: provider,
		}, entitlementsForTier("Backer"))).toBe(provider);
	});

	it("S209 AC 9: without the entitlement (a lapsed pledge, signed out) it is MLB.com", () =>
	{
		expect(effectiveStatsProvider({
			statsProvider: "fangraphs",
		}, entitlementsForTier("none"))).toBe("mlb");
		expect(effectiveStatsProvider({
			statsProvider: "savant",
		}, null)).toBe("mlb");
		expect(effectiveStatsProvider({
			statsProvider: "bbref",
		}, {
			statsProviderChoice: false,
		})).toBe("mlb");
	});

	it("S209 AC 9: every patron tier may choose, none may not", () =>
	{
		for (const tier of PATRON_TIERS) expect(entitlementsForTier(tier).statsProviderChoice).toBe(tier !== "none");
	});
});

describe("gamePersonIds (S209 AC 3)", () =>
{
	it("S209 AC 3: every batter and pitcher of the plays and the box score, once, sorted", () =>
	{
		const play = (batter: number, pitcher: number) => ({
			matchup: {
				batter: {
					id: batter,
				},
				pitcher: {
					id: pitcher,
				},
			},
		});
		const game = {
			plays: [play(30, 10), play(31, 10)],
			boxscore: {
				teams: {
					away: {
						batting: [{
							id: 30,
						}, {
							id: 32,
						}],
						pitching: [{
							id: 11,
						}],
					},
					home: {
						batting: [{
							id: 40,
						}],
					},
				},
				info: [],
			},
		} as unknown as Pick<GameSnapshot, "plays" | "boxscore">;
		expect(gamePersonIds(game)).toEqual([10, 11, 30, 31, 32, 40]);
		expect(gamePersonIds({
			plays: [],
		})).toEqual([]);
	});
});
