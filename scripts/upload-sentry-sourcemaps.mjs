// Uploads the runtime source maps that `npm run package:chrome` and
// `npm run package:firefox` wrote next to their zips, so Sentry can map store
// builds' stack frames back to source. Each browser's map is uploaded under its
// own dist (chrome or firefox), matching what the runtime reports. Before
// uploading, the bundle beside each map must match the one inside the zip.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(rootDir, "packages/browser-extension/manifest.json");
const sentryCliPath = path.join(rootDir, "node_modules/.bin/sentry-cli");
const BROWSERS = ["chrome", "firefox"];

function parseArgs(argv) {
	const options = {
		dryRun: false,
		wait: false,
		validate: true,
		browsers: [],
		packagesDir: path.join(rootDir, "dist"),
		org: process.env.SENTRY_ORG || "",
		project: process.env.SENTRY_PROJECT || "onhand-browser-extension",
		release: process.env.SENTRY_RELEASE || "",
		urlPrefix: process.env.SENTRY_URL_PREFIX || "app:///",
	};
	for (const arg of argv) {
		if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--wait") options.wait = true;
		else if (arg === "--no-validate") options.validate = false;
		else if (arg.startsWith("--browser=")) options.browsers.push(arg.slice("--browser=".length));
		else if (arg.startsWith("--packages-dir=")) options.packagesDir = path.resolve(rootDir, arg.slice("--packages-dir=".length));
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--release=")) options.release = arg.slice("--release=".length);
		else if (arg.startsWith("--url-prefix=")) options.urlPrefix = arg.slice("--url-prefix=".length);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	for (const browser of options.browsers) if (!BROWSERS.includes(browser)) throw new Error(`Unknown browser: ${browser}`);
	return options;
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

function packagedArtifacts(options, version, browser) {
	const name = `onhand-v${version}-${browser}`;
	return {
		browser,
		zipPath: path.join(options.packagesDir, `${name}.zip`),
		sourceMapDir: path.join(options.packagesDir, "sentry-sourcemaps", name),
	};
}

async function assertMatchesZip(artifacts) {
	const besideMap = await readFile(path.join(artifacts.sourceMapDir, "onhand-runtime.bundle.js"));
	const inZip = execFileSync("unzip", ["-p", artifacts.zipPath, "onhand-runtime.bundle.js"], { maxBuffer: 64 * 1024 * 1024 });
	if (!besideMap.equals(inZip)) {
		throw new Error(`${artifacts.sourceMapDir} does not match the bundle in ${artifacts.zipPath}. Repackage with npm run package:${artifacts.browser} -- --force.`);
	}
}

function buildCliArgs(options, artifacts) {
	const args = ["sourcemaps", "upload"];
	if (options.org) args.push("--org", options.org);
	if (options.project) args.push("--project", options.project);
	args.push("--release", options.release, "--dist", artifacts.browser, "--url-prefix", options.urlPrefix);
	if (options.validate) args.push("--validate");
	if (options.wait) args.push("--wait");
	args.push(artifacts.sourceMapDir);
	return args;
}

async function runSentryCli(args) {
	await new Promise((resolve, reject) => {
		const child = spawn(sentryCliPath, args, { cwd: rootDir, env: process.env, stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sentry-cli exited with code ${code}`))));
	});
}

const options = parseArgs(process.argv.slice(2));
const version = await readManifestVersion();
if (!options.release) options.release = `onhand-extension@${version}`;

const missing = [];
if (!options.org) missing.push("SENTRY_ORG");
if (!options.project) missing.push("SENTRY_PROJECT");
if (!process.env.SENTRY_AUTH_TOKEN) missing.push("SENTRY_AUTH_TOKEN");
if (missing.length && !options.dryRun) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

// Without --browser, upload every browser that has been packaged.
const requested = options.browsers.length ? options.browsers : BROWSERS;
const uploads = requested
	.map((browser) => packagedArtifacts(options, version, browser))
	.filter((artifacts) => options.browsers.length || existsSync(artifacts.sourceMapDir));
if (!uploads.length) throw new Error(`No packaged source maps for ${version} in ${options.packagesDir}. Run npm run package:chrome (and package:firefox) first.`);

for (const artifacts of uploads) {
	if (!existsSync(artifacts.sourceMapDir)) throw new Error(`Missing ${artifacts.sourceMapDir}. Run npm run package:${artifacts.browser} first.`);
	if (!existsSync(artifacts.zipPath)) throw new Error(`Missing ${artifacts.zipPath}.`);
	await assertMatchesZip(artifacts);
	const cliArgs = buildCliArgs(options, artifacts);
	console.log(`Sentry source maps for ${options.release} (${artifacts.browser}): ${artifacts.sourceMapDir}`);
	if (options.dryRun) console.log(`Dry run: ${quoteShellArg(sentryCliPath)} ${cliArgs.map(quoteShellArg).join(" ")}`);
	else await runSentryCli(cliArgs);
}
if (options.dryRun && missing.length) console.log(`Skipping upload; missing ${missing.join(", ")}`);
