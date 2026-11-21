/**
 * The deployed sign-in loader (S143 AC 5, AC 6): one read of the Worker's answer per page load,
 * and Logto's SDK (`AuthClient.ts`) imported only when a Logto sign-in or sign-out first asks for
 * the client, never on page load.
 */
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { jsonResponse } from "../test/jsonResponse.js";
import { deployedSignInWay, forgetSignInWay } from "./signInWay.js";

// Counts every client AuthClient.ts (the one module that imports Logto's SDK) makes. The module's
// import itself is counted only in SessionProvider.mockSignIn.test.tsx: a mock's factory runs once
// per file, so an import count here would depend on which case ran first. Every `client()` that
// loads the module calls `createAuthClient`, so its calls stand in for the import here.
const authClientModule = vi.hoisted(() => ({
	createAuthClient: vi.fn((..._args: unknown[]) => ({
		signIn: vi.fn(),
		finishSignIn: vi.fn(),
		signOut: vi.fn(),
	})),
}));
vi.mock("./AuthClient.js", () => ({
	createAuthClient: authClientModule.createAuthClient,
}));

/** A production build whose Worker answers `answer` to GET /api/v1/sign-in. */
function deployed(answer: unknown, status = 200)
{
	vi.stubEnv("PROD", true);
	const fetchMock = vi.fn(async () => jsonResponse(answer, status));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() =>
{
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	forgetSignInWay();
	authClientModule.createAuthClient.mockClear();
});

describe("the deployed sign-in loader (S143)", () =>
{
	it("S143 AC 5: an answer naming a Logto tenant makes no client; only way.client() makes one, once", async () =>
	{
		deployed({
			logto: {
				endpoint: "https://auth.bt.test",
				appId: "spa",
			},
			mock: false,
		});
		const way = await deployedSignInWay();
		if (way.kind !== "logto") throw new Error(`expected the logto way, got ${way.kind}`);
		// The header has its answer; no client is made, so nothing of Logto's is asked for.
		// Any import the loader started has finished, so a client it made would be counted by now.
		await vi.dynamicImportSettled();
		expect(authClientModule.createAuthClient).not.toHaveBeenCalled();
		// Two clicks before the chunk arrives share one import and one client.
		const [first, second] = await Promise.all([way.client(), way.client()]);
		expect(await way.client()).toBe(first);
		expect(second).toBe(first);
		expect(authClientModule.createAuthClient).toHaveBeenCalledOnce();
		expect(authClientModule.createAuthClient).toHaveBeenCalledWith({
			endpoint: "https://auth.bt.test",
			appId: "spa",
		}, location.origin);
	});

	it("S143 AC 5: a client that fails to load isn't remembered, so the next sign-in tries again", async () =>
	{
		deployed({
			logto: {
				endpoint: "https://auth.bt.test",
				appId: "spa",
			},
			mock: false,
		});
		const way = await deployedSignInWay();
		if (way.kind !== "logto") throw new Error(`expected the logto way, got ${way.kind}`);
		authClientModule.createAuthClient.mockImplementationOnce(() =>
		{
			throw new Error("chunk failed");
		});
		await expect(way.client()).rejects.toThrow("chunk failed");
		await expect(way.client()).resolves.toBeDefined();
		expect(authClientModule.createAuthClient).toHaveBeenCalledTimes(2);
	});

	it("S143 AC 5: a production build whose Worker answers mock: true signs in with the mock and never makes a Logto client", async () =>
	{
		const fetchMock = deployed({
			logto: null,
			mock: true,
		});
		expect(await deployedSignInWay()).toEqual({
			kind: "mock",
		});
		// Any import the loader started has finished, so a client it made would be counted by now.
		await vi.dynamicImportSettled();
		expect(authClientModule.createAuthClient).not.toHaveBeenCalled();
		expect(new URL((fetchMock.mock.calls[0] as unknown as [Request])[0].url).pathname).toBe("/api/v1/sign-in");
	});

	it("S143 AC 6: logto null and mock false is no sign-in; a development build is dev without asking", async () =>
	{
		const fetchMock = deployed({
			logto: null,
			mock: false,
		});
		expect(await deployedSignInWay()).toEqual({
			kind: "none",
		});
		forgetSignInWay();
		vi.stubEnv("PROD", false);
		expect(await deployedSignInWay()).toEqual({
			kind: "dev",
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("S143 AC 6: asked once per page load, and a failed ask isn't remembered, so the next one asks again", async () =>
	{
		const fetchMock = deployed({
			error: "unavailable",
		}, 503);
		await expect(deployedSignInWay()).rejects.toThrow();
		fetchMock.mockImplementation(async () => jsonResponse({
			logto: null,
			mock: true,
		}));
		expect((await deployedSignInWay()).kind).toBe("mock");
		expect((await deployedSignInWay()).kind).toBe("mock");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
