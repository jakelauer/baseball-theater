import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LiveGamePlay, LiveGamePlayEvent } from "@bt/mlb-api";
import { parseGameContentResponse, parseLiveFeedResponse } from "@bt/mlb-api";
import {
	describe, expect, it,
} from "vitest";
import { mapContentHighlights, mapRecap } from "./content.js";
import {
	mapAtBat, mapBoxscore, mapBoxscoreBatting, mapBoxscorePitching, mapLive, mapLiveFeed, mapPitchEvent,
} from "./live.js";

const rawDir = fileURLToPath(new URL("../../../fixtures/raw/", import.meta.url));

function readRaw(name: string): unknown
{
	return JSON.parse(readFileSync(rawDir + name, "utf8"));
}

const FETCHED_AT = "2026-09-06T00:00:00.000Z";

function snapshot()
{
	return mapLiveFeed(parseLiveFeedResponse(readRaw("live-823823.json")), FETCHED_AT);
}

describe("mapLiveFeed", () =>
{
	it("maps the recorded live feed onto a GameSnapshot", () =>
	{
		const game = snapshot();

		expect(game.gamePk).toBe(823823);
		expect(game.officialDate).toBe("2026-09-05");
		expect(game.teams.away.abbreviation).toBe("CHC");
		expect(game.teams.home.abbreviation).toBe("MIA");
		expect(game.venue?.name).toBe("loanDepot park");
		expect(game.status.detailedState).toBe("Final");
		expect(game.linescore?.teams.home.runs).toBeGreaterThanOrEqual(0);
		expect(game.fetchedAt).toBe(FETCHED_AT);
	});

	it("carries plays with Statcast pitch coordinates", () =>
	{
		const game = snapshot();
		expect(game.plays).toHaveLength(85);

		const pitched = game.plays.flatMap((play) => play.pitches);
		const located = pitched.filter((pitch) => pitch.pitchData !== null);
		expect(located.length).toBeGreaterThan(0);

		const first = located[0];
		expect(typeof first?.pitchData?.coordinates.pX).toBe("number");
		expect(typeof first?.pitchData?.coordinates.pZ).toBe("number");
		expect(first?.pitchData?.strikeZoneTop).toBeGreaterThan(0);
	});

	it("maps at-bat metadata the UI binds to", () =>
	{
		const [play] = snapshot().plays;
		expect(play?.about.inning).toBe(1);
		expect(play?.about.halfInning).toBe("top");
		expect(play?.matchup.batter.fullName).toBeTruthy();
		expect(play?.result.event).toBeTruthy();
	});
});

describe("mapPitchEvent — sparse input", () =>
{
	it("defaults every optional field when the upstream event carries almost nothing", () =>
	{
		const bare: LiveGamePlayEvent = {
			index: 3,
			isPitch: true,
		};
		const mapped = mapPitchEvent(bare);

		expect(mapped.pitchNumber).toBe(3);
		expect(mapped.playId).toBe("");
		expect(mapped.startTime).toBe("");
		expect(mapped.details).toEqual({
			call: null,
			callDescription: null,
			type: null,
			typeDescription: null,
			isBall: false,
			isStrike: false,
			isInPlay: false,
			ballColor: null,
		});
		expect(mapped.count).toEqual({
			balls: 0,
			strikes: 0,
			outs: 0,
		});
		expect(mapped.pitchData).toBeNull();
		expect(mapped.hitData).toBeNull();
	});

	it("returns null pitchData when coordinates are present but incomplete", () =>
	{
		const mapped = mapPitchEvent({
			index: 0,
			isPitch: true,
			pitchData: {
				coordinates: {
					pX: 0.5,
				},
			},
		});
		expect(mapped.pitchData).toBeNull();
	});

	it("fills pitchData defaults and nulls breaks when only coordinates are given", () =>
	{
		const mapped = mapPitchEvent({
			index: 0,
			isPitch: true,
			pitchData: {
				coordinates: {
					pX: 0.1,
					pZ: 2.5,
				},
			},
		});
		expect(mapped.pitchData?.startSpeed).toBe(0);
		expect(mapped.pitchData?.breaks).toBeNull();
		expect(mapped.pitchData?.coordinates.vx0).toBe(0);
	});

	it("maps breaks and hitData when both are present", () =>
	{
		const mapped = mapPitchEvent({
			index: 0,
			isPitch: true,
			pitchData: {
				coordinates: {
					pX: 0,
					pZ: 0,
				},
				breaks: {
					breakAngle: 12,
					breakLength: 6,
					spinRate: 2200,
				},
			},
			hitData: {
				launchSpeed: 95,
				launchAngle: 20,
				totalDistance: 350,
				trajectory: "fly_ball",
				coordinates: {
					coordX: 1,
					coordY: 2,
				},
			},
		});
		expect(mapped.pitchData?.breaks).toEqual({
			breakAngle: 12,
			breakLength: 6,
			spinRate: 2200,
			breakHorizontal: null,
			breakVertical: null,
		});
		expect(mapped.hitData).toEqual({
			launchSpeed: 95,
			launchAngle: 20,
			totalDistance: 350,
			trajectory: "fly_ball",
			coordinates: {
				coordX: 1,
				coordY: 2,
			},
		});
	});
});

