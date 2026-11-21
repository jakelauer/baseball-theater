/**
 * Areas and milestones, set directly on GitHub (S165 AC 4; owner, 2026-11-20: "GitHub owns state
 * (Recommended)"), never a ledger record:
 *
 *   - each story's `area:*` label, from its recorded `scope_files` ({@link areaOf});
 *   - each `done` story's milestone: the first published release whose commit contains its shipping
 *     commit (`git merge-base --is-ancestor`; work shipped before the first release takes the first
 *     release that contains it, v3.0.0) ({@link milestoneFor}). A story with no shipping commit, or one
 *     no published release contains yet, keeps the milestone it has (a done-but-unreleased story keeps
 *     the next release's), and a release tag that doesn't resolve here fails the run. The shipping
 *     commit is the one `audit.sh --reverify` and the graders use (scripts/lib/checks.sh `story_tip`),
 *     so all three agree.
 *
 * Labels are added and removed one at a time (github.ts addLabels / removeLabel), never by sending the
 * cached list back, so a status changed since the sync survives.
 *
 *   pnpm backlog:areas [--dry-run]   (the coordinator's session; reads the cache `pnpm backlog:sync`
 *                                    wrote) sets both; --dry-run only prints the changes
 */

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CachedIssue, GhRunner } from "./github.ts";
import {
	addLabels, cacheDir, ghRunner, itemsFromCache, listMilestones, NoCacheError, ok, patchIssue, readCache, readIssue, removeLabel, request, storeIssue,
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
	// The ingest code as the repo lays it out, tests beside it included: functions/src/services/*ingest*.ts
	// and functions/src/*ingest*.ts (the ingest Durable Object, the workerd ingest test).
	if (/^functions\/src\/(services\/)?[^/]*ingest[^/]*\.ts$/.test(path) || /^(packages\/mlb-api|fixtures)(\/|$)/.test(path))
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
 * `ship` (`isAncestor(ship, release.commit)`), or undefined, meaning "leave its milestone alone", when
 * none does yet or `ship` is unknown.
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

/**
 * The published releases, oldest first, each with its tag's commit (`git rev-list -n1 <tag>`). A tag
 * that doesn't resolve here throws: dropping it would give its stories a later release.
 */
export function publishedReleases(run: GhRunner, root: string): Release[]
{
	const raw = ok<{ tag_name: string;
		draft: boolean;
		published_at: string | null; }[]>(request(run, "GET", "repos/{owner}/{repo}/releases?per_page=100"), "listing releases") ?? [];
	return raw.filter((r) => !r.draft && r.published_at !== null).sort((a, b) => a.published_at!.localeCompare(b.published_at!)).map((r) =>
	{
		try
		{
			return {
				title: r.tag_name,
				commit: execFileSync("git", ["rev-list", "-n1", `refs/tags/${r.tag_name}`], {
					cwd: root,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				}).trim(),
			};
		}
		catch
		{
			throw new Error(`release ${r.tag_name}'s tag does not resolve here: run git fetch --tags origin, then pnpm backlog:areas again`);
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

/** One planned change: area labels to add and remove, and/or a milestone title. */
export interface AreaChange
{
	id: string;
	issue: CachedIssue;
	add?: string[];
	remove?: string[];
	milestone?: string;
}

/**
 * The changes `pnpm backlog:areas` makes: each trusted story whose `area:*` labels aren't exactly its
 * {@link areaOf} (only `area:*` labels are added or removed), and each done story whose milestone isn't
 * its {@link milestoneFor}, when that is known (never a clear).
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
		const areas = s.issue.labels.map((l) => l.name).filter((l) => l.startsWith("area:"));
		if (!areas.includes(area))
		{
			change.add = [area];
		}
		const wrong = areas.filter((l) => l !== area);
		if (wrong.length > 0)
		{
			change.remove = wrong;
		}
		if (s.status === "done")
		{
			const want = milestoneOf(s.id);
			if (want !== undefined && s.issue.milestone?.title !== want)
			{
				change.milestone = want;
			}
		}
		if (change.add !== undefined || change.remove !== undefined || change.milestone !== undefined)
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
	const milestones = changes.some((c) => c.milestone !== undefined) ? listMilestones({
		run,
	}) : [];
	const io = {
		run,
	};
	const lines: string[] = [];
	for (const c of changes)
	{
		let milestone: number | undefined;
		if (c.milestone !== undefined)
		{
			milestone = milestones.find((m) => m.title === c.milestone)?.number;
			if (milestone === undefined)
			{
				lines.push(`${c.id}: no milestone titled ${c.milestone}; left alone`);
			}
		}
		lines.push(`${c.id} (#${c.issue.number}):${c.add ? ` add ${c.add.join(", ")}` : ""}${c.remove ? ` remove ${c.remove.join(", ")}` : ""}${milestone !== undefined ? ` milestone ${c.milestone}` : ""}`);
		if (dryRun || (c.add === undefined && c.remove === undefined && milestone === undefined))
		{
			continue;
		}
		addLabels(io, c.issue.number, c.add ?? []);
		for (const l of c.remove ?? [])
		{
			removeLabel(io, c.issue.number, l);
		}
		if (milestone !== undefined)
		{
			patchIssue(io, c.issue.number, {
				milestone,
			});
		}
		// The label calls return labels, not the issue: read it fresh for the cache.
		storeIssue(root, readIssue(io, c.issue.number), env);
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
