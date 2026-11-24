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
	 * purge request fails; callers log that and never fail the write that asked for it.
	 */
	purge(urls: readonly string[]): Promise<void>;
}
