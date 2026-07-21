#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

function timestampSlug() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
	const args = {
		caseIds: [],
		host: DEFAULT_HOST,
		iterations: 1,
		keepTabs: false,
		outDir: "",
		port: DEFAULT_PORT,
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
		else if (value === "--host" || value.startsWith("--host=")) args.host = readValue("--host");
		else if (value === "--port" || value.startsWith("--port=")) args.port = Number(readValue("--port"));
		else if (value === "--iterations" || value.startsWith("--iterations=")) args.iterations = Number(readValue("--iterations"));
		else if (value === "--profile" || value.startsWith("--profile=")) args.profile = readValue("--profile");
		else if (value === "--suite" || value.startsWith("--suite=")) args.suitePath = resolve(readValue("--suite"));
		else if (value === "--out" || value.startsWith("--out=")) args.outDir = resolve(readValue("--out"));
		else if (value === "--timeout" || value.startsWith("--timeout=")) args.timeout = readValue("--timeout");
		else if (value === "--keep-tabs") args.keepTabs = true;
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

function runCli(args, options, { json = true } = {}) {
	const fullArgs = [CLI, ...args, "--host", options.host, "--port", String(options.port)];
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, fullArgs, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.once("error", reject);
		child.once("close", (code) => {
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

async function ask(testCase, options) {
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
	return await runCli(args, options);
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
	const fixture = await startAgentTrajectoryFixtureServer(suite);
	const cdp = await openBrowserCdp(options);
	const runtime = await getConfiguredRuntime(options);
	const metadata = {
		createdAt: new Date().toISOString(),
		suiteId: suite.suiteId,
		profile: options.profile,
		...runtime,
	};
	const traces = [];
	await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
	try {
		await closeFixtureTargets(cdp, fixture.catalog);
		trajectoryCases: for (const testCase of selected) {
			for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
				await waitForIdle(options);
				process.stderr.write(`[trajectory] ${testCase.id} iteration ${iteration}: opening fixture workspace\n`);
				await openWorkspace(cdp, testCase, fixture.catalog);
				const startedAt = Date.now();
				let trace;
				try {
					const result = await ask(testCase, options);
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
	} finally {
		if (!options.keepTabs) await closeFixtureTargets(cdp, fixture.catalog).catch(() => {});
		cdp.close();
		await fixture.close();
	}
	const { results, summary } = await persistBaselineArtifacts(outDir, metadata, traces, caseMap);
	console.log(JSON.stringify({ outDir, metadata, results, summary }, null, 2));
	if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
});
