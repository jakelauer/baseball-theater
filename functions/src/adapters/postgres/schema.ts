/**
 * BT's Postgres schema (ADR-018; S50, Drizzle per the owner, 2026-10-18). Typed tables for
 * what BT owns about people (users, identity links, entitlements, account settings, the
 * deletion log) and for the keys and versions of what it stores about games; each MLB-derived
 * document (a schedule day, a game snapshot, a projection, a replay artifact) is one JSONB
 * column beside its key and `version`, which every write compares (ADR-022). A GIN index on
 * the game document serves queries into it (S5's highlight search, when it lands).
 *
 * Times stay ISO strings in `text` columns: the ports hand them over as strings and the
 * storage contract (S46) reads back exactly what was written. Migrations are generated from
 * this file by `drizzle-kit` (`drizzle.config.ts`) and committed under `migrations/`.
 */
import type {
	AccountSettings, GameProjection, GameSnapshot, GameState, PatronTier, ScoreboardWinProbability, StoredScheduleDay,
} from "@bt/domain";
import type { ReplayArtifact } from "@bt/ports";
import { sql } from "drizzle-orm";
import {
	bigint, boolean, check, index, integer, jsonb, pgSequence, pgTable, primaryKey, serial, text,
} from "drizzle-orm/pg-core";

/**
 * One schedule day per date (`ScheduleRepository`). Its games carry no status, linescore or live moment, which
 * `game_states` holds (S150; days stored before it still have them in the document, and readers ignore them).
 * `served_base` is outside the document, so it isn't hashed: the served day's version adds it, and a refresh that
 * drops a game from the day raises it by that game's state version in the same write (S150 AC 6).
 */
export const scheduleDays = pgTable("schedule_days", {
	date: text("date").primaryKey(),
	version: integer("version").notNull(),
	servedBase: integer("served_base").notNull().default(0),
	document: jsonb("document").$type<StoredScheduleDay>().notNull(),
});

/**
 * One record per schedule month (`ScheduleRepository`'s month checks, S194): when BT last checked the
 * month against MLB, and when a refresh last claimed it, or the time a failed fill holds it until
 * (`holdScheduleMonth`), each an ISO instant or null; a claim holds until `claimed_at` plus the lease. The adapter
 * compares them as `timestamptz` (casting the text), so how a writer formats the instant can't
 * reorder them.
 */
