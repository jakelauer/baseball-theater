/**
 * S193 (Claude's review of PR #566): the change log modal's module is loaded on first opening, and that
 * load can fail (a flaky connection right after an update). A failed load must not take the app down:
 * the game page stays, the modal stays closed, and the next opening tries the load again.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { writeStored } from "../storage/storage.js";
import { stubMeApi } from "../test/meApi.js";
import {
	resetAfterUpdate, startAfterUpdate, useAfterUpdate,
} from "./afterUpdate.js";

const loads = vi.fn();

// The first load fails, as a dropped connection would; the next one arrives.
vi.mock("./ChangelogModal.js", () =>
{
	loads();
	if (loads.mock.calls.length === 1) throw new Error("Failed to fetch dynamically imported module");
	return {
		ChangelogModal: ({ opened }: { opened: boolean }) => (opened ? <div data-testid="changelog-modal">modal</div> : null),
	};
});

function Shell()
{
	const pointer = useAfterUpdate(false);
	return <AppShellLayout pointer={pointer}>{() => <p>game page</p>}</AppShellLayout>;
}

/** A load right after updating, so the game page's notice shows. */
function updatedLoad()
{
	resetAfterUpdate();
	writeStored("bt.lastRelease", "v3.9.0");
	act(() => startAfterUpdate("v3.10.0"));
}

async function tapNotice()
{
	fireEvent.click(within(screen.getByTestId("after-update-notice")).getByRole("button"));
	for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

afterEach(() =>
{
	cleanup();
	resetAfterUpdate();
	writeStored("bt.lastRelease", null);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("a failed load of the change log modal (S193, PR #566)", () =>
{
	it("S193 AC 2: the game page stays mounted, the modal stays closed, and the next opening retries the load", async () =>
	{
		vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		}));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		stubMeApi();
		updatedLoad();
		render(
			<MantineProvider>
				<QueryClientProvider client={createQueryClient()}>
					<SessionProvider>
						<MemoryRouter initialEntries={["/game/745525"]}>
							<Shell />
						</MemoryRouter>
					</SessionProvider>
				</QueryClientProvider>
			</MantineProvider>,
		);
		await tapNotice();
		expect(loads).toHaveBeenCalledTimes(1);
		expect(screen.getByText("game page")).toBeInTheDocument();
		expect(screen.queryByTestId("changelog-modal")).toBeNull();

		updatedLoad();
		await tapNotice();
		expect(loads).toHaveBeenCalledTimes(2);
		expect(await screen.findByTestId("changelog-modal")).toBeInTheDocument();
		expect(screen.getByText("game page")).toBeInTheDocument();
	});
});
