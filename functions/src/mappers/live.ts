/**
 * Pure upstream → BT mappers for the live feed (play-by-play + Statcast).
 *
 * Highlights are sourced from the content endpoint (`/game/{pk}/content`), not
 * the live feed hydrate — the live feed carries no playback URLs. See
 * `./content.ts`.
 */
import type {
	AtBat,
	AtBatChallenge,
	BoxscoreBatter,
	BoxscoreInfoGroup,
	BoxscoreInfoLine,
	BoxscorePitcher,
	BoxscoreTeam,
	GameBoxscore,
	GameLive,
	GameSnapshot,
	PitchEvent,
	ScheduleGameSummary,
	Unversioned,
} from "@bt/domain";
import { isLiveStatus } from "@bt/domain";
import type {
	LiveBoxscore,
	LiveBoxscoreInfoLabel,
	LiveBoxscoreTeam,
	LiveFeedResponse,
	LiveGamePlay,
	LiveGamePlayEvent,
	Person,
	PitchData as UpstreamPitchData,
} from "@bt/mlb-api";
import {
	mapDecisions, mapLinescore, mapProbable, mapRecord, mapStatus, mapTeam,
} from "./schedule.js";

function mapPitchData(pitch: UpstreamPitchData | undefined): PitchEvent["pitchData"]
{
	const coords = pitch?.coordinates;
	if (!pitch || !coords || coords.pX === undefined || coords.pZ === undefined)
	{
		return null;
	}
	return {
		startSpeed: pitch.startSpeed ?? 0,
		endSpeed: pitch.endSpeed ?? 0,
		strikeZoneTop: pitch.strikeZoneTop ?? 0,
		strikeZoneBottom: pitch.strikeZoneBottom ?? 0,
		zone: pitch.zone ?? null,
		plateTime: pitch.plateTime ?? null,
		extension: pitch.extension ?? null,
		coordinates: {
			pX: coords.pX,
			pZ: coords.pZ,
			x0: coords.x0 ?? 0,
			y0: coords.y0 ?? 0,
			z0: coords.z0 ?? 0,
			vx0: coords.vX0 ?? 0,
			vy0: coords.vY0 ?? 0,
			vz0: coords.vZ0 ?? 0,
			ax: coords.aX ?? 0,
			ay: coords.aY ?? 0,
			az: coords.aZ ?? 0,
			pfxX: coords.pfxX ?? 0,
			pfxZ: coords.pfxZ ?? 0,
		},
		breaks: pitch.breaks
			? {
				breakAngle: pitch.breaks.breakAngle ?? 0,
				breakLength: pitch.breaks.breakLength ?? 0,
				spinRate: pitch.breaks.spinRate ?? 0,
				breakHorizontal: pitch.breaks.breakHorizontal ?? null,
				breakVertical: pitch.breaks.breakVertical ?? null,
			}
			: null,
	};
}

export function mapPitchEvent(event: LiveGamePlayEvent): PitchEvent
{
	return {
		pitchNumber: event.pitchNumber ?? event.index,
		playId: event.playId ?? "",
		startTime: event.startTime ?? "",
		details: {
			call: event.details?.call?.code ?? null,
			callDescription: event.details?.call?.description ?? null,
			type: event.details?.type?.code ?? null,
			typeDescription: event.details?.type?.description ?? null,
			isBall: event.details?.isBall ?? false,
			isStrike: event.details?.isStrike ?? false,
			isInPlay: event.details?.isInPlay ?? false,
			ballColor: event.details?.ballColor ?? null,
		},
		count: {
			balls: event.count?.balls ?? 0,
			strikes: event.count?.strikes ?? 0,
			outs: event.count?.outs ?? 0,
		},
		pitchData: mapPitchData(event.pitchData),
		hitData: event.hitData
			? {
				launchSpeed: event.hitData.launchSpeed ?? 0,
				launchAngle: event.hitData.launchAngle ?? 0,
				totalDistance: event.hitData.totalDistance ?? 0,
				trajectory: event.hitData.trajectory ?? "",
				coordinates: {
					coordX: event.hitData.coordinates?.coordX ?? 0,
					coordY: event.hitData.coordinates?.coordY ?? 0,
				},
			}
			: null,
	};
}

