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
import type { InMemoryGameStateRepository } from "../adapters/memory/repos.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import { mapLiveFeed } from "../mappers/live.js";
import { mapScheduleResponse } from "../mappers/schedule.js";
import { FakeDurableStorage } from "./fake-durable-storage.js";
import { GameIngest } from "./game-ingest.js";
import type { GameStateWrite } from "./game-state.js";
import {
	readJoinedScheduleDay, readScheduleDay, readServedGame, servedGame, switchGameState,
} from "./game-state.js";
import type { IngestDeps } from "./ingest.js";
import {
	getOrRefreshGame, getOrRefreshSchedule, ingestGame, refreshTodaysWindow, storeSchedule, tickIngest,
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
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
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

/** `switchGameState` with one write: the game's row as it is then stored. */
async function one(deps: Pick<IngestDeps, "gameStates">, gameWrite: GameStateWrite, now: Date)
{
	return (await switchGameState(deps, [gameWrite], now)).get(gameWrite.gamePk)?.row ?? null;
}

const homeRuns = (state: { linescore: GameSnapshot["linescore"] } | null | undefined) => state?.linescore?.teams.home.runs ?? null;

describe("game state from MLB's two sources (S150 AC 1)", () =>
{
	// Skipped (owner, 2026-11-24: "Don't remove it, skip the test and file the bug to fix it."): it times out at 20 s on
	// CI runners and has failed two stage runs, one blocking a staging deploy. #508 makes it cheaper and turns it back on;
	// until then S150's feed/schedule agreement has no guard here, so #508 must re-enable this exact test.
	it.skip("S150 AC 1 live pair: 823823's feed and its schedule row at LIVE_FIXTURE_TIMECODE give the same status, linescore, runners and players", () =>
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
		await one(deps, write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))), BEFORE);
		await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 3)), "2026-09-05T23:29:00.000Z"), IN);
		const kept = await one(deps, write("schedule", gameStateFromSummary(await summary(LIVE, 2))), IN);
		expect(homeRuns(kept?.state)).toBe(3);
		expect(kept?.source).toBe("feed");
	});

	it("S150 AC 4 trail: a final game in its trail keeps the feed's final when a schedule a run behind arrives", async () =>
	{
		const deps = memoryDeps();
		await one(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		const kept = await one(deps, write("schedule", gameStateFromSummary(await summary(FINAL, 4))), new Date("2026-09-06T04:00:00Z"));
		expect(homeRuns(kept?.state)).toBe(5);
	});

	it("S150 AC 4 feed time: an older feed time is skipped; an unchanged poll moves the accepted time, so a stale copy between the two polls is then skipped", async () =>
	{
		const deps = memoryDeps();
		const at3 = gameStateFromGame(await feedGame(LIVE, 3));
		await one(deps, write("feed", at3, "2026-09-05T23:20:00.000Z"), IN);
		const older = await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 2)), "2026-09-05T23:10:00.000Z"), IN);
		expect(homeRuns(older?.state)).toBe(3);
		// The same state polled later: no new version, but the accepted time moves.
		const polled = await one(deps, write("feed", at3, "2026-09-05T23:30:00.000Z"), IN);
		expect(polled?.state.version).toBe(1);
		expect((await deps.gameStates.getByPk(PK))?.feedTime).toBe("2026-09-05T23:30:00.000Z");
		// A cached copy from between the two polls, a run behind, is now older than the accepted time.
		const stale = await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 2)), "2026-09-05T23:25:00.000Z"), IN);
		expect(homeRuns(stale?.state)).toBe(3);
	});

	it("S150 AC 4 no feed time: a game with no feed time is never skipped for its time and never moves the accepted time", async () =>
	{
		const deps = memoryDeps();
		await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 3)), "2026-09-05T23:20:00.000Z"), IN);
		const written = await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 4))), IN);
		expect(homeRuns(written?.state)).toBe(4);
		expect((await deps.gameStates.getByPk(PK))?.feedTime).toBe("2026-09-05T23:20:00.000Z");
	});

	it("S150 AC 4 after the window: a schedule state is written and a feed state isn't", async () =>
	{
		const deps = memoryDeps();
		await one(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		const corrected = await one(deps, write("schedule", gameStateFromSummary(await summary(FINAL, 6))), AFTER);
		expect(homeRuns(corrected?.state)).toBe(6);
		expect(corrected?.source).toBe("schedule");
		const late = await one(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 5)), "2026-09-07T11:00:00.000Z"), AFTER);
		expect(homeRuns(late?.state)).toBe(6);
	});

	it("S150 AC 4 first state: a game with no row takes it from either source", async () =>
	{
		const fromFeed = memoryDeps();
		expect(homeRuns((await one(fromFeed, write("feed", gameStateFromGame(await feedGame(FINAL, 5))), AFTER))?.state)).toBe(5);
		const fromSchedule = memoryDeps();
		expect(homeRuns((await one(fromSchedule, write("schedule", gameStateFromSummary(await summary(LIVE, 1))), IN))?.state)).toBe(1);
	});

	/** Makes `deps`' next game-state write land `competitor` first, as another writer between the switch's read and write. */
	function racedBy(deps: ReturnType<typeof memoryDeps>, competitor: () => Promise<unknown>): void
	{
		const original = deps.gameStates.write.bind(deps.gameStates);
		let raced = false;
		deps.gameStates.write = async (rows) =>
		{
			if (!raced)
			{
				raced = true;
				await competitor();
			}
			return original(rows);
		};
	}

	it("S150 AC 4 race: a write that loses to another writer's same version is decided again on the new row, never landing a second state at that version", async () =>
	{
		const deps = memoryDeps();
		await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 3)), "2026-09-05T23:29:00.000Z"), IN);
		const v1 = (await deps.gameStates.getByPk(PK))!;
		// Another feed writer (the cron's tick beside the ingest object) stamps v2 with home 5 from an earlier copy.
		racedBy(deps, () => deps.gameStates.write([{
			...v1,
			feedTime: "2026-09-05T23:29:10.000Z",
			state: {
				...gameStateFromGame({
					...v1.state,
					linescore: linescore(5),
					plays: [],
				}),
				version: 2,
				lastChangedAt: "2026-09-05T23:29:10.000Z",
			},
		}]));
		const row = await one(deps, write("feed", gameStateFromGame(await feedGame(LIVE, 4)), "2026-09-05T23:29:20.000Z"), new Date(IN.getTime() + 15_000));
		expect(row?.state.version).toBe(3);
		expect(homeRuns(row?.state)).toBe(4);
		expect(await deps.gameStates.getByPk(PK)).toEqual(row);
	});

	it("S150 AC 4 race: the retry asks the switch again, so a schedule write that lost to the feed's in-progress state is dropped", async () =>
	{
		const deps = memoryDeps();
		await one(deps, write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))), BEFORE);
		const v1 = (await deps.gameStates.getByPk(PK))!;
		// While the schedule's refresh runs, the feed writes the game in progress (it started early).
		racedBy(deps, () => deps.gameStates.write([{
			...v1,
			source: "feed",
			feedTime: "2026-09-05T12:00:30.000Z",
			state: {
				...gameStateFromGame(feedGameState(LIVE, 1)),
				version: 2,
				lastChangedAt: "2026-09-05T12:00:30.000Z",
			},
		}]));
		// The schedule's refresh read v1 and stamps its own change (warm-up) as v2.
		const warmup = {
			...gameStateFromSummary(await summary(SCHEDULED, 0)),
			status: {
				abstractGameState: "Live",
				codedGameState: "P",
				detailedState: "Warmup",
			},
		};
		const row = await one(deps, write("schedule", warmup), new Date("2026-09-05T12:00:40Z"));
		expect(row).toMatchObject({
			source: "feed",
			state: {
				status: LIVE,
				version: 2,
			},
		});
	});
});

