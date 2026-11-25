/**
 * S145 AC 5: `playInningLink` adds the arrow, the spoken name and the play's address to the
 * domain's half-inning words, from plain fields; `videoPlayLink` calls it. S172 AC 5: the spoken
 * name starts with the visible words, `Top 6: open play, top of 6th inning` (owner, 2026-11-22).
 */
import type { AtBat } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import {
	gameVideosLink, playInningLink, videoPlayLink,
} from "./playLink.js";

describe("playInningLink (S145)", () =>
{
	it("S145 AC 5: Top 6 →, spoken Top 6: open play, top of 6th inning, to the Plays room on the play (id URI-encoded)", () =>
	{
		expect(playInningLink({
			gamePk: 823823,
			playId: "abc",
			halfInning: "top",
			inning: 6,
		})).toEqual({
			label: "Top 6 →",
			name: "Top 6: open play, top of 6th inning",
			to: "/game/823823/plays?play=abc",
		});
		expect(playInningLink({
			gamePk: 1,
			playId: "a b/c?d",
			halfInning: "bottom",
			inning: 3,
		})).toEqual({
			label: "Bot 3 →",
			name: "Bot 3: open play, bottom of 3rd inning",
			to: "/game/1/plays?play=a%20b%2Fc%3Fd",
		});
		expect(playInningLink({
			gamePk: 1,
			playId: "x",
			halfInning: "top",
			inning: 10,
		}).label).toBe("Top 10 →");
	});

	it("S172 AC 5: the spoken name is the visible words without the arrow, then 'open play,' and the half-inning spoken", () =>
	{
		const name = (halfInning: "top" | "bottom", inning: number) => playInningLink({
			gamePk: 1,
			playId: "x",
			halfInning,
			inning,
		}).name;
		expect(name("top", 6)).toBe("Top 6: open play, top of 6th inning");
		expect(name("bottom", 10)).toBe("Bot 10: open play, bottom of 10th inning");
		expect(name("bottom", 1)).toBe("Bot 1: open play, bottom of 1st inning");
	});

	it("S145 AC 5: videoPlayLink is playInningLink with its at-bat's half-inning; null with no play or an unknown one", () =>
	{
		const plays = [{
			about: {
				atBatIndex: 0,
				halfInning: "bottom",
				inning: 7,
			},
			pitches: [{
				playId: "p1",
			}],
		}] as unknown as AtBat[];
		const game = {
			gamePk: 9,
			plays,
		};
		expect(videoPlayLink({
			playId: "p1",
		}, game)).toEqual(playInningLink({
			gamePk: 9,
			playId: "p1",
			halfInning: "bottom",
			inning: 7,
		}));
		expect(videoPlayLink({
			playId: null,
		}, game)).toBeNull();
		expect(videoPlayLink({
			playId: "nope",
		}, game)).toBeNull();
	});
});

describe("gameVideosLink (S173; standings-search-settings A10's game pill)", () =>
{
	it("S173 AC 2: More from game →, spoken More from game: <away @ home, date>, to the game's Videos tab", () =>
	{
		expect(gameVideosLink({
			gamePk: 823823,
			away: "NYY",
			home: "BOS",
			officialDate: "2026-09-21",
		})).toEqual({
			label: "More from game \u2192",
			name: "More from game: NYY @ BOS, Sep 21",
			to: "/game/823823/videos",
		});
	});
});
