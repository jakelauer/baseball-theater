import type { CSSProperties } from "react";
import { Anchor } from "@mantine/core";
import { Link } from "react-router-dom";
import type { PlayLink } from "./playLink.js";
import "./PlayInningPill.css";

/**
 * The inning pill (S145; game-shell A6's shared `play-inning-pill`): a clip's link to its play,
 * `Top 6 →`, its `aria-label` the spoken name `playInningLink` gives it (owner, 2026-11-19). One
 * component for the Videos room's cards and the floating player (ADR-025); both get the `PlayLink`
 * from `playLink.ts`, so the pill only draws it. `onClick` lets the player close itself as the
 * link opens the play. `testId` keeps the lookups S97's tests and design spec already use
 * (`play-link` on a card, `player-play-link` in the player).
 */
export function PlayInningPill({
	link, testId, onClick, style,
}: { link: PlayLink;
	testId: string;
	onClick?: () => void;
	style?: CSSProperties; })
{
	return (
		<Anchor component={Link} to={link.to} aria-label={link.name} className="bt-play-pill" underline="never" data-testid={testId} onClick={onClick} style={style}>
			<span className="bt-play-pill-face">{link.label}</span>
		</Anchor>
	);
}
