/**
 * The API's composition on the Workers runtime (S45; ADR-017): which MLB client, repos
 * and accounts the Worker serves with — the same wiring as `local-server.ts`, built
 * once per isolate. Every repository is Postgres (ADR-018; S51): the Worker's are built
 * on `scopedDatabase`, the connection of the request (or cron tick, or Durable Object call)
 * in progress, which `inDatabaseScope` opens through the `HYPERDRIVE` binding — compose.yaml's
 * Postgres in local dev, Neon deployed. Node callers (tests, `local-server.ts`) hand
 * `createWorkerApp` a database directly. Downloads and the mailer stay in-process until their
 * R2 and Email adapters (the launch checklist). Recording replays is a Node-only tool
 * (`src/scripts/`) and has no place in the Worker.
 */
import { cachedSeasonCalendars, defaultCalendarStore } from "./adapters/cached-season-calendars.js";
import type {
	BackgroundWork, MlbStatsClient, OwedEdgePurgeRepository,
} from "@bt/ports";
import {
	createDevAccountData, createDevAuth, StaticSecretsProvider,
} from "./adapters/fixtures/auth.js";
import { ScopedBackgroundWork } from "./adapters/background-work.js";
import { CloudflareEdgeCachePurger, NoopEdgeCachePurger } from "./adapters/cloudflare/edge-cache-purger.js";
import { createBundledFixtureClient } from "./adapters/fixtures/bundled.js";
import { LogtoIdentityAdmin, LogtoManagementApi } from "./adapters/logto/admin.js";
import { LogtoIdentityProvider } from "./adapters/logto/identity.js";
import { MockIdentityProvider } from "./adapters/mock/identity.js";
import { ChadwickPlayerRegister } from "./adapters/http/chadwick-register.js";
import { HttpMlbStatsClient } from "./adapters/http/mlb.js";
import type { MlbOverlaySource } from "./adapters/overlay-mlb.js";
import { overlayMlbClient, storeOverlay } from "./adapters/overlay-mlb.js";
import { scopedDatabase } from "./adapters/postgres/connect.js";
import type { HyperdriveBinding } from "./adapters/postgres/connect.js";
import type { PostgresDb } from "./adapters/postgres/repos.js";
import {
	PostgresDeletionLog,
	PostgresGameProjectionRepository, PostgresGameStateRepository,
	PostgresGameRepository,
	PostgresScheduleRepository,
	PostgresOwedEdgePurgeRepository,
	PostgresPlayerIdRepository,
	PostgresSettingsRepository,
	PostgresUserRepository,
	PostgresVenueFieldRepository,
} from "./adapters/postgres/repos.js";
import type { GameIngestNamespace } from "./game-ingest-object.js";
import type { ApiContext } from "./handlers/api.js";
import { APP_ORIGIN_SECRET } from "./services/data-downloads.js";
import { logApiUsage } from "./services/api-usage.js";
import type { AuthDeps } from "./services/accounts.js";
import { dayHubName, dayHubNotifier } from "./services/day-hubs.js";
import type { EdgePurge } from "./services/edge-purge.js";
import type { IngestDeps } from "./services/ingest.js";
import { RefreshCoordinator } from "./services/refresh.js";
import { SESSION_KEY_SECRET } from "./services/session.js";

