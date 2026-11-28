import {
	Button, Group, Menu,
} from "@mantine/core";
import {
	IconCheck, IconCopy, IconDownload, IconExternalLink, IconPictureInPicture, IconSettings, IconShare, IconX,
} from "@tabler/icons-react";
import type { VideoQuality } from "@bt/domain";
import { isMlbClipMp4 } from "@bt/domain";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { askDownloadRoute, downloadHref } from "../../pwa/download.js";

/** How long "Copied" (or "Couldn't copy") stays on the copy button, in ms. */
const COPIED_MS = 2000;

/** One small palette button: a quiet text button with its icon, the same in every slot. */
function ActionButton({
	icon, children, ...rest
}: { icon: ReactNode;
	children: ReactNode;
	onClick?: () => void;
	component?: "a";
	href?: string;
	target?: string;
	rel?: string;
	download?: boolean; })
{
	return (
		<Button variant="subtle" color="gray" size="compact-sm" c="var(--bt-light)" leftSection={icon} {...rest}>
			{children}
		</Button>
	);
}

/**
 * The quality picker (owner, 2026-11-12: "video player needs a quality selector for the
 * several qualities the api shows"): a menu of `videoQualities`' entries with the playing one
 * checked. With one quality there is nothing to pick, so it draws nothing.
 */
export function QualityPicker({
	qualities, current, onChange,
}: { qualities: readonly VideoQuality[];
	current: VideoQuality;
	onChange: (quality: VideoQuality) => void; })
{
	if (qualities.length < 2) return null;
	return (
		<Menu position="top-end" withinPortal={false}>
			<Menu.Target>
				<Button variant="subtle" color="gray" size="compact-sm" c="var(--bt-light)" leftSection={<IconSettings size={14} />} aria-label={`Quality: ${current.label}`}>
					{current.label}
				</Button>
			</Menu.Target>
			<Menu.Dropdown aria-label="Quality">
				{qualities.map((quality) => (
					<Menu.Item
						key={quality.id}
						onClick={() => onChange(quality)}
						aria-current={quality.id === current.id ? "true" : undefined}
						leftSection={quality.id === current.id ? <IconCheck size={14} /> : <span style={{
							display: "inline-block",
							width: 14,
						}}
						/>}
					>
						{quality.label}
					</Menu.Item>
				))}
			</Menu.Dropdown>
		</Menu>
	);
}

/**
 * Whether the service worker controlling this page answers the download route (S151,
 * `askDownloadRoute` in `pwa/download.ts`), asked once on mount and again each time another worker
 * takes control (`controllerchange`), since an older worker still in control under the update
 * prompt would answer the route with the app's page. False until it answers, and where there are no
 * workers. Only the newest question's answer counts, so a slow "no" from the old worker can't hide
 * Download after the new one said yes, and an effect that has been cleaned up (StrictMode mounts
 * twice, `main.tsx`) drops its late answers.
 */
function useDownloadRoute(): boolean
{
	const [ready, setReady] = useState(false);
	useEffect(() =>
	{
		const container = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
		if (!container) return;
		let live = true;
		let latest = 0;
		const ask = () =>
		{
			const asked = ++latest;
			setReady(false);
			void askDownloadRoute(container).then((answer) =>
			{
				if (live && asked === latest) setReady(answer);
			});
		};
		ask();
		container.addEventListener("controllerchange", ask);
		return () =>
		{
			live = false;
			container.removeEventListener("controllerchange", ask);
		};
	}, []);
	return ready;
}

