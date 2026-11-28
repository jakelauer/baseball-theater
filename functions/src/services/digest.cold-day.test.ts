/**
 * B577 (#577): a cold day's Best of took 7–10 s on staging for a 15-game day, about 0.55 s a game. A Worker invocation
 * keeps at most six connections open at once and queues the rest, and every cold game asked six or seven things of MLB
 * before the digest could answer: its uniforms and rule settings first, then the feed, then its content, GraphQL content
 * and playMetrics, then its player of the game. The digest needs only the feed, the content and the GraphQL content
 * (`dayDigest`); the rest held the queue, and the bounded asks (`askWithinLimit`) expired while they waited in it, so
 * the day's last games were stored without their rule settings.
 *
 * Here the live client (`HttpMlbStatsClient`) answers the recorded 2026-09-05 schedule (15 final games) and, for each
 * game, the recordings of game 823823 under its own gamePk, every request held in a six-connection queue for a fixed
 * time on fake timers. Times are simulated, so the test pins the critical path, not the machine's speed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameSnapshot } from "@bt/domain";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { RecordedBackgroundWork } from "../adapters/background-work.js";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import { memoryDeps, NOW } from "../test/past-data.js";
import { getDayDigest } from "./digest.js";
import { readDayAndGames } from "./ingest.js";
import { RefreshCoordinator } from "./refresh.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");
const DATE = "2026-09-05";
/** The recordings every game is answered from; their gamePk is swapped for the asked one. */
const RECORDED_PK = "823823";
/** A clock on the day itself (22:00 in New York), so its games aren't past yet and a stale stored one is refreshed. */
const SAME_DAY = new Date("2026-09-06T02:00:00Z");

/** Workers' limit: connections one invocation holds open at once; the rest wait their turn. */
const CONNECTIONS = 6;

/**
 * Each request's time on its connection (ms), as measured of MLB from staging for issue #577 (a cold 15-game day; the
 * playMetrics the slowest, the uniforms the quickest).
 */
const LATENCY = {
	schedule: 300,
	feed: 230,
	content: 150,
	graph: 500,
	playMetrics: 900,
	uniforms: 70,
	ruleSettings: 150,
	playerOfTheGame: 210,
} as const;
type Kind = keyof typeof LATENCY;

/** The asks a digest's batch leaves until after its answer. */
const AFTER_KINDS = ["playMetrics", "uniforms", "ruleSettings", "playerOfTheGame"] as const satisfies readonly Kind[];

/** Which of MLB's requests `url` is, and the recording that answers it. */
function classify(url: URL): { kind: Kind;
	file: string; }
{
	if (url.pathname === "/api/v1/schedule") return {
		kind: "schedule",
		file: "schedule-2026-09-05.json",
	};
	if (url.hostname === "data-graph.mlb.com") return {
		kind: "graph",
		file: "graphql-content-823823.json",
	};
	if (url.hostname === "www.mlb.com") return {
		kind: "playerOfTheGame",
		file: "potg-823823.json",
	};
	if (url.pathname.includes("/bdfed/playMetrics/")) return {
		kind: "playMetrics",
		file: "playmetrics-823823.json",
	};
	if (url.pathname === "/api/v1/uniforms/game") return {
		kind: "uniforms",
		file: "uniforms-823823.json",
	};
	if (url.pathname.endsWith("/feed/live") && url.searchParams.get("hydrate") === "ruleSettings") return {
		kind: "ruleSettings",
		file: "rulesettings-823823.json",
	};
	if (url.pathname.endsWith("/feed/live")) return {
		kind: "feed",
		file: "live-823823.json",
	};
	if (url.pathname.endsWith("/content")) return {
		kind: "content",
		file: "content-823823.json",
	};
	throw new Error(`unexpected MLB request ${url.href}`);
}

/** The gamePk a game's request names (in its path, its query or the GraphQL variables), or null for the schedule. */
function gamePkOf(url: URL): number | null
{
	const found = /\d{6}/.exec(decodeURIComponent(url.pathname + url.search))?.[0];
	return found ? Number(found) : null;
}

