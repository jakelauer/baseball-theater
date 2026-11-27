/**
 * MLB's `codedGameState` letters, every one MLB's `GET /api/v1/gameStatus` lists (#81);
 * `window.ts` says how BT treats each. `X` is MLB's own "Unknown", which BT also writes when
 * MLB sends no code. A code MLB doesn't list passes through as it is (the `| string` beside
 * this type wherever BT carries a status), and the domain reads it as unknown
 * (`normalizeStatusCode`). MLB's `U` is a suspended game, not unknown.
 */
export type GameStatusCode =
  | "S" // scheduled
  | "P" // pre-game, warm-up, delayed start
  | "I" // in progress, including in-game delays
  | "M" // manager challenge (#74)
  | "N" // umpire review (#74)
  | "T" // suspended (#79)
  | "U" // suspended (#79)
  | "F" // final
  | "O" // game over
  | "C" // cancelled
  | "Q" // forfeit (#80)
  | "R" // forfeit (#80)
  | "D" // postponed (MLB codes a delay `I`, not `D`; #72)
  | "X" // unknown
  | "W"; // writing (MLB's "Other" group; read as unknown)

export type AbstractTeam = {
	id: number;
	abbreviation: string;
	name: string;
	teamName: string;
};

export type LinescoreSummary = {
	currentInning: number | null;
	inningState: string | null;
	isTopInning: boolean | null;
	outs: number | null;
	balls: number | null;
	strikes: number | null;
	teams: {
		home: { runs: number | null;
			hits: number | null;
			errors: number | null };
		away: { runs: number | null;
			hits: number | null;
			errors: number | null };
	};
	/** Innings the game is scheduled for (9 unless shortened); absent on older recordings (S2). */
	scheduledInnings?: number | null;
	/** One entry per inning played or under way, in order (S2). Absent on older recordings. */
	innings?: LinescoreInning[];
};

/**
 * One inning of the linescore (S2). A side that hasn't batted in it yet — the home
 * half of an unfinished inning, or a bottom 9th never played — has `runs: null`.
 */
export type LinescoreInning = {
	num: number;
	away: { runs: number | null };
	home: { runs: number | null };
};

/** One batter's line in the box score (S2; the ratified Box frames' columns). */
export type BoxscoreBatter = {
	id: number;
	fullName: string;
	/** Fielding position abbreviation as MLB gives it (`CF`, `DH`, `P`). */
	position: string;
	/** MLB's batting-order code: `100`–`900` for starters, `101`… for whoever replaced them. */
	battingOrder: string;
	atBats: number;
	runs: number;
	hits: number;
	rbi: number;
	baseOnBalls: number;
	strikeOuts: number;
	/** Season batting average after this game, as MLB formats it (`.279`). */
	avg: string | null;
	/**
	 * The fields below came with S207, to draw the line as the live baseball.theater (v2) box score
	 * does; a game stored before it has none of them. The player's last name (`Crow-Armstrong`), MLB's
	 * `gameData.players[…].lastName`.
	 */
	lastName?: string;
	/** Every position he played, in order (`PH`, `DH`), MLB's `allPositions`; v2 joins them `PH-DH`. */
	positions?: string[];
	/** MLB's note marker for a substitute (`a-`, `1-`), keyed to the team's `notes`; `null` for none. */
	note?: string | null;
	/** Whether he came into the game as a substitute (MLB's `gameStatus.isSubstitute`); v2 indents him. */
	isSubstitute?: boolean;
	/** Season OPS after this game, as MLB formats it (`.943`). */
	ops?: string | null;
};

/**
 * One pitcher's line in the box score (S207): MLB's own numbers for this game, and his season ERA and
 * WHIP after it, as MLB formats them, so no view works a rate out itself (ADR-025).
 */
