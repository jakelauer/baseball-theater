/**
 * The site footer (S142; shell-scoreboard A14), on its own: A13's Live strip first on a live page
 * (S148), then the two ratified columns of links and a centred "© {year} Baseball Theater". No
 * "Fetched … ago", no "baseball.theater", nothing beyond the list. The session is set directly
 * through `SessionContext`, so each state (signed in, signed out, loading) is exact.
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import type { Session, SessionState } from "../session/session.js";
import { SessionContext } from "../session/session.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import { SiteFooter } from "./SiteFooter.js";
import type { LayoutVariant } from "./variant.js";

const SIGNED_IN: SessionState = {
	status: "signedIn",
	account: DEV_ACCOUNT as Extract<SessionState, { status: "signedIn" }>["account"],
};

function renderFooter(live: boolean, state: SessionState = SIGNED_IN, variant: LayoutVariant = "mobile")
{
	const session: Session = {
		...state,
		signInOffer: "offered",
		signIn: async () => false,
		signOut: async () => undefined,
	} as unknown as Session;
	return render(
		<MantineProvider>
			<SessionContext.Provider value={session}>
				<MemoryRouter>
					<SiteFooter live={live} variant={variant} />
				</MemoryRouter>
			</SessionContext.Provider>
		</MantineProvider>,
	);
}

/** The footer's links as [words, href, target, rel]. */
function links(): [string, string | null, string | null, string | null][]
{
	return within(screen.getByRole("contentinfo")).getAllByRole("link").map((a) => [a.textContent ?? "", a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]);
}

