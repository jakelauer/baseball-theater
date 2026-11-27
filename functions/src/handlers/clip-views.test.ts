/**
 * S174 AC 3–5: `POST /api/v1/clips/:mediaId/views` counts one start or finish of a stored highlight of a game, on the
 * request's UTC day, answering 204; a body that isn't `{ gamePk, event, shownPosition }` is 400 and a clip BT doesn't hold
 * for that game is 404, counting nothing either way; a request that doesn't come from BT's own page (`Sec-Fetch-Site`
 * other than `same-origin`, or without it an `Origin` other than the request's own) is 403, and no answer carries CORS
 * headers. It reads no cookie and no session and logs nothing.
 */
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryClipEngagementRepository, InMemoryGameProjectionRepository, InMemoryGameRepository, InMemorySettingsRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { ApiContext } from "./api.js";
import { handleApiRequest } from "./api.js";

/** The fixture game whose stored highlights are `hl-1`, `hl-2` and `hl-3`. */
const GAME_PK = 744834;

/** An API over fresh in-memory stores holding the fixture game, its clock at `now`, and its clip counts. */
async function api(now = "2026-11-22T18:00:00Z", counted = true)
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(GAME_PK);
	const games = new InMemoryGameRepository();
	await games.upsert({
		...game,
		version: 1,
		lastChangedAt: "2026-11-22T00:00:00.000Z",
	});
	const clipEngagement = new InMemoryClipEngagementRepository();
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const clock = {
		now: new Date(now),
	};
	const ctx: ApiContext = {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			...memoryScheduleStores(),
			games,
			projections: new InMemoryGameProjectionRepository(),
			now: () => clock.now,
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
		...counted && {
			clipEngagement,
		},
	};
	return {
		clock,
		clipEngagement,
		games,
		/** Posts a view as BT's own page does (`Sec-Fetch-Site: same-origin`) unless `headers` says otherwise; `null` drops a header. */
		post: (mediaId: string, body: unknown, headers: Record<string, string | null> = {}) => handleApiRequest(new Request(`http://localhost:8787/api/v1/clips/${mediaId}/views`, {
			method: "POST",
			headers: Object.fromEntries(Object.entries({
				"Content-Type": "application/json",
				"Sec-Fetch-Site": "same-origin",
				...headers,
			}).filter((entry): entry is [string, string] => entry[1] !== null)),
			body: typeof body === "string" ? body : JSON.stringify(body),
		}), ctx),
	};
}