export type BoxscorePitcher = {
	id: number;
	fullName: string;
	/** MLB's `lastInitName` (`Assad, J`), the name v2's pitching table shows; `fullName` when MLB sent none. */
	lastInitName: string;
	/** Innings pitched as MLB writes them, outs after the point (`4.2` is four and two thirds). */
	inningsPitched: string;
	hits: number;
	runs: number;
	earnedRuns: number;
	baseOnBalls: number;
	strikeOuts: number;
	homeRuns: number;
	battersFaced: number;
	/** Season ERA after this game (`3.58`); `null` when MLB sent none. */
	era: string | null;
	/** Season WHIP after this game (`1.14`); `null` when MLB sent none. */
	whip: string | null;
};

/** One `label: value` line of MLB's boxscore notes (Venue, Weather, Att…). */
export type BoxscoreInfoLine = {
	label: string;
	value: string;
};

/**
 * One of a team's titled groups of box score details (S207), as MLB groups them: `BATTING` (2B, HR,
 * RBI…), `BASERUNNING` (SB, CS, PO) or `FIELDING` (E, DP…), each line as MLB wrote it.
 */
export type BoxscoreInfoGroup = {
	title: string;
	lines: BoxscoreInfoLine[];
};

/**
 * One team's side of the box score: its batters in batting order and, since S207, its pitchers in
 * MLB's order (`pitchers`: the order they pitched), its detail groups and its lettered notes. The S207
 * fields are optional because a game stored before S207 has none of them.
 */
export type BoxscoreTeam = {
	batting: BoxscoreBatter[];
	pitching?: BoxscorePitcher[];
	details?: BoxscoreInfoGroup[];
	notes?: BoxscoreInfoLine[];
};

/**
 * The live moment of a game in progress (S63; the game-rooms Live frames' diamond and
 * pitcher / batter cards): the player id on each base (`null` when empty), the
 * batter and the pitcher. MLB's `linescore.offense` and `currentPlay.matchup`.
 */
export type GameLive = {
	runners: {
		first: number | null;
		second: number | null;
		third: number | null;
	};
	batterId: number | null;
	pitcherId: number | null;
};

/**
 * MLB's editorial recap as plain text (S10): the headline and the article's
 * paragraphs, separated by blank lines. Markup, embedded players and links are
 * stripped at ingest, so views never render outside HTML.
 */
export type GameRecap = {
	headline: string;
	text: string;
};

/**
 * The box score (S2): each team's side (`BoxscoreTeam`) and MLB's game info lines, in MLB's order
 * (a line MLB sends with no value, the game's date, is kept with an empty `value` since S207).
 */
export type GameBoxscore = {
	teams: {
		away: BoxscoreTeam;
		home: BoxscoreTeam;
	};
	info: BoxscoreInfoLine[];
};

/**
 * What a video is, from MLB's content keywords (S69): a play `highlight`, the game
 * `recap`, the `condensed` game, or another `video` (interviews, lineups, analysis).
 */
export type HighlightKind = "highlight" | "recap" | "condensed" | "video";

/** One encoding of a clip as MLB lists it: its playback name (`mp4Avc`, `highBit`, `hlsCloud`) and URL. */
export type VideoRendition = {
	name: string;
	url: string;
};

export type MediaHighlight = {
	id: string;
	/** The pitch the video shows (S95): MLB's link, or a matched ABS challenge (`playLink`); null when it shows no single play. */
	playId: string | null;
	/** How `playId` was found (S95): MLB linked it (`guid` / `playIdRef`), or BT matched an ABS challenge clip to its challenge. */
	playLink?: "mlb" | "challenge";
	title: string;
	blurb: string | null;
	duration: string | null;
	imageUrl: string | null;
	/** The encoding BT plays first: MLB's `mp4Avc`, else its HLS stream (`pickPlaybackUrl`). */
	playbackUrl: string | null;
	/**
	 * Every video encoding MLB lists for the clip (`mp4Avc`, `highBit`, `hlsCloud`), one per
	 * distinct URL, for the player's quality choice (`videoQualities`); absent on older
	 * recordings, which play `playbackUrl` alone.
	 */
	renditions?: VideoRendition[];
	/** S69: what the video is; absent on older recordings. */
	kind?: HighlightKind;
	/** S69: when MLB published it (ISO instant); absent on older recordings. */
	date?: string | null;
	/** S69: the MLB team ids it features (`team_id` keywords); absent on older recordings. */
	teamIds?: number[];
	/** S69: MLB's taxonomy tags (`data-visualization`, `home-run`, …); absent on older recordings. */
	tags?: string[];
};

