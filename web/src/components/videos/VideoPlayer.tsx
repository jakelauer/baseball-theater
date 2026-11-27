import {
	Box, Group, Stack, Text,
} from "@mantine/core";
import type { VideoQuality } from "@bt/domain";
import {
	defaultVideoQuality, fileQuality, rememberedVideoQuality, videoQualities,
} from "@bt/domain";
import {
	useEffect, useRef, useState,
} from "react";
import { setVideoQuality, useVideoQuality } from "../../settings/store.js";
import { loadHls } from "./hls-loader.js";
import { PlayerActions, QualityPicker } from "./PlayerActions.js";
import type { Video } from "./VideoCard.js";

/**
 * VISUAL-DESIGN §6: under the player, always, verbatim. It lives here and nowhere else, so
 * the dialog and the stage can't drift apart (game-shell DESIGN, S36's choice).
 */
const DISCLAIMER = "This video is provided by MLBAM and MLB.com and has no affiliation with or connection to Baseball Theater. It has been displayed on your device via a public API provided by Major League Baseball.";

/**
 * True when a key press belongs to whatever has focus (typing, a button, or the `<video>` itself,
 * whose built-in controls already play and pause on Space, #579), not to the player.
 */
function ownsSpace(target: HTMLElement): boolean
{
	return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "VIDEO"].includes(target.tagName) || target.getAttribute("role") === "button";
}

/** Plays a paused clip and pauses a playing one; a refused play (no source, autoplay rules) is ignored. */
function toggleVideo(element: HTMLVideoElement | null): void
{
	if (!element) return;
	if (element.paused) void element.play().catch(() => undefined);
	else element.pause();
}

/** The MIME type of an HLS playlist, as `canPlayType` names it. */
const HLS_TYPE = "application/vnd.apple.mpegurl";

/**
 * How this browser can play an HLS quality (#415): `"native"` in a plain `<video>` (Safari, every
 * iOS browser, Android Chrome), `"library"` through hls.js over Media Source Extensions (desktop
 * Chrome and Firefox; the same H.264 check `Hls.isSupported` makes, done here so the library
 * itself loads only when an HLS clip plays), or `null` where neither works, so the picker leaves
 * HLS out. Native wins where both work, since it needs no download.
 */
type HlsPath = "native" | "library" | null;

function hlsPath(): HlsPath
{
	if (typeof document === "undefined") return null;
	if (document.createElement("video").canPlayType(HLS_TYPE) !== "") return "native";
	const sources = globalThis as { ManagedMediaSource?: { isTypeSupported?: (type: string) => boolean };
		MediaSource?: { isTypeSupported?: (type: string) => boolean }; };
	const source = sources.ManagedMediaSource ?? sources.MediaSource;
	return source?.isTypeSupported?.("video/mp4; codecs=\"avc1.42E01E,mp4a.40.2\"") ? "library" : null;
}

/**
 * The qualities this browser can play: `videoQualities`' list, without HLS where there is no way
 * to play it (`path` null, or hls.js already failed on this clip, `libraryFailed`).
 */
function playableQualities(video: Video, path: HlsPath, libraryFailed: boolean): VideoQuality[]
{
	const hls = path === "native" || (path === "library" && !libraryFailed);
	return videoQualities(video).filter((quality) => hls || !quality.hls);
}

/**
 * Plays the element for a reader who wants it playing. If the browser refuses (`NotAllowedError`:
 * autoplay blocked by a site setting, Low Power Mode, or a play with no user gesture), they can't
 * have it playing, so `wantsPlay` goes back to paused. Any other refusal (an `AbortError` when a
 * newer load replaces this one) leaves the intent for that load to follow.
 */
function playWanted(element: HTMLVideoElement | null, wantsPlay: { current: boolean }): void
{
	void element?.play().catch((error: unknown) =>
	{
		// A DOMException, which isn't an Error subclass everywhere, so read its name.
		if ((error as { name?: unknown } | null)?.name !== "NotAllowedError") return;
		wantsPlay.current = false;
	});
}

