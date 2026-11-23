import {
	Badge, CloseButton, Group, Stack, Text,
} from "@mantine/core";
import type { SearchFilters } from "@bt/domain";
import { MLB_TEAMS, searchTagLabel } from "@bt/domain";
import { formatDate } from "../../format/datetime.js";

/** One filter a chip stands for: the URL parameter it removes. */
export type SearchFilterName = "date" | "team" | "tag";

/**
 * Search's active filters (S72; standings-search-settings `search-*` "ACTIVE FILTERS"): one removable
 * chip per filter set, in the frames' order (date, team, kind of play), each with a ✕ that hands its
 * name to `onRemove`; nothing at all when no filter is set. The date reads as the rows write theirs
 * ("Sep 21, 2026"), the team by its abbreviation (`MLB_TEAMS`, its id when BT doesn't know the club),
 * filled in Primary as the frames fill the team chip (the others outlined), and the kind of play by `searchTagLabel`
 * ("Home Runs"). Typographic only: no logo (VISUAL-DESIGN §6).
 */
export function SearchFilterChips({ filters, onRemove }: { filters: SearchFilters;
	onRemove: (name: SearchFilterName) => void; })
{
	const chips: { name: SearchFilterName;
		label: string; }[] = [];
	if (filters.date !== undefined) chips.push({
		name: "date",
		label: formatDate(filters.date),
	});
	if (filters.teamId !== undefined) chips.push({
		name: "team",
		label: MLB_TEAMS.find((team) => team.id === filters.teamId)?.abbreviation ?? String(filters.teamId),
	});
	if (filters.tag !== undefined) chips.push({
		name: "tag",
		label: searchTagLabel(filters.tag),
	});
	if (chips.length === 0) return null;
	return (
		<Stack gap={6} data-testid="search-filters">
			<Text size="xs" fw={700} tt="uppercase">Active filters</Text>
			<Group gap="xs">
				{chips.map((chip) => (
					<Badge
						key={chip.name}
						size="lg"
						radius="xl"
						tt="none"
						fw={500}
						variant={chip.name === "team" ? "filled" : "default"}
						rightSection={(
							// A real button (Mantine's Pill hides its ✕ from keyboards and screen readers), named for its chip.
							<CloseButton
								size="xs"
								variant="transparent"
								c="inherit"
								aria-label={`Remove filter ${chip.label}`}
								onClick={() => onRemove(chip.name)}
							/>
						)}
					>
						{chip.label}
					</Badge>
				))}
			</Group>
		</Stack>
	);
}
