/**
 * The backlog's notes directory on disk (docs/v3/backlog/): reading the notes, naming the ones in the
 * wrong folder, and writing a built or imported set back. Kept apart from cli.ts, which parses its
 * arguments and runs a command as soon as it is imported, so these can be tested on a temp directory.
 */

import {
	access, mkdir, readdir, readFile, rm, rmdir, writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { importNotes } from "./assemble.ts";
import {
	BACKLOG_BASE, isNoteKey, noteId,
} from "./vault.ts";

async function exists(path: string): Promise<boolean>
{
	return access(path).then(() => true, () => false);
}

/**
 * Story, bug and frame notes on disk, keyed like the rendered map (`stories/done/S1.md`, `bugs/todo/B74.md`,
 * `frame/00 ….md`). `stories/` and `bugs/` are read recursively so a note in any folder is seen, including
 * a flat `stories/S1.md` from before the status folders, which build then moves (vault.ts storyNotePath),
 * and any misnamed `.md` under `bugs/`, which build then refuses (bugs.ts readBugNotes).
 */
export async function readNotes(dir: string): Promise<Map<string, string>>
{
	const files = new Map<string, string>();
	for (const sub of ["stories", "bugs", "frame"])
	{
		const names = await readdir(join(dir, sub), {
			recursive: true,
		}).catch(() => [] as string[]);
		for (const name of names.map((n) => n.replaceAll("\\", "/")).sort())
		{
			const key = `${sub}/${name}`;
			if (isNoteKey(key))
			{
				files.set(key, await readFile(join(dir, key), "utf8"));
			}
		}
	}
	return files;
}

/**
 * Story and bug notes not in the folder their frontmatter `status` names (or a flat note from the old
 * layout), as messages naming where each belongs. Read from what build would write, so the
 * rule lives in one place (vault.ts storyNotePath, bugNotePath).
 */
export function misplacedNotes(notes: Map<string, string>, built: Map<string, string>): string[]
{
	const builtById = new Map<string, string>();
	for (const key of built.keys())
	{
		const id = noteId(key);
		if (id !== undefined)
		{
			builtById.set(id, key);
		}
	}
	const problems: string[] = [];
	for (const key of notes.keys())
	{
		const id = noteId(key);
		const wanted = id === undefined ? undefined : builtById.get(id);
		if (wanted !== undefined && wanted !== key)
		{
			problems.push(`${id}: ${key} belongs in ${wanted} (its status names the folder)`);
		}
	}
	return problems;
}

/** Write `wanted` into `dir`, removing story/bug/frame notes it no longer contains (a renamed frame heading, a removed story, a note its status moved). */
export async function writeNotes(dir: string, current: Map<string, string>, wanted: Map<string, string>, log: (message: string) => void)
{
	for (const path of current.keys())
	{
		if (!wanted.has(path))
		{
			await rm(join(dir, path));
			log(`removed ${path}`);
		}
	}
	for (const [path, content] of wanted)
	{
		if (current.get(path) !== content)
		{
			await mkdir(dirname(join(dir, path)), {
				recursive: true,
			});
			await writeFile(join(dir, path), content);
		}
	}
	if (!(await exists(join(dir, "Backlog.base"))))
	{
		await writeFile(join(dir, "Backlog.base"), BACKLOG_BASE);
	}
	// A status folder emptied by a move goes too, so Obsidian's file tree shows only live ones. One holding
	// nothing but macOS Finder's .DS_Store counts as empty; anything else keeps it (rmdir refuses a non-empty one).
	for (const sub of ["stories", "bugs"])
	{
		const folders = await readdir(join(dir, sub), {
			withFileTypes: true,
		}).catch(() => []);
		for (const folder of folders.filter((entry) => entry.isDirectory()))
		{
			const path = join(dir, sub, folder.name);
			if ((await readdir(path).catch(() => [] as string[])).join() === ".DS_Store")
			{
				await rm(join(path, ".DS_Store"), {
					force: true,
				});
			}
			await rmdir(path).catch(() => undefined);
		}
	}
}

/** `pnpm backlog:import`: regenerate the notes in `dir` from the BACKLOG.md at `backlogPath`, keeping the bug notes (assemble.ts importNotes). */
export async function importBacklog(dir: string, backlogPath: string, log: (message: string) => void)
{
	const current = await readNotes(dir);
	const wanted = importNotes(await readFile(backlogPath, "utf8"), current);
	await writeNotes(dir, current, wanted, log);
	log(`imported ${wanted.size} notes into ${dir} from ${backlogPath}`);
}
