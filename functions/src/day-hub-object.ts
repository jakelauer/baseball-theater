/**
 * The `day-hub:<YYYY-MM-DD>` Durable Object (S149; ADR-020 as amended 2026-11-16): the scoreboard's one live
 * connection per day. It holds the day's viewers' WebSockets through the Hibernation API, as `GameHubObject` does for a
 * game (an idle hub costs nothing between updates, the runtime answers pings), and pushes the whole served day, the
 * shape `GET /api/v1/schedule?date=` serves, newer versions only (`LiveHubState`, ADR-022), so a missed push is healed
 * by the next. One-way: what viewers send is ignored.
 *
 * It only reads (AC 3): each push is S150's read-only `readScheduleDay` (the stored day joined to its games' states,
 * never refreshed from MLB), and it writes nothing to Postgres; which source feeds a game's score is S150's switch alone.
 *
 * What makes it push (AC 2): while it has viewers it holds a lease (`HubLeases`, the game hub's own routes on each
 * ingest object) with every game of its date in its live window, so each game's ingest publishes to it after writing
 * the game (or mending its row); and every schedule writer that changes an in-window day calls its `/publish` too
 * (`DayHubCalls`). Either way the body is ignored and the day is read afresh. Every half lease an alarm renews the
 * leases and re-reads the day, registering a game that has entered its window since (a night game, a doubleheader's
 * second game), letting go of one whose window has ended, and pushing the day if it moved on; the last viewer leaving
 * gives up every lease.
 */
import type { ScheduleDay, ScheduleDayResponse } from "@bt/domain";
import { isGameInActiveWindow, toScheduleDayResponse } from "@bt/domain";
import { inDatabaseScope } from "./adapters/postgres/connect.js";
import type { HyperdriveBinding } from "./adapters/postgres/connect.js";
import {
	openSocketPair, pingAutoResponse, upgradeResponse,
} from "./adapters/cloudflare/websocket.js";
import type { HubSocket } from "./adapters/cloudflare/websocket.js";
import type { GameHubState, IngestLease } from "./game-hub-object.js";
import { ingestLease } from "./game-hub-object.js";
import { dayHubName } from "./services/day-hubs.js";
import type { GameStateDeps } from "./services/game-state.js";
import { readScheduleDay, withSuspendedAt } from "./services/game-state.js";
import { HUB_LEASE_MS } from "./services/hub-leases.js";
import { LiveHubState, liveMessage } from "./services/live-hub.js";
import type { WorkerEnv } from "./worker-app.js";
import { workerApp } from "./worker-app.js";

/** The part of the Durable Object state the day hub uses: the game hub's. */
export type DayHubState = GameHubState;

/** What the day hub reads through: the isolate's composition (`workerApp`), or a test's deps. */
export type DayHubDeps = GameStateDeps & { now?: () => Date };

const DATE_KEY = "date";
/** The gamePks the hub holds a lease with, so renewal knows whom to renew and whom to let go. */
const LEASED_KEY = "leased";

export class DayHubObject
{
	private readonly hub: LiveHubState<ScheduleDayResponse>;
	private readonly lease: IngestLease | null;
	private readonly hyperdrive: HyperdriveBinding | undefined;
	private readonly deps: DayHubDeps;
	/** Whether a test gave the deps: then there is no database scope to open. */
	private readonly injected: boolean;

	/** `deps` replaces the isolate's composition in tests; the Worker passes none. */
	constructor(private readonly state: DayHubState, env: WorkerEnv, deps?: DayHubDeps)
	{
		state.setWebSocketAutoResponse(pingAutoResponse());
		this.deps = deps ?? workerApp(env).ingest;
		this.injected = deps !== undefined;
		this.hub = new LiveHubState<ScheduleDayResponse>(async () => (await this.read())?.response ?? null);
		this.lease = env.GAME_INGEST ? ingestLease(env.GAME_INGEST) : null;
		this.hyperdrive = env.HYPERDRIVE;
	}

	/**
	 * `GET /connect?date=&since=` (a WebSocket upgrade, forwarded by the live route) adds a viewer; `POST /publish`
	 * (from a game's ingest object, or a schedule writer) says the day may have changed.
	 */
	fetch(request: Request): Promise<Response>
	{
		return this.scoped(() => this.route(request));
	}

	/** Runs `work` on its own database connection (S51), as every call, close and alarm that reads the day does. */
	private scoped<T>(work: () => Promise<T>): Promise<T>
	{
		return this.injected ? work() : inDatabaseScope(this.hyperdrive, work);
	}

