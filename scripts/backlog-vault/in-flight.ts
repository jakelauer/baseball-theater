/**
 * The backlog items in flight during a parallel run (S156, AC 13): the items workers have claimed
 * and not yet shipped. The debt scripts (scripts/review-debt.sh, scripts/parity-debt.sh) print how
 * many there are beside the `done` count, since a review that falls due starts beside them rather
 * than waiting for them (owner, 2026-11-20: "Run them in parallel (Recommended)").
 *
 * Read from `--in-flight S1,S2` when the overseer passes it, else from the claim files the run
 * keeps in the git-ignored `.run/claims/<ID>.json` (claims.ts writes them; only their names are
 * read here, so this never depends on what a claim holds).
 *
 *   node scripts/backlog-vault/in-flight.ts check <IDs>   exit 0 when <IDs> is empty or comma-separated
 *       item IDs exactly (`S9,F1`: no spaces, upper case), else exit 2 naming what isn't one
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isRunDirectly } from "./run-directly.ts";

/**
 * A backlog item's ID, the one definition (ADR-025): a story `S156`, a bug `B87`, a parallel run's
 * shared fix `F1` (run-backlog step 3) or a vault-migration stage `V3`. claims.ts uses it for claim
 * file names, and scripts/audit.sh checks `--in-flight` with this file's `check` command.
 */
export const ITEM_ID = /^[SBFV][0-9]+$/;

/**
 * The in-flight IDs, in order, each once: from `flag` (comma- or space-separated) when it is given,
 * even empty (an explicit "none"), else from `<root>/.run/claims/*.json`, or none when that is missing.
 */
export function inFlightIds(root: string, flag?: string): string[]
{
	const ids = flag === undefined ? claimedIds(root) : flag.split(/[\s,]+/).map((id) => id.trim().toUpperCase());
	return [...new Set(ids.filter((id) => ITEM_ID.test(id)))];
}

/** The IDs the run's claim files name, sorted by ID number. */
function claimedIds(root: string): string[]
{
	let names: string[];
	try
	{
		names = readdirSync(join(root, ".run", "claims"));
	}
	catch
	{
		return [];
	}
	return names
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length))
		.sort((a, b) => a.localeCompare(b, "en", {
			numeric: true,
		}));
}

/** The tokens of a comma-separated `--in-flight` value that aren't item IDs exactly; empty means none are in flight. */
export function invalidInFlight(value: string): string[]
{
	return value === "" ? [] : value.split(",").filter((id) => !ITEM_ID.test(id));
}

if (isRunDirectly(import.meta.url))
{
	const [command, value] = process.argv.slice(2);
	if (command !== "check" || value === undefined)
	{
		console.error("usage: in-flight.ts check <comma-separated item IDs>");
		process.exitCode = 2;
	}
	else
	{
		const bad = invalidInFlight(value);
		if (bad.length > 0)
		{
			console.error(`not item IDs (S<N>, B<N>, F<N> or V<N>, comma-separated, no spaces): ${bad.map((b) => `'${b}'`).join(", ")}`);
			process.exitCode = 2;
		}
	}
}
