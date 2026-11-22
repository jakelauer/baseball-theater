import {
	Box, Group, Text,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";

/**
 * The page's connection marker (S148; shell-scoreboard A13 `live-marker`): a red dot
 * (`Primary Light`) with a red glow, and "Live Data · Active" beside it. It says the page's
 * live WebSocket is open, so updates are arriving; it is not the game's in-progress marker,
 * which is `LiveIndicator`'s green "LIVE" (colour, words, speed and meaning all differ, so
 * that component isn't extended). The dot blinks slowly between A13's `Phase=Bright` and
 * `Phase=Dim` (`bt-live-marker`, `styles.css`); under `prefers-reduced-motion` it holds at
 * `Phase=Bright`, still glowing — an accessibility preference, not a viewport read. The dot
 * is decoration (`aria-hidden`); the words are what a screen reader announces.
 */
export function LiveMarker()
{
	const reduceMotion = useReducedMotion();
	return (
		<Group gap={6} wrap="nowrap" justify="center" data-testid="live-marker">
			<Box
				w={8}
				h={8}
				bg="var(--bt-primary-light)"
				data-testid="live-marker-dot"
				style={{
					borderRadius: "50%",
					boxShadow: "0 0 8px var(--bt-primary-light)",
					animation: reduceMotion ? "none" : "bt-live-marker 2s ease-in-out infinite",
				}}
				aria-hidden
			/>
			<Text fz={11} fw={500} c="var(--bt-light)" lh={1}>
				Live Data · Active
			</Text>
		</Group>
	);
}