export const scheduleMonths = pgTable("schedule_months", {
	month: text("month").primaryKey(),
	checkedAt: text("checked_at"),
	claimedAt: text("claimed_at"),
}, (t) => [
	// A month is `YYYY-MM`, so a caller's typo can't leave a record the refresh never reads.
	check("schedule_months_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]);

/**
 * One game's shared state per game (`GameStateRepository`, S150 AC 3): the source that wrote it (`feed` or
 * `schedule`, held to those two by a CHECK), the newest feed time it accepted (null until the feed writes), the
 * official date and first pitch the switch reads, the `GameState`, and the game's win-probability line (S161).
 */
export const gameStates = pgTable("game_states", {
	gamePk: integer("game_pk").primaryKey(),
	version: integer("version").notNull(),
	source: text("source").notNull(),
	feedTime: text("feed_time"),
	officialDate: text("official_date").notNull(),
	startTime: text("start_time"),
	document: jsonb("document").$type<GameState>().notNull(),
	// S161: the game's scoreboard win-probability line (`ScoreboardWinProbability`), null until a feed write with play
	// metrics sets one; kept outside the document, as feed-only data the switch never guards.
	winProbability: jsonb("win_probability").$type<ScoreboardWinProbability>(),
}, (table) => [check("game_states_source_check", sql`${table.source} IN ('feed', 'schedule')`)]);

/**
 * One record per game the cron re-checks (`GameRepository`'s re-check record, S212 AC 5): when BT last re-checked the
 * game's full detail against MLB, and when a re-check last claimed it, each an ISO instant or null; a claim holds until
 * `claimed_at` plus the lease. Kept apart from `games` so a snapshot write never touches it, and compared as
 * `timestamptz` by the adapter, as `schedule_months` is.
 */
export const gameRechecks = pgTable("game_rechecks", {
	gamePk: integer("game_pk").primaryKey(),
	checkedAt: text("checked_at"),
	claimedAt: text("claimed_at"),
});

/**
 * Where every owe of an edge purge takes its version (S212 review): one sequence for the table's life, so a version is
 * never reused, even after its row was settled and the URL owed again (a per-row counter would restart at 1 and let an
 * older listing's settle drop the new owe).
 */
export const owedEdgePurgeVersions = pgSequence("owed_edge_purges_version_seq");

/**
 * One row per URL whose edge purge failed and is still owed (`OwedEdgePurgeRepository`, S212): when it was last owed and
 * the version that owe took from {@link owedEdgePurgeVersions} (so settling an older listing never drops a newer owe),
 * how many retries of it have failed and when it may next be retried (an ISO instant, or null for now). Instants
 * compared as `timestamptz` by the adapter.
 *
 * A path-only owe (`/api/v1/…`, S161's win-probability fill) keeps its retry time in `path_retry_at` instead, and its
 * `retry_at` holds `'infinity'` (S219): a Worker from before S161 lists by `retry_at` alone and sends what it lists as it
 * is, so it must never reach those rows (see `PostgresOwedEdgePurgeRepository`).
 */
export const owedEdgePurges = pgTable("owed_edge_purges", {
	url: text("url").primaryKey(),
	owedAt: text("owed_at").notNull(),
	version: bigint("version", {
		mode: "number",
	}).notNull().default(sql`nextval('owed_edge_purges_version_seq')`),
	failures: integer("failures").notNull().default(0),
	retryAt: text("retry_at"),
	pathRetryAt: text("path_retry_at"),
});

/** One game snapshot per game (`GameRepository`): its day for `listByDate`, the document for queries into it. */
export const games = pgTable("games", {
	gamePk: integer("game_pk").primaryKey(),
	officialDate: text("official_date").notNull(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<GameSnapshot>().notNull(),
}, (t) => [
	index("games_official_date").on(t.officialDate),
	index("games_document_gin").using("gin", t.document),
]);

/**
 * MLB's players and their ids on FanGraphs and Baseball-Reference (`PlayerIdRepository`, S209), keyed by MLB's
 * person id: a row for each Chadwick register row with an MLB id and at least one of the two ids, MLB's
 * cross-references filling an id the register lacks. `register_file` names the register file the row came from,
 * so a file's sync deletes exactly the rows that file dropped. Public facts about players; no user data. No index
 * beyond the key: the only other read is that delete, a scan of about 24,000 rows at most once a day a file.
 */
export const playerIds = pgTable("player_ids", {
	personId: integer("person_id").primaryKey(),
	fangraphsId: text("fangraphs_id"),
	bbrefId: text("bbref_id"),
	registerFile: text("register_file").notNull(),
});

/**
 * The register sync's state per file (S209): the ETag of the copy last written (null when the register sent
 * none), when it was last synced (written, or answered unchanged) and when a run last claimed it (ISO instants,
 * compared as `timestamptz`, as `schedule_months`' are). Sixteen rows at most.
 */
export const playerRegisterFiles = pgTable("player_register_files", {
	file: text("file").primaryKey(),
	etag: text("etag"),
	syncedAt: text("synced_at"),
	triedAt: text("tried_at"),
});

/** The five projected documents per game (`GameProjectionRepository`), versioned by `header.version`. */
export const gameProjections = pgTable("game_projections", {
	gamePk: integer("game_pk").primaryKey(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<GameProjection>().notNull(),
});

/** One post-game replay artifact per game (`ReplayArtifactRepository`, S22). */
export const replayArtifacts = pgTable("replay_artifacts", {
	gamePk: integer("game_pk").primaryKey(),
	version: integer("version").notNull(),
	document: jsonb("document").$type<ReplayArtifact>().notNull(),
});

/**
 * Each ballpark's field drawing (`VenueFieldRepository`, S105), by MLB venue id: Savant's SVG after `sanitizeFieldSvg`,
 * or null when BT asked and got none; `fetched_at` (ISO, when BT asked) is its version, newer only (ADR-022).
 */
export const venueFields = pgTable("venue_fields", {
	venueId: integer("venue_id").primaryKey(),
	svg: text("svg"),
	fetchedAt: text("fetched_at").notNull(),
});

/** BT's own users (ADR-019): the profile, keyed by BT's uid. Personal: `BT database: users`. */
export const users = pgTable("users", {
	uid: text("uid").primaryKey(),
	email: text("email").notNull(),
	displayName: text("display_name"),
	patreonUserId: text("patreon_user_id"),
	role: text("role").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

/** What each user may use, beside the profile; goes with the user. Personal: `BT database: users`. */
export const entitlements = pgTable("entitlements", {
	uid: text("uid").primaryKey().references(() => users.uid, {
		onDelete: "cascade",
	}),
	tier: text("tier").notNull(),
	fasterLiveRefresh: boolean("faster_live_refresh").notNull(),
	cloudSyncedSettings: boolean("cloud_synced_settings").notNull(),
	savantLinks: boolean("savant_links").notNull(),
});

/**
 * Staging's backer tier override (S215): the tier a tester chose to see BT as, one row per user,
 * kept apart from `entitlements` (the real tier, which only a Patreon link writes) so setting it
 * never touches the real tier or Patreon. For staging tests only: production's deploy-time config
 * refuses the override on the server and never reads this table. Goes with the user. Personal:
 * `BT database: users` (the tester's chosen entitlement tier).
 */
export const tierOverrides = pgTable("tier_overrides", {
	uid: text("uid").primaryKey().references(() => users.uid, {
		onDelete: "cascade",
	}),
	tier: text("tier").$type<PatronTier>().notNull(),
});

/** A provider account (provider, subject) linked to one BT uid (ADR-019). Personal: `BT database: users`. */
export const identityLinks = pgTable("identity_links", {
	provider: text("provider").notNull(),
	subject: text("subject").notNull(),
	uid: text("uid").notNull(),
}, (t) => [
	primaryKey({
		columns: [t.provider, t.subject],
	}),
	index("identity_links_uid").on(t.uid),
]);

/** Each account's settings document (ADR-027, S6), typed column by column. Personal: `BT database: settings`. */
export const accountSettings = pgTable("account_settings", {
	uid: text("uid").primaryKey(),
	favoriteTeamIds: integer("favorite_team_ids").array().notNull(),
	opensFirst: text("opens_first").$type<AccountSettings["opensFirst"]>().notNull(),
	gameRowSlot: text("game_row_slot").$type<AccountSettings["gameRowSlot"]>().notNull(),
	collapseNonFavorites: boolean("collapse_non_favorites").notNull(),
	hideScores: boolean("hide_scores").notNull(),
	videoPlayer: text("video_player").$type<AccountSettings["videoPlayer"]>().notNull(),
	// S209: a row written before the column existed reads MLB.com, the house default.
	statsProvider: text("stats_provider").$type<AccountSettings["statsProvider"]>().notNull().default("mlb"),
	version: integer("version").notNull(),
});

/** Deleted uids and when (ADR-028): the one record kept after a deletion, re-applied after a restore. */
export const deletionLog = pgTable("deletion_log", {
	id: serial("id").primaryKey(),
	uid: text("uid").notNull(),
	deletedAt: text("deleted_at").notNull(),
});
