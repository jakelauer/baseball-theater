/**
 * The one name link (S209): where it points for each stats site a patron can choose, its fallbacks to MLB.com
 * (an unknown site id, a player BT has no row for, the profiles query loading or failed, a lapsed pledge), each
 * checked once the query has settled, and the names shown together sharing one request, on the fixture game's
 * players. The cards' and box score's own links are tested beside them (pitch.test.tsx, BoxRoom.test.tsx).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AccountSettings, AtBat, StatsProvider,
} from "@bt/domain";
import {
	DEFAULT_SETTINGS, entitlementsForTier, gamePersonIds,
} from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, render, screen, waitFor,
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
import type { ReactNode } from "react";
import type { GamePayload } from "../api/game.js";
import { BoxRoom } from "./game/BoxRoom.js";
import { MatchupCards } from "./pitch/MatchupCards.js";
import { PlayerLink } from "./PlayerLink.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const PLAYS: AtBat[] = JSON.parse(readFileSync(join(FIXTURES, "plays-823823.json"), "utf8"));

/** The fixture game, with its box score, as the API serves it (no plays: the box score's names only). */
const GAME = {
	...JSON.parse(readFileSync(join(FIXTURES, "game-823823.json"), "utf8")),
	plays: [],
	fetchedAt: "2026-09-05T23:00:00.000Z",
	windowMode: "cache",
	version: 1,
	lastChangedAt: "2026-09-05T23:00:00.000Z",
} as GamePayload;

/** Javier Assad (665871), as the profiles route answers him. */
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

/** The players a profiles request asked about, from its URL. */
function askedIds(url: string): number[]
{
	return (new URL(url).searchParams.get("personIds") ?? "").split(",").map(Number);
}

/**
 * Hydrates the store with `statsProvider` saved and stubs the profiles route with `answer(ids)` (a body, a status,
 * or "pending" for an answer that never comes), recording each profiles request's URL. Answers by default each
 * asked player from `known`.
 */
async function stubApi(statsProvider: StatsProvider, answer: (ids: number[]) => unknown | number | "pending" = (ids) => ({
	players: [ASSAD].filter((pages) => ids.includes(pages.ids.mlbam)),
}))
{
	const asked: string[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me/settings") return jsonResponse({
			...DEFAULT_SETTINGS,
			statsProvider,
			version: 1,
		} satisfies AccountSettings);
		asked.push(request.url);
		const body = answer(askedIds(request.url));
		if (body === "pending") return new Promise<Response>(() => undefined);
		return typeof body === "number" ? jsonResponse({
			error: "x",
		}, body) : jsonResponse(body);
	}));
	await hydrateSettings(DEV_ACCOUNT.uid);
	return asked;
}

/** Renders `children` for `tier` in a fresh query client, which it returns so a test can wait for it to settle. */
function renderAs(tier: "none" | "Backer", children: ReactNode)
{
	const client = createQueryClient();
	const view = render(
		<MantineProvider>
			<QueryClientProvider client={client}>
				<SessionContext.Provider value={session(tier)}>
					{children}
				</SessionContext.Provider>
			</QueryClientProvider>
		</MantineProvider>,
	);
	return {
		client,
		view,
		rerender: (next: ReactNode) => view.rerender(
			<MantineProvider>
				<QueryClientProvider client={client}>
					<SessionContext.Provider value={session(tier)}>
						{next}
					</SessionContext.Provider>
				</QueryClientProvider>
			</MantineProvider>,
		),
	};
}

/** Hydrates the store and renders Assad's name for `tier`, the profiles route answering `answer`. */
async function renderLink(statsProvider: StatsProvider, tier: "none" | "Backer", answer?: (ids: number[]) => unknown | number | "pending")
{
	const asked = await stubApi(statsProvider, answer);
	const { client } = renderAs(tier, <PlayerLink personId={665871}>Assad, J</PlayerLink>);
	return {
		asked,
		client,
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
		expect(asked.length > 0).toBe(provider === "fangraphs" || provider === "bbref");
	});

	it.each<[string, (ids: number[]) => unknown | number]>([
		["the site's id is unknown for the player", () => ({
			players: [{
				...ASSAD,
				ids: {
					...ASSAD.ids,
					bbref: null,
				},
			}],
		})],
		["the route leaves the player out (no row)", () => ({
			players: [],
		})],
		["the query has failed", () => 500],
	])("S209 AC 10: falls back to MLB.com when %s, once the query has settled", async (_case, answer) =>
	{
		const {
			link, asked, client,
		} = await renderLink("bbref", "Backer", answer);
		await waitFor(() => expect(asked).toHaveLength(1));
		await waitFor(() => expect(client.getQueryState(["player-pages", 665871])?.status).not.toBe("pending"));
		expect(client.isFetching()).toBe(0);
		expect(link()).toHaveAttribute("href", MLB);
	});

	it("S209 AC 10: links to MLB.com while the query is loading", async () =>
	{
		const {
			link, asked, client,
		} = await renderLink("bbref", "Backer", () => "pending");
		await waitFor(() => expect(asked).toHaveLength(1));
		expect(client.isFetching()).toBe(1);
		expect(link()).toHaveAttribute("href", MLB);
	});

	it("S209 AC 10: a lapsed pledge's saved FanGraphs links to MLB.com, asking nothing", async () =>
	{
		const { link, asked } = await renderLink("fangraphs", "none");
		expect(link()).toHaveAttribute("href", MLB);
		expect(asked).toEqual([]);
	});
});

