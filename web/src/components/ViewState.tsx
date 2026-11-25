import {
	Box, Button, Group, SimpleGrid, Skeleton, Stack, Text, Title,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import type { LayoutVariant } from "../layout/variant.js";
import { VideoGrid } from "./videos/VideoGrid.js";

/**
 * What a loading skeleton stands for, so its blocks broadly take that content's shape (B584, #584;
 * owner, 2026-11-25: "the skeleton loading style needs to broadly match the content it's representing,
 * it can't be the same skeleton for every single thing. It shouldn't be an exact match"):
 *
 * - `games`: scoreboard game cards, each a bordered card with a status line and two team rows;
 * - `videos`: the highlight grid's cards (`VideoGrid`), a 16:9 still over two lines of title;
 * - `table`: standings or box-score tables, rows of a team cell and figure cells;
 * - `results`: search result rows, an icon beside a title line and a meta line, over a hairline;
 * - `text`: a heading over lines of prose (release notes, a recap);
 * - `rows`: a plain list (play rows, anything else).
 *
 * The practice it follows: the blocks mimic the structure of the content they stand for, so the reader
 * can anticipate the page and it doesn't jump when the content lands (Nielsen Norman Group, "Skeleton
 * Screens 101": "The structure of the gray boxes mimics the structure of the final page"; Atlassian Design
 * System, Skeleton: "Match the size and shape of the expected content so the page does not jump when
 * loading completes"), without copying it block for block; and only the data-dependent part is a
 * skeleton, while navigation and other content that needs no data draws at once (Carbon Design System,
 * Loading pattern: skeletons are for "container-based components … or data-based components", and
 * "action components … do not need to have a skeleton state"), so each page keeps its own chrome around
 * this component.
 */
export type SkeletonShape = "games" | "videos" | "table" | "results" | "text" | "rows";

/**
 * The page and room states the frames draw (S31 `scoreboard-loading/empty/error-*`,
 * S33 `room-*-mobile`), one implementation for every page and room (S60):
 *
 * - `loading` is an animated skeleton shaped like what it stands for (`SkeletonShape`, B584), so the
 *   page doesn't jump when data lands and the pulse says it is still loading (B431, #431; owner,
 *   2026-11-23: "generally when we're loading stuff, we should use a skeleton style loading … and the
 *   skeleton view should be like animated in some way that makes it clear that it's loading", which
 *   replaces the frames' centered spinner). It draws only the data's place: the page around it keeps
 *   its own heading, controls and navigation while it loads (B584);
 * - `empty` is one muted sentence;
 * - `error` is a Primary Light title, the recovery hint and Retry (red text on Dark uses Primary Light).
 */
export type ViewStateProps =
	| {
		kind: "loading";
		/** A heading drawn over the skeleton, for a page whose own heading isn't already on screen. */
		title?: string;
		/** What the skeleton stands for; `rows` when not given. */
		shape?: SkeletonShape;
		/** `games`: the scoreboard's own column count, so the cards sit where the games will. */
		columns?: number;
		/** `videos`: the layout host's pairing, which `VideoGrid` turns into its columns. */
		variant?: LayoutVariant;
	}
	| {
		kind: "empty";
		message: string;
	}
	| {
		kind: "error";
		/** What failed, e.g. "Couldn't load games" or "Couldn't load this room". */
		title: string;
		onRetry: () => void;
	};

/** How many game-card blocks the card skeleton draws: enough to fill a screen at one to three columns. */
const SKELETON_CARDS = 6;

/** How many highlight cards the video skeleton draws: two rows at desktop's four columns. */
const SKELETON_VIDEOS = 8;

/** The row skeleton's widths: full-width rows with a short last one, so it reads as a list. */
const SKELETON_ROWS = ["100%", "100%", "100%", "60%"];

/** The prose skeleton's line widths: a paragraph's ragged right edge, its last line short. */
const SKELETON_LINES = ["100%", "96%", "100%", "92%", "55%"];

/** Rows per skeleton table: a division's five teams. */
const SKELETON_TABLE_ROWS = 5;

/** Figure cells per skeleton table row: W, L, PCT and GB on a standings table. */
const SKELETON_FIGURES = 4;

/** Rows in the search results skeleton. */
const SKELETON_RESULTS = 5;

/** The blocks for one shape; `animate` is false under prefers-reduced-motion. */
function SkeletonBlocks({
	shape, columns, variant, animate,
}: { shape: SkeletonShape;
	columns: number | undefined;
	variant: LayoutVariant | undefined;
	animate: boolean; })
{
	switch (shape)
	{
		case "games":
			// A scoreboard card: its status line, then the away and home rows (logo, name, runs/hits/errors).
			return (
				<SimpleGrid cols={columns ?? 1} spacing="md" verticalSpacing="md" data-testid="skeleton-grid">
					{Array.from({
						length: SKELETON_CARDS,
					}, (_, i) => (
						<Stack key={i} data-testid="skeleton-card" gap={8} p={12} style={{
							border: "1px solid var(--bt-hairline)",
							borderRadius: "var(--mantine-radius-md)",
						}}
						>
							<Skeleton h={12} w="35%" radius="sm" animate={animate} />
							{[0, 1].map((row) => (
								<Group key={row} data-testid="skeleton-team-row" gap={8} wrap="nowrap" mih={36}>
									<Skeleton h={28} w={28} circle animate={animate} />
									<Skeleton h={14} radius="sm" animate={animate} style={{
										flex: 1,
									}}
									/>
									{[0, 1, 2].map((figure) => <Skeleton key={figure} h={14} w={20} radius="sm" animate={animate} />)}
								</Group>
							))}
						</Stack>
					))}
				</SimpleGrid>
			);
		case "videos":
			// A highlight card in the grid layout: the 16:9 still, then a title of up to two lines.
			return (
				<VideoGrid variant={variant ?? "mobile"}>
					{Array.from({
						length: SKELETON_VIDEOS,
					}, (_, i) => (
						<Stack key={i} data-testid="skeleton-video" gap={6}>
							<Skeleton radius="md" animate={animate} style={{
								aspectRatio: "16 / 9",
							}}
							/>
							<Skeleton h={12} w="90%" radius="sm" animate={animate} />
							<Skeleton h={12} w="60%" radius="sm" animate={animate} />
						</Stack>
					))}
				</VideoGrid>
			);
		case "table":
			// Two tables, each a heading over rows of a team cell (logo and name) and the figure columns.
			return (
				<Stack gap="xl">
					{[0, 1].map((table) => (
						<Stack key={table} data-testid="skeleton-table" gap={10}>
							<Skeleton h={16} w="40%" radius="sm" animate={animate} />
							{Array.from({
								length: SKELETON_TABLE_ROWS,
							}, (_, row) => (
								<Group key={row} data-testid="skeleton-table-row" gap="md" wrap="nowrap" mih={24}>
									<Group data-testid="skeleton-cell" gap={8} wrap="nowrap" style={{
										flex: 1,
									}}
									>
										<Skeleton h={20} w={20} circle animate={animate} />
										<Skeleton h={12} w="60%" radius="sm" animate={animate} />
									</Group>
									{Array.from({
										length: SKELETON_FIGURES,
									}, (_, figure) => <Skeleton key={figure} data-testid="skeleton-cell" h={12} w={28} radius="sm" animate={animate} />)}
								</Group>
							))}
						</Stack>
					))}
				</Stack>
			);
		case "results":
			// A search result: the video icon, the title line and the meta line, the hairline under it.
			return (
				<Stack gap={0}>
					{Array.from({
						length: SKELETON_RESULTS,
					}, (_, i) => (
						<Group key={i} data-testid="skeleton-result" gap={12} wrap="nowrap" py={16} style={{
							borderBottom: "1px solid var(--bt-hairline)",
						}}
						>
							<Skeleton h={24} w={24} circle animate={animate} />
							<Stack gap={8} style={{
								flex: 1,
							}}
							>
								<Skeleton h={14} w="75%" radius="sm" animate={animate} />
								<Skeleton h={12} w="35%" radius="sm" animate={animate} />
							</Stack>
						</Group>
					))}
				</Stack>
			);
		case "text":
			return (
				<Stack gap={10}>
					<Skeleton h={20} w="40%" radius="sm" animate={animate} />
					{SKELETON_LINES.map((width, i) => <Skeleton key={i} h={12} w={width} radius="sm" animate={animate} />)}
				</Stack>
			);
		case "rows":
			return (
				<Stack gap="sm">
					{SKELETON_ROWS.map((width, i) => <Skeleton key={i} h={48} w={width} radius="md" animate={animate} />)}
				</Stack>
			);
	}
}

export function ViewState(props: ViewStateProps)
{
	// Under prefers-reduced-motion the skeleton holds still (VISUAL-DESIGN §7), as the Live dot does;
	// `styles.css` stops the pulse from the first frame, before this hook reads the preference.
	const reduceMotion = useReducedMotion();
	if (props.kind === "loading")
	{
		const shape = props.shape ?? "rows";
		return (
			<Stack gap="lg">
				{props.title ? <Title order={2}>{props.title}</Title> : null}
				{/* Mantine's Skeleton pulses (`animate`) unless motion is reduced; the label keeps "Loading" for screen readers. */}
				<Box role="status" aria-label="Loading" aria-busy data-skeleton={shape}>
					<SkeletonBlocks shape={shape} columns={props.columns} variant={props.variant} animate={!reduceMotion} />
				</Box>
			</Stack>
		);
	}
	if (props.kind === "empty")
	{
		return (
			<Stack align="center" py="xl">
				<Text c="dimmed">{props.message}</Text>
			</Stack>
		);
	}
	return (
		<Stack align="center" gap={4} py="xl" role="alert">
			<Text fw={700} c="var(--bt-primary-light)">
				{props.title}
			</Text>
			<Text size="xs" c="var(--bt-primary-light)">
				Check your connection and try again
			</Text>
			<Button variant="subtle" color="primary" c="var(--bt-primary-light)" onClick={props.onRetry}>
				Retry
			</Button>
		</Stack>
	);
}
