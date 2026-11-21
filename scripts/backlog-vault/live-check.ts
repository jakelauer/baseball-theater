/**
 * `pnpm backlog:check --live` (S165): law L9's live parts, the ones only GitHub can answer (owner,
 * 2026-11-20: "Accept the split (Recommended)", so they run in CI and the coordinator's session, never
 * in `pnpm verify`; and "GitHub owns state (Recommended)", which moved the design clause here):
 *
 *   - one issue per ID: an ID more than one trusted issue carries fails, naming every issue;
 *   - status label agreeing with state: an open item labelled done or superseded, a closed one labelled
 *     todo, doing or blocked, a closed one labelled the wrong one of done and superseded, two `status:`
 *     labels or an unknown `status:` value fail. Warnings instead: a **pending label** (an item whose
 *     merged pull request's `Closes #N` (or a `Fixes #N` commit) closed it, from its timeline
 *     ({@link closingEvent}), that doesn't carry `status:done` yet) and a closed item with **no status label**, each for
 *     {@link PENDING_LABEL_MS} after it was closed, then a failure; and an accepted bug **closed by its
 *     own filer**;
 *   - no unlogged body edit: a story's body (a bug's fields block only) is compared with its text
 *     records, the tree's and `origin/stage`'s (read with `git ls-tree` / `git cat-file`, no checkout;
 *     fetched first in CI or when the ref is missing, {@link fetchStage}), since S164 applies records
 *     only after they merge. A body matching an earlier record with no trusted `Applied` comment for any
 *     newer one is "recorded, not yet applied"; anything else, a revert of an applied record included,
 *     is an unlogged edit. Records that fork or leave a gap once stage's are merged in fail as that;
 *   - the design gate: an open UI story labelled `status:doing` whose design stories aren't all closed
 *     `completed` with `status:done` fails ({@link designGate}, which `claims.ts claim` also calls).
 *
 * A bug filed by someone untrusted stays its filer's issue, so the filer can still edit or reopen it
 * (owner, 2026-11-21, asked "How should a bug filed by an outsider be accepted, given they can still
 * edit or reopen it?": "Warn in CI, fail for me (Recommended)"): in CI (`GITHUB_ACTIONS=true`) its
 * fields-block change, its fields block with no create record, and its reopen after done or superseded
 * are warnings; the coordinator's session fails them until they are adopted or relabelled.
 *
 * Issues no trusted rule accepts (triage.ts) are never checked, so the check never fails on one. It
 * reads the cache `pnpm backlog:sync` wrote and makes only reads of its own (comments, and a closed
 * item's timeline), so CI's read-only token is enough; CI trusts only the owner and
 * `BT_BACKLOG_TRUSTED` (github.ts syncIssues). Its pure core, {@link liveCheck}, takes those reads
 * injected, so tests use committed fixtures and no network.
 */

import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type {
	CachedIssue, ClosingEvent, GhRunner, IssueCache,
} from "./github.ts";
import {
	appliedKey, appliedRecords, cacheDir, closingEvent, designGate, ghRunner, isLive, itemFromIssue, listComments, NoCacheError, readCache, readIssue, STATUSES, trustedId,
} from "./github.ts";
import { FRAGMENT_NAME } from "./ledger.ts";
import type { TextRecord } from "./text-records.ts";
import {
	BODY_KINDS, chains, fieldsYaml, fragmentsDir, parseRecord, readRecords,
} from "./text-records.ts";

/** How long an item closed by its pull request (or closed with no status label) may wait for its label before it fails (S165 AC 1). */
export const PENDING_LABEL_MS = 24 * 60 * 60_000;

/** What the live check found: failures exit 1; warnings and notes are printed and pass. */
export interface LiveReport
{
	failures: string[];
	warnings: string[];
	notes: string[];
}

/** One comment as the check reads it. */
type Comment = { body: string;
	user: { login: string } | null };

