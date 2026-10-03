#!/usr/bin/env node
// Packages the Chrome Web Store zip with Onhand Free configured.
//
// Tracked source and the tracked runtime bundle never carry the hosted
// free-tier Worker URL (see docs/FREE_TIER.md). This script stages a copy of
// packages/browser-extension, rebuilds only the staged runtime bundle with the
// URL from ONHAND_FREE_TIER_BASE_URL (environment or the ignored repo .env),
// and zips the staged copy into dist/. The working tree is left URL-free.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXTENSION_DIR = join(ROOT, "packages/browser-extension");
const TRACKED_BUNDLE = join(EXTENSION_DIR, "onhand-runtime.bundle.js");

function parseArgs(argv) {
	const args = { force: false, outDir: join(ROOT, "dist"), skipBuild: false };
	for (const value of argv) {
		if (value === "--force") args.force = true;
		else if (value === "--skip-build") args.skipBuild = true;
		else if (value.startsWith("--out-dir=")) args.outDir = value.slice("--out-dir=".length);
		else if (value === "-h" || value === "--help") {
			console.log(`Usage: npm run package:chrome -- [--force] [--out-dir=<dir>] [--skip-build]

Builds dist/onhand-v<version>-chrome.zip with Onhand Free pointed at
ONHAND_FREE_TIER_BASE_URL (read from the environment, then the repo .env).

  --force          Overwrite an existing zip for this version.
  --out-dir=<dir>  Output directory. Default: dist
  --skip-build     Package the current build without running build:extension first.`);
			process.exit(0);
		} else throw new Error(`Unknown option: ${value}`);
	}
	return args;
}

function parseEnvValue(source, key) {
	for (const line of String(source || "").split(/\r?\n/)) {
		const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (!match || match[1] !== key) continue;
		const value = match[2];
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
		return value.replace(/\s+#.*$/, "").trim();
	}
	return "";
}

async function resolveFreeTierBaseUrl() {
	let value = String(process.env.ONHAND_FREE_TIER_BASE_URL || "").trim();
	if (!value && existsSync(join(ROOT, ".env"))) value = parseEnvValue(await readFile(join(ROOT, ".env"), "utf8"), "ONHAND_FREE_TIER_BASE_URL");
	if (!value) throw new Error("Set ONHAND_FREE_TIER_BASE_URL (environment or repo .env) to the deployed free-tier Worker /v1 URL before packaging.");
	const parsed = new URL(value);
	if (parsed.protocol !== "https:") throw new Error("ONHAND_FREE_TIER_BASE_URL must use HTTPS.");
	if (!/\/v1\/?$/.test(parsed.pathname)) throw new Error("ONHAND_FREE_TIER_BASE_URL must be the Worker's /v1 URL.");
	return parsed.toString().replace(/\/+$/, "");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, "manifest.json"), "utf8"));
	const zipPath = join(args.outDir, `onhand-v${manifest.version}-chrome.zip`);
	if (existsSync(zipPath) && !args.force) throw new Error(`${zipPath} already exists; bump the manifest version or pass --force.`);
	const freeTierBaseUrl = await resolveFreeTierBaseUrl();

	if (!args.skipBuild) execFileSync("npm", ["run", "build:extension"], { cwd: ROOT, stdio: "inherit" });
	if ((await readFile(TRACKED_BUNDLE, "utf8")).includes(freeTierBaseUrl)) {
		throw new Error("The tracked runtime bundle already contains the free-tier URL; rebuild it without ONHAND_BUILD_FREE_TIER_BASE_URL first.");
	}

	const staging = await mkdtemp(join(tmpdir(), "onhand-package-"));
	try {
		const stagedExtension = join(staging, "extension");
		await cp(EXTENSION_DIR, stagedExtension, { recursive: true, filter: (source) => !source.endsWith(".DS_Store") });
		const stagedBundle = join(stagedExtension, "onhand-runtime.bundle.js");
		execFileSync(process.execPath, [join(ROOT, "scripts/build-browser-runtime.mjs")], {
			cwd: ROOT,
			stdio: "inherit",
			env: { ...process.env, ONHAND_RUNTIME_OUTFILE: stagedBundle, ONHAND_BUILD_FREE_TIER_BASE_URL: freeTierBaseUrl },
		});
		if (!(await readFile(stagedBundle, "utf8")).includes(freeTierBaseUrl)) throw new Error("The staged runtime bundle is missing the free-tier URL.");
		execFileSync("mkdir", ["-p", args.outDir]);
		if (existsSync(zipPath)) await rm(zipPath);
		execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: stagedExtension, stdio: "inherit" });
		const { size } = await stat(zipPath);
		console.log(`Packaged ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MiB), Onhand Free -> ${new URL(freeTierBaseUrl).host}`);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	if ((await readFile(TRACKED_BUNDLE, "utf8")).includes(freeTierBaseUrl)) throw new Error("Packaging leaked the free-tier URL into the tracked bundle.");
}

main().catch((error) => {
	console.error(`package-chrome-extension: ${error.message}`);
	process.exitCode = 1;
});
