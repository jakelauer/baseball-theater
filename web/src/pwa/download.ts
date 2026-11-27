/**
 * Download (S151; owner, 2026-11-12: "video player needs a palette of helpful clickables (copy link,
 * direct link, download, share)"). A browser ignores `download` on a link to another site's file, so
 * the player's Download links to a route on BT's own origin, {@link DOWNLOAD_PATH}, which the service
 * worker (`sw.ts`) answers by fetching MLB's MP4 and passing its body straight through as an
 * attachment: nothing holds the whole file (a condensed game is hundreds of MB), and the bytes still
 * come from MLB, so BT's servers carry none of it. The worker only ever fetches what `isMlbClipMp4`
 * (`@bt/domain`) accepts, so the route is never an open proxy.
 *
 * The page shows Download only while the worker controlling it answers {@link DOWNLOAD_PING}
 * (`askDownloadRoute`): an older worker still in control under the update prompt would answer the
 * route with the app's page, and a browser that can't stream a body through a worker gets no answer.
 *
 * No side effects on import: the worker entry (`sw.ts`) wires these up, and the tests and the page import them.
 */
import { isMlbClipMp4 } from "@bt/domain";

/** The same-site path the worker answers with the file: `/download/clip?url=<MLB MP4>&name=<title>`. */
export const DOWNLOAD_PATH = "/download/clip";

/** The message the page sends the controlling worker to ask whether it answers {@link DOWNLOAD_PATH}. */
export const DOWNLOAD_PING = {
	type: "BT_DOWNLOAD_PING",
} as const;

/** The worker's answer to {@link DOWNLOAD_PING}, posted on the port the page sent with it. */
export const DOWNLOAD_READY = {
	type: "BT_DOWNLOAD_READY",
} as const;

/** How long the page waits for the worker's answer before taking silence as "no" (an older worker never answers). */
export const DOWNLOAD_PING_TIMEOUT_MS = 1000;

/** The route's link for a clip's MP4 and its title (the player's Download `href`). */
export function downloadHref(fileUrl: string, title: string): string
{
	const query = new URLSearchParams({
		url: fileUrl,
		name: title,
	});
	return `${DOWNLOAD_PATH}?${query.toString()}`;
}

/**
 * A video file's extension at the end of a title (`.mp4`, `.MOV`), dropped so the saved name doesn't
 * end `.mp4.mp4`. Only video extensions: a title's own last word after a dot ("Dodgers vs. Cubs 5.2")
 * is kept, and the name still ends `.mp4` either way.
 */
const TRAILING_VIDEO_EXTENSION = /\.(?:mp4|m4v|mov|webm|mkv|avi)$/i;

/** A UTF-16 half with no partner, which `encodeURIComponent` throws on (a title cut mid-character). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * RFC 5987's encoding of `text` for `filename*`: `encodeURIComponent`, plus the four characters it
 * leaves alone that RFC 5987's `attr-char` doesn't allow (`'`, `(`, `)`, `*`).
 */