/** The live check's inputs: the cache, the records, and the reads it may need, injected. */
export interface LiveInput
{
	cache: IssueCache;
	/** The text records in the tree the check runs in. */
	records: TextRecord[];
	/** The text records on `origin/stage`, or undefined when there is no such ref. */
	stageRecords: TextRecord[] | undefined;
	/** An issue's comments (for the trusted `Applied` ones), read only when needed. */
	comments: (n: number) => Comment[];
	/** An issue's newest `closed` event and its closing pull request (github.ts closingEvent), read only for a closed item whose label disagrees with its state. */
	closeEvent: (n: number) => ClosingEvent | undefined;
	/** An issue read fresh from GitHub (github.ts readIssue), read only before failing a revert, since the cache may predate an `apply`. */
	freshIssue: (n: number) => CachedIssue;
	/** Running in CI (`GITHUB_ACTIONS=true`): an untrusted filer's change to their own bug is a warning there (the owner's 2026-11-21 answer). */
	ci: boolean;
	now: Date;
}

/**
 * Where one item's problems go. `fail(message, byFiler)`: a problem its untrusted filer could have
 * caused (`byFiler`) is a warning in CI and a failure in the coordinator's session.
 */
interface Sink
{
	fail: (message: string, byFiler?: boolean) => void;
	warn: (message: string) => void;
	note: (message: string) => void;
}

const labelsOf = (issue: CachedIssue) => issue.labels.map((l) => l.name);

/** The tree's records and stage's together, one per fragment name (the tree's copy wins). */
export function mergeRecords(tree: TextRecord[], stage: TextRecord[] | undefined): TextRecord[]
{
	const seen = new Set(tree.map((r) => basename(r.file)));
	return [...tree, ...(stage ?? []).filter((r) => !seen.has(basename(r.file)))];
}

/**
 * The status-label check for one item: failures, or a warning for the exceptions. `expected` is what
 * its state says (`done` for closed completed, `superseded` for not planned or a duplicate).
 */
function labelVerdict(id: string, issue: CachedIssue, input: LiveInput, sink: Sink): void
{
	const status = labelsOf(issue).filter((l) => l.startsWith("status:"));
	const where = `${id} (#${issue.number})`;
	if (status.length > 1)
	{
		sink.fail(`${where} has two status: labels (${status.join(", ")}): keep one (github.ts status ${id} <status>)`);
		return;
	}
	const label = status[0]?.slice("status:".length);
	// The backlog's own values (github.ts STATUSES); any other fails.
	if (label !== undefined && !(STATUSES as readonly string[]).includes(label))
	{
		sink.fail(`${where} has an unknown status label status:${label} (one of ${STATUSES.map((k) => `status:${k}`).join(", ")}): github.ts status ${id} <status>`);
		return;
	}
	if (issue.state === "open")
	{
		if (label === "done" || label === "superseded")
		{
			sink.fail(`${where} is open but labelled status:${label}: close it, or set its status (github.ts status ${id} <status>)`, true);
		}
		return;
	}
	const expected = issue.state_reason === "not_planned" || issue.state_reason === "duplicate" ? "superseded" : "done";
	if (label === expected)
	{
		return;
	}
	if (label === "done" || label === "superseded")
	{
		sink.fail(`${where} is closed as ${issue.state_reason ?? "completed"} but labelled status:${label}: github.ts status ${id} ${expected}`);
		return;
	}
	const event = input.closeEvent(issue.number);
	const filer = issue.user?.login;
	// Checked before the commit rule: a filer closing their own bug is never a pending label.
	if (id.startsWith("B") && filer !== undefined && !input.cache.trusted.includes(filer) && event?.actor === filer)
	{
		sink.warn(`${where} was closed by its own filer, ${filer}, and is ${label === undefined ? "unlabelled" : `labelled status:${label}`}: decide whether it is fixed (github.ts status ${id} <status>)`);
		return;
	}
	const closedAt = Date.parse(issue.closed_at ?? "");
	const inWindow = !Number.isNaN(closedAt) && input.now.getTime() - closedAt <= PENDING_LABEL_MS;
	if (label === undefined)
	{
		if (inWindow)
		{
			sink.warn(`${where} was closed at ${issue.closed_at} with no status label (a failure after 24 hours): github.ts status ${id} ${expected}`);
			return;
		}
		sink.fail(`${where} is closed with no status label: github.ts status ${id} ${expected}`);
		return;
	}
	if (expected === "done" && inWindow && event !== undefined && (event.closingPull !== undefined || event.commitId !== null))
	{
		const by = event.closingPull !== undefined ? `pull request #${event.closingPull}` : `commit ${event.commitId!.slice(0, 12)}`;
		sink.warn(`${where} was closed by ${by} at ${issue.closed_at} and waits for its status:done label (pending, a failure after 24 hours): github.ts status ${id} done`);
		return;
	}
	sink.fail(`${where} is closed but labelled status:${label}: github.ts status ${id} ${expected}`);
}

