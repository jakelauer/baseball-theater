/**
 * S105 AC 4–5: `GET /api/v1/venues/:venueId/field.svg` serves only the drawing ingest kept: SVG with a long-lived
 * `Cache-Control`, 404 (`no-store`) for a venue with none, and never a call to Savant from the request.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FIXTURES_ROOT, FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemorySettingsRepository, InMemoryVenueFieldRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { ApiContext } from "./api.js";
import { handleApiRequest } from "./api.js";
import { PAST_EDGE_TTL_S, VENUE_FIELD_CACHE_CONTROL } from "./cache-control.js";

const recording = (venueId: number) => readFileSync(path.join(FIXTURES_ROOT, "raw", `savant-field-${venueId}.svg`), "utf8");

/** An API over fresh in-memory stores and the fixtures, with a counted `fetchVenueField`; `answer` replaces Savant's. */
function api(answer?: () => Promise<string | null>)
{
	const mlb = new FixtureMlbStatsClient();
	const fetchVenueField = vi.spyOn(mlb, "fetchVenueField");
	if (answer) fetchVenueField.mockImplementation(answer);
	const venueFields = new InMemoryVenueFieldRepository();
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	const ctx: ApiContext = {
		ingest: {
			mlb,
			...memoryScheduleStores(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
			venueFields,
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
	};
	return {
		get: (pathname: string) => handleApiRequest(new Request(`http://localhost:8787${pathname}`), ctx),
		fetchVenueField,
		venueFields,
	};
}

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("GET /api/v1/venues/:venueId/field.svg (S105)", () =>
{
	it("S105 AC 4: serves the kept drawing as image/svg+xml with a long-lived Cache-Control, and the request never asks Savant", async () =>
	{
		const { get, fetchVenueField } = api();
		// Nothing kept yet: 404, and the read asked Savant nothing.
		expect((await get("/api/v1/venues/4169/field.svg")).status).toBe(404);
		expect(fetchVenueField).not.toHaveBeenCalled();
		// Storing a game at 4169 (a read of 823823) keeps its park's drawing.
		expect((await get("/api/v1/games/823823")).status).toBe(200);
		expect(fetchVenueField).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 3; i++)
		{
			const response = await get("/api/v1/venues/4169/field.svg");
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
			expect(response.headers.get("Cache-Control")).toBe(VENUE_FIELD_CACHE_CONTROL);
			expect(response.headers.get("Cache-Control")).toContain(`s-maxage=${PAST_EDGE_TTL_S}`);
			expect(response.headers.get("Cache-Control")).toMatch(/^public, max-age=86400,/);
			expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(await response.text()).toBe(recording(4169));
		}
		expect(fetchVenueField).toHaveBeenCalledTimes(1);
	});

	it("S105 AC 4: 404 (never cached) for a venue with no drawing kept, and for a venue id that isn't a number", async () =>
	{
		const { get, fetchVenueField } = api();
		const missing = await get("/api/v1/venues/3313/field.svg");
		expect(missing.status).toBe(404);
		expect(missing.headers.get("Cache-Control")).toBe("no-store");
		expect(await missing.json()).toEqual({
			error: "not_found",
		});
		expect((await get("/api/v1/venues/abc/field.svg")).status).toBe(404);
		expect((await get("/api/v1/venues/4169/field.png")).status).toBe(404);
		expect(fetchVenueField).not.toHaveBeenCalled();
	});

	it("S105 AC 4: a venue id of up to nine digits reaches the kept drawing; a tenth digit is not the route", async () =>
	{
		const { get, venueFields } = api();
		const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0,0\"/></svg>";
		await venueFields.upsert({
			venueId: 999999999,
			svg,
			fetchedAt: "2026-11-27T00:00:00.000Z",
		});
		const nine = await get("/api/v1/venues/999999999/field.svg");
		expect(nine.status).toBe(200);
		expect(await nine.text()).toBe(svg);
		// The same number with a tenth digit (a leading zero) is outside the route's pattern.
		expect((await get("/api/v1/venues/0999999999/field.svg")).status).toBe(404);
	});

	it("S105 AC 5: a venue Savant has no drawing for, or a failed fetch, answers 404 and the game is served as without the source", async () =>
	{
		const plain = api();
		const expected = await (await plain.get("/api/v1/games/823823")).json() as Record<string, unknown>;
		for (const answer of [async () => null, async () => Promise.reject(new Error("Savant down"))])
		{
			const { get, fetchVenueField } = api(answer);
			const game = await get("/api/v1/games/823823");
			expect(game.status).toBe(200);
			const body = await game.json() as Record<string, unknown>;
			// Only the read's own times (its fetch, and the version stamp taken from it) differ between two reads.
			const untimed = (game: Record<string, unknown>) => ({
				...game,
				fetchedAt: "",
				lastChangedAt: "",
				version: 0,
			});
			expect(untimed(body)).toEqual(untimed(expected));
			expect(fetchVenueField).toHaveBeenCalledTimes(1);
			expect((await get("/api/v1/venues/4169/field.svg")).status).toBe(404);
		}
	});
});
