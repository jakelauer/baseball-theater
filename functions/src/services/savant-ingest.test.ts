/**
 * S103: Baseball Savant's per-pitch game feed — recorded once and read from disk (AC 1), asked on Savant's own host by
 * the HTTP client and never inside the live feed's fetch (AC 3), pulled by the game's ingest object on its own bounded
 * cadence and merged in as it arrives (AC 5), and optional: a failing or empty Savant leaves the game as it was (AC 6).
 */
import type { GameSnapshot, SavantPitch } from "@bt/domain";
import { DEFAULT_CADENCE } from "@bt/domain";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { bundledFixtureFiles } from "../adapters/fixtures/bundled.js";
import { FixtureClient } from "../adapters/fixtures/fixture-client.js";
import { FIXTURES_ROOT, FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { HttpMlbStatsClient, SAVANT_BASE_URL } from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import { GameIngest } from "./game-ingest.js";
import type { IngestDeps } from "./ingest.js";
import { recordedFetch } from "./live-fixture.js";
import { rawEndpoints } from "./recorder.js";
import { pullSavant, storeSavant } from "./savant-ingest.js";

const T0 = new Date("2026-10-30T12:00:00Z");
const INTERVAL = DEFAULT_CADENCE.intervalMs;
const SAVANT_EVERY = DEFAULT_CADENCE.savantIntervalMs;
const TARGET = {
	date: "2026-09-05",
	gamePk: 823823,
};

afterEach(() =>
{
	vi.restoreAllMocks();
});

/**
 * One game's ingest over the fixtures (745001 is in progress, so always in its window), its live fetch optionally
 * rewritten, Savant answered by `savant`, and every write and publish recorded in order.
 */
function setup(savant: (gamePk: number) => Promise<SavantPitch[] | null>, rewrite: (game: GameSnapshot) => GameSnapshot = (game) => game)
{
	const real = new FixtureMlbStatsClient();
	const mlb = new FixtureMlbStatsClient();
	const order: string[] = [];
	mlb.fetchGame = async (pk: number) =>
	{
		order.push("fetchGame");
		return {
			game: rewrite((await real.fetchGame(pk)).game as GameSnapshot),
		};
	};
	const fetchSavantGameFeed = vi.fn(async (pk: number) =>
	{
		order.push("savant");
		return savant(pk);
	});
	mlb.fetchSavantGameFeed = fetchSavantGameFeed;
	const games = new InMemoryGameRepository();
	const upsertMany = games.upsertMany.bind(games);
	games.upsertMany = async (batch) =>
	{
		order.push("write");
		return upsertMany(batch);
	};
	const deps: IngestDeps = {
		mlb,
		...memoryScheduleStores(),
		games,
		projections: new InMemoryGameProjectionRepository(),
	};
	const published: GameSnapshot[] = [];
	const storage = new FakeDurableStorage();
	const ingest = new GameIngest(storage, deps, async (_hub, snapshot) =>
	{
		order.push("publish");
		published.push(snapshot);
	});
	return {
		deps,
		fetchSavantGameFeed,
		games,
		ingest,
		order,
		published,
		storage,
	};
}

/** A pitch for 745001, which has no plays recorded: one at-bat of 823823's, its first pitch renamed and given `endTime`. */
const PLAY_ID = "745001-first-pitch";

async function withPitch(endTime: string): Promise<(game: GameSnapshot) => GameSnapshot>
{
	const atBat = (await new FixtureMlbStatsClient().fetchGame(823823)).game.plays[0];
	if (!atBat) throw new Error("823823 has no at-bat");
	const pitch = {
		...atBat.pitches[0] as GameSnapshot["plays"][number]["pitches"][number],
		playId: PLAY_ID,
		endTime,
	};
	return (game) => ({
		...game,
		plays: [{
			...atBat,
			pitches: [pitch],
		}],
	});
}

describe("Savant's recording (S103 AC 1)", () =>
{
	it("S103 AC 1: the recording is Savant's answer to its gf URL for 823823, and the fixture client reads it from disk, never the network", async () =>
	{
		expect(rawEndpoints(TARGET).find((endpoint) => endpoint.name === "savant-gf-823823")?.url).toBe("https://baseballsavant.mlb.com/gf?game_pk=823823");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
		const before = Date.now();
		const pitches = await new FixtureMlbStatsClient().fetchSavantGameFeed(823823);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(pitches).toHaveLength(340);
		expect(pitches?.every((p) => p.version >= before)).toBe(true);
		expect(await new FixtureMlbStatsClient().fetchSavantGameFeed(745001)).toBeNull();
	});

	it("S103 AC 1: the Worker's bundled fixtures, which leave the 3 MB recording out, serve the projection kept in the game file; the game itself never carries it", async () =>
	{
		const bundled = new FixtureClient(bundledFixtureFiles);
		const fromDisk = await new FixtureMlbStatsClient(FIXTURES_ROOT).fetchSavantGameFeed(823823);
		const projected = await bundled.fetchSavantGameFeed(823823);
		const strip = (pitches: SavantPitch[] | null | undefined) => pitches?.map(({ version: _v, ...rest }) => rest);
		expect(strip(projected)).toEqual(strip(fromDisk));
		expect((await bundled.fetchGame(823823)).game).not.toHaveProperty("savant");
		expect((await new FixtureMlbStatsClient().fetchGame(823823)).game).not.toHaveProperty("savant");
	});
});

describe("the HTTP client (S103 AC 3)", () =>
{
	it("S103 AC 3: fetchSavantGameFeed asks Savant's own host (its own base URL, apart from the Stats API's) and maps the answer, stamped with the pull's time", async () =>
	{
		const asked: string[] = [];
		const answer = recordedFetch(`${FIXTURES_ROOT}/raw`, TARGET);
		const now = new Date("2026-09-05T23:00:00Z");
		const client = new HttpMlbStatsClient({
			baseUrl: "https://stats.example",
			fetchImpl: async (input, init) =>
			{
				asked.push(String(input));
				return answer(input, init);
			},
			now: () => now,
		});
		const pitches = await client.fetchSavantGameFeed(823823);
		expect(SAVANT_BASE_URL).toBe("https://baseballsavant.mlb.com");
		expect(asked).toEqual(["https://baseballsavant.mlb.com/gf?game_pk=823823"]);
		expect(pitches).toHaveLength(340);
		expect(pitches?.[0]?.version).toBe(now.getTime());

		const elsewhere: string[] = [];
		await new HttpMlbStatsClient({
			savantBaseUrl: "https://savant.example",
			fetchImpl: async (input) =>
			{
				elsewhere.push(String(input));
				return new Response("{}");
			},
		}).fetchSavantGameFeed(1);
		expect(elsewhere).toEqual(["https://savant.example/gf?game_pk=1"]);
	});

	it("S103 AC 3: the live feed's fetch (fetchGame) never asks Savant, so ingest alone decides when Savant is called", async () =>
	{
		const asked: string[] = [];
		const answer = recordedFetch(`${FIXTURES_ROOT}/raw`, TARGET);
		const client = new HttpMlbStatsClient({
			fetchImpl: async (input, init) =>
			{
				asked.push(String(input));
				return answer(input, init);
			},
			now: () => new Date("2026-09-05T23:00:00Z"),
		});
		const { game } = await client.fetchGame(823823);
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.filter((url) => url.includes("baseballsavant"))).toEqual([]);
		expect(game).not.toHaveProperty("savant");
	});
});

