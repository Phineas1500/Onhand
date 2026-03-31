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

When the user asks about content that is already open, do not stop at a detached answer when you can ground it visually. If you can identify the exact supporting passage on an existing page or tab, prefer this flow:
- switch to the most relevant already-open tab if needed
- highlight the exact supporting text
- add a short note near it
- scroll it into view
- save a browser artifact when the result is worth revisiting later

Prefer the clearest answer-bearing text in the main content or page header. Avoid grounding on footer boilerplate, legal copy, or generic navigation text when a better passage is available.

Avoid navigating away from the current page unless the user explicitly asks. Keep replies concise and launcher-friendly by default, and keep on-page notes short and explanatory.`;

let runtimePromise = null;
let activeRequest = null;
let sessionEventUnsubscribe = null;
let uiState = createEmptyUiState();
const uiStateListeners = new Set();

function truncate(value, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}…`;
}

function buildSessionTitleFromPrompt(prompt) {
	const cleaned = String(prompt || "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^['"`]+|['"`]+$/g, "")
		.replace(/[?.!]+$/g, "") || "New session";
	return truncate(cleaned, 80);
}

function extractUserQuestionFromSessionText(value) {
	const text = String(value || "");
	const match = text.match(/User question:\s*([\s\S]*?)\s*Captured browser context/i);
	if (!match) return null;
	return truncate(match[1], 140);
}

function buildSessionSummary(info, currentSessionFile) {
	const extractedQuestion =
		extractUserQuestionFromSessionText(info.allMessagesText) || extractUserQuestionFromSessionText(info.firstMessage);
	const title = truncate(info.name || extractedQuestion || info.firstMessage || "New session", 90);
	const previewSource = extractedQuestion || info.firstMessage || info.allMessagesText || "No messages yet.";
	return {
		path: info.path,
		id: info.id,
		title,
		name: info.name || null,
		preview: truncate(previewSource, 140),
		messageCount: info.messageCount,
		modifiedAt: info.modified.toISOString(),
		isCurrent: currentSessionFile ? info.path === currentSessionFile : false,
	};
}

function buildSessionState(session) {
	return {
		sessionId: session.sessionId,
		sessionFile: session.sessionFile || null,
		sessionName: session.sessionName || null,
	};
}

function buildCurrentSessionPlaceholder(currentSession) {
	return {
		path: currentSession.sessionFile || currentSession.sessionId,
		id: currentSession.sessionId,
		title: currentSession.sessionName || "New session",
		name: currentSession.sessionName || null,
		preview: currentSession.sessionName ? "Current launcher session" : "No messages yet.",
		messageCount: 0,
		modifiedAt: new Date().toISOString(),
		isCurrent: true,
	};
}

function createEmptyUiState(currentSession = null) {
	return {
		currentSession,
		messages: [],
		activities: [],
		pageActions: [],
		status: "Ready",
		activeRequestId: null,
		updatedAt: Date.now(),
	};
}

function cloneUiState() {
	return JSON.parse(JSON.stringify(uiState));
}

function emitUiState() {
	const snapshot = cloneUiState();
	for (const listener of uiStateListeners) {
		try {
			listener(snapshot);
		} catch {
			// Ignore UI subscriber failures.
		}
	}
}

function mutateUiState(mutator) {
	mutator(uiState);
	uiState.updatedAt = Date.now();
	emitUiState();
}

function replaceUiState(nextState) {
	uiState = {
		...nextState,
		updatedAt: Date.now(),
	};
	emitUiState();
}

async function getCurrentRuntimeSessionState() {
	if (!runtimePromise) return null;
	try {
		const { session } = await runtimePromise;
		return buildSessionState(session);
	} catch {
		return null;
	}
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
		"Use this captured context as your starting point. Prefer already-open tabs and pages over navigation.",
		"When it would help the user understand the answer, point to it on the live page by switching tabs, highlighting exact text, adding a short note, scrolling it into view, and saving a browser artifact.",
		"Prefer the most informative visible passage or heading that answers the question; avoid footer/legal boilerplate when a better passage exists.",
	].join("\n");
}

function extractTextFromContent(content) {
	if (typeof content === "string") {
		return content.trim();
	}
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text")
		.map((block) => block.text || "")
		.join("")
		.trim();
}

function extractUserFacingUserText(message) {
	const text = extractTextFromContent(message?.content);
	return extractUserQuestionFromSessionText(text) || truncate(text, 240);
}

