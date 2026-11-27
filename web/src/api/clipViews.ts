import type { ClipViewEvent, ClipViewRequest } from "@bt/domain";
import type { paths } from "./generated/bt-api.v1.js";

/**
 * Where a clip's views are counted from (S174): its game and its 1-based place in that game's ranked Videos list, or 0
 * when it was opened directly. Only the Videos room passes one; a player given none counts nothing.
 */
export type ClipViewSource = Omit<ClipViewRequest, "event">;

/** The clip-view route's path as the published spec names it, so a renamed route fails the typecheck here. */
const CLIP_VIEWS_PATH = "/api/v1/clips/{mediaId}/views" satisfies keyof paths;

/** The route's body as the spec generates it, which `ClipViewRequest` must match (`generated.types.test.ts`). */
type ClipViewBody = paths[typeof CLIP_VIEWS_PATH]["post"]["requestBody"]["content"]["application/json"];

/**
 * Counts one start or finish of a clip played from a game's Videos room (S174 AC 6): the one way the app sends a view.
 * It uses `navigator.sendBeacon`, which the browser delivers even as the page closes, and falls back to `fetch` with
 * `keepalive` where there is no beacon or the browser refuses to queue it. It sends no session (not the API client, whose
 * middleware adds one) and no cookie (`credentials: "omit"`; a beacon's same-origin cookies are never read, since the
 * route reads none). A failed send is dropped silently: no retry, nothing shown, nothing thrown. Paths are built from
 * the spec's own path, as the API client builds them.
 */
export function sendClipView(mediaId: string, event: ClipViewEvent, source: ClipViewSource): void
{
	const body: ClipViewBody = {
		gamePk: source.gamePk,
		event,
		shownPosition: source.shownPosition,
	};
	const url = new URL(CLIP_VIEWS_PATH.replace("{mediaId}", encodeURIComponent(mediaId)), location.origin).toString();
	const json = JSON.stringify(body);
	try
	{
		if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([json], {
			type: "application/json",
		}))) return;
		void globalThis.fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: json,
			keepalive: true,
			credentials: "omit",
		}).catch(() => undefined);
	}
	catch
	{
		// Counting never gets in the viewer's way: a refused or broken send is dropped.
	}
}
