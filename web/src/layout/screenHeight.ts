import { useState } from "react";

/**
 * Below this window height (px) the phone's calendar sheet drops its game counts and its day cells
 * are 36px tall (shell-scoreboard A8, `scoreboard-calendar-short-mobile`): the full sheet is 501px
 * tall, so under 640px it would cover the date control.
 */
export const SHORT_SCREEN_HEIGHT = 640;

/**
 * Whether the screen is short enough for A8's short sheet: the window's inner height when the
 * caller mounts (the calendar, as it opens), read once and never per month, so a month never
 * reflows between counts and no counts (A8: "that is decided once from the screen, never per
 * month"). Lives in `web/src/layout/`, the only place that reads the viewport (ADR-014 rule 8;
 * S125 AC 8).
 */
export function useShortScreen(): boolean
{
	const [short] = useState(() => window.innerHeight < SHORT_SCREEN_HEIGHT);
	return short;
}
