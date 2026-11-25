/**
 * S212 AC 5: the cron's re-check of recently finished games, against a counting fake MLB and the memory purger.
 */
import type {
	FetchedGame, GameSnapshot, Unversioned,
} from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { InMemoryOwedEdgePurgeRepository } from "../adapters/memory/repos.js";
import {
	countingMlb, finalGame, memoryDeps, NOW, ORIGIN,
} from "../test/past-data.js";
import { recheckDueGame } from "./game-recheck.js";
import { ingestGame } from "./ingest.js";

/** Three days before MLB's today (2026-11-15). */
const RECENT = "2026-11-12";
const STORED_AT = "2026-11-13T06:00:00.000Z";
const URLS = (gamePk: number, date: string) => [`${ORIGIN}/api/v1/games/${gamePk}`, `${ORIGIN}/api/v1/schedule?date=${date}`, `${ORIGIN}/api/v1/digest?date=${date}`];

/** What a fake MLB answers for each gamePk: the game as stored, unless a test changes it. */
type Answers = Map<number, Unversioned<GameSnapshot> | Error>;

/** A fake MLB answering `fetchGame` from `answers`, counted. */
function fakeMlb(answers: Answers)
{
	const fixture = new FixtureMlbStatsClient();
	return countingMlb(Object.assign(Object.create(fixture) as MlbStatsClient, {
		fetchGame: async (gamePk: number): Promise<FetchedGame> =>
		{
			const answer = answers.get(gamePk);
			if (answer instanceof Error) throw answer;
			if (!answer) throw new Error(`no game ${gamePk}`);
			return {
				game: answer,
			};
		},
	}));
}

/** Stores `game` as ingest leaves a finished game (out of its window), and returns it as MLB would send it again. */
async function stored(deps: ReturnType<typeof memoryDeps>, game: Unversioned<GameSnapshot>): Promise<Unversioned<GameSnapshot>>
{
	await ingestGame(deps, {
		...game,
		fetchedAt: STORED_AT,
		windowMode: "cache",
	});
	return game;
}

/** The fixture game 744834, final, played on `date`. */
async function game(date = RECENT, gamePk = 744834): Promise<Unversioned<GameSnapshot>>
{
	return {
		...(await finalGame(744834, date)).game,
		gamePk,
	};
}

/** Deps with `answers` as MLB, the purger cleared. */
function withMlb(deps: ReturnType<typeof memoryDeps>, answers: Answers)
{
	const mlb = fakeMlb(answers);
	deps.mlb = mlb.client;
	deps.purger.calls.length = 0;
	return mlb.calls;
}

