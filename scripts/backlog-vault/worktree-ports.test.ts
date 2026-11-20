/**
 * A worktree's ports (S156 AC 1): `.env.worktree` moves each checkout's ports, and a variable that is
 * set but empty counts as unset, so it falls back to today's port rather than to port 0 (a random port
 * for a listener) or a URL with no port. Each config is imported fresh with the variable stubbed, as the
 * tools that read it do at start-up.
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