/** The Worker's environment: plain `BT_*` vars (wrangler `--var` / `.dev.vars`), no secrets committed. */
export type WorkerEnv = {
	/** `"1"` serves live statsapi.mlb.com; anything else, the bundled fixtures (the default). */
	BT_USE_LIVE_MLB?: string;
	/** Signs sessions; without it a random key per isolate (sessions end on restart, as locally today). */
	BT_SESSION_KEY?: string;
	/** Where download emails link (default: the Vite dev server). */
	BT_APP_ORIGIN?: string;
	/**
	 * `"1"` marks local dev (`pnpm dev` and the Workers tests set it): the cron tick then runs only
	 * with `BT_INGEST_TICK=1`, and `dev:` sign-in is wired (S114 AC 7). No deployed env sets it.
	 */
	BT_LOCAL?: string;
	/**
	 * The Logto tenant's address and the single-page app's ID (S116): where both are set, the
	 * Worker offers Logto sign-in. Per-env `vars` in `wrangler.jsonc`; only production names them.
	 * Staging signs in with the mock test account instead (`BT_MOCK_SIGN_IN`), and previews offer
	 * no sign-in at all.
	 */
	LOGTO_ENDPOINT?: string;
	LOGTO_APP_ID?: string;
	/** The tenant's own ID, for the Management API, which Logto Cloud serves only at `<id>.logto.app` (S116). */
	LOGTO_TENANT_ID?: string;
	/**
	 * Production's machine-to-machine app (Worker secrets, pushed from GitHub secrets on every
	 * production deploy, S116 AC 5): where the secret is set, account deletion also deletes the
	 * fan's Logto account. No other env has one.
	 */
	LOGTO_S2S_APP_ID?: string;
	LOGTO_S2S_SECRET?: string;
	/**
	 * `"1"` signs fans in as staging's one shared test account (S143; `mockSignInAllowed`): set in
	 * `env.staging`'s vars only, so staging's Sign in works with no Logto tenant,
	 * while production signs in through Logto and previews offer no sign-in at all.
	 */
	BT_MOCK_SIGN_IN?: string;
	/**
	 * `"1"` offers staging's backer tier override (S215; `tierOverrideAllowed`), for testing only:
	 * set in `env.staging`'s vars only, and honoured only beside the mock sign-in, so production,
	 * which names a Logto tenant, refuses it on the server even if the var were copied there. The
	 * override never changes the real tier or touches Patreon.
	 */
	BT_TIER_OVERRIDE?: string;
	/**
	 * A Cloudflare API token with the Zone → Cache Purge permission, and the zone's ID (S212 AC 4; Worker secrets,
	 * pushed from GitHub secrets by the staging and production deploys (B543)): where both and `BT_APP_ORIGIN` are set, a write of a past, finished day or game purges its edge
	 * copy by URL (`edgePurgeFor`); otherwise nothing is purged and that is logged once.
	 */
	BT_CF_PURGE_TOKEN?: string;
	BT_CF_ZONE_ID?: string;
	/** `"1"` lets the cron tick ingest in local dev (ADR-002 cadence; off by default, as `local-server.ts`). */
	BT_INGEST_TICK?: string;
	/**
	 * S220: the `locationHint` each ingest object is created with (`gameIngestStub`), so it runs near Neon rather than
	 * near whatever first reached it. Set in `wrangler.jsonc`'s staging vars only (`enam`, nearest us-east-2) while the
	 * round-trip lines show whether it helps; with none, the objects are got without a hint, as before.
	 */
	BT_INGEST_LOCATION_HINT?: string;
	/** The per-game ingest objects (S48; `wrangler.jsonc` `durable_objects`); absent under Node. */
	GAME_INGEST?: GameIngestNamespace;
	/** The per-game live hubs (S18; `wrangler.jsonc` `durable_objects`); absent under Node. */
	GAME_HUB?: GameIngestNamespace;
	/** The scoreboard's per-day live hubs (S149; `wrangler.jsonc` `durable_objects`); absent under Node. */
	DAY_HUB?: GameIngestNamespace;
	/** Postgres through Hyperdrive (S51; `wrangler.jsonc` `hyperdrive`); absent under Node. */
	HYPERDRIVE?: HyperdriveBinding;
};

/** Everything a request or a cron tick needs: the handler's context plus the ingest loop's deps. */
export type WorkerApp = {
	context: ApiContext;
	ingest: IngestDeps;
};

/**
 * Fixtures are the default so local dev and tests never touch the network; `BT_USE_LIVE_MLB=1`
 * opts in. On fixtures, what the store already holds (the committed fixtures and the dev seed,
 * S112) is answered from the store: a refresh-on-read of a seeded game stamps it unchanged
 * instead of asking MLB, and a seeded day isn't replaced by the fixtures' empty answer.
 */
