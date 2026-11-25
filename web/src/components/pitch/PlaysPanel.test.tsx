/**
 * The Plays room (S41) on `fixtures/game-823823.json` + `fixtures/plays-823823.json`
 * (CHC @ MIA, 2026-09-05, Final 6–5): the boxed linescore, the inning sidebar, the
 * latest inning by default, its two halves, Runs, and an open at-bat built from Live's
 * cards, zone and pitch sequence. Then the accordion's open choreography and the open
 * at-bat's replay, on the first three at-bats.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtBat } from "@bt/domain";
import { pitcherLine } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../../api/game.js";
import { createQueryClient } from "../../api/queryClient.js";
import { GamePage } from "../../pages/GamePage.js";
import { BODY_FONT_PX, mantineFontPx } from "../../test/fontSize.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { AtBatViewer } from "./AtBatViewer.js";
import { PlaysPanel } from "./PlaysPanel.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const PLAYS: AtBat[] = JSON.parse(readFileSync(join(FIXTURES, "plays-823823.json"), "utf8"));

function game(plays: AtBat[] = PLAYS): GamePayload
{
	return {
		...JSON.parse(readFileSync(join(FIXTURES, "game-823823.json"), "utf8")),
		plays,
		fetchedAt: "2026-09-05T23:00:00.000Z",
		windowMode: "cache",
		version: 1,
		lastChangedAt: "2026-09-05T23:00:00.000Z",
	} as GamePayload;
}

function wrap(node: ReactNode)
{
	// The room reads `?play=` (S97), so it renders inside a router as the app does.
	return render(<MantineProvider><MemoryRouter>{node}</MemoryRouter></MantineProvider>);
}

/** Renders `/game/823823/plays` and returns the Plays tab panel. */
async function playsPanel(): Promise<HTMLElement>
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(game()))));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={["/game/823823/plays"]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<GamePage variant="mobile" />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
	await screen.findByRole("navigation", {
		name: "Inning sidebar",
	});
	return screen.getByRole("tabpanel");
}

/** The accordion item of one at-bat. */
function item(atBat: AtBat): HTMLElement
{
	return document.getElementById(`at-bat-${atBat.about.atBatIndex}`)!;
}

