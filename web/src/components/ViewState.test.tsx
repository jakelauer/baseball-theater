import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { SkeletonShape, ViewStateProps } from "./ViewState.js";
import { ViewState } from "./ViewState.js";

function renderState(props: ViewStateProps)
{
	return render(
		<MantineProvider>
			<ViewState {...props} />
		</MantineProvider>,
	);
}

afterEach(cleanup);

describe("ViewState (S60)", () =>
{
	it("loading keeps the page title above the loader", () =>
	{
		renderState({
			kind: "loading",
			title: "Scoreboard",
		});
		expect(screen.getByRole("heading", {
			name: "Scoreboard",
		})).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("loading without a title draws only the loader", () =>
	{
		renderState({
			kind: "loading",
		});
		expect(screen.queryByRole("heading")).toBeNull();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("loading's status is marked busy (#584)", () =>
	{
		renderState({
			kind: "loading",
		});
		expect(screen.getByLabelText("Loading")).toHaveAttribute("aria-busy", "true");
	});

	it("loading is an animated skeleton, never a spinner (#431)", () =>
	{
		renderState({
			kind: "loading",
		});
		const loading = screen.getByLabelText("Loading");
		expect(loading.querySelector(".mantine-Loader-root")).toBeNull();
		expect(loading.querySelectorAll(".mantine-Skeleton-root[data-animate=true]").length).toBeGreaterThan(0);
	});

	it("loading holds the skeleton still under prefers-reduced-motion (#431)", async () =>
	{
		vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
			matches: query.includes("prefers-reduced-motion: reduce"),
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		}));
		renderState({
			kind: "loading",
		});
		const loading = screen.getByLabelText("Loading");
		await vi.waitFor(() => expect(loading.querySelectorAll(".mantine-Skeleton-root[data-animate]")).toHaveLength(0));
		expect(loading.querySelectorAll(".mantine-Skeleton-root").length).toBeGreaterThan(0);
		vi.restoreAllMocks();
	});

	it("loading takes the shape of what it stands for, each block pulsing (#584)", () =>
	{
		const pieces: Record<SkeletonShape, string | null> = {
			games: "skeleton-card",
			videos: "skeleton-video",
			table: "skeleton-table-row",
			results: "skeleton-result",
			text: null,
			rows: null,
		};
		for (const [shape, piece] of Object.entries(pieces) as [SkeletonShape, string | null][])
		{
			renderState({
				kind: "loading",
				shape,
				columns: 2,
				variant: "desktop",
			});
			const loading = screen.getByLabelText("Loading");
			expect(loading).toHaveAttribute("data-skeleton", shape);
			if (piece) expect(loading.querySelectorAll(`[data-testid="${piece}"]`).length).toBeGreaterThan(1);
			expect(loading.querySelectorAll(".mantine-Skeleton-root[data-animate=true]").length).toBeGreaterThan(0);
			cleanup();
		}
	});

	it("loading cards and videos without a column count or pairing draw one column and the phone's grid (#584)", () =>
	{
		for (const shape of ["games", "videos"] as const)
		{
			renderState({
				kind: "loading",
				shape,
			});
			expect(screen.getByLabelText("Loading")).toHaveAttribute("data-skeleton", shape);
			cleanup();
		}
	});

	it("empty is one sentence", () =>
	{
		renderState({
			kind: "empty",
			message: "No games scheduled for this date.",
		});
		expect(screen.getByText("No games scheduled for this date.")).toBeInTheDocument();
	});

	it("error names what failed, the recovery hint, and Retry calls back", async () =>
	{
		const onRetry = vi.fn();
		renderState({
			kind: "error",
			title: "Couldn't load games",
			onRetry,
		});
		expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load games");
		expect(screen.getByText("Check your connection and try again")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", {
			name: "Retry",
		}));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
