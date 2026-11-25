import {
	Box, Button, Checkbox, Drawer, Group, Menu, Radio, ScrollArea, SegmentedControl, Stack, Text, TextInput, UnstyledButton, VisuallyHidden,
} from "@mantine/core";
import {
	IconArrowsSort, IconChevronDown, IconChevronRight, IconLayoutGrid, IconList, IconSearch,
} from "@tabler/icons-react";
import { useState } from "react";
import {
	countHighlightFacets, filterHighlights, groupHighlights, sortHighlights,
} from "@bt/domain";
import type {
	HighlightFacetCounts, HighlightGroup, HighlightSort,
} from "@bt/domain";
import type { GamePayload } from "../../api/game.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { ViewState } from "../ViewState.js";
import { useOpenClip } from "./openClip.js";
import { PlayerHost } from "./PlayerHost.js";
import { videoPlayLink } from "./playLink.js";
import { FilterPill, QuickFilters } from "./QuickFilters.js";
import { VideoCard } from "./VideoCard.js";
import { VideoGrid } from "./VideoGrid.js";
import { SectionHeading } from "../SectionHeading.js";

const SORT_LABELS: Readonly<Record<HighlightSort, string>> = {
	impact: "Impact",
	newest: "Newest",
	oldest: "Oldest",
};

/** Each group's heading (owner, 2026-10-30: "The groups are: Pre-game, Game highlights, Statcast, Post-Game"). */
const GROUP_LABELS: Readonly<Record<HighlightGroup, string>> = {
	pregame: "Pre-game",
	highlights: "Game highlights",
	statcast: "Statcast",
	postgame: "Post-game",
};

/** The quick filters' values; the drawer edits a copy and applies it whole. */
type Filters = {
	teamId: number | null;
	statViz: boolean;
};

/** The Featured team control's value for "All": no team chosen. */
const ALL_TEAMS = "all";

/**
 * The Featured team quick filter (#428; owner, 2026-11-23: "it should be a … button set where
 * the buttons are connected all in one pill … all and then each of the teams … we should put
 * the number of videos each one has"): one segmented control, All · away · home, All chosen
 * until the reader picks a team (FEATURES: the default is none). Each option shows its count
 * (`countHighlightFacets`); a clip featuring neither team counts only under All.
 */
function FeaturedTeam({
	game, teamId, counts, onChange,
}: { game: GamePayload;
	teamId: number | null;
	counts: HighlightFacetCounts;
	onChange: (teamId: number | null) => void; })
{
	const { away, home } = game.teams;
	const option = (label: string, count: number) => <>{label} <Text span inherit c="var(--bt-muted)">{count}</Text></>;
	return (
		<SegmentedControl
			size="xs"
			aria-label="Featured team"
			color="primary"
			value={teamId === null ? ALL_TEAMS : String(teamId)}
			onChange={(value) => onChange(value === ALL_TEAMS ? null : Number(value))}
			data={[
				{
					value: ALL_TEAMS,
					label: option("All", counts.all),
				},
				...[away, home].map((team) => ({
					value: String(team.id),
					label: option(team.abbreviation, counts.byTeam[team.id] ?? 0),
				})),
			]}
		/>
	);
}

/**
 * Every filter in a drawer from the bottom (owner, 2026-10-30: "a drawer from the bottom
 * showing all the filters … a fixed apply button and a scrolling list of filters"). It
 * edits a copy of the filters; Apply sets them and closes, dismissing discards.
 */
