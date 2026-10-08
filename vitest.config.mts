import { defineConfig } from "vitest/config";

/**
 * The domain layer is pure TypeScript, so the tests need no DOM and no vault.
 * Keeping the environment at `node` makes the suite fast and deterministic.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		globals: false,
		restoreMocks: true,
		coverage: {
			provider: "v8",
			include: ["src/domain/**/*.ts"],
			exclude: ["src/domain/index.ts"],
			reporter: ["text", "html"],
		},
	},
});
