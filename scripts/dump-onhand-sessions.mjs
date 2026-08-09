#!/usr/bin/env node

import WebSocket from "ws";
import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_HOST = process.env.ONHAND_CDP_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);
const DEFAULT_EXTENSION_ID = process.env.ONHAND_EXTENSION_ID || "hpjpjeehgbloadhdidmecpijppodibim";
const DEFAULT_LIMIT = 20;
const DEFAULT_TEXT_LIMIT = 900;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 1_000;
const FREE_TIER_QUOTA_BYPASS_MIN_LENGTH = 16;

const REPLAY_COMMANDS = new Set(["show", "timeline", "tools", "actions", "artifacts", "turn", "grep", "context"]);
const MAINTENANCE_COMMANDS = new Set(["cleanup-drivers", "reload-extension"]);
const CONTROL_COMMANDS = new Set([
	"new",
	"switch",
	"restore",
	"stop",
	"ask",
	"ask-new-url",
	"open-url",
	"artifact",
	"activate-action",
	"scroll",
	"free-tier-bypass",
	"learning-mode",
	"delete-session",
	"rename-session",
	"open-pdf-viewer",
]);
const DIAGNOSTIC_COMMANDS = new Set(["latest-errors", "tool-retries", "diff-tools", "turn-trace"]);
const ALL_COMMANDS = new Set(["list", "state", "watch", ...REPLAY_COMMANDS, ...CONTROL_COMMANDS, ...DIAGNOSTIC_COMMANDS]);

const DIAGNOSTIC_TOOL_NAMES = [
	"browser_get_selection",
	"browser_get_visible_text",
	"browser_get_viewport_headings",
	"browser_extract_content",
	"browser_pdf_search",
	"browser_pdf_read_pages",
	"browser_highlight_text",
	"browser_show_note",
	"browser_capture_state",
];

function printUsage() {
	console.log(`Usage:
  npm run debug:sessions -- list [options]
  npm run debug:sessions -- state [options]
  npm run debug:sessions -- show [--current|--latest|--session <id>|--query <text>] [options]
  npm run debug:sessions -- timeline [session selector] [options]
  npm run debug:sessions -- tools [session selector] [options]
  npm run debug:sessions -- actions [session selector] [options]
  npm run debug:sessions -- artifacts [session selector] [options]
  npm run debug:sessions -- turn --turn <n|id> [session selector] [options]
  npm run debug:sessions -- grep --query <text> [session selector] [options]
  npm run debug:sessions -- context [session selector] [options]
  npm run debug:sessions -- latest-errors [options]
  npm run debug:sessions -- tool-retries [options]
  npm run debug:sessions -- diff-tools --session-a <id> --session-b <id> [options]
  npm run debug:sessions -- open-url <url> [--new-tab] [options]
  npm run debug:sessions -- ask-new-url <url> "question" [options]  (starts a new session and always waits)
  npm run debug:sessions -- new [options]
  npm run debug:sessions -- ask "question" [--new] [--wait] [options]
  npm run debug:sessions -- stop [options]
  npm run debug:sessions -- switch <session_id|query> [options]
  npm run debug:sessions -- restore <session_id|query> [options]
  npm run debug:sessions -- artifact [--artifact-id <id>] [session selector] [options]
  npm run debug:sessions -- activate-action --key <action_key> [session selector] [options]
  npm run debug:sessions -- scroll --annotation-id <id> [--target annotation|note] [options]
  npm run debug:sessions -- free-tier-bypass <status|enable|disable|device-hash> [options]
  npm run debug:sessions -- learning-mode [on|off|status] [options]
  npm run debug:sessions -- delete-session <session_id|query> [options]
  npm run debug:sessions -- rename-session "New name" [options]
  npm run debug:sessions -- open-pdf-viewer [--tab-id <id>] [options]
  npm run debug:sessions -- turn-trace [--limit <n>] [options]
  npm run debug:sessions -- cleanup-drivers [options]
  npm run debug:sessions -- reload-extension [options]

Session selectors:
  --current              Use the current Onhand session. Default for replay commands.
  --latest               Use the most recently modified session.
  --session <id>         Use a specific session id/path.
  --query <text>         Find a session containing text in list/replay data.

Options:
  --host <host>          CDP host. Default: ${DEFAULT_HOST}
  --port <port>          CDP port. Default: ${DEFAULT_PORT}
  --extension-id <id>    Onhand extension id. Auto-detected when possible.
  --limit <n>            Session list/query limit. Default: ${DEFAULT_LIMIT}
  --url <url>            Browser URL for open-url or ask-new-url.
  --new-tab              Open URL in a fresh browser target.
  --session-a <id>       First session for diff-tools.
  --session-b <id>       Second session for diff-tools.
  --turn <n|id>          Select a turn for the turn command.
  --text-limit <n>       Max chars for text fields in human output. Default: ${DEFAULT_TEXT_LIMIT}
  --json                 Print machine-readable JSON.
  --full                 With --json, print raw replay/state payloads where available.
  --out <path>           Write output to a file instead of stdout.
  --window-id <id>       Target browser window id for page-aware commands.
  --wait                 For ask/watch, wait until completion.
  --timeout <duration>   Wait timeout, e.g. 120s, 2m, 5000ms. Default: 120s.
  --poll <duration>      Poll interval for wait/watch. Default: 1s.
  --new                  For ask, start a new session before submitting.
  --prompt <text>        Prompt text for ask.
  --prompt-file <path>   Read ask prompt from a file. Use - for stdin.
  --display-prompt <txt> Store a different visible prompt title.
  --eval-variant <name>  Label for a prompt-eval candidate variant.
  --eval-system-append <text>
                          Append temporary system policy text for source=prompt-eval asks.
  --eval-system-append-file <path>
                          Read temporary system policy append text from a file.
  --eval-launcher-append <text>
                          Append temporary launcher policy text for source=prompt-eval asks.
  --eval-launcher-append-file <path>
                          Read temporary launcher policy append text from a file.
  --artifact-id <id>     Fetch a specific replay artifact.
  --key <action_key>     Page action key for activate-action.
  --annotation-id <id>   Annotation id for scroll.
  --target <kind>        scroll target: annotation or note.
  --learning             Submit ask with learning mode enabled.
  --tab-id <id>          Target tab id for open-pdf-viewer.
  -h, --help             Show this help.

Learning mode:
  learning-mode on/off persists the sidebar Learning toggle (same as clicking
  it). status (the default) prints the current mode plus the learner state:
  open checks, introduced concepts, and recent check resolutions.

Turn traces:
  turn-trace prints the runtime's redacted per-turn decision traces (routing
  predicates, every tool call with its guardrail/error state, and
  provisionalAnswerExposed), newest first. Survives worker restarts.

Free-tier bypass:
  enable reads ONHAND_FREE_QUOTA_BYPASS_SECRET from the shell and stores it in
  extension-local storage. status never prints the secret value. device-hash
  prints the allowlist value for the current anonymous free-tier token.

The target browser must be running with a remote debugging port, for example:
  /Applications/Helium.app/Contents/MacOS/Helium --remote-debugging-port=${DEFAULT_PORT}
`);
}