/** The control that opens or closes one at-bat. */
function control(panel: HTMLElement, atBat: AtBat): HTMLElement
{
	return within(panel).getByRole("button", {
		name: new RegExp(`${atBat.matchup.batter.fullName} —`),
	});
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("the Plays room on 823823 (S41)", () =>
{
	it("sidebar: the boxed linescore, and every inning 1–9 in order then Runs", async () =>
	{
		const panel = await playsPanel();
		expect(within(panel).getByRole("table", {
			name: "Linescore",
		})).toBeInTheDocument();
		const nav = within(panel).getByRole("navigation", {
			name: "Inning sidebar",
		});
		expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "Runs"]);
	});

	it("halves: the 9th by default, top and bottom; choosing 8 shows the 8th", async () =>
	{
		const panel = await playsPanel();
		const nav = within(panel).getByRole("navigation", {
			name: "Inning sidebar",
		});
		expect(within(nav).getByRole("button", {
			name: "9",
		})).toHaveAttribute("aria-current", "true");
		expect(within(panel).getByText("Top 9th · CHC")).toBeInTheDocument();
		expect(within(panel).getByText("Bottom 9th · MIA")).toBeInTheDocument();
		const ninth = PLAYS.filter((play) => play.about.inning === 9);
		expect(within(panel).getAllByRole("button", {
			name: /^(Top|Bot) 9 · /,
		})).toHaveLength(ninth.length);
		// A row shows batter and result.
		const first = ninth[0]!;
		expect(control(panel, first)).toHaveTextContent(`— ${first.result.event}`);

		fireEvent.click(within(nav).getByRole("button", {
			name: "8",
		}));
		expect(within(panel).getByText("Top 8th · CHC")).toBeInTheDocument();
		expect(within(panel).getByText("Bottom 8th · MIA")).toBeInTheDocument();
		expect(within(panel).queryByText("Top 9th · CHC")).toBeNull();
		expect(within(panel).getAllByRole("button", {
			name: /^(Top|Bot) 8 · /,
		})).toHaveLength(PLAYS.filter((play) => play.about.inning === 8).length);
	});

	it("default: no at-bat is open (owner, 2026-11-12: \"the plays view shouldn't expand any plays by default\")", async () =>
	{
		const panel = await playsPanel();
		expect(within(panel).queryByTestId("catcher-view")).toBeNull();
		for (const play of PLAYS.filter((p) => p.about.inning === 9)) expect(control(panel, play)).toHaveAttribute("aria-expanded", "false");
	});

	it("open: the 9th's last at-bat shows the zone and its pitches newest first", async () =>
	{
		vi.stubGlobal("scrollBy", vi.fn());
		const panel = await playsPanel();
		const last = PLAYS.filter((play) => play.about.inning === 9).at(-1)!;
		fireEvent.click(control(panel, last));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		const open = item(last);
		expect(within(open).getByTestId("catcher-view")).toBeInTheDocument();
		const rows = within(open).getAllByTestId("pitch-row");
		expect(rows).toHaveLength(last.pitches.length);
		expect(rows[0]).toHaveAttribute("data-expanded", "true");
		expect(within(panel).getAllByTestId("catcher-view")).toHaveLength(1);
	});

	it("expand: opening an at-bat shows its zone and one pitch row per pitch", async () =>
	{
		vi.stubGlobal("scrollBy", vi.fn());
		const panel = await playsPanel();
		const atBat = PLAYS.filter((play) => play.about.inning === 9)[0]!;
		fireEvent.click(control(panel, atBat));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		expect(within(item(atBat)).getAllByTestId("pitch-row")).toHaveLength(atBat.pitches.length);
	});

	it("cards: an early at-bat's cards total through that at-bat, not the game", async () =>
	{
		vi.stubGlobal("scrollBy", vi.fn());
		const panel = await playsPanel();
		fireEvent.click(within(panel).getByRole("button", {
			name: "1",
		}));
		const atBat = PLAYS.filter((play) => play.about.inning === 1).at(-1)!;
		fireEvent.click(control(panel, atBat));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		const through = pitcherLine(PLAYS, atBat.matchup.pitcher.id, atBat.about.atBatIndex);
		const whole = pitcherLine(PLAYS, atBat.matchup.pitcher.id, Number.MAX_SAFE_INTEGER);
		expect(through.pitches).toBeLessThan(whole.pitches);
		const card = within(item(atBat)).getByTestId("card-pitcher");
		expect(card).toHaveTextContent(`${through.pitches} Pitches (${through.strikes} S)`);
		expect(within(item(atBat)).getByTestId("card-batter")).toHaveTextContent(atBat.matchup.batter.fullName);
	});

	it("runs: the nine scoring plays in game order with the score after each, Conforto first and Stowers last; they open the same way", async () =>
	{
		vi.stubGlobal("scrollBy", vi.fn());
		const panel = await playsPanel();
		fireEvent.click(within(panel).getByRole("button", {
			name: "Runs",
		}));
		expect(within(panel).getByText("Scoring plays")).toBeInTheDocument();
		const rows = within(panel).getAllByRole("button", {
			name: /^(Top|Bot) \d+ · .* — /,
		});
		expect(rows).toHaveLength(9);
		expect(rows[0]).toHaveTextContent("Top 3 · M. Conforto — Home Run");
		expect(rows[0]).toHaveTextContent("CHC 1–0");
		expect(rows.at(-1)).toHaveTextContent("Bot 7 · K. Stowers — Home Run");
		expect(rows.at(-1)).toHaveTextContent("CHC 6–5");
		// Runs opens on nothing; a row opens like an inning's.
		expect(within(panel).queryByTestId("catcher-view")).toBeNull();
		const stowers = PLAYS.filter((play) => play.about.isScoringPlay).at(-1)!;
		fireEvent.click(rows.at(-1)!);
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(item(stowers)).getByTestId("catcher-view")).toBeInTheDocument();
		expect(within(item(stowers)).getByTestId("matchup-cards")).toBeInTheDocument();
	});

	it("says so when a game has no plays yet, or no runs yet", () =>
	{
		wrap(<PlaysPanel game={game([])} />);
		expect(screen.getByText("No pitch-level play data for this game yet.")).toBeInTheDocument();
		cleanup();
		wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		fireEvent.click(screen.getByRole("button", {
			name: "Runs",
		}));
		expect(screen.getByText("No scoring plays yet.")).toBeInTheDocument();
	});
});

