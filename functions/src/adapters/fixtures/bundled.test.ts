/**
 * S45: the Worker's bundled fixtures are the committed files, all of them that the
 * fixture client reads by name — so a new committed schedule or game can't silently
 * 404 in `pnpm dev` while Node tests pass.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	BUNDLED_FIXTURES, BUNDLED_TEXT_FIXTURES, bundledFixtureFiles, createBundledFixtureClient,
} from "./bundled.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

/**
 * What `FixtureClient` reads by name: `schedule-<date>`, `game-<pk>`, `plays-<pk>`, `standings-<date>`
 * (the mapped table, `fetchStandings`' fallback for a day with no recording), `players-*`, and from `raw/`
 * the play-metrics recordings (S93), the player of the game (S99), the GraphQL game content (S94), the season calendars and World
 * Series (S111), each day's recorded table, `raw/standings-<date>` (S160, which `fetchStandings` maps
 * first), and each season's final and spring standings (S128) — a season's table with no date, which
 * before its first game lists the new season's teams (S139 reads 2027's for the regular season's blank
 * list), included, and each recorded highlight search, `search-<words>` (S5) or a filtered one,
 * `search[-<words>]--<filter>-<value>…` (S72). A recording with a suffix after its date (`-wildcard`,
 * `-spring-regular`) is never served.
 */
const SERVED = new RegExp(`^(${[
	String.raw`schedule-\d{4}-\d{2}-\d{2}`, String.raw`game-\d+`, String.raw`plays-\d+`, String.raw`standings-\d{4}-\d{2}-\d{2}`, "players-.+",
	String.raw`raw/playmetrics-\d+`, String.raw`raw/potg-\d+`, String.raw`raw/uniforms-\d+`, String.raw`raw/rulesettings-\d+`, String.raw`raw/graphql-content-\d+`, String.raw`raw/seasons-\d{4}`, String.raw`raw/worldseries-\d{4}`,
	String.raw`raw/standings-\d{4}-(?:final|spring)`, String.raw`raw/standings-\d{4}-\d{2}-\d{2}`, "search-[a-z0-9-]+",
].join("|")})\\.json$`);

describe("bundled fixtures (S45)", () =>
{
	it("bundles exactly the committed fixtures the client serves, unchanged", () =>
	{
		const committed = [...readdirSync(FIXTURES), ...readdirSync(path.join(FIXTURES, "raw")).map((name) => `raw/${name}`)]
			.filter((name) => SERVED.test(name)).sort();
		expect(Object.keys(BUNDLED_FIXTURES).sort()).toEqual(committed);
		for (const name of committed)
		{
			expect(BUNDLED_FIXTURES[name], name).toEqual(JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")));
		}
	});

	it("the guard covers S139's recordings: without them in bundled.ts it fails", () =>
	{
		// The new season's team list and the clinched-day table (mapped, and MLB's recording S160 maps) are read by name, so the guard must match them.
		for (const name of ["raw/standings-2027-final.json", "standings-2026-09-12.json", "raw/standings-2026-09-12.json"])
		{
			expect(SERVED.test(name), name).toBe(true);
			const { [name]: _left, ...without } = BUNDLED_FIXTURES;
			const committed = [...readdirSync(FIXTURES), ...readdirSync(path.join(FIXTURES, "raw")).map((file) => `raw/${file}`)]
				.filter((file) => SERVED.test(file)).sort();
			expect(Object.keys(without).sort()).not.toEqual(committed);
		}
		// The combined-types and playoff recordings are evidence for the ledger, never served, so never bundled.
		expect(SERVED.test("raw/standings-2026-final-wildcard.json")).toBe(false);
	});

	it("S105 AC 1: bundles exactly the committed field drawings, byte for byte, so pnpm dev serves the recordings", async () =>
	{
		const drawings = readdirSync(path.join(FIXTURES, "raw")).filter((name) => /^savant-field-\d+\.svg$/.test(name)).map((name) => `raw/${name}`).sort();
		expect(drawings).toEqual(["raw/savant-field-3313.svg", "raw/savant-field-4169.svg"]);
		expect(Object.keys(BUNDLED_TEXT_FIXTURES).sort()).toEqual(drawings);
		for (const name of drawings)
		{
			const recorded = readFileSync(path.join(FIXTURES, name), "utf8");
			expect(await bundledFixtureFiles.readText(name), name).toBe(recorded);
			expect(await createBundledFixtureClient().fetchVenueField(Number(/\d+/.exec(name)![0])), name).toBe(recorded);
		}
		await expect(bundledFixtureFiles.readText("raw/savant-field-1.svg")).rejects.toThrow(/no bundled fixture/);
		expect(await createBundledFixtureClient().fetchVenueField(1)).toBeNull();
	});

	it("an unknown fixture rejects like a missing file", async () =>
	{
		await expect(bundledFixtureFiles.read("game-1.json")).rejects.toThrow(/no bundled fixture/);
		expect(await bundledFixtureFiles.list()).toContain("schedule-2024-07-04.json");
	});
});
