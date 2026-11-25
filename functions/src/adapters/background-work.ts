/**
 * The `BackgroundWork` adapters (S216 AC 3): where an on-read refresh's deferred writes run once its answer is out.
 *
 * - The Worker's, {@link ScopedBackgroundWork}: each request's `fetch` opens a {@link DeferredWorkQueue} around its
 *   handler (`withDeferredWork`), and `inDatabaseScope` drains it after the handler returns, inside the request's
 *   database scope, closing the connection only once the queue has settled, all through `ctx.waitUntil`. So the
 *   response isn't held for the writes, and the writes still have their connection.
 * - The Node server's, {@link NodeBackgroundWork}: runs the work at once beside the response and logs a failure.
 * - The tests', {@link RecordedBackgroundWork}: records the work until a test flushes it.
 *
 * Every one runs each piece of work through {@link settleWork}, so a failure is logged and never reaches the request.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BackgroundWork } from "@bt/ports";

/** One piece of deferred work and the label a failure of it is logged under. */
type Deferred = {
	label: string;
	work: () => Promise<unknown>;
};

/** Runs `work`, logging a failure under `label`; never rejects (the request it came from has already answered). */
export async function settleWork(label: string, work: () => Promise<unknown>): Promise<void>
{
	try
	{
		await work();
	}
	catch (error)
	{
		console.error(`[background] ${label} failed`, error);
	}
}

/** One request's deferred work, run one piece after another (they share the request's one connection) by {@link drain}. */
export class DeferredWorkQueue
{
	private readonly queue: Deferred[] = [];

	push(label: string, work: () => Promise<unknown>): void
	{
		this.queue.push({
			label,
			work,
		});
	}

	/** Runs every queued piece in order, any queued while it runs included; never rejects. */
	async drain(): Promise<void>
	{
		for (let next = this.queue.shift(); next; next = this.queue.shift()) await settleWork(next.label, next.work);
	}
}

const current = new AsyncLocalStorage<DeferredWorkQueue>();

/** Runs `work` with `queue` as the queue {@link ScopedBackgroundWork} defers into (the Worker's `fetch`, per request). */
export function withDeferredWork<T>(queue: DeferredWorkQueue, work: () => Promise<T>): Promise<T>
{
	return current.run(queue, work);
}

/**
 * The Worker's adapter (S216 AC 3): defers into the current request's queue, which `inDatabaseScope` drains after the
 * response and before it closes the connection, through `ctx.waitUntil`. Outside a request (no queue) it runs the work
 * at once, as the Node adapter does, rather than drop it.
 */
export class ScopedBackgroundWork implements BackgroundWork
{
	defer(label: string, work: () => Promise<unknown>): void
	{
		const queue = current.getStore();
		if (queue) queue.push(label, work);
		else void settleWork(label, work);
	}
}

/** The Node server's adapter (S216 AC 3): runs the work at once, beside the response, and logs a failure. */
export class NodeBackgroundWork implements BackgroundWork
{
	defer(label: string, work: () => Promise<unknown>): void
	{
		void settleWork(label, work);
	}
}

/** The test double (S216 AC 3): records each piece of work, unrun, until the test calls {@link flush}. */
export class RecordedBackgroundWork implements BackgroundWork
{
	readonly pending: Deferred[] = [];

	defer(label: string, work: () => Promise<unknown>): void
	{
		this.pending.push({
			label,
			work,
		});
	}

	/** Runs every recorded piece in order (any recorded meanwhile too), each failure logged as the adapters log it. */
	async flush(): Promise<void>
	{
		for (let next = this.pending.shift(); next; next = this.pending.shift()) await settleWork(next.label, next.work);
	}
}