/**
 * How a test changes one request's answer: `"hang"` holds its connection and never answers; a `Response` is answered
 * in place of the recording (after the kind's latency); undefined answers the recording.
 */
type Override = (kind: Kind, gamePk: number | null) => "hang" | Response | undefined;

/**
 * The live client over a six-connection queue: each request waits for a free connection, holds it for its kind's
 * latency, then answers its recording with the gamePk swapped in (or what `override` says). Every request is logged
 * with its gamePk and the simulated time it was sent (got a connection), counted from `start`.
 */
function queuedMlb(start: Date, override?: Override)
{
	const sent: { kind: Kind;
		gamePk: number | null;
		at: number; }[] = [];
	let open = 0;
	const waiting: (() => void)[] = [];
	const release = () =>
	{
		open--;
		waiting.shift()?.();
	};
	const acquire = async () =>
	{
		if (open >= CONNECTIONS) await new Promise<void>((resolve) => waiting.push(resolve));
		open++;
	};
	const mlb = new HttpMlbStatsClient({
		now: () => new Date(Date.now()),
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			const { kind, file } = classify(url);
			const gamePk = gamePkOf(url);
			await acquire();
			sent.push({
				kind,
				gamePk,
				at: Date.now() - start.getTime(),
			});
			const answer = override?.(kind, gamePk);
			if (answer === "hang") return new Promise<Response>(() => undefined);
			await new Promise((resolve) => setTimeout(resolve, LATENCY[kind]));
			release();
			if (answer) return answer;
			const body = readFileSync(path.join(RAW, file), "utf8");
			return new Response(gamePk !== null && kind !== "schedule" ? body.replaceAll(RECORDED_PK, String(gamePk)) : body);
		},
	});
	return {
		mlb,
		sent,
	};
}

/** Memory stores over the queued client, with the recorded background double, at `clock` (fake system time too). */
function setup(clock: Date = NOW, override?: Override)
{
	vi.setSystemTime(clock);
	const { mlb, sent } = queuedMlb(clock, override);
	const deps = memoryDeps(mlb);
	deps.now = () => new Date(Date.now());
	deps.refresh = new RefreshCoordinator(() => new Date(Date.now()));
	const background = new RecordedBackgroundWork();
	deps.background = background;
	return {
		deps,
		background,
		sent,
	};
}

/** Advances the fake clock in small steps until `promise` settles (at most `capMs`); the simulated time it took. */
async function settleOnClock(promise: Promise<unknown>, capMs: number): Promise<number>
{
	let settled = false;
	void promise.finally(() =>
	{
		settled = true;
	}).catch(() => undefined);
	const start = Date.now();
	while (!settled && Date.now() - start < capMs) await vi.advanceTimersByTimeAsync(10);
	return Date.now() - start;
}

/** The day's games as stored now, in the day's order. */
async function storedGames(deps: ReturnType<typeof setup>["deps"]): Promise<GameSnapshot[]>
{
	const day = (await deps.schedules.getByDate(DATE))!;
	return deps.games.getMany(day.games.map(({ gamePk }) => gamePk));
}

/** Each stored game's missing after-answer field, as `<gamePk> <field>`. */
function missingAfterAnswers(games: readonly GameSnapshot[]): string[]
{
	return games.flatMap((game) => (["ruleSettings", "uniforms", "playerOfTheGame", "playMetrics"] as const)
		.filter((field) => game[field] === undefined)
		.map((field) => `${game.gamePk} ${field}`));
}

/** How many of `kind` were sent. */
function count(sent: ReturnType<typeof setup>["sent"], kind: Kind): number
{
	return sent.filter((request) => request.kind === kind).length;
}

