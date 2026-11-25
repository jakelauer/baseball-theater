/**
 * The Postgres adapter (ADR-018; S50): every repository port over Drizzle, held to the same
 * storage contract as the in-memory doubles (S46, `repos.contract.test.ts` here, on PGlite).
 * It takes any Drizzle Postgres database: tests hand it PGlite; the Worker will hand it a
 * driver over the `HYPERDRIVE` binding (`wrangler.jsonc`) when S51 composes the app on it.
 *
 * Every versioned write is one statement: insert, or on a key conflict update only when the
 * incoming version is newer (`WHERE excluded.version > <table>.version`), the `applyIfNewer`
 * rule (ADR-022) applied by the database, so a stale or duplicate write changes nothing even
 * when two writers race. JSONB documents come back as fresh objects, so nothing a caller
 * holds aliases the store.
 */
import type {
	AccountSettings, Entitlements, GameProjection, GameRecheckCandidate, GameSnapshot, GameStateFields, GameStateRow, GameStateSource, PatronTier, Role, ScheduleDayTally,
	ScheduleMonthCheck,
	StoredScheduleDay, UserProfile,
} from "@bt/domain";
import {
	dayRegularSeason, dayRegularSeasonTeamIds, distinctTeamIds, GAME_RECHECK_CLAIM_LEASE_MS, SCHEDULE_MONTH_CLAIM_LEASE_MS, SCHEDULE_MONTH_REFRESH_INTERVAL_MS, storedGameType,
} from "@bt/domain";
import type {
	DeletionLog,
	DeletionLogEntry,
	GameProjectionRepository,
	GameRepository,
	GameStateRepository,
	OwedEdgePurge,
	OwedEdgePurgeRepository,
	ReplayArtifact,
	ReplayArtifactRepository,
	ScheduleRepository,
	SettingsRepository,
	UserDataExport,
	UserRepository,
} from "@bt/ports";
import {
	and, asc, between, eq, inArray, sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
	accountSettings, deletionLog, entitlements, gameProjections, gameRechecks, games, gameStates, identityLinks, owedEdgePurges, replayArtifacts, scheduleDays, scheduleMonths,
	users,
} from "./schema.js";

/** Any Drizzle Postgres database: PGlite in tests, node-postgres behind Hyperdrive in the Worker (S51). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the schema type parameter differs per driver; the adapter only uses table objects
export type PostgresDb = PgDatabase<PgQueryResultHKT, any>;

/**
 * Writes a game snapshot if it is newer than the stored one; returns how many rows changed
 * (0 for a stale or duplicate write). The repository's `upsert`, exposed so a test can see
 * the database refuse a stale write (S50 AC 2).
 */
export async function upsertGame(db: PostgresDb, game: GameSnapshot): Promise<number>
{
	const changed = await db.insert(games).values({
		gamePk: game.gamePk,
		officialDate: game.officialDate,
		version: game.version,
		document: game,
	}).onConflictDoUpdate({
		target: games.gamePk,
		set: {
			officialDate: sql`excluded.official_date`,
			version: sql`excluded.version`,
			document: sql`excluded.document`,
		},
		setWhere: sql`excluded.version > ${games.version}`,
	}).returning({
		gamePk: games.gamePk,
	});
	return changed.length;
}

/**
 * How much a schedule day's `served_base` rises when an `INSERT … ON CONFLICT (date) DO UPDATE` replaces it (S150 AC 6):
 * the `game_states` versions, read in that statement, of the games the stored document lists and the incoming one
 * (`excluded`) doesn't, so the served version (the day's version plus `served_base` plus its games' state versions)
 * never falls when a game is dropped, and no state write between a read and this write can make it. The one
 * expression for it: the schedule repository's upsert and the baseball-data copy (`baseball-copy.ts`) both use it.
 */
export function servedBaseRaise(): SQL
{
	return sql`COALESCE((SELECT sum(s.version) FROM game_states s
		WHERE s.game_pk IN (SELECT (g->>'gamePk')::integer FROM jsonb_array_elements(schedule_days.document->'games') g)
		AND s.game_pk NOT IN (SELECT (g->>'gamePk')::integer FROM jsonb_array_elements(excluded.document->'games') g)), 0)`;
}

