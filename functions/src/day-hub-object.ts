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
		this.lease = env.GAME_INGEST ? ingestLease(env.GAME_INGEST, env.BT_INGEST_LOCATION_HINT) : null;
		this.hyperdrive = env.HYPERDRIVE;
	}

	/**
	 * `GET /connect?date=&since=` (a WebSocket upgrade, forwarded by the live route) adds a viewer; `POST /publish`
	 * (from a game's ingest object, or a schedule writer) says the day may have changed.
	 */
	fetch(request: Request): Promise<Response>
	{
		const publish = new URL(request.url).pathname === "/publish";
		return this.scoped(() => this.route(request), publish ? "publish" : "fetch");
	}

	/**
	 * Runs `work` on its own database connection (S51), as every call, close and alarm that reads the day does, logging
	 * its round trips (S220, kind `day-hub`, `job` the entry point), as the hub re-reads its day where it was made, not
	 * beside Neon. A `/publish` that read nothing writes no line, so the most frequent call adds no idle lines.
	 */
	private scoped<T>(work: () => Promise<T>, job: "fetch" | "publish" | "alarm"): Promise<T>
	{
		return this.injected ? work() : inDatabaseScope(this.hyperdrive, work, undefined, undefined, {
			kind: "day-hub",
			job,
			quietWhenNone: job === "publish",
		});
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
			// Once the socket is accepted the upgrade is always answered: a failed lease sync or read must never leave
			// an accepted socket with no answer, and the renewal alarm then retries what failed.
			try
			{
				await this.connect(server, since === null ? undefined : Number(since));
			}
			catch (error)
			{
				console.warn(`${dayHubName(date)}: connect incomplete; the renewal alarm retries`, error);
			}
			await this.armIfIdle();
			return upgradeResponse(client);
		}
		return new Response("not found", {
			status: 404,
		});
	}

	/**
	 * A new viewer's first send and, for the first viewer, the leases. The day is read afresh first and taken if newer
	 * (a hub that had no viewers may hold a stale day), passed on to the viewers already there, then the new viewer gets
	 * it unless its `since` already has it. A lease sync that fails is logged and the send still happens.
	 */
	private async connect(server: HubSocket, since: number | undefined): Promise<void>
	{
		// Judged before the read: two viewers connecting during it would both see two sockets, and neither would lease.
		const first = this.state.getWebSockets().length === 1;
		const read = await this.read();
		if (first)
		{
			try
			{
				await this.syncLeases(read?.day ?? null);
			}
			catch (error)
			{
				console.warn("day hub: lease sync failed on connect; the renewal alarm retries", error);
			}
		}
		if (read && await this.hub.accept(read.response))
		{
			const message = liveMessage(read.response);
			for (const socket of this.state.getWebSockets()) if (socket !== server) socket.send(message);
		}
		const current = await this.hub.onConnect(since);
		if (current) server.send(liveMessage(current));
	}

	/** Arms the renewal alarm when none is set (every connect asks, so a hub whose first connect failed still renews). */
	private async armIfIdle(): Promise<void>
	{
		try
		{
			if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
		}
		catch (error)
		{
			console.warn("day hub: renewal alarm not armed", error);
		}
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
	 * within half a lease. It never rethrows: a failure is logged and the next alarm is armed at the usual half lease
	 * either way, so the hub keeps one renewal every 30 seconds rather than leaning on the runtime's alarm retries.
	 */
	async alarm(): Promise<void>
	{
		if (this.state.getWebSockets().length === 0) return;
		try
		{
			await this.scoped(async () =>
			{
				const read = await this.read();
				if (!read) return;
				try
				{
					await this.syncLeases(read.day);
				}
				catch (error)
				{
					console.warn("day hub: lease sync failed on renewal; retried at the next", error);
				}
				await this.push(read);
			}, "alarm");
		}
		catch (error)
		{
			console.warn("day hub: renewal failed; retried at the next", error);
		}
		try
		{
			await this.state.storage.setAlarm(Date.now() + HUB_LEASE_MS / 2);
		}
		catch (error)
		{
			console.warn("day hub: renewal alarm not re-armed", error);
		}
	}

	/**
	 * Holds a lease with exactly the games of `day` in their live window (`isGameInActiveWindow`, a suspended game
	 * judged from when BT saw it suspended, `withSuspendedAt`), none when `day` is null: registers the new ones, renews
	 * the rest (registering again one that lapsed) and unregisters the ones that left. Each game's lease call stands
	 * alone: one that fails (an ingest object reset by a deploy) is logged and left out of the stored list, so the next
	 * renewal registers it again, and the others still go through.
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
		const lease = this.lease;
		const leased: number[] = [];
		for (const gamePk of wanted)
		{
			try
			{
				if (!held.has(gamePk) || !(await lease("renew", gamePk, hubId)).ok)
				{
					const registered = await lease("register", gamePk, hubId);
					if (!registered.ok) throw new Error(`register answered ${registered.status}`);
				}
				leased.push(gamePk);
			}
			catch (error)
			{
				console.warn(`${hubId}: lease with game ${gamePk} not held; retried at the next renewal`, error);
			}
		}
		for (const gamePk of held)
		{
			if (wanted.has(gamePk)) continue;
			try
			{
				await lease("unregister", gamePk, hubId);
			}
			catch (error)
			{
				// Its lease lapses on its own within a minute.
				console.warn(`${hubId}: lease with game ${gamePk} not given up; it lapses`, error);
			}
		}
		await this.state.storage.put(LEASED_KEY, leased.sort((a, b) => a - b));
	}
}
