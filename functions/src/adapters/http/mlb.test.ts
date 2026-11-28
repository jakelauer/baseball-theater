/**
 * The HTTP MLB client against the committed recordings (S2): each method asks for
 * the URL it should and maps the answer, with an injected `fetch` that serves
 * `fixtures/raw/` by URL path — no network. The live path's own mapping is proven by
 * `services/fixture-823823.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { datesBetween } from "@bt/domain";
import { parseScheduleResponse } from "@bt/mlb-api";
import { mapScheduleRange } from "../../mappers/schedule.js";
import { recordedClient } from "../../test/recorded-mlb.js";
import {
	finalStandingsUrl, gameRuleSettingsUrl, gameUniformsUrl, HttpMlbStatsClient, PLAY_METRICS_LIMIT_MS, playerOfTheGameUrl, springStandingsUrl,
} from "./mlb.js";

const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/raw");

/** Recording file by URL path; anything else answers 404. */
const BY_PATH: [RegExp, string][] = [
	[/\/feed\/live\/timestamps$/, "timestamps-823823.json"],
	[/\/feed\/live\/diffPatch$/, "diffpatch-823823.json"],
	[/\/api\/v1\/standings$/, "standings-2026-09-05.json"],
	[/\/api\/v1\/people$/, "people-823823.json"],
	[/\/api\/v1\/schedule$/, "schedule-2026-09-05.json"],
	[/\/bdfed\/playMetrics\/823823$/, "playmetrics-823823.json"],
	[/\/api\/v1\/seasons\/2026$/, "seasons-2026.json"],
];

function client(): { mlb: HttpMlbStatsClient;
	urls: string[]; }
{
	const urls: string[] = [];
	const mlb = new HttpMlbStatsClient({
		now: () => new Date("2026-09-05T23:00:00.000Z"),
		fetchImpl: async (input) =>
		{
			const url = new URL(String(input));
			urls.push(url.toString());
			// The World Series is the schedule path asked by game type and season (S111).
			const file = url.searchParams.get("gameType") === "W"
				? `worldseries-${url.searchParams.get("season")}.json`
				: BY_PATH.find(([re]) => re.test(url.pathname))?.[1];
			return file ? new Response(readFileSync(path.join(RAW, file))) : new Response("{}", {
				status: 404,
			});
		},
	});
	return {
		mlb,
		urls,
	};
}

