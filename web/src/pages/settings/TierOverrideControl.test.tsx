/**
 * S215 AC 5: staging's testing-only backer tier override in Settings. It shows only on a 200 from
 * `GET /api/v1/me/tier-override` (staging), renders nothing on a 404 (production, previews) or a
 * failed request, and a choice goes through `PUT`, keeps the new session and reloads `/api/v1/me`.
 */
import type { PatronTier } from "@bt/domain";
import { entitlementsForTier } from "@bt/domain";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup, render, screen, waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";
import { createQueryClient } from "../../api/queryClient.js";
import { DEV_SIGN_IN_TOKEN, useSession } from "../../session/session.js";
import { SessionProvider } from "../../session/SessionProvider.js";
import { getSessionToken, setSessionToken } from "../../session/token.js";
import { resetSettings } from "../../settings/store.js";
import { clearPersonalData } from "../../storage/storage.js";
import { jsonResponse } from "../../test/jsonResponse.js";
import { DEV_ACCOUNT } from "../../test/meApi.js";
import { SettingsPage } from "../SettingsPage.js";

const LABEL = "Testing only (staging): backer tier override";

/**
 * The API as a deployment answers: `/me` with the chosen tier's entitlements (as the server's
 * `effectiveEntitlements` would) and, by `override`, the tier-override routes: `"staging"` answers
 * them, `404` refuses them as production does, `"fail"` errors.
 */
function stubApi(override: "staging" | 404 | "fail", initial: PatronTier | null = null, putFailsAfterSaving = false)
{
	let chosen = initial;
	const puts: unknown[] = [];
	vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
	{
		const { pathname } = new URL(request.url);
		if (pathname === "/api/v1/me") return jsonResponse({
			...DEV_ACCOUNT,
			entitlements: chosen === null ? DEV_ACCOUNT.entitlements : entitlementsForTier(chosen),
		});
		if (pathname === "/api/v1/me/tier-override")
		{
			if (override === 404) return jsonResponse({
				error: "not_found",
			}, 404);
			if (override === "fail") return jsonResponse({
				error: "boom",
			}, 500);
			if (request.method === "PUT")
			{
				const body = await request.json() as { tier: PatronTier | null };
				puts.push(body);
				chosen = body.tier;
				if (putFailsAfterSaving) return jsonResponse({
					error: "boom",
				}, 500);
				return jsonResponse({
					tier: chosen,
					realTier: "none",
					token: "staging-session-2",
				});
			}
			return jsonResponse({
				tier: chosen,
				realTier: "none",
			});
		}
		if (pathname.startsWith("/api/v1/me/download")) return jsonResponse({
			error: "not_found",
		}, 404);
		return new Promise<Response>(() => undefined);
	}));
	return puts;
}

/** What the session says the account's tier is, as every client check reads it. */
function TierProbe()
{
	const session = useSession();
	return <output aria-label="session tier">{session.status === "signedIn" ? session.account.entitlements.tier : "-"}</output>;
}

function renderSettings()
{
	setSessionToken(DEV_SIGN_IN_TOKEN);
	return render(
		<MantineProvider>
			<QueryClientProvider client={createQueryClient()}>
				<SessionProvider>
					<SettingsPage variant="mobile" />
					<TierProbe />
				</SessionProvider>
			</QueryClientProvider>
		</MantineProvider>,
	);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	setSessionToken(null);
	resetSettings();
	clearPersonalData();
});

describe("staging's backer tier override in Settings (S215)", () =>
{
	it("S215 AC 5: a 200 answer shows the labelled control with every choice and the current one selected", async () =>
	{
		stubApi("staging", "Star Backer");
		renderSettings();
		expect(await screen.findByText(LABEL)).toBeInTheDocument();
		expect(screen.getByText(/changes only what this test site shows/i)).toBeInTheDocument();
		for (const name of [/^Use my real Patreon tier/, "Not a patron", "Backer", "Pro Backer", "Star Backer", "Premium Sponsor"])
		{
			expect(screen.getByRole("radio", {
				name,
			})).toBeInTheDocument();
		}
		expect(screen.getByRole("radio", {
			name: "Star Backer",
		})).toBeChecked();
	});

	it("S215 AC 5: a 404 (production, previews) or a failed request renders no control and no label text", async () =>
	{
		for (const answer of [404, "fail"] as const)
		{
			const fetchMock = stubApi(answer);
			renderSettings();
			await screen.findByText(/Signed in as/);
			await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([request]) => new URL((request as Request).url).pathname === "/api/v1/me/tier-override")).toBe(true));
			// Let the answer land before looking.
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(screen.queryByText(LABEL)).toBeNull();
			expect(screen.queryByRole("radio", {
				name: "Not a patron",
			})).toBeNull();
			expect(fetchMock).toEqual([]);
			cleanup();
			vi.unstubAllGlobals();
		}
	});

	it("S215 AC 5: while the answer loads, nothing renders", async () =>
	{
		vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
		{
			if (new URL(request.url).pathname === "/api/v1/me") return jsonResponse(DEV_ACCOUNT);
			return new Promise<Response>(() => undefined);
		}));
		renderSettings();
		await screen.findByText(/Signed in as/);
		expect(screen.queryByText(LABEL)).toBeNull();
	});

	it("S215 AC 5: choosing Pro Backer sends the PUT, keeps the new session and /me then reads Pro Backer; the real tier sends null", async () =>
	{
		const puts = stubApi("staging");
		renderSettings();
		await screen.findByText(LABEL);
		expect(screen.getByLabelText("session tier")).toHaveTextContent("none");
		expect(screen.getByRole("radio", {
			name: /^Use my real Patreon tier/,
		})).toBeChecked();

		await userEvent.click(screen.getByRole("radio", {
			name: "Pro Backer",
		}));
		await waitFor(() => expect(screen.getByLabelText("session tier")).toHaveTextContent("Pro Backer"));
		expect(puts).toEqual([{
			tier: "Pro Backer",
		}]);
		expect(getSessionToken()).toBe("staging-session-2");
		expect(screen.getByRole("radio", {
			name: "Pro Backer",
		})).toBeChecked();

		await userEvent.click(screen.getByRole("radio", {
			name: /^Use my real Patreon tier/,
		}));
		await waitFor(() => expect(screen.getByLabelText("session tier")).toHaveTextContent("none"));
		expect(puts).toEqual([{
			tier: "Pro Backer",
		}, {
			tier: null,
		}]);
	});

	it("S215 AC 5: a PUT that fails after the server saved the choice shows the stored choice and tier anyway", async () =>
	{
		stubApi("staging", null, true);
		renderSettings();
		await screen.findByText(LABEL);
		await userEvent.click(screen.getByRole("radio", {
			name: "Star Backer",
		}));
		await waitFor(() => expect(screen.getByLabelText("session tier")).toHaveTextContent("Star Backer"));
		await waitFor(() => expect(screen.getByRole("radio", {
			name: "Star Backer",
		})).toBeChecked());
	});
});
