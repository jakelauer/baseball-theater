/**
 * Areas and milestones, set directly on GitHub (S165 AC 4; owner, 2026-11-20: "GitHub owns state
 * (Recommended)"), never a ledger record:
 *
 *   - each story's `area:*` label, from its recorded `scope_files` ({@link areaOf});
 *   - each `done` story's milestone: the first published release whose commit contains its shipping
 *     commit (`git merge-base --is-ancestor`), or none for work shipped before the first release
 *     ({@link milestoneFor}). The shipping commit is the one `audit.sh --reverify` and the graders
 *     use (scripts/lib/checks.sh `story_tip`), so all three agree.
 *
 *   pnpm backlog:areas [--dry-run]   (the coordinator's session; reads the cache `pnpm backlog:sync`
 *                                    wrote) sets both; --dry-run only prints the changes
 */

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CachedIssue, GhRunner } from "./github.ts";
import {
	cacheDir, ghRunner, itemsFromCache, listMilestones, NoCacheError, patchIssue, readCache, request, storeIssue,
} from "./github.ts";
import { fragmentsDir, readRecords } from "./text-records.ts";

/** The area labels, one per story. */
export const AREAS = ["area:web", "area:api", "area:ingest", "area:design", "area:process"] as const;
export type Area = (typeof AREAS)[number];

