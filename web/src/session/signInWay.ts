/**
 * How this page signs fans in (S116, S143): the one read of the Worker's answer
 * (`GET /api/v1/sign-in`) that the header's "Sign in" and the sign-in itself share, asked once
 * per page load (ADR-025), not once each.
 *
 * - **Logto** where the Worker names a tenant (production). The answer alone loads nothing of
 *   Logto's: `AuthClient.ts`, the one module that imports Logto's SDK, is imported only when a
 *   sign-in, its callback or a sign-out first asks for the client (`client()`), so a page load
 *   never downloads it and "Sign in" never waits on it.
 * - **The mock** where the Worker says `mock: true` (staging): the sign-in hands the fixed mock
 *   credential to `POST /api/v1/sign-in` and never loads Logto's SDK.
 * - **None** where it says neither (previews): the header shows no "Sign in" at all.
 * - **Dev** in a development build, which signs in as `dev:test-user` without asking the Worker.
 *
 * This module imports Logto's code only by `import()` and its types only as types, so loading it
 * never loads the SDK.
 */
import { fetchSignInConfig } from "../api/client.js";
import type { AuthClient, LogtoTarget } from "./AuthClient.js";

export type SignInWay =
	| { kind: "logto";
		/** The tenant's client, imported and made on the first call and the same one after. */
		client(): Promise<AuthClient>; }
	| { kind: "mock" }
	| { kind: "dev" }
	| { kind: "none" };

/** Answers this page's {@link SignInWay}; `SessionProvider` takes one, and tests pass their own. */
export type SignInWayLoader = () => Promise<SignInWay>;

let loaded: Promise<SignInWay> | undefined;

/**
 * `client()` for `target`: the first call imports `AuthClient.ts` and makes the client; the promise
 * is kept at once, so two clicks before the chunk arrives share one import and one client. A failed
 * load (the chunk didn't arrive) isn't kept, so the next click tries again.
 */
function lazyClient(target: LogtoTarget): () => Promise<AuthClient>
{
	let made: Promise<AuthClient> | undefined;
	return () =>
	{
		made ??= import("./AuthClient.js").then(({ createAuthClient }) => createAuthClient(target, location.origin)).catch((error: unknown) =>
		{
			made = undefined;
			throw error;
		});
		return made;
	};
}

/**
 * The deployed loader: a development build is `dev` without asking; a production build asks the
 * Worker once per page load, and its answer imports nothing of Logto's. A failed ask isn't
 * remembered, so the next call (a click on "Sign in") asks again.
 */
export const deployedSignInWay: SignInWayLoader = () =>
{
	if (!import.meta.env.PROD) return Promise.resolve({
		kind: "dev",
	});
	loaded ??= (async (): Promise<SignInWay> =>
	{
		const { logto, mock } = await fetchSignInConfig();
		if (logto) return {
			kind: "logto",
			client: lazyClient(logto),
		};
		return mock ? {
			kind: "mock",
		} : {
			kind: "none",
		};
	})().catch((error: unknown) =>
	{
		loaded = undefined;
		throw error;
	});
	return loaded;
};

/** Forgets this page's answer, as a new page load would; for tests, which share one module across cases. */
export function forgetSignInWay(): void
{
	loaded = undefined;
}
