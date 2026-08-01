#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { loadTrajectorySuite, scoreTrajectory, summarizeTrajectoryResults } from "./lib/agent-trajectory-eval.mjs";
import {
	normalizeConfiguredRuntimeMetadata,
	normalizeLiveTrajectoryTrace,
	startAgentTrajectoryFixtureServer,
} from "./lib/agent-trajectory-fixtures.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./dump-onhand-sessions.mjs", import.meta.url));
const DEFAULT_SUITE = fileURLToPath(new URL("../evals/agent-trajectories/cases.json", import.meta.url));
const DEFAULT_HOST = process.env.ONHAND_CDP_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);
const EXTENSION_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const EXTENSION_ID = "hpjpjeehgbloadhdidmecpijppodibim";
const DEFAULT_ISOLATED_PROFILE = join(ROOT, "tmp", "agent-trajectory-browser-profile");
const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

function timestampSlug() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
	const args = {
		caseIds: [],
		browserPath: "",
		browserProfile: DEFAULT_ISOLATED_PROFILE,
		cancelAfterMs: 0,
		freeTier: false,
		host: DEFAULT_HOST,
		iterations: 1,
		keepBrowser: false,
		keepTabs: false,
		launchIsolated: false,
		keepProfile: false,
		outDir: "",
		port: DEFAULT_PORT,
		portExplicit: false,
		profile: "legacy",
		suitePath: DEFAULT_SUITE,
		timeout: "180s",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		const readValue = (name) => {
			const inline = value.startsWith(`${name}=`) ? value.slice(name.length + 1) : "";
			if (inline) return inline;
			const next = argv[index + 1];
			if (!next || next.startsWith("-")) throw new Error(`${name} requires a value`);
			index += 1;
			return next;
		};
		if (value === "--case" || value.startsWith("--case=")) args.caseIds.push(readValue("--case"));
		else if (value === "--browser" || value.startsWith("--browser=")) args.browserPath = resolve(readValue("--browser"));
		else if (value === "--browser-profile" || value.startsWith("--browser-profile=")) args.browserProfile = resolve(readValue("--browser-profile"));
		else if (value === "--cancel-after-ms" || value.startsWith("--cancel-after-ms=")) args.cancelAfterMs = Number(readValue("--cancel-after-ms"));
		else if (value === "--host" || value.startsWith("--host=")) args.host = readValue("--host");
		else if (value === "--port" || value.startsWith("--port=")) {
			args.port = Number(readValue("--port"));
			args.portExplicit = true;
		}
		else if (value === "--iterations" || value.startsWith("--iterations=")) args.iterations = Number(readValue("--iterations"));
		else if (value === "--profile" || value.startsWith("--profile=")) args.profile = readValue("--profile");
		else if (value === "--suite" || value.startsWith("--suite=")) args.suitePath = resolve(readValue("--suite"));
		else if (value === "--out" || value.startsWith("--out=")) args.outDir = resolve(readValue("--out"));
		else if (value === "--timeout" || value.startsWith("--timeout=")) args.timeout = readValue("--timeout");
		else if (value === "--keep-tabs") args.keepTabs = true;
		else if (value === "--keep-browser") args.keepBrowser = true;
		else if (value === "--launch-isolated") args.launchIsolated = true;
		else if (value === "--keep-profile") args.keepProfile = true;
		else if (value === "--free-tier") args.freeTier = true;
		else if (value === "-h" || value === "--help") {
			console.log(`Usage: npm run eval:agent-trajectories:live -- [options]

Runs deterministic local browser fixtures through the loaded Onhand extension
and its configured Pi/model route, then writes and scores normalized traces.

Options:
  --case <id>          Select a case; repeatable. Default: current-page-grounded-answer
  --iterations <n>     Repetitions per case. Default: 1
  --profile <name>     Trace profile label. Default: legacy
  --host <host>        Browser CDP host. Default: ${DEFAULT_HOST}
  --port <port>        Browser CDP port. Default: ${DEFAULT_PORT}
  --launch-isolated    Launch a fixture-only Chromium profile with the unpacked extension
  --browser <path>     Chromium-family binary for --launch-isolated
  --browser-profile <path>
                       Stable ignored profile directory. Default: tmp/agent-trajectory-browser-profile
  --keep-browser       Leave an isolated browser running after the evaluation
  --free-tier          Configure the isolated profile for Onhand Free using
                       ONHAND_FREE_TIER_BASE_URL (environment or repository .env)
  --cancel-after-ms <n>
                       Stop n milliseconds after the request becomes active (one case only)
  --timeout <duration> Per-turn timeout passed to debug:sessions. Default: 180s
  --suite <path>       Trajectory fixture suite
  --out <directory>    Output directory. Default: tmp/agent-trajectories/<timestamp>
  --keep-tabs          Leave fixture tabs open for visual inspection
  -h, --help           Show this help`);
			process.exit(0);
		} else throw new Error(`Unknown option: ${value}`);
	}
	if (!Number.isInteger(args.iterations) || args.iterations < 1) throw new Error("--iterations must be a positive integer");
	if (!Number.isFinite(args.port) || args.port <= 0) throw new Error("--port must be a positive number");
	if (!Number.isFinite(args.cancelAfterMs) || args.cancelAfterMs < 0) throw new Error("--cancel-after-ms must be zero or a positive number");
	if (args.freeTier && !args.launchIsolated) throw new Error("--free-tier requires --launch-isolated to avoid changing a personal browser profile");
	if (args.cancelAfterMs > 0 && (args.caseIds.length !== 1 || args.iterations !== 1)) {
		throw new Error("--cancel-after-ms requires exactly one case and one iteration");
	}
	if (!args.caseIds.length) args.caseIds.push("current-page-grounded-answer");
	return args;
}