function rfc5987(text: string): string
{
	return encodeURIComponent(text.replace(LONE_SURROGATE, "")).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The `Content-Disposition` for a clip titled `title`: never the caller's name as given. The title
 * loses a trailing video extension, then `filename` is its ASCII slug (lower case, each run of anything
 * but `a-z0-9` one `-`, trimmed; `clip` when nothing is left) and `filename*` (RFC 5987, which
 * browsers prefer) the title itself without CR, LF, `"`, `/` or `\`, percent-encoded; both end `.mp4`.
 */
export function contentDisposition(title: string): string
{
	const base = title.replace(TRAILING_VIDEO_EXTENSION, "");
	const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "clip";
	const plain = base.replace(/[\r\n"/\\]/g, "") || "clip";
	return `attachment; filename="${slug}.mp4"; filename*=UTF-8''${rfc5987(plain)}.mp4`;
}

/** The route's answer when MLB's answer can't be passed on: no `Content-Disposition`, so an error page is never saved as a video. */
function badGateway(): Response
{
	return new Response("The clip could not be fetched.", {
		status: 502,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}

/**
 * The worker's answer to a request for {@link DOWNLOAD_PATH} (`href`, the whole request URL). Its
 * `url` must be an MLB clip MP4 (`isMlbClipMp4`), else 400 and nothing is fetched. MLB's file is
 * fetched with `redirect: "error"`, so a 30x can't lead it elsewhere, and its body is passed on
 * unread with `Content-Disposition: attachment` and MLB's `Content-Length` (the browser's progress),
 * unless MLB names a `Content-Encoding` other than `identity`: `fetch` hands on the decoded bytes, so
 * an encoded file's length would be the wrong count, and the download goes without one. (A cross-origin
 * answer shows `Content-Encoding` only when MLB exposes it; MP4s aren't compressed in transit, so this
 * guards the case the worker can see.)
 * A non-2xx answer (a removed clip's 403 or 404) or a failed fetch is a 502. `fetcher` is the
 * worker's `fetch`; tests pass a fake.
 */
export async function downloadResponse(href: string, fetcher: typeof fetch): Promise<Response>
{
	const query = new URL(href).searchParams;
	const clip = query.get("url") ?? "";
	if (!isMlbClipMp4(clip))
	{
		return new Response("Only MLB clip MP4s can be downloaded.", {
			status: 400,
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
			},
		});
	}
	let upstream: Response;
	try
	{
		upstream = await fetcher(clip, {
			redirect: "error",
		});
	}
	catch
	{
		return badGateway();
	}
	if (!upstream.ok || !upstream.body)
	{
		// Let go of an error page's body rather than leave its connection open.
		void upstream.body?.cancel().catch(() => undefined);
		return badGateway();
	}
	const headers = new Headers({
		"Content-Type": "video/mp4",
		"Content-Disposition": contentDisposition(query.get("name") ?? ""),
	});
	const length = upstream.headers.get("Content-Length");
	const encoding = upstream.headers.get("Content-Encoding");
	if (length && (!encoding || encoding.trim().toLowerCase() === "identity")) headers.set("Content-Length", length);
	return new Response(upstream.body, {
		status: 200,
		headers,
	});
}

/**
 * Whether this browser's worker can answer with a body it streams through (`ReadableStream` passed to a
 * `Response`). Where it can't, the worker doesn't answer the ping, so Download stays hidden rather
 * than falling back to holding the whole file.
 */
export function canStreamDownloads(): boolean
{
	try
	{
		return typeof ReadableStream === "function" && new Response(new ReadableStream()).body !== null;
	}
	catch
	{
		return false;
	}
}

/**
 * The worker's side of the ping: answers {@link DOWNLOAD_PING} on the port it came with, when it can
 * stream. True when `data` was the ping (answered or not), so the caller knows it was handled.
 */
export function answerDownloadPing(data: unknown, ports: readonly MessagePort[], canStream: () => boolean = canStreamDownloads): boolean
{
	if ((data as { type?: unknown } | null)?.type !== DOWNLOAD_PING.type) return false;
	if (canStream()) ports[0]?.postMessage(DOWNLOAD_READY);
	return true;
}

/**
 * The page's side of the ping: whether the worker controlling the page answers {@link DOWNLOAD_PATH}.
 * False with no worker support, no controller (a first visit, a private window that refuses
 * workers), or no answer within {@link DOWNLOAD_PING_TIMEOUT_MS} (an older worker ignores the ping).
 */
export function askDownloadRoute(container: ServiceWorkerContainer | undefined, timeoutMs: number = DOWNLOAD_PING_TIMEOUT_MS): Promise<boolean>
{
	const controller = container?.controller;
	if (!controller) return Promise.resolve(false);
	return new Promise((resolve) =>
	{
		const channel = new MessageChannel();
		const timer = setTimeout(() => finish(false), timeoutMs);
		function finish(ready: boolean): void
		{
			clearTimeout(timer);
			channel.port1.close();
			resolve(ready);
		}
		channel.port1.onmessage = (event: MessageEvent) => finish((event.data as { type?: unknown } | null)?.type === DOWNLOAD_READY.type);
		controller.postMessage(DOWNLOAD_PING, [channel.port2]);
	});
}