/**
 * The body check for one item against its valid record chain. `isLive` says whether a record is the
 * issue's live text (a story's whole body, a bug's fields block).
 */
function bodyVerdict(id: string, issue: CachedIssue, chain: TextRecord[], input: LiveInput, sink: Sink): void
{
	const where = `${id} (#${issue.number})`;
	let k = -1;
	chain.forEach((r, i) =>
	{
		if (isLive(r, issue.body))
		{
			k = i;
		}
	});
	if (k === chain.length - 1)
	{
		return;
	}
	const bug = id.startsWith("B");
	const what = bug ? "fields block" : "body";
	const newest = chain.at(-1)!;
	if (k >= 0)
	{
		const applied = appliedRecords(input.comments(issue.number), id, input.cache.trusted);
		const back = chain.slice(k + 1).find((r) => applied.has(appliedKey(r)));
		if (back === undefined)
		{
			sink.note(`${where}: recorded, not yet applied: run scripts/audit.sh apply (its ${what} is ${chain[k]!.file}; newest ${newest.file})`);
			return;
		}
		// The cache may predate an apply whose Applied comment is already there: read the issue again
		// before calling it a revert.
		if (isLive(newest, input.freshIssue(issue.number).body))
		{
			sink.note(`${where}: the cache is older than GitHub (its ${what} is already ${newest.file}): pnpm backlog:sync`);
			return;
		}
		// apply never sends a record its Applied comment names again, so the restore is by hand.
		const restore = bug
			? `restore its fields block by hand on GitHub (node scripts/backlog-vault/text-records.ts body docs/v3/audit/${newest.file})`
			: `restore it by hand: node scripts/backlog-vault/text-records.ts body docs/v3/audit/${newest.file} | gh api -X PATCH repos/{owner}/{repo}/issues/${issue.number} -F body=@-`;
		sink.fail(`${where}: unlogged edit: its ${what} went back to ${chain[k]!.file} after ${back.file} was applied; if the owner wants it, adopt it with scripts/audit.sh edit ${id} --adopt --reason "<the owner's words>", else ${restore}`, true);
		return;
	}
	const hint = input.stageRecords === undefined
		? "; there is no origin/stage ref here, so if its edit was recorded on stage, git fetch origin && git merge origin/stage and run again"
		: "; if its edit was recorded on stage since your last fetch, git fetch origin and run again";
	sink.fail(`${where}: unlogged edit: its ${what} matches none of its text records (newest ${newest.file}); if the owner made it, adopt it with scripts/audit.sh edit ${id} --adopt --reason "<the owner's words>"${hint}`, true);
}

/**
 * A recorded create no issue carries (S165): a bug's create always names its issue, so its loss
 * fails; a story's create whose body sits on an issue that no longer carries its ID (retitled or
 * relabelled) fails naming it, since `apply` would open a duplicate. Only an issue authored by a
 * trusted login, or one a trusted `Applied` comment names for this ID, counts. Otherwise it is
 * "recorded, not yet applied".
 */
function uncarried(chain: { id: string;
	records: TextRecord[] }, input: LiveInput, sink: Sink): void
{
	const { cache } = input;
	if (chain.id.startsWith("B"))
	{
		sink.fail(`${chain.id}: its create is recorded, but no issue carries it (issue #${chain.id.slice(1)} is gone or lost its bug label): label it bug again, or apply can't send it`);
		return;
	}
	const stray = cache.issues.find((i) => i.pull_request === undefined && trustedId(i, cache.trusted) === undefined && chain.records.some((r) => isLive(r, i.body))
		&& ((i.user !== null && cache.trusted.includes(i.user.login))
			|| [...appliedRecords(input.comments(i.number), chain.id, cache.trusted)].length > 0));
	if (stray !== undefined)
	{
		sink.fail(`${chain.id}: its create was applied to #${stray.number}, which no longer carries ${chain.id} (title "${chain.id}: …" and the story label): restore them, or apply would open a duplicate`);
		return;
	}
	sink.note(`${chain.id}: recorded, not yet applied: run scripts/audit.sh apply (no issue carries it yet)`);
}

