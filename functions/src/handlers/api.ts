import type {
	StatsProvider,
	ApiErrorResponse, ApiResponseFor, ApiRoute, ApiVersionTable, CacheLifetimeStep, MeDeleteRequest, PatronTier, ReleaseNotes, SeasonPhaseName, TierOverrideResponse, UserProfile,
} from "@bt/domain";
import type { SettingsRepository } from "@bt/ports";
import {
	API_VERSIONS, DEFAULT_SETTINGS, entitlementsForTier, playerProfileUrl, SEARCH_QUERY_MAX_LENGTH, STATS_PROVIDERS,
	SEASON_PHASES, STANDINGS_CACHE_LIFETIME_LADDER, apiVersionOf, deprecationHeaders, isCalendarDate,
	isCalendarMonth, isPastFinishedGame, latestScheduleMonth, scheduleMonthAnswer, scheduleMonthVersion,
	isPatronTier, mlbDayEndsAt, mlbToday, parseAccountSettings, parseSearchFilters, seasonSettling, toGameSnapshotResponse, toMeResponse, toScheduleDayResponse,
} from "@bt/domain";
import type { AccountDataDeps } from "../services/account-deletion.js";
import { deleteAccount } from "../services/account-deletion.js";
import type { AuthDeps } from "../services/accounts.js";
import {
	accountEntitlements, authenticateAccount, completeProviderSignIn, CredentialRefusedError, issueSession,
} from "../services/accounts.js";
import {
	clearDeletedCookie, hasDeletedCookie, setDeletedCookie,
} from "../services/cookies.js";
import {
	currentDownload, downloadFile, requestDownload,
} from "../services/data-downloads.js";
import type { ApiUsageLog } from "../services/api-usage.js";
import type { DigestEdgeLifetime } from "../services/digest.js";
import { getDayDigest } from "../services/digest.js";
import { REFRESH_COOLDOWN_MS } from "../services/refresh.js";
import { getScheduleMonth, getScheduleMonthVersions } from "../services/schedule-month.js";
import { searchHighlights } from "../services/search.js";
import { BUNDLED_RELEASE_NOTES, getReleases } from "../services/releases.js";
import { getDefaultScoreboardDate } from "../services/scoreboard-date.js";
import type { StandingsRead } from "../services/standings.js";
import { getStandings, standingsNothingYet } from "../services/standings.js";
import type { IngestDeps } from "../services/ingest.js";
import { getOrRefreshGame, getScheduleRead } from "../services/ingest.js";
import {
	edgeCacheControl, PARTIAL_PAST_DIGEST_CACHE_CONTROL, PAST_CACHE_CONTROL, PLAYER_PROFILES_CHECKED_CACHE_CONTROL, PLAYER_PROFILES_PENDING_CACHE_CONTROL,
	RELEASES_CACHE_CONTROL, SCHEDULE_MONTH_VERSIONS_CACHE_CONTROL, versionedMonthCacheControl,
} from "./cache-control.js";
import { liveDayUpgrade, liveUpgrade } from "./live.js";

export type ApiContext = {
	ingest: IngestDeps;
	auth: AuthDeps;
	/** Each account's settings document (ADR-027, S6). */
	settings: SettingsRepository;
	/** Personal data downloads and deletion (ADR-028, S77, S80). */
	account: AccountDataDeps;
	/**
	 * Hands a live-route WebSocket upgrade to the game's hub (S18; the Worker forwards it to
	 * the `game-hub` Durable Object). Absent where there are no hubs (the Node server).
	 */
	live?: (gamePk: number, request: Request) => Promise<Response>;
	/**
	 * Hands the scoreboard's live-route upgrade to the day's hub (S149; the Worker forwards it to the `day-hub`
	 * Durable Object). Absent where there are no hubs (the Node server).
	 */
	liveDay?: (date: string, request: Request) => Promise<Response>;
	/** Records each versioned request's version and route (S28); absent, nothing is recorded. */
	usage?: ApiUsageLog;
	/** The version lifecycle to enforce; `API_VERSIONS` unless a test supplies its own (S28). */
	versions?: ApiVersionTable;
	/** The release notes the releases route answers from (S132); the build's bundle unless a test supplies its own. */
	releases?: readonly ReleaseNotes[];
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

function json(status: number, body: unknown): Response
{
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...CORS_HEADERS,
		},
	});
}

/**
 * Builds a route's typed response. `_route` is not read at runtime — it
 * exists purely so `R` (and therefore `body`'s required type) is inferred
 * from the route-key argument at each call site. `body` is checked against
 * that route's entry in the ApiRoutes table (`@bt/domain`) — sending the
 * wrong shape for a known route fails the `functions` typecheck (S26 check 6
 * proves this).
 */
export function sendJson<R extends ApiRoute>(
	status: number,
	_route: R,
	body: ApiResponseFor<R>,
): Response
{
	return json(status, body);
}