function parseDurationMs(value, optionName) {
	const raw = String(value || "").trim().toLowerCase();
	const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
	if (!match) throw new Error(`${optionName} must be a duration like 1000ms, 1s, or 2m.`);
	const number = Number(match[1]);
	const unit = match[2] || "ms";
	const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
	const ms = Math.floor(number * multiplier);
	if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${optionName} must be positive.`);
	return ms;
}

function parseArgs(argv) {
	const args = {
		command: "list",
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		extensionId: DEFAULT_EXTENSION_ID,
		limit: DEFAULT_LIMIT,
		textLimit: DEFAULT_TEXT_LIMIT,
		json: false,
		full: false,
		current: false,
		latest: false,
		newSession: false,
		wait: false,
		learningMode: false,
		sessionId: "",
		sessionA: "",
		sessionB: "",
		query: "",
		url: "",
		newTab: false,
		turn: "",
		out: "",
		prompt: "",
		promptFile: "",
		displayPrompt: "",
		evalVariant: "",
		evalSystemPromptAppend: "",
		evalSystemPromptAppendFile: "",
		evalLauncherPromptAppend: "",
		evalLauncherPromptAppendFile: "",
		artifactId: "",
		key: "",
		annotationId: "",
		target: "annotation",
		source: "cli",
		windowId: undefined,
		timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
		pollMs: DEFAULT_POLL_MS,
		positional: [],
	};
	const values = [...argv];
	if (values[0] && !values[0].startsWith("-")) args.command = values.shift();
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		const readValue = (name) => {
			const inline = value.startsWith(`${name}=`) ? value.slice(name.length + 1) : "";
			if (inline) return inline;
			const next = values[index + 1];
			if (!next || next.startsWith("-")) throw new Error(`${name} requires a value.`);
			index += 1;
			return next;
		};
		if (value === "-h" || value === "--help") {
			printUsage();
			process.exit(0);
		} else if (value === "--json") {
			args.json = true;
		} else if (value === "--full") {
			args.full = true;
		} else if (value === "--current") {
			args.current = true;
		} else if (value === "--latest") {
			args.latest = true;
		} else if (value === "--new") {
			args.newSession = true;
		} else if (value === "--new-tab") {
			args.newTab = true;
		} else if (value === "--wait") {
			args.wait = true;
		} else if (value === "--learning") {
			args.learningMode = true;
		} else if (value === "--host" || value.startsWith("--host=")) {
			args.host = readValue("--host");
		} else if (value === "--port" || value.startsWith("--port=")) {
			const port = Number(readValue("--port"));
			if (!Number.isFinite(port) || port <= 0) throw new Error("--port must be a positive number.");
			args.port = port;
		} else if (value === "--extension-id" || value.startsWith("--extension-id=")) {
			args.extensionId = readValue("--extension-id");
		} else if (value === "--limit" || value.startsWith("--limit=")) {
			const limit = Number(readValue("--limit"));
			if (!Number.isFinite(limit) || limit <= 0) throw new Error("--limit must be a positive number.");
			args.limit = Math.floor(limit);
		} else if (value === "--text-limit" || value.startsWith("--text-limit=")) {
			const limit = Number(readValue("--text-limit"));
			if (!Number.isFinite(limit) || limit <= 0) throw new Error("--text-limit must be a positive number.");
			args.textLimit = Math.floor(limit);
		} else if (value === "--timeout" || value.startsWith("--timeout=")) {
			args.timeoutMs = parseDurationMs(readValue("--timeout"), "--timeout");
		} else if (value === "--poll" || value.startsWith("--poll=")) {
			args.pollMs = parseDurationMs(readValue("--poll"), "--poll");
		} else if (value === "--session" || value.startsWith("--session=")) {
			args.sessionId = readValue("--session");
		} else if (value === "--query" || value.startsWith("--query=")) {
			args.query = readValue("--query");
		} else if (value === "--url" || value.startsWith("--url=")) {
			args.url = readValue("--url");
		} else if (value === "--session-a" || value.startsWith("--session-a=")) {
			args.sessionA = readValue("--session-a");
		} else if (value === "--session-b" || value.startsWith("--session-b=")) {
			args.sessionB = readValue("--session-b");
		} else if (value === "--turn" || value.startsWith("--turn=")) {
			args.turn = readValue("--turn");
		} else if (value === "--out" || value.startsWith("--out=")) {
			args.out = readValue("--out");
		} else if (value === "--prompt" || value.startsWith("--prompt=")) {
			args.prompt = readValue("--prompt");
		} else if (value === "--prompt-file" || value.startsWith("--prompt-file=")) {
			args.promptFile = readValue("--prompt-file");
		} else if (value === "--display-prompt" || value.startsWith("--display-prompt=")) {
			args.displayPrompt = readValue("--display-prompt");
		} else if (value === "--eval-variant" || value.startsWith("--eval-variant=")) {
			args.evalVariant = readValue("--eval-variant");
		} else if (value === "--eval-system-append" || value.startsWith("--eval-system-append=")) {
			args.evalSystemPromptAppend = readValue("--eval-system-append");
		} else if (value === "--eval-system-append-file" || value.startsWith("--eval-system-append-file=")) {
			args.evalSystemPromptAppendFile = readValue("--eval-system-append-file");
		} else if (value === "--eval-launcher-append" || value === "--eval-policy-append" || value.startsWith("--eval-launcher-append=") || value.startsWith("--eval-policy-append=")) {
			args.evalLauncherPromptAppend = readValue(value.startsWith("--eval-policy-append") ? "--eval-policy-append" : "--eval-launcher-append");
		} else if (value === "--eval-launcher-append-file" || value === "--eval-policy-append-file" || value.startsWith("--eval-launcher-append-file=") || value.startsWith("--eval-policy-append-file=")) {
			args.evalLauncherPromptAppendFile = readValue(value.startsWith("--eval-policy-append-file") ? "--eval-policy-append-file" : "--eval-launcher-append-file");
		} else if (value === "--artifact-id" || value === "--artifact" || value.startsWith("--artifact-id=") || value.startsWith("--artifact=")) {
			args.artifactId = readValue(value.startsWith("--artifact") && !value.startsWith("--artifact-id") ? "--artifact" : "--artifact-id");
		} else if (value === "--key" || value.startsWith("--key=")) {
			args.key = readValue("--key");
		} else if (value === "--annotation-id" || value.startsWith("--annotation-id=")) {
			args.annotationId = readValue("--annotation-id");
		} else if (value === "--target" || value.startsWith("--target=")) {
			const target = readValue("--target");
			if (!["annotation", "note"].includes(target)) throw new Error("--target must be annotation or note.");
			args.target = target;
		} else if (value === "--source" || value.startsWith("--source=")) {
			args.source = readValue("--source");
		} else if (value === "--window-id" || value.startsWith("--window-id=")) {
			const windowId = Number(readValue("--window-id"));
			if (!Number.isFinite(windowId)) throw new Error("--window-id must be a number.");
			args.windowId = windowId;
		} else if (value === "--tab-id" || value.startsWith("--tab-id=")) {
			const tabId = Number(readValue("--tab-id"));
			if (!Number.isFinite(tabId)) throw new Error("--tab-id must be a number.");
			args.tabId = tabId;
		} else if (!value.startsWith("-")) {
			args.positional.push(value);
		} else {
			throw new Error(`Unknown option: ${value}`);
		}
	}
	if (!ALL_COMMANDS.has(args.command) && !MAINTENANCE_COMMANDS.has(args.command)) throw new Error(`Unknown command: ${args.command}`);
	if (args.command === "ask" && !args.prompt && args.positional.length) args.prompt = args.positional.join(" ");
	if ((args.command === "open-url" || args.command === "ask-new-url") && !args.url && args.positional.length) args.url = args.positional.shift();
	if (args.command === "ask-new-url" && !args.prompt && args.positional.length) args.prompt = args.positional.join(" ");
	if (args.command === "diff-tools") {
		if (!args.sessionA && args.positional[0]) args.sessionA = args.positional[0];
		if (!args.sessionB && args.positional[1]) args.sessionB = args.positional[1];
	}
	if (args.command === "grep" && !args.query && args.positional.length) args.query = args.positional.join(" ");
	if (args.command === "turn" && !args.turn && args.positional.length) args.turn = args.positional[0];
	if ((args.command === "switch" || args.command === "restore" || args.command === "delete-session") && !args.sessionId && !args.query && args.positional.length) {
		const selector = args.positional.join(" ");
		if (selector.startsWith("session_")) args.sessionId = selector;
		else args.query = selector;
	}
	if (args.command === "artifact" && !args.artifactId && args.positional[0]?.startsWith("artifact_")) args.artifactId = args.positional.shift();
	if (args.command === "activate-action" && !args.key && args.positional.length) args.key = args.positional[0];
	if (args.command === "scroll" && !args.annotationId && args.positional.length) args.annotationId = args.positional[0];
	return args;
}

async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
	return await response.json();
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 1;
		this.pending = new Map();
		ws.on("message", (raw) => {
			const message = JSON.parse(raw);
			if (!message.id || !this.pending.has(message.id)) return;
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new Error(message.error.message + (message.error.data ? `: ${message.error.data}` : "")));
			} else {
				pending.resolve(message.result);
			}
		});
	}

	send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	close() {
		this.ws.close();
	}
}

async function evaluateJson(cdp, sessionId, expression) {
	const result = await cdp.send(
		"Runtime.evaluate",
		{
			expression,
			awaitPromise: true,
			returnByValue: true,
		},
		sessionId,
	);
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed.");
	}
	const value = result.result?.value;
	return typeof value === "string" ? JSON.parse(value) : value;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function driverTargetScore(target, extensionId) {
	const url = String(target?.url || "");
	if (!url.startsWith(`chrome-extension://${extensionId}/`)) return Number.POSITIVE_INFINITY;
	if (target.type === "page" && url.includes("/sidepanel.html") && /[?&]driver=1\b/.test(url)) return 0;
	if (target.type === "page" && url.includes("/sidepanel.html")) return Number.POSITIVE_INFINITY;
	return Number.POSITIVE_INFINITY;
}

async function waitForExtensionMessaging(cdp, sessionId) {
	const deadline = Date.now() + 5000;
	let lastError = null;
	while (Date.now() < deadline) {
		try {
			const status = await evaluateJson(
				cdp,
				sessionId,
				`JSON.stringify({sendMessage:typeof globalThis.chrome?.runtime?.sendMessage})`,
			);
			if (status?.sendMessage === "function") return;
		} catch (error) {
			lastError = error;
		}
		await sleep(100);
	}
	throw lastError || new Error("Timed out waiting for chrome.runtime.sendMessage.");
}

async function reloadExtensionRuntime(cdp, driver) {
	const response = await evaluateJson(
		cdp,
		driver.sessionId,
		`JSON.stringify((()=>{ setTimeout(()=>globalThis.chrome.runtime.reload(), 0); return { ok: true, action: "reload-extension" }; })())`,
	);
	await sleep(1000);
	return response;
}

async function openDriverTarget(cdp, extensionId, target, shouldCloseTarget = false) {
	const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
	const sessionId = attached.sessionId;
	await cdp.send("Runtime.enable", {}, sessionId).catch(() => {});
	await waitForExtensionMessaging(cdp, sessionId);
	const sendMessage = async (payload) =>
		await evaluateJson(
			cdp,
			sessionId,
			`(async()=>JSON.stringify(await globalThis.chrome.runtime.sendMessage(${JSON.stringify(payload)})))()`,
		);
	const status = await sendMessage({ type: "get-status" });
	if (!status?.ok || status?.status?.runtime !== "browser-extension") {
		throw new Error(`Extension ${extensionId} did not respond like Onhand.`);
	}
	return { extensionId, targetId: target.targetId, sessionId, sendMessage, shouldCloseTarget };
}

async function createDriverTarget(cdp, extensionId) {
	const driverUrl = `chrome-extension://${extensionId}/sidepanel.html?driver=1&onhand-session-dump=1`;
	const { targetId } = await cdp.send("Target.createTarget", { url: driverUrl, background: true });
	return { targetId, url: driverUrl, type: "page", title: "Onhand session dump driver" };
}

async function openDriverForExtension(cdp, extensionId, targets = []) {
	const candidates = targets
		.filter((target) => Number.isFinite(driverTargetScore(target, extensionId)))
		.sort((left, right) => driverTargetScore(left, extensionId) - driverTargetScore(right, extensionId));
	const failures = [];
	for (const target of candidates) {
		try {
			return await openDriverTarget(cdp, extensionId, target, false);
		} catch (error) {
			failures.push(`${target.type || "target"} ${target.url || target.targetId}: ${error.message}`);
		}
	}
	const createdTarget = await createDriverTarget(cdp, extensionId);
	try {
		return await openDriverTarget(cdp, extensionId, createdTarget, true);
	} catch (error) {
		failures.push(`${createdTarget.url}: ${error.message}`);
		throw new Error(failures.join("; "));
	}
}