describe("the ingest object's Savant pull (S103 AC 5)", () =>
{
	it("S103 AC 5: a hanging Savant never delays a pitch: the poll's write, its publish and the next alarm all come before Savant is asked", async () =>
	{
		let release: (value: null) => void = () => undefined;
		const hanging = new Promise<null>((resolve) =>
		{
			release = resolve;
		});
		const {
			fetchSavantGameFeed, games, ingest, order, published, storage,
		} = setup(() => hanging);
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		const alarm = ingest.alarm(T0);
		await vi.waitFor(() => expect(fetchSavantGameFeed).toHaveBeenCalledTimes(1));
		// Savant is still hanging: the pitch is already stored and out to the hub, and the next poll is armed.
		expect(order).toEqual(["fetchGame", "write", "publish", "savant"]);
		expect((await games.getByPk(745001))?.version).toBe(1);
		expect(published.map((g) => g.version)).toEqual([1]);
		expect(storage.alarmAt).toBe(T0.getTime() + INTERVAL);
		release(null);
		await alarm;
		expect((await games.getByPk(745001))?.savant).toBeUndefined();
	});

	it("S103 AC 5: a hanging Savant is given up once its limit passes, and the alarm still ends", async () =>
	{
		const { deps, games } = setup(() => new Promise(() => undefined));
		const ingest = new GameIngest(new FakeDurableStorage(), deps, async () => undefined, DEFAULT_CADENCE, 20);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect((await games.getByPk(745001))?.version).toBe(1);
		expect(await pullSavant(deps, 745001, T0, 20)).toBeNull();
	});

	it("S103 AC 5: over two polls each figure is logged when it first arrived, beside the live feed's time for the pitch, and each change is a new published version", async () =>
	{
		const playId = PLAY_ID;
		const endTime = "2026-10-30T11:59:58.000Z";
		const pulls: SavantPitch[][] = [
			[{
				playId,
				atBatIndex: 0,
				version: T0.getTime(),
				batSpeed: 71,
				timesThroughOrder: 1,
			}],
			[{
				playId,
				atBatIndex: 0,
				version: T0.getTime() + SAVANT_EVERY,
				batSpeed: 71,
				timesThroughOrder: 1,
				xba: 0.31,
			}],
		];
		const {
			games, ingest, published,
		} = setup(async () => pulls.shift() ?? null, await withPitch(endTime));
		await ingest.hubs.register("hub-a", T0);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		const first = await games.getByPk(745001);
		expect(first?.savant).toEqual([{
			playId,
			atBatIndex: 0,
			version: T0.getTime(),
			batSpeed: 71,
			timesThroughOrder: 1,
			arrivedAt: {
				batSpeed: T0.toISOString(),
				timesThroughOrder: T0.toISOString(),
			},
			playEndTime: endTime,
		}]);
		const T1 = new Date(T0.getTime() + SAVANT_EVERY);
		// A hub renews its lease while it listens.
		await ingest.hubs.register("hub-a", T1);
		await ingest.alarm(T1);
		const second = (await games.getByPk(745001))?.savant?.[0];
		expect(second?.xba).toBe(0.31);
		expect(second?.arrivedAt).toEqual({
			batSpeed: T0.toISOString(),
			timesThroughOrder: T0.toISOString(),
			xba: T1.toISOString(),
		});
		expect(second?.playEndTime).toBe(endTime);
		// The live poll's version, then each Savant change as the next.
		expect(published.map((g) => [g.version, g.savant?.length ?? 0])).toEqual([[1, 0], [2, 1], [3, 1]]);
	});

	it("S103 AC 5: a live poll never clears what Savant stored, and an older pull landing late changes nothing", async () =>
	{
		const playId = PLAY_ID;
		const {
			deps, games, ingest,
		} = setup(async () => null);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		expect((await storeSavant(deps, 745001, [{
			playId,
			atBatIndex: 0,
			version: 10,
			batSpeed: 70,
		}], T0))?.snapshot.version).toBe(2);
		expect(await storeSavant(deps, 745001, [{
			playId,
			atBatIndex: 0,
			version: 9,
			batSpeed: 99,
		}], T0)).toBeNull();
		await ingest.alarm(new Date(T0.getTime() + INTERVAL));
		const stored = await games.getByPk(745001);
		expect(stored?.version).toBe(2);
		expect(stored?.savant?.[0]?.batSpeed).toBe(70);
		expect(await storeSavant(deps, 999999, [], T0)).toBeNull();
	});

	it("S103 AC 5: a newer stored version that refuses the Savant write is read and merged again", async () =>
	{
		const playId = PLAY_ID;
		const {
			deps, games, ingest,
		} = setup(async () => null);
		await ingest.ensureRunning(745001, T0);
		await ingest.alarm(T0);
		const upsertMany = games.upsertMany;
		let refusals = 1;
		games.upsertMany = async (batch) =>
		{
			if (refusals-- > 0) return [];
			return upsertMany(batch);
		};
		expect((await storeSavant(deps, 745001, [{
			playId,
			atBatIndex: 0,
			version: 1,
			isSword: true,
		}], T0))?.snapshot.savant?.[0]?.isSword).toBe(true);
		refusals = 2;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		expect(await storeSavant(deps, 745001, [{
			playId,
			atBatIndex: 0,
			version: 2,
			isSword: false,
		}], T0)).toBeNull();
		expect(warn).toHaveBeenCalledWith("savant: game 745001 refused twice by newer stored versions; dropped");
	});

	it("S103 AC 5: polling is bounded: at most once per savantIntervalMs (config) while live, then once more after the final, on the run's last poll", async () =>
	{
		const live = setup(async () => null);
		await live.ingest.ensureRunning(745001, T0);
		for (let i = 0; i <= 4; i++) await live.ingest.alarm(new Date(T0.getTime() + i * INTERVAL));
		// Polls at 0, 30, 60, 90 and 120 s; Savant at 0, 60 and 120 s.
		expect(live.fetchSavantGameFeed).toHaveBeenCalledTimes(3);

		// The interval is config: set just over two polls, Savant is pulled at 0 and 90 s of polls at 0, 30, 60 and 90 s.
		const configured = setup(async () => null);
		const slower = new GameIngest(configured.storage, configured.deps, async () => undefined, {
			...DEFAULT_CADENCE,
			savantIntervalMs: 2 * INTERVAL + 1,
		});
		await slower.ensureRunning(745001, T0);
		for (let i = 0; i <= 3; i++) await slower.alarm(new Date(T0.getTime() + i * INTERVAL));
		expect(configured.fetchSavantGameFeed).toHaveBeenCalledTimes(2);

		const IN = new Date("2026-09-05T23:30:00Z");
		const OUT = new Date("2026-09-07T12:00:00Z");
		const final = setup(async () => null);
		await final.ingest.ensureRunning(823823, IN);
		await final.ingest.alarm(IN);
		await final.ingest.alarm(new Date(IN.getTime() + INTERVAL));
		expect(final.fetchSavantGameFeed).not.toHaveBeenCalled();
		await final.ingest.alarm(OUT);
		expect(final.fetchSavantGameFeed).toHaveBeenCalledTimes(1);
		expect(await final.storage.get("savantAt")).toBeUndefined();
		expect(await final.storage.get("savantFinal")).toBeUndefined();
		// The run is over: a stray alarm pulls nothing more.
		await final.ingest.alarm(OUT);
		expect(final.fetchSavantGameFeed).toHaveBeenCalledTimes(1);
	});

	it("S103 AC 5: the final pull merges Savant's figures for 823823 into the stored game, its first sightings beside the live feed's pitch times", async () =>
	{
		const IN = new Date("2026-09-05T23:30:00Z");
		const OUT = new Date("2026-09-07T12:00:00Z");
		const real = new FixtureMlbStatsClient();
		const {
			games, ingest, published,
		} = setup((pk) => real.fetchSavantGameFeed(pk));
		await ingest.hubs.register("hub-a", IN);
		await ingest.ensureRunning(823823, IN);
		await ingest.alarm(IN);
		await ingest.hubs.register("hub-a", OUT);
		await ingest.alarm(OUT);
		const savant = (await games.getByPk(823823))?.savant ?? [];
		expect(savant).toHaveLength(340);
		expect(savant.filter((p) => p.playEndTime !== undefined)).toHaveLength(339);
		expect(savant.every((p) => Object.values(p.arrivedAt ?? {}).every((at) => at === OUT.toISOString()))).toBe(true);
		expect(published.at(-1)?.savant).toHaveLength(340);
	});
});

