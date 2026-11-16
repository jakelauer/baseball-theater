import {
	describe, expect, it,
} from "vitest";
import {
	DIGEST_SIZE, dayDigest, digestFreshness,
} from "./digest.js";
import type { DigestGame } from "./digest.js";
import type { AtBat } from "./plays.js";
import type {
	AtBatMetrics, GamePlayMetrics, MediaHighlight,
} from "./types.js";

function clip(id: string, title: string, playId: string | null = null): MediaHighlight
{
	return {
		id,
		playId,
		title,
		blurb: null,
		duration: "00:00:30",
		imageUrl: null,
		playbackUrl: null,
	};
}

/** An at-bat whose one pitch is `pitchId`; only what the rank reads. */
const atBat = (atBatIndex: number, pitchId: string) => ({
	about: {
		atBatIndex,
	},
	pitches: [{
		playId: pitchId,
	}],
}) as unknown as AtBat;

/** S93 metrics for an at-bat that moved the home side's chance of winning by `added` points. */
const metric = (atBatIndex: number, added: number): AtBatMetrics => ({
	atBatIndex,
	homeWinProbability: null,
	awayWinProbability: null,
	homeWinProbabilityAdded: added,
	awayWinProbabilityAdded: -added,
	keyMoment: false,
	leadChange: false,
	scoring: false,
	homeRun: false,
	hardHit: false,
	strikeout: false,
	highLeverage: false,
	absChallenge: false,
	hitData: {
		launchSpeed: null,
		launchAngle: null,
		totalDistance: null,
	},
});

function game(gamePk: number, away: string, home: string, highlights: MediaHighlight[], plays: AtBat[] = [], playMetrics?: GamePlayMetrics): DigestGame
{
	return {
		gamePk,
		officialDate: "2026-09-21",
		teams: {
			away: {
				id: 1,
				abbreviation: away,
				name: away,
				teamName: away,
			},
			home: {
				id: 2,
				abbreviation: home,
				name: home,
				teamName: home,
			},
		},
		highlights,
		plays,
		...playMetrics && {
			playMetrics,
		},
	};
}

const DAY = [
	game(1, "NYY", "BOS", [clip("a", "Batter steps in"), clip("b", "Judge go-ahead home run")]),
	game(2, "LAD", "SD", [clip("c", "Walk-off grand slam, a home run to win it"), clip("d", "Pitching change")]),
	game(3, "CHC", "MIL", []),
];