describe("mapAtBat — sparse input", () =>
{
	it("defaults matchup, count and result when the upstream play carries almost nothing", () =>
	{
		const bare: LiveGamePlay = {
			result: {},
			about: {
				atBatIndex: 2,
				halfInning: "top",
				isTopInning: true,
				inning: 4,
			},
			playEvents: [],
		};
		const mapped = mapAtBat(bare);

		expect(mapped.about).toEqual({
			atBatIndex: 2,
			halfInning: "top",
			inning: 4,
			isComplete: false,
			isScoringPlay: false,
		});
		expect(mapped.result).toEqual({
			event: "",
			description: "",
			eventType: "",
			isOut: false,
			rbi: 0,
			awayScore: null,
			homeScore: null,
		});
		expect(mapped.matchup).toEqual({
			batter: {
				id: 0,
				fullName: "",
			},
			pitcher: {
				id: 0,
				fullName: "",
			},
			batSide: null,
			pitchHand: null,
		});
		expect(mapped.count).toEqual({
			balls: 0,
			strikes: 0,
			outs: 0,
		});
		expect(mapped.pitches).toEqual([]);
	});

	it("maps bottom-half innings and filters non-pitch events", () =>
	{
		const events: LiveGamePlayEvent[] = [
			{
				index: 0,
				isPitch: false,
			},
			{
				index: 1,
				isPitch: true,
			},
		];
		const mapped = mapAtBat({
			result: {},
			about: {
				atBatIndex: 0,
				halfInning: "bottom",
				isTopInning: false,
				inning: 1,
			},
			playEvents: events,
		});
		expect(mapped.about.halfInning).toBe("bottom");
		expect(mapped.pitches).toHaveLength(1);
	});
});

