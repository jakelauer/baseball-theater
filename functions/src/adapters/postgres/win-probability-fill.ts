/**
 * The one-time fill of S161's win-probability line (AC 4): a game stored before S161 has play metrics but no line on
 * its `game_states` row, since only a feed write made after S161 works the line out. The migration that added the
 * column only adds it; this step, run by `migrateDatabaseAt` after migrating (every deploy, and `pnpm db:migrate`), gives
 * each such row its line with the domain's one function (`scoreboardWinProbability`, ADR-025).
 *
 * It reads only rows never checked (`win_probability` SQL NULL) whose game has a stored snapshot, in batches in gamePk
 * order: one read and at most two writes a batch. A row with a measured at-bat gets its line and a new state `version`
 * and `lastChangedAt`, as any change to the line does (ADR-022), so the served day's version rises; a row without one is
 * marked checked with JSON `null` (no version change: what it serves is unchanged), which every reader takes as no
 * line and which a later write that brings no line keeps (the repositories' write rule). So each row's stored game is
 * read once, ever: the fill is idempotent (a second run reads nothing) and resumable (a run stopped part way leaves the
 * rest unchecked for the next).
 *
 * A filled game's past day may sit at the edge for S212's long lifetime without its line. The migrate step has no
 * purge credentials or app origin, so for each filled game whose official date is within that lifetime
 * (`PAST_EDGE_TTL_S`; an older copy has expired) it owes the purge of its edge paths (`gameEdgePaths`: its game URL
 * and every day that lists it) as paths alone; the Worker's cron sends them under its origin (`retryOwedEdgePurges`).
 */
import type { GamePlayMetrics } from "@bt/domain";
import { addDays, scoreboardWinProbability } from "@bt/domain";
import { sql } from "drizzle-orm";
import { PAST_EDGE_TTL_S } from "../../handlers/cache-control.js";
import { gameEdgePaths } from "../../services/edge-purge.js";
import type { PostgresDb } from "./repos.js";
import { PostgresOwedEdgePurgeRepository, PostgresScheduleRepository } from "./repos.js";

/** Rows read per batch: a game's play metrics are a few KB, so a batch reads well under a megabyte of them. */
export const WIN_PROBABILITY_FILL_BATCH = 200;

/** How a fill runs: its batch size, its clock, and (tests) a stop after this many batches, as a deploy cut off part way. */
export type WinProbabilityFillOptions = {
	batchRows?: number;
	maxBatches?: number;
	now?: Date;
};

/** What a fill did: the rows it read (`checked`), those it gave a line (`filled`), the batches, and the edge paths it owed. */
export type WinProbabilityFillResult = {
	checked: number;
	filled: number;
	batches: number;
	owed: number;
};

/**
 * Fills the line of every `game_states` row never checked whose game has a stored snapshot (see the module comment).
 * The line is worked out from the game's play metrics alone: `scoreboardWinProbability`'s values don't depend on the
 * plays, so the plays are never handed over. Each row is written only while it is still unchecked and (for a line) at
 * the version read, so a feed write that lands in between wins and this one is dropped.
 */
export async function fillWinProbability(db: PostgresDb, options: WinProbabilityFillOptions = {}): Promise<WinProbabilityFillResult>
{
	const batchRows = options.batchRows ?? WIN_PROBABILITY_FILL_BATCH;
	const now = options.now ?? new Date();
	const at = now.toISOString();
	// The oldest official date whose past day may still be at the edge without its line.
	const edgeFrom = addDays(at.slice(0, 10), -Math.ceil(PAST_EDGE_TTL_S / 86400));
	const result: WinProbabilityFillResult = {
		checked: 0,
		filled: 0,
		batches: 0,
		owed: 0,
	};
	let after = 0;
	while (options.maxBatches === undefined || result.batches < options.maxBatches)
	{
		const read = await db.execute(sql`SELECT s.game_pk, s.version, s.official_date, g.document->'playMetrics' AS metrics
			FROM game_states s JOIN games g ON g.game_pk = s.game_pk
			WHERE s.win_probability IS NULL AND s.game_pk > ${after}
			ORDER BY s.game_pk
			LIMIT ${batchRows}`) as unknown as { rows: { game_pk: number | string;
			version: number | string;
			official_date: string;
			metrics: GamePlayMetrics | null; }[]; };
		result.batches++;
		result.checked += read.rows.length;
		const lines = [];
		const none = [];
		for (const row of read.rows)
		{
			const line = row.metrics ? scoreboardWinProbability({
				plays: [],
				playMetrics: row.metrics,
			}) : null;
			if (line) lines.push({
				game_pk: Number(row.game_pk),
				version: Number(row.version),
				official_date: row.official_date,
				line,
			});
			else none.push(Number(row.game_pk));
		}
		if (none.length > 0)
		{
			await db.execute(sql`UPDATE game_states SET win_probability = 'null'::jsonb
				WHERE game_pk IN (${sql.join(none.map((pk) => sql`${pk}::integer`), sql`, `)}) AND win_probability IS NULL`);
		}
		if (lines.length > 0)
		{
			const written = await db.execute(sql`UPDATE game_states s SET
					win_probability = v.line,
					version = s.version + 1,
					document = jsonb_set(jsonb_set(s.document, '{version}', to_jsonb(s.version + 1)), '{lastChangedAt}', to_jsonb(${at}::text))
				FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS v(game_pk integer, version integer, line jsonb)
				WHERE s.game_pk = v.game_pk AND s.version = v.version AND s.win_probability IS NULL
				RETURNING s.game_pk`) as unknown as { rows: { game_pk: number | string }[] };
			const filled = new Set(written.rows.map((row) => Number(row.game_pk)));
			result.filled += filled.size;
			const recent = lines.filter((line) => filled.has(line.game_pk) && line.official_date >= edgeFrom).map((line) => ({
				gamePk: line.game_pk,
				officialDate: line.official_date,
			}));
			const paths = await gameEdgePaths(new PostgresScheduleRepository(db), recent);
			if (paths.length > 0)
			{
				await new PostgresOwedEdgePurgeRepository(db).owe(paths, at);
				result.owed += paths.length;
			}
		}
		const last = read.rows.at(-1);
		if (!last || read.rows.length < batchRows) break;
		after = Number(last.game_pk);
	}
	return result;
}
/** Whether the database has S161's column yet (a test may migrate a folder without it; then there is nothing to fill). */
export async function hasWinProbabilityColumn(db: PostgresDb): Promise<boolean>
{
	const result = await db.execute(sql`SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'game_states' AND column_name = 'win_probability'`) as unknown as { rows: unknown[] };
	return result.rows.length > 0;
}
