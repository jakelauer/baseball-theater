// @bt-targets: web
/**
 * S130's design match (rule 22): Standings' three views as standings-search-settings A9 draws them —
 * `standings-spring`, `-spring-empty`, `-regular-blank`, `-playoffs-champion`, `-regular-champion` and
 * `-offseason`, each at mobile, medium and desktop (desktop at 1200px, owner 2026-10-28). The standings
 * route is answered the way the API answers it (S139): every phase's dates, a phase's table only when
 * `includePhases` names it, built from the committed recording `fixtures/standings-2026-09-05.json`
 * with the clinch letters A9's frames show; the page's clock is frozen on the frame's day.
 *
 * Judge only S130's parts: the heading and its "as of" words, the switch, the World Series box, the
 * tables (spring's without GB, the blank regular season, the playoffs list), the clinch marks and
 * legend, and spring's first morning. Expected differences: the recording's teams and figures (all six
 * divisions, the Rays leading the AL East) where the frames draw sample AL records; the spring table
 * is the recording's regular-season figures standing in for spring's; the footer's "Fetched … ago".
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls,
} from "./helpers.js";

interface Team {
	teamId: number;
	name: string;
	abbreviation: string | null;
	clinched: boolean;
	clinchIndicator?: string | null;
	[field: string]: unknown;
}
interface Table {
	date: string;
	phase?: string;
	season?: number;
	divisions: Array<{ divisionId: number | null;
		name: string | null;
		leagueId: number | null;
		teams: Team[]; }>;
	fetchedAt: string;
	windowMode: string;
}

const RECORDING = JSON.parse(readFileSync(new URL("../../fixtures/standings-2026-09-05.json", import.meta.url), "utf8")) as Table;

/** The 2026 final table with the clinch letters A9's frames show (illustrative, on the recording's teams). */
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

function withTeams(table: Table, map: (team: Team) => Team): Table
{
	return {
		...table,
		divisions: table.divisions.map((division) => ({
			...division,
			teams: division.teams.map(map),
		})),
	};
}

const FINAL = withTeams({
	...RECORDING,
	date: "2026-09-27",
	phase: "final",
	season: 2026,
}, (team) => (team.abbreviation && LETTERS[team.abbreviation]
	? {
		...team,
		clinched: true,
		clinchIndicator: LETTERS[team.abbreviation],
	}
	: team));

const SPRING = {
	...RECORDING,
	date: "2027-03-02",
	phase: "spring",
	season: 2027,
};

/** The new season before its first game (S139 AC 4): each division's teams in name order, 0-0, every other figure blank. */
const BLANK: Table = {
	...RECORDING,
	date: "2027-03-02",
	phase: "regularSeason",
	season: 2027,
	divisions: RECORDING.divisions.map((division) => ({
		...division,
		teams: [...division.teams].sort((a, b) => a.name.localeCompare(b.name)).map((team) => ({
			...team,
			wins: 0,
			losses: 0,
			pct: null,
			gamesBack: null,
			clinched: false,
			clinchIndicator: null,
		})),
	})),
};

/** The playoffs list (S139 AC 2): the regular season's clinched teams, a division with none left out. */
function playoffs(table: Table): Table
{
	return {
		...table,
		divisions: table.divisions
			.map((division) => ({
				...division,
				teams: division.teams.filter((team) => team.clinched),
			}))
			.filter((division) => division.teams.length > 0),
	};
}

interface Season {
	phase: string;
	spring: { startDate: string;
		endDate: string;
		table: Table; };
	regularSeason: { startDate: string;
		endDate: string;
		table: Table; };
	playoffs: { startDate: string;
		endDate: string; };
	champion: { teamId: number;
		name: string;
		season: number;
		wonOn: string; } | null;
}

const SEASON_2027 = {
	spring: {
		startDate: "2027-02-19",
		endDate: "2027-03-24",
	},
	regularSeason: {
		startDate: "2027-03-25",
		endDate: "2027-09-26",
	},
	playoffs: {
		startDate: "2027-09-27",
		endDate: "2027-10-31",
	},
};

const SPRING_DAY: Season = {
	phase: "spring",
	spring: {
		...SEASON_2027.spring,
		table: SPRING,
	},
	regularSeason: {
		...SEASON_2027.regularSeason,
		table: BLANK,
	},
	playoffs: SEASON_2027.playoffs,
	champion: null,
};

