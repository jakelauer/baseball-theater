import type {
	AccountSettings, Entitlements, GameProjection, GameSnapshot, GameStateFields, GameStateRow, ScheduleDayTally, StoredScheduleDay, UserProfile,
} from "@bt/domain";
import {
	contentHash, downloadExpired, scheduleDayTally,
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
	ScheduleRepository,
	SettingsRepository,
	UserDataExport,
	UserRepository,
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

	put(key: K, value: T): void
	{
		const current = this.entries.get(key);
		if (current !== undefined && this.versionOf(value) <= this.versionOf(current)) return;
		this.entries.set(key, jsonCopy(value));
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
	 * day lists and `day` doesn't, read in the same synchronous step, as the Postgres statement reads them.
	 */
	async upsert(day: StoredScheduleDay): Promise<void>
	{
		const before = this.store.get(day.date);
		if (before !== null && day.version <= before.version) return;
		const listed = new Set(day.games.map((game) => game.gamePk));
		const raise = (before?.games ?? []).filter((game) => !listed.has(game.gamePk)).reduce((sum, game) => sum + this.gameStates.versionOf(game.gamePk), 0);
		this.store.put(day.date, day);
		this.servedBases.set(day.date, (this.servedBases.get(day.date) ?? 0) + raise);
	}

	async listGameCounts(from: string, to: string): Promise<ScheduleDayTally[]>
	{
		return this.store.values()
			.filter((day) => day.date >= from && day.date <= to)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map(scheduleDayTally);
	}

	clear(): void
	{
		this.store.clear();
		this.servedBases.clear();
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
				this.rows.set(row.gamePk, jsonCopy({
					...row,
					feedTime,
					startTime,
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

export class InMemoryGameRepository implements GameRepository
{
	private readonly store = new VersionedMemoryStore<number, GameSnapshot>((g) => g.version);

	async getByPk(gamePk: number): Promise<GameSnapshot | null>
	{
		return this.store.get(gamePk);
	}

	async upsert(game: GameSnapshot): Promise<void>
	{
		this.store.put(game.gamePk, game);
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

	clear(): void
	{
		this.store.clear();
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
 * Users and their identity links (ADR-019), stored as JSON copies like the
 * other doubles. Users carry no version: a user record changes by explicit
 * edits (profile, Patreon sync), not by ingest re-deliveries, so last write wins.
 */
export class InMemoryUserRepository implements UserRepository
{
	private readonly byUid = new Map<string, UserProfile>();
	/** `"<provider>\u0000<subject>"` → uid; NUL can't occur in either part, so keys can't collide. */
	private readonly links = new Map<string, string>();

	async getByUid(uid: string): Promise<UserProfile | null>
	{
		const user = this.byUid.get(uid);
		return user === undefined ? null : jsonCopy(user);
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
		return profile === null && identities.length === 0 ? null : {
			profile,
			identities,
		};
	}

	async deleteFor(uid: string): Promise<void>
	{
		this.byUid.delete(uid);
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
