/**
 * The footer's pages of words (S154): each page shows exactly its committed text, read straight from
 * `legal/<page>.md` (its raw bytes, not through the page's parser), so a page that drops, adds or rewords a
 * sentence fails.
 */
import { MantineProvider } from "@mantine/core";
import { cleanup, render } from "@testing-library/react";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { LegalPage } from "./LegalPage.js";
import type { LegalPageName } from "./legal/legalText.js";
import { LEGAL_TEXT, parseLegalText } from "./legal/legalText.js";

const PAGES: LegalPageName[] = ["about", "privacy", "terms"];

/** The committed file's words in order, its Markdown markers dropped and its spaces collapsed. */
function committedWords(page: LegalPageName): string
{
	return LEGAL_TEXT[page].split("\n").map((line) => line.trim().replace(/^(#{1,2}|-) /, "")).join(" ").replace(/\s+/g, " ").trim();
}

/** The page's words in order: its headings, paragraphs and list items, each block's text joined by a space. */
function renderedWords(container: HTMLElement): string
{
	return [...container.querySelectorAll("h1, h2, p, li")].map((el) => el.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
}

afterEach(() => cleanup());

describe("LegalPage (S154)", () =>
{
	for (const page of PAGES)
	{
		it(`S154 AC 2 ${page}: the page shows its committed text, word for word, and nothing else`, () =>
		{
			const { container } = render(
				<MantineProvider>
					<LegalPage page={page} />
				</MantineProvider>,
			);
			expect(renderedWords(container)).toBe(committedWords(page));
			expect(container.querySelectorAll("h1")).toHaveLength(1);
		});
	}

	it("parseLegalText reads a title, headings, wrapped paragraphs and wrapped list items", () =>
	{
		expect(parseLegalText("# T\r\n\nOne\ntwo.\n\n## H\n- a\n  more\n- b\n\nEnd.\n")).toEqual({
			title: "T",
			blocks: [
				{
					kind: "paragraph",
					text: "One two.",
				},
				{
					kind: "heading",
					text: "H",
				},
				{
					kind: "list",
					items: ["a more", "b"],
				},
				{
					kind: "paragraph",
					text: "End.",
				},
			],
		});
	});

	it("parseLegalText ends a paragraph at a heading or a list with no blank line between", () =>
	{
		expect(parseLegalText("# T\nP\n## H\nQ\n- i\n").blocks).toEqual([
			{
				kind: "paragraph",
				text: "P",
			},
			{
				kind: "heading",
				text: "H",
			},
			{
				kind: "paragraph",
				text: "Q",
			},
			{
				kind: "list",
				items: ["i"],
			},
		]);
	});
});
