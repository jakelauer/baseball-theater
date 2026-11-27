import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { sendClipView } from "./clipViews.js";

const URL_FOR = (mediaId: string) => `${location.origin}/api/v1/clips/${mediaId}/views`;

/** A Blob's text, read with `FileReader` (jsdom's Blob has no `text()`). */
function blobText(blob: Blob): Promise<string>
{
	return new Promise((resolve) =>
	{
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.readAsText(blob);
	});
}

afterEach(() =>
{
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(navigator, "sendBeacon");
});

/** Gives `navigator` a beacon answering `queued`. */
function stubBeacon(queued: boolean)
{
	const beacon = vi.fn((_url: string, _data?: BodyInit | null) => queued);
	Object.defineProperty(navigator, "sendBeacon", {
		value: beacon,
		configurable: true,
	});
	return beacon;
}

describe("sendClipView (S174 AC 6)", () =>
{
	it("S174 AC 6: sends the view with navigator.sendBeacon, as JSON, to the clip's route", async () =>
	{
		const beacon = stubBeacon(true);
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		sendClipView("hl 1/2", "start", {
			gamePk: 823823,
			shownPosition: 4,
		});
		expect(beacon).toHaveBeenCalledTimes(1);
		const [url, data] = beacon.mock.calls[0]!;
		expect(url).toBe(URL_FOR("hl%201%2F2"));
		expect((data as Blob).type).toBe("application/json");
		expect(JSON.parse(await blobText(data as Blob))).toEqual({
			gamePk: 823823,
			event: "start",
			shownPosition: 4,
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("S174 AC 6: falls back to fetch with keepalive, without a session or cookies, where there is no beacon or it refuses", () =>
	{
		const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(null, {
			status: 204,
		})));
		vi.stubGlobal("fetch", fetch);
		sendClipView("hl-1", "complete", {
			gamePk: 1,
			shownPosition: 0,
		});
		stubBeacon(false);
		sendClipView("hl-2", "start", {
			gamePk: 1,
			shownPosition: 2,
		});
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([URL_FOR("hl-1"), URL_FOR("hl-2")]);
		const init = fetch.mock.calls[0]![1]!;
		expect(init).toMatchObject({
			method: "POST",
			keepalive: true,
			credentials: "omit",
		});
		expect(new Headers(init.headers).has("Authorization")).toBe(false);
		expect(JSON.parse(init.body as string)).toEqual({
			gamePk: 1,
			event: "complete",
			shownPosition: 0,
		});
	});

	it("S174 AC 6: a failed send is dropped silently: no retry, nothing thrown", async () =>
	{
		const fetch = vi.fn(() => Promise.reject(new TypeError("offline")));
		vi.stubGlobal("fetch", fetch);
		expect(() => sendClipView("hl-1", "start", {
			gamePk: 1,
			shownPosition: 1,
		})).not.toThrow();
		const beacon = vi.fn(() =>
		{
			throw new TypeError("refused");
		});
		Object.defineProperty(navigator, "sendBeacon", {
			value: beacon,
			configurable: true,
		});
		expect(() => sendClipView("hl-1", "start", {
			gamePk: 1,
			shownPosition: 1,
		})).not.toThrow();
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
