import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import type { AtBat } from "./plays.js";
import type { AtBatMetrics, GamePlayMetrics } from "./types.js";
import { scoreboardWinProbability, winProbabilitySeries } from "./win-probability.js";

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), "utf8"));
const game823823 = {
	plays: fixture("plays-823823.json") as AtBat[],
	playMetrics: (fixture("game-823823.json") as { playMetrics: GamePlayMetrics }).playMetrics,
};

const atBat = (atBatIndex: number, inning: number) => ({
	about: {
		atBatIndex,
		inning,
	},
}) as unknown as AtBat;
const metric = (atBatIndex: number, home: number | null) => ({
	atBatIndex,
	homeWinProbability: home,
}) as AtBatMetrics;

describe("winProbabilitySeries (S106)", () =>
{
	it("S106 AC 1: on 823823 one point per measured at-bat, in order, each with its inning, ending at the final result", () =>
	{
		const series = winProbabilitySeries(game823823);
		expect(series.points).toHaveLength(game823823.playMetrics.atBats.length);
		expect(series.points).toHaveLength(85);
		const indexes = series.points.map((p) => p.atBatIndex);
		expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
		const innings = new Map(game823823.plays.map((a) => [a.about.atBatIndex, a.about.inning]));
		for (const p of series.points) expect(p.inning).toBe(innings.get(p.atBatIndex));
		expect([0, 100]).toContain(series.current);
		expect(series.current).toBe(series.points.at(-1)?.home);
	});

	it("S106 AC 1: metrics out of order come back in game order; unmeasured at-bats are skipped, not drawn at 0", () =>
	{
		const series = winProbabilitySeries({
			plays: [atBat(0, 1), atBat(1, 1), atBat(2, 2)],
			playMetrics: {
				atBats: [metric(2, 61.5), metric(0, 48), metric(1, null)],
			},
		});
		expect(series.points).toEqual([{
			atBatIndex: 0,
			inning: 1,
			home: 48,
		}, {
			atBatIndex: 2,
			inning: 2,
			home: 61.5,
		}]);
		expect(series.current).toBe(61.5);
		expect(series.currentPercent).toBe(62);
	});

	it("S106 AC 1: a game with no play metrics has no points and no current value", () =>
	{
		expect(winProbabilitySeries({
			plays: game823823.plays,
		})).toEqual({
			points: [],
			current: null,
			currentPercent: null,
		});
	});
});

describe("scoreboardWinProbability (S161)", () =>
{
	it("S161 AC 1 final game: every measured at-bat's home chance in order, unrounded, and its last value", () =>
	{
		const line = scoreboardWinProbability(game823823);
		const measured = [...game823823.playMetrics.atBats]
			.filter((m) => m.homeWinProbability != null)
			.sort((a, b) => a.atBatIndex - b.atBatIndex)
			.map((m) => m.homeWinProbability as number);
		expect(measured.length).toBeGreaterThan(10);
		expect(line).toEqual({
			points: measured,
			current: measured.at(-1),
		});
		expect(line!.points).toEqual(winProbabilitySeries(game823823).points.map((p) => p.home));
	});

	it("S161 AC 1 live first half: the same game cut to its first half carries the line so far", () =>
	{
		const half = Math.floor(game823823.plays.length / 2);
		const cutoff = game823823.plays[half - 1]!.about.atBatIndex;
		const live = {
			plays: game823823.plays.slice(0, half),
			playMetrics: {
				...game823823.playMetrics,
				atBats: game823823.playMetrics.atBats.filter((m) => m.atBatIndex <= cutoff),
			},
		};
		const line = scoreboardWinProbability(live);
		const whole = scoreboardWinProbability(game823823)!;
		expect(line).not.toBeNull();
		expect(line!.points.length).toBeLessThan(whole.points.length);
		expect(line!.points).toEqual(whole.points.slice(0, line!.points.length));
		expect(line!.current).toBe(line!.points.at(-1));
	});

	it("S161 AC 1 no play metrics: a game with none, or none measured, has no line", () =>
	{
		expect(scoreboardWinProbability({
			plays: game823823.plays,
		})).toBeNull();
		expect(scoreboardWinProbability({
			plays: [atBat(0, 1)],
			playMetrics: {
				...game823823.playMetrics,
				atBats: [metric(0, null)],
			},
		})).toBeNull();
	});
});
