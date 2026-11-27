/**
 * Baseball Savant's per-pitch game feed (`baseballsavant.mlb.com/gf?game_pk={gamePk}`; S103): every pitch of a game,
 * keyed by the live feed's `playId`, with Savant's own figures beside a copy of MLB's. An internal, unversioned feed
 * Savant's game page calls, so it may change without notice; BT treats it as optional. Its answer says only that it is
 * built from MLB's game feed and cached (`source: "gamefeed"`, `cacheKey`), never when Savant computed a figure.
 *
 * Only the pitch rows are typed field by field (`team_home` / `team_away`, every pitch once). The rest of the answer
 * repeats feeds BT reads from MLB itself (the scoreboard, the box score, team records) or regroups the same pitch rows
 * (by pitcher and batter, batted balls alone), so it is typed as passed through, not modeled (`SavantRepeated`).
 *
 * The pitch row is split by purpose, each part its own interface: who and when, the count and the call, the flight
 * (a copy of the live feed's trajectory), the batted ball, the swing and Savant's own calls.
 */

/** A branch of the answer that repeats what BT reads from MLB's own feeds, or regroups the pitch rows: passed through. */
export type SavantRepeated = unknown;

/** Who threw, hit and caught the pitch, and where it sits in the game (Savant's `ab_number` is the live feed's `atBatIndex` + 1). */
export interface SavantPitchWho {
	play_id: string;
	ab_number: number;
	game_pk?: string;
	rowId?: string;
	source?: string;
	/** "pitch", or "no_pitch" for an automatic ball or strike. */
	type?: string;
	sportId?: number;
	year?: number;
	inning?: number;
	half_inning?: string;
	batter?: number;
	batter_name?: string;
	stand?: string;
	pitcher?: number;
	pitcher_name?: string;
	p_throws?: string;
	catcher?: number;
	catcher_name?: string;
	team_batting?: string;
	team_batting_id?: number;
	team_fielding?: string;
	team_fielding_id?: number;
	/** The team abbreviation on a team's first row of the half (seen twice in 823823). */
	player_name?: string;
	/** The automatic call's place in its at-bat, on a "no_pitch" row. */
	index?: number;
	is_last_pitch?: boolean;
	pitch_number?: number;
	game_total_pitches?: number;
	player_total_pitches?: number;
	player_total_pitches_pitch_types?: number;
	pitcher_pa_number?: number;
	/** How many times the pitcher has faced the batting order, this plate appearance included. */
	pitcher_time_thru_order?: number;
	runnerOn1B?: boolean;
	runnerOn2B?: boolean;
	runnerOn3B?: boolean;
}

/** The count before and after the pitch, and the call on it. */
export interface SavantPitchCall {
	balls?: number;
	strikes?: number;
	pre_balls?: number;
	pre_strikes?: number;
	balls_and_strikes?: string;
	outs?: number;
	call?: string;
	call_name?: string;
	pitch_call?: string;
	description?: string;
	des?: string;
	events?: string;
	result?: string;
	result_code?: string;
	is_bip_out?: string;
	is_strike_swinging?: boolean;
	pitch_type?: string;
	pitch_name?: string;
	cap_index?: number;
}

/** The pitch's flight and the strike zone: Savant's copy of the live feed's `pitchData`, which BT reads from MLB. */
export interface SavantPitchFlight {
	start_speed?: number;
	end_speed?: number;
	spin_rate?: number;
	extension?: number;
	vx0?: number;
	vy0?: number;
	vz0?: number;
	ax?: number;
	ay?: number;
	az?: number;
	x0?: number;
	y0?: number;
	z0?: number;
	px?: number;
	pz?: number;
	plate_x?: number;
	plate_z?: number;
	plateTime?: number;
	plateTimeSZDepth?: number;
	pfxX?: number;
	pfxZ?: number;
	pfxXNoAbs?: number;
	pfxXWithGravity?: number;
	pfxZWithGravity?: number;
	pfxXDirection?: string;
	pfxZDirection?: string;
	breakX?: number;
	breakZ?: number;
	breakXFeet?: number;
	breakXInches?: number;
	breakZInducedFeet?: number;
	breakZInducedInches?: number;
	breakZWithGravityFeet?: number;
	breakZWithGravityInches?: number;
	inducedBreakZ?: number;
	inducedBreakZForcedSign?: string;
	ivbZDirection?: string;
	sz_top?: number;
	sz_bot?: number;
	sz_depth?: number;
	sz_width?: number;
	zone?: number;
	isInZone?: boolean;
}

