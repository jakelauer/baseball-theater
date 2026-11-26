/**
 * What `.github/workflows/deploy.yml` and `.github/workflows/preview-cleanup.yml` must keep doing,
 * read from the files themselves (nothing here runs a workflow). One `describe` per job, through
 * {@link job}, so later deploy pins (S146's skip) join this file rather than starting another.
 *
 * Issue #42: a preview runs on its own Neon branch and Hyperdrive config, which the
 * `preview-teardown` job deletes when its pull request closes, and a closed pull request's preview
 * is never recreated by a run that was already queued. `scripts/preview-pr-open.sh` is the one
 * place both jobs ask GitHub whether the pull request is open; it runs here against a stand-in `gh`.
 *
 * Issue #48: every deploy's migrate step fails on a database whose migrations differ from the code's;
 * only production's lets a database ahead of the code through, since re-running an older release's
 * deploy is its rollback.
 *
 * S146: staging and previews skip install, build, migrations and deploy when `pnpm build:inputs check`
 * finds the record of their last successful deploy unchanged; a record is stored only after the deploy
 * step, preview-teardown deletes a pull request's, a `force` run deploys staging anyway, and production
 * always deploys.
 */
import { execFileSync } from "node:child_process";
import {
	chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it,
} from "vitest";
import { MAY_BE_AHEAD_ENV } from "../adapters/postgres/migrate.js";

/** A workflow's text, or "" when the file is missing (so each pin fails on its own rather than the whole file). */
function workflow(name: string): string
{
	const url = new URL(`../../../.github/workflows/${name}`, import.meta.url);
	return existsSync(url) ? readFileSync(url, "utf8") : "";
}

const DEPLOY_YML = workflow("deploy.yml");
const CLEANUP_YML = workflow("preview-cleanup.yml");
const OPEN_SCRIPT = fileURLToPath(new URL("../../../scripts/preview-pr-open.sh", import.meta.url));