describe("HttpMlbStatsClient (S2)", () =>
{
	it("fetchSchedule and fetchStandings map the recorded day", async () =>
	{
		const { mlb } = client();
		const day = await mlb.fetchSchedule("2026-09-05");
		expect(day.games.some((g) => g.gamePk === 823823)).toBe(true);
		const standings = await mlb.fetchStandings("2026-09-05");
		expect(standings.divisions).toHaveLength(6);
		expect(standings.windowMode).toBe("active");
	});

	it("fetchScheduleRange asks one schedule request for the range, and a day the answer leaves out has no games (S124 schedule range)", async () =>
	{
		const { mlb, urls } = client();
		const days = await mlb.fetchScheduleRange("2026-09-04", "2026-09-06");
		expect(urls).toHaveLength(1);
		const asked = new URL(urls[0]!);
		expect(asked.pathname).toBe("/api/v1/schedule");
		expect(asked.searchParams.get("startDate")).toBe("2026-09-04");
		expect(asked.searchParams.get("endDate")).toBe("2026-09-06");
		// Part of one day's hydrate, leaving out only what the mapper never reads (#399; the test
		// below shows a day maps the same without it), so a day stored from either reads the same.
		const single = client();
		await single.mlb.fetchSchedule("2026-09-05");
		// Exactly the day's parts minus the four the mapper never reads, so dropping one it reads
		// (the probables' `person` or `stats`, say) fails here.
		const parts = (url: string) => new URL(url).searchParams.get("hydrate")!.split(/,(?![^(]*\))/);
		const unread = ["flags", "liveLookin", "review", "game(content(media(featured,epg),summary))"];
		expect(parts(urls[0]!)).toEqual(parts(single.urls[0]!).filter((part) => !unread.includes(part)));
		expect(days.map((day) => day.date)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
		// The recording holds only 2026-09-05: the days around it are empty, not copies of it.
		expect(days[0]!.games).toEqual([]);
		expect(days[2]!.games).toEqual([]);
		expect(days[1]!.games).toEqual((await mlb.fetchSchedule("2026-09-05")).games);
	});

	it("fetchScheduleRange asks a month as week-long requests, none hydrating the content the mapper never reads, and keeps each day's own games (#399)", async () =>
	{
		const { mlb, urls } = client();
		const days = await mlb.fetchScheduleRange("2026-09-01", "2026-09-30");
		// A whole month in one request with the game-content hydrate was ~20–29 MB from MLB and took
		// 10–15 s cold, too slow and too big for a Worker's month read (#399).
		const spans = urls.map((url) => [new URL(url).searchParams.get("startDate"), new URL(url).searchParams.get("endDate")]);
		expect(spans.sort()).toEqual([
			["2026-09-01", "2026-09-07"],
			["2026-09-08", "2026-09-14"],
			["2026-09-15", "2026-09-21"],
			["2026-09-22", "2026-09-28"],
			["2026-09-29", "2026-09-30"],
		]);
		for (const url of urls) expect(new URL(url).searchParams.get("hydrate")).not.toMatch(/content|liveLookin|review|flags/);
		expect(days.map((day) => day.date)).toEqual(datesBetween("2026-09-01", "2026-09-30"));
		// Every request answers with the 2026-09-05 recording; only the week holding that day keeps its games.
		expect(days.filter((day) => day.games.length > 0).map((day) => day.date)).toEqual(["2026-09-05"]);
		expect(days[4]!.games).toEqual((await mlb.fetchSchedule("2026-09-05")).games);
	});

	it("fetchScheduleRange keeps at most five requests in flight, however long the range (#399)", async () =>
	{
		const body = readFileSync(path.join(RAW, "schedule-2026-09-05.json"));
		let inFlight = 0;
		let most = 0;
		let asked = 0;
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async () =>
			{
				asked++;
				most = Math.max(most, ++inFlight);
				await new Promise((resolve) => setTimeout(resolve, 2));
				inFlight--;
				return new Response(body);
			},
		});
		const days = await mlb.fetchScheduleRange("2026-04-01", "2026-06-30");
		// Thirteen weeks, never more than five of them at once (a year would be 53).
		expect(asked).toBe(13);
		expect(most).toBeLessThanOrEqual(5);
		expect(days.map((day) => day.date)).toEqual(datesBetween("2026-04-01", "2026-06-30"));
	});

	it("fetchScheduleRange rejects when any week's request fails, rather than answering part of the range (#399)", async () =>
	{
		const { mlb } = client();
		const failing = new HttpMlbStatsClient({
			fetchImpl: async (input) =>
				new URL(String(input)).searchParams.get("startDate") === "2026-09-15" ? new Response("{}", {
					status: 500,
				}) : new Response(readFileSync(path.join(RAW, "schedule-2026-09-05.json"))),
		});
		await expect(failing.fetchScheduleRange("2026-09-01", "2026-09-30")).rejects.toThrow(/^HTTP 500 for /);
		expect(await mlb.fetchScheduleRange("2026-09-01", "2026-09-07")).toHaveLength(7);
	});

	it("the schedule hydrate leaves out only what mapping a day never reads: the recording without it maps the same (#399)", () =>
	{
		const raw = JSON.parse(readFileSync(path.join(RAW, "schedule-2026-09-05.json"), "utf8")) as { dates: { games: Record<string, unknown>[] }[] };
		const stripped = structuredClone(raw);
		let removed = 0;
		for (const date of stripped.dates)
		{
			for (const game of date.games)
			{
				for (const key of ["content", "flags", "liveLookin", "review"])
				{
					if (key in game) removed++;
					delete game[key];
				}
			}
		}
		// The recording carries those parts, so the comparison below means something.
		expect(removed).toBeGreaterThan(0);
		const map = (payload: unknown) => mapScheduleRange(parseScheduleResponse(payload), "2026-09-05", "2026-09-05", "t");
		expect(map(stripped)).toEqual(map(raw));
	});

	it("fetchStandings asks with the date's season, which MLB requires alongside the date", async () =>
	{
		const { mlb, urls } = client();
		await mlb.fetchStandings("2026-09-05");
		const asked = new URL(urls.at(-1)!);
		expect(asked.pathname).toBe("/api/v1/standings");
		expect(asked.searchParams.get("season")).toBe("2026");
		expect(asked.searchParams.get("date")).toBe("2026-09-05");
		expect(asked.searchParams.get("leagueId")).toBe("103,104");
	});

	it("S102 AC 1: fetchStandings hydrates each record group's division, the request fixtures/raw/standings-2026-09-05-division.json records", async () =>
	{
		const { mlb, urls } = client();
		await mlb.fetchStandings("2026-09-05");
		const asked = new URL(urls.at(-1)!);
		expect(asked.searchParams.get("hydrate")?.split(",")).toEqual(["team", "division"]);
		// The recording is MLB's answer to that request: every group's division arrives named.
		const recording = JSON.parse(readFileSync(path.join(RAW, "standings-2026-09-05-division.json"), "utf8")) as {
			records: { league: { id: number };
				division: { id: number;
					nameShort?: string; }; }[];
		};
		expect(new Set(recording.records.map((r) => r.league.id))).toEqual(new Set([103, 104]));
		expect(recording.records.every((r) => typeof r.division.nameShort === "string")).toBe(true);
	});

	it("fetchFinalStandings and fetchSpringStandings ask their own standings URLs (S128)", async () =>
	{
		const { mlb, urls } = client();
		await mlb.fetchFinalStandings(2026);
		await mlb.fetchSpringStandings(2026, "2026-03-01");
		expect(urls).toEqual([
			finalStandingsUrl(2026),
			springStandingsUrl(2026, "2026-03-01"),
		]);
		const final = new URL(urls[0]!);
		expect(final.searchParams.get("season")).toBe("2026");
		expect(final.searchParams.has("date")).toBe(false);
		const spring = new URL(urls[1]!);
		expect(spring.searchParams.get("standingsTypes")).toBe("springTraining");
		expect(spring.searchParams.get("date")).toBe("2026-03-01");
	});

	it("S102 AC 1: the final and spring standings hydrate each record group's division too", async () =>
	{
		const { mlb, urls } = client();
		await mlb.fetchFinalStandings(2026);
		await mlb.fetchSpringStandings(2026, "2026-03-01");
		const [final, spring] = urls.map((url) => new URL(url));
		expect(final!.searchParams.get("hydrate")).toBe("team,division");
		expect(spring!.searchParams.get("hydrate")).toBe("team,division");
	});

	it("fetchPlayers asks for this season's stats, and asks nothing for no ids", async () =>
	{
		const { mlb, urls } = client();
		expect(await mlb.fetchPlayers([])).toEqual([]);
		expect(urls).toEqual([]);
		const players = await mlb.fetchPlayers([691718]);
		expect(players.length).toBeGreaterThan(0);
		expect(decodeURIComponent(urls[0]!)).toContain("season=2026");
	});

	it("S209 AC 1: fetchPlayerXrefs asks the batched people call with hydrate=xrefId, reading FanGraphs and Lahman ids, and asks nothing for no ids", async () =>
	{
		const urls: string[] = [];
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async (input) =>
			{
				urls.push(String(input));
				return new Response(readFileSync(path.join(RAW, "people-xref-823823.json")));
			},
		});
		expect(await mlb.fetchPlayerXrefs([])).toEqual(new Map());
		expect(urls).toEqual([]);
		const xrefs = await mlb.fetchPlayerXrefs([665871, 691788]);
		expect(urls).toHaveLength(1);
		const asked = new URL(urls[0]!);
		expect(asked.pathname).toBe("/api/v1/people");
		expect(asked.searchParams.get("personIds")).toBe("665871,691788");
		expect(asked.searchParams.get("hydrate")).toBe("xrefId");
		// Every recorded player is read (the file answers all 33, whatever was asked); the recorded rookie has no Lahman id.
		expect(xrefs.size).toBe(33);
		expect(xrefs.get(691788)).toEqual({
			fangraphsId: "29780",
			bbrefId: null,
		});
		expect(xrefs.get(665871)).toEqual({
			fangraphsId: "21741",
			bbrefId: "assadja01",
		});
	});

	it("fetchGameTimestamps and fetchGameDiffPatch read the recorded feed history", async () =>
	{
		const { mlb, urls } = client();
		expect((await mlb.fetchGameTimestamps(823823)).length).toBeGreaterThan(0);
		const patch = await mlb.fetchGameDiffPatch(823823, "20260905_170118", "20260905_194407");
		expect(patch.length).toBeGreaterThan(0);
		expect(urls.at(-1)).toContain("startTimecode=20260905_170118&endTimecode=20260905_194407");
	});

	it("content is best-effort: a failed content request is no highlights; any other failure throws with the URL", async () =>
	{
		const { mlb } = client();
		expect(await mlb.fetchGameContent(823823)).toEqual([]);
		await expect(mlb.fetchGame(823823)).rejects.toThrow(/^HTTP 404 for .*\/feed\/live/);
	});

	it("fetchPlayMetrics asks MLB's bdfed feed with every category and maps the recording (S93)", async () =>
	{
		const { mlb, urls } = client();
		const metrics = await mlb.fetchPlayMetrics(823823);
		expect(urls).toEqual(["https://bdfed.stitch.mlbinfra.com/bdfed/playMetrics/823823?keyMoments=true&scoringPlays=true&homeRuns=true&strikeouts=true&hardHits=true&highLeverage=false&leadChange=true&winProb=true&absChallenge=true"]);
		expect(metrics?.atBats).toHaveLength(85);
		expect(await mlb.fetchPlayMetrics(1)).toBeNull();
	});

	it("fetchGameGraphContent asks data-graph's persisted query with MLB's client headers and maps the recording (S94)", async () =>
	{
		const asked: { url: URL;
			headers: Headers; }[] = [];
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async (input, init) =>
			{
				const url = new URL(String(input));
				const headers = new Headers(init?.headers);
				asked.push({
					url,
					headers,
				});
				const ok = url.searchParams.get("variables")?.includes("[823823]") && headers.get("x-client-name") === "mlb";
				return ok ? new Response(readFileSync(path.join(RAW, "graphql-content-823823.json"))) : new Response("", {
					status: 400,
				});
			},
		});
		const graph = await mlb.fetchGameGraphContent(823823);
		const { url, headers } = asked[0]!;
		expect(`${url.origin}${url.pathname}`).toBe("https://data-graph.mlb.com/graphql/");
		expect(url.searchParams.get("operationName")).toBe("getGamesByGamePks");
		expect(JSON.parse(url.searchParams.get("extensions")!).persistedQuery.sha256Hash).toBe("e12a5c2692406844d5f15f52ce7754208f53da81867de7d3e9e773611f4a040a");
		expect(JSON.parse(url.searchParams.get("variables")!)).toMatchObject({
			gamePks: [823823],
			locale: "EN_US",
		});
		expect(headers.get("x-client-name")).toBe("mlb");
		expect(headers.get("content-type")).toBe("application/json");
		expect(graph?.videoPlayRefs).toHaveLength(18);
		// The gateway's 400 for anything it won't answer is a null, not a throw.
		expect(await mlb.fetchGameGraphContent(1)).toBeNull();
	});

	it("season calendar: the recorded 2026 calendar with its World Series final and winner; a failed request rejects (S140 AC 3: still two requests)", async () =>
	{
		const { mlb, urls } = client();
		expect(await mlb.fetchSeasonCalendar(2026)).toEqual({
			season: 2026,
			springStartDate: "2026-02-20",
			lastGameDate: "2026-10-28",
			regularSeasonStartDate: "2026-03-25",
			regularSeasonEndDate: "2026-09-27",
			champion: {
				teamId: 158,
				name: "Milwaukee Brewers",
				wonOn: "2026-10-28",
			},
		});
		expect(urls).toEqual([
			"https://statsapi.mlb.com/api/v1/seasons/2026?sportId=1",
			"https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=W&season=2026",
		]);
		// No recording for 2031: the calendar answers 404, a failed request — it rejects rather than
		// answering null, so the standings can tell unreachable from unpublished (S128 AC 7).
		await expect(mlb.fetchSeasonCalendar(2031)).rejects.toThrow("404");
	});
});