function extensionIdsFromTargets(targets) {
	const ids = [];
	for (const target of targets) {
		const match = String(target.url || "").match(/^chrome-extension:\/\/([a-p]{32})\//);
		if (match && !ids.includes(match[1])) ids.push(match[1]);
	}
	if (DEFAULT_EXTENSION_ID && !ids.includes(DEFAULT_EXTENSION_ID)) ids.push(DEFAULT_EXTENSION_ID);
	return ids;
}

async function openOnhandDriver(args) {
	const cdp = await openBrowserCdp(args);
	try {
		const targets = (await cdp.send("Target.getTargets")).targetInfos || [];
		const preferred = [];
		if (args.extensionId) preferred.push(args.extensionId);
		for (const id of extensionIdsFromTargets(targets)) if (!preferred.includes(id)) preferred.push(id);
		const failures = [];
		for (const extensionId of preferred) {
			try {
				const driver = await openDriverForExtension(cdp, extensionId, targets);
				return { cdp, driver };
			} catch (error) {
				failures.push(`${extensionId}: ${error.message}`);
			}
		}
		throw new Error(`Could not find a live Onhand extension. Tried: ${failures.join("; ")}`);
	} catch (error) {
		cdp.close();
		throw error;
	}
}

async function openBrowserCdp(args) {
	const version = await fetchJson(`http://${args.host}:${args.port}/json/version`);
	return new Cdp(await connect(version.webSocketDebuggerUrl));
}

async function openUrlInBrowser(args) {
	if (!args.url) throw new Error("open-url requires a URL positional argument or --url.");
	const cdp = await openBrowserCdp(args);
	try {
		const { targetId } = await cdp.send("Target.createTarget", { url: args.url, background: false });
		await sleep(750);
		const targets = (await cdp.send("Target.getTargets")).targetInfos || [];
		const target = targets.find((entry) => entry.targetId === targetId) || {};
		return {
			ok: true,
			targetId,
			type: target.type || "page",
			title: target.title || "",
			url: target.url || args.url,
		};
	} finally {
		cdp.close();
	}
}

function formatOpenUrlResult(result) {
	const lines = [`Opened browser target: ${result.targetId || "(unknown)"}`];
	if (result.title) lines.push(`Title: ${result.title}`);
	if (result.url) lines.push(`URL: ${result.url}`);
	return `${lines.join("\n")}\n`;
}

function truncateText(value, max = DEFAULT_TEXT_LIMIT) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}

function truncateBlock(value, max = DEFAULT_TEXT_LIMIT) {
	const text = String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim();
	return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}

function jsonBlock(value, max = DEFAULT_TEXT_LIMIT) {
	return truncateBlock(JSON.stringify(value ?? null, null, 2), max);
}

function durationMs(startedAt, endedAt) {
	const start = Date.parse(startedAt || "");
	const end = Date.parse(endedAt || "");
	if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
	const ms = Math.max(0, end - start);
	return `${ms}ms`;
}

function firstErrorLine(error) {
	return String(error?.message || error || "").split("\n")[0] || "Unknown error";
}

function countBy(items, predicate) {
	return items.filter(predicate).length;
}

function summarizeAction(action, textLimit = 500) {
	return {
		type: action?.type || "",
		key: action?.key || "",
		label: action?.label || "",
		toolHint: String(action?.key || "").split(":")[0] || "",
		annotationId: action?.annotationId || null,
		artifactId: action?.artifactId || null,
		title: action?.title || "",
		url: action?.url || "",
		text: truncateText(action?.citationText || action?.detail || "", textLimit),
		noteText: truncateText(action?.noteText || "", textLimit),
	};
}

function allTurnTools(turn) {
	const activities = Array.isArray(turn?.activities) ? turn.activities : [];
	const traces = Array.isArray(turn?.toolTraces) ? turn.toolTraces : [];
	const tools = traces.map((trace) => ({
		source: "trace",
		turnId: turn?.id || "",
		toolCallId: trace.toolCallId || "",
		toolName: trace.toolName || "",
		state: trace.state || "",
		startedAt: trace.startedAt || "",
		endedAt: trace.endedAt || "",
		duration: durationMs(trace.startedAt, trace.endedAt),
		args: trace.args ?? null,
		effectiveArgs: trace.effectiveArgs ?? null,
		resultSummary: trace.resultSummary || "",
		resultDetails: trace.resultDetails ?? null,
		error: trace.error || "",
	}));
	for (const activity of activities) {
		if (!activity?.toolName) continue;
		if (tools.some((tool) => tool.toolName === activity.toolName && (!activity.id || tool.toolCallId === activity.id || `tool:${tool.toolCallId}` === activity.id))) {
			continue;
		}
		tools.push({
			source: "activity",
			turnId: turn?.id || "",
			toolCallId: activity.id || "",
			toolName: activity.toolName || "",
			state: activity.state || "",
			startedAt: "",
			endedAt: "",
			duration: "",
			args: null,
			effectiveArgs: null,
			resultSummary: activity.label || "",
			resultDetails: null,
			error: activity.error || "",
		});
	}
	return tools;
}

function summarizeTurn(turn, index, textLimit = DEFAULT_TEXT_LIMIT) {
	const pageActions = Array.isArray(turn?.pageActions) ? turn.pageActions : [];
	const tools = allTurnTools(turn);
	const calledTools = new Set(tools.map((tool) => tool.toolName).filter(Boolean));
	return {
		index: index + 1,
		id: turn?.id || "",
		createdAt: turn?.createdAt || "",
		error: Boolean(turn?.error),
		pending: Boolean(turn?.pending),
		userPrompt: truncateBlock(turn?.userPrompt || "", textLimit),
		reply: truncateBlock(turn?.reply || "", textLimit),
		tools,
		diagnosticToolsNotCalled: DIAGNOSTIC_TOOL_NAMES.filter((name) => !calledTools.has(name)),
		pageActions: pageActions.map((action) => summarizeAction(action, textLimit)),
	};
}

function summarizeReplay(replay, textLimit = DEFAULT_TEXT_LIMIT) {
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const pageActions = Array.isArray(replay.pageActions) ? replay.pageActions : [];
	const allTools = new Map();
	for (const turn of turns) {
		for (const tool of allTurnTools(turn)) {
			if (!tool.toolName) continue;
			const key = `${tool.toolName}:${tool.state || ""}`;
			allTools.set(key, {
				toolName: tool.toolName,
				state: tool.state || "",
				count: (allTools.get(key)?.count || 0) + 1,
			});
		}
	}
	return {
		session: replay.session || replay.currentSession || null,
		currentSession: replay.currentSession || null,
		counts: {
			turns: turns.length,
			pageActions: pageActions.length,
			artifacts: Array.isArray(replay.artifacts) ? replay.artifacts.length : 0,
			replayableAnnotations: Array.isArray(replay.replayableAnnotations) ? replay.replayableAnnotations.length : 0,
		},
		toolTotals: Array.from(allTools.values()).sort((left, right) => left.toolName.localeCompare(right.toolName) || left.state.localeCompare(right.state)),
		turns: turns.map((turn, index) => summarizeTurn(turn, index, textLimit)),
		pageActions: pageActions.map((action) => summarizeAction(action, textLimit)),
		artifacts: replay.artifacts || [],
		replayableAnnotations: replay.replayableAnnotations || [],
	};
}

function stringSize(value) {
	if (value == null) return 0;
	if (typeof value === "string") return value.length;
	return JSON.stringify(value).length;
}

function turnContextMetrics(turn, index) {
	const tools = allTurnTools(turn);
	const metrics = {
		index: index + 1,
		id: turn?.id || "",
		createdAt: turn?.createdAt || "",
		promptChars: stringSize(turn?.userPrompt || ""),
		replyChars: stringSize(turn?.reply || ""),
		toolCount: tools.length,
		toolResultSummaryChars: 0,
		toolResultDetailsChars: 0,
		toolArgChars: 0,
		pageActionChars: 0,
		tools: [],
	};
	for (const tool of tools) {
		const summaryChars = stringSize(tool.resultSummary || "");
		const detailsChars = stringSize(tool.resultDetails);
		const argChars = stringSize(tool.args);
		metrics.toolResultSummaryChars += summaryChars;
		metrics.toolResultDetailsChars += detailsChars;
		metrics.toolArgChars += argChars;
		metrics.tools.push({
			toolName: tool.toolName || "",
			state: tool.state || "",
			resultSummaryChars: summaryChars,
			resultDetailsChars: detailsChars,
			argChars,
			errorChars: stringSize(tool.error || ""),
		});
	}
	for (const action of Array.isArray(turn?.pageActions) ? turn.pageActions : []) {
		metrics.pageActionChars += stringSize(action?.citationText || "") + stringSize(action?.detail || "") + stringSize(action?.noteText || "");
	}
	metrics.totalRecordedChars =
		metrics.promptChars +
		metrics.replyChars +
		metrics.toolResultSummaryChars +
		metrics.toolResultDetailsChars +
		metrics.toolArgChars +
		metrics.pageActionChars;
	return metrics;
}

function replayContextMetrics(replay) {
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const turnMetrics = turns.map((turn, index) => turnContextMetrics(turn, index));
	const totals = {
		turns: turnMetrics.length,
		promptChars: 0,
		replyChars: 0,
		toolCount: 0,
		toolResultSummaryChars: 0,
		toolResultDetailsChars: 0,
		toolArgChars: 0,
		pageActionChars: 0,
		totalRecordedChars: 0,
	};
	for (const turn of turnMetrics) {
		for (const key of Object.keys(totals)) {
			if (key === "turns") continue;
			totals[key] += Number(turn[key] || 0);
		}
	}
	return {
		session: replay.session || replay.currentSession || null,
		totals,
		turns: turnMetrics,
	};
}

