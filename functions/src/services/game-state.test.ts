/**
 * S150: one stored copy of each game's shared state (`game_states`), written only through the switch
 * (`switchGameState`), handed every poll by both writers and read by the day and game reads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	FetchedGame, GameSnapshot, GameState, ScheduleDay, ScheduleGameSummary, Unversioned,
} from "@bt/domain";
import { gameStateFromGame, gameStateFromSummary } from "@bt/domain";
import { parseLiveFeedResponse, parseScheduleResponse } from "@bt/mlb-api";
import {
	describe, expect, it, vi,
} from "vitest";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryGameStateRepository, InMemoryScheduleRepository,
} from "../adapters/memory/repos.js";
import { mapLiveFeed } from "../mappers/live.js";
import { mapScheduleResponse } from "../mappers/schedule.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import { GameIngest } from "./game-ingest.js";
import {
	readScheduleDay, readServedGame, servedGame, switchGameState,
} from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import {
	getOrRefreshGame, getOrRefreshSchedule, ingestGame, storeSchedule, tickIngest,
} from "./ingest.js";
import { liveFixtureAt, scheduleMomentsAt } from "./live-fixture.js";
import { LiveHubState } from "./live-hub.js";
import { RefreshCoordinator } from "./refresh.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw");

const LIVE = {
	abstractGameState: "Live",
	codedGameState: "I",
	detailedState: "In Progress",
};
const FINAL = {
	abstractGameState: "Final",
	codedGameState: "F",
	detailedState: "Final",
};
const SCHEDULED = {
	abstractGameState: "Preview",
	codedGameState: "S",
	detailedState: "Scheduled",
};
const POSTPONED = {
	abstractGameState: "Final",
	codedGameState: "D",
	detailedState: "Postponed",
};

/** First pitch 7:05pm ET on 2026-09-05; in its window at `IN`, past a final's trail at `AFTER`. */
const DATE = "2026-09-05";
const START = "2026-09-05T23:05:00.000Z";
const BEFORE = new Date("2026-09-05T12:00:00Z");
const IN = new Date("2026-09-05T23:30:00Z");
const AFTER = new Date("2026-09-07T12:00:00Z");
const PK = 745001;

function memoryDeps(mlb = new FixtureMlbStatsClient()): IngestDeps & { gameStates: InMemoryGameStateRepository }
{
	return {
		mlb,
		schedules: new InMemoryScheduleRepository(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		gameStates: new InMemoryGameStateRepository(),
	};
}

/** A linescore with the home side at `home` runs. */
function linescore(home: number): NonNullable<GameSnapshot["linescore"]>
{
	return {
		currentInning: 7,
		inningState: "Top",
		isTopInning: true,
		outs: 1,
		balls: 1,
		strikes: 2,
		teams: {
			home: {
				runs: home,
				hits: 6,
				errors: 0,
			},
			away: {
				runs: 1,
				hits: 4,
				errors: 0,
			},
		},
	};
}

/** The fixture game `gamePk` on `DATE` at `status` and `home` runs, as the feed fetch returns it. */
async function feedGame(status: GameSnapshot["status"], home: number, gamePk = PK): Promise<Unversioned<GameSnapshot>>
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(PK);
	return {
		...game,
		gamePk,
		gameDate: DATE,
		officialDate: DATE,
		startTime: START,
		status,
		linescore: linescore(home),
		live: null,
	};
}

/** The fixture's scoreboard row for `gamePk` on `DATE` at `status` and `home` runs, as the schedule fetch returns it. */
async function summary(status: ScheduleGameSummary["status"], home: number, gamePk = PK): Promise<ScheduleGameSummary>
{
	const [row] = (await new FixtureMlbStatsClient().fetchSchedule("2024-07-04")).games;
	return {
		...row!,
		gamePk,
		gameDate: DATE,
		officialDate: DATE,
		startTime: START,
		status,
		linescore: linescore(home),
		live: null,
	};
}

/** A schedule fetch of `date` listing `games`, polled at `now`. */
function fetchedDay(games: ScheduleGameSummary[], now: Date, date = DATE): Unversioned<ScheduleDay>
{
	return {
		date,
		games,
		fetchedAt: now.toISOString(),
		windowMode: "active",
	};
}

