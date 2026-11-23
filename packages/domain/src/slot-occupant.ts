/**
 * What the scoreboard's game-row slot shows (S67; shell-scoreboard `Modular Block`).
 * The owner decided (2026-10-19) that **Status** is the drawn per-phase mix — the
 * pitchers of record on a final, the count on a live game — and the default; before
 * first pitch it is no box at all (S171; A7, owner 2026-11-16: "Remove the box
 * entirely."; A16), since the probable pitchers sit in the row's body beside their
 * teams. **Room Menu** links into the game's rooms in any phase, a scheduled game
 * included (owner, 2026-11-19: "Keep the links, but continue to hide recap"). One
 * answer for the scoreboard (ADR-025); the view draws it.
 */
import type { GamePhase } from "./game-phase.js";
import type { GameRowSlot } from "./settings.js";
import type { ProbablePitcher } from "./types.js";

export type SlotOccupant = "pitchersOfRecord" | "count" | "roomMenu";

/** Status's occupant per phase; `null` before first pitch, where the row draws no box (S171). */
const STATUS: Readonly<Record<GamePhase, SlotOccupant | null>> = {
	final: "pitchersOfRecord",
	live: "count",
	pregame: null,
};

/** The occupant for the user's Game-Row Slot setting and the game's phase; `null` when the row draws no slot box. */
export function slotOccupant(setting: GameRowSlot, phase: GamePhase): SlotOccupant | null
{
	return setting === "status" ? STATUS[phase] : "roomMenu";
}

/**
 * A probable pitcher's season line as the scheduled row draws it under his name, `11-5, 3.12`
 * (W-L, ERA). Parts MLB didn't send are left out; `null` when it sent none.
 */
export function probableLine(pitcher: Pick<ProbablePitcher, "wins" | "losses" | "era">): string | null
{
	const record = pitcher.wins !== null && pitcher.losses !== null ? `${pitcher.wins}-${pitcher.losses}` : null;
	const parts = [record, pitcher.era].filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The count as the live slot writes it, `0-2, 2 out` — balls-strikes, then outs, as
 * shorthand text, not pips (owner, 2026-10-30: "BSO are just shorthand text as seen in
 * the design"). `null` until MLB sends a count.
 */
export function countShorthand(count: { balls: number | null;
	strikes: number | null;
	outs: number | null; }): string | null
{
	if (count.balls === null || count.strikes === null) return null;
	const pitchCount = `${count.balls}-${count.strikes}`;
	return count.outs === null ? pitchCount : `${pitchCount}, ${count.outs} out`;
}
