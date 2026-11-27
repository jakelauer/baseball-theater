/**
 * Where a player's name links (S209): the four stats sites BT can open a player on, the one function
 * that builds each site's player-page URL, the one rule for which site a fan's links use, and the
 * roster of a stored game (the players whose outside ids BT keeps). ADR-025: every view, list and
 * route calls these and only formats.
 */
import type { AccountSettings } from "./settings.js";
import type { Entitlements, GameSnapshot } from "./types.js";

/**
 * The stats sites a player's name can open, MLB.com first, the default (owner, 2026-11-23: "the
 * default should be MLB.com because that is the most likely to definitely work"). The others are a
 * patron's choice (`effectiveStatsProvider`).
 */
export const STATS_PROVIDERS = ["mlb", "fangraphs", "bbref", "savant"] as const;

export type StatsProvider = (typeof STATS_PROVIDERS)[number];

/**
 * A player's ids on the sites BT links to: MLB's own (MLBAM, which MLB.com and Baseball Savant key
 * their pages by), and FanGraphs' and Baseball-Reference's, each null while BT doesn't know it
 * (not yet resolved, or the source has none for this player).
 */
export type PlayerIds = {
	mlbam: number;
	fangraphs: string | null;
	bbref: string | null;
};

/**
 * The player's page on `provider`, built from ids alone, never a name slug, so a renamed player's
 * link still works: MLB.com and Savant from MLBAM (each site redirects to its slugged page), FanGraphs
 * from its player id (its long-standing `statss.aspx?playerid=` address, which redirects to the
 * player's page), Baseball-Reference from its id (`/players/<first letter>/<id>.shtml`). Null when
 * the site's own id is unknown, so a caller falls back rather than linking nowhere.
 */
export function playerProfileUrl(provider: StatsProvider, ids: PlayerIds): string | null
{
	switch (provider)
	{
		case "mlb":
			return `https://www.mlb.com/player/${ids.mlbam}`;
		case "savant":
			return `https://baseballsavant.mlb.com/savant-player/${ids.mlbam}`;
		case "fangraphs":
			return ids.fangraphs ? `https://www.fangraphs.com/statss.aspx?playerid=${encodeURIComponent(ids.fangraphs)}` : null;
		case "bbref":
			return ids.bbref ? `https://www.baseball-reference.com/players/${encodeURIComponent(ids.bbref.charAt(0))}/${encodeURIComponent(ids.bbref)}.shtml` : null;
	}
}

/**
 * Which site a fan's player links open (S209 AC 9): their saved `statsProvider` when their account
 * may choose one (`statsProviderChoice`, any active pledge), else MLB.com. A lapsed pledge keeps its
 * saved choice but links to MLB.com; a signed-out visitor (no entitlements) gets MLB.com.
 */
export function effectiveStatsProvider(
	settings: Pick<AccountSettings, "statsProvider">,
	entitlements: Pick<Entitlements, "statsProviderChoice"> | null | undefined,
): StatsProvider
{
	return entitlements?.statsProviderChoice === true ? settings.statsProvider : "mlb";
}

/**
 * Every player a stored game names, sorted and without repeats (S209 AC 3): each play's batter and
 * pitcher and each box score batter and pitcher. Ingest compares a write's roster with the stored one
 * through this, so it adds players only when the roster changes; the seeding pass reads the same
 * paths in SQL.
 */
export function gamePersonIds(game: Pick<GameSnapshot, "plays" | "boxscore">): number[]
{
	const ids = new Set<number>();
	for (const play of game.plays)
	{
		ids.add(play.matchup.batter.id);
		ids.add(play.matchup.pitcher.id);
	}
	for (const team of [game.boxscore?.teams.away, game.boxscore?.teams.home])
	{
		for (const batter of team?.batting ?? []) ids.add(batter.id);
		for (const pitcher of team?.pitching ?? []) ids.add(pitcher.id);
	}
	return [...ids].sort((a, b) => a - b);
}
