/**
 * Work a request finishes after its response (S216 AC 3). An on-read refresh answers from the data it formed and hands
 * the writes that carry no version of its answer (the projection, the edge purge, a late playMetrics write) to this
 * port, so the fan doesn't wait on them. Cloud-agnostic (ADR-012): the Worker's adapter hands the work to the request's
 * `ctx.waitUntil` inside its database scope, so the connection stays open until the work settles; the Node server's
 * runs it at once and logs a failure; the test double records it for a test to flush (`functions/src/adapters/background-work.ts`).
 */
export interface BackgroundWork
{
	/**
	 * Finishes `work` after the response. Never throws to the caller and never fails the request: a failure is logged
	 * under `label` (the work is already past its answer, so there is no one left to tell).
	 */
	defer(label: string, work: () => Promise<unknown>): void;
}
