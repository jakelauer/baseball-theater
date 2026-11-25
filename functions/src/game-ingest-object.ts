/**
 * The `game-ingest:<gamePk>` Durable Object (S48; ADR-020 layer 1): a thin shell that
 * gives `GameIngest` (services/game-ingest.ts) its storage and alarm. The cron reaches it
 * through `ensureGameIngest`; a hub (S18) registers, renews and unregisters its lease
 * through `fetch`. It reads and writes Postgres through the isolate's composition
 * (`workerApp`), each call and alarm on its own connection (`inDatabaseScope`, S51).
 *
 * S220: each call and alarm logs one line of its database round trips (kind `ingest`, job `fetch` or
 * `alarm`), because this object runs wherever it was first made, not beside Neon as Smart Placement
 * puts the fetch handler, so each query may pay that distance. Both places that reach an ingest
 * object (the cron's `ensureGameIngest`, the hubs' `ingestLease`) get it through `gameIngestStub`,
 * which passes the location hint `BT_INGEST_LOCATION_HINT` names (staging's `enam`, near us-east-2):
 * a hint counts only on the call that creates the object, so whichever caller came first would
 * otherwise decide where it lives.
 */
import type { GameSnapshot } from "@bt/domain";
import { inDatabaseScope } from "./adapters/postgres/connect.js";
import type { HyperdriveBinding } from "./adapters/postgres/connect.js";
import type { AlarmStore } from "./services/game-ingest.js";
import { hubPublisher } from "./game-hub-object.js";
import { GameIngest, gameIngestName } from "./services/game-ingest.js";
import type { WorkerEnv } from "./worker-app.js";
import { workerApp } from "./worker-app.js";

/** The part of the Durable Object state this class uses. */
export type GameIngestState = { storage: AlarmStore };

/** The binding as `env.GAME_INGEST` exposes it (`wrangler.jsonc` `durable_objects`); `get`'s options carry S220's hint. */
export type GameIngestNamespace = {
	idFromName(name: string): unknown;
	get(id: never, options?: { locationHint?: string }): { fetch(input: string, init?: RequestInit): Promise<Response> };
};

/**
 * The one way to reach `game-ingest:<gamePk>` (S220 AC 2), so the object is placed the same however it is first made.
 * With `locationHint` (`env.BT_INGEST_LOCATION_HINT`, set for staging only) it asks Cloudflare to create the object
 * there; without one the call passes no options, as before S220, and Cloudflare places it near the first caller. A
 * hint is ignored for an object that already exists.
 */
export function gameIngestStub(namespace: GameIngestNamespace, gamePk: number, locationHint: string | undefined)
{
	const id = namespace.idFromName(gameIngestName(gamePk)) as never;
	return locationHint ? namespace.get(id, {
		locationHint,
	}) : namespace.get(id);
}

/**
 * Where there is no `GAME_HUB` binding (Node, tests) there is nowhere to deliver to:
 * registered hubs are "published" to here, keeping the write-then-publish order and the
 * lease bookkeeping real while delivery is a no-op. The Worker uses `hubPublisher` (S18).
 */
export async function stubHubPublisher(_hubId: string, _snapshot: GameSnapshot): Promise<void>
{
	// No hubs to reach without the binding.
}

export class GameIngestObject
{
	private readonly ingest: GameIngest;
	private readonly hyperdrive: HyperdriveBinding | undefined;

	constructor(state: GameIngestState, env: WorkerEnv)
	{
		this.ingest = new GameIngest(state.storage, workerApp(env).ingest, env.GAME_HUB ? hubPublisher(env.GAME_HUB, env.DAY_HUB) : stubHubPublisher);
		this.hyperdrive = env.HYPERDRIVE;
	}

	/**
	 * `POST /ensure?gamePk=` starts polling (idempotent); `POST /hubs/register`,
	 * `/hubs/renew` and `/hubs/unregister` with `?hub=` manage a hub's lease.
	 */
	fetch(request: Request): Promise<Response>
	{
		return inDatabaseScope(this.hyperdrive, () => this.route(request), undefined, undefined, {
			kind: "ingest",
			job: "fetch",
		});
	}

	private async route(request: Request): Promise<Response>
	{
		const url = new URL(request.url);
		const now = new Date();
		const hub = url.searchParams.get("hub");
		switch (url.pathname)
		{
			case "/ensure":
			{
				const gamePk = Number(url.searchParams.get("gamePk"));
				if (!Number.isInteger(gamePk) || gamePk <= 0) return new Response("gamePk required", {
					status: 400,
				});
				return Response.json({
					armed: await this.ingest.ensureRunning(gamePk, now),
				});
			}
			case "/hubs/register":
				if (!hub) break;
				await this.ingest.hubs.register(hub, now);
				return new Response(null, {
					status: 204,
				});
			case "/hubs/renew":
				if (!hub) break;
				return new Response(null, {
					status: await this.ingest.hubs.renew(hub, now) ? 204 : 410,
				});
			case "/hubs/unregister":
				if (!hub) break;
				await this.ingest.hubs.unregister(hub);
				return new Response(null, {
					status: 204,
				});
		}
		return new Response("not found", {
			status: 404,
		});
	}

	alarm(): Promise<void>
	{
		return inDatabaseScope(this.hyperdrive, () => this.ingest.alarm(new Date()), undefined, undefined, {
			kind: "ingest",
			job: "alarm",
		});
	}
}

/** Asks `gamePk`'s ingest object to run (the cron's call, once per in-window game per run), placed by `locationHint`. */
export async function ensureGameIngest(namespace: GameIngestNamespace, gamePk: number, locationHint?: string): Promise<void>
{
	const stub = gameIngestStub(namespace, gamePk, locationHint);
	const response = await stub.fetch(`https://game-ingest/ensure?gamePk=${gamePk}`, {
		method: "POST",
	});
	if (!response.ok) throw new Error(`game-ingest ${gamePk}: ${response.status}`);
}