/** What a switch write from `source` looks like for the fixture game. */
function write(source: "feed" | "schedule", state: Unversioned<GameState>, feedTime?: string)
{
	return {
		gamePk: PK,
		source,
		state,
		officialDate: DATE,
		startTime: START,
		...feedTime !== undefined && {
			feedTime,
		},
	};
}

const homeRuns = (state: { linescore: GameSnapshot["linescore"] } | null | undefined) => state?.linescore?.teams.home.runs ?? null;

describe("game state from MLB's two sources (S150 AC 1)", () =>
{
	it("S150 AC 1 live pair: 823823's feed and its schedule row at LIVE_FIXTURE_TIMECODE give the same status, linescore, runners and players", () =>
	{
		// The row is built from the feed recording (`scheduleMomentsAt`), since no MLB schedule was recorded mid-game: this
		// checks the row builder, not MLB's schedule.
		const fromRow = gameStateFromSummary(scheduleMomentsAt(RAW).live);
		const fromFeed = gameStateFromGame(liveFixtureAt(RAW));
		expect(fromRow.status.codedGameState).toBe("I");
		expect(fromFeed.status).toEqual(fromRow.status);
		expect(fromFeed.linescore).toEqual(fromRow.linescore);
		expect(fromFeed.live?.runners).toEqual(fromRow.live?.runners);
		// Both read the batter and pitcher from the feed's current play here, so they agree.
		expect(fromFeed.live).toEqual(fromRow.live);
	});

	it("S150 AC 1 final pair: the real schedule mapper on 2026-09-05 and the final feed give 823823 the same status and linescore", () =>
	{
		const read = (name: string): unknown => JSON.parse(readFileSync(path.join(RAW, name), "utf8"));
		const day = mapScheduleResponse(parseScheduleResponse(read("schedule-2026-09-05.json")), "2026-09-05", "");
		const fromSchedule = gameStateFromSummary(day.games.find((game) => game.gamePk === 823823)!);
		const fromFeed = gameStateFromGame(mapLiveFeed(parseLiveFeedResponse(read("live-823823.json")), ""));
		expect(fromSchedule.status).toEqual(fromFeed.status);
		expect(fromSchedule.linescore).toEqual(fromFeed.linescore);
		// A final game has no moment on either side. In play they can differ: the schedule reads the batter and pitcher
		// from its linescore, the feed from the current play, which part ways between batters.
		expect(fromSchedule.live).toBeNull();
		expect(fromFeed.live).toBeNull();
	});
});

describe("the feed's own time beside the game (S150 AC 2)", () =>
{
	it("S150 AC 2 never stored: the feed time reaches the row, never the stored game or the hub's push", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		const game = await feedGame(LIVE, 2);
		mlb.fetchGame = async (): Promise<FetchedGame> => ({
			game,
			feedTime: "2026-09-05T23:29:58.000Z",
		});
		const deps = memoryDeps(mlb);
		const published: GameSnapshot[] = [];
		const ingest = new GameIngest(new FakeDurableStorage(), deps, async (_hub, snapshot) =>
		{
			published.push(snapshot);
		});
		await ingest.hubs.register("hub-a", IN);
		await ingest.ensureRunning(PK, IN);
		await ingest.alarm(IN);
		expect(published).toHaveLength(1);
		expect(published[0]).not.toHaveProperty("feedTime");
		expect(JSON.stringify(published[0])).not.toContain("feedTime");
		expect(await deps.games.getByPk(PK)).not.toHaveProperty("feedTime");
		expect((await deps.gameStates.getByPk(PK))?.feedTime).toBe("2026-09-05T23:29:58.000Z");
	});
});

