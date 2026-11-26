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
 * MLB's labels the Box room writes out (B433, #433; owner, 2026-11-23: "You also have attendance
 * like shortened to ATT and time shortened to T. Those should just be the full label."). Every other
 * label shows as MLB sent it.
 */
const WRITTEN_OUT_LABELS: Readonly<Record<string, string>> = {
	T: "Time",
	Att: "Attendance",
};

/**
 * An MLB box score value as the Box room shows it: without MLB's closing period (`loanDepot park.`).
 * A value ending in a name's `Jr.` or `Sr.` keeps it (`GIDP: Guerrero Jr.`), since there MLB's period
 * is the abbreviation's own. Trailing spaces go first (MLB's Umpires line ends `Brennan Miller. `).
 */
export function infoValue(value: string): string
{
	const trimmed = value.trimEnd();
	return /\b[JS]r\.$/.test(trimmed) ? trimmed : trimmed.replace(/\.$/, "");
}

/**
 * MLB's boxscore info lines as the Box room shows them (S207): every line MLB sent, in MLB's
 * order, as the live baseball.theater lists them (HBP, Pitches-strikes, Umpires … Venue, then the
 * game's date, a line with no value), each under its written-out label (`WRITTEN_OUT_LABELS`) and
 * without MLB's closing period (`infoValue`). Before S207 it kept only the six lines the Box frames
 * drew, in their order.
 */
export function gameInfoLines(info: readonly { label: string;
	value: string; }[]): { label: string;
	value: string; }[]
{
	return info.map((line) => ({
		label: WRITTEN_OUT_LABELS[line.label] ?? line.label,
		value: infoValue(line.value),
	}));
}

/**
 * The box score detail and Game info lines that carry runs (S207 AC 5): the runs batted in, the
 * team's hits with runners in scoring position, and the runners a reliever let score. Hide Scores
 * masks their values; every other line (doubles, stolen bases, the umpires) shows as it is.
 */
const RUNS_BEARING_LINES: ReadonlySet<string> = new Set(["RBI", "2-out RBI", "Team RISP", "Inherited runners-scored"]);

/** Whether Hide Scores masks a detail or Game info line with MLB's `label` (S207 AC 5). */
export function isRunsBearingLine(label: string): boolean
{
	return RUNS_BEARING_LINES.has(label);
}

/**
 * A batter's name in the Box room's batting table (S207), as the live baseball.theater prints it:
 * MLB's last name and every position he played, `Crow-Armstrong (CF)`, `Shaw (PH-DH)`. A game stored
 * before S207 has neither, so it falls back to `P. Crow-Armstrong (CF)` from the full name and the one
 * position it kept.
 */
export function batterLabel(batter: { fullName: string;
	position: string;
	lastName?: string;
	positions?: string[]; }): string
{
	const name = batter.lastName ?? shortPlayerName(batter.fullName);
	const positions = batter.positions?.length ? batter.positions.join("-") : batter.position;
	return positions ? `${name} (${positions})` : name;
}