/**
 * The at-bat's challenge (S95), from `reviewDetails` on the play itself or on one of its events
 * (823823: the play for at-bats 34, 69, 83; a pitch for 39 and 82). Only a review MLB credits to
 * a challenging team counts.
 */
function mapChallenge(play: LiveGamePlay): AtBatChallenge | undefined
{
	const onEvent = play.playEvents.find((event) => event.reviewDetails?.challengeTeamId !== undefined);
	const review = play.reviewDetails?.challengeTeamId !== undefined ? play.reviewDetails : onEvent?.reviewDetails;
	if (review?.challengeTeamId === undefined) return undefined;
	return {
		teamId: review.challengeTeamId,
		overturned: review.isOverturned ?? false,
		playId: review === onEvent?.reviewDetails && onEvent.isPitch && onEvent.playId ? onEvent.playId : null,
	};
}

export function mapAtBat(play: LiveGamePlay): AtBat
{
	const challenge = mapChallenge(play);
	return {
		about: {
			atBatIndex: play.about.atBatIndex,
			halfInning: play.about.isTopInning ? "top" : "bottom",
			inning: play.about.inning,
			isComplete: play.about.isComplete ?? false,
			isScoringPlay: play.about.isScoringPlay ?? false,
		},
		result: {
			event: play.result.event ?? "",
			description: play.result.description ?? "",
			eventType: play.result.eventType ?? "",
			isOut: play.result.isOut ?? false,
			rbi: play.result.rbi ?? 0,
			awayScore: play.result.awayScore ?? null,
			homeScore: play.result.homeScore ?? null,
		},
		matchup: {
			batter: {
				id: play.matchup?.batter?.id ?? 0,
				fullName: play.matchup?.batter?.fullName ?? "",
			},
			pitcher: {
				id: play.matchup?.pitcher?.id ?? 0,
				fullName: play.matchup?.pitcher?.fullName ?? "",
			},
			batSide: play.matchup?.batSide?.code ?? null,
			pitchHand: play.matchup?.pitchHand?.code ?? null,
		},
		count: {
			balls: play.count?.balls ?? 0,
			strikes: play.count?.strikes ?? 0,
			outs: play.count?.outs ?? 0,
		},
		pitches: play.playEvents.filter((event) => event.isPitch).map(mapPitchEvent),
		...challenge && {
			challenge,
		},
	};
}

/** MLB's `gameData.players`, keyed `ID<personId>`: where a player's last name and `lastInitName` live. */
type GamePlayers = Record<string, Person> | undefined;

/**
 * A team's batting lines in batting order (S2): everyone MLB lists with a batting-order
 * slot, starters and substitutes alike; pitchers who never batted have none and are left
 * out. MLB's `batters` array is already in order of appearance. Since S207 each line also
 * carries what the live baseball.theater (v2) draws: the last name from `gameData.players`
 * (`players`), every position played, MLB's substitute note marker (`a-`), whether he came
 * in as a substitute, and his season OPS.
 */
export function mapBoxscoreBatting(team: LiveBoxscoreTeam | undefined, players?: GamePlayers): BoxscoreBatter[]
{
	return (team?.batters ?? []).flatMap((id) =>
	{
		const player = team?.players?.[`ID${id}`];
		if (!player?.battingOrder) return [];
		const line = player.stats?.batting;
		const lastName = players?.[`ID${id}`]?.lastName;
		return [{
			id,
			fullName: player.person?.fullName ?? "",
			position: player.position?.abbreviation ?? "",
			battingOrder: player.battingOrder,
			atBats: line?.atBats ?? 0,
			runs: line?.runs ?? 0,
			hits: line?.hits ?? 0,
			rbi: line?.rbi ?? 0,
			baseOnBalls: line?.baseOnBalls ?? 0,
			strikeOuts: line?.strikeOuts ?? 0,
			avg: player.seasonStats?.batting?.avg ?? null,
			...lastName && {
				lastName,
			},
			positions: (player.allPositions ?? []).flatMap((p) => (p.abbreviation ? [p.abbreviation] : [])),
			note: line?.note ?? null,
			isSubstitute: player.gameStatus?.isSubstitute ?? false,
			ops: player.seasonStats?.batting?.ops ?? null,
		}];
	});
}

