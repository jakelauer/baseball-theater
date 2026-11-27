/**
 * Baseball Savant's per-pitch figures BT keeps (S103): only what MLB's own feeds lack, each figure with one source
 * (ADR-025), merged into the stored game pitch by pitch as Savant publishes them.
 *
 * Savant's feed says nothing about when it computed a figure, and it may publish one long after the live feed showed
 * the pitch (owner, 2026-10-30). So every figure is optional and empty until it arrives; BT records when it first saw
 * each one beside the live feed's own time for the pitch, so the real delay can be read once live games resume; and an
 * older pull never overwrites a newer one (ADR-022).
 */
import { isFinalStatus, isLiveStatus } from "./window.js";

/** The figures BT keeps from Savant, in one list so the merge, the arrival log and "not yet" all cover the same set. */
export const SAVANT_FIELDS = [
	"xba",
	"isBarrel",
	"x",
	"y",
	"homeRunBallparks",
	"batSpeed",
	"isSword",
	"savantInZone",
	"timesThroughOrder",
	"isAbsChallenge",
	"plateXPoly",
	"plateZPoly",
] as const;

/** One figure BT keeps from Savant. */
export type SavantField = (typeof SAVANT_FIELDS)[number];

/**
 * One pitch's Savant figures, joined to the live feed's pitch by `playId`. A figure Savant hasn't published (or never
 * will, such as `xba` on a pitch nobody hit) is absent: read it with {@link readSavantField}, which says "not yet"
 * rather than giving a zero.
 */
export type SavantPitch = {
	/** The live feed's `playId` for the pitch. */
	playId: string;
	/** The live feed's `atBatIndex` of the pitch's at-bat (Savant's own at-bat number is one higher). */
	atBatIndex: number;
	/**
	 * The pull that last changed this pitch: the time BT fetched it, in epoch milliseconds. A pull replaces a stored
	 * figure only when it is newer (ADR-022), so a slow pull that lands after a later one changes nothing.
	 */
	version: number;
	/** Expected batting average of the batted ball (0–1). */
	xba?: number;
	/** Whether Savant calls the batted ball a barrel. */
	isBarrel?: boolean;
	/** Spray position in feet from home plate, toward right field. */
	x?: number;
	/** Spray position in feet from home plate, toward center field. */
	y?: number;
	/** In how many of the 30 ballparks the batted ball would have been a home run. */
	homeRunBallparks?: number;
	/** Bat speed in mph, on a swing Savant tracked. */
	batSpeed?: number;
	/** A "sword": a swing Savant calls non-competitive. */
	isSword?: boolean;
	/** Savant's own in-zone call. */
	savantInZone?: boolean;
	/** How many times the pitcher had faced the batting order, this plate appearance included. */
	timesThroughOrder?: number;
	/** Whether this is the pitch an ABS challenge was made on. */
	isAbsChallenge?: boolean;
	/** Where the pitch crossed the front of the plate, in feet from its center (Savant's polynomial fit). */
	plateXPoly?: number;
	/** The height at which the pitch crossed the front of the plate, in feet. */
	plateZPoly?: number;
	/** When BT first saw each figure (ISO), one entry per figure that has arrived. */
	arrivedAt?: Partial<Record<SavantField, string>>;
	/** The live feed's end time for the pitch (its play event's `endTime`), beside which `arrivedAt` is read. */
	playEndTime?: string;
};

/** A Savant figure as a view reads it: arrived with its value, or not yet. */
export type SavantReading<F extends SavantField> = { arrived: true;
	value: NonNullable<SavantPitch[F]>; } | { arrived: false };

/**
 * A pitch's Savant figure for a view: `{ arrived: false }` while Savant hasn't published it (or there is no such pitch),
 * never a zero or a `false` standing in for it.
 */
export function readSavantField<F extends SavantField>(pitches: readonly SavantPitch[] | undefined, playId: string, field: F): SavantReading<F>
{
	const value = pitches?.find((pitch) => pitch.playId === playId)?.[field];
	return value === undefined ? {
		arrived: false,
	} : {
		arrived: true,
		value: value as NonNullable<SavantPitch[F]>,
	};
}

