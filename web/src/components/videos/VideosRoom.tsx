import {
	Box, Button, Checkbox, Drawer, Group, Menu, Radio, ScrollArea, SegmentedControl, Stack, Text, TextInput, UnstyledButton,
} from "@mantine/core";
import {
	IconArrowsSort, IconChevronDown, IconChevronRight, IconSearch,
} from "@tabler/icons-react";
import { useState } from "react";
import {
	clipShownPosition, countHighlightFacets, filterHighlights, groupHighlights, groupHighlightsByTeam, HIGHLIGHT_GROUPS, sortHighlights,
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
import type { VideoLayout } from "./VideoLayoutToggle.js";
import { VideoLayoutToggle } from "./VideoLayoutToggle.js";
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

/**
 * The quick filters' values; the drawer edits a copy and applies it whole. Both the team and the
 * kind filter are kept whichever grouping shows, so switching back finds the other as it was (S200);
 * only the one the grouping offers applies.
 */
type Filters = {
	teamId: number | null;
	group: HighlightGroup | null;
	statViz: boolean;
};

/**
 * How the room groups its clips (S200): by kind (`groupHighlights`, the default) or by featured
 * team (`groupHighlightsByTeam`). It lasts for the visit and is not a setting.
 */
type Grouping = "kind" | "team";

/** The Kind filter's value for "All": no kind chosen. */
const ALL_KINDS = "all";

/**
 * The Group by switch (S200; owner, 2026-11-23: "group the highlights by the featured team instead
 * of by like type"): Kind or Team, the same segmented control as the Grid / List toggle beside it.
 */
function GroupBy({ value, onChange }: { value: Grouping;
	onChange: (grouping: Grouping) => void; })
{
	return (
		<SegmentedControl
			size="xs"
			aria-label="Group by"
			color="primary"
			value={value}
			onChange={(next) => onChange(next as Grouping)}
			style={{
				flexShrink: 0,
			}}
			data={[
				{
					value: "kind",
					label: "Kind",
				},
				{
					value: "team",
					label: "Team",
				},
			]}
		/>
	);
}

/** The kinds that have a clip, each with its count, in the groups' order: the only ones the kind filter offers. */
function presentKinds(counts: HighlightFacetCounts): { kind: HighlightGroup;
	count: number; }[]
{
	return HIGHLIGHT_GROUPS.flatMap((kind) =>
	{
		const count = counts.byGroup[kind];
		return count ? [{
			kind,
			count,
		}] : [];
	});
}

/**
 * The Kind quick filter (S200; owner, 2026-11-23: grouping by team "would swap it so that the
 * featured team filter is a type filter"): while the clips are grouped by team it takes the
 * Featured team control's place, built the same way (#428's connected pill): All, then each kind
 * that has a clip, each with its count, one chosen at a time.
 */
function KindFilter({
	group, counts, onChange,
}: { group: HighlightGroup | null;
	counts: HighlightFacetCounts;
	onChange: (group: HighlightGroup | null) => void; })
{
	const option = (label: string, count: number) => <>{label} <Text span inherit c="var(--bt-muted)">{count}</Text></>;
	return (
		<SegmentedControl
			size="xs"
			aria-label="Kind"
			color="primary"
			value={group ?? ALL_KINDS}
			onChange={(value) => onChange(value === ALL_KINDS ? null : value as HighlightGroup)}
			data={[
				{
					value: ALL_KINDS,
					label: option("All", counts.all),
				},
				...presentKinds(counts).map(({ kind, count }) => ({
					value: kind,
					label: option(GROUP_LABELS[kind], count),
				})),
			]}
		/>
	);
}

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
	game, opened, filters, statViz, grouping, kinds, onApply, onClose,
}: { game: GamePayload;
	opened: boolean;
	/** Grouped by team, the drawer offers Kind in Featured team's place, as the row does (S200). */
	grouping: Grouping;
	/** The kinds that have a clip (`presentKinds`). */
	kinds: readonly HighlightGroup[];
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
					{grouping === "team" ? (
						<Radio.Group
							label="Kind"
							value={draft.group ?? ""}
							onChange={(value) => setDraft({
								...draft,
								group: value ? value as HighlightGroup : null,
							})}
						>
							<Stack gap="xs" mt="xs">
								<Radio value="" label="All kinds" />
								{kinds.map((kind) => <Radio key={kind} value={kind} label={GROUP_LABELS[kind]} />)}
							</Stack>
						</Radio.Group>
					) : (
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
					)}
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
 * left (`QuickFilters`: the Featured team control always, #583, then as many as fit, then a Filters button opening
 * `FilterDrawer`; the row wraps when the team control leaves no room for the rest; the Kind pill in its place,
 * grouped by team, is not pinned and falls back to the drawer), and
 * on the right the sort (`sortHighlights`; impact first, the server's
 * `rankHighlightsByImpact` order) and the Grid / List icons (`VideoLayoutToggle`, shared with Search, #588). The quick
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
 * A Group by switch beside the Grid / List icons (S200) groups the clips by featured team instead
 * (`groupHighlightsByTeam`: away, home, then Other for clips featuring neither), and while it does
 * the Featured team filter gives way to a Kind filter (All, then each kind with a clip, with its
 * count), filtering within each team's group; switching back finds the team filter as it was. The
 * grouping lasts for the visit (`useState`), not a setting. List mode draws the cards as Best of
 * rows in 1 / 2 / 3 columns (`VideoGrid`, S200).
 * Every card leaves the date off its meta line (`noDate`), since every clip here is from the
 * game's own day (#421; owner, 2026-11-25, waiving game-shell A6's date on each card).
 * Choosing a video (a card linking to this room with it open, `useOpenClip`, #424) plays it in `PlayerHost` (S70): a dialog by default, or the stage at
 * the top of the room when the reader chose Stage. Played from the game's own room, the
 * dialog carries no link back to it. With Hide Scores on the recap clip is titled
 * "Recap (score hidden)" on its card and in the player (S75; game-shell A3); search still
 * matches MLB's titles.
 * The dialog counts the clip's start and finish anonymously (S174, `countViews`): with the game and the clip's place in
 * the game's ranked list (`clipShownPosition`, the order the game arrives in, whatever sort or filter shows), or 0 for
 * the clip that was open when the room first drew (opened directly, from a link; a clip taken back from the corner keeps
 * the place its start was counted at, `VideoPlayer`); a clip past the list's 100th place isn't counted. The stage counts
 * nothing.
 */
export function VideosRoom({ game, variant }: { game: GamePayload;
	variant: LayoutVariant; })
{
	const [query, setQuery] = useState("");
	const [filters, setFilters] = useState<Filters>({
		teamId: null,
		group: null,
		statViz: false,
	});
	const [grouping, setGrouping] = useState<Grouping>("kind");
	const [drawer, setDrawer] = useState(false);
	const [sort, setSort] = useState<HighlightSort>("impact");
	// Folded groups by section key: a kind, `team-<id>` or `other`.
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [layout, setLayout] = useState<VideoLayout>("grid");
	const {
		playing, href, close,
	} = useOpenClip(game.highlights, (video) => video.id);
	const scoresHidden = useScoresHidden(game);
	// The clip open as the room first drew came from a link, not the list (S174: shown position 0), until it closes.
	const [openedDirectly, setOpenedDirectly] = useState(() => playing?.id ?? null);
	if (openedDirectly !== null && playing?.id !== openedDirectly) setOpenedDirectly(null);
	const shownPosition = playing ? (playing.id === openedDirectly ? 0 : clipShownPosition(game.highlights, playing.id)) : null;

	if (game.highlights.length === 0)
	{
		return <ViewState kind="empty" message="No videos yet." />;
	}

	const byTeam = grouping === "team";
	// Only the filter the grouping offers applies: the kind filter grouped by team, else the team filter.
	const videos = sortHighlights(filterHighlights(game.highlights, {
		query,
		statViz: filters.statViz,
		...(byTeam ? {
			group: filters.group,
		} : {
			teamId: filters.teamId,
		}),
	}), sort);
	const counts = countHighlightFacets(game.highlights);
	const { away, home } = game.teams;
	const sections = byTeam
		? groupHighlightsByTeam(videos, game).map(({ teamId, highlights }) => ({
			key: teamId === null ? "other" : `team-${teamId}`,
			label: teamId === null ? "Other" : [away, home].find((team) => team.id === teamId)!.name,
			highlights,
		}))
		: groupHighlights(videos).map(({ group, highlights }) => ({
			key: group as string,
			label: GROUP_LABELS[group],
			highlights,
		}));
	const pills = [
		byTeam ? {
			key: "kind",
			active: filters.group !== null,
			node: <KindFilter group={filters.group} counts={counts} onChange={(group) => setFilters({
				...filters,
				group,
			})}
			/>,
		} : {
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
				countViews={shownPosition === null ? undefined : {
					gamePk: game.gamePk,
					shownPosition,
				}}
			/>
			<TextInput
				aria-label="Search videos"
				placeholder="Search videos..."
				leftSection={<IconSearch size={18} />}
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
			/>
			{/* Wraps only when the Featured team control, always shown (#583), leaves no room beside it. */}
			<Group gap={8} wrap="wrap" align="center">
				<QuickFilters pills={pills} pinned="team" onMore={() => setDrawer(true)} />
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
				<GroupBy value={grouping} onChange={setGrouping} />
				<VideoLayoutToggle value={layout} onChange={setLayout} />
			</Group>
			{videos.length === 0 ? <ViewState kind="empty" message="No videos match." /> : null}
			{sections.map(({
				key, label, highlights,
			}) =>
			{
				const cards = highlights.map((video) => (
					<VideoCard key={video.id} video={video} layout={layout} href={href(video)} scoresHidden={scoresHidden} playLink={videoPlayLink(video, game)} noDate />
				));
				const open = !collapsed.has(key);
				const Chevron = open ? IconChevronDown : IconChevronRight;
				return (
					<Stack key={key} gap="xs" component="section" aria-label={label} data-testid="videos-group" data-group={key}>
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
								if (open) next.add(key);
								else next.delete(key);
								setCollapsed(next);
							}}
						>
							<Group gap={6} wrap="nowrap">
								<Chevron size={14} color="var(--bt-muted)" aria-hidden />
								<SectionHeading c="var(--bt-muted)">{label}</SectionHeading>
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
								<VideoGrid variant={variant} layout={layout}>{cards}</VideoGrid>
							</Box>
						) : null}
					</Stack>
				);
			})}
			{drawer ? <FilterDrawer
				game={game}
				opened
				filters={filters}
				statViz={counts.statViz > 0}
				grouping={grouping}
				kinds={presentKinds(counts).map(({ kind }) => kind)}
				onApply={(next) =>
				{
					setFilters(next);
					setDrawer(false);
				}} onClose={() => setDrawer(false)}
			/> : null}
		</Stack>
	);
}
