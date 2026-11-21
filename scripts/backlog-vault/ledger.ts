/**
 * The verification ledger, read as data: the frozen docs/v3/AUDIT.md, then its fragments.
 *
 * AUDIT.md is the human record up to S156: Markdown entries that scripts/audit.sh appended,
 * newest last. Since S156 (owner, 2026-11-20: "The goal is to enable agents to work in tandem
 * on backlog items in a way that they don't conflict") audit.sh never appends to it: every
 * new entry is its own file, a ledger fragment, `docs/v3/audit/<YYYY-MM-DD>/<stamp>-<ID>-<kind>.md`
 * (see {@link FRAGMENT_NAME}), so two branches' entries are two new files and never conflict.
 * The ledger is AUDIT.md's entries, then the fragments' in stamp order ({@link readLedger}).
 *
 * This module is the one place that reads entry headings. Everything that needs the ledger
 * as data goes through it: the generated review-debt line (assemble.ts), the debt checks
 * (scripts/review-debt.sh, scripts/parity-debt.sh, through `cli.ts ledger-base` /
 * `done-since`), the review gate hook (scripts/review-gate.sh, through `cli.ts
 * review-blocked`), the run records (runs.ts: `concurrency`, `check-end`, `fragment` and `turn-caps`,
 * which `scripts/audit.sh run` and review-debt.sh call, S158), and the generated index docs/v3/audit.jsonl (one JSON object per entry,
 * for tools and agents that want an entry's kind, story, verdict or line without reading a
 * ~1.5 MB Markdown file).
 *
 * Owner, 2026-11-03, on making these structures "more code friendly": "do the jsonl for
 * audit rather than splitting by month". The index is generated, never hand-edited.
 */

import { execFileSync } from "node:child_process";
import {
	existsSync, readdirSync, readFileSync,
} from "node:fs";
import {
	basename, dirname, join, relative,
} from "node:path";

/**
 * The SHA-256 of the frozen docs/v3/AUDIT.md (S156): nothing is appended to it any more, every new
 * entry being a fragment, so its bytes never change (law L13). Pinned here, the ledger's one module,
 * for the law's test (merge-safety.test.ts) and the pre-commit step that refuses any other content
 * for it (precommit.ts). Re-pinned only if a merge from `stage` brings in entries appended before
 * S156 merged, in that merge's commit, together with `BASE_PARSER_SHA256` in ledger.test.ts (the base
 * parser's output on the same file), which moves with it.
 */
export const FROZEN_AUDIT_SHA256 = "b9153847627ca9f308aec161d064ceab4e89de3966a95af01777e2da7e252ed3";

/** The line in AUDIT.md after which every `## ` heading of the entry shapes below is an entry. */
export const LEDGER_MARKER = "<!-- entries below; newest last; appended by scripts/audit.sh -->";

/** Which review a review, answers or skip entry belongs to. */
export type ReviewKind = "backlog" | "parity";

/** What an entry records; each kind is one heading shape scripts/audit.sh writes. */
export type LedgerKind =
	| "completed" // a story finished: its grader and pnpm verify ran (`audit.sh story`)
	| "re-verified" // a shipped story's grader re-run at its shipping commit (`--reverify`)
	| "backfill" // an entry written later for a story that shipped before the ledger
	| "design-match" // an owner's design-match verdict on its own (`audit.sh design`)
	| "review" // a backlog or doc parity review pass (`audit.sh review` / `parity`)
	| "answers" // the owner's answers to a review's questions (`audit.sh answers`)
	| "skip" // the owner declined a review for a drift event (`audit.sh skip`)
	| "migration" // a story's or bug's text as `pnpm backlog:migrate` recorded it (`audit.sh migration`, S164)
	| "create" // a new story's text, or an accepted bug's fields block (`audit.sh create`)
	| "edit" // a story's new text, chained to the one before it (`audit.sh edit`)
	| "snapshot" // a story's newest text and the status it ships with, at ship time (`audit.sh story`)
	| "run"; // a /run-backlog run's record, read to set the next run's concurrency (`audit.sh run`, S158)

