import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	classifyHighlight, clipClock, clipDuration, countHighlightFacets, filterHighlights, groupHighlights, groupHighlightsByTeam, highlightGroup, highlightTitle,
	isGameRecapHighlight, sortHighlights,
} from "./highlights.js";
import { rankHighlightsByImpact } from "./impact.js";
import type { MediaHighlight } from "./types.js";

/** 823823's 40 videos as BT serves them: mapped from the recording, impact-ranked. */
const VIDEOS = rankHighlightsByImpact((JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/game-823823.json", import.meta.url)), "utf8")) as {
	highlights: MediaHighlight[];
}).highlights);

const titles = (list: MediaHighlight[]) => list.map((h) => h.title);

describe("classifyHighlight (S69)", () =>
{
	it("reads the featured teams and whether a clip is stat / viz from MLB's keywords", () =>
	{
		expect(classifyHighlight({
			teamIds: [146],
			tags: ["darkroom-bat-track", "home-run"],
		})).toEqual({
			teamIds: [146],
			statViz: true,
		});
		expect(classifyHighlight({
			teamIds: [112],
			tags: ["data-visualization"],
		}).statViz).toBe(true);
		expect(classifyHighlight({
			teamIds: [112, 146],
			tags: ["highlight", "home-run"],
		}).statViz).toBe(false);
	});

	it("an older recording without keywords belongs to no facet", () =>
	{
		expect(classifyHighlight({})).toEqual({
			teamIds: [],
			statViz: false,
		});
	});
});

describe("filterHighlights (S69)", () =>
{
	it("search: matches the title or the blurb, case-insensitively; blank keeps all", () =>
	{
		expect(titles(filterHighlights(VIDEOS, {
			query: "  ABS CHALLENGE ",
		}))).toHaveLength(5);
		expect(filterHighlights(VIDEOS, {
			query: "   ",
		})).toHaveLength(40);
		const blurbOnly = [{
			...VIDEOS[0]!,
			title: "Untitled",
			blurb: "A diving catch in the gap",
		}];
		expect(filterHighlights(blurbOnly, {
			query: "diving",
		})).toHaveLength(1);
	});

	it("featured team keeps clips that feature the team; stat / viz keeps viz clips; both combine", () =>
	{
		const cubs = filterHighlights(VIDEOS, {
			teamId: 112,
		});
		expect(cubs.every((h) => h.teamIds?.includes(112))).toBe(true);
		expect(cubs.length).toBeGreaterThan(0);
		const viz = filterHighlights(VIDEOS, {
			statViz: true,
		});
		expect(titles(viz)).toContain("Breaking down Kyle Stowers' home run");
		expect(titles(viz)).not.toContain("Michael Conforto hits Cubs' 200th home run (14)");
		expect(titles(filterHighlights(VIDEOS, {
			teamId: 112,
			statViz: true,
			query: "conforto",
		}))).toEqual(["Measuring the stats on Michael Conforto's home run"]);
	});

	it("impact: filtering never reorders — results keep the impact ranking", () =>
	{
		const filtered = filterHighlights(VIDEOS, {
			teamId: 146,
		});
		const positions = filtered.map((h) => VIDEOS.indexOf(h));
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(filtered[0]).toBe(VIDEOS.find((h) => h.teamIds?.includes(146)));
	});
});

describe("sortHighlights (S69)", () =>
{
	const clip = (id: string, date?: string) => ({
		id,
		title: id,
		date,
	}) as never;
	const clips = [clip("a", "2026-09-05T22:00:00Z"), clip("b"), clip("c", "2026-09-05T23:00:00Z"), clip("d", "2026-09-05T22:00:00Z")];
	const ids = (list: { id: string }[]) => list.map((h) => h.id);

	it("impact keeps the given (impact-ranked) order", () =>
	{
		expect(ids(sortHighlights(clips, "impact"))).toEqual(["a", "b", "c", "d"]);
	});

	it("newest / oldest order by date; ties keep impact order; undated clips go last", () =>
	{
		expect(ids(sortHighlights(clips, "newest"))).toEqual(["c", "a", "d", "b"]);
		expect(ids(sortHighlights(clips, "oldest"))).toEqual(["a", "d", "c", "b"]);
	});
});

