import {
	describe, expect, it, vi,
} from "vitest";
import {
	CloudflareEdgeCachePurger, NoopEdgeCachePurger, PURGE_URLS_PER_REQUEST,
} from "./edge-cache-purger.js";

/** A fake `fetch` that records each request and answers Cloudflare's success shape (or `status`). */
function fakeFetch(status = 200, success = true)
{
	const requests: { url: string;
		init: RequestInit; }[] = [];
	const fetcher = async (url: string, init: RequestInit) =>
	{
		requests.push({
			url,
			init,
		});
		return new Response(JSON.stringify({
			success,
		}), {
			status,
		});
	};
	return {
		requests,
		fetcher,
	};
}

describe("CloudflareEdgeCachePurger (S212 AC 4)", () =>
{
	it("S212 AC 4 101 urls: purges 101 URLs in exactly 4 requests of at most 30 files each, with the token and zone", async () =>
	{
		const { requests, fetcher } = fakeFetch();
		const urls = Array.from({
			length: 101,
		}, (_, i) => `https://stage.baseball.theater/api/v1/games/${i}`);
		await new CloudflareEdgeCachePurger("tok", "zone1", fetcher).purge(urls);
		expect(PURGE_URLS_PER_REQUEST).toBe(30);
		expect(requests).toHaveLength(4);
		const sent = requests.map((r) => (JSON.parse(r.init.body as string) as { files: string[] }).files);
		expect(sent.map((files) => files.length)).toEqual([30, 30, 30, 11]);
		expect(sent.flat()).toEqual(urls);
		for (const request of requests)
		{
			expect(request.url).toBe("https://api.cloudflare.com/client/v4/zones/zone1/purge_cache");
			expect(request.init.method).toBe("POST");
			expect((request.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
		}
	});

	it("sends nothing for no URLs, and rejects when Cloudflare refuses", async () =>
	{
		const ok = fakeFetch();
		await new CloudflareEdgeCachePurger("tok", "zone1", ok.fetcher).purge([]);
		expect(ok.requests).toHaveLength(0);
		await expect(new CloudflareEdgeCachePurger("tok", "zone1", fakeFetch(403, false).fetcher).purge(["https://x/a"])).rejects.toThrow(/403/);
		await expect(new CloudflareEdgeCachePurger("tok", "zone1", fakeFetch(200, false).fetcher).purge(["https://x/a"])).rejects.toThrow();
	});
});

describe("NoopEdgeCachePurger (S212 AC 4)", () =>
{
	it("purges nothing and logs it once", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const purger = new NoopEdgeCachePurger();
		await purger.purge(["https://x/a"]);
		await purger.purge(["https://x/b"]);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});
