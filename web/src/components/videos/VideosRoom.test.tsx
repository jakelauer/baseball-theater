/**
 * S69: the Videos room on 823823's 40 recorded videos (`fixtures/game-823823.json`),
 * impact-ranked as the server sends them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyHighlight, DEFAULT_SETTINGS, groupHighlights, highlightTitle, rankHighlightsByImpact, sortHighlights,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	Link, MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { BODY_FONT_PX, mantineFontPx } from "../../test/fontSize.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { expectInCorner, markPlaying } from "../../test/renderWithPlayer.js";
import { VideosRoom } from "./VideosRoom.js";
import { PlayerProvider } from "./PlayerProvider.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function game(highlights?: GamePayload["highlights"]): GamePayload
{
	const snapshot = JSON.parse(readFileSync(join(FIXTURES, "game-823823.json"), "utf8")) as GamePayload;
	return {
		...snapshot,
		// The API always sends plays (a required field); none here, so no card gets a play link (S97).
		plays: [],
		highlights: highlights ?? rankHighlightsByImpact(snapshot.highlights) as GamePayload["highlights"],
	};
}

function renderRoom(variant: LayoutVariant = "mobile", g: GamePayload = game())
{
	render(
		<MantineProvider>
			{/* The open clip lives in the URL (`?clip=`, #424). */}
			<MemoryRouter initialEntries={["/game/823823/videos"]}><PlayerProvider>
				<VideosRoom game={g} variant={variant} />
			</PlayerProvider></MemoryRouter>
		</MantineProvider>,
	);
}

/** Titles in the order the room shows them: by group, each group in the order given. */
function grouped(highlights: GamePayload["highlights"]): string[]
{
	return groupHighlights(highlights).flatMap((g) => g.highlights.map((h) => h.title));
}

function cardTitles(): string[]
{
	return screen.getAllByTestId("video-card").map((c) => c.getAttribute("aria-label")!.replace(/^Play /, ""));
}

afterEach(() =>
{
	cleanup();
	resetSettings();
});

describe("VideosRoom layout (S69)", () =>
{
	it.each([
		["mobile", "2"],
		["medium", "3"],
		["desktop", "4"],
	] as const)("columns: %s shows a %s-column grid of every video, impact order kept", (variant, cols) =>
	{
		renderRoom(variant);
		for (const grid of screen.getAllByTestId("videos-grid"))
		{
			expect(getComputedStyle(grid).getPropertyValue("--sg-cols")).toBe(cols);
		}
		expect(cardTitles()).toEqual(grouped(game().highlights));
	});

	// The kind alone, no date: every clip here is from the game's own day (#421; owner, 2026-11-25).
	it("each card shows the still's duration, the title and a Kind meta line", () =>
	{
		renderRoom();
		const recap = within(screen.getByRole("link", {
			name: "Play Conforto clubs Cubs' 200th homer in close win",
		}));
		expect(recap.getByTestId("video-duration")).toHaveTextContent("3:06");
		expect(recap.getByTestId("video-meta")).toHaveTextContent(/^Recap$/);
	});

	it("list: List shows the same VideoCards as rows; Grid brings the grid back", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.click(screen.getByRole("radio", {
			name: "List",
		}));
		expect(screen.queryByTestId("videos-grid")).toBeNull();
		const rows = screen.getAllByTestId("videos-list").flatMap((list) => within(list).getAllByTestId("video-card"));
		expect(rows).toHaveLength(40);
		expect(rows.every((r) => r.dataset.layout === "list")).toBe(true);
		await user.click(screen.getByRole("radio", {
			name: "Grid",
		}));
		expect(screen.getAllByTestId("videos-grid").length).toBeGreaterThan(0);
	});

	it("groups: Pre-game, Game highlights, Statcast, Post-game, each headed; a group with nothing in it is left out", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const groups = () => screen.getAllByTestId("videos-group").map((g) => g.getAttribute("aria-label"));
		expect(groups()).toEqual(["Pre-game", "Game highlights", "Statcast", "Post-game"]);
		expect(screen.getByText("Game highlights")).toBeInTheDocument();
		expect(within(screen.getByRole("region", {
			name: "Post-game",
		})).getByRole("link", {
			name: "Play Condensed Game: CHC@MIA - 9/5/26",
		})).toBeInTheDocument();
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "ABS challenge");
		// ABS challenge clips are Statcast (#432).
		expect(groups()).toEqual(["Statcast"]);
	});

	it("groups collapse: each heading folds its group away and back; the others stay open", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const heading = () => within(screen.getByRole("region", {
			name: "Statcast",
		})).getByRole("button", {
			name: /^Statcast \d+$/,
		});
		expect(heading()).toHaveAttribute("aria-expanded", "true");
		const all = cardTitles().length;
		await user.click(heading());
		expect(heading()).toHaveAttribute("aria-expanded", "false");
		expect(within(screen.getByRole("region", {
			name: "Statcast",
		})).queryAllByTestId("video-card")).toHaveLength(0);
		expect(cardTitles().length).toBeLessThan(all);
		expect(screen.getAllByTestId("videos-group")).toHaveLength(4);
		await user.click(heading());
		expect(cardTitles()).toHaveLength(all);
	});
});

