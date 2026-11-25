/**
 * S99 (pre-PR review): the player of the game through the cold game read (`getOrRefreshGame`). The live client
 * (`HttpMlbStatsClient`) on the committed recordings of game 823823 (final, 2026-09-05), the player-of-the-game feed
 * answered as each test sets `potg` before a read, on fake timers. A stored pick is never dropped by a later answer
 * that lacks it (a failure, a timeout, or the side MLB hasn't named), each side is kept on its own, and a game whose
 * two sides are both stored is not asked again.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameSnapshot } from "@bt/domain";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { RecordedBackgroundWork } from "../adapters/background-work.js";
import { HttpMlbStatsClient, PLAY_METRICS_LIMIT_MS } from "../adapters/http/mlb.js";
import { memoryDeps, NOW } from "../test/past-data.js";
import { getOrRefreshGame, ingestGame } from "./ingest.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const PK = 823823;

const MEDIA = {
	playerId: 666171,
	teamId: 112,
	summary: "1.2 IP, 0 ER, K, BB",
	winProbabilityAdded: 40.7,
};
const FAN = {
	playerId: 664285,
	teamId: 146,
	summary: "2-4, 2B, RBI",
	winProbabilityAdded: 18.2,
};

/** The feed's answer naming the given sides (feed shape), the other side MLB's every-field-null pick. */
function answer(sides: { media?: boolean;
	fan?: boolean; }): string
{
	const nobody = {
		playerId: null,
		feedId: null,
		boxscoreName: null,
		WPA: null,
		teamID: null,
		summary: null,
		summaryES: null,
	};
	return JSON.stringify({
		gamePK: String(PK),
		mediaWinner: sides.media
			? {
				...nobody,
				feedId: "666171",
				WPA: 40.7,
				teamID: "112",
				summary: "1.2 IP, 0 ER, K, BB",
			}
			: nobody,
		fanWinner: sides.fan
			? {
				...nobody,
				feedId: "664285",
				WPA: 18.2,
				teamID: "146",
				summary: "2-4, 2B, RBI",
			}
			: nobody,
	});
}

type Potg = { kind: "answer";
	body: string; } | { kind: "fail" } | { kind: "hang" };

/** The client and a counter of player-of-the-game requests; `state.potg` and `state.metricsDelay` set per read. */
function setup()
{
	const state: { potg: Potg;
		metricsDelay: number;
		asked: number;
		uniformsHang?: boolean; } = {
		potg: {
			kind: "answer",
			body: answer({
				media: true,
			}),
		},
		metricsDelay: 0,
		asked: 0,
	};
	const file = (name: string) => new Response(readFileSync(path.join(RAW, name)));
	const mlb = new HttpMlbStatsClient({
		now: () => NOW,
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			if (url.hostname === "www.mlb.com")
			{
				state.asked++;
				if (state.potg.kind === "hang") return new Promise<Response>(() => undefined);
				if (state.potg.kind === "fail") return new Response("{}", {
					status: 500,
				});
				return new Response(state.potg.body);
			}
			// S101 review: the uniforms, answered from the recording or, with `uniformsHang`, never.
			if (url.pathname === "/api/v1/uniforms/game") return state.uniformsHang ? new Promise<Response>(() => undefined) : file("uniforms-823823.json");
			if (url.hostname === "data-graph.mlb.com") return file("graphql-content-823823.json");
			if (url.pathname.endsWith(`/bdfed/playMetrics/${PK}`))
			{
				if (state.metricsDelay > 0) await new Promise((resolve) => setTimeout(resolve, state.metricsDelay));
				return file("playmetrics-823823.json");
			}
			if (url.pathname === `/api/v1.1/game/${PK}/feed/live`) return file("live-823823.json");
			if (url.pathname === `/api/v1/game/${PK}/content`) return file("content-823823.json");
			return new Response("{}", {
				status: 404,
			});
		},
	});
	const deps = memoryDeps(mlb);
	// No refresh cooldown: each test's reads are forced on one fixed clock, and the single-flight isn't under test.
	deps.refresh = undefined;
	const background = new RecordedBackgroundWork();
	deps.background = background;
	return {
		deps,
		background,
		state,
	};
}

