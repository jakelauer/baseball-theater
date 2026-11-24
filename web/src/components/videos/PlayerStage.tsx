import { Box } from "@mantine/core";
import { highlightTitle } from "@bt/domain";
import { useEffect, useRef } from "react";
import type { Video } from "./VideoCard.js";
import { VideoPlayer } from "./VideoPlayer.js";

/**
 * True when an Escape press already belongs to something else: a handler that took it, the
 * browser leaving full screen (it usually swallows that press, but not everywhere), or an
 * open menu inside the player (the quality picker) that it closes first. `fullscreenElement`
 * is compared loosely: it is undefined where the Fullscreen API is missing (jsdom among them).
 */
function escapeTaken(event: KeyboardEvent): boolean
{
	const target = event.target instanceof Element ? event.target : null;
	return event.defaultPrevented || document.fullscreenElement != null || target?.closest("[role=\"menu\"]") != null;
}

/**
 * The persistent player (S70; game-shell `video-player-stage-*`): the `VideoPlayer` fixed
 * at the top of the Videos room, above the list, for readers who choose Stage in
 * Settings → Game Detail → Video Player. It shows the chosen clip, playing, or until one
 * is chosen the room's first, waiting. Keyed by clip and by whether it was chosen, so a new
 * choice starts fresh and closing one goes back to waiting even when it was the first.
 *
 * Esc closes a chosen clip (`onClose`), as it does the dialog (#414), and puts focus back on
 * what had it when the clip was chosen (the card pressed); a stage that is only waiting
 * ignores it, and so does a press something else takes first (`escapeTaken`), so in full
 * screen the first Esc leaves full screen and a second one closes the clip.
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
			close.current();
			if (opener?.isConnected) opener.focus();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [autoPlay, video.id]);

	return (
		<Box component="section" aria-label="Video player">
			<VideoPlayer key={`${video.id}:${autoPlay}`} video={video} title={highlightTitle(video, scoresHidden)} autoPlay={autoPlay} />
		</Box>
	);
}
