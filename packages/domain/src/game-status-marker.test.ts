/**
 * S170 AC 1: `gameStatusMarker` over every status MLB lists (`GET /api/v1/gameStatus`, recorded in
 * `fixtures/raw/gamestatus.json`), each code's marker and reason as game-shell A7's Codes decision sorts it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { gameStatusMarker } from "./game-status-marker.js";
import type { GameStatusMarker } from "./game-status-marker.js";

interface StatusRow
{
	codedGameState: string;
	detailedState: string;
	statusCode: string;
	reason?: string;
}

const ROWS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/raw/gamestatus.json"), "utf8")) as StatusRow[];
const row = (statusCode: string) => ROWS.find((r) => r.statusCode === statusCode)!;

/** The marker A7 gives each status code, by its letter and detailed state. */
function expected(r: StatusRow): GameStatusMarker | null
{
	const reason = r.detailedState.includes(":") ? r.detailedState.split(":")[1]!.trim() : undefined;
	const withReason = (kind: GameStatusMarker["kind"]): GameStatusMarker => (reason ? {
		kind,
		reason,
	} : {
		kind,
	});
	switch (r.codedGameState)
	{
		case "I": return r.detailedState.startsWith("Delayed") ? withReason("delayed") : {
			kind: "live",
		};
		case "M":
		case "N": return {
			kind: "live",
		};
		case "P": return r.detailedState.startsWith("Delayed Start") ? withReason("delayedStart") : null;
		case "T":
		case "U": return withReason("suspended");
		default: return null;
	}
}

describe("gameStatusMarker (S170)", () =>
{
	it("S170 AC 1: the recording lists every letter A7 sorts", () =>
	{
		expect(ROWS.length).toBeGreaterThan(100);
		for (const letter of ["I", "M", "N", "P", "T", "U", "F", "S", "D"])
		{
			expect(ROWS.some((r) => r.codedGameState === letter)).toBe(true);
		}
	});

	for (const r of ROWS)
	{
		it(`S170 AC 1: ${r.statusCode} "${r.detailedState}"`, () =>
		{
			expect(gameStatusMarker(r)).toEqual(expected(r));
		});
	}

	const named: [string, GameStatusMarker | null][] = [
		["IR", {
			kind: "delayed",
			reason: "Rain",
		}],
		["IO", {
			kind: "delayed",
		}],
		["IZ", {
			kind: "delayed",
			reason: "About to Resume",
		}],
		["PR", {
			kind: "delayedStart",
			reason: "Rain",
		}],
		["PO", {
			kind: "delayedStart",
		}],
		["PW", null],
		["P", null],
		["TR", {
			kind: "suspended",
			reason: "Rain",
		}],
		["UR", {
			kind: "suspended",
			reason: "Rain",
		}],
		["TU", {
			kind: "suspended",
			reason: "Appeal Upheld",
		}],
		["T9", {
			kind: "suspended",
			reason: "COVID-19",
		}],
		["IH", {
			kind: "live",
		}],
		["MA", {
			kind: "live",
		}],
		["NA", {
			kind: "live",
		}],
		["F", null],
	];
	for (const [code, marker] of named)
	{
		it(`S170 AC 1: ${code} as the story lists it`, () =>
		{
			expect(gameStatusMarker(row(code))).toEqual(marker);
		});
	}

	it("S170 AC 1: a live marker never carries a reason, even with a colon or MLB's reason field", () =>
	{
		for (const code of ["IH", "MA", "NA", "I"])
		{
			const r = row(code);
			expect(gameStatusMarker(r)).toEqual({
				kind: "live",
			});
		}
		expect(row("IH").reason).toBe("Review");
	});

	it("S170 AC 1: an unknown or empty status gets none", () =>
	{
		expect(gameStatusMarker({
			codedGameState: "",
			detailedState: "",
		})).toBeNull();
		expect(gameStatusMarker({
			codedGameState: "Z",
			detailedState: "Delayed: Rain",
		})).toBeNull();
	});
});