/**
 * A team's pitching lines (S207) in MLB's order (`pitchers`: the order they pitched), each MLB's own
 * numbers for this game and his season ERA / WHIP after it. A pitcher MLB lists with no pitching line
 * for this game is left out, as v2 leaves him out.
 */
export function mapBoxscorePitching(team: LiveBoxscoreTeam | undefined, players?: GamePlayers): BoxscorePitcher[]
{
	return (team?.pitchers ?? []).flatMap((id) =>
	{
		const player = team?.players?.[`ID${id}`];
		const line = player?.stats?.pitching;
		if (!player || !line || Object.keys(line).length === 0) return [];
		const fullName = player.person?.fullName ?? "";
		return [{
			id,
			fullName,
			lastInitName: players?.[`ID${id}`]?.lastInitName ?? fullName,
			inningsPitched: line.inningsPitched ?? "0.0",
			hits: line.hits ?? 0,
			runs: line.runs ?? 0,
			earnedRuns: line.earnedRuns ?? 0,
			baseOnBalls: line.baseOnBalls ?? 0,
			strikeOuts: line.strikeOuts ?? 0,
			homeRuns: line.homeRuns ?? 0,
			battersFaced: line.battersFaced ?? 0,
			era: player.seasonStats?.pitching?.era ?? null,
			whip: player.seasonStats?.pitching?.whip ?? null,
		}];
	});
}

/** MLB's `{ label, value }` lines with a label and a value, as sent. */
function labelledLines(lines: readonly LiveBoxscoreInfoLabel[] | undefined): BoxscoreInfoLine[]
{
	return (lines ?? []).flatMap((line) => (line.label && line.value ? [{
		label: line.label,
		value: line.value,
	}] : []));
}

/**
 * One team's side (S207): batting, pitching, its detail groups as MLB groups them (`info`: a group
 * with no lines is dropped, so a group MLB doesn't send is never drawn empty) and its lettered notes.
 */
function mapBoxscoreTeam(team: LiveBoxscoreTeam | undefined, players: GamePlayers): BoxscoreTeam
{
	return {
		batting: mapBoxscoreBatting(team, players),
		pitching: mapBoxscorePitching(team, players),
		details: (team?.info ?? []).flatMap((group): BoxscoreInfoGroup[] =>
		{
			const lines = labelledLines(group.fieldList);
			return group.title && lines.length > 0 ? [{
				title: group.title,
				lines,
			}] : [];
		}),
		notes: labelledLines(team?.note),
	};
}

/**
 * The box score (S2), or `undefined` before MLB has one. `info` keeps MLB's own
 * label/value lines in MLB's order; since S207 the line MLB sends with a label and no
 * value (the game's date, which v2 prints last) is kept with an empty `value`.
 * `players` is the feed's `gameData.players`, for the names v2 prints (S207).
 */
export function mapBoxscore(boxscore: LiveBoxscore | undefined, players?: GamePlayers): GameBoxscore | undefined
{
	if (!boxscore?.teams) return undefined;
	return {
		teams: {
			away: mapBoxscoreTeam(boxscore.teams.away, players),
			home: mapBoxscoreTeam(boxscore.teams.home, players),
		},
		info: (boxscore.info ?? []).flatMap((line) => (line.label ? [{
			label: line.label,
			value: line.value ?? "",
		}] : [])),
	};
}

/**
 * The live moment (S63): runners from `linescore.offense`, batter and pitcher from
 * the current play's matchup — only while the game is in progress or suspended
 * (`isLiveStatus`; a suspended game shows where play stopped, #79), since a final or
 * scheduled game has no one on base or at the plate.
 */