/** One turn-cap hit (S158 AC 7): the item that stopped at its turn cap, and the journal event's time. */
export interface TurnCapHit
{
	id: string;
	at: string;
}

/** A row's list of hits, `S9 @ <at>, S12 @ <at>`, or `none`: how run and review entries write them. */
export function formatHits(hits: TurnCapHit[]): string
{
	return hits.map((h) => `${h.id} @ ${h.at}`).join(", ") || "none";
}

/** The hits a {@link formatHits} row holds; none for `none` or a missing row. */
export function parseHits(row: string | undefined): TurnCapHit[]
{
	return [...(row ?? "").matchAll(/([SBFV]\d+) @ (\S+?)(?=,|$)/g)].map((m) => ({
		id: m[1]!,
		at: m[2]!,
	}));
}

/** One ledger entry, from its heading. Optional fields are present only for the kinds that carry them. */
export interface LedgerEntry
{
	/** 1-based line of the heading in AUDIT.md, or in {@link LedgerEntry.file} for a fragment's entry. */
	line: number;
	/**
	 * A fragment's entry only: the fragment's path relative to the ledger's directory
	 * (`audit/2026-11-21/20261121T101500Z-S9-completed.md`, beside AUDIT.md in docs/v3/).
	 * Absent for an entry of AUDIT.md itself, so AUDIT.md parses exactly as it did before S156.
	 */
	file?: string;
	/** The date in the heading (`YYYY-MM-DD` in every entry audit.sh writes). */
	date: string;
	kind: LedgerKind;
	/** The story an entry is about (`S75`), for completed / re-verified / backfill / design-match. */
	story?: string;
	/** The review a review / answers / skip entry belongs to. */
	review?: ReviewKind;
	/** A review's verdict (`continue`, `amended`, `blocked`). */
	verdict?: string;
	/** For answers: the date of the review answered. */
	answers?: string;
	/** For a re-verification: the shipping commit it re-ran at, when the heading names it. */
	at?: string;
	/**
	 * A review fragment's in-flight items (its `| In flight |` row, `audit.sh review --in-flight`,
	 * S156 AC 13): the items being built while the review ran, whose notes it may not edit.
	 * Absent when the row is missing or says `none`.
	 */
	inFlight?: string[];
	/**
	 * The GitHub issue an item's fragment names (its `Issue: #<n>` line, S164): every story or bug
	 * fragment but a story's `create`, whose issue is found by its ID once `audit.sh apply` makes it.
	 */
	issue?: number;
	/** A run entry's run ID (`R20261121T101500Z`, S158), which its fragment's name carries. */
	run?: string;
	/** A run entry's concurrency (its `| C |` row). */
	runC?: number;
	/** A run entry's `| Counted |` and `| Clean |` rows (runs.ts summarizeRun). */
	counted?: boolean;
	clean?: boolean;
	/** A run entry's Claude-review findings per pull request; null when it opened none. */
	findingsPerPr?: number | null;
	/**
	 * Turn-cap hits (S158 AC 7): a run entry's `| Turn-cap hits |` row, or a backlog review's
	 * `| Turn-cap hits read |` row, the hits that review read and so clears.
	 */
	turnCaps?: TurnCapHit[];
	heading: string;
}

const REVIEW_NAMES: Record<string, ReviewKind> = {
	"backlog": "backlog",
	"doc parity": "parity",
};

