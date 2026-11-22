/**
 * The inning as a fan reads it (S3): `Top 6th`, `Bot 7th`, `Mid 3rd`, `End 9th`. One
 * label for the Live status and the scoreboard's live row (ADR-025); views render it.
 * The short forms are the ratified frames' (`Bot 7th · 1 Out`, game-rooms Live).
 */
import type { AtBat } from "./plays.js";
import type { LinescoreSummary } from "./types.js";

const HALF: Readonly<Record<string, string>> = {
	Top: "Top",
	Bottom: "Bot",
	Middle: "Mid",
	End: "End",
};

/** `1` → `1st`, `2` → `2nd`, `11` → `11th`, `23` → `23rd`. */
export function ordinal(n: number): string
{
	const teen = n % 100 >= 11 && n % 100 <= 13;
	const suffix = teen ? "th" : ({
		1: "st",
		2: "nd",
		3: "rd",
	} as Record<number, string>)[n % 10] ?? "th";
	return `${n}${suffix}`;
}

/**
 * The inning label, or `null` before the game has an inning. MLB's `inningState`
 * names the half (Top / Bottom / Middle / End); without it, `isTopInning` decides.
 */
export function inningLabel(linescore: Pick<LinescoreSummary, "currentInning" | "inningState" | "isTopInning"> | null): string | null
{
	if (!linescore?.currentInning) return null;
	const half = (linescore.inningState && HALF[linescore.inningState]) ?? (linescore.isTopInning === false ? "Bot" : "Top");
	return `${half} ${ordinal(linescore.currentInning)}`;
}

/** A half-inning as plain fields: an at-bat's `about`, or a Search result's route, which has no `AtBat`. */
export type HalfInning = Pick<AtBat["about"], "halfInning" | "inning">;

/**
 * A half-inning as the inning pill and the Plays room's scoring tag spell it, `Top 6` / `Bot 3` /
 * `Top 10`: the number, no ordinal (S145; game-shell A6, owner, 2026-11-19: "Don't use ordinals,
 * just numbers"). Takes plain fields so Search's rows, which have no `AtBat`, call it too; the one
 * spelling of a half-inning's short label (ADR-025). Replaces S97's at-bat label (`Top 6th`), and its test.
 */
export function halfInningLabel(half: HalfInning): string
{
	return `${half.halfInning === "top" ? "Top" : "Bot"} ${half.inning}`;
}

/**
 * The same half-inning spoken, `Top of 6th inning` / `Bottom of 3rd inning`: the inning pill's
 * accessible name after the "Open play" prefix `playInningLink` (web) adds (S145; the owner,
 * 2026-11-19, gave the pill's spoken name as "Open play", a hyphen, then "Top of 6th inning"). The
 * half is spelled out and the ordinal the visible label drops comes back, as the owner wrote "6th".
 */
export function halfInningName(half: HalfInning): string
{
	return `${half.halfInning === "top" ? "Top" : "Bottom"} of ${ordinal(half.inning)} inning`;
}
