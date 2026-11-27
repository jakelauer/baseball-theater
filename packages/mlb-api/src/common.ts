/**
 * Shared MLB Stats API building blocks.
 *
 * These mirror upstream payload shapes only. BT product types live in
 * `@bt/domain` and must not be re-declared or re-exported from this package.
 */
import type { PersonStatSplit } from "./stats.js";

/**
 * `{ id, name, link }` — the shape MLB returns for most referenced entities.
 * A named ref is a plain `MlbLink` that also carries a name, which is how the
 * parser builds it (`mlbRefSchema = mlbLinkSchema.extend({ name })`).
 */
export interface MlbRef extends MlbLink {
	name: string;
}

/**
 * A pointer with no name attached: MLB returns `{ id, link }` for a team's
 * spring venue and for `gameData.officialVenue`, where the caller is expected
 * to follow the link.
 */
export interface MlbLink {
	id: number;
	link?: string;
}

/** Spring-training leagues carry an abbreviation the other refs do not. */
export interface SpringLeague extends MlbRef {
	abbreviation?: string;
}

/** Team as embedded in schedule/live payloads. */
export interface MlbTeam extends MlbRef {
	abbreviation?: string;
	teamName?: string;
	clubName?: string;
	shortName?: string;
	locationName?: string;
	franchiseName?: string;
	teamCode?: string;
	fileCode?: string;
	firstYearOfPlay?: string;
	allStarStatus?: string;
	active?: boolean;
	league?: MlbRef;
	division?: MlbRef;
	sport?: MlbRef;
	springLeague?: SpringLeague;
	venue?: MlbRef;
	springVenue?: MlbLink;
	season?: number;
	record?: TeamRecord;
}

/** The standings block hydrated onto a team in the live feed. */
export interface TeamRecord {
	wins?: number;
	losses?: number;
	winningPercentage?: string;
	gamesPlayed?: number;
	divisionLeader?: boolean;
	leagueRecord?: LeagueRecord;
	conferenceGamesBack?: string;
	divisionGamesBack?: string;
	leagueGamesBack?: string;
	sportGamesBack?: string;
	springLeagueGamesBack?: string;
	wildCardGamesBack?: string;
	/** Split records (home/away, last ten, …). Empty in every recorded payload. */
	records?: unknown;
}

export interface LeagueRecord {
	wins: number;
	losses: number;
	ties?: number;
	pct: string;
}

/** Game status block — identical in schedule and live feed payloads. */
export interface GameStatus {
	abstractGameState: string;
	codedGameState?: string;
	detailedState: string;
	statusCode?: string;
	abstractGameCode?: string;
	startTimeTBD?: boolean;
	/** Why a game ended as it did when MLB says (`"Tied"`, the 2002 All-Star Game). */
	reason?: string;
}

export interface Venue extends MlbRef {
	active?: boolean;
	season?: string;
	location?: VenueLocation;
	timeZone?: VenueTimeZone;
	fieldInfo?: VenueFieldInfo;
}

export interface VenueLocation {
	city?: string;
	state?: string;
	stateAbbrev?: string;
	country?: string;
	address1?: string;
	postalCode?: string;
	phone?: string;
	elevation?: number;
	/** Degrees from true north to centre field — used for sun/shade math. */
	azimuthAngle?: number;
	defaultCoordinates?: GeoCoordinates;
}

export interface GeoCoordinates {
	latitude?: number;
	longitude?: number;
}

export interface VenueTimeZone {
	id?: string;
	offset?: number;
	offsetAtGameTime?: number;
	tz?: string;
}

export interface VenueFieldInfo {
	capacity?: number;
	turfType?: string;
	roofType?: string;
	leftLine?: number;
	leftCenter?: number;
	center?: number;
	rightCenter?: number;
	rightLine?: number;
}

/**
 * People come back keyed by `fullName`, not the `name` every other MLB ref
 * uses — so this deliberately does not extend `MlbRef`. Schedule and live
 * payloads hydrate the same person to different depths; everything past `id`
 * is optional for that reason.
 */
export interface Person {
	id: number;
	link?: string;
	fullName?: string;
	firstName?: string;
	lastName?: string;
	middleName?: string;
	boxscoreName?: string;
	primaryNumber?: string;
	primaryPosition?: Position;
	birthDate?: string;
	birthCity?: string;
	birthStateProvince?: string;
	birthCountry?: string;
	/** A retired player's death and last game, which older records carry (#359). */
	deathDate?: string;
	deathCity?: string;
	deathStateProvince?: string;
	deathCountry?: string;
	lastPlayedDate?: string;
	currentAge?: number;
	height?: string;
	weight?: number;
	active?: boolean;
	gender?: string;
	isPlayer?: boolean;
	isVerified?: boolean;
	draftYear?: number;
	mlbDebutDate?: string;
	pronunciation?: string;
	nickName?: string;
	nameSuffix?: string;
	nameTitle?: string;
	nameSlug?: string;
	nameFirstLast?: string;
	nameMatrilineal?: string;
	useName?: string;
	useLastName?: string;
	initLastName?: string;
	firstLastName?: string;
	lastFirstName?: string;
	lastInitName?: string;
	fullFMLName?: string;
	fullLFMName?: string;
	batSide?: CodedDescription;
	pitchHand?: CodedDescription;
	/** Personalized strike zone in feet, when MLB has measured one. */
	strikeZoneTop?: number;
	strikeZoneBottom?: number;
	stats?: PersonStatSplit[];
	/** The person's ids on other sites (`hydrate=xrefId`, S209): BT reads its `fangraphs` and `lahman` ones (see `PersonXref`). */
	xrefIds?: PersonXref[];
}

/**
 * One cross-reference MLB keeps for a person (`hydrate=xrefId`): an id on another site (`retrosheet`, `lahman`,
 * `fangraphs`, `espn`, `bis`, social accounts…) and the season MLB linked it, when it says. It has no
 * Baseball-Reference type; `lahman`, the Lahman database's id, matched Baseball-Reference's for every recorded player
 * that had one (28 of 33 for 823823; the five 2026 rookies had none). S209 takes the Chadwick register's ids first
 * and fills a gap from `fangraphs` and `lahman` (`mapPeopleXrefs`).
 */
export interface PersonXref {
	xrefId?: string;
	xrefType?: string;
	season?: string;
}

export interface Position {
	code?: string;
	name?: string;
	type?: string;
	abbreviation?: string;
}

/** `{ code, description }` — used for bat side, pitch hand, call types. */
export interface CodedDescription {
	code: string;
	description: string;
}

/**
 * MLB reports most per-team blocks as an away/home pair. One generic keeps the
 * variants (review counts, mound visits, boxscore sides) from re-declaring it.
 */
export interface HomeAwayPair<T> {
	away?: T;
	home?: T;
}

/** The live count. Both a play and the linescore report it. */
export interface CountState {
	balls?: number;
	strikes?: number;
	outs?: number;
}

/** `{ remaining, used }` — challenges left, mound visits left, and the like. */
export interface TeamUsageCount {
	remaining?: number;
	used?: number;
}
