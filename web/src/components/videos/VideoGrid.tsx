import { SimpleGrid } from "@mantine/core";
import type { ReactNode } from "react";
import type { LayoutVariant } from "../../layout/variant.js";

/** Grid columns by pairing (game-shell Videos frames: two, three, four). */
const COLUMNS: Readonly<Record<LayoutVariant, number>> = {
	mobile: 2,
	medium: 3,
	desktop: 4,
};

/**
 * The highlight grid: `VideoCard`s (grid layout) in 2 / 3 / 4 columns at mobile / medium /
 * desktop, cards pinned to the top of their row. The Videos room's groups (S69) and the
 * scoreboard's Best of (#426; owner, 2026-11-23: "the best of highlights thing should use the
 * grid style highlight layout") both draw through it, so the two grids stay alike.
 */
export function VideoGrid({ variant, children }: { variant: LayoutVariant;
	children: ReactNode; })
{
	return (
		<SimpleGrid cols={COLUMNS[variant]} spacing="md" verticalSpacing="lg" data-testid="videos-grid" style={{
			alignItems: "start",
		}}
		>
			{children}
		</SimpleGrid>
	);
}
