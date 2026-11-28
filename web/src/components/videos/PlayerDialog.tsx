import {
	FocusTrap, Group, Modal, UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
	useEffect, useRef, useState,
} from "react";
import { highlightTitle } from "@bt/domain";
import type { ClipViewSource } from "../../api/clipViews.js";
import type { Video } from "./VideoCard.js";
import { PlayInningPill } from "./PlayInningPill.js";
import { gameVideosLink } from "./playLink.js";
import type { PlayLink } from "./playLink.js";
import { usePlayerSlot } from "./PlayerProvider.js";

/** How long the dialog takes to open, in ms: brief enough to feel almost instant, long enough to read as opening (#423). */
const OPEN_MS = 150;

/** The game a clip belongs to: its pk, and its teams and date, which the game pill speaks (`gameVideosLink`). */
export type PlayerGame = Parameters<typeof gameVideosLink>[0];

/**
 * The only modal player (S70; S196): the `VideoPlayer` in an inset Mantine `Modal`, framed like the
 * site's other dialogs (the change log, `ChangelogModal`: Raised, a hairline border, 12px corners),
 * over the site dimmed but still visible (owner, 2026-11-23: "some maximum amount of the screen so
 * there's like a border around it that you can see the sight behind"). It takes at most 90% of the
 * viewport's width and height (`.bt-player-modal`, styles.css). Inside it, top to bottom: the pills and
 * "Close ✕", the title, the clip, BT's tools, the disclaimer (owner, same day: "the title should be on
 * top of the video and the tools below the video, and the disclaimer should remain at the bottom";
 * `VideoPlayer`'s `titleAbove`). It closes "with the close button the escape key or clicking outside
 * the border of the modal" (owner, same day). Mantine's own Esc and overlay closes are off, since each
 * closes too much: a press on the overlay closes only when it also started outside the border
 * (`pressedInside`), so a seek drag on the clip's built-in bar that ends on the dimmed site, which some
 * browsers report as a click on the overlay, keeps the player; and Esc closes only outside the browser's
 * full screen (`document.fullscreenElement`, or Safari's prefixed one, compared loosely since it is
 * undefined where the Fullscreen API is missing), where that press is the browser's, to leave full
 * screen, and not while another dialog opened over the player holds focus. A press inside the border
 * never closes it. Full screen, mute and volume are the clip's built-in controls (B579), so it adds no
 * button for them. This replaces game-shell A4's floating player on a fully dimmed page under the
 * owner's design waiver (2026-11-25, in S196's text). The Videos room, Search (S5) and the day digest
 * (S71) all open this one.
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
 * S75); only the game page passes `scoresHidden` (with `fromGamePk`), so Search and the digest keep
 * MLB's title. That game goes to the player as `scoresGame`, so in the corner the title follows Hide
 * Scores as it changes.
 *
 * The Close row and the player sit in the one content box, so they share one focus trap.
 *
 * It opens with a brief pop (opacity and scale, `OPEN_MS`), and the clip starts only once that
 * ends, so no sound plays while it opens (owner, 2026-11-23, #423: "It should feel almost
 * instant, but it should be not instant … the video shouldn't play until the animation is
 * completed"). With reduced motion it opens at once and plays at once. Mantine runs a modal's
 * enter transition only when `opened` turns true after mounting, so the dialog mounts closed and
 * opens a frame later; the player's `autoPlay` turns on once it has opened, which starts the same
 * `<video>` (`VideoPlayer`), so the element isn't replaced and nothing reloads.
 *
 * The clip itself is `PlayerProvider`'s one player (S198), moved into the slot under the title:
 * Close, Esc and a press outside stop it (`dismiss`), while leaving the page another way (a pill, any
 * link, Back) or the tool row's Mini player button sends a playing clip to the corner player.
 *
 * It opens with focus on Mantine's hidden `FocusTrap.InitialFocus`, not on its first control (#582):
 * a clip's link opened in a new tab (#424) opens the dialog on a page the reader hasn't touched,
 * where the browser counts focus placed on open as keyboard focus and rings that control, so the
 * player opened with a red box around the game pill, the inning pill or Close. Tab still reaches each
 * control in order, Esc still closes, and Space plays and pauses (`VideoPlayer`).
 */
