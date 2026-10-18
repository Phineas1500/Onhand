#!/usr/bin/env node
// Packages the Chrome Web Store zip (or, with --browser=firefox, the
// addons.mozilla.org zip) with Onhand Free configured.
//
// Tracked source and the tracked runtime bundle never carry the hosted
// free-tier Worker URL (see docs/FREE_TIER.md). This script stages a copy of
// packages/browser-extension, rebuilds only the staged runtime bundle with the
// URL from ONHAND_FREE_TIER_BASE_URL (environment or the ignored repo .env),
// and zips the staged copy into dist/. The working tree is left URL-free.
//
// The Firefox package also rewrites the staged manifest for Firefox (see
// toFirefoxManifest) and minifies the runtime bundle, since
// addons.mozilla.org won't parse JavaScript files over 5 MB.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXTENSION_DIR = join(ROOT, "packages/browser-extension");
const TRACKED_BUNDLE = join(EXTENSION_DIR, "onhand-runtime.bundle.js");

function parseArgs(argv) {
	const args = { browser: "chrome", force: false, outDir: join(ROOT, "dist"), skipBuild: false };
	for (const value of argv) {
		if (value === "--force") args.force = true;
		else if (value.startsWith("--browser=")) args.browser = value.slice("--browser=".length);
		else if (value === "--skip-build") args.skipBuild = true;
		else if (value.startsWith("--out-dir=")) args.outDir = value.slice("--out-dir=".length);
		else if (value === "-h" || value === "--help") {
			console.log(`Usage: npm run package:chrome -- [--force] [--out-dir=<dir>] [--skip-build]
       npm run package:firefox -- [--force] [--out-dir=<dir>] [--skip-build]

Builds dist/onhand-v<version>-<browser>.zip with Onhand Free pointed at
ONHAND_FREE_TIER_BASE_URL (read from the environment, then the repo .env).

  --browser=<name> chrome (default) or firefox.
  --force          Overwrite an existing zip for this version.
  --out-dir=<dir>  Output directory. Default: dist
  --skip-build     Package the current build without running build:extension first.`);
			process.exit(0);
		} else throw new Error(`Unknown option: ${value}`);
	}
	if (!["chrome", "firefox"].includes(args.browser)) throw new Error(`Unknown browser: ${args.browser}`);
	return args;
}

// Firefox's addons.mozilla.org caps extension names at 45 characters.
const FIREFOX_EXTENSION_NAME = "Onhand: Chat with PDFs, Answers Highlighted";
const FIREFOX_ADDON_ID = "onhand@useonhand.com";
// Permissions Firefox doesn't implement: the debugger paths fall back to
// scripting, the sidebar comes from sidebar_action, and the clipboard probe
// that used an offscreen document is skipped.
const FIREFOX_UNSUPPORTED_PERMISSIONS = new Set(["debugger", "sidePanel", "offscreen"]);

function toFirefoxManifest(manifest) {
	const firefox = structuredClone(manifest);
	firefox.name = FIREFOX_EXTENSION_NAME;
	firefox.background = { scripts: [manifest.background.service_worker], type: manifest.background.type };
	firefox.permissions = manifest.permissions.filter((permission) => !FIREFOX_UNSUPPORTED_PERMISSIONS.has(permission));
	// tabs.captureVisibleTab needs <all_urls> in Firefox. Firefox can't read
	// file:// URLs from an extension, so the file:///* pattern adds nothing.
	firefox.host_permissions = ["<all_urls>"];
	delete firefox.side_panel;
	delete firefox.minimum_chrome_version;
	if (firefox.commands?._execute_action) {
		firefox.commands = { _execute_sidebar_action: firefox.commands._execute_action };
	}
	firefox.browser_specific_settings = {
		gecko: {
			id: FIREFOX_ADDON_ID,
			strict_min_version: "140.0",
			// Page content, and the addresses and titles of the pages Onhand reads,
			// go to the chosen AI provider to answer. Anonymous diagnostics are the
			// technical data, which Mozilla only allows as optional, so the runtime
			// sends them only when Firefox reports consent. See the privacy policy.
			data_collection_permissions: { required: ["websiteContent", "browsingActivity"], optional: ["technicalAndInteraction"] },
		},
	};
	return firefox;
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
	const zipPath = join(args.outDir, `onhand-v${manifest.version}-${args.browser}.zip`);
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
			env: {
				...process.env,
				ONHAND_RUNTIME_OUTFILE: stagedBundle,
				ONHAND_BUILD_FREE_TIER_BASE_URL: freeTierBaseUrl,
				...(args.browser === "firefox" ? { ONHAND_RUNTIME_MINIFY: "1" } : {}),
			},
		});
		if (!(await readFile(stagedBundle, "utf8")).includes(freeTierBaseUrl)) throw new Error("The staged runtime bundle is missing the free-tier URL.");
		if (args.browser === "firefox") {
			await writeFile(join(stagedExtension, "manifest.json"), `${JSON.stringify(toFirefoxManifest(manifest), null, "\t")}\n`);
			const { size: bundleSize } = await stat(stagedBundle);
			if (bundleSize > 5 * 1024 * 1024) throw new Error(`The minified runtime bundle is ${(bundleSize / 1024 / 1024).toFixed(1)} MiB; addons.mozilla.org won't parse files over 5 MB.`);
		}
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
	console.error(`package-extension: ${error.message}`);
	process.exitCode = 1;
});
