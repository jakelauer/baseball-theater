/**
 * S105: ballpark field drawings — the recordings (AC 1), the port's two adapters and ingest asking once per venue
 * (AC 2, a counting fake), the one sanitizer (AC 3, the recordings intact and a hostile drawing cleaned) and the
 * optional source (AC 5). The route's own cases are in `handlers/venue-field.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { GameSnapshot } from "@bt/domain";
import type { VenueField, VenueFieldRepository } from "@bt/ports";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { FIXTURES_ROOT, FixtureMlbStatsClient } from "../adapters/fixtures/mlb.js";
import {
	HttpMlbStatsClient, SAVANT_BASE_URL, venueFieldUrl,
} from "../adapters/http/mlb.js";
import {
	InMemoryGameProjectionRepository, InMemoryGameRepository, InMemoryVenueFieldRepository, memoryScheduleStores,
} from "../adapters/memory/repos.js";
import type { IngestDeps } from "./ingest.js";
import { getOrRefreshGame, ingestGame } from "./ingest.js";
import {
	keepVenueFields, sanitizeFieldSvg, VENUE_FIELD_MAX_LENGTH, VENUE_FIELD_RETRY_MS,
} from "./venue-fields.js";

const recording = (venueId: number) => readFileSync(path.join(FIXTURES_ROOT, "raw", `savant-field-${venueId}.svg`), "utf8");

/** Fresh in-memory ingest deps over the fixtures, with a counted `fetchVenueField` and a kept-drawings store. */
function setup(answer?: (venueId: number) => Promise<string | null>)
{
	const mlb = new FixtureMlbStatsClient();
	const fetchVenueField = vi.spyOn(mlb, "fetchVenueField");
	if (answer) fetchVenueField.mockImplementation(answer);
	const venueFields = new InMemoryVenueFieldRepository();
	const deps: IngestDeps = {
		mlb,
		...memoryScheduleStores(),
		games: new InMemoryGameRepository(),
		projections: new InMemoryGameProjectionRepository(),
		venueFields,
	};
	return {
		mlb,
		deps,
		fetchVenueField,
		venueFields,
	};
}

/** 823823 (at 4169, loanDepot park) as fetched, renumbered to `gamePk` and set at `venueId` when given. */
async function fetchedGame(gamePk: number, venueId?: number)
{
	const { game } = await new FixtureMlbStatsClient().fetchGame(823823);
	return {
		...game,
		gamePk,
		...venueId !== undefined && {
			venue: {
				id: venueId,
				name: `Venue ${venueId}`,
			},
		},
	};
}

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("field drawing recordings (S105 AC 1)", () =>
{
	it("S105 AC 1: the fixture client serves each recording from disk, byte for byte, and never the network", async () =>
	{
		const network = vi.spyOn(globalThis, "fetch");
		const client = new FixtureMlbStatsClient();
		for (const venueId of [4169, 3313])
		{
			const svg = recording(venueId);
			expect(svg).toContain("viewBox=\"0 0 250 250\"");
			expect(await client.fetchVenueField(venueId)).toBe(svg);
		}
		// Savant answers an unknown venue with an error page; the fixtures have no recording for it.
		expect(await client.fetchVenueField(3309)).toBeNull();
		expect(network).not.toHaveBeenCalled();
	});
});

