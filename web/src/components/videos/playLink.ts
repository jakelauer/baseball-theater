import type { AtBat, HalfInning } from "@bt/domain";
import {
	atBatOfPlay, halfInningLabel, halfInningName,
} from "@bt/domain";
import type { Video } from "./VideoCard.js";

/**
 * A video's link to its play (game-shell A6): the inning pill's visible words (`Top 6 →`), the
 * name a screen reader speaks for it (`Top 6: open play, top of 6th inning`), and where it goes.
 */
export type PlayLink = {
	label: string;
	name: string;
	to: string;
};

/**
 * The link to a play from its plain fields (S145; game-shell A6): `Top 6 →`, spoken
 * `Top 6: open play, top of 6th inning`, opening the game's Plays room on that play
 * (`?play=<playId>`, game-rooms A6). The spoken name starts with the visible words, so a reader
 * who says what they see reaches the pill (WCAG 2.5.3; S172, owner, 2026-11-22: "Start with the
 * visible words (Recommended)", superseding S145's name, which began "Open play"); the
 * half-inning after it is `halfInningName` lowercased, as it sits mid-sentence. The one place the
 * arrow, the spoken name and the play's address are added (ADR-025): the card and both players
 * get it through `videoPlayLink`, and Search's rows, which have no `AtBat`, call it with their
 * route's fields.
 */
export function playInningLink({
	gamePk, playId, halfInning, inning,
}: HalfInning & { gamePk: number;
	playId: string; }): PlayLink
{
	const half = {
		halfInning,
		inning,
	};
	const visible = halfInningLabel(half);
	return {
		label: `${visible} →`,
		name: `${visible}: open play, ${halfInningName(half).toLowerCase()}`,
		to: `/game/${gamePk}/plays?play=${encodeURIComponent(playId)}`,
	};
}

/**
 * A video's link to its play (S97): `playInningLink` with the half-inning of the at-bat its pitch
 * is in. Null for a video with no play, or one whose pitch isn't in the game's plays. The one
 * place the card and the player get it.
 */
export function videoPlayLink(video: Pick<Video, "playId">, game: { gamePk: number;
	plays: readonly AtBat[]; }): PlayLink | null
{
	const atBat = atBatOfPlay(game.plays, video.playId);
	if (!atBat || !video.playId) return null;
	return playInningLink({
		gamePk: game.gamePk,
		playId: video.playId,
		halfInning: atBat.about.halfInning,
		inning: atBat.about.inning,
	});
}