/**
 * Merges a Savant pull into the stored figures, pitch by pitch by `playId` (S103 AC 5):
 *
 * - a pulled pitch newer than the stored one (`version`) sets each figure it carries; a figure it lacks keeps the stored
 *   one, so a pull that drops a figure never clears it;
 * - a pulled pitch no newer than the stored one changes nothing;
 * - each figure's first sighting is logged in `arrivedAt` as `at`, and never moved after;
 * - the pitch's `playEndTime` is filled from `playEndTimes` (the live feed's time for each `playId`) once known.
 *
 * A pitch the pull doesn't carry stays as stored. `changed` says whether anything did, so the caller writes (and makes a
 * new game version) only then.
 */
export function mergeSavantPitches(
	stored: readonly SavantPitch[] | undefined,
	pulled: readonly SavantPitch[],
	at: string,
	playEndTimes: ReadonlyMap<string, string> = new Map(),
): { pitches: SavantPitch[];
	changed: boolean; }
{
	const merged = [...stored ?? []];
	const index = new Map(merged.map((pitch, i) => [pitch.playId, i]));
	let changed = false;
	for (const pull of pulled)
	{
		const i = index.get(pull.playId);
		const before = i === undefined ? undefined : merged[i];
		const next = mergePitch(before, pull, at, playEndTimes.get(pull.playId));
		if (next === before) continue;
		changed = true;
		if (i === undefined)
		{
			index.set(pull.playId, merged.length);
			merged.push(next);
		}
		else merged[i] = next;
	}
	return {
		pitches: merged,
		changed,
	};
}

/** One pitch of {@link mergeSavantPitches}: `before` itself when the pull changes nothing. */
function mergePitch(before: SavantPitch | undefined, pull: SavantPitch, at: string, playEndTime: string | undefined): SavantPitch
{
	const fillEndTime = before !== undefined && before.playEndTime === undefined && playEndTime !== undefined;
	if (before !== undefined && pull.version <= before.version)
	{
		return fillEndTime ? {
			...before,
			playEndTime,
		} : before;
	}
	const next: SavantPitch = {
		playId: pull.playId,
		atBatIndex: pull.atBatIndex,
		version: pull.version,
	};
	const arrivedAt: Partial<Record<SavantField, string>> = {
		...before?.arrivedAt,
	};
	let differs = before === undefined || before.atBatIndex !== pull.atBatIndex || fillEndTime;
	for (const field of SAVANT_FIELDS)
	{
		const value = pull[field] ?? before?.[field];
		if (value === undefined) continue;
		(next as Record<SavantField, unknown>)[field] = value;
		if (value !== before?.[field]) differs = true;
		arrivedAt[field] ??= at;
	}
	if (!differs) return before as SavantPitch;
	if (Object.keys(arrivedAt).length > 0) next.arrivedAt = arrivedAt;
	const endTime = before?.playEndTime ?? playEndTime;
	if (endTime !== undefined) next.playEndTime = endTime;
	return next;
}

/** What {@link savantPullDue} decides from: the game's status, its ingest window and the run's last pulls. */
export type SavantPullState = {
	codedGameState: string;
	/** Whether the game is still in its ingest window (`isGameInActiveWindow`): false on the run's last poll. */
	inWindow: boolean;
	/** When this run last pulled Savant (epoch ms); absent before its first pull. */
	lastPulledAt?: number;
	/** Whether this run has already made its one pull after the final. */
	finalPulled: boolean;
	now: number;
	/** At most one pull per this many milliseconds while the game is live (`CadenceParams.savantIntervalMs`). */
	intervalMs: number;
};

/**
 * Whether ingest should pull Savant on this poll (S103 AC 5): while the game is live and in its window, at most once per
 * `intervalMs`; once it is final, only once more, on the run's last poll (when it leaves its window, the trail's end), so
 * figures Savant publishes late still arrive; never before first pitch, or for a game that isn't live or final.
 */
export function savantPullDue(state: SavantPullState): boolean
{
	if (isFinalStatus(state.codedGameState)) return !state.inWindow && !state.finalPulled;
	if (!state.inWindow || !isLiveStatus(state.codedGameState)) return false;
	return state.lastPulledAt === undefined || state.now - state.lastPulledAt >= state.intervalMs;
}