const view = (event: string, shownPosition: number, gamePk: number = GAME_PK) => ({
	gamePk,
	event,
	shownPosition,
});

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("POST /api/v1/clips/:mediaId/views (S174)", () =>
{
	it("S174 AC 4: answers 204 with no body, no-store, and counts one", async () =>
	{
		const { post, clipEngagement } = await api();
		const response = await post("hl-2", view("start", 2));
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		await post("hl-2", view("complete", 2));
		await post("hl-2", view("complete", 2));
		expect(await clipEngagement.countsFor(GAME_PK)).toEqual([
			{
				mediaId: "hl-2",
				gamePk: GAME_PK,
				viewDay: "2026-11-22",
				event: "complete",
				shownPosition: 2,
				count: 2,
			},
			{
				mediaId: "hl-2",
				gamePk: GAME_PK,
				viewDay: "2026-11-22",
				event: "start",
				shownPosition: 2,
				count: 1,
			},
		]);
	});

	it("S174 AC 4: answers 400 for an event that isn't start or complete, a body that isn't that shape, or a shown position outside 0–100, counting nothing", async () =>
	{
		const { post, clipEngagement } = await api();
		for (const body of [
			view("pause", 1),
			view("Start", 1),
			view("start", 101),
			view("start", -1),
			view("start", 1.5),
			{
				gamePk: GAME_PK,
				event: "start",
			},
			{
				gamePk: String(GAME_PK),
				event: "start",
				shownPosition: 1,
			},
			[view("start", 1)],
			{
				...view("start", 1),
				viewer: "someone",
			},
			"not json",
			"",
			"null",
		])
		{
			const response = await post("hl-1", body);
			expect(response.status, JSON.stringify(body)).toBe(400);
			expect(await response.json()).toMatchObject({
				error: "invalid_body",
			});
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(await clipEngagement.countsFor(GAME_PK)).toEqual([]);
	});

	it("S174 AC 4: answers 404 when the clip is not one of that game's stored highlights, counting nothing", async () =>
	{
		const { post, clipEngagement } = await api();
		// An unknown clip, a clip of a game BT doesn't hold, and a malformed escape.
		for (const [mediaId, gamePk] of [["hl-404", GAME_PK], ["hl-1", 1], ["hl-%E0%A4%A", GAME_PK]] as const)
		{
			const response = await post(mediaId, view("start", 1, gamePk));
			expect(response.status, mediaId).toBe(404);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(await clipEngagement.countsFor(GAME_PK)).toEqual([]);
		expect(await clipEngagement.countsFor(1)).toEqual([]);
	});

	it("S174 AC 4: checks the clip is stored without reading the game's whole document", async () =>
	{
		const { post, games } = await api();
		const getByPk = vi.spyOn(games, "getByPk");
		expect((await post("hl-1", view("start", 1))).status).toBe(204);
		expect((await post("hl-404", view("start", 1))).status).toBe(404);
		expect(getByPk).not.toHaveBeenCalled();
	});

	it("S174 AC 4: refuses with 403 a view that doesn't come from BT's own page, counting nothing", async () =>
	{
		const { post, clipEngagement } = await api();
		const refused: Record<string, string | null>[] = [
			// Another site's page beaconing a text/plain body: no preflight, but the browser says where it came from.
			{
				"Sec-Fetch-Site": "cross-site",
				"Content-Type": "text/plain;charset=UTF-8",
			},
			{
				"Sec-Fetch-Site": "same-site",
			},
			{
				"Sec-Fetch-Site": "none",
			},
			// Sec-Fetch-Site decides when present, whatever Origin says.
			{
				"Sec-Fetch-Site": "cross-site",
				Origin: "http://localhost:8787",
			},
			// Without Sec-Fetch-Site, Origin must be the request's own.
			{
				"Sec-Fetch-Site": null,
				Origin: "https://evil.example",
			},
			{
				"Sec-Fetch-Site": null,
				Origin: "null",
			},
			// Neither header: no browser page sent it.
			{
				"Sec-Fetch-Site": null,
			},
			// A deliberate limit: a phone on the LAN in local dev (plain http to `name.local:5173`, so no Sec-Fetch-Site)
			// reaches the API through Vite's proxy, whose changeOrigin makes the request's own origin localhost:8787.
			{
				"Sec-Fetch-Site": null,
				Origin: "http://bt-dev.local:5173",
			},
		];
		for (const headers of refused)
		{
			const response = await post("hl-1", view("start", 1), headers);
			expect(response.status, JSON.stringify(headers)).toBe(403);
			expect(await response.json()).toMatchObject({
				error: "cross_site",
			});
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(await clipEngagement.countsFor(GAME_PK)).toEqual([]);
	});

	it("S174 AC 4: without Sec-Fetch-Site, an Origin that is the request's own counts", async () =>
	{
		const { post, clipEngagement } = await api();
		expect((await post("hl-1", view("start", 1), {
			"Sec-Fetch-Site": null,
			Origin: "http://localhost:8787",
		})).status).toBe(204);
		expect((await clipEngagement.countsFor(GAME_PK)).map((row) => row.count)).toEqual([1]);
	});

	it("S174 AC 4: no answer of the route carries CORS headers", async () =>
	{
		const { post } = await api();
		const answers = [
			await post("hl-1", view("start", 1)),
			await post("hl-1", view("pause", 1)),
			await post("hl-1", view("start", 1), {
				"Sec-Fetch-Site": "cross-site",
			}),
			await post("hl-404", view("start", 1)),
		];
		expect(answers.map((response) => response.status)).toEqual([204, 400, 403, 404]);
		for (const response of answers)
		{
			expect([...response.headers.keys()].filter((name) => name.startsWith("access-control-")), String(response.status)).toEqual([]);
		}
	});

	it("S174 AC 4: a percent-encoded media id is the clip it names", async () =>
	{
		const { post, clipEngagement } = await api();
		expect((await post("hl%2D3", view("start", 3))).status).toBe(204);
		expect((await clipEngagement.countsFor(GAME_PK)).map((row) => row.mediaId)).toEqual(["hl-3"]);
	});

	it("S174 AC 4: where no clip store is composed, it counts nothing and answers 404", async () =>
	{
		const { post } = await api(undefined, false);
		expect((await post("hl-1", view("start", 1))).status).toBe(404);
	});

	it("S174 AC 4: reads no cookie and no session: the same request with and without them counts the same, and neither header is read", async () =>
	{
		const { post, clipEngagement } = await api();
		const get = vi.spyOn(Headers.prototype, "get");
		const has = vi.spyOn(Headers.prototype, "has");
		await post("hl-1", view("start", 1), {
			Cookie: "bt_deleted=1; session=abc",
			Authorization: "Bearer dev:someone",
		});
		await post("hl-1", view("start", 1));
		const read = [...get.mock.calls, ...has.mock.calls].map(([name]) => name.toLowerCase());
		expect(read).not.toContain("cookie");
		expect(read).not.toContain("authorization");
		expect(await clipEngagement.countsFor(GAME_PK)).toEqual([
			{
				mediaId: "hl-1",
				gamePk: GAME_PK,
				viewDay: "2026-11-22",
				event: "start",
				shownPosition: 1,
				count: 2,
			},
		]);
	});

	it("S174 AC 3: a view counts on the request's UTC day: 23:59:59Z and the next second land on different days", async () =>
	{
		const {
			post, clipEngagement, clock,
		} = await api("2026-11-22T23:59:59Z");
		await post("hl-1", view("complete", 1));
		clock.now = new Date("2026-11-23T00:00:00Z");
		await post("hl-1", view("complete", 1));
		expect((await clipEngagement.countsFor(GAME_PK)).map((row) => [row.viewDay, row.count])).toEqual([["2026-11-22", 1], ["2026-11-23", 1]]);
	});

	it("S174 AC 5: the handler logs nothing, so no request identifier reaches a log", async () =>
	{
		const { post } = await api();
		const calls = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
		await post("hl-1", view("start", 1));
		await post("hl-1", view("pause", 1));
		await post("hl-404", view("start", 1));
		for (const spy of calls) expect(spy).not.toHaveBeenCalled();
	});
});