function sendError(status: number, body: ApiErrorResponse): Response
{
	return json(status, body);
}

/**
 * Sets a schedule, schedule month, game or day digest response's edge-cache header (S47, ADR-021)
 * from the stored entity's window and last change, judged at ingest's clock. Two routes pass a
 * stand-in entity: the month route (S124) `windowMode: "cache"` and the month's last change, for a
 * complete month asked for without a version (a versioned month URL, S194, is judged by
 * `versionedMonthCacheControl` instead), and the digest route (#61) `digestFreshness`, live while
 * the day or any game is, last changed when the latest of them did. Past, finished data (S212) never comes here:
 * {@link withReadCacheControl} sends it `PAST_CACHE_CONTROL` (or a partial past digest's floor, or `no-store` forced).
 */
function withCacheControl(response: Response, entity: Parameters<typeof edgeCacheControl>[0], ctx: ApiContext, ladder?: readonly CacheLifetimeStep[]): Response
{
	response.headers.set("Cache-Control", edgeCacheControl(entity, ctx.ingest.now?.() ?? new Date(), ladder));
	return response;
}

/**
 * Sets the edge-cache header of a schedule day, game or digest read (S212), the one place a route chooses between the
 * past, finished lifetime and ADR-021's ladder: `ladder` goes to {@link withCacheControl}; `past` gets
 * `PAST_CACHE_CONTROL`, and `partialPast` (a past digest missing a game it couldn't read)
 * `PARTIAL_PAST_DIGEST_CACHE_CONTROL`. A forced read (`?refresh=1`) of past data gets `no-store` (S212 review): its
 * URL is its own cache key, which no purge names, so the long lifetime there would outlast any correction.
 */
function withReadCacheControl(response: Response, read: { lifetime: DigestEdgeLifetime;
	force?: boolean; }, entity: Parameters<typeof edgeCacheControl>[0], ctx: ApiContext): Response
{
	if (read.lifetime === "ladder") return withCacheControl(response, entity, ctx);
	response.headers.set("Cache-Control", read.force ? "no-store" : read.lifetime === "past" ? PAST_CACHE_CONTROL : PARTIAL_PAST_DIGEST_CACHE_CONTROL);
	return response;
}

/** An answer no cache may keep: a 400 or an upstream error. */
function noStore(response: Response): Response
{
	response.headers.set("Cache-Control", "no-store");
	return response;
}

/**
 * The standings route's `includePhases` (S139 AC 3): every value of the parameter, each split on
 * commas, so the comma form, the repeated form and the two mixed mean the same; the first API list
 * parameter, so this is the convention. Names match exactly; a name given twice counts once. No
 * parameter means every phase. Null when any name isn't a phase, is empty, or has spaces around it.
 */
export function parseIncludePhases(values: readonly string[]): SeasonPhaseName[] | null
{
	if (values.length === 0) return [...SEASON_PHASES];
	const names = values.flatMap((value) => value.split(","));
	if (!names.every((name) => (SEASON_PHASES as readonly string[]).includes(name))) return null;
	return SEASON_PHASES.filter((phase) => names.includes(phase));
}

/**
 * How the standings' edge cache judges an answer (S139 AC 8, ADR-021 with the standings' 30-day
 * cap): the stand-in entity and the ladder. `windowMode: "cache"` whatever the tables say (the HTTP
 * adapter labels every table `active`). A past day's tables only change by a late correction once
 * the day is over in MLB's zone, so they count as last changed then; but the answer also carries
 * its season's phase dates (and S140's winner), which the postseason can still move. So it goes by
 * where the answer's season stands (`seasonSettling`, the rule the calendar cache uses too; the
 * answer's season is the one its `phases` dates are for, which in January and February is last
 * year's):
 *
 * - settled: last changed at the end of the day asked, on the standings' ladder (up to 30 days);
 * - not over and before its postseason, or with no calendar for it: the end of the day asked, on
 *   ADR-021's own ladder (48 hours at most; an entry made just before `regularSeasonEndDate` can
 *   reach two days into the window, while `lastGameDate` only moves once the World Series is under
 *   way, weeks later);
 * - in its postseason window: just changed, so the floor.
 *
 * Today, a later day, no `date`, an answer with nothing in it yet, or one built while MLB couldn't
 * give a calendar also count as just changed.
 */
