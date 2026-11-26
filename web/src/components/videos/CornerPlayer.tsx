import {
	ActionIcon, Box, Group, Text,
} from "@mantine/core";
import {
	IconArrowsDiagonal, IconPlayerPause, IconPlayerPlay, IconX,
} from "@tabler/icons-react";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import type { LayoutVariant } from "../../layout/variant.js";

/** The corner player's width (S198 AC 4): about a third of the screen on a phone, 400px wider up. */
function cornerWidth(variant: LayoutVariant): string
{
	return variant === "mobile" ? "33vw" : "400px";
}

/** The controls row under the clip, in px: 28px buttons with 4px above and below, and the 1px borders. */
const ROW = 38;
/** The corner's inset from the screen's edges, and its gap above a floating notice, in px. */
const INSET = 16;
const GAP = 12;

/**
 * The page-end room the corner needs (`CornerSpace`): its height (the 16:9 clip and the controls row)
 * plus its inset and a gap, so the page's last pixel scrolls up clear of it.
 */
export function cornerSpace(variant: LayoutVariant): string
{
	return `calc(${cornerWidth(variant)} * 9 / 16 + ${ROW + INSET + GAP}px)`;
}

/**
 * The class a box fixed at the screen's bottom right carries (the update notice, shell-scoreboard A6,
 * `NoticeSlot`; the after-update notice, A17, `UpdatedNotice`), so the corner player sits above it.
 */
export const BOTTOM_FLOAT = "bt-bottom-float";

/**
 * How far up the corner sits, in px from the screen's bottom: above every `BOTTOM_FLOAT` box showing,
 * with a gap, or 0 (its own inset) when none shows.
 */
function liftAboveFloats(): number
{
	let clear = 0;
	for (const float of document.querySelectorAll<HTMLElement>(`.${BOTTOM_FLOAT}`))
	{
		const box = float.getBoundingClientRect();
		if (box.height > 0) clear = Math.max(clear, window.innerHeight - box.top);
	}
	return clear > 0 ? clear + GAP : 0;
}

/**
 * The corner mini-player (S198; YouTube's mini-player, owner, 2026-11-25): fixed at the bottom
 * right, a third of the width on a phone and 400px wider up (AC 4), holding the provider's one player
 * (`PlayerProvider` moves its holder into `slot`), drawn compact: the clip alone, without the browser's
 * controls, title, tools or disclaimer. Under it: play / pause, expand (to the clip's own page, where
 * the full player takes it back) and close (stops it). The clip's title is its accessible name, and
 * shows beside the controls where there is room (medium and desktop).
 *
 * It is always mounted, hidden while it holds nothing, so a host unmounting mid-commit always has
 * somewhere to hand a playing clip. It sits above the update notice and the after-update notice
 * (`BOTTOM_FLOAT`), re-measured as boxes come and go and the window resizes, and the shell leaves
 * room after the footer (`CornerSpace`) so the footer's Live strip scrolls clear of it. Its z-index
 * matches the notices' (150): above the page, below Mantine's modals and drawers (200).
 */
export function CornerPlayer({
	shown, title, slot, holder, variant, onExpand, onClose,
}: { shown: boolean;
	title: string;
	slot: RefObject<HTMLDivElement | null>;
	/** The provider's holder node, whose `<video>` the play / pause control drives. */
	holder: HTMLElement;
	variant: LayoutVariant;
	onExpand: () => void;
	onClose: () => void; })
{
	const [playing, setPlaying] = useState(false);
	const [lift, setLift] = useState(0);
	useEffect(() =>
	{
		if (!shown) return;
		const read = () =>
		{
			const video = holder.querySelector("video");
			setPlaying(video != null && !video.paused);
		};
		read();
		// `play` and `pause` don't bubble: a capturing listener on the holder still hears them.
		holder.addEventListener("play", read, true);
		holder.addEventListener("pause", read, true);
		return () =>
		{
			holder.removeEventListener("play", read, true);
			holder.removeEventListener("pause", read, true);
		};
	}, [shown, holder]);
	useEffect(() =>
	{
		if (!shown) return;
		const measure = () => setLift(liftAboveFloats());
		measure();
		const observer = new MutationObserver(measure);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});
		window.addEventListener("resize", measure);
		return () =>
		{
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [shown]);
	const toggle = () =>
	{
		const video = holder.querySelector("video");
		if (video?.paused === false) video.pause();
		else void video?.play()?.catch(() => undefined);
	};
	return (
		<Box
			component="section"
			aria-label={shown ? title : undefined}
			data-testid="corner-player"
			hidden={!shown}
			style={{
				position: "fixed",
				right: INSET,
				bottom: lift > 0 ? lift : `calc(${INSET}px + env(safe-area-inset-bottom, 0px))`,
				zIndex: 150,
				width: cornerWidth(variant),
				background: "var(--bt-raised)",
				border: "1px solid var(--bt-hairline)",
				borderRadius: 8,
				overflow: "hidden",
				boxShadow: "var(--mantine-shadow-md)",
				display: shown ? "block" : "none",
			}}
		>
			<div ref={slot} />
			<Group gap={4} wrap="nowrap" px={4} py={4} justify="flex-end">
				{variant === "mobile" ? null : (
					<Text size="xs" fw={500} truncate="end" style={{
						flex: 1,
						minWidth: 0,
					}}
					>
						{title}
					</Text>
				)}
				<ActionIcon variant="subtle" color="gray" size={28} c="var(--bt-light)" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
					{playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
				</ActionIcon>
				<ActionIcon variant="subtle" color="gray" size={28} c="var(--bt-light)" aria-label="Expand mini player" onClick={onExpand}>
					<IconArrowsDiagonal size={16} />
				</ActionIcon>
				<ActionIcon variant="subtle" color="gray" size={28} c="var(--bt-light)" aria-label="Close mini player" onClick={onClose}>
					<IconX size={16} />
				</ActionIcon>
			</Group>
		</Box>
	);
}