describe("VideosRoom search and quick filters (S69)", () =>
{
	it("search: narrows to videos whose title or blurb matches, in impact order", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "abs challenge");
		const titles = cardTitles();
		expect(titles).toHaveLength(5);
		expect(titles).toEqual(game().highlights.map((h) => h.title).filter((t) => titles.includes(t)));
		await user.clear(screen.getByRole("textbox", {
			name: "Search videos",
		}));
		await user.type(screen.getByRole("textbox", {
			name: "Search videos",
		}), "no such clip");
		expect(screen.getByText("No videos match.")).toBeInTheDocument();
	});

	it("quick filter: Featured team starts on All, narrows to the team picked from the game's two, and clears with All; Stat / viz the viz clips, together both", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const all = grouped(game().highlights);
		expect(cardTitles()).toEqual(all);
		await user.click(screen.getByRole("radio", {
			name: /^MIA \d+$/,
		}));
		const marlins = grouped(game().highlights.filter((h) => h.teamIds?.includes(146)));
		expect(cardTitles()).toEqual(marlins);
		await user.click(screen.getByRole("button", {
			name: "Stat / viz",
		}));
		expect(cardTitles()).toContain("Breaking down Kyle Stowers' home run");
		expect(cardTitles()).not.toContain("Kyle Stowers' solo home run (19)");
		expect(cardTitles().every((t) => marlins.includes(t))).toBe(true);
		await user.click(screen.getByRole("button", {
			name: "Stat / viz",
		}));
		await user.click(screen.getByRole("radio", {
			name: /^All \d+$/,
		}));
		expect(cardTitles()).toEqual(all);
	});
});