import type { AtBat } from "./plays.js";
import type { SavantPitch } from "./savant.js";
import type { ScoreboardWinProbability } from "./win-probability.js";

/**
 * What one at-bat meant, by MLB's own measure (S93; the play-metrics feed): the chance each
 * team wins after it (percent, 0–100), how much it moved that chance, and MLB's flags.
 * Keyed by the live feed's `atBatIndex`, so it joins `GameSnapshot.plays`.
 */
export type AtBatMetrics = {
	atBatIndex: number;
	homeWinProbability: number | null;
	awayWinProbability: number | null;
	/** Percentage points the at-bat added to the home team's chance (negative when it took some away). */
	homeWinProbabilityAdded: number | null;
	awayWinProbabilityAdded: number | null;
	keyMoment: boolean;
	/** The at-bat tied the game or changed the lead. */
	leadChange: boolean;
	scoring: boolean;
	homeRun: boolean;
	hardHit: boolean;
	strikeout: boolean;
	highLeverage: boolean;
	absChallenge: boolean;
	/** Statcast contact on the at-bat's ball in play; each figure null when nothing was measured. */
	hitData: { launchSpeed: number | null;
		launchAngle: number | null;
		totalDistance: number | null };
};

/** A game's play metrics (S93): every at-bat MLB measured, in game order. */
export type GamePlayMetrics = {
	atBats: AtBatMetrics[];
};

/**
 * The pitch a video shows, by MLB's own link (S94; GraphQL `playIdRef`): `videoId` is the
 * video's id in the content feed (`MediaHighlight.id`), `playId` the pitch's `PitchEvent.playId`.
 * It covers clips the content feed links to no play, such as ABS challenges.
 */
export type VideoPlayRef = {
	videoId: string;
	playId: string;
};

/**
 * An mlb.com story about the game (S94; GraphQL `relatedArticles`). MLB gives the article's
 * slug, not a URL; whoever shows it builds the mlb.com link from the slug.
 */
export type RelatedArticle = {
	slug: string;
	headline: string;
	blurb: string | null;
};

/** What MLB's GraphQL game content adds to a game (S94); either list may be empty. */
export type GameGraphContent = {
	videoPlayRefs: VideoPlayRef[];
	relatedArticles: RelatedArticle[];
};

/**
 * One player-of-the-game pick (S99): MLB's person id for the player, his team's id, his line as MLB
 * words it (`1.2 IP, 0 ER, K, BB`) and the win probability he added, in percentage points (40.7).
 * `summary` and `winProbabilityAdded` are null when MLB's pick leaves them out.
 */
export type PlayerOfTheGamePick = {
	playerId: number;
	teamId: number | null;
	summary: string | null;
	winProbabilityAdded: number | null;
};

/**
 * MLB's player of the game (S99): the media's pick and the fans' pick, each absent until MLB names
 * a player for it. Never an object with neither: a game with no pick has no `playerOfTheGame`.
 */
export type PlayerOfTheGame = {
	media?: PlayerOfTheGamePick;
	fan?: PlayerOfTheGamePick;
};

/** One piece of a team's uniform in a game (S101): MLB's code (`146_jersey_1_2026`), its name and its kind ("Jersey", "Pants", "Cap"). */
export type UniformAssetWorn = {
	code: string;
	text: string;
	type: string;
};

/**
 * What each team wore in a game (S101): each side's assets, in MLB's order. A side MLB lists nothing for is absent,
 * and a game with neither has no `uniforms`.
 */
