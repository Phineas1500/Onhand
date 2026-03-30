import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PI_EXTENSION_PATH = join(PROJECT_ROOT, "packages", "pi-extension", "index.ts");
const SESSION_DIR = join(PROJECT_ROOT, ".onhand", "sessions", "desktop");
const ONHAND_APPEND_SYSTEM_PROMPT = `You are Onhand, a contextual tutor and research copilot running inside a compact desktop launcher.

Prefer helping with the material already open in the user's browser. Stay grounded in the captured browser context supplied with each prompt. If you need more detail or the user asks you to point to something, use the available browser tools to inspect the live page.

Avoid navigating away from the current page unless the user explicitly asks. Keep replies concise and launcher-friendly by default.`;

let runtimePromise = null;
let activeRequest = null;
let sessionEventUnsubscribe = null;

function truncate(value, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}…`;
}

function renderBrowserContextForPrompt(context) {
	if (!context?.ok) {
		return `Browser context was unavailable.\nReason: ${context?.error || "Unknown error"}`;
	}

	const lines = [];
	const tab = context.activeTab;
	if (tab) {
		lines.push(`Active tab title: ${tab.title || "(untitled)"}`);
		lines.push(`Active tab URL: ${tab.url || "(unknown)"}`);
	}
	lines.push(`Connected browser clients: ${Number(context?.bridge?.connectedClients || 0)}`);
	if (context.warning) lines.push(`Warning: ${context.warning}`);
	if (context.selection?.hasSelection && context.selection?.text) {
		lines.push(`Selected text: ${JSON.stringify(truncate(context.selection.text, 1200))}`);
	}
	if (context.visible?.text) {
		lines.push("Visible text snapshot:");
		lines.push(truncate(context.visible.text, 3000));
	}
	return lines.join("\n");
}

function buildLauncherPrompt(prompt, browserContext) {
	return [
		"The user invoked Onhand from the desktop launcher.",
		"",
		`User question:\n${prompt.trim()}`,
		"",
		"Captured browser context right before the question:",
		renderBrowserContextForPrompt(browserContext),
		"",
		"Use this captured context as your starting point. If needed, call browser tools to inspect or act on the current page without navigating away unless the user explicitly asks.",
	].join("\n");
}

function extractAssistantText(messages) {
	if (!Array.isArray(messages)) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		return message.content
			.filter((block) => block?.type === "text")
			.map((block) => block.text || "")
			.join("")
			.trim();
	}
	return "";
}

function emitRequestEvent(payload) {
	activeRequest?.onEvent(payload);
}

function handleSessionEvent(session, event) {
	if (!activeRequest) return;

	switch (event.type) {
		case "agent_start": {
			emitRequestEvent({ type: "status", status: "Thinking…" });
			break;
		}
		case "message_update": {
			if (event.assistantMessageEvent.type === "text_delta") {
				activeRequest.reply += event.assistantMessageEvent.delta;
				emitRequestEvent({
					type: "reply_delta",
					delta: event.assistantMessageEvent.delta,
					reply: activeRequest.reply,
				});
				emitRequestEvent({ type: "status", status: "Responding…" });
			} else if (event.assistantMessageEvent.type === "thinking_delta" && !activeRequest.reply.trim()) {
				emitRequestEvent({ type: "status", status: "Thinking…" });
			}
			break;
		}
		case "tool_execution_start": {
			emitRequestEvent({
				type: "status",
				status: event.toolName?.startsWith("browser_") ? "Inspecting the current page…" : `Using ${event.toolName}…`,
			});
			break;
		}
		case "tool_execution_end": {
			emitRequestEvent({ type: "status", status: "Writing answer…" });
			break;
		}
		case "auto_retry_start": {
			emitRequestEvent({
				type: "status",
				status: `Retrying after an error (${event.attempt}/${event.maxAttempts})…`,
			});
			break;
		}
		case "compaction_start": {
			emitRequestEvent({ type: "status", status: "Compacting conversation context…" });
			break;
		}
		case "agent_end": {
			const reply = activeRequest.reply.trim() || extractAssistantText(event.messages) || "(No reply generated.)";
			emitRequestEvent({
				type: "complete",
				reply,
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
			});
			activeRequest = null;
			break;
		}
		default:
			break;
	}
}

async function createRuntime() {
	const authStorage = AuthStorage.create();
	const modelRegistry = new ModelRegistry(authStorage);
	const settingsManager = SettingsManager.create(PROJECT_ROOT);
	const resourceLoader = new DefaultResourceLoader({
		cwd: PROJECT_ROOT,
		settingsManager,
		additionalExtensionPaths: [PI_EXTENSION_PATH],
		appendSystemPrompt: ONHAND_APPEND_SYSTEM_PROMPT,
	});
	await resourceLoader.reload();

	const result = await createAgentSession({
		cwd: PROJECT_ROOT,
		authStorage,
		modelRegistry,
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.continueRecent(PROJECT_ROOT, SESSION_DIR),
	});

	if (result.extensionsResult.errors.length > 0) {
		result.session.dispose();
		const details = result.extensionsResult.errors
			.map((error) => `${error.path}: ${error.error}`)
			.join("\n");
		throw new Error(`Failed to load Onhand extensions:\n${details}`);
	}

	sessionEventUnsubscribe = result.session.subscribe((event) => {
		handleSessionEvent(result.session, event);
	});

	return result;
}

async function ensureRuntime() {
	if (!runtimePromise) {
		runtimePromise = createRuntime().catch((error) => {
			runtimePromise = null;
			throw error;
		});
	}
	return await runtimePromise;
}

export async function submitOnhandPrompt({ requestId, prompt, browserContext, onEvent }) {
	const { session } = await ensureRuntime();
	if (activeRequest) {
		throw new Error("Onhand is already responding. Please wait for the current reply to finish.");
	}

	activeRequest = {
		id: requestId,
		onEvent,
		reply: "",
	};

	onEvent({
		type: "status",
		status: "Starting Onhand…",
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
	});

	try {
		await session.prompt(buildLauncherPrompt(prompt, browserContext));
		if (activeRequest?.id === requestId) {
			const reply = activeRequest.reply.trim() || "(No reply generated.)";
			onEvent({
				type: "complete",
				reply,
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
			});
			activeRequest = null;
		}
		return {
			requestId,
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
		};
	} catch (error) {
		if (activeRequest?.id === requestId) {
			activeRequest = null;
		}
		throw error;
	}
}

export async function disposeOnhandAgent() {
	activeRequest = null;
	if (!runtimePromise) return;
	try {
		const { session } = await runtimePromise;
		sessionEventUnsubscribe?.();
		session.dispose();
	} catch {
		// Ignore shutdown cleanup failures.
	} finally {
		runtimePromise = null;
		sessionEventUnsubscribe = null;
	}
}
