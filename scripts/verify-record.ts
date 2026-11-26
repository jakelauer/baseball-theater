/**
 * What a finishing gate did, for its ledger entry (ADR-030 rule 9, S168): from Turborepo's run
 * summaries (`--summarize`, `.turbo/runs/*.json`) written by one `pnpm verify`, the tasks that ran,
 * those replayed from the cache, and those in the full graph it didn't touch (not affected), so a
 * narrowed or replayed run is never recorded as the whole gate.
 *
 *   node scripts/verify-record.ts --since <epoch ms> [--graph <dry-run.json>] [--root <dir>]
 *
 * Prints Markdown table rows. `--graph` names a saved dry run of the full task list (else it runs one).
 */
import {
	readdirSync, readFileSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface SummaryTask
{
	taskId: string;
	command?: string;
	cache?: { status?: string };
}

/** The three lists from run summaries and the full graph's task ids. */
export function gateRecord(summaries: { tasks: SummaryTask[] }[], graph: string[]): { ran: string[];
	replayed: string[];
	notAffected: string[] }
{
	const ran = new Set<string>();
	const replayed = new Set<string>();
	for (const s of summaries)
	{
		for (const t of s.tasks)
		{
			if (t.command === "<NONEXISTENT>") continue;
			if (t.cache?.status === "HIT") replayed.add(t.taskId);
			else ran.add(t.taskId);
		}
	}
	for (const t of ran) replayed.delete(t);
	const notAffected = graph.filter((t) => !ran.has(t) && !replayed.has(t));
	return {
		ran: [...ran].sort(),
		replayed: [...replayed].sort(),
		notAffected: [...notAffected].sort(),
	};
}

/** Markdown rows for the ledger fragment's table. */
export function gateRows(r: { ran: string[];
	replayed: string[];
	notAffected: string[] }): string
{
	const cell = (l: string[]): string => (l.length ? `${l.length}: ${l.map((t) => `\`${t}\``).join(", ")}` : "none");
	return [`| Gate: tasks that ran | ${cell(r.ran)} |`, `| Gate: replayed from the cache | ${cell(r.replayed)} |`, `| Gate: not affected | ${cell(r.notAffected)} |`].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
	const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1]; };
	const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));
	const since = Number(arg("--since") ?? 0);
	const runs = join(root, ".turbo/runs");
	let files: string[] = [];
	try { files = readdirSync(runs).filter((f) => f.endsWith(".json")).map((f) => join(runs, f)).filter((f) => statSync(f).mtimeMs >= since); }
	catch { files = []; }
	const summaries = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as { tasks: SummaryTask[] });
	const graphFile = arg("--graph");
	let graph: string[];
	if (graphFile) graph = (JSON.parse(readFileSync(graphFile, "utf8")) as { tasks: SummaryTask[] }).tasks.filter((t) => t.command !== "<NONEXISTENT>").map((t) => t.taskId);
	else graph = (await import("./backlog-vault/build-graph.ts")).dryRun(root).map((t) => t.taskId);
	console.log(gateRows(gateRecord(summaries, graph)));
}
