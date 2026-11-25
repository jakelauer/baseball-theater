/**
 * S145 (game-shell A6): a card's meta line by the play-wins rule — the date then the inning pill
 * (`Top 6 →`, spoken "Top 6: open play, top of 6th inning") for a clip with a play, `Kind · date` for one
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
	afterEach, describe, expect, it,
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
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={["/game/823823/videos"]}>
				<Routes>
					<Route path="*" element={<><VideoCard video={video} layout={layout} href={`/game/823823/videos?clip=${video.id}`} playLink={playLink} /><Where /></>} />
				</Routes>
			</MemoryRouter>
		</MantineProvider>,
	);
	const card = screen.getByTestId("video-card");
	return {
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
		const { box, card } = renderCard(clip(), layout, TOP6);
		const meta = within(box).getByTestId("video-meta");
		expect(meta.textContent).toBe(SHOWN);
		expect(box.textContent).not.toMatch(/Highlight/);
		expect(meta.getAttribute("style")).toMatch(/color: var\(--bt-muted\)/);
		const pill = within(box).getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
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
		// The card's own link (to its clip, #424), then the pill.
		expect(within(box).getAllByRole("link")).toEqual([card, pill]);
	});

	it.each(LAYOUTS)("S145 AC 1: %s: a bottom-half play reads Bot 3 → and is spoken Bottom of 3rd inning", (layout) =>
	{
		const { box } = renderCard(clip(), layout, BOT3);
		const pill = within(box).getByRole("link", {
			name: "Bot 3: open play, bottom of 3rd inning",
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
			name: "Top 6: open play, top of 6th inning",
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
			name: "Top 6: open play, top of 6th inning",
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
			// No pill: the card's own link (to its clip, #424) is the only one.
			expect(within(box).getAllByRole("link")).toEqual([card]);
			cleanup();
		}
	});

	it.each(LAYOUTS)("S145 AC 3: %s: the pill opens the play without playing the clip; the title and the date play it", (layout) =>
	{
		// The card's link opens its clip (`?clip=`, #424); the pill goes to the play and opens no clip.
		const { box } = renderCard(clip(), layout, TOP6);
		const where = () => screen.getByTestId("where").textContent;
		fireEvent.click(within(box).getByText("Aaron Judge's solo home run (52)"));
		expect(where()).toBe(`/game/823823/videos?clip=${clip().id}`);
		cleanup();
		const again = renderCard(clip(), layout, TOP6);
		fireEvent.click(within(again.box).getByTestId("video-meta"));
		expect(where()).toBe(`/game/823823/videos?clip=${clip().id}`);
		cleanup();
		const pill = renderCard(clip(), layout, TOP6);
		fireEvent.click(within(pill.box).getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		}));
		expect(where()).toBe("/game/823823/plays?play=abc");
	});

	it.each(LAYOUTS)("S145 AC 3: %s: one link for the clip (#424); the pill is outside it and any zoom host, and follows it in focus order", (layout) =>
	{
		const { card, box } = renderCard(clip(), layout, TOP6);
		expect(within(box).queryAllByRole("button")).toEqual([]);
		expect(card.getAttribute("aria-label")).toBe("Play Aaron Judge's solo home run (52)");
		const pill = within(box).getByRole("link", {
			name: "Top 6: open play, top of 6th inning",
		});
		expect(card.contains(pill)).toBe(false);
		expect(pill.closest(".bt-zoom-host")).toBeNull();
		expect(card.classList.contains("bt-zoom-host")).toBe(true);
		expect(card.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(pill.tabIndex).toBeLessThanOrEqual(0);
		expect(card.tabIndex).toBeLessThanOrEqual(0);
	});

	it("S145 AC 3: the pill's hit area is at least 24×24 px and its hover fill is var(--bt-raised-current)", () =>
	{
		const { box } = renderCard(clip(), "grid", TOP6);
		expect(within(box).getByRole("link", {
			name: /open play/,
		}).classList.contains("bt-play-pill")).toBe(true);
		const pill = rule(/^\s*\.bt-play-pill\s*$/);
		expect(pill).toMatch(/min-width:\s*24px;/);
		expect(pill).toMatch(/min-height:\s*24px;/);
		// A6, Touch: the hit area is "padded around the pill, not drawn", so a tap paints no highlight on it.
		expect(pill).toMatch(/-webkit-tap-highlight-color:\s*transparent;/);
		expect(rule(/\.bt-play-pill:hover \.bt-play-pill-face/)).toMatch(/background-color:\s*var\(--bt-raised-current\);/);
	});

	it("S145 AC 3: no stylesheet paints the pill's hit box on hover or focus", () =>
	{
		const { box } = renderCard(clip(), "grid", TOP6);
		const pill = within(box).getByRole("link", {
			name: /open play/,
		});
		const scanned = paintingStateSelectors();
		// Proves the scan reached the site's link wash rules (styles.css's Anchor hover, inside `@media (hover: hover)`, and its focus list).
		expect(scanned.filter((selector) => selector.includes(".mantine-Anchor-root:not(:disabled)") && selector.includes(":hover"))).toHaveLength(1);
		expect(scanned.filter((selector) => /^\.mantine-Anchor-root:focus-visible$/.test(selector))).toHaveLength(1);
		const painting = scanned.filter((selector) => pill.matches(selector.replace(STATE, "").replace(/\(\s*\)/g, "(*)")));
		expect(painting).toEqual([]);
	});

	it("S145 AC 3: keyboard focus fills the pill like hover and rings the pill alone", () =>
	{
		const { box } = renderCard(clip(), "grid", TOP6);
		expect(within(box).getByRole("link", {
			name: /open play/,
		}).classList.contains("mantine-focus-auto")).toBe(false);
		expect(rule(/^\s*\.bt-play-pill:focus-visible\s*$/)).toMatch(/outline:\s*none;/);
		const face = rule(/^\s*\.bt-play-pill:focus-visible \.bt-play-pill-face\s*$/);
		expect(face).toMatch(/background-color:\s*var\(--bt-raised-current\);/);
		expect(face).toMatch(/outline:\s*calc\(0\.125rem \* var\(--mantine-scale\)\) solid var\(--mantine-primary-color-filled\);/);
		// Keyboard focus shows on any screen, so its rule isn't inside the hover-only block.
		expect(mediaBlock(/hover:\s*hover/)).not.toMatch(/focus-visible/);
	});

	it("S145: reduced motion turns off the pill's fill transition", () =>
	{
		expect(mediaBlock(/prefers-reduced-motion:\s*reduce/)).toMatch(/\.bt-play-pill-face\s*\{[^}]*transition:\s*none;/);
	});
});

const SITE_CSS = readFileSync(join(HERE, "../../styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** The interaction states a rule can paint in; jsdom evaluates none of them, so the scan removes them before matching. */
const STATE = /:(?:hover|focus-visible|focus-within|focus)(?![\w-])/g;

