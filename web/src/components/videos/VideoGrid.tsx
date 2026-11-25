import { SimpleGrid, Stack } from "@mantine/core";
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
 * The highlight grid: `VideoCard`s (grid layout) in 2 / 3 / 4 columns at mobile / medium /
 * desktop, cards pinned to the top of their row. The Videos room's groups (S69), the
 * scoreboard's Best of (#426; owner, 2026-11-23: "the best of highlights thing should use the
 * grid style highlight layout") and Search's results (#588) all draw through it, so the grids
 * stay alike. `layout` "list" (the `VideoLayoutToggle`'s other choice) stacks the same cards as
 * rows instead; the caller passes cards in the matching `layout`.
 */
export function VideoGrid({
	variant, layout = "grid", children,
}: { variant: LayoutVariant;
	layout?: VideoLayout;
	children: ReactNode; })
{
	if (layout === "list") return <Stack gap="sm" data-testid="videos-list">{children}</Stack>;
	return (
		<SimpleGrid cols={COLUMNS[variant]} spacing="md" verticalSpacing="lg" data-testid="videos-grid" style={{
			alignItems: "start",
		}}
		>
			{children}
		</SimpleGrid>
	);
}
