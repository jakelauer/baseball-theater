/**
 * The one-time fill of S161's win-probability line (AC 4): a game stored before S161 has play metrics but no line on
 * its `game_states` row, since only a feed write made after S161 works the line out. The migration that added the
 * column only adds it; this step, run by `migrateDatabaseAt` after migrating (every deploy, and `pnpm db:migrate`), gives
 * each such row its line with the domain's one function (`scoreboardWinProbability`, ADR-025).
 *
 * It picks only rows whose line is still null and whose stored game has a measured at-bat, so it is idempotent (a
 * second run finds nothing and writes nothing) and resumable (a run stopped part way leaves the rest null, and the next
 * run picks them up). It works in batches, in gamePk order: one read and one write per batch. A filled row gets a new
 * state `version` and `lastChangedAt`, as any change to the line does (ADR-022), so the served day's version rises.
 *
 * Its cost: the check reads the stored game of every row still without a line. After the first full run those are only
 * games with no measured at-bat (an older recording, the feed's metrics down, a game not yet played), since every feed
 * write since S161 sets its game's line; it writes none of them. A game with no stored snapshot isn't read at all.
 */
import type { GamePlayMetrics } from "@bt/domain";
import { scoreboardWinProbability } from "@bt/domain";
import { sql } from "drizzle-orm";
import type { PostgresDb } from "./repos.js";

/** Rows read and written per batch: a game's play metrics are a few KB, so a batch reads well under a megabyte of them. */
export const WIN_PROBABILITY_FILL_BATCH = 200;

/** How a fill runs: its batch size, and (tests) a stop after this many batches, as a deploy cut off part way. */
export type WinProbabilityFillOptions = {
	batchRows?: number;
	maxBatches?: number;
	now?: Date;
};

/** What a fill did: the rows it wrote and the batches it read. */
export type WinProbabilityFillResult = {
	filled: number;
	batches: number;
};

/**
 * Fills the line of every `game_states` row still without one whose stored game has a measured at-bat (see the module
 * comment). The line is worked out from the game's play metrics alone: `scoreboardWinProbability`'s values don't depend
 * on the plays, so the plays (most of a stored game) are never read. Each row is written only while its line is still
 * null and its version is the one read, so a feed write that lands in between wins and this one is dropped.
 */
export async function fillWinProbability(db: PostgresDb, options: WinProbabilityFillOptions = {}): Promise<WinProbabilityFillResult>
{
	const batchRows = options.batchRows ?? WIN_PROBABILITY_FILL_BATCH;
	const at = (options.now ?? new Date()).toISOString();
	let after = 0;
	let filled = 0;
	let batches = 0;
	while (options.maxBatches === undefined || batches < options.maxBatches)
	{
		const read = await db.execute(sql`SELECT s.game_pk, s.version, g.document->'playMetrics' AS metrics
			FROM game_states s JOIN games g ON g.game_pk = s.game_pk
			WHERE s.win_probability IS NULL AND s.game_pk > ${after}
			AND jsonb_path_exists(g.document, '$.playMetrics.atBats[*] ? (@.homeWinProbability != null)')
			ORDER BY s.game_pk
			LIMIT ${batchRows}`) as unknown as { rows: { game_pk: number | string;
			version: number | string;
			metrics: GamePlayMetrics; }[]; };
		batches++;
		const lines = read.rows.flatMap((row) =>
		{
			const line = scoreboardWinProbability({
				plays: [],
				playMetrics: row.metrics,
			});
			return line ? [{
				game_pk: Number(row.game_pk),
				version: Number(row.version),
				line,
			}] : [];
		});
		if (lines.length > 0)
		{
			const written = await db.execute(sql`UPDATE game_states s SET
					win_probability = v.line,
					version = s.version + 1,
					document = jsonb_set(jsonb_set(s.document, '{version}', to_jsonb(s.version + 1)), '{lastChangedAt}', to_jsonb(${at}::text))
				FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS v(game_pk integer, version integer, line jsonb)
				WHERE s.game_pk = v.game_pk AND s.version = v.version AND s.win_probability IS NULL
				RETURNING s.game_pk`) as unknown as { rows: unknown[] };
			filled += written.rows.length;
		}
		const last = read.rows.at(-1);
		if (!last || read.rows.length < batchRows) break;
		after = Number(last.game_pk);
	}
	return {
		filled,
		batches,
	};
}

/** Whether the database has S161's column yet (a test may migrate a folder without it; then there is nothing to fill). */
export async function hasWinProbabilityColumn(db: PostgresDb): Promise<boolean>
{
	const result = await db.execute(sql`SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'game_states' AND column_name = 'win_probability'`) as unknown as { rows: unknown[] };
	return result.rows.length > 0;
}
