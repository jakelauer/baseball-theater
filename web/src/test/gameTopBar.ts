import { screen, waitFor } from "@testing-library/react";

/**
 * The game top bar once its game has answered. The bar draws before then, from what the page already
 * knows, marked `aria-busy` (B584, #584), so a test that waits for the game to load waits for this
 * rather than for the bar itself.
 */
export async function findLoadedTopBar(): Promise<HTMLElement>
{
	return waitFor(() =>
	{
		const bar = screen.getByTestId("game-topbar");
		if (bar.getAttribute("aria-busy") === "true") throw new Error("The game top bar is still loading its game");
		return bar;
	});
}
