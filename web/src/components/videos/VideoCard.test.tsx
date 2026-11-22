/**
 * S145 (game-shell A6): a card's meta line by the play-wins rule — the date then the inning pill
 * (`Top 6 →`, spoken "Open play - Top of 6th inning") for a clip with a play, `Kind · date` for one
 * without — the pill opening the play while the rest of the card plays the clip, in grid and list.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import {
	cleanup, fireEvent, render, screen, within,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes, useLocation,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { formatDate } from "../../format/datetime.js";
import type { Video } from "./VideoCard.js";
import { VideoCard } from "./VideoCard.js";
import type { PlayLink } from "./playLink.js";
import { playInningLink } from "./playLink.js";
import { videoMeta } from "./videoMeta.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PILL_CSS = readFileSync(join(HERE, "PlayInningPill.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DATE = "2026-09-21T22:07:38.195Z";
const SHOWN = formatDate(DATE);

const clip = (over: Partial<Video> = {}): Video => ({
	id: "clip",
	playId: "abc",
	title: "Aaron Judge's solo home run (52)",
	blurb: null,
	duration: "00:00:29",
	imageUrl: null,
	playbackUrl: null,
	kind: "highlight",
	date: DATE,
	...over,
});
const TOP6 = playInningLink({
	gamePk: 823823,
	playId: "abc",
	halfInning: "top",
	inning: 6,
});
const BOT3 = playInningLink({
	gamePk: 823823,
	playId: "d e/f",
	halfInning: "bottom",
	inning: 3,
});

function Where()
{
	const location = useLocation();
	return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderCard(video: Video, layout: "grid" | "list", playLink: PlayLink | null)
{
	const onPlay = vi.fn();
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={["/game/823823/videos"]}>
				<Routes>
					<Route path="*" element={<><VideoCard video={video} layout={layout} onPlay={onPlay} playLink={playLink} /><Where /></>} />
				</Routes>
			</MemoryRouter>
		</MantineProvider>,
	);
	const card = screen.getByTestId("video-card");
	return {
		onPlay,
		card,
		// The card's whole box: the button and, with a play, the pill beside it.
		box: card.parentElement!,
	};
}

/** The declarations of the first CSS rule whose selector matches. */
function rule(selector: RegExp): string
{
	const hit = [...PILL_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => selector.test(sel!));
	return hit?.[2] ?? "";
}

afterEach(() =>
{
	cleanup();
});

const LAYOUTS = ["grid", "list"] as const;

