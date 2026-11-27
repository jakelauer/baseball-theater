import { execFileSync } from "node:child_process";
import {
	mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	ApiRoutes, CLIP_SHOWN_POSITION_MAX, CLIP_VIEW_GAME_PK_MAX,
} from "@bt/domain";
import {
	afterAll, describe, expect, it,
} from "vitest";
import {
	buildOpenApiSpec, COMMITTED_SPEC, generateOpenApiSpec, ROUTE_DESCRIPTIONS, toOpenApiPath,
} from "./openapi.js";

// Test-only traversal of a parsed JSON document, whose shape the assertions themselves check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

interface GateResult
{
	status: number;
	output: string;
}

/** What `execFileSync` throws when the command exits nonzero. */
interface ExecFailure
{
	status: number;
	stdout: string;
}

const generated = await generateOpenApiSpec();
const spec = JSON.parse(generated) as Json;
const baseline = fileURLToPath(new URL("../../../openapi/bt-api.v1.baseline.json", import.meta.url));

describe("toOpenApiPath", () =>
{
	it("turns :params into {params}", () =>
	{
		expect(toOpenApiPath("/api/v1/games/:gamePk")).toBe("/api/v1/games/{gamePk}");
		expect(toOpenApiPath("/api/v1/schedule")).toBe("/api/v1/schedule");
	});
});

