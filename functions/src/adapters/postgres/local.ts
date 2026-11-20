/**
 * Where the local database is (S51, S122): the Node commands that write it (`pnpm db:seed`,
 * `pnpm mlb:backfill`) share this, so "local" means one thing. Import-safe — nothing runs on
 * import — and Node-only (it reads `wrangler.jsonc` from disk), so the Worker never imports it.
 */
import { readFileSync } from "node:fs";
import { parse } from "pg-connection-string";

/** Hosts that are the developer's own machine or compose.yaml's Postgres, never a hosted database. */
export const LOCAL_DB_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"];

/** Whether a connection string's host is local ({@link LOCAL_DB_HOSTS}). */
export function isLocalDbHost(host: string): boolean
{
	return LOCAL_DB_HOSTS.includes(host);
}

/**
 * The variable `wrangler dev` reads to override the HYPERDRIVE binding's local connection string
 * (its own name, `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<binding>`). A worktree's
 * `.env.worktree` (S156, `scripts/worktree-for.sh`) sets it to that checkout's Postgres port, so
 * the Worker and `pnpm db:seed` reach the same database and `wrangler.jsonc` stays unchanged.
 */
export const LOCAL_CONNECTION_STRING_ENV = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

/**
 * The local Hyperdrive connection string: the environment's override when set (as `wrangler dev`
 * takes it), else wrangler.jsonc's (comments stripped; the file is JSONC).
 */
export function localConnectionString(env: NodeJS.ProcessEnv = process.env): string
{
	const override = env[LOCAL_CONNECTION_STRING_ENV];
	if (override) return override;
	const text = readFileSync(new URL("../../../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
	const config = JSON.parse(text) as { hyperdrive?: { binding: string;
		localConnectionString?: string; }[]; };
	const local = config.hyperdrive?.find((h) => h.binding === "HYPERDRIVE")?.localConnectionString;
	if (!local) throw new Error("wrangler.jsonc has no HYPERDRIVE localConnectionString");
	return local;
}

/**
 * The database a connection string names, as the refusal check, logs and the backfill's resume
 * file name it: host and database only — never the user or password (S117, S122). Read with
 * `pg-connection-string`'s `parse`, the parser pg itself connects with, so it is the host pg
 * really reaches: a `?host=` query parameter overrides the URL's host there, and reading the
 * URL's host instead would let `postgres://…@localhost/db?host=<production>` pass as local.
 * The database falls back to the user name, as pg's does (before `PGDATABASE`). `hostaddr`
 * is returned when present: pg ignores it but libpq tools (`psql`, `pg_dump`) connect to it,
 * so the guard refuses such a string rather than judge it by one of two destinations. A
 * string with no host gives `""`, which is never local.
 */
export function databaseTarget(connectionString: string): { host: string;
	name: string;
	hostaddr?: string; }
{
	const parsed = parse(withoutSslParameters(connectionString));
	const hostaddr = (parsed as { hostaddr?: unknown }).hostaddr;
	return {
		host: parsed.host ?? "",
		name: parsed.database || parsed.user || "postgres",
		...typeof hostaddr === "string" && {
			hostaddr,
		},
	};
}

/**
 * The string without its `ssl*` parameters, which say how to connect, never where: `parse`
 * reads `sslcert`, `sslkey` and `sslrootcert` from disk (throwing for a path that isn't there)
 * and warns about `sslmode`, neither of which naming a database needs.
 */
function withoutSslParameters(connectionString: string): string
{
	const query = connectionString.indexOf("?");
	if (query < 0) return connectionString;
	const params = new URLSearchParams(connectionString.slice(query + 1));
	for (const key of [...params.keys()]) if (key.startsWith("ssl")) params.delete(key);
	const rest = params.toString();
	return `${connectionString.slice(0, query)}${rest ? `?${rest}` : ""}`;
}