function standingsFreshness({ answer, calendarsComplete }: StandingsRead, date: string | undefined, ctx: ApiContext): { entity: { windowMode: "cache";
	lastChangedAt: string; };
ladder?: readonly CacheLifetimeStep[]; }
{
	const now = ctx.ingest.now?.() ?? new Date();
	const today = mlbToday(now);
	const justChanged = {
		entity: {
			windowMode: "cache" as const,
			lastChangedAt: now.toISOString(),
		},
	};
	if (date === undefined || date >= today || !calendarsComplete || standingsNothingYet(answer, date)) return justChanged;
	const regularSeasonEnd = answer.phases.regularSeason?.endDate;
	// No playoffs phase means no postseason day: the last game is the regular season's last day.
	const settling = seasonSettling(regularSeasonEnd, answer.phases.playoffs?.endDate ?? regularSeasonEnd, today);
	if (settling === "postseason") return justChanged;
	return {
		entity: {
			windowMode: "cache",
			lastChangedAt: mlbDayEndsAt(date).toISOString(),
		},
		...settling === "settled" && {
			ladder: STANDINGS_CACHE_LIFETIME_LADDER,
		},
	};
}

/** 401 means "signed out" to the web client (S49's API-layer note). */
function unauthorized(): Response
{
	return sendError(401, {
		error: "unauthorized",
	});
}

/** A request's JSON body, or null when it isn't JSON (the routes answer 400). */
async function readJson(request: Request): Promise<unknown>
{
	try
	{
		return await request.json() as unknown;
	}
	catch
	{
		return null;
	}
}

/**
 * The JSON body of `POST /api/v1/me/delete`, or null when it isn't one. A
 * malformed body is the client's mistake, so it answers 400, never a thrown
 * error (which `adapters/node/http.ts` would log with whatever it carried).
 */
async function readDeleteRequest(request: Request): Promise<MeDeleteRequest | null>
{
	const body = await readJson(request);
	if (body === null || typeof body !== "object") return null;
	const { phrase } = body as Record<string, unknown>;
	return typeof phrase === "string" ? {
		phrase,
	} : null;
}

/** The ID token of `POST /api/v1/sign-in`, or null when the body isn't `{ idToken }` (400). */
async function readSignInRequest(request: Request): Promise<string | null>
{
	const body = await readJson(request);
	if (body === null || typeof body !== "object") return null;
	const { idToken } = body as Record<string, unknown>;
	return typeof idToken === "string" && idToken ? idToken : null;
}

function notFound(): Response
{
	return sendError(404, {
		error: "not_found",
	});
}

/**
 * The tier of `PUT /api/v1/me/tier-override`'s body (S215): a `PatronTier`, or null for "use my
 * real Patreon tier"; undefined when the body isn't `{ tier }` with one of those (400 `invalid_tier`).
 */
async function readOverrideTier(request: Request): Promise<PatronTier | null | undefined>
{
	const body = await readJson(request);
	if (body === null || typeof body !== "object" || !("tier" in body)) return undefined;
	const { tier } = body as Record<string, unknown>;
	return tier === null || isPatronTier(tier) ? tier : undefined;
}

/** The tier override's answer for `user` (S215): the chosen tier and the real one, which it never changes. */
async function overrideAnswer(ctx: ApiContext, user: UserProfile): Promise<TierOverrideResponse>
{
	return {
		tier: await ctx.auth.users.getTierOverride(user.uid),
		realTier: user.entitlements.tier,
	};
}

/**
 * Staging's backer tier override routes (S215 AC 4), for testing only. Where the deploy-time
 * config doesn't allow it (`tierOverrideAllowed`, false in production and on previews) they answer
 * 404 exactly as an unknown route does, before any session or database read: production refuses
 * the override on the server, not by hiding it. Every answer is `no-store`: a signed-in, per-user
 * answer the edge cache must never keep. Setting it never writes the real tier or calls Patreon.
 */
async function handleTierOverride(ctx: ApiContext, request: Request, write: boolean): Promise<Response>
{
	if (!ctx.auth.tierOverrideAllowed) return noStore(notFound());
	const account = await authenticateAccount(request, ctx.auth);
	if (!account) return noStore(unauthorized());
	if (!write) return noStore(sendJson(200, "GET /api/v1/me/tier-override", await overrideAnswer(ctx, account.user)));
	const tier = await readOverrideTier(request);
	if (tier === undefined)
	{
		return noStore(sendError(400, {
			error: "invalid_tier",
			hint: "{ tier: \"none\" | \"Backer\" | \"Pro Backer\" | \"Star Backer\" | \"Premium Sponsor\" | null }",
		}));
	}
	await ctx.auth.users.setTierOverride(account.user.uid, tier);
	// A new session at once, so every server check that reads it uses the chosen tier; the sign-in time stays the old one's.
	const { token } = await issueSession(ctx.auth, account.user, await accountEntitlements(ctx.auth, account.user), account.session.authTime);
	return noStore(sendJson(200, "PUT /api/v1/me/tier-override", {
		...await overrideAnswer(ctx, account.user),
		token,
	}));
}

