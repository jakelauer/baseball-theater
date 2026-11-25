/**
 * S170 AC 3: the game top bar's status marker (game-shell A7) per kind at each host pairing. Each
 * game's status is a recorded row of MLB's status list, `fixtures/raw/gamestatus.json`: `I` (in
 * progress), `IR` (a rain delay), `PR` (a start delayed by rain), `T` and `TR` (suspended), and `P`
 * (pre-game) and `F` (final), which show none.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it,
} from "vitest";
import type { LayoutVariant } from "../../layout/variant.js";
import { GameTopBar } from "./GameTopBar.js";

interface StatusRow
{
	statusCode: string;
	codedGameState: string;
	detailedState: string;
}

const ROWS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/raw/gamestatus.json"), "utf8")) as StatusRow[];

/** The recorded status for a code, as a game carries it. */
function status(code: string)
{
	const row = ROWS.find((r) => r.statusCode === code)!;
	return {
		codedGameState: row.codedGameState,
		detailedState: row.detailedState,
	};
}

function renderBar(code: string, variant: LayoutVariant)
{
	render(
		<MantineProvider>
			<MemoryRouter>
				<GameTopBar away="NYY" home="BOS" officialDate="2026-09-21" status={status(code)} variant={variant} />
			</MemoryRouter>
		</MantineProvider>,
	);
	return screen.getByTestId("game-topbar");
}

/** Whether the marker sits on its own line under the teams, rather than beside them. */
function onOwnLine(bar: HTMLElement): boolean
{
	const line = within(bar).queryByTestId("status-line");
	return line !== null && within(line).queryByTestId("status-marker") !== null;
}

afterEach(cleanup);

const KINDS: [string, string, string][] = [
	["I", "live", "LIVE"],
	["IR", "delayed", "Delayed · Rain"],
	["PR", "delayedStart", "Delayed start · Rain"],
	["T", "suspended", "Suspended"],
	["TR", "suspended", "Suspended · Rain"],
];

describe("GameTopBar's status marker (S170)", () =>
{
	for (const variant of ["mobile", "medium", "desktop"] as const)
	{
		for (const [code, kind, text] of KINDS)
		{
			it(`S170 AC 3 ${variant}: ${code} shows "${text}"${variant === "mobile" && kind !== "live" ? " on its own line" : " beside the teams"}`, () =>
			{
				const bar = renderBar(code, variant);
				const marker = within(bar).getByTestId("status-marker");
				expect(marker).toHaveAttribute("data-kind", kind);
				expect(within(bar).getByText(text)).toBeInTheDocument();
				expect(onOwnLine(bar)).toBe(variant === "mobile" && kind !== "live");
				// Beside the teams: the marker shares the team names' line.
				if (!onOwnLine(bar)) expect(within(within(bar).getByText("NYY @ BOS").parentElement!).getByTestId("status-marker")).toBe(marker);
			});
		}
	}

	it("S170 wrap (owner, 2026-11-23): on a phone the teams and marker side narrows and the date keeps its width, so a long reason wraps under the teams", () =>
	{
		const bar = renderBar("PI", "mobile");
		const line = within(bar).getByTestId("status-line");
		expect(within(line).getByText("Delayed start · Inclement Weather")).toBeInTheDocument();
		// Since B530 the date sits beside back, at the left, and the teams' side at the right.
		const side = within(bar).getByTestId("topbar-matchup");
		const date = within(bar).getByTestId("topbar-back");
		expect(side.style.flex).toBe("1 1 0%");
		expect(side.style.minWidth).toMatch(/^0(px)?$/);
		expect((line.parentElement as HTMLElement).style.minWidth).toMatch(/^0(px)?$/);
		expect(date).toHaveTextContent("2026");
		expect(date.style.flexShrink).toBe("0");
	});

	it("B530: the date sits beside the back button and the matchup after it, so back reads as returning to that day's games (#530)", () =>
	{
		// Owner, 2026-11-24: "The team @ team label and the date label in the top bar should swap, to show that the back button returns to the game list."
		// Design waived by the owner, 2026-11-25 ("Build it without a design").
		const bar = renderBar("F", "desktop");
		const back = within(bar).getByRole("link", {
			name: "Back to scoreboard",
		});
		const date = within(bar).getByText("Sep 21, 2026");
		const matchup = within(bar).getByText("NYY @ BOS");
		expect(back.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(date.compareDocumentPosition(matchup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	for (const code of ["P", "PW", "S", "F"])
	{
		it(`S170 AC 3 none: ${code} shows no marker at any pairing`, () =>
		{
			for (const variant of ["mobile", "medium", "desktop"] as const)
			{
				const bar = renderBar(code, variant);
				expect(within(bar).queryByTestId("status-marker")).toBeNull();
				expect(within(bar).queryByTestId("status-line")).toBeNull();
				cleanup();
			}
		});
	}
});