/** One job's text in a workflow: from its `    <name>:` line to the next job's (or the end). */
function job(workflow: string, name: string): string
{
	const start = workflow.indexOf(`\n    ${name}:\n`);
	if (start < 0) throw new Error(`no job ${name}`);
	const rest = workflow.slice(start + 1);
	const next = rest.slice(1).search(/\n {4}[a-z][\w-]*:\n/);
	return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The Cloudflare and Neon env every job that bootstraps or tears down a preview maps, from GitHub secrets and variables. */
const API_ENV = ["CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", "CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}", "NEON_API_KEY: ${{ secrets.NEON_API_KEY }}",
	"NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}"];

/** A job's own settings: its text before `steps:`. */
function header(jobText: string): string
{
	return jobText.slice(0, jobText.indexOf("\n        steps:\n"));
}

/**
 * GitHub's token is given only to the steps that call `gh` (the open checks, the comment), never to
 * the whole job, so `pnpm install` and the deploy scripts never see it.
 */
function expectTokenOnlyOnGhSteps(list: string[], jobText: string): void
{
	expect(header(jobText)).not.toMatch(/GH_TOKEN/);
	for (const step of list)
	{
		// #47's release lookup (scripts/build-release.sh) reads the pull request's milestone from GitHub too,
		// and S146's record steps read or delete Actions artifacts.
		const callsGitHub = /preview-pr-open\.sh|gh pr comment|scripts\/build-release\.sh|actions\/artifacts/.test(step);
		if (callsGitHub) expect(step, step).toMatch(/\n {14}env:\n {18}GH_TOKEN: \$\{\{ github\.token \}\}\n/);
		else expect(step, step).not.toMatch(/GH_TOKEN/);
	}
}

/** A job's steps, each as its own text, in order. */
function steps(jobText: string): string[]
{
	return jobText.split(/\n {12}- /).slice(1);
}

describe("deploy.yml preview job (issue #42)", () =>
{
	const preview = DEPLOY_YML && job(DEPLOY_YML, "preview");
	const list = steps(preview);

	it("issue #42: checks the pull request is still open first, and again just before deploying, tearing down and stopping if it closed", () =>
	{
		expect(list[0]).toMatch(/actions\/checkout/);
		expect(list[1]).toMatch(/id: open\n[^]*scripts\/preview-pr-open\.sh \$\{\{ github\.event\.pull_request\.number \}\}/);
		// The deploy itself, not S146's dry run for the Worker's metafile.
		const deploy = list.findIndex((step) => step.includes("wrangler deploy --config \"${{ steps.bootstrap"));
		const recheck = list.findIndex((step) => /id: still_open\n/.test(step));
		const reapply = list.findIndex((step) => step.includes("db:reapply-deletions"));
		expect(recheck).toBeGreaterThan(reapply);
		expect(deploy).toBe(recheck + 1);
		expect(list[deploy]).toMatch(/if: steps\.still_open\.outputs\.open == 'true'/);
		// Every step after the first check, up to the recheck, runs only while the pull request is open
		// (setup and install also run to tear down a closed one).
		for (const step of list.slice(2, recheck))
		{
			if (/deploy:teardown/.test(step)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'false'/);
			else if (!/action-setup|setup-node|name: Install/.test(step)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'true'/);
		}
		const teardowns = list.filter((step) => /pnpm run deploy:teardown preview --pr \$\{\{ github\.event\.pull_request\.number \}\}/.test(step));
		expect(teardowns).toHaveLength(2);
		expect(teardowns[1]).toMatch(/if: steps\.still_open\.outputs\.open == 'false'/);
		expect(list.at(-1)).toMatch(/if: steps\.still_open\.outputs\.open == 'true'/);
		expect(preview).not.toMatch(/\|\| true/);
		expectTokenOnlyOnGhSteps(list, preview);
		for (const line of API_ENV) expect(header(preview)).toContain(line);
	});

	it("issue #42: runs on the pull request's own database, never staging's", () =>
	{
		expect(preview).not.toMatch(/bt-staging|staging database|staging's database/);
		expect(preview).toMatch(/pnpm run deploy:bootstrap preview --pr/);
		expect(preview).toMatch(/group: deploy-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
	});
});

describe("deploy.yml preview-teardown job (issue #42)", () =>
{
	const teardown = DEPLOY_YML && job(DEPLOY_YML, "preview-teardown");
	const list = steps(teardown);

	it("issue #42: does nothing if the pull request is open again, and otherwise deletes the Worker, config and branch, failing loudly", () =>
	{
		expect(list[0]).toMatch(/actions\/checkout/);
		expect(list[1]).toMatch(/id: open\n[^]*scripts\/preview-pr-open\.sh \$\{\{ github\.event\.pull_request\.number \}\}/);
		for (const step of list.slice(2)) expect(step).toMatch(/if: steps\.open\.outputs\.open == 'false'/);
		expect(teardown).toMatch(/run: pnpm run deploy:teardown preview --pr \$\{\{ github\.event\.pull_request\.number \}\}\n/);
		expect(teardown).not.toMatch(/\|\| true|wrangler delete/);
		for (const line of API_ENV) expect(header(teardown)).toContain(line);
		expectTokenOnlyOnGhSteps(list, teardown);
		// It only reads the pull request; the workflow's write permission is for the preview's comment.
		// S146: and deletes its build-inputs records (actions: write).
		expect(header(teardown)).toMatch(/\n {8}permissions:\n {12}actions: write\n {12}contents: read\n {12}pull-requests: read\n {8}concurrency:/);
		expect(teardown).toMatch(/group: deploy-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true/);
	});
});

describe("preview-cleanup.yml (issue #42)", () =>
{
	it("issue #42: runs weekly and by hand, reading pull requests and tearing down only closed ones' previews", () =>
	{
		expect(CLEANUP_YML).toMatch(/\n {4}schedule:\n {8}- cron: "[^"]+"/);
		expect(CLEANUP_YML).toMatch(/\n {4}workflow_dispatch:/);
		expect(CLEANUP_YML).toMatch(/pull-requests: read/);
		expect(CLEANUP_YML).not.toMatch(/pull-requests: write|contents: write/);
		expect(CLEANUP_YML).toMatch(/run: pnpm run deploy:cleanup-previews\n/);
		for (const name of [...API_ENV, "GH_TOKEN: ${{ github.token }}"]) expect(CLEANUP_YML).toContain(name);
	});
});

describe("scripts/preview-pr-open.sh (issue #42)", () =>
{
	let dir = "";
	afterEach(() =>
	{
		if (dir) rmSync(dir, {
			recursive: true,
			force: true,
		});
		dir = "";
	});

	/** Runs the script with a stand-in `gh` that prints `state` (or fails when `state` is undefined). */
	function run(pr: string, state: string | undefined): { status: number;
		output: string;
		args: string; }
	{
		dir = mkdtempSync(join(tmpdir(), "preview-pr-open-"));
		const gh = join(dir, "gh");
		writeFileSync(gh, state === undefined
			? `#!/usr/bin/env bash\necho "$@" > "${dir}/args"\necho "HTTP 502" >&2\nexit 1\n`
			: `#!/usr/bin/env bash\necho "$@" > "${dir}/args"\necho "${state}"\n`);
		chmodSync(gh, 0o755);
		const output = join(dir, "output");
		writeFileSync(output, "");
		let status = 0;
		try
		{
			execFileSync("bash", [OPEN_SCRIPT, pr], {
				env: {
					...process.env,
					PATH: `${dir}:${process.env.PATH}`,
					GITHUB_OUTPUT: output,
					GITHUB_REPOSITORY: "owner/repo",
				},
				stdio: "pipe",
			});
		}
		catch (error)
		{
			status = (error as { status: number }).status;
		}
		let args = "";
		try
		{
			args = readFileSync(join(dir, "args"), "utf8").trim();
		}
		catch
		{
			// gh was never called
		}
		return {
			status,
			output: readFileSync(output, "utf8"),
			args,
		};
	}

	it("issue #42: says open=true for an open pull request and open=false for a closed one, asking GitHub for that pull request", () =>
	{
		const open = run("42", "open");
		expect(open).toEqual({
			status: 0,
			output: "open=true\n",
			args: "api repos/owner/repo/pulls/42 --jq .state",
		});
		expect(run("42", "closed")).toMatchObject({
			status: 0,
			output: "open=false\n",
		});
	});

	it("issue #42: fails rather than guessing when GitHub can't be read, answers something unexpected, or the number is bad", () =>
	{
		expect(run("42", undefined)).toMatchObject({
			status: 1,
			output: "",
		});
		expect(run("42", "merged?")).toMatchObject({
			status: 1,
			output: "",
		});
		for (const bad of ["", "0", "07", "abc", "4 2"])
		{
			expect(run(bad, "open")).toMatchObject({
				status: 2,
				output: "",
				args: "",
			});
		}
	});
});

describe("deploy.yml migrate steps (issue #48)", () =>
{
	const migrateStep = (name: string) => steps(DEPLOY_YML && job(DEPLOY_YML, name)).find((step) => /\brun: pnpm db:migrate\n/.test(`${step}\n`)) ?? "";

	it("issue #48: production's and previews' migrate steps let a database ahead of the code through; staging stays strict", () =>
	{
		// Production: re-running an older release's Deploy run is the rollback. A preview: its database is reset from
		// staging, which is ahead of a pull request built before `stage` gained a newer migration (a re-run, or no push since).
		for (const name of ["production", "preview"]) expect(migrateStep(name), name).toMatch(new RegExp(`\\n {14}env:\\n {18}${MAY_BE_AHEAD_ENV}: "1"\\n`));
		expect(migrateStep("staging")).toMatch(/run: pnpm db:migrate/);
		expect(migrateStep("staging")).not.toContain(MAY_BE_AHEAD_ENV);
		// Set nowhere else (no workflow- or job-level env), so staging can't become permissive with these pins green.
		const settings = DEPLOY_YML.split("\n").filter((line) => !/^\s*#/.test(line) && line.includes(MAY_BE_AHEAD_ENV));
		expect(settings).toHaveLength(2);
	});
});

describe("deploy.yml edge purge secrets (issue #543)", () =>
{
	const PURGE = ["BT_CF_PURGE_TOKEN", "BT_CF_ZONE_ID"];

	it("staging and production map the edge purge's GitHub secrets for their Workers; previews and other jobs never do (#543)", () =>
	{
		// The Worker purges a corrected past day's edge copy only with both (S212 AC 4); a preview lives on workers.dev, off the zone.
		for (const name of ["staging", "production"])
		{
			for (const secret of PURGE) expect(`${header(job(DEPLOY_YML, name))}\n`, `${name} ${secret}`).toContain(`\n            ${secret}: \${{ secrets.${secret} }}\n`);
		}
		for (const name of ["preview", "preview-teardown", "production-logto"])
		{
			for (const secret of PURGE) expect(job(DEPLOY_YML, name), `${name} ${secret}`).not.toContain(secret);
		}
		// Mapped only in those two job envs, never workflow-wide or in a step anyone could echo from.
		const settings = DEPLOY_YML.split("\n").filter((line) => !/^\s*#/.test(line) && PURGE.some((secret) => line.includes(secret)));
		expect(settings).toHaveLength(4);
	});
});

/** A job's `permissions:` block as `scope: level` lines, or [] when it has none. */
function permissions(jobText: string): string[]
{
	const m = /\n {8}permissions:\n((?: {12}[\w-]+: \w+\n)+)/.exec(header(jobText));
	return m ? m[1]!.trim().split(/\n\s*/) : [];
}

/** The index of the one step matching `pattern` (failing the test when none or several do). */
function stepIndex(list: string[], pattern: RegExp): number
{
	const hits = list.flatMap((step, at) => (pattern.test(step) ? [at] : []));
	expect(hits, String(pattern)).toHaveLength(1);
	return hits[0]!;
}

/** Steps that install, build, migrate, record, deploy or store the record: every one S146 skips on `unchanged`. */
const SKIPPED = [/name: Install\n/, /name: Build the web app\n/, /name: Bootstrap/, /run: pnpm db:migrate\n/, /run: pnpm db:reapply-deletions\n/, /name: Record the build's inputs/,
	/wrangler deploy --config "\$\{\{ steps\.bootstrap/, /actions\/upload-artifact@v4/];

describe("deploy.yml build inputs (S146 AC 3)", () =>
{
	const staging = DEPLOY_YML && job(DEPLOY_YML, "staging");
	const preview = DEPLOY_YML && job(DEPLOY_YML, "preview");
	const teardown = DEPLOY_YML && job(DEPLOY_YML, "preview-teardown");
	const production = DEPLOY_YML && job(DEPLOY_YML, "production");

	it("S146 AC 3: staging fetches its last record before installing, skips everything on unchanged, and stores a record only after deploying", () =>
	{
		const list = steps(staging);
		// Its own permissions keep build-release.sh merged's scopes and add the artifact read.
		expect(permissions(staging)).toEqual(["actions: read", "contents: read", "issues: read", "pull-requests: read"]);
		const served = stepIndex(list, /id: served\n/);
		const fetch = stepIndex(list, /name: Fetch the record of staging's last successful deploy \(build:inputs\)/);
		const check = stepIndex(list, /id: inputs\n/);
		const install = stepIndex(list, /name: Install\n/);
		expect(served).toBeLessThan(fetch);
		expect(fetch).toBeLessThan(check);
		expect(check).toBeLessThan(install);
		expect(list[fetch]).toMatch(/actions\/artifacts\?name=build-inputs-staging&/);
		expect(list[fetch]).toMatch(/select\(\.expired \| not\)/);
		// The check runs with plain node (setup-node, no pnpm), trusts only a record of the served commit, and is the only way to build=false.
		expect(list.slice(0, check).some((step) => /actions\/setup-node@v4/.test(step) && !/cache: pnpm/.test(step))).toBe(true);
		expect(list.slice(0, check).some((step) => /uses: pnpm\/action-setup|run: pnpm install/.test(step))).toBe(false);
		expect(list[check]).toMatch(/node functions\/src\/deploy\/build-inputs\.ts check "\$record" --served "\$SERVED"\)"; then\n[^\n]*\n\s+build=false\n/);
		expect(list[check]).toMatch(/BT_RELEASE: \$\{\{ steps\.release\.outputs\.release \}\}/);
		expect(list[check]!.match(/build=false/g)).toHaveLength(1);
		expect(list[served]).toMatch(/echo "served=\$served_sha" >>"\$GITHUB_OUTPUT"/);
		// The served-commit check still decides first: an older run never deploys over a newer one.
		expect(list[served]).toMatch(/git merge-base --is-ancestor "\$\{\{ github\.sha \}\}" "\$served"/);
		for (const pattern of SKIPPED) expect(list[stepIndex(list, pattern)], String(pattern)).toMatch(/\n {14}if: steps\.inputs\.outputs\.build == 'true'\n/);
		const deploy = stepIndex(list, /wrangler deploy --config "\$\{\{ steps\.bootstrap/);
		const store = stepIndex(list, /actions\/upload-artifact@v4/);
		expect(store).toBe(list.length - 1);
		expect(store).toBeGreaterThan(deploy);
		expect(list[store]).toMatch(/name: build-inputs-staging\n/);
		expect(list[store]).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)|continue-on-error/);
		const record = list[stepIndex(list, /name: Record the build's inputs/)]!;
		expect(record).toMatch(/--dry-run --outdir "\$RUNNER_TEMP\/worker-dry-run" --metafile "\$RUNNER_TEMP\/worker-meta\.json"/);
		expect(record).toMatch(/pnpm build:inputs record "\$RUNNER_TEMP\/build-inputs\/build-inputs\.json" --worker-meta "\$RUNNER_TEMP\/worker-meta\.json"/);
		expect(record).toMatch(/--commit "\$\{\{ github\.sha \}\}"/);
		expect(staging).not.toMatch(/\|\| true/);
		expectTokenOnlyOnGhSteps(list, staging);
	});

	it("S146 AC 3: preview fetches its pull request's record before installing, skips on unchanged, still comments, and records the head commit", () =>
	{
		const list = steps(preview);
		expect(permissions(preview)).toEqual(["actions: read", "contents: read", "issues: read", "pull-requests: write"]);
		const fetch = stepIndex(list, /name: Fetch the record of this preview's last successful deploy \(build:inputs\)/);
		const check = stepIndex(list, /id: inputs\n/);
		const install = stepIndex(list, /name: Install\n/);
		expect(fetch).toBeLessThan(check);
		expect(check).toBeLessThan(install);
		expect(list[fetch]).toMatch(/name="build-inputs-preview-\$\{\{ github\.event\.pull_request\.number \}\}"/);
		// A reopened pull request always deploys: its Worker and record were deleted when it closed.
		expect(list[fetch]).toMatch(/if: steps\.open\.outputs\.open == 'true' && github\.event\.action != 'reopened'\n/);
		expect(list[check]).toMatch(/REOPENED: \$\{\{ github\.event\.action == 'reopened' \}\}/);
		expect(list[check]).toMatch(/if \[ "\$REOPENED" = true \]; then\n[^\n]*\n\s+build=true\n/);
		expect(list[check]).toMatch(/node functions\/src\/deploy\/build-inputs\.ts check "\$record"\)"; then/);
		// Setup and install also run to tear down a closed pull request's preview.
		expect(list[install]).toMatch(/if: steps\.open\.outputs\.open == 'false' \|\| steps\.inputs\.outputs\.build == 'true'\n/);
		for (const pattern of SKIPPED.slice(1)) expect(list[stepIndex(list, pattern)], String(pattern)).toMatch(/steps\.inputs\.outputs\.build == 'true'\n/);
		const deploy = stepIndex(list, /wrangler deploy --config "\$\{\{ steps\.bootstrap/);
		const store = stepIndex(list, /actions\/upload-artifact@v4/);
		expect(store).toBe(deploy + 1);
		expect(list[store]).toMatch(/name: build-inputs-preview-\$\{\{ github\.event\.pull_request\.number \}\}\n/);
		expect(list[store]).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)|continue-on-error/);
		// The record names the pull request's head commit, never GITHUB_SHA (GitHub's test merge).
		const record = list[stepIndex(list, /name: Record the build's inputs/)]!;
		expect(record).toMatch(/--metafile "\$RUNNER_TEMP\/worker-meta\.json"\n/);
		expect(record).toMatch(/--commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/);
		expect(preview.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n")).not.toMatch(/github\.sha|GITHUB_SHA/);
		// A skipped preview still posts its comment, naming the recorded commit that still serves it.
		const comment = list.at(-1)!;
		expect(comment).toMatch(/if: steps\.still_open\.outputs\.open == 'true'\n/);
		expect(comment).toMatch(/RECORDED: \$\{\{ steps\.inputs\.outputs\.recorded \}\}/);
		expect(comment).toMatch(/so the preview from \$RECORDED still serves this one, at \$ORIGIN/);
		expect(comment).toMatch(/ORIGIN: \$\{\{ steps\.bootstrap\.outputs\.origin \|\| steps\.inputs\.outputs\.origin \}\}/);
		expect(list[check]).toMatch(/echo "recorded=\$\(node functions\/src\/deploy\/build-inputs\.ts get "\$record" commit\)"/);
	});

	it("S146 AC 3: preview-teardown deletes the pull request's records before its Worker, failing the job if it can't", () =>
	{
		const list = steps(teardown);
		expect(permissions(teardown)).toEqual(["actions: write", "contents: read", "pull-requests: read"]);
		const remove = stepIndex(list, /name: Delete the preview's build-inputs records/);
		expect(remove).toBeLessThan(stepIndex(list, /deploy:teardown/));
		expect(list[remove]).toMatch(/set -euo pipefail\n/);
		expect(list[remove]).toMatch(/actions\/artifacts\?name=build-inputs-preview-\$\{\{ github\.event\.pull_request\.number \}\}&per_page=100" --paginate/);
		expect(list[remove]).toMatch(/gh api -X DELETE "repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$id"/);
		expect(list[remove]).not.toMatch(/\|\| true|continue-on-error/);
	});

	it("S146 AC 3: force: a manual run of Deploy on stage deploys staging whatever the record says, with verify, never over a newer commit", () =>
	{
		expect(DEPLOY_YML).toMatch(/\n {4}workflow_dispatch:\n {8}inputs:\n {12}force:\n(?: {16}.*\n)* {16}type: boolean\n/);
		// The changes job answers code=true for it (as for a release), so verify runs and staging isn't stopped by code=false.
		expect(job(DEPLOY_YML, "changes")).toMatch(/elif \[ "\$\{\{ github\.event_name \}\}" = workflow_dispatch \]; then\n(?:\s+#.*\n)?\s+echo "code=true" >> "\$GITHUB_OUTPUT"/);
		expect(header(staging)).toMatch(/\(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) && github\.ref == 'refs\/heads\/stage'/);
		const list = steps(staging);
		const force = "FORCE: ${{ github.event_name == 'workflow_dispatch' && inputs.force }}";
		const check = list[stepIndex(list, /id: inputs\n/)]!;
		expect(check).toContain(force);
		expect(check).toMatch(/if \[ "\$FORCE" = true \]; then\n[^\n]*\n\s+build=true\n/);
		// The served check lets a forced run redeploy only the commit staging already serves, never an older one.
		const served = list[stepIndex(list, /id: served\n/)]!;
		expect(served).toContain(force);
		expect(served).toMatch(/if \[ "\$FORCE" = true \] && \[ "\$served" = "\$\{\{ github\.sha \}\}" \]; then/);
	});

	it("S146 AC 3: production always deploys: no input check, record or skip", () =>
	{
		expect(production).not.toMatch(/build-inputs|build:inputs|upload-artifact|steps\.inputs/);
		const list = steps(production);
		for (const pattern of [/name: Install\n/, /name: Build the web app\n/, /run: pnpm db:migrate\n/, /name: Deploy production\n/])
		{
			expect(list[stepIndex(list, pattern)], String(pattern)).not.toMatch(/\n {14}if:/);
		}
	});
});
