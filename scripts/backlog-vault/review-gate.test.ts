/**
 * scripts/review-gate.sh's words (S156 AC 13): a due review starts beside a parallel run's in-flight
 * items, never pausing them, and a blocked one points at the ledger's fragments, not at the frozen
 * AUDIT.md. Its Stop loop guard (B481) lets a forced turn stop once per HEAD + due set in Claude Code
 * and in Cursor, which runs the same hook but sends `loop_count` instead of `stop_hook_active`, and since
 * 2026-11-24 it blocks at most once per HEAD + due set even across unforced turns; a due review whose entry
 * already sits on an open pull request counts as handled (owner, 2026-11-24: "Do all 6 token savers").
 * Runs the real gate in a clean throwaway repository whose debt scripts, ledger CLI and `gh` are stubs.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, beforeEach, describe, expect, it,
} from "vitest";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "../review-gate.sh");

let repo = "";
let bin = "";

function write(path: string, text: string, exec = false): void
{
	mkdirSync(dirname(join(repo, path)), {
		recursive: true,
	});
	writeFileSync(join(repo, path), text);
	if (exec) chmodSync(join(repo, path), 0o755);
}

/** What the stub debt scripts answer: `events` (the `--json` event kinds now), `since` (those `--json --since <sha>` reports), `done`, and `jsonFails`. */
interface Debt
{
	events?: string[];
	since?: string[];
	done?: string[];
	jsonFails?: boolean;
}

/** A stub debt script: due with its text when `due`, else clear; `--json` (and `--since`) answer as `debt` says. */
function debtScript(due: boolean, label: string, debt: Debt): string
{
	if (!due) return "#!/bin/sh\nexit 0\n";
	const json = (kinds: string[]) => JSON.stringify({
		due: true,
		done: debt.done ?? [],
		events: kinds.map((kind) => ({
			kind,
		})),
	});
	const jsonBranch = debt.jsonFails
		? "if [ \"$1\" = \"--json\" ]; then exit 2; fi\n"
		: `if [ "$1" = "--json" ] && [ "$2" = "--since" ]; then echo '${json(debt.since ?? [])}'; exit 0; fi\nif [ "$1" = "--json" ]; then echo '${json(debt.events ?? ["inserted"])}'; exit 0; fi\n`;
	return `#!/bin/sh\n${jsonBranch}echo '${label}'\nexit 1\n`;
}

let prHead = "";

const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "-c", "core.hooksPath=/dev/null", ...args], {
	cwd: repo,
	encoding: "utf8",
}).stdout.trim();

/**
 * A clean repository holding the gate, stub debt scripts and a ledger CLI answering `blocked`. `prHead` is a commit on
 * the base, as an open pull request's head; `later` stories' snapshot fragments are committed after it, so they shipped
 * after that pull request's base.
 */
function world(reviewDue: boolean, blocked: string, debt: Debt = {}, parity?: Debt, later: string[] = []): void
{
	copyFileSync(GATE, join(mkdirOf("scripts/review-gate.sh"), "review-gate.sh"));
	write("scripts/review-debt.sh", debtScript(reviewDue, "A backlog review is due: 6 stories done.", debt), true);
	write("scripts/parity-debt.sh", debtScript(parity !== undefined, "A doc parity review is due.", parity ?? {}), true);
	write("scripts/backlog-vault/cli.ts", `const kind = process.argv.at(-1); console.log(kind === ${JSON.stringify(blocked)} ? "blocked" : "clear");\n`);
	write("docs/v3/AUDIT.md", "# Ledger\n");
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", "base");
	prHead = git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "pull request head");
	if (later.length > 0)
	{
		for (const id of later) write(`docs/v3/audit/2026-11-24/20261124T000000Z-${id}-snapshot.md`, "snapshot\n");
		git("add", "-A");
		git("commit", "-qm", "later stories");
	}
}

function mkdirOf(path: string): string
{
	const dir = dirname(join(repo, path));
	mkdirSync(dir, {
		recursive: true,
	});
	return dir;
}

/** One open pull request the fake `gh` lists: its files (added unless `status` says otherwise) and whether it comes from a fork. */
interface FakePr
{
	files: string[];
	status?: string;
	fork?: boolean;
}

/**
 * A fake `gh` on PATH answering `gh api --paginate … --jq '.[]'` with one JSON object a line, unfiltered, as the REST
 * API returns them: the open pull requests (number i + 1, head `prHead`) and each one's files. `fail` makes every call
 * fail, as `gh` does offline or signed out; `filesFail` only the per-pull-request `files` calls.
 */
