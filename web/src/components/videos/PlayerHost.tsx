import type { ClipViewSource } from "../../api/clipViews.js";
import { useSettings } from "../../settings/store.js";
import { LazyPlayerDialog } from "./LazyPlayerDialog.js";
import type { PlayerGame } from "./PlayerDialog.js";
import { PlayerStage } from "./PlayerStage.js";
import type { StageGame } from "./PlayerStage.js";
import type { Video } from "./VideoCard.js";
import type { PlayLink } from "./playLink.js";

/**
 * Puts the player where the reader's Video Player setting says (S70): `PlayerDialog`
 * over the page (the default, and what signed-out readers get, since their settings are
 * the house defaults) or `PlayerStage` where the host is rendered. It reads the setting
 * from the store, so changing it in Settings moves the player without a reload.
 *
 * `video` is the clip the reader chose, or null; the stage falls back to `first` so it is
 * never empty, while the dialog only opens on a choice. `scoresHidden` (the game page's
 * `useScoresHidden`) goes to whichever one shows, for the recap clip's title (S75). The
 * dialog gets the chosen clip's `playLink`; the stage gets `stageGame` and builds the link
 * for the clip it shows itself (S172), since it shows the waiting first clip too.
 *
 * `countViews` (S174) goes to the dialog only: the Videos room passes it so the clip's start and finish are counted
 * anonymously; the stage, like Search's and the digest's players, sends nothing.
 */
export function PlayerHost({
	video, first, onClose, game, fromGamePk, scoresHidden, playLink, stageGame, countViews,
}: { video: Video | null;
	first: Video | undefined;
	onClose: () => void;
	game?: PlayerGame;
	fromGamePk?: number;
	scoresHidden?: boolean;
	/** The playing clip's play link (S97), for the dialog's top-left slot. */
	playLink?: PlayLink | null;
	/** The room's game and its plays, from which the stage builds the shown clip's inning pill (S172). */
	stageGame?: StageGame;
	/** Where the dialog's clip is counted from (S174, the Videos room); never given to the stage. */
	countViews?: ClipViewSource; })
{
	const { videoPlayer } = useSettings();
	if (videoPlayer === "stage")
	{
		const shown = video ?? first;
		return shown ? <PlayerStage video={shown} autoPlay={video !== null} scoresHidden={scoresHidden} game={stageGame} onClose={onClose} /> : null;
	}
	return video ? (
		<LazyPlayerDialog video={video} onClose={onClose} game={game} fromGamePk={fromGamePk} scoresHidden={scoresHidden} playLink={playLink} countViews={countViews} />
	) : null;
}