export class PostgresScheduleRepository implements ScheduleRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByDate(date: string): Promise<StoredScheduleDay | null>
	{
		return (await this.getWithServedBase(date))?.day ?? null;
	}

	async getWithServedBase(date: string): Promise<{ day: StoredScheduleDay;
		servedBase: number; } | null>
	{
		const [row] = await this.db.select({
			document: scheduleDays.document,
			servedBase: scheduleDays.servedBase,
		}).from(scheduleDays).where(eq(scheduleDays.date, date));
		return row ? {
			day: row.document,
			servedBase: Number(row.servedBase),
		} : null;
	}

	/**
	 * One statement: the version-guarded write and the `served_base` raise (`servedBaseRaise`, the dropped games' state
	 * versions read in this same statement) land together or not at all (S150 AC 6). A new day drops nothing. S216: the
	 * statement returns the `served_base` it left (`RETURNING`), and no row when the version guard refused it, so the
	 * caller answers from the day it formed with no read-back.
	 */
	async upsert(day: StoredScheduleDay): Promise<number | null>
	{
		const [stored] = await this.db.insert(scheduleDays).values({
			date: day.date,
			version: day.version,
			document: day,
		}).onConflictDoUpdate({
			target: scheduleDays.date,
			set: {
				version: sql`excluded.version`,
				servedBase: sql`${scheduleDays.servedBase} + ${servedBaseRaise()}`,
				document: sql`excluded.document`,
			},
			setWhere: sql`excluded.version > ${scheduleDays.version}`,
		}).returning({
			servedBase: scheduleDays.servedBase,
		});
		return stored ? Number(stored.servedBase) : null;
	}

	/**
	 * One query for the whole range, unpacking each stored document's games once (S191; a database
	 * review measured 34.8 ms against 22.2 ms for a year when each field unpacked it again): one
	 * `{ gameType, teamIds }` per game, in stored order, over `jsonb_array_elements`, plus the two
	 * stamps, so no document leaves the database. The game count, the teams (S136) and the types
	 * (S167) are then read from that list here, exactly as the memory adapter reads its stored days.
	 * The values arrive as stored: the driver parses the jsonb, so a number arrives as a JS number
	 * and a `null` or string ID as itself, and `distinctTeamIds` (shared with the memory adapter) is
	 * the one guard that drops any non-integer ID, de-duplicates and sorts. `->'gameType'` gives SQL
	 * `NULL` for a game without one, which `jsonb_build_object` keeps as a JSON `null` (a
	 * `jsonb_path_query_array` over `$.games[*].gameType` would drop it and turn a spring day with
	 * an untyped game into a typed one). `dayRegularSeason` and `dayRegularSeasonTeamIds`, shared
	 * too, turn the list into the day's answers.
	 */
	async listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>
	{
		const rows = await this.db.select({
			date: scheduleDays.date,
			games: sql<{ gameType: unknown;
				teamIds: unknown[]; }[]>`coalesce((select jsonb_agg(jsonb_build_object('gameType', game->'gameType', 'teamIds', jsonb_path_query_array(game, '$.teams.*.id')) order by ord) from jsonb_array_elements(${scheduleDays.document}->'games') with ordinality as g(game, ord)), '[]'::jsonb)`,
			fetchedAt: sql<string>`${scheduleDays.document}->>'fetchedAt'`,
			lastChangedAt: sql<string>`${scheduleDays.document}->>'lastChangedAt'`,
		}).from(scheduleDays).where(between(scheduleDays.date, from, to)).orderBy(asc(scheduleDays.date));
		return rows.map(({ games, ...row }) =>
		{
			// A stored type that isn't a string (hand-edited or older row) counts as no type (`storedGameType`).
			const gameTypes = games.map((game) => storedGameType(game.gameType));
			return {
				...row,
				gameCount: games.length,
				teamIds: distinctTeamIds(games.flatMap((game) => game.teamIds)),
				gameTypes,
				regularSeason: dayRegularSeason(gameTypes),
				regularSeasonTeamIds: dayRegularSeasonTeamIds(games),
			};
		});
	}

	/** One read of the months' records (S194), in month order. */
	async listScheduleMonthChecks(from: string, to: string): Promise<ScheduleMonthCheck[]>
	{
		return this.db.select({
			month: scheduleMonths.month,
			checkedAt: scheduleMonths.checkedAt,
			claimedAt: scheduleMonths.claimedAt,
		}).from(scheduleMonths).where(between(scheduleMonths.month, from, to)).orderBy(asc(scheduleMonths.month));
	}

	/**
	 * One statement: insert the month's record, or move its `checked_at` forward only, so the database
	 * keeps the later of two racing checks whatever order they land in (S194 AC 1).
	 */
	async recordScheduleMonthCheck(month: string, checkedAt: string): Promise<void>
	{
		await this.db.insert(scheduleMonths).values({
			month,
			checkedAt,
		}).onConflictDoUpdate({
			target: scheduleMonths.month,
			set: {
				checkedAt: sql`excluded.checked_at`,
			},
			setWhere: sql`${scheduleMonths.checkedAt} IS NULL OR excluded.checked_at::timestamptz > ${scheduleMonths.checkedAt}::timestamptz`,
		});
	}

	/**
	 * One conditional statement (S194 AC 1): insert the month claimed, or take an existing record's
	 * claim only when the month is still due (no `checked_at`, or one at least
	 * `SCHEDULE_MONTH_REFRESH_INTERVAL_MS` before `at`) and it has no claim or one at least
	 * `SCHEDULE_MONTH_CLAIM_LEASE_MS` older than `at`. A returned row means this caller holds the
	 * claim; two racing claimants can't both get one, since the second's update re-checks the first's
	 * committed claim, and a month another tick checked after this one's read is refused.
	 */
	async claimScheduleMonth(month: string, at: string): Promise<boolean>
	{
		const cutoff = new Date(Date.parse(at) - SCHEDULE_MONTH_CLAIM_LEASE_MS).toISOString();
		const dueBy = new Date(Date.parse(at) - SCHEDULE_MONTH_REFRESH_INTERVAL_MS).toISOString();
		const claimed = await this.db.insert(scheduleMonths).values({
			month,
			claimedAt: at,
		}).onConflictDoUpdate({
			target: scheduleMonths.month,
			set: {
				claimedAt: sql`excluded.claimed_at`,
			},
			setWhere: sql`(${scheduleMonths.claimedAt} IS NULL OR ${scheduleMonths.claimedAt}::timestamptz <= ${cutoff}::timestamptz)
				AND (${scheduleMonths.checkedAt} IS NULL OR ${scheduleMonths.checkedAt}::timestamptz <= ${dueBy}::timestamptz)`,
		}).returning({
			month: scheduleMonths.month,
		});
		return claimed.length > 0;
	}

	/** One statement: insert the month held, or move its `claimed_at` forward only (S194 review). */
	async holdScheduleMonth(month: string, claimedAt: string): Promise<void>
	{
		await this.db.insert(scheduleMonths).values({
			month,
			claimedAt,
		}).onConflictDoUpdate({
			target: scheduleMonths.month,
			set: {
				claimedAt: sql`excluded.claimed_at`,
			},
			setWhere: sql`${scheduleMonths.claimedAt} IS NULL OR excluded.claimed_at::timestamptz > ${scheduleMonths.claimedAt}::timestamptz`,
		});
	}

	/**
	 * One statement for every game asked for (S212 review), over the primary key's range, so only the range's days are
	 * scanned and each document's games are unpacked once (`jsonb_array_elements`), whatever the number of games.
	 */
	async listGameListings(gamePks: readonly number[], from: string, to: string): Promise<{ date: string;
		gamePk: number; }[]>
	{
		if (gamePks.length === 0) return [];
		const result = await this.db.execute(sql`SELECT DISTINCT d.date, (g->>'gamePk')::integer AS game_pk
			FROM ${scheduleDays} d, jsonb_array_elements(d.document->'games') g
			WHERE d.date BETWEEN ${from} AND ${to}
			AND (g->>'gamePk')::integer IN (${sql.join(gamePks.map((gamePk) => sql`${gamePk}::integer`), sql`, `)})
			ORDER BY d.date, game_pk`) as unknown as { rows: { date: string;
			game_pk: number | string; }[]; };
		return result.rows.map((row) => ({
			date: row.date,
			gamePk: Number(row.game_pk),
		}));
	}
}

