/**
 * One game's ingest (S48; ADR-020 layer 1, ADR-002 cadence): what the
 * `game-ingest:<gamePk>` Durable Object does, as a plain module so it is tested in Node
 * (where the coverage floors live) and the object stays a thin shell over it.
 *
 * The cron makes sure one object runs per in-window game (`ensureRunning`, idempotent:
 * one alarm however often it is called). Each alarm polls MLB through `MlbStatsClient`,
 * writes the game through the same versioned store every ingest path uses (an unchanged
 * payload writes nothing, ADR-022), and **only then** publishes to the hubs leased in
 * its storage, so a viewer is never told about a change the store doesn't hold. When the
 * game leaves its window, the last poll publishes the final state and no alarm is set.
 *
 * S103: after a poll has written and published (and armed the next alarm), the object pulls Baseball Savant on its own
 * cadence (`savantPullDue`: at most once per `savantIntervalMs` while the game is live, then once more on the run's last
 * poll after the final), merges what arrived into the stored game and publishes that version too. Savant is never asked
 * inside the poll's fetch, so a slow or failing Savant never delays a pitch.
 */
import type { CadenceParams, GameSnapshot } from "@bt/domain";
import {
	DEFAULT_CADENCE, isFinalStatus, isGameInActiveWindow, isSuspendedStatus, playerOfTheGameComplete, savantPullDue, suspendedSince, wholeFetchedGame,
} from "@bt/domain";
import type { DurableStore } from "./hub-leases.js";
import { HubLeases } from "./hub-leases.js";
import type { IngestDeps } from "./ingest.js";
import { servedGame } from "./game-state.js";
import { ingestGame, refreshTodaysWindow } from "./ingest.js";
import { withAskedPlayerOfTheGame } from "./player-of-the-game.js";
import { pullSavant, SAVANT_LIMIT_MS } from "./savant-ingest.js";

/** Durable Object storage with its alarm (`state.storage`). */
export interface AlarmStore extends DurableStore
{
	getAlarm(): Promise<number | null>;
	setAlarm(scheduledTime: number): Promise<void>;
	deleteAlarm(): Promise<void>;
}

/** Sends a stored snapshot to one hub (S18 builds the real hub); rejects when the hub can't take it. */
export type HubPublisher = (hubId: string, snapshot: GameSnapshot) => Promise<void>;

/** The object's name: one per game, so every cron run reaches the same instance. */
export function gameIngestName(gamePk: number): string
{
	return `game-ingest:${gamePk}`;
}

const GAME_KEY = "gamePk";
/** When this object was last armed or polled (epoch ms). */
const ACTIVE_KEY = "activeAt";
/**
 * Set once this run's stored game holds both player-of-the-game picks (S99 review), so later polls ask mlb.com no more:
 * kept in the object's own storage, so deciding costs no database read. A pick MLB changes after both sides are stored
 * stays as first stored (accepted). Cleared with the game's other keys when the run ends.
 */
const POTG_COMPLETE_KEY = "potgComplete";
/**
 * Set once this run has polled the game as final (S101 review), whatever that poll's asks of the extras kept whole (the
 * uniforms, and S100's rule settings) answered: later polls of the final trail write without asking (`ingestGame`
 * without `mlb`), so a final game MLB lists neither for is asked once per run, not on every poll of its trail; the
 * week-long re-check (`recheckDueGame`) covers later tries. Live polls before then ask only on a status change
 * (`askedExtraDue`). Cleared with the game's other keys when the run ends. Its stored name predates S100, kept so an
 * object mid-run across the deploy still finds (and clears) it.
 */
const EXTRAS_ASKED_KEY = "uniformsAsked";
/** When this run last pulled Baseball Savant (epoch ms, S103), for `savantPullDue`'s interval. Cleared when the run ends. */
const SAVANT_AT_KEY = "savantAt";
/** Set once this run has made its one Savant pull after the final (S103). Cleared when the run ends. */
const SAVANT_FINAL_KEY = "savantFinal";

export class GameIngest
{
	readonly hubs: HubLeases;

	constructor(
		private readonly storage: AlarmStore,
		private readonly deps: IngestDeps,
		private readonly publish: HubPublisher,
		private readonly params: CadenceParams = DEFAULT_CADENCE,
		/** How long one Savant pull may take (S103); tests shorten it. */
		private readonly savantLimitMs: number = SAVANT_LIMIT_MS,
	)
	{
		this.hubs = new HubLeases(storage);
	}

	/**
	 * Makes sure this object polls `gamePk`: arms an alarm for `now` unless it is already
	 * running — an alarm is set, or it was armed or polled within the last two intervals.
	 * The second test matters because the runtime reports no alarm from the moment one is
	 * due until its handler re-arms. True when it armed one. Safe on every cron run: a
	 * Durable Object has one alarm, so arming again can never start a second poll chain,
	 * and an object whose alarms stopped is restarted.
	 */
	async ensureRunning(gamePk: number, now: Date): Promise<boolean>
	{
		await this.storage.put(GAME_KEY, gamePk);
		const activeAt = await this.storage.get<number>(ACTIVE_KEY);
		const recent = activeAt !== undefined && now.getTime() - activeAt < 2 * this.params.intervalMs;
		if (recent || await this.storage.getAlarm() !== null) return false;
		await this.storage.put(ACTIVE_KEY, now.getTime());
		await this.storage.setAlarm(now.getTime());
		return true;
	}

