/**
 * `pnpm clips:engagement-export --from YYYY-MM-DD --to YYYY-MM-DD [--out <file>]` (S174 AC 7): writes the anonymous daily
 * clip counts whose UTC day falls in the inclusive range as JSON lines, one `ClipEngagementRow` per line, in the port's
 * order, for S185's ranking model to train on. To `--out` (a path from where the command was typed) or, without it, to
 * standard output; a range with no rows writes nothing, so `--out` leaves an empty file, and exits 0.
 *
 * It reads the database `BT_DATABASE_URL` names, else the local one `pnpm dev` starts (`localConnectionString`). The
 * rows hold nothing about who watched (S174 AC 5), so the file is safe to hand to training as it is.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isCalendarDate } from "@bt/domain";
import type { ClipEngagementRepository } from "@bt/ports";
import { openPostgres } from "../adapters/postgres/connect.js";
import { localConnectionString } from "../adapters/postgres/local.js";
import { PostgresClipEngagementRepository } from "../adapters/postgres/repos.js";

/** Printed with every argument error. */
export const CLIP_EXPORT_USAGE = "usage: pnpm clips:engagement-export --from YYYY-MM-DD --to YYYY-MM-DD [--out <file>]";

/** What the export runs with: the inclusive range of UTC days and where to write, if not standard output. */
export type ClipExportArgs = {
	from: string;
	to: string;
	out: string | null;
};

const VALUE_FLAGS = new Set(["--from", "--to", "--out"]);

/**
 * Parses `argv` (without node and the script): `--from` and `--to` are required real calendar dates with `--from` no
 * later than `--to`, and `--out` is optional. Both `--flag value` and `--flag=value` are read. Throws with
 * {@link CLIP_EXPORT_USAGE} on anything else.
 */
export function parseClipExportArgs(argv: readonly string[]): ClipExportArgs
{
	const values = new Map<string, string>();
	for (let i = 0; i < argv.length; i++)
	{
		const [flag = "", inline] = argv[i]!.split(/=(.*)/s, 2);
		if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown argument ${argv[i]}\n${CLIP_EXPORT_USAGE}`);
		const value = inline ?? argv[++i];
		if (value === undefined || value === "") throw new Error(`${flag} needs a value\n${CLIP_EXPORT_USAGE}`);
		values.set(flag, value);
	}
	const from = values.get("--from");
	const to = values.get("--to");
	if (from === undefined || to === undefined) throw new Error(`--from and --to are required\n${CLIP_EXPORT_USAGE}`);
	if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error(`--from and --to must be real YYYY-MM-DD dates\n${CLIP_EXPORT_USAGE}`);
	if (from > to) throw new Error(`--from ${from} is after --to ${to}\n${CLIP_EXPORT_USAGE}`);
	return {
		from,
		to,
		out: values.get("--out") ?? null,
	};
}

/**
 * Runs the export against `counts` and returns the exit code: 0 once the range's rows are written (none is still a
 * success), 2 for arguments it can't read, with the reason on `io.error`. `io.cwd` resolves a relative `--out`.
 */
export async function runClipEngagementExport(counts: ClipEngagementRepository, argv: readonly string[], io: { cwd: string;
	stdout: (text: string) => void;
	error: (text: string) => void; }): Promise<number>
{
	let args: ClipExportArgs;
	try
	{
		args = parseClipExportArgs(argv);
	}
	catch (error)
	{
		io.error((error as Error).message);
		return 2;
	}
	const rows = await counts.exportRange(args.from, args.to);
	const lines = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
	if (args.out === null) io.stdout(lines);
	else await writeFile(path.resolve(io.cwd, args.out), lines);
	return 0;
}

if (import.meta.main)
{
	const { db, close } = await openPostgres(process.env.BT_DATABASE_URL ?? localConnectionString());
	try
	{
		// `pnpm --filter … exec` runs here in functions/, so a relative --out is read from where the command was typed.
		process.exitCode = await runClipEngagementExport(new PostgresClipEngagementRepository(db), process.argv.slice(2), {
			cwd: process.env.INIT_CWD ?? process.cwd(),
			stdout: (text) => process.stdout.write(text),
			error: (text) => console.error(`[clips:engagement-export] ${text}`),
		});
	}
	finally
	{
		await close();
	}
}