/** Law L9's live parts over the cache and the records (see the file's header). Pure: every read is injected. */
export function liveCheck(input: LiveInput): LiveReport
{
	const report: LiveReport = {
		failures: [],
		warnings: [],
		notes: [],
	};
	const { cache } = input;
	const records = mergeRecords(input.records, input.stageRecords);
	const byId = chains(records);
	const carriers = new Map<string, CachedIssue[]>();
	for (const issue of cache.issues)
	{
		const id = trustedId(issue, cache.trusted);
		if (id !== undefined)
		{
			carriers.set(id, [...(carriers.get(id) ?? []), issue]);
		}
	}
	const plain: Sink = {
		fail: (m) => report.failures.push(m),
		warn: (m) => report.warnings.push(m),
		note: (m) => report.notes.push(m),
	};
	for (const [id, issues] of carriers)
	{
		if (issues.length > 1)
		{
			report.failures.push(`${id} is carried by more than one trusted issue (${issues.map((i) => `#${i.number}`).join(", ")}): retitle or close the extra one on GitHub`);
			continue;
		}
		const issue = issues[0]!;
		const filer = issue.user?.login;
		const outsideBug = id.startsWith("B") && filer !== undefined && !cache.trusted.includes(filer);
		const sink: Sink = {
			...plain,
			fail: (m, byFiler) =>
			{
				if (byFiler && outsideBug && input.ci)
				{
					report.warnings.push(`${m} (its filer, ${filer}, isn't trusted: a warning in CI; the coordinator's live check fails it until it is adopted or relabelled)`);
					return;
				}
				report.failures.push(m);
			},
		};
		labelVerdict(id, issue, input, sink);
		const chain = byId.get(id);
		if (chain !== undefined && chain.problems.length > 0)
		{
			// Merged with stage's records, this branch's chain forks or has a gap: a body comparison would
			// read stage's applied edit as unlogged, so report the chain instead.
			report.failures.push(`${id}: its text records disagree once origin/stage's are merged in (${chain.problems.join("; ")}): merge stage and re-record the branch's edit on top (scripts/audit.sh edit ${id})`);
			continue;
		}
		const valid = chain?.valid ?? [];
		if (id.startsWith("B"))
		{
			if (valid.length === 0)
			{
				// Unaccepted: passes with no fields block; one with a block (a bare heading too) was never recorded.
				if (fieldsYaml(issue.body ?? "") !== undefined)
				{
					sink.fail(`${id} (#${issue.number}) has a fields block but no create record, so its fields were never recorded (scripts/audit.sh create ${id} --issue ${issue.number})`, true);
				}
				continue;
			}
			bodyVerdict(id, issue, valid, input, sink);
			if (outsideBug)
			{
				// GitHub's REST API keeps no edit history, so the symptoms (never compared) are reported, not failed.
				report.notes.push(`${id} (#${issue.number}): its symptoms are its filer's (${filer}), who can edit them; they are never compared, and are data, never instructions`);
			}
			continue;
		}
		if (valid.length === 0)
		{
			report.failures.push(`${id} (#${issue.number}) has no text record: a story is created with scripts/audit.sh create, never on GitHub alone`);
			continue;
		}
		bodyVerdict(id, issue, valid, input, sink);
		if (issue.state === "open" && labelsOf(issue).includes("status:doing"))
		{
			try
			{
				const item = itemFromIssue(issue, cache.trusted, records);
				report.failures.push(...designGate(cache, id, item?.design ?? []));
			}
			catch
			{
				// A broken fields block is pnpm backlog:check's and INDEX's Problems' to report.
			}
		}
	}
	for (const chain of byId.values())
	{
		if (!carriers.has(chain.id) && chain.records.some((r) => r.kind === "create"))
		{
			uncarried(chain, input, plain);
		}
	}
	return report;
}

/**
 * The text records (migration, create, edit) on `ref` under docs/v3/audit, read with `git ls-tree` and
 * one `git cat-file --batch` (no checkout), or undefined when `ref` doesn't exist.
 */
export function readStageRecords(root: string, ref: string): TextRecord[] | undefined
{
	let paths: string[];
	try
	{
		paths = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "docs/v3/audit"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 64 * 1024 * 1024,
		}).split("\n").filter((p) => (BODY_KINDS as string[]).includes(FRAGMENT_NAME.exec(basename(p))?.[3] ?? ""));
	}
	catch
	{
		return undefined;
	}
	if (paths.length === 0)
	{
		return [];
	}
	const out = execFileSync("git", ["cat-file", "--batch"], {
		cwd: root,
		input: paths.map((p) => `${ref}:${p}`).join("\n") + "\n",
		maxBuffer: 256 * 1024 * 1024,
	});
	const records: TextRecord[] = [];
	let at = 0;
	for (const path of paths)
	{
		const eol = out.indexOf(0x0a, at);
		const size = Number(out.subarray(at, eol).toString("utf8").split(" ")[2]);
		const text = out.subarray(eol + 1, eol + 1 + size).toString("utf8");
		at = eol + 1 + size + 1;
		records.push(parseRecord(text, path.slice("docs/v3/audit/".length)));
	}
	return records;
}