/** A `game_states` row as the port hands it over. */
function gameStateRow(row: typeof gameStates.$inferSelect): GameStateRow
{
	return {
		gamePk: row.gamePk,
		source: row.source as GameStateSource,
		feedTime: row.feedTime,
		officialDate: row.officialDate,
		startTime: row.startTime,
		state: row.document,
	};
}

/**
 * `game_states` (S150 AC 3). The write is one statement for the whole batch, the port's rule applied by the database:
 * a row whose version is newer replaces the state, the source and the official date; one at the same version is taken
 * only when its document equals the stored one (jsonb `=`: the whole state, its `version` and `lastChangedAt`
 * included) and its feed time is newer (ISO instants, so they compare as text), and then only the accepted feed time
 * and the source move, never the document, so one version never stands for two states (ADR-022). The accepted feed
 * time only moves forward (`GREATEST` ignores a null) and a write with no first pitch keeps the stored one. The rows
 * are written in gamePk order, so two batches over the same games lock them in the same order.
 */
export class PostgresGameStateRepository implements GameStateRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByPk(gamePk: number): Promise<GameStateRow | null>
	{
		const [row] = await this.db.select().from(gameStates).where(eq(gameStates.gamePk, gamePk));
		return row ? gameStateRow(row) : null;
	}

	async getMany(gamePks: readonly number[]): Promise<GameStateRow[]>
	{
		if (gamePks.length === 0) return [];
		return (await this.db.select().from(gameStates).where(inArray(gameStates.gamePk, [...gamePks]))).map(gameStateRow);
	}

	async write(rows: readonly GameStateRow[]): Promise<number[]>
	{
		if (rows.length === 0) return [];
		const newer = sql`excluded.version > ${gameStates.version}`;
		const written = await this.db.insert(gameStates).values([...rows].sort((a, b) => a.gamePk - b.gamePk).map((row) => ({
			gamePk: row.gamePk,
			version: row.state.version,
			source: row.source,
			feedTime: row.feedTime,
			officialDate: row.officialDate,
			startTime: row.startTime,
			document: row.state,
		}))).onConflictDoUpdate({
			target: gameStates.gamePk,
			set: {
				version: sql`excluded.version`,
				source: sql`excluded.source`,
				feedTime: sql`GREATEST(${gameStates.feedTime}, excluded.feed_time)`,
				officialDate: sql`CASE WHEN ${newer} THEN excluded.official_date ELSE ${gameStates.officialDate} END`,
				startTime: sql`COALESCE(excluded.start_time, ${gameStates.startTime})`,
				document: sql`CASE WHEN ${newer} THEN excluded.document ELSE ${gameStates.document} END`,
			},
			setWhere: sql`${newer}
				OR (excluded.version = ${gameStates.version} AND excluded.document = ${gameStates.document}
					AND excluded.feed_time > COALESCE(${gameStates.feedTime}, ''))`,
		}).returning({
			gamePk: gameStates.gamePk,
		});
		return written.map((row) => row.gamePk);
	}
}

