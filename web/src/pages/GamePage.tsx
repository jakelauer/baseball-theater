import { Stack, Tabs } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCachedGame, useGame } from "../api/game.js";
import { findScheduledGame } from "../api/schedule.js";
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
import { NoticeSlot } from "../layout/NoticeSlot.js";
import { useOfflineNotice, useSavedCopy } from "../pwa/offline.js";
import type { Room } from "@bt/domain";
import {
	gamePhase, openingRoom, roomsForPhase,
} from "@bt/domain";
import { roomLabel } from "../components/game/format.js";
import { useSettings } from "../settings/store.js";

/** The widest a room tab grows, in px: wide enough for "Videos" with room to spare, narrow enough that five tabs sit centered on desktop. */
const TAB_MAX_WIDTH = 160;

/**
 * The room tabs — equal widths up to `TAB_MAX_WIDTH`, centered (owner, 2026-11-12) — around the
 * open room's panel (`children`); choosing a tab moves to that room's URL.
 */
function RoomTabs({
	gamePk, rooms, active, children,
}: { gamePk: number;
	rooms: readonly Room[];
	active: string;
	children?: ReactNode; })
{
	const navigate = useNavigate();
	return (
		<Tabs
			keepMounted={false}
			value={active}
			onChange={(value) =>
			{
				if (value)
				{
					void navigate(`/game/${gamePk}/${value}`);
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
			{children}
		</Tabs>
	);
}

/**
 * One game: the game top bar (in place of the app header, S60), the room tabs —
 * equal widths up to `TAB_MAX_WIDTH`, centered (owner, 2026-11-12) — and the room.
 * `variant` comes from the layout host; rooms take their tablet and desktop
 * layouts from it as they're built (S63/S64 and on). While the game's live socket is open the
 * shell's site footer opens with the Live strip on every room (A13 Which pages), told through
 * `setFooter` (S142).
 *
 * Offline (S74; game-rooms A1) the offline marker sits under the top bar: "This game as of …" over
 * the game as last stored, Hide Scores applying as online; a failed refetch or poll keeps the game
 * shown (`queryScreen`). A game never opened while online has no copy: the page then shows only
 * "You're offline." over an empty room, no error and no explanation (owner, 2026-10-21), with the
 * top bar and tabs when a day in the cache lists the game (`findScheduledGame`).
 */
export function GamePage({ variant, setFooter }: { variant: LayoutVariant;
	setFooter?: SetFooterMode; })
{
	const { gamePk, tab } = useParams();
	const client = useQueryClient();
	// A game in its window streams (S19); the stream then owns its freshness, so the query stops
	// refetching. The query gets the in-window flag, never `open`: a reconnect wait mustn't start
	// query polling on top of the stream's own fallback (S148).
	const live = useLiveGame(Number(gamePk), useCachedGame(Number(gamePk))?.windowMode === "active");
	const {
		data: game, error, refetch, dataUpdatedAt,
	} = useGame(Number(gamePk), live.inWindow);
	// Signed out, the store holds the house defaults, so games open on the default room.
	const { opensFirst } = useSettings();
	// Offline (S74): the marker names this game's copy, and draws under the top bar (the shell leaves it out here).
	const marker = useOfflineNotice();
	// A stored copy's own time, or when this page last got the game (a fetch, or a pushed update).
	useSavedCopy(game ? {
		kind: "game",
		asOf: game.copyAsOf ?? new Date(dataUpdatedAt).toISOString(),
	} : null);

	// A failed refetch keeps the room already shown (S28's one rule: a retired version's 426
	// raises the update notice over it); the error room is for a game that never loaded.
	const screen = queryScreen({
		data: game,
		error,
	});
	// Before the loading and error returns below, as hooks must be. No footer while the game loads, so
	// it never draws under the spinner and jumps (S142; `FooterMode`). Once loaded, or failed, the strip
	// shows while the socket is open, over the error state too: A13 ties the marker to the open socket,
	// not to what the page draws above it ("any page that has an active websocket").
	useFooterMode(setFooter, screen === "loading" || (screen !== "error" && !game) ? "none" : live.open ? "live" : "plain");
	if (screen === "error" && marker)
	{
		// Never opened while online: the banner over an empty room, no explanation (game-rooms A1).
		const listed = findScheduledGame(client, Number(gamePk));
		if (!listed) return <NoticeSlot notice={marker} flush />;
		const phase = gamePhase(listed.status.codedGameState);
		return (
			<Stack gap="xs" data-variant={variant}>
				<GameTopBar
					away={listed.teams.away.abbreviation ?? ""}
					home={listed.teams.home.abbreviation ?? ""}
					officialDate={listed.officialDate}
					// The status as the cached day lists it (S170's marker reads it, as online).
					status={listed.status}
					variant={variant}
				/>
				<NoticeSlot notice={marker} flush />
				<RoomTabs gamePk={listed.gamePk} rooms={roomsForPhase(phase, false)} active={openingRoom(tab, opensFirst, phase, false)} />
			</Stack>
		);
	}
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
				status={game.status}
				variant={variant}
			/>

			<NoticeSlot notice={marker} flush />

			{/* Only the open room is mounted: a hidden room (Plays opens an at-bat, Live replays pitches) costs nothing. */}
			<RoomTabs gamePk={game.gamePk} rooms={rooms} active={active}>
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
			</RoomTabs>
		</Stack>
	);
}
