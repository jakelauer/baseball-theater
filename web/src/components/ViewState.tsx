import {
	Button, SimpleGrid, Skeleton, Stack, Text, Title,
} from "@mantine/core";

/**
 * The page and room states the frames draw (S31 `scoreboard-loading/empty/error-*`,
 * S33 `room-*-mobile`), one implementation for every page and room (S60):
 *
 * - `loading` keeps the page title above an animated skeleton, so the page doesn't jump when data lands
 *   and the pulse says it is still loading (B431, #431; owner, 2026-11-23: "generally when we're loading
 *   stuff, we should use a skeleton style loading … and the skeleton view should be like animated in
 *   some way that makes it clear that it's loading", which replaces the frames' centered spinner). A page
 *   of cards (the scoreboard's games) passes `cards`, its column count, for card-shaped blocks; every
 *   other page and room gets rows;
 * - `empty` is one muted sentence;
 * - `error` is a Primary Light title, the recovery hint and Retry (red text on Dark uses Primary Light).
 */
export type ViewStateProps =
	| {
		kind: "loading";
		/** The page's heading, kept while loading. Rooms sit under the game top bar and pass none. */
		title?: string;
		/** Draw game-card blocks in this many columns (the page's own, from its `variant`) instead of rows. */
		cards?: number;
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

/** How many game-card blocks the card skeleton draws: enough to fill a screen at one or two columns. */
const SKELETON_CARDS = 6;

/** The row skeleton's widths: full-width rows with a short last one, so it reads as a list. */
const SKELETON_ROWS = ["100%", "100%", "100%", "60%"];

export function ViewState(props: ViewStateProps)
{
	if (props.kind === "loading")
	{
		return (
			<Stack gap="lg">
				{props.title ? <Title order={2}>{props.title}</Title> : null}
				{/* Mantine's Skeleton pulses by default (`animate`); the label keeps "Loading" for screen readers. */}
				{props.cards ? (
					<SimpleGrid cols={props.cards} spacing="md" verticalSpacing="md" aria-label="Loading" role="status">
						{Array.from({
							length: SKELETON_CARDS,
						}, (_, i) => <Skeleton key={i} data-testid="skeleton-card" h={120} radius="md" />)}
					</SimpleGrid>
				) : (
					<Stack gap="sm" aria-label="Loading" role="status">
						{SKELETON_ROWS.map((width, i) => <Skeleton key={i} h={48} w={width} radius="md" />)}
					</Stack>
				)}
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
