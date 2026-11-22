/**
 * The rail's look, pinned to the Figma `nav-rail` values (S83): the active item
 * filled Primary with a Primary Light marker, inactive items with an invisible
 * marker at the same inset, 15px labels, an 11px Light version line.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { setSessionToken } from "../session/token.js";
import { stubMeApi } from "../test/meApi.js";
import { NavRail } from "./NavRail.js";

function renderRail(path: string)
{
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<NavRail />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

const item = (name: string) => screen.getByRole("link", {
	name,
});

beforeEach(() =>
{
	setSessionToken(null);
	stubMeApi();
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("NavRail active item (S83)", () =>
{
	it("fills the active item Primary with the Primary Light marker; an inactive item has no visible marker", () =>
	{
		renderRail("/standings");
		const active = item("Standings");
		expect(active).toHaveAttribute("aria-current", "page");
		expect(active.style.background).toBe("var(--bt-primary)");
		expect(within(active).getByTestId("nav-marker").style.background).toBe("var(--bt-primary-light)");

		const inactive = item("Scoreboard");
		expect(inactive).not.toHaveAttribute("aria-current");
		expect(inactive.style.background).toBe("transparent");
		expect(within(inactive).getByTestId("nav-marker").style.background).toBe("transparent");
	});
});

describe("NavRail Figma values (S83)", () =>
{
	it("Figma: 44px rows, 8px radius, 12/16 padding, a 4x20 marker 12px before a 15px label; active SemiBold", () =>
	{
		renderRail("/games/2024-07-04");
		const active = item("Scoreboard");
		expect(active.style.height).toBe("44px");
		expect(active.style.borderRadius).toBe("8px");
		expect(active.style.padding).toBe("12px 16px");
		expect(active.style.gap).toBe("12px");
		const marker = within(active).getByTestId("nav-marker");
		expect(marker.style.width).toBe("4px");
		expect(marker.style.height).toBe("20px");
		const label = within(active).getByText("Scoreboard");
		expect(label.style.fontSize).toMatch(/15px|calc\(0\.9375rem/);
		expect(label.style.fontWeight).toBe("600");
		expect(within(item("Search")).getByText("Search").style.fontWeight).toBe("400");
	});

	it("Figma: the version line is 11px Light, not dimmed", () =>
	{
		renderRail("/games/2024-07-04");
		const version = screen.getByTestId("version-line");
		expect(version.style.fontSize).toMatch(/11px|calc\(0\.6875rem/);
		expect(version.style.color).toBe("var(--bt-light)");
	});
});

describe("NavRail change log link (S134 AC 3)", () =>
{
	const changelog = () => screen.getByTestId("changelog-link");

	it("S134 AC 3: rail: a link reading 'Changelog' to /changelog, outside the nav list, right above the version line, which is not a link", () =>
	{
		renderRail("/standings");
		const link = item("Changelog");
		expect(link).toBe(changelog());
		expect(link).toHaveTextContent(/^Changelog$/);
		expect(link).toHaveAttribute("href", "/changelog");
		expect(screen.getByRole("list")).not.toContainElement(link);
		const version = screen.getByTestId("version-line");
		expect(link.nextElementSibling).toBe(version);
		expect(version.closest("a")).toBeNull();
	});

	it("S134 AC 3: rail: plain on /standings (no fill, not current, Regular 13) while Standings is the active item", () =>
	{
		renderRail("/standings");
		const link = changelog();
		expect(link).not.toHaveAttribute("aria-current");
		expect(link.style.background).toBe("transparent");
		const words = within(link).getByText("Changelog");
		expect(words.style.fontSize).toMatch(/13px|calc\(0\.8125rem/);
		expect(words.style.fontWeight).toBe("400");
		expect(item("Standings")).toHaveAttribute("aria-current", "page");
	});

	for (const path of ["/changelog", "/changelog?x=1"])
	{
		it(`S134 AC 3: rail: current on ${path} (Primary fill, SemiBold, aria-current="page") with no nav item marked active`, () =>
		{
			renderRail(path);
			const link = changelog();
			expect(link).toHaveAttribute("aria-current", "page");
			expect(link.style.background).toBe("var(--bt-primary)");
			expect(within(link).getByText("Changelog").style.fontWeight).toBe("600");
			const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
			expect(current).toEqual([link]);
			for (const marker of screen.getAllByTestId("nav-marker")) expect(marker.style.background).toBe("transparent");
		});
	}

	it("S134 AC 3: rail: signed out, the link is there (and Settings isn't); signed in, it is there too", async () =>
	{
		renderRail("/games/2024-07-04");
		expect(item("Changelog")).toBeInTheDocument();
		expect(screen.queryByRole("link", {
			name: "Settings",
		})).toBeNull();
		cleanup();
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderRail("/games/2024-07-04");
		expect(await screen.findByRole("link", {
			name: "Settings",
		})).toBeInTheDocument();
		expect(item("Changelog")).toBeInTheDocument();
	});
});
