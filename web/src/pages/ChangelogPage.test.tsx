/**
 * S134: the change log page (shell-scoreboard A9 `changelog-*`) on three releases as A9 draws them,
 * served as `GET /api/v1/releases` would: v3.2.0 with every bucket (here two headline additions, so
 * two Major Feature headers), one item of each kind and a fixes line; v3.1.1 with no date and only a
 * fixes line; v3.1.0 with no headline addition and no fixes line. Then its empty, loading and error
 * states, the title kept above each.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { ReleasesPayload } from "../api/releases.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { ChangelogPage } from "./ChangelogPage.js";

const V320: ReleasesPayload["releases"][number] = {
	version: "v3.2.0",
	date: "2026-11-24",
	headline: [
		{
			title: "Pick any day from a calendar",
			sentence: "Jump to any date since 1901, with each day's game count shown under it.",
		},
		{
			title: "Win probability on every game",
			sentence: "Each game row can show who is likely to win.",
		},
	],
	items: [
		{
			kind: "feature",
			title: "Spring training standings",
			sentence: "Standings show spring training records, labeled, until opening day.",
		},
		{
			kind: "enhancement",
			title: "Choose what the game row shows",
			sentence: "Pick pitchers, the count or win probability for the slot on each game.",
		},
		{
			kind: "performance",
			title: "Faster scoreboard loading",
			sentence: "The scoreboard opens about twice as fast on a slow connection.",
		},
		{
			kind: "fix",
			title: "Scores stay hidden after a reload",
			sentence: "Hide Scores now holds when the app reopens offline.",
		},
	],
	fixesAndPolish: "Smaller fixes to the scoreboard, game pages and sign-in.",
};
const V311: ReleasesPayload["releases"][number] = {
	version: "v3.1.1",
	headline: [],
	items: [],
	fixesAndPolish: "Faster loading on slow connections, and smaller fixes to video playback.",
};
const V310: ReleasesPayload["releases"][number] = {
	version: "v3.1.0",
	date: "2026-11-10",
	headline: [],
	items: [
		{
			kind: "enhancement",
			title: "A calmer update notice",
			sentence: "The update notice floats at the bottom with Snooze and Update Now.",
		},
		{
			kind: "fix",
			title: "Videos resume where you left off",
			sentence: "Closing and reopening a highlight no longer restarts it.",
		},
	],
};
const RELEASES: ReleasesPayload = {
	current: V320,
	releases: [V320, V311, V310],
};

function renderChangelog()
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/changelog"]}>
					<ChangelogPage />
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

function serve(response: () => Response)
{
	const fetchMock = vi.fn((_request: Request) => Promise.resolve(response()));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const title = () => screen.getByRole("heading", {
	level: 1,
	name: "Changelog",
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("ChangelogPage (S134 AC 1)", () =>
{
	it("S134 AC 1: every release newest first from GET /api/v1/releases, under the title 'Changelog', each with its version and formatDate'd date", async () =>
	{
		const fetchMock = serve(() => jsonResponse(RELEASES));
		renderChangelog();
		const releases = await screen.findAllByTestId("release");
		expect(title()).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(new URL(fetchMock.mock.calls[0]![0].url).pathname).toBe("/api/v1/releases");
		expect(releases.map((r) => within(r).getByRole("heading", {
			level: 2,
		}).textContent)).toEqual(["v3.2.0", "v3.1.1", "v3.1.0"]);
		expect(within(releases[0]!).getByTestId("release-date")).toHaveTextContent(/^Nov 24, 2026$/);
		expect(within(releases[2]!).getByTestId("release-date")).toHaveTextContent(/^Nov 10, 2026$/);
		// A release with no date shows its version alone.
		expect(within(releases[1]!).queryByTestId("release-date")).toBeNull();
		// No "Fetched … ago" line (owner, 2026-11-10).
		expect(screen.queryByText(/Fetched/)).toBeNull();
	});

	it("S134 AC 1: each headline addition under its own gold 'Major Feature' header, then its title and sentence", async () =>
	{
		serve(() => jsonResponse(RELEASES));
		renderChangelog();
		const [v320, v311, v310] = await screen.findAllByTestId("release");
		const majors = within(v320!).getAllByTestId("major-feature");
		expect(majors).toHaveLength(2);
		majors.forEach((major, i) =>
		{
			const header = within(major).getByText("Major Feature");
			expect(header.style.color).toBe("var(--bt-accent)");
			expect(within(major).getByRole("heading", {
				level: 3,
			})).toHaveTextContent(V320.headline[i]!.title);
			expect(within(major).getByText(V320.headline[i]!.sentence)).toBeInTheDocument();
		});
		expect(within(v311!).queryByText("Major Feature")).toBeNull();
		expect(within(v310!).queryByText("Major Feature")).toBeNull();
	});

	it("S134 AC 1: items labeled FEATURE, ENHANCEMENT, PERFORMANCE and BUG FIX for feature, enhancement, performance and fix, every label in one neutral style", async () =>
	{
		serve(() => jsonResponse(RELEASES));
		renderChangelog();
		const [v320, v311, v310] = await screen.findAllByTestId("release");
		const items = within(v320!).getAllByTestId("release-item");
		expect(items.map((item) => within(item).getByTestId("kind-label").textContent)).toEqual(["Feature", "Enhancement", "Performance", "Bug fix"]);
		expect(items.map((item) => within(item).getByTestId("kind-label").dataset.kind)).toEqual(["feature", "enhancement", "performance", "fix"]);
		items.forEach((item, i) =>
		{
			expect(within(item).getByRole("heading", {
				level: 3,
			})).toHaveTextContent(V320.items[i]!.title);
			expect(within(item).getByText(V320.items[i]!.sentence)).toBeInTheDocument();
		});
		const labels = screen.getAllByTestId("kind-label");
		expect(labels).toHaveLength(6);
		for (const label of labels)
		{
			// Uppercase is the label's style (A9: SemiBold 11 uppercase on Raised current), one for every kind.
			expect(label.style.background).toBe("var(--bt-raised-current)");
			expect(label.style.color).toBe("var(--bt-light)");
			expect(label.style.textTransform).toBe("uppercase");
			expect(label.className).toBe(labels[0]!.className);
			expect(label.getAttribute("style")).toBe(labels[0]!.getAttribute("style"));
		}
		expect(within(v311!).queryAllByTestId("release-item")).toHaveLength(0);
		expect(within(v310!).getAllByTestId("kind-label").map((l) => l.textContent)).toEqual(["Enhancement", "Bug fix"]);
	});

	it("S134 AC 1: the 'Fixes and polish' line when a release has one, and none when it hasn't", async () =>
	{
		serve(() => jsonResponse(RELEASES));
		renderChangelog();
		const [v320, v311, v310] = await screen.findAllByTestId("release");
		const fixes = within(v320!).getByTestId("fixes-and-polish");
		expect(within(fixes).getByText("Fixes and polish")).toBeInTheDocument();
		expect(within(fixes).getByText(V320.fixesAndPolish!)).toBeInTheDocument();
		expect(within(v311!).getByTestId("fixes-and-polish")).toHaveTextContent(V311.fixesAndPolish!);
		expect(within(v311!).queryByTestId("major-feature")).toBeNull();
		expect(within(v310!).queryByTestId("fixes-and-polish")).toBeNull();
	});
});

describe("ChangelogPage, notes from a newer API (S134 AC 1)", () =>
{
	it("S134 AC 1: a kind this build doesn't know shows its own word on the label, and items with the same title both draw", async () =>
	{
		serve(() => jsonResponse({
			current: null,
			releases: [
				{
					version: "v4.1.0",
					headline: [],
					items: [
						{
							kind: "security",
							title: "Same title",
							sentence: "First.",
						},
						{
							kind: "fix",
							title: "Same title",
							sentence: "Second.",
						},
					],
				},
			],
		}));
		renderChangelog();
		const items = await screen.findAllByTestId("release-item");
		expect(items).toHaveLength(2);
		expect(items.map((item) => within(item).getByTestId("kind-label").textContent)).toEqual(["security", "Bug fix"]);
		expect(screen.getByText("First.")).toBeInTheDocument();
		expect(screen.getByText("Second.")).toBeInTheDocument();
	});
});

describe("ChangelogPage states (S134 AC 2)", () =>
{
	it("S134 AC 2: loading keeps the title over ViewState's loader", () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
		renderChangelog();
		expect(title()).toBeInTheDocument();
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
	});

	it("S134 AC 2: empty (no approved release notes, as before v4.0.0) keeps the title and says 'No release notes yet.'", async () =>
	{
		serve(() => jsonResponse({
			current: null,
			releases: [],
		}));
		renderChangelog();
		expect(await screen.findByText("No release notes yet.")).toBeInTheDocument();
		expect(title()).toBeInTheDocument();
		expect(screen.queryByTestId("release")).toBeNull();
	});

	it("S134 AC 2: error keeps the title, says 'Couldn't load the change log' with the hint, and Retry asks again", async () =>
	{
		const fetchMock = serve(() => jsonResponse({
			error: "unavailable",
		}, 500));
		const user = userEvent.setup();
		renderChangelog();
		const alert = await screen.findByRole("alert");
		expect(title()).toBeInTheDocument();
		expect(within(alert).getByText("Couldn't load the change log")).toBeInTheDocument();
		expect(within(alert).getByText("Check your connection and try again")).toBeInTheDocument();
		fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(RELEASES)));
		await user.click(within(alert).getByRole("button", {
			name: "Retry",
		}));
		expect(await screen.findAllByTestId("release")).toHaveLength(3);
	});
});