describe("Savant is optional (S103 AC 6)", () =>
{
	it("S103 AC 6: when Savant fails, throws or lists no pitch, savant stays absent and the game is stored and served as before", async () =>
	{
		const failing = new HttpMlbStatsClient({
			fetchImpl: async () => new Response("down", {
				status: 503,
			}),
		});
		expect(await failing.fetchSavantGameFeed(823823)).toBeNull();
		const garbled = new HttpMlbStatsClient({
			fetchImpl: async () => Response.json({
				team_home: [{
					ab_number: 1,
				}],
			}),
		});
		expect(await garbled.fetchSavantGameFeed(823823)).toBeNull();
		const empty = new HttpMlbStatsClient({
			fetchImpl: async () => Response.json({
				team_home: [],
				team_away: [],
			}),
		});
		expect(await empty.fetchSavantGameFeed(823823)).toBeNull();

		const without = setup(async () => null);
		await without.ingest.hubs.register("hub-a", T0);
		await without.ingest.ensureRunning(745001, T0);
		await without.ingest.alarm(T0);
		const throwing = setup(async () =>
		{
			throw new Error("savant down");
		});
		await throwing.ingest.hubs.register("hub-a", T0);
		await throwing.ingest.ensureRunning(745001, T0);
		await throwing.ingest.alarm(T0);
		for (const run of [without, throwing])
		{
			const stored = await run.games.getByPk(745001);
			expect(stored).not.toHaveProperty("savant");
			expect(stored?.version).toBe(1);
			expect(run.published.map((g) => g.version)).toEqual([1]);
			expect(run.storage.alarmAt).toBe(T0.getTime() + INTERVAL);
		}
		const { fetchedAt: _a, ...a } = (await without.games.getByPk(745001)) as GameSnapshot;
		const { fetchedAt: _b, ...b } = (await throwing.games.getByPk(745001)) as GameSnapshot;
		expect(b).toEqual(a);
	});
});