describe("clipDuration (S69)", () =>
{
	it("MLB's HH:MM:SS as the badge prints it", () =>
	{
		expect(clipDuration("00:00:29")).toBe("0:29");
		expect(clipDuration("00:03:06")).toBe("3:06");
		expect(clipDuration("00:12:12")).toBe("12:12");
		expect(clipDuration("01:02:05")).toBe("1:02:05");
	});

	it("null for anything that is not a duration", () =>
	{
		expect(clipDuration(null)).toBeNull();
		expect(clipDuration(undefined)).toBeNull();
		expect(clipDuration("0:29")).toBeNull();
	});
});

describe("groupHighlights (S69)", () =>
{
	it("puts each clip in Pre-game, Game highlights, Statcast or Post-game from MLB's keywords", () =>
	{
		const group = (title: string) => highlightGroup(VIDEOS.find((h) => h.title.startsWith(title))!);
		expect(group("Starting lineups")).toBe("pregame");
		expect(group("Bullpen availability for Chicago")).toBe("pregame");
		expect(group("Bench availability for Miami")).toBe("pregame");
		expect(group("Fielding alignment for Miami")).toBe("pregame");
		expect(group("Griffin Conine's two-run home run")).toBe("highlights");
		expect(group("Ball 1 overturned")).toBe("statcast");
		expect(group("Kyle Stowers' home run through bat tracking")).toBe("statcast");
		expect(group("Breaking down Javier Assad's pitches")).toBe("statcast");
		expect(group("Kyle Stowers' 442-foot home run")).toBe("statcast");
		expect(group("Condensed Game")).toBe("postgame");
		expect(group("Conforto clubs")).toBe("postgame");
		expect(group("Clayton McCullough discusses")).toBe("postgame");
		expect(highlightGroup({
			tags: ["manager-pregame"],
		})).toBe("pregame");
		expect(highlightGroup({})).toBe("highlights");
	});

	it("groups in order, each keeping the order given, and leaves out a group with no clips", () =>
	{
		const groups = groupHighlights(VIDEOS);
		expect(groups.map((g) => g.group)).toEqual(["pregame", "highlights", "statcast", "postgame"]);
		expect(groups.flatMap((g) => g.highlights)).toHaveLength(VIDEOS.length);
		for (const { highlights } of groups)
		{
			expect(titles(highlights)).toEqual(titles(VIDEOS).filter((title) => highlights.some((h) => h.title === title)));
		}
		const onlyHighlights = filterHighlights(VIDEOS, {
			query: "ABS challenge",
		});
		expect(groupHighlights(onlyHighlights).map((g) => g.group)).toEqual(["statcast"]);
		expect(groupHighlights([])).toEqual([]);
	});
});

describe("countHighlightFacets (#418, #428)", () =>
{
	it("counts every clip, each team's clips and the stat / viz clips, each equal to what that filter alone keeps", () =>
	{
		const counts = countHighlightFacets(VIDEOS);
		expect(counts.all).toBe(40);
		for (const teamId of [112, 146]) expect(counts.byTeam[teamId]).toBe(filterHighlights(VIDEOS, {
			teamId,
		}).length);
		expect(counts.statViz).toBe(filterHighlights(VIDEOS, {
			statViz: true,
		}).length);
		expect(countHighlightFacets([{
			id: "x",
			title: "No keywords",
		} as MediaHighlight])).toEqual({
			all: 1,
			byTeam: {},
			statViz: 0,
			byGroup: {
				highlights: 1,
			},
		});
	});

	it("counts each kind's clips, each equal to what that kind filter alone keeps (S200)", () =>
	{
		const counts = countHighlightFacets(VIDEOS);
		for (const { group, highlights } of groupHighlights(VIDEOS))
		{
			expect(counts.byGroup[group], group).toBe(highlights.length);
			expect(filterHighlights(VIDEOS, {
				group,
			})).toEqual(highlights);
		}
		expect(filterHighlights(VIDEOS, {
			group: null,
		})).toHaveLength(40);
	});
});

