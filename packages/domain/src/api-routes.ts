/**
 * The typed BT API route contract (ADR-014 "the wire boundary").
 *
 * One runtime-enumerable table maps each route to its response type (and, in
 * `ApiRequestBodies`, the routes that take a body to its type). Both the
 * server's sender (`functions/src/handlers/api.ts`) and the client's fetch
 * helper (`web/src/api/client.ts`) consume this same declaration — a route and
 * its response cannot disagree without breaking a typecheck on one end or the
 * other.
 *
 * Response types are named `<DomainType>Response` aliases (ADR-014 "Response
 * aliases — the DTO seam"), not the bare domain type. Each alias is *derived*
 * (`type XResponse = X`) — structurally identical to its source today, so this
 * is not a second, hand-authored shape and does not reopen the "one type
 * source" drift risk. It plants a named seam: the day an internal-only reason
 * forces a domain field to change while the wire needs to stay stable, that
 * divergence lives in the matching `to<DomainType>Response` mapping function
 * (still a passthrough today), not in a rewrite of the route table.
 */
import type { DigestItem } from "./digest.js";
import type { SearchHighlight } from "./search.js";
import type { ReleaseNotes } from "./release-notes.js";
import type { ScheduleDayCount } from "./schedule-month.js";
import type { AccountSettings } from "./settings.js";
import type { StandingsChampion } from "./standings-phase.js";
import type {
	Entitlements, GameSnapshot, PatronTier, Role, ScheduleDay, StandingsSnapshot, UserProfile,
} from "./types.js";

export type ScheduleDayResponse = ScheduleDay;
export type GameSnapshotResponse = GameSnapshot;

/**
 * One season phase in a standings answer (S139): the first and last day the phase runs in the
 * season the answer is for, and its table when the request included the phase (`includePhases`).
 * The dates are always there, so a caller can choose which phases to ask for without their
 * tables. `startDate` and `endDate` are null only on `regularSeason` when the day has no season
 * calendar. `table` keeps S128's meaning of `phase`, `season` and `date` (for `playoffs`, those of
 * the regular-season table its teams come from).
 */
export type StandingsPhaseAnswer = {
	startDate: string | null;
	endDate: string | null;
	table?: StandingsSnapshot;
};

/** Every season phase's answer for the day, keyed by phase; null for a phase the day's season can't answer. */
export type StandingsPhases = {
	spring: StandingsPhaseAnswer | null;
	regularSeason: StandingsPhaseAnswer | null;
	playoffs: StandingsPhaseAnswer | null;
};

/**
 * The division standings for one day (S4, S128): MLB's tables projected to BT's shape — the
 * regular season's as of that day, the season's final table after it ends, spring training's
 * in the spring (see `phase`). S128's fields stay at the top unchanged (ADR-015: additive only),
 * so a client that doesn't know phases keeps its table; `phases` (S139) carries each season
 * phase's dates and, when asked for, its table. `champion` (S140) names the World Series winner
 * in the off-season, from the day it was won (`standingsChampion`), and is null otherwise; it
 * doesn't depend on `includePhases`.
 */
export type StandingsResponse = StandingsSnapshot & {
	phases: StandingsPhases;
	champion: StandingsChampion | null;
};

/**
 * Games per day for one month (S124) and the teams playing each day (S136), from BT's stored
 * schedule days, for S125's calendar date picker: one entry per day of the month, in order.
 */
export interface ScheduleMonthResponse {
	/** The month, `YYYY-MM`. */
	month: string;
	/**
	 * Every day of the month, first to last; `count` and `teamIds` are null for a day BT holds no
	 * schedule for.
	 */
	days: ScheduleDayCount[];
}

/**
 * The version of each complete month of one year (S194): the content hash of the whole month answer
 * as the month route sends it (`scheduleMonthAnswer`, `scheduleMonthVersion`), which the web passes
 * back as the month route's `?v=` so the edge may keep that exact answer long.
 */
export interface ScheduleMonthVersionsResponse {
	/** The year asked for. */
	year: number;
	/**
	 * Month (`YYYY-MM`) to its answer's version, for each month of the year whose stored answer is
	 * complete (every day known); a month left out is asked for without a version.
	 */
	versions: Record<string, string>;
}

