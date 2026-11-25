import {
	Box, Group, Modal, UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { highlightTitle } from "@bt/domain";
import type { Video } from "./VideoCard.js";
import { PlayInningPill } from "./PlayInningPill.js";
import { gameVideosLink } from "./playLink.js";
import type { PlayLink } from "./playLink.js";
import { VideoPlayer } from "./VideoPlayer.js";

/** How long the dialog takes to open, in ms: brief enough to feel almost instant, long enough to read as opening (#423). */
const OPEN_MS = 150;

/** The game a clip belongs to: its pk, and its teams and date, which the game pill speaks (`gameVideosLink`). */
export type PlayerGame = Parameters<typeof gameVideosLink>[0];

/**
 * The only modal player (S70; game-shell A4, standings-search-settings A6): the
 * `VideoPlayer` floating, with no card, over the fully dimmed page. "Close ✕" sits in the
 * overlay at top right (owner, 2026-10-31: "a floating video with a “Close” button in the
 * dimmed overlay, no borders, so there’s more real estate to show a playlist in the
 * future"); Esc and a press on the empty overlay close it too. The Videos room, Search
 * (S5) and the day digest (S71) all open this one.
 *
 * At top left sit its pills (S173; standings-search-settings A10, which repealed the text link to
 * the game): first the game pill, to the clip's game's Videos tab (`gameVideosLink`), whenever
 * the clip carries a game and isn't being played from that game's own page (owner, 2026-10-21: "All
 * videos which have enough context to associate them to a game should show a link to the game unless
 * they are already being played from the game"); then, 8px after it, the clip's inning pill, `Top 6 →`
 * (S97, S145; game-shell A6), when it has a play link. The caller passes `game` when it knows it,
 * `fromGamePk` when it is that game's page and `playLink` when the clip has a play. Both pills are the
 * one `PlayInningPill` (A10: the game pill is an instance of the same component), and each closes the
 * player as it navigates. With neither, only "Close ✕" shows, at top right.
 *
 * With scores hidden the recap clip is titled "Recap (score hidden)" (`highlightTitle`,
 * S75); only the game page passes `scoresHidden`, so Search and the digest keep MLB's title.
 *
 * The content fills the screen so the Close row and the player share one focus trap; it
 * is transparent, so the overlay behind it is the dimmed page the frames draw.
 *
 * It opens with a brief pop (opacity and scale, `OPEN_MS`), and the clip starts only once that
 * ends, so no sound plays while it opens (owner, 2026-11-23, #423: "It should feel almost
 * instant, but it should be not instant … the video shouldn't play until the animation is
 * completed"). With reduced motion it opens at once and plays at once. Mantine runs a modal's
 * enter transition only when `opened` turns true after mounting, so the dialog mounts closed and
 * opens a frame later; the player's `autoPlay` turns on once it has opened, which starts the same
 * `<video>` (`VideoPlayer`), so the element isn't replaced and nothing reloads.
 */
export function PlayerDialog({
	video, onClose, game, fromGamePk, scoresHidden = false, playLink,
}: { video: Video;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number;
	scoresHidden?: boolean;
	/** The clip's play link (S97; game-shell A6's inning pill, S145): shown top left when no game link holds that slot. */
	playLink?: PlayLink | null; })
{
	const title = highlightTitle(video, scoresHidden);
	const gameLink = game && game.gamePk !== fromGamePk ? gameVideosLink(game) : null;
	const reduceMotion = useReducedMotion();
	const [opened, setOpened] = useState(false);
	const [entered, setEntered] = useState(false);
	useEffect(() =>
	{
		// A frame later, once the portal holding the dialog has mounted closed: opened in the same pass,
		// the portal's first render would already be open and Mantine would skip the transition.
		const frame = requestAnimationFrame(() => setOpened(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			fullScreen
			withCloseButton={false}
			aria-label={title}
			transitionProps={{
				transition: "pop",
				duration: reduceMotion ? 0 : OPEN_MS,
				onEntered: () => setEntered(true),
			}}
			styles={{
				// The frames draw the page behind fully dimmed (Mantine's own overlay color can't take a CSS variable).
				overlay: {
					background: "var(--bt-dark)",
					opacity: 1,
				},
				content: {
					background: "transparent",
					boxShadow: "none",
				},
				body: {
					height: "100%",
					padding: 16,
					display: "flex",
					flexDirection: "column",
				},
			}}
		>
			<Group justify="space-between" wrap="nowrap" gap="md">
				<Group gap={8} wrap="nowrap" data-testid="player-pills">
					{gameLink ? <PlayInningPill link={gameLink} testId="player-game-link" onClick={onClose} /> : null}
					{playLink ? <PlayInningPill link={playLink} testId="player-play-link" onClick={onClose} /> : null}
				</Group>
				<UnstyledButton onClick={onClose} aria-label="Close video" c="var(--bt-light)" className="bt-hover" px={8} py={4} mx={-8} my={-4} style={{
					flexShrink: 0,
					borderRadius: 8,
				}}
				>
					Close ✕
				</UnstyledButton>
			</Group>
			<Box
				data-testid="player-backdrop"
				onClick={(event) =>
				{
					if (event.target === event.currentTarget) onClose();
				}}
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{/* `.bt-player-frame` (styles.css): as wide as the screen allows, up to 1280px, while the clip,
				    its controls and the disclaimer still fit the screen's height (owner, 2026-11-12: "video
				    player on desktop needs to play videos larger, taking more of the screen"). */}
				<Box className="bt-player-frame">
					<VideoPlayer video={video} title={title} autoPlay={entered} />
				</Box>
			</Box>
		</Modal>
	);
}