function formatContextMetrics(metrics) {
	const session = metrics.session || {};
	const lines = [
		`Context telemetry: ${session.id || session.path || session.sessionId || "(unknown)"}`,
		`Totals: turns=${metrics.totals.turns} tools=${metrics.totals.toolCount} recordedChars=${metrics.totals.totalRecordedChars}`,
		`Breakdown: prompts=${metrics.totals.promptChars} replies=${metrics.totals.replyChars} toolSummaries=${metrics.totals.toolResultSummaryChars} toolDetails=${metrics.totals.toolResultDetailsChars} toolArgs=${metrics.totals.toolArgChars} pageActions=${metrics.totals.pageActionChars}`,
		"",
	];
	for (const turn of metrics.turns) {
		lines.push(
			`Turn ${turn.index}: recordedChars=${turn.totalRecordedChars} prompt=${turn.promptChars} reply=${turn.replyChars} tools=${turn.toolCount} toolSummaries=${turn.toolResultSummaryChars} toolDetails=${turn.toolResultDetailsChars}`,
		);
		const largestTools = [...turn.tools]
			.sort((left, right) => right.resultDetailsChars + right.resultSummaryChars - (left.resultDetailsChars + left.resultSummaryChars))
			.slice(0, 4);
		for (const tool of largestTools) {
			lines.push(`  - ${tool.toolName || "(unknown)"}:${tool.state || "unknown"} summary=${tool.resultSummaryChars} details=${tool.resultDetailsChars} args=${tool.argChars}`);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function formatSessionList(list) {
	const sessions = Array.isArray(list.sessions) ? list.sessions : [];
	const lines = [
		`Current session: ${list.currentSession?.sessionId || "(unknown)"} ${list.currentSession?.sessionName ? `- ${list.currentSession.sessionName}` : ""}`.trim(),
		`Sessions (${sessions.length}):`,
	];
	for (const session of sessions) {
		const marker = session.isCurrent ? "*" : "-";
		lines.push(
			`${marker} ${session.id} | ${session.modifiedAt || ""} | turns=${session.turnCount || 0} actions=${session.pageActionCount || 0} highlights=${session.highlightCount || 0} notes=${session.noteCount || 0}`,
		);
		lines.push(`  ${truncateText(session.title || "", 140)}`);
		if (session.preview && session.preview !== session.title) lines.push(`  preview: ${truncateText(session.preview, 160)}`);
	}
	return `${lines.join("\n")}\n`;
}

function formatReplaySummary(summary) {
	const session = summary.session || {};
	const lines = [
		`Session: ${session.id || session.path || session.sessionId || "(unknown)"}`,
		`Title: ${session.title || session.name || session.sessionName || "(untitled)"}`,
		`Modified: ${session.modifiedAt || ""}`,
		`Counts: turns=${summary.counts.turns}, pageActions=${summary.counts.pageActions}, artifacts=${summary.counts.artifacts}, replayableAnnotations=${summary.counts.replayableAnnotations}`,
		"",
		"Tool Totals:",
	];
	if (summary.toolTotals.length) {
		for (const tool of summary.toolTotals) lines.push(`- ${tool.toolName} ${tool.state || "(no state)"}: ${tool.count}`);
	} else {
		lines.push("- none recorded");
	}
	for (const turn of summary.turns) {
		lines.push("", `Turn ${turn.index}: ${turn.createdAt}${turn.error ? " [error]" : ""}${turn.pending ? " [pending]" : ""}`, `User: ${turn.userPrompt || "(blank)"}`);
		if (turn.tools.length) {
			lines.push(`Tools: ${turn.tools.map((tool) => `${tool.toolName}:${tool.state || "unknown"}`).join(", ")}`);
		} else {
			lines.push("Tools: none recorded");
		}
		lines.push(`Diagnostic tools not called: ${turn.diagnosticToolsNotCalled.join(", ") || "none"}`);
		const anchors = turn.pageActions.filter((action) => action.type === "annotation" || action.type === "note" || action.type === "artifact");
		if (anchors.length) {
			lines.push("Page actions:");
			for (const action of anchors) lines.push(`- ${action.label || action.type}: ${action.text}`);
		}
		if (turn.reply) lines.push(`Reply: ${turn.reply}`);
	}
	if (summary.replayableAnnotations.length) {
		lines.push("", "Replayable Annotations:");
		for (const annotation of summary.replayableAnnotations) {
			lines.push(`- ${truncateText(annotation.matchedText || "", 220)}${annotation.noteText ? ` | note: ${truncateText(annotation.noteText, 180)}` : ""}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function formatTimeline(replay, textLimit) {
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const session = replay.session || replay.currentSession || {};
	const lines = [`Timeline: ${session.id || session.path || session.sessionId || "(unknown)"}`, ""];
	for (const [index, turn] of turns.entries()) {
		const actions = Array.isArray(turn.pageActions) ? turn.pageActions : [];
		const tools = allTurnTools(turn);
		lines.push(`Turn ${index + 1} ${turn.id || ""} ${turn.createdAt || ""}${turn.error ? " [error]" : ""}`);
		lines.push(`  User: ${truncateText(turn.userPrompt || "", textLimit) || "(blank)"}`);
		lines.push(`  Reply: ${truncateText(turn.reply || "", textLimit) || "(blank)"}`);
		lines.push(
			`  Tools: ${tools.length ? tools.map((tool) => `${tool.toolName}:${tool.state || "unknown"}`).join(", ") : "none"}`,
		);
		lines.push(
			`  Actions: total=${actions.length} highlights=${countBy(actions, (action) => action?.type === "annotation")} notes=${countBy(actions, (action) => action?.type === "note")} artifacts=${countBy(actions, (action) => action?.type === "artifact")}`,
		);
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function formatTools(replay, textLimit) {
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const lines = ["Tool Calls:"];
	let count = 0;
	for (const [index, turn] of turns.entries()) {
		for (const tool of allTurnTools(turn)) {
			count += 1;
			lines.push("", `${count}. Turn ${index + 1} ${tool.toolName || "(unknown)"} ${tool.state || ""} ${tool.duration || ""}`.trim());
			if (tool.toolCallId) lines.push(`   id: ${tool.toolCallId}`);
			if (tool.startedAt || tool.endedAt) lines.push(`   time: ${tool.startedAt || "?"}${tool.endedAt ? ` -> ${tool.endedAt}` : ""}`);
			if (tool.args != null) lines.push(`   requested args: ${jsonBlock(tool.args, Math.min(textLimit, 1600))}`);
			if (tool.effectiveArgs != null) lines.push(`   effective args: ${jsonBlock(tool.effectiveArgs, Math.min(textLimit, 1600))}`);
			if (tool.resultSummary) lines.push(`   result: ${truncateBlock(tool.resultSummary, textLimit)}`);
			if (tool.error) lines.push(`   error: ${truncateBlock(tool.error, textLimit)}`);
		}
	}
	if (!count) lines.push("- none recorded");
	return `${lines.join("\n")}\n`;
}

function formatActions(replay, textLimit) {
	const pageActions = Array.isArray(replay.pageActions) ? replay.pageActions : [];
	const lines = [`Page Actions (${pageActions.length}):`];
	for (const [index, action] of pageActions.entries()) {
		lines.push("", `${index + 1}. ${action.type || "(unknown)"} ${action.label || ""}`.trim());
		if (action.key) lines.push(`   key: ${action.key}`);
		if (action.annotationId) lines.push(`   annotationId: ${action.annotationId}`);
		if (action.artifactId) lines.push(`   artifactId: ${action.artifactId}`);
		if (action.title || action.url) lines.push(`   page: ${truncateText(action.title || "", 120)} ${action.url || ""}`.trim());
		if (action.citationText || action.detail) lines.push(`   text: ${truncateBlock(action.citationText || action.detail, textLimit)}`);
		if (action.noteText) lines.push(`   note: ${truncateBlock(action.noteText, textLimit)}`);
	}
	return `${lines.join("\n")}\n`;
}

function formatArtifacts(replay, textLimit) {
	const artifacts = Array.isArray(replay.artifacts) ? replay.artifacts : [];
	const lines = [`Artifacts (${artifacts.length}):`];
	for (const [index, artifact] of artifacts.entries()) {
		const id = artifact.artifactId || artifact.id || "";
		lines.push("", `${index + 1}. ${artifact.title || artifact.name || id || "(untitled)"}`);
		if (id) lines.push(`   artifactId: ${id}`);
		if (artifact.kind || artifact.type) lines.push(`   type: ${artifact.kind || artifact.type}`);
		if (artifact.createdAt || artifact.updatedAt) lines.push(`   time: ${artifact.createdAt || ""}${artifact.updatedAt ? ` updated=${artifact.updatedAt}` : ""}`);
		if (artifact.url) lines.push(`   url: ${artifact.url}`);
		if (artifact.preview || artifact.summary) lines.push(`   preview: ${truncateBlock(artifact.preview || artifact.summary, textLimit)}`);
	}
	if (!artifacts.length) lines.push("- none");
	return `${lines.join("\n")}\n`;
}

function artifactTextFields(artifact) {
	const fields = [];
	const visit = (value, path, depth) => {
		if (value == null || depth > 4) return;
		if (typeof value === "string") {
			const text = value.trim();
			if (text.length > 40 && !/^data:/i.test(text)) fields.push({ path, text });
			return;
		}
		if (Array.isArray(value)) {
			for (const [index, entry] of value.slice(0, 12).entries()) visit(entry, `${path}[${index}]`, depth + 1);
			return;
		}
		if (typeof value === "object") {
			for (const [key, entry] of Object.entries(value).slice(0, 40)) {
				if (/^(data|dataUrl|screenshot|image|html)$/i.test(key) && typeof entry === "string") continue;
				visit(entry, path ? `${path}.${key}` : key, depth + 1);
			}
		}
	};
	visit(artifact, "", 0);
	return fields;
}

function formatArtifactDetail(response, textLimit) {
	const artifact = response.artifact || response;
	const lines = [
		`Artifact: ${artifact.artifactId || artifact.id || "(unknown)"}`,
		`Title: ${artifact.title || artifact.label || artifact.name || "(untitled)"}`,
	];
	if (artifact.url) lines.push(`URL: ${artifact.url}`);
	if (artifact.createdAt || artifact.updatedAt) lines.push(`Time: ${artifact.createdAt || ""}${artifact.updatedAt ? ` updated=${artifact.updatedAt}` : ""}`);
	const fields = artifactTextFields(artifact).filter((field) => !["artifactId", "id", "title", "label", "name", "url", "createdAt", "updatedAt"].includes(field.path));
	if (fields.length) {
		lines.push("", "Text Fields:");
		for (const field of fields.slice(0, 16)) {
			lines.push(`- ${field.path}: ${truncateBlock(field.text, textLimit)}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function selectTurn(replay, selector) {
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const raw = String(selector || "").trim();
	if (!raw) return turns.at(-1) || null;
	const index = Number(raw);
	if (Number.isInteger(index) && index > 0) return turns[index - 1] || null;
	return turns.find((turn) => turn?.id === raw || String(turn?.id || "").startsWith(raw)) || null;
}

function formatTurn(replay, args) {
	const turn = selectTurn(replay, args.turn);
	if (!turn) throw new Error(`Turn not found: ${args.turn || "(latest)"}`);
	const turns = Array.isArray(replay.turns) ? replay.turns : [];
	const index = Math.max(0, turns.indexOf(turn)) + 1;
	const actions = Array.isArray(turn.pageActions) ? turn.pageActions : [];
	const errorReport = turn.errorReport && typeof turn.errorReport === "object" ? turn.errorReport : null;
	const lines = [
		`Turn ${index}: ${turn.id || ""}`,
		`Created: ${turn.createdAt || ""}${turn.error ? " [error]" : ""}${turn.pending ? " [pending]" : ""}`,
		"",
		"User:",
		truncateBlock(turn.userPrompt || "", args.textLimit) || "(blank)",
		"",
		"Reply:",
		truncateBlock(turn.reply || "", args.textLimit) || "(blank)",
		"",
	];
	if (errorReport) {
		lines.push(
			"Error Report:",
			`kind: ${errorReport.error_kind || "(unknown)"}`,
			`message: ${truncateBlock(errorReport.error_message || "", args.textLimit) || "(blank)"}`,
			`provider: ${errorReport.ai_provider || ""}/${errorReport.ai_model || ""}`,
			"",
		);
	}
	lines.push(formatTools({ turns: [turn] }, args.textLimit).trimEnd(), "", `Page Actions (${actions.length}):`);
	for (const [actionIndex, action] of actions.entries()) {
		lines.push(`${actionIndex + 1}. ${action.type || "(unknown)"} ${action.label || ""}`.trim());
		if (action.citationText || action.detail) lines.push(`   ${truncateBlock(action.citationText || action.detail, args.textLimit)}`);
		if (action.noteText) lines.push(`   note: ${truncateBlock(action.noteText, args.textLimit)}`);
	}
	return `${lines.join("\n")}\n`;
}

function addMatch(matches, source, label, text, textLimit) {
	const clean = String(text || "").trim();
	if (!clean) return;
	matches.push({ source, label, text: truncateBlock(clean, textLimit) });
}

function collectGrepMatches(replay, query, textLimit) {
	const needle = String(query || "").toLowerCase();
	if (!needle) throw new Error("grep requires --query or positional search text.");
	const matches = [];
	const contains = (value) => String(value || "").toLowerCase().includes(needle);
	for (const [turnIndex, turn] of (Array.isArray(replay.turns) ? replay.turns : []).entries()) {
		if (contains(turn.userPrompt)) addMatch(matches, "turn", `Turn ${turnIndex + 1} user`, turn.userPrompt, textLimit);
		if (contains(turn.reply)) addMatch(matches, "turn", `Turn ${turnIndex + 1} reply`, turn.reply, textLimit);
		for (const [toolIndex, tool] of allTurnTools(turn).entries()) {
			if (contains(tool.toolName) || contains(tool.resultSummary) || contains(JSON.stringify(tool.args || {}))) {
				addMatch(matches, "tool", `Turn ${turnIndex + 1} tool ${toolIndex + 1} ${tool.toolName}`, tool.resultSummary || JSON.stringify(tool.args || {}), textLimit);
			}
		}
		for (const [actionIndex, action] of (Array.isArray(turn.pageActions) ? turn.pageActions : []).entries()) {
			const text = [action.label, action.citationText, action.detail, action.noteText].filter(Boolean).join("\n");
			if (contains(text)) addMatch(matches, "action", `Turn ${turnIndex + 1} action ${actionIndex + 1} ${action.type || ""}`, text, textLimit);
		}
	}
	for (const [actionIndex, action] of (Array.isArray(replay.pageActions) ? replay.pageActions : []).entries()) {
		const text = [action.label, action.citationText, action.detail, action.noteText].filter(Boolean).join("\n");
		if (contains(text)) addMatch(matches, "pageAction", `Page action ${actionIndex + 1} ${action.type || ""}`, text, textLimit);
	}
	for (const [artifactIndex, artifact] of (Array.isArray(replay.artifacts) ? replay.artifacts : []).entries()) {
		const text = JSON.stringify(artifact || {});
		if (contains(text)) addMatch(matches, "artifact", `Artifact ${artifactIndex + 1}`, text, textLimit);
	}
	return matches;
}

function formatGrep(replay, args) {
	const matches = collectGrepMatches(replay, args.query, args.textLimit);
	const lines = [`Matches for "${args.query}" (${matches.length}):`];
	for (const [index, match] of matches.entries()) {
		lines.push("", `${index + 1}. [${match.source}] ${match.label}`, match.text);
	}
	return `${lines.join("\n")}\n`;
}

function formatState(response, textLimit = DEFAULT_TEXT_LIMIT) {
	const state = response.state || response;
	const tab = state?.tab || {};
	const page = state?.page || {};
	const messages = Array.isArray(state?.messages) ? state.messages : [];
	const activities = Array.isArray(state?.activities) ? state.activities : [];
	const turns = Array.isArray(state?.turns) ? state.turns : [];
	const lines = [
		`Status: ${state?.status || "(unknown)"}`,
		`Current session: ${state?.currentSession?.sessionId || "(unknown)"} ${state?.currentSession?.sessionName || ""}`.trim(),
		`Active request: ${state?.activeRequestId || "none"}`,
		`Current turn: ${state?.currentTurnId || "none"}`,
		`Tab: ${tab?.title || "(unknown)"} ${tab?.url || ""}`.trim(),
		`Page: ${page?.title || ""}${page?.url ? ` ${page.url}` : ""}`.trim(),
		`Counts: messages=${messages.length} turns=${turns.length} activities=${activities.length} pageActions=${Array.isArray(state?.pageActions) ? state.pageActions.length : 0}`,
	];
	const assistantDraft = [...messages].reverse().find((message) => message?.role === "assistant" && String(message?.text || "").trim());
	if (assistantDraft) {
		lines.push("", `Latest assistant ${assistantDraft.pending ? "[pending]" : ""}:`.trim(), truncateBlock(assistantDraft.text || "", textLimit));
	}
	if (activities.length) {
		lines.push("", "Activities:");
		for (const activity of activities.slice(-12)) {
			lines.push(`- ${activity.toolName || activity.label || activity.kind || "activity"} ${activity.state || ""}`.trim());
		}
	}
	if (state?.pageCaptureError) lines.push("", `Page capture error: ${state.pageCaptureError}`);
	if (state?.tabCaptureError) lines.push("", `Tab capture error: ${state.tabCaptureError}`);
	return `${lines.join("\n")}\n`;
}

function sessionMatchesQuery(session, query) {
	const needle = String(query || "").toLowerCase();
	if (!needle) return false;
	return JSON.stringify(session).toLowerCase().includes(needle);
}

async function resolveSessionId(args, list, sendMessage, { defaultCurrent = false } = {}) {
	if (args.sessionId) return args.sessionId;
	const sessions = Array.isArray(list.sessions) ? list.sessions : [];
	if (args.current || defaultCurrent) {
		const currentSessionId = list.currentSession?.sessionId || list.currentSession?.sessionFile || list.currentSession?.id || "";
		const currentFromList =
			sessions.find((session) => session.isCurrent) ||
			sessions.find((session) => session.id === currentSessionId || session.path === currentSessionId);
		return currentFromList?.path || currentFromList?.id || currentSessionId;
	}
	if (args.latest) return sessions[0]?.id || "";
	if (args.query) {
		const shallow = sessions.find((session) => sessionMatchesQuery(session, args.query));
		if (shallow) return shallow.path || shallow.id;
		for (const session of sessions) {
			const replay = await checkedMessage(sendMessage, { type: "sidebar:get-session-replay", sessionPath: session.id });
			if (sessionMatchesQuery(replay, args.query)) return session.path || session.id;
		}
		throw new Error(`No session matched query: ${args.query}`);
	}
	return "";
}

async function checkedMessage(sendMessage, payload) {
	const response = await sendMessage(payload);
	if (!response?.ok) throw new Error(response?.error || `Onhand message failed: ${payload.type || "(unknown)"}`);
	return response;
}

async function getSessionList(driver, args) {
	return await checkedMessage(driver.sendMessage, { type: "sidebar:list-sessions", limit: args.limit });
}

async function getReplayForArgs(driver, args, { defaultCurrent = true } = {}) {
	const list = await getSessionList(driver, args);
	const sessionId = await resolveSessionId(args, list, driver.sendMessage, { defaultCurrent });
	if (!sessionId) throw new Error("Choose a session with --current, --latest, --session, or --query.");
	const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: sessionId });
	return { list, sessionId, replay };
}

function replayCommandObject(command, replay, args) {
	if (args.full) return replay;
	switch (command) {
		case "show":
			return summarizeReplay(replay, args.textLimit);
		case "timeline":
			return (Array.isArray(replay.turns) ? replay.turns : []).map((turn, index) => summarizeTurn(turn, index, args.textLimit));
		case "tools":
			return (Array.isArray(replay.turns) ? replay.turns : []).flatMap((turn) => allTurnTools(turn));
		case "actions":
			return Array.isArray(replay.pageActions) ? replay.pageActions : [];
		case "artifacts":
			return Array.isArray(replay.artifacts) ? replay.artifacts : [];
		case "turn":
			return selectTurn(replay, args.turn);
		case "grep":
			return collectGrepMatches(replay, args.query, args.textLimit);
		case "context":
			return replayContextMetrics(replay);
		default:
			return replay;
	}
}

function replayCommandText(command, replay, args) {
	switch (command) {
		case "show":
			return formatReplaySummary(summarizeReplay(replay, args.textLimit));
		case "timeline":
			return formatTimeline(replay, args.textLimit);
		case "tools":
			return formatTools(replay, args.textLimit);
		case "actions":
			return formatActions(replay, args.textLimit);
		case "artifacts":
			return formatArtifacts(replay, args.textLimit);
		case "turn":
			return formatTurn(replay, args);
		case "grep":
			return formatGrep(replay, args);
		case "context":
			return formatContextMetrics(replayContextMetrics(replay));
		default:
			return formatReplaySummary(summarizeReplay(replay, args.textLimit));
	}
}

async function writeOutput(args, output) {
	const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
	if (args.out) await writeFile(args.out, text);
	else process.stdout.write(text);
}

async function readStdin() {
	return await new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

async function readPrompt(args) {
	if (args.promptFile) {
		return String(args.promptFile === "-" ? await readStdin() : await readFile(args.promptFile, "utf8")).trim();
	}
	return String(args.prompt || "").trim();
}

async function readOptionalText(value, file) {
	const direct = String(value || "").trim();
	if (direct) return direct;
	if (!file) return "";
	return String(file === "-" ? await readStdin() : await readFile(file, "utf8")).trim();
}

function findTurnByRequestId(replay, requestId) {
	return (Array.isArray(replay?.turns) ? replay.turns : []).find((turn) => turn?.id === requestId) || null;
}

async function waitForRequest(driver, args, requestId) {
	const deadline = Date.now() + args.timeoutMs;
	let lastStatus = "";
	let lastState = null;
	let currentSessionId = "";
	while (Date.now() < deadline) {
		const stateResponse = await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
		const state = stateResponse.state || {};
		lastState = state;
		currentSessionId = state.currentSession?.sessionId || currentSessionId;
		const status = `${state.status || ""}${state.activeRequestId ? ` (${state.activeRequestId})` : ""}`;
		if (!args.json && status && status !== lastStatus) {
			process.stderr.write(`[onhand] ${status}\n`);
			lastStatus = status;
		}
		if (currentSessionId) {
			const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: currentSessionId });
			const turn = findTurnByRequestId(replay, requestId);
			if (turn && !turn.pending && state.activeRequestId !== requestId) {
				await sleep(Math.min(args.pollMs, 250));
				const latestReplay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: currentSessionId });
				return { state, replay: latestReplay, turn: findTurnByRequestId(latestReplay, requestId) || turn };
			}
		}
		if (state.activeRequestId && state.activeRequestId !== requestId && currentSessionId) {
			const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: currentSessionId });
			const turn = findTurnByRequestId(replay, requestId);
			if (turn) return { state, replay, turn };
		}
		await sleep(args.pollMs);
	}
	throw new Error(`Timed out waiting for request ${requestId}. Last state: ${lastState?.status || "(unknown)"}`);
}