/** Each heading shape audit.sh writes, and how it maps to an entry. Order doesn't matter: the shapes are disjoint. */
const SHAPES: { pattern: RegExp;
	entry: (m: RegExpExecArray) => Omit<LedgerEntry, "line" | "date" | "heading"> }[] = [
	{
		pattern: /^(S\d+) completed$/,
		entry: (m) => ({
			kind: "completed",
			story: m[1],
		}),
	},
	{
		pattern: /^(S\d+) re-verified(?: at `([0-9a-f]+)`)?$/,
		entry: (m) => ({
			kind: "re-verified",
			story: m[1],
			...(m[2] ? {
				at: m[2],
			} : {}),
		}),
	},
	{
		pattern: /^(S\d+) verified \(backfill(?:, no grader)?\)$/,
		entry: (m) => ({
			kind: "backfill",
			story: m[1],
		}),
	},
	{
		pattern: /^(S\d+) design match$/,
		entry: (m) => ({
			kind: "design-match",
			story: m[1],
		}),
	},
	// The text records (S164; text-records.ts writes their headings, RECORD_HEADINGS).
	...([["migrated", "migration"], ["created", "create"], ["edited", "edit"], ["snapshot", "snapshot"]] as const).map(([word, kind]) => ({
		pattern: new RegExp(`^([SB]\\d+) ${word}$`),
		entry: (m: RegExpExecArray) => ({
			kind,
			story: m[1],
		}),
	})),
	{
		pattern: /^(backlog|doc parity) review \(`([a-z]+)`\)$/,
		entry: (m) => ({
			kind: "review",
			review: REVIEW_NAMES[m[1]!],
			verdict: m[2],
		}),
	},
	{
		pattern: /^(backlog|doc parity) review answers \((\S+)\)$/,
		entry: (m) => ({
			kind: "answers",
			review: REVIEW_NAMES[m[1]!],
			answers: m[2],
		}),
	},
	{
		pattern: /^run (R\d{8}T\d{6}Z)$/,
		entry: (m) => ({
			kind: "run",
			run: m[1],
		}),
	},
	{
		pattern: /^(backlog|doc parity) review skipped$/,
		entry: (m) => ({
			kind: "skip",
			review: REVIEW_NAMES[m[1]!],
		}),
	},
];

/** The entry a heading's text after "<date> — " names, or undefined when it matches no shape. */
function shapeOf(rest: string): Omit<LedgerEntry, "line" | "date" | "heading"> | undefined
{
	return SHAPES.map(({ pattern, entry }) =>
	{
		const m = pattern.exec(rest);
		return m ? entry(m) : undefined;
	}).find((e) => e !== undefined);
}

/** Thrown when a dated heading among the entries matches no shape audit.sh writes (a hand-written entry). */
export class LedgerParseError extends Error
{
	override name = "LedgerParseError";
}

/**
 * Every entry in `audit`, in ledger order (oldest first).
 *
 * Only headings after {@link LEDGER_MARKER} count (the preamble above it describes entries;
 * a ledger without the marker, as in tests, is read from the top). An entry heading is
 * `## <date> — <shape>`; a review's own findings use `## ` sub-headings too ("## Check 1 —
 * coverage"), which are skipped because their first word is not followed by " — ".
 * A `## YYYY-MM-DD — …` heading that matches no shape throws: every entry comes from
 * audit.sh, so an unknown one is a hand-written entry or a new shape this parser must learn.
 */
export function parseLedger(audit: string): LedgerEntry[]
{
	const lines = audit.split("\n");
	const marker = lines.indexOf(LEDGER_MARKER);
	const entries: LedgerEntry[] = [];
	for (let i = marker + 1; i < lines.length; i++)
	{
		const heading = /^## (\S+) — (.+)$/.exec(lines[i]!);
		if (!heading)
		{
			continue;
		}
		const [, date, rest] = heading as unknown as [string, string, string];
		const shape = shapeOf(rest);
		if (shape)
		{
			entries.push({
				line: i + 1,
				date,
				...shape,
				heading: lines[i]!,
			});
		}
		else if (/^\d{4}-\d{2}-\d{2}$/.test(date))
		{
			throw new LedgerParseError(`AUDIT.md line ${i + 1}: "${lines[i]}" is not an entry scripts/audit.sh writes`);
		}
	}
	return entries;
}

