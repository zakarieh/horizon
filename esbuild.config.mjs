import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const banner = `/*
Horizon Task - bundled by esbuild.
This file is generated; edit the sources in src/ instead.
*/`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	// `obsidian` and Electron are injected by the host app at runtime, and Node
	// builtins must never be bundled: plugins are loaded into a mobile-capable
	// renderer.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2018",
	jsx: "automatic",
	// React and dnd-kit are React libraries, so the JSX runtime is bundled in.
	// `process.env.NODE_ENV` must be replaced at build time: on mobile there is
	// no Node `process` object, and leaving the reference in would throw.
	define: {
		"process.env.NODE_ENV": prod ? '"production"' : '"development"',
	},
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	await context.dispose();
	process.exit(0);
} else {
	await context.watch();
}
