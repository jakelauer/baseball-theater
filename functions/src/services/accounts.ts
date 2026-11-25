/**
 * Turning a completed sign-in into a BT user and session (ADR-019), and a
 * request's `Authorization` header back into a session.
 *
 * BT owns the user ID: a provider account is looked up by `(provider, subject)`
 * and, on its first sign-in, gets a new BT user linked to it. After that the
 * session BT issues is all an ordinary request needs.
 */
import type {
	BtSession, Entitlements, UserProfile,
} from "@bt/domain";
import { effectiveEntitlements, entitlementsForTier } from "@bt/domain";
import type {
	IdentityClaims, IdentityProvider, UserRepository,
} from "@bt/ports";
import type { SessionSigner } from "./session.js";

export type AuthDeps = {
	users: UserRepository;
	sessions: SessionSigner;
	/**
	 * The local/CI identity provider that accepts `Bearer dev:<uid>` directly
	 * (`DevIdentityProvider`). Absent in production, where a `dev:` token is just
	 * an invalid session.
	 */
	dev?: IdentityProvider;
	/**
	 * The deployed sign-in (S116): Logto, wherever the Worker's vars name its tenant
	 * (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`). The web app reads `config` to start a sign-in and hands
	 * the ID token it gets back to `POST /api/v1/sign-in` ({@link completeProviderSignIn}).
	 * Absent locally, on previews, and on staging, which signs in with {@link AuthDeps.mock}.
	 */
	logto?: {
		provider: IdentityProvider;
		config: { endpoint: string;
			appId: string; };
	};
	/**
	 * Staging's mock sign-in (S143; `MockIdentityProvider`): one fixed credential traded at
	 * `POST /api/v1/sign-in` for a session as the one shared test account. Wired only where
	 * `mockSignInAllowed` says, which is never beside `logto`; absent in production, on previews
	 * and locally.
	 */
	mock?: IdentityProvider;
	/**
	 * Staging's backer tier override (S215): true only where `tierOverrideAllowed` says, from the
	 * deploy-time config. For staging tests only; absent in production, on previews and locally, so
	 * there the stored override is never read (no query) and its routes answer 404. The override
	 * never changes the real tier or touches Patreon.
	 */
	tierOverrideAllowed?: boolean;
	now?: () => Date;
};

/** A completed sign-in: the token to hand the client, and the session it carries. */
export type SignedIn = {
	token: string;
	session: BtSession;
};

/** The prefix of a local/CI bearer token that signs in as the named uid (ADR-013 local auth). */
export const DEV_TOKEN_PREFIX = "dev:";

/**
 * A sign-in refused because of the credential itself (it doesn't verify, is malformed, or vouches
 * for no email): the caller's to fix by signing in again, so the sign-in route answers 401. Any
 * other error during a sign-in (the provider's keys can't be fetched, the database or the session
 * key fails) is BT's, and the route answers 503 (S120). Provider adapters throw subclasses.
 */
export class CredentialRefusedError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "CredentialRefusedError";
	}
}

/** A sign-in BT refuses because the provider vouched for no email address (S82). */
export class NoEmailError extends CredentialRefusedError
{
	constructor(provider: string)
	{
		super(`a ${provider} sign-in carried no email address; every BT account has one`);
		this.name = "NoEmailError";
	}
}

/**
 * Finds or creates the BT user for a provider account and issues their
 * session, with the entitlements {@link accountEntitlements} hands out (S215) and the provider's sign-in time (`claims.authTime`) for
 * deletion's recent-sign-in check (S120). `newUid` names a first-time user; it defaults to a random UUID, and
 * the dev provider passes the subject so `dev:test-user` is uid `test-user`.
 *
 * A sign-in with no email is refused before anything is read or written: every
 * account has an email (owner, 2026-10-28: "It should be impossible for an
 * account to have no email."; S82).
 */
