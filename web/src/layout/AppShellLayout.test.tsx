/**
 * The layout host (S60): the one viewport read and the `variant` it hands to
 * pages, the header and drawer on mobile and medium, the rail on desktop, game
 * routes without the app header, and the signed-out account control.
 * Widths are set by answering `matchMedia` the way a browser that wide would.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
	afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import { DEV_SIGN_IN_TOKEN } from "../session/session.js";
import { SessionProvider } from "../session/SessionProvider.js";
import { setSessionToken } from "../session/token.js";
import { stubMeApi } from "../test/meApi.js";
import { AppShellLayout } from "./AppShellLayout.js";

const WIDTHS = {
	mobile: 390,
	medium: 768,
	desktop: 1280,
} as const;

/** Answers `(min-width: Nem)` queries as a viewport `width` px wide (1em = 16px). */
function viewport(width: number)
{
	vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
	{
		const min = /min-width:\s*([\d.]+)em/.exec(query);
		return {
			matches: min ? width >= Number(min[1]) * 16 : false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		};
	});
}

function CurrentPath()
{
	return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderShell(path: string, width: number)
{
	viewport(width);
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<MemoryRouter initialEntries={[path]}>
						<AppShellLayout>
							{(variant) => <output aria-label="variant">{variant}</output>}
						</AppShellLayout>
						<CurrentPath />
					</MemoryRouter>
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

/** Opens the mobile/medium drawer through the header's burger and returns it. */
async function openDrawer()
{
	await userEvent.click(within(screen.getByRole("banner")).getByRole("button", {
		name: "Open navigation",
	}));
	return screen.findByRole("dialog");
}

beforeEach(() =>
{
	setSessionToken(null);
	stubMeApi();
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("layout variant", () =>
{
	for (const [variant, width] of Object.entries(WIDTHS))
	{
		it(`passes variant "${variant}" to the page at ${width}px`, () =>
		{
			renderShell("/games/2024-07-04", width);
			expect(screen.getByLabelText("variant")).toHaveTextContent(variant);
		});
	}
});

describe("drawer change log link (S134 AC 3)", () =>
{
	for (const variant of ["mobile", "medium"] as const)
	{
		it(`S134 AC 3: ${variant}, signed out: the drawer's 'Changelog' link sits right above the version line, plain on /standings, and choosing it opens /changelog and closes the drawer`, async () =>
		{
			renderShell("/standings", WIDTHS[variant]);
			const drawer = await openDrawer();
			const link = within(drawer).getByRole("link", {
				name: "Changelog",
			});
			expect(link.nextElementSibling).toBe(within(drawer).getByTestId("version-line"));
			expect(within(drawer).getByRole("list")).not.toContainElement(link);
			expect(link).not.toHaveAttribute("aria-current");
			expect(link.style.background).toBe("transparent");
			await userEvent.click(link);
			expect(screen.getByLabelText("path")).toHaveTextContent(/^\/changelog$/);
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		});

		it(`S134 AC 3: ${variant}: on /changelog the drawer's link is current and no nav item is active`, async () =>
		{
			renderShell("/changelog", WIDTHS[variant]);
			const drawer = await openDrawer();
			const link = within(drawer).getByRole("link", {
				name: "Changelog",
			});
			expect(link).toHaveAttribute("aria-current", "page");
			expect(link.style.background).toBe("var(--bt-primary)");
			const current = within(drawer).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
			expect(current).toEqual([link]);
		});
	}
});

describe("mobile and medium header + drawer", () =>
{
	for (const variant of ["mobile", "medium"] as const)
	{
		it(`${variant}: header with burger, wordmark and account control; the burger opens the drawer, which closes on navigate`, async () =>
		{
			renderShell("/games/2024-07-04", WIDTHS[variant]);
			const header = screen.getByRole("banner");
			expect(within(header).getByRole("img", {
				name: "Baseball Theater",
			})).toBeInTheDocument();
			expect(await within(header).findByRole("button", {
				name: "Sign in",
			})).toBeInTheDocument();
			expect(screen.queryByRole("navigation")).toBeNull();

			await userEvent.click(within(header).getByRole("button", {
				name: "Open navigation",
			}));
			const drawer = await screen.findByRole("dialog");
			await userEvent.click(within(drawer).getByRole("link", {
				name: "Standings",
			}));
			expect(screen.getByLabelText("path")).toHaveTextContent(/^\/standings$/);
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		});

		it(`${variant}: on the home page / the drawer marks Scoreboard current, filled Primary (#412: / shows the scoreboard in place)`, async () =>
		{
			renderShell("/", WIDTHS[variant]);
			const drawer = await openDrawer();
			const current = within(drawer).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
			expect(current).toHaveLength(1);
			expect(current[0]).toHaveTextContent("Scoreboard");
			expect(current[0]?.style.background).toBe("var(--bt-primary)");
		});
	}

	it("mobile: the drawer's wordmark goes home and closes the drawer (owner, 2026-11-12: \"clicking the logo should go to the home page\")", async () =>
	{
		renderShell("/standings", WIDTHS.mobile);
		await userEvent.click(within(screen.getByRole("banner")).getByRole("button", {
			name: "Open navigation",
		}));
		const drawer = await screen.findByRole("dialog");
		await userEvent.click(within(drawer).getByRole("link", {
			name: "Baseball Theater home",
		}));
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/$/);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});

describe("desktop rail", () =>
{
	it("desktop: the 240px rail is the navigation and there is no burger", () =>
	{
		renderShell("/games/2024-07-04", WIDTHS.desktop);
		const rail = screen.getByRole("navigation", {
			name: "Main",
		});
		expect(rail.style.width).toBe("240px");
		// One logo on desktop, the rail's (owner, 2026-11-12: "The rightmost one should go away on desktop").
		expect(screen.getAllByRole("img", {
			name: "Baseball Theater",
		})).toHaveLength(1);
		expect(within(rail).getByRole("link", {
			name: "Baseball Theater home",
		})).toHaveAttribute("href", "/");
		expect(screen.queryByRole("button", {
			name: "Open navigation",
		})).toBeNull();
		expect(within(rail).getByTestId("version-line")).toHaveTextContent(/^dev \(unknown\)$/);
	});

	const cases: [string, string][] = [
		// `/` and `/games` render the scoreboard in place (#412), so they light Scoreboard too.
		["/", "Scoreboard"],
		["/games", "Scoreboard"],
		["/games/2024-07-04", "Scoreboard"],
		["/game/745001/live", "Scoreboard"],
		["/standings", "Standings"],
		["/search", "Search"],
	];
	for (const [path, section] of cases)
	{
		it(`rail: ${path} marks exactly one aria-current item, ${section}`, () =>
		{
			renderShell(path, WIDTHS.desktop);
			const rail = screen.getByRole("navigation", {
				name: "Main",
			});
			const current = within(rail).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
			expect(current).toHaveLength(1);
			expect(current[0]).toHaveTextContent(section);
		});
	}
});

describe("game route", () =>
{
	it("game route on mobile: no app header, so the page's game top bar leads", () =>
	{
		renderShell("/game/745001", WIDTHS.mobile);
		expect(screen.queryByRole("banner")).toBeNull();
		expect(screen.queryByRole("button", {
			name: "Open navigation",
		})).toBeNull();
		expect(screen.getByLabelText("variant")).toHaveTextContent("mobile");
	});

	it("game route on desktop: no app header, the rail stays", () =>
	{
		renderShell("/game/745001", WIDTHS.desktop);
		expect(screen.queryByRole("banner")).toBeNull();
		expect(screen.getByRole("navigation", {
			name: "Main",
		})).toBeInTheDocument();
	});
});

describe("account control, signed out and signed in", () =>
{
	it("signed out: Sign in beside the account icon starts sign-in, and the rail has no Settings", async () =>
	{
		renderShell("/games/2024-07-04", WIDTHS.desktop);
		const rail = screen.getByRole("navigation", {
			name: "Main",
		});
		await userEvent.click(await screen.findByRole("button", {
			name: "Sign in",
		}));
		// signIn() is the dev sign-in locally (S59): the session turns signed in.
		expect(await screen.findByRole("button", {
			name: "Account",
		})).toBeInTheDocument();
		expect(within(rail).getByRole("link", {
			name: "Settings",
		})).toBeInTheDocument();
	});

	it("signed out: the rail has no Settings item", async () =>
	{
		renderShell("/games/2024-07-04", WIDTHS.desktop);
		await screen.findByRole("button", {
			name: "Sign in",
		});
		expect(screen.queryByRole("link", {
			name: "Settings",
		})).toBeNull();
	});

	it("signed in: the account control's menu leads to Settings", async () =>
	{
		setSessionToken(DEV_SIGN_IN_TOKEN);
		renderShell("/games/2024-07-04", WIDTHS.mobile);
		await userEvent.click(await screen.findByRole("button", {
			name: "Account",
		}));
		await userEvent.click(await screen.findByRole("menuitem", {
			name: "Settings",
		}));
		expect(screen.getByLabelText("path")).toHaveTextContent(/^\/settings$/);
		expect(screen.queryByRole("button", {
			name: "Sign in",
		})).toBeNull();
	});
});

describe("footer at the window's bottom on a short page (#525)", () =>
{
	// Owner, 2026-11-24: "It's never pinned, but the content's minimum height should be either a percentage of the
	// viewport height or something similar to avoid a highwater footer." jsdom lays nothing out and loads no
	// stylesheet, so this checks the flex chain that does it in a browser: the shell is at least the window's
	// height (`.bt-shell`, `100dvh` after a `100vh` fallback), its content column stretches to it, and `<main>`
	// takes the leftover height, so the footer after it starts at the window's bottom; taller content pushes it
	// down. The footer itself is never pinned (A14).
	it("the shell's stylesheet rule is at least the window's height: 100vh, then 100dvh where supported", () =>
	{
		const sheet = postcss.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8"));
		const heights: string[] = [];
		sheet.walkRules(".bt-shell", (rule) =>
		{
			rule.walkDecls("min-height", (declaration) =>
			{
				heights.push(declaration.value);
			});
		});
		expect(heights).toEqual(["100vh", "100dvh"]);
	});

	it.each([
		["mobile", 375],
		["desktop", 1280],
	] as const)("%s: <main> grows to fill the window's leftover height, so the footer after it sits at the bottom", (_name, width) =>
	{
		renderShell("/", width);
		const main = screen.getByRole("main");
		const column = main.parentElement!;
		expect(column.parentElement).toHaveClass("bt-shell");
		expect(column.style.display).toBe("flex");
		expect(column.style.flexDirection).toBe("column");
		expect(main.style.flexGrow).toBe("1");
		const footer = screen.getByRole("contentinfo");
		expect(footer.previousElementSibling).toBe(main);
		expect(footer.style.position).toBe("");
	});
});