	/**
	 * One poll. A failed MLB call keeps the cadence (the next alarm retries); otherwise the
	 * game is written, then published if it changed, or as the final state once it is out
	 * of its window, when the alarm stops. A suspended game's window counts from when BT saw it
	 * turn suspended (#323): `suspendedSince` against the stored game, the same answer the store
	 * then records, read only while the game is suspended.
	 */
	async alarm(now: Date): Promise<void>
	{
		const gamePk = await this.storage.get<number>(GAME_KEY);
		if (gamePk === undefined) return;
		await this.storage.put(ACTIVE_KEY, now.getTime());
		let fetched;
		try
		{
			// The whole game, its playMetrics waited for (S216 AC 5): a poll never stores a game without them for being slow.
			fetched = await wholeFetchedGame(await this.deps.mlb.fetchGame(gamePk));
			// S99: a due game's pick, asked between the fetch and the write (bounded by PLAY_METRICS_LIMIT_MS), so a poll
			// stays one versioned write and one publish; never once both sides are stored. The key needs both, so a game MLB
			// never gives a fan pick is asked again, one bounded request, on every final-trail poll until its run ends (the
			// cold read likewise asks again on each refresh of a game whose stored pick has only one side).
			if (!await this.storage.get<boolean>(POTG_COMPLETE_KEY)) fetched = await withAskedPlayerOfTheGame(this.deps.mlb, fetched, undefined);
		}
		catch
		{
			await this.storage.setAlarm(now.getTime() + this.params.intervalMs);
			return;
		}
		const { game, feedTime } = fetched;
		const suspendedAt = isSuspendedStatus(game.status.codedGameState)
			? suspendedSince(await this.deps.games.getByPk(gamePk), game.status.codedGameState, now.toISOString())
			: undefined;
		const inWindow = isGameInActiveWindow({
			...game,
			suspendedAt,
		}, now, this.params);
		// S101 review: once this run has polled the game as final, its writes ask no extras (`EXTRAS_ASKED_KEY`).
		const { mlb: _noExtrasAsk, ...withoutAsk } = this.deps;
		const {
			snapshot, state, changed, stateChanged,
		} = await ingestGame(await this.storage.get<boolean>(EXTRAS_ASKED_KEY) ? withoutAsk : this.deps, {
			...game,
			fetchedAt: now.toISOString(),
			windowMode: inWindow ? "active" : "cache",
		}, feedTime);
		if (playerOfTheGameComplete(snapshot.playerOfTheGame)) await this.storage.put(POTG_COMPLETE_KEY, true);
		if (isFinalStatus(game.status.codedGameState)) await this.storage.put(EXTRAS_ASKED_KEY, true);
		// S150 AC 6: the served game (status and linescore from its one stored state), as the HTTP read and the hub's first send serve it.
		// S149 AC 2: a mend (the row changed under an unchanged snapshot) is published too, so a day hub pushes its day.
		if (changed || stateChanged || !inWindow) await this.publishToHubs(servedGame(snapshot, state, now), now);
		// S103: decided now, pulled only after the next alarm is armed, so a slow Savant never holds up the next poll.
		const savantDue = savantPullDue({
			codedGameState: game.status.codedGameState,
			inWindow,
			lastPulledAt: await this.storage.get<number>(SAVANT_AT_KEY),
			finalPulled: await this.storage.get<boolean>(SAVANT_FINAL_KEY) === true,
			now: now.getTime(),
			intervalMs: this.params.savantIntervalMs,
		});
		if (inWindow)
		{
			await this.storage.setAlarm(now.getTime() + this.params.intervalMs);
			if (savantDue) await this.pullSavant(gamePk, isFinalStatus(game.status.codedGameState), now);
			return;
		}
		if (savantDue) await this.pullSavant(gamePk, isFinalStatus(game.status.codedGameState), now);
		await this.storage.deleteAlarm();
		await this.storage.delete(GAME_KEY);
		await this.storage.delete(ACTIVE_KEY);
		await this.storage.delete(POTG_COMPLETE_KEY);
		await this.storage.delete(EXTRAS_ASKED_KEY);
		await this.storage.delete(SAVANT_AT_KEY);
		await this.storage.delete(SAVANT_FINAL_KEY);
	}

	/**
	 * One Savant pull (S103): noted first (so a pull that hangs still counts toward the interval), then merged into the
	 * stored game and, when that changed it, published as its next version.
	 */
	private async pullSavant(gamePk: number, final: boolean, now: Date): Promise<void>
	{
		await this.storage.put(SAVANT_AT_KEY, now.getTime());
		if (final) await this.storage.put(SAVANT_FINAL_KEY, true);
		const written = await pullSavant(this.deps, gamePk, now, this.savantLimitMs);
		if (written) await this.publishToHubs(servedGame(written.snapshot, written.row, now), now);
	}

	private async publishToHubs(snapshot: GameSnapshot, now: Date): Promise<void>
	{
		for (const hubId of await this.hubs.live(now))
		{
			let ok = true;
			try
			{
				await this.publish(hubId, snapshot);
			}
			catch
			{
				ok = false;
			}
			await this.hubs.recordPublish(hubId, ok);
		}
	}
}

/**
 * The cron's part (ADR-020): reads today's schedule (stored, as the tick always did) and
 * ensures an ingest object for each game in its window, and none for the rest. Returns
 * the games it ensured.
 */
export async function ensureIngestRunning(
	deps: IngestDeps,
	ensure: (gamePk: number) => Promise<unknown>,
	now: Date = deps.now?.() ?? new Date(),
	params: CadenceParams = DEFAULT_CADENCE,
): Promise<number[]>
{
	const { active } = await refreshTodaysWindow(deps, now, params);
	const ensured: number[] = [];
	for (const game of active)
	{
		try
		{
			await ensure(game.gamePk);
			ensured.push(game.gamePk);
		}
		catch
		{
			// One object that won't start must not keep the others from starting.
		}
	}
	return ensured;
}
