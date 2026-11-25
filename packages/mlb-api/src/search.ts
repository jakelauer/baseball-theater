/**
 * MLB's highlight search answer (`fastball-gateway.mlb.com` `Search`; S5, ADR-029), as named types and
 * their zod parser. Upstream data, so it lives here beside the other feeds (CLAUDE.md, MLB upstream
 * types; enhancement #347, done by S153), apart from BT's own search types in `@bt/domain`. Only the
 * fields BT asks for are modelled (`searchHighlightsRequest` in `functions/src/adapters/http/mlb.ts`).
 *
 * Two levels, so one odd clip never costs the fan the rest: `parseSearchResponse` checks the answer's
 * envelope and throws on MLB's `errors` or a changed shape (a failed answer is an error, never "no
 * results"); `parseSearchPlay` checks one play and answers null for one BT can't map, which the mapper
 * leaves out.
 */
import { z } from "zod";

/** One club as MLB's search names it (`playInfo.teams.away`); `id: -1`, `triCode: ""` when the clip has no game. */
export interface MlbSearchTeamInfo {
	id: number;
	triCode?: string | null;
}

/**
 * The play a clip shows: its game's two clubs and its inning. A clip with no play has `inning: 0` and a
 * null `inningHalf` (`fixtures/search-walk-off.json`); one with a play has `"Top"` or `"Bottom"`.
 */
export interface MlbSearchPlayInfo {
	inning?: number | null;
	inningHalf?: string | null;
	gamePk?: number | null;
	teams?: {
		away?: MlbSearchTeamInfo | null;
		home?: MlbSearchTeamInfo | null;
	} | null;
}

/** One encoding of a clip (`mp4Avc`, `hlsCloud`, `highBit`, `trickplay`). */
export interface MlbSearchPlayback {
	name: string;
	url: string;
}

/** One feed of a clip: its length, its still and its encodings. */
export interface MlbSearchFeed {
	duration?: string | null;
	image?: {
		cuts?: { width?: number | null;
			src?: string | null; }[] | null;
	} | null;
	playbacks?: MlbSearchPlayback[] | null;
}

/** The clip itself, as MLB's `MediaPlayback`. */
export interface MlbSearchMediaPlayback {
	id: string;
	title: string;
	blurb?: string | null;
	description?: string | null;
	/** When MLB published it, `YYYY-MM-DD`. */
	date?: string | null;
	/** The play's id, as a pitch's `playId` in the game's feed (null for a clip with no play); the content feed reads the same field. */
	guid?: string | null;
	playInfo?: MlbSearchPlayInfo | null;
	feeds?: MlbSearchFeed[] | null;
}

/** One search hit: its game (`gamePk: -1`, `gameDate: null` for a clip tied to none) and its clips. */
export interface MlbSearchPlay {
	id?: string;
	gamePk: number;
	gameDate?: string | null;
	mediaPlayback: MlbSearchMediaPlayback[];
}

/** The GraphQL answer's envelope; each play is checked on its own (`parseSearchPlay`), as MLB's plays are not all whole. */
export interface MlbSearchResponse {
	data: {
		search: {
			total: number;
			plays: unknown[];
		};
	};
}

const searchTeamInfoSchema = z.object({
	id: z.number(),
	triCode: z.string().nullable().optional(),
});

const searchPlayInfoSchema = z.object({
	inning: z.number().nullable().optional(),
	inningHalf: z.string().nullable().optional(),
	gamePk: z.number().nullable().optional(),
	teams: z.object({
		away: searchTeamInfoSchema.nullable().optional(),
		home: searchTeamInfoSchema.nullable().optional(),
	}).nullable().optional(),
});

const searchFeedSchema = z.object({
	duration: z.string().nullable().optional(),
	image: z.object({
		cuts: z.array(z.object({
			width: z.number().nullable().optional(),
			src: z.string().nullable().optional(),
		})).nullable().optional(),
	}).nullable().optional(),
	playbacks: z.array(z.object({
		name: z.string(),
		url: z.string(),
	})).nullable().optional(),
});

const searchMediaPlaybackSchema = z.object({
	id: z.string(),
	title: z.string(),
	blurb: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	date: z.string().nullable().optional(),
	guid: z.string().nullable().optional(),
	playInfo: searchPlayInfoSchema.nullable().optional(),
	feeds: z.array(searchFeedSchema).nullable().optional(),
});

const searchPlaySchema = z.object({
	id: z.string().optional(),
	gamePk: z.number(),
	gameDate: z.string().nullable().optional(),
	mediaPlayback: z.array(searchMediaPlaybackSchema),
});

const searchResponseSchema = z.object({
	data: z.object({
		search: z.object({
			total: z.number(),
			plays: z.array(z.unknown()),
		}),
	}),
});

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The search answer's envelope, checked: a `data.search` with a numeric `total` and a `plays` list.
 * Throws otherwise, naming what was wrong: MLB's first `errors` message when it refused the query, else
 * "not an object" or "no data.search" for a changed shape.
 */
export function parseSearchResponse(payload: unknown): MlbSearchResponse
{
	if (!isRecord(payload)) throw new Error("MLB search: answer is not an object");
	const errors = payload.errors;
	if (Array.isArray(errors) && errors.length > 0)
	{
		const first: unknown = errors[0];
		throw new Error(`MLB search: ${isRecord(first) && typeof first.message === "string" ? first.message : "query refused"}`);
	}
	const parsed = searchResponseSchema.safeParse(payload);
	if (!parsed.success) throw new Error("MLB search: no data.search");
	return parsed.data;
}

/**
 * One play of the answer, checked by its schema: a numeric `gamePk`, a `gameDate` that is a string,
 * null or absent, and clips each with a string `id` and `title`, whose feeds' cuts are lists and whose
 * playbacks each have a string `name` and `url`. Null for a play that fails, which the caller leaves out.
 */
export function parseSearchPlay(play: unknown): MlbSearchPlay | null
{
	const parsed = searchPlaySchema.safeParse(play);
	return parsed.success ? parsed.data : null;
}
