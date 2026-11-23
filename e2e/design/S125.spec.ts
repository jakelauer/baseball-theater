// @bt-targets: web, functions
/**
 * S125's design match (rule 22): the scoreboard's calendar date picker, shell-scoreboard A8's 29
 * `scoreboard-calendar-*` frames (desktop at 1200px, owner 2026-10-28): closed, open, off-day
 * marks (and the phone's tap-and-hold), the invalid and too-early typed dates, a month loading, a
 * month whose counts failed, an off-season month, the earliest month, and the short phone sheet.
 *
 * The month answers are stubbed with `page.route` to A8's illustrative September 2026 (`15 gm`,
 * `9 gm` / `10 gm` on Mondays and Thursdays, the 28th without games, `4 gm` on the Wild Card
 * days), as are the scoreboard's default day (2026-09-21, the frames' "today") and the account's
 * settings (no favorites, or the Yankees and Mets for the off-day frames). The clock is frozen on
 * 2026-09-21 so `latestScheduleMonth` answers for these months.
 *
 * Judge only S125's parts: the date button and the calendar. Expected differences: the scoreboard
 * behind it (the fixture server's day against the frames' sample games), the footer and other
 * chrome later amendments changed (A8, ## Frames: everything around the calendar is a shared
 * component as it stood on 2026-11-19), and a scheduled row's slot (A16).
 */
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { test } from "@playwright/test";
import {
	capture, freezeClock, hideDevControls, signInDev,
} from "./helpers.js";

const DAY = "/games/2026-09-21";
const YANKEES = 147;
const METS = 121;
const OTHER = [111, 112];

/** A8's September 2026: each day's count, and which of the Yankees and Mets play it. */
function september(): unknown
{
	const red = [4, 18, 21];
	const yellow = [11, 24, 29, 30];
	return {
		month: "2026-09",
		days: Array.from({
			length: 30,
		}, (_, index) =>
		{
			const n = index + 1;
			const date = `2026-09-${String(n).padStart(2, "0")}`;
			const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
			if (n === 28) return {
				date,
				count: 0,
				teamIds: [],
				regularSeason: false,
			};
			let count = weekday === 1 || weekday === 4 ? 9 + (n % 2) : 15;
			if (n >= 29) count = 4;
			const teamIds = red.includes(n) ? OTHER : yellow.includes(n) ? [YANKEES, ...OTHER] : [YANKEES, METS, ...OTHER];
			return {
				date,
				count,
				teamIds,
				regularSeason: true,
			};
		}),
	};
}

/** A month whose every day `fill` describes. */
function month(key: string, length: number, fill: (day: number) => number | null): unknown
{
	return {
		month: key,
		days: Array.from({
			length,
		}, (_, index) =>
		{
			const count = fill(index + 1);
			return {
				date: `${key}-${String(index + 1).padStart(2, "0")}`,
				count,
				teamIds: count === null ? null : count > 0 ? OTHER : [],
				regularSeason: count === null ? null : count > 0,
			};
		}),
	};
}

type MonthStub = unknown | "pending" | number;

/** Answer the month route from `months` (September 2026 by default), the default day, and the account's favorites. */
async function stub(page: Page, favorites: number[], months: Record<string, MonthStub> = {}): Promise<void>
{
	const answers: Record<string, MonthStub> = {
		"2026-09": september(),
		...months,
	};
	await page.route(/\/api\/v1\/schedule\/month\/([^/?]+)/, async (route) =>
	{
		const key = /month\/([^/?]+)/.exec(route.request().url())![1]!;
		const answer = answers[key];
		if (answer === "pending") return;
		if (typeof answer === "number" || answer === undefined)
		{
			await route.fulfill({
				status: typeof answer === "number" ? answer : 500,
				contentType: "application/json",
				body: JSON.stringify({
					error: "unavailable",
				}),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(answer),
		});
	});
	await page.route(/\/api\/v1\/scoreboard\/default-date/, (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			date: "2026-09-21",
		}),
	}));
	await page.route(/\/api\/v1\/me\/settings/, (route) =>
	{
		if (route.request().method() !== "GET") return route.fallback();
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				favoriteTeamIds: favorites,
				opensFirst: "videos",
				gameRowSlot: "status",
				collapseNonFavorites: false,
				hideScores: false,
				videoPlayer: "dialog",
				version: 1_000_000,
			}),
		});
	});
}

async function openCalendar(page: Page): Promise<void>
{
	await page.getByTestId("date-selector").click();
	await page.getByTestId("calendar-panel").waitFor();
	// Let the sheet's slide and its focus trap finish before anything is typed or tapped.
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
	await page.waitForTimeout(300);
}

async function typeDate(page: Page, text: string): Promise<void>
{
	const field = page.locator("#calendar-date-field");
	await field.fill(text);
	await field.press("Enter");
}