/** The day the scoreboard opens on (S111): today in season, the last final in the off-season. */
export interface ScoreboardDefaultDateResponse {
	/** The day, `YYYY-MM-DD`. */
	date: string;
}

/** "Best of <date>" (S71): the day's top clips across its games, ranked by `dayDigest`. */
export interface DayDigestResponse {
	/** The day, `YYYY-MM-DD`. */
	date: string;
	/** Best first; empty on a day with no videos yet. */
	items: DigestItem[];
	/**
	 * `active` while the day or any of its games is in the live window, so the browser re-asks on
	 * the live cadence (`freshnessPolicy`, #61); `cache` once all of them are out of it.
	 */
	windowMode: "active" | "cache";
}

/**
 * Highlight search (S5; ADR-029): MLB's free-text search for `q`, as BT asks it per query, newest
 * first. `total` is how many clips MLB matched in all; `highlights` is the first page of them.
 */
export interface SearchHighlightsResponse {
	/** The words as the fan typed them, trimmed. */
	query: string;
	/** MLB's count of every clip it matched; `highlights` is the first page of them, so it may hold fewer. */
	total: number;
	highlights: SearchHighlight[];
}

/**
 * The signed-in account, for Settings' "Signed in as {email}" (standings-search-settings
 * A3) and for gating UI by entitlement. A projection of `UserProfile`, not the
 * whole record: Patreon IDs and timestamps stay server-side.
 */
export interface MeResponse {
	uid: string;
	/** Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82). */
	email: string;
	role: Role;
	entitlements: Entitlements;
}

/**
 * A stored data download (ADR-028, owner 2026-10-27): its id and when it ages
 * out. Requesting one answers with this, never the data; the file itself is
 * fetched by its id, signed in, while it lasts.
 */
export interface MeDownloadResponse {
	id: string;
	/** ISO time the download stops being fetchable (14 days after it was made; `downloadExpiresAt`). */
	expiresAt: string;
}

/** A download's file: every registered personal data store's export at the time it was made. */
export interface MeDownloadFileResponse extends MeDownloadResponse {
	/** Store name (ADR-028's inventory **Where**) → that store's export; null when it held nothing. */
	stores: Record<string, unknown>;
}

/**
 * The body of an account deletion: the phrase the user typed, which must equal
 * {@link ACCOUNT_DELETION_PHRASE} exactly. Deleting needs no download first
 * (owner, 2026-10-27: "Deleting and downloading aren't connected").
 */
export interface MeDeleteRequest {
	phrase: string;
}

/** A finished deletion. The session that asked no longer resolves to an account. */
export interface MeDeleteResponse {
	deleted: true;
}

/**
 * What a user types to confirm deleting their account (ADR-028: "maximal
 * verification including typing a phrase"). One constant, so S79's
 * confirmation field compares against the same text the server checks.
 */
export const ACCOUNT_DELETION_PHRASE = "delete my account";

/** The signed-in user's settings document (ADR-027); the house defaults until they first save. */
export type SettingsResponse = AccountSettings;

/**
 * A settings write: the whole document with a bumped `version`; an older version is
 * ignored (ADR-022). `gameRowSlot` (S67), `collapseNonFavorites` and `hideScores` (S68), `videoPlayer` (S70)
 * may be left out — each reads as its default — so a page loaded before they shipped can still save.
 */
export type SettingsRequest = Omit<AccountSettings, OptionalSettings> & Partial<Pick<AccountSettings, OptionalSettings>>;

/** Settings added after launch of the document, which a write may leave out (S67, S68, S70). */
type OptionalSettings = "gameRowSlot" | "collapseNonFavorites" | "hideScores" | "videoPlayer";

/** The one error-body shape every 4xx path returns. */
export interface ApiErrorResponse {
	error: string;
	hint?: string;
	/** On a 429 download refusal: the ISO time the next download may be requested (`nextDownloadAllowedAt`). */
	nextAllowedAt?: string;
}

/** Passthrough today — see the module doc for why this indirection exists. */
export function toScheduleDayResponse(day: ScheduleDay): ScheduleDayResponse
{
	return day;
}

/** Passthrough today — see the module doc for why this indirection exists. */
export function toGameSnapshotResponse(game: GameSnapshot): GameSnapshotResponse
{
	return game;
}

