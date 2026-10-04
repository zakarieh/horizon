import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/** Files the TypeScript rules (and the type-aware parser) apply to. */
const TS_FILES = ["**/*.{ts,cts,mts,tsx}"];

/**
 * ESLint 9+ flat config.
 *
 * `obsidianmd.configs.recommended` already layers in `@eslint/js` recommended,
 * the typescript-eslint recommended *type-checked* rules, and the
 * Obsidian-specific rules (no Node builtins, no detached leaves, command naming,
 * manifest validation, ...), so those presets must not be added again.
 *
 * The local overrides are scoped to the same globs as the preset's TypeScript
 * config, so the `@typescript-eslint` plugin stays registered for every file
 * those rules are applied to.
 */
export default defineConfig([
	{
		ignores: [
			"main.js",
			"node_modules/**",
			"coverage/**",
			"*.map",
			"versions.json",
		],
	},
	...obsidianmd.configs.recommended,
	{
		files: TS_FILES,
		languageOptions: {
			parserOptions: {
				// Type-aware rules need every linted file to belong to a project.
				projectService: {
					allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{ prefer: "type-imports", fixStyle: "inline-type-imports" },
			],
			"@typescript-eslint/explicit-function-return-type": [
				"error",
				{ allowExpressions: true, allowTypedFunctionExpressions: true },
			],
		},
	},
	{
		// Vitest callbacks are already fully typed by the framework, so the
		// "declare the return type" rule would only add noise here.
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/explicit-function-return-type": "off",
		},
	},
	{
		// Build and config scripts run on the developer's machine under Node and
		// are never bundled into `main.js`, so the mobile-safety rule that guards
		// plugin code does not apply to them.
		files: ["esbuild.config.mjs", "eslint.config.mjs"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
]);
