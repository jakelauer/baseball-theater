import { Stack, Text } from "@mantine/core";
import type { ClinchLegendLine } from "@bt/domain";

/**
 * The clinch legend under the last Standings table (standings-search-settings A9 `clinch-legend`):
 * one line per letter the page shows, strongest first, the letter in Bold then its meaning, 11px on
 * 16px lines at the muted 50%. The lines come from `clinchLegend` (packages/domain); none draws nothing.
 */
export function ClinchLegend({ lines }: { lines: readonly ClinchLegendLine[] })
{
	if (lines.length === 0) return null;
	return (
		<Stack gap={0} data-testid="clinch-legend">
			{lines.map((line) => (
				<Text key={line.letter} fz={11} lh="16px" c="var(--bt-muted)" data-testid="clinch-legend-line">
					<Text span inherit fw={700}>{line.letter}</Text>
					{" "}
					{line.meaning}
				</Text>
			))}
		</Stack>
	);
}