/** Picks the wire fields from a stored user; everything else on `UserProfile` stays server-side. */
export function toMeResponse(user: UserProfile): MeResponse
{
	return {
		uid: user.uid,
		email: user.email,
		role: user.role,
		entitlements: user.entitlements,
	};
}

/**
 * How this deployment signs fans in (S116, S143; ADR-019). `logto` is its Logto tenant's address
 * and the web app's ID, read from the Worker's `vars` (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`) so the web
 * app keeps no second copy; null where the Worker offers no Logto sign-in. `mock` is true only
 * where the Worker signs in with the shared test account instead (staging, `BT_MOCK_SIGN_IN`). Where
 * both say no, the deployment offers no sign-in at all: previews, and local dev, which signs in as
 * `dev:` without asking.
 */
export interface SignInConfigResponse {
	logto: {
		/** The tenant's address, e.g. `https://auth.baseball.theater`. */
		endpoint: string;
		/** The single-page app's ID, the ID token's audience. */
		appId: string;
	} | null;
	/** Whether `POST /api/v1/sign-in` takes {@link MOCK_SIGN_IN_CREDENTIAL} for the shared test account (staging only, S143). */
	mock: boolean;
}

/**
 * The one credential the mock sign-in accepts (S143): sent as `idToken` to `POST /api/v1/sign-in`
 * where `GET /api/v1/sign-in` answers `mock: true`, it signs in as staging's one shared test account.
 * Not a secret: it means nothing where the mock isn't wired (production and previews refuse it, as
 * any token Logto can't verify), and staging holds no fan's data. Not a `dev:` token, which only
 * local dev accepts.
 */
export const MOCK_SIGN_IN_CREDENTIAL = "bt-mock-sign-in";

/**
 * A sign-in hand-off, sent once: the ID token Logto's hosted sign-in gave the web app, or, where
 * `GET /api/v1/sign-in` answers `mock: true` (staging, S143), `MOCK_SIGN_IN_CREDENTIAL`.
 */
export interface SignInRequest {
	idToken: string;
}

/** A finished sign-in: BT's own session token, which the web app sends as `Authorization: Bearer`. */
export interface SignInResponse {
	token: string;
}

/**
 * Staging's backer tier override (S215), for testing only: `tier` is the tier the signed-in tester
 * chose (null: their real tier stands) and `realTier` their stored one, which the override never
 * changes and which only a Patreon link writes. Answered only where the server's deploy-time config
 * allows the override (staging); production's config answers 404, so the route does not exist there.
 */
export interface TierOverrideResponse {
	tier: PatronTier | null;
	realTier: PatronTier;
}

/** A tier override saved (S215): the same answer plus a new session token, whose entitlements are the chosen tier's. */
export interface TierOverrideSetResponse extends TierOverrideResponse {
	token: string;
}

/** The tier to test as (S215): a tier (`"none"` is "not a patron"), or null for "use my real Patreon tier". */
export interface TierOverrideRequest {
	tier: PatronTier | null;
}

/**
 * One release's notes as the public releases API serves them: `ReleaseNotes` without `approval`,
 * the owner's dated, quoted approval, which only `pnpm release:check` and the production deploy's
 * "Release notes approved" step read (#327; owner, 2026-11-22, asked "Should the public releases API
 * include your approval words for each release?": chose "Leave it out").
 */
export type PublicReleaseNotes = Omit<ReleaseNotes, "approval">;

/**
 * Every approved release's fan-facing notes (S132), for the change log page (S134). Read from the
 * notes bundled into this build (`pnpm release:bundle`), never from MLB or the database.
 */
export interface ReleasesResponse {
	/**
	 * The newest approved release in this build's notes (`currentRelease`, S131); null before any
	 * release has approved notes. On staging it can trail the version line, which names the pull
	 * request's milestone, a release not yet published.
	 */
	current: PublicReleaseNotes | null;
	/** Every approved release's notes, newest first (`approvedReleasesNewestFirst`); a draft never appears. */
	releases: PublicReleaseNotes[];
}

