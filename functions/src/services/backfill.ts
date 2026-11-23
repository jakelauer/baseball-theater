/**
 * The game backfill (S122; owner, 2026-11-07: "I want idempotent functionality that hydrates
 * every game between two dates"): walks the days from `to` back to `from`, newest first, and
 * stores each day the way ingest does — its schedule day (`storeSchedule`) and each final game
 * through `ingestGame`'s version-guarded write (ADR-022) — so the data it leaves is the same
 * Postgres rows the app reads locally and that a production run would write to Neon.
 *
 * It is resumable without a progress file: a day is **complete** when its stored schedule day
 * is settled (`isScheduleDaySettled`: every game settled, and an empty day only once MLB's
 * today is past it) and every final game is stored, final, with a current projection. A complete day asks MLB nothing and writes nothing, so a second run, or
 * a run after a stop, goes straight to the first incomplete day. A settled day stored before S167,
 * with a game lacking its `gameType` (`scheduleDayLacksGameType`), is fetched and re-stored once
 * in a run, so its month answer can say whether it was regular season; it then counts as complete
 * in that run whatever MLB sent, or when its request fails (its stored games carry on through the
 * finals and repair steps), so it never holds the run's other work back. A game whose projection fell
 * behind its snapshot (a stop between `storeGame`'s two writes) is repaired from the stored
 * snapshot. The only state outside the database is each extra source's counted stretches
 * ({@link ResumeStore}, AC 8).
 *
 * The game's three extra sources — content (videos and recap), play metrics and the GraphQL
 * game content — exist only for recent games, so each is asked on its own and given up after
 * {@link GIVE_UP_AFTER_DAYS} consecutive failed days of games (`recordSourceDay`). The live
 * feed is never given up: a game whose feed fails leaves its day incomplete for the next run, and
 * its reason is logged (#359).
 *
 * A day's games are all fetched first, its source answers counted and saved, and only then
 * are its games written. A stop after the save re-fetches the day's games on resume but can't
 * count the day twice (`recordSourceDay` skips a day it has counted); a stop before it leaves
 * the games unwritten, so the resume fetches and counts them, where writing first would leave
 * stored games the resume skips, with their answers never counted. A day is counted once,
 * from the games fetched that run: if only some of its feeds succeed, the day is counted from
 * those, and the rest, fetched by a later run, don't count toward the streak. A run that
 * continues or touches an earlier run's counted days joins their streak; a run over dates that
 * don't (a newer range, or an older one) counts a streak of its own, so it can give a source up
 * again without continuing an unrelated streak.
 */
import type {
	GameGraphContent, GamePlayMetrics, GameSnapshot, ScheduleDay, SourceStreak, Unversioned,
} from "@bt/domain";
import {
	backfillDays, GIVE_UP_AFTER_DAYS, isFinalStatus, isScheduleDaySettled, isSourceGivenUp, mlbToday, normalizeStatusCode, recordSourceDay, scheduleDayLacksGameType,
	sourceGivenUpAt,
} from "@bt/domain";
import type {
	GameEditorial, GameProjectionRepository, GameRepository, GameStateRepository, MlbGameSources, ScheduleRepository,
} from "@bt/ports";
import { assembleGame } from "../mappers/game-extras.js";
import { readScheduleDay } from "./game-state.js";
import {
	ingestGame, repairProjection, scheduleDayWindowMode, storeSchedule,
} from "./ingest.js";

/** The extra sources a game is hydrated from beside its live feed, each given up on its own. */
export const EXTRA_SOURCES = ["content", "playMetrics", "graphContent"] as const;
/** One of {@link EXTRA_SOURCES}: the key each source's counted stretches are kept under in {@link BackfillState}. */
export type ExtraSource = (typeof EXTRA_SOURCES)[number];

/** What a resumed run needs that the database doesn't hold: each extra source's counted stretches. */
export type BackfillState = {
	sources: Partial<Record<ExtraSource, SourceStreak>>;
};

/** Where {@link BackfillState} is kept between runs (a file per database, `backfill-state.ts`). */
export interface ResumeStore
{
	load(): Promise<BackfillState>;
	save(state: BackfillState): Promise<void>;
}

/**
 * What the walk reads and writes: MLB's game sources (the paced HTTP client in the command, a
 * fake in tests), the same repositories ingest writes, and the resume store. Everything else
 * is optional and only steers or reports the walk.
 */
export type BackfillDeps = {
	mlb: MlbGameSources;
	schedules: ScheduleRepository;
	games: GameRepository;
	projections: GameProjectionRepository;
	/** Each game's one stored state (S150): written through ingest's switch, read into the joined day. */
	gameStates: GameStateRepository;
	state: ResumeStore;
	now?: () => Date;
	/** Called with each day before its first request, so the pacer can pick that day's gap. */
	pace?: (day: string) => void;
	/** Progress lines (AC 9). */
	log?: (line: string) => void;
	/** Stops the walk before the next day; the day in progress finishes first. */
	signal?: AbortSignal;
};