function FilterDrawer({
	game, opened, filters, statViz, onApply, onClose,
}: { game: GamePayload;
	opened: boolean;
	/** Whether to offer Stat / viz: only when some clip fits it (#418). */
	statViz: boolean;
	filters: Filters;
	onApply: (filters: Filters) => void;
	onClose: () => void; })
{
	const [draft, setDraft] = useState(filters);
	const { away, home } = game.teams;
	return (
		<Drawer
			opened={opened}
			onClose={onClose}
			position="bottom"
			title="Filters"
			styles={{
				// As tall as its filters (up to most of the screen), not Mantine's full-height default.
				content: {
					height: "auto",
					maxHeight: "85dvh",
				},
				body: {
					display: "flex",
					flexDirection: "column",
					gap: 16,
				},
			}}
		>
			<ScrollArea.Autosize mah="55dvh" type="auto" data-testid="filter-drawer-list">
				<Stack gap="lg">
					<Radio.Group
						label="Featured team"
						value={draft.teamId === null ? "" : String(draft.teamId)}
						onChange={(value) => setDraft({
							...draft,
							teamId: value ? Number(value) : null,
						})}
					>
						<Stack gap="xs" mt="xs">
							<Radio value="" label="All teams" />
							{[away, home].map((team) => <Radio key={team.id} value={String(team.id)} label={team.abbreviation} />)}
						</Stack>
					</Radio.Group>
					{statViz ? (
						<Checkbox
							label="Stat / viz"
							checked={draft.statViz}
							onChange={(event) => setDraft({
								...draft,
								statViz: event.currentTarget.checked,
							})}
						/>
					) : null}
				</Stack>
			</ScrollArea.Autosize>
			<Button fullWidth onClick={() => onApply(draft)}>Apply</Button>
		</Drawer>
	);
}

/**
 * The Videos room (S69; game-shell `game-videos-*` frames, A1): the game's videos, opening on a
 * full-width search with no "Videos" heading above it, since the tab already says so (#529;
 * owner, 2026-11-25, waiving the ratified frames' heading: "Drop the heading"), then one row: the quick filters on the
 * left (`QuickFilters`: as many as fit, then a Filters button opening `FilterDrawer`), and
 * on the right the sort (`sortHighlights`; impact first, the server's
 * `rankHighlightsByImpact` order) and the Grid / List icons (owner, 2026-10-30). The quick
 * filters are the Featured team control with each option's count and, only when some clip
 * fits it, Stat / viz (`countHighlightFacets`; #428, #418). The grid (`VideoGrid`)
 * has 2 / 3 / 4 columns at mobile / medium / desktop from the host's `variant`; List
 * shows the same `VideoCard`s as rows. Filtering is `filterHighlights` (packages/domain).
 * The results show in groups — Pre-game, Game highlights, Statcast, Post-game
 * (`groupHighlights`), each in the chosen sort — and a group with nothing in it is left
 * out (owner, 2026-10-30). Each group's heading, with its count, is a button that folds
 * the group away and back (owner, 2026-10-30: "the groups should be collapsible"); all
 * start open, each open group's clips inset in a container whose left rule runs down
 * from the chevron (#427).
 * Every card leaves the date off its meta line (`noDate`), since every clip here is from the
 * game's own day (#421; owner, 2026-11-25, waiving game-shell A6's date on each card).
 * Choosing a video (a card linking to this room with it open, `useOpenClip`, #424) plays it in `PlayerHost` (S70): a dialog by default, or the stage at
 * the top of the room when the reader chose Stage. Played from the game's own room, the
 * dialog carries no link back to it. With Hide Scores on the recap clip is titled
 * "Recap (score hidden)" on its card and in the player (S75; game-shell A3); search still
 * matches MLB's titles.
 */
