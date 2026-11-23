/**
 * S135 AC 3: the after-update pointer (shell-scoreboard A9, Figma `after-update-pointer` 651:13439)
 * through the real shell, wired as `App.tsx` wires it: `useUpdateNotice` raises A6's box,
 * `useAfterUpdate` the pointer, never both. Widths are set by answering `matchMedia` as a browser
 * that wide would, so the shell's `LayoutVariant` picks the rail or the drawer placement.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { markVersionUnsupported, resetVersionNotice } from "../api/versionNotice.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import type { Notice } from "../layout/NoticeSlot.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { readStored, writeStored } from "../storage/storage.js";
import { stubMeApi } from "../test/meApi.js";
import {
	POINTER_MS, checkAfterUpdate, resetAfterUpdate, startAfterUpdate, useAfterUpdate,
} from "./afterUpdate.js";
import {
	UPDATE_MESSAGE, announceUpdate, resetUpdates, useUpdateNotice,
} from "./updates.js";

const WIDTHS = {
	mobile: 390,
	medium: 768,
	desktop: 1280,
} as const;

/** Answers `(min-width: Nem)` as a viewport `width` px wide, and `prefers-reduced-motion` as `reduced` says. */
function viewport(width: number, reduced = false)
{
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
	{
		const min = /min-width:\s*([\d.]+)em/.exec(query);
		const matches = min ? width >= Number(min[1]) * 16 : query.includes("prefers-reduced-motion") ? reduced : false;
		return {
			matches,
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

/** The app's wiring (`App.tsx`): A6's box from `useUpdateNotice`, else a passed marker; the pointer never while the box is up. */
function Shell({ marker }: { marker: Notice | null })
{
	const update = useUpdateNotice();
	const pointer = useAfterUpdate(Boolean(update?.update));
	return (
		<AppShellLayout notice={update ?? marker} pointer={pointer}>
			{() => <p>page</p>}
		</AppShellLayout>
	);
}

function renderShell({
	width = WIDTHS.desktop, path = "/", marker = null, reduced = false,
}: {
	width?: number;
	path?: string;
	marker?: Notice | null;
	reduced?: boolean;
} = {})
{
	viewport(width, reduced);
	const fetchMock = stubMeApi();
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<Shell marker={marker} />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return fetchMock;
}

/** A load right after updating from v3.9.0 to v3.10.0 (`v3.10.0` is newer, by S131's ordering, not by text). */
function updatedLoad()
{
	writeStored("bt.lastRelease", "v3.9.0");
	startAfterUpdate("v3.10.0");
}

const pointer = () => screen.queryByTestId("after-update-pointer");
/** Lets the popover's 150ms fade-out finish, so a pointer that has ended is out of the document. */
function gone()
{
	act(() => vi.advanceTimersByTime(200));
	expect(pointer()).toBeNull();
}
const burger = () => screen.getByRole("button", {
	name: "Open navigation",
});
const releaseRequests = (fetchMock: ReturnType<typeof stubMeApi>) =>
	fetchMock.mock.calls.map(([request]) => new URL((request as Request).url).pathname).filter((p) => p.startsWith("/api/v1/releases"));

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
	resetVersionNotice();
	resetUpdates();
	writeStored("bt.lastRelease", null);
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("checkAfterUpdate: what a load records and whether it just updated (S135 AC 3)", () =>
{
	it("S135 AC 3: v3.9.0 recorded and v3.10.0 built: the pointer's release, and v3.10.0 recorded", () =>
	{
		writeStored("bt.lastRelease", "v3.9.0");
		expect(checkAfterUpdate("v3.10.0")).toBe("v3.10.0");
		expect(readStored("bt.lastRelease")).toBe("v3.10.0");
	});

	it("S135 AC 3: a first visit, the same release and an older one (a rollback) show nothing and record the build", () =>
	{
		expect(checkAfterUpdate("v3.2.0")).toBeNull();
		expect(readStored("bt.lastRelease")).toBe("v3.2.0");
		expect(checkAfterUpdate("v3.2.0")).toBeNull();
		expect(checkAfterUpdate("v3.1.9")).toBeNull();
		expect(readStored("bt.lastRelease")).toBe("v3.1.9");
	});

	it("S135 AC 3: a malformed recorded value counts as nothing recorded and is overwritten", () =>
	{
		writeStored("bt.lastRelease", "v3.2");
		expect(checkAfterUpdate("v3.3.0")).toBeNull();
		expect(readStored("bt.lastRelease")).toBe("v3.3.0");
	});

	it("S135 AC 3: a build with no known release records nothing and shows nothing", () =>
	{
		writeStored("bt.lastRelease", "v3.1.0");
		expect(checkAfterUpdate(null)).toBeNull();
		expect(readStored("bt.lastRelease")).toBe("v3.1.0");
	});

	it("S135 AC 3: storage that throws on read shows nothing and breaks nothing", () =>
	{
		// An older release is recorded, so only the throwing read keeps the pointer away (not a first visit).
		writeStored("bt.lastRelease", "v3.9.0");
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		expect(checkAfterUpdate("v3.10.0")).toBeNull();
	});

	it("S135 AC 3: storage that throws on both read and write shows nothing and breaks nothing", () =>
	{
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		expect(() => checkAfterUpdate("v3.10.0")).not.toThrow();
		expect(checkAfterUpdate("v3.10.0")).toBeNull();
	});

	it("S135 AC 3: storage that throws only on write still shows the pointer this load, and again on the next", () =>
	{
		writeStored("bt.lastRelease", "v3.9.0");
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("blocked");
		});
		expect(checkAfterUpdate("v3.10.0")).toBe("v3.10.0");
		expect(checkAfterUpdate("v3.10.0")).toBe("v3.10.0");
	});
});

describe("the after-update pointer in the shell (S135 AC 3)", () =>
{
	it("S135 AC 3: rail (desktop): aimed at the menu's change log link, which is highlighted; its words and link; no releases request; gone after 10 s", () =>
	{
		updatedLoad();
		const fetchMock = renderShell();
		const shown = pointer()!;
		expect(shown).toHaveAttribute("role", "status");
		expect(shown).toHaveTextContent("Update complete");
		expect(shown).toHaveTextContent("You're on v3.10.0. What changed is in the changelog.");
		expect(within(shown).getByRole("link", {
			name: "Open the changelog",
		})).toHaveAttribute("href", "/changelog");
		const link = screen.getByTestId("changelog-link");
		expect(link).toHaveAttribute("data-highlighted", "true");
		expect(link.getAttribute("aria-describedby")).toBe(shown.id);
		expect(screen.queryByRole("button", {
			name: "Open navigation",
		})).toBeNull();
		// No close control.
		expect(within(shown).queryByRole("button")).toBeNull();
		expect(screen.getByTestId("pointer-countdown")).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(POINTER_MS - 100));
		expect(pointer()).not.toBeNull();
		act(() => vi.advanceTimersByTime(100));
		gone();
		expect(link).not.toHaveAttribute("data-highlighted");
		expect(releaseRequests(fetchMock)).toEqual([]);
	});

	for (const variant of ["mobile", "medium"] as const)
	{
		it(`S135 AC 3: drawer (${variant}): aimed at the menu button, and opening the drawer ends it and highlights the drawer's link until it closes`, async () =>
		{
			updatedLoad();
			renderShell({
				width: WIDTHS[variant],
			});
			const shown = pointer()!;
			expect(shown).toHaveTextContent("You're on v3.10.0. What changed is in the changelog.");
			expect(burger().getAttribute("aria-describedby")).toBe(shown.id);
			fireEvent.click(burger());
			gone();
			const drawer = await screen.findByRole("dialog");
			expect(within(drawer).getByTestId("changelog-link")).toHaveAttribute("data-highlighted", "true");
			// Closed and opened again: the pointer is gone for this load, so the link is plain.
			fireEvent.click(burger());
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			fireEvent.click(burger());
			const again = await screen.findByRole("dialog");
			expect(within(again).getByTestId("changelog-link")).not.toHaveAttribute("data-highlighted");
			gone();
		});
	}

	it("S135 AC 3: a click on it ends it at once; hovered it keeps counting down (it never pauses)", () =>
	{
		updatedLoad();
		renderShell();
		fireEvent.mouseEnter(pointer()!);
		fireEvent.mouseOver(pointer()!);
		fireEvent.focus(pointer()!);
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
		cleanup();
		resetAfterUpdate();
		updatedLoad();
		renderShell();
		fireEvent.click(screen.getByText("Update complete"));
		gone();
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
	});

	it("S135 AC 3: following its link ends it", () =>
	{
		updatedLoad();
		renderShell();
		fireEvent.click(screen.getByRole("link", {
			name: "Open the changelog",
		}));
		gone();
		expect(screen.getByTestId("changelog-link")).toHaveAttribute("aria-current", "page");
	});

	it("S135 AC 3: on /changelog it reads 'What changed is on this page.' with no link, and the rail's link stays current, not highlighted", () =>
	{
		updatedLoad();
		renderShell({
			path: "/changelog",
		});
		const shown = pointer()!;
		expect(shown).toHaveTextContent("You're on v3.10.0. What changed is on this page.");
		expect(within(shown).queryByRole("link")).toBeNull();
		const link = screen.getByTestId("changelog-link");
		expect(link).toHaveAttribute("aria-current", "page");
		expect(link).not.toHaveAttribute("data-highlighted");
	});

	it("S135 AC 3: reduced motion: no countdown line, still gone at 10 s", () =>
	{
		updatedLoad();
		renderShell({
			reduced: true,
		});
		expect(pointer()).not.toBeNull();
		expect(screen.queryByTestId("pointer-countdown")).toBeNull();
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
	});

	it("S135 AC 3: A6 up at load, then Snooze: no pointer on that load", () =>
	{
		updatedLoad();
		announceUpdate(null);
		renderShell();
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
		gone();
		fireEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		gone();
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
	});

	it("S135 AC 3: A6 raised at load by markVersionUnsupported: the notice, not the pointer", () =>
	{
		updatedLoad();
		markVersionUnsupported();
		renderShell();
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
		gone();
		expect(screen.getByTestId("changelog-link")).not.toHaveAttribute("data-highlighted");
	});

	it("S135 AC 3: A6 arriving while the pointer shows ends it at once; after the pointer's time it is still gone", () =>
	{
		updatedLoad();
		renderShell();
		expect(pointer()).not.toBeNull();
		act(() => vi.advanceTimersByTime(3000));
		act(() => announceUpdate(null));
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
		gone();
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
		expect(screen.getByText(UPDATE_MESSAGE)).toBeInTheDocument();
	});

	it("S135 AC 3: A6 arriving while it shows, then Snooze and a further 10 s: the pointer never returns", () =>
	{
		updatedLoad();
		renderShell();
		act(() => announceUpdate(null));
		fireEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		expect(screen.queryByText(UPDATE_MESSAGE)).toBeNull();
		gone();
		act(() => vi.advanceTimersByTime(POINTER_MS));
		gone();
	});

	it("S135 AC 3: with a message-only marker in the slot the pointer shows over it, and asks /api/v1/releases nothing", () =>
	{
		updatedLoad();
		const fetchMock = renderShell({
			width: WIDTHS.mobile,
			marker: {
				id: "offline",
				message: "You're offline. Scores as of 7:42 PM — 18 min ago.",
			},
		});
		expect(within(screen.getByTestId("notice-slot")).getByText(/You're offline/)).toBeInTheDocument();
		expect(pointer()).toHaveTextContent("Update complete");
		expect(releaseRequests(fetchMock)).toEqual([]);
	});

	it("S135 AC 3: no update (first visit, or no known release): no pointer, and the rail's link plain", () =>
	{
		startAfterUpdate("v3.10.0");
		renderShell();
		gone();
		expect(screen.getByTestId("changelog-link")).not.toHaveAttribute("data-highlighted");
		cleanup();
		startAfterUpdate(null);
		renderShell();
		gone();
	});
});