/** Where the pitch crossed the front of the plate (Savant's polynomial fit), in feet: what no MLB feed BT reads carries. */
export interface SavantPlateCrossing {
	plateXPoly?: number;
	plateYPoly?: number;
	plateZPoly?: number;
}

/** Savant's context for a batted ball. */
export interface SavantContextMetrics {
	/** In how many of the 30 ballparks the ball would have been a home run. */
	homeRunBallparks?: number;
}

/** A batted ball: MLB's exit velocity and angle as strings, and Savant's own expected average, barrel and spray position. */
export interface SavantBattedBall {
	launch_speed?: string;
	launch_angle?: string;
	hit_speed?: string;
	hit_speed_round?: string;
	hit_angle?: string;
	hit_distance?: string;
	/** Expected batting average, e.g. ".780". */
	xba?: string;
	/** 1 when Savant calls the ball a barrel, 0 when not. */
	is_barrel?: number;
	/** The spray chart position, in Savant's chart units. */
	hc_x?: number;
	hc_y?: number;
	/** The spray position in feet from home plate (x toward right field, y toward center). */
	hc_x_ft?: number;
	hc_y_ft?: number;
	contextMetrics?: SavantContextMetrics;
}

/** The pitch a team challenged under the automated ball-strike system, and how the challenge went. */
export interface SavantAbsChallenge {
	is_batter?: boolean;
	is_in_progress?: boolean;
	is_overturned?: boolean;
	challenge_team_id?: number;
	edge_distance?: number;
	edge_distance_calc?: number;
	challenging_player_id?: number;
	challenging_player_type?: string;
}

/** The swing and Savant's own calls on the pitch. */
export interface SavantSwingAndCalls {
	/** Bat speed in mph, on a swing Savant tracked. */
	batSpeed?: number;
	/** A "sword": a swing so non-competitive Savant calls it one. */
	isSword?: boolean;
	/** Savant's own in-zone call. */
	savantIsInZone?: boolean;
	is_abs_challenge?: boolean;
	abs_challenge?: SavantAbsChallenge;
}

/** One pitch row of Savant's game feed. */
export interface SavantFeedPitch extends SavantPitchWho, SavantPitchCall, SavantPitchFlight, SavantPlateCrossing, SavantBattedBall, SavantSwingAndCalls {}

/** The whole answer: the pitch rows by side, and the repeated branches passed through. */
export interface SavantGameFeedResponse {
	game_status_code?: string;
	game_status?: string;
	gamedayType?: string;
	gameDate?: string;
	game_date?: string;
	hasAbs?: boolean;
	venue_id?: number;
	team_home_id?: number;
	team_away_id?: number;
	/** Every pitch the home team threw. */
	team_home?: SavantFeedPitch[];
	/** Every pitch the away team threw. */
	team_away?: SavantFeedPitch[];
	cacheKey?: string;
	cache_hit?: string;
	scoreboard?: SavantRepeated;
	boxscore?: SavantRepeated;
	home_team_data?: SavantRepeated;
	away_team_data?: SavantRepeated;
	home_pitchers?: SavantRepeated;
	away_pitchers?: SavantRepeated;
	home_batters?: SavantRepeated;
	away_batters?: SavantRepeated;
	exit_velocity?: SavantRepeated;
	players?: SavantRepeated;
	home_lineup?: SavantRepeated;
	away_lineup?: SavantRepeated;
	home_pitcher_lineup?: SavantRepeated;
	away_pitcher_lineup?: SavantRepeated;
}