/**
 * The player's palette of clickables (owner, 2026-11-12: "video player needs a palette of
 * helpful clickables (copy link, direct link, download, share)"). BT has no page of its own for a single clip (public playback catalogs
 * are out of scope), so every action works on the clip's own video file: `fileUrl`
 * (`fileQuality`: the MP4 playing, or the same cut's MP4 while an HLS stream plays, since a
 * playlist is not something to save, open or send). Only when MLB gave no MP4 of that cut do
 * Copy link, Direct link and Share fall back to the stream.
 *
 * - **Copy link** puts that URL on the clipboard and reads "Copied" for two seconds, or
 *   "Couldn't copy" when the browser has no clipboard or refuses the write.
 * - **Direct link** opens the file in a new tab.
 * - **Download** (S151) saves the MP4: a browser ignores `download` on another site's file and just
 *   opens it, so it links to BT's own download route (`downloadHref`), which the service worker
 *   answers by streaming MLB's file through as an attachment. It is drawn only while the worker in
 *   control answers that route (`useDownloadRoute`) and there is an MP4 on MLB's clip hosts
 *   (`fileUrl`, `isMlbClipMp4`): never for a stream alone, and never with no worker, where Direct
 *   link opens the file and the browser's own save works.
 * - **Share** opens the device's share sheet with the title and URL. It is drawn only where the
 *   browser has one (`navigator.share`) that takes this title and URL (`navigator.canShare`, where
 *   the browser has it); elsewhere Copy link already does what a fallback would (owner, 2026-11-23,
 *   #417: "I would prefer that we just don't show the share option if it isn't available").
 * - **Mini player** (S198, YouTube's miniplayer button), when the player passes `onMiniPlayer`: sends
 *   the clip to the corner player, playing on, and leaves the fan on the page beneath.
 */
export function PlayerActions({
	title, url, fileUrl, onMiniPlayer,
}: { title: string;
	/** The URL being played. */
	url: string;
	/** The clip's MP4 (`fileQuality`), or null when MLB gave only a stream of this cut. */
	fileUrl: string | null;
	/** Sends the clip to the corner player (S198); without it there is no Mini player button. */
	onMiniPlayer?: () => void; })
{
	const link = fileUrl ?? url;
	const downloadReady = useDownloadRoute();
	const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
	useEffect(() =>
	{
		if (copy === "idle") return;
		const timer = window.setTimeout(() => setCopy("idle"), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [copy]);

	const copyLink = () =>
	{
		// `navigator.clipboard` is missing outside a secure context and in some web views.
		if (!navigator.clipboard)
		{
			setCopy("failed");
			return;
		}
		navigator.clipboard.writeText(link).then(() => setCopy("copied"), () => setCopy("failed"));
	};
	const payload = {
		title,
		url: link,
	};
	// `canShare` is newer than `share` (older Safari has only `share`), so its absence doesn't hide Share.
	const canShare = typeof navigator.share === "function" && (typeof navigator.canShare !== "function" || navigator.canShare(payload));
	const share = () =>
	{
		navigator.share(payload).catch(() =>
		{
			// The reader closed the share sheet: nothing to do.
		});
	};

	const copyIcon = copy === "copied" ? <IconCheck size={14} /> : copy === "failed" ? <IconX size={14} /> : <IconCopy size={14} />;
	return (
		<Group gap={4} wrap="wrap" role="toolbar" aria-label="Video actions" data-testid="player-actions">
			<ActionButton icon={copyIcon} onClick={copyLink}>
				{copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : "Copy link"}
			</ActionButton>
			<ActionButton icon={<IconExternalLink size={14} />} component="a" href={link} target="_blank" rel="noopener noreferrer">
				Direct link
			</ActionButton>
			{downloadReady && fileUrl && isMlbClipMp4(fileUrl) ? (
				<ActionButton icon={<IconDownload size={14} />} component="a" href={downloadHref(fileUrl, title)} download>
					Download
				</ActionButton>
			) : null}
			{canShare ? (
				<ActionButton icon={<IconShare size={14} />} onClick={share}>
					Share
				</ActionButton>
			) : null}
			{onMiniPlayer ? (
				<ActionButton icon={<IconPictureInPicture size={14} />} onClick={onMiniPlayer}>
					Mini player
				</ActionButton>
			) : null}
		</Group>
	);
}
