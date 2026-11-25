/**
 * S161 AC 3: a game's win-probability line is worked out when its play metrics are written (the game's feed write) and
 * stored on its `game_states` row, so the served day (`readScheduleDay`, `GET /api/v1/schedule?date=`) carries it
 * without reading any game's plays; a schedule write never clears it, a feed write sets it whichever source holds the
 * row, and a change to it alone raises the day's served version.
 */
import type {
	GameSnapshot, ScheduleDay, Unversioned,
} from "@bt/domain";
import { scoreboardWinProbability } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import { InMemorySettingsRepository } from "../adapters/memory/repos.js";
import { handleApiRequest } from "../handlers/api.js";
import { memoryDeps } from "../test/past-data.js";
import { readScheduleDay } from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import { ingestGame, storeSchedule } from "./ingest.js";
import { RefreshCoordinator } from "./refresh.js";

const PK = 823823;
const DATE = "2026-09-05";
/** In 823823's live window (first pitch 2026-09-05 evening ET), and the day the AC opens it long after. */
const IN_WINDOW = "2026-09-05T23:59:00.000Z";
const LATER = new Date("2026-11-20T12:00:00Z");

/** Memory deps read at `now`, with an edge purger that records what it was asked to drop. */
function deps(now = LATER): ReturnType<typeof memoryDeps>
{
	return {
		...memoryDeps(),
		now: () => now,
		refresh: new RefreshCoordinator(() => now),
	};
}

async function fetched823823(fetchedAt: string): Promise<Unversioned<GameSnapshot>>
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(PK);
	return {
		...game,
		fetchedAt,
	};
}

/** The 2026-09-05 fixture day as the schedule fetches it, at `fetchedAt`. */
async function day(fetchedAt: string): Promise<Unversioned<ScheduleDay>>
{
	return {
		...await new FixtureMlbStatsClient().fetchSchedule(DATE),
		fetchedAt,
	};
}

const served = (served: ScheduleDay | null) => served?.games.find((game) => game.gamePk === PK);

