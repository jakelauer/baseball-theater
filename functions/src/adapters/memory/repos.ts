import type {
	AccountSettings, Entitlements, GameProjection, GameRecheckCandidate, GameSnapshot, GameStateFields, GameStateRow, PatronTier, ScheduleDayTally, ScheduleMonthCheck,
	StoredScheduleDay, UserProfile,
} from "@bt/domain";
import {
	contentHash, downloadExpired, entitlementsForTier, GAME_RECHECK_CLAIM_LEASE_MS, PERSON_ID_MAX,
	SCHEDULE_MONTH_CLAIM_LEASE_MS, SCHEDULE_MONTH_REFRESH_INTERVAL_MS, scheduleDayTally,
} from "@bt/domain";
import type {
	DataDownload,
	ExportStore,
	GameProjectionRepository,
	GameRepository,
	GameStateRepository,
	ReplayArtifact,
	ReplayArtifactRepository,
	DeletionLog,
	DeletionLogEntry,
	MailMessage,
	Mailer,
	OwedEdgePurge,
	OwedEdgePurgeRepository,
	PlayerIdRepository,
	PlayerIdRow,
	RegisterFileState,
	RegisterFileWrite,
	ScheduleRepository,
	SettingsRepository,
	UserDataExport,
	UserRepository,
	VenueField,
	VenueFieldRepository,
} from "@bt/ports";