/**
 * A Space press on the page (the built-in controls take presses on the clip itself, #579). While
 * a quality switch reloads the clip (`reloading`) the element reports itself paused whatever the
 * reader wants, so the press follows `wantsPlay`: a pause records it in `wantsPlay` (which the
 * reload's `loadedmetadata` follows) and pauses the element in case an earlier press already
 * started it; a play goes to the element, since `play()` also starts a load the browser may not
 * have begun (iOS can skip `preload="metadata"`). On a failed load a press only changes what the
 * reader wants; picking another quality reloads. Otherwise it plays or pauses the element; its
 * play / pause events update `wantsPlay`.
 */
function togglePlayer(element: HTMLVideoElement | null, reloading: boolean, wantsPlay: { current: boolean }): void
{
	if (!reloading)
	{
		toggleVideo(element);
		return;
	}
	if (wantsPlay.current)
	{
		wantsPlay.current = false;
		element?.pause();
		return;
	}
	playWanted(element, wantsPlay);
}

/**
 * The one video player (S70; game-shell `video-player` frames): the clip under the browser's
 * own controls (seek, mute and volume, fullscreen, captions, AirPlay / picture-in-picture),
 * which replace the frames' custom play button, progress bar and clock (owner, 2026-11-25,
 * #579: "Yeah, let's use the default controls."), the title, and the MLBAM disclaimer.
 * `PlayerDialog` and `PlayerStage` host it (through `PlayerProvider`, below); neither repeats any of it.
 * Space plays and pauses (VISUAL-DESIGN §6) unless focus is on something Space already
 * means something to, such as the search box, a button or the clip. `autoPlay` starts the clip when
 * the reader chose it; the stage's first clip waits for a press. `autoPlay` turning on after mount
 * (the dialog once its opening transition ends, #423) plays the same element, since the
 * `<video>`'s own autoplay counts only on its first load.
 *
 * Under the clip sit the quality picker (`QualityPicker`, the clip's
 * `videoQualities` this browser can play, HLS natively or through hls.js, starting on the quality the reader last
 * chose, else the nearest one the clip has, else `playbackUrl`'s: `rememberedVideoQuality`, #416) and the palette of
 * actions (`PlayerActions`: copy link, direct link, download (S151), share), both on the quality
 * being played. Switching quality records it as the reader's choice (`setVideoQuality`; a fallback
 * never does), keeps the place in the clip, and plays on only if the
 * reader wants it playing (`wantsPlay`); only the first source autoplays.
 *
 * The title sits under the tools by default, as the stage draws it (standings-search-settings A10);
 * `titleAbove` puts it above the clip, one size larger, for the dialog (S196; owner, 2026-11-23: "the
 * title should be on top of the video … The title should be a little bit bigger than it is"). The
 * disclaimer is last either way.
 *
 * `PlayerProvider` renders the only one (S198), moving it between the dialog, the stage and the corner
 * player. `compact` is the corner's drawing: the clip alone, without the browser's controls (the
 * corner draws its own), the title, the tools or the disclaimer, and Space left to the page, whose
 * fan is browsing it. Each part comes and goes in its own place, so the `<video>` is never re-created.
 * `onMiniPlayer` adds the tool row's Mini player button (`PlayerActions`).
 */
