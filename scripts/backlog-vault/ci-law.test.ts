/**
 * Law P11 (docs/v3/LAWS.md; S62; owner, 2026-10-29: "Yes", to running all of
 * `pnpm verify` in CI): CI runs `pnpm verify`, so every law the gate holds —
 * including `pnpm dup:check` (L7) and `pnpm size` (L5) — also holds on every change to
 * code, not only where someone runs it locally. A docs-only change runs only the docs
 * checks (owner, 2026-11-07: "Things like this shouldn't trigger CI."), as
 * `scripts/ci-changes.sh` decides; nothing else may skip the gate. A code change also runs
 * the docs job's Markdown format check (Claude's review of PR #14), so unformatted Markdown
 * can't merge with code and then fail the next docs-only change.
 *
 * Since S152 (owner, 2026-11-19: "Reword P11 (Recommended)"; "Stage reruns everything
 * (Recommended)") a pull request reuses what unchanged packages already passed and may run
 * functions' tests in shard jobs, while every push runs all of `pnpm verify` fresh. So these
 * tests also hold that: a push reads no cache (Turborepo's and the lint/tsc caches are restored
 * only on pull requests, and the read switch is set only in a pull-request step), the root scripts
 * read no Turborepo or ESLint cache outside those runs, and `ci-passed` fails when the shard and
 * merge jobs didn't pass for code (or when `changes` gave no answer). Every child process gets
 * an environment built from scratch: CI exports GITHUB_ACTIONS, and a pull request's verify step
 * BT_TURBO_CACHE_READ and BT_FUNCTIONS_SHARDED, which would leak into the "unset" cases.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { parse as parseYaml } from "yaml";

const CI_YML = fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url));
const DEPLOY_YML = fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url));
const ROOT_PACKAGE = fileURLToPath(new URL("../../package.json", import.meta.url));

/** A ci.yml step, as far as these tests read it. */
interface Step
{
	name?: string;
	uses?: string;
	if?: string;
	run?: string;
	env?: Record<string, string>;
	with?: Record<string, string>;
}

/** The parsed workflow's jobs, by name. */
function jobsOf(workflow: string): Record<string, { needs?: string[];
	steps?: Step[] }>
{
	return (parseYaml(workflow) as { jobs?: Record<string, { needs?: string[];
		steps?: Step[] }> }).jobs ?? {};
}

const READ_SWITCH = "BT_TURBO_CACHE_READ";
const ONLY_ON_PULL_REQUESTS = "github.event_name == 'pull_request'";

/** A child process environment from scratch: PATH and HOME, plus the case's own variables. */
function cleanEnv(vars: Record<string, string> = {}): Record<string, string>
{
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: process.env.HOME ?? "/tmp",
		...vars,
	};
}

/**
 * The problems that would let a push to stage or main read a cache: the Turborepo or lint/tsc
 * restore running on more than pull requests, or a step setting the read switch on one.
 */
export function pushCacheProblems(workflow: string): string[]
{
	const problems: string[] = [];
	for (const [job, def] of Object.entries(jobsOf(workflow)))
	{
		for (const step of def.steps ?? [])
		{
			const restores = /^actions\/cache(\/restore)?@/.test(step.uses ?? "") && /\.turbo\/cache|eslintcache|tsbuildinfo/.test(step.with?.path ?? "");
			if (restores && step.if !== ONLY_ON_PULL_REQUESTS) problems.push(`${job}: '${step.name}' restores a cache with if: ${step.if ?? "(none)"}`);
			const setsSwitch = step.env?.[READ_SWITCH] !== undefined || (step.run ?? "").includes(READ_SWITCH);
			if (setsSwitch && step.if !== ONLY_ON_PULL_REQUESTS) problems.push(`${job}: '${step.name}' sets ${READ_SWITCH} with if: ${step.if ?? "(none)"}`);
		}
	}
	const verify = jobsOf(workflow).verify?.steps ?? [];
	const pushVerify = verify.filter((s) => /^pnpm verify$/m.test(s.run ?? "") && s.if !== ONLY_ON_PULL_REQUESTS && s.env?.[READ_SWITCH] === undefined);
	if (pushVerify.length === 0) problems.push("no verify step runs pnpm verify on a push without the read switch");
	return problems;
}