describe("parked on the owner (design)", () =>
{
	// Parked: the ratified `plays-mobile` frame draws `9TH INNING` over `TOP 9TH · NYY`, and the
	// issue records no design waiver; the fix that finishes #526 makes this a plain test.
	it.fails("an inning chosen in the sidebar shows its half-inning headers but no inning header (#526)", async () =>
	{
		const panel = await playsPanel();
		expect(within(panel).getByText("Top 9th · CHC")).toBeInTheDocument();
		expect(within(panel).queryByText("9th inning")).toBeNull();
	});

	// Parked: the ratified `plays-mobile` frame and game-rooms DESIGN ("the pitch accordion
	// newest-first with the last pitch open") draw an open at-bat with its newest pitch expanded,
	// and the issue records no design waiver; the fix that finishes #522 makes this a plain test.
	it.fails("opening a play shows all of its pitches collapsed (#522)", async () =>
	{
		vi.stubGlobal("scrollBy", vi.fn());
		const panel = await playsPanel();
		const last = PLAYS.filter((play) => play.about.inning === 9).at(-1)!;
		fireEvent.click(control(panel, last));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(item(last)).getAllByTestId("pitch-row").map((row) => row.dataset.expanded)).toEqual(last.pitches.map(() => "false"));
	});
});

describe("Plays headers are never smaller than body text (#527)", () =>
{
	it("the view's heading and each half's header draw at body size or larger", async () =>
	{
		const panel = await playsPanel();
		for (const header of ["9th inning", "Top 9th · CHC", "Bottom 9th · MIA"])
		{
			expect(mantineFontPx(within(panel).getByText(header)), header).toBeGreaterThanOrEqual(BODY_FONT_PX);
		}
	});
});