describe("recheckDueGame (S212 AC 5)", () =>
{
	it("S212 AC 5 picks: a game 3 days back with no re-check is picked; one 8 days back, today's and a postponed game never are", async () =>
	{
		const deps = memoryDeps();
		const answers: Answers = new Map();
		answers.set(744834, await stored(deps, await game()));
		answers.set(800008, await stored(deps, await game("2026-11-07", 800008)));
		answers.set(800000, await stored(deps, await game("2026-11-15", 800000)));
		answers.set(800001, await stored(deps, {
			...await game(RECENT, 800001),
			status: {
				abstractGameState: "Final",
				codedGameState: "D",
				detailedState: "Postponed: Rain",
			},
		}));
		const calls = withMlb(deps, answers);
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(await recheckDueGame(deps)).toBeNull();
		expect(calls).toEqual(["fetchGame 744834"]);
	});

	it("S212 AC 5 new clip: a re-check whose only difference is a new highlight clip stores it and purges its three URLs", async () =>
	{
		const deps = memoryDeps();
		const full = await game();
		await stored(deps, {
			...full,
			highlights: full.highlights.slice(0, -1),
		});
		withMlb(deps, new Map([[744834, full]]));
		expect(await recheckDueGame(deps)).toBe(744834);
		expect((await deps.games.getByPk(744834))?.highlights).toHaveLength(full.highlights.length);
		expect(deps.purger.purged).toEqual(URLS(744834, RECENT));
	});

	it("S212 AC 5 change purges: a re-check that changes the game purges its game URL and its day's schedule and digest URLs", async () =>
	{
		const deps = memoryDeps();
		const before = await stored(deps, await game());
		withMlb(deps, new Map([[744834, {
			...before,
			status: {
				...before.status,
				detailedState: "Final: scoring change",
			},
		}]]));
		await recheckDueGame(deps);
		expect(deps.purger.purged).toEqual(URLS(744834, RECENT));
	});

	it("S212 AC 5 unchanged: a re-check that changes nothing purges nothing and still records the re-check", async () =>
	{
		const deps = memoryDeps();
		const same = await stored(deps, await game());
		withMlb(deps, new Map([[744834, same]]));
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(deps.purger.purged).toEqual([]);
		const [candidate] = await deps.games.listRecheckCandidates(RECENT, RECENT);
		expect(candidate?.checkedAt).toBe(NOW.toISOString());
	});

	it("S212 AC 5 six hours: a game re-checked under 6 h ago is not picked", async () =>
	{
		const deps = memoryDeps();
		const same = await stored(deps, await game());
		await deps.games.recordGameRecheck(744834, new Date(NOW.getTime() - 5 * 3600_000).toISOString());
		const calls = withMlb(deps, new Map([[744834, same]]));
		expect(await recheckDueGame(deps)).toBeNull();
		expect(calls).toEqual([]);
		// Six hours after that re-check it is due again.
		deps.now = () => new Date(NOW.getTime() + 3600_000);
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(calls).toEqual(["fetchGame 744834"]);
	});

	it("S212 AC 5 none due: with no due game a call sends no MLB request and does one database read", async () =>
	{
		const deps = memoryDeps();
		await stored(deps, await game("2026-11-07"));
		const calls = withMlb(deps, new Map());
		const reads: string[] = [];
		for (const name of ["schedules", "games", "gameStates", "projections"] as const)
		{
			const repo = deps[name] as unknown as Record<string, unknown>;
			deps[name] = new Proxy(repo, {
				get(target, key, receiver)
				{
					const value = Reflect.get(target, key, receiver) as unknown;
					if (typeof value !== "function") return value;
					return (...args: unknown[]) =>
					{
						reads.push(`${name}.${String(key)}`);
						return (value as (...a: unknown[]) => unknown).apply(target, args);
					};
				},
			}) as never;
		}
		expect(await recheckDueGame(deps)).toBeNull();
		expect(calls).toEqual([]);
		expect(reads).toEqual(["games.listRecheckCandidates"]);
	});

	it("S212 AC 5 MLB fails: an MLB failure records no re-check and stores nothing", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const deps = memoryDeps();
		await stored(deps, await game());
		const before = await deps.games.getByPk(744834);
		withMlb(deps, new Map([[744834, new Error("MLB down")]]));
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(await deps.games.getByPk(744834)).toEqual(before);
		const [candidate] = await deps.games.listRecheckCandidates(RECENT, RECENT);
		expect(candidate?.checkedAt).toBeNull();
		expect(deps.purger.purged).toEqual([]);
		warn.mockRestore();
	});

	it("S212 review MLB fails held: a game MLB failed to answer is not asked again for 6 h, while other due games still are", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const deps = memoryDeps();
		await stored(deps, await game());
		const calls = withMlb(deps, new Map([[744834, new Error("MLB down")]]));
		expect(await recheckDueGame(deps)).toBe(744834);
		// Past the 5-minute claim lease: still held.
		deps.now = () => new Date(NOW.getTime() + 10 * 60_000);
		expect(await recheckDueGame(deps)).toBeNull();
		deps.now = () => new Date(NOW.getTime() + 6 * 3600_000 - 1);
		expect(await recheckDueGame(deps)).toBeNull();
		expect(calls).toEqual(["fetchGame 744834"]);
		deps.now = () => new Date(NOW.getTime() + 6 * 3600_000);
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(calls).toEqual(["fetchGame 744834", "fetchGame 744834"]);
		warn.mockRestore();
	});

	it("S212 review purge fails: a re-check whose purge fails owes its URLs for the cron to retry and still records the re-check", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const deps = memoryDeps();
		const before = await stored(deps, await game());
		withMlb(deps, new Map([[744834, {
			...before,
			status: {
				...before.status,
				detailedState: "Final: scoring change",
			},
		}]]));
		const owed = new InMemoryOwedEdgePurgeRepository();
		deps.edgePurge = {
			origin: ORIGIN,
			owed,
			purger: {
				purge: async () =>
				{
					throw new Error("HTTP 500");
				},
			},
		};
		expect(await recheckDueGame(deps)).toBe(744834);
		expect((await owed.listDue(NOW.toISOString(), 10)).map((purge) => purge.url).sort()).toEqual(URLS(744834, RECENT).sort());
		const [candidate] = await deps.games.listRecheckCandidates(RECENT, RECENT);
		expect(candidate?.checkedAt).toBe(NOW.toISOString());
		warn.mockRestore();
	});

	it("S212 review live-ingested: a recent final game live ingest left stamped active is re-checked once it is out of its window", async () =>
	{
		const deps = memoryDeps();
		const same = await game();
		await ingestGame(deps, {
			...same,
			fetchedAt: STORED_AT,
			windowMode: "active",
		});
		const calls = withMlb(deps, new Map([[744834, same]]));
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(calls).toEqual(["fetchGame 744834"]);
	});
});

