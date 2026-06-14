import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const typeboxCompileShim = path.join(rootDir, "packages/browser-extension/src/typebox-compile-shim.ts");
const shippedBundlePath = path.join(rootDir, "packages/browser-extension/onhand-runtime.bundle.js");
const manifestPath = path.join(rootDir, "packages/browser-extension/manifest.json");
const defaultOutDir = path.join(rootDir, "tmp/sentry-sourcemaps/browser-runtime");
const sentryCliPath = path.join(rootDir, "node_modules/.bin/sentry-cli");

function parseArgs(argv) {
	const options = {
		dryRun: false,
		wait: false,
		validate: true,
		outDir: process.env.SENTRY_SOURCEMAPS_OUT_DIR || defaultOutDir,
		org: process.env.SENTRY_ORG || "",
		project: process.env.SENTRY_PROJECT || "onhand-browser-extension",
		release: process.env.SENTRY_RELEASE || "",
		dist: process.env.SENTRY_DIST || "chrome",
		urlPrefix: process.env.SENTRY_URL_PREFIX || "app:///",
	};
	for (const arg of argv) {
		if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--wait") options.wait = true;
		else if (arg === "--no-validate") options.validate = false;
		else if (arg.startsWith("--out-dir=")) options.outDir = path.resolve(rootDir, arg.slice("--out-dir=".length));
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--release=")) options.release = arg.slice("--release=".length);
		else if (arg.startsWith("--dist=")) options.dist = arg.slice("--dist=".length);
		else if (arg.startsWith("--url-prefix=")) options.urlPrefix = arg.slice("--url-prefix=".length);
		else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function stripTrailingWhitespace(source) {
	return source.replace(/[ \t]+$/gm, "");
}

function stripSourceMapComment(source) {
	return source.replace(/\n?\/\/# sourceMappingURL=[^\n]+\.map\s*$/i, "");
}

function quoteShellArg(value) {
	if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

async function readManifestVersion() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!manifest.version) throw new Error("packages/browser-extension/manifest.json does not include version");
	return manifest.version;
}

async function buildSourceMapArtifacts(outDir) {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	const artifactBundlePath = path.join(outDir, "onhand-runtime.bundle.js");

	await esbuild.build({
		absWorkingDir: rootDir,
		entryPoints: ["packages/browser-extension/src/browser-runtime.ts"],
		outfile: artifactBundlePath,
		bundle: true,
		format: "esm",
		platform: "browser",
		target: ["chrome116"],
		sourcemap: "external",
		sourcesContent: true,
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

	const artifactBundle = stripTrailingWhitespace(await readFile(artifactBundlePath, "utf8"));
	await writeFile(artifactBundlePath, artifactBundle, "utf8");

	const shippedBundle = stripTrailingWhitespace(await readFile(shippedBundlePath, "utf8"));
	const comparableArtifact = stripSourceMapComment(artifactBundle);
	if (comparableArtifact.trimEnd() !== shippedBundle.trimEnd()) {
		throw new Error("Generated Sentry source-map artifact does not match the shipped runtime bundle. Run `npm run build:extension` first.");
	}

	return {
		bundlePath: artifactBundlePath,
		sourceMapPath: `${artifactBundlePath}.map`,
	};
}

function buildCliArgs(options) {
	const args = ["sourcemaps", "upload"];
	if (options.org) args.push("--org", options.org);
	if (options.project) args.push("--project", options.project);
	args.push("--release", options.release);
	if (options.dist) args.push("--dist", options.dist);
	args.push("--url-prefix", options.urlPrefix);
	if (options.validate) args.push("--validate");
	if (options.wait) args.push("--wait");
	args.push(options.outDir);
	return args;
}

async function runSentryCli(args) {
	await new Promise((resolve, reject) => {
		const child = spawn(sentryCliPath, args, {
			cwd: rootDir,
			env: process.env,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`sentry-cli exited with code ${code}`));
		});
	});
}

const options = parseArgs(process.argv.slice(2));
if (!options.release) options.release = `onhand-extension@${await readManifestVersion()}`;

const missing = [];
if (!options.org) missing.push("SENTRY_ORG");
if (!options.project) missing.push("SENTRY_PROJECT");
if (!process.env.SENTRY_AUTH_TOKEN) missing.push("SENTRY_AUTH_TOKEN");
if (missing.length && !options.dryRun) {
	throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const artifacts = await buildSourceMapArtifacts(options.outDir);
const cliArgs = buildCliArgs(options);

console.log(`Prepared Sentry source maps for ${options.release}${options.dist ? ` (${options.dist})` : ""}`);
console.log(`Bundle: ${path.relative(rootDir, artifacts.bundlePath)}`);
console.log(`Source map: ${path.relative(rootDir, artifacts.sourceMapPath)}`);
console.log(`URL prefix: ${options.urlPrefix}`);

if (options.dryRun) {
	console.log(`Dry run: ${quoteShellArg(sentryCliPath)} ${cliArgs.map(quoteShellArg).join(" ")}`);
	if (missing.length) console.log(`Skipping upload; missing ${missing.join(", ")}`);
} else {
	await runSentryCli(cliArgs);
}