describe("HttpMlbStatsClient fetchGameEditorial (S122)", () =>
{
	const recorded = JSON.parse(readFileSync(path.join(RAW, "content-823823.json"), "utf8")) as Record<string, unknown>;

	/** A client whose content endpoint answers `content` (or 404 when it is undefined); nothing else is asked. */
	function contentClient(content: unknown): HttpMlbStatsClient
	{
		return new HttpMlbStatsClient({
			fetchImpl: async (input) =>
			{
				expect(new URL(String(input)).pathname).toBe("/api/v1/game/823823/content");
				return content === undefined ? new Response("{}", {
					status: 404,
				}) : Response.json(content);
			},
		});
	}

	it("an empty content answer (no videos, no recap — most old games) is null, so the backfill counts it a failure", async () =>
	{
		const empty = {
			...recorded,
			editorial: {},
			highlights: {
				highlights: {
					items: [],
				},
			},
		};
		expect(await contentClient(empty).fetchGameEditorial(823823)).toBeNull();
	});

	it("a 404 is null", async () =>
	{
		expect(await contentClient(undefined).fetchGameEditorial(823823)).toBeNull();
	});

	it("an answer with videos is a value carrying them", async () =>
	{
		const editorial = await contentClient(recorded).fetchGameEditorial(823823);
		expect(editorial?.highlights.length).toBeGreaterThan(0);
		expect(editorial?.recap).toBeTruthy();
	});
});

