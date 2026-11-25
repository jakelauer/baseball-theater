/**
 * MLB's game uniforms (`GET /api/v1/uniforms/game?gamePks={gamePk}`; S101): the uniform assets each team
 * wore in a game (jersey, pants, cap…), set by the clubs before first pitch. BT treats it as optional.
 *
 * Split by purpose: an asset's type, one asset, one team's side, one game, and the response that lists
 * the games asked for.
 */

/** What kind of asset it is: `uniformAssetTypeText` is the plain name ("Jersey", "Pants", "Cap"), the code its letter. */
export interface UniformAssetType {
	uniformAssetTypeId?: number;
	uniformAssetTypeCode?: string;
	uniformAssetTypeText?: string;
	uniformAssetTypeDesc?: string;
}

/** One piece a team wore: its code (`146_jersey_1_2026`) and its name ("Marlins Home White Jersey"). */
export interface UniformAsset {
	uniformAssetId?: number;
	uniformAssetCode?: string;
	uniformAssetText?: string;
	uniformAssetType?: UniformAssetType;
	active?: boolean;
}

/** One team's side of a game: the team (its id, short name and API path) and the assets it wore. */
export interface TeamUniforms {
	id?: number;
	teamName?: string;
	link?: string;
	uniformAssets?: UniformAsset[];
}

/** One game's uniforms, home and away. */
export interface GameUniformsEntry {
	gamePk?: number;
	home?: TeamUniforms;
	away?: TeamUniforms;
}

/** The endpoint's answer: one entry per game asked for (BT asks one). */
export interface GameUniformsResponse {
	copyright?: string;
	uniforms?: GameUniformsEntry[];
}
