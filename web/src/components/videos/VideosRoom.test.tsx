/**
 * S69: the Videos room on 823823's 40 recorded videos (`fixtures/game-823823.json`),
 * impact-ranked as the server sends them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyHighlight, groupHighlights, rankHighlightsByImpact, sortHighlights,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { resetSettings } from "../../settings/store.js";
import { BODY_FONT_PX, mantineFontPx } from "../../test/fontSize.js";
import { VideosRoom } from "./VideosRoom.js";

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
			<MemoryRouter initialEntries={["/game/823823/videos"]}>
				<VideosRoom game={g} variant={variant} />
			</MemoryRouter>
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

	it("each card shows the still's duration, the title and a Kind · date meta line", () =>
	{
		renderRoom();
		const recap = within(screen.getByRole("link", {
			name: "Play Conforto clubs Cubs' 200th homer in close win",
		}));
		expect(recap.getByTestId("video-duration")).toHaveTextContent("3:06");
		expect(recap.getByText(/^Recap · (Sep 5|Sep 6), 2026$/)).toBeInTheDocument();
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
	it("the Videos title and every group's header draw at body size or larger", () =>
	{
		renderRoom();
		expect(mantineFontPx(screen.getByText("Videos"))).toBeGreaterThanOrEqual(BODY_FONT_PX);
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

	it.fails("a game's clips show no date: every clip is from the game's own day (#421)", () =>
	{
		renderRoom();
		const metas = screen.getAllByTestId("video-meta").map((meta) => meta.textContent ?? "");
		expect(metas.length).toBeGreaterThan(0);
		expect(metas.filter((meta) => /\b2026\b/.test(meta))).toEqual([]);
	});

	it.fails("the Videos tab has no \"Videos\" header (#529)", () =>
	{
		renderRoom();
		expect(screen.queryByText("Videos")).toBeNull();
	});
});