/** The report as printed: failures, then warnings, then notes, then a tally. */
export function formatLiveReport(report: LiveReport): string
{
	return [
		...report.failures.map((f) => `FAIL ${f}`),
		...report.warnings.map((w) => `WARN ${w}`),
		...report.notes.map((n) => `note ${n}`),
		`backlog:check --live: ${report.failures.length} failure(s), ${report.warnings.length} warning(s), ${report.notes.length} note(s)`,
	].join("\n");
}

/** Whether `ref` names a commit in `root`. */
function refExists(root: string, ref: string): boolean
{
	try
	{
		execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
			cwd: root,
			stdio: "ignore",
		});
		return true;
	}
	catch
	{
		return false;
	}
}

/**
 * Brings `origin/stage` up to date, so a record merged into stage while a pull request's CI ran (or
 * since a local fetch) is read (S165): `git fetch --no-tags origin
 * +refs/heads/stage:refs/remotes/origin/stage`, with `--depth=1` only in a shallow checkout (CI's), so a
 * full clone never becomes shallow. Returns why it failed, or undefined. `ci.yml` stays as the owner
 * approved it: the fetch is here.
 */
export function fetchStage(root: string): string | undefined
{
	try
	{
		const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim() === "true";
		execFileSync("git", ["fetch", "--quiet", "--no-tags", ...(shallow ? ["--depth=1"] : []), "origin", "+refs/heads/stage:refs/remotes/origin/stage"], {
			cwd: root,
			stdio: ["ignore", "ignore", "pipe"],
		});
		return undefined;
	}
	catch (error)
	{
		return String((error as { stderr?: Buffer }).stderr ?? (error as Error).message).trim().split("\n")[0];
	}
}

/**
 * The live check as `cli.ts check --live` runs it: the cache in the main checkout of `root` (no cache
 * throws {@link NoCacheError}), the tree's records, `origin/stage`'s (`BT_STAGE_REF`; fetched first in
 * CI, `GITHUB_ACTIONS=true` in `env`, or when missing), and reads through `gh`.
 */
export function runLiveCheck(root: string, env: Record<string, string | undefined> = process.env, run: GhRunner = ghRunner, now = new Date()): LiveReport
{
	const dir = cacheDir(root, env);
	const cache = readCache(dir);
	if (!cache)
	{
		throw new NoCacheError(dir);
	}
	const ci = env.GITHUB_ACTIONS === "true";
	const ref = env.BT_STAGE_REF ?? "origin/stage";
	const fetchError = ref === "origin/stage" && (ci || !refExists(root, ref)) ? fetchStage(root) : undefined;
	const io = {
		run,
	};
	const report = liveCheck({
		cache,
		records: readRecords(fragmentsDir(env)),
		stageRecords: readStageRecords(root, ref),
		comments: (n) => listComments(io, n),
		closeEvent: (n) => closingEvent(io, n, cache.repo),
		freshIssue: (n) => readIssue(io, n),
		ci,
		now,
	});
	if (fetchError !== undefined)
	{
		report.warnings.unshift(`could not fetch origin/stage (${fetchError}): stage's newest records may be missing`);
	}
	return report;
}