/** A feed state at `status` and `home` runs, with no at-bats. */
function feedGameState(status: GameSnapshot["status"], home: number)
{
	return {
		status,
		linescore: linescore(home),
		live: null,
		plays: [],
	};
}

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
		await deps.gameStates.write([{
			...fed,
			source: "schedule",
			state: {
				...fed.state,
				linescore: linescore(0),
				version: fed.state.version + 1,
			},
		}]);
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
		const postponed = {
			...await summary(POSTPONED, 0),
			linescore: null,
		};
		await storeSchedule(deps, fetchedDay([postponed], new Date("2026-09-05T13:00:00Z")));
		const stored = await deps.schedules.getByDate(DATE);
		// The row moves away from the postponement without the stored day changing (as another writer could leave it).
		await one(deps, write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))), new Date("2026-09-05T13:30:00Z"));
		expect((await deps.gameStates.getByPk(PK))?.state.status.codedGameState).toBe("S");
		const day = await storeSchedule(deps, fetchedDay([postponed], new Date("2026-09-05T14:00:00Z")));
		expect((await deps.schedules.getByDate(DATE))?.version).toBe(stored?.version);
		expect(day.games[0]?.status.codedGameState).toBe("D");
		expect((await deps.gameStates.getByPk(PK))?.state.status.codedGameState).toBe("D");
	});

	it("S150 AC 5 stop: a stop between the row's write and the snapshot's is mended by the next poll", async () =>
	{
		const deps = memoryDeps();
		const upsert = deps.games.upsert.bind(deps.games);
		let stopped = false;
		deps.games.upsert = async (game) =>
		{
			if (!stopped)
			{
				stopped = true;
				throw new Error("the Worker stopped");
			}
			await upsert(game);
		};
		const game = {
			...await feedGame(LIVE, 3),
			fetchedAt: IN.toISOString(),
			windowMode: "active" as const,
		};
		await expect(ingestGame(deps, game, "2026-09-05T23:29:00.000Z")).rejects.toThrow("stopped");
		// The row is written first (S150: the served game is never a new snapshot with an old row's score).
		expect(homeRuns((await deps.gameStates.getByPk(PK))?.state)).toBe(3);
		expect(await deps.games.getByPk(PK)).toBeNull();
		const next = await ingestGame(deps, {
			...game,
			fetchedAt: new Date(IN.getTime() + 15_000).toISOString(),
		}, "2026-09-05T23:29:15.000Z");
		expect(next.changed).toBe(true);
		expect(homeRuns(await deps.games.getByPk(PK))).toBe(3);
	});

	it("S150 AC 5 stop: a stop after the snapshot's write leaves the row already written", async () =>
	{
		const deps = memoryDeps();
		deps.projections.upsert = async () =>
		{
			throw new Error("the Worker stopped");
		};
		await expect(ingestGame(deps, {
			...await feedGame(LIVE, 3),
			fetchedAt: IN.toISOString(),
			windowMode: "active",
		}, "2026-09-05T23:29:00.000Z")).rejects.toThrow("stopped");
		expect(await deps.games.getByPk(PK)).not.toBeNull();
		expect(homeRuns((await deps.gameStates.getByPk(PK))?.state)).toBe(3);
	});

	it("S150 AC 5 batch: a schedule refresh reads its games' rows once and writes them in one write", async () =>
	{
		const deps = memoryDeps();
		const calls: string[] = [];
		const states = deps.gameStates;
		for (const method of ["getByPk", "getMany", "write"] as const)
		{
			const original = (states[method] as (...args: never[]) => Promise<unknown>).bind(states);
			(states as unknown as Record<string, unknown>)[method] = async (...args: never[]) =>
			{
				calls.push(method);
				return original(...args);
			};
		}
		await storeSchedule(deps, fetchedDay([await summary(SCHEDULED, 0), await summary(SCHEDULED, 0, 2), await summary(SCHEDULED, 0, 3)], BEFORE));
		// The switch's own reads and writes, before the day read joins the rows.
		const switchCalls = calls.slice(0, calls.indexOf("write") + 1);
		expect(switchCalls).toEqual(["getMany", "write"]);
		expect(calls.filter((call) => call === "write")).toHaveLength(1);
		expect((await deps.gameStates.getMany([PK, 2, 3])).map((row) => row.gamePk).sort((a, b) => a - b)).toEqual([2, 3, PK]);
	});

	it("S150 AC 5 batch: a batch naming a game twice writes it once, the last write winning, and writes its rows in gamePk order", async () =>
	{
		const deps = memoryDeps();
		const written: number[][] = [];
		const original = deps.gameStates.write.bind(deps.gameStates);
		deps.gameStates.write = async (rows) =>
		{
			written.push(rows.map((row) => row.gamePk));
			return original(rows);
		};
		const outcomes = await switchGameState(deps, [
			write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))),
			{
				...write("schedule", gameStateFromSummary(await summary(SCHEDULED, 0))),
				gamePk: 2,
			},
			write("schedule", gameStateFromSummary(await summary(POSTPONED, 0))),
		], BEFORE);
		expect(written).toEqual([[2, PK]]);
		expect(outcomes.get(PK)?.row?.state.status.codedGameState).toBe("D");
		expect([...outcomes.keys()].sort((a, b) => a - b)).toEqual([2, PK]);
	});

	it("S150 AC 4 moved start: the same state with a moved first pitch is a new version, and the feed takes the row in the moved window", async () =>
	{
		const deps = memoryDeps();
		const at = (start: string) => summary(SCHEDULED, 0).then((row) => ({
			...row,
			startTime: start,
		}));
		await storeSchedule(deps, fetchedDay([await at(START)], BEFORE));
		const first = (await deps.gameStates.getByPk(PK))!;
		// The game is moved to a 1:05pm ET start the same day.
		const moved = "2026-09-05T17:05:00.000Z";
		await storeSchedule(deps, fetchedDay([await at(moved)], new Date("2026-09-05T12:30:00Z")));
		const row = (await deps.gameStates.getByPk(PK))!;
		expect(row.state.version).toBe(first.state.version + 1);
		expect(row.startTime).toBe(moved);
		const at1730 = new Date("2026-09-05T17:30:00Z");
		await ingestGame(deps, {
			...await feedGame(LIVE, 1),
			startTime: moved,
			fetchedAt: at1730.toISOString(),
			windowMode: "active",
		}, at1730.toISOString());
		expect(await deps.gameStates.getByPk(PK)).toMatchObject({
			source: "feed",
			state: {
				status: LIVE,
			},
		});
	});

	it("S150 AC 4 stale snapshot: a feed poll older than the row's accepted time writes no snapshot either", async () =>
	{
		const deps = memoryDeps();
		const poll = async (home: number, at: Date, feedTime?: string) => ingestGame(deps, {
			...await feedGame(LIVE, home),
			fetchedAt: at.toISOString(),
			windowMode: "active",
		}, feedTime);
		await poll(3, IN, "2026-09-05T23:29:30.000Z");
		const stored = (await deps.games.getByPk(PK))!;
		// A cached copy a run behind, from before the accepted feed time.
		const stale = await poll(2, new Date(IN.getTime() + 15_000), "2026-09-05T23:29:00.000Z");
		expect(stale.changed).toBe(false);
		expect(stale.snapshot.version).toBe(stored.version);
		expect(homeRuns(await deps.games.getByPk(PK))).toBe(3);
		// A poll with no feed time is never skipped for its time.
		const untimed = await poll(4, new Date(IN.getTime() + 30_000));
		expect(untimed.changed).toBe(true);
		expect(homeRuns(await deps.games.getByPk(PK))).toBe(4);
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

	it("S150 AC 6 makeup: a game postponed on one day and made up on another, refreshed in either order: the makeup day has its state, the original day shows Postponed, and the original day's refresh never changes the row", async () =>
	{
		const MAKEUP = "2026-09-06";
		const listing = async (date: string, status: ScheduleGameSummary["status"], home: number) => ({
			...await summary(status, home),
			gameDate: date,
			officialDate: date,
			startTime: date === DATE ? START : "2026-09-06T17:05:00.000Z",
		});
		const original = async (at: Date) => storeSchedule(deps, fetchedDay([{
			...await listing(DATE, POSTPONED, 0),
			linescore: null,
		}], at));
		const makeup = async (status: ScheduleGameSummary["status"], home: number, at: Date) => storeSchedule(deps, fetchedDay([await listing(MAKEUP, status, home)], at, MAKEUP));
		const morning = new Date("2026-09-05T12:00:00Z");
		const later = new Date("2026-09-08T12:00:00Z");
		let deps = memoryDeps();
		for (const order of ["original first", "makeup first"])
		{
			deps = memoryDeps();
			if (order === "original first")
			{
				await original(morning);
				await makeup(SCHEDULED, 0, new Date(morning.getTime() + 60_000));
			}
			else
			{
				await makeup(SCHEDULED, 0, morning);
				await original(new Date(morning.getTime() + 60_000));
			}
			expect((await deps.gameStates.getByPk(PK))?.officialDate, order).toBe(MAKEUP);
			await makeup(FINAL, 6, later);
			const row = (await deps.gameStates.getByPk(PK))!;
			// The original day's refresh, after the makeup, leaves the row alone.
			await original(new Date(later.getTime() + 60_000));
			expect(await deps.gameStates.getByPk(PK), order).toEqual(row);
			const madeUp = (await readScheduleDay(deps, MAKEUP, later))!;
			expect([madeUp.games[0]?.status.codedGameState, homeRuns(madeUp.games[0])], order).toEqual(["F", 6]);
			const postponed = (await readScheduleDay(deps, DATE, later))!;
			expect([postponed.games[0]?.status.codedGameState, homeRuns(postponed.games[0])], order).toEqual(["D", null]);
		}
	});

	/** The fixture game listed on `date` at `status` (first pitch 23:05Z that day unless given), as that day's schedule fetch returns it. */
	async function listedOn(date: string, status: ScheduleGameSummary["status"], home: number | null = 0, startTime = `${date}T23:05:00.000Z`): Promise<ScheduleGameSummary>
	{
		const row = await summary(status, home ?? 0);
		return {
			...row,
			gameDate: date,
			officialDate: date,
			startTime,
			linescore: home === null ? null : row.linescore,
		};
	}

	/** Stores `date`'s schedule listing the fixture game at `status`, fetched at `at`. */
	async function listOn(deps: ReturnType<typeof memoryDeps>, date: string, status: ScheduleGameSummary["status"], at: Date, home: number | null = 0, startTime?: string)
	{
		return storeSchedule(deps, fetchedDay([await listedOn(date, status, home, startTime)], at, date));
	}

	const SUSPENDED = {
		abstractGameState: "Live",
		codedGameState: "U",
		detailedState: "Suspended",
	};

	it("S150 AC 4 moved earlier: a game MLB moves to an earlier day takes that day's listing, and its feed then writes it", async () =>
	{
		const deps = memoryDeps();
		await listOn(deps, "2026-09-06", SCHEDULED, new Date("2026-09-05T10:00:00Z"));
		// MLB moves it a day earlier, to 2026-09-05 at 23:05Z.
		await listOn(deps, DATE, SCHEDULED, new Date("2026-09-05T12:00:00Z"));
		expect((await deps.gameStates.getByPk(PK))?.officialDate).toBe(DATE);
		await ingestGame(deps, {
			...await feedGame(LIVE, 2),
			startTime: START,
			fetchedAt: IN.toISOString(),
			windowMode: "active",
		}, IN.toISOString());
		expect(await deps.gameStates.getByPk(PK)).toMatchObject({
			source: "feed",
			state: {
				status: LIVE,
			},
		});
	});

	it("S150 AC 4 moved later: a game MLB moves to a later day with no postponement takes that day's listing", async () =>
	{
		const deps = memoryDeps();
		await listOn(deps, DATE, SCHEDULED, new Date("2026-09-05T10:00:00Z"));
		await listOn(deps, "2026-09-06", SCHEDULED, new Date("2026-09-05T12:00:00Z"));
		expect(await deps.gameStates.getByPk(PK)).toMatchObject({
			officialDate: "2026-09-06",
			startTime: "2026-09-06T23:05:00.000Z",
		});
	});

	it("S150 AC 4 postponed again: a makeup postponed in its turn keeps the row, and the first day's listing never flips it back", async () =>
	{
		const deps = memoryDeps();
		const morning = new Date("2026-09-05T10:00:00Z");
		await listOn(deps, DATE, POSTPONED, morning, null);
		await listOn(deps, "2026-09-06", SCHEDULED, new Date(morning.getTime() + 60_000));
		await listOn(deps, "2026-09-06", POSTPONED, new Date("2026-09-06T12:00:00Z"), null);
		const row = (await deps.gameStates.getByPk(PK))!;
		expect([row.officialDate, row.state.status.codedGameState]).toEqual(["2026-09-06", "D"]);
		for (const at of ["2026-09-06T12:01:00Z", "2026-09-06T12:02:00Z"])
		{
			await listOn(deps, DATE, POSTPONED, new Date(at), null);
			expect(await deps.gameStates.getByPk(PK)).toEqual(row);
		}
		expect((await readScheduleDay(deps, DATE, new Date("2026-09-06T12:03:00Z")))?.games[0]?.status.codedGameState).toBe("D");
		expect((await readScheduleDay(deps, "2026-09-06", new Date("2026-09-06T12:03:00Z")))?.games[0]?.status.codedGameState).toBe("D");
	});

	it("S150 AC 4 suspended with its own resumption date: the resumption's listing takes the row, and the original day's never flips it back", async () =>
	{
		const deps = memoryDeps();
		const later = new Date("2026-09-08T12:00:00Z");
		await listOn(deps, DATE, SUSPENDED, later, 3);
		await listOn(deps, "2026-09-07", SUSPENDED, new Date(later.getTime() + 60_000), 3);
		const row = (await deps.gameStates.getByPk(PK))!;
		expect(row.officialDate).toBe("2026-09-07");
		for (const minute of [2, 3])
		{
			await listOn(deps, DATE, SUSPENDED, new Date(later.getTime() + minute * 60_000), 3);
			expect(await deps.gameStates.getByPk(PK)).toEqual(row);
		}
	});

	it("S150 AC 6 suspended original day: once the game has moved to another day, the cron counts the original day settled and stops asking MLB for it", async () =>
	{
		const deps = memoryDeps();
		// Suspended late on 2026-09-05, resumed at 1:05pm ET on 2026-09-06 under its own date, and final by 5pm ET (the
		// original day's six suspended hours long past, so the schedule owns the row).
		const resumed = "2026-09-06T17:05:00.000Z";
		await listOn(deps, DATE, SUSPENDED, new Date("2026-09-06T05:00:00Z"), 3);
		await listOn(deps, "2026-09-06", FINAL, new Date("2026-09-06T21:00:00Z"), 5, resumed);
		const now = new Date("2026-09-06T21:30:00Z");
		// The original day stored out of its window, as the fetch that finds it out of window stores it.
		await listOn(deps, DATE, SUSPENDED, now, 3);
		await deps.schedules.upsert({
			...(await deps.schedules.getByDate(DATE))!,
			windowMode: "cache",
			version: (await deps.schedules.getByDate(DATE))!.version + 1,
		});
		const held = (await readJoinedScheduleDay(deps, DATE, now))!;
		expect(held.served.games[0]).toMatchObject({
			status: SUSPENDED,
			linescore: null,
		});
		expect([...held.moved]).toEqual([PK]);
		const asked: string[] = [];
		deps.mlb.fetchSchedule = async (date: string) =>
		{
			asked.push(date);
			return fetchedDay([await listedOn("2026-09-06", FINAL, 5, resumed)], now, date);
		};
		await refreshTodaysWindow(deps, now);
		expect(asked).toEqual(["2026-09-06"]);
	});

	it("S150 AC 6 window: a day stored active whose joined games are all final past their trails is served cache, and once past and finished is served without asking MLB (S212)", async () =>
	{
		const deps = memoryDeps();
		await storeSchedule(deps, fetchedDay([await summary(LIVE, 2)], IN));
		expect((await deps.schedules.getByDate(DATE))?.windowMode).toBe("active");
		// The feed's final lands in the row; the stored day (its schedule data) is untouched.
		await one(deps, write("feed", gameStateFromGame(await feedGame(FINAL, 4)), "2026-09-06T02:40:00.000Z"), new Date("2026-09-06T02:41:00Z"));
		expect((await readScheduleDay(deps, DATE, AFTER))?.windowMode).toBe("cache");
		const fetchSchedule = vi.fn(async () => fetchedDay([await summary(FINAL, 4)], AFTER));
		deps.mlb.fetchSchedule = fetchSchedule;
		deps.now = () => AFTER;
		deps.refresh = new RefreshCoordinator(() => AFTER);
		const day = await getOrRefreshSchedule(deps, DATE);
		// S212: the joined day is past and finished, so the cron's writes own its freshness, not the read.
		expect(fetchSchedule).toHaveBeenCalledTimes(0);
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

	it("S150 AC 6 order: a first send between a poll's two writes never holds a version the poll's publish then repeats with another score", async () =>
	{
		const deps = memoryDeps();
		const hub = new LiveHubState(() => readServedGame(deps, PK));
		const poll = (home: number, at: Date) => ingestGame(deps, {
			...feedGameSync(home),
			fetchedAt: at.toISOString(),
			windowMode: "active",
		}, at.toISOString());
		const base = await feedGame(LIVE, 2);
		const feedGameSync = (home: number): Unversioned<GameSnapshot> => ({
			...base,
			linescore: linescore(home),
		});
		await poll(2, IN);
		// Whichever of the row and the snapshot is written first, a viewer connects right after it.
		let firstSend: GameSnapshot | null = null;
		let writes = 0;
		const between = async () =>
		{
			if (++writes === 1) firstSend = await hub.onConnect();
		};
		const upsert = deps.games.upsert.bind(deps.games);
		deps.games.upsert = async (game) =>
		{
			await upsert(game);
			await between();
		};
		const write = deps.gameStates.write.bind(deps.gameStates);
		(deps.gameStates as { write: (...args: never[]) => Promise<unknown> }).write = async (...args: never[]) =>
		{
			const taken = await (write as (...a: never[]) => Promise<unknown>)(...args);
			await between();
			return taken;
		};
		const { snapshot, state } = await poll(3, new Date(IN.getTime() + 15_000));
		expect(firstSend).not.toBeNull();
		const published = servedGame(snapshot, state);
		expect(homeRuns(published)).toBe(3);
		// The publish is newer than what the viewer got, so the hub (and the client, ADR-022) takes it.
		expect(await hub.accept(published)).toBe(true);
	});

	it("S150 AC 6 wiring: when the row and the snapshot differ, the game read (fresh and refreshed), the hub's first send and the ingest's publish all serve the row's score", async () =>
	{
		const mlb = new FixtureMlbStatsClient();
		mlb.fetchGame = async (): Promise<FetchedGame> => ({
			game: await feedGame(FINAL, 5),
			feedTime: "2026-09-06T02:40:00.000Z",
		});
		const deps = memoryDeps(mlb);
		// The feed's final (home 5) lands in its window; after the window a schedule correction (home 6) lands in the row.
		const ended = new Date("2026-09-06T02:41:00Z");
		deps.now = () => ended;
		await ingestGame(deps, {
			...await feedGame(FINAL, 5),
			fetchedAt: ended.toISOString(),
			windowMode: "active",
		}, "2026-09-06T02:40:00.000Z");
		await storeSchedule(deps, fetchedDay([await summary(FINAL, 6)], AFTER));
		expect(homeRuns(await deps.games.getByPk(PK))).toBe(5);
		deps.now = () => AFTER;
		// The fresh branch: the stored snapshot is `active`, so it isn't refreshed.
		expect(homeRuns(await getOrRefreshGame(deps, PK))).toBe(6);
		// The refreshed branch: MLB's feed still says 5, and after the window the switch keeps the schedule's row.
		expect(homeRuns(await getOrRefreshGame(deps, PK, {
			force: true,
		}))).toBe(6);
		// The hub's first send.
		expect(homeRuns(await new LiveHubState(() => readServedGame(deps, PK)).onConnect())).toBe(6);
		// The ingest object's publish after the window.
		const pushed: GameSnapshot[] = [];
		const ingest = new GameIngest(new FakeDurableStorage(), deps, async (_hub, snapshot) =>
		{
			pushed.push(snapshot);
		});
		await ingest.hubs.register("hub-a", AFTER);
		await ingest.ensureRunning(PK, AFTER);
		await ingest.alarm(AFTER);
		expect(pushed.length).toBeGreaterThan(0);
		expect(homeRuns(pushed.at(-1))).toBe(6);
	});
});