/** A JSON round-trip: what a Postgres `jsonb` column hands back, and never the caller's object. */
function jsonCopy<T>(value: T): T
{
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The behavior every in-memory test double shares, so they match the Postgres
 * adapter (S50) under the shared contract (S46): values are stored and read as
 * JSON copies (no aliasing — mutating a written or returned value never changes
 * the store), and a write applies only if its version is newer — the
 * `applyIfNewer` rule (ADR-022), over a version read by `versionOf` because a
 * projection carries it on its header.
 */
class VersionedMemoryStore<K, T>
{
	private readonly entries = new Map<K, T>();

	constructor(private readonly versionOf: (value: T) => number) {}

	get(key: K): T | null
	{
		const value = this.entries.get(key);
		return value === undefined ? null : jsonCopy(value);
	}

	/** Stores `value` if it is newer than what `key` holds; says whether it did (S216: an upsert reports a refusal). */
	put(key: K, value: T): boolean
	{
		const current = this.entries.get(key);
		if (current !== undefined && this.versionOf(value) <= this.versionOf(current)) return false;
		this.entries.set(key, jsonCopy(value));
		return true;
	}

	/** Stores each of `values` under `keyOf` as {@link put} does, the newest of one key's values only; returns the keys it took. */
	putMany(values: readonly T[], keyOf: (value: T) => K): K[]
	{
		const newest = new Map<K, T>();
		for (const value of values)
		{
			const held = newest.get(keyOf(value));
			if (held === undefined || this.versionOf(value) > this.versionOf(held)) newest.set(keyOf(value), value);
		}
		return [...newest].filter(([key, value]) => this.put(key, value)).map(([key]) => key);
	}

	values(): T[]
	{
		return [...this.entries.values()].map(jsonCopy);
	}

	clear(): void
	{
		this.entries.clear();
	}

	delete(key: K): void
	{
		this.entries.delete(key);
	}
}

/**
 * Schedule days in memory. It reads the games' state versions for `served_base` (S150 AC 6) from `gameStates`, the
 * game-state store beside it, as the Postgres statement reads `game_states`: required, so no double ever raises it by 0
 * for a game whose row it can't see.
 */
export class InMemoryScheduleRepository implements ScheduleRepository
{
	private readonly store = new VersionedMemoryStore<string, StoredScheduleDay>((d) => d.version);
	private readonly servedBases = new Map<string, number>();

	constructor(private readonly gameStates: InMemoryGameStateRepository) {}

	async getByDate(date: string): Promise<StoredScheduleDay | null>
	{
		return this.store.get(date);
	}

	async getWithServedBase(date: string): Promise<{ day: StoredScheduleDay;
		servedBase: number; } | null>
	{
		const day = this.store.get(date);
		return day ? {
			day,
			servedBase: this.servedBases.get(date) ?? 0,
		} : null;
	}

	/**
	 * The version-guarded write, and with it the `served_base` raise: the stored state versions of the games the stored
	 * day lists and `day` doesn't, read in the same synchronous step, as the Postgres statement reads them. Returns the
	 * `served_base` it left, or null when refused (S216).
	 */
	async upsert(day: StoredScheduleDay): Promise<number | null>
	{
		const before = this.store.get(day.date);
		if (before !== null && day.version <= before.version) return null;
		const listed = new Set(day.games.map((game) => game.gamePk));
		const raise = (before?.games ?? []).filter((game) => !listed.has(game.gamePk)).reduce((sum, game) => sum + this.gameStates.versionOf(game.gamePk), 0);
		this.store.put(day.date, day);
		const servedBase = (this.servedBases.get(day.date) ?? 0) + raise;
		this.servedBases.set(day.date, servedBase);
		return servedBase;
	}

	async listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>
	{
		return this.store.values()
			.filter((day) => day.date >= from && day.date <= to)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map(scheduleDayTally);
	}

	async listGameListings(gamePks: readonly number[], from: string, to: string): Promise<{ date: string;
		gamePk: number; }[]>
	{
		const wanted = new Set(gamePks);
		return this.store.values()
			.filter((day) => day.date >= from && day.date <= to)
			.flatMap((day) => [...new Set(day.games.map((game) => game.gamePk).filter((gamePk) => wanted.has(gamePk)))].map((gamePk) => ({
				date: day.date,
				gamePk,
			})))
			.sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);
	}

	/** Each month's record (S194), the Postgres adapter's `schedule_months` rows. */
	private readonly months = new Map<string, ScheduleMonthCheck>();

	async listScheduleMonthChecks(from: string, to: string): Promise<ScheduleMonthCheck[]>
	{
		return [...this.months.values()]
			.filter((check) => check.month >= from && check.month <= to)
			.sort((a, b) => a.month.localeCompare(b.month))
			.map(jsonCopy);
	}

	/** Moves `checkedAt` forward only, as the Postgres adapter's guarded update does. */
	async recordScheduleMonthCheck(month: string, checkedAt: string): Promise<void>
	{
		const stored = this.months.get(month);
		if (stored?.checkedAt && !(Date.parse(checkedAt) > Date.parse(stored.checkedAt))) return;
		this.months.set(month, {
			month,
			checkedAt,
			claimedAt: stored?.claimedAt ?? null,
		});
	}

	/**
	 * Takes the claim only when the month is still due (unchecked, or checked at least the refresh
	 * interval before `at`) and unclaimed or claimed at least the lease before, as the Postgres
	 * adapter's conditional write does.
	 */
	async claimScheduleMonth(month: string, at: string): Promise<boolean>
	{
		const stored = this.months.get(month);
		if (stored?.claimedAt && Date.parse(at) - Date.parse(stored.claimedAt) < SCHEDULE_MONTH_CLAIM_LEASE_MS) return false;
		if (stored?.checkedAt && Date.parse(at) - Date.parse(stored.checkedAt) < SCHEDULE_MONTH_REFRESH_INTERVAL_MS) return false;
		this.months.set(month, {
			month,
			checkedAt: stored?.checkedAt ?? null,
			claimedAt: at,
		});
		return true;
	}

	/** Moves the claim forward only, as the Postgres adapter's guarded update does. */
	async holdScheduleMonth(month: string, claimedAt: string): Promise<void>
	{
		const stored = this.months.get(month);
		if (stored?.claimedAt && !(Date.parse(claimedAt) > Date.parse(stored.claimedAt))) return;
		this.months.set(month, {
			month,
			checkedAt: stored?.checkedAt ?? null,
			claimedAt,
		});
	}

	clear(): void
	{
		this.store.clear();
		this.servedBases.clear();
		this.months.clear();
	}
}

/**
 * `game_states` in memory (S150 AC 3), under the same write rule as the Postgres adapter. A state is "the same" as the
 * stored one only when the whole of it is, `version` and `lastChangedAt` included, as jsonb `=` compares the document
 * (`contentHash` of each, independent of key order like jsonb).
 */
export class InMemoryGameStateRepository implements GameStateRepository
{
	private readonly rows = new Map<number, GameStateRow>();

