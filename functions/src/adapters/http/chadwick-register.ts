/**
 * The Chadwick Bureau's open player register (S209 AC 1), BT's base source of FanGraphs and Baseball-Reference ids.
 * Its licence, from the register's README: the Open Data Commons Attribution License 1.0 (ODC-By), which allows use
 * and asks for attribution. MLB's `people?hydrate=xrefId` carries FanGraphs ids, and a Lahman id that matches
 * Baseball-Reference's, but no Baseball-Reference id of its own, and it is asked player by player; the register has
 * both for nearly every player and is published as files BT can sync whole. So the register is the base, and MLB's
 * cross-references only fill an id it lacks (`syncPlayerRegister`; recorded in `fixtures/raw/people-xref-823823.json`:
 * where both hold an id they agree, 28 of 28 for each site, and MLB has the FanGraphs ids of the five 2026 rookies the
 * register lacks).
 *
 * It is published as sixteen CSV files (`people-0.csv` … `people-f.csv`, about 4.3 MB and 33,000 rows each, 528,000
 * rows in all, about 8,600 of each file's with an MLB id), split by the register's own person key. The cron syncs one
 * file a run with a conditional request on the ETag it stored (`If-None-Match`): an unchanged file is a 304 with no
 * body. A changed file is streamed line by line, never held whole: reading all sixteen that way, keeping only the
 * columns BT uses, measured (2026-11-27) about 1.2 s of CPU time and 11 MB of JavaScript heap, so one file is a small
 * part of one Worker run's limits (128 MB of memory, 30 s of CPU time). Conditional requests to
 * `raw.githubusercontent.com` don't count against GitHub's API rate limit (they carry no `X-RateLimit` headers and
 * left the API's count unchanged). Nothing here scrapes a stats site's pages (FEATURES' Multi-source knowledge
 * non-goals).
 */
import { PERSON_ID_MAX } from "@bt/domain";
import type {
	PlayerRegister, RegisterFileAnswer, RegisterRow,
} from "@bt/ports";

/** Where the register's files are published (the `chadwickbureau/register` repository's `data/` folder). */
export const CHADWICK_REGISTER_BASE_URL = "https://raw.githubusercontent.com/chadwickbureau/register/master/data";

/** The register's sixteen files, one per first hex digit of its own person key. */
export const CHADWICK_REGISTER_FILES = [..."0123456789abcdef"].map((digit) => `people-${digit}.csv`);

/** The register columns BT reads; every other column is skipped. */
const COLUMNS = ["key_mlbam", "key_fangraphs", "key_bbref", "mlb_played_first"] as const;

type Columns = Record<(typeof COLUMNS)[number], number>;

/** An MLB id as the register writes it: digits with no leading zero. */
const MLB_ID = /^[1-9]\d*$/;

/** The column indexes of {@link COLUMNS} in a register file's header (which holds no quotes). */
function columnIndexes(header: string): Columns
{
	const names = header.trim().split(",");
	const indexes = Object.fromEntries(COLUMNS.map((column) => [column, names.indexOf(column)])) as Columns;
	const missing = COLUMNS.filter((column) => indexes[column] < 0);
	if (missing.length > 0) throw new Error(`Chadwick register header lacks ${missing.join(", ")}`);
	return indexes;
}

/**
 * A CSV line's first `count` fields. A quoted field may hold a comma (`"tejada000jr,"` in `key_bbref_minors`,
 * before `key_fangraphs`) or a doubled quote, so the fields are read quote-aware, not split on every comma; the line
 * after them is never read.
 */