describe("opening an at-bat (S64 choreography, kept in S41)", () =>
{
	it("the open one snaps shut, the tapped one scrolls to the top, then opens and replays each pitch in turn", () =>
	{
		vi.useFakeTimers();
		let now = 0;
		// One frame every 16 ms of timer time, each a tenth of a second of the replay.
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() =>
		{
			now += 100;
			tick(now);
		}, 16));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.spyOn(performance, "now").mockImplementation(() => now);
		const scrollBy = vi.fn();
		vi.stubGlobal("scrollBy", scrollBy);
		// The tapped at-bat sits 300px down the screen until it's scrolled to.
		let atTop = false;
		const scrolled: Element[] = [];
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element)
		{
			scrolled.push(this);
			atTop = true;
		});
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
			top: atTop ? 0 : 300,
		}) as DOMRect);
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		// Nothing starts open: open the last at-bat first, then tap the second.
		const first = item(PLAYS[2]!);
		expect(within(first).queryByTestId("catcher-view")).toBeNull();
		fireEvent.click(control(container, PLAYS[2]!));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(first).getByTestId("catcher-view")).toBeInTheDocument();
		scrolled.length = 0;
		scrollBy.mockClear();
		atTop = false;
		const second = PLAYS[1]!;
		const tapped = item(second);
		const button = control(container, second);
		fireEvent.click(button);
		// 1. The open one has shut, the tapped one held in place; 2. it scrolls up, not yet open.
		expect(within(first).queryByTestId("catcher-view")).toBeNull();
		expect(scrollBy).toHaveBeenCalledWith(0, 0);
		expect(scrolled).toEqual([tapped]);
		expect(within(tapped).queryByTestId("catcher-view")).toBeNull();
		// 3. The scroll ends: it opens, and once open its first pitch is thrown.
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(tapped).getByTestId("catcher-view")).toBeInTheDocument();
		act(() =>
		{
			for (const panel of tapped.querySelectorAll(".mantine-Accordion-panel"))
			{
				for (const el of [panel, panel.parentElement!])
				{
					const event = new Event("transitionend", {
						bubbles: true,
					});
					Object.defineProperty(event, "propertyName", {
						value: "height",
					});
					el.dispatchEvent(event);
				}
			}
		});
		act(() =>
		{
			vi.advanceTimersByTime(16);
		});
		expect(within(tapped).getByTestId("zone-ball")).toBeInTheDocument();
		// No pitch wears the "current pitch" ring while the at-bat replays.
		expect(tapped.querySelector('circle[r="10"]')).toBeNull();
		const located = second.pitches.filter((p) => p.pitchData);
		// The last pitch is selected throughout (its sequence row open), not the replay's.
		const lastPitch = located.at(-1)!;
		expect(within(tapped).getAllByTestId("pitch-row")[second.pitches.length - lastPitch.pitchNumber]).toHaveAttribute("data-expanded", "true");
		// ...and the rest follow, overlapping in the air, until the last has landed
		// (each step's effects run between acts).
		let most = 0;
		for (let step = 0; step < 40; step++)
		{
			act(() =>
			{
				vi.advanceTimersByTime(16);
			});
			most = Math.max(most, within(tapped).queryAllByTestId("zone-ball").length);
		}
		expect(most).toBeGreaterThan(1);
		const last = within(tapped).getByRole("button", {
			name: `Pitch ${lastPitch.pitchNumber}`,
		});
		expect(last).toHaveAttribute("aria-pressed", "true");
		// The last one gets the ring once it's over.
		expect(last.querySelector("circle")).toHaveAttribute("r", "10");

		// Closing it scrolls nothing.
		fireEvent.click(button);
		act(() =>
		{
			vi.runAllTimers();
		});
		expect(scrolled).toHaveLength(1);
		expect(within(tapped).queryByTestId("catcher-view")).toBeNull();
	});

	it("an at-bat already at the top opens straight away, its header carries the matchup once, and it replays with no open animation to end", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("scrollBy", vi.fn());
		const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[0]!;
		fireEvent.click(control(container, atBat));
		expect(scrolled).not.toHaveBeenCalled();
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		expect(control(container, atBat)).toHaveTextContent(`${atBat.matchup.batter.fullName} vs ${atBat.matchup.pitcher.fullName}`);
		expect(within(item(atBat)).getAllByText(atBat.result.description)).toHaveLength(1);
		act(() =>
		{
			vi.advanceTimersByTime(600);
		});
		expect(within(item(atBat)).getByTestId("zone-ball")).toBeInTheDocument();
	});

	it("a second tap before the scroll ends wins; opening again replays again", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("scrollBy", vi.fn());
		let atTop = false;
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() =>
		{
			atTop = true;
		});
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
			top: atTop ? 0 : 300,
		}) as DOMRect);
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const [first, second] = [PLAYS[0]!, PLAYS[1]!];
		fireEvent.click(control(container, second));
		atTop = false;
		fireEvent.click(control(container, first));
		act(() =>
		{
			window.dispatchEvent(new Event("scrollend"));
		});
		expect(within(item(second)).queryByTestId("catcher-view")).toBeNull();
		expect(within(item(first)).getByTestId("catcher-view")).toBeInTheDocument();
		act(() =>
		{
			vi.advanceTimersByTime(600);
		});
		expect(within(item(first)).getByTestId("zone-ball")).toBeInTheDocument();
	});

	it("an at-bat opens once its scroll settles, or when it can't scroll, without waiting a second for a scrollend that never comes (#420)", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() => tick(performance.now()), 16));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.stubGlobal("scrollBy", vi.fn());
		// The page can't scroll the tapped at-bat any higher (the last rows of a short page),
		// so the browser fires no `scrollend`.
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
			top: 300,
		}) as DOMRect);
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[2]!;
		fireEvent.click(control(container, atBat));
		// Nothing moves, so it waits out the frames a late-starting scroll gets (ten), not a second.
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		expect(within(item(atBat)).queryByTestId("catcher-view")).toBeNull();
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
	});

	it("an at-bat waits for a smooth scroll that starts late, then opens once it stops (#420)", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() => tick(performance.now()), 16));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.stubGlobal("scrollBy", vi.fn());
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
		// The scroll sits still on screen for its first frames, then moves partway and stops
		// short of the top (the last rows of a short page).
		let moved = false;
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
			top: moved ? 200 : 300,
		}) as DOMRect);
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[2]!;
		fireEvent.click(control(container, atBat));
		act(() =>
		{
			vi.advanceTimersByTime(90);
		});
		expect(within(item(atBat)).queryByTestId("catcher-view")).toBeNull();
		moved = true;
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
	});

	it("closing an at-bat doesn't start its replay again while it collapses (#420)", () =>
	{
		vi.useFakeTimers();
		let now = 0;
		// One frame every 16 ms of timer time, each a tenth of a second of the replay.
		vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() =>
		{
			now += 100;
			tick(now);
		}, 16));
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.stubGlobal("scrollBy", vi.fn());
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[0]!;
		const lastPitch = atBat.pitches.filter((p) => p.pitchData).at(-1)!;
		// `hidden`: a collapsing panel is aria-hidden, but its contents are still there.
		const ringed = () => within(item(atBat)).getByRole("button", {
			name: `Pitch ${lastPitch.pitchNumber}`,
			hidden: true,
		}).querySelector('circle[r="10"]') !== null;
		// Counted, not matched: the test runner can't print a stray SVG ball in a failure.
		const balls = () => within(item(atBat)).queryAllByTestId("zone-ball").length;
		// Already at the top, it opens at once; its replay starts and plays out in full.
		fireEvent.click(control(container, atBat));
		act(() =>
		{
			vi.advanceTimersByTime(600);
		});
		expect(within(item(atBat)).getByTestId("zone-ball")).toBeInTheDocument();
		for (let step = 0; step < 60; step++)
		{
			act(() =>
			{
				vi.advanceTimersByTime(16);
			});
		}
		expect(ringed()).toBe(true);
		// Closing keeps the finished at-bat as it was through the collapse: no replay.
		fireEvent.click(control(container, atBat));
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		expect(balls()).toBe(0);
		expect(ringed()).toBe(true);
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		expect(balls()).toBe(0);
		expect(ringed()).toBe(true);
	});

	it("closing an at-bat keeps its contents in the panel until the collapse ends, so the page doesn't jump (#420)", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("scrollBy", vi.fn());
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[0]!;
		fireEvent.click(control(container, atBat));
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		fireEvent.click(control(container, atBat));
		expect(control(container, atBat)).toHaveAttribute("aria-expanded", "false");
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect(within(item(atBat)).queryByTestId("catcher-view")).toBeNull();
	});

	it("switching from one open play to another opens the new one instantly, as the old one closes, so the page doesn't jump (#521)", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("scrollBy", vi.fn());
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const [first, second] = [PLAYS[0]!, PLAYS[1]!];
		const panel = (atBat: AtBat) => item(atBat).querySelector<HTMLElement>(".mantine-Accordion-panel");
		// The first play opens from nothing, with the open animation.
		fireEvent.click(control(container, first));
		expect(panel(first)?.style.transition).toContain("200ms");
		// Already at the top (jsdom's rects are all 0), the second opens at once: with no animation.
		fireEvent.click(control(container, second));
		expect(within(item(second)).getByTestId("catcher-view")).toBeInTheDocument();
		expect(panel(second)?.style.transition ?? "").toBe("");
		// Its pitches replay straight away, with no open animation to wait out.
		act(() =>
		{
			vi.advanceTimersByTime(20);
		});
		expect(within(item(second)).getByTestId("zone-ball")).toBeInTheDocument();
	});

	it("closing again after a quick reopen keeps the contents through the whole second collapse (#420)", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("scrollBy", vi.fn());
		const { container } = wrap(<PlaysPanel game={game(PLAYS.slice(0, 3))} />);
		const atBat = PLAYS[0]!;
		const button = control(container, atBat);
		// Open (at the top, so at once), close, reopen 100 ms in, close again 100 ms later.
		fireEvent.click(button);
		fireEvent.click(button);
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		fireEvent.click(button);
		act(() =>
		{
			vi.advanceTimersByTime(100);
		});
		fireEvent.click(button);
		// The first close's wait would have ended here; the second collapse is still running.
		act(() =>
		{
			vi.advanceTimersByTime(150);
		});
		expect(within(item(atBat)).getByTestId("catcher-view")).toBeInTheDocument();
		act(() =>
		{
			vi.advanceTimersByTime(200);
		});
		expect(within(item(atBat)).queryByTestId("catcher-view")).toBeNull();
	});
});

