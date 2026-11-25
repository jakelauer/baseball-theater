/**
 * S193: after updating on a game page at mobile and medium widths, A17's notice in place of S135's
 * pointer, and the change log it opens over the game page (shell-scoreboard A17). Through the real
 * shell, wired as `App.tsx` wires it (`useUpdateNotice` raises A6's box, `useAfterUpdate` the moment),
 * with widths set by answering `matchMedia` as a browser that wide would.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	Link, MemoryRouter, useLocation,
} from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { readStored, writeStored } from "../storage/storage.js";
import { jsonResponse } from "../test/jsonResponse.js";
import {
	POINTER_MS, resetAfterUpdate, startAfterUpdate, useAfterUpdate,
} from "./afterUpdate.js";
import {
	announceUpdate, resetUpdates, useUpdateNotice,
} from "./updates.js";

const WIDTHS = {
	mobile: 390,
	medium: 768,
	desktop: 1280,
} as const;

const RELEASE = {
	version: "v3.10.0",
	date: "2026-11-24",
	headline: [],
	items: [{
		kind: "feature",
		title: "Spring training standings",
		sentence: "Standings show spring training records, labeled, until opening day.",
	}],
	fixesAndPolish: null,
};

/** Answers `(min-width: Nem)` as a viewport `width` px wide, and `prefers-reduced-motion` as `reduced` says. */
function viewport(width: number, reduced = false)
{
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
	{
		const min = /min-width:\s*([\d.]+)em/.exec(query);
		return {
			matches: min ? width >= Number(min[1]) * 16 : query.includes("prefers-reduced-motion") && reduced,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		};
	});
}