function formatAskResult(result, args) {
	const turn = result.turn || {};
	const tools = allTurnTools(turn);
	const lines = [
		`Request: ${result.requestId}`,
		`Session: ${result.replay?.session?.id || result.replay?.currentSession?.sessionId || "(unknown)"}`,
		`Turn: ${turn.id || "(pending)"}`,
		`Tools: ${tools.length ? tools.map((tool) => `${tool.toolName}:${tool.state || "unknown"}`).join(", ") : "none"}`,
		"",
		"Reply:",
		truncateBlock(turn.reply || "", args.textLimit) || "(no reply yet)",
	];
	return `${lines.join("\n")}\n`;
}

async function handleAsk(driver, args) {
	const prompt = await readPrompt(args);
	if (!prompt) throw new Error("ask requires prompt text, --prompt, or --prompt-file.");
	const evalSystemPromptAppend = await readOptionalText(args.evalSystemPromptAppend, args.evalSystemPromptAppendFile);
	const evalLauncherPromptAppend = await readOptionalText(args.evalLauncherPromptAppend, args.evalLauncherPromptAppendFile);
	if (args.newSession) {
		await checkedMessage(driver.sendMessage, { type: "sidebar:new-session", windowId: args.windowId });
	}
	// Mirror the sidebar: a submitted turn carries the Learning toggle state, so
	// the persisted preference (learning-mode on) applies without --learning.
	let learningMode = Boolean(args.learningMode);
	if (!learningMode) {
		const stateResponse = await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
		learningMode = Boolean((stateResponse.state || stateResponse)?.preferences?.learningMode);
	}
	const payload = {
		type: "sidebar:submit-prompt",
		prompt,
		displayPrompt: args.displayPrompt || prompt,
		attachments: [],
		source: args.source || "cli",
		learningMode,
		windowId: args.windowId,
		...(args.evalVariant ? { evalVariant: args.evalVariant } : {}),
		...(evalSystemPromptAppend ? { evalSystemPromptAppend } : {}),
		...(evalLauncherPromptAppend ? { evalLauncherPromptAppend } : {}),
	};
	const response = await checkedMessage(driver.sendMessage, payload);
	const requestId = response.requestId;
	if (!args.wait) return { requestId, submitted: true };
	const waited = await waitForRequest(driver, args, requestId);
	return { requestId, submitted: true, ...waited };
}