describe("dayDigest (S71)", () =>
{
	it("dayDigest: ranks every game's clips together by the impact rule, numbered from 1, each with its game", () =>
	{
		const items = dayDigest(DAY);
		expect(items.map((i) => i.highlight.id)).toEqual(["c", "b", "a", "d"]);
		expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
		expect(items[0]!.game).toEqual({
			gamePk: 2,
			officialDate: "2026-09-21",
			away: "LAD",
			home: "SD",
		});
		expect(items[1]!.game.gamePk).toBe(1);
	});

	it("watch first: only the top clip is flagged", () =>
	{
		expect(dayDigest(DAY).map((i) => i.watchFirst)).toEqual([true, false, false, false]);
	});

	it("keeps the top `limit` (DIGEST_SIZE by default); a day with no clips has none", () =>
	{
		expect(dayDigest(DAY, 2).map((i) => i.highlight.id)).toEqual(["c", "b"]);
		const many = [game(9, "A", "B", Array.from({
			length: DIGEST_SIZE + 3,
		}, (_, n) => clip(`x${n}`, `Clip ${n}`)))];
		expect(dayDigest(many)).toHaveLength(DIGEST_SIZE);
		expect(dayDigest([game(3, "CHC", "MIL", [])])).toEqual([]);
	});

	it("a clip two games list is kept once, with the first game", () =>
	{
		const shared = clip("s", "Home run derby");
		const items = dayDigest([game(1, "NYY", "BOS", [shared]), game(2, "LAD", "SD", [shared])]);
		expect(items).toHaveLength(1);
		expect(items[0]!.game.gamePk).toBe(1);
	});

	it("#61: on 2026-10-28 the play clips rank by how much their play swung the game, and the interviews follow", () =>
	{
		// The shape of that day on staging: game 849799's clips, every title free of the keywords,
		// so before #61 the order fell to the id and Aaron Ashby's interview came first.
		const plays = [atBat(10, "p-double"), atBat(20, "p-strands"), atBat(30, "p-single")];
		const metrics = {
			atBats: [metric(10, 18), metric(20, 4), metric(30, 9)],
		} as GamePlayMetrics;
		const items = dayDigest([game(849799, "TB", "MIL", [
			clip("aaron-ashby-on-world-champion", "Aaron Ashby on how it feels to be a world champion"),
			clip("brewers-discuss-champions", "Brewers discuss becoming 2026 World Series champions"),
			clip("ben-williamson-grounds-out", "Jacob Misiorowski strands two runners in the 4th", "p-strands"),
			clip("david-hamilton-singles", "David Hamilton's RBI single", "p-single"),
			clip("william-contreras-rbi-double", "William Contreras' RBI double", "p-double"),
		], plays, metrics)]);
		expect(items.map((i) => i.highlight.id)).toEqual([
			"william-contreras-rbi-double",
			"david-hamilton-singles",
			"ben-williamson-grounds-out",
			"aaron-ashby-on-world-champion",
			"brewers-discuss-champions",
		]);
	});

	it("#61: each clip is measured by its own game's plays, even when two games share at-bat numbers", () =>
	{
		// Both games have an at-bat 1; game 2's swung the game far more, so its clip leads, though its id sorts last.
		const items = dayDigest([
			game(1, "NYY", "BOS", [clip("a-small", "A single", "g1-p1")], [atBat(1, "g1-p1")], {
				atBats: [metric(1, 2)],
			} as GamePlayMetrics),
			game(2, "LAD", "SD", [clip("b-big", "A double", "g2-p1")], [atBat(1, "g2-p1")], {
				atBats: [metric(1, -30)],
			} as GamePlayMetrics),
		]);
		expect(items.map((i) => [i.highlight.id, i.game.gamePk])).toEqual([["b-big", 2], ["a-small", 1]]);
	});
});

describe("digestFreshness (#61)", () =>
{
	const day = {
		windowMode: "cache" as const,
		lastChangedAt: "2026-11-06T05:03:50.028Z",
	};

	it("is live while the day or any game is in the live window", () =>
	{
		expect(digestFreshness(day, []).windowMode).toBe("cache");
		expect(digestFreshness({
			...day,
			windowMode: "active",
		}, []).windowMode).toBe("active");
		expect(digestFreshness(day, [{
			windowMode: "cache",
			lastChangedAt: day.lastChangedAt,
		}, {
			windowMode: "active",
			lastChangedAt: day.lastChangedAt,
		}]).windowMode).toBe("active");
	});

	it("last changed when the latest of the day and its games did: a video posted after the game moves it", () =>
	{
		expect(digestFreshness(day, [{
			windowMode: "cache",
			lastChangedAt: "2026-11-14T22:51:40.523Z",
		}, {
			windowMode: "cache",
			lastChangedAt: "2026-10-29T01:00:00.000Z",
		}]).lastChangedAt).toBe("2026-11-14T22:51:40.523Z");
		expect(digestFreshness(day, [{
			windowMode: "cache",
			lastChangedAt: "2026-10-29T01:00:00.000Z",
		}]).lastChangedAt).toBe(day.lastChangedAt);
	});

	it("skips a timestamp that doesn't parse, and keeps a game's when the day's doesn't", () =>
	{
		expect(digestFreshness(day, [{
			windowMode: "cache",
			lastChangedAt: "not a date",
		}]).lastChangedAt).toBe(day.lastChangedAt);
		expect(digestFreshness({
			windowMode: "cache",
			lastChangedAt: "",
		}, [{
			windowMode: "cache",
			lastChangedAt: "2026-10-29T01:00:00.000Z",
		}]).lastChangedAt).toBe("2026-10-29T01:00:00.000Z");
	});
});
