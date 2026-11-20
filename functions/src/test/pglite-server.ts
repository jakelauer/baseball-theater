/**
 * Global setup for the workerd tests (S51): the Worker's `HYPERDRIVE` binding needs a
 * Postgres to talk to, and CI has no Docker, so this serves a migrated PGlite over the
 * Postgres wire protocol on `PGLITE_PORT` (`@electric-sql/pglite-socket`) for the test run.
 * `vitest.workers.config.ts` points the binding there. PGlite is one connection underneath;
 * the server multiplexes the Worker's connections onto it.
 */
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { TestProject } from "vitest/node";
import { migratedPglite } from "../adapters/postgres/migrate.js";

declare module "vitest"
{
	interface ProvidedContext
	{
		/** The port the config chose ({@link PGLITE_PORT}), handed to {@link setup}. */
		pglitePort: number;
	}
}

/**
 * Where the workerd tests' Postgres listens. `PGLITE_PORT` from the environment (a worktree's
 * `.env.worktree`, S156) moves it, so two checkouts' `pnpm verify` can run at once; without it,
 * 54329. Read where `vitest.workers.config.ts` imports this, which sees the environment; the pool
 * runs this file's {@link setup} with an empty `process.env`, so the config passes the value on
 * (`provide.pglitePort`) and setup listens where the binding points.
 */
export const PGLITE_PORT = Number(process.env.PGLITE_PORT ?? 54329);

/**
 * The server drops its socket's error listener once a connection is done, so a Worker
 * connection reset after that (workerd ends sockets abruptly) would surface as an uncaught
 * ECONNRESET (or EPIPE, writing to it) and end the test run. Those are a client hanging up;
 * anything else still throws.
 */
function ignoreClientResets(error: NodeJS.ErrnoException): void
{
	if (error.code !== "ECONNRESET" && error.code !== "EPIPE") throw error;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>>
{
	const port = project.config.provide?.pglitePort ?? PGLITE_PORT;
	process.on("uncaughtException", ignoreClientResets);
	const { pglite } = await migratedPglite();
	const server = new PGLiteSocketServer({
		db: pglite,
		host: "127.0.0.1",
		port,
		maxConnections: 16,
	});
	await server.start();
	return async () =>
	{
		await server.stop();
		// The listener stays: stopping the server resets the sockets still open.
		await pglite.close();
	};
}