export class PostgresGameRepository implements GameRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByPk(gamePk: number): Promise<GameSnapshot | null>
	{
		const [row] = await this.db.select({
			document: games.document,
		}).from(games).where(eq(games.gamePk, gamePk));
		return row?.document ?? null;
	}

	async upsert(game: GameSnapshot): Promise<void>
	{
		await upsertGame(this.db, game);
	}

	/** One statement over the primary key (S216 AC 2): a day's games in one read. */
	async getMany(gamePks: readonly number[]): Promise<GameSnapshot[]>
	{
		if (gamePks.length === 0) return [];
		const rows = await this.db.select({
			document: games.document,
		}).from(games).where(inArray(games.gamePk, [...new Set(gamePks)]));
		return rows.map((row) => row.document);
	}

	/**
	 * One statement for the whole batch (S216 AC 2), `upsertGame`'s version guard applied per row by the database; the
	 * rows it took come back (`RETURNING`), so a row a newer stored version refused is left out. Written in gamePk order,
	 * one row per gamePk (its newest version: one statement can't write a row twice), so two batches over the same games
	 * lock them in the same order.
	 */
	async upsertMany(batch: readonly GameSnapshot[]): Promise<number[]>
	{
		const rows = newestByKey(batch, (game) => game.gamePk, (game) => game.version);
		if (rows.length === 0) return [];
		const taken = await this.db.insert(games).values(rows.map((game) => ({
			gamePk: game.gamePk,
			officialDate: game.officialDate,
			version: game.version,
			document: game,
		}))).onConflictDoUpdate({
			target: games.gamePk,
			set: {
				officialDate: sql`excluded.official_date`,
				version: sql`excluded.version`,
				document: sql`excluded.document`,
			},
			setWhere: sql`excluded.version > ${games.version}`,
		}).returning({
			gamePk: games.gamePk,
		});
		return taken.map((row) => row.gamePk);
	}

	/**
	 * Each document is read once (`jsonb_to_record`), not once per field, and only its status, linescore, live moment
	 * and last at-bat's matchup leave the database.
	 */
	async getStateFields(gamePks: readonly number[]): Promise<GameStateFields[]>
	{
		if (gamePks.length === 0) return [];
		const rows = await this.db.select({
			gamePk: games.gamePk,
			fields: sql<Omit<GameStateFields, "gamePk" | "plays"> & { matchup: GameStateFields["plays"][number]["matchup"] | null }>`(SELECT jsonb_build_object(
				'status', d.status, 'linescore', d.linescore, 'live', d.live, 'matchup', d.plays->-1->'matchup')
				FROM jsonb_to_record(${games.document}) AS d(status jsonb, linescore jsonb, live jsonb, plays jsonb))`,
		}).from(games).where(inArray(games.gamePk, [...gamePks])).orderBy(asc(games.gamePk));
		return rows.map(({ gamePk, fields }) => ({
			gamePk,
			status: fields.status,
			linescore: fields.linescore ?? null,
			live: fields.live ?? null,
			plays: fields.matchup ? [{
				matchup: fields.matchup,
			}] : [],
		}));
	}

	async listByDate(date: string): Promise<GameSnapshot[]>
	{
		const rows = await this.db.select({
			document: games.document,
		}).from(games).where(eq(games.officialDate, date)).orderBy(asc(games.gamePk));
		return rows.map((row) => row.document);
	}

	/**
	 * One statement (S212 AC 5): each game of the dates (by the indexed `official_date`), its `windowMode`, first pitch and
	 * suspension time (what `clockWindowMode` judges its window by), and its
	 * served status (the `game_states` row's, else the snapshot's) taken out of the documents, and its `game_rechecks`
	 * record, so a tick with no due game costs this one read.
	 */
	async listRecheckCandidates(from: string, to: string): Promise<GameRecheckCandidate[]>
	{
		const rows = await this.db.select({
			gamePk: games.gamePk,
			officialDate: games.officialDate,
			windowMode: sql<GameSnapshot["windowMode"]>`${games.document}->>'windowMode'`,
			startTime: sql<string | null>`${games.document}->>'startTime'`,
			suspendedAt: sql<string | null>`${games.document}->>'suspendedAt'`,
			status: sql<GameRecheckCandidate["status"]>`COALESCE(${gameStates.document}->'status', ${games.document}->'status')`,
			checkedAt: gameRechecks.checkedAt,
			claimedAt: gameRechecks.claimedAt,
		}).from(games)
			.leftJoin(gameStates, eq(gameStates.gamePk, games.gamePk))
			.leftJoin(gameRechecks, eq(gameRechecks.gamePk, games.gamePk))
			.where(between(games.officialDate, from, to))
			.orderBy(asc(games.gamePk));
		return rows.map((row) => ({
			gamePk: row.gamePk,
			officialDate: row.officialDate,
			windowMode: row.windowMode,
			startTime: row.startTime ?? null,
			suspendedAt: row.suspendedAt ?? null,
			status: {
				codedGameState: row.status.codedGameState,
				detailedState: row.status.detailedState,
			},
			checkedAt: row.checkedAt ?? null,
			claimedAt: row.claimedAt ?? null,
		}));
	}

	/**
	 * One conditional statement (S212 AC 5), as `claimScheduleMonth`: insert the game claimed, or take an existing
	 * record's claim only when the game is still due (no `checked_at`, or one at least
	 * `SCHEDULE_MONTH_REFRESH_INTERVAL_MS` before `at`) and has no claim or one at least `GAME_RECHECK_CLAIM_LEASE_MS`
	 * older than `at`; a returned row means this caller holds the claim.
	 */
	async claimGameRecheck(gamePk: number, at: string): Promise<boolean>
	{
		const cutoff = new Date(Date.parse(at) - GAME_RECHECK_CLAIM_LEASE_MS).toISOString();
		const dueBy = new Date(Date.parse(at) - SCHEDULE_MONTH_REFRESH_INTERVAL_MS).toISOString();
		const claimed = await this.db.insert(gameRechecks).values({
			gamePk,
			claimedAt: at,
		}).onConflictDoUpdate({
			target: gameRechecks.gamePk,
			set: {
				claimedAt: sql`excluded.claimed_at`,
			},
			setWhere: sql`(${gameRechecks.claimedAt} IS NULL OR ${gameRechecks.claimedAt}::timestamptz <= ${cutoff}::timestamptz)
				AND (${gameRechecks.checkedAt} IS NULL OR ${gameRechecks.checkedAt}::timestamptz <= ${dueBy}::timestamptz)`,
		}).returning({
			gamePk: gameRechecks.gamePk,
		});
		return claimed.length > 0;
	}

	/** One statement: insert the game's record, or move its `checked_at` forward only (S212 AC 5). */
	async recordGameRecheck(gamePk: number, checkedAt: string): Promise<void>
	{
		await this.db.insert(gameRechecks).values({
			gamePk,
			checkedAt,
		}).onConflictDoUpdate({
			target: gameRechecks.gamePk,
			set: {
				checkedAt: sql`excluded.checked_at`,
			},
			setWhere: sql`${gameRechecks.checkedAt} IS NULL OR excluded.checked_at::timestamptz > ${gameRechecks.checkedAt}::timestamptz`,
		});
	}

	/** One statement: insert the game held, or move its `claimed_at` forward only (as `holdScheduleMonth`). */
	async holdGameRecheck(gamePk: number, claimedAt: string): Promise<void>
	{
		await this.db.insert(gameRechecks).values({
			gamePk,
			claimedAt,
		}).onConflictDoUpdate({
			target: gameRechecks.gamePk,
			set: {
				claimedAt: sql`excluded.claimed_at`,
			},
			setWhere: sql`${gameRechecks.claimedAt} IS NULL OR excluded.claimed_at::timestamptz > ${gameRechecks.claimedAt}::timestamptz`,
		});
	}
}