class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		socket.on("message", (data) => {
			const message = JSON.parse(String(data));
			if (!message.id) return;
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || "CDP error"}`));
			else pending.resolve(message.result || {});
		});
		socket.on("close", () => {
			for (const pending of this.pending.values()) pending.reject(new Error("CDP connection closed"));
			this.pending.clear();
		});
	}

	send(method, params = {}, sessionId = "") {
		const id = this.nextId++;
		return new Promise((resolvePromise, reject) => {
			this.pending.set(id, { method, resolve: resolvePromise, reject });
			this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	}

	close() {
		this.socket.close();
	}
}

function findBrowser(explicitPath = "") {
	if (explicitPath) return existsSync(explicitPath) ? explicitPath : null;
	for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate;
	return null;
}

async function pickAvailablePort() {
	return await new Promise((resolvePromise, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => (port ? resolvePromise(port) : reject(new Error("Could not allocate a CDP port"))));
		});
	});
}

async function waitForBrowserCdp(options, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	do {
		try {
			const response = await fetch(`http://${options.host}:${options.port}/json/version`);
			if (response.ok) return;
		} catch {}
		await sleep(250);
	} while (Date.now() < deadline);
	throw new Error(`Isolated browser CDP did not become ready on ${options.host}:${options.port}`);
}

