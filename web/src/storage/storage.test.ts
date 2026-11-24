import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import {
	API_CACHE, clearPersonalData, readStored, STORAGE_KEYS, writeStored,
} from "./storage.js";

afterEach(() =>
{
	localStorage.clear();
	sessionStorage.clear();
	vi.restoreAllMocks();
});

describe("browser storage", () =>
{
	it("round-trips a labeled key and removes it on null", () =>
	{
		writeStored("bt.session", "token-1");
		expect(readStored("bt.session")).toBe("token-1");
		writeStored("bt.session", null);
		expect(readStored("bt.session")).toBeNull();
	});

	it("labels every key personal or not", () =>
	{
		for (const label of Object.values(STORAGE_KEYS)) expect(typeof label.personal).toBe("boolean");
	});

	it("clearPersonalData removes every personal key and leaves keys BT doesn't own", () =>
	{
		writeStored("bt.session", "token-1");
		localStorage.setItem("someone-else", "kept");
		clearPersonalData();
		expect(readStored("bt.session")).toBeNull();
		expect(localStorage.getItem("someone-else")).toBe("kept");
	});

	it("S73: the update snooze and the dismissed install tip say nothing about the person, so sign-out keeps them", () =>
	{
		writeStored("bt.updateSnoozedUntil", "123");
		writeStored("bt.installTipDismissed", "1");
		clearPersonalData();
		expect(readStored("bt.updateSnoozedUntil")).toBe("123");
		expect(readStored("bt.installTipDismissed")).toBe("1");
		writeStored("bt.updateSnoozedUntil", null);
		writeStored("bt.installTipDismissed", null);
	});

	it("#416: the chosen video quality says nothing about the person and survives sign-out, in this browser for every visitor", () =>
	{
		expect(STORAGE_KEYS["bt.videoQuality"]).toEqual({
			personal: false,
			area: "shared",
		});
		writeStored("bt.videoQuality", "highBit");
		clearPersonalData();
		expect(readStored("bt.videoQuality")).toBe("highBit");
	});

	it("S135 AC 3: the recorded release is its own key, not the snooze key, says nothing about the person and survives sign-out", () =>
	{
		expect(STORAGE_KEYS["bt.lastRelease"]).toEqual({
			personal: false,
			area: "shared",
		});
		writeStored("bt.lastRelease", "v3.2.0");
		writeStored("bt.updateSnoozedUntil", "123");
		clearPersonalData();
		expect(readStored("bt.lastRelease")).toBe("v3.2.0");
		writeStored("bt.updateSnoozedUntil", null);
		expect(readStored("bt.lastRelease")).toBe("v3.2.0");
		writeStored("bt.lastRelease", null);
	});

	it("reads null and drops writes when storage throws", () =>
	{
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		expect(readStored("bt.session")).toBeNull();
		expect(() => writeStored("bt.session", "token-1")).not.toThrow();
	});

	it("S120 AC 5: the in-flight sign-in and its return path are the tab's own, and clearPersonalData clears both areas", () =>
	{
		for (const key of ["bt.signInReturnTo", "logto.signInSession", "logto.idToken", "logto.accessToken", "logto.refreshToken"] as const)
		{
			expect(STORAGE_KEYS[key]).toEqual({
				personal: true,
				area: "tab",
			});
		}
		writeStored("logto.signInSession", "pkce-of-this-tab");
		writeStored("bt.signInReturnTo", "/settings");
		writeStored("bt.session", "token-1");
		// Another tab's storage area is a different sessionStorage; the shared one never holds the sign-in.
		expect(sessionStorage.getItem("logto.signInSession")).toBe("pkce-of-this-tab");
		expect(sessionStorage.getItem("bt.signInReturnTo")).toBe("/settings");
		expect(Object.keys(localStorage)).toEqual(["bt.session"]);
		expect(readStored("logto.signInSession")).toBe("pkce-of-this-tab");

		clearPersonalData();
		expect(Object.keys(localStorage)).toEqual([]);
		expect(Object.keys(sessionStorage)).toEqual([]);
	});

	it("S74 AC 1 cache name: the API runtime cache is declared here, labeled Cache Storage and personal (ADR-028's offline caches), and is no localStorage key", () =>
	{
		expect(API_CACHE).toEqual({
			name: "bt-api-v1",
			area: "cache",
			personal: true,
		});
		expect(Object.keys(STORAGE_KEYS)).not.toContain(API_CACHE.name);
	});

	it("S74: clearPersonalData deletes the offline API cache (ADR-028: offline caches go on sign-out and deletion), and leaves the shell's precache", async () =>
	{
		const remove = vi.fn(async () => true);
		vi.stubGlobal("caches", {
			delete: remove,
		});
		clearPersonalData();
		await vi.waitFor(() => expect(remove).toHaveBeenCalledWith("bt-api-v1"));
		expect(remove).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it("S74 R1: clearPersonalData tells the controlling worker to forget personal copies, so an answer still on its way isn't stored after sign-out", () =>
	{
		const postMessage = vi.fn();
		vi.stubGlobal("caches", {
			delete: vi.fn(async () => true),
		});
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				controller: {
					postMessage,
				},
			},
		});
		clearPersonalData();
		expect(postMessage).toHaveBeenCalledWith({
			type: "CLEAR_PERSONAL",
		});
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				controller: null,
			},
		});
		expect(() => clearPersonalData()).not.toThrow();
		delete (navigator as { serviceWorker?: unknown }).serviceWorker;
		expect(() => clearPersonalData()).not.toThrow();
		vi.unstubAllGlobals();
	});

	it("S74: clearPersonalData still clears the keys where Cache Storage is missing or refuses", async () =>
	{
		vi.stubGlobal("caches", {
			delete: vi.fn(async () =>
			{
				throw new Error("blocked");
			}),
		});
		writeStored("bt.session", "token");
		expect(() => clearPersonalData()).not.toThrow();
		expect(readStored("bt.session")).toBeNull();
		vi.unstubAllGlobals();
		vi.stubGlobal("caches", undefined);
		writeStored("bt.session", "token");
		expect(() => clearPersonalData()).not.toThrow();
		expect(readStored("bt.session")).toBeNull();
		vi.unstubAllGlobals();
	});
});