export function PlayerDialog({
	video, onClose, game, fromGamePk, scoresHidden = false, playLink, countViews,
}: { video: Video;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number;
	scoresHidden?: boolean;
	/** The clip's play link (S97; game-shell A6's inning pill, S145): its inning pill, drawn after the game pill when there is one (S173). */
	playLink?: PlayLink | null;
	/** Where the clip's start and finish are counted from (S174): the Videos room passes it; Search and the digest don't. */
	countViews?: ClipViewSource; })
{
	const title = highlightTitle(video, scoresHidden);
	const gameLink = game && game.gamePk !== fromGamePk ? gameVideosLink(game) : null;
	const reduceMotion = useReducedMotion();
	const [opened, setOpened] = useState(false);
	const [entered, setEntered] = useState(false);
	// Whether the latest press started inside the modal's border, read when a click reaches the overlay.
	const pressedInside = useRef(false);
	const { slot, dismiss } = usePlayerSlot({
		video,
		title,
		autoPlay: entered,
		titleAbove: true,
		chosen: true,
		onClose,
		countViews,
		...fromGamePk === undefined ? {} : {
			scoresGame: {
				gamePk: fromGamePk,
			},
		},
	});
	// Close, Esc and a press outside stop the clip, then close the dialog (a pill only closes it). Only
	// this dialog's clip (`dismiss`): an Esc before its slot took the player leaves the corner's playing.
	const stop = () =>
	{
		dismiss();
		onClose();
	};
	// The latest `stop`, read at the press: callers pass a fresh `onClose` each render.
	const close = useRef(stop);
	useEffect(() =>
	{
		close.current = stop;
	});
	useEffect(() =>
	{
		function onPress(event: PointerEvent): void
		{
			pressedInside.current = event.target instanceof Element && event.target.closest(".bt-player-modal") != null;
		}
		// Esc as Mantine handles it (window capture, never mid-composition, not a press a menu inside marked
		// as its own), except in the browser's full screen (Safari before 16.4 sets only the prefixed
		// `webkitFullscreenElement`) and except when another dialog or drawer opened over the player holds
		// focus: Mantine closed only the topmost modal, so that press is the other one's. None stacks one
		// today (the quality picker is a Menu, inside this dialog); the guard keeps a future one safe.
		function onKey(event: KeyboardEvent): void
		{
			if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
			const page = document as Document & { webkitFullscreenElement?: Element | null };
			if (page.fullscreenElement != null || page.webkitFullscreenElement != null) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.getAttribute("data-mantine-stop-propagation") === "true") return;
			const holder = target?.closest("[role=\"dialog\"], [aria-modal=\"true\"]");
			if (holder && !holder.classList.contains("bt-player-modal")) return;
			close.current();
		}
		document.addEventListener("pointerdown", onPress, true);
		window.addEventListener("keydown", onKey, true);
		return () =>
		{
			document.removeEventListener("pointerdown", onPress, true);
			window.removeEventListener("keydown", onKey, true);
		};
	}, []);
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
			onClose={stop}
			centered
			withCloseButton={false}
			closeOnClickOutside={false}
			closeOnEscape={false}
			aria-label={title}
			size="auto"
			radius={12}
			padding={16}
			shadow="xl"
			// The site dimmed but visible behind it, as the change log modal dims it.
			overlayProps={{
				backgroundOpacity: 0.7,
				color: "var(--bt-dark)",
				onClick: () =>
				{
					if (!pressedInside.current) stop();
				},
			}}
			classNames={{
				content: "bt-player-modal",
			}}
			transitionProps={{
				transition: "pop",
				duration: reduceMotion ? 0 : OPEN_MS,
				onEntered: () => setEntered(true),
			}}
			styles={{
				content: {
					background: "var(--bt-raised)",
					border: "1px solid var(--bt-hairline)",
				},
				body: {
					display: "flex",
					flexDirection: "column",
					gap: 12,
				},
			}}
		>
			<FocusTrap.InitialFocus />
			<Group justify="space-between" wrap="nowrap" gap="md">
				<Group gap={8} wrap="nowrap" data-testid="player-pills">
					{gameLink ? <PlayInningPill link={gameLink} testId="player-game-link" onClick={onClose} /> : null}
					{playLink ? <PlayInningPill link={playLink} testId="player-play-link" onClick={onClose} /> : null}
				</Group>
				<UnstyledButton onClick={stop} aria-label="Close video" c="var(--bt-light)" className="bt-hover" px={8} py={4} mx={-8} my={-4} style={{
					flexShrink: 0,
					borderRadius: 8,
				}}
				>
					Close ✕
				</UnstyledButton>
			</Group>
			<div ref={slot} className="bt-player-slot" />
		</Modal>
	);
}