export async function signIn(
	deps: AuthDeps,
	claims: IdentityClaims,
	newUid: () => string = () => crypto.randomUUID(),
): Promise<SignedIn>
{
	if (!claims.email.trim()) throw new NoEmailError(claims.provider);
	let uid = await deps.users.getByIdentity(claims.provider, claims.subject);
	let user = uid ? await deps.users.getByUid(uid) : null;
	if (!user)
	{
		uid ??= newUid();
		const now = (deps.now?.() ?? new Date()).toISOString();
		user = {
			uid,
			email: claims.email,
			displayName: null,
			patreonUserId: null,
			role: "member",
			entitlements: entitlementsForTier("none"),
			createdAt: now,
			updatedAt: now,
		};
		await deps.users.upsert(user);
		await deps.users.linkIdentity(claims.provider, claims.subject, uid);
	}
	return issueSession(deps, user, await accountEntitlements(deps, user), claims.authTime);
}

/**
 * The entitlements a signed-in account is handed (S215 AC 1): its stored tier, or the staging tier
 * override through `effectiveEntitlements`. The override is read only where `deps.tierOverrideAllowed`
 * is set, so production (where it never is) makes no query for it; it exists for staging tests and
 * never changes the real tier or touches Patreon. The session at sign-in, `GET /api/v1/me` and the
 * override route's new session all come here.
 */
export async function accountEntitlements(deps: AuthDeps, user: UserProfile): Promise<Entitlements>
{
	if (!deps.tierOverrideAllowed) return effectiveEntitlements(user.entitlements, null, false);
	return effectiveEntitlements(user.entitlements, await deps.users.getTierOverride(user.uid), true);
}

/**
 * Issues `user` a session carrying `entitlements`, and its verified form. `authTime` is the
 * provider's own sign-in time, which rides in the session for deletion's recent-sign-in check
 * (S120); a session reissued for a tier override (S215) carries the one it replaces.
 */
export async function issueSession(deps: AuthDeps, user: UserProfile, entitlements: Entitlements, authTime: number | undefined): Promise<SignedIn>
{
	const token = await deps.sessions.issue({
		uid: user.uid,
		role: user.role,
		entitlements,
		...authTime !== undefined && {
			authTime,
		},
	});
	const session = await deps.sessions.verify(token);
	if (!session) throw new Error("a freshly issued session failed to verify");
	return {
		token,
		session,
	};
}

/**
 * A sign-in hand-off (S116 AC 2, S143 AC 3): the deployment's provider checks `credential`
 * (Logto's ID token, or staging's mock credential) and BT finds or creates the user and issues its
 * own session, through the same {@link signIn} the dev provider uses. Logto and the mock are never
 * both wired (`mockSignInAllowed`), so whichever is wired is the one asked. Null when this
 * deployment offers no provider sign-in; throws a {@link CredentialRefusedError} when the
 * credential doesn't verify or carries no email (so where Logto is wired the mock credential is
 * refused like any token it can't verify), and anything else when BT itself fails. A `dev:` token
 * never signs in here. Trading the same ID token again issues a new session but keeps the token's
 * `auth_time`, so it never makes a sign-in look recent (S120).
 */
export async function completeProviderSignIn(deps: AuthDeps, credential: string): Promise<SignedIn | null>
{
	const provider = deps.logto?.provider ?? deps.mock;
	if (!provider) return null;
	return signIn(deps, await provider.completeSignIn(credential));
}

/**
 * The session a request carries in `Authorization: Bearer …`, or null when it
 * has none or an invalid one. A BT session token is verified by signature
 * alone. A `dev:` token, only when `deps.dev` is wired, signs in through the
 * dev provider first, so local requests exercise the same link-and-issue path
 * a real sign-in does.
 */
export async function authenticate(request: Request, deps: AuthDeps): Promise<BtSession | null>
{
	const header = request.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	if (deps.dev && token.startsWith(DEV_TOKEN_PREFIX))
	{
		const claims = await deps.dev.completeSignIn(token);
		return (await signIn(deps, claims, () => claims.subject)).session;
	}
	return deps.sessions.verify(token);
}

/**
 * The session a request carries **and** the account it still names, or null.
 * A session verifies by signature alone, so a deleted user's session keeps
 * verifying until it expires (S77); every route that acts for an account goes
 * through this one check rather than repeating the profile read (ADR-025).
 */
export async function authenticateAccount(request: Request, deps: AuthDeps): Promise<{ session: BtSession;
	user: UserProfile } | null>
{
	const session = await authenticate(request, deps);
	const user = session ? await deps.users.getByUid(session.uid) : null;
	return session && user ? {
		session,
		user,
	} : null;
}
