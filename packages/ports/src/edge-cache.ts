/**
 * Clearing Cloudflare's edge copy of a BT response (S212; ADR-021's 2026-11-24 amendment). A past, finished day or game
 * is kept at the edge for weeks, so when a write really changes one, the writer asks this port to drop the edge's copy
 * of its URLs in every data center. Cloud-agnostic (ADR-012): the Cloudflare purge-by-URL adapter, a no-op (no
 * credentials) and a memory double for tests live under `functions/src/adapters/`.
 */
export interface EdgeCachePurger
{
	/**
	 * Drops the edge's copy of each absolute URL in `urls` (exactly as the web client asks for them). Rejects when the
	 * purge request fails; callers record the URLs as owed ({@link OwedEdgePurgeRepository}) and never fail the write
	 * that asked for it.
	 */
	purge(urls: readonly string[]): Promise<void>;
}

/** One URL whose purge failed and is still owed (S212). */
export interface OwedEdgePurge
{
	/** An absolute URL, or a path the cron sends under its origin (S161). */
	url: string;
	/** When it was last owed, an ISO instant: a purge owed longer than the edge lifetime is given up. */
	owedAt: string;
	/**
	 * A version unique for the store's life, a new one each time the URL is owed (again), so settling or deferring an
	 * older listing never touches a newer owe, even one made after that listing's row was settled.
	 */
	version: number;
	/** How many retries of it have failed since it was last owed. */
	failures: number;
}

/**
 * The purges BT still owes the edge (S212): a write whose purge failed records its URLs here, and the cron retries them
 * (`retryOwedEdgePurges`), so a Cloudflare outage delays a correction rather than pinning it for the edge's 30 days.
 */
export interface OwedEdgePurgeRepository
{
	/** Records each of `urls` owed at `at` (an ISO instant): a new row, or an existing one re-owed (a new version, its failures and retry time cleared). */
	owe(urls: readonly string[], at: string): Promise<void>;
	/** At most `limit` owed purges whose retry time is unset or not after `at`, oldest owed first (then by URL). */
	listDue(at: string, limit: number): Promise<OwedEdgePurge[]>;
	/** Drops each listed purge, only while its version is still the listed one, so a URL owed again since stays owed. */
	settle(purges: readonly Pick<OwedEdgePurge, "url" | "version">[]): Promise<void>;
	/** Records a failed retry of each listed purge still at its listed version: its `failures` raised by one, not retried before `retryAt`. */
	defer(purges: readonly Pick<OwedEdgePurge, "url" | "version">[], retryAt: string): Promise<void>;
}