/** One read of the game, answered once the fake clock passes `ms`. */
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

beforeEach(() =>
{
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout"],
	});
});

afterEach(() =>
{
	vi.useRealTimers();
});

describe("S99 review: the player of the game through the cold game read", () =>
{
	it("S99 review stored: a cold read stores the pick; with both sides stored a later read asks no more", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		state.potg = {
			kind: "answer",
			body: answer({
				media: true,
				fan: true,
			}),
		};
		const first = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await background.flush();
		expect(first?.playerOfTheGame).toEqual({
			media: MEDIA,
			fan: FAN,
		});
		state.asked = 0;
		const again = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
		await background.flush();
		expect(state.asked).toBe(0);
		expect(again?.playerOfTheGame).toEqual(first?.playerOfTheGame);
	});

	it("S99 review per side: with only the media pick stored a later read asks again, and the fan pick it brings is added, the media pick kept", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await background.flush();
		state.potg = {
			kind: "answer",
			body: answer({
				fan: true,
			}),
		};
		state.asked = 0;
		const again = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
		await background.flush();
		expect(state.asked).toBe(1);
		expect(again?.playerOfTheGame).toEqual({
			media: MEDIA,
			fan: FAN,
		});
	});

	it("S99 review kept: a later read whose pick fails or names nobody keeps the stored pick, the version unchanged", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		const first = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await background.flush();
		for (const potg of [{
			kind: "fail",
		}, {
			kind: "answer",
			body: answer({}),
		}] as const)
		{
			state.potg = potg;
			const again = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
			await background.flush();
			expect(again?.playerOfTheGame).toEqual({
				media: MEDIA,
			});
			expect(again?.version).toBe(first?.version);
		}
	});

	it("S99 review late write: when the pick hangs and the playMetrics come late, neither the answer nor the late write drops the stored pick", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		const first = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await background.flush();
		state.potg = {
			kind: "hang",
		};
		state.metricsDelay = 2000;
		const again = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
		expect(again?.playerOfTheGame).toEqual({
			media: MEDIA,
		});
		await vi.advanceTimersByTimeAsync(2000);
		await background.flush();
		const stored = await deps.games.getByPk(PK);
		expect(stored?.playMetrics).toBeDefined();
		expect(stored?.playerOfTheGame).toEqual({
			media: MEDIA,
		});
		expect(first?.playerOfTheGame).toEqual({
			media: MEDIA,
		});
	});

	it("S99 review hung: a first cold read whose pick never answers still answers within PLAY_METRICS_LIMIT_MS, the field absent", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		state.potg = {
			kind: "hang",
		};
		const first = await readWithin(deps, PLAY_METRICS_LIMIT_MS);
		await background.flush();
		expect(first).not.toBeNull();
		expect(first).not.toHaveProperty("playerOfTheGame");
		expect(first?.playMetrics).toBeDefined();
	});

	it("S101 review parallel: a read that asks both the pick and the uniforms, both hanging, answers within one PLAY_METRICS_LIMIT_MS", async () =>
	{
		const {
			deps, background, state,
		} = setup();
		// Stored live with neither, so the final read is due both: the pick (now final) and the uniforms (status changed).
		const { game } = await deps.mlb.fetchGame(PK);
		const { mlb: _mlb, ...noMlb } = deps;
		await ingestGame(noMlb, {
			...game,
			status: {
				...game.status,
				codedGameState: "I",
			},
			fetchedAt: "2026-09-05T20:00:00.000Z",
			windowMode: "active",
		});
		state.potg = {
			kind: "hang",
		};
		state.uniformsHang = true;
		const read = await readWithin(deps, PLAY_METRICS_LIMIT_MS, true);
		await background.flush();
		expect(read).not.toHaveProperty("playerOfTheGame");
		expect(read).not.toHaveProperty("uniforms");
	});
});