export function createMlbClient(env: WorkerEnv, store?: MlbOverlaySource): MlbStatsClient
{
	if (env.BT_USE_LIVE_MLB === "1")
	{
		return new HttpMlbStatsClient();
	}
	const fixtures = createBundledFixtureClient();
	return store ? overlayMlbClient(fixtures, store) : fixtures;
}

/**
 * The edge purge a Worker writes with (S212 AC 4): Cloudflare's purge-by-URL API where `BT_CF_PURGE_TOKEN`,
 * `BT_CF_ZONE_ID` and `BT_APP_ORIGIN` are all set, its failed purges owed to `owed` for the cron to retry (S212
 * review), else a no-op purger that logs once that it purged nothing, so every write still succeeds; the no-op never
 * fails, so it is given no owed store and the cron's retry reads nothing. `fetcher` is the composition's test `fetch`,
 * when given.
 */
export function edgePurgeFor(env: WorkerEnv, fetcher?: WorkerAppOptions["fetch"], owed?: OwedEdgePurgeRepository): EdgePurge
{
	if (env.BT_CF_PURGE_TOKEN && env.BT_CF_ZONE_ID && env.BT_APP_ORIGIN)
	{
		return {
			purger: new CloudflareEdgeCachePurger(env.BT_CF_PURGE_TOKEN, env.BT_CF_ZONE_ID, fetcher),
			origin: env.BT_APP_ORIGIN,
			...owed && {
				owed,
			},
		};
	}
	return {
		purger: new NoopEdgeCachePurger(),
		origin: env.BT_APP_ORIGIN ?? "",
	};
}

/**
 * What tests swap in the composition: the `fetch` the Logto adapters (and the edge purge, S212) call (a stand-in tenant).
 * `background` is where an on-read refresh's deferred writes run (S216 AC 3): the Worker's per-request queue
 * (`workerApp`), the Node server's run-at-once adapter (`local-server.ts`); absent (most tests), they run before the
 * read returns.
 */
export type WorkerAppOptions = {
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	background?: BackgroundWork;
};

/**
 * Wires the API for `env` on `db`. Exported for tests and the Node server; the Worker calls
 * `workerApp`, which builds it once on `scopedDatabase`. Nothing is seeded here: `pnpm db:seed`
 * fills the database, and a day or game that isn't stored is read through from MLB anyway.
 * `options.background` (S216) is where a read's refresh defers its writes that carry no version of its answer.
 */
