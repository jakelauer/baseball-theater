/**
 * The Box room (S2) on the committed 823823 fixture (CHC @ MIA, Final 6–5), rendered
 * through the game page so every assertion is made inside the Box tab panel.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { DEFAULT_SETTINGS, contrastSafeTeamColor } from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { GamePage } from "../../pages/GamePage.js";
import { hydrateSettings, resetSettings } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { findLoadedTopBar } from "../../test/gameTopBar.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

/** A committed game fixture, shaped as the API serves it. */
function fixture(gamePk: number): GamePayload
{
	return {
		...JSON.parse(readFileSync(join(FIXTURES, `game-${gamePk}.json`), "utf8")),
		plays: [],
		fetchedAt: "2026-09-05T23:00:00.000Z",
		windowMode: "cache",
		version: 1,
		lastChangedAt: "2026-09-05T23:00:00.000Z",
	} as GamePayload;
}

/** Renders `/game/<pk>/box` at a pairing and returns the Box tab panel. */
async function boxPanel(game: GamePayload, variant: LayoutVariant = "mobile"): Promise<HTMLElement>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(game))));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[`/game/${game.gamePk}/box`]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await findLoadedTopBar();
	return screen.getByRole("tabpanel");
}

/** `#rrggbb` → the `rgb(r, g, b)` jsdom reports for a style. */
function rgb(hex: string): string
{
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Turns Hide Scores on or off for a signed-in reader (as `HideScoresRooms.test.tsx` does). */
async function hideScores(on: boolean): Promise<void>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
		...DEFAULT_SETTINGS,
		hideScores: on,
		version: 1,
	}))));
	await hydrateSettings("test-user");
}

/** A table's body rows as their cells' text. */
function rows(table: HTMLElement): string[][]
{
	return within(table).getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent ?? ""));
}

/** A table's column heads. */
function heads(table: HTMLElement): string[]
{
	return within(table).getAllByRole("columnheader").map((th) => th.textContent ?? "");
}

/** The named section's lines (`2B: Amaya (10, Gusto); Busch (26, Gusto)`), in order. */
function lines(panel: HTMLElement, name: string): string[]
{
	return within(within(panel).getByRole("region", {
		name,
	})).getAllByTestId("info-line").map((line) => line.textContent ?? "");
}

afterEach(() =>
{
	cleanup();
	resetSettings();
	vi.unstubAllGlobals();
});

