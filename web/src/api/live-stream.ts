/**
 * The live stream itself (S19): see `live.ts` for what it does and why. Kept in its own
 * module so the browser loads it only when a game (or, S149, a scoreboard day) in its window
 * is open — it stays out of the entry bundle (ADR-026's 200 KB budget).
 *
 * One stream for both resources (S149, generalized rather than copied): `LiveStream` owns the
 * socket, the reconnect with backoff and `?since=`, the polling fallback and the open state;
 * what differs is the address, the cache entry and what a skipped version means (`gaps`).
 */
import type { Versioned } from "@bt/domain";
import { applyIfNewer } from "@bt/domain";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { GamePayload } from "./game.js";
import { gameKey } from "./game.js";

/** Reconnect and fallback timing; tests shorten nothing, they drive fake timers. */
export const LIVE_TIMING = {
	/** First reconnect delay, doubled per failure up to `maxDelayMs`. */
	baseDelayMs: 1000,
	maxDelayMs: 30 * 1000,
	/** Socket closes in a row before falling back to polling. */
	maxFailures: 5,
	/** Polling cadence once fallen back (S25's in-window refetch interval). */
	pollMs: 15 * 1000,
} as const;

/** The part of the browser's WebSocket the stream uses. */
export type LiveSocket = {
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	close(): void;
};

/** The live route for `gamePk` on the page's own host, `ws:` or `wss:` to match. */
export function liveUrl(gamePk: number, since?: number, location: Pick<Location, "protocol" | "host"> = window.location): string
{
	const scheme = location.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${location.host}/api/v1/games/${gamePk}/live${since === undefined ? "" : `?since=${since}`}`;
}

/** The scoreboard's live route for `date` (S149, `GET /api/v1/schedule/live?date=`), as {@link liveUrl} builds a game's. */
export function liveDayUrl(date: string, since?: number, location: Pick<Location, "protocol" | "host"> = window.location): string
{
	const scheme = location.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${location.host}/api/v1/schedule/live?date=${date}${since === undefined ? "" : `&since=${since}`}`;
}

/**
 * The wait before reconnect attempt `attempt` (0-based): exponential from `baseDelayMs`,
 * capped, then scaled by a random factor in [0.5, 1) so many viewers dropped together
 * don't all come back in the same instant.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number
{
	const exponential = Math.min(LIVE_TIMING.maxDelayMs, LIVE_TIMING.baseDelayMs * 2 ** attempt);
	return Math.round(exponential * (0.5 + random() / 2));
}

/** What every stream is given, whatever it streams. */
type StreamOptions<T> = {
	client: QueryClient;
	/** The resource's cache writer (`writeGame`, `writeScheduleDay`), the only way a payload reaches the cache. */
	write: (payload: T) => void;
	openSocket?: (url: string) => LiveSocket;
	random?: () => number;
	/**
	 * Told each time the socket becomes open, and each time it stops being open (closed, a
	 * reconnect wait, the polling fallback, stopped) (S148): whether pushes are arriving, which
	 * the page's Live marker shows. Called only on a change, never with the same value twice.
	 */
	onOpenChange?: (open: boolean) => void;
};

/** A game's stream (S19): `gamePk` names the game. */
export type LiveStreamOptions = StreamOptions<GamePayload> & { gamePk: number };

/**
 * What one resource's stream needs besides the shared options: its cache entry (`queryKey`), its address for a
 * `since` version (`url`) and its gap rule. `gaps: "refetch"` (a game, S19): a version skipped on the way means an
 * update went missing, so the resource is refetched rather than written. `gaps: "apply"` (a day, S149 AC 4): every
 * push is the whole day, so any newer version is applied at once, however far ahead.
 */
export type LiveResource = {
	queryKey: QueryKey;
	url: (since?: number) => string;
	gaps: "refetch" | "apply";
};

/**
 * One resource's live stream: the socket, reconnects with backoff and `?since=`, the polling fallback (refetching the
 * resource's query), and its open state (S148).
 */
export class LiveStream<T extends Versioned>
{
	private socket: LiveSocket | null = null;
	private failures = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private stopped = false;
	/** Whether the current socket has opened and not closed since (S148). */
	private open = false;
	private readonly openSocket: (url: string) => LiveSocket;

	constructor(private readonly options: StreamOptions<T>, private readonly resource: LiveResource)
	{
		this.openSocket = options.openSocket ?? ((url) => new WebSocket(url) as unknown as LiveSocket);
	}

