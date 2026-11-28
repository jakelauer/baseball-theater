/**
 * The settings store (S6, ADR-024/027/028): setters save to the account, it
 * hydrates after sign-in and resets on sign-out, and its cached copy lives in
 * `web/src/storage/` under a personal key that sign-out's clear-all removes.
 * `fetch` answers like the API, keeping one settings document per test.
 */
import type { AccountSettings } from "@bt/domain";
import { DEFAULT_SETTINGS } from "@bt/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, renderHook, waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { Session } from "../session/session.js";
import {
	DEV_SIGN_IN_TOKEN, SessionContext, useSession,
} from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { clearPersonalData, readStored } from "../storage/storage.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import { SettingsSync } from "./SettingsSync.js";
import {
	hydrateSettings, resetSettings, setCollapseNonFavorites, setFavoriteTeams, setGameRowSlot, setHideScores, setOpensFirst, setStatsProvider, setVideoPlayer, setVideoQuality,
	useSettings, useVideoQuality,
} from "./store.js";

/** Stubs the API: `/me` for the dev session, and settings as one stored document with apply-if-newer. */
function stubAccountApi(stored: AccountSettings = DEFAULT_SETTINGS)
{
	let doc = stored;
	const puts: AccountSettings[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
		if (pathname === "/api/v1/me/settings" && request.method === "PUT")
		{
			const body = await request.json() as AccountSettings;
			puts.push(body);
			if (body.version > doc.version) doc = body;
			return jsonResponse(doc);
		}
		if (pathname === "/api/v1/me/settings") return jsonResponse(doc);
		return jsonResponse({
			error: "not_found",
		}, 404);
	}));
	return {
		puts,
		stored: () => doc,
	};
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("settings store", () =>
{
	it("starts at the house defaults and is read with useSettings()", () =>
	{
		const { result } = renderHook(() => useSettings());
		expect(result.current).toEqual(DEFAULT_SETTINGS);
	});

	it("setters update at once and save the whole document to the account with the next version", async () =>
	{
		const api = stubAccountApi();
		const { result } = renderHook(() => useSettings());

		await act(() => setFavoriteTeams([147, 111]));
		expect(result.current.favoriteTeamIds).toEqual([147, 111]);
		await act(() => setOpensFirst("box"));
		await act(() => setGameRowSlot("roomMenu"));
		await act(() => setCollapseNonFavorites(true));
		await act(() => setHideScores(true));
		await act(() => setVideoPlayer("stage"));
		await act(() => setStatsProvider("bbref"));
		expect(result.current).toEqual({
			favoriteTeamIds: [147, 111],
			opensFirst: "box",
			gameRowSlot: "roomMenu",
			collapseNonFavorites: true,
			hideScores: true,
			videoPlayer: "stage",
			statsProvider: "bbref",
			version: 7,
		});
		expect(api.puts.map((p) => p.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(api.stored()).toEqual(result.current);
	});

	it("keeps a local change when the save fails", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
			error: "unavailable",
		}, 503)));
		const { result } = renderHook(() => useSettings());
		await act(() => setOpensFirst("live"));
		expect(result.current.opensFirst).toBe("live");
	});

	it("S209 AC 9: a save the account refuses (400) puts the account's copy back, so the next change saves", async () =>
	{
		// The account may not choose a site other than MLB.com: its PUT is refused unless the document keeps "mlb".
		let doc: AccountSettings = {
			...DEFAULT_SETTINGS,
			version: 3,
		};
		const puts: AccountSettings[] = [];
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			if (request.method === "PUT")
			{
				const body = await request.json() as AccountSettings;
				puts.push(body);
				if (body.statsProvider !== "mlb") return jsonResponse({
					error: "invalid_settings",
				}, 400);
				if (body.version > doc.version) doc = body;
			}
			return jsonResponse(doc);
		}));
		await hydrateSettings(DEV_ACCOUNT.uid);
		const { result } = renderHook(() => useSettings());
		await act(() => setStatsProvider("fangraphs"));
		await waitFor(() => expect(result.current).toEqual(doc));
		await act(() => setHideScores(true));
		expect(puts.map((put) => [put.statsProvider, put.version])).toEqual([["fangraphs", 4], ["mlb", 4]]);
		expect(doc.hideScores).toBe(true);
		expect(result.current.hideScores).toBe(true);
	});

	/**
	 * The account of the S209 AC 9 test, refusing any document whose site isn't MLB.com, with each settings read held
	 * until the test answers it, as the account stood when it was asked.
	 */
	async function stubRefusingAccountWithHeldReads()
	{
		let doc: AccountSettings = {
			...DEFAULT_SETTINGS,
			version: 3,
		};
		const puts: AccountSettings[] = [];
		const reads: (() => void)[] = [];
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			if (request.method === "PUT")
			{
				const body = await request.json() as AccountSettings;
				puts.push(body);
				if (body.statsProvider !== "mlb") return jsonResponse({
					error: "invalid_settings",
				}, 400);
				if (body.version > doc.version) doc = body;
				return jsonResponse(doc);
			}
			const asOf = doc;
			return new Promise<Response>((resolve) => reads.push(() => resolve(jsonResponse(asOf))));
		}));
		const hydrated = hydrateSettings(DEV_ACCOUNT.uid);
		await waitFor(() => expect(reads).toHaveLength(1));
		reads.shift()!();
		await hydrated;
		return {
			puts,
			reads,
			doc: () => doc,
		};
	}

	it("S209 AC 9: a refused save's re-read that lands after a later accepted save leaves the later save's copy", async () =>
	{
		const account = await stubRefusingAccountWithHeldReads();
		const { result } = renderHook(() => useSettings());
		const refused = setStatsProvider("fangraphs");
		await waitFor(() => expect(account.reads).toHaveLength(1));
		// Before the re-read answers, the reader picks MLB.com again (version 5), which the account accepts.
		await act(() => setStatsProvider("mlb"));
		expect(account.doc()).toMatchObject({
			statsProvider: "mlb",
			version: 5,
		});
		// The re-read, asked before the accepted save, answers the account's old copy (version 3) last.
		await act(async () =>
		{
			account.reads.shift()!();
			await refused;
		});
		expect(result.current).toEqual(account.doc());
		await act(() => setOpensFirst("box"));
		expect(account.puts.map((put) => [put.version, put.statsProvider])).toEqual([[4, "fangraphs"], [5, "mlb"], [6, "mlb"]]);
		expect(account.doc()).toMatchObject({
			opensFirst: "box",
			version: 6,
		});
	});

	it("S209 AC 9: an earlier refused save's late re-read doesn't undo a change saved since at the version it had", async () =>
	{
		const account = await stubRefusingAccountWithHeldReads();
		const { result } = renderHook(() => useSettings());
		// A (version 4) and B (version 5) are both refused; each reads the account back (version 3).
		const a = setStatsProvider("fangraphs");
		await waitFor(() => expect(account.reads).toHaveLength(1));
		const b = setStatsProvider("bbref");
		await waitFor(() => expect(account.reads).toHaveLength(2));
		// B's re-read lands first and puts version 3 back; C then saves at version 4, A's version, and is accepted.
		await act(async () =>
		{
			account.reads[1]!();
			await b;
		});
		expect(result.current.version).toBe(3);
		await act(() => setOpensFirst("box"));
		expect(account.doc()).toMatchObject({
			opensFirst: "box",
			version: 4,
		});
		// A's re-read lands last: the store holds C's copy, not A's refused one, so it stays.
		await act(async () =>
		{
			account.reads[0]!();
			await a;
		});
		expect(result.current).toEqual(account.doc());
		await act(() => setHideScores(true));
		expect(account.puts.map((put) => [put.version, put.statsProvider])).toEqual([[4, "fangraphs"], [5, "bbref"], [4, "mlb"], [5, "mlb"]]);
		expect(account.doc()).toMatchObject({
			opensFirst: "box",
			hideScores: true,
			version: 5,
		});
	});

	it("hydrates from the account after sign-in and resets to the house defaults on sign-out", async () =>
	{
		const saved = {
			favoriteTeamIds: [121],
			opensFirst: "live" as const,
			gameRowSlot: "status" as const,
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog" as const,
			statsProvider: "mlb" as const,
			version: 4,
		};
		stubAccountApi(saved);
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<SettingsSync />
					{children}
				</SessionProvider>
			</QueryClientProvider>
		);
		const { result } = renderHook(() => ({
			settings: useSettings(),
			session: useSession(),
		}), {
			wrapper,
		});
		await waitFor(() => expect(result.current.settings).toEqual(saved));

		act(() => result.current.session.signOut());
		await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_SETTINGS));
		// The cached copy no longer holds the account's favorites.
		expect(readStored("bt.settings") ?? "").not.toContain("121");
	});

	it("S74 R2: a session the server can't be reached for (offline cold start) keeps the stored settings; one it refuses (401) resets them", async () =>
	{
		// Last visit's settings, as the store left them in bt.settings.
		stubAccountApi();
		await act(() => setHideScores(true));
		const settings = () => renderHook(() => useSettings(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={createQueryClient()}>
					<SessionProvider>
						<SettingsSync />
						{children}
					</SessionProvider>
				</QueryClientProvider>
			),
		});
		const unreachable = vi.fn(async () =>
		{
			throw new TypeError("Failed to fetch");
		});
		vi.stubGlobal("fetch", unreachable);
		setSessionToken(DEV_SIGN_IN_TOKEN);
		const offline = settings();
		await waitFor(() => expect(unreachable).toHaveBeenCalled());
		await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
		expect(offline.result.current.hideScores).toBe(true);
		offline.unmount();

		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
			error: "unauthorized",
		}, 401)));
		const refused = settings();
		await waitFor(() => expect(refused.result.current).toEqual(DEFAULT_SETTINGS));
	});

	it("keeps its copy through web/src/storage/ under bt.settings, which clearPersonalData removes", async () =>
	{
		stubAccountApi();
		await act(() => setFavoriteTeams([147]));
		expect(JSON.parse(readStored("bt.settings")!)).toMatchObject({
			state: {
				settings: {
					favoriteTeamIds: [147],
				},
			},
		});
		clearPersonalData();
		expect(readStored("bt.settings")).toBeNull();
	});

	it("#416: the chosen video quality is this browser's, under its own key: never in bt.settings or saved to the account, and kept on sign-out", async () =>
	{
		const { puts } = stubAccountApi();
		act(() => setVideoQuality("highBit"));
		const { result } = renderHook(() => useVideoQuality());
		expect(result.current).toBe("highBit");
		expect(readStored("bt.videoQuality")).toBe("highBit");
		await act(() => setFavoriteTeams([147]));
		expect(readStored("bt.settings")).not.toContain("highBit");
		expect(JSON.stringify(puts)).not.toContain("highBit");
		act(() =>
		{
			resetSettings();
			clearPersonalData();
		});
		expect(result.current).toBe("highBit");
		expect(readStored("bt.videoQuality")).toBe("highBit");
		act(() => setVideoQuality(null));
		expect(result.current).toBeNull();
		expect(readStored("bt.videoQuality")).toBeNull();
	});

	it("hydrateSettings replaces the store with the account's copy", async () =>
	{
		stubAccountApi({
			favoriteTeamIds: [111],
			opensFirst: "box",
			gameRowSlot: "status",
			collapseNonFavorites: false,
			hideScores: false,
			videoPlayer: "dialog" as const,
			statsProvider: "mlb" as const,
			version: 9,
		});
		await hydrateSettings("test-user");
		const { result } = renderHook(() => useSettings());
		expect(result.current.opensFirst).toBe("box");
	});
});

