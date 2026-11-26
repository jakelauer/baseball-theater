/**
 * A worktree's ports (S156 AC 1): `.env.worktree` moves each checkout's ports, and a variable that is
 * set but empty counts as unset, so it falls back to today's port rather than to port 0 (a random port
 * for a listener) or a URL with no port. Each config is imported fresh with the variable stubbed, as the
 * tools that read it do at start-up. The last block checks that a server command run inside a workspace unit
 * (Lighthouse's, from e2e) finds the root script it names, as a port-moving script is only useful if it starts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach, describe, expect, it, vi,
} from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Import `path` (repository-relative) afresh with `env` set. */
async function fresh<T>(path: string, env: Record<string, string>): Promise<T>
{
	for (const [k, v] of Object.entries(env))
	{
		vi.stubEnv(k, v);
	}
	vi.resetModules();
	return await import(join(ROOT, path)) as T;
}

afterEach(() =>
{
	vi.unstubAllEnvs();
});

interface ViteConfig { server: { port: number;
	proxy: Record<string, { target: string }> } }
interface PlaywrightConfig { use: { baseURL: string } }

describe("port variables: empty means today's default", () =>
{
	it("the workerd tests' PGlite port", async () =>
	{
		const port = async (v: string) => (await fresh<{ PGLITE_PORT: number }>("functions/src/test/pglite-server.ts", {
			PGLITE_PORT: v,
		})).PGLITE_PORT;
		expect(await port("")).toBe(54329);
		expect(await port("26001")).toBe(26001);
	});

	it("Vite's dev port and the API it proxies to", async () =>
	{
		const config = async (web: string, api: string) => (await fresh<{ default: ViteConfig }>("web/vite.config.ts", {
			BT_WEB_PORT: web,
			BT_API_PORT: api,
		})).default.server;
		const empty = await config("", "");
		expect(empty.port).toBe(5173);
		expect(empty.proxy["/api"]?.target).toBe("http://localhost:8787");
		const set = await config("19001", "18001");
		expect(set.port).toBe(19001);
		expect(set.proxy["/api"]?.target).toBe("http://localhost:18001");
	});

	it("Playwright's base URL", async () =>
	{
		const url = async (v: string) => (await fresh<{ default: PlaywrightConfig }>("e2e/playwright.config.ts", {
			BT_WEB_PORT: v,
		})).default.use.baseURL;
		expect(await url("")).toBe("http://localhost:5173");
		expect(await url("19001")).toBe("http://localhost:19001");
	});

	it("no root script waits on a fixed API port: lighthouse:serve waits where the API listens", () =>
	{
		const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
		const fixed = Object.entries(scripts).filter(([, cmd]) => /wait-for-port\.ts 8787\b/.test(cmd)).map(([name]) => name);
		expect(fixed).toEqual([]);
		expect(scripts["lighthouse:serve"]).toContain("wait-for-port.ts ${BT_API_PORT:-8787}");
	});
});

/** pnpm's own commands, which a `pnpm <word>` line runs instead of a script. */
const PNPM_BUILTINS = new Set(["exec", "dlx", "install", "add", "run", "--filter", "-F", "-r", "--recursive", "-C", "--dir"]);

/**
 * The package a `pnpm <script>` call in `cmd` reads its scripts from, run in `cwd` (repository-relative),
 * paired with the script's name. pnpm looks only at the nearest workspace unit's package.json, so a call
 * made inside a unit (e2e is one since S168) misses a root script unless it says `-w`.
 */
function pnpmScriptCalls(cmd: string, cwd: string): { pkg: string;
	name: string; }[]
{
	const calls: { pkg: string;
		name: string; }[] = [];
	for (const m of cmd.matchAll(/\bpnpm((?:\s+[^\s&|;"]+)+)/g))
	{
		const words = (m[1] ?? "").trim().split(/\s+/);
		const root = words[0] === "-w" || words[0] === "--workspace-root";
		const rest = root ? words.slice(1) : words;
		const name = rest[0] === "run" ? rest[1] : rest[0];
		if (name === undefined || (rest[0] !== "run" && PNPM_BUILTINS.has(name)))
		{
			continue;
		}
		calls.push({
			pkg: root ? "package.json" : join(cwd, "package.json"),
			name,
		});
	}
	return calls;
}

describe("a pnpm script called from inside a workspace unit resolves", () =>
{
	const rootScripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
	const scriptsOf = (pkg: string): Record<string, string> =>
		(JSON.parse(readFileSync(join(ROOT, pkg), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};

	it("lighthouse's server command, run where the lighthouse script cds to, names a script that package defines", () =>
	{
		const lighthouse = rootScripts.lighthouse ?? "";
		const cwd = /^cd (\S+) &&/.exec(lighthouse)?.[1] ?? ".";
		const config = /--config=(\S+)/.exec(lighthouse)?.[1] ?? "";
		const rc = JSON.parse(readFileSync(join(ROOT, cwd, config), "utf8")) as { ci: { collect: { startServerCommand: string } } };
		const calls = pnpmScriptCalls(rc.ci.collect.startServerCommand, cwd);
		expect(calls.length).toBeGreaterThan(0);
		for (const { pkg, name } of calls)
		{
			expect(Object.keys(scriptsOf(pkg)), `${name} from ${pkg}`).toContain(name);
		}
	});

	it("every root script that cds into a directory calls only scripts that resolve there", () =>
	{
		for (const cmd of Object.values(rootScripts))
		{
			const cwd = /^cd (\S+) &&/.exec(cmd)?.[1];
			if (cwd === undefined)
			{
				continue;
			}
			for (const { pkg, name } of pnpmScriptCalls(cmd.slice(cmd.indexOf("&&") + 2), cwd))
			{
				expect(Object.keys(scriptsOf(pkg)), `${name} from ${pkg}`).toContain(name);
			}
		}
	});
});