describe("mapContentHighlights", () =>
{
	it("maps highlights from the content endpoint", () =>
	{
		const content = parseGameContentResponse(readRaw("content-823823.json"));
		const highlights = mapContentHighlights(content);

		expect(highlights).toHaveLength(40);
		const first = highlights[0];
		expect(first?.title).toBeTruthy();
		expect(first?.playbackUrl).toMatch(/^https?:\/\//);
		expect(mapRecap(content)?.headline).toMatch(/Zeferjahn/);
	});
});

describe("mapBoxscore — sparse input (S2)", () =>
{
	it("has no box score until MLB sends teams", () =>
	{
		expect(mapBoxscore(undefined)).toBeUndefined();
		expect(mapBoxscore({})).toBeUndefined();
	});

	it("keeps only batters with a batting-order slot, with zeros and nulls for missing stats", () =>
	{
		expect(mapBoxscoreBatting({
			batters: [1, 2, 3],
			players: {
				ID1: {
					battingOrder: "100",
				},
				ID2: {
					person: {
						id: 2,
						fullName: "A Pitcher",
					},
				},
			},
		})).toEqual([{
			id: 1,
			fullName: "",
			position: "",
			battingOrder: "100",
			atBats: 0,
			runs: 0,
			hits: 0,
			rbi: 0,
			baseOnBalls: 0,
			strikeOuts: 0,
			avg: null,
			positions: [],
			note: null,
			isSubstitute: false,
			ops: null,
		}]);
		expect(mapBoxscoreBatting(undefined)).toEqual([]);
		expect(mapBoxscoreBatting({})).toEqual([]);
	});

	it("keeps the date line with an empty value (S207) and maps empty sides to empty tables", () =>
	{
		const empty = {
			batting: [],
			pitching: [],
			details: [],
			notes: [],
		};
		expect(mapBoxscore({
			teams: {},
			info: [{
				label: "Venue",
				value: "loanDepot park.",
			}, {
				label: "September 5, 2026",
			}, {
				value: "no label",
			}],
		})).toEqual({
			teams: {
				away: empty,
				home: empty,
			},
			info: [{
				label: "Venue",
				value: "loanDepot park.",
			}, {
				label: "September 5, 2026",
				value: "",
			}],
		});
		expect(mapBoxscore({
			teams: {},
		})?.info).toEqual([]);
	});
});

describe("mapBoxscore — pitching and details (S207)", () =>
{
	const box = () => snapshot().boxscore!;

	it("S207 AC 1: the away team's pitchers in MLB's order, Javier Assad first with MLB's line and season ERA", () =>
	{
		const { away, home } = box().teams;
		expect(away.pitching?.map((p) => p.lastInitName)).toEqual(["Assad, J", "Thielbar, C", "Thornton, T", "Rolison, R", "Zeferjahn, R"]);
		expect(away.pitching?.[0]).toEqual({
			id: 665871,
			fullName: "Javier Assad",
			lastInitName: "Assad, J",
			inningsPitched: "4.2",
			hits: 3,
			runs: 3,
			earnedRuns: 3,
			baseOnBalls: 5,
			strikeOuts: 3,
			homeRuns: 0,
			battersFaced: 20,
			era: "3.58",
			whip: "1.14",
		});
		expect(home.pitching?.map((p) => p.lastInitName)).toEqual(["Gusto, R", "Vodnik, V", "Faucher, C", "Fulton, D", "Zuber, T"]);
	});

	it("S207 AC 1: a batter carries v2's last name, every position, the substitute marker and season OPS", () =>
	{
		const shaw = box().teams.away.batting.find((b) => b.fullName === "Matt Shaw");
		expect(shaw).toMatchObject({
			lastName: "Shaw",
			positions: ["PH", "DH"],
			note: "a-",
			isSubstitute: true,
			ops: ".781",
		});
		expect(box().teams.away.batting[0]).toMatchObject({
			lastName: "Crow-Armstrong",
			positions: ["CF"],
			note: null,
			isSubstitute: false,
			ops: ".943",
		});
	});

	it("S207 AC 1: a pitcher MLB lists with no pitching line, or with no lastInitName, is handled", () =>
	{
		expect(mapBoxscorePitching({
			pitchers: [1, 2, 3],
			players: {
				ID1: {
					person: {
						id: 1,
						fullName: "No Line",
					},
					stats: {
						pitching: {},
					},
				},
				ID2: {
					person: {
						id: 2,
						fullName: "Only Name",
					},
					stats: {
						pitching: {
							outs: 0,
						},
					},
				},
			},
		})).toEqual([{
			id: 2,
			fullName: "Only Name",
			lastInitName: "Only Name",
			inningsPitched: "0.0",
			hits: 0,
			runs: 0,
			earnedRuns: 0,
			baseOnBalls: 0,
			strikeOuts: 0,
			homeRuns: 0,
			battersFaced: 0,
			era: null,
			whip: null,
		}]);
		expect(mapBoxscorePitching(undefined)).toEqual([]);
	});

	it("S207 AC 2: each team's detail groups as MLB groups them, every line, and its lettered notes", () =>
	{
		const { away, home } = box().teams;
		expect(away.details?.map((g) => g.title)).toEqual(["BATTING", "BASERUNNING", "FIELDING"]);
		expect(away.details?.[0]?.lines.map((l) => l.label)).toEqual(["2B", "HR", "TB", "RBI", "2-out RBI", "Runners left in scoring position, 2 out", "SAC", "GIDP", "Team RISP", "Team LOB"]);
		expect(away.details?.[1]?.lines).toEqual([{
			label: "CS",
			value: "Hoerner (4, 3rd base by Gusto/Mack).",
		}]);
		expect(away.details?.[2]?.lines.map((l) => l.label)).toEqual(["Outfield assists", "DP"]);
		expect(away.notes).toEqual([{
			label: "a",
			value: "Walked for Conforto in the 7th.",
		}]);
		// MLB sent the home team no BASERUNNING group.
		expect(home.details?.map((g) => g.title)).toEqual(["BATTING", "FIELDING"]);
		expect(home.notes?.map((n) => n.label)).toEqual(["a", "b", "c"]);
	});

	it("S207 AC 2: every game line MLB sends, in MLB's order, the date last with no value", () =>
	{
		expect(box().info.map((l) => l.label)).toEqual(["HBP", "Pitch timer violations", "ABS Challenge", "Pitches-strikes", "Groundouts-flyouts", "Batters faced",
			"Inherited runners-scored", "Umpires", "Weather", "Wind", "First pitch", "T", "Att", "Venue", "September 5, 2026"]);
		expect(box().info.at(-1)?.value).toBe("");
	});

	it("S207 AC 2: a group with a title but no lines, or lines with no value, is dropped", () =>
	{
		expect(mapBoxscore({
			teams: {
				away: {
					info: [{
						title: "BASERUNNING",
						fieldList: [],
					}, {
						title: "FIELDING",
						fieldList: [{
							label: "E",
						}],
					}, {
						fieldList: [{
							label: "DP",
							value: "1.",
						}],
					}],
				},
			},
		})?.teams.away.details).toEqual([]);
	});
});

describe("mapLive (S63)", () =>
{
	const live = (codedGameState: string) => ({
		gameData: {
			status: {
				codedGameState,
			},
		},
		liveData: {
			plays: {
				allPlays: [],
			},
		},
	}) as unknown as Parameters<typeof mapLive>[0];

	it("is null unless the game is in progress", () =>
	{
		expect(mapLive(live("F"))).toBeNull();
		expect(mapLive(live("S"))).toBeNull();
	});

	it("in progress with no linescore or current play yet: bases empty, no batter or pitcher", () =>
	{
		expect(mapLive(live("I"))).toEqual({
			runners: {
				first: null,
				second: null,
				third: null,
			},
			batterId: null,
			pitcherId: null,
		});
	});
});