describe("recheckDueGame player of the game (S99, Claude's review of #621)", () =>
{
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

	/** A fake MLB whose fetch says the game is due a pick, its pick answered with both sides; every call counted. */
	function dueMlb(deps: ReturnType<typeof memoryDeps>, answer: Unversioned<GameSnapshot>)
	{
		const fixture = new FixtureMlbStatsClient();
		const mlb = countingMlb(Object.assign(Object.create(fixture) as MlbStatsClient, {
			fetchGame: async (): Promise<FetchedGame> => ({
				game: answer,
				playerOfTheGameDue: true,
			}),
			fetchPlayerOfTheGame: async () => ({
				media: MEDIA,
				fan: FAN,
			}),
		}));
		deps.mlb = mlb.client;
		return mlb.calls;
	}

	it("S99 review recheck complete: a re-check of a game with both picks stored asks for no pick", async () =>
	{
		const deps = memoryDeps();
		const both = {
			...await game(),
			playerOfTheGame: {
				media: MEDIA,
				fan: FAN,
			},
		};
		await stored(deps, both);
		const { playerOfTheGame: _sent, ...sent } = both;
		const calls = dueMlb(deps, sent);
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(calls).toEqual(["fetchGame 744834"]);
		expect((await deps.games.getByPk(744834))?.playerOfTheGame).toEqual(both.playerOfTheGame);
	});

	it("S99 review recheck missing side: a re-check of a game with only the media pick stored asks once and adds the fan pick", async () =>
	{
		const deps = memoryDeps();
		const one = {
			...await game(),
			playerOfTheGame: {
				media: MEDIA,
			},
		};
		await stored(deps, one);
		const { playerOfTheGame: _sent, ...sent } = one;
		const calls = dueMlb(deps, sent);
		expect(await recheckDueGame(deps)).toBe(744834);
		expect(calls).toEqual(["fetchGame 744834", "fetchPlayerOfTheGame 744834"]);
		expect((await deps.games.getByPk(744834))?.playerOfTheGame).toEqual({
			media: MEDIA,
			fan: FAN,
		});
	});

	it("S99 review recheck read fails: a failed read of the stored game rejects as BT's own, never held as an MLB failure", async () =>
	{
		const deps = memoryDeps();
		const sent = await stored(deps, await game());
		const calls = dueMlb(deps, sent);
		deps.games.getByPk = async () =>
		{
			throw new Error("database down");
		};
		const hold = vi.spyOn(deps.games, "holdGameRecheck");
		await expect(recheckDueGame(deps)).rejects.toThrow("database down");
		expect(hold).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
	});
});