describe("the Box room (S2)", () =>
{
	it("box panel: nine boxed innings and R H E, a CHC/MIA switcher, one batting table at a time, Game info", async () =>
	{
		const panel = await boxPanel(fixture(823823));
		const linescore = within(panel).getByRole("table", {
			name: "Linescore",
		});
		const [away, home] = within(linescore).getAllByTestId("linescore-row");
		expect(within(away!).getAllByTestId("inning-cell")).toHaveLength(9);
		expect(within(home!).getAllByTestId("inning-cell")).toHaveLength(9);
		const totals = (row: HTMLElement) => [...row.querySelectorAll("td")].slice(-3).map((td) => td.textContent);
		expect(within(away!).getByRole("rowheader")).toHaveTextContent("CHC");
		expect(totals(away!)).toEqual(["6", "13", "0"]);
		expect(within(home!).getByRole("rowheader")).toHaveTextContent("MIA");
		expect(totals(home!)).toEqual(["5", "6", "0"]);

		const chc = within(panel).getByRole("button", {
			name: "CHC",
		});
		const mia = within(panel).getByRole("button", {
			name: "MIA",
		});
		expect(chc).toHaveAttribute("aria-pressed", "true");
		expect(within(panel).getAllByRole("table", {
			name: /batting$/,
		})).toHaveLength(1);
		expect(within(panel).getByRole("table", {
			name: "CHC batting",
		})).toHaveTextContent("Crow-Armstrong (CF)");

		await userEvent.click(mia);
		expect(mia).toHaveAttribute("aria-pressed", "true");
		expect(within(panel).queryByRole("table", {
			name: "CHC batting",
		})).toBeNull();
		const miaTable = within(panel).getByRole("table", {
			name: "MIA batting",
		});
		expect(miaTable).not.toHaveTextContent("Crow-Armstrong");

		const info = within(panel).getByRole("region", {
			name: "Game info",
		});
		expect(info).toHaveTextContent("Venue");
		expect(info).toHaveTextContent("loanDepot park");
		expect(info).not.toHaveTextContent("loanDepot park.");
	});

	it("batting row: name (position) and AB R H RBI BB K AVG OPS for Pete Crow-Armstrong (S207: as the live site prints it)", async () =>
	{
		const panel = await boxPanel(fixture(823823));
		const [first] = within(panel).getAllByTestId("batting-row");
		const cells = [...first!.querySelectorAll("td")].map((td) => td.textContent);
		// 1-4, BB, 2 K, RBI; season .279 / .943 (fixtures/raw/live-823823.json).
		expect(cells).toEqual(["Crow-Armstrong (CF)", "4", "0", "1", "1", "1", "2", ".279", ".943"]);
	});

	it("swatch: each switcher button carries its team's TeamSwatch", async () =>
	{
		const panel = await boxPanel(fixture(823823));
		const group = within(panel).getByRole("group", {
			name: "Team",
		});
		const swatches = within(group).getAllByTestId("team-swatch");
		expect(swatches.map((s) => s.style.background)).toEqual([rgb(contrastSafeTeamColor(112)!), rgb(contrastSafeTeamColor(146)!)]);
	});

	it("no box score: a game without one shows the room's empty state", async () =>
	{
		const panel = await boxPanel(fixture(744834));
		expect(within(panel).getByText("No box score yet.")).toBeInTheDocument();
		expect(within(panel).queryByRole("table")).toBeNull();
	});

	it("box panel: a box score with no info lines and no season average leaves those blank", async () =>
	{
		const game = fixture(823823);
		const boxscore = game.boxscore!;
		const panel = await boxPanel({
			...game,
			boxscore: {
				...boxscore,
				teams: {
					...boxscore.teams,
					away: {
						batting: boxscore.teams.away.batting.map((b) => ({
							...b,
							avg: null,
						})),
					},
				},
				info: [],
			},
		});
		expect(within(panel).queryByRole("region", {
			name: "Game info",
		})).toBeNull();
		const [first] = within(panel).getAllByTestId("batting-row");
		// AVG, the column before OPS.
		expect([...first!.querySelectorAll("td")].at(-2)?.textContent).toBe("");
	});

	for (const variant of ["medium", "desktop"] as const)
	{
		it(`variant: at ${variant} both teams' batting tables show side by side, home on the right, with no switcher (#433)`, async () =>
		{
			const panel = await boxPanel(fixture(823823), variant);
			expect(within(panel).getByTestId("box-room")).toHaveAttribute("data-variant", variant);
			expect(within(panel).getByRole("table", {
				name: "Linescore",
			})).toBeInTheDocument();
			expect(within(panel).queryByRole("group", {
				name: "Team",
			})).toBeNull();
			const tables = within(panel).getAllByRole("table", {
				name: /batting$/,
			});
			expect(tables.map((t) => t.getAttribute("aria-label"))).toEqual(["CHC batting", "MIA batting"]);
			expect(within(panel).getByRole("region", {
				name: "Game info",
			})).toBeInTheDocument();
		});
	}

	for (const variant of ["medium", "desktop"] as const)
	{
		it(`team headings: at ${variant} each side-by-side table's heading is the full team name, aligned with its table, not centered (#586)`, async () =>
		{
			const panel = await boxPanel(fixture(823823), variant);
			// The heading is the first thing in each team's column, above its tables (S207 put the tables under section titles).
			const headings = within(panel).getAllByTestId("box-team").map((column) => column.firstElementChild as HTMLElement);
			expect(headings.map((h) => h.textContent)).toEqual(["Chicago Cubs", "Miami Marlins"]);
			for (const heading of headings)
			{
				expect(heading.style.getPropertyValue("--group-justify")).toBe("flex-start");
			}
		});
	}

	it("team switcher: at mobile the ratified box-mobile switcher keeps its abbreviations, centered (#586)", async () =>
	{
		const panel = await boxPanel(fixture(823823));
		const group = within(panel).getByRole("group", {
			name: "Team",
		});
		expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["CHC", "MIA"]);
	});

	it("game info: MLB's T and Att are written out as Time and Attendance (#433)", async () =>
	{
		const panel = await boxPanel(fixture(823823), "desktop");
		const info = within(panel).getByRole("region", {
			name: "Game info",
		});
		const labels = lines(panel, "Game info").map((line) => line.split(":")[0]);
		expect(labels).toContain("Time");
		expect(labels).toContain("Attendance");
		expect(labels).not.toContain("T");
		expect(labels).not.toContain("Att");
		expect(within(info).getByText("Time:", {
			exact: false,
		})).toBeInTheDocument();
	});
});

