/**
 * MLB's rule settings for a game (S100): the live feed asked with `hydrate=ruleSettings&fields=gameData,ruleSettings`
 * (`GET /api/v1.1/game/{gamePk}/feed/live?language=en&hydrate=ruleSettings&fields=gameData,ruleSettings`), which answers
 * only `gameData.ruleSettings`: the strike zone the ABS system judged the game against (its top and bottom as a share
 * of the batter's height, its width and depth), and the game's other rules (designated hitter, pitch timer, ABS and
 * replay challenges…). BT treats it as optional.
 *
 * Split by purpose: one setting, the trimmed `gameData` that carries them, and the response.
 */

/**
 * One rule a game was played under. `settingName` is its stable key (`strikeZoneTopFactor`), `valueType` says how to
 * read `settingValue`: `percentage` (53.5 means 53.5%), `numeric` (a count, or inches where the description says so),
 * `boolean` or `text`.
 */
export interface RuleSetting {
	settingId?: number;
	settingName?: string;
	settingDisplayName?: string;
	settingDescription?: string;
	valueType?: string;
	settingValue?: number | boolean | string;
}

/** The only part of `gameData` the `fields=gameData,ruleSettings` filter leaves. */
export interface RuleSettingsGameData {
	ruleSettings?: RuleSetting[];
}

/** The filtered live feed's answer: `gameData` holding the settings, nothing else. */
export interface GameRuleSettingsResponse {
	gameData?: RuleSettingsGameData;
}