function fakeGh(prs: FakePr[], fail = false, filesFail = false): void
{
	const list = prs.map((pr, i) => JSON.stringify({
		number: i + 1,
		head: {
			sha: prHead,
			repo: {
				full_name: pr.fork ? "someone/fork" : "owner/repo",
			},
		},
		base: {
			repo: {
				full_name: "owner/repo",
			},
		},
	}));
	const files = prs.map((pr) => pr.files.map((filename) => JSON.stringify({
		filename,
		status: pr.status ?? "added",
	})).join("\n"));
	const script = fail
		? "#!/bin/sh\nexit 1\n"
		: `#!/usr/bin/env node\nconst args = process.argv.slice(2).join(" ");\nconst list = ${JSON.stringify(list.join("\n"))};\nconst files = ${JSON.stringify(files)};\nconst m = /pulls\\/(\\d+)\\/files/.exec(args);\nif (m && ${filesFail}) process.exit(1);\nconsole.log(m ? files[Number(m[1]) - 1] ?? "" : list);\n`;
	writeFileSync(join(bin, "gh"), script);
	chmodSync(join(bin, "gh"), 0o755);
}

/** The fake `gh` lives outside the repository, which must stay clean for the gate to speak. */
const env = () => ({
	...process.env,
	PATH: `${bin}:${process.env.PATH ?? ""}`,
});

const prompt = () => spawnSync("bash", [join(repo, "scripts/review-gate.sh"), "prompt"], {
	cwd: repo,
	encoding: "utf8",
	input: "",
	env: env(),
}).stdout;

const stop = (input: object) => spawnSync("bash", [join(repo, "scripts/review-gate.sh"), "stop"], {
	cwd: repo,
	encoding: "utf8",
	input: JSON.stringify(input),
	env: env(),
}).stdout;

beforeEach(() =>
{
	repo = mkdtempSync(join(tmpdir(), "review-gate-"));
	bin = mkdtempSync(join(tmpdir(), "review-gate-bin-"));
	fakeGh([], true);
});

afterEach(() =>
{
	for (const dir of [repo, bin])
	{
		rmSync(dir, {
			recursive: true,
			force: true,
		});
	}
});

describe("review-gate.sh prompt", () =>
{
	it("starts a due review beside a parallel run's in-flight items instead of before any story continues", () =>
	{
		world(true, "none");
		const out = prompt();
		expect(out).toContain("BACKLOG REVIEW");
		expect(out).toContain("beside the in-flight items and never pauses them");
		expect(out).not.toContain("before starting or continuing any story");
	});

	it("points a blocked review's questions at its ledger fragment, not at the frozen AUDIT.md", () =>
	{
		world(false, "parity");
		const out = prompt();
		expect(out).toContain("Blocked, waiting for the owner's answers");
		expect(out).toContain("a fragment under docs/v3/audit/");
		expect(out).not.toContain("AUDIT.md");
	});
});

describe("review-gate.sh stop loop guard", () =>
{
	it("lets Claude Code stop after one forced turn that committed no review", () =>
	{
		world(true, "none");
		expect(stop({
			stop_hook_active: false,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			stop_hook_active: true,
		})).toBe("");
	});

	it("lets Cursor stop after one forced turn that committed no review (B481)", () =>
	{
		world(true, "none");
		expect(stop({
			status: "completed",
			loop_count: 0,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			status: "completed",
			loop_count: 1,
		})).toBe("");
	});

	it("still blocks a forced Cursor turn the gate has not yet blocked for this HEAD and due set", () =>
	{
		world(true, "none");
		expect(stop({
			status: "completed",
			loop_count: 3,
		})).toContain("\"decision\":\"block\"");
	});

	it("blocks at most once per HEAD and due set, not at every turn's end (owner, 2026-11-24: \"Do all 6 token savers\")", () =>
	{
		world(true, "none");
		expect(stop({
			stop_hook_active: false,
		})).toContain("\"decision\":\"block\"");
		expect(stop({
			stop_hook_active: false,
		})).toBe("");
	});
});