/**
 * Routes that stream instead of returning one JSON body (S18's live-game hub
 * upgrades to a WebSocket, ADR-020). They have no response type, so they can't
 * be keys of `ApiRoutes`; the route-table check allows a dispatched route
 * outside `ApiRoutes` only if it is named here.
 */
export const STREAMING_ROUTE_EXCEPTIONS = ["GET /api/v1/games/:gamePk/live", "GET /api/v1/schedule/live"] as const satisfies readonly string[];

type StreamingRoute = (typeof STREAMING_ROUTE_EXCEPTIONS)[number];

/** One dispatchable route: its `"<METHOD> <path>"` key, as written in `ApiRoutes`. */
export interface RouteEntry
{
	route: ApiRoute | StreamingRoute;
	/** Per-parameter value patterns; a `:param` without one matches any single segment. */
	params?: Record<string, RegExp>;
	handle: (url: URL, params: Record<string, string>, ctx: ApiContext, request: Request) => Promise<Response>;
}

/**
 * Every route the API dispatches, keyed exactly as in `ApiRoutes`, so the
 * route-table test can compare the two sets (S44). Typing `route` as
 * `ApiRoute | StreamingRoute` also makes an undeclared key a compile error.
 */
export const API_ROUTER: readonly RouteEntry[] = [
	{
		route: "GET /api/v1/schedule",
		handle: async (url, _params, ctx) =>
		{
			const date = url.searchParams.get("date");
			if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				return sendError(400, {
					error: "date_required",
					hint: "YYYY-MM-DD",
				});
			}
			const force = url.searchParams.get("refresh") === "1";
			const { day, pastFinished } = await getScheduleRead(ctx.ingest, date, {
				force,
			});
			// S212: a past, finished day is kept at the edge for weeks and purged when the cron changes it.
			return withReadCacheControl(sendJson(200, "GET /api/v1/schedule", toScheduleDayResponse(day)), {
				lifetime: pastFinished ? "past" : "ladder",
				force,
			}, day, ctx);
		},
	},
	{
		// S149: the scoreboard's day over the day hub's WebSocket, while the day has a game in its window.
		route: "GET /api/v1/schedule/live",
		handle: async (url, _params, ctx, request) =>
		{
			const date = url.searchParams.get("date");
			if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				const response = sendError(400, {
					error: "date_required",
					hint: "YYYY-MM-DD",
				});
				response.headers.set("Cache-Control", "no-store");
				return response;
			}
			return liveDayUpgrade(date, request, ctx);
		},
	},
	{
		route: "GET /api/v1/schedule/month/:month",
		handle: async (url, params, ctx) =>
		{
			// One check of the month (S124 AC 5): its shape, a real month, and none before 1901-04.
			const month = params.month ?? "";
			if (!isCalendarMonth(month))
			{
				return sendError(400, {
					error: "month_invalid",
					hint: "YYYY-MM, 1901-04 or later",
				});
			}
			// Nor after December of next year, by MLB's today (owner, 2026-11-09: "Reject past next year"):
			// MLB can't have published it, and answering it would cost an MLB request and stored rows.
			const today = mlbToday(ctx.ingest.now?.() ?? new Date());
			const latest = latestScheduleMonth(today);
			if (month > latest)
			{
				return sendError(400, {
					error: "month_too_late",
					hint: `YYYY-MM, ${latest} or earlier`,
				});
			}
			const result = await getScheduleMonth(ctx.ingest, month);
			// The body and its version come from one answer (`scheduleMonthAnswer`), so `?v=` names exactly what is sent.
			const answer = scheduleMonthAnswer(result.month, result.days);
			const response = sendJson(200, "GET /api/v1/schedule/month/:month", answer);
			// A month with an unknown day (a fill MLB didn't answer, or a past day nothing stored) is kept
			// at the edge only as long as the fill's cooldown and never served stale after (#399): the
			// ladder's floor served such answers for up to ten minutes as months with no games, and
			// no-store would send every open of a past month nothing stored to the Worker and Postgres.
			if (!result.complete)
			{
				response.headers.set("Cache-Control", `public, s-maxage=${REFRESH_COOLDOWN_MS / 1000}`);
				return response;
			}
			// Asked for by version (S194 AC 7): the versions route named this URL, so when the version
			// matches the answer it names exactly this content and may be kept long, a past year's
			// longest of all; a version that doesn't match is kept only the floor (plus the stale window).
			const version = url.searchParams.get("v");
			if (version !== null)
			{
				response.headers.set("Cache-Control", versionedMonthCacheControl(month, version === scheduleMonthVersion(answer), today));
				return response;
			}
			// Without a version, cached by when the month's data last changed (ADR-021's ladder, up to its
			// 48-hour cap), whatever its year: a correction must reach a URL that names no content within it.
			return withCacheControl(response, {
				windowMode: "cache",
				lastChangedAt: result.lastChangedAt,
			}, ctx);
		},
	},
	{
		route: "GET /api/v1/schedule/month-versions/:year",
		handle: async (_url, params, ctx) =>
		{
			// Any year the month route answers a month of (S194 AC 7): 1901 through next year by MLB's today.
			const text = params.year ?? "";
			const latestYear = Number(latestScheduleMonth(mlbToday(ctx.ingest.now?.() ?? new Date())).slice(0, 4));
			const year = Number(text);
			if (!/^\d{4}$/.test(text) || year < 1901 || year > latestYear)
			{
				return noStore(sendError(400, {
					error: "year_invalid",
					hint: `YYYY, 1901 through ${latestYear}`,
				}));
			}
			const response = sendJson(200, "GET /api/v1/schedule/month-versions/:year", {
				year,
				versions: await getScheduleMonthVersions(ctx.ingest, year),
			});
			response.headers.set("Cache-Control", SCHEDULE_MONTH_VERSIONS_CACHE_CONTROL);
			return response;
		},
	},
	{
		route: "GET /api/v1/digest",
		handle: async (url, _params, ctx) =>
		{
			const date = url.searchParams.get("date");
			if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			{
				return sendError(400, {
					error: "date_required",
					hint: "YYYY-MM-DD",
				});
			}
			const {
				freshness, digest, edgeLifetime,
			} = await getDayDigest(ctx.ingest, date);
			// S212: a past, finished day whose games are all past, finished and read is kept for weeks (purged on a change);
			// one missing a game it couldn't read is kept only the floor, so the next read tries that game again.
			// Otherwise by the graduated rule (S71, #61): not while the day or a game is live,
			// then by how long since the latest of them changed.
			return withReadCacheControl(sendJson(200, "GET /api/v1/digest", digest), {
				lifetime: edgeLifetime,
			}, freshness, ctx);
		},
	},
	{
		route: "GET /api/v1/search/highlights",
		handle: async (url, _params, ctx) =>
		{
			const q = url.searchParams.get("q") ?? "";
			// The one limit the web app's box shares (`SEARCH_QUERY_MAX_LENGTH`: UTF-16 units after trimming).
			if (q.trim().length > SEARCH_QUERY_MAX_LENGTH)
			{
				return noStore(sendError(400, {
					error: "query_too_long",
					hint: `q: at most ${SEARCH_QUERY_MAX_LENGTH} characters`,
				}));
			}
			// S72's optional filters, each MLB's own: a game date, a club's id and a content tag. One that isn't
			// well formed is refused rather than dropped, so a fan never sees unfiltered results under a chip.
			const filters = parseSearchFilters((name) => url.searchParams.get(name));
			if (filters === "invalid")
			{
				return noStore(sendError(400, {
					error: "invalid_filter",
					hint: "date: YYYY-MM-DD; team: an MLB team id; tag: a content tag such as home-run",
				}));
			}
			let answer;
			try
			{
				answer = await searchHighlights(ctx.ingest.mlb, q, filters);
			}
			catch (error)
			{
				// MLB couldn't answer: an error, never cached, and never "no results". Logged by the error's name only, so the
				// words searched for (ADR-028) and MLB's URL, which carries them, stay out of the log.
				console.error("search failed:", error instanceof Error ? error.name : typeof error);
				return noStore(sendError(502, {
					error: "search_unavailable",
					hint: "MLB could not be reached; try again shortly",
				}));
			}
			if (!answer)
			{
				return noStore(sendError(400, {
					error: "query_required",
					hint: "q: the words to search highlights for, or a date, team or tag filter",
				}));
			}
			const response = sendJson(200, "GET /api/v1/search/highlights", answer);
			// MLB adds clips as games are played; five minutes spares it a request per repeated search.
			response.headers.set("Cache-Control", "public, max-age=300");
			return response;
		},
	},
	{
		route: "GET /api/v1/standings",
		handle: async (url, _params, ctx) =>
		{
			// The day to show standings for; MLB's today when absent (S128).
			const date = url.searchParams.get("date") ?? undefined;
			// A real date (`isCalendarDate`), not only the shape: `2026-02-30` is no day to answer or cache.
			if (date !== undefined && !isCalendarDate(date))
			{
				return noStore(sendError(400, {
					error: "date_invalid",
					hint: "YYYY-MM-DD",
				}));
			}
			const include = parseIncludePhases(url.searchParams.getAll("includePhases"));
			if (include === null)
			{
				return noStore(sendError(400, {
					error: "include_phases_invalid",
					hint: `comma-separated phase names: ${SEASON_PHASES.join(",")}`,
				}));
			}
			let read: StandingsRead;
			try
			{
				read = await getStandings(ctx.ingest, date, include);
			}
			catch (error)
			{
				// MLB couldn't answer a standings table: an error, never cached (AC 8). A calendar it couldn't give is not
				// an error (no calendar, S128 AC 7); that answer is kept only the floor (`standingsFreshness`). Logged by
				// the error's name only, as sign-in is, so a programming error doesn't pass unseen.
				console.error("standings failed:", error instanceof Error ? error.name : typeof error);
				return noStore(sendError(502, {
					error: "standings_unavailable",
					hint: "MLB could not be reached; try again shortly",
				}));
			}
			const { entity, ladder } = standingsFreshness(read, date, ctx);
			return withCacheControl(sendJson(200, "GET /api/v1/standings", read.answer), entity, ctx, ladder);
		},
	},
	{
		route: "GET /api/v1/scoreboard/default-date",
		handle: async (_url, _params, ctx) =>
		{
			const response = sendJson(200, "GET /api/v1/scoreboard/default-date", await getDefaultScoreboardDate(ctx.ingest));
			// The answer moves once a day at most; five minutes spares MLB a calendar read per visit.
			response.headers.set("Cache-Control", "public, max-age=300");
			return response;
		},
	},
	{
		route: "GET /api/v1/players/:personId/profiles",
		params: {
			personId: /^\d+$/,
		},
		handle: async (_url, params, ctx) =>
		{
			// S209 AC 3: read from the player-id table only; the cron's resolve step fills it, never this request.
			const row = await ctx.ingest.playerIds?.get(Number(params.personId)) ?? null;
			if (!row)
			{
				const missing = notFound();
				missing.headers.set("Cache-Control", PLAYER_PROFILES_PENDING_CACHE_CONTROL);
				return missing;
			}
			const ids = {
				mlbam: row.personId,
				fangraphs: row.fangraphsId,
				bbref: row.bbrefId,
			};
			const response = sendJson(200, "GET /api/v1/players/:personId/profiles", {
				ids,
				profiles: Object.fromEntries(STATS_PROVIDERS.map((provider) => [provider, playerProfileUrl(provider, ids)])) as Record<StatsProvider, string | null>,
				checked: row.checkedAt !== null,
			});
			response.headers.set("Cache-Control", row.checkedAt === null ? PLAYER_PROFILES_PENDING_CACHE_CONTROL : PLAYER_PROFILES_CHECKED_CACHE_CONTROL);
			return response;
		},
	},
	{
		route: "GET /api/v1/releases",
		handle: async (_url, _params, ctx) =>
		{
			// Bundled into the build (S132 AC 3), so nothing is read at request time; cached at most 5 minutes in all (AC 4).
			const response = sendJson(200, "GET /api/v1/releases", getReleases(ctx.releases ?? BUNDLED_RELEASE_NOTES));
			response.headers.set("Cache-Control", RELEASES_CACHE_CONTROL);
			return response;
		},
	},
	{
		route: "GET /api/v1/games/:gamePk",
		params: {
			gamePk: /^\d+$/,
		},
		handle: async (url, params, ctx) =>
		{
			const gamePk = Number(params.gamePk);
			const force = url.searchParams.get("refresh") === "1";
			const game = await getOrRefreshGame(ctx.ingest, gamePk, {
				force,
			});
			if (!game)
			{
				return notFound();
			}
			// S212: a past, finished game is kept at the edge for weeks and purged when the cron changes it.
			return withReadCacheControl(sendJson(200, "GET /api/v1/games/:gamePk", toGameSnapshotResponse(game)), {
				lifetime: isPastFinishedGame(game, ctx.ingest.now?.() ?? new Date()) ? "past" : "ladder",
				force,
			}, game, ctx);
		},
	},
	{
		route: "GET /api/v1/games/:gamePk/live",
		params: {
			gamePk: /^\d+$/,
		},
		handle: (_url, params, ctx, request) => liveUpgrade(Number(params.gamePk), request, ctx),
	},
	{
		route: "GET /api/v1/me",
		handle: async (_url, _params, ctx, request) =>
		{
			// The session proves who is asking; the profile read is for the email, which the session doesn't carry.
			const account = await authenticateAccount(request, ctx.auth);
			// Right after a deletion (S87): signed out with the deletion cookie answers
			// `account_deleted` once, and any /me that sees the cookie clears it, signed in or
			// not (owner, 2026-10-29: "Drop it (clear on any /me)").
			const deleted = hasDeletedCookie(request);
			// The entitlements come from the one rule (S215 AC 1): the staging tier override where allowed, else the stored tier.
			const response = account
				? sendJson(200, "GET /api/v1/me", toMeResponse({
					...account.user,
					entitlements: await accountEntitlements(ctx.auth, account.user),
				}))
				: deleted ? sendError(401, {
					error: "account_deleted",
				}) : unauthorized();
			return deleted ? clearDeletedCookie(response, request) : response;
		},
	},
	{
		route: "POST /api/v1/me/download",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const result = await requestDownload(ctx.account, account.user);
			if ("nextAllowedAt" in result)
			{
				return sendError(429, {
					error: "download_limit",
					hint: "two downloads per rolling 24 hours",
					nextAllowedAt: result.nextAllowedAt,
				});
			}
			return sendJson(200, "POST /api/v1/me/download", result.download);
		},
	},
	{
		route: "GET /api/v1/me/download",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const download = await currentDownload(ctx.account, account.session.uid);
			return download ? sendJson(200, "GET /api/v1/me/download", download) : notFound();
		},
	},
	{
		route: "GET /api/v1/me/download/:downloadId",
		handle: async (_url, params, ctx, request) =>
		{
			// Owner only: another user's id, an aged-out download and an unknown id all look the same (404).
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const file = await downloadFile(ctx.account, account.session.uid, params.downloadId ?? "");
			return file ? sendJson(200, "GET /api/v1/me/download/:downloadId", file) : notFound();
		},
	},
	{
		route: "POST /api/v1/me/delete",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const body = await readDeleteRequest(request);
			if (!body)
			{
				return sendError(400, {
					error: "invalid_body",
					hint: "{ phrase }",
				});
			}
			const refusal = await deleteAccount(ctx.account, account.session, body);
			if (refusal) return sendError(refusal.status, {
				error: refusal.error,
			});
			// The next visit to Settings says the account is gone, once (S87, A5).
			return setDeletedCookie(sendJson(200, "POST /api/v1/me/delete", {
				deleted: true,
			}), request);
		},
	},
	{
		route: "GET /api/v1/me/tier-override",
		handle: (_url, _params, ctx, request) => handleTierOverride(ctx, request, false),
	},
	{
		route: "PUT /api/v1/me/tier-override",
		handle: (_url, _params, ctx, request) => handleTierOverride(ctx, request, true),
	},
	{
		route: "GET /api/v1/sign-in",
		handle: async (_url, _params, ctx) =>
		{
			// The web app reads its Logto tenant and app ID from here, so it keeps no copy of its own (S116),
			// and whether staging's mock sign-in is offered instead (S143).
			const response = sendJson(200, "GET /api/v1/sign-in", {
				logto: ctx.auth.logto?.config ?? null,
				mock: ctx.auth.mock !== undefined,
			});
			response.headers.set("Cache-Control", "no-store");
			return response;
		},
	},
	{
		route: "POST /api/v1/sign-in",
		handle: async (_url, _params, ctx, request) =>
		{
			const idToken = await readSignInRequest(request);
			if (!idToken) return sendError(400, {
				error: "invalid_body",
				hint: "{ idToken }",
			});
			let signedIn: Awaited<ReturnType<typeof completeProviderSignIn>>;
			try
			{
				signedIn = await completeProviderSignIn(ctx.auth, idToken);
			}
			catch (error)
			{
				// A token that doesn't verify (or carries no email) is the caller's to fix by signing in again; nothing is logged.
				if (error instanceof CredentialRefusedError) return sendError(401, {
					error: "sign_in_refused",
				});
				// Anything else is BT's (the tenant's keys can't be fetched, the database or the session key failed):
				// not the fan's sign-in being refused (S120). Logged by the error's name only: a message can carry an
				// account's subject (`linkIdentity`), which deletion couldn't follow into the logs (ADR-028).
				console.error("sign-in failed:", error instanceof Error ? error.name : typeof error);
				return sendError(503, {
					error: "sign_in_failed",
				});
			}
			return signedIn ? sendJson(200, "POST /api/v1/sign-in", {
				token: signedIn.token,
			}) : sendError(404, {
				error: "sign_in_unavailable",
			});
		},
	},
	{
		route: "GET /api/v1/me/settings",
		handle: async (_url, _params, ctx, request) =>
		{
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			return sendJson(200, "GET /api/v1/me/settings", await ctx.settings.get(account.session.uid) ?? DEFAULT_SETTINGS);
		},
	},
	{
		route: "PUT /api/v1/me/settings",
		handle: async (_url, _params, ctx, request) =>
		{
			// The account check matters here: a deleted user's still-valid session must not write settings back (ADR-028).
			const account = await authenticateAccount(request, ctx.auth);
			if (!account) return unauthorized();
			const settings = parseAccountSettings(await readJson(request));
			if (!settings)
			{
				return sendError(400, {
					error: "invalid_settings",
					hint: "{ favoriteTeamIds, opensFirst, gameRowSlot?, collapseNonFavorites?, hideScores?, videoPlayer?, statsProvider?, version }",
				});
			}
			// S209 AC 9: a stats site other than MLB.com is a patron's choice. The route takes the whole document, so only a
			// change of it is refused: a lapsed patron's stored choice saves unchanged with any other edit. Decided from the
			// account's tier (`getByUid`, with staging's override as /me applies it) through `entitlementsForTier`, never
			// from the session token's copy, which a token signed before S209 lacks.
			const stored = await ctx.settings.get(account.session.uid);
			const changedProvider = settings.statsProvider !== (stored ?? DEFAULT_SETTINGS).statsProvider;
			const tier = (await accountEntitlements(ctx.auth, account.user)).tier;
			if (changedProvider && settings.statsProvider !== "mlb" && !entitlementsForTier(tier).statsProviderChoice)
			{
				return sendError(400, {
					error: "invalid_settings",
					hint: "statsProvider other than \"mlb\" needs a patron tier (Backer and up)",
				});
			}
			// Apply-if-newer (ADR-022): an older version is ignored, and the answer is what is stored.
			await ctx.settings.upsert(account.session.uid, settings);
			return sendJson(200, "PUT /api/v1/me/settings", await ctx.settings.get(account.session.uid) ?? settings);
		},
	},
];

