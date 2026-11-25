import { useLocation, useSearchParams } from "react-router-dom";

/** The search param naming the clip open on a page (#424): `?clip=<highlight id>`. */
export const CLIP_PARAM = "clip";

/**
 * The clip open on this page, kept in its URL so every clip can be a link (#424; owner,
 * 2026-11-23: "if you visit the link in a new tab, it should open the page that you were on and
 * then open the video that you opened, such that if you close the video, you'd end up in the same
 * page that you were on in the first tab"). The one place a surface that plays clips (the Videos
 * and Plays rooms, Search, the day digest) reads, links and closes its open clip (ADR-025).
 *
 * - `playing`: the clip among `clips` whose `idOf` the URL's `?clip=` names, or null when it names
 *   none, or one not (yet) loaded, so a link waits for its page's data and an unknown id opens nothing.
 * - `href(clip)`: this page's path and params with `?clip=` set to that clip. A card renders it as a
 *   router `Link` with `replace`: a plain click opens the player in place, a middle- or modified
 *   click is the browser's, opening the page with the clip in a new tab.
 * - `close()`: drops `?clip=` and keeps every other param, so the page is as it was.
 *
 * Opening and closing replace the history entry rather than adding one, as choosing a clip did
 * before it was a link, so Back still leaves the page and never reopens a closed clip.
 */
export function useOpenClip<T>(clips: readonly T[] | undefined, idOf: (clip: T) => string): {
	playing: T | null;
	href: (clip: T) => string;
	close: () => void;
}
{
	const [params, setParams] = useSearchParams();
	const { pathname } = useLocation();
	const id = params.get(CLIP_PARAM);
	const playing = id === null ? null : clips?.find((clip) => idOf(clip) === id) ?? null;
	const href = (clip: T) =>
	{
		const next = new URLSearchParams(params);
		next.set(CLIP_PARAM, idOf(clip));
		return `${pathname}?${next.toString()}`;
	};
	const close = () => setParams((current) =>
	{
		const next = new URLSearchParams(current);
		next.delete(CLIP_PARAM);
		return next;
	}, {
		replace: true,
	});
	return {
		playing,
		href,
		close,
	};
}
