/**
 * S149: the `day-hub:<date>` Durable Object in Node, over fake state (`FakeDurableStorage`) and stand-ins for the
 * runtime's WebSocket pieces (the workerd test runs the real ones), with memory stores and a clock: what a viewer gets,
 * which games' ingest objects it leases (AC 2), that it pushes only what `readScheduleDay` reads (AC 3), newer versions
 * only (AC 4).
 */
import type {
	ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import {
	beforeAll, describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "./adapters/fixtures/mlb.js";
import type { HubSocket } from "./adapters/cloudflare/websocket.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "./adapters/memory/repos.js";
import { DayHubObject } from "./day-hub-object.js";
import { HUB_LEASE_MS } from "./services/hub-leases.js";
import { dayHubName } from "./services/day-hubs.js";
import { FakeDurableStorage } from "./services/fake-durable-storage.js";
import type { IngestDeps } from "./services/ingest.js";
import { readScheduleDay, switchGameState } from "./services/game-state.js";
import { storeSchedule } from "./services/ingest.js";
import type { GameFactory } from "./test/day-games.js";
import { gameFactory } from "./test/day-games.js";
import { useNodeDatabase } from "./test/node-database.js";
import { workerApp } from "./worker-app.js";

vi.mock("./adapters/cloudflare/websocket.js", () => ({
	openSocketPair: () =>
	{
		const server = {
			sent: [] as string[],
			send(message: string)
			{
				this.sent.push(message);
			},
			close: () => undefined,
		};
		return {
			client: {
				send: () => undefined,
				close: () => undefined,
			},
			server,
		};
	},
	upgradeResponse: () => new Response("upgraded", {
		status: 200,
	}),
	pingAutoResponse: () => "ping→pong",
}));

type TestSocket = HubSocket & { sent: string[] };

const DATE = "2026-11-20";
const OTHER = "2026-11-21";
const NOON = new Date(`${DATE}T12:00:00Z`);
let game: GameFactory;

beforeAll(async () =>
{
	game = await gameFactory();
});

/** Memory stores with a settable clock, and a writer for a day as the schedule refresh stores it. */
function stores()
{
	const clock = {
		now: NOON,
	};
	const deps: IngestDeps = {
		mlb: new FixtureMlbStatsClient(),
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		now: () => clock.now,
	};
	const write = (date: string, games: ScheduleGameSummary[]) => storeSchedule(deps, {
		date,
		games,
		fetchedAt: clock.now.toISOString(),
		windowMode: "active",
	} satisfies Unversioned<ScheduleDay>);
	/** The feed's write of a live game's new score (inside its window the feed owns its row, S150's switch). */
	const score = async (gamePk: number, date: string, startTime: string, runs: number) =>
	{
		const summary = game(gamePk, date, {
			startTime,
			live: true,
			homeRuns: runs,
		});
		clock.now = new Date(clock.now.getTime() + 1000);
		await switchGameState(deps, [{
			gamePk,
			source: "feed",
			state: {
				status: summary.status,
				linescore: summary.linescore,
				live: null,
			},
			officialDate: date,
			startTime,
		}], clock.now);
	};
	return {
		clock,
		deps,
		write,
		score,
	};
}

/** Fake Durable Object state that records what the hub asks of the runtime. */
function hubState()
{
	const sockets: TestSocket[] = [];
	return {
		storage: new FakeDurableStorage(),
		sockets,
		autoResponse: undefined as unknown,
		acceptWebSocket(socket: HubSocket)
		{
			sockets.push(socket as TestSocket);
		},
		getWebSockets: () => [...sockets],
		setWebSocketAutoResponse(pair: unknown)
		{
			this.autoResponse = pair;
		},
	};
}

/** A stand-in for `env.GAME_INGEST` recording the hub's lease calls as `<gamePk> <action>`. */
function ingestStub()
{
	const calls: string[] = [];
	const registered = new Set<number>();
	/** `<gamePk> <action>` calls that throw, as an ingest object reset by a deploy does. */
	const failing = new Set<string>();
	return {
		calls,
		registered,
		failing,
		namespace: {
			idFromName: (name: string) => name,
			get: (id: never) => ({
				fetch: async (input: string) =>
				{
					const { pathname, searchParams } = new URL(input);
					const gamePk = Number(String(id).split(":")[1]);
					const action = pathname.split("/").at(-1)!;
					calls.push(`${gamePk} ${action} ${searchParams.get("hub")}`);
					if (failing.has(`${gamePk} ${action}`)) throw new Error(`game-ingest:${gamePk} reset`);
					if (action === "register") registered.add(gamePk);
					if (action === "unregister") registered.delete(gamePk);
					return new Response(null, {
						status: action === "renew" && !registered.has(gamePk) ? 410 : 204,
					});
				},
			}),
		},
	};
}

function hub(deps: IngestDeps, ingest?: ReturnType<typeof ingestStub>)
{
	const state = hubState();
	const object = new DayHubObject(state, ingest ? {
		GAME_INGEST: ingest.namespace,
	} : {}, deps);
	return {
		state,
		object,
	};
}

const connect = (object: DayHubObject, date: string, since?: number) => object.fetch(new Request(`https://day-hub/connect?date=${date}${since === undefined ? "" : `&since=${since}`}`, {
	headers: {
		Upgrade: "websocket",
	},
}));
const publish = (object: DayHubObject) => object.fetch(new Request("https://day-hub/publish", {
	method: "POST",
	body: "{}",
}));
const pushes = (socket: TestSocket | undefined) => (socket?.sent ?? []).map((m) => JSON.parse(m) as ScheduleDay);
const homeRuns = (day: ScheduleDay | undefined, gamePk: number) => day?.games.find((g) => g.gamePk === gamePk)?.linescore?.teams.home.runs;
const leasesOf = (calls: string[], action: string) => calls.filter((c) => c.split(" ")[1] === action).map((c) => Number(c.split(" ")[0]));

describe("DayHubObject", () =>
{
	it("S149 AC 1 connect gets the day: a viewer's first message is the served day; hibernated sockets, pings by the runtime, viewer messages ignored", async () =>
	{
		const { deps, write } = stores();
		const served = await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: 2,
		})]);
		const { state, object } = hub(deps);
		expect(state.autoResponse).toBe("ping→pong");
		expect((await connect(object, DATE)).status).toBe(200);
		expect(dayHubName(DATE)).toBe(`day-hub:${DATE}`);
		const [first] = pushes(state.sockets[0]);
		expect(first?.date).toBe(DATE);
		expect(first?.version).toBe(served.version);
		expect(homeRuns(first, 1)).toBe(2);
		expect(object.webSocketMessage()).toBeUndefined();
		expect((await object.fetch(new Request("https://day-hub/elsewhere"))).status).toBe(404);
	});

	it("S149 AC 1 publish reaches every socket: a changed day goes to each open viewer once", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: 1,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		await connect(object, DATE);
		await score(1, DATE, `${DATE}T11:00:00Z`, 3);
		expect((await publish(object)).status).toBe(204);
		expect(state.sockets.map((s) => pushes(s).map((day) => homeRuns(day, 1)))).toEqual([[1, 3], [1, 3]]);
	});

	it("S149 AC 1 last viewer ends its leases: an earlier close keeps them; the last unregisters every game and stops renewing", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		}), game(2, DATE, {
			startTime: `${DATE}T13:00:00Z`,
		})]);
		const ingest = ingestStub();
		const { state, object } = hub(deps, ingest);
		await connect(object, DATE);
		await connect(object, DATE);
		const [a, b] = state.sockets;
		await object.webSocketClose(a!);
		expect(leasesOf(ingest.calls, "unregister")).toEqual([]);
		state.sockets.splice(0, 1);
		await object.webSocketClose(b!);
		expect(leasesOf(ingest.calls, "unregister").sort()).toEqual([1, 2]);
		expect(state.storage.alarmAt).toBeNull();
		// Without viewers the alarm does nothing.
		await object.alarm();
		expect(leasesOf(ingest.calls, "renew")).toEqual([]);
	});

	it("S149 AC 2 in window at connect: the first viewer registers the hub with each in-window game's ingest object, not a later one's, and arms the renewal", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		}), game(2, DATE, {
			startTime: `${DATE}T23:10:00Z`,
		})]);
		const ingest = ingestStub();
		const { state, object } = hub(deps, ingest);
		await connect(object, DATE);
		await connect(object, DATE);
		expect(ingest.calls).toEqual([`1 register day-hub:${DATE}`]);
		expect(state.storage.alarmAt).not.toBeNull();
	});

	it("S149 AC 2 enters its window after the next renewal: a night game is registered once the clock reaches its window; an ended one is let go", async () =>
	{
		const {
			clock, deps, write,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
		}), game(2, DATE, {
			startTime: `${DATE}T23:10:00Z`,
		})]);
		const ingest = ingestStub();
		const { object } = hub(deps, ingest);
		await connect(object, DATE);
		expect(ingest.calls).toEqual([`1 register day-hub:${DATE}`]);
		clock.now = new Date(`${DATE}T21:30:00Z`);
		await object.alarm();
		// Game 1 (scheduled 11:00, never started) is past its 3h trail; game 2 is 1h40m from first pitch.
		expect(ingest.calls.slice(1)).toEqual([`2 register day-hub:${DATE}`, `1 unregister day-hub:${DATE}`]);
		await object.alarm();
		expect(ingest.calls.at(-1)).toBe(`2 renew day-hub:${DATE}`);
	});

	it("S149 AC 2 another date never: a live game of the next day is never leased by this day's hub", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		})]);
		await write(OTHER, [game(9, OTHER, {
			startTime: `${OTHER}T11:00:00Z`,
			live: true,
		})]);
		const ingest = ingestStub();
		const { object } = hub(deps, ingest);
		await connect(object, DATE);
		await object.alarm();
		expect(ingest.calls.some((c) => c.startsWith("9 "))).toBe(false);
		expect(leasesOf(ingest.calls, "register")).toEqual([1]);
	});

	it("S149 AC 2 doubleheader: both games of the date in their windows are leased", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T10:05:00Z`,
			live: true,
		}), game(2, DATE, {
			startTime: `${DATE}T13:35:00Z`,
		})]);
		const ingest = ingestStub();
		const { object } = hub(deps, ingest);
		await connect(object, DATE);
		expect(leasesOf(ingest.calls, "register")).toEqual([1, 2]);
	});

	it("S149 AC 3 new score: after a game's write, the next push carries its new score at the day's new version", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		const first = await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: 0,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		await score(1, DATE, `${DATE}T11:00:00Z`, 4);
		await publish(object);
		const [, pushed] = pushes(state.sockets[0]);
		expect(homeRuns(pushed, 1)).toBe(4);
		expect(pushed?.version).toBeGreaterThan(first.version);
	});

	it("S149 AC 3 two games: two games of the date updated together are both in the push that follows, and a second publish with nothing new sends nothing", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		const both = (a: number, b: number) => [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: a,
		}), game(2, DATE, {
			startTime: `${DATE}T11:05:00Z`,
			live: true,
			homeRuns: b,
		})];
		await write(DATE, both(0, 0));
		const { state, object } = hub(deps);
		await connect(object, DATE);
		await score(1, DATE, `${DATE}T11:00:00Z`, 2);
		await score(2, DATE, `${DATE}T11:05:00Z`, 5);
		await publish(object);
		await publish(object);
		const sent = pushes(state.sockets[0]);
		expect(sent).toHaveLength(2);
		expect([homeRuns(sent[1], 1), homeRuns(sent[1], 2)]).toEqual([2, 5]);
	});

	it("S149 AC 3 failed read pushes nothing: a read that throws sends no message; the hub writes nothing", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		// A change the reads would carry, had they worked.
		await score(1, DATE, `${DATE}T11:00:00Z`, 6);
		const upsert = vi.spyOn(deps.schedules, "upsert");
		const writeStates = vi.spyOn(deps.gameStates, "write");
		vi.spyOn(deps.schedules, "getWithServedBase").mockRejectedValueOnce(new Error("database gone")).mockRejectedValueOnce(new Error("database gone"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await publish(object);
		await object.alarm();
		expect(pushes(state.sockets[0])).toHaveLength(1);
		expect(upsert).not.toHaveBeenCalled();
		expect(writeStates).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("S149 AC 2 a lease call that fails on connect: the viewer still gets the day, the other game is leased and the renewal alarm is armed; the next renewal registers the failed one", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		}), game(2, DATE, {
			startTime: `${DATE}T11:30:00Z`,
			live: true,
		})]);
		const ingest = ingestStub();
		ingest.failing.add("1 register");
		const { state, object } = hub(deps, ingest);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		expect((await connect(object, DATE)).status).toBe(200);
		expect(pushes(state.sockets[0]).map((d) => d.date)).toEqual([DATE]);
		expect([...ingest.registered]).toEqual([2]);
		expect(state.storage.alarmAt).not.toBeNull();
		ingest.failing.clear();
		await object.alarm();
		expect([...ingest.registered].sort()).toEqual([1, 2]);
		warn.mockRestore();
	});

	it("S149 AC 2 a lease call that fails on renewal: the other game is still renewed, the push still goes out and the alarm is re-armed at half a lease", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		}), game(2, DATE, {
			startTime: `${DATE}T11:30:00Z`,
			live: true,
		})]);
		const ingest = ingestStub();
		const { state, object } = hub(deps, ingest);
		await connect(object, DATE);
		ingest.failing.add("1 renew");
		await score(2, DATE, `${DATE}T11:30:00Z`, 3);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		state.storage.alarmAt = null;
		const before = Date.now();
		await object.alarm();
		expect(ingest.calls.slice(-2)).toEqual([`1 renew day-hub:${DATE}`, `2 renew day-hub:${DATE}`]);
		expect(homeRuns(pushes(state.sockets[0]).at(-1), 2)).toBe(3);
		expect(state.storage.alarmAt).toBeGreaterThanOrEqual(before + HUB_LEASE_MS / 2);
		expect(state.storage.alarmAt).toBeLessThanOrEqual(Date.now() + HUB_LEASE_MS / 2);
		warn.mockRestore();
	});

	it("S149 AC 2 a lapsed lease is registered again at the next renewal", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		})]);
		const ingest = ingestStub();
		const { object } = hub(deps, ingest);
		await connect(object, DATE);
		// The ingest object let the lease lapse (it answers the renewal 410).
		ingest.registered.clear();
		await object.alarm();
		expect(ingest.calls.slice(-2)).toEqual([`1 renew day-hub:${DATE}`, `1 register day-hub:${DATE}`]);
	});

	it("S149 AC 2 two viewers connecting at once: the first still leases the day's in-window games", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		})]);
		const ingest = ingestStub();
		const { object } = hub(deps, ingest);
		await Promise.all([connect(object, DATE), connect(object, DATE)]);
		expect(leasesOf(ingest.calls, "register")).toEqual([1]);
	});

	it("a connect re-arms the renewal only when no alarm is set", async () =>
	{
		const { deps, write } = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		const armed = state.storage.alarmAt;
		await connect(object, DATE);
		expect(state.storage.alarmAt).toBe(armed);
		state.storage.alarmAt = null;
		await connect(object, DATE);
		expect(state.storage.alarmAt).not.toBeNull();
	});

	it("a hub that had no viewers sends a new viewer the day as it is now, not the one it last held", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: 0,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		const [first] = state.sockets;
		state.sockets.length = 0;
		await object.webSocketClose(first!);
		await score(1, DATE, `${DATE}T11:00:00Z`, 8);
		await connect(object, DATE);
		expect(homeRuns(pushes(state.sockets[0]).at(-1), 1)).toBe(8);
	});

	it("S149 AC 4 hub: a duplicate publish is dropped, a reconnect with ?since at the current version gets nothing and one behind gets the whole day", async () =>
	{
		const {
			deps, write, score,
		} = stores();
		await write(DATE, [game(1, DATE, {
			startTime: `${DATE}T11:00:00Z`,
			live: true,
			homeRuns: 0,
		})]);
		const { state, object } = hub(deps);
		await connect(object, DATE);
		await score(1, DATE, `${DATE}T11:00:00Z`, 1);
		await publish(object);
		const newer = (await readScheduleDay(deps, DATE, NOON))!;
		await publish(object);
		const versions = pushes(state.sockets[0]).map((d) => d.version);
		expect(versions).toHaveLength(2);
		expect(versions[0]).toBeLessThan(newer.version);
		expect(versions[1]).toBe(newer.version);
		await connect(object, DATE, newer.version);
		await connect(object, DATE, newer.version - 1);
		expect(pushes(state.sockets[1])).toEqual([]);
		expect(pushes(state.sockets[2]).map((d) => d.version)).toEqual([newer.version]);
	});

	it("reads nothing it can't: a hub given no date, or a date with nothing stored, sends nothing and leases nothing; an alarm with no viewers does nothing", async () =>
	{
		const { deps } = stores();
		const ingest = ingestStub();
		const { state, object } = hub(deps, ingest);
		// A socket the runtime kept across an eviction, with nothing stored yet: a publish reads no day.
		const sent: string[] = [];
		state.acceptWebSocket({
			sent,
			send: (message: string) => void sent.push(message),
			close: () => undefined,
		} as unknown as HubSocket);
		await publish(object);
		expect(pushes(state.sockets[0])).toEqual([]);
		const empty = hub(deps, ingest);
		await connect(empty.object, OTHER);
		await empty.object.fetch(new Request("https://day-hub/connect", {
			headers: {
				Upgrade: "websocket",
			},
		}));
		expect(empty.state.sockets.map(pushes)).toEqual([[], []]);
		expect(ingest.calls).toEqual([]);
		const quiet = hub(deps, ingest);
		await quiet.object.alarm();
		expect(quiet.state.storage.alarmAt).toBeNull();
	});
});

describe("DayHubObject in the isolate's composition", () =>
{
	beforeAll(async () =>
	{
		await useNodeDatabase();
	});

	it("with no deps given it reads through the Worker's composition on the database in scope, on the real clock", async () =>
	{
		const app = workerApp({}).ingest;
		await storeSchedule(app, {
			date: DATE,
			games: [game(1, DATE, {
				startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
				live: true,
			})],
			fetchedAt: new Date().toISOString(),
			windowMode: "active",
		});
		const state = hubState();
		const object = new DayHubObject(state, {});
		await connect(object, DATE);
		expect(pushes(state.sockets[0]).map((d) => d.date)).toEqual([DATE]);
		await object.alarm();
		expect(state.storage.alarmAt).not.toBeNull();
	});
});