describe("review-gate.sh with the due review already on an open pull request", () =>
{
	const REVIEW = "docs/v3/audit/2026-11-24/20261124T040541Z-backlog-review.md";
	const SKIP = "docs/v3/audit/2026-11-24/20261124T045520Z-backlog-skip.md";
	const PARITY_REVIEW = "docs/v3/audit/2026-11-24/20261124T004216Z-parity-review.md";

	it("treats a backlog review recorded on an open pull request as handled", () =>
	{
		world(true, "none", {
			events: ["count"],
			since: ["count"],
		});
		fakeGh([{
			files: [REVIEW],
		}]);
		expect(prompt()).toBe("");
		expect(stop({
			stop_hook_active: false,
		})).toBe("");
	});

	it("treats a skip on an open pull request as handling a drift event", () =>
	{
		world(true, "none", {
			events: ["inserted"],
		});
		fakeGh([{
			files: [SKIP],
		}]);
		expect(prompt()).toBe("");
	});

	it("still asks for the review when only a skip is pending but the review is due by story count, which a skip never clears", () =>
	{
		world(true, "none", {
			events: ["count"],
		});
		fakeGh([{
			files: [SKIP],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("still asks when only a skip is pending but a turn-cap hit is due, which only a review clears", () =>
	{
		world(true, "none", {
			events: ["turn-cap"],
		});
		fakeGh([{
			files: [SKIP],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("ignores another kind's entry: a pending parity review leaves a due backlog review due", () =>
	{
		world(true, "none");
		fakeGh([{
			files: [PARITY_REVIEW],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("handles a due parity review only through a parity entry: a pending backlog review leaves it due", () =>
	{
		world(false, "none", {}, {
			events: ["doc-changed"],
		});
		fakeGh([{
			files: [REVIEW],
		}]);
		expect(prompt()).toContain("DOC PARITY REVIEW");
		fakeGh([{
			files: [PARITY_REVIEW],
		}]);
		rmSync(join(repo, ".git/bt-review-gate-prs"), {
			force: true,
		});
		expect(prompt()).toBe("");
	});

	it("doesn't count an old pull request's review against an event due since its base", () =>
	{
		world(true, "none", {
			events: ["inserted"],
			since: ["inserted"],
		});
		fakeGh([{
			files: [REVIEW],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("doesn't count an old pull request's review once 6 more stories shipped after its base", () =>
	{
		const later = ["S1", "S2", "S3", "S4", "S5", "S6"];
		world(true, "none", {
			events: ["count"],
			since: ["count"],
			done: later,
		}, undefined, later);
		fakeGh([{
			files: [REVIEW],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("doesn't count a fork's pull request", () =>
	{
		world(true, "none", {
			events: ["count"],
			since: ["count"],
		});
		fakeGh([{
			files: [REVIEW],
			fork: true,
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("doesn't count an entry the pull request only changes, not adds", () =>
	{
		world(true, "none");
		fakeGh([{
			files: [REVIEW],
			status: "modified",
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("asks for the review when the debt script's --json fails", () =>
	{
		world(true, "none", {
			jsonFails: true,
		});
		fakeGh([{
			files: [SKIP],
		}]);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});

	it("fetches a pull request's head the checkout hasn't fetched before judging what it covers", () =>
	{
		world(true, "none", {
			events: ["count"],
			since: ["count"],
		});
		const remote = mkdtempSync(join(tmpdir(), "review-gate-remote-"));
		try
		{
			spawnSync("git", ["clone", "-q", repo, remote]);
			const head = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@e", "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "unfetched head"], {
				cwd: remote,
				encoding: "utf8",
			}).stdout.trim();
			spawnSync("git", ["update-ref", "refs/pull/1/head", head], {
				cwd: remote,
			});
			git("remote", "add", "origin", remote);
			expect(git("cat-file", "-t", head)).toBe("");
			prHead = head;
			fakeGh([{
				files: [REVIEW],
			}]);
			expect(prompt()).toBe("");
		}
		finally
		{
			rmSync(remote, {
				recursive: true,
				force: true,
			});
		}
	});

	it("never caches an answer with a failed files call, so the next prompt asks gh again", () =>
	{
		world(true, "none");
		fakeGh([{
			files: [REVIEW],
		}], false, true);
		expect(prompt()).toContain("BACKLOG REVIEW");
		expect(existsSync(join(repo, ".git/bt-review-gate-prs"))).toBe(false);
	});

	it("falls back to asking for the review when gh can't answer (offline)", () =>
	{
		world(true, "none");
		fakeGh([], true);
		expect(prompt()).toContain("BACKLOG REVIEW");
	});
});
