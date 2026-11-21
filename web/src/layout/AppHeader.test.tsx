import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { MOCK_SIGN_IN_CREDENTIAL } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import type { Session } from "../session/session.js";
import { DEV_SIGN_IN_TOKEN, SessionContext } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import type { SignInWay, SignInWayLoader } from "../session/signInWay.js";
import { getSessionToken, setSessionToken } from "../session/token.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { stubMeApi } from "../test/meApi.js";
import { AppHeader } from "./AppHeader.js";

beforeEach(() =>
{
	setSessionToken(null);
	stubMeApi();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

/** The header on `/games/2024-07-04`, under the real session provider (with `signInWay` standing in for the Worker's answer, if given). */
function renderHeader(wordmark = true, signInWay?: SignInWayLoader)
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider {...signInWay && {
					signInWay,
				}}>
					<MemoryRouter initialEntries={["/games/2024-07-04"]}>
						<AppHeader burger wordmark={wordmark} drawerOpened={false} onBurger={() => undefined} />
						<CurrentPath />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

describe("AppHeader Figma values (S83)", () =>
{
	it("Figma: signed out, 'Sign in' is 14px Light beside the account icon", async () =>
	{
		renderHeader();
		const signIn = await screen.findByText("Sign in");
		expect(signIn.style.fontSize).toMatch(/14px|calc\(0\.875rem/);
		expect(signIn.style.color).toBe("var(--bt-light)");
	});
});

describe("AppHeader wordmark (owner, 2026-11-12)", () =>
{
	it("the wordmark links home, to /", async () =>
	{
		renderHeader();
		const home = screen.getByRole("link", {
			name: "Baseball Theater home",
		});
		expect(home).toHaveAttribute("href", "/");
		await userEvent.click(home);
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/$/);
	});

	it("without `wordmark` (desktop, where the rail shows it) the header draws none", () =>
	{
		renderHeader(false);
		expect(screen.queryByRole("img", {
			name: "Baseball Theater",
		})).toBeNull();
	});
});

describe("AppHeader sign-in feedback (owner, 2026-11-12: \"clicking sign in gives no feedback\")", () =>
{
	/** A session whose `signIn` waits on the returned promise's resolvers, as Logto's SDK load and redirect do. */
	function renderWithSignIn(signIn: Session["signIn"])
	{
		const session: Session = {
			status: "signedOut",
			signIn,
			finishSignIn: () => Promise.resolve("/"),
			signInOffer: "offered",
			signOut: () => undefined,
		};
		render(
			<MantineProvider>
				<SessionContext.Provider value={session}>
					<MemoryRouter>
						<AppHeader burger wordmark drawerOpened={false} onBurger={() => undefined} />
					</MemoryRouter>
				</SessionContext.Provider>
			</MantineProvider>,
		);
	}

	it("pressing Sign in turns it into a disabled, busy \"Signing in…\" with a spinner while sign-in starts", async () =>
	{
		const signIn = vi.fn(() => new Promise<boolean>(() => undefined));
		renderWithSignIn(signIn);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		const pending = screen.getByRole("button", {
			name: "Signing in…",
		});
		expect(pending).toBeDisabled();
		expect(pending).toHaveAttribute("aria-busy", "true");
		expect(pending.querySelector(".mantine-Loader-root")).not.toBeNull();
		await userEvent.click(pending);
		expect(signIn).toHaveBeenCalledTimes(1);
	});

	it("a sign-in leaving for Logto keeps \"Signing in…\" until the page goes", async () =>
	{
		renderWithSignIn(async () => true);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		await Promise.resolve();
		expect(screen.getByRole("button", {
			name: "Signing in…",
		})).toBeDisabled();
	});

	it("a sign-in that ends without leaving the page (no Logto in this build, or the dev sign-in) puts the button back", async () =>
	{
		renderWithSignIn(async () => false);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});

	it("coming Back from Logto out of the back/forward cache puts the button back", async () =>
	{
		renderWithSignIn(() => new Promise<boolean>(() => undefined));
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(screen.getByRole("button", {
			name: "Signing in…",
		})).toBeDisabled();
		act(() =>
		{
			window.dispatchEvent(Object.assign(new Event("pageshow"), {
				persisted: true,
			}));
		});
		expect(screen.getByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});

	it("signed in while a sign-in was still pending, then signed out: a fresh, enabled \"Sign in\"", async () =>
	{
		const signIn = vi.fn(() => new Promise<boolean>(() => undefined));
		let setStatus: (status: "signedIn" | "signedOut") => void = () => undefined;
		function Host()
		{
			const [status, set] = useState<"signedIn" | "signedOut">("signedOut");
			setStatus = set;
			const session = (status === "signedIn" ? {
				status,
				account: {} as never,
				signIn,
				finishSignIn: () => Promise.resolve("/"),
				signInOffer: "offered",
				signOut: () => set("signedOut"),
			} : {
				status,
				signIn,
				finishSignIn: () => Promise.resolve("/"),
				signInOffer: "offered",
				signOut: () => undefined,
			}) satisfies Session;
			return (
				<SessionContext.Provider value={session}>
					<MemoryRouter>
						<AppHeader burger wordmark drawerOpened={false} onBurger={() => undefined} />
					</MemoryRouter>
				</SessionContext.Provider>
			);
		}
		render(
			<MantineProvider>
				<Host />
			</MantineProvider>,
		);
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		act(() => setStatus("signedIn"));
		await userEvent.click(screen.getByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Sign out",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
		expect(screen.queryByText("Signing in…")).toBeNull();
	});

	it("a sign-in that fails to start puts the button back", async () =>
	{
		renderWithSignIn(() => Promise.reject(new Error("Logto unreachable")));
		await userEvent.click(screen.getByRole("button", {
			name: "Sign in",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeEnabled();
	});
});

describe("AppHeader account menu (owner, 2026-11-12: \"Settings, Sign Out\")", () =>
{
	it("signed in, the account icon opens a menu with Settings and Sign out", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderHeader();
		await userEvent.click(await screen.findByRole("button", {
			name: "Account",
		}));
		const settings = await screen.findByRole("menuitem", {
			name: "Settings",
		});
		expect(settings).toHaveAttribute("href", "/settings");
		expect(screen.getByRole("menuitem", {
			name: "Sign out",
		})).toBeInTheDocument();
		await userEvent.click(settings);
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
	});

	it("Sign out in the menu ends the session: the header offers Sign in again", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderHeader();
		await userEvent.click(await screen.findByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Sign out",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeInTheDocument();
		await waitFor(() => expect(getSessionToken()).toBeNull());
	});
});

/** The Worker's sign-in and /me for the mock: only the mock credential trades for a session. */
function stubMockApi()
{
	const fetchMock = vi.fn(async (request: Request): Promise<Response> =>
	{
		const path = new URL(request.url).pathname;
		if (path === "/api/v1/sign-in" && request.method === "POST")
		{
			const { idToken } = await request.json() as { idToken: string };
			return idToken === MOCK_SIGN_IN_CREDENTIAL ? jsonResponse({
				token: "bt-mock-session",
			}) : jsonResponse({
				error: "sign_in_refused",
			}, 401);
		}
		if (path === "/api/v1/me") return request.headers.get("Authorization") === "Bearer bt-mock-session" ? jsonResponse({
			uid: "mock-uid",
			email: "tester@stage.baseball.theater",
			role: "member",
			entitlements: {},
		}) : jsonResponse({
			error: "unauthorized",
		}, 401);
		return new Promise<Response>(() => undefined);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("AppHeader on staging's mock sign-in (S143)", () =>
{
	it("S143 AC 5: Sign in hands the mock credential to POST /api/v1/sign-in, keeps the token and shows the account, on this page; Sign out returns to signed out", async () =>
	{
		const fetchMock = stubMockApi();
		const href = window.location.href;
		renderHeader(true, async () => ({
			kind: "mock",
		}));
		await userEvent.click(await screen.findByRole("button", {
			name: "Sign in",
		}));
		expect(await screen.findByRole("button", {
			name: "Account",
		})).toBeInTheDocument();
		expect(getSessionToken()).toBe("bt-mock-session");
		const posts = fetchMock.mock.calls.map(([request]) => request).filter((request) => request.method === "POST");
		expect(posts.map((request) => new URL(request.url).pathname)).toEqual(["/api/v1/sign-in"]);
		// No navigation: the app's route and the browser's address are where they were.
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games\/2024-07-04$/);
		expect(window.location.href).toBe(href);

		await userEvent.click(screen.getByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Sign out",
		}));
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeInTheDocument();
		expect(getSessionToken()).toBeNull();
		expect(window.location.href).toBe(href);
	});
});

describe("AppHeader where there is no sign-in (S143 AC 6)", () =>
{
	/** A loader the test answers by hand, counting how often it is asked. */
	function deferredWay()
	{
		let settle: { resolve: (way: SignInWay) => void;
			reject: (error: Error) => void; } | undefined;
		const loader = vi.fn(() => new Promise<SignInWay>((resolve, reject) =>
		{
			settle = {
				resolve,
				reject,
			};
		}));
		return {
			loader,
			answer: (way: SignInWay) => act(async () =>
			{
				settle!.resolve(way);
				await Promise.resolve();
			}),
			fail: () => act(async () =>
			{
				settle!.reject(new Error("503"));
				await Promise.resolve();
			}),
		};
	}

	it("S143 AC 6: each way in (Logto, the mock, a development build) shows Sign in, and the no-sign-in answer doesn't", async () =>
	{
		const ways: SignInWay[] = [{
			kind: "logto",
			client: async () => ({
				signIn: vi.fn(async () => undefined),
				finishSignIn: vi.fn(async () => ""),
				signOut: vi.fn(async () => undefined),
			}),
		}, {
			kind: "mock",
		}, {
			kind: "dev",
		}];
		for (const way of ways)
		{
			renderHeader(true, async () => way);
			expect(await screen.findByRole("button", {
				name: "Sign in",
			}), way.kind).toBeInTheDocument();
			cleanup();
		}
		// The real loader in a development build (this test run's) is the dev way, and shows it too.
		renderHeader();
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeInTheDocument();
		cleanup();

		const none = deferredWay();
		renderHeader(true, none.loader);
		await none.answer({
			kind: "none",
		});
		expect(screen.queryByText("Sign in")).toBeNull();
		expect(screen.queryByRole("button", {
			name: "Account",
		})).toBeNull();
		// Nothing else on the signed-out header changes.
		expect(screen.getByRole("link", {
			name: "Baseball Theater home",
		})).toBeInTheDocument();
		expect(screen.getByRole("button", {
			name: "Open navigation",
		})).toBeInTheDocument();
	});

	it("S143 AC 6: while the answer loads there is no Sign in, so a preview never flashes one", async () =>
	{
		const way = deferredWay();
		renderHeader(true, way.loader);
		await act(async () => await Promise.resolve());
		expect(way.loader).toHaveBeenCalledOnce();
		expect(screen.queryByText("Sign in")).toBeNull();
		await way.answer({
			kind: "mock",
		});
		expect(await screen.findByRole("button", {
			name: "Sign in",
		})).toBeInTheDocument();
	});

	it("S143 AC 6: when the question fails, Sign in shows, and a click asks again", async () =>
	{
		stubMockApi();
		const way = deferredWay();
		renderHeader(true, way.loader);
		await way.fail();
		await userEvent.click(await screen.findByRole("button", {
			name: "Sign in",
		}));
		expect(way.loader).toHaveBeenCalledTimes(2);
		await way.answer({
			kind: "mock",
		});
		expect(await screen.findByRole("button", {
			name: "Account",
		})).toBeInTheDocument();
	});

	it("S143 AC 6: when the question fails and the click's ask answers no sign-in, Sign in goes away", async () =>
	{
		stubMockApi();
		const way = deferredWay();
		renderHeader(true, way.loader);
		await way.fail();
		await userEvent.click(await screen.findByRole("button", {
			name: "Sign in",
		}));
		await way.answer({
			kind: "none",
		});
		await waitFor(() => expect(screen.queryByRole("button", {
			name: "Sign in",
		})).toBeNull());
		expect(way.loader).toHaveBeenCalledTimes(2);
	});
});
