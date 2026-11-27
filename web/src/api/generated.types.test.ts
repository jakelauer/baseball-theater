import type {
	ApiRequestFor, ApiRoute, ApiRouteWithBody, GameSnapshotResponse, MeDeleteResponse, ProbablePitcher,
	MeDownloadFileResponse, MeDownloadResponse, MeResponse, ScheduleDayResponse, ScheduleMonthResponse, ScheduleMonthVersionsResponse, SettingsResponse,
	TierOverrideResponse, TierOverrideSetResponse,
	DayDigestResponse, StandingsResponse,
	PlayerProfilesResponse, ReleasesResponse, ScoreboardDefaultDateResponse, SearchHighlightsResponse, SignInConfigResponse, SignInResponse, StandingsPhaseAnswer, StandingsPhases,
} from "@bt/domain";
import {
	describe, expect, it,
} from "vitest";
import type { components, paths } from "./generated/bt-api.v1.js";

/**
 * The spec-fidelity gate (S29, ADR-016). S27's `oasdiff` gate only compares the
 * spec with its own previous self; this compares it with reality. For every route
 * in the S26 table, the type generated from `openapi/bt-api.v1.json` and the
 * route's `<DomainType>Response` alias — the type actually on the wire — must be
 * mutually assignable. A field the emitter drops, a nullability it loses, a union
 * it widens: each breaks one direction, and `tsc` (in `pnpm build`) fails.
 *
 * Compared against the alias, never the bare domain type, so the ADR-014 DTO
 * adapter stays free to diverge from `GameSnapshot` / `ScheduleDay` later.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Json200<P extends keyof paths, M extends "get" | "post" | "put" = "get"> = NonNullable<paths[P][M]>["responses"][200]["content"]["application/json"];

/** A route's generated JSON request body (S77: request bodies come from `ApiRequestBodies`). */
type JsonBody<P extends keyof paths, M extends "post" | "put"> = NonNullable<NonNullable<paths[P][M]>["requestBody"]>["content"]["application/json"];

/**
 * One entry per S26 route, keyed by the route literal: `satisfies Record<ApiRoute, true>`
 * fails when a route is added without a fidelity pairing, and each value only
 * type-checks as `true` when the pairing round-trips losslessly.
 */
const fidelity = {
	"GET /api/v1/games/:gamePk": true as MutuallyAssignable<Json200<"/api/v1/games/{gamePk}">, GameSnapshotResponse>,
	"GET /api/v1/schedule": true as MutuallyAssignable<Json200<"/api/v1/schedule">, ScheduleDayResponse>,
	"GET /api/v1/schedule/month/:month": true as MutuallyAssignable<Json200<"/api/v1/schedule/month/{month}">, ScheduleMonthResponse>,
	"GET /api/v1/schedule/month-versions/:year": true as MutuallyAssignable<Json200<"/api/v1/schedule/month-versions/{year}">, ScheduleMonthVersionsResponse>,
	"GET /api/v1/digest": true as MutuallyAssignable<Json200<"/api/v1/digest">, DayDigestResponse>,
	"GET /api/v1/search/highlights": true as MutuallyAssignable<Json200<"/api/v1/search/highlights">, SearchHighlightsResponse>,
	"GET /api/v1/standings": true as MutuallyAssignable<Json200<"/api/v1/standings">, StandingsResponse>,
	"GET /api/v1/me": true as MutuallyAssignable<Json200<"/api/v1/me">, MeResponse>,
	"POST /api/v1/me/download": true as MutuallyAssignable<Json200<"/api/v1/me/download", "post">, MeDownloadResponse>,
	"GET /api/v1/scoreboard/default-date": true as MutuallyAssignable<Json200<"/api/v1/scoreboard/default-date">, ScoreboardDefaultDateResponse>,
	"GET /api/v1/me/download": true as MutuallyAssignable<Json200<"/api/v1/me/download">, MeDownloadResponse>,
	"GET /api/v1/me/download/:downloadId": true as MutuallyAssignable<Json200<"/api/v1/me/download/{downloadId}">, MeDownloadFileResponse>,
	"POST /api/v1/me/delete": true as MutuallyAssignable<Json200<"/api/v1/me/delete", "post">, MeDeleteResponse>,
	"GET /api/v1/me/settings": true as MutuallyAssignable<Json200<"/api/v1/me/settings">, SettingsResponse>,
	"PUT /api/v1/me/settings": true as MutuallyAssignable<Json200<"/api/v1/me/settings", "put">, SettingsResponse>,
	"GET /api/v1/me/tier-override": true as MutuallyAssignable<Json200<"/api/v1/me/tier-override">, TierOverrideResponse>,
	"PUT /api/v1/me/tier-override": true as MutuallyAssignable<Json200<"/api/v1/me/tier-override", "put">, TierOverrideSetResponse>,
	"GET /api/v1/sign-in": true as MutuallyAssignable<Json200<"/api/v1/sign-in">, SignInConfigResponse>,
	"POST /api/v1/sign-in": true as MutuallyAssignable<Json200<"/api/v1/sign-in", "post">, SignInResponse>,
	"GET /api/v1/releases": true as MutuallyAssignable<Json200<"/api/v1/releases">, ReleasesResponse>,
	"GET /api/v1/players/profiles": true as MutuallyAssignable<Json200<"/api/v1/players/profiles">, PlayerProfilesResponse>,
} satisfies Record<ApiRoute, true>;