export type GameUniforms = {
	home?: UniformAssetWorn[];
	away?: UniformAssetWorn[];
};

/**
 * How a rule setting's value reads (S100), from MLB's `valueType`: `percent` (53.5 means 53.5%, of the batter's height
 * for the strike zone's top and bottom), `number` (a count, or inches where the description says so, as the zone's
 * width and depth), `boolean` (the rule is on) or `text` (a named mode, as `absType`'s `challengeABS`).
 */
export type GameRuleSettingUnit = "percent" | "number" | "boolean" | "text";

/**
 * One rule a game was played under (S100), from MLB's `ruleSettings`: its stable `name` (`strikeZoneTopFactor`), MLB's
 * `label` ("Strike Zone Top") and description, its value and the unit to read the value in.
 */
export type GameRuleSetting = {
	name: string;
	label: string;
	description: string;
	value: number | boolean | string;
	unit: GameRuleSettingUnit;
};

export type GameSnapshot = {
	gamePk: number;
	gameDate: string; // YYYY-MM-DD (schedule date)
	officialDate: string;
	/**
	 * First pitch as an ISO instant, from the live feed's `gameData.datetime.dateTime`. The
	 * active window is measured from it (`isGameInActiveWindow`, #71); absent on snapshots
	 * stored before it existed, which fall back to a mid-afternoon assumption.
	 */
	startTime?: string;
	status: {
		abstractGameState: string;
		codedGameState: GameStatusCode | string;
		detailedState: string;
	};
	/**
	 * When BT saw the game turn suspended (`T`/`U`, #79): the ISO time of the write that stored
	 * the change (`suspendedSince`), kept while it stays suspended and dropped when it resumes.
	 * A suspended game is polled for `suspendedHours` from it (#323). Absent when the game isn't
	 * suspended, or BT didn't see the change happen, when the window counts from first pitch.
	 */
	suspendedAt?: string;
	teams: {
		home: AbstractTeam;
		away: AbstractTeam;
	};
	venue: { id: number;
		name: string } | null;
	linescore: LinescoreSummary | null;
	highlights: MediaHighlight[];
	plays: AtBat[];
	/** The box score (S2); absent until MLB has one, and on older recordings. */
	boxscore?: GameBoxscore;
	/** MLB's editorial recap (S10); absent until MLB publishes one. */
	recap?: GameRecap;
	/**
	 * MLB's per-at-bat win probability and key-moment flags (S93). Absent when the feed
	 * (an internal mlb.com source) failed or had nothing: the game is served as before.
	 */
	playMetrics?: GamePlayMetrics;
	/**
	 * The pitch each video shows, where MLB links one (S94). Absent when MLB's GraphQL game
	 * content (a persisted query MLB may retire) failed or had no links: the game is served as before.
	 */
	videoPlayRefs?: VideoPlayRef[];
	/** mlb.com stories about the game (S94); absent, like `videoPlayRefs`, when the source failed or had none. */
	relatedArticles?: RelatedArticle[];
	/**
	 * MLB's player of the game (S99), asked by ingest only for a regular-season or postseason game from 2024 on that is
	 * over (`playerOfTheGameExpected`), while BT still refreshes it (its ingest window, a cold read, a re-check), and only
	 * until both sides are stored. Each side, once stored, is kept (`keepPlayerOfTheGame`): a later failed or slow request
	 * never clears it. Absent until MLB names a pick BT has asked for (an older finished game that BT no longer refreshes
	 * gets none here; filling those is #619's), and then the game is served as before.
	 */
	playerOfTheGame?: PlayerOfTheGame;
	/**
	 * What each team wore (S101), asked by ingest off the game fetch (`withAskedExtras`) while none is stored, when it
	 * first stores the game, sees its status change, or writes a final game (`askedExtraDue`), so a live poll at an
	 * unchanged status never asks again for a value settled before first pitch. Once stored it is kept
	 * (`keepStoredExtras`): a later write that didn't ask, or whose ask failed or ran past its limit, never clears it.
	 * Absent until MLB lists one BT has asked for, and then the game is served as before. A final game BT no longer
	 * refreshes (past its re-check window, which the backfill skips as already stored) gets none here: #619's scope.
	 */
	uniforms?: GameUniforms;
	/**
	 * The rules the game was played under (S100), in MLB's order: the strike zone its ABS challenges were judged against
	 * (`strikeZoneTopFactor` and `strikeZoneBottomFactor` as a share of the batter's height, `strikeZoneWidth` in inches)
	 * and its other settings (designated hitter, pitch timer, challenges…). Asked and kept as the uniforms are: by ingest
	 * off the game fetch (`withAskedExtras`) while none is stored, when it first stores the game, sees its status change,
	 * or writes a final game (`askedExtraDue`), and kept once stored (`keepStoredExtras`). Absent until MLB lists any BT
	 * has asked for, and then the game is served as before. A final game BT no longer refreshes (past its re-check
	 * window, which the backfill skips as already stored) gets none here: #619's scope.
	 */
	ruleSettings?: GameRuleSetting[];
	/**
	 * Baseball Savant's figures for each pitch (S103), only those MLB's own feeds lack, joined to the live feed's pitches
	 * by `playId`. Pulled by the game's ingest object on its own cadence (`savantPullDue`), never with the live feed, and
	 * merged in as Savant publishes them (`mergeSavantPitches`): a figure is absent until it arrives, and every game write
	 * keeps the stored ones (`keepStoredExtras`). Absent when Savant failed or had nothing: the game is served as before.
	 */
	savant?: SavantPitch[];
	/** Who is on base and who is batting and pitching (S63); `null` unless in progress, absent on older recordings. */
	live?: GameLive | null;
	fetchedAt: string; // ISO
	windowMode: "active" | "cache";
	/** ADR-022: monotonic per game; bumps only when the content changes (`stampVersion`). */
	version: number;
	/** ISO time the content last changed — not the last poll, which is `fetchedAt`. */
	lastChangedAt: string;
};

