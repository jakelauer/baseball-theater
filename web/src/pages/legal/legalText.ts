import about from "./about.md?raw";
import privacy from "./privacy.md?raw";
import terms from "./terms.md?raw";

/**
 * The three pages of words the site footer links (S154; shell-scoreboard A14): About, the Privacy
 * policy and the Terms of use. Each page's text is committed beside this file as `<page>.md`, and a
 * page is served only once the owner has approved its words (S154 AC 2), so changing a page's words
 * is a change to that file alone.
 */
export const LEGAL_TEXT = {
	about,
	privacy,
	terms,
} as const;

export type LegalPageName = keyof typeof LEGAL_TEXT;

/** One block of a page: a section heading, a paragraph, or a list of items. */
export type LegalBlock =
	| { kind: "heading";
		text: string }
	| { kind: "paragraph";
		text: string }
	| { kind: "list";
		items: string[] };

/**
 * Reads a page's committed text, which uses only the little Markdown it needs: the first line is
 * `# <title>`, a `## <heading>` line starts a section, a `- <item>` line is a list item, and a
 * blank line ends a paragraph or list. Nothing else is Markdown here (no emphasis, no links), so
 * what the file says is exactly what the page shows. A paragraph's wrapped lines join with a space.
 */
export function parseLegalText(source: string): { title: string;
	blocks: LegalBlock[]; }
{
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	let title = "";
	const blocks: LegalBlock[] = [];
	// The block being built: a paragraph's lines or a list's items, until a blank line or a heading.
	let open: LegalBlock | null = null;
	const close = () =>
	{
		if (open) blocks.push(open);
		open = null;
	};
	for (const raw of lines)
	{
		const line = raw.trim();
		if (line === "")
		{
			close();
		}
		else if (line.startsWith("## "))
		{
			close();
			blocks.push({
				kind: "heading",
				text: line.slice(3),
			});
		}
		else if (line.startsWith("# "))
		{
			close();
			title = line.slice(2);
		}
		else if (line.startsWith("- "))
		{
			if (open?.kind !== "list")
			{
				close();
				open = {
					kind: "list",
					items: [],
				};
			}
			open.items.push(line.slice(2));
		}
		else if (open?.kind === "paragraph")
		{
			open.text += ` ${line}`;
		}
		else if (open?.kind === "list")
		{
			// A list item's wrapped line continues that item.
			const last = open.items.length - 1;
			open.items[last] = `${open.items[last]} ${line}`;
		}
		else
		{
			open = {
				kind: "paragraph",
				text: line,
			};
		}
	}
	close();
	return {
		title,
		blocks,
	};
}
