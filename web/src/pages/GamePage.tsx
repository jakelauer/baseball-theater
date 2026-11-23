import { Stack, Tabs } from "@mantine/core";
import { useNavigate, useParams } from "react-router-dom";
import { useCachedGame, useGame } from "../api/game.js";
import { useLiveGame } from "../api/live.js";
import { BoxRoom } from "../components/game/BoxRoom.js";
import { GameTopBar } from "../components/game/GameTopBar.js";
import { LiveRoom } from "../components/game/LiveRoom.js";
import { RecapRoom } from "../components/game/RecapRoom.js";
import { PlaysPanel } from "../components/pitch/PlaysPanel.js";
import { VideosRoom } from "../components/videos/VideosRoom.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import type { SetFooterMode } from "../layout/footerMode.js";
import { useFooterMode } from "../layout/footerMode.js";
import type { LayoutVariant } from "../layout/variant.js";
import {
	gamePhase, openingRoom, roomsForPhase,
} from "@bt/domain";
import { roomLabel } from "../components/game/format.js";
import { useSettings } from "../settings/store.js";

/** The widest a room tab grows, in px: wide enough for "Videos" with room to spare, narrow enough that five tabs sit centered on desktop. */
const TAB_MAX_WIDTH = 160;

/**
 * One game: the game top bar (in place of the app header, S60), the room tabs —
 * equal widths up to `TAB_MAX_WIDTH`, centered (owner, 2026-11-12) — and the room.
 * `variant` comes from the layout host; rooms take their tablet and desktop
 * layouts from it as they're built (S63/S64 and on). While the game's live socket is open the
 * shell's site footer opens with the Live strip on every room (A13 Which pages), told through
 * `setFooter` (S142).
 */
export function GamePage({ variant, setFooter }: { variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const { gamePk, tab } = useParams();
	const navigate = useNavigate();
	// A game in its window streams (S19); the stream then owns its freshness, so the query stops
	// refetching. The query gets the in-window flag, never `open`: a reconnect wait mustn't start
	// query polling on top of the stream's own fallback (S148).
	const live = useLiveGame(Number(gamePk), useCachedGame(Number(gamePk))?.windowMode === "active");
	// Called before the loading and error returns below (hooks must be), so while the socket is open the
	// strip also shows under the room's loading or error state: A13 ties the marker to the open socket,
	// not to what the page draws above it ("any page that has an active websocket"), so this is kept.
	useFooterMode(setFooter, live.open ? "live" : "plain");
	const {
		data: game, error, refetch,
	} = useGame(Number(gamePk), live.inWindow);
	// Signed out, the store holds the house defaults, so games open on the default room.
	const { opensFirst } = useSettings();

	// A failed refetch keeps the room already shown (S28's one rule: a retired version's 426
	// raises the update notice over it); the error room is for a game that never loaded.
	const screen = queryScreen({
		data: game,
		error,
	});
	if (screen === "error")
	{
		return <ViewState kind="error" title="Couldn't load this room" onRetry={() => void refetch()} />;
	}
	if (screen === "loading" || !game)
	{
		return <ViewState kind="loading" />;
	}

	const phase = gamePhase(game.status.codedGameState);
	// Recap only when MLB has published one (S10).
	const hasRecap = game.recap !== undefined;
	const rooms = roomsForPhase(phase, hasRecap);
	// With no room in the URL, the user's Opens First; a room this game hides
	// (Live on a final game, Recap without a recap) opens the default room instead.
	const active = openingRoom(tab, opensFirst, phase, hasRecap);

	return (
		<Stack gap="xs" data-variant={variant}>
			<GameTopBar
				away={game.teams.away.abbreviation}
				home={game.teams.home.abbreviation}
				officialDate={game.officialDate}
				live={phase === "live"}
			/>

			{/* Only the open room is mounted: a hidden room (Plays opens an at-bat, Live replays pitches) costs nothing. */}
			<Tabs
				keepMounted={false}
				value={active}
				onChange={(value) =>
				{
					if (value)
					{
						void navigate(`/game/${game.gamePk}/${value}`);
					}
				}}
			>
				{/* Equal-width tabs, each at most TAB_MAX_WIDTH, centered as a group (owner, 2026-11-12: "tab menu
				    on games should have a max width per tab and the tabs should be centered, and equal width to each other"). */}
				<Tabs.List
					grow
					justify="center"
					style={{
						flexWrap: "nowrap",
						overflowX: "auto",
					}}
				>
					{rooms.map((room) => (
						<Tabs.Tab
							key={room}
							value={room}
							style={{
								flex: "1 1 0",
								maxWidth: TAB_MAX_WIDTH,
							}}
						>
							{roomLabel(room)}
						</Tabs.Tab>
					))}
				</Tabs.List>

				<Tabs.Panel value="videos" pt="md">
					<VideosRoom game={game} variant={variant} />
				</Tabs.Panel>

				{rooms.includes("live") ? (
					<Tabs.Panel value="live" pt="md">
						<LiveRoom game={game} variant={variant} />
					</Tabs.Panel>
				) : null}

				<Tabs.Panel value="plays" pt="md">
					<PlaysPanel game={game} />
				</Tabs.Panel>

				<Tabs.Panel value="box" pt="md">
					<BoxRoom game={game} variant={variant} />
				</Tabs.Panel>

				{game.recap && rooms.includes("recap") ? (
					<Tabs.Panel value="recap" pt="md">
						<RecapRoom game={game} recap={game.recap} />
					</Tabs.Panel>
				) : null}
			</Tabs>
		</Stack>
	);
}