/**
 * `owed_edge_purges` (S212): each write is one statement. An owe inserts the URLs or re-owes them (a new version from
 * the table's sequence, never reused, failures and retry time cleared); a settle or a deferral touches a row only while its version is the listed one, so a
 * URL owed again after the cron listed it is never dropped by that listing's settle.
 */
export class PostgresOwedEdgePurgeRepository implements OwedEdgePurgeRepository
{
	constructor(private readonly db: PostgresDb) {}

	async owe(urls: readonly string[], at: string): Promise<void>
	{
		const unique = [...new Set(urls)];
		if (unique.length === 0) return;
		// A new row takes its version from the column's default, the sequence; a re-owe takes the next one too.
		await this.db.insert(owedEdgePurges).values(unique.map((url) => ({
			url,
			owedAt: at,
		}))).onConflictDoUpdate({
			target: owedEdgePurges.url,
			set: {
				owedAt: sql`excluded.owed_at`,
				version: sql`nextval('owed_edge_purges_version_seq')`,
				failures: 0,
				retryAt: null,
			},
		});
	}

	async listDue(at: string, limit: number): Promise<OwedEdgePurge[]>
	{
		return this.db.select({
			url: owedEdgePurges.url,
			owedAt: owedEdgePurges.owedAt,
			version: owedEdgePurges.version,
			failures: owedEdgePurges.failures,
		}).from(owedEdgePurges)
			.where(sql`${owedEdgePurges.retryAt} IS NULL OR ${owedEdgePurges.retryAt}::timestamptz <= ${at}::timestamptz`)
			.orderBy(sql`${owedEdgePurges.owedAt}::timestamptz`, asc(owedEdgePurges.url))
			.limit(limit);
	}