describe("groupHighlightsByTeam (S200)", () =>
{
	const GAME = {
		teams: {
			away: {
				id: 112,
			},
			home: {
				id: 146,
			},
		},
	};
	const clip = (id: string, teamIds?: number[]) => ({
		id,
		title: id,
		teamIds,
	}) as MediaHighlight;
	const shape = (groups: ReturnType<typeof groupHighlightsByTeam>) => groups.map((g) => [g.teamId, g.highlights.map((h) => h.id)]);

	it("S200 AC 1 each team: a group per team, away first then home, each in the order given", () =>
	{
		expect(shape(groupHighlightsByTeam([clip("m1", [146]), clip("c1", [112]), clip("m2", [146])], GAME))).toEqual([
			[112, ["c1"]], [146, ["m1", "m2"]],
		]);
	});

	it("S200 AC 1 both: a clip featuring both teams sits in both groups", () =>
	{
		expect(shape(groupHighlightsByTeam([clip("both", [146, 112]), clip("c1", [112])], GAME))).toEqual([
			[112, ["both", "c1"]], [146, ["both"]],
		]);
	});

	it("S200 AC 1 neither: a clip featuring neither team (or none tagged) sits in a last Other group; an empty group is left out", () =>
	{
		expect(shape(groupHighlightsByTeam([clip("other", [999]), clip("untagged"), clip("m1", [146])], GAME))).toEqual([
			[146, ["m1"]], [null, ["other", "untagged"]],
		]);
		// 823823: every clip lands in at least one group, and only the both-team clips twice.
		const groups = groupHighlightsByTeam(VIDEOS, GAME);
		expect(groups.map((g) => g.teamId)).toEqual([112, 146, null]);
		const placed = groups.reduce((n, g) => n + g.highlights.length, 0);
		expect(placed).toBe(40 + VIDEOS.filter((h) => h.teamIds?.includes(112) && h.teamIds.includes(146)).length);
	});

	it("S200 AC 1 no clips: a game with no clips has no groups", () =>
	{
		expect(groupHighlightsByTeam([], GAME)).toEqual([]);
	});
});

describe("ABS challenge clips are Statcast (#432)", () =>
{
	it("an ABS challenge clip, BT-matched or linked by MLB, groups under Statcast; other clips stay where they were", () =>
	{
		const absClips = VIDEOS.filter((h) => /ABS challenge/.test(h.title));
		// 823823 has both kinds: two BT matched to their challenge (S95) and three MLB linked, tagged `abs`.
		expect(absClips.filter((h) => h.playLink === "challenge")).toHaveLength(2);
		expect(absClips.filter((h) => h.playLink === "mlb")).toHaveLength(3);
		for (const clip of absClips) expect(highlightGroup(clip), clip.title).toBe("statcast");
		expect(highlightGroup(VIDEOS.find((h) => h.title.startsWith("Griffin Conine's two-run home run"))!)).toBe("highlights");
		// A manager's challenge replay is not an ABS challenge: it stays a game highlight.
		expect(highlightGroup({
			tags: ["highlight", "challenge", "replay-review"],
		})).toBe("highlights");
		// An ABS clip is not a stat / viz clip: only its group changes (B418's filter is `classifyHighlight`'s).
		for (const clip of absClips) expect(classifyHighlight(clip).statViz).toBe(false);
	});
});

describe("clipClock (S70)", () =>
{
	it("prints whole seconds as m:ss, h:mm:ss past an hour, and 0:00 for nothing", () =>
	{
		expect(clipClock(12.7)).toBe("0:12");
		expect(clipClock(48)).toBe("0:48");
		expect(clipClock(186)).toBe("3:06");
		expect(clipClock(3725)).toBe("1:02:05");
		expect(clipClock(Number.NaN)).toBe("0:00");
		expect(clipClock(-3)).toBe("0:00");
	});
});

describe("isGameRecapHighlight (S75)", () =>
{
	it("finds 823823's one recap clip among its videos", () =>
	{
		expect(titles(VIDEOS.filter(isGameRecapHighlight))).toEqual(["Conforto clubs Cubs' 200th homer in close win"]);
	});

	it("takes any one of MLB's recap keywords", () =>
	{
		for (const tag of ["game-recap", "mlb_recap", "MLBCOM_GAME_RECAP"])
		{
			expect(isGameRecapHighlight({
				tags: ["home-run", tag],
			})).toBe(true);
		}
		expect(isGameRecapHighlight({
			tags: ["home-run"],
		})).toBe(false);
		expect(isGameRecapHighlight({})).toBe(false);
	});
});

describe("highlightTitle (S75)", () =>
{
	const recap = VIDEOS.find(isGameRecapHighlight)!;
	const play = VIDEOS.find((h) => !isGameRecapHighlight(h))!;

	it("titles the recap clip \"Recap (score hidden)\" with scores hidden", () =>
	{
		expect(highlightTitle(recap, true)).toBe("Recap (score hidden)");
	});

	it("keeps MLB's title for the recap with scores shown, and for every other clip either way", () =>
	{
		expect(highlightTitle(recap, false)).toBe(recap.title);
		expect(highlightTitle(play, true)).toBe(play.title);
		expect(highlightTitle(play, false)).toBe(play.title);
	});
});
