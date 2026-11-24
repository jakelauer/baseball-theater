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
	AccountSettings, Entitlements, GameProjection, GameSnapshot, GameStateFields, GameStateRow, GameStateSource, PatronTier, Role, ScheduleDayTally, StoredScheduleDay,
	UserProfile,
} from "@bt/domain";
import {
	dayRegularSeason, distinctTeamIds, storedGameType,
} from "@bt/domain";
import type {
	DeletionLog,
	DeletionLogEntry,
	GameProjectionRepository,
	GameRepository,
	GameStateRepository,
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
	accountSettings, deletionLog, entitlements, gameProjections, games, gameStates, identityLinks, replayArtifacts, scheduleDays, users,
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
	 * versions read in this same statement) land together or not at all (S150 AC 6). A new day drops nothing.
	 */
	async upsert(day: StoredScheduleDay): Promise<void>
	{
		await this.db.insert(scheduleDays).values({
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
		});
	}

	/**
	 * One query for the whole range; the games are counted and their teams' IDs picked out in the
	 * database (S136), so no document leaves it. They come back as one jsonb array of every game's
	 * away and home ID, repeats and all, as stored: the driver parses it, so a number arrives as a
	 * JS number and a `null` or string ID as itself. `distinctTeamIds` (shared with the memory
	 * adapter) is the one guard: it drops any non-integer ID, de-duplicates and sorts. Each game's
	 * `gameType` (S167) comes back the same way, one entry per game: `->'gameType'` over
	 * `jsonb_array_elements` gives SQL `NULL` for a game without one, which `jsonb_agg` keeps as a
	 * JSON `null` (a `jsonb_path_query_array` over `$.games[*].gameType` would drop it and turn a
	 * spring day with an untyped game into a typed one). `dayRegularSeason`, shared with the memory
	 * adapter, turns the list into the day's answer.
	 */
	async listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>
	{
		const rows = await this.db.select({
			date: scheduleDays.date,
			gameCount: sql<number>`jsonb_array_length(${scheduleDays.document}->'games')`,
			teamIds: sql<unknown[]>`jsonb_path_query_array(${scheduleDays.document}, '$.games[*].teams.*.id')`,
			gameTypes: sql<unknown[]>`coalesce((select jsonb_agg(game->'gameType' order by ord) from jsonb_array_elements(${scheduleDays.document}->'games') with ordinality as g(game, ord)), '[]'::jsonb)`,
			fetchedAt: sql<string>`${scheduleDays.document}->>'fetchedAt'`,
			lastChangedAt: sql<string>`${scheduleDays.document}->>'lastChangedAt'`,
		}).from(scheduleDays).where(between(scheduleDays.date, from, to)).orderBy(asc(scheduleDays.date));
		// A driver may hand `jsonb_array_length`'s integer back as a string; the port promises a number.
		return rows.map((row) =>
		{
			// A stored type that isn't a string (hand-edited or older row) counts as no type (`storedGameType`).
			const gameTypes = row.gameTypes.map(storedGameType);
			return {
				...row,
				gameCount: Number(row.gameCount),
				teamIds: distinctTeamIds(row.teamIds),
				gameTypes,
				regularSeason: dayRegularSeason(gameTypes),
			};
		});
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
