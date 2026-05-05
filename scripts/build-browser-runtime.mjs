import * as esbuild from "esbuild";

const typeboxCompileShim = new URL("../packages/browser-extension/src/typebox-compile-shim.ts", import.meta.url).pathname;

await esbuild.build({
	entryPoints: ["packages/browser-extension/src/browser-runtime.ts"],
	outfile: "packages/browser-extension/onhand-runtime.bundle.js",
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
