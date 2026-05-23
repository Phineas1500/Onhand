import * as esbuild from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const outfile = "packages/browser-extension/pdf-viewer.bundle.js";
const vendorDir = "packages/browser-extension/vendor";

await esbuild.build({
	entryPoints: ["packages/browser-extension/src/pdf-viewer.ts"],
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

await mkdir(vendorDir, { recursive: true });
await cp("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", `${vendorDir}/pdf.worker.mjs`);
await cp("node_modules/pdfjs-dist/cmaps", `${vendorDir}/cmaps`, { recursive: true });
await cp("node_modules/pdfjs-dist/standard_fonts", `${vendorDir}/standard_fonts`, { recursive: true });

const bundle = await readFile(outfile, "utf8");
await writeFile(outfile, bundle.replace(/[ \t]+$/gm, ""), "utf8");