export function VideoPlayer({
	video, title = video.title, autoPlay = false, titleAbove = false, compact = false, onMiniPlayer,
}: { video: Video;
	/** The clip's title; the game page passes `highlightTitle`'s (S75). */
	title?: string;
	autoPlay?: boolean;
	/** Title above the clip at `md` (the dialog, S196) rather than under the tools at `sm` (the stage). */
	titleAbove?: boolean;
	/** The corner player's drawing (S198): the clip alone, no built-in controls, Space not taken. */
	compact?: boolean;
	/** Sends the clip to the corner player (S198): the tool row's Mini player button. */
	onMiniPlayer?: () => void; })
{
	const ref = useRef<HTMLVideoElement>(null);
	// `compact` as last rendered, read by the page-wide Space handler.
	const compactNow = useRef(compact);
	useEffect(() =>
	{
		compactNow.current = compact;
	});

	const path = hlsPath();
	// Set once hls.js fails on this clip (a fatal error, or its chunk wouldn't load): HLS leaves the picker.
	const [libraryFailed, setLibraryFailed] = useState(false);
	const qualities = playableQualities(video, path, libraryFailed);
	const [picked, setPicked] = useState<string | null>(null);
	const remembered = useVideoQuality();
	const quality = qualities.find((entry) => entry.id === picked) ?? rememberedVideoQuality(qualities, remembered, video.playbackUrl);
	// The playlist hls.js plays into the element, when the quality is HLS and the browser can't play it itself.
	const libraryUrl = quality?.hls && path === "library" ? quality.url : null;
	// Where to pick up after a quality switch reloads the clip.
	const resume = useRef<{ time: number } | null>(null);
	// Whether the reader wants the clip playing: set by autoplay's intent and by their own
	// play/pause, not sampled from the element at switch time, since a reloading or
	// not-yet-autoplayed clip reports itself paused. The media load algorithm sets `paused`
	// without firing `pause`, so only real plays and pauses move it.
	const wantsPlay = useRef(autoPlay);
	// `autoPlay` as last rendered, so only its turning on after mount plays the clip here (#423).
	const autoPlayed = useRef(autoPlay);

	const switchTo = (next: VideoQuality) =>
	{
		const element = ref.current;
		if (next.id === quality?.id) return;
		// A second switch before the first loads keeps the first one's time, not the reload's 0.
		if (element) resume.current = {
			time: resume.current?.time ?? element.currentTime,
		};
		setPicked(next.id);
		setVideoQuality(next.id);
	};
	// The clip as a file (`fileQuality`): the MP4 playing, or the same cut's MP4 while a stream plays.
	const fileUrl = fileQuality(qualities, quality)?.url ?? null;

	useEffect(() =>
	{
		const turnedOn = autoPlay && !autoPlayed.current;
		autoPlayed.current = autoPlay;
		// Only the first source autoplays (`picked` null), as the element's own `autoPlay` below.
		if (!turnedOn || picked !== null) return;
		wantsPlay.current = true;
		playWanted(ref.current, wantsPlay);
		// Only `autoPlay` turning on plays: a quality pick mustn't.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoPlay]);

	useEffect(() =>
	{
		function onKey(event: KeyboardEvent): void
		{
			if (event.code !== "Space" || compactNow.current || ownsSpace(event.target as HTMLElement)) return;
			event.preventDefault();
			togglePlayer(ref.current, resume.current !== null, wantsPlay);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	// hls.js plays `libraryUrl` (#415), loaded only now (`loadHls`), so the entry bundle never
	// carries it. A new quality or clip, or the player closing, destroys it; by then React has
	// already set the next MP4's `src`, which hls.js leaves alone since it only clears its own blob
	// URL. If hls.js fails (a fatal error, or its chunk won't load), HLS leaves the picker and the
	// clip goes on from the same moment in the same cut's MP4 (`fileQuality`), else the clip's
	// sharpest MP4. A clip MLB gives no MP4 for has nothing to fall back to: it stays paused.
	useEffect(() =>
	{
		const element = ref.current;
		if (!libraryUrl || !element) return;
		let cancelled = false;
		let player: { destroy(): void } | null = null;
		const fail = () =>
		{
			if (cancelled) return;
			// Read the place first: destroying hls.js detaches its stream, which resets `currentTime`.
			const time = resume.current?.time ?? element.currentTime;
			player?.destroy();
			player = null;
			setLibraryFailed(true);
			const files = videoQualities(video).filter((entry) => !entry.hls);
			const sameCut = fileQuality(videoQualities(video), quality);
			const fallback = sameCut && !sameCut.hls ? sameCut : defaultVideoQuality(files, video.playbackUrl);
			if (!fallback)
			{
				// Nothing plays here: no reload will come to resume.
				resume.current = null;
				wantsPlay.current = false;
				return;
			}
			resume.current = {
				time,
			};
			// Never back to null: that would re-arm the first source's autoplay against a pause.
			setPicked(fallback.id);
		};
		loadHls().then(({ default: Hls }) =>
		{
			if (cancelled) return;
			const hls = new Hls();
			// Captions start off (#580). This light build has no subtitle controller, so here (Chrome,
			// Firefox) Auto carries no caption track at all and the setting only states the intent;
			// where the browser plays HLS itself (Safari, iOS) its CC menu and system setting decide.
			hls.subtitleDisplay = false;
			player = hls;
			hls.on(Hls.Events.ERROR, (_event, data) =>
			{
				if (data.fatal) fail();
			});
			hls.loadSource(libraryUrl);
			hls.attachMedia(element);
		}, fail);
		return () =>
		{
			cancelled = true;
			player?.destroy();
		};
		// Only a new playlist starts a new player; `video` and `quality` change with it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [libraryUrl]);

	return (
		<Stack gap={10} data-testid="video-player">
			{titleAbove && !compact ? <Text size="md" fw={500}>{title}</Text> : null}
			<Box
				component="video"
				ref={ref}
				// The browser's own controls (#579): a click or tap on the picture is theirs to handle.
				// The corner player draws its own (S198).
				controls={!compact}
				// No `src` while hls.js plays the quality: it attaches its own stream (the effect above).
				src={libraryUrl ? undefined : quality?.url ?? video.playbackUrl ?? undefined}
				poster={video.imageUrl ?? undefined}
				// Only the first source autoplays: a quality switch reloads the clip, and a reload
				// would otherwise autoplay a clip the reader had paused (`wantsPlay` decides instead).
				autoPlay={autoPlay && picked === null}
				// Without these iOS takes a playing clip fullscreen; the prefixed one is for
				// older iOS and in-app web views that still read it.
				playsInline
				webkit-playsinline="true"
				preload="metadata"
				onPlay={() =>
				{
					wantsPlay.current = true;
				}}
				onPause={() =>
				{
					wantsPlay.current = false;
				}}
				// At the end, go back to the start (#581): the picture holds a frame instead of going
				// blank, and the next play starts the clip again on every browser.
				onEnded={(event) =>
				{
					event.currentTarget.currentTime = 0;
				}}
				onLoadedMetadata={(event) =>
				{
					const element = event.currentTarget;
					const at = resume.current;
					if (!at) return;
					resume.current = null;
					element.currentTime = at.time;
					if (wantsPlay.current) playWanted(element, wantsPlay);
				}}
				style={{
					display: "block",
					width: "100%",
					aspectRatio: "16 / 9",
					// Contain, not cover: a portrait cut (`videoQualities`) shows whole, letterboxed on Raised.
					objectFit: "contain",
					// Square in the corner, whose own border rounds it.
					borderRadius: compact ? 0 : 8,
					background: "var(--bt-raised)",
				}}
			/>
			{quality && !compact ? (
				<Group gap={4} justify="space-between" wrap="wrap">
					<PlayerActions title={title} url={quality.url} fileUrl={fileUrl} onMiniPlayer={onMiniPlayer} />
					<QualityPicker qualities={qualities} current={quality} onChange={switchTo} />
				</Group>
			) : null}
			{titleAbove || compact ? null : <Text size="sm" fw={500}>{title}</Text>}
			{compact ? null : (
				<Stack gap={2}>
					{/* `xs`, as the tools row's labels: 10px was too small to read (#589). */}
					<Text size="xs" fw={700} tt="uppercase" c="var(--bt-muted)">Disclaimer:</Text>
					<Text size="xs" lh={1.4} c="var(--bt-muted)">{DISCLAIMER}</Text>
				</Stack>
			)}
		</Stack>
	);
}
