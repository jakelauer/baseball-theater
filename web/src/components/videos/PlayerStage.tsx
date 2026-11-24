import { Box } from "@mantine/core";
import { highlightTitle } from "@bt/domain";
import { useEffect, useRef } from "react";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

/**
 * True when an Escape press already belongs to something else: a handler that took it, an
 * input method (IME) cancelling the text being composed, the browser leaving full screen (it usually swallows that press, but not everywhere), an open
 * menu inside the player or the room (the quality, featured-team and sort pickers) that it
 * closes first, or a modal such as the Filters drawer. `fullscreenElement` is compared
 * loosely: it is undefined where the Fullscreen API is missing (jsdom among them).
 *
 * Mantine closes a Modal or Drawer from a window-capture listener without `preventDefault`,
 * and React flushes that close before this document listener runs, so a conditionally
 * rendered drawer is already unmounted by then: the target's own ancestors (still linked in
 * its detached subtree, and the drawer traps focus) are what show the press was the drawer's.
 * A modal still in the page (one mid-exit, or focus outside it) is caught by the query.
 * Known gap: a Select, Combobox or Popover target that closes itself on Esc without
 * `preventDefault` strips its open attributes in that same flushed render, so it can't be
 * told apart here; the Videos room has none (its pickers are Menus, `role="menu"`).
 */
function escapeTaken(event: KeyboardEvent): boolean
{
	const target = event.target instanceof Element ? event.target : null;
	return event.defaultPrevented
		|| event.isComposing
		|| document.fullscreenElement != null
		|| target?.closest("[role=\"menu\"], [role=\"dialog\"], [aria-modal=\"true\"]") != null
		|| document.querySelector("[aria-modal=\"true\"]") != null;
}

/**
 * The persistent player (S70; game-shell `video-player-stage-*`): the `VideoPlayer` fixed
 * at the top of the Videos room, above the list, for readers who choose Stage in
 * Settings → Game Detail → Video Player. It shows the chosen clip, playing, or until one
 * is chosen the room's first, waiting. Keyed by clip and by whether it was chosen, so a new
 * choice starts fresh and closing one goes back to waiting even when it was the first.
 *
 * Esc closes a chosen clip (`onClose`), as it does the dialog (#414), from anywhere on the
 * page, the "Search videos" box included (a plain text field that has no use for Esc, except
 * to cancel an IME composition, which `escapeTaken` leaves to the input method). It
 * puts focus back on what had it when the clip was chosen (the card pressed) only when focus
 * was on the page itself or inside the player, so a reader who has moved on (into the search
 * box, say) stays there. A stage that is only waiting ignores Esc, and so does a press
 * something else takes first (`escapeTaken`), so in full screen the first Esc leaves full
 * screen and a second one closes the clip.
 */
export function PlayerStage({
	video, autoPlay, scoresHidden = false, onClose,
}: { video: Video;
	autoPlay: boolean;
	/** With scores hidden the recap clip is retitled (`highlightTitle`, S75). */
	scoresHidden?: boolean;
	/** Closes the chosen clip; Esc calls it while one plays. */
	onClose?: () => void; })
{
	// The latest `onClose`, read at the press: callers pass a fresh arrow each render, and
	// re-running the effect on it would re-capture `opener` from wherever focus moved since.
	const close = useRef(onClose);
	const stage = useRef<HTMLElement>(null);
	useEffect(() =>
	{
		close.current = onClose;
	});
	useEffect(() =>
	{
		if (!autoPlay) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		function onKey(event: KeyboardEvent): void
		{
			if (event.key !== "Escape" || escapeTaken(event)) return;
			if (!close.current) return;
			// Read before closing: the close re-renders the player away, dropping focus held in it.
			const focused = document.activeElement;
			const returnFocus = focused == null || focused === document.body || stage.current?.contains(focused) === true;
			close.current();
			if (returnFocus && opener?.isConnected) opener.focus();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [autoPlay, video.id]);

	return (
		<Box ref={stage} component="section" aria-label="Video player">
			<VideoPlayer key={`${video.id}:${autoPlay}`} video={video} title={highlightTitle(video, scoresHidden)} autoPlay={autoPlay} />
		</Box>
	);
}