describe("generateOpenApiSpec", () =>
{
	it("is the committed spec (regenerate with pnpm api:spec)", () =>
	{
		expect(generated).toBe(readFileSync(COMMITTED_SPEC, "utf8"));
	});

	it("has one operation per route, each with a described error response", () =>
	{
		const routes = Object.keys(ApiRoutes);
		const operations = Object.values(spec.paths as Json).flatMap((item) => Object.keys(item));
		expect(operations).toHaveLength(routes.length);
		expect(Object.keys(ROUTE_DESCRIPTIONS).sort()).toEqual([...routes].sort());
	});

	it("refs each route's response alias, which resolves to the generated domain schema", () =>
	{
		const schemas = spec.components.schemas as Json;
		const game = spec.paths["/api/v1/games/{gamePk}"].get;
		expect(game.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/GameSnapshotResponse");
		expect(schemas.GameSnapshotResponse).toEqual({
			$ref: "#/components/schemas/GameSnapshot",
		});
		expect(schemas.GameSnapshot.properties).toHaveProperty("fetchedAt");
		expect(schemas.GameSnapshot.properties).toHaveProperty("windowMode");
		expect(spec.paths["/api/v1/schedule"].get.responses["200"].content["application/json"].schema.$ref).toBe("#/components/schemas/ScheduleDayResponse");
	});

	it("S174 AC 4: gives the clip-view route a 204 with no body and no 200, its request body, and no schema for the empty response", () =>
	{
		const post = spec.paths["/api/v1/clips/{mediaId}/views"].post;
		expect(Object.keys(post.responses).sort()).toEqual(["204", "400", "403", "404", "426"]);
		expect(post.responses["204"]).toEqual({
			description: "No Content",
		});
		expect(post.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/ClipViewRequest");
		expect(spec.components.schemas.ClipViewRequest.required).toEqual(["gamePk", "event", "shownPosition"]);
		expect(spec.components.schemas).not.toHaveProperty("NoContentResponse");
	});

	it("S174 AC 4: states ClipViewRequest as parseClipViewRequest takes it: whole numbers in its bounds and no other keys", () =>
	{
		const schema = spec.components.schemas.ClipViewRequest;
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.gamePk).toMatchObject({
			type: "integer",
			minimum: 1,
			maximum: CLIP_VIEW_GAME_PK_MAX,
		});
		expect(schema.properties.shownPosition).toMatchObject({
			type: "integer",
			minimum: 0,
			maximum: CLIP_SHOWN_POSITION_MAX,
		});
	});

	it("declares the handler's error responses with ApiErrorResponse bodies", () =>
	{
		const errorRef = {
			$ref: "#/components/schemas/ApiErrorResponse",
		};
		expect(spec.paths["/api/v1/schedule"].get.responses["400"].content["application/json"].schema).toEqual(errorRef);
		expect(spec.paths["/api/v1/games/{gamePk}"].get.responses["404"].content["application/json"].schema).toEqual(errorRef);
		expect(spec.components.schemas.ApiErrorResponse).toMatchObject({
			properties: {
				error: {
					type: "string",
				},
				hint: {
					type: "string",
				},
			},
			required: ["error"],
		});
	});

	it("is stable: building twice from the same schemas gives identical output", () =>
	{
		const schemas = spec.components.schemas as Json;
		expect(JSON.stringify(buildOpenApiSpec(schemas))).toBe(JSON.stringify(buildOpenApiSpec({
			...schemas,
		})));
	});
});

describe("oasdiff breaking gate", () =>
{
	const dir = mkdtempSync(path.join(tmpdir(), "bt-openapi-test-"));
	afterAll(() => rmSync(dir, {
		recursive: true,
		force: true,
	}));

	function breaking(revision: Json): GateResult
	{
		const file = path.join(dir, `rev-${Math.random().toString(36).slice(2)}.json`);
		writeFileSync(file, JSON.stringify(revision));
		try
		{
			const output = execFileSync("oasdiff", ["breaking", baseline, file, "--fail-on", "ERR"], {
				encoding: "utf8",
				stdio: "pipe",
			});
			return {
				status: 0,
				output,
			};
		}
		catch (error)
		{
			const e = error as ExecFailure;
			return {
				status: e.status,
				output: e.stdout,
			};
		}
	}

	it("passes the unmodified spec", () =>
	{
		expect(breaking(spec).status).toBe(0);
	});

	it("passes an additive change (a new optional response field)", () =>
	{
		const added = structuredClone(spec);
		added.components.schemas.GameSnapshot.properties.newOptionalField = {
			type: "string",
		};
		expect(breaking(added).status).toBe(0);
	});

	it("fails a removed response field, naming the change", () =>
	{
		const removed = structuredClone(spec);
		const game = removed.components.schemas.GameSnapshot;
		delete game.properties.fetchedAt;
		game.required = game.required.filter((name: string) => name !== "fetchedAt");
		const result = breaking(removed);
		expect(result.status).not.toBe(0);
		expect(result.output).toContain("removed the required property `fetchedAt` from the response");
	});
}, 30_000);

/**
 * A small JSON Schema check, enough for the generated standings schemas (S160): `$ref`, `type` (one or a
 * list), `enum`, `properties` with `required` and `additionalProperties: false`, `items` and `anyOf`.
 * The functions package has no JSON Schema validator, and this test needs only these keywords.
 */
function conforms(value: unknown, schema: Json, schemas: Json): boolean
{
	if (schema.$ref !== undefined) return conforms(value, schemas[String(schema.$ref).split("/").pop()!], schemas);
	if (schema.anyOf !== undefined) return (schema.anyOf as Json[]).some((s) => conforms(value, s, schemas));
	if (schema.enum !== undefined && !(schema.enum as unknown[]).includes(value)) return false;
	if (schema.type !== undefined)
	{
		const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
		const types = ([] as string[]).concat(schema.type);
		if (!types.some((t) => t === kind || (t === "integer" && Number.isInteger(value)))) return false;
	}
	if (Array.isArray(value) && schema.items !== undefined) return value.every((item) => conforms(item, schema.items, schemas));
	if (value !== null && typeof value === "object" && !Array.isArray(value) && schema.properties !== undefined)
	{
		const record = value as Record<string, unknown>;
		if (!((schema.required ?? []) as string[]).every((key) => key in record)) return false;
		for (const [key, field] of Object.entries(record))
		{
			const property = schema.properties[key];
			if (property === undefined)
			{
				if (schema.additionalProperties === false) return false;
				continue;
			}
			if (!conforms(field, property, schemas)) return false;
		}
	}
	return true;
}

describe("standings clinch letter on the wire (S160)", () =>
{
	const schemas = spec.components.schemas as Json;
	/** A team row as every answer cached before S160 served it: no clinchIndicator at all. */
	const beforeS160 = {
		teamId: 158,
		name: "Milwaukee Brewers",
		abbreviation: "MIL",
		wins: 97,
		losses: 65,
		pct: ".599",
		gamesBack: null,
		divisionRank: 1,
		streak: "W2",
		runsScored: 780,
		runsAllowed: 640,
		runDifferential: 140,
		divisionLeader: true,
		clinched: true,
		eliminationNumber: null,
	};

	it("S160 AC 2: a record without the field (an answer cached before S160) still parses through the generated schema, and reads as no letter", () =>
	{
		const division = {
			divisionId: 205,
			name: "National League Central",
			leagueId: 104,
			teams: [beforeS160],
		};
		expect(conforms(division, schemas.StandingsDivision, schemas)).toBe(true);
		expect(schemas.StandingsTeamRecord.required).not.toContain("clinchIndicator");
		const parsed = JSON.parse(JSON.stringify(beforeS160)) as { clinchIndicator?: string | null };
		expect(parsed.clinchIndicator ?? null).toBeNull();
	});

	it("S160 AC 2: a letter or null parses, anything else does not", () =>
	{
		const record = schemas.StandingsTeamRecord as Json;
		expect(conforms({
			...beforeS160,
			clinchIndicator: "z",
		}, record, schemas)).toBe(true);
		expect(conforms({
			...beforeS160,
			clinchIndicator: null,
		}, record, schemas)).toBe(true);
		expect(conforms({
			...beforeS160,
			clinchIndicator: 1,
		}, record, schemas)).toBe(false);
		const { clinched: _clinched, ...withoutClinched } = beforeS160;
		expect(conforms(withoutClinched, record, schemas)).toBe(false);
	});
});
