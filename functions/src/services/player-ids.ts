/**
 * Players' outside ids, resolved lazily (S209 AC 3; ARCHITECTURE §3), never by scanning every game BT holds in one
 * go: S122 backfills every game since 1901, and the cron runs every minute under the Worker's subrequest limit.
 *
 * - Ingest adds a game's players, unchecked, when it first writes the game or a write changes its roster
 *   (`addRosterPlayers`, called from `storeGames`), not on every live snapshot.
 * - The cron's player-id job (`runPlayerIdJobs`, its own `cron` scope in `worker.ts`) first resolves at most
 *   {@link RESOLVE_CAP} due players through the register (one read of it a run, and none when nothing is due), then
 *   seeds one page of {@link SEED_PAGE_GAMES} stored games by keyset, so games stored before S209 get their players
 *   without any game document reaching the Worker. Neither keeps a last-run time: what is due is in the rows.
 */
import type { GameSnapshot } from "@bt/domain";
import { gamePersonIds } from "@bt/domain";
import type { PlayerIdRepository, PlayerRegister } from "@bt/ports";

/** At most this many players are looked up in one cron run; the rest stay unchecked for the next run. */
export const RESOLVE_CAP = 1000;

/** A checked player the register knew nothing for is asked about again only after this long (two weeks). */
export const RECHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/** How many stored games one seeding run reads (counted in games, apart from the resolve cap). */
export const SEED_PAGE_GAMES = 200;

export type PlayerIdJobDeps = {
	playerIds: PlayerIdRepository;
	/** The register; absent (local fixture data, tests of seeding alone) the resolve step does nothing. */
	register?: PlayerRegister;
	now?: () => Date;
};

/**
 * The resolve step: selects up to {@link RESOLVE_CAP} due players (never checked first, then those with no outside
 * id checked over {@link RECHECK_INTERVAL_MS} ago), asks the register once for all of them, and marks each checked
 * with what it found (nulls for one it lacks). Answers how many were asked about; 0 means no register call.
 */
export async function resolveDuePlayerIds(deps: PlayerIdJobDeps): Promise<number>
{
	if (!deps.register) return 0;
	const now = deps.now?.() ?? new Date();
	const due = await deps.playerIds.listDue(RESOLVE_CAP, new Date(now.getTime() - RECHECK_INTERVAL_MS).toISOString());
	if (due.length === 0) return 0;
	const found = await deps.register.lookup(due);
	await deps.playerIds.recordChecked(due, found, now.toISOString());
	return due.length;
}

/**
 * The cron's player-id job: the resolve step, then one page of the seeding pass (`seedNextPage`, one SQL statement
 * that moves its own cursor). An empty page means every stored game has been seeded, and a later run reads only games
 * stored after the cursor.
 */
export async function runPlayerIdJobs(deps: PlayerIdJobDeps): Promise<{ resolved: number;
	seededGames: number; }>
{
	const resolved = await resolveDuePlayerIds(deps);
	const seeded = await deps.playerIds.seedNextPage(SEED_PAGE_GAMES);
	return {
		resolved,
		seededGames: seeded.games,
	};
}

/** Whether two sorted id lists differ. */
function rosterChanged(before: readonly number[], after: readonly number[]): boolean
{
	return before.length !== after.length || before.some((id, i) => id !== after[i]);
}

/**
 * Ingest's part (S209 AC 3): of the games a write stored (`stored` the copy before it, null for a first write), the
 * players of each whose roster (`gamePersonIds`) is new or changed are added unchecked, in one insert. A failed insert
 * is logged and never fails the game write: the seeding pass reaches the game's players too.
 */
export async function addRosterPlayers(
	playerIds: PlayerIdRepository | undefined,
	written: readonly { stored: GameSnapshot | null;
		snapshot: GameSnapshot; }[],
): Promise<void>
{
	if (!playerIds) return;
	const ids = new Set<number>();
	for (const { stored, snapshot } of written)
	{
		const after = gamePersonIds(snapshot);
		if (stored === null || rosterChanged(gamePersonIds(stored), after)) for (const id of after) ids.add(id);
	}
	if (ids.size === 0) return;
	try
	{
		await playerIds.addPlayers([...ids]);
	}
	catch (error)
	{
		console.error("player ids: adding a game's players failed:", error instanceof Error ? error.name : typeof error);
	}
}
