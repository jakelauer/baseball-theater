/**
 * Pure upstream → BT mapper for the rules a game was played under (S100), from the live feed's `ruleSettings`
 * hydrate. Each setting keeps MLB's name, label and description, its value and the unit to read it in (from
 * `valueType`); MLB's numeric `settingId` stays upstream. A setting missing its name, value or value type (absent or
 * null), or whose value type BT doesn't know, is left out (a null label or description falls back), and an answer with
 * none left maps to null, so the game is served without the field.
 */
import type {
	GameRuleSetting, GameRuleSettingUnit, GameSnapshot, Unversioned,
} from "@bt/domain";
import type { GameRuleSettingsResponse } from "@bt/mlb-api";

/** MLB's `valueType` → BT's unit; a type not listed here leaves its setting out. */
const UNITS: ReadonlyMap<string, GameRuleSettingUnit> = new Map([
	["percentage", "percent"],
	["numeric", "number"],
	["boolean", "boolean"],
	["text", "text"],
]);

/** The game's rule settings from MLB's answer, in MLB's order, or null when it lists none whole. */
export function mapGameRuleSettings(response: GameRuleSettingsResponse): GameRuleSetting[] | null
{
	const settings: GameRuleSetting[] = [];
	for (const setting of response.gameData?.ruleSettings ?? [])
	{
		const name = setting.settingName;
		const value = setting.settingValue;
		const unit = setting.valueType == null ? undefined : UNITS.get(setting.valueType);
		if (!name || value == null || !unit) continue;
		settings.push({
			name,
			label: setting.settingDisplayName ?? name,
			description: setting.settingDescription ?? "",
			value,
			unit,
		});
	}
	return settings.length > 0 ? settings : null;
}

/**
 * The game with its rule settings attached (S100), or as it is when there are none: the field is only ever present with
 * a value, so a game with none hashes as before. Ingest attaches an asked answer here (`withAskedExtras`).
 */
export function withGameRuleSettings(game: Unversioned<GameSnapshot>, ruleSettings: GameRuleSetting[] | null): Unversioned<GameSnapshot>
{
	return ruleSettings
		? {
			...game,
			ruleSettings,
		}
		: game;
}