export function createWorkerApp(env: WorkerEnv, db: PostgresDb, options: WorkerAppOptions = {}): WorkerApp
{
	const schedules = new PostgresScheduleRepository(db);
	const games = new PostgresGameRepository(db);
	const gameStates = new PostgresGameStateRepository(db);
	// With live MLB data the one HTTP client is built here, so the player-id job's cross-references (S209) use the same
	// instance as ingest; every other case is `createMlbClient`'s.
	const live = env.BT_USE_LIVE_MLB === "1" ? new HttpMlbStatsClient() : undefined;
	const mlb = live ?? createMlbClient(env, storeOverlay({
		schedules,
		games,
		gameStates,
	}));
	const ingest: IngestDeps = {
		mlb,
		// The standings' calendars, kept for a day (S139 AC 8): the Workers Cache in the Worker, memory under Node.
		seasonCalendars: cachedSeasonCalendars(mlb, defaultCalendarStore()),
		schedules,
		games,
		projections: new PostgresGameProjectionRepository(db),
		gameStates,
		// S105: each venue's field drawing, asked by a game's first write and served by the venue field route.
		venueFields: new PostgresVenueFieldRepository(db),
		// One coordinator per isolate: stale out-of-window reads refresh single-flighted.
		refresh: new RefreshCoordinator(),
		edgePurge: edgePurgeFor(env, options.fetch, new PostgresOwedEdgePurgeRepository(db)),
		// S209: MLB's players and their outside ids. The cron's sync reads the register and MLB's cross-references only
		// with live MLB data, so local fixture runs and tests never fetch them (their names link to MLB.com).
		playerIds: new PostgresPlayerIdRepository(db),
		...live && {
			playerRegister: new ChadwickPlayerRegister(options.fetch ? (input, init) => options.fetch!(String(input), init) : undefined),
			playerXrefs: live,
		},
		...options.background && {
			background: options.background,
		},
		// S149 AC 2: a schedule write tells the day hubs of the in-window days it changed; the Node server has none.
		...env.DAY_HUB && {
			dayHubs: dayHubNotifier(env.DAY_HUB),
		},
	};
	const secrets = new StaticSecretsProvider({
		[SESSION_KEY_SECRET]: env.BT_SESSION_KEY ?? crypto.randomUUID(),
		...env.BT_APP_ORIGIN && {
			[APP_ORIGIN_SECRET]: env.BT_APP_ORIGIN,
		},
	});
	const devAuth = createDevAuth(secrets, new PostgresUserRepository(db));
	const logto = logtoSignIn(env, options);
	const auth: AuthDeps = {
		...devSignInAllowed(env) ? devAuth : withoutDevSignIn(devAuth),
		...logto && {
			logto,
		},
		...mockSignInAllowed(env) && {
			mock: new MockIdentityProvider(),
		},
		...tierOverrideAllowed(env) && {
			tierOverrideAllowed: true,
		},
	};
	const settings = new PostgresSettingsRepository(db);
	const devAccount = createDevAccountData({
		users: auth.users,
		settings,
	}, secrets, new PostgresDeletionLog(db));
	const admin = logtoAdmin(env, options);
	// Deletion reaches each provider through its admin; without Logto's (everywhere but production)
	// a deletion still removes every BT row and leaves the provider account alone (S116 AC 4).
	const account = {
		...devAccount,
		identityAdmins: admin ? [...devAccount.identityAdmins, admin] : devAccount.identityAdmins,
	};
	return {
		context: {
			ingest,
			auth,
			settings,
			account,
			// One log line per versioned request, for retiring versions on evidence (S28).
			usage: logApiUsage,
			...env.GAME_HUB && {
				live: liveForwarder(env.GAME_HUB),
			},
			...env.DAY_HUB && {
				liveDay: liveDayForwarder(env.DAY_HUB),
			},
		},
		ingest,
	};
}

/**
 * Whether `Bearer dev:<uid>` signs in (S114 AC 7): only in local dev, where `pnpm dev` and the
 * Workers tests set `BT_LOCAL` to `"1"`. No deployed environment sets it (`wrangler.jsonc`), so
 * preview, staging and production refuse a `dev:` token; production signs in through Logto (S116).
 */
export function devSignInAllowed(env: WorkerEnv): boolean
{
	return env.BT_LOCAL === "1";
}

/**
 * Whether the mock sign-in is wired (S143 AC 2): only where the env sets `BT_MOCK_SIGN_IN` to
 * `"1"` and names no Logto tenant, not even half of one (`LOGTO_ENDPOINT` or `LOGTO_APP_ID` alone),
 * so a mis-set tenant never falls back to the shared test account. `wrangler.jsonc` sets the var in
 * `env.staging` only; production and previews never accept the mock credential.
 */
export function mockSignInAllowed(env: WorkerEnv): boolean
{
	return env.BT_MOCK_SIGN_IN === "1" && !env.LOGTO_ENDPOINT && !env.LOGTO_APP_ID;
}

/**
 * Whether staging's backer tier override is offered (S215 AC 2): only where the env's vars set
 * `BT_TIER_OVERRIDE` to `"1"` **and** the mock sign-in is wired ({@link mockSignInAllowed}), so an
 * env naming a Logto tenant, as production does, never honours it even if the var were copied
 * there. Deploy-time config only: no request header, query, cookie or body can switch it on, and
 * the local Node server never sets the var. It exists for staging tests; production refuses it on
 * the server (its routes answer 404 and the stored override is never read), not by hiding it, and
 * the override never changes the real tier or touches Patreon.
 */
export function tierOverrideAllowed(env: WorkerEnv): boolean
{
	return env.BT_TIER_OVERRIDE === "1" && mockSignInAllowed(env);
}

