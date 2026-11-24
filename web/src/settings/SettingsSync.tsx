import { useEffect } from "react";
import { useSession } from "../session/session.js";
import { getSessionToken } from "../session/token.js";
import { hydrateSettings, resetSettings } from "./store.js";

/**
 * Ties the settings store to the session (ADR-027): signed in, it reads the
 * account's settings; signed out, it puts the house defaults back. It runs
 * again when the signed-in account changes without the status changing (a
 * sign-in as someone else, S120), and the store resets before reading the new
 * account's. Renders nothing; mounted once inside `SessionProvider`.
 *
 * "Signed out" resets only when no session token is left (S74): sign-out and a
 * refused token (401) both drop it first, but a server that can't be reached
 * (an offline cold start, where `/api/v1/me` is never stored by the worker)
 * reads as signed out with the token kept, and there the cached copy of this
 * browser's settings stands, so Hide Scores still masks the stored scores.
 */
export function SettingsSync(): null
{
	const session = useSession();
	const { status } = session;
	const uid = session.status === "signedIn" ? session.account.uid : null;
	useEffect(() =>
	{
		if (uid !== null) hydrateSettings(uid).catch(() => undefined);
		if (status === "signedOut" && getSessionToken() === null) resetSettings();
	}, [status, uid]);
	return null;
}