/**
 * A ledger fragment's file name: `<stamp>-<ID>-<kind>.md`, in a folder named for the stamp's
 * UTC date. The stamp is the entry's `Captured (UTC)` time without separators
 * (`20261121T101500Z`), so file names sort in stamp order. The ID is the story (`S9`, `B12`,
 * `V3`) for a story's entries, the review (`backlog`, `parity`) for a review's, and the run
 * (`R20261121T101500Z`, S158) for a run entry; the kind is
 * {@link FRAGMENT_KINDS}' name for the entry's {@link LedgerKind}. scripts/audit.sh writes
 * these names; this pattern is how they are read back and checked.
 */
export const FRAGMENT_NAME = /^(\d{8}T\d{6}Z)-([A-Za-z0-9]+)-([a-z]+)\.md$/;

/** The kind in a fragment's file name for each entry kind (a file name has no `-` in its kind). */
export const FRAGMENT_KINDS: Record<LedgerKind, string> = {
	"completed": "completed",
	"re-verified": "reverified",
	"backfill": "backfill",
	"design-match": "design",
	"review": "review",
	"answers": "answers",
	"skip": "skip",
	"migration": "migration",
	"create": "create",
	"edit": "edit",
	"snapshot": "snapshot",
	"run": "run",
};

/**
 * The folder a ledger's fragments live in: beside it, named for it in lower case
 * (docs/v3/AUDIT.md → docs/v3/audit/, docs/v3/VAULT-MIGRATION-AUDIT.md →
 * docs/v3/vault-migration-audit/). scripts/audit.sh and scripts/lib/reverify.sh derive the
 * same folder the same way, so an overridden ledger (`BT_AUDIT_LEDGER`) keeps its own fragments.
 */
export function fragmentsDirFor(auditPath: string): string
{
	return join(dirname(auditPath), basename(auditPath, ".md").toLowerCase());
}

/**
 * The one entry of a ledger fragment. `file` is its path relative to the ledger's directory
 * (it becomes the entry's {@link LedgerEntry.file}); its base name must be a
 * {@link FRAGMENT_NAME} whose ID and kind agree with the entry heading, so a renamed or
 * hand-written fragment can't pass as another entry. A fragment holds exactly one entry
 * heading (`## <date> — <shape>`, the same headings AUDIT.md's entries have); a review's
 * findings may use other `## ` sub-headings, skipped as in {@link parseLedger}.
 * Throws {@link LedgerParseError} for anything else.
 */
export function parseFragment(text: string, file: string): LedgerEntry
{
	const name = FRAGMENT_NAME.exec(basename(file));
	if (!name)
	{
		throw new LedgerParseError(`${file}: a ledger fragment is named <stamp>-<ID>-<kind>.md (scripts/audit.sh)`);
	}
	const [, , id, kind] = name as unknown as [string, string, string, string];
	// A text record's body (S164) is story text, not ledger entries: only the lines above it are read.
	const lines = text.split("<!-- bt-body:begin -->")[0]!.split("\n");
	const found: LedgerEntry[] = [];
	for (let i = 0; i < lines.length; i++)
	{
		const heading = /^## (\S+) — (.+)$/.exec(lines[i]!);
		if (!heading)
		{
			continue;
		}
		const [, date, rest] = heading as unknown as [string, string, string];
		const shape = shapeOf(rest);
		if (shape)
		{
			found.push({
				line: i + 1,
				date,
				file,
				...shape,
				heading: lines[i]!,
			});
		}
		else if (/^\d{4}-\d{2}-\d{2}$/.test(date))
		{
			throw new LedgerParseError(`${file} line ${i + 1}: "${lines[i]}" is not an entry scripts/audit.sh writes`);
		}
	}
	if (found.length !== 1)
	{
		throw new LedgerParseError(`${file}: a ledger fragment holds exactly one entry heading, not ${found.length}`);
	}
	const entry = found[0]!;
	const entryId = entry.story ?? entry.review ?? entry.run;
	if (entryId !== id || FRAGMENT_KINDS[entry.kind] !== kind)
	{
		throw new LedgerParseError(`${file}: its name says ${id} ${kind}, but its entry is "${entry.heading}"`);
	}
	const inFlight = /^\| In flight \| (.*) \|$/m.exec(text)?.[1]?.trim();
	if (inFlight && inFlight !== "none")
	{
		entry.inFlight = inFlight.split(/,\s*/).filter(Boolean);
	}
	const row = (name: string) => new RegExp(`^\\| ${name} \\| (.*) \\|$`, "m").exec(text)?.[1]?.trim();
	if (entry.kind === "run")
	{
		entry.runC = Number(row("C"));
		entry.counted = row("Counted") === "yes";
		entry.clean = row("Clean") === "yes";
		const f = row("Findings per pull request");
		entry.findingsPerPr = f === undefined || f === "none" ? null : Number(f);
		entry.turnCaps = parseHits(row("Turn-cap hits"));
	}
	if (entry.kind === "review")
	{
		entry.turnCaps = parseHits(row("Turn-cap hits read"));
	}
	// An item's issue (S164): the `Issue: #<n>` line in the entry's header, before a text record's body
	// or a completion's grader output (`<details>`), either of which may quote such a line.
	const issue = /^Issue: #(\d+)$/m.exec(text.split(/<!-- bt-body:begin -->|<details>/)[0]!)?.[1];
	if (issue)
	{
		entry.issue = Number(issue);
	}
	return entry;
}

