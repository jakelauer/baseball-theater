/**
 * S148: the foot of every page (shell-scoreboard A13). With the page's socket open it is the
 * `footer-live-strip` alone, the Live marker centred in it; with none it draws nothing. No
 * footer says "Fetched … ago" or "baseball.theater".
 */
import { MantineProvider } from "@mantine/core";
import {
	cleanup, render, screen,
} from "@testing-library/react";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { SiteFooter } from "./SiteFooter.js";

function renderFooter(live: boolean)
{
	return render(
		<MantineProvider>
			<SiteFooter live={live} />
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
});

describe("SiteFooter (S148)", () =>
{
	it("S148 AC 1: no socket, no footer line at all", () =>
	{
		const { container } = renderFooter(false);
		expect(screen.queryByRole("contentinfo")).toBeNull();
		expect(screen.queryByTestId("footer-live-strip")).toBeNull();
		expect(container).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});

	it("S148 AC 1: socket open, the footer is the strip alone: no 'Fetched … ago', no 'baseball.theater'", () =>
	{
		renderFooter(true);
		const footer = screen.getByRole("contentinfo");
		expect(footer.children).toHaveLength(1);
		expect(footer.firstElementChild).toBe(screen.getByTestId("footer-live-strip"));
		expect(footer).toHaveTextContent(/^Live Data · Active$/);
		expect(footer).not.toHaveTextContent(/Fetched|baseball\.theater/);
	});

	it("S148 AC 3: live draws the footer-live-strip with LiveMarker centred in it, 10px above and below, darker than the page", () =>
	{
		renderFooter(true);
		const strip = screen.getByTestId("footer-live-strip");
		expect(strip).toContainElement(screen.getByTestId("live-marker"));
		expect(strip.style.background).toBe("rgba(0, 0, 0, 0.4)");
		expect(screen.getByTestId("live-marker").className).toMatch(/Group/);
		expect(screen.getByText("Live Data · Active")).toBeInTheDocument();
	});
});
