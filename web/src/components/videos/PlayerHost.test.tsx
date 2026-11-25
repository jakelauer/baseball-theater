/**
 * S70: the Video Player setting picks the host — the dialog by default and for signed-out
 * readers, the stage when chosen — and a change moves the player without a reload.
 */
import type { AccountSettings } from "@bt/domain";
import { Drawer, MantineProvider } from "@mantine/core";
import {
	act, cleanup, fireEvent, render, screen,
} from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { resetSettings, setVideoPlayer } from "../../settings/store.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { PlayerHost } from "./PlayerHost.js";
import type { Video } from "./VideoCard.js";

const clip = (id: string): Video => ({
	id,
	playId: null,
	title: `Clip ${id}`,
	blurb: null,
	duration: "00:00:20",
	imageUrl: null,
	playbackUrl: null,
});

// Elements a test appends to the body itself (a stand-in card, input or modal), removed after it.
const appended: HTMLElement[] = [];

function append<T extends HTMLElement>(element: T): T
{
	appended.push(element);
	document.body.append(element);
	return element;
}

afterEach(() =>
{
	cleanup();
	for (const element of appended.splice(0)) element.remove();
	vi.unstubAllGlobals();
	resetSettings();
});

function renderHost(video: Video | null)
{
	return render(
		<MantineProvider>
			<MemoryRouter>
				<PlayerHost video={video} first={clip("first")} onClose={() => undefined} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

describe("PlayerHost", () =>
{
	it("signed out: the house defaults play a chosen clip in the dialog, and nothing shows until one is chosen", async () =>
	{
		resetSettings();
		const { rerender } = renderHost(null);
		expect(screen.queryByTestId("video-player")).toBeNull();
		rerender(
			<MantineProvider>
				<MemoryRouter>
					<PlayerHost video={clip("chosen")} first={clip("first")} onClose={() => undefined} />
				</MemoryRouter>
			</MantineProvider>,
		);
		expect(await screen.findByRole("dialog")).toHaveTextContent("Clip chosen");
	});

	it("host: choosing Stage moves the player out of the dialog onto the stage without a reload, showing the first clip until one is chosen", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		renderHost(null);
		expect(screen.queryByTestId("video-player")).toBeNull();
		await act(() => setVideoPlayer("stage"));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByRole("region", {
			name: "Video player",
		})).toHaveTextContent("Clip first");
	});

	it("host: on the stage with no clips at all, nothing renders", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		await act(() => setVideoPlayer("stage"));
		render(
			<MantineProvider>
				<PlayerHost video={null} first={undefined} onClose={() => undefined} />
			</MantineProvider>,
		);
		expect(screen.queryByTestId("video-player")).toBeNull();
	});

	it("stage: Esc closes a chosen clip, as it does the dialog, and does nothing while the stage only waits (#414)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		await act(() => setVideoPlayer("stage"));
		const onClose = vi.fn();
		const { rerender } = render(
			<MantineProvider>
				<PlayerHost video={null} first={clip("first")} onClose={onClose} />
			</MantineProvider>,
		);
		fireEvent.keyDown(document.body, {
			key: "Escape",
			code: "Escape",
		});
		expect(onClose).not.toHaveBeenCalled();
		const card = document.createElement("button");
		document.body.append(card);
		card.focus();
		rerender(
			<MantineProvider>
				<PlayerHost video={clip("chosen")} first={clip("first")} onClose={onClose} />
			</MantineProvider>,
		);
		card.blur();
		fireEvent.keyDown(document.body, {
			key: "Escape",
			code: "Escape",
		});
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(card);
		card.remove();
	});

	it("stage: Esc that closes an open drawer leaves the clip playing (#414)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		await act(() => setVideoPlayer("stage"));
		const onClose = vi.fn();
		// As VideosRoom renders FilterDrawer: mounted only while open. flushSync unmounts it inside
		// Mantine's window-capture handler, as the browser's microtask checkpoint does before the
		// stage's document listener runs, so the drawer is already gone when that listener looks.
		function WithDrawer()
		{
			const [open, setOpen] = useState(true);
			return (
				<>
					<PlayerHost video={clip("chosen")} first={clip("first")} onClose={onClose} />
					{open ? <Drawer opened title="Filters" onClose={() => flushSync(() => setOpen(false))}><button type="button">Apply</button></Drawer> : null}
				</>
			);
		}
		render(
			<MantineProvider>
				<WithDrawer />
			</MantineProvider>,
		);
		const apply = await screen.findByRole("button", {
			name: "Apply",
		});
		apply.focus();
		pressEscape(apply);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: Esc with a modal open elsewhere and focus on the page leaves the clip playing (#414)", async () =>
	{
		const onClose = await renderChosen();
		const modal = append(document.createElement("div"));
		modal.setAttribute("aria-modal", "true");
		pressEscape(document.body);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: Esc on an open menu's item closes the menu, not the clip (#414)", async () =>
	{
		const onClose = await renderChosen();
		const menu = append(document.createElement("div"));
		menu.setAttribute("role", "menu");
		const item = document.createElement("button");
		menu.append(item);
		pressEscape(item);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: Esc on an expanded disclosure (a group header, no pop-up) still closes the clip (#414)", async () =>
	{
		const onClose = await renderChosen();
		const header = append(document.createElement("button"));
		header.setAttribute("aria-expanded", "true");
		pressEscape(header);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("stage: Esc that cancels an IME composition (typing in the search box) leaves the clip playing (#414)", async () =>
	{
		const onClose = await renderChosen();
		const search = append(document.createElement("input"));
		search.focus();
		fireEvent.keyDown(search, {
			key: "Escape",
			code: "Escape",
			isComposing: true,
		});
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: Esc another handler already took (preventDefault) leaves the clip playing (#414)", async () =>
	{
		const onClose = await renderChosen();
		const owner = append(document.createElement("button"));
		owner.addEventListener("keydown", (event) => event.preventDefault());
		pressEscape(owner);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: in full screen Esc leaves the clip playing (the browser leaves full screen) (#414)", async () =>
	{
		const onClose = await renderChosen();
		Object.defineProperty(document, "fullscreenElement", {
			configurable: true,
			value: document.body,
		});
		try
		{
			pressEscape(document.body);
		}
		finally
		{
			Reflect.deleteProperty(document, "fullscreenElement");
		}
		expect(onClose).not.toHaveBeenCalled();
	});

	it("stage: Esc after focus moved elsewhere leaves focus there (#414)", async () =>
	{
		const card = append(document.createElement("button"));
		card.focus();
		const onClose = await renderChosen();
		const search = append(document.createElement("input"));
		search.setAttribute("aria-label", "Search videos");
		search.focus();
		pressEscape(search);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(search);
	});

	it("stage: Esc from the player's own controls returns focus to the card (#414)", async () =>
	{
		const card = append(document.createElement("button"));
		card.focus();
		const onClose = await renderChosen();
		// The clip itself, which carries the browser's built-in controls (#579).
		const video = screen.getByTestId("video-player").querySelector("video")!;
		video.tabIndex = 0;
		video.focus();
		pressEscape(video);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(card);
	});

	it("stage: once the clip is closed or the stage unmounts, Esc does nothing more (#414)", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
		await act(() => setVideoPlayer("stage"));
		const onClose = vi.fn();
		const { rerender, unmount } = render(
			<MantineProvider>
				<PlayerHost video={clip("chosen")} first={clip("first")} onClose={onClose} />
			</MantineProvider>,
		);
		pressEscape(document.body);
		expect(onClose).toHaveBeenCalledTimes(1);
		rerender(
			<MantineProvider>
				<PlayerHost video={null} first={clip("first")} onClose={onClose} />
			</MantineProvider>,
		);
		pressEscape(document.body);
		expect(onClose).toHaveBeenCalledTimes(1);
		unmount();
		pressEscape(document.body);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

/** Renders the stage host playing a chosen clip and returns its `onClose` spy. */
async function renderChosen()
{
	vi.stubGlobal("fetch", vi.fn(async (request: Request) => jsonResponse(await request.json() as AccountSettings)));
	await act(() => setVideoPlayer("stage"));
	const onClose = vi.fn();
	render(
		<MantineProvider>
			<PlayerHost video={clip("chosen")} first={clip("first")} onClose={onClose} />
		</MantineProvider>,
	);
	return onClose;
}

/** Presses Escape on `target`, bubbling to the document as a real key press does. */
function pressEscape(target: Element): void
{
	fireEvent.keyDown(target, {
		key: "Escape",
		code: "Escape",
	});
}