describe("VideoCard meta line (S145)", () =>
{
	it.each(LAYOUTS)("S145 AC 1: %s: a clip with a play reads its date then the Top 6 → pill, no kind word, linking to the play", (layout) =>
	{
		const { box } = renderCard(clip(), layout, TOP6);
		const meta = within(box).getByTestId("video-meta");
		expect(meta.textContent).toBe(SHOWN);
		expect(box.textContent).not.toMatch(/Highlight/);
		expect(meta.getAttribute("style")).toMatch(/color: var\(--bt-muted\)/);
		const pill = within(box).getByRole("link", {
			name: "Open play - Top of 6th inning",
		});
		expect(pill.textContent).toBe("Top 6 →");
		expect(pill.getAttribute("href")).toBe(TOP6.to);
		expect(TOP6.to).toBe("/game/823823/plays?play=abc");
		// S144's colours: the face in the date's muted colour on the raised fill.
		expect(pill.querySelector(".bt-play-pill-face")).not.toBeNull();
		expect(rule(/^\s*\.bt-play-pill-face\s*$/)).toMatch(/background-color:\s*var\(--bt-raised\);/);
		expect(rule(/^\s*\.bt-play-pill-face\s*$/)).toMatch(/\bcolor:\s*var\(--bt-muted\);/);
		// On the meta line (the same grid row, after the date), not a line of its own under the card.
		expect(pill.style.gridRow).toBe(meta.style.gridRow);
		expect(Number(pill.style.gridColumn)).toBe(Number(meta.style.gridColumn) + 1);
		expect(within(box).getAllByRole("link")).toHaveLength(1);
	});

	it.each(LAYOUTS)("S145 AC 1: %s: a bottom-half play reads Bot 3 → and is spoken Bottom of 3rd inning", (layout) =>
	{
		const { box } = renderCard(clip(), layout, BOT3);
		const pill = within(box).getByRole("link", {
			name: "Open play - Bottom of 3rd inning",
		});
		expect(pill.textContent).toBe("Bot 3 →");
		expect(pill.getAttribute("href")).toBe("/game/823823/plays?play=d%20e%2Ff");
	});

	it.each(LAYOUTS)("S145 AC 1: %s: a clip with a play but no kind and no date still shows the pill, alone", (layout) =>
	{
		const { box } = renderCard(clip({
			kind: undefined,
			date: undefined,
		}), layout, TOP6);
		expect(within(box).queryByTestId("video-meta")).toBeNull();
		expect(within(box).getByRole("link", {
			name: "Open play - Top of 6th inning",
		}).textContent).toBe("Top 6 →");
	});

	it.each([
		["a video-kind clip", {
			kind: "video",
		}],
		["a recap", {
			kind: "recap",
		}],
		["a clip with no kind", {
			kind: undefined,
		}],
	] as const)("S145 AC 1: a play wins: %s with a play reads the date and the pill, no kind word", (_, over) =>
	{
		const { box } = renderCard(clip(over), "grid", TOP6);
		expect(within(box).getByTestId("video-meta").textContent).toBe(SHOWN);
		expect(within(box).getByRole("link", {
			name: "Open play - Top of 6th inning",
		})).toBeInTheDocument();
		expect(box.textContent).not.toMatch(/Video ·|Recap|Highlight/);
	});

	it.each([
		["highlight", "Highlight"],
		["recap", "Recap"],
		["condensed", "Condensed game"],
	] as const)("S145 AC 2: a %s with no play keeps its Kind · date line, muted, with no link", (kind, word) =>
	{
		for (const layout of LAYOUTS)
		{
			const { box, card } = renderCard(clip({
				kind,
				playId: null,
			}), layout, null);
			const meta = within(box).getByTestId("video-meta");
			expect(meta.textContent).toBe(`${word} · ${SHOWN}`);
			expect(meta.getAttribute("style")).toMatch(/color: var\(--bt-muted\)/);
			expect(card.contains(meta)).toBe(true);
			expect(within(box).queryByRole("link")).toBeNull();
			cleanup();
		}
	});

	it.each(LAYOUTS)("S145 AC 3: %s: the pill opens the play without playing the clip; the title and the date play it", (layout) =>
	{
		const { onPlay, box } = renderCard(clip(), layout, TOP6);
		fireEvent.click(within(box).getByText("Aaron Judge's solo home run (52)"));
		expect(onPlay).toHaveBeenCalledTimes(1);
		fireEvent.click(within(box).getByTestId("video-meta"));
		expect(onPlay).toHaveBeenCalledTimes(2);
		fireEvent.click(within(box).getByRole("link", {
			name: "Open play - Top of 6th inning",
		}));
		expect(screen.getByTestId("where").textContent).toBe("/game/823823/plays?play=abc");
		expect(onPlay).toHaveBeenCalledTimes(2);
	});

	it.each(LAYOUTS)("S145 AC 3: %s: one button for the clip; the pill is in no button and no zoom host, and follows the button in focus order", (layout) =>
	{
		const { card, box } = renderCard(clip(), layout, TOP6);
		expect(within(box).getAllByRole("button")).toEqual([card]);
		expect(card.getAttribute("aria-label")).toBe("Play Aaron Judge's solo home run (52)");
		const pill = within(box).getByRole("link", {
			name: "Open play - Top of 6th inning",
		});
		expect(pill.closest("button")).toBeNull();
		expect(pill.closest(".bt-zoom-host")).toBeNull();
		expect(card.classList.contains("bt-zoom-host")).toBe(true);
		expect(card.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(pill.tabIndex).toBeLessThanOrEqual(0);
		expect(card.tabIndex).toBeLessThanOrEqual(0);
	});

	it("S145 AC 3: the pill's hit area is at least 24×24 px and its hover fill is var(--bt-raised-current)", () =>
	{
		const { box } = renderCard(clip(), "grid", TOP6);
		expect(within(box).getByRole("link").classList.contains("bt-play-pill")).toBe(true);
		const pill = rule(/^\s*\.bt-play-pill\s*$/);
		expect(pill).toMatch(/min-width:\s*24px;/);
		expect(pill).toMatch(/min-height:\s*24px;/);
		expect(rule(/\.bt-play-pill:hover \.bt-play-pill-face/)).toMatch(/background-color:\s*var\(--bt-raised-current\);/);
	});
});

describe("videoMeta, the meta line's play-wins rule (S145)", () =>
{
	it("S145 AC 5: date then pill; pill alone with no date; Kind · date with no play; nothing when all are missing", () =>
	{
		expect(videoMeta(clip(), TOP6)).toEqual({
			text: SHOWN,
			pill: TOP6,
		});
		expect(videoMeta(clip({
			kind: "recap",
			date: undefined,
		}), TOP6)).toEqual({
			text: null,
			pill: TOP6,
		});
		expect(videoMeta(clip(), null)).toEqual({
			text: `Highlight · ${SHOWN}`,
			pill: null,
		});
		expect(videoMeta(clip({
			kind: "condensed",
			date: undefined,
		}), null)).toEqual({
			text: "Condensed game",
			pill: null,
		});
		expect(videoMeta(clip({
			kind: undefined,
		}), undefined)).toEqual({
			text: SHOWN,
			pill: null,
		});
		expect(videoMeta(clip({
			kind: undefined,
			date: undefined,
		}), null)).toBeNull();
	});
});
