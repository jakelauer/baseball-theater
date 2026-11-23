import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { Notice } from "./NoticeSlot.js";
import { NoticeSlot } from "./NoticeSlot.js";

afterEach(cleanup);

function renderSlot(notice: Notice | null, path = "/")
{
	render(
		<MantineProvider>
			<MemoryRouter initialEntries={[path]}>
				<NoticeSlot notice={notice} />
			</MemoryRouter>
		</MantineProvider>,
	);
}

function updateNotice(): Notice
{
	return {
		id: "update",
		message: "An update to Baseball Theater is ready.",
		update: {
			onUpdate: vi.fn(),
			onSnooze: vi.fn(),
		},
	};
}

describe("NoticeSlot (S60; shell-scoreboard A6)", () =>
{
	it("floats the reload notice at the bottom: message on top, then Snooze and Update Now, right-aligned, and no ✕", async () =>
	{
		const onUpdate = vi.fn();
		const onSnooze = vi.fn();
		renderSlot({
			id: "update",
			message: "An update to Baseball Theater is ready.",
			update: {
				onUpdate,
				onSnooze,
			},
		});
		const float = screen.getByTestId("notice-float");
		expect(float.style.position).toBe("fixed");
		expect(float.style.bottom).toContain("safe-area-inset-bottom");
		expect(screen.queryByTestId("notice-slot")).toBeNull();
		expect(screen.getByRole("status")).toHaveTextContent("An update to Baseball Theater is ready.");
		// Snooze first, so Update Now sits at the far right (A6's interpretation).
		expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Snooze", "Update Now"]);
		expect(screen.queryByRole("button", {
			name: "Dismiss",
		})).toBeNull();
		await userEvent.click(screen.getByRole("button", {
			name: "Update Now",
		}));
		expect(onUpdate).toHaveBeenCalledOnce();
		await userEvent.click(screen.getByRole("button", {
			name: "Snooze",
		}));
		expect(onSnooze).toHaveBeenCalledOnce();
	});

	it("renders a message-only banner under the header with no buttons (the offline marker)", () =>
	{
		renderSlot({
			id: "offline",
			message: "You're offline. Scores as of 7:42 PM — 18 min ago.",
		});
		expect(screen.getByTestId("notice-slot")).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("You're offline.");
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("renders nothing without a notice", () =>
	{
		renderSlot(null);
		expect(screen.queryByTestId("notice-slot")).toBeNull();
		expect(screen.queryByTestId("notice-float")).toBeNull();
	});

	it("S135 AC 2: the link 'See the changelog' sits at the left of the button row, before Snooze and Update Now, and opens /changelog", () =>
	{
		renderSlot(updateNotice());
		const link = screen.getByRole("link", {
			name: "See the changelog",
		});
		expect(link).toHaveAttribute("href", "/changelog");
		const row = link.parentElement!;
		expect(row.firstElementChild).toBe(link);
		const buttons = screen.getAllByRole("button");
		expect(buttons.map((b) => b.textContent)).toEqual(["Snooze", "Update Now"]);
		expect(link.compareDocumentPosition(buttons[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("S135 AC 2: on the change log page the notice shows no link (A9 Link=No), still with Snooze and Update Now", () =>
	{
		renderSlot(updateNotice(), "/changelog");
		expect(screen.getByRole("status")).toHaveTextContent("An update to Baseball Theater is ready.");
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Snooze", "Update Now"]);
	});

	it("S135 AC 2: a message-only marker carries no change log link", () =>
	{
		renderSlot({
			id: "offline",
			message: "You're offline.",
		});
		expect(screen.queryByRole("link")).toBeNull();
	});
});