export function mapLive(feed: LiveFeedResponse): GameLive | null
{
	if (!isLiveStatus(feed.gameData.status.codedGameState ?? "")) return null;
	const offense = feed.liveData.linescore?.offense;
	const matchup = feed.liveData.plays.currentPlay?.matchup;
	return {
		runners: {
			first: offense?.first?.id ?? null,
			second: offense?.second?.id ?? null,
			third: offense?.third?.id ?? null,
		},
		batterId: matchup?.batter?.id ?? null,
		pitcherId: matchup?.pitcher?.id ?? null,
	};
}

/**
 * Maps the live feed onto a `GameSnapshot`. Highlights come from the content
 * endpoint, so callers merge those in separately (see `mapContentHighlights`).
 */
export function mapLiveFeed(
	feed: LiveFeedResponse,
	fetchedAt: string,
	windowMode: GameSnapshot["windowMode"] = "cache",
): Unversioned<GameSnapshot>
{
	const { gameData, liveData } = feed;
	const officialDate =
		gameData.datetime?.officialDate ?? gameData.datetime?.originalDate ?? "";
	return {
		gamePk: feed.gamePk,
		gameDate: officialDate,
		officialDate,
		// First pitch: `gameDate` is only the date, and the active window needs the instant (#71).
		startTime: gameData.datetime?.dateTime,
		status: mapStatus(gameData.status),
		teams: {
			home: mapTeam(gameData.teams.home),
			away: mapTeam(gameData.teams.away),
		},
		venue: {
			id: gameData.venue.id,
			name: gameData.venue.name,
		},
		linescore: mapLinescore(liveData.linescore),
		highlights: [],
		plays: liveData.plays.allPlays.map(mapAtBat),
		boxscore: mapBoxscore(liveData.boxscore, gameData.players),
		live: mapLive(feed),
		fetchedAt,
		windowMode,
	};
}

/**
 * A scoreboard summary from the live feed (S65) — how a game looks on the scoreboard
 * at any moment of its recorded replay, before, during or after it. Records and
 * probables come from `gameData` (each probable's throwing hand from `gameData.players`);
 * each probable's season line from the boxscore;
 * the live moment is `mapLive` plus the count; the game type (S167) is the feed's
 * `gameData.game.type`, the same code the schedule sends as `gameType`.
 */
export function mapLiveFeedSummary(feed: LiveFeedResponse): ScheduleGameSummary
{
	const { gameData, liveData } = feed;
	const snapshot = mapLiveFeed(feed, "");
	const live = mapLive(feed);
	const probable = (side: "away" | "home") =>
	{
		const named = gameData.probablePitchers?.[side];
		// The feed names a probable by id and name only; his throwing hand (S171) is on his
		// `gameData.players` entry, as the schedule's hydrated person carries it.
		const person = named ? {
			...named,
			pitchHand: named.pitchHand ?? gameData.players?.[`ID${named.id}`]?.pitchHand,
		} : undefined;
		const season = person ? liveData.boxscore?.teams?.[side]?.players?.[`ID${person.id}`]?.seasonStats?.pitching : undefined;
		return mapProbable(person, season);
	};
	return {
		gamePk: snapshot.gamePk,
		gameDate: snapshot.gameDate,
		officialDate: snapshot.officialDate,
		...(gameData.game?.type !== undefined ? {
			gameType: gameData.game.type,
		} : {}),
		startTime: snapshot.startTime,
		status: snapshot.status,
		teams: {
			home: {
				...snapshot.teams.home,
				record: mapRecord(gameData.teams.home.record),
			},
			away: {
				...snapshot.teams.away,
				record: mapRecord(gameData.teams.away.record),
			},
		},
		venue: snapshot.venue,
		linescore: snapshot.linescore,
		probablePitchers: {
			away: probable("away"),
			home: probable("home"),
		},
		decisions: mapDecisions(liveData.decisions),
		live: live ? {
			...live,
			batterName: liveData.plays.currentPlay?.matchup?.batter?.fullName ?? null,
			pitcherName: liveData.plays.currentPlay?.matchup?.pitcher?.fullName ?? null,
			balls: liveData.linescore?.balls ?? null,
			strikes: liveData.linescore?.strikes ?? null,
			outs: liveData.linescore?.outs ?? null,
		} : null,
	};
}
