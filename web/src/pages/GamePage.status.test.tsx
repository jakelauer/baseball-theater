/**
 * S170 AC 6: a suspended or delayed game keeps its Live tab and a delayed start has none, while the
 * top bar shows each one's marker (game-shell A7). The 745001 fixture game is served in a recorded
 * status from MLB's list, `fixtures/raw/gamestatus.json` (`T`, `IR`, `PR`); `gamePhase` decides the
 * tabs, reused as it is.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, within,
} from "@testing-library/react";
import {
	MemoryRouter, Route, Routes,
} from "react-router-dom";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import type { GamePayload } from "../api/game.js";
import { createQueryClient } from "../api/queryClient.js";
import { resetVersionNotice } from "../api/versionNotice.js";
import { resetSettings } from "../settings/store.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { GamePage } from "./GamePage.js";
import { findLoadedTopBar } from "../test/gameTopBar.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const ROWS = JSON.parse(readFileSync(join(FIXTURES, "raw/gamestatus.json"), "utf8")) as { statusCode: string;
	abstractGameState: string;
	codedGameState: string;
	detailedState: string; }[];

/** The 745001 fixture game, served from the cache, in the recorded status for `code`. */
function game(code: string): GamePayload
{
	const snapshot = JSON.parse(readFileSync(join(FIXTURES, "game-745001.json"), "utf8")) as GamePayload;
	const row = ROWS.find((r) => r.statusCode === code)!;
	return {
		...snapshot,
		status: {
			abstractGameState: row.abstractGameState,
			codedGameState: row.codedGameState,
			detailedState: row.detailedState,
		},
		fetchedAt: "2024-07-04T18:00:00.000Z",
		windowMode: "cache",
	} as GamePayload;
}

function renderGame(payload: GamePayload)
{
	vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(payload))));
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<MemoryRouter initialEntries={[`/game/${payload.gamePk}/videos`]}>
					<Routes>
						<Route path="/game/:gamePk/:tab" element={<GamePage variant="desktop" />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

async function tabNames(): Promise<string[]>
{
	await findLoadedTopBar();
	return within(screen.getAllByRole("tablist")[0]!).getAllByRole("tab").map((t) => t.textContent ?? "");
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	resetSettings();
	resetVersionNotice();
});

describe("GamePage's rooms for a stopped game (S170)", () =>
{
	const cases: [string, string, boolean][] = [
		["T", "suspended", true],
		["IR", "delayed", true],
		["PR", "delayedStart", false],
	];
	for (const [code, kind, live] of cases)
	{
		it(`S170 AC 6: ${code} (${kind}) ${live ? "keeps its Live tab" : "has no Live tab"}, and its top bar shows the marker`, async () =>
		{
			renderGame(game(code));
			const tabs = await tabNames();
			expect(tabs.includes("Live")).toBe(live);
			expect(within(screen.getByTestId("game-topbar")).getByTestId("status-marker")).toHaveAttribute("data-kind", kind);
		});
	}
});
