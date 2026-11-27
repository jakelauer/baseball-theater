/**
 * The Chadwick Bureau's open player register (S209 AC 1), BT's one source of FanGraphs and
 * Baseball-Reference ids: MLB's `people?hydrate=xrefId` carries FanGraphs ids but no Baseball-Reference
 * ids (`fixtures/raw/people-xref-823823.json`: all 33 of 823823's players have a `fangraphs` cross-reference,
 * none a Baseball-Reference one), so MLB can't be the source. Its licence, from the register's README:
 * the Open Data Commons Attribution License 1.0 (ODC-By), which allows use and asks for attribution.
 *
 * It is published as sixteen CSV files (`people-0.csv` … `people-f.csv`, about 4.3 MB each, 68 MB and
 * 528,000 rows in all), split by the register's own person key, not MLB's, so finding a set of players means
 * reading every file. Measured 2026-11-27 by streaming all sixteen once and keeping only the 33 wanted rows,
 * as `lookup` does: about 1.2 s of CPU time, 1.1–8 s of wall time, and 11 MB of JavaScript heap, since
 * no file is ever held whole. That is inside one Worker run's limits (128 MB of memory, 30 s of CPU time
 * by default, a cron's 15 minutes of wall time, and 16 of its subrequests), so the cron's resolve step reads
 * the whole register in one run, at most once a run and only when players are waiting (`runPlayerIdJobs`).
 * Nothing here scrapes a stats site's pages (FEATURES' Multi-source knowledge non-goals).
 */
import type { PlayerRegister, ResolvedPlayerIds } from "@bt/ports";

/** Where the register's files are published (the `chadwickbureau/register` repository's `data/` folder). */
export const CHADWICK_REGISTER_BASE_URL = "https://raw.githubusercontent.com/chadwickbureau/register/master/data";

/** The register's sixteen files, one per first hex digit of its own person key. */
export const CHADWICK_REGISTER_FILES = [..."0123456789abcdef"].map((digit) => `people-${digit}.csv`);

/** The register columns BT reads; every other column is skipped. */
const COLUMNS = ["key_mlbam", "key_fangraphs", "key_bbref"] as const;

/**
 * The column indexes of {@link COLUMNS} in a register file's header. The key columns come before every
 * name column and never hold a quote or a comma, so a plain split of the leading fields is enough.
 */
function columnIndexes(header: string): Record<(typeof COLUMNS)[number], number>
{
	const names = header.trim().split(",");
	const indexes = Object.fromEntries(COLUMNS.map((column) => [column, names.indexOf(column)])) as Record<(typeof COLUMNS)[number], number>;
	const missing = COLUMNS.filter((column) => indexes[column] < 0);
	if (missing.length > 0) throw new Error(`Chadwick register header lacks ${missing.join(", ")}`);
	return indexes;
}

/**
 * Reads the register's rows for `personIds` (MLBAM ids) through `fetchImpl`, streaming each file line by line
 * and keeping only the rows asked for, so memory stays small whatever a file's size; it stops once every
 * player is found. A player the register lacks is absent from the answer; an empty id reads as null. A file
 * that fails rejects the whole lookup, so the resolve step marks nothing checked and the next run asks again.
 */
export class ChadwickPlayerRegister implements PlayerRegister
{
	constructor(
		private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
		private readonly baseUrl: string = CHADWICK_REGISTER_BASE_URL,
	) {}

	async lookup(personIds: readonly number[]): Promise<Map<number, ResolvedPlayerIds>>
	{
		const wanted = new Set(personIds);
		const found = new Map<number, ResolvedPlayerIds>();
		for (const file of CHADWICK_REGISTER_FILES)
		{
			if (found.size === wanted.size) break;
			const response = await this.fetchImpl(`${this.baseUrl}/${file}`);
			if (!response.ok || !response.body) throw new Error(`Chadwick register ${file}: HTTP ${response.status}`);
			await readRows(response.body, (cells, at) =>
			{
				const mlbam = Number(cells[at.key_mlbam]);
				if (!wanted.has(mlbam)) return;
				found.set(mlbam, {
					fangraphsId: cells[at.key_fangraphs] || null,
					bbrefId: cells[at.key_bbref] || null,
				});
			});
		}
		return found;
	}
}

/** Streams a register file's lines to `onRow` as split leading fields, after reading the header's column indexes. */
async function readRows(body: ReadableStream<Uint8Array>, onRow: (cells: string[], at: ReturnType<typeof columnIndexes>) => void): Promise<void>
{
	const reader = body.pipeThrough(new TextDecoderStream()).getReader();
	let at: ReturnType<typeof columnIndexes> | null = null;
	let width = 0;
	let buffer = "";
	const take = (line: string) =>
	{
		if (line === "") return;
		if (!at)
		{
			at = columnIndexes(line);
			width = Math.max(at.key_mlbam, at.key_fangraphs, at.key_bbref) + 1;
			return;
		}
		onRow(line.split(",", width), at);
	};
	for (;;)
	{
		const { done, value } = await reader.read();
		if (done) break;
		buffer += value;
		let start = 0;
		let newline = buffer.indexOf("\n", start);
		while (newline >= 0)
		{
			take(buffer.slice(start, newline).replace(/\r$/, ""));
			start = newline + 1;
			newline = buffer.indexOf("\n", start);
		}
		buffer = buffer.slice(start);
	}
	take(buffer.replace(/\r$/, ""));
}