describe("the Box room's pitching and details, as the live site shows them (S207)", () =>
{
	it("S207 AC 1: under each batting table its pitchers render in MLB's order; Assad's row is 4.2 IP 3 H 3 R 3 ER 5 BB 3 K 0 HR, ERA 3.58", async () =>
	{
		const panel = await boxPanel(fixture(823823), "desktop");
		const chc = within(panel).getByRole("table", {
			name: "CHC pitching",
		});
		expect(heads(chc)).toEqual(["PLAYER", "IP", "H", "R", "ER", "BB", "SO", "HR", "ERA", "WHIP"]);
		expect(rows(chc)[0]).toEqual(["Assad, J", "4.2", "3", "3", "3", "5", "3", "0", "3.58", "1.14"]);
		expect(rows(chc).map((row) => row[0])).toEqual(["Assad, J", "Thielbar, C", "Thornton, T", "Rolison, R", "Zeferjahn, R"]);
		expect(rows(within(panel).getByRole("table", {
			name: "MIA pitching",
		}))[0]?.[0]).toBe("Gusto, R");
		// Each team's pitching table comes after its batting table, in its own column.
		const [away] = within(panel).getAllByTestId("box-team");
		expect(within(away!).getAllByRole("table").map((t) => t.getAttribute("aria-label"))).toEqual(["CHC batting", "CHC pitching"]);
	});

	it("S207 AC 2: each team's groups, titled, every line; the lettered notes; MIA has no BASERUNNING; every Game info line", async () =>
	{
		const panel = await boxPanel(fixture(823823), "desktop");
		expect(lines(panel, "CHC BATTING")).toHaveLength(10);
		expect(lines(panel, "CHC BATTING")[0]).toBe("2B: Amaya (10, Gusto); Busch (26, Gusto)");
		expect(within(within(panel).getByRole("region", {
			name: "CHC BATTING",
		})).getByText("BATTING")).toBeInTheDocument();
		expect(lines(panel, "CHC BASERUNNING")).toEqual(["CS: Hoerner (4, 3rd base by Gusto/Mack)"]);
		expect(lines(panel, "CHC FIELDING")).toEqual(["Outfield assists: Happ (Caissie at 2nd base)", "DP: 2 (Bregman-Ramírez-Busch; Ramírez-Busch)"]);
		expect(lines(panel, "CHC notes")).toEqual(["a: Walked for Conforto in the 7th"]);
		expect(lines(panel, "MIA BATTING")[0]).toBe("2B: Lopez, O (31, Assad); Ruiz, E (11, Rolison)");
		expect(lines(panel, "MIA FIELDING")[0]).toBe("Outfield assists: Marsee (Happ at 3rd base)");
		expect(lines(panel, "MIA notes")).toHaveLength(3);
		expect(within(panel).queryByRole("region", {
			name: "MIA BASERUNNING",
		})).toBeNull();
		const info = lines(panel, "Game info");
		expect(info.map((line) => line.split(":")[0])).toEqual(["HBP", "Pitch timer violations", "ABS Challenge", "Pitches-strikes", "Groundouts-flyouts", "Batters faced",
			"Inherited runners-scored", "Umpires", "Weather", "Wind", "First pitch", "Time", "Attendance", "Venue", "September 5, 2026"]);
		expect(info[0]).toBe("HBP: Bregman (by Gusto); Hernández, H (by Thornton, T); Lopez, O (by Thornton, T)");
		expect(info.at(-1)).toBe("September 5, 2026");
	});

	it("S207 AC 2: intentional walks, wild pitches and balks show wherever MLB sends them", async () =>
	{
		const extra = await boxPanel(fixture(776897), "desktop");
		expect(lines(extra, "Game info").slice(0, 3).map((line) => line.split(":")[0])).toEqual(["Balk", "Disengagement violations", "IBB"]);
		cleanup();
		const suspended = await boxPanel(fixture(777861), "desktop");
		expect(lines(suspended, "Game info").slice(0, 2).map((line) => line.split(":")[0])).toEqual(["WP", "IBB"]);
	});

	it("S207 AC 2: a game stored without pitchers, groups or notes still renders its batting table and Game info, with no empty sections", async () =>
	{
		const game = fixture(823823);
		const boxscore = game.boxscore!;
		const older = (side: "away" | "home") => ({
			batting: boxscore.teams[side].batting.map(({
				lastName: _l, positions: _p, note: _n, isSubstitute: _s, ops: _o, ...rest
			}) => rest),
		});
		const panel = await boxPanel({
			...game,
			boxscore: {
				teams: {
					away: older("away"),
					home: older("home"),
				},
				info: boxscore.info,
			},
		}, "desktop");
		expect(within(panel).getAllByRole("table", {
			name: /batting$/,
		})).toHaveLength(2);
		expect(within(panel).queryByRole("table", {
			name: /pitching$/,
		})).toBeNull();
		expect(within(panel).queryByText("PITCHING")).toBeNull();
		expect(within(panel).queryAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Game info"]);
		// The name falls back to S2's short form with the one position it kept.
		expect(rows(within(panel).getByRole("table", {
			name: "CHC batting",
		}))[0]?.[0]).toBe("P. Crow-Armstrong (CF)");
	});

	it("S207 AC 5: Hide Scores masks the pitching R, ER and ERA and the RBI, 2-out RBI, Team RISP and Inherited runners-scored lines; the rest reads as it does with it off", async () =>
	{
		const read = async (on: boolean) =>
		{
			await hideScores(on);
			const panel = await boxPanel(fixture(823823), "desktop");
			const result = {
				pitching: rows(within(panel).getByRole("table", {
					name: "CHC pitching",
				}))[0],
				batting: rows(within(panel).getByRole("table", {
					name: "CHC batting",
				}))[0],
				linescore: within(panel).getByRole("table", {
					name: "Linescore",
				}).textContent,
				details: lines(panel, "CHC BATTING"),
				info: lines(panel, "Game info"),
				masks: within(panel).queryAllByTestId("hidden-score").length,
			};
			cleanup();
			resetSettings();
			return result;
		};
		const hidden = await read(true);
		const shown = await read(false);
		expect(shown.masks).toBe(0);
		expect(hidden.pitching).toEqual(["Assad, J", "4.2", "3", "–", "–", "5", "3", "0", "–", "1.14"]);
		expect(shown.pitching).toEqual(["Assad, J", "4.2", "3", "3", "3", "5", "3", "0", "3.58", "1.14"]);
		const masked = (all: string[], label: string) => all.find((line) => line.startsWith(`${label}:`));
		for (const label of ["RBI", "2-out RBI", "Team RISP"])
		{
			expect(masked(hidden.details, label)).toBe(`${label}: –`);
			expect(masked(shown.details, label)).not.toBe(`${label}: –`);
		}
		expect(masked(hidden.info, "Inherited runners-scored")).toBe("Inherited runners-scored: –");
		expect(masked(hidden.details, "2B")).toBe(masked(shown.details, "2B"));
		expect(masked(hidden.info, "Venue")).toBe("Venue: loanDepot park");
		// What A3 draws on the Box room is unchanged: the linescore and the batting lines.
		expect(hidden.linescore).toBe(shown.linescore);
		expect(hidden.batting).toEqual(shown.batting);
	});
});

/**
 * One test per difference S207 found between v3's Box room and the live baseball.theater (v2) box
 * score, each on a game it recorded (docs/v3/design-checks/S207/v2-differences.md names them).
 */
describe("the Box room against the live baseball.theater (S207 AC 3)", () =>
{
	it("S207 AC 3 batting columns: AB R H RBI BB K AVG OPS, K for strikeouts and the season OPS last (776854)", async () =>
	{
		const panel = await boxPanel(fixture(776854), "desktop");
		const tor = within(panel).getByRole("table", {
			name: "TOR batting",
		});
		expect(heads(tor)).toEqual(["PLAYER", "AB", "R", "H", "RBI", "BB", "K", "AVG", "OPS"]);
		expect(rows(tor)[0]).toEqual(["Lukes (RF)", "4", "2", "2", "1", "1", "0", ".262", ".775"]);
	});

	it("S207 AC 3 batter names: MLB's last name and every position he played, joined by hyphens (776854)", async () =>
	{
		const panel = await boxPanel(fixture(776854), "desktop");
		const names = rows(within(panel).getByRole("table", {
			name: "COL batting",
		})).map((row) => row[0]);
		expect(names).toContain("Bernabel (1B-3B)");
		expect(names.at(-1)).toBe("1-Farmer (PR-3B-2B)");
	});

	it("S207 AC 3 substitutes: indented under the player replaced, with MLB's marker in bold before the name (776897)", async () =>
	{
		const panel = await boxPanel(fixture(776897), "desktop");
		const table = within(panel).getByRole("table", {
			name: "TEX batting",
		});
		const cells = within(table).getAllByTestId("batting-row").map((row) => row.querySelector("td")!);
		const cell = (text: string) => cells.find((td) => td.textContent === text)!;
		const haggerty = cell("2-Haggerty (PR-LF)");
		expect(haggerty.querySelector("[data-substitute]")).not.toBeNull();
		expect(within(haggerty).getByText("2-")).toHaveStyle({
			fontWeight: "700",
		});
		// A substitute MLB gives no marker (a pitcher who came in) is still indented, with no marker.
		expect(cell("Curvelo (P)").querySelector("[data-substitute]")).not.toBeNull();
		expect(cell("Pederson (DH)").querySelector("[data-substitute]")).toBeNull();
		// Batting order: each substitute right under the starter he replaced (MLB's own order).
		const names = cells.map((td) => td.textContent);
		expect(names.indexOf("2-Haggerty (PR-LF)")).toBe(names.indexOf("Pederson (DH)") + 1);
	});

	it("S207 AC 3 pitching tables: every pitcher who pitched, seven and eight in the extra-innings game (776897)", async () =>
	{
		const panel = await boxPanel(fixture(776897), "desktop");
		expect(rows(within(panel).getByRole("table", {
			name: "TEX pitching",
		}))).toHaveLength(7);
		const sea = rows(within(panel).getByRole("table", {
			name: "SEA pitching",
		}));
		expect(sea).toHaveLength(8);
		expect(sea[0]?.[0]).toBe("Castillo, L");
	});

	it("S207 AC 3 section titles: BATTING over the batting table and PITCHING over the pitching table (776836)", async () =>
	{
		const panel = await boxPanel(fixture(776836), "desktop");
		const [, home] = within(panel).getAllByTestId("box-team");
		for (const [title, table] of [["BATTING", "COL batting"], ["PITCHING", "COL pitching"]] as const)
		{
			const element = within(home!).getByRole("table", {
				name: table,
			});
			expect(element.previousElementSibling?.textContent).toBe(title);
		}
	});

	it("S207 AC 3 order: each team reads batting, pitching, the notes, then BATTING, BASERUNNING and FIELDING (776854)", async () =>
	{
		const panel = await boxPanel(fixture(776854), "desktop");
		const [away] = within(panel).getAllByTestId("box-team");
		const parts = [...away!.querySelectorAll("table[aria-label], section[aria-label]")].map((el) => el.getAttribute("aria-label"));
		expect(parts).toEqual(["TOR batting", "TOR pitching", "TOR notes", "TOR BATTING", "TOR BASERUNNING", "TOR FIELDING"]);
		expect(lines(panel, "TOR notes")).toEqual(["1: Ran for Loperfido, J in the 6th"]);
		expect(lines(panel, "TOR FIELDING")[0]).toBe("E: Barger (9, fielding); Varsho (1, fielding)");
		expect(lines(panel, "TOR BATTING")).toContain("GIDP: Guerrero Jr.");
		expect(lines(panel, "COL BASERUNNING")).toEqual(["SB: Beck (13, 2nd base off Berríos/Kirk)", "PO: Arcia, Or (2nd base by Berríos)"]);
	});

	it("S207 AC 3 mobile: the team switcher shows the chosen team's whole box score, batting through its details (776836)", async () =>
	{
		const panel = await boxPanel(fixture(776836));
		const tables = () => within(panel).getAllByRole("table").map((t) => t.getAttribute("aria-label")).filter((name) => name !== "Linescore");
		expect(tables()).toEqual(["TOR batting", "TOR pitching"]);
		expect(within(panel).getByRole("region", {
			name: "TOR FIELDING",
		})).toBeInTheDocument();
		await userEvent.click(within(panel).getByRole("button", {
			name: "COL",
		}));
		expect(tables()).toEqual(["COL batting", "COL pitching"]);
		expect(rows(within(panel).getByRole("table", {
			name: "COL pitching",
		}))[0]).toEqual(["Freeland, K", "4.2", "7", "6", "6", "2", "4", "1", "5.53", "1.52"]);
		expect(within(panel).getByRole("region", {
			name: "COL BASERUNNING",
		})).toBeInTheDocument();
		expect(within(panel).queryByRole("region", {
			name: "TOR FIELDING",
		})).toBeNull();
	});

	it("S207 AC 3 info lines: each detail and Game info line is its label in bold, a colon, then MLB's words (777861)", async () =>
	{
		const panel = await boxPanel(fixture(777861), "desktop");
		const info = within(panel).getByRole("region", {
			name: "Game info",
		});
		const [first] = within(info).getAllByTestId("info-line");
		expect(first!.textContent).toMatch(/^WP: /);
		expect(within(first!).getByText("WP:", {
			exact: false,
		})).toHaveStyle({
			fontWeight: "600",
		});
		expect(lines(panel, "Game info").at(-1)).toBe("May 19, 2025");
	});

	it("S207 AC 3 player links: each batter's and pitcher's name opens his MLB player page in a new tab (823823)", async () =>
	{
		const panel = await boxPanel(fixture(823823), "desktop");
		const batter = within(within(panel).getByRole("table", {
			name: "CHC batting",
		})).getByRole("link", {
			name: "Crow-Armstrong (CF)",
		});
		expect(batter).toHaveAttribute("href", "https://www.mlb.com/player/691718");
		expect(batter).toHaveAttribute("target", "_blank");
		expect(batter).toHaveAttribute("rel", "noreferrer nofollow");
		expect(within(within(panel).getByRole("table", {
			name: "CHC pitching",
		})).getByRole("link", {
			name: "Assad, J",
		})).toHaveAttribute("href", "https://www.mlb.com/player/665871");
	});

	it("S207 AC 3 kept labels: MLB's T and Att stay written out as Time and Attendance, as the owner asked for B433 (776836)", async () =>
	{
		const panel = await boxPanel(fixture(776836), "desktop");
		const labels = lines(panel, "Game info").map((line) => line.split(":")[0]);
		expect(labels).toEqual(expect.arrayContaining(["Time", "Attendance"]));
		expect(labels).not.toContain("T");
		expect(labels).not.toContain("Att");
	});

	it("S207 AC 3 kept periods: MLB's closing period is left off every line, as the Game info block already did (776854)", async () =>
	{
		const panel = await boxPanel(fixture(776854), "desktop");
		for (const name of ["TOR BATTING", "TOR notes", "COL FIELDING", "Game info"])
		{
			for (const line of lines(panel, name))
			{
				// A closing Jr. is the name's own (GIDP: Guerrero Jr.).
				if (!/Jr\.$/.test(line)) expect(line).not.toMatch(/\.$/);
			}
		}
	});

	it("S207 AC 3 kept linescore: v3's boxed linescore keeps the team abbreviations and every inning, eleven on the extra-innings game (776897)", async () =>
	{
		const panel = await boxPanel(fixture(776897), "desktop");
		const linescore = within(panel).getByRole("table", {
			name: "Linescore",
		});
		const [away, home] = within(linescore).getAllByTestId("linescore-row");
		expect(within(away!).getByRole("rowheader")).toHaveTextContent("TEX");
		expect(within(home!).getByRole("rowheader")).toHaveTextContent("SEA");
		expect(within(away!).getAllByTestId("inning-cell")).toHaveLength(11);
	});
});

