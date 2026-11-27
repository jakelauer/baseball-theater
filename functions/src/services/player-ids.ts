/**
 * MLB's players' outside ids, preseeded once and kept in step with the Chadwick register (S209 AC 3; owner,
 * 2026-11-27: "yes, go ahead with the ETag sync"). Nothing looks players up one by one and nothing at ingest adds
 * them: the cron's player-id job (its own `cron` scope in `worker.ts`) syncs at most one of the register's sixteen
 * files a run, each about once a day, with a conditional request on the ETag it stored. An unchanged file is a 304
 * and nothing more; a changed one is read, its gaps filled from MLB's cross-references, and written in one statement
 * (`PlayerIdRepository.replaceRegisterFile`). The first sync of each file is the preseed: sixteen runs.
 */
import type {
	PlayerIdRepository, PlayerIdRow, PlayerRegister, PlayerXrefSource, RegisterFileState, RegisterRow, ResolvedPlayerIds,
} from "@bt/ports";

/** How long a synced register file is left before it is checked again (a day; an unchanged day is sixteen 304s). */
export const REGISTER_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How long a file whose sync failed (or is running) is left before a run tries it again (an hour). */
export const REGISTER_RETRY_MS = 60 * 60 * 1000;

/** How many players one MLB cross-reference request asks about. */
export const PLAYER_XREF_BATCH = 100;

export type PlayerIdSyncDeps = {
	playerIds: PlayerIdRepository;
	register: PlayerRegister;
	xrefs: PlayerXrefSource;
	now?: () => Date;
};

/** What one run did: which file it synced (null when none was due) and whether that file had changed. */
export type PlayerIdSyncResult =
	| { file: null }
	| { file: string;
		changed: false; }
	| { file: string;
		changed: true;
		inserted: number;
		updated: number;
		deleted: number;
		xrefCalls: number; };

/**
 * The file a run should sync, or null: a file never synced first (in the register's order), else the one synced
 * longest ago, once that is over {@link REGISTER_SYNC_INTERVAL_MS} ago; never one tried within
 * {@link REGISTER_RETRY_MS} (a failed or running sync). The claim (`claimRegisterFile`) applies the same rule again
 * in the database, so two runs can't both take a file.
 */
export function dueRegisterFile(files: readonly string[], states: readonly RegisterFileState[], now: Date): string | null
{
	const byFile = new Map(states.map((state) => [state.file, state]));
	const resting = (state: RegisterFileState | undefined) => state?.triedAt != null && now.getTime() - Date.parse(state.triedAt) < REGISTER_RETRY_MS;
	const never = files.find((file) => byFile.get(file)?.syncedAt == null && !resting(byFile.get(file)));
	if (never !== undefined) return never;
	const due = files
		.map((file) => byFile.get(file)!)
		.filter((state) => state.syncedAt != null && now.getTime() - Date.parse(state.syncedAt) > REGISTER_SYNC_INTERVAL_MS && !resting(state))
		.sort((a, b) => Date.parse(a.syncedAt!) - Date.parse(b.syncedAt!));
	return due[0]?.file ?? null;
}

/**
 * A register row with MLB's cross-references filling only an id the register lacks (S209 AC 1): where both hold one,
 * the register's is kept (they agree in every recorded case, the register publishes Baseball-Reference's own key,
 * where MLB's `lahman` only matches it, and the register is what the sync follows for corrections).
 */
export function fillFromXrefs(row: RegisterRow, xref: ResolvedPlayerIds | undefined): PlayerIdRow
{
	return {
		personId: row.personId,
		fangraphsId: row.fangraphsId ?? xref?.fangraphsId ?? null,
		bbrefId: row.bbrefId ?? xref?.bbrefId ?? null,
	};
}

/**
 * One run of the player-id job: picks and claims the due file, fetches it conditionally (with its stored ETag), and on
 * a 304 records the check; on a changed file asks MLB's cross-references, {@link PLAYER_XREF_BATCH} at a time, for its
 * players the register says played in MLB and lacks an id for, fills them ({@link fillFromXrefs}), keeps the rows
 * with at least one id (a row with neither would answer what no row answers) and writes them with the new ETag in one
 * statement. Any failure rejects (the runtime logs it) having stored no ETag; the claim's `triedAt` keeps the file
 * back for {@link REGISTER_RETRY_MS}, and the other files go on syncing meanwhile.
 */
export async function syncPlayerRegister(deps: PlayerIdSyncDeps): Promise<PlayerIdSyncResult>
{
	const now = deps.now?.() ?? new Date();
	const at = now.toISOString();
	const states = await deps.playerIds.registerFiles();
	const file = dueRegisterFile(deps.register.files, states, now);
	if (file === null) return {
		file: null,
	};
	const claimed = await deps.playerIds.claimRegisterFile(
		file,
		at,
		new Date(now.getTime() - REGISTER_SYNC_INTERVAL_MS).toISOString(),
		new Date(now.getTime() - REGISTER_RETRY_MS).toISOString(),
	);
	if (!claimed) return {
		file: null,
	};
	const stored = states.find((state) => state.file === file);
	const answer = await deps.register.fetchFile(file, stored?.etag ?? null);
	if (!answer.changed)
	{
		await deps.playerIds.markRegisterFileUnchanged(file, at);
		return {
			file,
			changed: false,
		};
	}
	const gaps = answer.rows.filter((row) => row.playedInMlb && (row.fangraphsId === null || row.bbrefId === null)).map((row) => row.personId);
	const xrefs = new Map<number, ResolvedPlayerIds>();
	let xrefCalls = 0;
	for (let start = 0; start < gaps.length; start += PLAYER_XREF_BATCH)
	{
		xrefCalls++;
		for (const [id, ids] of await deps.xrefs.fetchPlayerXrefs(gaps.slice(start, start + PLAYER_XREF_BATCH))) xrefs.set(id, ids);
	}
	const rows = answer.rows
		.map((row) => fillFromXrefs(row, row.playedInMlb ? xrefs.get(row.personId) : undefined))
		.filter((row) => row.fangraphsId !== null || row.bbrefId !== null);
	const written = await deps.playerIds.replaceRegisterFile(file, rows, answer.etag, at);
	return {
		file,
		changed: true,
		...written,
		xrefCalls,
	};
}