function buildConversationMessagesFromAgent(agentMessages = []) {
	const messages = [];
	for (let index = 0; index < agentMessages.length; index += 1) {
		const message = agentMessages[index];
		if (!message || typeof message !== "object" || !message.role) continue;
		if (message.role === "toolResult") continue;

		let text = "";
		if (message.role === "user") {
			text = extractUserFacingUserText(message);
		} else if (message.role === "assistant") {
			text = extractTextFromContent(message.content);
		}

		if (!text) continue;
		messages.push({
			id: `${message.role}:${index}`,
			role: message.role,
			text,
		});
	}
	return messages;
}

function extractAssistantText(messages) {
	if (!Array.isArray(messages)) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		return extractTextFromContent(message.content);
	}
	return "";
}

function emitRequestEvent(payload) {
	activeRequest?.onEvent(payload);
}

function syncUiStateFromSession(session, overrides = {}) {
	replaceUiState({
		...createEmptyUiState(buildSessionState(session)),
		messages: buildConversationMessagesFromAgent(session.agent.state.messages),
		...overrides,
	});
}

function beginUiRequest(session, requestId, prompt) {
	const currentSession = buildSessionState(session);
	const previousMessages = buildConversationMessagesFromAgent(session.agent.state.messages);
	const now = new Date().toISOString();
	replaceUiState({
		currentSession,
		messages: [
			...previousMessages,
			{
				id: `user:${requestId}`,
				role: "user",
				text: prompt.trim(),
				createdAt: now,
			},
			{
				id: `assistant:${requestId}`,
				role: "assistant",
				text: "",
				createdAt: now,
				pending: true,
			},
		],
		activities: [],
		pageActions: [],
		status: "Starting Onhand…",
		activeRequestId: requestId,
	});
}

function updateAssistantDraft(requestId, text, extra = {}) {
	mutateUiState((state) => {
		const message = state.messages.find((entry) => entry.id === `assistant:${requestId}`);
		if (!message) return;
		message.text = text;
		Object.assign(message, extra);
	});
}

function appendUiActivity(activity) {
	mutateUiState((state) => {
		const existingIndex = state.activities.findIndex((entry) => entry.id === activity.id);
		if (existingIndex >= 0) {
			state.activities[existingIndex] = {
				...state.activities[existingIndex],
				...activity,
			};
		} else {
			state.activities.push(activity);
		}
	});
}

function setUiStatus(status) {
	mutateUiState((state) => {
		state.status = status;
	});
}

function getToolStatusMessage(toolName) {
	switch (toolName) {
		case "browser_list_tabs":
			return "Checking open tabs…";
		case "browser_activate_tab":
			return "Switching to the relevant tab…";
		case "browser_get_selection":
			return "Reading your current selection…";
		case "browser_get_visible_text":
			return "Reading the visible part of the page…";
		case "browser_get_viewport_headings":
			return "Checking the current section heading…";
		case "browser_get_scroll_state":
			return "Checking where you are on the page…";
		case "browser_find_elements":
			return "Looking for the relevant part of the page…";
		case "browser_highlight_text":
			return "Highlighting the relevant passage…";
		case "browser_show_note":
			return "Adding a note on the page…";
		case "browser_scroll_to_annotation":
			return "Moving the page to the relevant section…";
		case "browser_capture_state":
			return "Saving an Onhand artifact…";
		case "browser_restore_state":
			return "Restoring a saved Onhand view…";
		case "browser_clear_annotations":
			return "Clearing previous Onhand annotations…";
		default:
			return toolName?.startsWith("browser_") ? "Inspecting the current page…" : `Using ${toolName}…`;
	}
}

