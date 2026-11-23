import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import {
	Navigate, Route, Routes,
} from "react-router-dom";
import { ViewState } from "./components/ViewState.js";
import { ScoreboardPage } from "./pages/ScoreboardPage.js";
import type { LayoutVariant } from "./layout/variant.js";
import type { SetFooterMode } from "./layout/footerMode.js";
import { useFooterMode } from "./layout/footerMode.js";
import { useAccountDeleted } from "./api/accountDeleted.js";
import { useScoreboardDefaultDate } from "./api/scoreboardDate.js";
import { DeletedAccountPage } from "./pages/settings/DeletedAccountPage.js";
import { useSession } from "./session/session.js";
import { SignInCallback } from "./session/SignInCallback.js";
import { SIGN_IN_CALLBACK_PATH } from "@bt/domain";

/**
 * Signed out on `/settings`: if this browser's account was just deleted, A5's
 * page, once; otherwise off to the scoreboard. The server alone knows (S87's
 * `HttpOnly` cookie), so the page stays empty while it is asked (S79). The shell's footer is
 * off while it is asked as well as on the deleted page (A5; S142), and `SignedInOnly` keeps it
 * off while the session itself loads, so the deleted page never shows it at any step. The hook
 * runs before the early return, as hooks must.
 */
function SignedOutSettings({ setFooter }: { setFooter: SetFooterMode })
{
	const { data: deleted, isPending } = useAccountDeleted();
	useFooterMode(setFooter, isPending || deleted ? "none" : "plain");
	if (isPending) return null;
	return deleted ? <DeletedAccountPage setFooter={setFooter} /> : <Navigate to="/games" replace />;
}

/**
 * Settings are signed-in only (ADR-027). Signed out, the route shows the
 * deleted-account page once after a deletion and otherwise sends you to the
 * scoreboard. While the session is still loading it renders nothing, so a
 * signed-in reload isn't bounced away before the session arrives.
 */
function SignedInOnly({ children, setFooter }: { children: ReactNode;
	setFooter: SetFooterMode; })
{
	const session = useSession();
	// No footer while the session loads, as on any loading page (S142): Settings and the deleted page
	// then draw it, or not, once they know.
	useFooterMode(setFooter, session.status === "loading" ? "none" : null);
	if (session.status === "loading") return null;
	if (session.status === "signedOut") return <SignedOutSettings setFooter={setFooter} />;
	return children;
}

/**
 * A page's loading treatment (`ViewState`'s) with the shell's footer held back until the page
 * settles (S142; `FooterMode`): a route's chunk arriving, the default day being asked, the
 * sign-in hand-off.
 */
function Loading({ setFooter }: { setFooter: SetFooterMode })
{
	useFooterMode(setFooter, "none");
	return <ViewState kind="loading" />;
}

/**
 * `/` and `/games` open the day the server names (S111): today in season, the last final
 * in the off-season. The URL then names the day, so it can be shared and stepped from.
 */
function DefaultDay({ setFooter }: { setFooter: SetFooterMode })
{
	const date = useScoreboardDefaultDate();
	return date ? <Navigate to={`/games/${date}`} replace /> : <Loading setFooter={setFooter} />;
}

/*
 * Every page past the scoreboard loads on demand, as its own JS chunk (S110; owner,
 * 2026-11-02: "Lazy loading would be better, with chunked JS files."): the first download
 * holds the shell and the scoreboard, the landing page, and stays inside ADR-026's entry
 * budget as the other pages grow. The pages keep named exports; `lazy` takes a default.
 */
const GamePage = lazy(() => import("./pages/GamePage.js").then((m) => ({
	default: m.GamePage,
})));
const StandingsPage = lazy(() => import("./pages/StandingsPage.js").then((m) => ({
	default: m.StandingsPage,
})));
const SearchPage = lazy(() => import("./pages/SearchPage.js").then((m) => ({
	default: m.SearchPage,
})));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js").then((m) => ({
	default: m.SettingsPage,
})));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage.js").then((m) => ({
	default: m.ChangelogPage,
})));

/**
 * The routes, each page given the pairing the layout host settled (S60). While a page's
 * chunk arrives, the page area shows ViewState's loading treatment (S110), the one every
 * page uses while its data loads, so there is no extra screen. `setFooter` is the shell's say
 * over the site footer (S142), passed to the pages that change it: every page with a loading state
 * (no footer until it settles), the game page (its live socket) and the deleted-account page (no
 * footer). Required, so the app can't drop the wiring; a render with no shell passes a no-op.
 */
export function AppRoutes({ variant, setFooter }: { variant: LayoutVariant;
	setFooter: SetFooterMode; })
{
	return (
		<Suspense fallback={<Loading setFooter={setFooter} />}>
			<Routes>
				<Route path="/" element={<DefaultDay setFooter={setFooter} />} />
				<Route path="/games" element={<DefaultDay setFooter={setFooter} />} />
				<Route path="/games/:date" element={<ScoreboardPage variant={variant} setFooter={setFooter} />} />
				<Route path="/game/:gamePk" element={<GamePage variant={variant} setFooter={setFooter} />} />
				<Route path="/game/:gamePk/:tab" element={<GamePage variant={variant} setFooter={setFooter} />} />
				<Route path="/standings" element={<StandingsPage variant={variant} setFooter={setFooter} />} />
				<Route path="/search" element={<SearchPage />} />
				{/* The change log is for everyone, signed in or not (A9, ratified 2026-11-19). */}
				<Route path="/changelog" element={<ChangelogPage setFooter={setFooter} />} />
				<Route path="/settings" element={<SignedInOnly setFooter={setFooter}><SettingsPage variant={variant} /></SignedInOnly>} />
				<Route path={SIGN_IN_CALLBACK_PATH} element={<SignInCallback setFooter={setFooter} />} />
			</Routes>
		</Suspense>
	);
}
