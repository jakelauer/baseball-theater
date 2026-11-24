/**
 * The site footer in the real shell and routes (S142; shell-scoreboard A14): the shell draws it
 * after `<main>` on every page (`contentinfo`, so never inside `<main>`), not on the
 * account-deleted Settings page and not in the nav drawer; the game page's open socket reaches it
 * through the render prop's setter and is cleared when the page goes. `serveApp` answers every
 * page's requests from the fixtures, since the footer waits for a page to settle (no footer under
 * a loading state, which would jump as the content arrives: CI's Lighthouse CLS budget).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider, Modal } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, useLocation, useNavigate,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppRoutes } from "../routes.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { stubMeApi } from "../test/meApi.js";
import { AppShellLayout } from "./AppShellLayout.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

/** `fixtures/game-823823-live.json` as BT serves it in its window, so the game page opens its socket. */
function liveGame(): unknown
{
	return {
		...JSON.parse(readFileSync(join(FIXTURES, "game-823823-live.json"), "utf8")),
		highlights: [],
		fetchedAt: "2026-09-05T20:57:20.000Z",
		windowMode: "active",
		version: 1,
	};
}

/** A fixture file, parsed. */
function read(name: string): Record<string, unknown>
{
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

const SERVED = {
	fetchedAt: "2026-09-05T20:57:20.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T20:57:20.000Z",
};

/**
 * Answers the API the way each page needs to settle: the session (`stubMeApi`), 2026-09-05's
 * schedule with an empty digest, games 744834 (final) and 823823 (live, in its window),
 * Standings, and an empty change log. Anything else stays pending.
 */
function serveApp(): void
{
	const me = stubMeApi();
	vi.stubGlobal("fetch", vi.fn((request: Request) =>
	{
		const path = new URL(request.url).pathname;
		if (path === "/api/v1/schedule") return Promise.resolve(jsonResponse({
			...read("schedule-2026-09-05.json"),
			...SERVED,
		}));
		if (path === "/api/v1/digest") return Promise.resolve(jsonResponse({
			date: "2026-09-05",
			items: [],
			windowMode: "cache",
		}));
		if (path === "/api/v1/games/744834") return Promise.resolve(jsonResponse({
			...read("game-744834.json"),
			...SERVED,
		}));
		if (path === "/api/v1/games/823823") return Promise.resolve(jsonResponse(liveGame()));
		if (path === "/api/v1/standings") return Promise.resolve(jsonResponse(read("standings-2026-09-05.json")));
		if (path === "/api/v1/releases") return Promise.resolve(jsonResponse({
			current: null,
			releases: [],
		}));
		return me(request);
	}));
}

/** The browser WebSocket, stood in: the test opens it by hand. */
class FakeWebSocket
{
	static opened: FakeWebSocket[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	readonly close = vi.fn();

	constructor(readonly url: string)
	{
		FakeWebSocket.opened.push(this);
	}
}

/** Shows the router's path, and lets a test move it as a link would. */
function Path()
{
	const navigate = useNavigate();
	return (
		<>
			<output aria-label="path">{useLocation().pathname}</output>
			<button type="button" onClick={() => void navigate("/standings")}>to standings</button>
		</>
	);
}

function renderApp(path: string)
{
	return render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<AppShellLayout>
							{(variant, setFooter) => <AppRoutes variant={variant} setFooter={setFooter} />}
						</AppShellLayout>
						<Path />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** The footer, after `<main>` and outside it, as the page's `contentinfo`. */
async function footer(): Promise<HTMLElement>
{
	const found = await screen.findByRole("contentinfo");
	const main = screen.getByRole("main");
	expect(main).not.toContainElement(found);
	expect(main.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	expect(within(found).getByText(/^© \d{4} Baseball Theater$/)).toBeInTheDocument();
	return found;
}

beforeEach(() =>
{
	setSessionToken(null);
	serveApp();
	FakeWebSocket.opened = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("the shell's site footer (S142)", () =>
{
	it("S142 AC 1 scoreboard: the footer follows <main>, with no strip (the scoreboard opens no socket yet)", async () =>
	{
		renderApp("/games/2026-09-05");
		const found = await footer();
		expect(within(found).queryByTestId("footer-live-strip")).toBeNull();
		expect(found).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});

	it("S142 AC 1 game page: the footer follows <main> on a game page", async () =>
	{
		renderApp("/game/744834/box");
		await footer();
	});

	it("S142 AC 1 Standings: the footer follows <main>, with no strip", async () =>
	{
		renderApp("/standings");
		const found = await footer();
		expect(within(found).queryByTestId("footer-live-strip")).toBeNull();
	});

	it("S142 AC 1 Search: the footer follows <main>", async () =>
	{
		renderApp("/search");
		await footer();
	});

	it("S142 AC 1 Settings: signed in, the footer follows <main> on Settings", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderApp("/settings");
		expect(await screen.findByRole("heading", {
			name: /settings/i,
		})).toBeInTheDocument();
		await footer();
	});

	it("S142 AC 1 change log: the footer follows <main> on the change log page", async () =>
	{
		renderApp("/changelog");
		await footer();
	});

	for (const [page, heading] of [["about", "About"], ["privacy", "Privacy policy"], ["terms", "Terms of use"]] as const)
	{
		it(`S154 AC 1 ${page}: /${page} renders its page's heading, with the site footer after <main>`, async () =>
		{
			renderApp(`/${page}`);
			expect(await screen.findByRole("heading", {
				level: 1,
				name: heading,
			})).toBeInTheDocument();
			expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", {
				level: 1,
			}));
			await footer();
			expect(screen.getByLabelText("path")).toHaveTextContent(new RegExp(`^/${page}$`));
		});
	}

	it("S142 AC 1 loading: no footer while a page loads, so it never jumps; it appears under the page once it settles", async () =>
	{
		let answer: (response: Response) => void = () => undefined;
		const me = stubMeApi();
		vi.stubGlobal("fetch", vi.fn((request: Request) => new URL(request.url).pathname === "/api/v1/releases"
			? new Promise<Response>((resolve) =>
			{
				answer = resolve;
			})
			: me(request)));
		renderApp("/changelog");
		expect(await screen.findByRole("heading", {
			level: 1,
			name: "Change log",
		})).toBeInTheDocument();
		expect(screen.queryByRole("contentinfo")).toBeNull();
		await act(async () => answer(jsonResponse({
			current: null,
			releases: [],
		})));
		expect(await screen.findByText("No release notes yet.")).toBeInTheDocument();
		await footer();
	});

	it("S142 AC 1 deleted page: the account-deleted Settings page has no footer (A5)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => new URL(request.url).pathname === "/api/v1/me"
			? jsonResponse({
				error: "account_deleted",
			}, 401)
			: new Promise<Response>(() => undefined)));
		renderApp("/settings");
		expect(await screen.findByText("Your account and your data are deleted.")).toBeInTheDocument();
		expect(screen.queryByRole("contentinfo")).toBeNull();
	});

	it("S142 AC 1 deleted page, while asked: signed out on /settings, no footer while the server is asked whether the account was deleted", async () =>
	{
		let asked = 0;
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			const path = new URL(request.url).pathname;
			if (path !== "/api/v1/me") return new Promise<Response>(() => undefined);
			// Signed out (no token), the one `/api/v1/me` is the deleted-account question: held unanswered.
			asked++;
			return new Promise<Response>(() => undefined);
		}));
		renderApp("/settings");
		await waitFor(() => expect(asked).toBeGreaterThan(0));
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		expect(screen.queryByRole("contentinfo")).toBeNull();
	});

	it("S142 AC 1 dialog: a dialog opened over a page holds no footer and none of its links", async () =>
	{
		const { rerender } = renderApp("/standings");
		await footer();
		rerender(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<SessionProvider>
						<MemoryRouter initialEntries={["/standings"]}>
							<AppShellLayout>
								{(variant, setFooter) => (
									<>
										<AppRoutes variant={variant} setFooter={setFooter} />
										<Modal opened onClose={() => undefined} title="A dialog">
											<p>Inside the dialog</p>
										</Modal>
									</>
								)}
							</AppShellLayout>
						</MemoryRouter>
					</SessionProvider>
				</QueryClientProvider>
			</MantineProvider>,
		);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Inside the dialog")).toBeInTheDocument();
		expect(within(dialog).queryByRole("contentinfo")).toBeNull();
		expect(within(dialog).queryByRole("link")).toBeNull();
		// The page's own footer is still the shell's, outside the dialog.
		expect(dialog).not.toContainElement(screen.getByRole("contentinfo"));
	});

	it("S142 AC 1 drawer: the open nav drawer holds no footer and none of its links", async () =>
	{
		renderApp("/standings");
		await footer();
		await userEvent.click(screen.getByRole("button", {
			name: "Open navigation",
		}));
		const drawer = await screen.findByRole("dialog");
		expect(within(drawer).queryByRole("contentinfo")).toBeNull();
		expect(within(drawer).queryByRole("link", {
			name: "Support & Community",
		})).toBeNull();
		expect(drawer.querySelector('a[href="https://www.reddit.com/r/BaseballTheater/"]')).toBeNull();
		// The drawer's own way to the change log is the menu's link (S134; A9), not the footer's.
		for (const link of drawer.querySelectorAll('a[href="/changelog"]'))
		{
			expect(link).toHaveAttribute("data-testid", "changelog-link");
		}
	});

	it("S142 AC 1 state channel: a live game page with its socket open shows the strip; on to Standings it goes", async () =>
	{
		renderApp("/game/823823/live");
		await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		expect(screen.queryByTestId("footer-live-strip")).toBeNull();
		await act(async () => FakeWebSocket.opened[0]!.onopen?.({}));
		const found = await footer();
		expect(found.firstElementChild).toBe(screen.getByTestId("footer-live-strip"));
		await userEvent.click(screen.getByRole("button", {
			name: "to standings",
		}));
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/standings$/));
		expect(screen.queryByTestId("footer-live-strip")).toBeNull();
		expect(screen.getByRole("contentinfo")).toBeInTheDocument();
	});

	it("S142 AC 2: the Live marker shows on a live game page with its socket open, and not once it closes", async () =>
	{
		renderApp("/game/823823/live");
		await waitFor(() => expect(FakeWebSocket.opened).toHaveLength(1));
		await act(async () => FakeWebSocket.opened[0]!.onopen?.({}));
		expect(within(await footer()).getByText("Live Data · Active")).toBeInTheDocument();
		await act(async () => FakeWebSocket.opened[0]!.onclose?.({}));
		expect(screen.queryByText("Live Data · Active")).toBeNull();
		expect(screen.getByRole("contentinfo")).toBeInTheDocument();
	});

	it("S142 AC 3: each BT link opens a page a route serves, not a catch-all", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		serveApp();
		renderApp("/standings");
		await userEvent.click(within(await footer()).getByRole("link", {
			name: "Changelog",
		}));
		expect(await screen.findByRole("heading", {
			level: 1,
			name: "Change log",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/changelog$/);
		await userEvent.click(within(await footer()).getByRole("link", {
			name: "Your data",
		}));
		expect(await screen.findByRole("heading", {
			name: /settings/i,
		})).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
	});

	it("S154 AC 4: About, Privacy policy and Terms of use each open their own page", async () =>
	{
		renderApp("/standings");
		for (const [name, path, heading] of [["About", "/about", "About"], ["Privacy policy", "/privacy", "Privacy policy"], ["Terms of use", "/terms", "Terms of use"]] as const)
		{
			await userEvent.click(within(await footer()).getByRole("link", {
				name,
			}));
			expect(await screen.findByRole("heading", {
				level: 1,
				name: heading,
			})).toBeInTheDocument();
			expect(screen.getByLabelText("path")).toHaveTextContent(new RegExp(`^${path}$`));
		}
	});
});
