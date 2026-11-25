/**
 * Settings are signed-in only (ADR-027, S59): signed out, the nav item is
 * absent and `/settings` redirects to the scoreboard; signed in, both render.
 * Renders the real shell and routes with the session read from a stubbed API;
 * at the default (mobile) pairing the nav lives in the drawer, so the tests open it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "./api/queryClient.js";
import { AppShellLayout } from "./layout/AppShellLayout.js";
import { AppRoutes } from "./routes.js";
import { SessionProvider } from "./session/SessionProvider.js";
import { DEV_SIGN_IN_TOKEN } from "./session/session.js";
import { setSessionToken } from "./session/token.js";
import { jsonResponse } from "./test/jsonResponse.js";
import { stubMeApi } from "./test/meApi.js";

/** Shows the router's current path, to observe redirects. */
function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderApp(path: string)
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<AppShellLayout>
							{(variant, setFooter) => <AppRoutes variant={variant} setFooter={setFooter} />}
						</AppShellLayout>
						<CurrentPath />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

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

describe("Settings gating", () =>
{
	it("signed out: no Settings nav item, and /settings redirects to the scoreboard", async () =>
	{
		renderApp("/settings");
		// Signed out, /settings first asks the server whether the account was just deleted (S79, S87).
		// The scoreboard's default day stays unanswered here (S111), so the path rests on /games.
		await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games$/));
		await userEvent.click(screen.getByRole("button", {
			name: "Open navigation",
		}));
		expect(await screen.findByRole("link", {
			name: "Scoreboard",
		})).toBeInTheDocument();
		expect(screen.queryByRole("link", {
			name: "Settings",
		})).toBeNull();
	});

	it("signed in: the Settings nav item and /settings both render", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderApp("/settings");
		await userEvent.click(await screen.findByRole("button", {
			name: "Open navigation",
		}));
		expect(await screen.findByRole("link", {
			name: "Settings",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		// The settings page is its own chunk (S110), so its heading arrives once it loads.
		expect(await screen.findByRole("heading", {
			name: /settings/i,
		})).toBeInTheDocument();
	});
});

describe("default day (S111, #412)", () =>
{
	/** Answers the default day with 2026-10-28 and records the day each schedule request asks for. */
	function serveDefaultDay(): string[]
	{
		const me = stubMeApi();
		const scheduleDates: string[] = [];
		vi.stubGlobal("fetch", vi.fn((request: Request) =>
		{
			const url = new URL(request.url);
			if (url.pathname === "/api/v1/schedule") scheduleDates.push(url.searchParams.get("date")!);
			return url.pathname === "/api/v1/scoreboard/default-date"
				? Promise.resolve(jsonResponse({
					date: "2026-10-28",
				}))
				: me(request);
		}));
		return scheduleDates;
	}

	// The home page shows today but keeps its own URL, so search engines index one stable
	// address rather than a dated one that changes every day (#412).
	it.each(["/", "/games"])("%s shows the day the server names with no redirect (#412)", async (path) =>
	{
		const scheduleDates = serveDefaultDay();
		renderApp(path);
		await waitFor(() => expect(scheduleDates).toContain("2026-10-28"));
		expect(screen.getByLabelText("path")).toHaveTextContent(new RegExp(`^${path}$`));
	});

	it("a dated URL, today's included, shows that date (#412)", async () =>
	{
		const scheduleDates = serveDefaultDay();
		renderApp("/games/2026-10-28");
		await waitFor(() => expect(scheduleDates).toContain("2026-10-28"));
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/games\/2026-10-28$/);
	});
});

describe("home page title (#412)", () =>
{
	// The title is the page's static HTML, the same every day: "Baseball Theater — " and what the site is.
	it("is \"Baseball Theater — <what the site is>\", with a matching description meta (#412)", () =>
	{
		const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
		const doc = new DOMParser().parseFromString(html, "text/html");
		expect(doc.title).toMatch(/^Baseball Theater — \S/);
		expect(doc.querySelector("meta[name=description]")?.getAttribute("content")).toBeTruthy();
	});
});

describe("change log route (S134)", () =>
{
	it("S134 AC 3: signed out, /changelog stays there and draws the change log, its menu link current", async () =>
	{
		const me = stubMeApi();
		vi.stubGlobal("fetch", vi.fn((request: Request) => new URL(request.url).pathname === "/api/v1/releases"
			? Promise.resolve(jsonResponse({
				current: null,
				releases: [],
			}))
			: me(request)));
		renderApp("/changelog");
		// The page is its own chunk (S110), so its heading arrives once it loads.
		expect(await screen.findByRole("heading", {
			level: 1,
			name: "Changelog",
		})).toBeInTheDocument();
		expect(await screen.findByText("No release notes yet.")).toBeInTheDocument();
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/changelog$/);
		await userEvent.click(screen.getByRole("button", {
			name: "Open navigation",
		}));
		// The drawer's link, not the site footer's "Changelog" (S142), which is never marked current.
		expect(within(await screen.findByRole("dialog")).getByRole("link", {
			name: "Changelog",
		})).toHaveAttribute("aria-current", "page");
	});
});
