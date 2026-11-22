import type { ReactNode } from "react";
import { Stack, Tabs } from "@mantine/core";
import type { SeasonPhaseName } from "@bt/domain";
import { VIEW_LABELS } from "./viewLabels.js";

/**
 * Standings' view switch (S130 AC 1; standings-search-settings A9 "The view switch"): the game page's
 * tab row reused (Mantine `Tabs`, styled globally), its tabs at the start of the row 24px apart, one
 * per view the day offers (`standingsViews`), in the season's order, the shown one marked. The page
 * draws none when only the regular season is offered.
 *
 * `children` (the World Series box and the tables) sit in one panel under the marked tab, so each tab's
 * `aria-controls` names a panel that exists: that panel takes the shown view's value and keeps one key,
 * so its content is never remounted as the fan switches (the box's sheen runs once, when it first
 * appears, A9), and each other offered view gets an empty, hidden panel. The panel sits `xl` below the
 * tab row with its children `xl` apart, the page's own spacing.
 */
export function ViewSwitch({
	offered, shown, onChoose, children,
}: { offered: readonly SeasonPhaseName[];
	shown: SeasonPhaseName;
	onChoose: (view: SeasonPhaseName) => void;
	children: ReactNode; })
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
			<Tabs.Panel key="shown" value={shown} pt="xl">
				<Stack gap="xl">{children}</Stack>
			</Tabs.Panel>
			{offered.filter((view) => view !== shown).map((view) => <Tabs.Panel key={view} value={view}>{null}</Tabs.Panel>)}
		</Tabs>
	);
}