describe("HttpMlbStatsClient.searchHighlights (S5)", () =>
{
	const recorded = readFileSync(path.resolve(RAW, "../search-walk-off.json"), "utf8");

	it("asks MLB's free-text search and maps its recorded answer", async () =>
	{
		const urls: string[] = [];
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async (input) =>
			{
				urls.push(String(input));
				return new Response(recorded);
			},
		});
		const page = await mlb.searchHighlights("walk-off");
		expect(urls).toHaveLength(1);
		expect(new URL(urls[0]!).host).toBe("fastball-gateway.mlb.com");
		expect(page.highlights.length).toBeGreaterThan(0);
		expect(page.total).toBeGreaterThanOrEqual(page.highlights.length);
	});

	it("rejects when MLB errors, so the route says so rather than showing no results", async () =>
	{
		const mlb = new HttpMlbStatsClient({
			fetchImpl: async () => new Response("", {
				status: 503,
			}),
		});
		await expect(mlb.searchHighlights("walk-off")).rejects.toThrow(/503/);
	});
});

describe("HttpMlbStatsClient feed time (S150 AC 2)", () =>
{
	/** A client whose live feed is `feed` (the recorded final feed unless given); everything else answers 404. */
	function feedClient(feed: string = readFileSync(path.join(RAW, "live-823823.json"), "utf8"), now = new Date("2026-09-06T00:00:00.000Z")): HttpMlbStatsClient
	{
		return new HttpMlbStatsClient({
			now: () => now,
			fetchImpl: async (input) => /\/feed\/live$/.test(new URL(String(input)).pathname) ? new Response(feed) : new Response("{}", {
				status: 404,
			}),
		});
	}

	it("S150 AC 2 feed time: the fetched game carries the feed's metaData.timeStamp as ISO beside the game, never on it", async () =>
	{
		const fetched = await feedClient().fetchGame(823823);
		expect(fetched.feedTime).toBe("2026-09-05T23:34:35.000Z");
		expect(fetched.game.gamePk).toBe(823823);
		expect(fetched.game).not.toHaveProperty("feedTime");
		expect((await feedClient().fetchGameFeed(823823)).feedTime).toBe("2026-09-05T23:34:35.000Z");
	});

	it("S150 AC 2 no time: a feed with no timeStamp leaves the feed time out", async () =>
	{
		const feed = JSON.parse(readFileSync(path.join(RAW, "live-823823.json"), "utf8")) as { metaData?: Record<string, unknown> };
		delete feed.metaData?.timeStamp;
		const fetched = await feedClient(JSON.stringify(feed)).fetchGame(823823);
		expect(fetched).not.toHaveProperty("feedTime");
	});

	it("S150 AC 2 future time: a feed time further ahead of BT's clock than the tolerance is left out", async () =>
	{
		// The recorded feed says 23:34:35; BT's clock reads 23:00, 34 minutes earlier.
		const fetched = await feedClient(undefined, new Date("2026-09-05T23:00:00.000Z")).fetchGame(823823);
		expect(fetched).not.toHaveProperty("feedTime");
	});
});