async function handleWatch(driver, args) {
	if (!args.wait) {
		return await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
	}
	const deadline = Date.now() + args.timeoutMs;
	let lastStatus = "";
	let lastResponse = null;
	while (Date.now() < deadline) {
		const response = await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
		lastResponse = response;
		const state = response.state || {};
		const status = `${state.status || ""}${state.activeRequestId ? ` (${state.activeRequestId})` : ""}`;
		if (!args.json && status && status !== lastStatus) {
			process.stderr.write(`[onhand] ${status}\n`);
			lastStatus = status;
		}
		if (!state.activeRequestId) return response;
		await sleep(args.pollMs);
	}
	return lastResponse || { ok: true, state: null };
}

async function resolveArtifactId(driver, args) {
	if (args.artifactId) return args.artifactId;
	const { replay } = await getReplayForArgs(driver, args, { defaultCurrent: true });
	return replay.selectedArtifactId || replay.artifacts?.at?.(-1)?.artifactId || replay.artifacts?.at?.(-1)?.id || "";
}

async function resolveOptionalSessionPath(driver, args) {
	if (!args.sessionId && !args.query && !args.latest && !args.current) return "";
	const list = await getSessionList(driver, args);
	return await resolveSessionId(args, list, driver.sendMessage, { defaultCurrent: true });
}

function formatLearningMode(result, textLimit) {
	const lines = [`Learning Mode: ${result.learningMode ? "ON" : "OFF"}`];
	const learner = result.learnerState || {};
	const concepts = Array.isArray(learner.conceptsIntroduced) ? learner.conceptsIntroduced : [];
	const openChecks = Array.isArray(learner.openChecks) ? learner.openChecks : [];
	const responses = Array.isArray(learner.responses) ? learner.responses : [];
	lines.push(`Learner state: ${concepts.length} concept${concepts.length === 1 ? "" : "s"}, ${openChecks.length} open check${openChecks.length === 1 ? "" : "s"}, ${responses.length} resolved`);
	for (const check of openChecks.slice(-5)) {
		const anchor = check.annotationId ? ` [${check.annotationId}]` : " [no annotation]";
		lines.push(`  open ${check.checkId} (${check.kind || "check"})${anchor}: ${truncateText(check.promptText, textLimit)}`);
	}
	for (const response of responses.slice(-3)) {
		lines.push(`  resolved ${response.checkId}: ${response.assessment}${response.evidence ? ` - ${truncateText(response.evidence, 140)}` : ""}`);
	}
	return `${lines.join("\n")}\n`;
}

function formatTurnTraces(traces, textLimit) {
	if (!traces.length) return "No turn traces recorded yet.\n";
	const lines = [];
	traces.forEach((trace, index) => {
		lines.push(
			`${index + 1}. ${trace.createdAt || "?"} ${trace.result || "?"} turn ${trace.turnId || "?"} (session ${trace.sessionId || "?"})`,
		);
		lines.push(`   prompt: ${truncateText(trace.prompt, textLimit)}`);
		if (typeof trace.provisionalAnswerExposed === "boolean") {
			lines.push(`   provisionalAnswerExposed: ${trace.provisionalAnswerExposed}`);
		}
		const predicates = trace.routing?.predicates || {};
		const activeLanes = Object.entries(predicates).filter(([, value]) => value).map(([key]) => key);
		const routingFlags = [];
		if (trace.routing?.gateEligible) routingFlags.push("gate-eligible");
		if (trace.routing?.bufferedUntilSettled) routingFlags.push("buffered-until-settled");
		lines.push(
			`   routing: ${activeLanes.length ? activeLanes.join(", ") : "(no marker lanes)"}${routingFlags.length ? ` [${routingFlags.join(", ")}]` : ""}${trace.routing?.classifier ? " +classifier" : ""}`,
		);
		const toolCalls = Array.isArray(trace.toolCalls) ? trace.toolCalls : [];
		for (const call of toolCalls) {
			const duration = Number.isFinite(call.durationMs) ? ` ${call.durationMs}ms` : "";
			const detail = call.state === "error" || /guardrail|blocked/i.test(String(call.result || "")) ? ` - ${truncateText(call.result, 200)}` : "";
			lines.push(`   ${call.tool} ${call.state}${duration}${detail}`);
		}
		lines.push("");
	});
	return lines.join("\n");
}

function formatControlResponse(command, response) {
	switch (command) {
		case "new":
			return `Started new session: ${response.currentSession?.sessionId || "(unknown)"}\n`;
		case "switch":
			return `Switched to session: ${response.currentSession?.sessionId || "(unknown)"}\n`;
		case "restore":
			return `Restored ${response.restoredCount || 0} page state${response.restoredCount === 1 ? "" : "s"}.\n`;
		case "stop":
			return `Stopped: ${response.stopped ? "yes" : "no"}\n`;
		case "delete-session":
			return `Deleted session: ${response.deletedSessionId || "(unknown)"}\nCurrent session: ${response.currentSession?.sessionId || "(unknown)"}\n`;
		case "rename-session":
			return `Renamed current session to: ${response.currentSession?.sessionName || "(unknown)"}\n`;
		default:
			return `${JSON.stringify(response, null, 2)}\n`;
	}
}

async function readFreeTierBypassState(driver, action) {
	const state = await checkedMessage(driver.sendMessage, { type: "debug:free-tier-bypass-state" });
	return { ...state, action };
}

async function freeTierBypassCommand(_cdp, driver, args) {
	const action = String(args.positional[0] || "status").trim().toLowerCase();
	if (!["status", "enable", "disable", "device-hash"].includes(action)) {
		throw new Error("free-tier-bypass action must be status, enable, disable, or device-hash.");
	}
	if (action === "enable") {
		const secret = String(process.env.ONHAND_FREE_QUOTA_BYPASS_SECRET || "").trim();
		const expiresAt = String(process.env.ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT || "").trim();
		if (secret.length < FREE_TIER_QUOTA_BYPASS_MIN_LENGTH) {
			throw new Error("Set ONHAND_FREE_QUOTA_BYPASS_SECRET to a 16+ character value before enabling the bypass.");
		}
		const result = await checkedMessage(driver.sendMessage, { type: "debug:set-free-tier-bypass", secret, expiresAt });
		return { ...result, action };
	}
	if (action === "disable") {
		const result = await checkedMessage(driver.sendMessage, { type: "debug:clear-free-tier-bypass" });
		return { ...result, action };
	}
	return await readFreeTierBypassState(driver, action);
}

function formatFreeTierBypass(result) {
	const lines = [`Free-tier quota bypass: ${result.enabled ? "enabled" : "disabled"}`];
	if (result.expiresAt) lines.push(`Expires: ${result.expiresAt}${result.expired ? " (expired)" : ""}`);
	if (result.deviceHash) lines.push(`Device hash: ${result.deviceHash}`);
	else lines.push("Device hash: unavailable (free-tier token has not been registered yet)");
	return `${lines.join("\n")}\n`;
}

function isCliDriverTarget(target, extensionId = "") {
	const url = String(target?.url || "");
	if (!url.startsWith("chrome-extension://")) return false;
	if (extensionId && !url.startsWith(`chrome-extension://${extensionId}/`)) return false;
	if (url.includes("onhand-session-dump=1")) return true;
	return /\/(?:sidepanel|pdf-viewer)\.html\b/i.test(url) && /[?&]driver=1\b/.test(url);
}

function formatCleanupDrivers(result) {
	const lines = [`Closed ${result.closed.length} Onhand CLI driver target${result.closed.length === 1 ? "" : "s"}.`];
	if (result.failed.length) lines.push(`Failed to close ${result.failed.length} target${result.failed.length === 1 ? "" : "s"}.`);
	for (const target of result.closed.slice(0, 12)) {
		lines.push(`- ${target.type || "target"} ${target.targetId}: ${truncateText(target.url, 180)}`);
	}
	for (const target of result.failed.slice(0, 8)) {
		lines.push(`- failed ${target.targetId}: ${firstErrorLine(target.error)}`);
	}
	return `${lines.join("\n")}\n`;
}