describe("fetchVenueField and ingest (S105 AC 2)", () =>
{
	/** An HTTP client whose fetch answers `respond` and records each URL. */
	function http(respond: (url: string) => Response | Promise<Response>)
	{
		const urls: string[] = [];
		const client = new HttpMlbStatsClient({
			fetchImpl: (async (input: string) =>
			{
				urls.push(String(input));
				return respond(String(input));
			}) as typeof fetch,
		});
		return {
			client,
			urls,
		};
	}

	it("S105 AC 2: the HTTP client asks Savant's own host for the venue's drawing and answers its text", async () =>
	{
		const svg = recording(4169);
		const { client, urls } = http(() => new Response(svg, {
			headers: {
				"content-type": "image/svg+xml",
			},
		}));
		expect(await client.fetchVenueField(4169)).toBe(svg);
		expect(urls).toEqual([`${SAVANT_BASE_URL}/site-core/images/fields/4169.svg`]);
		expect(venueFieldUrl(3313)).toBe("https://baseballsavant.mlb.com/site-core/images/fields/3313.svg");
	});

	it("S105 AC 2: the HTTP client answers null, never a throw, for Savant's error page, a body with no <svg>, or a failed call", async () =>
	{
		expect(await http(() => new Response("<!DOCTYPE html><html>Error | baseballsavant.com</html>", {
			status: 404,
		})).client.fetchVenueField(999999)).toBeNull();
		expect(await http(() => new Response("<html><body>maintenance</body></html>")).client.fetchVenueField(4169)).toBeNull();
		expect(await http(() => Promise.reject(new Error("offline"))).client.fetchVenueField(4169)).toBeNull();
	});

	it("S105 AC 2: a venue's drawing is fetched the first time a game there is stored, kept, and never fetched again per game or per read", async () =>
	{
		const {
			deps, fetchVenueField, venueFields,
		} = setup();
		expect(await venueFields.get(4169)).toBeNull();
		// The first game at 4169, stored by a read: asked once, sanitized and kept.
		expect(await getOrRefreshGame(deps, 823823)).not.toBeNull();
		expect(fetchVenueField.mock.calls).toEqual([[4169]]);
		expect((await venueFields.get(4169))?.svg).toBe(sanitizeFieldSvg(recording(4169)));
		// Reading and re-fetching that game, and storing two more games there, ask nothing more.
		await getOrRefreshGame(deps, 823823);
		await getOrRefreshGame(deps, 823823, {
			force: true,
		});
		await ingestGame(deps, await fetchedGame(1));
		await ingestGame(deps, await fetchedGame(2));
		expect(fetchVenueField).toHaveBeenCalledTimes(1);
		// A game at another park asks for that park's drawing, once.
		await ingestGame(deps, await fetchedGame(3, 3313));
		await ingestGame(deps, await fetchedGame(4, 3313));
		expect(fetchVenueField.mock.calls).toEqual([[4169], [3313]]);
		expect((await venueFields.get(3313))?.svg).toBe(recording(3313));
	});

	it("S105 AC 2: without a drawing store (the backfill, the seed paths) nothing is asked", async () =>
	{
		const { deps, fetchVenueField } = setup();
		const { venueFields: _none, ...withoutStore } = deps;
		await getOrRefreshGame(withoutStore, 823823);
		await ingestGame(withoutStore, await fetchedGame(5));
		expect(fetchVenueField).not.toHaveBeenCalled();
	});

	it("S105 AC 2: a venue BT got no drawing for is asked again only after a week; a kept drawing never", async () =>
	{
		const {
			mlb, fetchVenueField, venueFields,
		} = setup();
		const at = new Date("2026-11-27T12:00:00.000Z");
		await keepVenueFields({
			mlb,
			venueFields,
		}, [3309, 3309, 4169], at);
		expect(fetchVenueField.mock.calls).toEqual([[3309], [4169]]);
		expect(await venueFields.get(3309)).toEqual({
			venueId: 3309,
			svg: null,
			fetchedAt: at.toISOString(),
		});
		await keepVenueFields({
			mlb,
			venueFields,
		}, [3309, 4169], new Date(at.getTime() + VENUE_FIELD_RETRY_MS - 1));
		expect(fetchVenueField).toHaveBeenCalledTimes(2);
		const later = new Date(at.getTime() + VENUE_FIELD_RETRY_MS);
		await keepVenueFields({
			mlb,
			venueFields,
		}, [3309, 4169], later);
		expect(fetchVenueField.mock.calls).toEqual([[3309], [4169], [3309]]);
		expect((await venueFields.get(3309))?.fetchedAt).toBe(later.toISOString());
		// Venue ids that aren't MLB ids are never asked.
		await keepVenueFields({
			mlb,
			venueFields,
		}, [0, -1, 1.5, Number.NaN], later);
		expect(fetchVenueField).toHaveBeenCalledTimes(3);
	});
});