function buildPageAction(toolName, result) {
	const details = result?.details || {};
	const tab = details.tab || null;
	switch (toolName) {
		case "browser_activate_tab": {
			const detail = truncate(details.tab?.title || details.tab?.url || "Relevant page", 72);
			return {
				key: `tab:${details.tab?.id || detail}`,
				type: "tab",
				tabId: details.tab?.id || null,
				windowId: details.tab?.windowId || null,
				label: "Switched tab",
				detail,
			};
		}
		case "browser_highlight_text": {
			const matchedText = truncate(details.annotation?.matchedText || "Relevant passage", 72);
			return {
				key: `highlight:${details.annotation?.annotationId || matchedText}`,
				type: "annotation",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.annotation?.annotationId || null,
				label: "Highlighted text",
				detail: matchedText,
			};
		}
		case "browser_show_note": {
			const noteText = truncate(details.note?.note || details.note?.text || details.note?.label || "Short explanation", 72);
			return {
				key: `note:${details.note?.annotationId || noteText}`,
				type: "note",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.note?.annotationId || null,
				label: "Added note",
				detail: noteText,
			};
		}
		case "browser_scroll_to_annotation": {
			return {
				key: `scroll:${details.annotation?.annotationId || result?.toolCallId || Date.now()}`,
				type: "annotation",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.annotation?.annotationId || null,
				label: "Moved to section",
				detail: "Brought the relevant part of the page into view",
			};
		}
		case "browser_capture_state": {
			if (details.persistedArtifact?.artifactId) {
				return {
					key: `artifact:${details.persistedArtifact.artifactId}`,
					label: "Saved artifact",
					detail: truncate(details.persistedArtifact.artifactId, 72),
				};
			}
			return null;
		}
		case "browser_restore_state": {
			const detail = truncate(details.artifact?.page?.title || details.artifactPath || "Saved browser state", 72);
			return { key: `restore:${detail}`, label: "Restored view", detail };
		}
		default:
			return null;
	}
}

function pushPageAction(action) {
	if (!activeRequest || !action) return;
	if (activeRequest.pageActions.some((existing) => existing.key === action.key)) return;
	activeRequest.pageActions.push(action);
	emitRequestEvent({
		type: "page_actions",
		actions: [...activeRequest.pageActions],
	});
	mutateUiState((state) => {
		state.pageActions = [...activeRequest.pageActions];
	});
}