describe("HttpMlbStatsClient player of the game (S99)", () =>
{
	const POTG_URL = "https://www.mlb.com/apps/player-of-the-game/game/json/winners/823823.json";
	const ZEFERJAHN = {
		playerId: 666171,
		teamId: 112,
		summary: "1.2 IP, 0 ER, K, BB",
		winProbabilityAdded: 40.7,
	};
	const isPotg = (url: URL) => url.hostname === "www.mlb.com";
	/** The recorded 823823 feed with its game type and status changed, answered for the feed's URL. */
	const feedAs = (type: string, coded: string, abstract: string) =>
	{
		const feed = JSON.parse(readFileSync(path.join(RAW, "live-823823.json"), "utf8")) as {
			gameData: { game: { type: string };
				status: { codedGameState: string;
					abstractGameState: string; }; };
		};
		feed.gameData.game.type = type;
		feed.gameData.status.codedGameState = coded;
		feed.gameData.status.abstractGameState = abstract;
		return (url: URL) => url.pathname === "/api/v1.1/game/823823/feed/live" ? new Response(JSON.stringify(feed)) : undefined;
	};

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("S99 AC 3: fetchPlayerOfTheGame asks mlb.com's player-of-the-game feed and maps the recording", async () =>
	{
		const { mlb, asked } = recordedClient();
		expect(playerOfTheGameUrl(823823)).toBe(POTG_URL);
		expect(await mlb.fetchPlayerOfTheGame(823823)).toEqual({
			media: ZEFERJAHN,
		});
		expect(asked).toEqual([POTG_URL]);
	});

	it("S99 AC 3: fetchGame of a final regular-season game says it is due a pick and asks none itself (ingest asks, only while a side is missing)", async () =>
	{
		const { mlb, asked } = recordedClient();
		const fetched = await mlb.fetchGame(823823);
		expect(fetched.playerOfTheGameDue).toBe(true);
		expect(fetched.game).not.toHaveProperty("playerOfTheGame");
		expect(asked.some((url) => isPotg(new URL(url)))).toBe(false);
	});

	it("S99 AC 3: a game in progress, or of a type MLB doesn't pick for, never asks it, so a live poll adds no request", async () =>
	{
		for (const override of [feedAs("R", "I", "Live"), feedAs("S", "F", "Final")])
		{
			const { mlb, asked } = recordedClient(override);
			const { game, playerOfTheGameDue } = await mlb.fetchGame(823823);
			expect(playerOfTheGameDue).toBeUndefined();
			expect(game).not.toHaveProperty("playerOfTheGame");
			expect(asked.some((url) => isPotg(new URL(url)))).toBe(false);
		}
	});

	it("S99 AC 5: when the call fails or names nobody the field is absent and the game is served as before", async () =>
	{
		const { game: whole } = await recordedClient().mlb.fetchGame(823823);
		const { playerOfTheGame: _, ...asBefore } = whole;
		const nobody = JSON.stringify({
			gamePK: "823823",
			fanWinner: {
				feedId: null,
			},
			mediaWinner: {
				feedId: null,
			},
		});
		for (const answer of [() => new Response("{}", {
			status: 500,
		}), () => new Response(nobody), () => new Response("not json")])
		{
			const { mlb } = recordedClient((url) => isPotg(url) ? answer() : undefined);
			expect(await mlb.fetchPlayerOfTheGame(823823)).toBeNull();
			const { game } = await mlb.fetchGame(823823);
			expect(game).toEqual(asBefore);
		}
	});

	it("S99 AC 5 hung: a player-of-the-game request that never resolves leaves fetchGame answering within PLAY_METRICS_LIMIT_MS, the field absent", async () =>
	{
		vi.useFakeTimers();
		const { mlb } = recordedClient((url) => isPotg(url) ? new Promise<Response>(() => undefined) as unknown as Response : undefined);
		let answered: Awaited<ReturnType<typeof mlb.fetchGame>> | undefined;
		void mlb.fetchGame(823823).then((fetched) =>
		{
			answered = fetched;
		});
		await vi.advanceTimersByTimeAsync(PLAY_METRICS_LIMIT_MS);
		expect(answered).toBeDefined();
		expect(answered?.game).not.toHaveProperty("playerOfTheGame");
		// The rest of the game is all there: the recorded play metrics arrived well inside the limit.
		expect(answered?.game.playMetrics?.atBats).toHaveLength(85);
		expect(answered?.playMetricsLate).toBeUndefined();
	});
});