export function VideosRoom({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const [query, setQuery] = useState("");
	const [filters, setFilters] = useState<Filters>({
		teamId: null,
		statViz: false,
	});
	const [drawer, setDrawer] = useState(false);
	const [sort, setSort] = useState<HighlightSort>("impact");
	const [collapsed, setCollapsed] = useState<ReadonlySet<HighlightGroup>>(new Set());
	const [layout, setLayout] = useState<"grid" | "list">("grid");
	const {
		playing, href, close,
	} = useOpenClip(game.highlights, (video) => video.id);
	const scoresHidden = useScoresHidden(game);

	if (game.highlights.length === 0)
	{
		return <ViewState kind="empty" message="No videos yet." />;
	}

	const videos = sortHighlights(filterHighlights(game.highlights, {
		query,
		...filters,
	}), sort);
	const counts = countHighlightFacets(game.highlights);
	const pills = [
		{
			key: "team",
			active: filters.teamId !== null,
			node: <FeaturedTeam game={game} teamId={filters.teamId} counts={counts} onChange={(teamId) => setFilters({
				...filters,
				teamId,
			})}
			/>,
		},
		// Stat / viz only when some clip fits it (#418; owner, 2026-11-23: "the stat viz button should not show if there are no videos that fit that description").
		...(counts.statViz === 0 ? [] : [{
			key: "statViz",
			active: filters.statViz,
			node: (
				<FilterPill active={filters.statViz} aria-pressed={filters.statViz} onClick={() => setFilters({
					...filters,
					statViz: !filters.statViz,
				})}
				>
					Stat / viz
				</FilterPill>
			),
		}]),
	];

	return (
		<Stack gap="md">
			<PlayerHost
				video={playing}
				first={game.highlights[0]}
				onClose={close}
				fromGamePk={game.gamePk}
				scoresHidden={scoresHidden}
				playLink={playing ? videoPlayLink(playing, game) : null}
				stageGame={game}
			/>
			<TextInput
				aria-label="Search videos"
				placeholder="Search videos..."
				leftSection={<IconSearch size={18} />}
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
			/>
			<Group gap={8} wrap="nowrap" align="center">
				<QuickFilters pills={pills} onMore={() => setDrawer(true)} />
				<Menu position="bottom-end">
					<Menu.Target>
						<FilterPill leftSection={<IconArrowsSort size={14} />} aria-label={`Sort: ${SORT_LABELS[sort]}`}>
							{SORT_LABELS[sort]}
						</FilterPill>
					</Menu.Target>
					<Menu.Dropdown>
						{(Object.keys(SORT_LABELS) as HighlightSort[]).map((value) => (
							<Menu.Item key={value} onClick={() => setSort(value)}>{SORT_LABELS[value]}</Menu.Item>
						))}
					</Menu.Dropdown>
				</Menu>
				<SegmentedControl
					size="xs"
					aria-label="Layout"
					color="primary"
					value={layout}
					onChange={(value) => setLayout(value as "grid" | "list")}
					style={{
						flexShrink: 0,
					}}
					data={[
						{
							value: "grid",
							label: <><IconLayoutGrid size={16} style={{
								display: "block",
							}}
							/><VisuallyHidden>Grid</VisuallyHidden></>,
						},
						{
							value: "list",
							label: <><IconList size={16} style={{
								display: "block",
							}}
							/><VisuallyHidden>List</VisuallyHidden></>,
						},
					]}
				/>
			</Group>
			{videos.length === 0 ? <ViewState kind="empty" message="No videos match." /> : null}
			{groupHighlights(videos).map(({ group, highlights }) =>
			{
				const cards = highlights.map((video) => (
					<VideoCard key={video.id} video={video} layout={layout} href={href(video)} scoresHidden={scoresHidden} playLink={videoPlayLink(video, game)} noDate />
				));
				const open = !collapsed.has(group);
				const Chevron = open ? IconChevronDown : IconChevronRight;
				return (
					<Stack key={group} gap="xs" component="section" aria-label={GROUP_LABELS[group]} data-testid="videos-group" data-group={group}>
						<UnstyledButton
							className="bt-hover"
							px={6}
							py={4}
							mx={-6}
							style={{
								borderRadius: 6,
							}}
							aria-expanded={open}
							onClick={() =>
							{
								const next = new Set(collapsed);
								if (open) next.add(group);
								else next.delete(group);
								setCollapsed(next);
							}}
						>
							<Group gap={6} wrap="nowrap">
								<Chevron size={14} color="var(--bt-muted)" aria-hidden />
								<SectionHeading c="var(--bt-muted)">{GROUP_LABELS[group]}</SectionHeading>
								<Text size="xs" c="var(--bt-muted)">{highlights.length}</Text>
							</Group>
						</UnstyledButton>
						{/*
							The group's container (#427; owner, 2026-11-23: "a border on the left that sort of like goes down
							from the arrow … the videos inside that section are actually inside it"): a rule from under the
							chevron, the clips inset beside it.
						*/}
						{open ? (
							<Box
								data-testid="videos-group-body"
								style={{
									marginLeft: 6,
									paddingLeft: 14,
									borderLeftWidth: 2,
									borderLeftStyle: "solid",
									borderLeftColor: "var(--mantine-color-dark-4)",
								}}
							>
								{layout === "grid" ? <VideoGrid variant={variant}>{cards}</VideoGrid> : <Stack gap="sm" data-testid="videos-list">{cards}</Stack>}
							</Box>
						) : null}
					</Stack>
				);
			})}
			{drawer ? <FilterDrawer game={game} opened filters={filters} statViz={counts.statViz > 0} onApply={(next) =>
			{
				setFilters(next);
				setDrawer(false);
			}} onClose={() => setDrawer(false)}
			/> : null}
		</Stack>
	);
}