const SPRING_MORNING: Season = {
	...SPRING_DAY,
	phase: "final",
	spring: {
		...SEASON_2027.spring,
		table: {
			...SPRING,
			date: "2027-02-19",
			divisions: [],
		},
	},
};

const AFTER_SERIES: Season = {
	phase: "final",
	spring: {
		startDate: "2026-02-20",
		endDate: "2026-03-24",
		table: {
			...SPRING,
			season: 2026,
		},
	},
	regularSeason: {
		startDate: "2026-03-25",
		endDate: "2026-09-27",
		table: FINAL,
	},
	playoffs: {
		startDate: "2026-09-28",
		endDate: "2026-10-28",
	},
	champion: {
		teamId: 158,
		name: "Milwaukee Brewers",
		season: 2026,
		wonOn: "2026-10-28",
	},
};

/** Answer `/api/v1/standings` as the API would for `season`, naming each phase's table only when asked for. */
async function serve(page: Page, season: Season, fetchedAt: string): Promise<void>
{
	await page.route("**/api/v1/standings*", (route) =>
	{
		const phases = new URL(route.request().url()).searchParams.getAll("includePhases").flatMap((p) => p.split(","));
		const named = (phase: string) => phases.length === 0 || phases.includes(phase);
		const regular = season.regularSeason.table;
		const top = season.phase === "spring" ? season.spring.table : regular;
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				...top,
				fetchedAt,
				phase: season.phase,
				champion: season.champion,
				phases: {
					spring: {
						startDate: season.spring.startDate,
						endDate: season.spring.endDate,
						...named("spring") && {
							table: season.spring.table,
						},
					},
					regularSeason: {
						startDate: season.regularSeason.startDate,
						endDate: season.regularSeason.endDate,
						...named("regularSeason") && {
							table: regular,
						},
					},
					playoffs: {
						startDate: season.playoffs.startDate,
						endDate: season.playoffs.endDate,
						...named("playoffs") && {
							table: playoffs(regular),
						},
					},
				},
			}),
		});
	});
}

/** Each frame: the season it shows, the address, the page's "now" (MLB's today is its New York day) and what to wait for. */
const FRAMES: Array<{ view: string;
	season: Season;
	path: string;
	now: string;
	ready: "table" | "spring-empty"; }> = [
	{
		view: "spring",
		season: SPRING_DAY,
		path: "/standings?date=2027-03-02",
		now: "2027-03-10T17:00:00.000Z",
		ready: "table",
	},
	{
		view: "spring-empty",
		season: SPRING_MORNING,
		path: "/standings",
		now: "2027-02-19T17:00:00.000Z",
		ready: "spring-empty",
	},
	{
		view: "regular-blank",
		season: SPRING_DAY,
		path: "/standings?view=regularSeason",
		now: "2027-03-02T17:00:00.000Z",
		ready: "table",
	},
	{
		view: "playoffs-champion",
		season: AFTER_SERIES,
		path: "/standings",
		now: "2026-10-29T17:00:00.000Z",
		ready: "table",
	},
	{
		view: "regular-champion",
		season: AFTER_SERIES,
		path: "/standings?view=regularSeason",
		now: "2026-10-29T17:00:00.000Z",
		ready: "table",
	},
	{
		view: "offseason",
		season: AFTER_SERIES,
		path: "/standings?date=2026-12-01",
		now: "2026-12-10T17:00:00.000Z",
		ready: "table",
	},
];

for (const {
	view, season, path, now, ready,
} of FRAMES)
{
	for (const pairing of ["mobile", "medium", "desktop"])
	{
		const frame = `standings-${view}-${pairing}`;
		test(frame, async ({ page }, testInfo) =>
		{
			test.skip(testInfo.project.name !== pairing, `${frame} is drawn at another pairing`);
			// The box's one sheen is drawn still in the frames; capture it settled.
			await page.emulateMedia({
				reducedMotion: "reduce",
			});
			await freezeClock(page, now);
			await serve(page, season, now);
			await page.goto(path);
			await page.getByTestId(ready === "table" ? "division-table" : "spring-empty").first().waitFor();
			await page.evaluate(async () =>
			{
				await document.fonts.ready;
			});
			await hideDevControls(page);
			await capture(page, testInfo, frame);
		});
	}
}