describe("HttpMlbStatsClient fetchGame skipPlayMetrics (B577)", () =>
{
	it("B577: with skipPlayMetrics no playMetrics request is sent, and the game comes without them and with no late promise", async () =>
	{
		const { mlb, asked } = recordedClient();
		const fetched = await mlb.fetchGame(823823, {
			skipPlayMetrics: true,
		});
		expect(asked.some((url) => url.includes("/bdfed/playMetrics/"))).toBe(false);
		expect(fetched.game.playMetrics).toBeUndefined();
		expect(fetched.playMetricsLate).toBeUndefined();
		expect(fetched.game.highlights.length).toBeGreaterThan(0);
		expect((await mlb.fetchGame(823823)).game.playMetrics?.atBats).toHaveLength(85);
	});
});

describe("HttpMlbStatsClient game uniforms (S101)", () =>
{
	const UNIFORMS_URL = "https://statsapi.mlb.com/api/v1/uniforms/game?gamePks=823823";
	const isUniforms = (url: URL) => url.pathname === "/api/v1/uniforms/game";

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("S101 AC 3: fetchGameUniforms asks the Stats API's uniforms endpoint and maps the recording", async () =>
	{
		const { mlb, asked } = recordedClient();
		expect(gameUniformsUrl(823823)).toBe(UNIFORMS_URL);
		const uniforms = await mlb.fetchGameUniforms(823823);
		expect(uniforms?.home?.[0]).toEqual({
			code: "146_jersey_1_2026",
			text: "Marlins Home White Jersey",
			type: "Jersey",
		});
		expect(uniforms?.away).toHaveLength(3);
		expect(asked).toEqual([UNIFORMS_URL]);
	});

	it("S101 AC 3: fetchGame never asks it, so no game read or live poll adds the request", async () =>
	{
		const { mlb, asked } = recordedClient();
		const { game } = await mlb.fetchGame(823823);
		expect(game).not.toHaveProperty("uniforms");
		expect(asked.some((url) => url.includes("/uniforms/"))).toBe(false);
	});

	it("S101 AC 5 hung: a uniforms request that never resolves leaves fetchGame answering within PLAY_METRICS_LIMIT_MS, the field absent", async () =>
	{
		vi.useFakeTimers();
		const { mlb } = recordedClient((url) => isUniforms(url) ? new Promise<Response>(() => undefined) as unknown as Response : undefined);
		let answered: Awaited<ReturnType<typeof mlb.fetchGame>> | undefined;
		void mlb.fetchGame(823823).then((fetched) =>
		{
			answered = fetched;
		});
		await vi.advanceTimersByTimeAsync(PLAY_METRICS_LIMIT_MS);
		expect(answered).toBeDefined();
		expect(answered?.game).not.toHaveProperty("uniforms");
		expect(answered?.game.playMetrics?.atBats).toHaveLength(85);
	});
});

