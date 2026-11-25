/**
 * The session's shape and how components read it (S59). `SessionProvider.tsx`
 * holds the state; this module holds what callers import, so the provider file
 * exports only a component (fast refresh).
 */
import { createContext, useContext } from "react";
import type { fetchMe } from "../api/client.js";

/** The signed-in account, as `/api/v1/me` returns it: uid, email, role and entitlements. */
export type Account = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;

export type SessionState =
	| { status: "loading" }
	| { status: "signedOut" }
	| {
		status: "signedIn";
		account: Account;
	};

/**
 * Whether this page offers a way to sign in (S143), from the Worker's one answer (`signInWay.ts`):
 * `loading` until it answers, `none` where it offers no sign-in at all (previews), and `offered`
 * otherwise, including when the question failed, so a fan whose request failed still has a way in.
 */
export type SignInOffer = "loading" | "offered" | "none";

export type Session = SessionState & {
	/** Whether to show "Sign in" (S143 AC 6): the header shows it only when `offered`. */
	signInOffer: SignInOffer;
	/**
	 * The one way to start signing in; the header's "Sign in" and Settings' "Sign in
	 * again" call it (S60, S79). Where the deployment offers Logto (S116) it sends the
	 * browser to Logto's hosted sign-in, always for a fresh emailed code; on staging (S143)
	 * it signs in as the shared test account with no navigation; locally it is the dev
	 * sign-in as `dev:test-user`; where the deployment offers no sign-in (previews) it
	 * does nothing.
	 *
	 * Answers true when the browser is now leaving for Logto (a caller showing progress keeps
	 * showing it), false when sign-in finished or couldn't start here (the mock or dev sign-in,
	 * a deployment with none), so a caller can put its control back.
	 */
	signIn(): Promise<boolean>;
	/**
	 * At the sign-in callback route (S116): hands Logto's ID token to BT once, keeps
	 * BT's session, and answers the path the sign-in started from. Calling it again
	 * for the same callback URL answers the same result rather than a second hand-off.
	 */
	finishSignIn(callbackUrl: string): Promise<string>;
	/** Ends BT's session and clears every personal browser key; where Logto signed in, ends Logto's too (never for the mock). */
	signOut(): void;
	/**
	 * Keeps a session token BT just issued for this account (the path every sign-in keeps its token
	 * by): stores it, reloads `/api/v1/me` into the session and refreshes the account's server data.
	 * Staging's backer tier override (S215) hands it the token its `PUT` answers, so every check that
	 * reads `account.entitlements` sees the chosen tier at once.
	 */
	keepSession(token: string): Promise<void>;
};

/** The local dev account (S8's `dev:` bearer): uid `test-user`, email `dev@local.test`. */
export const DEV_SIGN_IN_TOKEN = "dev:test-user";

/**
 * The query-key prefix for server data that belongs to the signed-in account
 * (settings, S6). Signing in invalidates these queries; signing out removes
 * them, so the next user never sees the last one's data.
 */
export const ACCOUNT_QUERY_KEY = ["account"] as const;

export const SIGNED_OUT: SessionState = {
	status: "signedOut",
};

export const SessionContext = createContext<Session | null>(null);

/** The current session. Must be used inside `SessionProvider`. */
export function useSession(): Session
{
	const session = useContext(SessionContext);
	if (!session) throw new Error("useSession must be used inside SessionProvider");
	return session;
}