	async settle(purges: readonly Pick<OwedEdgePurge, "url" | "version">[]): Promise<void>
	{
		if (purges.length === 0) return;
		await this.db.delete(owedEdgePurges).where(listedVersions(purges));
	}

	async defer(purges: readonly Pick<OwedEdgePurge, "url" | "version">[], retryAt: string): Promise<void>
	{
		if (purges.length === 0) return;
		await this.db.update(owedEdgePurges).set({
			failures: sql`${owedEdgePurges.failures} + 1`,
			retryAt,
		}).where(listedVersions(purges));
	}
}

/** The rows of `purges` still at their listed versions: `(url, version) IN (…)`. */
function listedVersions(purges: readonly Pick<OwedEdgePurge, "url" | "version">[]): SQL
{
	return sql`(${owedEdgePurges.url}, ${owedEdgePurges.version}) IN (${sql.join(purges.map((purge) => sql`(${purge.url}, ${purge.version}::bigint)`), sql`, `)})`;
}

export class PostgresGameProjectionRepository implements GameProjectionRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByPk(gamePk: number): Promise<GameProjection | null>
	{
		const [row] = await this.db.select({
			document: gameProjections.document,
		}).from(gameProjections).where(eq(gameProjections.gamePk, gamePk));
		return row?.document ?? null;
	}

	async upsert(projection: GameProjection): Promise<void>
	{
		await this.db.insert(gameProjections).values({
			gamePk: projection.header.gamePk,
			version: projection.header.version,
			document: projection,
		}).onConflictDoUpdate({
			target: gameProjections.gamePk,
			set: {
				version: sql`excluded.version`,
				document: sql`excluded.document`,
			},
			setWhere: sql`excluded.version > ${gameProjections.version}`,
		});
	}

	/** One statement for the whole batch (S216 AC 2), as {@link PostgresGameRepository.upsertMany}: the rows it took come back. */
	async upsertMany(batch: readonly GameProjection[]): Promise<number[]>
	{
		const rows = newestByKey(batch, (projection) => projection.header.gamePk, (projection) => projection.header.version);
		if (rows.length === 0) return [];
		const taken = await this.db.insert(gameProjections).values(rows.map((projection) => ({
			gamePk: projection.header.gamePk,
			version: projection.header.version,
			document: projection,
		}))).onConflictDoUpdate({
			target: gameProjections.gamePk,
			set: {
				version: sql`excluded.version`,
				document: sql`excluded.document`,
			},
			setWhere: sql`excluded.version > ${gameProjections.version}`,
		}).returning({
			gamePk: gameProjections.gamePk,
		});
		return taken.map((row) => row.gamePk);
	}
}