/** The problems that would let a root script read a cache outside CI's pull-request runs. */
export function scriptCacheProblems(scripts: Record<string, string>): string[]
{
	const problems: string[] = [];
	const expand = (command: string, vars: Record<string, string>): string => execFileSync("sh", ["-c", `echo ${command}`], {
		env: cleanEnv(vars),
	}).toString().trim();
	for (const name of ["build", "test:coverage"])
	{
		// The turbo command ends at a shell separator or, when a runner such as `concurrently` quotes it
		// beside other commands, at its closing quote.
		const turbo = /turbo run [^&|;"']+/.exec(scripts[name] ?? "")?.[0];
		if (!turbo)
		{
			problems.push(`root ${name} doesn't call turbo run`);
			continue;
		}
		for (const vars of [{}, {
			GITHUB_ACTIONS: "true",
		}])
		{
			const args = expand(turbo, vars);
			const spec = /--cache=(\S*)/.exec(args)?.[1];
			const local = spec === undefined ? "rw" : (/(?:^|,)local:(\w*)/.exec(spec)?.[1] ?? "");
			if (!/--force\b/.test(args) && (local.includes("r") || /remote:\w*r/.test(spec ?? ""))) problems.push(`root ${name} reads a cache without ${READ_SWITCH}: ${args}`);
		}
	}
	const eslint = /eslint \.[^&|;]*/.exec(scripts.lint ?? "")?.[0] ?? "";
	if (/--cache\b/.test(expand(eslint, {}))) problems.push(`root lint reads ESLint's cache outside CI: ${expand(eslint, {})}`);
	return problems;
}

/**
 * Runs ci-passed's check the way GitHub runs a step that names no shell (`bash -e`), with each
 * job's result and the `changes` answer given; true when it passes.
 */
export function ciPassedAccepts(workflow: string, outcome: Record<string, string>): boolean
{
	const step = (jobsOf(workflow)["ci-passed"]?.steps ?? []).find((s) => (s.run ?? "").includes('test "$CHANGES" = success'));
	if (!step) throw new Error("ci-passed has no step checking the jobs' results");
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(step.env ?? {}))
	{
		const expr = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(value)?.[1] ?? "";
		const job = /^needs\.([\w-]+)\.result$/.exec(expr)?.[1];
		if (job) env[key] = outcome[job] ?? "";
		else if (expr === "needs.changes.outputs.code") env[key] = outcome.code ?? "";
		else if (/github\.event\.pull_request\.base\.ref == 'stage'/.test(expr)) env[key] = outcome.intoStage ?? "true";
		else throw new Error(`ci-passed reads ${key} from an expression this test can't give: ${value}`);
	}
	return spawnSync("bash", ["-e", "-c", step.run ?? ""], {
		env: cleanEnv(env),
	}).status === 0;
}

const S = "success";
const K = "skipped";
/** A code change whose every job passed, into stage. */
const CODE_RUN = {
	code: "true",
	changes: S,
	docs: K,
	verify: S,
	flows: S,
	lighthouse: S,
	"functions-shard": S,
	"functions-coverage": S,
	milestone: S,
	intoStage: "true",
};
/** A docs-only change whose docs job passed. */
const DOCS_RUN = {
	...CODE_RUN,
	code: "false",
	docs: S,
	verify: K,
	flows: K,
	lighthouse: K,
	"functions-shard": K,
	"functions-coverage": K,
};

/** The commands of a workflow's `run:` steps, one per step (single-line runs only). */
export function runSteps(workflow: string): string[]
{
	return [...workflow.matchAll(/^\s*run:\s*(.+?)\s*$/gm)].map((m) => m[1]!);
}

/** The docs job's Markdown format command, which the verify job runs too (Claude's review of PR #14). */
const MARKDOWN_CHECK = 'pnpm exec prettier --check "**/*.md"';

/**
 * Asserts a job has a "Markdown format" step that runs `MARKDOWN_CHECK` on every run: its text,
 * from its `- name:` to the next step's, has no `if:` and no `continue-on-error`.
 */
function expectUnconditionalMarkdownStep(job: string): void
{
	const start = job.indexOf("- name: Markdown format");
	expect(start, "a Markdown format step").toBeGreaterThanOrEqual(0);
	const next = job.indexOf("- name:", start + 1);
	const step = job.slice(start, next === -1 ? undefined : next);
	expect(runSteps(step)).toContain(MARKDOWN_CHECK);
	expect(step).not.toMatch(/^\s*if:/m);
	expect(step).not.toContain("continue-on-error");
}