	async getByPk(gamePk: number): Promise<GameStateRow | null>
	{
		const row = this.rows.get(gamePk);
		return row ? jsonCopy(row) : null;
	}

	async getMany(gamePks: readonly number[]): Promise<GameStateRow[]>
	{
		return gamePks.flatMap((gamePk) => this.rows.has(gamePk) ? [jsonCopy(this.rows.get(gamePk)!)] : []);
	}

	/** The stored state version of `gamePk`, 0 when it has no row (what `served_base` adds for it). */
	versionOf(gamePk: number): number
	{
		return this.rows.get(gamePk)?.state.version ?? 0;
	}

	async write(rows: readonly GameStateRow[]): Promise<number[]>
	{
		const taken: number[] = [];
		for (const row of rows)
		{
			const stored = this.rows.get(row.gamePk);
			const feedTime = [stored?.feedTime ?? null, row.feedTime].filter((t): t is string => t !== null).sort().at(-1) ?? null;
			const startTime = row.startTime ?? stored?.startTime ?? null;
			if (!stored || row.state.version > stored.state.version)
			{
				// S161: a newer version with a line replaces the stored one; one without keeps it (a line never clears), as the
				// Postgres write's COALESCE does. No line at all is left out, as Postgres reads a null column.
				const winProbability = row.winProbability ?? stored?.winProbability;
				const { winProbability: _incoming, ...rest } = row;
				this.rows.set(row.gamePk, jsonCopy({
					...rest,
					feedTime,
					startTime,
					...winProbability && {
						winProbability,
					},
				}));
			}
			else if (row.state.version === stored.state.version && contentHash(row.state) === contentHash(stored.state)
				&& row.feedTime !== null && row.feedTime > (stored.feedTime ?? ""))
			{
				// The same state polled later: only the accepted feed time and the source move.
				this.rows.set(row.gamePk, {
					...stored,
					source: row.source,
					feedTime,
					startTime,
				});
			}
			else continue;
			taken.push(row.gamePk);
		}
		return taken;
	}

	clear(): void
	{
		this.rows.clear();
	}
}

/** A memory schedule store and the game-state store it reads `served_base` raises from (S150), linked as one database. */
export function memoryScheduleStores(): { schedules: InMemoryScheduleRepository;
	gameStates: InMemoryGameStateRepository; }
{
	const gameStates = new InMemoryGameStateRepository();
	return {
		schedules: new InMemoryScheduleRepository(gameStates),
		gameStates,
	};
}

/**
 * Game snapshots in memory. Given the game-state store beside it (`gameStates`), its re-check read (S212 AC 5) serves
 * each game's status from its row, as the Postgres statement joins `game_states`; without one, from the snapshot.
 */
export class InMemoryGameRepository implements GameRepository
{
	private readonly store = new VersionedMemoryStore<number, GameSnapshot>((g) => g.version);
	/** Each game's re-check record (S212 AC 5), the Postgres adapter's `game_rechecks` rows. */
	private readonly rechecks = new Map<number, { checkedAt: string | null;
		claimedAt: string | null; }>();

	constructor(private readonly gameStates?: InMemoryGameStateRepository) {}

	async getByPk(gamePk: number): Promise<GameSnapshot | null>
	{
		return this.store.get(gamePk);
	}

	async upsert(game: GameSnapshot): Promise<void>
	{
		this.store.put(game.gamePk, game);
	}

	async getMany(gamePks: readonly number[]): Promise<GameSnapshot[]>
	{
		return [...new Set(gamePks)].flatMap((gamePk) => this.store.get(gamePk) ?? []);
	}

	async upsertMany(games: readonly GameSnapshot[]): Promise<number[]>
	{
		return this.store.putMany(games, (game) => game.gamePk);
	}

	async getStateFields(gamePks: readonly number[]): Promise<GameStateFields[]>
	{
		return gamePks.flatMap((gamePk) =>
		{
			const game = this.store.get(gamePk);
			const last = game?.plays.at(-1);
			return game ? [{
				gamePk,
				status: game.status,
				linescore: game.linescore,
				live: game.live,
				plays: last ? [{
					matchup: last.matchup,
				}] : [],
			}] : [];
		});
	}

	async listByDate(date: string): Promise<GameSnapshot[]>
	{
		return this.store.values().filter((g) => g.officialDate === date);
	}

