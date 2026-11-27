/**
 * Baseball Savant's pull for one game (S103 AC 5), the game's ingest object's own step after its live poll: ask Savant
 * (bounded by {@link SAVANT_LIMIT_MS}), merge each pitch's figures into the stored game by `playId`
 * (`mergeSavantPitches`: a newer pull only, a figure empty until it arrives, its first sighting logged beside the live
 * feed's time for the pitch), and write the game as its next version (ADR-022) only when a figure changed. It never runs
 * inside the live poll's fetch, so a slow or failing Savant never delays a pitch; a pull that fails or has nothing leaves
 * the stored game as it is (AC 6).
 */
import type {
	GameSnapshot, GameStateRow, SavantPitch,
} from "@bt/domain";
import {
	isPastFinishedGame, mergeSavantPitches, projectGame, stampVersion,
} from "@bt/domain";
import { purgeGameAndDayEdge } from "./edge-purge.js";
import { servedGame } from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import { unversionedGame, writeProjections } from "./ingest.js";
import { askWithinLimit } from "./player-of-the-game.js";

/**
 * How long one Savant pull may take before it counts as no answer: its answer is megabytes, and it runs after the live
 * poll has written and published, so it may take longer than the extras asked inside a poll, but stays well under the
 * live poll's interval.
 */
export const SAVANT_LIMIT_MS = 10_000;

/** A Savant write that changed the game: the stored snapshot, and the game's state row to serve it with. */
export type SavantWrite = { snapshot: GameSnapshot;
	row: GameStateRow | null; };

/** The live feed's end time for each pitch of the stored game, by `playId`: what each Savant arrival is read beside. */
function pitchEndTimes(game: GameSnapshot): Map<string, string>
{
	const times = new Map<string, string>();
	for (const atBat of game.plays)
	{
		for (const pitch of atBat.pitches)
		{
			if (pitch.endTime !== undefined && pitch.playId !== "") times.set(pitch.playId, pitch.endTime);
		}
	}
	return times;
}

/**
 * Pulls Savant for `gamePk` and stores what changed ({@link storeSavant}); null when Savant failed, ran past
 * {@link SAVANT_LIMIT_MS}, listed no pitch, or changed nothing. The clock (`deps.now`) is read once the answer is back,
 * so each figure's first sighting is when Savant's answer arrived, not when the poll that asked began.
 */
export async function pullSavant(
	deps: Pick<IngestDeps, "mlb" | "games" | "projections" | "gameStates" | "edgePurge" | "now">,
	gamePk: number,
	limitMs: number = SAVANT_LIMIT_MS,
): Promise<SavantWrite | null>
{
	const pulled = await askWithinLimit(() => deps.mlb.fetchSavantGameFeed(gamePk), limitMs);
	return pulled ? storeSavant(deps, gamePk, pulled, deps.now?.() ?? new Date()) : null;
}

/**
 * Merges `pulled` into the stored game and writes it as the next version, its projection with it; null when no game is
 * stored or nothing changed. `at` is when Savant's answer arrived: each newly seen figure's `arrivedAt`, and the write's
 * time. A newer stored version that refuses the write (another writer stored the game meanwhile) is
 * read and merged again, once; a second refusal is logged and dropped, never written over. A past, finished game's edge
 * copy is purged after the write, as the late playMetrics write does, since the edge may hold the game without them.
 */
export async function storeSavant(
	deps: Pick<IngestDeps, "games" | "projections" | "gameStates" | "edgePurge">,
	gamePk: number,
	pulled: readonly SavantPitch[],
	at: Date,
): Promise<SavantWrite | null>
{
	for (let attempt = 0; attempt < 2; attempt++)
	{
		const stored = await deps.games.getByPk(gamePk);
		if (!stored) return null;
		const { pitches, changed } = mergeSavantPitches(stored.savant, pulled, at.toISOString(), pitchEndTimes(stored));
		if (!changed) return null;
		const next = stampVersion<GameSnapshot>(stored, {
			...unversionedGame(stored),
			savant: pitches,
		}, at.toISOString());
		if ((await deps.games.upsertMany([next])).includes(gamePk))
		{
			await writeProjections(deps, [projectGame(next)]);
			const row = await deps.gameStates.getByPk(gamePk);
			if (isPastFinishedGame(servedGame(next, row, at), at)) await purgeGameAndDayEdge(deps, [next], at);
			return {
				snapshot: next,
				row,
			};
		}
	}
	console.warn(`savant: game ${gamePk} refused twice by newer stored versions; dropped`);
	return null;
}