/** Logto sign-in where the env's vars name the tenant and the app (S116 AC 2); none elsewhere. */
export function logtoSignIn(env: WorkerEnv, options: WorkerAppOptions = {}): AuthDeps["logto"]
{
	if (!env.LOGTO_ENDPOINT || !env.LOGTO_APP_ID) return undefined;
	const config = {
		endpoint: env.LOGTO_ENDPOINT,
		appId: env.LOGTO_APP_ID,
	};
	return {
		provider: new LogtoIdentityProvider({
			...config,
			...options.fetch && {
				fetch: options.fetch,
			},
		}),
		config,
	};
}

/**
 * Logto's admin, only where production's machine-to-machine app is set: `LOGTO_S2S_SECRET` and
 * `LOGTO_S2S_APP_ID` (Worker secrets) and `LOGTO_TENANT_ID` (a var). Staging and previews have
 * none, so none is composed there (S116 AC 4).
 */
export function logtoAdmin(env: WorkerEnv, options: WorkerAppOptions = {}): LogtoIdentityAdmin | undefined
{
	if (!env.LOGTO_S2S_SECRET || !env.LOGTO_S2S_APP_ID || !env.LOGTO_TENANT_ID) return undefined;
	return new LogtoIdentityAdmin(new LogtoManagementApi({
		tenantId: env.LOGTO_TENANT_ID,
		appId: env.LOGTO_S2S_APP_ID,
		secret: env.LOGTO_S2S_SECRET,
		...options.fetch && {
			fetch: options.fetch,
		},
	}));
}

/** The same auth with the `dev:` provider left out, so a `dev:` token is just an unknown bearer. */
function withoutDevSignIn(auth: AuthDeps): AuthDeps
{
	const { dev: _dev, ...rest } = auth;
	return rest;
}

/**
 * Hands a live upgrade to `game-hub:<gamePk>` (S18) as `/connect`, keeping the viewer's
 * `since` so a viewer behind gets the full state first.
 */
export function liveForwarder(namespace: GameIngestNamespace): (gamePk: number, request: Request) => Promise<Response>
{
	return (gamePk, request) =>
	{
		const since = new URL(request.url).searchParams.get("since");
		const target = `https://game-hub/connect?gamePk=${gamePk}${since === null ? "" : `&since=${encodeURIComponent(since)}`}`;
		return namespace.get(namespace.idFromName(`game-hub:${gamePk}`) as never).fetch(target, {
			headers: request.headers,
		});
	};
}

/**
 * Hands `GET /api/v1/schedule/live?date=` to the date's day hub (S149 AC 5), as {@link liveForwarder} does a game's:
 * the request's headers (the upgrade) and its `?since=` go along.
 */
export function liveDayForwarder(namespace: GameIngestNamespace): (date: string, request: Request) => Promise<Response>
{
	return (date, request) =>
	{
		const since = new URL(request.url).searchParams.get("since");
		const target = `https://day-hub/connect?date=${encodeURIComponent(date)}${since === null ? "" : `&since=${encodeURIComponent(since)}`}`;
		return namespace.get(namespace.idFromName(dayHubName(date)) as never).fetch(target, {
			headers: request.headers,
		});
	};
}

let app: WorkerApp | undefined;

/**
 * The isolate's one app, on `scopedDatabase`: what lives as long as the isolate (the refresh
 * single-flight, the session key, the fixture client's caches) is shared, while each unit
 * of work brings its own connection (`inDatabaseScope`). Built on first use, from that first
 * call's `env`. Its deferred writes go to the request's own queue (`ScopedBackgroundWork`, S216 AC 3), which the
 * Worker's `fetch` drains after the response.
 */
export function workerApp(env: WorkerEnv): WorkerApp
{
	app ??= createWorkerApp(env, scopedDatabase, {
		background: new ScopedBackgroundWork(),
	});
	return app;
}

/** Whether a cron tick may ingest or refresh schedule months (S194): always deployed; in local dev only with `BT_INGEST_TICK=1`. */
export function tickAllowed(env: WorkerEnv): boolean
{
	return env.BT_LOCAL !== "1" || env.BT_INGEST_TICK === "1";
}
