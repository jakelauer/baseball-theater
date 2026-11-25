/**
 * S193: the change log modal, and the change log page inside it, stay out of the entry chunk: the shell
 * loads `ChangelogModal.js` only when the game page's notice first opens it, as `routes.tsx` keeps the
 * page out (S110). The module's import is held back by a gate, so nothing of it is there until it lands.
 */
import { MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { AppShellLayout } from "../layout/AppShellLayout.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { stubMeApi } from "../test/meApi.js";
import { writeStored } from "../storage/storage.js";
import {
	resetAfterUpdate, startAfterUpdate, useAfterUpdate,
} from "./afterUpdate.js";

let arrive: () => void = () => undefined;
const arrived = new Promise<void>((resolve) =>
{
	arrive = resolve;
});
const loaded = vi.fn();

vi.mock("./ChangelogModal.js", async () =>
{
	await arrived;
	loaded();
	return {
		ChangelogModal: ({ opened }: { opened: boolean }) => (opened ? <div data-testid="changelog-modal">modal</div> : null),
	};
});

function Shell()
{
	const pointer = useAfterUpdate(false);
	return <AppShellLayout pointer={pointer}>{() => <p>page</p>}</AppShellLayout>;
}

afterEach(() =>
{
	cleanup();
	resetAfterUpdate();
	writeStored("bt.lastRelease", null);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("the change log modal loads on demand (S193 AC 2)", () =>
{
	it("S193 AC 2: the modal's module is not loaded with the shell, only once the notice opens it", async () =>
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
		writeStored("bt.lastRelease", "v3.9.0");
		startAfterUpdate("v3.10.0");
		stubMeApi();
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
		await act(async () => Promise.resolve());
		expect(loaded).not.toHaveBeenCalled();
		fireEvent.click(within(screen.getByTestId("after-update-notice")).getByRole("button"));
		expect(screen.queryByTestId("changelog-modal")).toBeNull();
		arrive();
		expect(await screen.findByTestId("changelog-modal")).toBeInTheDocument();
		expect(loaded).toHaveBeenCalledTimes(1);
	});
});