	async listRecheckCandidates(from: string, to: string): Promise<GameRecheckCandidate[]>
	{
		const games = this.store.values().filter((g) => g.officialDate >= from && g.officialDate <= to).sort((a, b) => a.gamePk - b.gamePk);
		const rows = new Map((await this.gameStates?.getMany(games.map((g) => g.gamePk)) ?? []).map((row) => [row.gamePk, row]));
		return games.map((game) =>
		{
			const status = rows.get(game.gamePk)?.state.status ?? game.status;
			return {
				gamePk: game.gamePk,
				officialDate: game.officialDate,
				windowMode: game.windowMode,
				startTime: game.startTime ?? null,
				suspendedAt: game.suspendedAt ?? null,
				status: {
					codedGameState: status.codedGameState,
					detailedState: status.detailedState,
				},
				checkedAt: this.rechecks.get(game.gamePk)?.checkedAt ?? null,
				claimedAt: this.rechecks.get(game.gamePk)?.claimedAt ?? null,
			};
		});
	}

	/** Takes the claim only when the game is still due and unclaimed (or its claim has lapsed), as the Postgres adapter's conditional write does. */
	async claimGameRecheck(gamePk: number, at: string): Promise<boolean>
	{
		const stored = this.rechecks.get(gamePk);
		if (stored?.claimedAt && Date.parse(at) - Date.parse(stored.claimedAt) < GAME_RECHECK_CLAIM_LEASE_MS) return false;
		if (stored?.checkedAt && Date.parse(at) - Date.parse(stored.checkedAt) < SCHEDULE_MONTH_REFRESH_INTERVAL_MS) return false;
		this.rechecks.set(gamePk, {
			checkedAt: stored?.checkedAt ?? null,
			claimedAt: at,
		});
		return true;
	}

	/** Moves `checkedAt` forward only, as the Postgres adapter's guarded update does. */
	async recordGameRecheck(gamePk: number, checkedAt: string): Promise<void>
	{
		const stored = this.rechecks.get(gamePk);
		if (stored?.checkedAt && !(Date.parse(checkedAt) > Date.parse(stored.checkedAt))) return;
		this.rechecks.set(gamePk, {
			checkedAt,
			claimedAt: stored?.claimedAt ?? null,
		});
	}

	/** Moves the claim forward only, as the Postgres adapter's guarded update does. */
	async holdGameRecheck(gamePk: number, claimedAt: string): Promise<void>
	{
		const stored = this.rechecks.get(gamePk);
		if (stored?.claimedAt && !(Date.parse(claimedAt) > Date.parse(stored.claimedAt))) return;
		this.rechecks.set(gamePk, {
			checkedAt: stored?.checkedAt ?? null,
			claimedAt,
		});
	}

	clear(): void
	{
		this.store.clear();
		this.rechecks.clear();
	}
}

/** The purges BT still owes the edge, in memory (S212), under the Postgres adapter's rules (`owed_edge_purges`). */
export class InMemoryOwedEdgePurgeRepository implements OwedEdgePurgeRepository
{
	private readonly rows = new Map<string, OwedEdgePurge & { retryAt: string | null }>();
	/** The last version handed out: one counter for the store's life, as the Postgres adapter's sequence. */
	private lastVersion = 0;

	async owe(urls: readonly string[], at: string): Promise<void>
	{
		for (const url of new Set(urls))
		{
			this.rows.set(url, {
				url,
				owedAt: at,
				version: ++this.lastVersion,
				failures: 0,
				retryAt: null,
			});
		}
	}

	async listDue(at: string, limit: number): Promise<OwedEdgePurge[]>
	{
		return [...this.rows.values()]
			.filter((row) => row.retryAt === null || Date.parse(row.retryAt) <= Date.parse(at))
			.sort((a, b) => Date.parse(a.owedAt) - Date.parse(b.owedAt) || a.url.localeCompare(b.url))
			.slice(0, limit)
			.map(({ retryAt: _retryAt, ...owed }) => jsonCopy(owed));
	}

	async settle(purges: readonly Pick<OwedEdgePurge, "url" | "version">[]): Promise<void>
	{
		for (const purge of purges)
		{
			if (this.rows.get(purge.url)?.version === purge.version) this.rows.delete(purge.url);
		}
	}

