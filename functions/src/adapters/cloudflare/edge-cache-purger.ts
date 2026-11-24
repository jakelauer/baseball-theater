/**
 * Cloudflare's purge-by-URL API behind the `EdgeCachePurger` port (S212 AC 4; ADR-021's 2026-11-24 amendment). Workers
 * Cache is per data center, so `caches.default.delete` would clear one colo only (S194's notes); this API clears every
 * one. It needs a Cloudflare API token with the Zone → Cache Purge permission and the zone's ID, the Worker secrets
 * `BT_CF_PURGE_TOKEN` and `BT_CF_ZONE_ID` (the owner's step); without them, or without `BT_APP_ORIGIN` to build the
 * URLs from, the Worker uses {@link NoopEdgeCachePurger} instead (`edgePurgeFor` in `worker-app.ts`).
 */
import type { EdgeCachePurger } from "@bt/ports";

/**
 * The most URLs one purge request carries: 30, the smallest per-request `files` cap of any Cloudflare plan (the Free
 * plan's), so a request is never refused for its length whatever plan the zone is on. A longer list is split.
 */
export const PURGE_URLS_PER_REQUEST = 30;

/** The `fetch` the adapter calls; tests pass a fake, never the network. */
export type PurgeFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Purges by URL through `POST /client/v4/zones/<zone>/purge_cache` with `files`, at most {@link PURGE_URLS_PER_REQUEST} a request. */
export class CloudflareEdgeCachePurger implements EdgeCachePurger
{
	constructor(
		private readonly token: string,
		private readonly zoneId: string,
		private readonly fetcher: PurgeFetch = (input, init) => fetch(input, init),
	) {}

	/** Sends the requests one after another and rejects on the first Cloudflare refuses (or doesn't answer with `success`). */
	async purge(urls: readonly string[]): Promise<void>
	{
		for (let start = 0; start < urls.length; start += PURGE_URLS_PER_REQUEST)
		{
			const files = urls.slice(start, start + PURGE_URLS_PER_REQUEST);
			const response = await this.fetcher(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.zoneId)}/purge_cache`, {
				method: "POST",
				headers: {
					"Authorization": `Bearer ${this.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					files,
				}),
			});
			const body = await response.json().catch(() => null) as { success?: boolean } | null;
			if (!response.ok || body?.success !== true) throw new Error(`Cloudflare purge_cache failed: HTTP ${response.status}`);
		}
	}
}

/**
 * The purger without credentials (S212 AC 4): purges nothing and logs that once for its lifetime (one per isolate, as
 * the Worker builds its app once), so every write still succeeds and the log says why corrections wait out the edge
 * lifetime.
 */
export class NoopEdgeCachePurger implements EdgeCachePurger
{
	private logged = false;

	async purge(urls: readonly string[]): Promise<void>
	{
		if (this.logged || urls.length === 0) return;
		this.logged = true;
		console.warn("edge purge: BT_CF_PURGE_TOKEN, BT_CF_ZONE_ID or BT_APP_ORIGIN is not set, so nothing was purged from the edge cache");
	}
}
