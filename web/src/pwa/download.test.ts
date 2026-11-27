/**
 * S151: the service worker's download route (`downloadResponse`), the names it gives a saved clip
 * (`contentDisposition`), and the ping that tells the page the worker answers it, run with a fake
 * `fetch` and real streams.
 */
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	answerDownloadPing, askDownloadRoute, canStreamDownloads, contentDisposition, DOWNLOAD_PATH, DOWNLOAD_PING, DOWNLOAD_PING_TIMEOUT_MS, DOWNLOAD_READY, downloadHref,
	downloadResponse,
} from "./download.js";

const UUID = "4b03089e-85b8-45bb-b5bd-940b0201ade3";
const MP4 = "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-09/05/68e1ef46-6669f6b0-5b1ac736-csvm-diamondgcp-asset_1280x720_59_4000K.mp4";

/** The route's whole request URL for `url` and `name`, as the page's link makes it. */
function routeHref(url: string, name = "Clip"): string
{
	return new URL(downloadHref(url, name), "https://baseball.theater").href;
}

/** A fake `fetch` answering every request with `response`. */
function answering(response: Response)
{
	return vi.fn<typeof fetch>(async () => response);
}

/** MLB's file: `bytes` as a stream, with its length. */
function mlbFile(bytes: number[]): Response
{
	return new Response(new ReadableStream<Uint8Array>({
		start(controller)
		{
			controller.enqueue(new Uint8Array(bytes));
			controller.close();
		},
	}), {
		status: 200,
		headers: {
			"Content-Length": String(bytes.length),
			"Content-Type": "video/mp4",
		},
	});
}

afterEach(() =>
{
	vi.useRealTimers();
});

