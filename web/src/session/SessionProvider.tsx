/**
 * Who is using the app (S59). Session state lives in its own provider, not as
 * a TanStack query next to game data (ADR-014 rule 7). When it changes, it
 * invalidates the server data that depends on it.
 *
 * The session is the account `GET /api/v1/me` returns for the stored bearer
 * token (`token.ts`). The server answers 401 when there is no valid session,
 * which reads as signed out.
 *
 * How it signs in is the deployment's (`signInWay.ts`, asked once per page load): Logto
 * where it names a tenant (S116; the `AuthClient`, the one module that loads Logto's SDK,
 * imported only when a sign-in, its callback or a sign-out first asks for it, goes to Logto's
 * hosted sign-in, and the callback route hands the ID token to BT for BT's own session
 * token); staging's mock, which trades the fixed mock credential for a session
 * as the shared test account with no navigation (S143); none on previews; and the dev
 * sign-in locally.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
	useEffect, useState, type ReactNode,
} from "react";
import { MOCK_SIGN_IN_CREDENTIAL, signOutReturnUri } from "@bt/domain";
import { exchangeIdToken, fetchMe } from "../api/client.js";
import {
	ACCOUNT_QUERY_KEY, DEV_SIGN_IN_TOKEN, SessionContext, SIGNED_OUT, type Session, type SessionState, type SignInOffer,
} from "./session.js";
import type { SignInWay, SignInWayLoader } from "./signInWay.js";
import { deployedSignInWay } from "./signInWay.js";
import {
	clearPersonalData, readStored, writeStored,
} from "../storage/storage.js";
import { getSessionToken, setSessionToken } from "./token.js";

/**
 * Reads the account for the stored token. A 401 drops the token. If the server
 * can't be reached, this load counts as signed out but the token is kept, so
 * the next load can try again.
 *
 * Null when the stored token changed while the load was under way (S120): its
 * answer is about a token that is no longer the session's, so it neither sets
 * the state nor, on a 401, clears the newer token. On the sign-in callback the
 * startup load runs with the old token and can finish after the hand-off has
 * stored the new one.
 */
async function loadSession(): Promise<SessionState | null>
{
	const token = getSessionToken();
	let next: SessionState = SIGNED_OUT;
	let refused = false;
	try
	{
		const account = await fetchMe();
		if (account) next = {
			status: "signedIn",
			account,
		};
		else refused = true;
	}
	catch
	{
		// Unreachable: signed out for now, the token kept.
	}
	if (getSessionToken() !== token) return null;
	if (refused) setSessionToken(null);
	return next;
}

/** Whether a way to sign in shows "Sign in": every way but `none` (previews, S143 AC 6). */
function offerOf(way: SignInWay): SignInOffer
{
	return way.kind === "none" ? "none" : "offered";
}

/**
 * Each callback URL's hand-off, so the ID token goes to BT once even when the callback
 * route's effect runs twice (React's development double-run, or a re-render).
 */
const handOffs = new Map<string, Promise<string>>();

export function SessionProvider({ children, signInWay = deployedSignInWay }: { children: ReactNode;
	/** How this page signs in (`signInWay.ts`); tests pass a stand-in. */
	signInWay?: SignInWayLoader; })
{
	const queryClient = useQueryClient();
	// With no stored token there is nothing to ask the server, so start signed out.
	const [state, setState] = useState<SessionState>(() => (getSessionToken() ? {
		status: "loading",
	} : SIGNED_OUT));

	const [signInOffer, setSignInOffer] = useState<SignInOffer>("loading");

	// The deployment's answer, once per page load (the loader keeps it): "Sign in" waits for it so it
	// never flashes on a preview, and shows when the question fails, so a fan always has a way in.
	useEffect(() =>
	{
		let current = true;
		signInWay().then((way) =>
		{
			if (current) setSignInOffer(offerOf(way));
		}, () =>
		{
			if (current) setSignInOffer("offered");
		});
		return () =>
		{
			current = false;
		};
	}, [signInWay]);

	useEffect(() =>
	{
		if (!getSessionToken()) return;
		let current = true;
		void loadSession().then((next) =>
		{
			if (current && next) setState(next);
		});
		return () =>
		{
			current = false;
		};
	}, []);

	/** Loads the session for the token just stored and shows it, unless a newer token replaced it meanwhile. */
	async function applySession(): Promise<void>
	{
		const next = await loadSession();
		if (next) setState(next);
	}

	/** Keeps `token` as the session's, shows its account, and refreshes the account's server data. */
	async function keepSession(token: string): Promise<void>
	{
		setSessionToken(token);
		await applySession();
		await queryClient.invalidateQueries({
			queryKey: ACCOUNT_QUERY_KEY,
		});
	}

	const session: Session = {
		...state,
		signInOffer,
		async signIn()
		{
			// A click after a failed question asks again (the loader doesn't remember a failure).
			const way = await signInWay();
			setSignInOffer(offerOf(way));
			if (way.kind === "logto")
			{
				// Logto's SDK arrives first: if it can't, nothing is stored and the click can be retried.
				const client = await way.client();
				// The callback returns here once Logto is done (`finishSignIn`).
				writeStored("bt.signInReturnTo", `${location.pathname}${location.search}`);
				await client.signIn();
				return true;
			}
			// Staging (S143): the mock credential traded for an ordinary BT session, on this page.
			if (way.kind === "mock")
			{
				await keepSession(await exchangeIdToken(MOCK_SIGN_IN_CREDENTIAL));
				return false;
			}
			if (way.kind === "none") return false;
			await keepSession(DEV_SIGN_IN_TOKEN);
			return false;
		},
		finishSignIn(callbackUrl)
		{
			let handOff = handOffs.get(callbackUrl);
			if (!handOff)
			{
				handOff = (async () =>
				{
					const way = await signInWay();
					if (way.kind !== "logto") throw new Error("this deployment offers no Logto sign-in");
					const client = await way.client();
					await keepSession(await exchangeIdToken(await client.finishSignIn(callbackUrl)));
					const returnTo = readStored("bt.signInReturnTo") ?? "/";
					writeStored("bt.signInReturnTo", null);
					return returnTo;
				})();
				handOffs.set(callbackUrl, handOff);
			}
			return handOff;
		},
		keepSession,
		signOut()
		{
			setSessionToken(null);
			// Every personal browser key, Logto's included, not just the token (ADR-028).
			clearPersonalData();
			setState(SIGNED_OUT);
			queryClient.removeQueries({
				queryKey: ACCOUNT_QUERY_KEY,
			});
			// Then Logto's own session, where Logto signed in: a navigation, back to this page when Logto accepts it.
			// The mock and dev sign-ins have no session but BT's.
			void signInWay().then(async (way) =>
			{
				if (way.kind === "logto") await (await way.client()).signOut(signOutReturnUri(location.origin, location.pathname));
			}).catch(() =>
			{
				// BT's session is already over; a Logto session left behind only skips the email on the next sign-in, which asks for a fresh code anyway.
			});
		},
	};

	return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
