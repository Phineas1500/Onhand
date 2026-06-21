#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";

const DEFAULT_HOURS = 6;
const MAX_HOURS = 24;
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);
const WORKER_DIR = new URL("../workers/free-tier/", import.meta.url);
const SESSION_CLI = new URL("./dump-onhand-sessions.mjs", import.meta.url);

function printUsage() {
	console.log(`Usage:
  npm run free-tier:bypass -- status [--port=<n>]
  npm run free-tier:bypass -- enable [--hours=<1-24>] [--device-hash=<hash>] [--port=<n>] [--no-extension]
  npm run free-tier:bypass -- disable [--port=<n>] [--no-extension]

Creates a bounded developer-only Onhand Free quota override:
  - rotates the bypass secret on every enable
  - allowlists one free-tier device hash
  - sets a short server-side expiration
  - stores the secret only in extension-local storage when --no-extension is not set
`);
}

function parseArgs(argv) {
	const args = {
		command: "status",
		hours: DEFAULT_HOURS,
		port: DEFAULT_PORT,
		deviceHash: "",
		extension: true,
	};
	const values = [...argv];
	if (values[0] && !values[0].startsWith("-")) args.command = values.shift();
	for (const value of values) {
		if (value === "--help" || value === "-h") {
			printUsage();
			process.exit(0);
		}
		if (value === "--no-extension") {
			args.extension = false;
			continue;
		}
		if (value.startsWith("--hours=")) {
			args.hours = Number(value.slice("--hours=".length));
			continue;
		}
		if (value.startsWith("--port=")) {
			args.port = Number(value.slice("--port=".length));
			continue;
		}
		if (value.startsWith("--device-hash=")) {
			args.deviceHash = value.slice("--device-hash=".length).trim();
			continue;
		}
		throw new Error(`Unknown option: ${value}`);
	}
	if (!["status", "enable", "disable"].includes(args.command)) {
		throw new Error("Command must be status, enable, or disable.");
	}
	if (!Number.isFinite(args.port) || args.port <= 0) throw new Error("--port must be a positive number.");
	if (!Number.isFinite(args.hours) || args.hours <= 0 || args.hours > MAX_HOURS) {
		throw new Error(`--hours must be between 1 and ${MAX_HOURS}.`);
	}
	return args;
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env || process.env,
			stdio: options.input == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (options.inheritStdout) process.stdout.write(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (options.inheritStderr !== false) process.stderr.write(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${command} ${args.join(" ")} exited ${code}${stderr ? `\n${stderr.trim()}` : ""}`));
		});
		if (options.input != null) {
			child.stdin.end(options.input.endsWith("\n") ? options.input : `${options.input}\n`);
		}
	});
}

async function sessionCli(args, options = {}) {
	const result = await run(process.execPath, [SESSION_CLI.pathname, ...args], {
		env: options.env || process.env,
		inheritStderr: true,
	});
	return result.stdout;
}

async function sessionJson(args, options = {}) {
	const text = await sessionCli([...args, "--json"], options);
	return JSON.parse(text);
}

async function putWorkerSecret(name, value) {
	await run("npx", ["wrangler", "secret", "put", name], {
		cwd: WORKER_DIR.pathname,
		input: value,
		inheritStdout: true,
		inheritStderr: true,
	});
}

async function currentDeviceHash(port) {
	const state = await sessionJson(["free-tier-bypass", "device-hash", "--port", String(port)]);
	if (!state.deviceHash) {
		throw new Error("No free-tier device hash is available. Register/select Onhand Free once, then retry.");
	}
	return state.deviceHash;
}

async function enable(args) {
	const deviceHash = args.deviceHash || (await currentDeviceHash(args.port));
	if (!/^[a-f0-9]{32}$/i.test(deviceHash)) throw new Error("--device-hash must be a 32-character hex hash.");
	const secret = randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + args.hours * 60 * 60 * 1000).toISOString();

	await putWorkerSecret("ONHAND_FREE_QUOTA_BYPASS_SECRET", secret);
	await putWorkerSecret("ONHAND_FREE_QUOTA_BYPASS_DEVICE_HASHES", deviceHash);
	await putWorkerSecret("ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT", expiresAt);

	let extensionState = null;
	if (args.extension) {
		extensionState = await sessionJson(["free-tier-bypass", "enable", "--port", String(args.port)], {
			env: {
				...process.env,
				ONHAND_FREE_QUOTA_BYPASS_SECRET: secret,
				ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT: expiresAt,
			},
		});
	}
	return { ok: true, enabled: true, deviceHash, expiresAt, extensionState };
}

async function disable(args) {
	const expiresAt = new Date(Date.now() - 60_000).toISOString();
	await putWorkerSecret("ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT", expiresAt);
	let extensionState = null;
	if (args.extension) {
		extensionState = await sessionJson(["free-tier-bypass", "disable", "--port", String(args.port)]);
	}
	return { ok: true, enabled: false, expiresAt, extensionState };
}

async function status(args) {
	return await sessionJson(["free-tier-bypass", "status", "--port", String(args.port)]);
}

function printResult(result) {
	if (result.enabled === true) {
		console.log(`Free-tier quota bypass: enabled`);
		if (result.deviceHash) console.log(`Device hash: ${result.deviceHash}`);
		if (result.expiresAt) console.log(`Expires: ${result.expiresAt}`);
		return;
	}
	if (result.enabled === false) {
		console.log(`Free-tier quota bypass: disabled`);
		if (result.deviceHash) console.log(`Device hash: ${result.deviceHash}`);
		if (result.expiresAt) console.log(`Server expiry set to: ${result.expiresAt}`);
		return;
	}
	console.log(JSON.stringify(result, null, 2));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const result = args.command === "enable" ? await enable(args) : args.command === "disable" ? await disable(args) : await status(args);
	printResult(result);
}

main().catch((error) => {
	console.error(`free-tier-bypass: ${error.message}`);
	process.exitCode = 1;
});
