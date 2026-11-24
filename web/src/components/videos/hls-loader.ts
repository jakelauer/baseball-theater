import type * as HlsLight from "hls.js/light";

/**
 * Loads hls.js's light build (#415) as its own chunk, only when `VideoPlayer` plays an HLS
 * quality the browser can't play itself, so the entry bundle never carries it (the light build
 * leaves out subtitles, alternate audio and DRM, which highlight clips don't use). One function
 * so tests can hold or refuse the load.
 */
export function loadHls(): Promise<typeof HlsLight>
{
	return import("hls.js/light");
}
