/**
 * `GET /api/v1/games/:gamePk/live` (S18; ADR-020, ADR-021): a WebSocket for a game in its
 * ADR-002 window, handed to the game's hub. A finished or not-yet-started game has no
 * socket — it is cached HTTP — so the answer points at `GET /api/v1/games/:gamePk`, which
 * clients also short-poll when a socket can't be had. `GET /api/v1/schedule/live?date=`
 * (S149) does the same for the scoreboard's day, handed to the day's hub. Streaming routes:
 * they sit outside `ApiRoutes` and the OpenAPI spec (`STREAMING_ROUTE_EXCEPTIONS`).
 */
import { isGameInActiveWindow } from "@bt/domain";
import { scheduleDayWindowMode } from "../services/game-state.js";
import { getOrRefreshGame, getOrRefreshSchedule } from "../services/ingest.js";
import type { ApiContext } from "./api.js";

/**
 * A refusal pointing at the cached HTTP route. `noStore` (the day route, S149) keeps the edge cache (S47, S212)
 * from holding it: a day refused before its first game's window opens must upgrade once it does.
 */
function refuse(status: number, error: string, hint: string, noStore = false): Response
{
	return Response.json({
		error,
		hint,
	}, {
		status,
		...noStore && {
			headers: {
				"Cache-Control": "no-store",
			},
		},
	});
}

export async function liveUpgrade(gamePk: number, request: Request, ctx: ApiContext): Promise<Response>
{
	const cached = `/api/v1/games/${gamePk}`;
	if (request.headers.get("Upgrade") !== "websocket") return refuse(426, "websocket_required", cached);
	const game = await getOrRefreshGame(ctx.ingest, gamePk);
	if (!game) return refuse(404, "not_found", cached);
	if (!isGameInActiveWindow(game, ctx.ingest.now?.() ?? new Date())) return refuse(409, "not_live", cached);
	if (!ctx.live) return refuse(501, "live_unavailable", cached);
	return ctx.live(gamePk, request);
}

/**
 * `GET /api/v1/schedule/live?date=<YYYY-MM-DD>` (S149 AC 5): upgrades to the date's day hub only while the day has a
 * game in its live window, judged now from the day's games and the clock by `scheduleDayWindowMode` (each suspended
 * game from when BT saw it suspended), never from the stored `windowMode`. The day is read as `GET /api/v1/schedule`
 * reads it (fetching a day BT doesn't hold yet); a day with no games is out of its window, not an error. Every refusal
 * says `no-store`, so the edge never keeps a "not live" answer.
 */
export async function liveDayUpgrade(date: string, request: Request, ctx: ApiContext): Promise<Response>
{
	const cached = `/api/v1/schedule?date=${date}`;
	if (request.headers.get("Upgrade") !== "websocket") return refuse(426, "websocket_required", cached, true);
	const day = await getOrRefreshSchedule(ctx.ingest, date);
	if (await scheduleDayWindowMode(ctx.ingest, day, ctx.ingest.now?.() ?? new Date()) !== "active") return refuse(409, "not_live", cached, true);
	if (!ctx.liveDay) return refuse(501, "live_unavailable", cached, true);
	return ctx.liveDay(date, request);
}