beforeEach(() =>
{
	// 18:00 UTC on Sep 21, 2026: MLB's day is in 2026.
	vi.useFakeTimers({
		toFake: ["Date"],
	});
	vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

describe("SiteFooter (S142)", () =>
{
	it("S142 AC 1 copyright year: with the clock fixed in 2026 the footer reads '© 2026 Baseball Theater', from copyrightYear's MLB day", () =>
	{
		renderFooter(false);
		expect(screen.getByRole("contentinfo")).toHaveTextContent(/© 2026 Baseball Theater$/);
		cleanup();
		// 03:00 UTC on New Year's Day is still Dec 31 in New York: still 2026.
		vi.setSystemTime(new Date("2027-01-01T03:00:00Z"));
		renderFooter(false);
		expect(screen.getByText("© 2026 Baseball Theater")).toBeInTheDocument();
	});

	it("S142 AC 2: no 'Fetched … ago' and no 'baseball.theater', live or not", () =>
	{
		const { container } = renderFooter(false);
		expect(container).not.toHaveTextContent(/Fetched|baseball\.theater/);
		cleanup();
		const live = renderFooter(true);
		expect(live.container).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});

	it("S142 AC 2: live, the footer opens with A13's strip and the Live marker in it; not live, no strip", () =>
	{
		renderFooter(true);
		const footer = screen.getByRole("contentinfo");
		const strip = screen.getByTestId("footer-live-strip");
		expect(footer.firstElementChild).toBe(strip);
		expect(strip).toContainElement(screen.getByTestId("live-marker"));
		expect(strip).toHaveTextContent(/^Live Data · Active$/);
		expect(strip.style.background).toBe("rgba(0, 0, 0, 0.4)");
		cleanup();
		renderFooter(false);
		expect(screen.queryByTestId("footer-live-strip")).toBeNull();
		expect(screen.queryByText("Live Data · Active")).toBeNull();
	});

	it("S142 AC 3: each link's words, href, target and rel are A14's, less S154's three pages", () =>
	{
		renderFooter(false);
		expect(links()).toEqual([
			["Changelog", "/changelog", null, null],
			["Support & Community", "https://www.reddit.com/r/BaseballTheater/", "_blank", "noopener noreferrer"],
			["Your data", "/settings", null, null],
		]);
		for (const name of ["About", "Privacy policy", "Terms of use"])
		{
			expect(screen.queryByRole("link", {
				name,
			})).toBeNull();
		}
	});

	it("S142 AC 3: every link is a Mantine Anchor, so it gets the site-wide hover and focus", () =>
	{
		renderFooter(false);
		for (const link of within(screen.getByRole("contentinfo")).getAllByRole("link"))
		{
			expect(link.className).toMatch(/mantine-Anchor-root/);
			// No external-link icon on Support & Community, or anywhere (A14 Support & Community).
			expect(link.querySelector("svg")).toBeNull();
		}
	});

	it("S142 AC 4: the footer's text is exactly the headings, the links and the copyright line, plus 'Live Data · Active' when live", () =>
	{
		renderFooter(false);
		const parts = (el: HTMLElement) => Array.from(el.querySelectorAll("p, a")).map((n) => n.textContent);
		expect(parts(screen.getByRole("contentinfo"))).toEqual(["Baseball Theater", "Changelog", "Support & Community", "Legal", "Your data", "© 2026 Baseball Theater"]);
		expect(screen.getByRole("contentinfo")).toHaveTextContent(/^Baseball TheaterChangelogSupport & CommunityLegalYour data© 2026 Baseball Theater$/);
		expect(screen.getByRole("contentinfo").querySelector("img, svg")).toBeNull();
		cleanup();
		renderFooter(true);
		expect(screen.getByRole("contentinfo")).toHaveTextContent(/^Live Data · ActiveBaseball TheaterChangelogSupport & CommunityLegalYour data© 2026 Baseball Theater$/);
	});

	it("S142 AC 4: the copyright line is last, centred", () =>
	{
		renderFooter(false);
		const line = screen.getByText("© 2026 Baseball Theater");
		const all = screen.getByRole("contentinfo").querySelectorAll("p, a");
		expect(all[all.length - 1]).toBe(line);
		expect(line.getAttribute("style") ?? "").toMatch(/text-align: center/);
	});

	it("S142 AC 5 signed in: 'Your data' goes to /settings exactly, under 'Legal'", () =>
	{
		renderFooter(false);
		expect(screen.getByRole("link", {
			name: "Your data",
		})).toHaveAttribute("href", "/settings");
	});

	it("S142 AC 5 signed out: no 'Your data', and the 'Legal' heading stands alone", () =>
	{
		renderFooter(false, {
			status: "signedOut",
		});
		expect(screen.queryByRole("link", {
			name: "Your data",
		})).toBeNull();
		const legal = screen.getByText("Legal");
		expect(legal.parentElement?.querySelectorAll("a")).toHaveLength(0);
		expect(legal.parentElement?.children).toHaveLength(1);
	});

	it("S142 AC 5 loading: while the session loads 'Your data' is left out, so it never flashes", () =>
	{
		renderFooter(false, {
			status: "loading",
		});
		expect(screen.queryByRole("link", {
			name: "Your data",
		})).toBeNull();
		expect(screen.getByText("Legal")).toBeInTheDocument();
	});

	it("S142 AC 1: columns inset 16px and 48px apart at mobile, 24px and 64px at medium and desktop (A14 Width=Mobile / Wide)", () =>
	{
		// Mantine writes px as rem at its default scale of 1 (16px = 1rem).
		for (const [variant, pad, gap] of [["mobile", "1rem", "3rem"], ["medium", "1.5rem", "4rem"], ["desktop", "1.5rem", "4rem"]] as const)
		{
			renderFooter(false, SIGNED_IN, variant);
			const columns = screen.getByText("Legal").parentElement!.parentElement!;
			const body = columns.parentElement!;
			expect(body.getAttribute("style") ?? "").toContain(`padding-inline: calc(${pad} * var(--mantine-scale))`);
			expect(columns.getAttribute("style") ?? "").toContain(`--group-gap: calc(${gap} * var(--mantine-scale))`);
			cleanup();
		}
	});
});
