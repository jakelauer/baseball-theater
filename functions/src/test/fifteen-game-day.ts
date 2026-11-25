/**
 * A fake MLB answering a 15-game past day (S216): 2021-06-15, every game final, built from the committed 2024-07-04
 * fixture day and game 744834 under fifteen gamePks, so the round-trip tests count a full day's reads and writes
 * without a recording of that day. Everything else it is asked rejects, so a test notices a request it didn't expect.
 */
import type {
	FetchedGame, ScheduleDay, Unversioned,
} from "@bt/domain";
import type { MlbStatsClient } from "@bt/ports";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";

/** The day the latency probe measured (`.run/reports/latency-1124.md`): 15 games, all past and final. */
export const FIFTEEN_GAME_DATE = "2021-06-15";

/** The day's fifteen gamePks. */
export const FIFTEEN_GAME_PKS = Array.from({
	length: 15,
}, (_, i) => 900_001 + i);

const FINAL = {
	abstractGameState: "Final",
	codedGameState: "F",
	detailedState: "Final",
};

/** The day as MLB's schedule answers it: the fixture day's first game, once per gamePk, every game final. */
export async function fifteenGameDay(): Promise<Unversioned<ScheduleDay>>
{
	const fixture = await new FixtureMlbStatsClient().fetchSchedule("2024-07-04");
	const template = fixture.games[0]!;
	return {
		...fixture,
		date: FIFTEEN_GAME_DATE,
		windowMode: "cache",
		games: FIFTEEN_GAME_PKS.map((gamePk) => ({
			...template,
			gamePk,
			officialDate: FIFTEEN_GAME_DATE,
			status: FINAL,
		})),
	};
}

/** One of the day's games as MLB's feed answers it: fixture game 744834 under `gamePk`, final, on the day. */
export async function fifteenGameDayGame(gamePk: number): Promise<FetchedGame>
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(744834);
	return {
		game: {
			...game,
			gamePk,
			officialDate: FIFTEEN_GAME_DATE,
			status: FINAL,
		},
	};
}

/** The fake MLB: the day's schedule and its games; any other request rejects. */
export function fifteenGameMlb(): MlbStatsClient
{
	const base: Partial<MlbStatsClient> = {
		fetchSchedule: async (date) =>
		{
			if (date !== FIFTEEN_GAME_DATE) throw new Error(`no schedule for ${date}`);
			return fifteenGameDay();
		},
		fetchGame: async (gamePk) =>
		{
			if (!FIFTEEN_GAME_PKS.includes(gamePk)) throw new Error(`no game ${gamePk}`);
			return fifteenGameDayGame(gamePk);
		},
	};
	return new Proxy(base as MlbStatsClient, {
		get(target, key, receiver)
		{
			return Reflect.get(target, key, receiver) ?? (async () =>
			{
				throw new Error(`fifteenGameMlb: ${String(key)} not faked`);
			});
		},
	});
}
