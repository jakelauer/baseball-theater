import {
	List, Stack, Text, Title,
} from "@mantine/core";
import type { LegalPageName } from "./legal/legalText.js";
import { LEGAL_TEXT, parseLegalText } from "./legal/legalText.js";

/**
 * One of the footer's pages of words, laid out as the change log page is (S133's A9 frames; owner,
 * 2026-11-19, asked whether these pages get their own design: chose "Reuse change log layout
 * (Recommended)"): the page title in the Standings title style, then a column at most 640px wide,
 * each section's heading in the change log's release-heading style (SemiBold 20) and its words at
 * 14px. Static text, so there is no loading, empty or error state, and the footer is the shell's
 * plain one.
 */
export function LegalPage({ page }: { page: LegalPageName })
{
	const { title, blocks } = parseLegalText(LEGAL_TEXT[page]);
	return (
		<Stack gap="lg">
			<Title order={1}>{title}</Title>
			<Stack gap={14} maw={640} style={{
				overflowWrap: "anywhere",
			}}>
				{blocks.map((block, i) =>
				{
					if (block.kind === "heading")
					{
						return (
							<Title key={i} order={2} fz={20} fw={600} mt={i > 0 ? 14 : 0}>
								{block.text}
							</Title>
						);
					}
					if (block.kind === "list")
					{
						return (
							// Mantine's item wrapper is an inline-flex box beside an inside bullet, which sizes itself to
							// the whole item's width and so runs past the column by the bullet's width at 390px. A plain
							// inline box with the bullet hung outside (in the list's own 20px inset) wraps its words
							// inside the column, each wrapped line under the first one's words.
							<List key={i} fz={14} spacing={6} styles={{
								root: {
									listStylePosition: "outside",
									paddingInlineStart: 20,
								},
								item: {
									whiteSpace: "normal",
								},
								itemWrapper: {
									display: "inline",
								},
							}}>
								{block.items.map((item, j) => <List.Item key={j}>{item}</List.Item>)}
							</List>
						);
					}
					return <Text key={i} fz={14}>{block.text}</Text>;
				})}
			</Stack>
		</Stack>
	);
}
