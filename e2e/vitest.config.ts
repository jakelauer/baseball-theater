import { defineConfig } from "vitest/config";

// The spec selector's unit tests (S152), run by `pnpm test:selector`, part of `pnpm verify`. Only
// that one file: every `*.spec.ts` here starts a browser, which `pnpm verify` never does (law P8).
export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["select-specs.test.ts"],
	},
});
