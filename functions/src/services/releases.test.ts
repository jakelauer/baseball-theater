/**
 * S132: `GET /api/v1/releases` answers every approved release's notes, newest first, and the newest
 * as `current`, from notes bundled into the build, cacheable for at most five minutes in all.
 */
import type { ReleaseNotes, ReleasesResponse } from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import { createDevAccountData, createDevAuth } from "../adapters/fixtures/auth.js";
import { FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	InMemoryGameProjectionRepository,
	InMemoryGameRepository,
	InMemoryScheduleRepository,
	InMemorySettingsRepository,
} from "../adapters/memory/repos.js";
import { handleApiRequest } from "../handlers/api.js";
import { RELEASES_CACHE_CONTROL } from "../handlers/cache-control.js";
import { BUNDLED_RELEASE_NOTES, getReleases } from "./releases.js";

/** One release's notes, approved unless `draft`. */
const notes = (version: string, draft = false): ReleaseNotes => ({
	version,
	headline: [],
	items: [{
		kind: "feature",
		title: `What ${version} adds`,
		sentence: "Something new.",
	}],
	...!draft && {
		approval: {
			date: "2027-03-25",
			quote: "Yes",
		},
	},
});

/** `GET /api/v1/releases` over the given notes (the build's bundle when none are given). */
function getReleasesRoute(releases?: readonly ReleaseNotes[])
{
	const auth = createDevAuth();
	const settings = new InMemorySettingsRepository();
	return handleApiRequest(new Request("http://localhost:8787/api/v1/releases"), {
		ingest: {
			mlb: new FixtureMlbStatsClient(),
			schedules: new InMemoryScheduleRepository(),
			games: new InMemoryGameRepository(),
			projections: new InMemoryGameProjectionRepository(),
		},
		auth,
		settings,
		account: createDevAccountData({
			users: auth.users,
			settings,
		}),
		...releases && {
			releases,
		},
	});
}

describe("GET /api/v1/releases (S132)", () =>
{
	it("S132 AC 1 draft newer: a draft newer than the newest approved release is never returned, as current or in releases", async () =>
	{
		const response = await getReleasesRoute([notes("v4.1.0"), notes("v4.3.0", true), notes("v4.10.0"), notes("v4.2.0")]);
		expect(response.status).toBe(200);
		const body = await response.json() as ReleasesResponse;
		expect(body.current?.version).toBe("v4.10.0");
		expect(body.releases.map((r) => r.version)).toEqual(["v4.10.0", "v4.2.0", "v4.1.0"]);
		expect(body.releases[0]).toEqual(notes("v4.10.0"));
	});

	it("S132 AC 1 none approved: current is null and releases empty, with no notes or only drafts", async () =>
	{
		for (const all of [[], [notes("v4.0.0", true)]])
		{
			const body = await (await getReleasesRoute(all)).json() as ReleasesResponse;
			expect(body).toEqual({
				current: null,
				releases: [],
			});
		}
	});

	it("S132 AC 1 bundle: without notes of its own the route answers the build's bundled notes", async () =>
	{
		const body = await (await getReleasesRoute()).json() as ReleasesResponse;
		expect(body).toEqual(getReleases(BUNDLED_RELEASE_NOTES));
	});

	it("S132 AC 4 header: cacheable for at most 300s in all, fresh plus stale, browser and edge", async () =>
	{
		const header = (await getReleasesRoute([notes("v4.0.0")])).headers.get("Cache-Control") ?? "";
		expect(header).toBe(RELEASES_CACHE_CONTROL);
		const directives = new Map(header.split(",").map((part): [string, string | undefined] =>
		{
			const [name = "", value] = part.trim().split("=");
			return [name, value];
		}));
		expect(directives.has("public")).toBe(true);
		expect(directives.has("no-store")).toBe(false);
		const seconds = (name: string) => Number(directives.get(name) ?? 0);
		const fresh = Math.max(seconds("max-age"), seconds("s-maxage"));
		expect(fresh).toBeGreaterThan(0);
		expect(fresh + seconds("stale-while-revalidate")).toBeLessThanOrEqual(300);
	});
});