/** What a run did, for the command's summary and the tests: counts, days left, sources given up. */
export type BackfillResult = {
	/** Days visited (off-season days are never visited). */
	days: number;
	/** Days that were already complete and asked MLB nothing. */
	alreadyComplete: number;
	/** Games written this run. */
	gamesStored: number;
	/** Projections repaired from their stored snapshot. */
	repaired: number;
	/** Days left incomplete, for the next run: unsettled games, or a schedule or feed MLB didn't serve. */
	incomplete: string[];
	/** Each given-up source and the newest day it was given up at (it is skipped on that day and every older one). */
	givenUp: Partial<Record<ExtraSource, string>>;
	/** Whether the walk stopped early (`signal`). */
	stopped: boolean;
};

function isFinalSummary(summary: ScheduleDay["games"][number]): boolean
{
	return isFinalStatus(normalizeStatusCode(summary.status.codedGameState));
}

/** One extra source's answer: the value, or null when it failed or had nothing. */
async function ask<T>(asked: boolean, call: () => Promise<T | null>): Promise<T | null>
{
	if (!asked) return null;
	try
	{
		return await call();
	}
	catch
	{
		return null;
	}
}

/**
 * Why a game's feed or a schedule day failed, in one short line for the progress log (#359): a parser's error
 * (zod's `issues`) names each distinct field path it rejected, indices collapsed, so a feed with
 * a hundred bad hits reads as one path; any other error is its message.
 */
function failureReason(error: unknown): string
{
	const issues = (error as { issues?: { path: (string | number)[];
		message: string; }[]; } | null)?.issues;
	if (!Array.isArray(issues)) return error instanceof Error ? error.message : String(error);
	const distinct = [...new Set(issues.map((issue) => `${issue.path.map((part) => typeof part === "number" ? "*" : part).join(".")}: ${issue.message}`))];
	return distinct.join("; ");
}

/**
 * What one game's fetch came to, for the day's tally. A fetched game is not yet written: the
 * day's answers are saved first (see the module comment), then {@link ingestGame} writes it.
 */
type GameOutcome =
	| { kind: "unchanged" | "repaired" }
	| { kind: "feedFailed";
		reason: string; }
	| { kind: "fetched";
		game: Unversioned<GameSnapshot>;
		/** The feed's own time (S150 AC 2), handed to the game-state switch beside the game. */
		feedTime?: string;
		answered: Partial<Record<ExtraSource, boolean>>; };

/**
 * Fetches one final game: from the store when it is already there and final (repairing its
 * projection if it fell behind), else from MLB, asking each extra source not given up for `day`.
 */
async function fetchGame(deps: BackfillDeps, gamePk: number, asking: Record<ExtraSource, boolean>, fetchedAt: string, windowMode: ScheduleDay["windowMode"]): Promise<GameOutcome>
{
	const stored = await deps.games.getByPk(gamePk);
	if (stored && isFinalStatus(normalizeStatusCode(stored.status.codedGameState)))
	{
		return {
			kind: await repairProjection(deps, stored) ? "repaired" : "unchanged",
		};
	}
	let feed;
	try
	{
		feed = await deps.mlb.fetchGameFeed(gamePk);
	}
	catch (error)
	{
		return {
			kind: "feedFailed",
			reason: failureReason(error),
		};
	}
	const [editorial, playMetrics, graph] = await Promise.all([
		ask<GameEditorial>(asking.content, () => deps.mlb.fetchGameEditorial(gamePk)),
		ask<GamePlayMetrics>(asking.playMetrics, () => deps.mlb.fetchPlayMetrics(gamePk)),
		ask<GameGraphContent>(asking.graphContent, () => deps.mlb.fetchGameGraphContent(gamePk)),
	]);
	const game = {
		...assembleGame(feed.game, editorial, playMetrics, graph),
		fetchedAt,
		windowMode,
	};
	const answered: Partial<Record<ExtraSource, boolean>> = {};
	if (asking.content) answered.content = editorial !== null;
	if (asking.playMetrics) answered.playMetrics = playMetrics !== null;
	if (asking.graphContent) answered.graphContent = graph !== null;
	return {
		kind: "fetched",
		game,
		...feed.feedTime !== undefined && {
			feedTime: feed.feedTime,
		},
		answered,
	};
}

/**
 * Hydrates every game from `to` back to `from` (both included; `from` clamped to 1901-04-18,
 * the off-season skipped, `backfillDays`). Safe to stop and run again: see the module comment.
 */