	/** The version the cache holds for this resource, if any. */
	private cachedVersion(): number | undefined
	{
		return this.options.client.getQueryData<T>(this.resource.queryKey)?.version;
	}

	start(): void
	{
		this.stopped = false;
		window.addEventListener("online", this.retryNow);
		document.addEventListener("visibilitychange", this.onVisibility);
		this.connect();
	}

	/** Closes the socket and stops every timer and listener (unmount, leaving the route). */
	stop(): void
	{
		this.stopped = true;
		window.removeEventListener("online", this.retryNow);
		document.removeEventListener("visibilitychange", this.onVisibility);
		clearTimeout(this.reconnectTimer);
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		this.closeSocket();
		this.setOpen(false);
	}

	/** Records the socket's open state and tells the page when it changes (S148). */
	private setOpen(open: boolean): void
	{
		if (this.open === open) return;
		this.open = open;
		this.options.onOpenChange?.(open);
	}

	private closeSocket(): void
	{
		const socket = this.socket;
		this.socket = null;
		if (!socket) return;
		socket.onclose = null;
		socket.close();
	}

	private connect(): void
	{
		const socket = this.openSocket(this.resource.url(this.cachedVersion()));
		this.socket = socket;
		// Open only once the socket says so: a socket being connected isn't receiving pushes yet.
		socket.onopen = () =>
		{
			this.failures = 0;
			this.setOpen(true);
		};
		socket.onmessage = (event) => this.receive(event.data);
		socket.onclose = () =>
		{
			this.socket = null;
			this.setOpen(false);
			this.failures += 1;
			if (this.failures >= LIVE_TIMING.maxFailures) this.startPolling();
			else this.reconnectTimer = setTimeout(() => this.connect(), reconnectDelay(this.failures - 1, this.options.random));
		};
	}

	/** One payload: written if newer (ADR-022), or, for a resource that refetches on a gap, a refetch if a version was skipped. */
	private receive(data: unknown): void
	{
		const payload = JSON.parse(String(data)) as T;
		const current = this.options.client.getQueryData<T>(this.resource.queryKey) ?? null;
		if (this.resource.gaps === "refetch" && current && payload.version > current.version + 1)
		{
			void this.options.client.refetchQueries({
				queryKey: this.resource.queryKey,
			});
			return;
		}
		if (applyIfNewer(current, payload) === payload && payload !== current) this.options.write(payload);
	}

	private startPolling(): void
	{
		if (this.pollTimer !== undefined) return;
		this.pollTimer = setInterval(() =>
		{
			void this.options.client.refetchQueries({
				queryKey: this.resource.queryKey,
			});
		}, LIVE_TIMING.pollMs);
	}

	/** Back online, or the tab shown again: try the socket now, from a clean slate. */
	private readonly retryNow = (): void =>
	{
		if (this.stopped || this.socket) return;
		clearTimeout(this.reconnectTimer);
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		this.failures = 0;
		this.connect();
	};

	private readonly onVisibility = (): void =>
	{
		if (document.visibilityState === "visible") this.retryNow();
	};
}

/** A game's live stream (S19): `GET /api/v1/games/:gamePk/live`, refetching the game on a skipped version. */
export class LiveGameStream extends LiveStream<GamePayload>
{
	constructor(options: LiveStreamOptions)
	{
		super(options, {
			queryKey: gameKey(options.gamePk),
			url: (since) => liveUrl(options.gamePk, since),
			gaps: "refetch",
		});
	}
}

/** A scoreboard day's stream options (S149): `date` names the day. */
export type LiveDayStreamOptions<T> = StreamOptions<T> & {
	date: string;
	queryKey: QueryKey;
};

/**
 * A scoreboard day's live stream (S149 AC 4, AC 6): `GET /api/v1/schedule/live?date=`, each push the whole day, so any
 * newer version is applied at once. `queryKey` is the day's cache entry (`scheduleKey`), passed in so this module
 * needn't load the schedule resource.
 */
export class LiveDayStream<T extends Versioned> extends LiveStream<T>
{
	constructor(options: LiveDayStreamOptions<T>)
	{
		super(options, {
			queryKey: options.queryKey,
			url: (since) => liveDayUrl(options.date, since),
			gaps: "apply",
		});
	}
}