describe("the download route (S151, downloadResponse)", () =>
{
	it("S151 AC 1: streams MLB's body through unread, as an attachment, with MLB's Content-Length", async () =>
	{
		const upstream = mlbFile([1, 2, 3]);
		const body = upstream.body;
		const fetcher = answering(upstream);
		const response = await downloadResponse(routeHref(MP4, "Michael Conforto homers"), fetcher);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(MP4, {
			redirect: "error",
		});
		expect(response.status).toBe(200);
		// The same stream, not a copy: nothing read it into memory on the way.
		expect(response.body).toBe(body);
		expect(upstream.bodyUsed).toBe(false);
		expect(response.headers.get("Content-Length")).toBe("3");
		expect(response.headers.get("Content-Type")).toBe("video/mp4");
		expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"michael-conforto-homers.mp4\"; filename*=UTF-8''Michael%20Conforto%20homers.mp4");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
	});

	it("S151 AC 1: with no Content-Length from MLB, none is made up", async () =>
	{
		const upstream = new Response("abc", {
			status: 200,
		});
		upstream.headers.delete("Content-Length");
		const response = await downloadResponse(routeHref(MP4), answering(upstream));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Length")).toBeNull();
	});

	it("S151 AC 1: the name is never the caller's as given: a slug and the RFC 5987 title, both ending .mp4", () =>
	{
		const cases: [string, string][] = [
			["Acuña's homer", "attachment; filename=\"acu-a-s-homer.mp4\"; filename*=UTF-8''Acu%C3%B1a%27s%20homer.mp4"],
			["x.exe", "attachment; filename=\"x.mp4\"; filename*=UTF-8''x.mp4"],
			["満塁弾", "attachment; filename=\"clip.mp4\"; filename*=UTF-8''%E6%BA%80%E5%A1%81%E5%BC%BE.mp4"],
			["Ohtani reaches 50-50 vs. Marlins", "attachment; filename=\"ohtani-reaches-50-50-vs-marlins.mp4\"; filename*=UTF-8''Ohtani%20reaches%2050-50%20vs.%20Marlins.mp4"],
			["a \"b\"/c\\d\r\ne (f) *", "attachment; filename=\"a-b-c-d-e-f.mp4\"; filename*=UTF-8''a%20bcde%20%28f%29%20%2A.mp4"],
			["", "attachment; filename=\"clip.mp4\"; filename*=UTF-8''clip.mp4"],
			["half \uD83D", "attachment; filename=\"half.mp4\"; filename*=UTF-8''half%20.mp4"],
		];
		for (const [title, header] of cases)
		{
			expect(() => contentDisposition(title), title).not.toThrow();
			expect(contentDisposition(title), title).toBe(header);
		}
	});

	it("S151 AC 1: Acuña's homer through the route doesn't throw and names the file both ways", async () =>
	{
		const response = await downloadResponse(routeHref(MP4, "Acuña's homer"), answering(mlbFile([0])));
		expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"acu-a-s-homer.mp4\"; filename*=UTF-8''Acu%C3%B1a%27s%20homer.mp4");
		const unnamed = await downloadResponse(new URL(`${DOWNLOAD_PATH}?url=${encodeURIComponent(MP4)}`, "https://baseball.theater").href, answering(mlbFile([0])));
		expect(unnamed.headers.get("Content-Disposition")).toBe("attachment; filename=\"clip.mp4\"; filename*=UTF-8''clip.mp4");
	});

	it("S151 AC 1: a removed clip's 403 or 404, or a fetch that rejects (a network error, a redirect), answers 502 with no Content-Disposition", async () =>
	{
		for (const status of [403, 404, 500])
		{
			const response = await downloadResponse(routeHref(MP4), answering(new Response("<html>gone</html>", {
				status,
			})));
			expect(response.status, String(status)).toBe(502);
			expect(response.headers.get("Content-Disposition")).toBeNull();
		}
		const rejected = await downloadResponse(routeHref(MP4), vi.fn<typeof fetch>(async () =>
		{
			throw new TypeError("Failed to fetch");
		}));
		expect(rejected.status).toBe(502);
		expect(rejected.headers.get("Content-Disposition")).toBeNull();
		const empty = await downloadResponse(routeHref(MP4), answering(new Response(null, {
			status: 200,
		})));
		expect(empty.status).toBe(502);
	});

	it("S151 AC 2: each MLB clip host's real shape is fetched", async () =>
	{
		for (const url of [MP4, `https://bdata-producedclips.mlb.com/${UUID}.mp4`, `https://darkroom-clips.mlb.com/${UUID}.mp4`])
		{
			const fetcher = answering(mlbFile([0]));
			expect((await downloadResponse(routeHref(url), fetcher)).status, url).toBe(200);
			expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, {
				redirect: "error",
			});
		}
	});

	it("S151 AC 2: anything but an MLB clip MP4, or a malformed or missing url, answers 400 and fetches nothing", async () =>
	{
		const refused = [
			`https://mlb-cuts-diamond.mlb.com.evil.example/${UUID}.mp4`,
			`https://evil.example/mlb-cuts-diamond.mlb.com/${UUID}.mp4`,
			`https://mlb-cuts-diamond.mlb.com@evil.example/${UUID}.mp4`,
			`https://user:pw@mlb-cuts-diamond.mlb.com/${UUID}.mp4`,
			`http://mlb-cuts-diamond.mlb.com/${UUID}.mp4`,
			`https://mlb-cuts-diamond.mlb.com:8443/${UUID}.mp4`,
			`https://mlb-cuts-diamond.mlb.com/${UUID}.m3u8?x=.mp4`,
			"::not a url::",
		];
		for (const url of refused)
		{
			const fetcher = answering(mlbFile([0]));
			const response = await downloadResponse(routeHref(url), fetcher);
			expect(response.status, url).toBe(400);
			expect(response.headers.get("Content-Disposition")).toBeNull();
			expect(fetcher).not.toHaveBeenCalled();
		}
		const fetcher = answering(mlbFile([0]));
		expect((await downloadResponse(`https://baseball.theater${DOWNLOAD_PATH}`, fetcher)).status).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe("the download route's ping (S151)", () =>
{
	it("S151 AC 4: the worker answers the ping on its port when it can stream, and stays silent when it can't", () =>
	{
		const port = {
			postMessage: vi.fn(),
		} as unknown as MessagePort;
		expect(answerDownloadPing(DOWNLOAD_PING, [port], () => true)).toBe(true);
		expect(port.postMessage).toHaveBeenCalledExactlyOnceWith(DOWNLOAD_READY);
		vi.mocked(port.postMessage).mockClear();
		expect(answerDownloadPing(DOWNLOAD_PING, [port], () => false)).toBe(true);
		expect(port.postMessage).not.toHaveBeenCalled();
		expect(answerDownloadPing(DOWNLOAD_PING, [])).toBe(true);
		expect(answerDownloadPing({
			type: "SKIP_WAITING",
		}, [port])).toBe(false);
		expect(answerDownloadPing(null, [port])).toBe(false);
		expect(port.postMessage).not.toHaveBeenCalled();
	});

	it("S151 AC 4: streaming is feature-checked: a body passed through a Response, else no", () =>
	{
		expect(canStreamDownloads()).toBe(true);
		vi.stubGlobal("ReadableStream", undefined);
		expect(canStreamDownloads()).toBe(false);
		vi.unstubAllGlobals();
		vi.stubGlobal("Response", function NoStreams()
		{
			throw new TypeError("no streams");
		});
		expect(canStreamDownloads()).toBe(false);
		vi.unstubAllGlobals();
	});

	it("S151 AC 4: the page hears yes only from a worker that answers; no controller, or silence until the timeout, is no", async () =>
	{
		expect(await askDownloadRoute(undefined)).toBe(false);
		expect(await askDownloadRoute({
			controller: null,
		} as ServiceWorkerContainer)).toBe(false);
		const answering = {
			controller: {
				postMessage: (message: unknown, transfer: MessagePort[]) => answerDownloadPing(message, transfer, () => true),
			},
		} as unknown as ServiceWorkerContainer;
		expect(await askDownloadRoute(answering)).toBe(true);
		const otherAnswer = {
			controller: {
				postMessage: (_message: unknown, transfer: MessagePort[]) => transfer[0]!.postMessage({
					type: "something else",
				}),
			},
		} as unknown as ServiceWorkerContainer;
		expect(await askDownloadRoute(otherAnswer)).toBe(false);
		vi.useFakeTimers();
		const silent = askDownloadRoute({
			controller: {
				postMessage: vi.fn(),
			},
		} as unknown as ServiceWorkerContainer);
		vi.advanceTimersByTime(DOWNLOAD_PING_TIMEOUT_MS);
		expect(await silent).toBe(false);
	});
});