describe("HttpMlbStatsClient game rule settings (S100)", () =>
{
	const RULE_SETTINGS_URL = "https://statsapi.mlb.com/api/v1.1/game/823823/feed/live?language=en&hydrate=ruleSettings&fields=gameData,ruleSettings";
	const isRuleSettings = (url: URL) => url.pathname.endsWith("/feed/live") && url.searchParams.get("hydrate") === "ruleSettings";

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("S100 AC 3: fetchGameRuleSettings asks the live feed filtered to its ruleSettings hydrate and maps the recording", async () =>
	{
		const { mlb, asked } = recordedClient();
		expect(gameRuleSettingsUrl(823823)).toBe(RULE_SETTINGS_URL);
		const settings = await mlb.fetchGameRuleSettings(823823);
		expect(settings?.find((setting) => setting.name === "strikeZoneTopFactor")).toMatchObject({
			value: 53.5,
			unit: "percent",
		});
		expect(settings?.find((setting) => setting.name === "strikeZoneBottomFactor")?.value).toBe(27);
		expect(asked).toEqual([RULE_SETTINGS_URL]);
	});

	it("S100 AC 3: fetchGame never asks it, so no game read or live poll adds the request", async () =>
	{
		const { mlb, asked } = recordedClient();
		const { game } = await mlb.fetchGame(823823);
		expect(game).not.toHaveProperty("ruleSettings");
		expect(asked.some((url) => url.includes("ruleSettings"))).toBe(false);
	});

	// fetchGame doesn't ask the rule settings at all (ingest asks them beside it), so this proves both halves: the hung
	// endpoint is never called (a fetchGame that started asking it fails here), and the game still answers in time.
	it("S100 AC 5 hung: a rule-settings request that never resolves leaves fetchGame answering within PLAY_METRICS_LIMIT_MS, the field absent", async () =>
	{
		vi.useFakeTimers();
		let hungAsks = 0;
		const { mlb } = recordedClient((url) =>
		{
			if (!isRuleSettings(url)) return undefined;
			hungAsks += 1;
			return new Promise<Response>(() => undefined) as unknown as Response;
		});
		let answered: Awaited<ReturnType<typeof mlb.fetchGame>> | undefined;
		void mlb.fetchGame(823823).then((fetched) =>
		{
			answered = fetched;
		});
		await vi.advanceTimersByTimeAsync(PLAY_METRICS_LIMIT_MS);
		expect(answered).toBeDefined();
		expect(answered?.game).not.toHaveProperty("ruleSettings");
		expect(answered?.game.playMetrics?.atBats).toHaveLength(85);
		expect(hungAsks).toBe(0);
	});
});