export async function runBackfill(deps: BackfillDeps, range: { from: string;
	to: string; }): Promise<BackfillResult>
{
	const log = deps.log ?? (() => undefined);
	const state = await deps.state.load();
	const result: BackfillResult = {
		days: 0,
		alreadyComplete: 0,
		gamesStored: 0,
		repaired: 0,
		incomplete: [],
		givenUp: {},
		stopped: false,
	};
	for (const source of EXTRA_SOURCES)
	{
		const givenUpAt = sourceGivenUpAt(state.sources[source]);
		if (givenUpAt) result.givenUp[source] = givenUpAt;
	}

	for (const day of backfillDays(range.from, range.to))
	{
		if (deps.signal?.aborted)
		{
			result.stopped = true;
			break;
		}
		result.days++;
		deps.pace?.(day);
		const now = deps.now?.() ?? new Date();
		const today = mlbToday(now);
		let complete = true;

		// The stored day is enough when it is settled and every game carries its type; otherwise
		// MLB is asked again. An untyped settled day (stored before S167) is asked once here; the
		// version guard lets its new types through, and it counts as complete whatever MLB sent, or
		// with its stored games when the request fails.
		// The joined day (S150 AC 6): each game's status from its one stored state, since the stored day has none.
		let scheduleDay = await readScheduleDay(deps, day, now);
		let askedMlb = false;
		// Games MLB's schedule calls final this run. A game whose one stored state says otherwise (written in play,
		// and the switch then hands it to the feed, S150) is fetched too, so its feed's final mends it.
		const fetchedFinals = new Set<number>();
		if (!scheduleDay || !isScheduleDaySettled(scheduleDay, today) || scheduleDayLacksGameType(scheduleDay))
		{
			askedMlb = true;
			try
			{
				const fetched = await deps.mlb.fetchSchedule(day);
				for (const game of fetched.games) if (isFinalSummary(game)) fetchedFinals.add(game.gamePk);
				scheduleDay = await storeSchedule(deps, {
					...fetched,
					fetchedAt: now.toISOString(),
					windowMode: await scheduleDayWindowMode(deps, fetched, now),
				});
			}
			catch (error)
			{
				const reason = failureReason(error);
				// Only a missing or unsettled day waits for the next run. A settled day asked only for its
				// game types (stored before S167) carries on with what is stored, so its finals and any
				// projection repair still run (S122 AC 4; S167 AC 4: it never holds the run's other work back).
				if (!scheduleDay || !isScheduleDaySettled(scheduleDay, today))
				{
					log(`${day}: the schedule fetch or store failed (${reason}); left for the next run`);
					result.incomplete.push(day);
					continue;
				}
				log(`${day}: the schedule fetch or store failed (${reason}); its stored games keep no game type until a later run`);
			}
		}

		const asking = Object.fromEntries(EXTRA_SOURCES.map((source) => [source, !isSourceGivenUp(state.sources[source], day)])) as Record<ExtraSource, boolean>;
		const finals = scheduleDay.games.filter((game) => isFinalSummary(game) || fetchedFinals.has(game.gamePk));
		const windowMode = scheduleDay.windowMode;
		const outcomes = await Promise.all(finals.map((game) => fetchGame(deps, game.gamePk, asking, now.toISOString(), windowMode)));

		let repaired = 0;
		for (const [index, outcome] of outcomes.entries())
		{
			if (outcome.kind === "feedFailed")
			{
				complete = false;
				log(`${day}: game ${finals[index]!.gamePk}'s live feed failed (${outcome.reason}); left for the next run`);
			}
			if (outcome.kind === "repaired") repaired++;
			if (outcome.kind === "fetched") askedMlb = true;
		}
		result.repaired += repaired;
		let stateChanged = false;

		// The give-up rule (AC 7): a day counts for a source only when it was asked for some game.
		for (const source of EXTRA_SOURCES)
		{
			const answers = outcomes.flatMap((outcome) => outcome.kind === "fetched" && outcome.answered[source] !== undefined ? [outcome.answered[source]] : []);
			if (answers.length === 0) continue;
			const before = state.sources[source] ?? {
				stretches: [],
			};
			const after = recordSourceDay(before, day, !answers.includes(true), range.to);
			if (after === before) continue;
			state.sources[source] = after;
			stateChanged = true;
			// Every counted day is newer than any give-up so far, so a new give-up moves the newest one.
			const givenUpAt = sourceGivenUpAt(after);
			if (givenUpAt !== undefined && givenUpAt !== sourceGivenUpAt(before))
			{
				result.givenUp[source] = givenUpAt;
				log(`${day}: gave up ${source} after ${GIVE_UP_AFTER_DAYS} days of games without it in a row; not asked again for older days`);
			}
		}
		// Saved before the day's games are written, so a stop between the two can't lose the day's answers.
		if (stateChanged) await deps.state.save(state);

		let stored = 0;
		for (const outcome of outcomes)
		{
			if (outcome.kind === "fetched" && (await ingestGame(deps, outcome.game, outcome.feedTime)).changed) stored++;
		}
		result.gamesStored += stored;
		// Judged once the day's games are written, since a feed's final can settle a game's state (S150).
		if (askedMlb && !isScheduleDaySettled(await readScheduleDay(deps, day, now) ?? scheduleDay, today)) complete = false;

		if (!complete) result.incomplete.push(day);
		if (!askedMlb && complete && repaired === 0)
		{
			result.alreadyComplete++;
			continue;
		}
		const givenUp = Object.keys(result.givenUp);
		log(`${day}: ${finals.length} final, ${stored} stored${repaired > 0 ? `, ${repaired} repaired` : ""}${complete ? "" : ", incomplete (checked again next run)"}${givenUp.length > 0 ? `; given up: ${givenUp.join(", ")}` : ""}`);
	}
	return result;
}
