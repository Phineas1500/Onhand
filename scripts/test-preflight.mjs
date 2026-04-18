import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CONFIG_PATH = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const SESSION_DIR = join(PROJECT_ROOT, ".onhand", "sessions", "desktop");
const FAST_TIMEOUT_MS = 1500;

function parseArgs(argv) {
	return {
		json: argv.includes("--json"),
	};
}

async function loadBridgeConfig() {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = JSON.parse(raw);
	return {
		host: parsed.host || "127.0.0.1",
		port: Number(parsed.port || 3210),
		token: parsed.token || "",
	};
}

async function requestJson(url, token) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FAST_TIMEOUT_MS).unref();
	try {
		const headers = new Headers();
		if (token) headers.set("Authorization", `Bearer ${token}`);
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
		});
		const data = await response.json();
		return {
			ok: response.ok && data?.ok !== false,
			status: response.status,
			data,
			error: response.ok && data?.ok !== false ? "" : data?.error || `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			data: null,
			error: error?.name === "AbortError" ? "request timed out" : error?.message || String(error),
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

async function inspectSessionDir() {
	try {
		const { readdir } = await import("node:fs/promises");
		const entries = (await readdir(SESSION_DIR)).filter((entry) => entry.endsWith(".jsonl")).sort();
		return {
			ok: true,
			dir: SESSION_DIR,
			count: entries.length,
			latest: entries.at(-1) || "",
		};
	} catch (error) {
		return {
			ok: false,
			dir: SESSION_DIR,
			count: 0,
			latest: "",
			error: error?.message || String(error),
		};
	}
}

async function buildReport() {
	const bridgeConfig = await loadBridgeConfig();
	const bridgeBaseUrl = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
	const desktopBaseUrl = "http://127.0.0.1:3211";

	const [bridgeHealth, desktopHealth, sessionDir] = await Promise.all([
		requestJson(`${bridgeBaseUrl}/health`, bridgeConfig.token),
		requestJson(`${desktopBaseUrl}/health`, bridgeConfig.token),
		inspectSessionDir(),
	]);

	const connectedClients = Array.isArray(bridgeHealth.data?.connectedClients)
		? bridgeHealth.data.connectedClients.length
		: 0;

	return {
		projectRoot: PROJECT_ROOT,
		bridge: {
			baseUrl: bridgeBaseUrl,
			ok: bridgeHealth.ok,
			connectedClients,
			host: bridgeHealth.data?.host || bridgeConfig.host,
			port: bridgeHealth.data?.port || bridgeConfig.port,
			error: bridgeHealth.error,
		},
		desktopUi: {
			baseUrl: desktopBaseUrl,
			ok: desktopHealth.ok,
			host: desktopHealth.data?.host || "127.0.0.1",
			port: desktopHealth.data?.port || 3211,
			error: desktopHealth.error,
		},
		sessions: sessionDir,
		manualReminders: [
			"If you changed packages/browser-extension/*, reload the unpacked extension before Tier 3 tests.",
			"Use a dedicated Chrome window for GUI validation with Computer Use.",
			"If the change is UI-sensitive, run Tier 1 and Tier 2 first, then verify the real flow with Computer Use.",
		],
	};
}

function printHealth(label, item, extra = "") {
	const status = item.ok ? "OK" : "FAIL";
	console.log(`${label}: ${status}${extra ? ` (${extra})` : ""}`);
	if (!item.ok && item.error) {
		console.log(`  Error: ${item.error}`);
	}
}

function printHumanReadable(report) {
	console.log(`Project root: ${report.projectRoot}`);
	console.log("");
	printHealth("Bridge", report.bridge, `${report.bridge.host}:${report.bridge.port}, ${report.bridge.connectedClients} client(s)`);
	printHealth("Desktop UI API", report.desktopUi, `${report.desktopUi.host}:${report.desktopUi.port}`);
	printHealth(
		"Session directory",
		report.sessions,
		`${report.sessions.count} session file(s)${report.sessions.latest ? `, latest ${report.sessions.latest}` : ""}`,
	);
	if (!report.sessions.ok && report.sessions.error) {
		console.log(`  Error: ${report.sessions.error}`);
	}
	console.log("");
	console.log("Manual reminders:");
	for (const line of report.manualReminders) {
		console.log(`- ${line}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = await buildReport();
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	printHumanReadable(report);
}

await main();
