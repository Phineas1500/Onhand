import * as esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const typeboxCompileShim = new URL("../packages/browser-extension/src/typebox-compile-shim.ts", import.meta.url).pathname;
const outfile = "packages/browser-extension/onhand-runtime.bundle.js";

await esbuild.build({
	entryPoints: ["packages/browser-extension/src/browser-runtime.ts"],
	outfile,
	bundle: true,
	format: "esm",
	platform: "browser",
	target: ["chrome116"],
	sourcemap: false,
	legalComments: "none",
	mainFields: ["browser", "module", "main"],
	banner: {
		js: "var process = globalThis.process || { env: {}, versions: {} };",
	},
	define: {
		"process.env.NODE_ENV": "\"production\"",
	},
	plugins: [
		{
			name: "browser-safe-typebox-compile",
			setup(build) {
				build.onResolve({ filter: /^typebox\/compile$/ }, () => ({
					path: typeboxCompileShim,
				}));
			},
		},
	],
	logLevel: "info",
});

const bundle = await readFile(outfile, "utf8");
await writeFile(outfile, bundle.replace(/[ \t]+$/gm, ""), "utf8");
