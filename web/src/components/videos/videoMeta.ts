import type { HighlightKind } from "@bt/domain";
import { formatDate } from "../../format/datetime.js";
import type { Video } from "./VideoCard.js";
import type { PlayLink } from "./playLink.js";

/** The meta line's first word (`Highlight · Sep 5, 2026`). */
const KIND_LABELS: Readonly<Record<HighlightKind, string>> = {
	highlight: "Highlight",
	recap: "Recap",
	condensed: "Condensed game",
	video: "Video",
};

/**
 * A card's second line (S145; game-shell A6's shared `video-meta`), by the play-wins rule: a clip
 * with a play reads its date (if any) then the inning pill, whatever its kind; one with no play
 * reads `Highlight · Sep 5, 2026` (its kind's word, then the date, either alone if the other is
 * missing); a clip with none of them has no line (`null`). The one rule for the line (ADR-025):
 * `VideoCard` draws it, and Search's rows (S153) reuse it. `text` is the muted words, `pill` the play.
 * `noDate` leaves the date out: only the game's own Videos room passes it, since every clip there
 * is from that game's day (#421; owner, 2026-11-25, waiving game-shell A6's date on each card:
 * "Drop the date in the game's room"), so a play clip reads just its pill and one with no play
 * just its kind. Best of, Search and the player keep the date.
 */
export function videoMeta(video: Pick<Video, "kind" | "date">, playLink: PlayLink | null | undefined, { noDate = false }: { noDate?: boolean } = {}): { text: string | null;
	pill: PlayLink | null; } | null
{
	const date = video.date && !noDate ? formatDate(video.date) : null;
	if (playLink) return {
		text: date,
		pill: playLink,
	};
	const text = [video.kind ? KIND_LABELS[video.kind] : null, date].filter(Boolean).join(" · ");
	return text ? {
		text,
		pill: null,
	} : null;
}