/** One value per key, the newest by `versionOf`, in key order: what a multi-row upsert writes (S216). */
function newestByKey<T>(values: readonly T[], keyOf: (value: T) => number, versionOf: (value: T) => number): T[]
{
	const newest = new Map<number, T>();
	for (const value of values)
	{
		const held = newest.get(keyOf(value));
		if (held === undefined || versionOf(value) > versionOf(held)) newest.set(keyOf(value), value);
	}
	return [...newest.values()].sort((a, b) => keyOf(a) - keyOf(b));
}

export class PostgresReplayArtifactRepository implements ReplayArtifactRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByPk(gamePk: number): Promise<ReplayArtifact | null>
	{
		const [row] = await this.db.select({
			document: replayArtifacts.document,
		}).from(replayArtifacts).where(eq(replayArtifacts.gamePk, gamePk));
		return row?.document ?? null;
	}

	async upsert(artifact: ReplayArtifact): Promise<void>
	{
		await this.db.insert(replayArtifacts).values({
			gamePk: artifact.gamePk,
			version: artifact.version,
			document: artifact,
		}).onConflictDoUpdate({
			target: replayArtifacts.gamePk,
			set: {
				version: sql`excluded.version`,
				document: sql`excluded.document`,
			},
			setWhere: sql`excluded.version > ${replayArtifacts.version}`,
		});
	}
}

/** The entitlements row for `uid`, as stored. */
function entitlementsRow(uid: string, value: Entitlements)
{
	return {
		uid,
		tier: value.tier,
		fasterLiveRefresh: value.fasterLiveRefresh,
		cloudSyncedSettings: value.cloudSyncedSettings,
		savantLinks: value.savantLinks,
	};
}

/**
 * Users, their entitlements and their identity links (ADR-019). Profiles carry no version:
 * an upsert replaces the profile, as the in-memory double does. A provider account links to
 * one uid; linking it to another throws.
 */
export class PostgresUserRepository implements UserRepository
{
	constructor(private readonly db: PostgresDb) {}

	async getByUid(uid: string): Promise<UserProfile | null>
	{
		const [row] = await this.db.select().from(users).innerJoin(entitlements, eq(entitlements.uid, users.uid)).where(eq(users.uid, uid));
		if (!row) return null;
		const { users: user, entitlements: granted } = row;
		return {
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			patreonUserId: user.patreonUserId,
			role: user.role as Role,
			entitlements: {
				tier: granted.tier as PatronTier,
				fasterLiveRefresh: granted.fasterLiveRefresh,
				cloudSyncedSettings: granted.cloudSyncedSettings,
				savantLinks: granted.savantLinks,
			},
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};
	}

	async upsert(user: UserProfile): Promise<void>
	{
		const profile = {
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			patreonUserId: user.patreonUserId,
			role: user.role,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};
		await this.db.insert(users).values(profile).onConflictDoUpdate({
			target: users.uid,
			set: profile,
		});
		const granted = entitlementsRow(user.uid, user.entitlements);
		await this.db.insert(entitlements).values(granted).onConflictDoUpdate({
			target: entitlements.uid,
			set: granted,
		});
	}