/** `/api/v1/releases` answered as `releases` says (pending by default); every other path pending. */
function serve(releases: () => Response | Promise<Response> = () => new Promise<Response>(() => undefined))
{
	const fetchMock = vi.fn((request: Request): Promise<Response> =>
		new URL(request.url).pathname.startsWith("/api/v1/releases") ? Promise.resolve(releases()) : new Promise<Response>(() => undefined));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

/** The page under the shell: where it is, and links to move between a game page and the scoreboard. */
function Page()
{
	const { pathname } = useLocation();
	return (
		<>
			<p data-testid="where">{pathname}</p>
			<Link to="/">to scoreboard</Link>
			<Link to="/game/745525">to game</Link>
		</>
	);
}

function Shell()
{
	const update = useUpdateNotice();
	const pointer = useAfterUpdate(Boolean(update?.update));
	return (
		<AppShellLayout notice={update} pointer={pointer}>
			{() => <Page />}
		</AppShellLayout>
	);
}

function renderShell({
	width = WIDTHS.mobile, path = "/game/745525", reduced = false,
}: { width?: number;
	path?: string;
	reduced?: boolean; } = {})
{
	viewport(width, reduced);
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<Shell />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** A load right after updating from v3.9.0 to v3.10.0. */
function updatedLoad()
{
	writeStored("bt.lastRelease", "v3.9.0");
	startAfterUpdate("v3.10.0");
}

/** A later load of the same release: the module's state starts again, as a reload's would. */
function reload()
{
	cleanup();
	resetAfterUpdate();
	startAfterUpdate("v3.10.0");
}

const notice = () => screen.queryByTestId("after-update-notice");
const pointer = () => screen.queryByTestId("after-update-pointer");
const modal = () => screen.queryByTestId("changelog-modal");
const where = () => screen.getByTestId("where").textContent;
/** Lets a 150ms fade-out finish. */
const settle = () => act(() => vi.advanceTimersByTime(250));

/** Taps the notice and waits for the modal, whose module loads on first opening. */
async function openModal()
{
	fireEvent.click(within(screen.getByTestId("after-update-notice")).getByRole("button"));
	settle();
	await screen.findByTestId("changelog-modal");
}

beforeEach(() =>
{
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});

afterEach(() =>
{
	cleanup();
	resetAfterUpdate();
	resetUpdates();
	writeStored("bt.lastRelease", null);
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("the notice where the pointer can't aim (S193 AC 1)", () =>
{
	it("S193 AC 1: a game page at a phone width after an update shows the notice, in A9's words with the link, and not the pointer", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		const shown = screen.getByTestId("after-update-notice");
		expect(shown).toHaveTextContent("Update complete");
		expect(shown).toHaveTextContent("You're on v3.10.0. What changed is in the changelog.");
		expect(within(shown).getByRole("button", {
			name: /Open the changelog/,
		})).toBeInTheDocument();
		expect(within(shown).queryByRole("link")).toBeNull();
		expect(within(shown).getByTestId("pointer-countdown")).toBeInTheDocument();
		expect(pointer()).toBeNull();
		expect(shown.style.right).toBe("16px");
	});

	it("S193 AC 1: a game page at a tablet (medium) width shows the notice too, 24px from the edges", async () =>
	{
		serve();
		updatedLoad();
		renderShell({
			width: WIDTHS.medium,
		});
		expect(notice()?.style.right).toBe("24px");
		expect(pointer()).toBeNull();
	});

	it("S193 AC 1: a page with a menu button still shows S135's pointer, not the notice; a desktop game page keeps the rail's pointer", async () =>
	{
		serve();
		updatedLoad();
		renderShell({
			path: "/",
		});
		expect(pointer()).not.toBeNull();
		expect(notice()).toBeNull();
		cleanup();
		renderShell({
			width: WIDTHS.desktop,
		});
		expect(pointer()).not.toBeNull();
		expect(notice()).toBeNull();
	});

	it("S193 AC 1: it goes after its 10 seconds and doesn't come back on that load", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		act(() => vi.advanceTimersByTime(POINTER_MS - 100));
		expect(notice()).not.toBeNull();
		act(() => vi.advanceTimersByTime(100));
		settle();
		expect(notice()).toBeNull();
		expect(pointer()).toBeNull();
	});

	it("S193 AC 1: the update notice up suppresses both, and a notice already showing goes at once and doesn't come back", async () =>
	{
		serve();
		updatedLoad();
		announceUpdate(async () => undefined);
		renderShell();
		expect(screen.getByRole("button", {
			name: "Update Now",
		})).toBeInTheDocument();
		expect(notice()).toBeNull();
		expect(pointer()).toBeNull();
		cleanup();
		resetUpdates();
		resetAfterUpdate();
		updatedLoad();
		renderShell();
		expect(notice()).not.toBeNull();
		act(() => announceUpdate(async () => undefined));
		settle();
		expect(notice()).toBeNull();
		fireEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		settle();
		expect(notice()).toBeNull();
		expect(pointer()).toBeNull();
	});

	it("S193 AC 1: a change log modal the fan already opened stays open when the update notice comes up", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		expect(modal()).not.toBeNull();
		act(() => announceUpdate(async () => undefined));
		settle();
		expect(modal()).not.toBeNull();
		expect(screen.getByRole("button", {
			name: "Update Now",
		})).toBeInTheDocument();
	});

	it("S193 AC 1: leaving the game page while the notice shows runs the rest of its 10 seconds as the pointer; the release is recorded once", async () =>
	{
		serve();
		const write = vi.spyOn(Storage.prototype, "setItem");
		updatedLoad();
		const records = write.mock.calls.length;
		renderShell();
		act(() => vi.advanceTimersByTime(4000));
		expect(notice()).not.toBeNull();
		fireEvent.click(screen.getByRole("link", {
			name: "to scoreboard",
		}));
		settle();
		expect(where()).toBe("/");
		expect(notice()).toBeNull();
		expect(pointer()).not.toBeNull();
		// The time left carries over: 4s on the game page, 0.25s settling, then under 6s more.
		act(() => vi.advanceTimersByTime(5500));
		expect(pointer()).not.toBeNull();
		act(() => vi.advanceTimersByTime(300));
		settle();
		expect(pointer()).toBeNull();
		expect(write.mock.calls.length).toBe(records);
		expect(readStored("bt.lastRelease")).toBe("v3.10.0");
	});

	it("S193 AC 1: opening a game page while the pointer shows runs the rest as the notice, its countdown line starting from the time left", async () =>
	{
		serve();
		const write = vi.spyOn(Storage.prototype, "setItem");
		updatedLoad();
		const records = write.mock.calls.length;
		renderShell({
			path: "/",
		});
		act(() => vi.advanceTimersByTime(5000));
		expect(pointer()).not.toBeNull();
		fireEvent.click(screen.getByRole("link", {
			name: "to game",
		}));
		settle();
		expect(pointer()).toBeNull();
		const shown = screen.getByTestId("after-update-notice");
		// The line starts at about half and runs down over what's left, not over 10 seconds.
		const fill = within(shown).getByTestId("pointer-countdown").firstElementChild as HTMLElement;
		expect(fill.style.transition).toMatch(/^transform (4\d{3}|5000)ms linear$/);
		act(() => vi.advanceTimersByTime(4800));
		settle();
		expect(notice()).toBeNull();
		expect(write.mock.calls.length).toBe(records);
	});
});

describe("the change log over the game page (S193 AC 2)", () =>
{
	it("S193 AC 2: a tap on the notice opens the change log in a modal over the game page, with the /changelog page's content; the URL doesn't change", async () =>
	{
		const fetchMock = serve(() => jsonResponse({
			current: RELEASE,
			releases: [RELEASE],
		}));
		updatedLoad();
		renderShell();
		fireEvent.click(within(screen.getByTestId("after-update-notice")).getByText("Update complete"));
		settle();
		const open = await screen.findByTestId("changelog-modal");
		expect(within(open).getByRole("heading", {
			name: "Changelog",
			level: 1,
		})).toBeInTheDocument();
		expect(await within(open).findByText("Spring training standings")).toBeInTheDocument();
		expect(within(open).getByTestId("kind-label")).toHaveTextContent("Feature");
		expect(fetchMock.mock.calls.some(([request]) => new URL((request as Request).url).pathname === "/api/v1/releases")).toBe(true);
		expect(notice()).toBeNull();
		expect(where()).toBe("/game/745525");
	});

	it("S193 AC 2: its link 'Open the changelog' opens the modal, not the /changelog page", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		fireEvent.click(screen.getByRole("button", {
			name: /Open the changelog/,
		}));
		settle();
		expect(await screen.findByTestId("changelog-modal")).toBeInTheDocument();
		expect(where()).toBe("/game/745525");
	});

	it("S193 AC 2: the whole notice is one button, reached by Tab and pressed with Enter, its link part of it", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		const shown = screen.getByTestId("after-update-notice");
		const buttons = within(shown).getAllByRole("button");
		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toHaveAccessibleName(/Update complete.*Open the changelog/);
		const user = userEvent.setup({
			advanceTimers: (ms) => vi.advanceTimersByTime(ms),
		});
		// From the top of the document, Tab reaches it (it sits after the page and its footer).
		for (let i = 0; i < 40 && document.activeElement !== buttons[0]; i++) await user.tab();
		expect(buttons[0]).toHaveFocus();
		await user.keyboard("{Enter}");
		settle();
		expect(await screen.findByTestId("changelog-modal")).toBeInTheDocument();
	});

	it("S193 AC 2: closing it returns focus to the page's first control (the game top bar's back link), not the document", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		fireEvent.click(screen.getByRole("button", {
			name: "Close the change log",
		}));
		settle();
		await waitFor(() => expect(modal()).toBeNull());
		await waitFor(() => expect(screen.getByRole("link", {
			name: "to scoreboard",
		})).toHaveFocus());
	});

	it("S193 AC 2: on a tablet (medium) width it opens as the dialog", async () =>
	{
		serve();
		updatedLoad();
		renderShell({
			width: WIDTHS.medium,
		});
		await openModal();
		expect(screen.getByRole("button", {
			name: "Close the change log",
		})).toBeInTheDocument();
	});

	it("S193 AC 2: under reduced motion the notice draws no countdown line and the modal still opens, without its transition", async () =>
	{
		serve();
		updatedLoad();
		renderShell({
			reduced: true,
		});
		expect(within(screen.getByTestId("after-update-notice")).queryByTestId("pointer-countdown")).toBeNull();
		await openModal();
		expect(modal()).not.toBeNull();
	});

	it("S193 AC 2: its loading, empty and error (with Retry) states are the change log page's", async () =>
	{
		let answer: () => Response | Promise<Response> = () => new Promise<Response>(() => undefined);
		serve(() => answer());
		updatedLoad();
		renderShell();
		await openModal();
		expect(within(screen.getByTestId("changelog-modal")).getByRole("heading", {
			name: "Changelog",
		})).toBeInTheDocument();
		cleanup();
		answer = () => jsonResponse({
			current: null,
			releases: [],
		});
		resetAfterUpdate();
		updatedLoad();
		renderShell();
		await openModal();
		expect(await within(screen.getByTestId("changelog-modal")).findByText("No release notes yet.")).toBeInTheDocument();
		cleanup();
		answer = () => jsonResponse({
			error: "boom",
		}, 500);
		resetAfterUpdate();
		updatedLoad();
		renderShell();
		await openModal();
		expect(await within(screen.getByTestId("changelog-modal")).findByText("Couldn't load the change log", {}, {
			timeout: 10_000,
		})).toBeInTheDocument();
		expect(within(screen.getByTestId("changelog-modal")).getByRole("button", {
			name: /Retry/,
		})).toBeInTheDocument();
	});

	it("S193 AC 2: the ✕ close button closes it and returns to the game page", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		fireEvent.click(screen.getByRole("button", {
			name: "Close the change log",
		}));
		await waitFor(() => expect(modal()).toBeNull());
		expect(where()).toBe("/game/745525");
	});

	it("S193 AC 2: a tap on the scrim outside the card closes it", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		const overlay = document.querySelector(".mantine-Modal-overlay");
		expect(overlay).not.toBeNull();
		fireEvent.click(overlay as Element);
		await waitFor(() => expect(modal()).toBeNull());
	});

	it("S193 AC 2: Escape closes it", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		fireEvent.keyDown(screen.getByTestId("changelog-modal"), {
			key: "Escape",
		});
		await waitFor(() => expect(modal()).toBeNull());
	});

	it("S193 AC 2: the phone's Back closes it and stays on the game page, and closing it otherwise leaves no extra entry for Back", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		expect(window.history.state).toMatchObject({
			btChangelogModal: true,
		});
		act(() => window.history.back());
		await waitFor(() => expect(modal()).toBeNull());
		expect(where()).toBe("/game/745525");
		expect(window.history.state?.btChangelogModal).toBeUndefined();
		// Closed by its ✕, the entry it added is popped too.
		cleanup();
		resetAfterUpdate();
		updatedLoad();
		renderShell();
		await openModal();
		fireEvent.click(screen.getByRole("button", {
			name: "Close the change log",
		}));
		await waitFor(() => expect(window.history.state?.btChangelogModal).toBeUndefined());
	});
});

describe("counts as seen (S193 AC 3)", () =>
{
	it("S193 AC 3: a reload after the notice shows neither the notice nor the pointer", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		expect(notice()).not.toBeNull();
		reload();
		renderShell();
		expect(notice()).toBeNull();
		expect(pointer()).toBeNull();
		cleanup();
		renderShell({
			path: "/",
		});
		expect(pointer()).toBeNull();
	});

	it("S193 AC 3: a reload after the modal was opened shows neither", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		await openModal();
		reload();
		renderShell();
		expect(notice()).toBeNull();
		expect(pointer()).toBeNull();
	});

	it("S193 AC 3: a reload after a hand-over between the notice and the pointer shows neither", async () =>
	{
		serve();
		updatedLoad();
		renderShell();
		fireEvent.click(screen.getByRole("link", {
			name: "to scoreboard",
		}));
		settle();
		expect(pointer()).not.toBeNull();
		reload();
		renderShell({
			path: "/",
		});
		expect(pointer()).toBeNull();
		cleanup();
		renderShell();
		expect(notice()).toBeNull();
	});
});