async function launchIsolatedBrowser(options) {
	const browserPath = findBrowser(options.browserPath);
	if (!browserPath) throw new Error(`No Chromium-family browser found; set --browser or ONHAND_TEST_BROWSER.`);
	if (!options.portExplicit) options.port = await pickAvailablePort();
	// Chromium caches the unpacked extension's service worker inside the
	// profile, so a reused profile can resurrect stale extension code across
	// launches (observed 2026-07-31: a July-era worker sent the old free-tier
	// model id and every request 400'd; developerPrivate.reload unloads
	// command-line extensions instead of reloading them). Start from a fresh
	// profile unless --keep-profile explicitly opts into the cached one.
	if (!options.keepProfile) await rm(options.browserProfile, { recursive: true, force: true });
	await mkdir(options.browserProfile, { recursive: true });
	const browser = spawn(
		browserPath,
		[
			`--user-data-dir=${options.browserProfile}`,
			`--load-extension=${EXTENSION_DIR}`,
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--remote-debugging-port=${options.port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1200,1000",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	await waitForBrowserCdp(options);
	process.stderr.write(`[trajectory] isolated browser ready on ${options.host}:${options.port} using ${options.browserProfile}\n`);
	return browser;
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
	if (!value) {
		try {
			value = parseEnvValue(await readFile(join(ROOT, ".env"), "utf8"), "ONHAND_FREE_TIER_BASE_URL");
		} catch {}
	}
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("--free-tier requires a valid ONHAND_FREE_TIER_BASE_URL in the environment or repository .env");
	}
	if (parsed.protocol !== "https:") throw new Error("ONHAND_FREE_TIER_BASE_URL must use HTTPS");
	return parsed.toString().replace(/\/$/, "");
}

async function configureIsolatedFreeTier(cdp) {
	const baseUrl = await resolveFreeTierBaseUrl();
	const { targetId } = await cdp.send("Target.createTarget", {
		url: `chrome-extension://${EXTENSION_ID}/options.html`,
		background: true,
	});
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	try {
		let ready = false;
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const probe = await cdp.send(
				"Runtime.evaluate",
				{ expression: `Boolean(globalThis.chrome?.storage?.local && globalThis.chrome?.runtime?.sendMessage)`, returnByValue: true },
				sessionId,
			);
			if (probe?.result?.value === true) {
				ready = true;
				break;
			}
			await sleep(250);
		}
		if (!ready) throw new Error("Onhand options page did not expose extension storage/runtime APIs");
		const expression = `(async () => {
			await chrome.storage.local.set({ onhandFreeTierBaseUrl: ${JSON.stringify(baseUrl)} });
			return await chrome.runtime.sendMessage({
				type: "browser-runtime:update-settings",
				aiProvider: "onhand-free",
				aiModel: "openai/gpt-5.6-luna",
				authMode: "api-key",
				diagnosticsEnabled: true
			});
		})()`;
		const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
		if (result?.exceptionDetails) throw new Error(result.exceptionDetails?.exception?.description || result.exceptionDetails.text || "Free-tier configuration failed");
		if (!result?.result?.value?.ok) throw new Error(result?.result?.value?.error || "Onhand rejected free-tier configuration");
	} finally {
		await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
		await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
	}
}

async function connect(url) {
	return await new Promise((resolvePromise, reject) => {
		const socket = new WebSocket(url);
		socket.once("open", () => resolvePromise(socket));
		socket.once("error", reject);
	});
}

async function openBrowserCdp(args) {
	const response = await fetch(`http://${args.host}:${args.port}/json/version`);
	if (!response.ok) throw new Error(`CDP endpoint returned HTTP ${response.status}`);
	const version = await response.json();
	return new Cdp(await connect(version.webSocketDebuggerUrl));
}

function sleep(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function runCli(args, options, { json = true, signal = null } = {}) {
	const fullArgs = [CLI, ...args, "--host", options.host, "--port", String(options.port)];
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, fullArgs, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let aborted = false;
		const abort = () => {
			aborted = true;
			child.kill("SIGTERM");
		};
		if (signal?.aborted) abort();
		else signal?.addEventListener?.("abort", abort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.once("error", reject);
		child.once("close", (code) => {
			signal?.removeEventListener?.("abort", abort);
			if (aborted) {
				const error = new Error("debug:sessions command aborted by trajectory runner");
				error.name = "AbortError";
				reject(error);
				return;
			}
			if (code !== 0) {
				reject(new Error(`debug:sessions ${args[0]} failed with exit ${code}\n${stderr || stdout}`));
				return;
			}
			if (!json) {
				resolvePromise(stdout);
				return;
			}
			try {
				resolvePromise(JSON.parse(stdout));
			} catch (error) {
				reject(new Error(`Could not parse debug:sessions output: ${error.message}\n${stdout}`));
			}
		});
	});
}

async function getConfiguredRuntime(cdpOptions) {
	const state = await runCli(["state", "--json", "--full"], cdpOptions);
	return normalizeConfiguredRuntimeMetadata(state);
}

async function waitForConfiguredRuntime(cdpOptions, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	do {
		try {
			return await getConfiguredRuntime(cdpOptions);
		} catch (error) {
			lastError = error;
			await sleep(500);
		}
	} while (Date.now() < deadline);
	throw lastError || new Error("Onhand extension runtime did not become ready");
}

async function waitForIdle(cdpOptions, { timeoutMs = 15000, pollMs = 500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastStatus = "";
	do {
		const response = await runCli(["state", "--json"], cdpOptions);
		const state = response?.state && typeof response.state === "object" ? response.state : response;
		lastStatus = String(state?.status || "");
		if (!state?.activeRequestId && !/^(?:Starting|Planning|Thinking|Reading|Searching|Opening|Writing|Evaluating|Highlighting|Adding|Finding|Navigating)/i.test(lastStatus)) {
			return;
		}
		await sleep(pollMs);
	} while (Date.now() < deadline);
	throw new Error(`Onhand did not become idle after cancellation. Last state: ${lastStatus || "unknown"}`);
}

async function createTarget(cdp, url, background) {
	const { targetId } = await cdp.send("Target.createTarget", { url, background });
	if (!targetId) throw new Error(`Could not create fixture tab for ${url}`);
	return targetId;
}

async function selectText(cdp, targetId, selectedText) {
	if (!selectedText) return true;
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	const expression = `(() => {
		const target = ${JSON.stringify(selectedText)};
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const index = node.data.indexOf(target);
			if (index < 0) continue;
			const range = document.createRange();
			range.setStart(node, index);
			range.setEnd(node, index + target.length);
			const selection = getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			node.parentElement?.scrollIntoView({ block: "center" });
			return selection.toString();
		}
		return "";
	})()`;
	const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
	await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
	return result?.result?.value === selectedText;
}

async function openWorkspace(cdp, testCase, catalog) {
	const targets = [];
	const inactive = testCase.workspace.tabs.filter((tab) => tab.id !== testCase.workspace.activeTabId);
	const active = testCase.workspace.tabs.find((tab) => tab.id === testCase.workspace.activeTabId);
	for (const tab of inactive) {
		const targetId = await createTarget(cdp, catalog.tabUrl(testCase, tab), true);
		targets.push(targetId);
	}
	const activeTargetId = await createTarget(cdp, catalog.tabUrl(testCase, active), false);
	targets.push(activeTargetId);
	await sleep(1200);
	if (!(await selectText(cdp, activeTargetId, testCase.turn.selectedText || ""))) {
		throw new Error(`${testCase.id}: could not establish the fixture text selection`);
	}
	return targets;
}

async function closeFixtureTargets(cdp, catalog) {
	const targetInfos = (await cdp.send("Target.getTargets")).targetInfos || [];
	for (const target of targetInfos) {
		if (!String(target.url || "").startsWith(catalog.baseUrl)) continue;
		await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
	}
}

async function sendExtensionMessage(cdp, payload) {
	const { targetId } = await cdp.send("Target.createTarget", {
		url: `chrome-extension://${EXTENSION_ID}/sidepanel.html?driver=1&agent-trajectory-control=1`,
		background: true,
	});
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	try {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const probe = await cdp.send(
				"Runtime.evaluate",
				{ expression: `typeof globalThis.chrome?.runtime?.sendMessage`, returnByValue: true },
				sessionId,
			);
			if (probe?.result?.value === "function") break;
			if (attempt === 39) throw new Error("Onhand control driver did not expose extension messaging");
			await sleep(100);
		}
		const expression = `(async () => JSON.stringify(await chrome.runtime.sendMessage(${JSON.stringify(payload)})))()`;
		const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
		if (result?.exceptionDetails) throw new Error(result.exceptionDetails?.exception?.description || result.exceptionDetails.text || "Extension message failed");
		return JSON.parse(String(result?.result?.value || "null"));
	} finally {
		await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
		await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
	}
}

async function stopActiveRequest(cdp) {
	let lastError;
	for (let attempt = 1; attempt <= 20; attempt += 1) {
		try {
			const response = await sendExtensionMessage(cdp, { type: "sidebar:stop" });
			if (!response?.ok) throw new Error(response?.error || "Onhand rejected the stop command");
			process.stderr.write(`[trajectory] cancellation acknowledged (stopped=${Boolean(response.stopped)})\n`);
			return response;
		} catch (error) {
			lastError = error;
			if (attempt < 20) await sleep(250);
		}
	}
	throw new Error(`Cancellation did not reach Onhand: ${lastError?.message || String(lastError)}`);
}

async function waitForActiveRequestAndCancel(cdp, delayMs, shouldContinue) {
	for (let attempt = 0; attempt < 120 && shouldContinue(); attempt += 1) {
		try {
			const response = await sendExtensionMessage(cdp, { type: "sidebar:fetch-state" });
			const state = response?.state && typeof response.state === "object" ? response.state : response;
			if (state?.activeRequestId) {
				await sleep(delayMs);
				if (!shouldContinue()) return null;
				return await stopActiveRequest(cdp);
			}
		} catch {}
		await sleep(250);
	}
	if (shouldContinue()) throw new Error("Cancellation timer could not observe an active Onhand request within 30 seconds");
	return null;
}

async function currentTrajectoryResult(cdp) {
	const stateResponse = await sendExtensionMessage(cdp, { type: "sidebar:fetch-state" });
	const state = stateResponse?.state && typeof stateResponse.state === "object" ? stateResponse.state : stateResponse;
	const sessionPath = String(state?.currentSession?.sessionId || state?.currentSession?.sessionFile || "");
	if (!sessionPath) throw new Error("Cancelled Onhand request did not expose a current session");
	const replay = await sendExtensionMessage(cdp, { type: "sidebar:get-session-replay", sessionPath });
	const turns = Array.isArray(replay?.turns) ? replay.turns : [];
	const turn = turns.at(-1) || null;
	if (!turn) throw new Error("Cancelled Onhand session did not contain a turn");
	return { requestId: turn.id, submitted: true, state, replay, turn };
}

async function ask(testCase, options, cdp) {
	const args = [
		"ask",
		"--prompt",
		testCase.turn.prompt,
		"--new",
		"--wait",
		"--timeout",
		options.timeout,
		"--json",
		"--full",
		"--source",
		"agent-trajectory",
	];
	if (testCase.turn.mode === "learning") args.push("--learning");
	let askFinished = false;
	if (options.cancelAfterMs <= 0) return await runCli(args, options);
	const controller = new AbortController();
	const askPromise = runCli(args, options, { signal: controller.signal });
	const cancelPromise = waitForActiveRequestAndCancel(cdp, options.cancelAfterMs, () => !askFinished);
	const first = await Promise.race([
		askPromise.then((result) => ({ kind: "ask", result }), (error) => ({ kind: "ask-error", error })),
		cancelPromise.then((result) => ({ kind: "cancel", result }), (error) => ({ kind: "cancel-error", error })),
	]);
	if (first.kind === "ask") {
		askFinished = true;
		await cancelPromise.catch(() => {});
		return first.result;
	}
	if (first.kind === "ask-error") {
		askFinished = true;
		await cancelPromise.catch(() => {});
		throw first.error;
	}
	if (first.kind === "cancel-error") {
		askFinished = true;
		controller.abort();
		await askPromise.catch(() => {});
		throw first.error;
	}
	controller.abort();
	await askPromise.catch(() => {});
	askFinished = true;
	await sleep(250);
	return await currentTrajectoryResult(cdp);
}

function reportMarkdown(metadata, results, summary) {
	const lines = [
		"# Onhand agent trajectory baseline",
		"",
		`- Created: ${metadata.createdAt}`,
		`- Extension: ${metadata.extensionVersion || "unknown"}`,
		`- Runtime revision: ${metadata.runtimeRevision || "unknown"}`,
		`- Provider/model: ${metadata.provider} / ${metadata.model}`,
		`- Profile: ${metadata.profile}`,
		"",
		"| Case | Iteration | Status | Score | Latency | Model calls | Tool calls | Failures |",
		"| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |",
	];
	for (const result of results) {
		lines.push(`| ${result.caseId} | ${result.iteration} | ${result.status} | ${result.score.toFixed(3)} | ${result.metrics.latencyMs} ms | ${result.metrics.modelCalls} | ${result.metrics.toolCalls} | ${result.hardFailures.join("<br>") || ""} |`);
	}
	lines.push("", "| Model | Runs | Pass rate | Average score | p95 latency |", "| --- | ---: | ---: | ---: | ---: |");
	for (const group of summary) {
		lines.push(`| ${group.model} | ${group.runs} | ${(group.passRate * 100).toFixed(0)}% | ${group.averageScore.toFixed(3)} | ${group.p95LatencyMs ?? "n/a"} ms |`);
	}
	return `${lines.join("\n")}\n`;
}

function failedTrajectoryTrace(testCase, options, runtime, iteration, elapsedMs) {
	return {
		caseId: testCase.id,
		profile: options.profile,
		model: runtime.model,
		iteration,
		completed: false,
		honestLimitation: false,
		reply: "",
		toolCalls: [],
		evidenceUses: [],
		annotations: [],
		modelCalls: 0,
		latencyMs: Math.max(0, elapsedMs),
		duplicateSources: 0,
		focusChanges: 0,
		unsupportedActionClaims: 0,
		pageMutations: 0,
		provisionalAnswerExposed: false,
	};
}

function isFreeTierQuotaTrace(trace, runtime) {
	return runtime.provider === "onhand-free" && /reached today(?:'|’)s Onhand Free limit/i.test(String(trace?.reply || ""));
}

async function persistBaselineArtifacts(outDir, metadata, traces, caseMap) {
	const results = traces.map((trace) => scoreTrajectory(caseMap.get(trace.caseId), trace));
	const summary = summarizeTrajectoryResults(results);
	await writeFile(join(outDir, "traces.jsonl"), traces.length ? `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n` : "");
	await writeFile(join(outDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
	await writeFile(join(outDir, "report.json"), `${JSON.stringify({ metadata, results, summary }, null, 2)}\n`);
	await writeFile(join(outDir, "report.md"), reportMarkdown(metadata, results, summary));
	return { results, summary };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	let isolatedBrowser = null;
	let fixture = null;
	let cdp = null;
	try {
		if (options.launchIsolated) isolatedBrowser = await launchIsolatedBrowser(options);
		const suite = await loadTrajectorySuite(options.suitePath);
		const caseMap = new Map(suite.cases.map((testCase) => [testCase.id, testCase]));
		const selected = options.caseIds.map((id) => {
			const testCase = caseMap.get(id);
			if (!testCase) throw new Error(`Unknown case id: ${id}`);
			if (!testCase.profiles.includes(options.profile)) throw new Error(`${id} does not support profile ${options.profile}`);
			return testCase;
		});
		const outDir = options.outDir || join(ROOT, "tmp", "agent-trajectories", timestampSlug());
		await mkdir(outDir, { recursive: true });
		fixture = await startAgentTrajectoryFixtureServer(suite);
		cdp = await openBrowserCdp(options);
		if (options.freeTier) await configureIsolatedFreeTier(cdp);
		const runtime = await waitForConfiguredRuntime(options);
		if (options.freeTier && runtime.provider !== "onhand-free") {
			throw new Error(`Isolated free-tier setup did not take effect; configured provider is ${runtime.provider}`);
		}
		const metadata = {
			createdAt: new Date().toISOString(),
			suiteId: suite.suiteId,
			profile: options.profile,
			...(options.cancelAfterMs > 0 ? { cancelAfterMs: options.cancelAfterMs } : {}),
			...runtime,
		};
		const traces = [];
		await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
		await closeFixtureTargets(cdp, fixture.catalog);
		trajectoryCases: for (const testCase of selected) {
			for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
				await waitForIdle(options);
				process.stderr.write(`[trajectory] ${testCase.id} iteration ${iteration}: opening fixture workspace\n`);
				await openWorkspace(cdp, testCase, fixture.catalog);
				const startedAt = Date.now();
				let trace;
				try {
					const result = await ask(testCase, options, cdp);
					trace = normalizeLiveTrajectoryTrace(testCase, result, {
						profile: options.profile,
						model: runtime.model,
						iteration,
						elapsedMs: Date.now() - startedAt,
						catalog: fixture.catalog,
					});
				} catch (error) {
					await runCli(["stop", "--json"], options).catch(() => {});
					await waitForIdle(options).catch((idleError) => {
						process.stderr.write(`[trajectory] ${testCase.id} iteration ${iteration}: ${idleError.message || String(idleError)}\n`);
					});
					trace = failedTrajectoryTrace(testCase, options, runtime, iteration, Date.now() - startedAt);
					process.stderr.write(`[trajectory] ${testCase.id} iteration ${iteration}: request error: ${error.message || String(error)}\n`);
				}
				traces.push(trace);
				const scored = scoreTrajectory(testCase, trace);
				process.stderr.write(`[trajectory] ${testCase.id} iteration ${iteration}: ${scored.status} (${scored.score.toFixed(3)})\n`);
				await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
				if (!options.keepTabs) await closeFixtureTargets(cdp, fixture.catalog);
				if (isFreeTierQuotaTrace(trace, runtime)) {
					metadata.stoppedReason = "free-tier-quota-exhausted";
					process.stderr.write("[trajectory] Onhand Free daily quota exhausted; stopping before additional runs are misclassified.\n");
					await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
					break trajectoryCases;
				}
			}
		}
		const { results, summary } = await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
		console.log(JSON.stringify({ outDir, metadata, results, summary }, null, 2));
		if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
	} finally {
		if (cdp && fixture && !options.keepTabs) await closeFixtureTargets(cdp, fixture.catalog).catch(() => {});
		cdp?.close();
		await fixture?.close();
		if (isolatedBrowser) {
			if (options.keepBrowser) isolatedBrowser.unref();
			else isolatedBrowser.kill("SIGTERM");
		}
	}
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
});