	private now(): Date
	{
		return this.deps.now?.() ?? new Date();
	}

	/** The served day and its response shape, or null when nothing is stored for the date or the read failed. */
	private async read(): Promise<{ day: ScheduleDay;
		response: ScheduleDayResponse; } | null>
	{
		const date = await this.state.storage.get<string>(DATE_KEY);
		if (date === undefined) return null;
		try
		{
			const day = await readScheduleDay(this.deps, date, this.now());
			return day ? {
				day,
				response: toScheduleDayResponse(day),
			} : null;
		}
		catch (error)
		{
			// A failed read pushes nothing (AC 3); the next publish or renewal reads again.
			console.warn(`${dayHubName(date)}: day read failed; nothing pushed`, error);
			return null;
		}
	}

	/** Reads the day and sends it to every viewer if it is newer than what they have. */
	private async push(read: Awaited<ReturnType<DayHubObject["read"]>>): Promise<void>
	{
		if (!read || !await this.hub.accept(read.response)) return;
		const message = liveMessage(read.response);
		for (const socket of this.state.getWebSockets()) socket.send(message);
	}

	private async route(request: Request): Promise<Response>
	{
		const url = new URL(request.url);
		if (url.pathname === "/publish" && request.method === "POST")
		{
			// No viewers: nothing to push, and no socket can be opened without the route's own read.
			if (this.state.getWebSockets().length > 0) await this.push(await this.read());
			return new Response(null, {
				status: 204,
			});
		}
		if (url.pathname === "/connect" && request.headers.get("Upgrade") === "websocket")
		{
			const date = url.searchParams.get("date") ?? "";
			const since = url.searchParams.get("since");
			await this.state.storage.put(DATE_KEY, date);
			const { client, server } = openSocketPair();
			this.state.acceptWebSocket(server);
			const current = await this.hub.onConnect(since === null ? undefined : Number(since));
			if (current) server.send(liveMessage(current));
			if (this.state.getWebSockets().length === 1)
			{
				await this.syncLeases((await this.read())?.day ?? null);
				await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
			}
			return upgradeResponse(client);
		}
		return new Response("not found", {
			status: 404,
		});
	}

	/** One-way: a viewer has nothing to say to the hub (pings are answered by the runtime). */
	webSocketMessage(): void
	{
		// Ignored by design (ADR-020).
	}

	/** When the last viewer leaves, the hub gives up every lease and stops renewing. */
	async webSocketClose(socket: HubSocket): Promise<void>
	{
		if (this.state.getWebSockets().some((open) => open !== socket)) return;
		await this.state.storage.deleteAlarm();
		await this.syncLeases(null);
	}

	/**
	 * While viewers remain: re-reads the day, renews (or re-registers, or takes, or lets go of) its games' leases to
	 * match the games now in their window, and pushes the day if it moved on, so a call that never arrived is healed
	 * within half a lease.
	 */
	alarm(): Promise<void>
	{
		return this.scoped(async () =>
		{
			if (this.state.getWebSockets().length === 0) return;
			const read = await this.read();
			if (read)
			{
				await this.syncLeases(read.day);
				await this.push(read);
			}
			await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
		});
	}

	/**
	 * Holds a lease with exactly the games of `day` in their live window (`isGameInActiveWindow`, a suspended game
	 * judged from when BT saw it suspended, `withSuspendedAt`), none when `day` is null: registers the new ones, renews
	 * the rest (registering again one that lapsed) and unregisters the ones that left.
	 */
	private async syncLeases(day: ScheduleDay | null): Promise<void>
	{
		const date = await this.state.storage.get<string>(DATE_KEY);
		if (!this.lease || date === undefined) return;
		const hubId = dayHubName(date);
		const now = this.now();
		const held = new Set(await this.state.storage.get<number[]>(LEASED_KEY) ?? []);
		const wanted = new Set(day ? (await withSuspendedAt(this.deps, day.date, day.games, now))
			.filter((game) => isGameInActiveWindow(game, now))
			.map((game) => game.gamePk) : []);
		for (const gamePk of wanted)
		{
			if (!held.has(gamePk) || !(await this.lease("renew", gamePk, hubId)).ok) await this.lease("register", gamePk, hubId);
		}
		for (const gamePk of held) if (!wanted.has(gamePk)) await this.lease("unregister", gamePk, hubId);
		await this.state.storage.put(LEASED_KEY, [...wanted].sort((a, b) => a - b));
	}
}