describe("sanitizeFieldSvg (S105 AC 3)", () =>
{
	it("S105 AC 3: the 4169 and 3313 recordings come through intact, byte for byte", () =>
	{
		for (const venueId of [4169, 3313])
		{
			const svg = recording(venueId);
			expect(sanitizeFieldSvg(svg)).toBe(svg);
		}
	});

	it("S105 AC 3: a hostile drawing loses every script, handler, outside link and foreign object, and keeps its outline", () =>
	{
		const hostile = `<?xml version="1.0"?>
<?xml-stylesheet href="https://evil.example/a.css"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 250 250" onload="alert(1)" ONCLICK="alert(2)">
<script>alert('field')</script>
<SCRIPT>alert(3)</SCRIPT>
<script><![CDATA[ alert(4) ]]></script>
<style>.a{fill:url(#grad)}</style>
<style>@import url("https://evil.example/b.css");</style>
<style>.b{background:u\\72l(https://evil.example/c.png)}</style>
<style>@&#105;mport "https://evil.example/d.css";</style>
<defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
<g id="field" onmouseover="alert(5)">
<path id="grass" class="a" d="M125,214.2l-83.5-102z" fill="url(#grad)"/>
<path id="dirt" d="M1,1z" fill="url(https://evil.example/e.svg#x)" style="fill:url(https://evil.example/f)"/>
<use href="#grass"/>
<use xlink:href="#dirt"/>
<use href="https://evil.example/g.svg#x"/>
<use xlink:href="javascript:alert(6)"/>
<use href="&#x6A;avascript:alert(7)"/>
<a xlink:href="javascript:alert(8)"><text>click</text></a>
<image href="https://evil.example/h.png" width="10" height="10"/>
<foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><svg><script>alert(9)</script></svg></div></foreignObject>
<animate attributeName="href" to="javascript:alert(10)"/>
<set attributeName="onclick" to="alert(11)"/>
<rect x="1" y="2" width="3" height="4" xml:base="https://evil.example/"/>
<text x="1" y="2" fill="javascript:alert(12)">CF 400</text>
</g>
</svg>`;
		const clean = sanitizeFieldSvg(hostile);
		expect(clean).not.toBeNull();
		for (const banned of ["<script", "<SCRIPT", "alert", "on", "evil.example", "javascript", "foreignObject", "<a ", "<image", "<animate", "<set", "xml-stylesheet", "xml:base", "@import", "&#"])
		{
			expect(clean!.includes(banned) && !(banned === "on" && !/\son[a-z]*=/i.test(clean!)), banned).toBe(false);
		}
		expect(clean).not.toMatch(/\son[a-z]*=/i);
		// The outline stands: its elements, local fragment links and local gradient survive, attributes as written.
		expect(clean).toContain("<?xml version=\"1.0\"?>");
		expect(clean).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 250 250\">");
		expect(clean).toContain("<style>.a{fill:url(#grad)}</style>");
		expect(clean).toContain("<path id=\"grass\" class=\"a\" d=\"M125,214.2l-83.5-102z\" fill=\"url(#grad)\"/>");
		expect(clean).toContain("<path id=\"dirt\" d=\"M1,1z\"/>");
		expect(clean).toContain("<use href=\"#grass\"/>");
		expect(clean).toContain("<use xlink:href=\"#dirt\"/>");
		expect(clean).toContain("<g id=\"field\">");
		expect(clean).toContain("<rect x=\"1\" y=\"2\" width=\"3\" height=\"4\"/>");
		expect(clean).toContain("<text x=\"1\" y=\"2\">CF 400</text>");
		expect(clean).toContain("<stop offset=\"0\" stop-color=\"#fff\"/>");
		// Cleaning is stable: a cleaned drawing comes through unchanged.
		expect(sanitizeFieldSvg(clean!)).toBe(clean);
	});

	it("S105 AC 3: what can't be read safely is refused whole: a DOCTYPE, malformed markup, no <svg>, or an oversized document", () =>
	{
		const ok = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0,0\"/></svg>";
		expect(sanitizeFieldSvg(ok)).toBe(ok);
		expect(sanitizeFieldSvg(`<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>${ok}`)).toBeNull();
		expect(sanitizeFieldSvg("<svg><g></svg>")).toBeNull();
		// A closing tag inside a script is markup to XML, so the script can't hide one: refused as mismatched.
		expect(sanitizeFieldSvg("<svg><script>alert(\"</svg>\")</script></svg>")).toBeNull();
		expect(sanitizeFieldSvg("<svg><g>")).toBeNull();
		expect(sanitizeFieldSvg("<svg><path d=M0/></svg>")).toBeNull();
		expect(sanitizeFieldSvg("<svg><path d=\"M0/></svg>")).toBeNull();
		expect(sanitizeFieldSvg("<svg>1 < 2</svg>")).toBeNull();
		expect(sanitizeFieldSvg("<svg><!-- open")).toBeNull();
		expect(sanitizeFieldSvg("<svg><![CDATA[ open")).toBeNull();
		expect(sanitizeFieldSvg("<svg><?pi open")).toBeNull();
		expect(sanitizeFieldSvg("<svg></svg")).toBeNull();
		expect(sanitizeFieldSvg("<svg><path d=\"M0\"x=\"1\"/></svg>")).toBeNull();
		expect(sanitizeFieldSvg("<html><body>Error</body></html>")).toBeNull();
		expect(sanitizeFieldSvg("<foreignObject><svg></svg></foreignObject>")).toBeNull();
		expect(sanitizeFieldSvg(`<svg>${" ".repeat(VENUE_FIELD_MAX_LENGTH)}</svg>`)).toBeNull();
	});

	it("S105 AC 3: ingest keeps only the sanitized drawing, and none when the sanitizer refuses Savant's answer", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { mlb, venueFields } = setup(async (venueId) => venueId === 1
			? "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"><script>alert(2)</script><path d=\"M0\"/></svg>"
			: "<!DOCTYPE svg><svg/>");
		await keepVenueFields({
			mlb,
			venueFields,
		}, [1, 2], new Date("2026-11-27T00:00:00.000Z"));
		expect((await venueFields.get(1))?.svg).toBe("<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0\"/></svg>");
		expect((await venueFields.get(2))?.svg).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("venue field 2"));
	});
});