	async defer(purges: readonly Pick<OwedEdgePurge, "url" | "version">[], retryAt: string): Promise<void>
	{
		for (const purge of purges)
		{
			const row = this.rows.get(purge.url);
			if (row?.version !== purge.version) continue;
			this.rows.set(purge.url, {
				...row,
				failures: row.failures + 1,
				retryAt,
			});
		}
	}
}

export class InMemoryGameProjectionRepository implements GameProjectionRepository
{
	private readonly store = new VersionedMemoryStore<number, GameProjection>((p) => p.header.version);

	async getByPk(gamePk: number): Promise<GameProjection | null>
	{
		return this.store.get(gamePk);
	}

	async upsert(projection: GameProjection): Promise<void>
	{
		this.store.put(projection.header.gamePk, projection);
	}

	async upsertMany(projections: readonly GameProjection[]): Promise<number[]>
	{
		return this.store.putMany(projections, (projection) => projection.header.gamePk);
	}

	clear(): void
	{
		this.store.clear();
	}
}

export class InMemoryReplayArtifactRepository implements ReplayArtifactRepository
{
	private readonly store = new VersionedMemoryStore<number, ReplayArtifact>((a) => a.version);

	async getByPk(gamePk: number): Promise<ReplayArtifact | null>
	{
		return this.store.get(gamePk);
	}

	async upsert(artifact: ReplayArtifact): Promise<void>
	{
		this.store.put(artifact.gamePk, artifact);
	}

	clear(): void
	{
		this.store.clear();
	}
}

/**
 * Each venue's field drawing (S105), versioned by when BT asked Savant (`fetchedAt`), newer only (ADR-022), and a kept
 * drawing never replaced by a later ask that got none, as the Postgres adapter's `setWhere` does.
 */
export class InMemoryVenueFieldRepository implements VenueFieldRepository
{
	private readonly store = new VersionedMemoryStore<number, VenueField>((field) => Date.parse(field.fetchedAt));

	async get(venueId: number): Promise<VenueField | null>
	{
		return this.store.get(venueId);
	}

	async upsert(field: VenueField): Promise<void>
	{
		if (field.svg === null && this.store.get(field.venueId)?.svg) return;
		this.store.put(field.venueId, field);
	}
}

/**
 * Users, their identity links (ADR-019) and staging's tier overrides (S215, kept apart from the
 * real entitlements), stored as JSON copies like the
 * other doubles. Users carry no version: a user record changes by explicit
 * edits (profile, Patreon sync), not by ingest re-deliveries, so last write wins.
 */
export class InMemoryUserRepository implements UserRepository
{
	private readonly byUid = new Map<string, UserProfile>();
	/** `"<provider>\u0000<subject>"` → uid; NUL can't occur in either part, so keys can't collide. */
	private readonly links = new Map<string, string>();
	/** Staging's tier overrides (S215), apart from `byUid`'s real entitlements. */
	private readonly tierOverrides = new Map<string, PatronTier>();

	async getByUid(uid: string): Promise<UserProfile | null>
	{
		const user = this.byUid.get(uid);
		// S209 AC 9: derived from the tier as the Postgres adapter derives it, whatever the stored copy held.
		return user === undefined ? null : {
			...jsonCopy(user),
			entitlements: {
				...jsonCopy(user.entitlements),
				statsProviderChoice: entitlementsForTier(user.entitlements.tier).statsProviderChoice,
			},
		};
	}

	async upsert(user: UserProfile): Promise<void>
	{
		this.byUid.set(user.uid, jsonCopy(user));
	}

	async setEntitlements(uid: string, entitlements: Entitlements): Promise<void>
	{
		const existing = this.byUid.get(uid);
		if (!existing) return;
		this.byUid.set(uid, {
			...existing,
			entitlements: jsonCopy(entitlements),
			updatedAt: new Date().toISOString(),
		});
	}

	async getTierOverride(uid: string): Promise<PatronTier | null>
	{
		return this.tierOverrides.get(uid) ?? null;
	}

	async setTierOverride(uid: string, tier: PatronTier | null): Promise<void>
	{
		// Only for an existing user, as Postgres's foreign key and setEntitlements have it.
		if (!this.byUid.has(uid)) return;
		if (tier === null) this.tierOverrides.delete(uid);
		else this.tierOverrides.set(uid, tier);
	}