describe("switchGameState, the one writer (S150 AC 4)", () =>
{
	it("S150 AC 4 in the window: a schedule a run behind, arriving after a feed write, leaves the feed's score", async () =>
	{
		const deps = memoryDeps();
		await switchGameState(deps, write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))), BEFORE);
		await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 3)), "2026-09-05T23:29:00.000Z"), IN);
		const kept = await switchGameState(deps, write("schedule", gameStateFromSummary(await summary(LIVE, 2))), IN);
		expect(homeRuns(kept?.state)).toBe(3);
		expect(kept?.source).toBe("feed");
	});

	it("S150 AC 4 trail: a final game in its trail keeps the feed's final when a schedule a run behind arrives", async () =>
	{
		const deps = memoryDeps();
		await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		const kept = await switchGameState(deps, write("schedule", gameStateFromSummary(await summary(FINAL, 4))), new Date("2026-09-06T04:00:00Z"));
		expect(homeRuns(kept?.state)).toBe(5);
	});

	it("S150 AC 4 feed time: an older feed time is skipped; an unchanged poll moves the accepted time, so a stale copy between the two polls is then skipped", async () =>
	{
		const deps = memoryDeps();
		const at3 = gameStateFromGame(await feedGame(LIVE, 3));
		await switchGameState(deps, write("feed", at3, "2026-09-05T23:20:00.000Z"), IN);
		const older = await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 2)), "2026-09-05T23:10:00.000Z"), IN);
		expect(homeRuns(older?.state)).toBe(3);
		// The same state polled later: no new version, but the accepted time moves.
		const polled = await switchGameState(deps, write("feed", at3, "2026-09-05T23:30:00.000Z"), IN);
		expect(polled?.state.version).toBe(1);
		expect((await deps.gameStates.getByPk(PK))?.feedTime).toBe("2026-09-05T23:30:00.000Z");
		// A cached copy from between the two polls, a run behind, is now older than the accepted time.
		const stale = await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 2)), "2026-09-05T23:25:00.000Z"), IN);
		expect(homeRuns(stale?.state)).toBe(3);
	});

	it("S150 AC 4 no feed time: a game with no feed time is never skipped for its time and never moves the accepted time", async () =>
	{
		const deps = memoryDeps();
		await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 3)), "2026-09-05T23:20:00.000Z"), IN);
		const written = await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 4))), IN);
		expect(homeRuns(written?.state)).toBe(4);
		expect((await deps.gameStates.getByPk(PK))?.feedTime).toBe("2026-09-05T23:20:00.000Z");
	});

	it("S150 AC 4 after the window: a schedule state is written and a feed state isn't", async () =>
	{
		const deps = memoryDeps();
		await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		const corrected = await switchGameState(deps, write("schedule", gameStateFromSummary(await summary(FINAL, 6))), AFTER);
		expect(homeRuns(corrected?.state)).toBe(6);
		expect(corrected?.source).toBe("schedule");
		const late = await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-07T11:00:00.000Z"), AFTER);
		expect(homeRuns(late?.state)).toBe(6);
	});

	it("S150 AC 4 first state: a game with no row takes it from either source", async () =>
	{
		const fromFeed = memoryDeps();
		expect(homeRuns((await switchGameState(fromFeed, write("feed", gameStateFromGame(await feedGame(FINAL, 5))), AFTER))?.state)).toBe(5);
		const fromSchedule = memoryDeps();
		expect(homeRuns((await switchGameState(fromSchedule, write("schedule", gameStateFromSummary(await summary(LIVE, 1))), IN))?.state)).toBe(1);
	});
});

