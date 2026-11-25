/**
 * The counting repository double of S216: it wraps a request's stores (the memory repositories, or any adapter) and
 * records each repository call as one database round trip, since on Workers each is one query on the request's one
 * `pg` connection, run one at a time. It also keeps, per row key (`day:<date>`, `game:<gamePk>`, `state:<gamePk>`,
 * `proj:<gamePk>`), what the request has read and written, so a test can fail on a read of a row the same request
 * wrote (a read-back) or a second read of a key it already read (a repeat): `violations` lists each one.
 *
 * `beforeWrite` runs before every write is passed on, so a test can seed another writer's version between a read and
 * a write (S216 AC 1's refused-write case).
 */
import type { IngestDeps } from "../services/ingest.js";

/** One repository call: which store, which method, the row keys it touched, and whether it read or wrote them. */
export type RoundTrip = {
	repo: string;
	method: string;
	kind: "read" | "write";
	keys: string[];
};

/** The stores a request touches, by the prefix their row keys carry. */
const PREFIX = {
	schedules: "day",
	games: "game",
	gameStates: "state",
	projections: "proj",
} as const;

type Repo = keyof typeof PREFIX;

/** The keys one call reads or writes; an empty list for a range read (a listing, a month), which reads no one row. */
function keysOf(repo: Repo, method: string, args: unknown[]): { kind: "read" | "write";
	keys: string[]; }
{
	const prefix = PREFIX[repo];
	const one = (value: unknown) => `${prefix}:${String(value)}`;
	const keyOfValue = (value: unknown): string =>
	{
		const record = value as { date?: string;
			gamePk?: number;
			header?: { gamePk: number }; };
		return one(record.header?.gamePk ?? record.gamePk ?? record.date);
	};
	switch (method)
	{
		case "getByDate":
		case "getWithServedBase":
		case "getByPk":
			return {
				kind: "read",
				keys: [one(args[0])],
			};
		case "getMany":
		case "getStateFields":
			return {
				kind: "read",
				keys: (args[0] as readonly unknown[]).map(one),
			};
		case "upsert":
			return {
				kind: "write",
				keys: [keyOfValue(args[0])],
			};
		case "upsertMany":
		case "write":
			return {
				kind: "write",
				keys: (args[0] as readonly unknown[]).map(keyOfValue),
			};
		default:
			return {
				kind: method.startsWith("list") || method.startsWith("get") ? "read" : "write",
				keys: [],
			};
	}
}

/** What a test reads back from the double: every call so far, and every read-back or repeat read. */
export class RoundTripLog
{
	readonly calls: RoundTrip[] = [];
	readonly violations: string[] = [];
	/** Runs before each write is passed on (S216 AC 1: another writer's version seeded between a read and a write). */
	beforeWrite?: (call: RoundTrip) => Promise<void>;
	private readonly read = new Set<string>();
	private readonly written = new Set<string>();

	/** How many round trips so far. */
	get count(): number
	{
		return this.calls.length;
	}

	/** The calls as `<repo>.<method>`, for a failure message that says which ones ran. */
	names(): string[]
	{
		return this.calls.map((call) => `${call.repo}.${call.method}`);
	}

	/** Records one call, and a violation for each key it reads that this request already wrote or read. */
	record(call: RoundTrip): void
	{
		this.calls.push(call);
		for (const key of call.keys)
		{
			if (call.kind === "read")
			{
				if (this.written.has(key)) this.violations.push(`read-back of ${key} (${call.repo}.${call.method})`);
				else if (this.read.has(key)) this.violations.push(`repeat read of ${key} (${call.repo}.${call.method})`);
				this.read.add(key);
			}
			else this.written.add(key);
		}
	}
}

/** `repo` with every method call recorded in `log` (and `beforeWrite` awaited before a write). */
function counted<T extends object>(repo: T, name: Repo, log: RoundTripLog): T
{
	return new Proxy(repo, {
		get(target, key, receiver)
		{
			const value = Reflect.get(target, key, receiver) as unknown;
			if (typeof value !== "function" || typeof key !== "string") return value;
			return async (...args: unknown[]) =>
			{
				const call: RoundTrip = {
					repo: name,
					method: key,
					...keysOf(name, key, args),
				};
				if (call.kind === "write" && log.beforeWrite) await log.beforeWrite(call);
				log.record(call);
				return (value as (...a: unknown[]) => unknown).apply(target, args);
			};
		},
	});
}

/**
 * `deps` with its four stores counted in a new log: what a test hands the read path. The originals stay unwrapped, so
 * a test can seed or inspect them without counting.
 */
export function countingDeps<D extends Pick<IngestDeps, Repo>>(deps: D): { deps: D;
	log: RoundTripLog; }
{
	const log = new RoundTripLog();
	return {
		deps: {
			...deps,
			schedules: counted(deps.schedules, "schedules", log),
			games: counted(deps.games, "games", log),
			gameStates: counted(deps.gameStates, "gameStates", log),
			projections: counted(deps.projections, "projections", log),
		},
		log,
	};
}