async function cleanupDriverTargets(args) {
	const cdp = await openBrowserCdp(args);
	try {
		const targets = (await cdp.send("Target.getTargets")).targetInfos || [];
		const matches = targets.filter((target) => isCliDriverTarget(target, args.extensionId));
		const closed = [];
		const failed = [];
		for (const target of matches) {
			try {
				const result = await cdp.send("Target.closeTarget", { targetId: target.targetId });
				if (result?.success === false) throw new Error("Target.closeTarget returned success=false");
				closed.push({
					targetId: target.targetId,
					type: target.type || "",
					title: target.title || "",
					url: target.url || "",
				});
			} catch (error) {
				failed.push({
					targetId: target.targetId,
					type: target.type || "",
					title: target.title || "",
					url: target.url || "",
					error: error?.message || String(error),
				});
			}
		}
		return { ok: failed.length === 0, scanned: targets.length, matched: matches.length, closed, failed };
	} finally {
		cdp.close();
	}
}

function collectReplayErrors(replay, sessionId, textLimit = DEFAULT_TEXT_LIMIT) {
	const errors = [];
	for (const [turnIndex, turn] of (Array.isArray(replay.turns) ? replay.turns : []).entries()) {
		if (turn?.error) {
			errors.push({
				sessionId,
				turnIndex: turnIndex + 1,
				turnId: turn?.id || "",
				createdAt: turn?.createdAt || "",
				kind: "turn",
				toolName: "",
				state: "",
				message: truncateBlock(turn?.error?.message || turn?.error || "Turn error", textLimit),
				userPrompt: truncateBlock(turn?.userPrompt || "", textLimit),
			});
		}
		for (const tool of allTurnTools(turn)) {
			if (tool.state !== "error" && !tool.error) continue;
			errors.push({
				sessionId,
				turnIndex: turnIndex + 1,
				turnId: turn?.id || "",
				createdAt: turn?.createdAt || "",
				kind: "tool",
				toolName: tool.toolName || "",
				state: tool.state || "",
				message: truncateBlock(tool.error || tool.resultSummary || "Tool error", textLimit),
				userPrompt: truncateBlock(turn?.userPrompt || "", textLimit),
			});
		}
	}
	return errors;
}

function collectReplayToolRetries(replay, sessionId, textLimit = DEFAULT_TEXT_LIMIT) {
	const retries = [];
	for (const [turnIndex, turn] of (Array.isArray(replay.turns) ? replay.turns : []).entries()) {
		const tools = allTurnTools(turn);
		const completedToolNames = new Set(tools.filter((tool) => tool.state === "complete").map((tool) => tool.toolName).filter(Boolean));
		for (const tool of tools) {
			if (tool.state !== "error" && !tool.error) continue;
			const recovered = !turn?.error && (completedToolNames.has(tool.toolName) || String(turn?.reply || "").trim());
			if (!recovered) continue;
			retries.push({
				sessionId,
				turnIndex: turnIndex + 1,
				turnId: turn?.id || "",
				createdAt: turn?.createdAt || "",
				toolName: tool.toolName || "",
				toolCallId: tool.toolCallId || "",
				state: tool.state || "",
				recovered,
				message: truncateBlock(tool.error || tool.resultSummary || "Tool failed before retry.", textLimit),
				resultSummary: truncateBlock(tool.resultSummary || "", textLimit),
				requestedArgs: tool.args ?? null,
				effectiveArgs: tool.effectiveArgs ?? null,
				userPrompt: truncateBlock(turn?.userPrompt || "", textLimit),
				reply: truncateBlock(turn?.reply || "", textLimit),
			});
		}
	}
	return retries;
}

async function collectLatestErrors(driver, args) {
	const list = await getSessionList(driver, args);
	const errors = [];
	for (const session of (Array.isArray(list.sessions) ? list.sessions : []).slice(0, args.limit)) {
		const sessionId = session.path || session.id;
		if (!sessionId) continue;
		try {
			const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: sessionId });
			errors.push(...collectReplayErrors(replay, sessionId, args.textLimit));
		} catch (error) {
			errors.push({
				sessionId,
				turnIndex: 0,
				turnId: "",
				createdAt: session.modifiedAt || "",
				kind: "session",
				toolName: "",
				state: "error",
				message: truncateBlock(error?.message || String(error), args.textLimit),
				userPrompt: "",
			});
		}
	}
	errors.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
	return { currentSession: list.currentSession || null, scannedSessions: Math.min(args.limit, list.sessions?.length || 0), errors };
}

async function collectLatestToolRetries(driver, args) {
	const list = await getSessionList(driver, args);
	const retries = [];
	for (const session of (Array.isArray(list.sessions) ? list.sessions : []).slice(0, args.limit)) {
		const sessionId = session.path || session.id;
		if (!sessionId) continue;
		try {
			const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: sessionId });
			retries.push(...collectReplayToolRetries(replay, sessionId, args.textLimit));
		} catch (error) {
			retries.push({
				sessionId,
				turnIndex: 0,
				turnId: "",
				createdAt: session.modifiedAt || "",
				toolName: "",
				toolCallId: "",
				state: "error",
				recovered: false,
				message: truncateBlock(error?.message || String(error), args.textLimit),
				resultSummary: "",
				requestedArgs: null,
				effectiveArgs: null,
				userPrompt: "",
				reply: "",
			});
		}
	}
	retries.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
	return { currentSession: list.currentSession || null, scannedSessions: Math.min(args.limit, list.sessions?.length || 0), retries };
}

function formatLatestErrors(result) {
	const lines = [`Latest errors: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} across ${result.scannedSessions} session${result.scannedSessions === 1 ? "" : "s"}.`];
	for (const [index, error] of result.errors.entries()) {
		lines.push(
			"",
			`${index + 1}. ${error.sessionId} turn=${error.turnIndex || "?"} ${error.kind}${error.toolName ? ` ${error.toolName}` : ""} ${error.state || ""}`.trim(),
		);
		if (error.createdAt) lines.push(`   time: ${error.createdAt}`);
		if (error.userPrompt) lines.push(`   prompt: ${truncateText(error.userPrompt, 220)}`);
		lines.push(`   error: ${truncateBlock(error.message, 600)}`);
	}
	if (!result.errors.length) lines.push("- none found");
	return `${lines.join("\n")}\n`;
}

function formatToolRetries(result) {
	const lines = [`Recovered tool retries: ${result.retries.length} across ${result.scannedSessions} session${result.scannedSessions === 1 ? "" : "s"}.`];
	for (const [index, retry] of result.retries.entries()) {
		lines.push(
			"",
			`${index + 1}. ${retry.sessionId} turn=${retry.turnIndex || "?"} ${retry.toolName || "(unknown tool)"} ${retry.state || ""}`.trim(),
		);
		if (retry.createdAt) lines.push(`   time: ${retry.createdAt}`);
		if (retry.turnId) lines.push(`   turnId: ${retry.turnId}`);
		if (retry.toolCallId) lines.push(`   toolCallId: ${retry.toolCallId}`);
		if (retry.userPrompt) lines.push(`   prompt: ${truncateText(retry.userPrompt, 220)}`);
		lines.push(`   error: ${truncateBlock(retry.message, 600)}`);
		if (retry.effectiveArgs) lines.push(`   effective args: ${jsonBlock(retry.effectiveArgs, 600)}`);
	}
	if (!result.retries.length) lines.push("- none found");
	return `${lines.join("\n")}\n`;
}

