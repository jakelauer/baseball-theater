/**
 * The cron's re-check of recently finished games (S212 AC 5; owner, 2026-11-24: "Cron re-checks recent games
 * (Recommended)", the option reading "The cron also re-ingests each game's full detail for recently finished days (e.g.
 * the last 7 days, when corrections actually happen), and purges the edge copy only when something changed"). Since
 * S212 a read never refreshes a past, finished game, and game ingest runs only while a game is in its live window, so
 * this is what picks up a clip MLB posts hours after the last live poll, or a scoring change, and purges the game's
 * edge copy (through `ingestGame`'s store, `purgeGameEdge`).
 */
import {
	GAME_RECHECK_CLAIM_LEASE_MS, GAME_RECHECK_FAILED_HOLD_MS, gamesDueForRecheck, recentRecheckDates, wholeFetchedGame,
} from "@bt/domain";
import type { IngestDeps } from "./ingest.js";
import { ingestGame } from "./ingest.js";

/**
 * Re-ingests at most one due game per call (S212 AC 5) and returns its gamePk, or null when none was due. Run from
 * `scheduled()` on every allowed tick, beside S194's month refresh. A game is due when it is past and finished
 * (`isPastFinishedGame`), final, of the `RECENT_GAME_RECHECK_DAYS` (7) dates before MLB's today, and never re-checked
 * or last re-checked at least S194's refresh interval (`SCHEDULE_MONTH_REFRESH_INTERVAL_MS`, 6 h) ago
 * (`gamesDueForRecheck`: never-checked first, then the oldest check, then the earliest gamePk). It claims the first due
 * game it can (`claimGameRecheck`, one conditional write that re-checks the game is still due, so two isolates never
 * re-check one game at once), fetches its full detail through `fetchGame` (the live feed, its content and highlight
 * clips, play metrics and graph content) and stores it through `ingestGame`, which purges the game's URL and its day's
 * schedule and digest URLs (and of any other day listing it) only when the stored game changed; a purge that fails is
 * owed and retried by the cron (`retryOwedEdgePurges`), so the re-check is recorded either way. Then it records the
 * re-check, changed or not. An MLB failure records no re-check and stores nothing, and holds the game for
 * `GAME_RECHECK_FAILED_HOLD_MS` (6 h, `holdGameRecheck`, as S194 holds a month whose fill failed), so a feed that fails
 * for good is asked as often as a working one, not after every 5-minute lease; a store failure is BT's own and rejects.
 *
 * Upstream budget (ADR-002): one game per tick, `fetchGame`'s 4 MLB requests at most, so at most 5,760 requests a day
 * by the tick count (1,440 ticks). In practice each recent game is tried once per 6 h, for 7 days, whether MLB answers
 * or fails: at most 7 days × about 17 games × 4 tries × 4 requests ≈ 1,900 requests a day in mid-season, and none in
 * the off-season. A correction MLB makes to a game more than 7 days after it was played is never picked up (the owner's
 * choice). A tick with no due game sends no request and does one database read (`listRecheckCandidates`).
 */
export async function recheckDueGame(deps: IngestDeps): Promise<number | null>
{
	const now = deps.now?.() ?? new Date();
	const { from, to } = recentRecheckDates(now);
	const candidates = await deps.games.listRecheckCandidates(from, to);
	for (const game of gamesDueForRecheck(candidates, now, GAME_RECHECK_CLAIM_LEASE_MS))
	{
		// Another isolate may have claimed or re-checked it since the read: try the next due game.
		if (!await deps.games.claimGameRecheck(game.gamePk, now.toISOString())) continue;
		let fetched;
		try
		{
			// The whole game, its playMetrics waited for (S216 AC 5).
			fetched = await wholeFetchedGame(await deps.mlb.fetchGame(game.gamePk));
		}
		catch (error)
		{
			console.warn(`recheckDueGame: game ${game.gamePk} not re-checked; MLB failed, held for the refresh interval`, error);
			await deps.games.holdGameRecheck(game.gamePk, new Date(now.getTime() + GAME_RECHECK_FAILED_HOLD_MS - GAME_RECHECK_CLAIM_LEASE_MS).toISOString());
			return game.gamePk;
		}
		await ingestGame(deps, {
			...fetched.game,
			fetchedAt: now.toISOString(),
			windowMode: "cache",
		}, fetched.feedTime);
		await deps.games.recordGameRecheck(game.gamePk, now.toISOString());
		return game.gamePk;
	}
	return null;
}
