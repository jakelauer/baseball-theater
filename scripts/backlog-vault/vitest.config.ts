import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["*.test.ts"],
		// Each test yields to the event loop afterwards, so long synchronous git and script calls can't
		// starve the worker's progress messages (test-setup.ts).
		setupFiles: ["./test-setup.ts"],
		// These tests run git, audit.sh and the debt scripts in temporary repositories; on a shared CI
		// runner one such test took 7.3 s, past Vitest's 5 s default (#298's CI).
		testTimeout: 30_000,
	},
});
