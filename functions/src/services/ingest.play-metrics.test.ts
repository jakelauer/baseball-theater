/**
 * S216 AC 5: a slow playMetrics can't hold a cold game's answer. The live client (`HttpMlbStatsClient`) on the
 * committed recordings of game 823823 (final, 2026-09-05, so past and finished at the tests' clock), its playMetrics
 * answered after `delay` ms on fake timers; the deferred work flushed by the test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameSnapshot } from "@bt/domain";
import { gameStateFromGame } from "@bt/domain";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { RecordedBackgroundWork } from "../adapters/background-work.js";
import { HttpMlbStatsClient, PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import {
	memoryDeps, NOW, ORIGIN,
} from "../test/past-data.js";
import { getOrRefreshGame } from "./ingest.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const PK = 823823;
const DATE = "2026-09-05";
const URLS = [`${ORIGIN}/api/v1/games/${PK}`, `${ORIGIN}/api/v1/schedule?date=${DATE}`, `${ORIGIN}/api/v1/digest?date=${DATE}`];

/** The recorded answer for one of 823823's four calls; playMetrics after `delay` ms. */
function client(delay: number): HttpMlbStatsClient
{
	const file = (name: string) => new Response(readFileSync(path.join(RAW, name)));
	return new HttpMlbStatsClient({
		now: () => NOW,
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			if (url.hostname === "data-graph.mlb.com") return file("graphql-content-823823.json");
			if (url.pathname.endsWith(`/bdfed/playMetrics/${PK}`))
			{
				await new Promise((resolve) => setTimeout(resolve, delay));
				return file("playmetrics-823823.json");
			}
			if (url.pathname === `/api/v1.1/game/${PK}/feed/live`) return file("live-823823.json");
			if (url.pathname === `/api/v1/game/${PK}/content`) return file("content-823823.json");
			return new Response("{}", {
				status: 404,
			});
		},
	});
}

/** Stores, the recorded background double and the client; each purge notes whether the store then held playMetrics. */
function setup(delay: number)
{
	const deps = memoryDeps(client(delay));
	const background = new RecordedBackgroundWork();
	deps.background = background;
	const heldAtPurge: boolean[] = [];
	const purge = deps.purger.purge.bind(deps.purger);
	deps.purger.purge = async (urls) =>
	{
		heldAtPurge.push((await deps.games.getByPk(PK))?.playMetrics !== undefined);
		return purge(urls);
	};
	return {
		deps,
		background,
		heldAtPurge,
	};
}

/** The game read, answered once the fake clock passes `ms`; whether it had answered by then. */
async function readWithin(deps: ReturnType<typeof setup>["deps"], ms: number, force = false): Promise<GameSnapshot | null>
{
	let answered = false;
	const read = getOrRefreshGame(deps, PK, {
		force,
	}).finally(() =>
	{
		answered = true;
	});
	await vi.advanceTimersByTimeAsync(ms);
	expect(answered).toBe(true);
	return read;
}

/** Another writer's newer version of the stored game, without playMetrics and with no videos (so it is told apart). */
async function seedNewer(deps: ReturnType<typeof setup>["deps"]): Promise<GameSnapshot>
{
	const stored = (await deps.games.getByPk(PK))!;
	const { playMetrics: _without, ...rest } = stored;
	const newer = {
		...rest,
		highlights: [],
		version: stored.version + 1,
		lastChangedAt: NOW.toISOString(),
	};
	await deps.games.upsert(newer);
	return newer;
}

beforeEach(() =>
{
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout"],
	});
});

