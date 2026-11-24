// @bt-targets: web
/**
 * S138's design match (rule 22): Standings with the scoreboard's date control and calendar on it,
 * closed and open, at mobile, medium and desktop (desktop at 1200px, owner 2026-10-28). S138 has no
 * Standings frames of its own, so each capture is judged twice: the date control and calendar against
 * shell-scoreboard A8's `scoreboard-calendar-closed-<pairing>` / `-open-<pairing>`, and the rest of
 * the page against standings-search-settings A9's `standings-offseason-<pairing>`, the view and day
 * S130's own `standings-offseason-*` captures reproduce (`/standings?date=2026-12-01`, the clock on
 * 2026-12-10, the 2026 final table with A9's clinch letters and the Brewers' World Series box).
 *
 * The standings route is answered as S130's spec answers it; the calendar's December 2026 is an
 * off-season month (no games any day, so A8's "No games this month." line shows).
 *
 * Judge only S138's parts: the control's place (first under the header, above the heading) and that
 * it and its calendar are A8's. Expected differences: the month shown (December 2026, the day viewed,
 * where A8 draws September 2026) and so its dimmed days and no counts; the recording's teams and
 * figures where A9 draws sample records; the footer.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls,
} from "./helpers.js";

interface Team {
	teamId: number;
	abbreviation: string | null;
	clinched: boolean;
	clinchIndicator?: string | null;
	[field: string]: unknown;
}
interface Table {
	date: string;
	divisions: Array<{ teams: Team[];
		[field: string]: unknown; }>;
	[field: string]: unknown;
}

const RECORDING = JSON.parse(readFileSync(new URL("../../fixtures/standings-2026-09-05.json", import.meta.url), "utf8")) as Table;

/** The clinch letters A9's frames show (illustrative, on the recording's teams), as S130's spec gives them. */
const LETTERS: Record<string, string> = {
	NYY: "z",
	BAL: "w",
	CLE: "y",
	MIN: "w",
	SEA: "y",
	HOU: "w",
	PHI: "y",
	MIL: "z",
	LAD: "y",
	CHC: "w",
	SD: "w",
	NYM: "w",
};

const FINAL: Table = {
	...RECORDING,
	date: "2026-09-27",
	phase: "final",
	season: 2026,
	divisions: RECORDING.divisions.map((division) => ({
		...division,
		teams: division.teams.map((team) => (team.abbreviation && LETTERS[team.abbreviation]
			? {
				...team,
				clinched: true,
				clinchIndicator: LETTERS[team.abbreviation],
			}
			: team)),
	})),
};

const NOW = "2026-12-10T17:00:00.000Z";
const PATH = "/standings?date=2026-12-01";

/** Answer standings as the API would on 2026-12-01 (the off-season after the 2026 Series), and December 2026's month. */
async function serve(page: Page): Promise<void>
{
	await page.route("**/api/v1/standings*", (route) =>
	{
		const phases = new URL(route.request().url()).searchParams.getAll("includePhases").flatMap((p) => p.split(","));
		const named = (phase: string) => phases.length === 0 || phases.includes(phase);
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				...FINAL,
				fetchedAt: NOW,
				phase: "final",
				champion: {
					teamId: 158,
					name: "Milwaukee Brewers",
					season: 2026,
					wonOn: "2026-10-28",
				},
				phases: {
					spring: {
						startDate: "2026-02-20",
						endDate: "2026-03-24",
						...named("spring") && {
							table: FINAL,
						},
					},
					regularSeason: {
						startDate: "2026-03-25",
						endDate: "2026-09-27",
						...named("regularSeason") && {
							table: FINAL,
						},
					},
					playoffs: {
						startDate: "2026-09-28",
						endDate: "2026-10-28",
						...named("playoffs") && {
							table: {
								...FINAL,
								divisions: FINAL.divisions
									.map((division) => ({
										...division,
										teams: division.teams.filter((team) => team.clinched),
									}))
									.filter((division) => division.teams.length > 0),
							},
						},
					},
				},
			}),
		});
	});
	await page.route(/\/api\/v1\/schedule\/month\/2026-12/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			month: "2026-12",
			days: Array.from({
				length: 31,
			}, (_, index) => ({
				date: `2026-12-${String(index + 1).padStart(2, "0")}`,
				count: 0,
				teamIds: [],
				regularSeason: false,
			})),
		}),
	}));
}

for (const state of ["closed", "open"])
{
	for (const pairing of ["mobile", "medium", "desktop"])
	{
		const frame = `standings-calendar-${state}-${pairing}`;
		test(frame, async ({ page }, testInfo) =>
		{
			test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
			// The box's one sheen is drawn still in the frames; capture it settled.
			await page.emulateMedia({
				reducedMotion: "reduce",
			});
			await freezeClock(page, NOW);
			await serve(page);
			await page.goto(PATH);
			await page.getByTestId("division-table").first().waitFor();
			await page.evaluate(async () =>
			{
				await document.fonts.ready;
			});
			await hideDevControls(page);
			if (state === "open")
			{
				await page.getByTestId("date-selector").click();
				await page.getByText("No games this month.").waitFor();
				await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
			}
			await capture(page, testInfo, frame);
		});
	}
}