/**
 * Every selector, in the site stylesheet and the pill's, of a rule that sets a background in a
 * hover or focus state. Vitest loads no CSS (`document.styleSheets` is empty), so this reads the
 * text: the innermost `selector { declarations }` blocks, which reaches into `@media` blocks, with
 * each selector list split at its top-level commas (lists span lines).
 */
function paintingStateSelectors(): string[]
{
	const selectors: string[] = [];
	for (const [, head, body] of [SITE_CSS, PILL_CSS].flatMap((css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]))
	{
		if (!/(?:^|[\s;])background(?:-color)?\s*:/.test(body!))
		{
			continue;
		}
		// A statement such as `@import …;` before the rule isn't part of its selector.
		const list = head!.slice(head!.lastIndexOf(";") + 1);
		let depth = 0;
		let start = 0;
		for (let i = 0; i <= list.length; i++)
		{
			const char = list[i];
			depth += char === "(" ? 1 : char === ")" ? -1 : 0;
			if (i === list.length || (char === "," && depth === 0))
			{
				const selector = list.slice(start, i).trim();
				start = i + 1;
				if (STATE.test(selector))
				{
					selectors.push(selector);
				}
				STATE.lastIndex = 0;
			}
		}
	}
	return selectors;
}

/** The text of the pill stylesheet's first `@media` block whose condition matches. */
function mediaBlock(condition: RegExp): string
{
	const at = [...PILL_CSS.matchAll(/@media([^{]*)\{/g)].find(([, query]) => condition.test(query!));
	if (!at)
	{
		return "";
	}
	let depth = 0;
	for (let i = at.index! + at[0].length - 1; i < PILL_CSS.length; i++)
	{
		depth += PILL_CSS[i] === "{" ? 1 : PILL_CSS[i] === "}" ? -1 : 0;
		if (depth === 0)
		{
			return PILL_CSS.slice(at.index!, i + 1);
		}
	}
	return "";
}

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

	it("noDate (the game's own room, #421): a play clip reads just its pill, one with no play just its kind", () =>
	{
		expect(videoMeta(clip(), TOP6, {
			noDate: true,
		})).toEqual({
			text: null,
			pill: TOP6,
		});
		expect(videoMeta(clip(), null, {
			noDate: true,
		})).toEqual({
			text: "Highlight",
			pill: null,
		});
		expect(videoMeta(clip({
			kind: undefined,
		}), null, {
			noDate: true,
		})).toBeNull();
	});
});
