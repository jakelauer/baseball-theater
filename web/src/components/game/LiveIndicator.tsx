import {
	Box, Group, Text,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import type { GameStatusMarkerKind } from "@bt/domain";

/** Where the marker is drawn (game-shell A7's `Place`): the game top bar, or a scoreboard game row. */
export type MarkerPlace = "topbar" | "row";

const WORD: Record<Exclude<GameStatusMarkerKind, "live">, string> = {
	delayed: "Delayed",
	delayedStart: "Delayed start",
	suspended: "Suspended",
};

/**
 * The marker's words, as A7 writes them, joined by a middle dot (U+00B7). In the top bar `LIVE`,
 * literal capitals, and the others in sentence case with MLB's reason ("Delayed · Rain"; owner,
 * 2026-11-22: "Sentence case for all three (Recommended)"). On a row a live game reads its inning
 * ("Bot 7", or `LIVE` with none yet), a delayed one keeps its inning ("Delayed · Bot 3", plain
 * "Delayed" with none), and a delayed start or a suspension names the reason, as in the top bar.
 */
function markerLabel(kind: GameStatusMarkerKind, place: MarkerPlace, reason: string | undefined, inning: string | null | undefined): string
{
	if (kind === "live") return place === "row" ? inning ?? "LIVE" : "LIVE";
	const detail = kind === "delayed" && place === "row" ? inning : reason;
	return detail ? `${WORD[kind]} · ${detail}` : WORD[kind];
}

/**
 * The game status marker (game-shell A7, S157; S170): the one dot and label that say a game's
 * state, in the game top bar (`place="topbar"`) and at the top-left of a scoreboard row
 * (`place="row"`). Kept under its old name with a `kind` prop rather than renamed, so the
 * live indicator it always was (S60, S66) is now its `live` kind; the kind comes from
 * `gameStatusMarker` (`packages/domain`), which callers ask, and this only draws it.
 * `live` is the `Accent 2` dot, blinking (`bt-blink`), held still under
 * `prefers-reduced-motion` (VISUAL-DESIGN §7, an accessibility preference, not a viewport
 * read); `delayed` and `delayedStart` a steady `Accent` dot and `suspended` a steady `Accent`
 * ring, since nothing is happening (A7 Motion). No CSS case change: every label is written as
 * it shows, so `LIVE` is literal capitals and the rest stay sentence case. The dot is
 * decoration; the words are the marker. The page's connection marker, the footer's red "Live
 * Data · Active" saying pushes are arriving, is `LiveMarker` (`web/src/layout/`, S148), a
 * different component that A7 leaves unchanged.
 */
export function LiveIndicator({
	kind = "live", place = "topbar", reason, inning,
}: {
	kind?: GameStatusMarkerKind;
	place?: MarkerPlace;
	/** MLB's reason (`Rain`), shown by the stopped kinds; never by `live`. */
	reason?: string;
	/** The row's short inning (`inningShortLabel`), read by `live` and `delayed` on a row. */
	inning?: string | null;
})
{
	const reduceMotion = useReducedMotion();
	const live = kind === "live";
	const color = live ? "var(--bt-accent-2)" : "var(--bt-accent)";
	return (
		<Group gap={6} wrap="nowrap" data-testid="status-marker" data-kind={kind}>
			<Box
				w={8}
				h={8}
				data-testid="status-marker-dot"
				style={{
					flexShrink: 0,
					borderRadius: "50%",
					boxSizing: "border-box",
					background: kind === "suspended" ? "transparent" : color,
					border: kind === "suspended" ? `2px solid ${color}` : undefined,
					animation: live && !reduceMotion ? "bt-blink 1.2s ease-in-out infinite" : "none",
				}}
				aria-hidden
			/>
			<Text size="xs" fw={700} c={color} style={{
				whiteSpace: "nowrap",
			}}
			>
				{markerLabel(kind, place, reason, inning)}
			</Text>
		</Group>
	);
}