	async linkIdentity(provider: string, subject: string, uid: string): Promise<void>
	{
		const key = `${provider}\u0000${subject}`;
		const linked = this.links.get(key);
		if (linked !== undefined && linked !== uid)
		{
			throw new Error(`${provider} account ${subject} is already linked to another user`);
		}
		this.links.set(key, uid);
	}

	async getByIdentity(provider: string, subject: string): Promise<string | null>
	{
		return this.links.get(`${provider}\u0000${subject}`) ?? null;
	}

	async exportFor(uid: string): Promise<UserDataExport | null>
	{
		const profile = await this.getByUid(uid);
		const identities = this.linkKeysFor(uid).map((key) =>
		{
			const [provider = "", subject = ""] = key.split("\u0000");
			return {
				provider,
				subject,
			};
		});
		const tierOverride = this.tierOverrides.get(uid);
		return profile === null && identities.length === 0 && tierOverride === undefined ? null : {
			profile,
			identities,
			...tierOverride !== undefined && {
				tierOverride,
			},
		};
	}

	async deleteFor(uid: string): Promise<void>
	{
		this.byUid.delete(uid);
		this.tierOverrides.delete(uid);
		for (const key of this.linkKeysFor(uid)) this.links.delete(key);
	}

	/** Every link key that resolves to `uid`. A scan is fine for a test double; Postgres indexes it (S50). */
	private linkKeysFor(uid: string): string[]
	{
		return [...this.links].filter(([, linked]) => linked === uid).map(([key]) => key);
	}
}

/**
 * The deletion log (ADR-028): uid and time only, kept after a deletion so a
 * restored backup can be cleaned again. Append-only; nothing here deletes from it.
 */
export class InMemoryDeletionLog implements DeletionLog
{
	private readonly entries: DeletionLogEntry[] = [];

	async record(entry: DeletionLogEntry): Promise<void>
	{
		this.entries.push(jsonCopy(entry));
	}

	async list(): Promise<DeletionLogEntry[]>
	{
		return jsonCopy(this.entries);
	}
}

/**
 * Data downloads in memory (ADR-028; R2 in production, with the Worker runtime).
 * Honours the 14-day expiry the bucket's lifecycle rule enforces: reads skip an
 * aged-out download, and each new download sweeps the ones aged out by then.
 */
export class InMemoryExportStore implements ExportStore
{
	private downloads: { record: DataDownload;
		file: unknown }[] = [];

	async put(download: DataDownload, file: unknown): Promise<void>
	{
		const now = new Date(download.createdAt);
		this.downloads = this.downloads.filter((d) => !downloadExpired(d.record.expiresAt, now));
		this.downloads.push({
			record: jsonCopy(download),
			file: jsonCopy(file),
		});
	}

	async list(uid: string, now: Date): Promise<DataDownload[]>
	{
		return this.downloads
			.filter((d) => d.record.uid === uid && !downloadExpired(d.record.expiresAt, now))
			.map((d) => jsonCopy(d.record));
	}

	async file(uid: string, id: string, now: Date): Promise<unknown>
	{
		const found = this.downloads.find((d) => d.record.id === id && d.record.uid === uid && !downloadExpired(d.record.expiresAt, now));
		return found ? jsonCopy(found.file) : null;
	}

	async exportFor(uid: string): Promise<DataDownload[] | null>
	{
		const records = this.downloads.filter((d) => d.record.uid === uid).map((d) => jsonCopy(d.record));
		return records.length > 0 ? records : null;
	}

	async deleteFor(uid: string): Promise<void>
	{
		this.downloads = this.downloads.filter((d) => d.record.uid !== uid);
	}
}

/**
 * The dev mailer (Cloudflare Email in production, with the Worker runtime):
 * sends nothing, keeps every message in {@link sent} for tests to read. Each
 * holds an address, so it is personal data deleted with the account.
 */
export class InMemoryMailer implements Mailer
{
	readonly sent: MailMessage[] = [];

	async send(message: MailMessage): Promise<void>
	{
		this.sent.push(jsonCopy(message));
	}

