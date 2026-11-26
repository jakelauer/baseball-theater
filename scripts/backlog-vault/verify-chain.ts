import { dryRun, ROOT } from "./build-graph.ts";

/**
 * The scripts `pnpm verify` reaches (S84, S85): `verify` and every `pnpm <script>` it
 * calls, followed transitively. Since ADR-030 (S168) the checks themselves are tasks of the graph
 * the entry point runs (scripts/verify.sh); `graphTasks` lists them for law P8 and the laws registry.
 */
export function verifyChain(scripts: Record<string, string>): Set<string>
{
	const seen = new Set<string>();
	const walk = (name: string): void =>
	{
		if (seen.has(name) || !(name in scripts)) return;
		seen.add(name);
		for (const m of scripts[name]!.matchAll(/pnpm (?:-s )?(?:run )?([a-z][\w:-]*)/g)) walk(m[1]!);
	};
	walk("verify");
	return seen;
}

/** Law P8: the scripts in the verify chain whose command starts a browser (Playwright, or Lighthouse CI's Chrome since S62). */
export function browserSteps(scripts: Record<string, string>): string[]
{
	return [...verifyChain(scripts)].filter((name) => /playwright|design:capture|e2e\/|lhci/.test(scripts[name]!));
}

/** Every task of the full graph `pnpm verify --full` runs, with its command (ADR-030 rule 11). */
export function graphTasks(root: string = ROOT): { taskId: string;
	command: string }[]
{
	return dryRun(root).map((t) => ({
		taskId: t.taskId,
		command: t.command,
	}));
}

/**
 * Law P8 over the graph: the tasks whose command starts a browser. A task whose command runs a root
 * script (`pnpm -w run size`, as web's `size` does) is judged by that script's text and every root
 * script it runs in turn (`rootScripts`: the root package.json's scripts), each read once.
 */
export function browserTasks(tasks: { taskId: string;
	command: string }[], rootScripts: Record<string, string>): string[]
{
	const expand = (command: string, seen: Set<string>): string =>
	{
		let text = command;
		for (const m of command.matchAll(/pnpm (?:-w |--workspace-root )?(?:-s )?(?:run )?([a-z][\w:-]*)/g))
		{
			const name = m[1]!;
			if (seen.has(name) || !(name in rootScripts)) continue;
			seen.add(name);
			text += `\n${expand(rootScripts[name]!, seen)}`;
		}
		return text;
	};
	return tasks.filter((t) => /playwright|design:capture|lhci/.test(expand(t.command, new Set()))).map((t) => t.taskId);
}