describe("CI runs pnpm verify (law P11)", () =>
{
	it(".github/workflows/ci.yml has a step that runs pnpm verify", () =>
	{
		expect(runSteps(readFileSync(CI_YML, "utf8"))).toContain("pnpm verify");
	});

	it("catches a workflow that runs only parts of the gate", () =>
	{
		expect(runSteps("steps:\n  - run: pnpm lint\n  - run: pnpm build\n")).not.toContain("pnpm verify");
	});

	it("the verify job is skipped only for a docs-only change, and ci-passed requires it for code", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const verifyJob = ci.slice(ci.indexOf("\n    verify:\n"), ci.indexOf("\n    flows:\n"));
		expect(verifyJob).toContain("if: needs.changes.outputs.code == 'true'");
		expect([...verifyJob.matchAll(/^ {8}if:/gm)]).toHaveLength(1);
		expect(ci).toContain('test "$VERIFY $FLOWS $LIGHTHOUSE" = "success success success"');
	});

	// Claude's review of PR #14: Markdown format was checked only in the docs job, so a code
	// change could merge unformatted Markdown and the next docs-only pull request failed on a file
	// it never touched. The verify job runs the docs job's exact check too (owner, 2026-11-13,
	// asked "May I add a Markdown formatting check to CI's main verify job?": "yes").
	it("the Markdown format check runs for code changes too, the same command as the docs job", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const docsJob = ci.slice(ci.indexOf("\n    docs:\n"), ci.indexOf("\n    verify:\n"));
		const verifyJob = ci.slice(ci.indexOf("\n    verify:\n"), ci.indexOf("\n    flows:\n"));
		expectUnconditionalMarkdownStep(docsJob);
		expectUnconditionalMarkdownStep(verifyJob);
	});

	it("catches a Markdown step in either job that is switched off or allowed to fail", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const docsJob = ci.slice(ci.indexOf("\n    docs:\n"), ci.indexOf("\n    verify:\n"));
		const verifyJob = ci.slice(ci.indexOf("\n    verify:\n"), ci.indexOf("\n    flows:\n"));
		const named = "            - name: Markdown format\n";
		for (const job of [docsJob, verifyJob])
		{
			for (const extra of ["              if: false\n", "              continue-on-error: true\n"])
			{
				expect(() => expectUnconditionalMarkdownStep(job.replace(named, named + extra)), extra).toThrow();
			}
		}
	});

	it("a pull request is compared with its base and a push with the last commit whose run passed, in CI and Deploy", () =>
	{
		for (const [file, workflow] of [[CI_YML, "ci.yml"], [DEPLOY_YML, "deploy.yml"]] as const)
		{
			const text = readFileSync(file, "utf8");
			const start = text.indexOf("\n    changes:\n");
			const changesJob = text.slice(start, text.indexOf("\n    # ", start + 1));
			expect(changesJob, file).toContain('scripts/ci-changes.sh pr "${{ github.event.pull_request.base.sha }}" "${{ github.sha }}"');
			expect(changesJob, file).toContain(`actions/workflows/${workflow}/runs?branch=\${{ github.ref_name }}&event=push&status=success&per_page=1`);
			expect(changesJob, file).toContain('scripts/ci-changes.sh push "$checked" "${{ github.sha }}"');
			expect(changesJob, file).not.toContain("github.event.before");
		}
		const deploy = readFileSync(DEPLOY_YML, "utf8");
		expect(deploy).toMatch(/= release \]; then\n\s+echo "code=true" >> "\$GITHUB_OUTPUT"/);
		const staging = deploy.slice(deploy.indexOf("\n    staging:\n"), deploy.indexOf("\n    production:\n"));
		// Staging deploys only code that verify passed; a docs-only push deploys nothing (owner,
		// 2026-11-11: "Can we avoid deploying when the only change was docs?").
		expect(staging).toContain("needs.changes.outputs.code == 'true' && needs.verify.result == 'success'");
		expect(staging).not.toContain("needs.verify.result == 'skipped'");
		// Whether to deploy is decided from the commit staging serves, never from what else is on
		// stage, so a newer run that fails can't strand an older commit that passed.
		expect(staging).toContain('echo "${{ github.sha }}" >web/dist/bt-commit.txt');
		expect(staging).toContain('git merge-base --is-ancestor "${{ github.sha }}" "$served"');
		expect(staging).not.toContain("origin/stage)");
		// A 404 or a 200 without a sha (no marker yet) deploys; any other answer fails the step after
		// curl's retries (no `|| true` swallowing it); the marker is read twice so a deploy still
		// spreading to the edge is seen.
		expect(staging).toContain("curl -sS --retry 5 --max-time 10");
		expect(staging).toContain("200 | 404) ;;");
		expect(staging).not.toMatch(/bt-commit\.txt[^\n]*\|\| true/);
		expect(staging).toContain("for attempt in 1 2; do");
		expect(staging).toContain("!cancelled()");
		expect(staging).not.toMatch(/always\(\)/);
	});

	it("a push reads no cache: the restores and the read switch are for pull requests only (S152)", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		expect(pushCacheProblems(ci)).toEqual([]);
	});

	it("catches a cache restored on pushes, or the read switch set on them", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const restore = "            - name: Restore Turborepo's cache (pull requests only)\n              if: github.event_name == 'pull_request'\n";
		expect(ci).toContain(restore);
		expect(pushCacheProblems(ci.replace(restore, "            - name: Restore Turborepo's cache (pull requests only)\n"))).not.toEqual([]);
		const prVerify = "            - name: Verify (pull request, reusing unchanged packages)\n              if: github.event_name == 'pull_request'\n";
		expect(ci).toContain(prVerify);
		expect(pushCacheProblems(ci.replace(prVerify, "            - name: Verify (pull request, reusing unchanged packages)\n"))).not.toEqual([]);
		const pushVerify = "            - name: Verify\n              if: github.event_name != 'pull_request'\n              run: pnpm verify\n";
		expect(ci).toContain(pushVerify);
		expect(pushCacheProblems(ci.replace(pushVerify, ""))).not.toEqual([]);
	});

	it("the root scripts read no Turborepo or ESLint cache without the pull-request switch (S152)", () =>
	{
		const scripts = (JSON.parse(readFileSync(ROOT_PACKAGE, "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scriptCacheProblems(scripts)).toEqual([]);
	});

	it("catches a root script that reads a cache without the switch", () =>
	{
		const scripts = (JSON.parse(readFileSync(ROOT_PACKAGE, "utf8")) as { scripts: Record<string, string> }).scripts;
		for (const name of ["build", "test:coverage"])
		{
			const always = scripts[name]!.replace(/--cache=\S+/, "--cache=local:rw");
			expect(scriptCacheProblems({
				...scripts,
				[name]: always,
			}), name).not.toEqual([]);
			expect(scriptCacheProblems({
				...scripts,
				[name]: scripts[name]!.replace(/ --cache=\S+/, ""),
			}), `${name} with turbo's default cache`).not.toEqual([]);
		}
		expect(scriptCacheProblems({
			...scripts,
			lint: "pnpm backlog:check && eslint . --cache --cache-strategy content --cache-location .eslintcache",
		})).not.toEqual([]);
	});

	it("ci-passed requires the functions shards and their merge for code, and fails without an answer from changes (S152)", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		expect(jobsOf(ci)["ci-passed"]?.needs).toEqual(expect.arrayContaining(["functions-shard", "functions-coverage"]));
		expect(ciPassedAccepts(ci, CODE_RUN)).toBe(true);
		expect(ciPassedAccepts(ci, DOCS_RUN)).toBe(true);
		expect(ciPassedAccepts(ci, {
			...CODE_RUN,
			"functions-shard": K,
		})).toBe(false);
		expect(ciPassedAccepts(ci, {
			...CODE_RUN,
			"functions-coverage": "failure",
		})).toBe(false);
		expect(ciPassedAccepts(ci, {
			...DOCS_RUN,
			"functions-shard": S,
			"functions-coverage": S,
		})).toBe(false);
		expect(ciPassedAccepts(ci, {
			...DOCS_RUN,
			code: "",
		})).toBe(false);
		expect(ciPassedAccepts(ci, {
			...DOCS_RUN,
			code: "",
			docs: K,
		})).toBe(false);
	});

	it("catches a ci-passed that stops checking the shards and their merge", () =>
	{
		const ci = readFileSync(CI_YML, "utf8");
		const shardLine = 'test "$SHARDS $MERGE" = "success success"';
		expect(ci).toContain(shardLine);
		expect(ciPassedAccepts(ci.replace(shardLine, "true"), {
			...CODE_RUN,
			"functions-shard": K,
		})).toBe(true);
	});
});