	async setEntitlements(uid: string, value: Entitlements): Promise<void>
	{
		const [existing] = await this.db.select({
			uid: users.uid,
		}).from(users).where(eq(users.uid, uid));
		if (!existing) return;
		const granted = entitlementsRow(uid, value);
		await this.db.insert(entitlements).values(granted).onConflictDoUpdate({
			target: entitlements.uid,
			set: granted,
		});
		await this.db.update(users).set({
			updatedAt: new Date().toISOString(),
		}).where(eq(users.uid, uid));
	}

	async linkIdentity(provider: string, subject: string, uid: string): Promise<void>
	{
		const linked = await this.getByIdentity(provider, subject);
		if (linked !== null && linked !== uid)
		{
			throw new Error(`${provider} account ${subject} is already linked to another user`);
		}
		await this.db.insert(identityLinks).values({
			provider,
			subject,
			uid,
		}).onConflictDoNothing();
	}

	async getByIdentity(provider: string, subject: string): Promise<string | null>
	{
		const [row] = await this.db.select({
			uid: identityLinks.uid,
		}).from(identityLinks).where(and(eq(identityLinks.provider, provider), eq(identityLinks.subject, subject)));
		return row?.uid ?? null;
	}

	async exportFor(uid: string): Promise<UserDataExport | null>
	{
		const profile = await this.getByUid(uid);
		const identities = await this.db.select({
			provider: identityLinks.provider,
			subject: identityLinks.subject,
		}).from(identityLinks).where(eq(identityLinks.uid, uid)).orderBy(asc(identityLinks.provider), asc(identityLinks.subject));
		return profile === null && identities.length === 0 ? null : {
			profile,
			identities,
		};
	}

	async deleteFor(uid: string): Promise<void>
	{
		await this.db.delete(identityLinks).where(eq(identityLinks.uid, uid));
		// Entitlements go with the user (ON DELETE CASCADE).
		await this.db.delete(users).where(eq(users.uid, uid));
	}
}

/** Account settings (ADR-027, S6): a newer version replaces the stored document. */
export class PostgresSettingsRepository implements SettingsRepository
{
	constructor(private readonly db: PostgresDb) {}

	async get(uid: string): Promise<AccountSettings | null>
	{
		const [row] = await this.db.select().from(accountSettings).where(eq(accountSettings.uid, uid));
		if (!row) return null;
		return {
			favoriteTeamIds: row.favoriteTeamIds,
			opensFirst: row.opensFirst,
			gameRowSlot: row.gameRowSlot,
			collapseNonFavorites: row.collapseNonFavorites,
			hideScores: row.hideScores,
			videoPlayer: row.videoPlayer,
			version: row.version,
		};
	}

	async upsert(uid: string, settings: AccountSettings): Promise<void>
	{
		const row = {
			uid,
			favoriteTeamIds: settings.favoriteTeamIds,
			opensFirst: settings.opensFirst,
			gameRowSlot: settings.gameRowSlot,
			collapseNonFavorites: settings.collapseNonFavorites,
			hideScores: settings.hideScores,
			videoPlayer: settings.videoPlayer,
			version: settings.version,
		};
		await this.db.insert(accountSettings).values(row).onConflictDoUpdate({
			target: accountSettings.uid,
			set: {
				favoriteTeamIds: sql`excluded.favorite_team_ids`,
				opensFirst: sql`excluded.opens_first`,
				gameRowSlot: sql`excluded.game_row_slot`,
				collapseNonFavorites: sql`excluded.collapse_non_favorites`,
				hideScores: sql`excluded.hide_scores`,
				videoPlayer: sql`excluded.video_player`,
				version: sql`excluded.version`,
			},
			setWhere: sql`excluded.version > ${accountSettings.version}`,
		});
	}

	async exportFor(uid: string): Promise<AccountSettings | null>
	{
		return this.get(uid);
	}

	async deleteFor(uid: string): Promise<void>
	{
		await this.db.delete(accountSettings).where(eq(accountSettings.uid, uid));
	}
}

/** The deletion log (ADR-028): appended once per deletion, read in order for re-applying after a restore. */
export class PostgresDeletionLog implements DeletionLog
{
	constructor(private readonly db: PostgresDb) {}

	async record(entry: DeletionLogEntry): Promise<void>
	{
		await this.db.insert(deletionLog).values({
			uid: entry.uid,
			deletedAt: entry.deletedAt,
		});
	}

	async list(): Promise<DeletionLogEntry[]>
	{
		return this.db.select({
			uid: deletionLog.uid,
			deletedAt: deletionLog.deletedAt,
		}).from(deletionLog).orderBy(asc(deletionLog.id));
	}
}