afterEach(() =>
{
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("S216 AC 5: playMetrics can't hold a cold game's answer", () =>
{
	it("S216 AC 5 answers within the limit: the game without playMetrics; after the flush stored with them, the game's and its day's URLs purged after the write", async () =>
	{
		expect(PLAY_METRICS_LIMIT_MS).toBe(750);
		const {
			deps, background, heldAtPurge,
		} = setup(2000);
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		expect(answered?.playMetrics).toBeUndefined();
		expect((await deps.games.getByPk(PK))?.playMetrics).toBeUndefined();
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const stored = await deps.games.getByPk(PK);
		expect(stored?.playMetrics).toBeDefined();
		expect(stored?.version).toBe(answered!.version + 1);
		expect((await deps.projections.getByPk(PK))?.header.version).toBe(stored?.version);
		// The store's own purge of the newly stored past game, then the late write's, each exactly these three URLs.
		expect(deps.purger.calls.at(-1)?.sort()).toEqual([...URLS].sort());
		expect(deps.purger.calls.every((urls) => [...urls].sort().join() === [...URLS].sort().join())).toBe(true);
		expect(heldAtPurge.at(-1)).toBe(true);
	});

	it("S216 AC 5 inside the limit purges nothing: playMetrics that arrive in time are in the answer, and a refresh that changes nothing purges nothing", async () =>
	{
		const { deps, background } = setup(100);
		const first = await readWithin(deps, 100);
		expect(first?.playMetrics).toBeDefined();
		await background.flush();
		deps.purger.calls.length = 0;
		const again = await readWithin(deps, 100, true);
		expect(again?.playMetrics).toBeDefined();
		expect(again?.version).toBe(first?.version);
		await background.flush();
		expect(deps.purger.calls).toEqual([]);
	});

	it("S216 AC 5 refused follow-up retries once: over a newer stored version without playMetrics, it stores that content with them", async () =>
	{
		const { deps, background } = setup(2000);
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		const upsertMany = deps.games.upsertMany.bind(deps.games);
		let seeded: GameSnapshot | null = null;
		deps.games.upsertMany = async (batch) =>
		{
			seeded ??= await seedNewer(deps);
			return upsertMany(batch);
		};
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const stored = await deps.games.getByPk(PK);
		expect(seeded!.version).toBe(answered!.version + 1);
		expect(stored?.version).toBe(seeded!.version + 1);
		expect(stored?.playMetrics).toBeDefined();
		expect(stored?.highlights).toEqual([]);
	});

	it("S216 AC 5 second refusal logged: refused again, the follow-up is dropped and the stored game left alone", async () =>
	{
		const { deps, background } = setup(2000);
		await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const upsertMany = deps.games.upsertMany.bind(deps.games);
		let latest: GameSnapshot | null = null;
		deps.games.upsertMany = async (batch) =>
		{
			latest = await seedNewer(deps);
			return upsertMany(batch);
		};
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const stored = await deps.games.getByPk(PK);
		expect(stored).toEqual(latest);
		expect(stored?.playMetrics).toBeUndefined();
		expect(warn.mock.calls.some((args) => String(args[0]).includes("refused twice"))).toBe(true);
	});
	it("S216 AC 5 late playMetrics that never come: the game stays stored without them and nothing more is written", async () =>
	{
		const { deps, background } = setup(2000);
		const failing = client(2000);
		const fetchPlayMetrics = failing.fetchPlayMetrics.bind(failing);
		deps.mlb = failing;
		failing.fetchPlayMetrics = async (gamePk) =>
		{
			await fetchPlayMetrics(gamePk);
			return null;
		};
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		expect(await deps.games.getByPk(PK)).toEqual(expect.objectContaining({
			version: answered?.version,
		}));
		expect((await deps.games.getByPk(PK))?.playMetrics).toBeUndefined();
	});

	it("S216 AC 5 a newer stored version that already has playMetrics: the follow-up stops, writing nothing over it", async () =>
	{
		const { deps, background } = setup(2000);
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		const upsertMany = deps.games.upsertMany.bind(deps.games);
		let newer: GameSnapshot | null = null;
		deps.games.upsertMany = async (batch) =>
		{
			if (!newer)
			{
				newer = {
					...batch[0]!,
					highlights: [],
				};
				await deps.games.upsert(newer);
			}
			return upsertMany(batch);
		};
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		expect(await deps.games.getByPk(PK)).toEqual(newer);
		expect((await deps.games.getByPk(PK))?.version).toBe(answered!.version + 1);
	});
	it("B577 review: a late playMetrics write over another writer's newer version that refused this read's own write adds only the playMetrics, never rewinding it", async () =>
	{
		const { deps, background } = setup(2000);
		const upsertMany = deps.games.upsertMany.bind(deps.games);
		let newer: GameSnapshot | null = null;
		// Another writer (the game's ingest object) stores a newer version, told apart by its empty videos, before this
		// read's own write, which it then refuses: the read answers that one.
		deps.games.upsertMany = async (batch) =>
		{
			if (!newer)
			{
				const { playMetrics: _without, ...content } = batch[0]!;
				newer = {
					...content,
					highlights: [],
					version: batch[0]!.version + 1,
					lastChangedAt: NOW.toISOString(),
				};
				await deps.games.upsert(newer);
			}
			return upsertMany(batch);
		};
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		expect(answered?.version).toBe(newer!.version);
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const stored = await deps.games.getByPk(PK);
		expect(stored?.highlights).toEqual([]);
		expect(stored?.playMetrics?.atBats).toHaveLength(85);
		expect(stored?.version).toBe(newer!.version + 1);
	});

	it("B577 review: a forced read whose feed the switch skips as older keeps the stored game and only adds the late playMetrics it lacks, never writing this read's older feed over it", async () =>
	{
		const { deps, background } = setup(2000);
		const fetching = client(0).fetchGame(PK);
		await vi.advanceTimersByTimeAsync(10);
		const { game } = await fetching;
		const { playMetrics: _without, ...content } = game;
		// Stored from a newer feed (its own later feed time on the row), told apart by its empty videos, without playMetrics.
		const stored: GameSnapshot = {
			...content,
			highlights: [],
			version: 3,
			lastChangedAt: NOW.toISOString(),
		};
		await deps.games.upsert(stored);
		await deps.gameStates.write([{
			gamePk: PK,
			source: "feed",
			feedTime: "2026-11-01T00:00:00.000Z",
			officialDate: DATE,
			startTime: game.startTime ?? null,
			state: {
				...gameStateFromGame(game),
				version: 5,
				lastChangedAt: NOW.toISOString(),
			},
		}]);
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
		expect(answered?.version).toBe(3);
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const after = await deps.games.getByPk(PK);
		expect(after?.highlights).toEqual([]);
		expect(after?.playMetrics?.atBats).toHaveLength(85);
		expect(after?.version).toBe(4);
	});

	it("S216 review late playMetrics purge judged as served: a final snapshot whose state row says suspended purges nothing", async () =>
	{
		const { deps, background } = setup(2000);
		const fetching = client(0).fetchGame(PK);
		await vi.advanceTimersByTimeAsync(10);
		const { game } = await fetching;
		const suspended = {
			abstractGameState: "Live",
			codedGameState: "U",
			detailedState: "Suspended: Rain",
		};
		// A newer feed state already stored (the feed's own, later feed time), so this read's older copy is skipped.
		await deps.gameStates.write([{
			gamePk: PK,
			source: "feed",
			feedTime: "2026-11-01T00:00:00.000Z",
			officialDate: DATE,
			startTime: game.startTime ?? null,
			state: {
				...gameStateFromGame({
					...game,
					status: suspended,
				}),
				version: 5,
				lastChangedAt: NOW.toISOString(),
			},
		}]);
		const answered = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		expect(answered?.status.codedGameState).toBe("U");
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		expect((await deps.games.getByPk(PK))?.playMetrics).toBeDefined();
		expect(deps.purger.calls).toEqual([]);
	});
});