describe("settings follow the signed-in account (S120)", () =>
{
	const settingsOf = (favorite: number, version: number): AccountSettings => ({
		...DEFAULT_SETTINGS,
		favoriteTeamIds: [favorite],
		version,
	});
	const A = settingsOf(111, 7);
	const B = settingsOf(147, 2);

	/** A session signed in as `uid`, as `SessionProvider` would give it, without the provider. */
	function signedInAs(uid: string): Session
	{
		return {
			status: "signedIn",
			account: {
				...DEV_ACCOUNT,
				role: "member",
				entitlements: {
					...DEV_ACCOUNT.entitlements,
					tier: "none",
				},
				uid,
			},
			signIn: vi.fn(async () => false),
			finishSignIn: vi.fn(async () => "/"),
			signInOffer: "offered",
			keepSession: async () => undefined,
			signOut: vi.fn(),
		};
	}

	/**
	 * The settings API per bearer token: `bt-a` is account A, `bt-b` account B. `hold` keeps A's
	 * answers (reads and saves) waiting until `release()`, as a slow network would.
	 */
	function stubTwoAccounts(hold = false)
	{
		const docs: Record<string, AccountSettings> = {
			"Bearer bt-a": A,
			"Bearer bt-b": B,
		};
		const puts: { auth: string;
			body: AccountSettings; }[] = [];
		const held: (() => void)[] = [];
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			const auth = request.headers.get("Authorization") ?? "";
			const body = request.method === "PUT" ? await request.json() as AccountSettings : undefined;
			if (body) puts.push({
				auth,
				body,
			});
			const answer = () => jsonResponse(body && body.version > docs[auth]!.version ? docs[auth] = body : docs[auth]);
			if (hold && auth === "Bearer bt-a" && held.length < 10) return new Promise<Response>((resolve) => held.push(() => resolve(answer())));
			return answer();
		}));
		return {
			puts,
			release: () => held.splice(0).forEach((resolve) => resolve()),
			held: () => held.length,
		};
	}

	function renderSync(session: Session)
	{
		let current = session;
		const view = renderHook(() => useSettings(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<SessionContext.Provider value={current}>
					<SettingsSync />
					{children}
				</SessionContext.Provider>
			),
		});
		return {
			result: view.result,
			switchTo: (next: Session) =>
			{
				current = next;
				view.rerender();
			},
		};
	}

	it("S120 AC 2: a sign-in as another account (status stays signedIn) resets the store and reads the new account's settings; a change then saves to the new account only", async () =>
	{
		const api = stubTwoAccounts();
		setSessionToken("bt-a");
		const { result, switchTo } = renderSync(signedInAs("account-a"));
		await waitFor(() => expect(result.current).toEqual(A));

		setSessionToken("bt-b");
		switchTo(signedInAs("account-b"));
		// A's settings are gone at once, before B's arrive.
		expect(result.current.favoriteTeamIds).not.toContain(111);
		await waitFor(() => expect(result.current).toEqual(B));

		await act(() => setOpensFirst("box"));
		expect(api.puts).toHaveLength(1);
		expect(api.puts[0]!.auth).toBe("Bearer bt-b");
		expect(api.puts[0]!.body).toEqual({
			...B,
			opensFirst: "box",
			version: B.version + 1,
		});
	});

	it("S120 AC 2: a read or save answered for the previous account after the switch is discarded", async () =>
	{
		const api = stubTwoAccounts(true);
		setSessionToken("bt-a");
		const { result, switchTo } = renderSync(signedInAs("account-a"));
		// A's read is held; a change under A sends a save that is held too.
		await waitFor(() => expect(api.held()).toBe(1));
		void setFavoriteTeams([121]);
		await waitFor(() => expect(api.held()).toBe(2));

		setSessionToken("bt-b");
		switchTo(signedInAs("account-b"));
		await waitFor(() => expect(result.current).toEqual(B));

		// A's answers land now: neither replaces B's settings.
		await act(async () =>
		{
			api.release();
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(result.current).toEqual(B);
		expect(api.puts.map((p) => p.auth)).toEqual(["Bearer bt-a"]);
	});
});