/** The API over `ingest`. */
function api(ingest: IngestDeps)
{
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx = {
		ingest,
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return async (path: string) =>
	{
		const response = await handleApiRequest(new Request(`http://localhost:8787${path}`), ctx);
		expect(response.status).toBe(200);
		return await response.json() as ScheduleDay;
	};
}

describe("the scoreboard's win-probability line, stored at write time (S161 AC 3)", () =>
{
	it("S161 AC 3 schedule write keeps the line: a final game's row with its line, then a schedule-source write, still serves it", async () =>
	{
		const d = deps();
		const game = await fetched823823(IN_WINDOW);
		const line = scoreboardWinProbability(game);
		expect(line).not.toBeNull();
		await ingestGame(d, game);
		expect((await d.gameStates.getByPk(PK))?.winProbability).toEqual(line);
		// Long after the window the schedule owns the row; its refresh, carrying no play metrics, writes a scoring
		// correction (one more home hit), so the row is the schedule's write.
		const fetchedDay = await day(LATER.toISOString());
		await storeSchedule(d, {
			...fetchedDay,
			games: fetchedDay.games.map((g) => g.gamePk === PK && g.linescore
				? {
					...g,
					linescore: {
						...g.linescore,
						teams: {
							...g.linescore.teams,
							home: {
								...g.linescore.teams.home,
								hits: (g.linescore.teams.home.hits ?? 0) + 1,
							},
						},
					},
				}
				: g),
		});
		const row = await d.gameStates.getByPk(PK);
		expect(row?.source).toBe("schedule");
		expect(row?.winProbability).toEqual(line);
		expect(served(await readScheduleDay(d, DATE, LATER))?.winProbability).toEqual(line);
	});

	it("S161 AC 3 first ingested after its window: the schedule owns the row, then the game's ingest gives 823823 its line", async () =>
	{
		const d = deps();
		const get = api(d);
		// /games/2026-09-05 opened on 2026-11-20: the day is stored from the schedule, which owns every row.
		const before = served(await get(`/api/v1/schedule?date=${DATE}`));
		expect(before?.status.codedGameState).toBe("F");
		expect(before?.winProbability).toBeNull();
		expect((await d.gameStates.getByPk(PK))?.source).toBe("schedule");
		const versionBefore = (await readScheduleDay(d, DATE, LATER))!.version;
		d.purger.calls.length = 0;
		// Then the game is opened: its first ingest writes play metrics through the feed.
		await ingestGame(d, await fetched823823(LATER.toISOString()));
		const row = await d.gameStates.getByPk(PK);
		expect(row?.source).toBe("schedule");
		expect(row?.winProbability).toEqual(scoreboardWinProbability(await fetched823823(LATER.toISOString())));
		const after = await readScheduleDay(d, DATE, LATER);
		expect(served(after)?.winProbability).toEqual(row?.winProbability);
		expect(after!.version).toBeGreaterThan(versionBefore);
		// The day's long-cached edge copy is dropped, so the edge serves the line (S212).
		expect(d.purger.purged.some((url) => url.endsWith(`/api/v1/schedule?date=${DATE}`))).toBe(true);
	});

	it("S161 AC 3 line change raises the day version: an unchanged state with one new play metric raises the day's version and lastChangedAt", async () =>
	{
		const d = deps(new Date(IN_WINDOW));
		const whole = await fetched823823(IN_WINDOW);
		const metrics = whole.playMetrics!.atBats;
		const lastMeasured = metrics.filter((m) => m.homeWinProbability != null).at(-1)!;
		const fewer = {
			...whole,
			playMetrics: {
				...whole.playMetrics!,
				atBats: metrics.filter((m) => m !== lastMeasured),
			},
		};
		await storeSchedule(d, await day(IN_WINDOW));
		await ingestGame(d, fewer);
		const first = await readScheduleDay(d, DATE, new Date(IN_WINDOW));
		const firstRow = await d.gameStates.getByPk(PK);
		const later = "2026-09-06T00:00:30.000Z";
		await ingestGame(d, {
			...whole,
			fetchedAt: later,
		});
		const second = await readScheduleDay(d, DATE, new Date(later));
		const secondRow = await d.gameStates.getByPk(PK);
		expect(secondRow?.state.status).toEqual(firstRow?.state.status);
		expect(secondRow?.state.linescore).toEqual(firstRow?.state.linescore);
		expect(secondRow?.state.version).toBe(firstRow!.state.version + 1);
		expect(second!.version).toBeGreaterThan(first!.version);
		expect(Date.parse(second!.lastChangedAt)).toBeGreaterThan(Date.parse(first!.lastChangedAt));
		expect(served(second)?.winProbability?.points.length).toBe(served(first)!.winProbability!.points.length + 1);
		expect(served(second)?.winProbability?.current).toBe(lastMeasured.homeWinProbability);
	});

	it("S161 AC 3 schedule read reads no game snapshot: the day and its route are served from the rows alone", async () =>
	{
		const d = deps();
		await storeSchedule(d, await day(LATER.toISOString()));
		await ingestGame(d, await fetched823823(LATER.toISOString()));
		const line = (await d.gameStates.getByPk(PK))?.winProbability;
		expect(line).toBeTruthy();
		// A games store that fails any read: a schedule read must load no game's snapshot (or plays).
		const failing = new Proxy(d.games, {
			get(target, prop, receiver)
			{
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== "function") return value;
				return /^(get|list)/.test(String(prop))
					? () => Promise.reject(new Error(`schedule read touched games.${String(prop)}`))
					: value.bind(target);
			},
		});
		const guarded = {
			...d,
			games: failing,
		};
		expect(served(await readScheduleDay(guarded, DATE, LATER))?.winProbability).toEqual(line);
		expect(served(await api(guarded)(`/api/v1/schedule?date=${DATE}`))?.winProbability).toEqual(line);
	});

	it("S161 AC 3 route serves the line: GET /api/v1/schedule on the 823823 day carries every game's line or null", async () =>
	{
		const d = deps();
		const get = api(d);
		await get(`/api/v1/schedule?date=${DATE}`);
		await ingestGame(d, await fetched823823(LATER.toISOString()));
		const body = await get(`/api/v1/schedule?date=${DATE}`);
		const game = served(body);
		expect(game?.winProbability?.points.length).toBeGreaterThan(10);
		expect(game?.winProbability?.current).toBe(game?.winProbability?.points.at(-1));
		// Every game carries the field; the games never ingested carry null.
		for (const other of body.games) expect(other).toHaveProperty("winProbability");
		expect(body.games.filter((g) => g.gamePk !== PK).every((g) => g.winProbability === null)).toBe(true);
	});
});
