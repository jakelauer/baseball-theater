/**
 * `pnpm --filter @bt/functions record-fixtures -- --date=… --game=…`
 * `pnpm --filter @bt/functions record-fixtures -- --season=YYYY [--spring-date=YYYY-MM-DD]`
 * `pnpm --filter @bt/functions record-fixtures -- --date=YYYY-MM-DD` (one day's standings alone, S155)
 *
 * The `--season` form records one season's calendar, World Series, final standings and (with
 * `--spring-date`) its spring training standings as of that day, through `seasonEndpoints` (S128).
 *
 * Re-records the committed fixture corpus from live MLB: the Stats API payloads
 * and MLB's play-metrics feed (`raw/playmetrics-<gamePk>.json`, from
 * `bdfed.stitch.mlbinfra.com`, S93) and its GraphQL game content
 * (`raw/graphql-content-<gamePk>.json`, from `data-graph.mlb.com`, S94), all through `rawEndpoints`. This is the one
 * network-touching entrypoint in the repo and is **never** run by CI or
 * `pnpm verify` — both stay on `FixtureMlbStatsClient`. Review the diff before
 * committing re-recorded payloads (see README). Its arguments are parsed by
 * `parseRecordFixturesArgs` (`record-fixtures-args.ts`), which refuses a flag
 * its form wouldn't read; on any argument error it prints the usage and exits 2.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpMlbStatsClient } from "../adapters/http/mlb.js";
import {
	recordEndpoints,
	recordNormalized,
	recordRaw,
	recordStandingsDay,
	seasonEndpoints,
	type RecorderTarget,
} from "../services/recorder.js";
import { parseRecordFixturesArgs, type RecordFixturesArgs } from "./record-fixtures-args.js";

const FIXTURES_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures",
);

async function main(): Promise<void>
{
	let args: RecordFixturesArgs;
	try
	{
		args = parseRecordFixturesArgs(process.argv.slice(2));
	}
	catch (error)
	{
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}
	const outDir = args.out ?? FIXTURES_ROOT;
	if (args.form === "season")
	{
		const written = await recordEndpoints(seasonEndpoints(args.season, args.springDate), outDir);
		for (const file of written) console.log(`wrote raw/${file}`);
		return;
	}
	if (args.form === "day")
	{
		// One day's standings alone (S155): MLB's raw table, then the mapped one from that same answer.
		for (const file of await recordStandingsDay(args.date, outDir)) console.log(`wrote ${file}`);
		return;
	}

	const target: RecorderTarget = {
		date: args.date,
		gamePk: args.gamePk,
		playerIds: args.playerIds,
	};

	const raw = await recordRaw(target, outDir);
	const normalized = await recordNormalized(new HttpMlbStatsClient(), target, outDir);
	for (const file of [...raw.map((f) => `raw/${f}`), ...normalized])
	{
		console.log(`wrote ${file}`);
	}
}

await main();
