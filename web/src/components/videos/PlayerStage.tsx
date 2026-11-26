import { Box, Stack } from "@mantine/core";
import { highlightTitle } from "@bt/domain";
import { useEffect, useRef } from "react";
import { PlayInningPill } from "./PlayInningPill.js";
import { usePlayerSlot } from "./PlayerProvider.js";
import type { Video } from "./VideoCard.js";
import { videoPlayLink } from "./playLink.js";

/** The game whose Videos room holds the stage: what `videoPlayLink` needs to find the clip's play. */
export type StageGame = Parameters<typeof videoPlayLink>[1];

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
 * is chosen the room's first, waiting. The clip is `PlayerProvider`'s one player (S198), moved into
 * the stage's slot and keyed by the clip alone, so choosing the waiting clip plays the same element;
 * closing a chosen clip stops it (`dismiss`), and the stage then asks again for its waiting first clip,
 * which starts fresh even when it was the one just closed. Leaving the room while a clip plays sends it
 * to the corner player; a waiting clip never takes the player back from the corner, so while the
 * corner plays another clip the stage draws nothing.
 *
 * Above the video, for a clip with a play, sits S145's inning pill (`Top 6 →`) alone on a
 * row of its own, left-aligned with the video (S172; standings-search-settings A10: the stage
 * has no top row to hold it; owner, 2026-11-22: "Yes, a row above the video (Recommended)").
 * The link is built here from the clip the stage shows, so the waiting first clip gets one
 * too, not only a chosen clip. A clip with no play has no row at all. No game pill: the
 * stage only plays inside the game it belongs to (A10, Stage player). Choosing the pill
 * leaves the Videos room for the Plays room, so the stage stops with the room. The inning
 * carries no score, so Hide Scores leaves the row as it is.
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
	video, autoPlay, scoresHidden = false, game, onClose,
}: { video: Video;
	autoPlay: boolean;
	/** With scores hidden the recap clip is retitled (`highlightTitle`, S75). */
	scoresHidden?: boolean;
	/** The room's game, for the clip's inning pill; without it the stage draws no row. */
	game?: StageGame;
	/** Closes the chosen clip; Esc calls it while one plays. */
	onClose?: () => void; })
{
	const title = highlightTitle(video, scoresHidden);
	const {
		slot, holding, dismiss,
	} = usePlayerSlot({
		video,
		title,
		autoPlay,
		chosen: autoPlay,
		onClose,
		// The room's game, whose Hide Scores rule titles the clip in the corner as the setting changes.
		...game ? {
			scoresGame: {
				gamePk: game.gamePk,
			},
		} : {},
	});
	// Esc stops the chosen clip before closing it.
	const stop = onClose ? () =>
	{
		dismiss();
		onClose();
	} : undefined;
	// The latest `onClose`, read at the press: callers pass a fresh arrow each render, and
	// re-running the effect on it would re-capture `opener` from wherever focus moved since.
	const close = useRef(stop);
	const stage = useRef<HTMLDivElement>(null); // Mantine types Stack's ref as a div even rendered as a section
	useEffect(() =>
	{
		close.current = stop;
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

	const link = game ? videoPlayLink(video, game) : null;
	return (
		<Stack ref={stage} component="section" aria-label="Video player" gap={2} style={holding ? undefined : {
			display: "none",
		}}
		>
			{link ? (
				<Box data-testid="stage-play-row" style={{
					display: "flex",
				}}
				>
					<PlayInningPill link={link} testId="stage-play-link" />
				</Box>
			) : null}
			<div ref={slot} />
		</Stack>
	);
}
