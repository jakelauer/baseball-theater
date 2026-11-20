/**
 * The backlog items in flight during a parallel run (S156, AC 13): the items workers have claimed
 * and not yet shipped. The debt scripts (scripts/review-debt.sh, scripts/parity-debt.sh) print how
 * many there are beside the `done` count, since a review that falls due starts beside them rather
 * than waiting for them (owner, 2026-11-20: "Run them in parallel (Recommended)").
 *
 * Read from `--in-flight S1,S2` when the overseer passes it, else from the claim files the run
 * keeps in the git-ignored `.run/claims/<ID>.json` (claims.ts writes them; only their names are
 * read here, so this never depends on what a claim holds).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** A story or bug ID: `S156`, `B87`. */
const ITEM_ID = /^[SB]\d+$/;

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