describe("names shown together share one request (S209 AC 10)", () =>
{
	it("S209 AC 10: a box score's names ask the profiles route once, about the whole game", async () =>
	{
		const asked = await stubApi("fangraphs");
		renderAs("Backer", <BoxRoom game={GAME} variant="desktop" />);
		// Assad's name in his pitching row, found by its text.
		await waitFor(() => expect(screen.getAllByText("Assad, J")[0]!.closest("a")).toHaveAttribute("href", ASSAD.profiles.fangraphs));
		expect(asked).toHaveLength(1);
		expect(askedIds(asked[0]!)).toEqual(gamePersonIds(GAME));
		// Every other name had no row in the answer, so it links to MLB.com.
		const other = GAME.boxscore!.teams.home.batting[0]!;
		expect(document.querySelector(`a[href="https://www.mlb.com/player/${other.id}"]`)).not.toBeNull();
	});

	it("S209 AC 10: past an hour, a focus refetch of the box score's stale names asks once more, about the whole game", async () =>
	{
		const asked = await stubApi("fangraphs");
		const { client } = renderAs("Backer", <BoxRoom game={GAME} variant="desktop" />);
		await waitFor(() => expect(screen.getAllByText("Assad, J")[0]!.closest("a")).toHaveAttribute("href", ASSAD.profiles.fangraphs));
		await waitFor(() => expect(client.isFetching()).toBe(0));
		expect(asked).toHaveLength(1);
		// An hour and a second later every entry is stale: refocusing the tab refetches each name's query.
		const later = Date.now() + 60 * 60 * 1000 + 1000;
		const now = vi.spyOn(Date, "now").mockReturnValue(later);
		try
		{
			act(() =>
			{
				focusManager.setFocused(false);
				focusManager.setFocused(true);
			});
			await waitFor(() => expect(asked.length).toBeGreaterThan(1));
			await waitFor(() => expect(client.isFetching()).toBe(0));
			expect(asked).toHaveLength(2);
			expect(askedIds(asked[1]!)).toEqual(gamePersonIds(GAME));
			expect(client.getQueryState(["player-pages", 665871])?.status).toBe("success");
		}
		finally
		{
			now.mockRestore();
			focusManager.setFocused(undefined);
		}
	});

	it("S209 AC 10: as the Live room's plays grow, only a player new to the game is asked about, and loaded links keep their site meanwhile", async () =>
	{
		// The first answer names every asked player with a FanGraphs id; the second never arrives.
		let answers = 0;
		const asked = await stubApi("fangraphs", (ids) =>
		{
			answers++;
			return answers === 1 ? {
				players: ids.map((id) => ({
					ids: {
						mlbam: id,
						fangraphs: `fg${id}`,
						bbref: null,
					},
					profiles: {
						mlb: `https://www.mlb.com/player/${id}`,
						fangraphs: `https://www.fangraphs.com/statss.aspx?playerid=fg${id}`,
						bbref: null,
						savant: `https://baseballsavant.mlb.com/savant-player/${id}`,
					},
				})),
			} : "pending";
		});
		const before = PLAYS.slice(0, 1);
		const first = before[0]!;
		const { rerender } = renderAs("Backer", <MatchupCards plays={before} atBat={first} />);
		const pitcherLink = () => screen.getByTestId("card-pitcher").querySelector("a");
		await waitFor(() => expect(pitcherLink()).toHaveAttribute("href", `https://www.fangraphs.com/statss.aspx?playerid=fg${first.matchup.pitcher.id}`));
		expect(asked).toHaveLength(1);
		const known = new Set(gamePersonIds({
			plays: before,
		}));
		const next = PLAYS.findIndex((play) => !known.has(play.matchup.batter.id));
		const grown = PLAYS.slice(0, next + 1);
		rerender(<MatchupCards plays={grown} atBat={first} />);
		// The same at-bat's cards with a longer game: nothing new to ask about for these two names.
		expect(pitcherLink()).toHaveAttribute("href", `https://www.fangraphs.com/statss.aspx?playerid=fg${first.matchup.pitcher.id}`);
		rerender(<MatchupCards plays={grown} atBat={grown[next]!} />);
		await waitFor(() => expect(asked).toHaveLength(2));
		const newIds = gamePersonIds({
			plays: grown,
		}).filter((id) => !known.has(id));
		expect(askedIds(asked[1]!)).toEqual(newIds);
		// The card's pitcher, already loaded, keeps FanGraphs while the new batter's request is still out.
		const pitcher = grown[next]!.matchup.pitcher.id;
		if (known.has(pitcher)) expect(pitcherLink()).toHaveAttribute("href", `https://www.fangraphs.com/statss.aspx?playerid=fg${pitcher}`);
		expect(screen.getByTestId("card-batter").querySelector("a")).toHaveAttribute("href", `https://www.mlb.com/player/${grown[next]!.matchup.batter.id}`);
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
