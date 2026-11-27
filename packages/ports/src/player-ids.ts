/**
 * The outside ids of the players BT has seen (S209): which FanGraphs and Baseball-Reference ids go
 * with each MLB person id, so a player's name can open their page on those sites. Resolved lazily
 * (ARCHITECTURE §3): ingest and a seeding pass add players unchecked, and a capped cron step looks a
 * few up at a time in the one source behind `PlayerRegister`.
 */

/** One player's stored ids: null until resolved, or when the source has none for them. */
export type PlayerIdRow = {
	personId: number;
	/** When the source was last asked about this player (ISO instant), or null while never asked. */
	checkedAt: string | null;
	fangraphsId: string | null;
	bbrefId: string | null;
};

/** What the source answered for one player it knows. */
export type ResolvedPlayerIds = {
	fangraphsId: string | null;
	bbrefId: string | null;
};

/** The keyset cursor of the seeding pass: the last stored game it has read, in (official date, gamePk) order. */
export type PlayerIdSeedCursor = {
	officialDate: string;
	gamePk: number;
};

export interface PlayerIdRepository {
	/** Adds each id not already stored, unchecked (`ON CONFLICT DO NOTHING`); answers how many were new. */
	addPlayers(personIds: readonly number[]): Promise<number>;
	/** The stored row for `personId`, or null when BT has never seen them. */
	get(personId: number): Promise<PlayerIdRow | null>;
	/**
	 * Up to `cap` person ids due a lookup, never-checked first (`ORDER BY checked_at NULLS FIRST`):
	 * those never checked, and those checked before `recheckBefore` (an ISO instant) that the source
	 * knew nothing for.
	 */
	listDue(cap: number, recheckBefore: string): Promise<number[]>;
	/**
	 * Marks each of `personIds` checked at `checkedAt`, with the ids `found` holds for it (both null
	 * for one the source doesn't know).
	 */
	recordChecked(personIds: readonly number[], found: ReadonlyMap<number, ResolvedPlayerIds>, checkedAt: string): Promise<void>;
	/**
	 * One page of the seeding pass: takes the next `pageSize` stored games after the cursor, adds their
	 * players and moves the cursor to the page's last game, in one transaction, without reading any
	 * game document into the caller. Answers how many games the page held (0: seeding is done).
	 */
	seedNextPage(pageSize: number): Promise<{ games: number;
		added: number; }>;
}

/**
 * The one source of outside ids (S209 AC 1): MLB's cross-references carry FanGraphs ids but no
 * Baseball-Reference ids, so it is the Chadwick Bureau's open register. Answers what it holds for
 * the players asked about; one it doesn't know is absent from the map.
 */
export interface PlayerRegister {
	lookup(personIds: readonly number[]): Promise<Map<number, ResolvedPlayerIds>>;
}
