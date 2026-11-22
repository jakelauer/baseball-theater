import { Tabs } from "@mantine/core";
import type { SeasonPhaseName } from "@bt/domain";
import { VIEW_LABELS } from "./viewLabels.js";

/**
 * Standings' view switch (S130 AC 1; standings-search-settings A9 "The view switch"): the game page's
 * tab row reused (Mantine `Tabs`, styled globally), its tabs at the start of the row 24px apart, one
 * per view the day offers (`standingsViews`), in the season's order, the shown one marked. The page
 * draws none when only the regular season is offered.
 */
export function ViewSwitch({
	offered, shown, onChoose,
}: { offered: readonly SeasonPhaseName[];
	shown: SeasonPhaseName;
	onChoose: (view: SeasonPhaseName) => void; })
{
	return (
		<Tabs
			value={shown}
			onChange={(value) =>
			{
				const view = offered.find((v) => v === value);
				if (view) onChoose(view);
			}}
		>
			<Tabs.List aria-label="Standings view" style={{
				gap: 24,
			}}
			>
				{offered.map((view) => (
					<Tabs.Tab key={view} value={view} px={0}>
						{VIEW_LABELS[view]}
					</Tabs.Tab>
				))}
			</Tabs.List>
		</Tabs>
	);
}
