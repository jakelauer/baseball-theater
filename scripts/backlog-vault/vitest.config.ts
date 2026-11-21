import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["*.test.ts"],
		// Each test yields to the event loop afterwards, so long synchronous git and script calls can't
		// starve the worker's progress messages (test-setup.ts).
		setupFiles: ["./test-setup.ts"],
	},
});