/** Registry a route's response-type name is checked against — no unenforced string keys. */
export interface ApiResponseTypes {
	ScheduleDayResponse: ScheduleDayResponse;
	ScheduleMonthResponse: ScheduleMonthResponse;
	ScheduleMonthVersionsResponse: ScheduleMonthVersionsResponse;
	GameSnapshotResponse: GameSnapshotResponse;
	DayDigestResponse: DayDigestResponse;
	SearchHighlightsResponse: SearchHighlightsResponse;
	StandingsResponse: StandingsResponse;
	ScoreboardDefaultDateResponse: ScoreboardDefaultDateResponse;
	MeResponse: MeResponse;
	MeDownloadResponse: MeDownloadResponse;
	MeDownloadFileResponse: MeDownloadFileResponse;
	MeDeleteResponse: MeDeleteResponse;
	SettingsResponse: SettingsResponse;
	SignInConfigResponse: SignInConfigResponse;
	SignInResponse: SignInResponse;
	ReleasesResponse: ReleasesResponse;
	TierOverrideResponse: TierOverrideResponse;
	TierOverrideSetResponse: TierOverrideSetResponse;
	ApiErrorResponse: ApiErrorResponse;
}

/**
 * `"<METHOD> <path>"` → the name of its response type in {@link ApiResponseTypes}.
 * A runtime value (not just a type), so S27 can walk it to generate a spec.
 * `satisfies` makes an unknown type-name key a compile error.
 */
export const ApiRoutes = {
	"GET /api/v1/schedule": "ScheduleDayResponse",
	"GET /api/v1/schedule/month/:month": "ScheduleMonthResponse",
	"GET /api/v1/schedule/month-versions/:year": "ScheduleMonthVersionsResponse",
	"GET /api/v1/games/:gamePk": "GameSnapshotResponse",
	"GET /api/v1/digest": "DayDigestResponse",
	"GET /api/v1/search/highlights": "SearchHighlightsResponse",
	"GET /api/v1/standings": "StandingsResponse",
	"GET /api/v1/scoreboard/default-date": "ScoreboardDefaultDateResponse",
	"GET /api/v1/me": "MeResponse",
	"POST /api/v1/me/download": "MeDownloadResponse",
	"GET /api/v1/me/download": "MeDownloadResponse",
	"GET /api/v1/me/download/:downloadId": "MeDownloadFileResponse",
	"POST /api/v1/me/delete": "MeDeleteResponse",
	"GET /api/v1/me/settings": "SettingsResponse",
	"PUT /api/v1/me/settings": "SettingsResponse",
	"GET /api/v1/me/tier-override": "TierOverrideResponse",
	"PUT /api/v1/me/tier-override": "TierOverrideSetResponse",
	"GET /api/v1/sign-in": "SignInConfigResponse",
	"POST /api/v1/sign-in": "SignInResponse",
	"GET /api/v1/releases": "ReleasesResponse",
} as const satisfies Record<string, keyof ApiResponseTypes>;

export type ApiRoute = keyof typeof ApiRoutes;

/** The response type a given route resolves to, via the registry above. */
export type ApiResponseFor<R extends ApiRoute> = ApiResponseTypes[(typeof ApiRoutes)[R]];

/** Registry a route's request-body type name is checked against, like {@link ApiResponseTypes}. */
export interface ApiRequestTypes {
	MeDeleteRequest: MeDeleteRequest;
	SettingsRequest: SettingsRequest;
	SignInRequest: SignInRequest;
	TierOverrideRequest: TierOverrideRequest;
}

/**
 * The routes that take a JSON request body → its type's name in
 * {@link ApiRequestTypes} (S77; S6's settings write reuses it). A runtime value
 * so the spec generator can emit each `requestBody`; a route absent here takes none.
 */
export const ApiRequestBodies = {
	"POST /api/v1/me/delete": "MeDeleteRequest",
	"PUT /api/v1/me/settings": "SettingsRequest",
	"POST /api/v1/sign-in": "SignInRequest",
	"PUT /api/v1/me/tier-override": "TierOverrideRequest",
} as const satisfies Partial<Record<ApiRoute, keyof ApiRequestTypes>>;

export type ApiRouteWithBody = keyof typeof ApiRequestBodies;

/** The request-body type a route takes, via the registry above. */
export type ApiRequestFor<R extends ApiRouteWithBody> = ApiRequestTypes[(typeof ApiRequestBodies)[R]];