function handleSessionEvent(session, event) {
	if (!activeRequest) return;

	switch (event.type) {
		case "agent_start": {
			emitRequestEvent({ type: "status", status: "Thinking…" });
			setUiStatus("Thinking…");
			break;
		}
		case "message_update": {
			if (event.assistantMessageEvent.type === "text_delta") {
				activeRequest.reply += event.assistantMessageEvent.delta;
				updateAssistantDraft(activeRequest.id, activeRequest.reply, { pending: true });
				emitRequestEvent({
					type: "reply_delta",
					delta: event.assistantMessageEvent.delta,
					reply: activeRequest.reply,
				});
				emitRequestEvent({ type: "status", status: "Responding…" });
				setUiStatus("Responding…");
			} else if (event.assistantMessageEvent.type === "thinking_delta" && !activeRequest.reply.trim()) {
				emitRequestEvent({ type: "status", status: "Thinking…" });
				activeRequest.reasoning = `${activeRequest.reasoning || ""}${event.assistantMessageEvent.delta || ""}`.trim();
				appendUiActivity({
					id: `reasoning:${activeRequest.id}`,
					kind: "reasoning",
					label: "Reasoning",
					text: truncate(activeRequest.reasoning, 5000),
				});
				setUiStatus("Thinking…");
			}
			break;
		}
		case "tool_execution_start": {
			activeRequest.toolExecutionCount = (activeRequest.toolExecutionCount || 0) + 1;
			appendUiActivity({
				id: `tool:${event.toolCallId || `${event.toolName}:${activeRequest.toolExecutionCount}`}`,
				kind: "tool",
				label: getToolStatusMessage(event.toolName),
				toolName: event.toolName,
				state: "running",
			});
			emitRequestEvent({
				type: "status",
				status: getToolStatusMessage(event.toolName),
			});
			setUiStatus(getToolStatusMessage(event.toolName));
			break;
		}
		case "tool_execution_end": {
			appendUiActivity({
				id: `tool:${event.toolCallId || event.toolName}`,
				kind: "tool",
				label: event.isError ? `Failed ${event.toolName}` : getToolStatusMessage(event.toolName),
				toolName: event.toolName,
				state: event.isError ? "error" : "complete",
			});
			if (!event.isError) {
				pushPageAction(buildPageAction(event.toolName, event.result));
			}
			emitRequestEvent({ type: "status", status: "Writing answer…" });
			setUiStatus("Writing answer…");
			break;
		}
		case "auto_retry_start": {
			emitRequestEvent({
				type: "status",
				status: `Retrying after an error (${event.attempt}/${event.maxAttempts})…`,
			});
			setUiStatus(`Retrying after an error (${event.attempt}/${event.maxAttempts})…`);
			break;
		}
		case "compaction_start": {
			emitRequestEvent({ type: "status", status: "Compacting conversation context…" });
			setUiStatus("Compacting conversation context…");
			break;
		}
		case "agent_end": {
			const reply = activeRequest.reply.trim() || extractAssistantText(event.messages) || "(No reply generated.)";
			syncUiStateFromSession(session, {
				activities: [...uiState.activities],
				pageActions: [...activeRequest.pageActions],
				status: "Reply ready",
				activeRequestId: null,
			});
			emitRequestEvent({
				type: "complete",
				reply,
				actions: [...activeRequest.pageActions],
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
				sessionName: session.sessionName || null,
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
	syncUiStateFromSession(result.session);

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

export async function getSessionOverview(limit = 3) {
	const recentSessions = await SessionManager.list(PROJECT_ROOT, SESSION_DIR);
	recentSessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	const currentSession = await getCurrentRuntimeSessionState();
	const currentSessionFile = currentSession?.sessionFile || recentSessions[0]?.path || null;
	const sessions = recentSessions.map((info) => buildSessionSummary(info, currentSessionFile));
	if (currentSession && currentSession.sessionFile && !sessions.some((session) => session.path === currentSession.sessionFile)) {
		sessions.unshift(buildCurrentSessionPlaceholder(currentSession));
	}
	return {
		currentSession,
		sessions: sessions.slice(0, Math.max(1, limit)),
	};
}

export async function startNewOnhandSession() {
	const { session } = await ensureRuntime();
	if (activeRequest) {
		throw new Error("Wait for the current Onhand reply to finish before starting a new session.");
	}
	const previousSessionFile = session.sessionFile;
	const created = await session.newSession({ parentSession: previousSessionFile || undefined });
	syncUiStateFromSession(session);
	return {
		created,
		currentSession: buildSessionState(session),
	};
}

export async function switchOnhandSession(sessionPath) {
	const { session } = await ensureRuntime();
	if (activeRequest) {
		throw new Error("Wait for the current Onhand reply to finish before switching sessions.");
	}
	const switched = await session.switchSession(sessionPath);
	syncUiStateFromSession(session);
	return {
		switched,
		currentSession: buildSessionState(session),
	};
}

export async function submitOnhandPrompt({ requestId, prompt, browserContext, onEvent }) {
	const { session } = await ensureRuntime();
	if (activeRequest) {
		throw new Error("Onhand is already responding. Please wait for the current reply to finish.");
	}
	if (!session.sessionName && session.messages.length === 0) {
		session.setSessionName(buildSessionTitleFromPrompt(prompt));
	}

	activeRequest = {
		id: requestId,
		onEvent,
		reply: "",
		reasoning: "",
		pageActions: [],
		toolExecutionCount: 0,
	};
	beginUiRequest(session, requestId, prompt);

	onEvent({
		type: "status",
		status: "Starting Onhand…",
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
		sessionName: session.sessionName || null,
	});

	try {
		await session.prompt(buildLauncherPrompt(prompt, browserContext));
		if (activeRequest?.id === requestId) {
			const reply = activeRequest.reply.trim() || "(No reply generated.)";
			syncUiStateFromSession(session, {
				activities: [...uiState.activities],
				pageActions: [...activeRequest.pageActions],
				status: "Reply ready",
				activeRequestId: null,
			});
			onEvent({
				type: "complete",
				reply,
				actions: [...activeRequest.pageActions],
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
				sessionName: session.sessionName || null,
			});
			activeRequest = null;
		}
		return {
			requestId,
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			sessionName: session.sessionName || null,
		};
	} catch (error) {
		if (activeRequest?.id === requestId) {
			if (error && typeof error === "object") {
				error.pageActions = [...activeRequest.pageActions];
			}
			updateAssistantDraft(requestId, `Error: ${error?.message || String(error)}`, { pending: false, error: true });
			mutateUiState((state) => {
				state.pageActions = [...activeRequest.pageActions];
				state.status = "Prompt failed";
				state.activeRequestId = null;
			});
			activeRequest = null;
		}
		throw error;
	}
}

export function getOnhandUiState() {
	return cloneUiState();
}

export function subscribeOnhandUiState(listener) {
	uiStateListeners.add(listener);
	listener(cloneUiState());
	return () => {
		uiStateListeners.delete(listener);
	};
}

export function getOnhandPageAction(actionKey) {
	if (!actionKey) return null;
	return uiState.pageActions.find((action) => action.key === actionKey) || null;
}

export async function disposeOnhandAgent() {
	activeRequest = null;
	replaceUiState(createEmptyUiState());
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