/**
 * Matches a request against one route key. Returns the `:param` values, or
 * null when the method, segment count, a literal segment, or a param pattern
 * differs. Path segments are compared raw (no decoding), as the hand-written
 * matcher before S44 did.
 */
function matchRoute(entry: RouteEntry, method: string, pathname: string): Record<string, string> | null
{
	const [routeMethod, routePath = ""] = entry.route.split(" ");
	if (routeMethod !== method) return null;
	const want = routePath.split("/");
	const got = pathname.split("/");
	if (want.length !== got.length) return null;
	const params: Record<string, string> = {};
	for (let i = 0; i < want.length; i++)
	{
		const w = want[i] ?? "";
		const g = got[i] ?? "";
		if (w.startsWith(":"))
		{
			const name = w.slice(1);
			const pattern = entry.params?.[name];
			if (g === "" || (pattern && !pattern.test(g))) return null;
			params[name] = g;
		}
		else if (w !== g)
		{
			return null;
		}
	}
	return params;
}

/**
 * What disagrees between the routes a router dispatches and the declared
 * contract: a dispatched route that is neither declared nor a named streaming
 * exception, or a declared route nothing dispatches. Empty means they agree.
 */
export function routeTableMismatches(
	router: readonly { route: string }[],
	declared: readonly string[],
	streaming: readonly string[],
): string[]
{
	const dispatched = new Set(router.map((r) => r.route));
	const undeclared = [...dispatched]
		.filter((r) => !declared.includes(r) && !streaming.includes(r))
		.map((r) => `dispatched but not in ApiRoutes: ${r}`);
	const undispatched = declared
		.filter((r) => !dispatched.has(r))
		.map((r) => `in ApiRoutes but not dispatched: ${r}`);
	return [...undeclared, ...undispatched];
}

