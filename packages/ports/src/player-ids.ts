/**
 * The outside ids of MLB's players (S209): which FanGraphs and Baseball-Reference ids go with each MLB
 * person id, so a player's name can open their page on those sites. The table is preseeded from the
 * Chadwick Bureau's register and kept in step with it file by file (owner, 2026-11-27: "yes, go ahead
 * with the ETag sync"), MLB's cross-references filling an id the register lacks; nothing is looked up
 * player by player. Every person id stored is at most `PERSON_ID_MAX` (`@bt/domain`).
 */

/** One player's stored ids: each null when neither source has it (a row always holds at least one). */
export type PlayerIdRow = {
	personId: number;
	fangraphsId: string | null;
	bbrefId: string | null;
};

/** What a source holds for one player it knows. */
export type ResolvedPlayerIds = {
	fangraphsId: string | null;
	bbrefId: string | null;
};

/** One register file's sync state: the ETag of the copy last written, and when it was last synced and last tried (ISO instants). */
export type RegisterFileState = {
	file: string;
	etag: string | null;
	syncedAt: string | null;
	triedAt: string | null;
};

/** What one sync of a register file writes, counted by the statement that wrote it. */
export type RegisterFileWrite = {
	inserted: number;
	updated: number;
	deleted: number;
};

export interface PlayerIdRepository {
	/** The stored rows of `personIds` (repeats and ids with no row, or past `PERSON_ID_MAX`, are left out). */
	getMany(personIds: readonly number[]): Promise<PlayerIdRow[]>;
	/** Every register file's sync state, in no order; a file never tried has none. */
	registerFiles(): Promise<RegisterFileState[]>;
	/**
	 * Claims `file` for one run's sync, in one conditional statement: it is taken (and its `triedAt` set to
	 * `at`) only when it was never synced or was last synced before `dueBefore`, and was never tried or last
	 * tried before `retryBefore`. True means this caller holds it; two racing runs can't both get it.
	 */
	claimRegisterFile(file: string, at: string, dueBefore: string, retryBefore: string): Promise<boolean>;
	/** Records that `file` was checked at `at` and the register answered it unchanged (a 304). */
	markRegisterFileUnchanged(file: string, at: string): Promise<void>;
	/**
	 * Makes `rows` the stored copy of `file`, in one statement: inserts its new rows, updates only those whose
	 * ids (or file) changed, deletes the rows it came with before that it no longer has, and stores `etag` with
	 * `syncedAt` `at`. A person id given more than once counts once, its last row winning. A row belongs to the last
	 * file that wrote it, so when two files name one id and the owner drops it, the row goes until the other file
	 * next changes. A failure writes none of it.
	 */
	replaceRegisterFile(file: string, rows: readonly PlayerIdRow[], etag: string | null, at: string): Promise<RegisterFileWrite>;
}

/** One register row with an MLB id, as the sync needs it. */
export type RegisterRow = PlayerIdRow & {
	/** Whether the register says the person played in MLB (`mlb_played_first`): only they are asked of MLB. */
	playedInMlb: boolean;
};

/** One conditional fetch of a register file: unchanged (a 304), or its rows and the copy's ETag (null when none was sent). */
export type RegisterFileAnswer =
	| { changed: false }
	| { changed: true;
		etag: string | null;
		rows: RegisterRow[]; };

/**
 * The Chadwick Bureau's open player register (S209 AC 1), the base source: its files, and one conditional
 * request for one of them (`If-None-Match` with the ETag last stored, when there is one). It rejects rather than
 * answer a changed file with no rows, so a broken copy never replaces the stored one.
 */
export interface PlayerRegister {
	readonly files: readonly string[];
	fetchFile(file: string, etag: string | null): Promise<RegisterFileAnswer>;
}

/**
 * MLB's cross-references (S209 AC 1, `hydrate=xrefId`), which fill an id the register lacks: what MLB holds
 * for each of `personIds`, in one request. A person MLB has nothing for is absent.
 */
export interface PlayerXrefSource {
	fetchPlayerXrefs(personIds: readonly number[]): Promise<Map<number, ResolvedPlayerIds>>;
}
