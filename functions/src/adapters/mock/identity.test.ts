import {
	describe, expect, it,
} from "vitest";
import { CredentialRefusedError } from "../../services/accounts.js";
import {
	MOCK_EMAIL, MOCK_SIGN_IN_CREDENTIAL, MOCK_SUBJECT, MockIdentityProvider,
} from "./identity.js";

describe("the mock identity provider (S143)", () =>
{
	it("S143 AC 1: the fixed credential signs in as the one test account, signed in at the injected clock's moment", async () =>
	{
		const at = new Date("2026-11-18T12:34:56Z");
		const claims = await new MockIdentityProvider(() => at).completeSignIn(MOCK_SIGN_IN_CREDENTIAL);
		expect(claims).toEqual({
			provider: "mock",
			subject: MOCK_SUBJECT,
			email: MOCK_EMAIL,
			emailVerified: true,
			authTime: Math.floor(at.getTime() / 1000),
		});
		expect(MOCK_EMAIL).toMatch(/@stage\.baseball\.theater$/);
		expect(MOCK_SIGN_IN_CREDENTIAL.startsWith("dev:")).toBe(false);
	});

	it("S143 AC 1: any other credential is refused as a CredentialRefusedError", async () =>
	{
		const provider = new MockIdentityProvider();
		for (const credential of ["another-string", "", "dev:test-user", ` ${MOCK_SIGN_IN_CREDENTIAL}`, `${MOCK_SIGN_IN_CREDENTIAL} `, `${MOCK_SIGN_IN_CREDENTIAL}x`])
		{
			await expect(provider.completeSignIn(credential)).rejects.toBeInstanceOf(CredentialRefusedError);
		}
	});
});