/**
 * Stores the day at the same-day clock (a cold read, flushed), then makes the first game's stored snapshot stale (an old
 * `fetchedAt`, as stored a day ago) with playMetrics for all but its last two at-bats, and a fresh coordinator, so the
 * next read refreshes that game alone. Returns the game's gamePk.
 */
async function storeThenStale(context: ReturnType<typeof setup>): Promise<number>
{
	const { deps, background } = context;
	await settleOnClock(getDayDigest(deps, DATE), 30_000);
	await settleOnClock(background.flush(), 60_000);
	const [first] = await storedGames(deps);
	const atBats = first!.playMetrics!.atBats;
	await deps.games.upsert({
		...first!,
		playMetrics: {
			atBats: atBats.slice(0, -2),
		},
		fetchedAt: "2026-09-05T00:00:00.000Z",
		lastChangedAt: "2026-09-05T00:00:00.000Z",
		version: first!.version + 1,
	});
	deps.refresh = new RefreshCoordinator(() => new Date(Date.now()));
	context.sent.length = 0;
	return first!.gamePk;
}

beforeEach(() =>
{
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "Date"],
	});
	vi.setSystemTime(NOW);
});

afterEach(() =>
{
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("B577: a cold day's Best of answers on its feeds, contents and GraphQL contents alone", () =>
{
	it("B577 a cold 15-game day's digest answers once its schedule, feeds, contents and GraphQL contents pass six connections; uniforms, rule settings, player of the game and playMetrics are asked after it and stored for every game (#577)", async () =>
	{
		const {
			deps, background, sent,
		} = setup();

		const read = getDayDigest(deps, DATE);
		const answeredAfter = await settleOnClock(read, 30_000);
		const { digest } = await read;
		// Every clip is one of the day's games' recorded videos.
		const gamePks = new Set((await deps.schedules.getByDate(DATE))!.games.map(({ gamePk }) => gamePk));
		const content = readFileSync(path.join(RAW, "content-823823.json"), "utf8");
		expect(digest.items.length).toBeGreaterThan(0);
		for (const item of digest.items)
		{
			expect(gamePks.has(item.game.gamePk)).toBe(true);
			expect(content.includes(item.highlight.id)).toBe(true);
		}

		// What the digest needs, fifteen games' worth through six connections, then the last GraphQL content's own wait.
		const critical = LATENCY.schedule + 15 * (LATENCY.feed + LATENCY.content + LATENCY.graph) / CONNECTIONS + LATENCY.graph;
		expect.soft(answeredAfter, `answered after ${answeredAfter} ms of simulated time`).toBeLessThanOrEqual(critical);
		// Nothing the digest doesn't use was sent before it answered.
		const before = new Set(sent.filter(({ at }) => at < answeredAfter).map(({ kind }) => kind));
		expect.soft([...before].sort()).toEqual(["content", "feed", "graph", "schedule"]);

		// After the response, every game gets what it was answered without, none lost to a limit that ran while it queued.
		await settleOnClock(background.flush(), 60_000);
		expect(count(sent, "feed")).toBe(15);
		const stored = await storedGames(deps);
		expect(stored).toHaveLength(15);
		expect(missingAfterAnswers(stored)).toEqual([]);
		// Two purges: the batch store's, then one for every late write together (the games' URLs and the day's).
		expect(deps.purger.calls).toHaveLength(2);
		const late = deps.purger.calls[1]!;
		expect(late.filter((url) => url.includes("/api/v1/games/"))).toHaveLength(15);
		expect(late.some((url) => url.endsWith(`/api/v1/digest?date=${DATE}`))).toBe(true);

		// The next read is served from the store, every game with its playMetrics, asking MLB nothing.
		const asked = sent.length;
		const again = await settleOnClock(readDayAndGames(deps, DATE).then(({ games }) =>
		{
			expect(games.every((game) => game?.playMetrics !== undefined)).toBe(true);
		}), 1000);
		expect(again).toBeLessThan(1000);
		expect(sent).toHaveLength(asked);
	});

	it("B577 review: one game's rule settings request never answers; the late work still settles well inside waitUntil's 30 s, that game stored with its other three answers and every other game whole, the dropped ask logged", async () =>
	{
		let hung: number | null = null;
		const context = setup(NOW, (kind, gamePk) =>
		{
			if (kind !== "ruleSettings") return undefined;
			hung ??= gamePk;
			return gamePk === hung ? "hang" : undefined;
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await settleOnClock(getDayDigest(context.deps, DATE), 30_000);
		const flushedAfter = await settleOnClock(context.background.flush(), 60_000);
		expect(flushedAfter, `late work settled after ${flushedAfter} ms of simulated time`).toBeLessThanOrEqual(20_000);
		expect(missingAfterAnswers(await storedGames(context.deps))).toEqual([`${hung} ruleSettings`]);
		expect(warn.mock.calls.some((args) => String(args[0]).includes(`rule settings of game ${hung}`))).toBe(true);
	});

	it("B577 review: two concurrent cold reads of the day ask each game's feed, playMetrics, uniforms, rule settings and player of the game once", async () =>
	{
		const {
			deps, background, sent,
		} = setup();
		await settleOnClock(Promise.all([getDayDigest(deps, DATE), getDayDigest(deps, DATE)]), 30_000);
		await settleOnClock(background.flush(), 60_000);
		expect(Object.fromEntries((["feed", ...AFTER_KINDS] as const).map((kind) => [kind, count(sent, kind)]))).toEqual({
			feed: 15,
			playMetrics: 15,
			uniforms: 15,
			ruleSettings: 15,
			playerOfTheGame: 15,
		});
		expect(missingAfterAnswers(await storedGames(deps))).toEqual([]);
	});

	it("B577 review: a late ask that fails (uniforms 500) leaves that game stored with its other three answers", async () =>
	{
		let failed: number | null = null;
		const context = setup(NOW, (kind, gamePk) =>
		{
			if (kind !== "uniforms") return undefined;
			failed ??= gamePk;
			return gamePk === failed ? new Response("{}", {
				status: 500,
			}) : undefined;
		});
		await settleOnClock(getDayDigest(context.deps, DATE), 30_000);
		await settleOnClock(context.background.flush(), 60_000);
		expect(missingAfterAnswers(await storedGames(context.deps))).toEqual([`${failed} uniforms`]);
	});

	it("B577 review: one game's late write failing and another's projection write failing still send the one purge with the second game, and the late work still rejects", async () =>
	{
		const { deps, background } = setup();
		await settleOnClock(getDayDigest(deps, DATE), 30_000);
		const [failing, unprojected] = (await deps.schedules.getByDate(DATE))!.games.map(({ gamePk }) => gamePk);
		// From here every write is a late one: the read's batch store already ran.
		const upsertGames = deps.games.upsertMany.bind(deps.games);
		deps.games.upsertMany = async (batch) =>
		{
			if (batch.some((game) => game.gamePk === failing)) throw new Error(`game ${failing} write failed`);
			return upsertGames(batch);
		};
		const upsertProjections = deps.projections.upsertMany.bind(deps.projections);
		deps.projections.upsertMany = async (batch) =>
		{
			if (batch.length === 1 && batch[0]!.header.gamePk === unprojected) throw new Error(`projection ${unprojected} failed`);
			return upsertProjections(batch);
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await settleOnClock(background.flush(), 60_000);
		const late = deps.purger.calls.at(-1)!;
		expect(late.filter((url) => url.includes("/api/v1/games/"))).toHaveLength(14);
		expect(late.some((url) => url.endsWith(`/api/v1/games/${unprojected}`))).toBe(true);
		expect(late.some((url) => url.endsWith(`/api/v1/games/${failing}`))).toBe(false);
		expect(error.mock.calls.some((args) => String(args[1]).includes("late writes of 2 games failed"))).toBe(true);
	});

	it("B577 review: a late write refused by a newer version lacking the rule settings adds them (and the playMetrics) over it", async () =>
	{
		const { deps, background } = setup();
		await settleOnClock(getDayDigest(deps, DATE), 30_000);
		const [first] = (await deps.schedules.getByDate(DATE))!.games.map(({ gamePk }) => gamePk);
		const upsertGames = deps.games.upsertMany.bind(deps.games);
		let newer: GameSnapshot | null = null;
		deps.games.upsertMany = async (batch) =>
		{
			if (!newer && batch[0]!.gamePk === first)
			{
				const stored = (await deps.games.getByPk(first!))!;
				newer = {
					...stored,
					highlights: [],
					version: batch[0]!.version,
				};
				await deps.games.upsert(newer);
			}
			return upsertGames(batch);
		};
		await settleOnClock(background.flush(), 60_000);
		const stored = await deps.games.getByPk(first!);
		expect(stored?.highlights).toEqual([]);
		expect(stored?.version).toBe(newer!.version + 1);
		expect(missingAfterAnswers([stored!])).toEqual([]);
	});

	/**
	 * The first game's late write refused by a newer version holding the recorded playMetrics cut or extended by
	 * `reach` at-bats (the extra ones copies of the last, renumbered) and no rule settings; the game as stored after.
	 */
	async function refusedByNewerReaching(reach: number): Promise<GameSnapshot>
	{
		const { deps, background } = setup();
		await settleOnClock(getDayDigest(deps, DATE), 30_000);
		const [first] = (await deps.schedules.getByDate(DATE))!.games.map(({ gamePk }) => gamePk);
		const upsertGames = deps.games.upsertMany.bind(deps.games);
		let seeded = false;
		deps.games.upsertMany = async (batch) =>
		{
			const late = batch[0]!;
			if (!seeded && late.gamePk === first && late.playMetrics)
			{
				seeded = true;
				const atBats = late.playMetrics.atBats;
				const last = atBats.at(-1)!;
				const { ruleSettings: _without, ...rest } = late;
				await deps.games.upsert({
					...rest,
					highlights: [],
					playMetrics: {
						atBats: reach < 0 ? atBats.slice(0, reach) : [...atBats, ...Array.from({
							length: reach,
						}, (_, i) => ({
							...last,
							atBatIndex: last.atBatIndex + 1 + i,
						}))],
					},
				});
			}
			return upsertGames(batch);
		};
		await settleOnClock(background.flush(), 60_000);
		return (await deps.games.getByPk(first!))!;
	}

	it("B577 review: a late write refused by a newer version whose playMetrics reach a later at-bat keeps those and still adds the rule settings", async () =>
	{
		const stored = await refusedByNewerReaching(1);
		expect(stored.highlights).toEqual([]);
		expect(stored.playMetrics?.atBats).toHaveLength(86);
		expect(stored.ruleSettings).toBeDefined();
	});

	it("B577 review: a late write refused by a newer version whose playMetrics reach an earlier at-bat replaces them with its fuller ones", async () =>
	{
		const stored = await refusedByNewerReaching(-2);
		expect(stored.highlights).toEqual([]);
		expect(stored.playMetrics?.atBats).toHaveLength(85);
		expect(stored.ruleSettings).toBeDefined();
	});
});

describe("B577 review: a stale stored game refreshed by the digest", () =>
{
	it("keeps its stored playMetrics in the answer and the store until the late answer replaces them with fuller ones, and gets the pick's other side", async () =>
	{
		let fan = false;
		const context = setup(SAME_DAY, (kind) =>
		{
			if (kind !== "playerOfTheGame" || !fan) return undefined;
			const pick = JSON.parse(readFileSync(path.join(RAW, "potg-823823.json"), "utf8")) as Record<string, unknown>;
			return new Response(JSON.stringify({
				...pick,
				fanWinner: pick.mediaWinner,
			}));
		});
		const gamePk = await storeThenStale(context);
		fan = true;
		const read = readDayAndGames(context.deps, DATE);
		await settleOnClock(read, 30_000);
		const answered = (await read).games.find((game) => game?.gamePk === gamePk);
		expect(answered?.playMetrics?.atBats).toHaveLength(83);
		expect((await context.deps.games.getByPk(gamePk))?.playMetrics?.atBats).toHaveLength(83);
		await settleOnClock(context.background.flush(), 60_000);
		const stored = await context.deps.games.getByPk(gamePk);
		expect(stored?.playMetrics?.atBats).toHaveLength(85);
		expect(stored?.playerOfTheGame?.media).toBeDefined();
		expect(stored?.playerOfTheGame?.fan).toBeDefined();
	});

	it("keeps its stored playMetrics when the late playMetrics ask fails", async () =>
	{
		let failing = false;
		const context = setup(SAME_DAY, (kind) => failing && kind === "playMetrics" ? new Response("{}", {
			status: 500,
		}) : undefined);
		const gamePk = await storeThenStale(context);
		failing = true;
		await settleOnClock(readDayAndGames(context.deps, DATE), 30_000);
		await settleOnClock(context.background.flush(), 60_000);
		expect((await context.deps.games.getByPk(gamePk))?.playMetrics?.atBats).toHaveLength(83);
		expect(count(context.sent, "playMetrics")).toBe(1);
	});

	it("two viewers at once (one joins the other's fetch, either store may win): the fresh playMetrics are asked once and stored over the carried ones", async () =>
	{
		const context = setup(SAME_DAY);
		const gamePk = await storeThenStale(context);
		await settleOnClock(Promise.all([readDayAndGames(context.deps, DATE), readDayAndGames(context.deps, DATE)]), 30_000);
		await settleOnClock(context.background.flush(), 60_000);
		expect((await context.deps.games.getByPk(gamePk))?.playMetrics?.atBats).toHaveLength(85);
		expect(count(context.sent, "playMetrics")).toBe(1);
	});

	it("whose write is refused because another writer stored the same content first still counts as its own: the fresh playMetrics are asked once and replace the carried ones", async () =>
	{
		const context = setup(SAME_DAY);
		const gamePk = await storeThenStale(context);
		const upsertGames = context.deps.games.upsertMany.bind(context.deps.games);
		let copied = false;
		context.deps.games.upsertMany = async (batch) =>
		{
			const formed = batch.find((game) => game.gamePk === gamePk);
			if (!copied && formed)
			{
				copied = true;
				// The same content at the same version, stored just before: the read's own write is refused.
				await context.deps.games.upsert(formed);
			}
			return upsertGames(batch);
		};
		await settleOnClock(readDayAndGames(context.deps, DATE), 30_000);
		await settleOnClock(context.background.flush(), 60_000);
		expect(copied).toBe(true);
		expect((await context.deps.games.getByPk(gamePk))?.playMetrics?.atBats).toHaveLength(85);
		expect(count(context.sent, "playMetrics")).toBe(1);
	});

	it("whose write another writer's newer version with playMetrics refused asks no playMetrics after the response", async () =>
	{
		const context = setup(SAME_DAY);
		const gamePk = await storeThenStale(context);
		const upsertGames = context.deps.games.upsertMany.bind(context.deps.games);
		let newer: GameSnapshot | null = null;
		context.deps.games.upsertMany = async (batch) =>
		{
			if (!newer && batch[0]!.gamePk === gamePk)
			{
				const stored = (await context.deps.games.getByPk(gamePk))!;
				newer = {
					...stored,
					highlights: [],
					version: batch[0]!.version + 1,
				};
				await context.deps.games.upsert(newer);
			}
			return upsertGames(batch);
		};
		await settleOnClock(readDayAndGames(context.deps, DATE), 30_000);
		await settleOnClock(context.background.flush(), 60_000);
		expect(count(context.sent, "playMetrics")).toBe(0);
		expect((await context.deps.games.getByPk(gamePk))?.highlights).toEqual([]);
	});
});