/** A team's season record (S65; the scoreboard module's `81-62`). */
export type TeamRecord = {
	wins: number;
	losses: number;
};

/** A team on the scoreboard (S65): the team, and its record when MLB sent one. */
export type ScheduleTeam = AbstractTeam & {
	record?: TeamRecord | null;
};

/** A player named on the scoreboard (pitchers of record). */
export type PlayerRef = {
	id: number;
	fullName: string;
};

/** A probable pitcher with his season line (S65; the module's "W-L, ERA"); nulls when MLB sent none. */
export type ProbablePitcher = PlayerRef & {
	wins: number | null;
	losses: number | null;
	era: string | null;
	/**
	 * The hand he throws with, MLB's `pitchHand.code` (`"L"` / `"R"`; S171, the row's
	 * `J. Steele (L)`); `null` when MLB sent none. Optional because schedule rows stored
	 * before S171 have no such field.
	 */
	pitchHand?: string | null;
};

/** The pitchers of record of a finished game (S65; W / L / S). */
export type GameDecisions = {
	winner: PlayerRef | null;
	loser: PlayerRef | null;
	save: PlayerRef | null;
};

/**
 * The live moment on the scoreboard (S65): S63's runners and matchup, plus the count,
 * and who is batting and pitching by name for the count slot's "AB / P" lines (S67).
 */
export type ScheduleLive = GameLive & {
	batterName: string | null;
	pitcherName: string | null;
	balls: number | null;
	strikes: number | null;
	outs: number | null;
};

