/**
 * Staging's mock sign-in (S143; owner, 2026-11-10: "Can we make it a session-only shim where
 * clicking Sign In gives me a cookie that is valid but which uses a mock version?"): an
 * `IdentityProvider` like Logto's, wired only where `mockSignInAllowed` says (staging), that
 * vouches for one fixed test account in exchange for one fixed credential. BT then issues its
 * ordinary session through the same `signIn` a Logto sign-in uses, so everything an account does
 * works behind it. Everyone who signs in on staging lands in that one shared account (owner,
 * 2026-11-10: "yeah, plan this story and move it up to the top priority."); staging holds no
 * fan's data (S114 AC 9).
 *
 * Unlike the dev provider (`Bearer dev:<uid>`, local only), it accepts no uid of the caller's
 * choosing and issues no session by itself: the credential is traded once at
 * `POST /api/v1/sign-in` for a BT session.
 */
import type { IdentityClaims, IdentityProvider } from "@bt/ports";
import { MOCK_SIGN_IN_CREDENTIAL } from "@bt/domain";
import { CredentialRefusedError } from "../../services/accounts.js";

export { MOCK_SIGN_IN_CREDENTIAL };

/** The provider name the test account is linked under (`identity_links.provider`). */
export const MOCK_PROVIDER = "mock";

/** The test account's one subject: every mock sign-in is this account. */
export const MOCK_SUBJECT = "staging-test-account";

/**
 * The test account's address, on staging's own domain, so S82's no-email refusal never fires and
 * nothing is ever mailed to a real person.
 */
export const MOCK_EMAIL = "tester@stage.baseball.theater";

export class MockIdentityProvider implements IdentityProvider
{
	/** `now` is the clock `authTime` reads; tests inject one. */
	constructor(private readonly now: () => Date = () => new Date()) {}

	async completeSignIn(credential: string): Promise<IdentityClaims>
	{
		if (credential !== MOCK_SIGN_IN_CREDENTIAL) throw new CredentialRefusedError("not the mock sign-in credential");
		return {
			provider: MOCK_PROVIDER,
			subject: MOCK_SUBJECT,
			email: MOCK_EMAIL,
			emailVerified: true,
			// Signed in this moment, so deletion's recent-sign-in check passes right after it (S120).
			authTime: Math.floor(this.now().getTime() / 1000),
		};
	}
}
