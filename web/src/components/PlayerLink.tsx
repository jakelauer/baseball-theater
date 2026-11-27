/**
 * A player's name as a link to their stats page (S209): the one name link the matchup cards and the
 * box score's tables use, so the Settings choice changes every name in one place. It opens the page
 * in a new tab, as BT's other outside links do, with the site's existing link look (Mantine
 * `Anchor`); the owner waived a design for it (2026-11-25).
 *
 * Which site comes from `effectiveStatsProvider` (a patron's saved choice, else MLB.com), the URL
 * from `playerProfileUrl`. FanGraphs and Baseball-Reference need the player's id on that site, read
 * from `GET /api/v1/players/profiles` (`usePlayerPages`); names shown together pass their `roster`,
 * so they are asked about in one request. While that is loading or has failed, when BT has no row
 * for the player, or when the site's id is unknown, the link points at MLB.com, so a name always
 * opens something.
 */
import type { PlayerIds, StatsProvider } from "@bt/domain";
import { effectiveStatsProvider, playerProfileUrl } from "@bt/domain";
import type { AnchorProps } from "@mantine/core";
import { Anchor } from "@mantine/core";
import type { ReactNode } from "react";
import { useContext } from "react";
import { usePlayerPages } from "../api/players.js";
import { SessionContext } from "../session/session.js";
import { useSettings } from "../settings/store.js";

type PlayerLinkProps = Omit<AnchorProps, "href"> & {
	/** MLB's person id (MLBAM). */
	personId: number;
	/**
	 * The players whose names are shown with this one (a game's, `gamePersonIds`), asked about together in one
	 * request when the site needs BT's ids; the player alone when absent.
	 */
	roster?: readonly number[];
	children: ReactNode;
};

/** The ids a name knows without asking BT: MLB's own, which MLB.com and Savant key their pages by. */
function mlbOnly(personId: number): PlayerIds
{
	return {
		mlbam: personId,
		fangraphs: null,
		bbref: null,
	};
}

/** MLB.com's page: what every link falls back to. */
function mlbPage(personId: number): string
{
	return playerProfileUrl("mlb", mlbOnly(personId)) ?? "";
}

/** The anchor itself, at `href`. */
function NameAnchor({
	href, children, ...anchor
}: Omit<PlayerLinkProps, "personId" | "roster"> & { href: string })
{
	return (
		<Anchor href={href} target="_blank" rel="noopener noreferrer" c="inherit" underline="hover" {...anchor}>
			{children}
		</Anchor>
	);
}

/** A name on a site whose own id BT looks up (FanGraphs, Baseball-Reference): MLB.com until the ids arrive, and if none does. */
function LookedUpLink({
	provider, personId, roster, ...rest
}: PlayerLinkProps & { provider: StatsProvider })
{
	const pages = usePlayerPages(personId, roster ?? [personId], true);
	const ids = pages.data?.ids;
	const href = (ids ? playerProfileUrl(provider, ids) : null) ?? mlbPage(personId);
	return <NameAnchor href={href} {...rest} />;
}

/**
 * A player's name linking to their page on the fan's stats site. Read outside a session (a test
 * rendering a room alone), the visitor counts as signed out: MLB.com.
 */
export function PlayerLink({
	personId, roster, ...rest
}: PlayerLinkProps)
{
	const settings = useSettings();
	const session = useContext(SessionContext);
	const entitlements = session?.status === "signedIn" ? session.account.entitlements : null;
	const provider = effectiveStatsProvider(settings, entitlements);
	if (provider === "fangraphs" || provider === "bbref") return <LookedUpLink provider={provider} personId={personId} {...roster && {
		roster,
	}} {...rest} />;
	return <NameAnchor href={playerProfileUrl(provider, mlbOnly(personId)) ?? mlbPage(personId)} {...rest} />;
}