describe("both writers hand over every poll (S150 AC 5)", () =>
{
	it("S150 AC 5 tick: an unchanged snapshot still reaches the switch through tickIngest, mending a row the schedule wrote while live", async () =>
	{
		// MLB's 2024-07-04 at 19:00 ET: its fixture lists 745001 in progress, so the tick fetches it.
		const deps = memoryDeps();
		const now = new Date("2024-07-04T23:00:00Z");
		await tickIngest(deps, now);
		const fed = (await deps.gameStates.getByPk(PK))!;
		expect(await deps.games.getByPk(PK)).not.toBeNull();
		// A copy the schedule wrote while the game was live (as a backfilled row could be): a newer version, older score.
		await deps.gameStates.write({
			...fed,
			source: "schedule",
			state: {
				...fed.state,
				linescore: linescore(0),
				version: fed.state.version + 1,
			},
		});
		const snapshot = await deps.games.getByPk(PK);
		await tickIngest(deps, new Date(now.getTime() + 15_000));
		expect((await deps.games.getByPk(PK))?.version).toBe(snapshot?.version);
		const mended = await deps.gameStates.getByPk(PK);
		expect(mended?.source).toBe("feed");
		expect(mended?.state.linescore).toEqual(snapshot?.linescore);
	});

	it("S150 AC 5 unchanged day: a stored day that doesn't change still hands over a postponement", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, fetchedDay([await summary(SCHEDULED, 0)], BEFORE));
		const stored = await deps.schedules.getByDate(DATE);
		const postponed = await summary(POSTPONED, 0);
		const day = await storeSchedule(deps, fetchedDay([{
			...postponed,
			linescore: null,
		}], new Date("2026-09-05T13:00:00Z")));
		expect((await deps.schedules.getByDate(DATE))?.version).toBe(stored?.version);
		expect(day.games[0]?.status.codedGameState).toBe("D");
		expect((await deps.gameStates.getByPk(PK))?.state.status.codedGameState).toBe("D");
	});

	it("S150 AC 5 stop: a stop after the snapshot's write is mended by the next poll", async () =>
	{
		const deps = memoryDeps();
		const upsert = deps.projections.upsert.bind(deps.projections);
		let stopped = false;
		deps.projections.upsert = async (projection) =>
		{
			if (!stopped)
			{
				stopped = true;
				throw new Error("the Worker stopped");
			}
			await upsert(projection);
		};
		const game = {
			...await feedGame(LIVE, 3),
			fetchedAt: IN.toISOString(),
			windowMode: "active" as const,
		};
		await expect(ingestGame(deps, game, "2026-09-05T23:29:00.000Z")).rejects.toThrow("stopped");
		expect(await deps.games.getByPk(PK)).not.toBeNull();
		expect(await deps.gameStates.getByPk(PK)).toBeNull();
		const next = await ingestGame(deps, {
			...game,
			fetchedAt: new Date(IN.getTime() + 15_000).toISOString(),
		}, "2026-09-05T23:29:15.000Z");
		expect(next.changed).toBe(false);
		expect(homeRuns((await deps.gameStates.getByPk(PK))?.state)).toBe(3);
	});
});