describe("VideosRoom states and play (S69)", () =>
{
	it("empty: a game with no videos reads \"No videos yet.\"", () =>
	{
		renderRoom("mobile", game([]));
		expect(screen.getByText("No videos yet.")).toBeInTheDocument();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("filters overflow: when every pill fits there is no Filters button", () =>
	{
		renderRoom();
		expect(within(screen.getByTestId("filter-row")).queryByRole("button", {
			name: "Filters",
		})).toBeNull();
		expect(within(screen.getByTestId("filter-row")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Stat / viz"]);
		expect(within(screen.getByTestId("filter-row")).getByRole("radiogroup", {
			name: "Featured team",
		})).toBeInTheDocument();
	});

	it("filters overflow: pills that don't fit move behind a last Filters button whose drawer lists every filter, applied with Apply", async () =>
	{
		// jsdom lays nothing out: each pill 100px, the Filters button 60px, and the row room for one pill plus the button.
		const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.textContent === "Filters" ? 60 : 100;
		});
		const room = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
		const user = userEvent.setup();
		renderRoom();
		const row = within(screen.getByTestId("filter-row"));
		expect(row.getByRole("radiogroup", {
			name: "Featured team",
		})).toBeInTheDocument();
		expect(row.getAllByRole("button").map((b) => b.textContent)).toEqual(["Filters"]);
		await user.click(row.getByRole("button", {
			name: "Filters",
		}));
		const drawer = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		expect(drawer.getByTestId("filter-drawer-list")).toBeInTheDocument();
		await user.click(drawer.getByRole("radio", {
			name: "MIA",
		}));
		await user.click(drawer.getByRole("checkbox", {
			name: "Stat / viz",
		}));
		expect(cardTitles()).toHaveLength(game().highlights.length);
		await user.click(drawer.getByRole("button", {
			name: "Apply",
		}));
		const marlinsViz = cardTitles();
		expect(marlinsViz).toContain("Breaking down Kyle Stowers' home run");
		expect(marlinsViz).not.toContain("Kyle Stowers' solo home run (19)");
		expect(marlinsViz.length).toBeLessThan(game().highlights.length);
		// Dismissing the drawer discards its edits.
		await user.click(row.getByRole("button", {
			name: "Filters",
		}));
		const again = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		await user.click(again.getByRole("radio", {
			name: "All teams",
		}));
		await user.keyboard("{Escape}");
		expect(cardTitles()).toEqual(marlinsViz);
		widths.mockRestore();
		room.mockRestore();
	});

	it("every game's Videos room shows the inline Featured team control, never a Filters drawer in its place, however wide it is (#583)", async () =>
	{
		// jsdom lays nothing out: the Featured team control (its text starts "All") 160px, every other pill and the
		// Filters button 60px, and a row of 180px: room for Stat / viz and the button, not for the team control.
		const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.textContent?.startsWith("All") ? 160 : 60;
		});
		const room = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
		try
		{
			const user = userEvent.setup();
			renderRoom();
			const row = within(screen.getByTestId("filter-row"));
			expect(row.getByRole("radiogroup", {
				name: "Featured team",
			})).toBeInTheDocument();
			// Stat / viz, which no longer fits beside it, stays reachable through the drawer.
			expect(row.getAllByRole("button").map((b) => b.textContent)).toEqual(["Filters"]);
			await user.click(row.getByRole("button", {
				name: "Filters",
			}));
			const drawer = within(await screen.findByRole("dialog", {
				name: "Filters",
			}));
			expect(drawer.getByRole("checkbox", {
				name: "Stat / viz",
			})).toBeInTheDocument();
		}
		finally
		{
			widths.mockRestore();
			room.mockRestore();
		}
	});

	it("only the Featured team control is pinned: grouped by team, a Kind pill wider than a 320px row falls back to Filters and holds no width wider than the row (#583)", async () =>
	{
		// jsdom lays nothing out: the Kind pill (its options name the kinds) 400px, wider than the row; the Featured
		// team control (its text starts "All") 200px; every other pill and the Filters button 60px; a row of 320px.
		const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			const text = this.textContent ?? "";
			if (text.includes("Pre-game")) return 400;
			return text.startsWith("All") ? 200 : 60;
		});
		const room = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
		try
		{
			const user = userEvent.setup();
			renderRoom();
			const filterRow = screen.getByTestId("filter-row");
			// The row's own box: its minimum width is what a wrapping toolbar can't narrow it below.
			const minWidth = () => parseFloat(filterRow.parentElement!.style.minWidth || "0");
			expect(within(filterRow).getByRole("radiogroup", {
				name: "Featured team",
			})).toBeInTheDocument();
			expect(minWidth()).toBeLessThanOrEqual(320);
			await user.click(screen.getByRole("radio", {
				name: "Team",
			}));
			const row = within(screen.getByTestId("filter-row"));
			expect(row.queryByRole("radiogroup", {
				name: "Kind",
			})).toBeNull();
			// Stat / viz still fits beside the Filters button, which holds the Kind filter.
			expect(row.getAllByRole("button").map((b) => b.textContent)).toEqual(["Stat / viz", "Filters"]);
			expect(minWidth()).toBeLessThanOrEqual(320);
		}
		finally
		{
			widths.mockRestore();
			room.mockRestore();
		}
	});

	it("sort: Impact by default; Newest and Oldest reorder through sortHighlights, within each group", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const impact = cardTitles();
		expect(impact).toEqual(grouped(game().highlights));
		await user.click(screen.getByRole("button", {
			name: "Sort: Impact",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "Newest",
		}));
		const newest = grouped(sortHighlights(game().highlights, "newest"));
		expect(cardTitles()).toEqual(newest);
		expect(newest).not.toEqual(impact);
		await user.click(screen.getByRole("button", {
			name: "Sort: Newest",
		}));
		await user.click(await screen.findByRole("menuitem", {
			name: "Oldest",
		}));
		expect(cardTitles()).toEqual(grouped(sortHighlights(game().highlights, "oldest")));
	});

	it("onPlay: choosing a card plays that video in the player dialog (S70), with no game pill back to this game (S173)", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const first = game().highlights[0]!;
		await user.click(screen.getByRole("link", {
			name: `Play ${first.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByTestId("video-player")).toHaveTextContent(first.title);
		expect(within(dialog).queryByRole("link", {
			name: /More from game/,
		})).toBeNull();
	});
});

describe("Videos headers are never smaller than body text (#527)", () =>
{
	// The room has no "Videos" title any more (#529), so only the group headers are checked.
	it("every group's header draws at body size or larger", () =>
	{
		renderRoom();
		const groups = screen.getAllByTestId("videos-group");
		expect(groups.length).toBeGreaterThan(0);
		for (const group of groups)
		{
			const label = group.getAttribute("aria-label")!;
			expect(mantineFontPx(within(group).getByText(label)), label).toBeGreaterThanOrEqual(BODY_FONT_PX);
		}
	});
});

describe("the Videos room's filters and groups (videos-room bugs)", () =>
{
	it("the Stat / viz filter is hidden when no clip is a stat or viz clip (#418)", () =>
	{
		renderRoom("mobile", game(game().highlights.filter((h) => !classifyHighlight(h).statViz)));
		expect(screen.queryAllByText("Stat / viz")).toEqual([]);
		cleanup();
		renderRoom();
		expect(screen.getByRole("button", {
			name: "Stat / viz",
		})).toBeInTheDocument();
	});

	it("Featured team is one connected control, All · away · home, All chosen, each with its clip count (#428)", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const all = game().highlights;
		const count = (teamId: number) => all.filter((h) => h.teamIds?.includes(teamId)).length;
		const control = within(screen.getByRole("radiogroup", {
			name: "Featured team",
		}));
		expect(control.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
			`All ${all.length}`, `CHC ${count(112)}`, `MIA ${count(146)}`,
		]);
		expect(control.getByRole("radio", {
			name: `All ${all.length}`,
		})).toBeChecked();
		// A clip featuring neither team counts only under All.
		expect(count(112) + count(146)).not.toBe(all.length);
		await user.click(control.getByRole("radio", {
			name: `MIA ${count(146)}`,
		}));
		expect(cardTitles()).toEqual(grouped(all.filter((h) => h.teamIds?.includes(146))));
		await user.click(control.getByRole("radio", {
			name: `All ${all.length}`,
		}));
		expect(cardTitles()).toEqual(grouped(all));
	});

	it("each group reads as a collapsible container: a left rule runs down from its chevron and its clips sit inset inside it (#427)", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		for (const group of screen.getAllByTestId("videos-group"))
		{
			const body = within(group).getByTestId("videos-group-body");
			expect(body.style.borderLeftStyle, group.dataset.group).toBe("solid");
			expect(Number.parseFloat(body.style.paddingLeft), group.dataset.group).toBeGreaterThan(0);
			expect(body).toContainElement(within(group).getAllByTestId("video-card")[0]!);
		}
		await user.click(within(screen.getByRole("region", {
			name: "Statcast",
		})).getByRole("button", {
			name: /^Statcast \d+$/,
		}));
		expect(within(screen.getByRole("region", {
			name: "Statcast",
		})).queryByTestId("videos-group-body")).toBeNull();
	});

	it("a game's clips show no date: every clip is from the game's own day (#421)", () =>
	{
		renderRoom();
		const metas = screen.getAllByTestId("video-meta").map((meta) => meta.textContent ?? "");
		expect(metas.length).toBeGreaterThan(0);
		expect(metas.filter((meta) => /\b2026\b/.test(meta))).toEqual([]);
	});

	it("the Videos tab has no \"Videos\" header (#529)", () =>
	{
		renderRoom();
		expect(screen.queryByText("Videos")).toBeNull();
	});
});

describe("Group by team and the list's Best of rows (S200)", () =>
{
	const ALL = game().highlights;
	const featuring = (teamId: number) => ALL.filter((h) => h.teamIds?.includes(teamId));
	const groupNames = () => screen.getAllByTestId("videos-group").map((g) => g.getAttribute("aria-label"));
	const groupTitles = (name: string) => within(screen.getByRole("region", {
		name,
	})).getAllByTestId("video-card").map((c) => c.getAttribute("aria-label")!.replace(/^Play /, ""));

	// AC 4 stubs fetch to hydrate settings; undo it even when an assertion fails first.
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	it("S200 AC 2 switch: Group by (Kind, Team) sits beside the Layout toggle; Team groups by away, home, then Other, and Kind brings the kinds back", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		const groupBy = screen.getByRole("radiogroup", {
			name: "Group by",
		});
		expect(within(groupBy).getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Kind", "Team"]);
		expect(within(groupBy).getByRole("radio", {
			name: "Kind",
		})).toBeChecked();
		// Beside the Grid / List toggle, in the same row.
		const layout = screen.getByRole("radiogroup", {
			name: "Layout",
		});
		expect(groupBy.parentElement).toBe(layout.parentElement);
		expect(groupNames()).toEqual(["Pre-game", "Game highlights", "Statcast", "Post-game"]);
		await user.click(within(groupBy).getByRole("radio", {
			name: "Team",
		}));
		expect(groupNames()).toEqual(["Chicago Cubs", "Miami Marlins", "Other"]);
		expect(groupTitles("Chicago Cubs")).toEqual(featuring(112).map((h) => h.title));
		expect(groupTitles("Miami Marlins")).toEqual(featuring(146).map((h) => h.title));
		expect(groupTitles("Other")).toEqual(ALL.filter((h) => !h.teamIds?.includes(112) && !h.teamIds?.includes(146)).map((h) => h.title));
		// The team filter gives way to the kind filter.
		expect(screen.queryByRole("radiogroup", {
			name: "Featured team",
		})).toBeNull();
		expect(screen.getByRole("radiogroup", {
			name: "Kind",
		})).toBeInTheDocument();
		await user.click(within(groupBy).getByRole("radio", {
			name: "Kind",
		}));
		expect(groupNames()).toEqual(["Pre-game", "Game highlights", "Statcast", "Post-game"]);
	});

	it("S200 AC 2 kind filter: grouped by team the Kind pill offers All and each kind with its count, filters within each team, and switching back finds the team filter as it was", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.click(screen.getByRole("radio", {
			name: /^MIA \d+$/,
		}));
		const marlins = grouped(featuring(146));
		expect(cardTitles()).toEqual(marlins);
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		// The team filter doesn't apply grouped by team: every clip is back, in its team's group.
		expect(groupNames()).toEqual(["Chicago Cubs", "Miami Marlins", "Other"]);
		const kinds = within(screen.getByRole("radiogroup", {
			name: "Kind",
		}));
		const count = (name: string) => groupHighlights(ALL).find((g) => GROUP_NAMES[g.group] === name)?.highlights.length;
		expect(kinds.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
			`All ${ALL.length}`, ...groupHighlights(ALL).map((g) => `${GROUP_NAMES[g.group]} ${count(GROUP_NAMES[g.group])}`),
		]);
		expect(kinds.getByRole("radio", {
			name: `All ${ALL.length}`,
		})).toBeChecked();
		await user.click(kinds.getByRole("radio", {
			name: /^Statcast \d+$/,
		}));
		const statcast = groupHighlights(ALL).find((g) => g.group === "statcast")!.highlights;
		expect(groupTitles("Miami Marlins")).toEqual(statcast.filter((h) => h.teamIds?.includes(146)).map((h) => h.title));
		expect(groupTitles("Chicago Cubs")).toEqual(statcast.filter((h) => h.teamIds?.includes(112)).map((h) => h.title));
		// One choice at a time: Statcast checked, All not.
		expect(kinds.getByRole("radio", {
			name: `All ${ALL.length}`,
		})).not.toBeChecked();
		await user.click(screen.getByRole("radio", {
			name: "Kind",
		}));
		expect(screen.getByRole("radio", {
			name: /^MIA \d+$/,
		})).toBeChecked();
		expect(cardTitles()).toEqual(marlins);
	});

	it.each([
		["mobile", "1"],
		["medium", "2"],
		["desktop", "3"],
	] as const)("S200 AC 3 %s: List lays each group's clips out as Best of rows in %s column(s), with no rank number", async (variant, cols) =>
	{
		const user = userEvent.setup();
		renderRoom(variant);
		await user.click(screen.getByRole("radio", {
			name: "List",
		}));
		const lists = screen.getAllByTestId("videos-list");
		expect(lists).toHaveLength(4);
		for (const list of lists) expect(getComputedStyle(list).getPropertyValue("--sg-cols")).toBe(cols);
		const rows = screen.getAllByTestId("video-card");
		expect(rows).toHaveLength(40);
		for (const row of rows)
		{
			// The Best of row: a raised card holding the still, the title and the meta line.
			const card = row.parentElement!;
			expect(card).toHaveClass("bt-card");
			expect(card.style.background).toBe("var(--bt-raised)");
			expect(row.querySelector(".bt-zoom")).not.toBeNull();
			// No rank number: the still comes first in the row, and nothing in the card is a bare number.
			expect(row.firstElementChild!.querySelector(".bt-zoom")).not.toBeNull();
			expect(within(card).queryAllByText(/^\d+$/)).toHaveLength(0);
		}
		// The team grouping draws the same rows.
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		for (const list of screen.getAllByTestId("videos-list")) expect(getComputedStyle(list).getPropertyValue("--sg-cols")).toBe(cols);
	});

	it("S200 AC 2 kind filter: a kind with no clip is not offered, and All clears the kind chosen", async () =>
	{
		const user = userEvent.setup();
		const noPregame = ALL.filter((h) => !groupHighlights([h]).some((g) => g.group === "pregame"));
		renderRoom("mobile", game(noPregame));
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		const kinds = within(screen.getByRole("radiogroup", {
			name: "Kind",
		}));
		expect(kinds.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent?.replace(/ \d+$/, ""))).toEqual([
			"All", "Game highlights", "Statcast", "Post-game",
		]);
		await user.click(kinds.getByRole("radio", {
			name: /^Post-game \d+$/,
		}));
		expect(cardTitles().length).toBeLessThan(noPregame.length);
		await user.click(kinds.getByRole("radio", {
			name: `All ${noPregame.length}`,
		}));
		expect(new Set(cardTitles())).toEqual(new Set(noPregame.map((h) => h.title)));
	});

	it("S200 AC 2 kind filter in the drawer: grouped by team, the Filters drawer offers Kind (All kinds, then each kind with a clip) in Featured team's place", async () =>
	{
		const widths = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement)
		{
			return this.textContent === "Filters" ? 60 : 100;
		});
		const room = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
		const user = userEvent.setup();
		renderRoom();
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		await user.click(within(screen.getByTestId("filter-row")).getByRole("button", {
			name: "Filters",
		}));
		const drawer = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		expect(drawer.queryByRole("radiogroup", {
			name: "Featured team",
		})).toBeNull();
		const kinds = within(drawer.getByRole("radiogroup", {
			name: "Kind",
		}));
		expect(kinds.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
			"All kinds", ...groupHighlights(ALL).map((g) => GROUP_NAMES[g.group]),
		]);
		await user.click(kinds.getByRole("radio", {
			name: "Post-game",
		}));
		await user.click(drawer.getByRole("button", {
			name: "Apply",
		}));
		const postgame = groupHighlights(ALL).find((g) => g.group === "postgame")!.highlights.map((h) => h.title);
		expect(cardTitles().every((t) => postgame.includes(t))).toBe(true);
		await user.click(within(screen.getByTestId("filter-row")).getByRole("button", {
			name: "Filters",
		}));
		const again = within(await screen.findByRole("dialog", {
			name: "Filters",
		}));
		await user.click(again.getByRole("radio", {
			name: "All kinds",
		}));
		await user.click(again.getByRole("button", {
			name: "Apply",
		}));
		expect(new Set(cardTitles())).toEqual(new Set(ALL.map((h) => h.title)));
		widths.mockRestore();
		room.mockRestore();
	});

	it("S200 AC 4: Hide Scores titles the recap through highlightTitle grouped by kind and by team alike", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
			...DEFAULT_SETTINGS,
			hideScores: true,
			version: 1,
		}))));
		await hydrateSettings("test-user");
		const user = userEvent.setup();
		renderRoom();
		const recap = ALL.find((h) => h.title === "Conforto clubs Cubs' 200th homer in close win")!;
		expect(highlightTitle(recap, true)).toBe("Recap (score hidden)");
		expect(screen.getAllByRole("link", {
			name: "Play Recap (score hidden)",
		})).toHaveLength(1);
		expect(screen.queryByText(recap.title)).toBeNull();
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		// The recap features both teams, so it shows in both groups, hidden in each.
		expect(screen.getAllByRole("link", {
			name: "Play Recap (score hidden)",
		})).toHaveLength(2);
		expect(screen.queryByText(recap.title)).toBeNull();
		// Every other title stays MLB's.
		expect(cardTitles().filter((t) => t !== "Recap (score hidden)").every((t) => ALL.some((h) => h.title === t))).toBe(true);
	});

	it("S200 collapse: grouped by team, folding a team's group or Other hides its clips and unfolding shows them", async () =>
	{
		const user = userEvent.setup();
		renderRoom();
		await user.click(screen.getByRole("radio", {
			name: "Team",
		}));
		const group = (key: string) => screen.getAllByTestId("videos-group").find((g) => g.dataset.group === key)!;
		const others = ALL.filter((h) => !h.teamIds?.includes(112) && !h.teamIds?.includes(146)).map((h) => h.title);
		for (const [key, name, titles] of [
			["team-146", "Miami Marlins", featuring(146).map((h) => h.title)],
			["other", "Other", others],
		] as const)
		{
			expect(titles.length).toBeGreaterThan(0);
			const toggle = within(group(key)).getByRole("button", {
				expanded: true,
			});
			await user.click(toggle);
			expect(toggle).toHaveAttribute("aria-expanded", "false");
			expect(within(group(key)).queryAllByTestId("video-card")).toHaveLength(0);
			// The other groups stay open.
			expect(groupTitles("Chicago Cubs")).toEqual(featuring(112).map((h) => h.title));
			await user.click(toggle);
			expect(groupTitles(name)).toEqual(titles);
		}
	});
});

/** The kind groups' headings, as the room writes them. */
const GROUP_NAMES = {
	pregame: "Pre-game",
	highlights: "Game highlights",
	statcast: "Statcast",
	postgame: "Post-game",
} as const;

describe("the corner mini-player from the Videos room (S198)", () =>
{
	it("S198 AC 1: a clip playing in the Videos room keeps playing in the corner after a route change, the same element", async () =>
	{
		const user = userEvent.setup();
		render(
			<MantineProvider>
				<MemoryRouter initialEntries={["/game/823823/videos"]}><PlayerProvider>
					<Routes>
						<Route path="/game/823823/videos" element={<VideosRoom game={game()} variant="desktop" />} />
						<Route path="*" element={<p>Box room</p>} />
					</Routes>
					{/* A header link, outside the page. */}
					<Link to="/game/823823/box">Box</Link>
				</PlayerProvider></MemoryRouter>
			</MantineProvider>,
		);
		const first = game().highlights[0]!;
		await user.click(screen.getByRole("link", {
			name: `Play ${first.title}`,
		}));
		const dialog = await screen.findByRole("dialog");
		const video = within(dialog).getByTestId("video-player").querySelector("video")!;
		markPlaying(video, 7);
		fireEvent.click(screen.getByRole("link", {
			name: "Box",
		}));
		expect(await screen.findByText("Box room")).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expectInCorner(video, 7);
	});
});
