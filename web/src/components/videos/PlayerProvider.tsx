import { Box } from "@mantine/core";
import type { ReactNode, RefObject } from "react";
import {
	createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { highlightTitle } from "@bt/domain";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import type { LayoutVariant } from "../../layout/variant.js";
import { CornerPlayer, cornerSpace } from "./CornerPlayer.js";
import type { Video } from "./VideoCard.js";
import type { VideoPlayer as Player } from "./VideoPlayer.js";

/**
 * The player, loaded as its own chunk once the shell has mounted, so it stays out of the entry bundle
 * (200,000-byte budget, `pnpm size`) now that the provider holding it sits in the shell. Kept here once
 * loaded, so every later provider has it from its first render. A clip chosen before it arrives waits
 * in state and plays once it does. `loadPlayer` is exported for the tests' setup, which loads it first.
 */
let loadedPlayer: typeof Player | null = null;
let loadingPlayer: Promise<typeof Player> | null = null;

export function loadPlayer(): Promise<typeof Player>
{
	loadingPlayer ??= import("./VideoPlayer.js").then((m) =>
	{
		loadedPlayer = m.VideoPlayer;
		return m.VideoPlayer;
	}, (error: unknown) =>
	{
		// A failed load (a dropped connection) is tried again by the next provider or clip.
		loadingPlayer = null;
		throw error;
	});
	return loadingPlayer;
}


/** What a host asks the player to show: the clip and how the host draws it. */
export interface SlotProps
{
	video: Video;
	/** The clip's title (`highlightTitle` on the game page, S75). */
	title: string;
	/**
	 * The game whose Hide Scores rule titles the clip, for a host that follows it (the game page's): in the
	 * corner, with no host to re-title it, the provider titles it from the current setting
	 * (`useScoresHidden`, `highlightTitle`), so turning Hide Scores on there hides a recap's score. Absent
	 * (Search, the digest), the clip keeps `title`, MLB's.
	 */
	scoresGame?: { gamePk: number };
	/** Start the clip: the dialog once its opening ends (#423), the stage once the fan chose a clip. */
	autoPlay: boolean;
	/** The dialog's title above the clip (S196); the stage's under the tools. */
	titleAbove?: boolean;
	/**
	 * The fan chose this clip (the dialog always; the stage only for a chosen clip, not its waiting first
	 * one). A chosen clip replaces whatever plays, the corner's included; a waiting one never takes the
	 * player from the corner.
	 */
	chosen: boolean;
	/** The host's close (drops `?clip=`, #424), which the tool row's mini-player button calls as it leaves. */
	onClose?: () => void;
}

/** The clip the player holds: what its host asked for, and the page it was opened on (its link, B424). */
interface HeldClip
{
	video: Video;
	title: string;
	scoresGame: { gamePk: number } | undefined;
	autoPlay: boolean;
	titleAbove: boolean;
	/** The page the clip plays on, `?clip=` included: where the corner's expand control goes. */
	href: string;
}

/** What the provider renders from: the clip, whether it sits in the corner, and the corner's focus asks. */
interface View
{
	clip: HeldClip | null;
	inCorner: boolean;
	/** Bumped each time the Mini player button sends the clip to the corner: the corner takes focus (`CornerPlayer`). */
	focusCorner: number;
}

/** The host that let the clip go (closed it or sent it to the corner), until it asks for something else. */
interface LetGo
{
	slot: HTMLElement;
	id: string;
	chosen: boolean;
}

/** The provider's moves, stable for its lifetime so a host's unmount cleanup can call them. */
interface Controller
{
	/** A host's slot asks for the player (every commit; a no-op when nothing changed). */
	claim: (slot: HTMLElement, props: SlotProps, href: string) => void;
	/** A host's slot is going away: a playing clip goes to the corner, any other closes. */
	release: (slot: HTMLElement) => void;
	/**
	 * Stops the clip and drops it (the close control, Esc, a press outside the dialog). Given a clip's id
	 * (a host's own), only while the player holds that clip: a dialog closed before its slot took the
	 * player leaves the corner's clip playing.
	 */
	dismiss: (id?: string) => void;
	/** Sends the clip to the corner and closes its host, the fan staying on the page (the mini-player button). */
	minimize: () => void;
}

interface PlayerContextValue extends Controller
{
	view: View;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** The `<video>` the holder holds, if a clip is loaded. */
function videoIn(holder: HTMLElement): HTMLVideoElement | null
{
	return holder.querySelector("video");
}

/** Pauses the holder's clip if it plays. */
function pauseIn(holder: HTMLElement): void
{
	const video = videoIn(holder);
	if (isPlaying(video)) video?.pause();
}

/** Whether a clip is playing now, read from the element (the fan's own play and pause included). */
function isPlaying(video: HTMLVideoElement | null): boolean
{
	return video != null && !video.paused && !video.ended;
}

/**
 * Builds the provider's moves over its live state (`live`, which every move updates before it tells
 * React through `setView`, so two moves in one commit see each other) and its one holder node.
 */
function makeController(live: { current: View & { active: HTMLElement | null;
	letGo: LetGo | null;
	onClose: (() => void) | undefined; }; }, holder: HTMLElement, corner: RefObject<HTMLDivElement | null>, setView: (view: View) => void): Controller
{
	const publish = () => setView({
		clip: live.current.clip,
		inCorner: live.current.inCorner,
		focusCorner: live.current.focusCorner,
	});
	// Moves the holder into `slot`, the `<video>` with it: the same element, never a new one (S198 AC 3).
	const dock = (slot: HTMLElement) =>
	{
		if (holder.parentNode !== slot) slot.appendChild(holder);
	};
	const drop = () =>
	{
		pauseIn(holder);
		holder.remove();
		live.current.active = null;
		live.current.clip = null;
		live.current.inCorner = false;
		publish();
	};
	return {
		claim(slot, props, href)
		{
			const state = live.current;
			const letGo = state.letGo;
			if (letGo?.slot === slot)
			{
				if (letGo.id === props.video.id && letGo.chosen === props.chosen) return;
				state.letGo = null;
			}
			const held = state.clip;
			const same = held?.video.id === props.video.id;
			// A waiting clip (the stage's first) never takes the player from the corner or from another host.
			if (!props.chosen && held && (state.inCorner || (!same && state.active !== slot))) return;
			const next: HeldClip = {
				video: props.video,
				title: props.title,
				scoresGame: props.scoresGame,
				autoPlay: props.autoPlay,
				titleAbove: props.titleAbove ?? false,
				href,
			};
			state.onClose = props.onClose;
			if (held && !same)
			{
				// Another clip: the one playing stops, and the player starts over on the new one (its own key).
				pauseIn(holder);
			}
			const moved = state.active !== slot || state.inCorner;
			const changed = !held || !same || held.title !== next.title || held.scoresGame?.gamePk !== next.scoresGame?.gamePk
				|| held.autoPlay !== next.autoPlay || held.titleAbove !== next.titleAbove || held.href !== next.href;
			if (!moved && !changed) return;
			dock(slot);
			state.active = slot;
			state.inCorner = false;
			// The page it plays on is kept while it moves to the corner: the link the fan opened it from.
			state.clip = same && !changed ? held : next;
			publish();
		},
		release(slot)
		{
			const state = live.current;
			if (state.letGo?.slot === slot) state.letGo = null;
			if (state.active !== slot) return;
			state.active = null;
			if (isPlaying(videoIn(holder)) && corner.current)
			{
				dock(corner.current);
				state.inCorner = true;
				publish();
				return;
			}
			drop();
		},
		dismiss(id)
		{
			const state = live.current;
			if (id !== undefined && state.clip?.video.id !== id) return;
			if (state.active && state.clip) state.letGo = {
				slot: state.active,
				id: state.clip.video.id,
				chosen: true,
			};
			drop();
		},
		minimize()
		{
			// Only a host's player offers it (`onMiniPlayer`, never the corner's), so a clip is held in a host's
			// slot; the corner is always mounted.
			const state = live.current;
			state.letGo = {
				slot: state.active!,
				id: state.clip!.video.id,
				chosen: true,
			};
			dock(corner.current!);
			state.active = null;
			state.inCorner = true;
			state.focusCorner += 1;
			publish();
			state.onClose?.();
		},
	};
}

/**
 * The one video player, held above the routes (S198; owner, 2026-11-23: "a way to have the video
 * playing like in the corner while you browse the site kind of like YouTube has"). The shell renders
 * it (`AppShellLayout`) around the pages, so a route change never unmounts it. Its state is React
 * state lifted here (ADR-024: `useState` and props, read through context; no store, proxy or signal).
 *
 * It renders `VideoPlayer` once, keyed by the clip's id alone, through `createPortal` into one holder
 * node it creates once and never replaces. A host (`PlayerDialog`, `PlayerStage`, through
 * `usePlayerSlot`) draws an empty slot, and the provider moves the holder into the slot with
 * `appendChild` as the slot attaches (its callback ref, in the layout phase of the commit that mounts
 * it, so never into a host still lazy or suspended); when a host unmounts, the ref's detach moves the
 * holder out (to the corner, or nowhere) before its DOM goes. So the `<video>` element moves between
 * the dialog, the stage and the corner and is never re-created: no reload, and no fresh `play()`
 * a browser could refuse. A portal whose target changes would remount its children, hence the move.
 * The key is the clip's id only (2026-11-25 focused backlog review): `autoPlay` turning on reaches the
 * player through its own effect (#423), never a remount.
 *
 * As YouTube's mini-player does (owner, 2026-11-25: "it's just a floating video player in the
 * corner and should use exactly the same behaviors that YouTube's mini player uses"):
 *
 * - Leaving a host while its clip plays (any route change, a link in the player, Back or Forward) puts
 *   the clip in the corner (`CornerPlayer`), playing on; a paused clip closes, as before. The tool
 *   row's mini-player button does the same without leaving the page.
 * - The corner's expand control goes to the clip's own page (its link, B424), whose host takes the
 *   clip back; Back to that page does the same. Its close control stops the clip.
 * - Opening another clip replaces it: the new one opens in the full player and the corner closes.
 *
 * `variant` is the shell's pairing, for the corner's width. Nothing is stored (ADR-028): the clip
 * lives in memory for the tab.
 */
export function PlayerProvider({ children, variant = "desktop" }: { children: ReactNode;
	variant?: LayoutVariant; })
{
	const [view, setView] = useState<View>({
		clip: null,
		inCorner: false,
		focusCorner: 0,
	});
	const [holder] = useState(() =>
	{
		const node = document.createElement("div");
		node.className = "bt-player-holder";
		return node;
	});
	const corner = useRef<HTMLDivElement>(null);
	const live = useRef<View & { active: HTMLElement | null;
		letGo: LetGo | null;
		onClose: (() => void) | undefined; }>({
		clip: null,
		inCorner: false,
		focusCorner: 0,
		active: null,
		letGo: null,
		onClose: undefined,
	});
	const [controller] = useState(() => makeController(live, holder, corner, setView));
	const [VideoPlayer, setVideoPlayer] = useState(() => loadedPlayer);
	const navigate = useNavigate();
	const wanted = view.clip !== null;
	useEffect(() =>
	{
		if (VideoPlayer) return;
		let gone = false;
		loadPlayer().then((loaded) =>
		{
			if (!gone) setVideoPlayer(() => loaded);
		}, () => undefined);
		return () =>
		{
			gone = true;
		};
		// `wanted`: a clip chosen after a failed load tries again.
	}, [VideoPlayer, wanted]);
	const clip = view.clip;
	// The clip's title now: a host's, or in the corner, re-titled as Hide Scores changes (`scoresGame`).
	const scoresHidden = useScoresHidden(clip?.scoresGame);
	const title = clip?.scoresGame ? highlightTitle(clip.video, scoresHidden) : clip?.title ?? "";
	return (
		<PlayerContext.Provider value={{
			...controller,
			view,
		}}
		>
			{children}
			<CornerPlayer
				shown={view.inCorner && clip !== null}
				title={title}
				slot={corner}
				holder={holder}
				variant={variant}
				focusRequest={view.focusCorner}
				onExpand={() =>
				{
					if (clip) void navigate(clip.href);
				}}
				onClose={() => controller.dismiss()}
			/>
			{clip && VideoPlayer ? createPortal(
				<VideoPlayer
					key={clip.video.id}
					video={clip.video}
					title={title}
					autoPlay={clip.autoPlay}
					titleAbove={clip.titleAbove}
					compact={view.inCorner}
					onMiniPlayer={view.inCorner ? undefined : controller.minimize}
				/>,
				holder,
			) : null}
		</PlayerContext.Provider>
	);
}

/**
 * The room the corner player needs at the page's end (S198 AC 4): drawn after the site footer while
 * the corner shows, so the footer, its Live strip included, always scrolls clear above it.
 */
export function CornerSpace({ variant }: { variant: LayoutVariant })
{
	const player = useContext(PlayerContext);
	if (!player?.view.inCorner) return null;
	return <Box data-testid="corner-space" style={{
		height: cornerSpace(variant),
		flexShrink: 0,
	}}
	/>;
}

/**
 * A host's place for the one player (S198 AC 3): returns the callback ref of the empty element it draws
 * where the clip goes, whether it holds the player now, and `dismiss`, which stops and drops the clip
 * if it is the host's own (its close control and Esc call it before the host's own close). The slot asks for the player as it
 * attaches, in the layout phase of the commit that mounts it, so a slot that mounts late (the dialog's,
 * a frame after it opens) asks as it appears, and hands it back as it detaches, before its DOM goes;
 * a layout effect passes the host's later changes (`autoPlay` turning on, a new clip). Needs a
 * `PlayerProvider` above.
 */
export function usePlayerSlot(props: SlotProps): {
	slot: (element: HTMLDivElement | null) => void;
	holding: boolean;
	dismiss: () => void;
}
{
	const player = useContext(PlayerContext);
	if (!player) throw new Error("usePlayerSlot needs a PlayerProvider above it");
	const { pathname, search } = useLocation();
	const href = pathname + search;
	const { claim, release } = player;
	// The host's latest ask, for a slot that appears in a commit the host itself didn't render in.
	const latest = useRef({
		props,
		href,
	});
	// The slot element now in the page, if any.
	const attached = useRef<HTMLElement | null>(null);
	// A callback ref, made once (a new one each render would detach and re-attach the slot): it runs
	// as the slot attaches, whichever component's commit draws it (the dialog's sits in Mantine's
	// portal, which mounts a render after the dialog), and with null as it goes, before its DOM does.
	const [slot] = useState(() => (element: HTMLDivElement | null) =>
	{
		if (element)
		{
			attached.current = element;
			claim(element, latest.current.props, latest.current.href);
			return;
		}
		const gone = attached.current;
		attached.current = null;
		if (gone) release(gone);
	});
	useLayoutEffect(() =>
	{
		latest.current = {
			props,
			href,
		};
		if (attached.current) claim(attached.current, props, href);
	});
	const held = player.view.clip;
	return {
		slot,
		holding: held !== null && held.video.id === props.video.id && !player.view.inCorner,
		// Only this host's clip: an Esc before its slot took the player leaves the corner's playing.
		dismiss: () => player.dismiss(props.video.id),
	};
}