function toolCountMap(tools) {
	const counts = new Map();
	for (const tool of tools) {
		const key = `${tool.toolName || "(unknown)"}:${tool.state || "unknown"}`;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

function replayToolProfile(replay) {
	const turns = (Array.isArray(replay.turns) ? replay.turns : []).map((turn, index) => {
		const tools = allTurnTools(turn).map((tool) => ({
			toolName: tool.toolName || "",
			state: tool.state || "",
			error: tool.error || "",
			args: tool.args ?? null,
			effectiveArgs: tool.effectiveArgs ?? null,
			resultSummary: tool.resultSummary || "",
		}));
		return {
			index: index + 1,
			id: turn?.id || "",
			userPrompt: turn?.userPrompt || "",
			tools,
		};
	});
	const totals = toolCountMap(turns.flatMap((turn) => turn.tools));
	return {
		session: replay.session || replay.currentSession || null,
		turns,
		totals: Object.fromEntries([...totals.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
	};
}

function sessionSelectorArgs(args, selector) {
	const value = String(selector || "").trim();
	if (!value) return { ...args, sessionId: "", query: "" };
	if (value.startsWith("session_")) return { ...args, sessionId: value, query: "" };
	return { ...args, sessionId: "", query: value };
}

async function getReplayForSelector(driver, args, list, selector) {
	const selectorArgs = sessionSelectorArgs(args, selector);
	const sessionId = await resolveSessionId(selectorArgs, list, driver.sendMessage, { defaultCurrent: false });
	if (!sessionId) throw new Error(`Could not resolve session selector: ${selector || "(blank)"}`);
	const replay = await checkedMessage(driver.sendMessage, { type: "sidebar:get-session-replay", sessionPath: sessionId });
	return { sessionId, replay };
}

async function diffToolProfiles(driver, args) {
	if (!args.sessionA || !args.sessionB) throw new Error("diff-tools requires --session-a and --session-b, or two positional session selectors.");
	const list = await getSessionList(driver, args);
	const left = await getReplayForSelector(driver, args, list, args.sessionA);
	const right = await getReplayForSelector(driver, args, list, args.sessionB);
	const leftProfile = replayToolProfile(left.replay);
	const rightProfile = replayToolProfile(right.replay);
	const keys = new Set([...Object.keys(leftProfile.totals), ...Object.keys(rightProfile.totals)]);
	const totalDiffs = [...keys]
		.sort()
		.map((key) => ({ tool: key, left: leftProfile.totals[key] || 0, right: rightProfile.totals[key] || 0 }))
		.filter((entry) => entry.left || entry.right);
	const turnCount = Math.max(leftProfile.turns.length, rightProfile.turns.length);
	const turns = [];
	for (let index = 0; index < turnCount; index += 1) {
		const leftTurn = leftProfile.turns[index] || null;
		const rightTurn = rightProfile.turns[index] || null;
		turns.push({
			index: index + 1,
			left: leftTurn ? leftTurn.tools.map((tool) => `${tool.toolName}:${tool.state || "unknown"}`) : [],
			right: rightTurn ? rightTurn.tools.map((tool) => `${tool.toolName}:${tool.state || "unknown"}`) : [],
			leftPrompt: truncateText(leftTurn?.userPrompt || "", args.textLimit),
			rightPrompt: truncateText(rightTurn?.userPrompt || "", args.textLimit),
		});
	}
	return {
		left: { selector: args.sessionA, sessionId: left.sessionId, session: leftProfile.session },
		right: { selector: args.sessionB, sessionId: right.sessionId, session: rightProfile.session },
		totalDiffs,
		turns,
	};
}

function formatToolDiff(diff) {
	const lines = [
		`Tool diff:`,
		`Left:  ${diff.left.sessionId}`,
		`Right: ${diff.right.sessionId}`,
		"",
		"Totals:",
	];
	for (const entry of diff.totalDiffs) {
		lines.push(`- ${entry.tool}: left=${entry.left} right=${entry.right}${entry.left === entry.right ? "" : ` delta=${entry.right - entry.left}`}`);
	}
	if (!diff.totalDiffs.length) lines.push("- no tools recorded");
	lines.push("", "Turns:");
	for (const turn of diff.turns) {
		lines.push(`Turn ${turn.index}`);
		if (turn.leftPrompt || turn.rightPrompt) lines.push(`  prompts: left="${turn.leftPrompt || "(blank)"}" right="${turn.rightPrompt || "(blank)"}"`);
		lines.push(`  left:  ${turn.left.join(", ") || "none"}`);
		lines.push(`  right: ${turn.right.join(", ") || "none"}`);
	}
	return `${lines.join("\n")}\n`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.command === "cleanup-drivers") {
		const result = await cleanupDriverTargets(args);
		await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatCleanupDrivers(result));
		return;
	}
	if (args.command === "open-url") {
		const result = await openUrlInBrowser(args);
		await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatOpenUrlResult(result));
		return;
	}
	let openedUrl = null;
	if (args.command === "ask-new-url") {
		openedUrl = await openUrlInBrowser({ ...args, newTab: true });
		args.newSession = true;
		args.wait = true;
		await sleep(1200);
	}
	const { cdp, driver } = await openOnhandDriver(args);
	try {
		if (args.command === "list") {
			const list = await getSessionList(driver, args);
			await writeOutput(args, args.json ? JSON.stringify(list, null, 2) : formatSessionList(list));
			return;
		}
		if (args.command === "state" || args.command === "watch") {
			const response = args.command === "watch" ? await handleWatch(driver, args) : await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
			const outputObject = args.full ? response : response.state || response;
			await writeOutput(args, args.json ? JSON.stringify(outputObject, null, 2) : formatState(response, args.textLimit));
			return;
		}
		if (args.command === "reload-extension") {
			const response = await reloadExtensionRuntime(cdp, driver);
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : "Requested Onhand extension reload.\n");
			return;
		}
		if (REPLAY_COMMANDS.has(args.command)) {
			const { replay } = await getReplayForArgs(driver, args, { defaultCurrent: true });
			if (args.json) {
				await writeOutput(args, `${JSON.stringify(replayCommandObject(args.command, replay, args), null, 2)}\n`);
			} else {
				await writeOutput(args, replayCommandText(args.command, replay, args));
			}
			return;
		}
		if (args.command === "latest-errors") {
			const result = await collectLatestErrors(driver, args);
			await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatLatestErrors(result));
			return;
		}
		if (args.command === "tool-retries") {
			const result = await collectLatestToolRetries(driver, args);
			await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatToolRetries(result));
			return;
		}
		if (args.command === "diff-tools") {
			const result = await diffToolProfiles(driver, args);
			await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatToolDiff(result));
			return;
		}
		if (args.command === "free-tier-bypass") {
			const result = await freeTierBypassCommand(cdp, driver, args);
			await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatFreeTierBypass(result));
			return;
		}
		if (args.command === "new") {
			const response = await checkedMessage(driver.sendMessage, { type: "sidebar:new-session", windowId: args.windowId });
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : formatControlResponse(args.command, response));
			return;
		}
		if (args.command === "switch" || args.command === "restore") {
			const list = await getSessionList(driver, args);
			const sessionId = await resolveSessionId(args, list, driver.sendMessage, { defaultCurrent: false });
			if (!sessionId) throw new Error(`${args.command} requires a session id or query.`);
			const response = await checkedMessage(driver.sendMessage, {
				type: args.command === "switch" ? "sidebar:switch-session" : "sidebar:restore-session",
				sessionPath: sessionId,
				windowId: args.windowId,
			});
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : formatControlResponse(args.command, response));
			return;
		}
		if (args.command === "stop") {
			const response = await checkedMessage(driver.sendMessage, { type: "sidebar:stop" });
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : formatControlResponse(args.command, response));
			return;
		}
		if (args.command === "artifact") {
			const artifactId = await resolveArtifactId(driver, args);
			if (!artifactId) throw new Error("artifact requires --artifact-id or a session with a selected artifact.");
			const response = await checkedMessage(driver.sendMessage, { type: "sidebar:get-replay-artifact", artifactId });
			await writeOutput(args, args.json ? `${JSON.stringify(args.full ? response : response.artifact || response, null, 2)}\n` : formatArtifactDetail(response, args.textLimit));
			return;
		}
		if (args.command === "activate-action") {
			if (!args.key) throw new Error("activate-action requires --key <action_key>.");
			const sessionPath = await resolveOptionalSessionPath(driver, args);
			const response = await checkedMessage(driver.sendMessage, {
				type: "sidebar:activate-action",
				key: args.key,
				sessionPath,
			});
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : `Activated action ${args.key}.\n`);
			return;
		}
		if (args.command === "scroll") {
			if (!args.annotationId) throw new Error("scroll requires --annotation-id <id>.");
			try {
				const response = await checkedMessage(driver.sendMessage, {
					type: "sidebar:scroll-to-annotation",
					annotationId: args.annotationId,
					target: args.target,
					tabId: undefined,
				});
				await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : `Scrolled to ${args.target} ${args.annotationId}.\n`);
			} catch (error) {
				const key = `${args.target === "note" ? "note" : "highlight"}:${args.annotationId}`;
				const sessionPath = await resolveOptionalSessionPath(driver, args);
				const response = await checkedMessage(driver.sendMessage, {
					type: "sidebar:activate-action",
					key,
					sessionPath,
				});
				const output = {
					...response,
					fallback: "activate-action",
					key,
					directScrollError: firstErrorLine(error),
				};
				await writeOutput(args, args.json ? `${JSON.stringify(output, null, 2)}\n` : `Activated saved action ${key} after direct scroll failed: ${firstErrorLine(error)}\n`);
			}
			return;
		}
		if (args.command === "learning-mode") {
			const mode = String(args.positional[0] || "status").toLowerCase();
			if (!["on", "off", "status"].includes(mode)) throw new Error("learning-mode takes on, off, or status.");
			if (mode !== "status") {
				await checkedMessage(driver.sendMessage, {
					type: "sidebar:set-learning-mode",
					learningMode: mode === "on",
				});
			}
			const stateResponse = await checkedMessage(driver.sendMessage, { type: "sidebar:fetch-state", windowId: args.windowId });
			const state = stateResponse.state || stateResponse;
			const result = {
				learningMode: Boolean(state?.preferences?.learningMode),
				learnerState: state?.learnerState || null,
			};
			await writeOutput(args, args.json ? `${JSON.stringify(result, null, 2)}\n` : formatLearningMode(result, args.textLimit));
			return;
		}
		if (args.command === "delete-session") {
			const list = await getSessionList(driver, args);
			const sessionId = await resolveSessionId(args, list, driver.sendMessage, { defaultCurrent: false });
			if (!sessionId) throw new Error("delete-session requires a session id or query.");
			const response = await checkedMessage(driver.sendMessage, {
				type: "sidebar:delete-session",
				sessionPath: sessionId,
				windowId: args.windowId,
			});
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : formatControlResponse(args.command, response));
			return;
		}
		if (args.command === "rename-session") {
			const name = args.positional.join(" ").trim();
			if (!name) throw new Error("rename-session requires the new session name.");
			const response = await checkedMessage(driver.sendMessage, { type: "sidebar:rename-session", sessionName: name });
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : formatControlResponse(args.command, response));
			return;
		}
		if (args.command === "open-pdf-viewer") {
			const response = await checkedMessage(driver.sendMessage, {
				type: "sidebar:open-pdf-viewer",
				...(args.tabId !== undefined ? { tabId: args.tabId } : {}),
				windowId: args.windowId,
			});
			const result = response.result || response;
			const summary = [
				`Opened: ${result?.opened === false ? "no" : "yes"}${result?.alreadyOpen ? " (already open)" : ""}`,
				result?.pdfUrl ? `PDF: ${result.pdfUrl}` : "",
				result?.viewerUrl ? `Viewer: ${result.viewerUrl}` : "",
			].filter(Boolean).join("\n");
			await writeOutput(args, args.json ? `${JSON.stringify(response, null, 2)}\n` : `${summary}\n`);
			return;
		}
		if (args.command === "turn-trace") {
			const response = await checkedMessage(driver.sendMessage, { type: "debug:fetch-turn-trace", limit: args.limit });
			const traces = Array.isArray(response.traces) ? response.traces : [];
			await writeOutput(args, args.json ? `${JSON.stringify(traces, null, 2)}\n` : formatTurnTraces(traces, args.textLimit));
			return;
		}
		if (args.command === "ask" || args.command === "ask-new-url") {
			const result = await handleAsk(driver, args);
			if (args.json) {
				const outputObject = args.full ? { openedUrl, ...result } : {
					openedUrl,
					requestId: result.requestId,
					submitted: result.submitted,
					session: result.replay?.session || result.replay?.currentSession || null,
					turn: result.turn || null,
				};
				await writeOutput(args, `${JSON.stringify(outputObject, null, 2)}\n`);
			} else if (args.wait) {
				await writeOutput(args, `${openedUrl ? formatOpenUrlResult(openedUrl) : ""}${formatAskResult(result, args)}`);
			} else {
				await writeOutput(args, `Submitted request: ${result.requestId}\n`);
			}
			return;
		}
		throw new Error(`Unhandled command: ${args.command}`);
	} finally {
		if (driver.shouldCloseTarget) await cdp.send("Target.closeTarget", { targetId: driver.targetId }).catch(() => {});
		cdp.close();
	}
}

main().catch((error) => {
	console.error(`dump-onhand-sessions: ${error.message}`);
	if (/ECONNREFUSED|fetch failed|HTTP|CDP|remote/i.test(error.message)) {
		console.error(`\nMake sure Helium/Chromium is running with --remote-debugging-port=${DEFAULT_PORT}.`);
	}
	process.exitCode = 1;
});