/** The product area one scope entry reaches, or undefined for process paths (scripts, docs, CI, the backlog). */
function entryArea(path: string): Area | undefined
{
	if (/^docs\/v3\/visual\//.test(path))
	{
		return "area:design";
	}
	if (/^(web|e2e)\//.test(path))
	{
		return "area:web";
	}
	if (/^(functions\/src\/ingest|packages\/mlb-api|fixtures)(\/|$)/.test(path))
	{
		return "area:ingest";
	}
	if (/^(functions|packages|openapi|migrations)(\/|$)/.test(path))
	{
		return "area:api";
	}
	return undefined;
}

/**
 * A story's area from its `scope_files`: the first entry, in scope order, that reaches a product area
 * (web, api, ingest or design), so a story spanning two takes the first; `area:process` when none does
 * (scripts, docs, CI and the backlog itself). Pure.
 */
export function areaOf(scopeFiles: string[]): Area
{
	for (const path of scopeFiles)
	{
		const area = entryArea(path);
		if (area !== undefined)
		{
			return area;
		}
	}
	return "area:process";
}

/** A published release: its title (the milestone's name, `v3.1.0`) and the commit its tag points at. */
export interface Release
{
	title: string;
	commit: string;
}

/**
 * A done story's milestone: the title of the first release, in publish order, whose commit contains
 * `ship` (`isAncestor(ship, release.commit)`), or undefined when none does or `ship` is unknown.
 */
export function milestoneFor(ship: string | undefined, releases: Release[], isAncestor: (a: string, b: string) => boolean): string | undefined
{
	if (ship === undefined || ship === "")
	{
		return undefined;
	}
	return releases.find((r) => isAncestor(ship, r.commit))?.title;
}

/** `git merge-base --is-ancestor a b` in `root`: false when either commit is unknown here. */
export function gitIsAncestor(root: string): (a: string, b: string) => boolean
{
	return (a, b) => spawnSync("git", ["merge-base", "--is-ancestor", a, b], {
		cwd: root,
		stdio: "ignore",
	}).status === 0;
}

/** The published releases, oldest first, each with its tag's commit (`git rev-list -n1 <tag>`; fetch tags first). */
export function publishedReleases(run: GhRunner, root: string): Release[]
{
	const raw = JSON.parse(request(run, "GET", "repos/{owner}/{repo}/releases?per_page=100").body || "[]") as { tag_name: string;
		draft: boolean;
		published_at: string | null; }[];
	return raw.filter((r) => !r.draft && r.published_at !== null).sort((a, b) => a.published_at!.localeCompare(b.published_at!)).flatMap((r) =>
	{
		try
		{
			const commit = execFileSync("git", ["rev-list", "-n1", `refs/tags/${r.tag_name}`], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			return [{
				title: r.tag_name,
				commit,
			}];
		}
		catch
		{
			return [];
		}
	});
}

/** A story's shipping commit through scripts/lib/checks.sh `story_tip`, or undefined. */
export function shippingCommit(root: string, id: string): string | undefined
{
	const r = spawnSync("bash", ["-c", ". scripts/lib/checks.sh; story_tip \"$1\"", "areas", id], {
		cwd: root,
		encoding: "utf8",
	});
	const sha = r.stdout.trim();
	return sha === "" ? undefined : sha;
}

/** One planned change: an issue's new labels and/or milestone title (null clears it). */
export interface AreaChange
{
	id: string;
	issue: CachedIssue;
	labels?: string[];
	milestone?: string | null;
}

/**
 * The changes `pnpm backlog:areas` makes: each trusted story whose `area:*` labels aren't exactly its
 * {@link areaOf}, and each done story whose milestone isn't its {@link milestoneFor}.
 */
export function planAreas(stories: { id: string;
	issue: CachedIssue;
	scopeFiles: string[];
	status: string; }[], milestoneOf: (id: string) => string | undefined): AreaChange[]
{
	const out: AreaChange[] = [];
	for (const s of stories)
	{
		const change: AreaChange = {
			id: s.id,
			issue: s.issue,
		};
		const area = areaOf(s.scopeFiles);
		const names = s.issue.labels.map((l) => l.name);
		const areas = names.filter((l) => l.startsWith("area:"));
		if (areas.length !== 1 || areas[0] !== area)
		{
			change.labels = [...names.filter((l) => !l.startsWith("area:")), area];
		}
		if (s.status === "done")
		{
			const want = milestoneOf(s.id) ?? null;
			if ((s.issue.milestone?.title ?? null) !== want)
			{
				change.milestone = want;
			}
		}
		if (change.labels !== undefined || change.milestone !== undefined)
		{
			out.push(change);
		}
	}
	return out;
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");

/** The CLI. Returns what to print. */
export function main(argv: string[], run: GhRunner = ghRunner, root = repoRoot, env: Record<string, string | undefined> = process.env): string
{
	const dryRun = argv.includes("--dry-run");
	const dir = cacheDir(root, env);
	const cache = readCache(dir);
	if (!cache)
	{
		throw new NoCacheError(dir);
	}
	const { items } = itemsFromCache(cache, readRecords(fragmentsDir(env)));
	const stories = items.filter((i) => i.kind === "story" && i.issue !== undefined).map((i) => ({
		id: i.id,
		issue: cache.issues.find((x) => x.number === i.issue)!,
		scopeFiles: i.scopeFiles,
		status: i.status,
	}));
	const releases = publishedReleases(run, root);
	const isAncestor = gitIsAncestor(root);
	const changes = planAreas(stories, (id) => milestoneFor(shippingCommit(root, id), releases, isAncestor));
	const milestones = changes.some((c) => typeof c.milestone === "string") ? listMilestones({
		run,
	}) : [];
	const lines: string[] = [];
	for (const c of changes)
	{
		let milestone: number | null | undefined;
		if (typeof c.milestone === "string")
		{
			milestone = milestones.find((m) => m.title === c.milestone)?.number;
			if (milestone === undefined)
			{
				lines.push(`${c.id}: no milestone titled ${c.milestone}; left alone`);
			}
		}
		else if (c.milestone === null)
		{
			milestone = null;
		}
		lines.push(`${c.id} (#${c.issue.number}):${c.labels ? ` labels ${c.labels.filter((l) => l.startsWith("area:")).join(", ")}` : ""}${milestone !== undefined ? ` milestone ${c.milestone ?? "none"}` : ""}`);
		if (!dryRun && (c.labels !== undefined || milestone !== undefined))
		{
			storeIssue(root, patchIssue({
				run,
			}, c.issue.number, {
				...(c.labels ? {
					labels: c.labels,
				} : {}),
				...(milestone !== undefined ? {
					milestone,
				} : {}),
			}), env);
		}
	}
	return [`backlog:areas: ${changes.length} change(s)${dryRun ? " (dry run: nothing sent)" : ""}`, ...lines].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
	try
	{
		console.log(main(process.argv.slice(2)));
	}
	catch (error)
	{
		console.error(`areas: ${(error as Error).message}`);
		process.exitCode = error instanceof NoCacheError ? 2 : 1;
	}
}