/**
 * Every fragment file under `dir` (`<date>/<name>.md`), as paths relative to `dir`, in stamp
 * order (by file name; the stamp leads it, then the ID and kind break a tie the same way
 * everywhere). Empty when `dir` doesn't exist (a ledger with no fragments yet). Names starting
 * with "." are skipped at both levels.
 */
export function fragmentFiles(dir: string): string[]
{
	if (!existsSync(dir))
	{
		return [];
	}
	const files: string[] = [];
	// A name starting with "." is never a fragment: Finder's .DS_Store, an editor's swap file, or the
	// `.<name>.tmp` audit.sh writes an entry to before linking it into place.
	for (const day of readdirSync(dir, {
		withFileTypes: true,
	}).filter((d) => !d.name.startsWith(".")))
	{
		if (!day.isDirectory())
		{
			throw new LedgerParseError(`${join(dir, day.name)}: only <YYYY-MM-DD>/ folders of fragments belong in the ledger's fragment folder`);
		}
		for (const file of readdirSync(join(dir, day.name)).filter((f) => !f.startsWith(".")))
		{
			files.push(`${day.name}/${file}`);
		}
	}
	return files.sort((a, b) => compareFragments(a, b));
}

/** Stamp order for fragment paths: by file name, then by the whole path. */
function compareFragments(a: string, b: string): number
{
	const [x, y] = [basename(a), basename(b)];
	return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The whole ledger at `auditPath`: its own entries (the frozen AUDIT.md, parsed by
 * {@link parseLedger}), then each fragment's in stamp order ({@link fragmentFiles}) from
 * `fragmentsDir` (default {@link fragmentsDirFor}). A fragment entry's `file` is relative to
 * the ledger's directory. Reads the working tree; throws {@link LedgerParseError} on a
 * fragment that isn't one audit.sh writes.
 */
export function readLedger(auditPath: string, fragmentsDir = fragmentsDirFor(auditPath)): LedgerEntry[]
{
	const entries = parseLedger(readFileSync(auditPath, "utf8"));
	const base = dirname(auditPath);
	for (const file of fragmentFiles(fragmentsDir))
	{
		const path = join(fragmentsDir, file);
		entries.push(parseFragment(readFileSync(path, "utf8"), relative(base, path)));
	}
	return entries;
}

/** The stories completed since the newest review of a kind, and that review. */
export interface DoneSince
{
	/** The newest review entry of the kind, or undefined when none is logged. */
	review?: LedgerEntry;
	/** Story IDs with a `completed` entry after it, each once, in ledger order. */
	stories: string[];
}

/**
 * The review counter: stories `done` since the newest `kind` review.
 *
 * Only a review itself resets it. An answers entry finishes a review and a skip declines
 * one; neither reviews the stories, so neither resets the count (owner, 2026-11-03: "Skip
 * notes should not reset the counter, they should just avoid incrementing it, and if the
 * counter is already at the target, the skip should leave the counter as it is so the
 * next time triggers the review"). Re-verifications, backfills and design matches are not
 * completions.
 *
 * A review that ran beside in-flight items (S156; its `In flight` row) didn't review them, so
 * those of them already counted stay counted across it: an item whose completion fragment is
 * stamped before the review but merges after it is still one of the stories done since. A later
 * review that doesn't list it resets it as usual.
 */
export function storiesDoneSince(entries: LedgerEntry[], kind: ReviewKind): DoneSince
{
	let review: LedgerEntry | undefined;
	let stories: string[] = [];
	for (const entry of entries)
	{
		if (entry.kind === "review" && entry.review === kind)
		{
			review = entry;
			stories = stories.filter((s) => entry.inFlight?.includes(s));
		}
		else if (entry.kind === "completed" && entry.story && !stories.includes(entry.story))
		{
			stories.push(entry.story);
		}
	}
	return {
		review,
		stories,
	};
}

/**
 * Whether the `kind` review waits for the owner: its newest review or answers entry is a
 * `blocked` review (scripts/review-gate.sh then reports it and never runs it on its own).
 * An answers entry after it unblocks it; a skip does not, since declining a review for a
 * drift event doesn't answer a blocked review's questions.
 */
export function reviewBlocked(entries: LedgerEntry[], kind: ReviewKind): boolean
{
	const newest = entries.filter((e) => e.review === kind && (e.kind === "review" || e.kind === "answers")).at(-1);
	return newest?.kind === "review" && newest.verdict === "blocked";
}

/** The entry kinds that move the debt checks' base: a review, the owner's answers to one, or a skip. */
export const BASE_KINDS: LedgerEntry["kind"][] = ["review", "answers", "skip"];

/** The entries of a review kind and of `kinds`, as one comparable string (line numbers left out: they move when an earlier entry is edited). */
function reviewTrail(audit: string, kind: ReviewKind, kinds: LedgerEntry["kind"][]): string
{
	return parseLedger(audit)
		.filter((e) => e.review === kind && kinds.includes(e.kind))
		.map((e) => e.heading)
		.join("\n");
}

/**
 * The commit the debt checks measure drift from: the commit that added the newest review,
 * answers or skip entry of `kind` (the last one in HEAD's ledger at `ledgerPath`,
 * repo-relative). Undefined when HEAD's ledger has none.
 *
 * That commit is the one whose ledger holds the entry while none of its parents' ledgers
 * do (#40). Comparing a commit only with the one before it in `git log` order is wrong
 * across a merge: the log lists a merge before both parents by date, so a merge whose
 * other side touched the ledger last read as the base, and `git diff <merge> HEAD` hid
 * drift that side carried and the review never saw. Only entry headings count, so edits
 * to an entry's body (a correction) don't move the base. Reads committed history only.
 *
 * Since S156 a newer entry is a fragment ({@link readLedger}), and fragments always follow
 * AUDIT.md's entries, so when HEAD holds a review, answers or skip fragment of `kind` the
 * base is the commit that added the newest one (`git log --diff-filter=A`, which never lists
 * a merge, so the #40 merge order can't fool it); only otherwise is AUDIT.md searched as before.
 *
 * `kinds` narrows which entries count (S163): `["review"]` is the newest review itself (`cli.ts
 * review-base`), the base a review's seed measures from, so a change a skip or answers entry passed
 * over is still seeded ("the next scheduled or drift-triggered review still checks it", CLAUDE.md).
 * The debt checks keep the default, so their due-ness is unchanged.
 */
export function ledgerBase(repo: string, ledgerPath: string, kind: ReviewKind, kinds: LedgerEntry["kind"][] = BASE_KINDS): string | undefined
{
	const git = (args: string[]) => execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
	});
	const fragmentBase = newestReviewFragmentCommit(git, ledgerPath, kind, kinds);
	if (fragmentBase !== undefined)
	{
		return fragmentBase;
	}
	let commits: string[];
	try
	{
		commits = git(["log", "--format=%h", "--", ledgerPath]).split("\n").filter(Boolean);
	}
	catch
	{
		return undefined;
	}
	const trailAt = (commit: string) =>
	{
		try
		{
			return reviewTrail(git(["show", `${commit}:${ledgerPath}`]), kind, kinds).split("\n").filter(Boolean);
		}
		catch (error)
		{
			if (error instanceof LedgerParseError)
			{
				throw error;
			}
			return [];
		}
	};
	const head = trailAt("HEAD");
	const newest = head.at(-1);
	if (newest === undefined)
	{
		return undefined;
	}
	// Headings can repeat (two same-day `continue` reviews), so "holds the entry" means
	// holding at least as many copies of it as HEAD does.
	const copies = head.filter((h) => h === newest).length;
	const holds = (commit: string) => trailAt(commit).filter((h) => h === newest).length >= copies;
	// The commit that added the entry changed the ledger against every parent, so `git log
	// -- <ledger>` (which drops a merge matching one parent) always lists it.
	for (const commit of commits)
	{
		const parents = git(["log", "-1", "--format=%p", commit]).trim().split(" ").filter(Boolean);
		if (holds(commit) && !parents.some(holds))
		{
			return commit;
		}
	}
	return undefined;
}