export type ScheduleGameSummary = {
	gamePk: number;
	gameDate: string;
	officialDate: string;
	/**
	 * MLB's game type code as sent (S167): `R` regular season, `S` spring training, `E` exhibition,
	 * `A` All-Star, `F`/`D`/`L`/`W` postseason rounds, any other code kept as it is. Absent when MLB
	 * sent none, and on a game stored before S167 until the backfill re-stores its day.
	 */
	gameType?: string;
	/** First pitch as an ISO instant (S65); views show it in the viewer's zone (`formatGameTime`). */
	startTime?: string;
	status: GameSnapshot["status"];
	teams: {
		home: ScheduleTeam;
		away: ScheduleTeam;
	};
	venue: GameSnapshot["venue"];
	linescore: LinescoreSummary | null;
	/** Before the game: who is expected to start (S65). */
	probablePitchers?: {
		away: ProbablePitcher | null;
		home: ProbablePitcher | null;
	};
	/** After the game: the pitchers of record (S65); `null` until MLB names them. */
	decisions?: GameDecisions | null;
	/** During the game: runners, matchup and count (S65); `null` unless in progress. */
	live?: ScheduleLive | null;
	/**
	 * The home team's win-probability line so far (S161, `scoreboardWinProbability`): set on every game a served day
	 * carries, `null` for a pregame game or one with no measured at-bat; absent on a day as MLB's schedule is fetched,
	 * which carries no play metrics.
	 */
	winProbability?: ScoreboardWinProbability | null;
};

export type ScheduleDay = {
	date: string; // YYYY-MM-DD
	games: ScheduleGameSummary[];
	fetchedAt: string;
	windowMode: "active" | "cache";
	/** ADR-022: monotonic per day; bumps only when the content changes (`stampVersion`). */
	version: number;
	/** ISO time the content last changed — not the last poll, which is `fetchedAt`. */
	lastChangedAt: string;
};

export type PatronTier =
  "none" | "Backer" | "Pro Backer" | "Star Backer" | "Premium Sponsor";

export type Entitlements = {
	tier: PatronTier;
	fasterLiveRefresh: boolean;
	cloudSyncedSettings: boolean;
	savantLinks: boolean;
	/**
	 * May pick a stats site other than MLB.com for player links (S209; owner, 2026-11-24: "Every patron,
	 * Backer and up (Recommended)"). Never stored: `entitlementsForTier` derives it from the tier wherever entitlements
	 * are read, so a row or a session signed before S209 can't lack it where it matters.
	 */
	statsProviderChoice: boolean;
};

/** What a user may administer. Lives in BT, not the identity provider (ADR-019: no provider RBAC). */
export type Role = "member" | "admin";

export type UserProfile = {
	/** BT's own user ID (ADR-019); provider accounts link to it, never the reverse. */
	uid: string;
	/** Every account has an email (owner, 2026-10-28: "It should be impossible for an account to have no email."; S82). */
	email: string;
	displayName: string | null;
	patreonUserId: string | null;
	role: Role;
	entitlements: Entitlements;
	createdAt: string;
	updatedAt: string;
};

/**
 * What BT's own signed session carries (ADR-019): enough to authorize an
 * ordinary request without reading Postgres or calling the identity provider.
 * Role and entitlements are a copy as of sign-in, so a change reaches the
 * session when it is next issued. Times are Unix seconds.
 */
export type BtSession = {
	uid: string;
	role: Role;
	entitlements: Entitlements;
	issuedAt: number;
	expiresAt: number;
	/**
	 * When the identity provider last made the user sign in, as the provider signed it
	 * (`IdentityClaims.authTime`, S120). Account deletion's recent-sign-in check reads this, not
	 * `issuedAt`: a still-valid provider token can be traded for a new session without a new
	 * sign-in. Absent on sessions issued before S120 or from a provider that didn't say, which
	 * deletion treats as not recent.
	 */
	authTime?: number;
};

/**
 * One team's row in a standings table.
 *
 * MLB reports games-back and the elimination figures as strings, using `"-"`
 * for "not applicable". The mapper normalizes that sentinel to `null` so the
 * UI never has to special-case a dash.
 */
