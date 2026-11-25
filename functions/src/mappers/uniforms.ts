/**
 * Pure upstream → BT mapper for the uniforms each team wore (S101). Each asset keeps MLB's code, its
 * name and its kind's plain name ("Jersey"); MLB's numeric ids, the kind's code and long description,
 * the `active` flag and the team's link stay upstream. An asset missing its code, name or kind is left
 * out, a side with none left is absent, and an answer with neither side (or not for this game) maps to
 * null, so the game is served without the field.
 */
import type {
	GameSnapshot, GameUniforms, UniformAssetWorn, Unversioned,
} from "@bt/domain";
import type { GameUniformsResponse, TeamUniforms } from "@bt/mlb-api";

/** One side's assets, in MLB's order; undefined when none is whole. */
function sideOf(team: TeamUniforms | undefined): UniformAssetWorn[] | undefined
{
	const assets: UniformAssetWorn[] = [];
	for (const asset of team?.uniformAssets ?? [])
	{
		const code = asset.uniformAssetCode;
		const text = asset.uniformAssetText;
		const type = asset.uniformAssetType?.uniformAssetTypeText;
		if (code && text && type) assets.push({
			code,
			text,
			type,
		});
	}
	return assets.length > 0 ? assets : undefined;
}

/** The game's uniforms from MLB's answer, or null when it lists none for `gamePk`. */
export function mapGameUniforms(response: GameUniformsResponse, gamePk: number): GameUniforms | null
{
	const entry = response.uniforms?.find((game) => game.gamePk === gamePk);
	const home = sideOf(entry?.home);
	const away = sideOf(entry?.away);
	if (!home && !away) return null;
	return {
		...home && {
			home,
		},
		...away && {
			away,
		},
	};
}

/**
 * The game with its uniforms attached (S101), or as it is when there are none: the field is only ever present with a
 * value, so a game with no uniforms hashes as before. Ingest attaches an asked answer here (`withAskedUniforms`).
 */
export function withGameUniforms(game: Unversioned<GameSnapshot>, uniforms: GameUniforms | null): Unversioned<GameSnapshot>
{
	return uniforms
		? {
			...game,
			uniforms,
		}
		: game;
}
