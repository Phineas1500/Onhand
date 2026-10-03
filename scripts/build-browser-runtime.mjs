import * as esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const typeboxCompileShim = new URL("../packages/browser-extension/src/typebox-compile-shim.ts", import.meta.url).pathname;
const asyncHooksBrowserShim = new URL("../packages/browser-extension/src/observability/async-hooks-browser-shim.ts", import.meta.url).pathname;
const nodeOsBrowserShim = new URL("../packages/browser-extension/src/observability/node-os-browser-shim.ts", import.meta.url).pathname;
const developmentAgentObserverDisabledShim = new URL(
	"../packages/browser-extension/src/observability/development-agent-observer-disabled-shim.ts",
	import.meta.url,
).pathname;
// The release packager rebuilds into a staged copy; everything else writes the
// tracked bundle.
const outfile = process.env.ONHAND_RUNTIME_OUTFILE || "packages/browser-extension/onhand-runtime.bundle.js";

function resolveLocalRaindropWorkshopUrl(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const parsed = new URL(raw);
	const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
	if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) {
		throw new Error("ONHAND_RAINDROP_WORKSHOP_URL must use HTTP on a loopback host.");
	}
	parsed.username = "";
	parsed.password = "";
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`;
}

const localRaindropWorkshopUrl = resolveLocalRaindropWorkshopUrl(process.env.ONHAND_RAINDROP_WORKSHOP_URL);

// Only the release packager (scripts/package-chrome-extension.mjs) sets this, so
// the tracked bundle never carries the hosted Worker URL. Ordinary builds leave
// Onhand Free unconfigured unless a profile sets onhandFreeTierBaseUrl.
function resolveFreeTierBaseUrl(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const parsed = new URL(raw);
	if (parsed.protocol !== "https:") throw new Error("ONHAND_BUILD_FREE_TIER_BASE_URL must use HTTPS.");
	return parsed.toString().replace(/\/+$/, "");
}

const freeTierBaseUrl = resolveFreeTierBaseUrl(process.env.ONHAND_BUILD_FREE_TIER_BASE_URL);
const isRaindropPiAgentImporter = (importer) => importer.replaceAll("\\", "/").includes("/node_modules/@raindrop-ai/pi-agent/");

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
		__ONHAND_RAINDROP_WORKSHOP_URL__: JSON.stringify(localRaindropWorkshopUrl),
		__ONHAND_FREE_TIER_BASE_URL__: JSON.stringify(freeTierBaseUrl),
	},
	plugins: [
		{
			name: "local-raindrop-pilot-boundary",
			setup(build) {
				build.onResolve({ filter: /^\.\/observability\/development-agent-observer$/ }, () =>
					localRaindropWorkshopUrl ? undefined : { path: developmentAgentObserverDisabledShim },
				);
				build.onResolve({ filter: /^(?:node:)?os$/ }, (args) =>
					isRaindropPiAgentImporter(args.importer) ? { path: nodeOsBrowserShim } : undefined,
				);
			},
		},
		{
			name: "browser-safe-async-hooks",
			setup(build) {
				build.onResolve({ filter: /^(?:node:)?async_hooks$/ }, (args) =>
					isRaindropPiAgentImporter(args.importer) ? { path: asyncHooksBrowserShim } : undefined,
				);
			},
		},
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
