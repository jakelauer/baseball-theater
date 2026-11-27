/**
 * The one name link (S209): where it points for each stats site a patron can choose, and its fallbacks to MLB.com
 * (an unknown site id, a player BT has no row for, the profiles query loading or failed, a lapsed pledge), on the
 * fixture game's players. The cards' and box score's own links are tested beside them (pitch.test.tsx, BoxRoom.test.tsx).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AccountSettings, AtBat, StatsProvider,
} from "@bt/domain";
import { DEFAULT_SETTINGS, entitlementsForTier } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../api/queryClient.js";
import type { Session } from "../session/session.js";
import { SessionContext } from "../session/session.js";
import { hydrateSettings, resetSettings } from "../settings/store.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../test/meApi.js";
import { MatchupCards } from "./pitch/MatchupCards.js";
import { PlayerLink } from "./PlayerLink.js";

const PLAYS: AtBat[] = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/plays-823823.json"), "utf8"));

/** Javier Assad (665871), as the profiles route answers him once checked. */
const ASSAD = {
	ids: {
		mlbam: 665871,
		fangraphs: "21741",
		bbref: "assadja01",
	},
	profiles: {
		mlb: "https://www.mlb.com/player/665871",
		fangraphs: "https://www.fangraphs.com/statss.aspx?playerid=21741",
		bbref: "https://www.baseball-reference.com/players/a/assadja01.shtml",
		savant: "https://baseballsavant.mlb.com/savant-player/665871",
	},
	checked: true,
};

const MLB = "https://www.mlb.com/player/665871";

/** A signed-in session whose account is at `tier`. */
function session(tier: "none" | "Backer"): Session
{
	return {
		status: "signedIn",
		account: {
			...DEV_ACCOUNT,
			entitlements: entitlementsForTier(tier),
		},
		signInOffer: "offered",
	} as unknown as Session;
}

/**
 * Hydrates the store with `statsProvider` saved and stubs the profiles route with `profiles` (a body, a status,
 * or "pending" for an answer that never comes), then renders Assad's name for `tier`.
 */
async function renderLink(statsProvider: StatsProvider, tier: "none" | "Backer", profiles: unknown | number | "pending" = ASSAD)
{
	const asked: string[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		asked.push(pathname);
		if (pathname === "/api/v1/me/settings") return jsonResponse({
			...DEFAULT_SETTINGS,
			statsProvider,
			version: 1,
		} satisfies AccountSettings);
		if (profiles === "pending") return new Promise<Response>(() => undefined);
		return typeof profiles === "number" ? jsonResponse({
			error: "x",
		}, profiles) : jsonResponse(profiles);
	}));
	await hydrateSettings(DEV_ACCOUNT.uid);
	render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionContext.Provider value={session(tier)}>
					<PlayerLink personId={665871}>Assad, J</PlayerLink>
				</SessionContext.Provider>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return {
		asked,
		link: () => screen.getByRole("link", {
			name: "Assad, J",
		}),
	};
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	resetSettings();
});

describe("PlayerLink follows the stats site (S209 AC 10)", () =>
{
	it.each<[StatsProvider, string]>([
		["mlb", MLB],
		["savant", "https://baseballsavant.mlb.com/savant-player/665871"],
		["fangraphs", "https://www.fangraphs.com/statss.aspx?playerid=21741"],
		["bbref", "https://www.baseball-reference.com/players/a/assadja01.shtml"],
	])("S209 AC 10: a patron who chose %s links there", async (provider, url) =>
	{
		const { link, asked } = await renderLink(provider, "Backer");
		await waitFor(() => expect(link()).toHaveAttribute("href", url));
		// MLB.com and Savant need only MLB's id: the profiles route is asked only for FanGraphs and Baseball-Reference.
		expect(asked.some((path) => path.startsWith("/api/v1/players/"))).toBe(provider === "fangraphs" || provider === "bbref");
	});

	it("S209 AC 10: falls back to MLB.com when the site's id is unknown for the player", async () =>
	{
		const { link, asked } = await renderLink("fangraphs", "Backer", {
			...ASSAD,
			ids: {
				...ASSAD.ids,
				fangraphs: null,
			},
		});
		await waitFor(() => expect(asked).toContain("/api/v1/players/665871/profiles"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(link()).toHaveAttribute("href", MLB);
	});

	it.each<[string, number | "pending"]>([
		["the route answers 404 (no row)", 404],
		["the query has failed", 500],
		["the query is loading", "pending"],
	])("S209 AC 10: falls back to MLB.com when %s", async (_case, answer) =>
	{
		const { link, asked } = await renderLink("bbref", "Backer", answer);
		await waitFor(() => expect(asked).toContain("/api/v1/players/665871/profiles"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(link()).toHaveAttribute("href", MLB);
	});

	it("S209 AC 10: a lapsed pledge's saved FanGraphs links to MLB.com, asking nothing", async () =>
	{
		const { link, asked } = await renderLink("fangraphs", "none");
		expect(link()).toHaveAttribute("href", MLB);
		expect(asked.some((path) => path.startsWith("/api/v1/players/"))).toBe(false);
	});
});

describe("the matchup cards' names (S209 AC 4)", () =>
{
	it("S209 AC 4: the batter's and pitcher's names link to their MLB.com pages in a new tab, with no setting (signed out)", () =>
	{
		const atBat = PLAYS[0]!;
		render(
			<MantineProvider>
				<MatchupCards plays={PLAYS} atBat={atBat} />
			</MantineProvider>,
		);
		for (const [player, testId] of [[atBat.matchup.batter, "card-batter"], [atBat.matchup.pitcher, "card-pitcher"]] as const)
		{
			const link = screen.getByTestId(testId).querySelector("a");
			expect(link).toHaveTextContent(player.fullName);
			expect(link).toHaveAttribute("href", `https://www.mlb.com/player/${player.id}`);
			expect(link).toHaveAttribute("target", "_blank");
			expect(link).toHaveAttribute("rel", "noopener noreferrer");
		}
	});
});
