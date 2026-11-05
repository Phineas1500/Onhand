#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PILOT_DIR = join(ROOT, "tmp", "raindrop-pilot");
const HOME_DIR = join(PILOT_DIR, "home");
const BIN_DIR = join(PILOT_DIR, "bin");
const LOG_PATH = join(PILOT_DIR, "workshop.log");
const PID_PATH = join(PILOT_DIR, "workshop-process.json");
const DB_PATH = join(PILOT_DIR, "workshop.db");
const PORT = Number(process.env.RAINDROP_WORKSHOP_PORT || 5899);
const VERSION = "0.1.23";

const RELEASES = {
	"darwin-arm64": {
		url: `https://github.com/raindrop-ai/workshop/releases/download/v${VERSION}/raindrop-bun-darwin-arm64.gz`,
		sha256: "fcec201ad7605a08906f6012d2449c4df744a24943a81b31ba17c37abdc29c08",
	},
	"darwin-x64": {
		url: `https://github.com/raindrop-ai/workshop/releases/download/v${VERSION}/raindrop-bun-darwin-x64.gz`,
		sha256: "4b336cb4fcaaba48cee7880ef8610e541ab940a692b0066a807fa2acf0adcdb4",
	},
	"linux-arm64": {
		url: `https://github.com/raindrop-ai/workshop/releases/download/v${VERSION}/raindrop-bun-linux-arm64.gz`,
		sha256: "e9f40c72c8868a821965b4a280ebd77c91cb1888ccfd3d9efb2077a7ce307367",
	},
	"linux-x64": {
		url: `https://github.com/raindrop-ai/workshop/releases/download/v${VERSION}/raindrop-bun-linux-x64.gz`,
		sha256: "09be0eaa647db6060603e9d8e5c119903fff75f3de20cc591a802027c6cfdfe3",
	},
	"win32-x64": {
		url: `https://github.com/raindrop-ai/workshop/releases/download/v${VERSION}/raindrop-bun-windows-x64.exe.gz`,
		sha256: "33987b7c4571a3f03de367bcbb87623db545a22c88c4e2720f7a837d5235e89f",
	},
};

const executableName = process.platform === "win32" ? "raindrop.exe" : "raindrop";
const binaryPath = join(BIN_DIR, executableName);
const release = RELEASES[`${process.platform}-${process.arch}`];
const workshopUrl = `http://127.0.0.1:${PORT}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function usage() {
	console.log(`Usage: node scripts/manage-raindrop-development-pilot.mjs <command>

Commands:
  setup    Download and checksum the pinned Workshop ${VERSION} binary
  start    Start the repository-local Workshop in the background
  status   Report the managed process and loopback HTTP health
  stop     Stop only the Workshop process recorded by this repository

