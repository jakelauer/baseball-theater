/**
 * The API as a Cloudflare Worker (S45; ADR-017). `fetch` serves `/api/*` through the
 * same Fetch-standard `handleApiRequest` the Node server adapts; everything else is
 * the web app, served from `web/dist` by the assets binding before the Worker runs
 * (`wrangler.jsonc`). `scheduled` is the per-minute cron trigger: it ensures one
 * `game-ingest:<gamePk>` Durable Object per in-window game (S48; ADR-020), whose alarms
 * own the ADR-002 cadence, refreshes at most one due schedule month of the fill window
 * (S194, `refreshDueScheduleMonth`), so every month is checked against MLB about every six
 * hours with no second cron expression, and re-checks at most one recently finished game's full
 * detail (S212, `recheckDueGame`), and resolves and seeds a capped batch of players' outside ids (S209,
 * `runPlayerIdJobs`). Composition lives in `worker-app.ts`.
 */
import { DeferredWorkQueue, withDeferredWork } from "./adapters/background-work.js";
import { inDatabaseScope } from "./adapters/postgres/connect.js";
import { ensureGameIngest } from "./game-ingest-object.js";
import { handleApiRequest } from "./handlers/api.js";
import { ensureIngestRunning } from "./services/game-ingest.js";
import { retryOwedEdgePurges } from "./services/edge-purge.js";
import { recheckDueGame } from "./services/game-recheck.js";
import { runPlayerIdJobs } from "./services/player-ids.js";
import { refreshDueScheduleMonth } from "./services/schedule-refresh.js";
import { tickAllowed, workerApp } from "./worker-app.js";
import type { WorkerEnv } from "./worker-app.js";

export { GameHubObject } from "./game-hub-object.js";
export { DayHubObject } from "./day-hub-object.js";
export { GameIngestObject } from "./game-ingest-object.js";

/** The part of the Workers `ExecutionContext` this Worker uses. */
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

export default {
	/**
	 * Each request on its own Postgres connection through Hyperdrive (S51), closed after the response. S216 AC 3: the
	 * request's deferred writes (`ScopedBackgroundWork`, the app's `BackgroundWork`) gather in its own queue and run after
	 * the response, inside the same `inDatabaseScope`, before the connection closes, all in `ctx.waitUntil`.
	 */
	async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response>
	{
		const app = workerApp(env);
		const deferred = new DeferredWorkQueue();
		const handle = () => withDeferredWork(deferred, () => handleApiRequest(request, app.context));
		return inDatabaseScope(env.HYPERDRIVE, handle, (closing) => ctx.waitUntil(closing), () => deferred.drain());
	},

	/**
	 * Each tick, in local dev only with `BT_INGEST_TICK=1` (`tickAllowed`): ensures an ingest
	 * object (`ensureRunning`) for each in-window game where the `GAME_INGEST` binding exists, and
	 * refreshes at most one due schedule month (S194, `refreshDueScheduleMonth`), which needs no
	 * binding but the database, and re-checks at most one due recently finished game (S212,
	 * `recheckDueGame`), whose writes purge the edge copy of what they change, and retries the purges a failure left owed
	 * (S212 review, `retryOwedEdgePurges`; one database read a tick, and only with purge credentials), and runs the
	 * player-id job (S209, `runPlayerIdJobs`: at most one register read a tick, none when no player is due). Each runs in its own
	 * `waitUntil` and its own database scope, so one that rejects (and is logged by the runtime)
	 * doesn't stop the others. A preview's
	 * `crons: []` (`wrangler.jsonc`) means previews never run either.
	 *
	 * S220: each job's scope logs one line of its database round trips (kind `cron`, `job` naming it),
	 * one line per job rather than per tick, because Smart Placement alone doesn't move the cron near Neon
	 * and every query may pay the distance. Staging's `placement.hint` (with mode "smart", a hint that seeds
	 * Smart Placement, not a pin) is expected to move it there; these lines will show whether it does. The ingest objects it
	 * ensures are created with `BT_INGEST_LOCATION_HINT` (`gameIngestStub`).
	 */
	async scheduled(_controller: unknown, env: WorkerEnv, ctx: WorkerContext): Promise<void>
	{
		if (!tickAllowed(env)) return;
		const app = workerApp(env);
		const namespace = env.GAME_INGEST;
		if (namespace)
		{
			const ensure = (gamePk: number) => ensureGameIngest(namespace, gamePk, env.BT_INGEST_LOCATION_HINT);
			ctx.waitUntil(inDatabaseScope(env.HYPERDRIVE, () => ensureIngestRunning(app.ingest, ensure), undefined, undefined, {
				kind: "cron",
				job: "ingest-start",
			}));
		}
		ctx.waitUntil(inDatabaseScope(env.HYPERDRIVE, () => refreshDueScheduleMonth(app.ingest), undefined, undefined, {
			kind: "cron",
			job: "month-refresh",
		}));
		ctx.waitUntil(inDatabaseScope(env.HYPERDRIVE, () => recheckDueGame(app.ingest), undefined, undefined, {
			kind: "cron",
			job: "game-recheck",
		}));
		ctx.waitUntil(inDatabaseScope(env.HYPERDRIVE, () => retryOwedEdgePurges(app.ingest), undefined, undefined, {
			kind: "cron",
			job: "edge-purge-retry",
		}));
		// S209 AC 3: the capped resolve step, then one seeding page, in a scope of their own so their database waits show
		// in their own round-trip line.
		const playerIds = app.ingest.playerIds;
		if (playerIds)
		{
			ctx.waitUntil(inDatabaseScope(env.HYPERDRIVE, () => runPlayerIdJobs({
				playerIds,
				...app.ingest.playerRegister && {
					register: app.ingest.playerRegister,
				},
			}), undefined, undefined, {
				kind: "cron",
				job: "player-ids",
			}));
		}
	},
};
