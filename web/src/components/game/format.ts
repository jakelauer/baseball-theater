import type { Room } from "@bt/domain";

/** `live` → `Live`: the tab label for a room. The rooms themselves come from `@bt/domain` (ADR-025). */
export function roomLabel(room: Room): string
{
	return room[0]!.toUpperCase() + room.slice(1);
}

/**
 * `Pete Crow-Armstrong` → `P. Crow-Armstrong`: the Box batting table's player name
 * (game-rooms Box frames, "G. Torres"). A one-word name is left as it is.
 */
export function shortPlayerName(fullName: string): string
{
	const [first, ...rest] = fullName.split(" ");
	return first && rest.length > 0 ? `${first[0]}. ${rest.join(" ")}` : fullName;
}

/**
 * A probable pitcher's name on the scheduled scoreboard row with the hand he throws
 * with, `J. Steele (L)` (shell-scoreboard A16, S171); just `J. Steele` when MLB sent no
 * hand (`null`) or the stored row predates the field (`undefined`). The one place the
 * `(L)` / `(R)` suffix is written.
 */
export function probableLabel(pitcher: { fullName: string;
	pitchHand?: string | null; }): string
{
	const name = shortPlayerName(pitcher.fullName);
	return pitcher.pitchHand ? `${name} (${pitcher.pitchHand})` : name;
}

/** The throwing hand in plain words for a screen reader; MLB's codes are `L` and `R`. */
const HAND_WORDS: Readonly<Record<string, string>> = {
	L: "left-handed",
	R: "right-handed",
};

/**
 * A probable pitcher as a screen reader hears him on the scheduled row, `M. Pérez,
 * left-handed`: the card's link names the game, which hides the visible
 * `probableLabel` text, so the label carries it in words (S171). No hand (or a code
 * other than `L` / `R`) leaves just the name.
 */
export function probableSpoken(pitcher: { fullName: string;
	pitchHand?: string | null; }): string
{
	const name = shortPlayerName(pitcher.fullName);
	const hand = pitcher.pitchHand ? HAND_WORDS[pitcher.pitchHand] : undefined;
	return hand ? `${name}, ${hand}` : name;
}

/**
 * The Game info lines the Box frames draw, in their order (game-rooms DESIGN, S33): MLB's
 * label, then the label shown. MLB's `T` and `Att` are written out (B433, #433; owner,
 * 2026-11-23: "You also have attendance like shortened to ATT and time shortened to T.
 * Those should just be the full label.").
 */
const GAME_INFO_LABELS = [
	["Venue", "Venue"],
	["First pitch", "First pitch"],
	["Weather", "Weather"],
	["Wind", "Wind"],
	["T", "Time"],
	["Att", "Attendance"],
] as const;

/**
 * MLB's boxscore info lines as the Box room shows them: the drawn lines in the drawn
 * order under their written-out labels, each value without MLB's closing period
 * (`loanDepot park.`).
 */
export function gameInfoLines(info: readonly { label: string;
	value: string; }[]): { label: string;
	value: string; }[]
{
	return GAME_INFO_LABELS.flatMap(([mlb, label]) =>
	{
		const line = info.find((l) => l.label === mlb);
		return line ? [{
			label,
			value: line.value.replace(/\.$/, ""),
		}] : [];
	});
}