The binary, database, log, and PID metadata stay under ignored tmp/raindrop-pilot/.`);
}

function workshopEnv() {
	return {
		...process.env,
		HOME: HOME_DIR,
		RAINDROP_WORKSHOP_PORT: String(PORT),
		RAINDROP_WORKSHOP_BIND_HOST: "127.0.0.1",
		RAINDROP_WORKSHOP_DB_PATH: DB_PATH,
	};
}

async function readManagedProcess() {
	try {
		return JSON.parse(await readFile(PID_PATH, "utf8"));
	} catch {
		return null;
	}
}

function processExists(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function workshopHealthy(timeoutMs = 1000) {
	try {
		const response = await fetch(workshopUrl, { signal: AbortSignal.timeout(timeoutMs) });
		return response.status >= 200 && response.status < 500;
	} catch {
		return false;
	}
}

async function setup() {
	if (!release) throw new Error(`Workshop ${VERSION} has no pinned artifact for ${process.platform}-${process.arch}.`);
	await mkdir(BIN_DIR, { recursive: true });
	await mkdir(HOME_DIR, { recursive: true });
	if (existsSync(binaryPath)) {
		const version = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
		if (version.status === 0 && String(version.stdout || "").trim() === VERSION) {
			console.log(`Raindrop Workshop ${VERSION} is already installed at ${binaryPath}`);
			return;
		}
	}
	const response = await fetch(release.url);
	if (!response.ok) throw new Error(`Workshop download returned HTTP ${response.status}`);
	const archive = Buffer.from(await response.arrayBuffer());
	const actualSha = createHash("sha256").update(archive).digest("hex");
	if (actualSha !== release.sha256) {
		throw new Error(`Workshop checksum mismatch: expected ${release.sha256}, received ${actualSha}`);
	}
	await writeFile(binaryPath, gunzipSync(archive));
	if (process.platform !== "win32") await chmod(binaryPath, 0o755);
	const version = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
	if (version.status !== 0 || String(version.stdout || "").trim() !== VERSION) {
		await rm(binaryPath, { force: true });
		throw new Error(`Downloaded Workshop did not report version ${VERSION}`);
	}
	console.log(`Installed and verified Raindrop Workshop ${VERSION} at ${binaryPath}`);
}

async function status({ quiet = false } = {}) {
	const managed = await readManagedProcess();
	const processRunning = processExists(Number(managed?.pid));
	const healthy = await workshopHealthy();
	const result = {
		version: VERSION,
		url: workshopUrl,
		pid: managed?.pid || null,
		processRunning,
		healthy,
		managed: Boolean(managed),
		logPath: LOG_PATH,
		databasePath: DB_PATH,
	};
	if (!quiet) console.log(JSON.stringify(result, null, 2));
	return result;
}

async function start() {
	if (!existsSync(binaryPath)) await setup();
	await mkdir(PILOT_DIR, { recursive: true });
	await mkdir(HOME_DIR, { recursive: true });
	const current = await status({ quiet: true });
	if (current.healthy) {
		if (!current.processRunning) {
			throw new Error(`${workshopUrl} is already serving an unmanaged process; refusing to replace or adopt it.`);
		}
		console.log(`Raindrop Workshop is already running at ${workshopUrl}`);
		return;
	}
	if (current.managed && !current.processRunning) await rm(PID_PATH, { force: true });
	const logFd = openSync(LOG_PATH, "a");
	const child = spawn(binaryPath, ["workshop", "serve"], {
		cwd: ROOT,
		env: workshopEnv(),
		stdio: ["ignore", logFd, logFd],
		detached: true,
	});
	closeSync(logFd);
	child.unref();
	await writeFile(
		PID_PATH,
		`${JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), port: PORT, version: VERSION }, null, 2)}\n`,
	);
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (await workshopHealthy(500)) {
			console.log(`Raindrop Workshop ${VERSION} is running at ${workshopUrl} (PID ${child.pid})`);
			return;
		}
		if (!processExists(child.pid)) break;
		await delay(250);
	}
	throw new Error(`Workshop did not become healthy. Inspect ${LOG_PATH}`);
}

async function stop() {
	const managed = await readManagedProcess();
	if (!managed?.pid) {
		console.log("No repository-managed Raindrop Workshop process is recorded.");
		return;
	}
	const pid = Number(managed.pid);
	if (processExists(pid)) {
		process.kill(pid, "SIGTERM");
		for (let attempt = 0; attempt < 40 && processExists(pid); attempt += 1) await delay(100);
		if (processExists(pid)) throw new Error(`Workshop PID ${pid} did not stop after SIGTERM.`);
	}
	await rm(PID_PATH, { force: true });
	console.log(`Stopped repository-managed Raindrop Workshop PID ${pid}.`);
}

const command = process.argv[2];
if (!command || command === "-h" || command === "--help") {
	usage();
	process.exit(command ? 0 : 1);
}

if (command === "setup") await setup();
else if (command === "start") await start();
else if (command === "status") await status();
else if (command === "stop") await stop();
else throw new Error(`Unknown command: ${command}`);
