/**
 * `BT_DATABASE_URL=… pnpm db:migrate` (S113): applies the committed Drizzle migrations to the
 * database the connection string names, the production Neon branch included. Every deploy runs it
 * against its own database before the new Worker takes traffic (S114, `.github/workflows/deploy.yml`,
 * with BT_DATABASE_URL from `pnpm deploy:bootstrap`); agents never run it against a hosted database
 * (CLAUDE.md). There is no default: the connection string lives only in the caller's
 * environment and in Cloudflare's Hyperdrive config, never in the repo. Running it again
 * changes nothing. It exits 1, failing the deploy before the new Worker goes live, when the
 * database's applied migrations differ from the committed ones, before or after migrating (#48).
 * With `BT_MIGRATIONS_MAY_BE_AHEAD=1` (`MAY_BE_AHEAD_ENV`, set by the production and preview
 * deploys, never staging's) a database that has run newer migrations than the code passes with a
 * warning, so re-running an older release's deploy (the rollback) and a preview of a pull request
 * built before `stage` gained a newer migration (a re-run, or no push since) still work.
 */
import { mayBeAheadFrom, migrateDatabaseAt } from "../adapters/postgres/migrate.js";

const url = process.env.BT_DATABASE_URL;
if (!url)
{
	console.error("[db:migrate] set BT_DATABASE_URL to the database's connection string (Neon: the branch's connection string, with sslmode=require)");
	process.exit(2);
}
// The host only: the connection string carries a password.
const host = new URL(url).hostname;
console.log(`[db:migrate] applying migrations to ${host}…`);
try
{
	await migrateDatabaseAt(url, {
		mayBeAhead: mayBeAheadFrom(process.env),
		warn: (line) => console.warn(`[db:migrate] ${host}: warning: ${line}`),
	});
}
catch (error)
{
	console.error(`[db:migrate] ${host}: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
console.log(`[db:migrate] ${host}: up to date`);