/**
 * The API as a Fetch-standard handler (ADR-017: a Worker's handler is
 * `(Request) => Response`). Node's local server adapts to it in
 * `adapters/node/http.ts`. `/health` is an operational probe for the local
 * server, not part of the `/api` contract, so it sits outside `API_ROUTER`.
 */
export async function handleApiRequest(
	request: Request,
	ctx: ApiContext,
): Promise<Response>
{
	if (request.method === "OPTIONS")
	{
		return new Response(null, {
			status: 204,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				...CORS_HEADERS,
			},
		});
	}

	const url = new URL(request.url);
	const { pathname } = url;

	if (request.method === "GET" && pathname === "/health")
	{
		return json(200, {
			ok: true,
			service: "bt-functions-local",
		});
	}

	let match: { entry: RouteEntry;
		params: Record<string, string>; } | null = null;
	for (const entry of API_ROUTER)
	{
		const params = matchRoute(entry, request.method, pathname);
		if (params)
		{
			match = {
				entry,
				params,
			};
			break;
		}
	}

	// ADR-015's lifecycle (S28): record the version asked for; a retired version gets 426 and
	// no data; a deprecated one is served with Deprecation and Sunset headers.
	const version = apiVersionOf(pathname);
	const state = version ? (ctx.versions ?? API_VERSIONS)[version] : undefined;
	if (version) ctx.usage?.({
		version,
		route: match?.entry.route ?? "unmatched",
	});
	if (state?.status === "sunset")
	{
		return sendError(426, {
			error: "version_unsupported",
			hint: "This version of the app has been retired; reload to update.",
		});
	}
	// `no-store`, as the tier override's 404 off staging (S215), so the two can't be told apart by their headers.
	if (!match) return noStore(notFound());
	const response = await match.entry.handle(url, match.params, ctx, request);
	const headers = state ? deprecationHeaders(state) : {};
	// A WebSocket upgrade (101) can't be re-wrapped; it carries no warning.
	if (Object.keys(headers).length === 0 || response.status === 101) return response;
	const warned = new Response(response.body, response);
	for (const [name, value] of Object.entries(headers)) warned.headers.set(name, value);
	return warned;
}