describe("AtBatViewer", () =>
{
	it("Animate pitch replays the selected pitch in the zone; choosing a pitch stops a replay of the at-bat", () =>
	{
		vi.useFakeTimers();
		const atBat = PLAYS.find((play) => play.pitches.filter((p) => p.pitchData).length >= 3)!;
		const { rerender } = wrap(<AtBatViewer plays={PLAYS} atBat={atBat} />);
		fireEvent.click(screen.getByRole("button", {
			name: "Animate pitch",
		}));
		act(() =>
		{
			vi.advanceTimersByTime(20);
		});
		expect(screen.getByTestId("zone-ball")).toBeInTheDocument();
		act(() =>
		{
			vi.runAllTimers();
		});
		// Replay the at-bat, then stop it by choosing the first pitch in the sequence.
		rerender(<MantineProvider><AtBatViewer plays={PLAYS} atBat={atBat} autoplay={1} /></MantineProvider>);
		const firstPitch = atBat.pitches[0]!;
		fireEvent.click(screen.getAllByTestId("pitch-row").at(-1)!.querySelector("button")!);
		act(() =>
		{
			vi.runAllTimers();
		});
		expect(screen.queryByTestId("zone-ball")).toBeNull();
		expect(screen.getByRole("button", {
			name: `Pitch ${firstPitch.pitchNumber}`,
		})).toHaveAttribute("aria-pressed", "true");
	});

	it("an open pitch closes when its header is tapped, leaving none open (#522)", () =>
	{
		const atBat = PLAYS.find((play) => play.pitches.length >= 2)!;
		wrap(<AtBatViewer plays={PLAYS} atBat={atBat} />);
		const open = screen.getAllByTestId("pitch-row").find((row) => row.dataset.expanded === "true")!;
		fireEvent.click(within(open).getByRole("button"));
		expect(screen.getAllByTestId("pitch-row").map((row) => row.dataset.expanded)).toEqual(atBat.pitches.map(() => "false"));
	});

	it("an at-bat with no pitches has nothing to animate", () =>
	{
		wrap(<AtBatViewer plays={PLAYS} atBat={{
			...PLAYS[0]!,
			pitches: [],
		}} autoplay={1} />);
		expect(screen.getByRole("button", {
			name: "Animate pitch",
		})).toBeDisabled();
	});
});