/** Each state: what it stubs, the favorites, and how it gets there from the open page. */
interface State
{
	favorites?: number[];
	months?: Record<string, MonthStub>;
	act: (page: Page) => Promise<void>;
	/** The frame draws a pointer over a day: photograph it without parking the pointer. */
	hovered?: boolean;
}

const STATES: Record<string, State> = {
	closed: {
		act: async (page) =>
		{
			await page.getByTestId("date-selector").waitFor();
		},
	},
	open: {
		act: openCalendar,
	},
	offday: {
		favorites: [YANKEES, METS],
		act: openCalendar,
	},
	invalid: {
		act: async (page) =>
		{
			await openCalendar(page);
			await typeDate(page, "Feb 30, 2026");
			await page.getByText("Not a date.").waitFor();
		},
	},
	tooearly: {
		act: async (page) =>
		{
			await openCalendar(page);
			await typeDate(page, "Apr 17, 1901");
			await page.getByText("No data before Apr 18, 1901.").waitFor();
		},
	},
	loading: {
		months: {
			"2026-08": "pending",
		},
		act: async (page) =>
		{
			await openCalendar(page);
			await page.getByRole("button", {
				name: "Previous month",
			}).click();
			await page.getByTestId("count-loading").first().waitFor();
		},
	},
	failed: {
		months: {
			"2026-08": 500,
		},
		act: async (page) =>
		{
			await openCalendar(page);
			await page.getByRole("button", {
				name: "Previous month",
			}).click();
			await page.getByTestId("day-2026-08-31").waitFor();
		},
	},
	offseason: {
		months: {
			"2026-12": month("2026-12", 31, () => 0),
		},
		act: async (page) =>
		{
			await openCalendar(page);
			await page.getByLabel("Month", {
				exact: true,
			}).selectOption("12");
			await page.getByText("No games this month.").waitFor();
		},
	},
	earliest: {
		months: {
			"1901-04": month("1901-04", 30, (day) => (day < 18 ? null : 4 + (day % 5))),
		},
		act: async (page) =>
		{
			await openCalendar(page);
			await page.getByLabel("Year", {
				exact: true,
			}).selectOption("1901");
			await page.getByLabel("Month", {
				exact: true,
			}).selectOption("4");
			await page.getByText("4 gm").first().waitFor();
		},
	},
};

/** Photograph `frame` as `capture` does, but with the pointer left where the state put it (a hover). */
async function captureHovered(page: Page, testInfo: TestInfo, frame: string): Promise<void>
{
	const path = process.env.BT_DESIGN_CAPTURE === "1"
		? join(import.meta.dirname, "../../docs/v3/design-checks/S125", `${frame}.png`)
		: testInfo.outputPath(`${frame}.png`);
	await page.waitForTimeout(500);
	await page.screenshot({
		path,
		fullPage: true,
	});
}

const FRAMES: [string, State][] = [];
for (const pairing of ["mobile", "medium", "desktop"])
{
	for (const [name, state] of Object.entries(STATES))
	{
		if (name === "offday" && pairing !== "mobile")
		{
			FRAMES.push([`scoreboard-calendar-offday-${pairing}`, {
				...state,
				hovered: true,
				act: async (page) =>
				{
					await openCalendar(page);
					await page.getByTestId("day-2026-09-18").hover();
					await page.getByText("Off day: Yankees, Mets").waitFor();
				},
			}]);
			continue;
		}
		FRAMES.push([`scoreboard-calendar-${name}-${pairing}`, state]);
	}
}
FRAMES.push(["scoreboard-calendar-offday-hold-mobile", {
	favorites: [YANKEES, METS],
	act: async (page) =>
	{
		await openCalendar(page);
		await page.getByTestId("day-2026-09-18").dispatchEvent("touchstart");
		await page.getByText("Off day: Yankees, Mets").waitFor();
	},
}]);
FRAMES.push(["scoreboard-calendar-short-mobile", {
	act: openCalendar,
}]);

for (const [frame, state] of FRAMES)
{
	test(frame, async ({ page }, testInfo) =>
	{
		test.skip(!frame.endsWith(`-${testInfo.project.name}`), `${frame} is drawn at another pairing`);
		if (frame === "scoreboard-calendar-short-mobile")
		{
			await page.setViewportSize({
				width: 390,
				height: 568,
			});
		}
		await freezeClock(page, "2026-09-21T23:00:00.000Z");
		await stub(page, state.favorites ?? [], state.months);
		await signInDev(page, DAY);
		await page.getByTestId("date-selector").waitFor();
		await page.evaluate(async () =>
		{
			await document.fonts.ready;
		});
		await state.act(page);
		await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
		await hideDevControls(page);
		if (state.hovered) await captureHovered(page, testInfo, frame);
		else await capture(page, testInfo, frame);
	});
}