	async exportFor(uid: string): Promise<MailMessage[] | null>
	{
		const mine = this.sent.filter((m) => m.uid === uid).map((m) => jsonCopy(m));
		return mine.length > 0 ? mine : null;
	}

	async deleteFor(uid: string): Promise<void>
	{
		// In place: `sent` is a readonly reference tests hold.
		for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i]!.uid === uid) this.sent.splice(i, 1);
	}
}

/**
 * MLB's players and their outside ids (S209), the Postgres adapter's `player_ids` and `player_register_files`: each
 * register file's rows replaced at once, an unchanged row left as it was, and the same claim rule for a file's sync.
 */
export class InMemoryPlayerIdRepository implements PlayerIdRepository
{
	private readonly rows = new Map<number, PlayerIdRow & { registerFile: string }>();
	private readonly files = new Map<string, RegisterFileState>();

	async getMany(personIds: readonly number[]): Promise<PlayerIdRow[]>
	{
		const wanted = [...new Set(personIds)].filter((id) => Number.isInteger(id) && id > 0 && id <= PERSON_ID_MAX).sort((a, b) => a - b);
		return wanted.flatMap((id) =>
		{
			const row = this.rows.get(id);
			return row ? [{
				personId: row.personId,
				fangraphsId: row.fangraphsId,
				bbrefId: row.bbrefId,
			}] : [];
		});
	}

	async registerFiles(): Promise<RegisterFileState[]>
	{
		return [...this.files.values()].map((state) => ({
			...state,
		}));
	}

	async claimRegisterFile(file: string, at: string, dueBefore: string, retryBefore: string): Promise<boolean>
	{
		const state = this.files.get(file);
		if (state)
		{
			const due = state.syncedAt === null || Date.parse(state.syncedAt) < Date.parse(dueBefore);
			const resting = state.triedAt !== null && Date.parse(state.triedAt) >= Date.parse(retryBefore);
			if (!due || resting) return false;
		}
		this.files.set(file, {
			file,
			etag: state?.etag ?? null,
			syncedAt: state?.syncedAt ?? null,
			triedAt: at,
		});
		return true;
	}

	async markRegisterFileUnchanged(file: string, at: string): Promise<void>
	{
		const state = this.files.get(file);
		if (state) this.files.set(file, {
			...state,
			syncedAt: at,
		});
	}

	async replaceRegisterFile(file: string, rows: readonly PlayerIdRow[], etag: string | null, at: string): Promise<RegisterFileWrite>
	{
		const write: RegisterFileWrite = {
			inserted: 0,
			updated: 0,
			deleted: 0,
		};
		const kept = new Set<number>();
		// One row per person id, the last given, as the Postgres adapter does (the port's rule).
		const unique = new Map(rows.map((row) => [row.personId, row]));
		for (const row of unique.values())
		{
			if (row.personId <= 0 || row.personId > PERSON_ID_MAX) continue;
			kept.add(row.personId);
			const stored = this.rows.get(row.personId);
			if (stored && stored.fangraphsId === row.fangraphsId && stored.bbrefId === row.bbrefId && stored.registerFile === file) continue;
			if (stored) write.updated++;
			else write.inserted++;
			this.rows.set(row.personId, {
				personId: row.personId,
				fangraphsId: row.fangraphsId,
				bbrefId: row.bbrefId,
				registerFile: file,
			});
		}
		for (const [id, stored] of this.rows)
		{
			if (stored.registerFile !== file || kept.has(id)) continue;
			this.rows.delete(id);
			write.deleted++;
		}
		this.files.set(file, {
			file,
			etag,
			syncedAt: at,
			triedAt: at,
		});
		return write;
	}
}

/** Settings documents by uid (ADR-027), apply-if-newer on `version` like the other doubles. */
export class InMemorySettingsRepository implements SettingsRepository
{
	private readonly store = new VersionedMemoryStore<string, AccountSettings>((s) => s.version);

	async get(uid: string): Promise<AccountSettings | null>
	{
		return this.store.get(uid);
	}

	async upsert(uid: string, settings: AccountSettings): Promise<void>
	{
		this.store.put(uid, settings);
	}

	async exportFor(uid: string): Promise<AccountSettings | null>
	{
		return this.store.get(uid);
	}

	async deleteFor(uid: string): Promise<void>
	{
		this.store.delete(uid);
	}
}