describe("an optional source (S105 AC 5)", () =>
{
	/** The stored game, its version stamp aside, as a read serves it. */
	const served = async (deps: IngestDeps, gamePk = 823823) =>
	{
		const {
			version: _v, lastChangedAt: _c, fetchedAt: _f, ...game
		} = (await getOrRefreshGame(deps, gamePk)) as GameSnapshot;
		return game;
	};

	it("S105 AC 5: a venue with no drawing, a failed or a hanging fetch keeps no drawing and leaves the game as it is without the source", async () =>
	{
		const without = setup();
		const { venueFields: _none, ...noSource } = without.deps;
		const expected = await served(noSource);
		for (const answer of [async () => null, async () => Promise.reject(new Error("Savant down"))])
		{
			const {
				deps, venueFields, fetchVenueField,
			} = setup(answer);
			expect(await served(deps)).toEqual(expected);
			expect(fetchVenueField).toHaveBeenCalledTimes(1);
			expect((await venueFields.get(4169))?.svg).toBeNull();
		}
		const { mlb, venueFields } = setup(() => new Promise<string | null>(() => undefined));
		await keepVenueFields({
			mlb,
			venueFields,
		}, [4169], new Date("2026-11-27T00:00:00.000Z"), 10);
		expect((await venueFields.get(4169))?.svg).toBeNull();
	});

	it("S105 AC 5: a drawing store that fails is logged and the game is still stored and served", async () =>
	{
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { deps } = setup();
		const broken: VenueFieldRepository = {
			get: async () => Promise.reject(new Error("venue_fields unavailable")),
			upsert: async (_field: VenueField) => Promise.reject(new Error("venue_fields unavailable")),
		};
		const stored = await ingestGame({
			...deps,
			venueFields: broken,
		}, await fetchedGame(6));
		expect(stored.snapshot.gamePk).toBe(6);
		expect(await deps.games.getByPk(6)).not.toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("venue field 4169: not kept: venue_fields unavailable"));
	});
});
