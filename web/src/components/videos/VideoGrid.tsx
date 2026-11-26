import { SimpleGrid } from "@mantine/core";
import type { ReactNode } from "react";
import type { LayoutVariant } from "../../layout/variant.js";
import type { VideoLayout } from "./VideoLayoutToggle.js";

/** Grid columns by pairing (game-shell Videos frames: two, three, four). */
const COLUMNS: Readonly<Record<LayoutVariant, number>> = {
	mobile: 2,
	medium: 3,
	desktop: 4,
};

/**
 * List columns by pairing (S200; owner, 2026-11-23: "however many columns can like reasonably fit"):
 * a Best of row needs about a phone's width, so one at mobile, two at medium, three at desktop.
 */
const LIST_COLUMNS: Readonly<Record<LayoutVariant, number>> = {
	mobile: 1,
	medium: 2,
	desktop: 3,
};

/**
 * The highlight grid: `VideoCard`s (grid layout) in 2 / 3 / 4 columns at mobile / medium /
 * desktop, cards pinned to the top of their row. The Videos room's groups (S69), the
 * scoreboard's Best of (#426; owner, 2026-11-23: "the best of highlights thing should use the
 * grid style highlight layout") and Search's results (#588) all draw through it, so the grids
 * stay alike. `layout` "list" (the `VideoLayoutToggle`'s other choice) lays the same cards out as
 * Best of rows (S200) in 1 / 2 / 3 columns instead; the caller passes cards in the matching `layout`.
 */
export function VideoGrid({
	variant, layout = "grid", children,
}: { variant: LayoutVariant;
	layout?: VideoLayout;
	children: ReactNode; })
{
	if (layout === "list")
	{
		return (
			<SimpleGrid cols={LIST_COLUMNS[variant]} spacing={8} verticalSpacing={8} data-testid="videos-list">
				{children}
			</SimpleGrid>
		);
	}
	return (
		<SimpleGrid cols={COLUMNS[variant]} spacing="md" verticalSpacing="lg" data-testid="videos-grid" style={{
			alignItems: "start",
		}}
		>
			{children}
		</SimpleGrid>
	);
}
