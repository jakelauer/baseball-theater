/**
 * Runs before every test file (vitest.config.ts `setupFiles`). Many of these tests call git, bash and
 * the debt scripts synchronously (execFileSync / spawnSync) for a long stretch (review-debt.test.ts
 * alone takes about 45 s), which blocks the worker's event loop, so its progress messages to the main
 * process time out (`[vitest-worker]: Timeout calling "onTaskUpdate"`, seen in CI on #132 and on
 * stage's push of 6f149855). After each test the worker yields once to the event loop, so those
 * messages go out between tests. The count lets test-setup.test.ts prove the hook runs.
 */
import { afterEach } from "vitest";

const counter = globalThis as { __btEventLoopYields?: number };
counter.__btEventLoopYields = 0;

afterEach(async () =>
{
	await new Promise((resolve) => setImmediate(resolve));
	counter.__btEventLoopYields = (counter.__btEventLoopYields ?? 0) + 1;
});
