/**
 * Connecting the Postgres adapter (S51; ADR-018). On Workers a connection belongs to the
 * request that opened it — another request can't use its socket — so the isolate's one
 * composition holds `scopedDatabase`, a handle that resolves to the connection of the unit
 * of work it runs in (a request, a cron tick, a Durable Object call), and `inDatabaseScope`
 * opens that connection through the `HYPERDRIVE` binding and closes it after. Locally the
 * binding's `localConnectionString` points at compose.yaml's Postgres; in the workerd tests,
 * at PGlite served over a socket. Node callers hand the composition a database directly.
 *
 * S220: every database a scope runs on goes through one counting wrapper (`countRoundTrips`), so a
 * scope given a `ScopeLabel` (an ingest object's alarm or call, a hub's, a cron job's) logs how many
 * round trips it made and how long they took. Smart Placement (issue #532) moves only the fetch
 * handler near Neon; Durable Objects and the cron may still run far from it, paying the distance on
 * every query, and these lines are how staging and production show what that costs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { PostgresDb } from "./repos.js";

/** The `HYPERDRIVE` binding as the Worker sees it (`wrangler.jsonc` `hyperdrive`). */
export type HyperdriveBinding = { connectionString: string };

/**
 * One connection over node-postgres (`pg`, the driver Cloudflare recommends with Hyperdrive),
 * and how to close it. Hyperdrive pools behind it, so a unit of work needs only the one.
 */
export async function openPostgres(connectionString: string): Promise<{ db: PostgresDb;
	close: () => Promise<void>; }>
{
	const client = new Client({
		connectionString,
	});
	// A failed query rejects its own promise; this listener is for the socket. On Workers its
	// read loop ends with "Stream was cancelled" once we close it (pg-cloudflare), which is the
	// goodbye, not a fault. Anything before the close is worth a log line.
	let closed = false;
	client.on("error", (error) =>
	{
		if (!closed) console.error("[postgres] connection error", error);
	});
	await client.connect();
	return {
		db: drizzle(client),
		close: () =>
		{
			closed = true;
			return client.end();
		},
	};
}

const scope = new AsyncLocalStorage<PostgresDb>();

/**
 * What a measured scope is (S220 AC 1), the `kind` its log line is read by: a game's ingest object
 * (`ingest`), a game hub (`hub`), a day hub (`day-hub`) or one cron job (`cron`, the job named). A
 * request's scope has none and logs nothing, so ordinary traffic adds no lines.
 */
export type ScopeLabel = { kind: "ingest" | "hub" | "day-hub" | "cron";
	job: string; };

/** The round trips one measured scope has made so far; a nested measured scope also counts into its parent's. */
type RoundTripMeter = { roundTrips: number;
	totalMs: number;
	maxMs: number;
	parent: RoundTripMeter | undefined; };

const meters = new AsyncLocalStorage<RoundTripMeter>();

/** Adds one round trip of `ms` to the measured scope in progress (and those around it); nothing outside one. */
function recordRoundTrip(ms: number): void
{
	for (let meter = meters.getStore(); meter; meter = meter.parent)
	{
		meter.roundTrips += 1;
		meter.totalMs += ms;
		meter.maxMs = Math.max(meter.maxMs, ms);
	}
}

/** The structured line a measured scope writes once its work is done (Workers Logs indexes its fields). */
export type RoundTripLine = ScopeLabel & { event: "db-round-trips";
	roundTrips: number;
	totalMs: number;
	maxMs: number; };

function logRoundTrips(label: ScopeLabel, meter: RoundTripMeter): void
{
	const line: RoundTripLine = {
		event: "db-round-trips",
		...label,
		roundTrips: meter.roundTrips,
		totalMs: Math.round(meter.totalMs),
		maxMs: Math.round(meter.maxMs),
	};
	console.log(line);
}

const COUNTED = Symbol("bt.countedRoundTrips");

type QueryClient = { query: (...args: unknown[]) => unknown;
	transaction?: (work: (tx: QueryClient) => unknown, ...rest: unknown[]) => unknown;
	[COUNTED]?: true; };

/**
 * The one counting wrapper (S220 AC 1): times each `query` the driver sends through `client` (node-postgres's `Client`
 * on Workers, every statement of a transaction included; PGlite's under Node, whose transactions hand their own client
 * to the callback, wrapped too, though PGlite's own BEGIN and COMMIT go uncounted) into the measured scope in progress.
 * Once per client; a query outside a measured scope costs one clock read. Times are `performance.now()`, which on
 * Workers moves only across I/O, which is what a round trip is.
 */