describe("readers use the one stored state (S150 AC 6)", () =>
{
	it("S150 AC 6 day read: shows a feed score newer than the day's schedule fetch, and the game read shows the same score", async () =>
	{
		const deps = memoryDeps();
		deps.now = () => IN;
		await storeSchedule(deps, fetchedDay([await summary(LIVE, 1)], IN));
		const before = (await getOrRefreshSchedule(deps, DATE)).version;
		await ingestGame(deps, {
			...await feedGame(LIVE, 4),
			fetchedAt: IN.toISOString(),
			windowMode: "active",
		}, "2026-09-05T23:30:00.000Z");
		const day = await getOrRefreshSchedule(deps, DATE);
		expect(homeRuns(day.games[0])).toBe(4);
		// A state change raises the day's version.
		expect(day.version).toBeGreaterThan(before);
		expect(homeRuns(await getOrRefreshGame(deps, PK))).toBe(4);
	});

	it("S150 AC 6 dropped: a game dropped from a day doesn't lower its version, even when the Worker stops between the day's read and write", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, fetchedDay([await summary(FINAL, 2), await summary(FINAL, 3, 999)], AFTER));
		const before = (await readScheduleDay(deps, DATE, AFTER))!.version;
		const upsert = deps.schedules.upsert.bind(deps.schedules);
		deps.schedules.upsert = async () =>
		{
			throw new Error("the Worker stopped");
		};
		await expect(storeSchedule(deps, fetchedDay([await summary(FINAL, 2)], AFTER))).rejects.toThrow("stopped");
		expect((await readScheduleDay(deps, DATE, AFTER))!.version).toBeGreaterThanOrEqual(before);
		deps.schedules.upsert = upsert;
		const dropped = await storeSchedule(deps, fetchedDay([await summary(FINAL, 2)], AFTER));
		expect(dropped.games.map((game) => game.gamePk)).toEqual([PK]);
		expect(dropped.version).toBeGreaterThan(before);
		expect((await deps.schedules.getWithServedBase(DATE))?.servedBase).toBe(1);
	});

	it("S150 AC 6 no row: a game with no row is served from its snapshot, or as scheduled with no score", async () =>
	{
		const deps = memoryDeps();
		await deps.schedules.upsert({
			date: DATE,
			games: [await summary(SCHEDULED, 0), await summary(SCHEDULED, 0, 999)],
			fetchedAt: AFTER.toISOString(),
			windowMode: "cache",
			version: 1,
			lastChangedAt: AFTER.toISOString(),
		});
		await deps.games.upsert({
			...await feedGame(FINAL, 7),
			fetchedAt: AFTER.toISOString(),
			windowMode: "cache",
			version: 2,
			lastChangedAt: AFTER.toISOString(),
		});
		const day = (await readScheduleDay(deps, DATE, AFTER))!;
		expect(day.games.map((game) => [game.status.codedGameState, homeRuns(game)])).toEqual([["F", 7], ["S", null]]);
	});

	it("S150 AC 6 two days: a game listed on two days shows the same state on both", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, fetchedDay([await summary(FINAL, 3)], AFTER, "2026-09-04"));
		await storeSchedule(deps, fetchedDay([await summary(FINAL, 5)], AFTER));
		const first = (await readScheduleDay(deps, "2026-09-04", AFTER))!;
		const second = (await readScheduleDay(deps, DATE, AFTER))!;
		expect(homeRuns(first.games[0])).toBe(5);
		expect(first.games[0]?.status).toEqual(second.games[0]?.status);
	});

	it("S150 AC 6 window: a day stored active whose joined games are all final past their trails is served cache and goes stale on the cache ladder", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, fetchedDay([await summary(LIVE, 2)], IN));
		expect((await deps.schedules.getByDate(DATE))?.windowMode).toBe("active");
		// The feed's final lands in the row; the stored day (its schedule data) is untouched.
		await switchGameState(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 4)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		expect((await readScheduleDay(deps, DATE, AFTER))?.windowMode).toBe("cache");
		const fetchSchedule = vi.fn(async () => fetchedDay([await summary(FINAL, 4)], AFTER));
		deps.mlb.fetchSchedule = fetchSchedule;
		deps.now = () => AFTER;
		deps.refresh = new RefreshCoordinator(() => AFTER);
		const day = await getOrRefreshSchedule(deps, DATE);
		expect(fetchSchedule).toHaveBeenCalledTimes(1);
		expect(day.windowMode).toBe("cache");
	});

	it("S150 AC 6 served game: the HTTP read's version equals the hub's first send, and the next change is pushed one version higher", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		let home = 2;
		mlb.fetchGame = async (): Promise<FetchedGame> => ({
			game: await feedGame(LIVE, home),
		});
		const deps = memoryDeps(mlb);
		deps.now = () => IN;
		const pushed: GameSnapshot[] = [];
		const ingest = new GameIngest(new FakeDurableStorage(), deps, async (_hub, snapshot) =>
		{
			pushed.push(snapshot);
		});
		await ingest.hubs.register("hub-a", IN);
		await ingest.ensureRunning(PK, IN);
		await ingest.alarm(IN);
		const read = await getOrRefreshGame(deps, PK);
		const hub = new LiveHubState(() => readServedGame(deps, PK));
		const first = await hub.onConnect();
		expect(first?.version).toBe(read?.version);
		expect(first?.linescore).toEqual(read?.linescore);
		home = 3;
		await ingest.alarm(new Date(IN.getTime() + 15_000));
		const next = pushed.at(-1)!;
		expect(next.version).toBe(read!.version + 1);
		expect(homeRuns(next)).toBe(3);
		expect(await hub.accept(next)).toBe(true);
	});

	it("S150 AC 6 served game: status and linescore come from the row, the version from the snapshot, the later change time of the two", async () =>
	{
		const snapshot: GameSnapshot = {
			...await feedGame(LIVE, 2),
			fetchedAt: IN.toISOString(),
			windowMode: "active",
			version: 9,
			lastChangedAt: "2026-09-05T23:00:00.000Z",
		};
		expect(servedGame(snapshot, null)).toBe(snapshot);
		const served = servedGame(snapshot, {
			state: {
				...gameStateFromSummary(await summary(FINAL, 5)),
				version: 2,
				lastChangedAt: "2026-09-06T03:00:00.000Z",
			},
		});
		expect(served.version).toBe(9);
		expect(served.status).toEqual(FINAL);
		expect(homeRuns(served)).toBe(5);
		expect(served.lastChangedAt).toBe("2026-09-06T03:00:00.000Z");
	});
});
