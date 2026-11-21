/**
 * Staging's mock sign-in through the real `SessionProvider` and the deployed loader (S143 AC 5):
 * no Logto SDK is loaded on the way, not by the loader and not by the provider.
 *
 * A file of its own because a module mock's factory runs once per file: here nothing else imports
 * `AuthClient.ts`, so the recorder below sees any import the provider makes, a static one included
 * (it would run at this file's load, before any test, and is never cleared).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import {
	act, cleanup, renderHook, waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { MOCK_SIGN_IN_CREDENTIAL } from "@bt/domain";
import { createQueryClient } from "../api/queryClient.js";
import { jsonResponse } from "../test/jsonResponse.js";
import { SessionProvider } from "./SessionProvider.js";
import { useSession } from "./session.js";
import { forgetSignInWay } from "./signInWay.js";
import { getSessionToken, setSessionToken } from "./token.js";

// Records every import of AuthClient.ts, the one module that imports Logto's SDK.
const authClientModule = vi.hoisted(() => ({
	imported: vi.fn(),
}));
vi.mock("./AuthClient.js", () =>
{
	authClientModule.imported();
	return {
		createAuthClient: vi.fn(),
	};
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	// Each case is a fresh page load.
	forgetSignInWay();
	setSessionToken(null);
});

describe("SessionProvider and the deployed loader on staging (S143)", () =>
{
	it("S143 AC 5: in a production build whose Worker answers mock: true, the real provider and loader sign in with the mock credential and never import AuthClient.ts", async () =>
	{
		vi.stubEnv("PROD", true);
		const fetchMock = vi.fn(async (request: Request): Promise<Response> =>
		{
			const path = new URL(request.url).pathname;
			if (path === "/api/v1/sign-in" && request.method === "GET") return jsonResponse({
				logto: null,
				mock: true,
			});
			if (path === "/api/v1/sign-in" && request.method === "POST")
			{
				const { idToken } = await request.json() as { idToken: string };
				return idToken === MOCK_SIGN_IN_CREDENTIAL ? jsonResponse({
					token: "bt-mock-1",
				}) : jsonResponse({
					error: "sign_in_refused",
				}, 401);
			}
			if (path === "/api/v1/me") return request.headers.get("Authorization") === "Bearer bt-mock-1" ? jsonResponse({
				uid: "mock-uid",
				email: "tester@stage.baseball.theater",
				role: "member",
				entitlements: {},
			}) : jsonResponse({}, 401);
			return new Promise<Response>(() => undefined);
		});
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = createQueryClient();
		const { result } = renderHook(() => useSession(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					<SessionProvider>{children}</SessionProvider>
				</QueryClientProvider>
			),
		});
		await waitFor(() => expect(result.current.signInOffer).toBe("offered"));

		await act(async () =>
		{
			expect(await result.current.signIn()).toBe(false);
		});
		expect(result.current.status === "signedIn" && result.current.account.email).toBe("tester@stage.baseball.theater");
		expect(getSessionToken()).toBe("bt-mock-1");
		expect(authClientModule.imported).not.toHaveBeenCalled();
	});
});