export function leadingFields(line: string, count: number): string[]
{
	const fields: string[] = [];
	let at = 0;
	while (fields.length < count && at <= line.length)
	{
		if (line[at] === "\"")
		{
			let value = "";
			at++;
			for (;;)
			{
				const quote = line.indexOf("\"", at);
				if (quote < 0)
				{
					value += line.slice(at);
					at = line.length;
					break;
				}
				value += line.slice(at, quote);
				if (line[quote + 1] === "\"")
				{
					value += "\"";
					at = quote + 2;
					continue;
				}
				at = quote + 1;
				break;
			}
			fields.push(value);
			const comma = line.indexOf(",", at);
			at = comma < 0 ? line.length + 1 : comma + 1;
			continue;
		}
		const comma = line.indexOf(",", at);
		fields.push(comma < 0 ? line.slice(at) : line.slice(at, comma));
		at = comma < 0 ? line.length + 1 : comma + 1;
	}
	return fields;
}

/**
 * Fetches one register file through `fetchImpl`, conditionally on the ETag stored for it. A 304 is unchanged. A 200
 * is streamed into its rows with an MLB id: a row whose `key_mlbam` is empty, not a whole number or past
 * `PERSON_ID_MAX` is skipped (an empty one is not person 0); an empty id reads as null; two rows naming one MLB id
 * merge, each id the first non-empty one in file order. A 200 with no ETag answers a null one, so that file is
 * fetched whole at each sync. Any other status, or a body that fails, rejects, so the sync stores nothing for it. So
 * does a 200 with no header line (an empty body) or no row with an MLB id: every published file has about 8,600, so
 * such a copy is broken or cut short, and storing it would delete the file's rows under its new ETag, where later
 * 304s would keep them deleted.
 */
export class ChadwickPlayerRegister implements PlayerRegister
{
	readonly files = CHADWICK_REGISTER_FILES;

	constructor(
		private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
		private readonly baseUrl: string = CHADWICK_REGISTER_BASE_URL,
	) {}

	async fetchFile(file: string, etag: string | null): Promise<RegisterFileAnswer>
	{
		const response = await this.fetchImpl(`${this.baseUrl}/${file}`, etag === null ? undefined : {
			headers: {
				"If-None-Match": etag,
			},
		});
		if (response.status === 304) return {
			changed: false,
		};
		if (!response.ok || !response.body) throw new Error(`Chadwick register ${file}: HTTP ${response.status}`);
		const rows = new Map<number, RegisterRow>();
		await readRows(file, response.body, (cells, at) =>
		{
			const key = cells[at.key_mlbam] ?? "";
			if (!MLB_ID.test(key)) return;
			const personId = Number(key);
			if (personId > PERSON_ID_MAX) return;
			const row: RegisterRow = {
				personId,
				fangraphsId: cells[at.key_fangraphs] || null,
				bbrefId: cells[at.key_bbref] || null,
				playedInMlb: Boolean(cells[at.mlb_played_first]),
			};
			const earlier = rows.get(personId);
			rows.set(personId, earlier ? {
				personId,
				fangraphsId: earlier.fangraphsId ?? row.fangraphsId,
				bbrefId: earlier.bbrefId ?? row.bbrefId,
				playedInMlb: earlier.playedInMlb || row.playedInMlb,
			} : row);
		});
		if (rows.size === 0) throw new Error(`Chadwick register ${file}: no row with an MLB id`);
		return {
			changed: true,
			etag: response.headers.get("ETag"),
			rows: [...rows.values()],
		};
	}
}

/**
 * Streams a register file's lines to `onRow` as quote-aware leading fields, after reading the header's column indexes;
 * rejects when `file`'s body holds no header line at all.
 */
async function readRows(file: string, body: ReadableStream<Uint8Array>, onRow: (cells: string[], at: Columns) => void): Promise<void>
{
	const reader = body.pipeThrough(new TextDecoderStream()).getReader();
	let at: Columns | null = null;
	let width = 0;
	let buffer = "";
	const take = (line: string) =>
	{
		if (line === "") return;
		if (!at)
		{
			at = columnIndexes(line);
			width = Math.max(...COLUMNS.map((column) => at![column])) + 1;
			return;
		}
		onRow(leadingFields(line, width), at);
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
	if (!at) throw new Error(`Chadwick register ${file}: no header line`);
}