export type StandingsTeamRecord = {
	teamId: number;
	name: string;
	abbreviation: string | null;
	wins: number;
	losses: number;
	pct: string | null;
	gamesBack: string | null;
	divisionRank: number | null;
	streak: string | null;
	runsScored: number | null;
	runsAllowed: number | null;
	runDifferential: number | null;
	divisionLeader: boolean;
	clinched: boolean;
	/**
	 * How the team clinched (S160): MLB's letter as it sends it on a `clinched` team (`z` best record
	 * in the league, `y` division, `w` wild card, `x` playoff spot, or any other letter MLB adds, which
	 * is shown as it is: owner, 2026-11-20, "Print it anyway"). `null` on a team that isn't `clinched`
	 * or when MLB sends none. Optional because an answer cached before S160 lacks it, which means no letter.
	 */
	clinchIndicator?: string | null;
	eliminationNumber: string | null;
};

export type StandingsDivision = {
	divisionId: number | null;
	/** The table's full name from MLB (`American League East`), or its league's (`American League`) for a league table before 1969. */
	name: string | null;
	/**
	 * MLB's short name for the division (`AL East`; S102, from `hydrate=division`), what the Standings
	 * headings show. `null` on a league table and when MLB sends none. Optional because an answer
	 * cached before S102 lacks it; the heading then falls back to `name` until that entry expires.
	 */
	nameShort?: string | null;
	/** MLB's abbreviation for the division (`ALE`; S102), `null` and optional as `nameShort` is. */
	abbreviation?: string | null;
	leagueId: number | null;
	teams: StandingsTeamRecord[];
};

/**
 * Which table a standings payload is (S128): the day's regular-season standings, a season's
 * final regular-season table (after the regular season until the next spring), or spring
 * training's standings as of the day.
 */
export type StandingsPhaseName = "regularSeason" | "final" | "spring";

/**
 * A part of the season the standings answer one table for (S139; owner, 2026-11-13: "it should
 * categorize the results based on the season phase"). `spring` and `regularSeason` are
 * `StandingsPhaseName`'s; `final` is not a phase (it is the regular season's table once the regular
 * season is over), and `playoffs` is the teams that made the postseason.
 */
export type SeasonPhaseName = "spring" | "regularSeason" | "playoffs";

/** Every season phase, in the order the season runs them: the one list callers iterate and validate against. */
export const SEASON_PHASES: readonly SeasonPhaseName[] = ["spring", "regularSeason", "playoffs"];

export type StandingsSnapshot = {
	/** The day the table stands as of; for a `final` table, its season's `regularSeasonEndDate`. */
	date: string; // YYYY-MM-DD
	/** Which table this is (S128); absent on snapshots read before S128 (recorded fixtures). */
	phase?: StandingsPhaseName;
	/** MLB's season id of the table (S128): the year it was played. */
	season?: number;
	divisions: StandingsDivision[];
	fetchedAt: string;
	windowMode: "active" | "cache";
};

/** A player's season line for one stat group, as BT displays it. */
export type PlayerSeasonLine = {
	season: string;
	group: string; // "hitting" | "pitching" | "fielding"
	teamId: number | null;
	gamesPlayed: number | null;
	avg: string | null;
	obp: string | null;
	slg: string | null;
	ops: string | null;
	homeRuns: number | null;
	rbi: number | null;
	era: string | null;
	wins: number | null;
	losses: number | null;
	strikeOuts: number | null;
	inningsPitched: string | null;
};

/** Identity + season bag for one player. */
export type PlayerProfile = {
	playerId: number;
	fullName: string;
	boxscoreName: string | null;
	primaryNumber: string | null;
	position: string | null;
	batSide: string | null;
	pitchHand: string | null;
	birthDate: string | null;
	currentAge: number | null;
	active: boolean;
	seasons: PlayerSeasonLine[];
};

export type FreshnessMeta = {
	fetchedAt: string;
	windowMode: "active" | "cache";
	stale: boolean;
};