/**
 * The commit that added HEAD's newest fragment of `kind` whose entry is one of `kinds` (ledgerBase's
 * fragment half), or undefined when HEAD holds none. Fragments are read from HEAD's tree, not
 * the working tree, and each is parsed, so a misnamed one throws as in {@link readLedger}.
 */
function newestReviewFragmentCommit(git: (args: string[]) => string, ledgerPath: string, kind: ReviewKind, kinds: LedgerEntry["kind"][]): string | undefined
{
	const dir = fragmentsDirFor(ledgerPath);
	let paths: string[];
	try
	{
		paths = git(["ls-tree", "-r", "--name-only", "HEAD", "--", `${dir}/`]).split("\n").filter(Boolean);
	}
	catch
	{
		return undefined;
	}
	const base = dirname(ledgerPath);
	const newest = paths
		.filter((p) => FRAGMENT_NAME.exec(basename(p))?.[2] === kind)
		.sort(compareFragments)
		.filter((p) =>
		{
			const entry = parseFragment(git(["show", `HEAD:${p}`]), relative(base, p));
			return entry.review === kind && kinds.includes(entry.kind);
		})
		.at(-1);
	if (newest === undefined)
	{
		return undefined;
	}
	return git(["log", "--diff-filter=A", "--format=%h", "--", newest]).split("\n").filter(Boolean).at(-1);
}

/** docs/v3/audit.jsonl: one JSON object per entry, oldest first, keys in a fixed order (`file` only for a fragment's entry). */
export function renderLedgerIndex(entries: LedgerEntry[]): string
{
	return entries.map((e) => JSON.stringify({
		line: e.line,
		file: e.file,
		date: e.date,
		kind: e.kind,
		story: e.story,
		review: e.review,
		verdict: e.verdict,
		answers: e.answers,
		at: e.at,
		inFlight: e.inFlight,
		issue: e.issue,
		run: e.run,
		runC: e.runC,
		findingsPerPr: e.findingsPerPr,
		counted: e.counted,
		clean: e.clean,
		turnCaps: e.turnCaps?.length ? e.turnCaps : undefined,
		heading: e.heading,
	})).join("\n") + (entries.length > 0 ? "\n" : "");
}