function countRoundTrips(client: QueryClient): void
{
	if (client[COUNTED]) return;
	client[COUNTED] = true;
	const query = client.query.bind(client);
	client.query = (...args: unknown[]) =>
	{
		const started = performance.now();
		const result = query(...args);
		if (result instanceof Promise) return result.finally(() => recordRoundTrip(performance.now() - started));
		return result;
	};
	const transaction = client.transaction?.bind(client);
	if (transaction) client.transaction = (work, ...rest) => transaction((tx) =>
	{
		countRoundTrips(tx);
		return work(tx);
	}, ...rest);
}

/** Counts the round trips of `db`'s driver client (`$client`), when it has one (test doubles may not). */
function countDatabase(db: PostgresDb): PostgresDb
{
	const client = (db as { $client?: QueryClient }).$client;
	if (client && typeof client.query === "function") countRoundTrips(client);
	return db;
}

/** Node's database outside any scope (`setNodeDatabase`); never set in the Worker. */
let nodeDatabase: PostgresDb | undefined;

/**
 * Under Node there are no requests to scope (tests, `local-server.ts`): the process has one
 * database — PGlite — that unscoped work uses. The Worker never calls this, so work there
 * that escaped `inDatabaseScope` still throws.
 */
export function setNodeDatabase(db: PostgresDb | undefined): void
{
	nodeDatabase = db && countDatabase(db);
}

/** Runs `work` with `db` as the database `scopedDatabase` resolves to, its round trips counted (S220). */
export function withDatabase<T>(db: PostgresDb, work: () => Promise<T>): Promise<T>
{
	return scope.run(countDatabase(db), work);
}

/**
 * The database of the unit of work in progress. Every property read goes to the current
 * scope's connection, so repositories built once per isolate never hold another request's
 * socket. Used outside a scope it throws rather than reach for a connection that isn't there.
 */
export const scopedDatabase: PostgresDb = new Proxy({} as PostgresDb, {
	get(_target, key)
	{
		const db = scope.getStore() ?? nodeDatabase;
		if (!db) throw new Error("no database in scope: wrap the work in inDatabaseScope (S51)");
		const value = Reflect.get(db, key, db) as unknown;
		return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(db) : value;
	},
});

/**
 * Runs `work` on its own connection through `binding`, closing it afterwards — through
 * `waitUntil` when given, so the response isn't held for the goodbye. Inside an existing
 * scope (or under Node, with `setNodeDatabase`) it uses that database, so nested calls share
 * a connection.
 *
 * S216 AC 3: `after` is what runs once `work` has returned (a request's deferred writes, `DeferredWorkQueue.drain`),
 * inside the same scope, before the connection closes, so the response isn't held for it and it still has its
 * connection; with `waitUntil`, `after` and the close go to it together. It must not reject (the drain never does).
 *
 * S220 AC 1: given a `label`, the scope logs one structured line (`RoundTripLine`: its kind and job, the number of
 * database round trips `work` and `after` made, and their total and largest time in ms) once both are done, whether
 * they succeeded or threw, so the distance from where the work runs to Neon (us-east-2) shows in the logs by `kind`.
 * The count comes from the one wrapper on the connection (`countRoundTrips`), never from timers around each call.
 * Without a label (a request) nothing is logged.
 */
export async function inDatabaseScope<T>(
	binding: HyperdriveBinding | undefined,
	work: () => Promise<T>,
	waitUntil?: (promise: Promise<unknown>) => void,
	after?: () => Promise<void>,
	label?: ScopeLabel,
): Promise<T>
{
	const finish = async (closing: Promise<unknown>): Promise<void> =>
	{
		if (waitUntil) waitUntil(closing);
		else await closing;
	};
	const meter: RoundTripMeter | undefined = label && {
		roundTrips: 0,
		totalMs: 0,
		maxMs: 0,
		parent: meters.getStore(),
	};
	// Awaited inside the meter's context: a drizzle query is a thenable that runs only when awaited, so handing it out
	// of `meters.run` unawaited would count its round trip to the scope around this one.
	const measured = <R>(run: () => Promise<R>): Promise<R> => meter ? meters.run(meter, async () => await run()) : run();
	const report = (): void =>
	{
		if (label && meter) logRoundTrips(label, meter);
	};
	if (scope.getStore() ?? nodeDatabase)
	{
		try
		{
			return await measured(work);
		}
		finally
		{
			if (after) await finish(measured(after).then(report));
			else report();
		}
	}
	if (!binding) throw new Error("the HYPERDRIVE binding is missing (wrangler.jsonc hyperdrive)");
	const { db, close } = await openPostgres(binding.connectionString);
	try
	{
		return await withDatabase(db, () => measured(work));
	}
	finally
	{
		const settled = after ? withDatabase(db, () => measured(after)) : Promise.resolve();
		await finish(settled.then(report).then(close, close));
	}
}