/** Every route that takes a body, paired with its generated request type the same way. */
const requestFidelity = {
	"POST /api/v1/me/delete": true as MutuallyAssignable<JsonBody<"/api/v1/me/delete", "post">, ApiRequestFor<"POST /api/v1/me/delete">>,
	"PUT /api/v1/me/settings": true as MutuallyAssignable<JsonBody<"/api/v1/me/settings", "put">, ApiRequestFor<"PUT /api/v1/me/settings">>,
	"POST /api/v1/sign-in": true as MutuallyAssignable<JsonBody<"/api/v1/sign-in", "post">, ApiRequestFor<"POST /api/v1/sign-in">>,
	"PUT /api/v1/me/tier-override": true as MutuallyAssignable<JsonBody<"/api/v1/me/tier-override", "put">, ApiRequestFor<"PUT /api/v1/me/tier-override">>,
} satisfies Record<ApiRouteWithBody, true>;

/** The other side of exhaustiveness: every path the spec publishes is one the table knows. */
/**
 * The types inside a response that callers name on their own (S139: the standings' season
 * phases; S171: a probable pitcher, whose optional `pitchHand` must stay optional and
 * nullable), each paired with its generated component the same way.
 */
const componentFidelity = {
	StandingsPhases: true as MutuallyAssignable<components["schemas"]["StandingsPhases"], StandingsPhases>,
	StandingsPhaseAnswer: true as MutuallyAssignable<components["schemas"]["StandingsPhaseAnswer"], StandingsPhaseAnswer>,
	ProbablePitcher: true as MutuallyAssignable<components["schemas"]["ProbablePitcher"], ProbablePitcher>,
} satisfies Record<string, true>;

type SpecPathsCovered = MutuallyAssignable<keyof paths, "/api/v1/games/{gamePk}" | "/api/v1/schedule" | "/api/v1/schedule/month/{month}" | "/api/v1/schedule/month-versions/{year}" | "/api/v1/digest" | "/api/v1/search/highlights" | "/api/v1/standings" | "/api/v1/scoreboard/default-date" | "/api/v1/me" | "/api/v1/me/download" | "/api/v1/me/download/{downloadId}" | "/api/v1/me/delete" | "/api/v1/me/settings" | "/api/v1/me/tier-override" | "/api/v1/sign-in" | "/api/v1/releases" | "/api/v1/players/profiles">;
const specPathsCovered: SpecPathsCovered = true;

/**
 * Teeth: a deliberately wrong pairing must fail. `@ts-expect-error` itself errors
 * when the line below it compiles, so a generated type that had collapsed into
 * something `any`-ish (assignable to everything) would fail the build here.
 */
// @ts-expect-error — the game route's generated type is not a ScheduleDayResponse.
const wrongPairing: MutuallyAssignable<Json200<"/api/v1/games/{gamePk}">, ScheduleDayResponse> = true;

describe("generated response types — spec fidelity", () =>
{
	it("pairs every S26 route with its generated type (checked by tsc)", () =>
	{
		expect(Object.keys(fidelity).sort()).toEqual(["GET /api/v1/digest", "GET /api/v1/games/:gamePk", "GET /api/v1/me", "GET /api/v1/me/download", "GET /api/v1/me/download/:downloadId", "GET /api/v1/me/settings", "GET /api/v1/me/tier-override", "GET /api/v1/players/profiles", "GET /api/v1/releases", "GET /api/v1/schedule", "GET /api/v1/schedule/month-versions/:year", "GET /api/v1/schedule/month/:month", "GET /api/v1/scoreboard/default-date", "GET /api/v1/search/highlights", "GET /api/v1/sign-in", "GET /api/v1/standings", "POST /api/v1/me/delete", "POST /api/v1/me/download", "POST /api/v1/sign-in", "PUT /api/v1/me/settings", "PUT /api/v1/me/tier-override"]);
		expect(Object.keys(requestFidelity)).toEqual(["POST /api/v1/me/delete", "PUT /api/v1/me/settings", "POST /api/v1/sign-in", "PUT /api/v1/me/tier-override"]);
		expect([specPathsCovered, wrongPairing]).toEqual([true, true]);
		expect(Object.keys(componentFidelity)).toEqual(["StandingsPhases", "StandingsPhaseAnswer", "ProbablePitcher"]);
	});
});
