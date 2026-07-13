import * as esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const outfile = "packages/browser-extension/pdf-corpus-search.bundle.js";

await esbuild.build({
	entryPoints: ["packages/browser-extension/src/pdf-corpus-search.ts"],
	outfile,
	bundle: true,
	format: "esm",
	platform: "browser",
	target: ["chrome116"],
	sourcemap: false,
	legalComments: "none",
	mainFields: ["browser", "module", "main"],
	logLevel: "info",
});

const bundle = await readFile(outfile, "utf8");
await writeFile(outfile, bundle.replace(/[ \t]+$/gm, ""), "utf8");
