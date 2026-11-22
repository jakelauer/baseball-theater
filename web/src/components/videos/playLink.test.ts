/**
 * S145 AC 5: `playInningLink` adds the arrow, the spoken `Open play - ` prefix and the play's
 * address to the domain's half-inning words, from plain fields; `videoPlayLink` calls it.
 */
import type { AtBat } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { playInningLink, videoPlayLink } from "./playLink.js";

describe("playInningLink (S145)", () =>
{
	it("S145 AC 5: Top 6 →, spoken Open play - Top of 6th inning, to the Plays room on the play (id URI-encoded)", () =>
	{
		expect(playInningLink({
			gamePk: 823823,
			playId: "abc",
			halfInning: "top",
			inning: 6,
		})).toEqual({
			label: "Top 6 →",
			name: "Open play - Top of 6th inning",
			to: "/game/823823/plays?play=abc",
		});
		expect(playInningLink({
			gamePk: 1,
			playId: "a b/c?d",
			halfInning: "bottom",
			inning: 3,
		})).toEqual({
			label: "Bot 3 →",
			name: "Open play - Bottom of 3rd inning",
			to: "/game/1/plays?play=a%20b%2Fc%3Fd",
		});
		expect(playInningLink({
			gamePk: 1,
			playId: "x",
			halfInning: "top",
			inning: 10,
		}).label).toBe("Top 10 →");
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
