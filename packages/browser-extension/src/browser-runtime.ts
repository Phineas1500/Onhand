import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModel, registerFauxProvider, Type } from "@mariozechner/pi-ai";
import {
	getBrowserOAuthApiKey,
	getBrowserOAuthProvider,
	getBrowserOAuthProviders,
	getDefaultOAuthModel,
	isBrowserOAuthProvider,
	loginBrowserOAuthProvider,
	summarizeOAuthCredentials,
	type BrowserOAuthCredentials,
	type BrowserOAuthProgressEvent,
} from "./browser-oauth";

declare const chrome: any;

type BrowserCommandRunner = (name: string, args?: Record<string, unknown>) => Promise<any>;

interface RuntimeHost {
	runCommand: BrowserCommandRunner;
	snapshotState: () => Promise<any>;
	log?: (...args: unknown[]) => void;
	notifyAuthProgress?: (event: BrowserOAuthProgressEvent) => void;
	resolveModel?: (provider: string, model: string) => any;
}

interface RuntimeSession {
	id: string;
	name: string | null;
	createdAt: string;
	updatedAt: string;
	messages: AgentMessage[];
	turns: UiTurn[];
	pageActions: PageAction[];
}

interface RuntimeSettings {
	learningMode: boolean;
	aiProvider: string;
	aiModel: string;
	aiApiKey: string;
	authMode: "api-key" | "oauth";
	oauthCredentials: Record<string, BrowserOAuthCredentials>;
}

interface UiMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	createdAt?: string;
	pending?: boolean;
	error?: boolean;
}

interface UiTurn {
	id: string;
	userPrompt: string;
	reply: string;
	activities: UiActivity[];
	pageActions: PageAction[];
	pending: boolean;
	error: boolean;
	createdAt: string;
}

interface UiActivity {
	id: string;
	kind: "tool" | "reasoning";
	label: string;
	text?: string;
	toolName?: string;
	state?: "running" | "complete" | "error";
}

interface PageAction {
	key: string;
	type?: string;
	clientId?: string | null;
	tabId?: number | null;
	windowId?: number | null;
	annotationId?: string | null;
	label: string;
	detail: string;
	citationText?: string;
}

const STORAGE_KEY = "onhandBrowserRuntime";
const OPENAI_API_PROVIDER = "openai";
const OPENAI_API_MODEL = "gpt-4.1-mini";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_MODEL = "gpt-5.5";
const SMOKE_PROVIDER = "onhand-smoke";
const SMOKE_MODEL = "onhand-smoke-1";
const DEFAULT_SETTINGS: RuntimeSettings = {
	learningMode: false,
	aiProvider: OPENAI_CODEX_PROVIDER,
	aiModel: OPENAI_CODEX_MODEL,
	aiApiKey: "",
	authMode: "oauth",
	oauthCredentials: {},
};

const ONHAND_INTERNAL_PROMPT_PREFIX = "[Onhand internal]";
let smokeModelRegistration: ReturnType<typeof registerFauxProvider> | null = null;

const ONHAND_SYSTEM_PROMPT = `You are Onhand, a contextual tutor and research copilot running inside a Chromium extension side panel.

Prefer helping with the material already open in the user's browser. Stay grounded in the captured browser context supplied with each prompt. For questions about the current page or already-open tabs, use browser tools before answering.

When the user asks about content that is already open, do not stop at a detached answer when you can ground it visually. If you can identify the supporting passage, highlight the exact text, add a short note near it, scroll it into view, and then answer concisely.

For straightforward explanations, one or two strong supporting passages are usually enough. Once the main claims are grounded, stop gathering more evidence and answer.

Avoid navigating away from the current page unless the user explicitly asks. Use markdown sparingly.`;

const ONHAND_LEARNING_MODE_APPEND = `Learning mode is enabled for this request.

Help the user learn from the material on screen. When useful, identify a prerequisite concept, correct likely misconceptions, and add one short retrieval-check note. Do not force Socratic behavior on simple or transactional prompts.`;

const LIST_TABS_SCHEMA = Type.Object({
	onlyActive: Type.Optional(Type.Boolean({ description: "Only include active tabs" })),
});

const TAB_SELECTOR_SCHEMA = {
	tabId: Type.Optional(Type.Number({ description: "Exact browser tab ID to target. Omit this to use the active tab." })),
};

const VISIBLE_TEXT_SCHEMA = Type.Object({
	...TAB_SELECTOR_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters of visible text to return" })),
	maxBlocks: Type.Optional(Type.Number({ description: "Maximum visible text blocks to return" })),
});

const HIGHLIGHT_TEXT_SCHEMA = Type.Object({
	...TAB_SELECTOR_SCHEMA,
	text: Type.String({ description: "Visible text to highlight on the page" }),
	occurrence: Type.Optional(Type.Number({ description: "1-based occurrence of the match to highlight" })),
	clearExisting: Type.Optional(Type.Boolean({ description: "Clear existing Onhand highlights first" })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Scroll the highlighted match into view" })),
});

const SHOW_NOTE_SCHEMA = Type.Object({
	...TAB_SELECTOR_SCHEMA,
	annotationId: Type.String({ description: "Annotation ID returned by browser_highlight_text" }),
	note: Type.String({ description: "Short explanatory note to display near the highlighted content" }),
	label: Type.Optional(Type.String({ description: "Optional short label shown above the note" })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Keep the anchored content in view when showing the note" })),
});

const SCROLL_TO_ANNOTATION_SCHEMA = Type.Object({
	...TAB_SELECTOR_SCHEMA,
	annotationId: Type.String({ description: "Annotation ID returned by browser_highlight_text" }),
	target: Type.Optional(Type.String({ description: "Scroll target: annotation or note" })),
});

const RUN_JS_SCHEMA = Type.Object({
	...TAB_SELECTOR_SCHEMA,
	expression: Type.String({ description: "JavaScript expression to evaluate in the target tab" }),
});

function nowIso() {
	return new Date().toISOString();
}

function truncate(value: unknown, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}...`;
}

function normalizeAuthMode(value: unknown): RuntimeSettings["authMode"] {
	return value === "oauth" ? "oauth" : "api-key";
}

function normalizeOAuthCredentials(value: unknown): Record<string, BrowserOAuthCredentials> {
	if (!value || typeof value !== "object") return {};
	const normalized: Record<string, BrowserOAuthCredentials> = {};
	for (const [providerId, rawCredential] of Object.entries(value as Record<string, any>)) {
		if (providerId !== OPENAI_CODEX_PROVIDER) continue;
		if (!rawCredential || typeof rawCredential !== "object") continue;
		if (typeof rawCredential.refresh !== "string" || typeof rawCredential.access !== "string") continue;
		normalized[providerId] = {
			...rawCredential,
			refresh: rawCredential.refresh,
			access: rawCredential.access,
			expires: typeof rawCredential.expires === "number" ? rawCredential.expires : 0,
		};
	}
	return normalized;
}

function normalizeProviderForAuthMode(provider: string, authMode: RuntimeSettings["authMode"], allowSmokeProvider = false) {
	if (allowSmokeProvider && provider === SMOKE_PROVIDER) return SMOKE_PROVIDER;
	return authMode === "oauth" ? OPENAI_CODEX_PROVIDER : OPENAI_API_PROVIDER;
}

function normalizeModelForProvider(model: string, provider: string, authMode: RuntimeSettings["authMode"]) {
	const trimmed = model.trim();
	if (provider === SMOKE_PROVIDER) return trimmed || SMOKE_MODEL;
	if (authMode === "oauth") return OPENAI_CODEX_MODEL;
	return trimmed || OPENAI_API_MODEL;
}

function buildPublicSettings(settings: RuntimeSettings) {
	const signedInProviders = summarizeOAuthCredentials(settings.oauthCredentials);
	const activeOAuthProvider = signedInProviders.find((provider) => provider.id === settings.aiProvider) || null;
	return {
		learningMode: settings.learningMode,
		aiProvider: settings.aiProvider,
		aiModel: settings.aiModel,
		authMode: settings.authMode,
		hasAiApiKey: Boolean(settings.aiApiKey),
		hasOAuthCredentials: Boolean(activeOAuthProvider?.signedIn),
		activeOAuthProvider,
		oauthProviders: getBrowserOAuthProviders(),
		signedInProviders,
	};
}

function stripForbiddenBrowserHeaders(headers: Record<string, string> | undefined) {
	if (!headers || typeof headers !== "object") return headers;
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "user-agent") continue;
		cleaned[key] = value;
	}
	return cleaned;
}

function getSmokeModel(modelId: string) {
	smokeModelRegistration ||= registerFauxProvider({
		api: "onhand-smoke-api",
		provider: SMOKE_PROVIDER,
		models: [{ id: SMOKE_MODEL, name: "Onhand Smoke Model", reasoning: false }],
		tokenSize: { min: 8, max: 16 },
	});
	smokeModelRegistration.setResponses([
		fauxAssistantMessage([
			fauxToolCall("browser_highlight_text", {
				text: "Alpha smoke content",
				clearExisting: true,
				scrollIntoView: true,
			}),
		]),
		fauxAssistantMessage(fauxText("Browser runtime smoke ok")),
	]);
	return smokeModelRegistration.getModel(modelId || SMOKE_MODEL);
}

function createSession(name: string | null = null): RuntimeSession {
	const timestamp = nowIso();
	const id = `session_${crypto.randomUUID()}`;
	return {
		id,
		name,
		createdAt: timestamp,
		updatedAt: timestamp,
		messages: [],
		turns: [],
		pageActions: [],
	};
}

function createEmptyState(session: RuntimeSession | null, settings: RuntimeSettings) {
	const publicSettings = buildPublicSettings(settings);
	return {
		currentSession: session ? buildSessionState(session) : null,
		turns: session?.turns || [],
		currentTurnId: null,
		messages: [] as UiMessage[],
		activities: [] as UiActivity[],
		pageActions: [] as PageAction[],
		status: "Ready",
		activeRequestId: null as string | null,
		preferences: {
			runtime: "browser-extension",
			...publicSettings,
		},
		updatedAt: Date.now(),
	};
}

function buildSessionState(session: RuntimeSession) {
	return {
		sessionId: session.id,
		sessionFile: session.id,
		sessionName: session.name,
	};
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: any) => block?.type === "text")
		.map((block: any) => block.text || "")
		.join("")
		.trim();
}

function extractUserQuestionFromSessionText(value: unknown): string | null {
	const text = String(value || "");
	const match = text.match(/User question:\s*([\s\S]*?)\s*Captured browser context/i);
	return match ? truncate(match[1], 180) : null;
}

function buildConversationMessages(agentMessages: AgentMessage[] = []): UiMessage[] {
	const messages: UiMessage[] = [];
	for (let index = 0; index < agentMessages.length; index += 1) {
		const message: any = agentMessages[index];
		if (!message || typeof message !== "object" || !message.role || message.role === "toolResult") continue;
		let text = "";
		if (message.role === "user") {
			const rawText = extractTextFromContent(message.content);
			if (rawText.trim().startsWith(ONHAND_INTERNAL_PROMPT_PREFIX)) continue;
			text = extractUserQuestionFromSessionText(rawText) || truncate(rawText, 240);
		} else if (message.role === "assistant") {
			text = extractTextFromContent(message.content);
		}
		if (!text) continue;
		messages.push({
			id: `${message.role}:${index}`,
			role: message.role,
			text,
			createdAt: typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined,
			error: Boolean(message.errorMessage),
		});
	}
	return messages;
}

function extractAssistantText(messages: AgentMessage[] = []) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message: any = messages[index];
		if (message?.role !== "assistant") continue;
		return extractTextFromContent(message.content);
	}
	return "";
}

function extractAssistantFailure(messages: AgentMessage[] = [], userAborted = false): Error | null {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message: any = messages[index];
		if (message?.role !== "assistant") continue;
		if (message.stopReason === "error" || message.errorMessage) {
			return new Error(message.errorMessage || "The model provider returned an error.");
		}
		if (message.stopReason === "aborted" && !userAborted) {
			return new Error(message.errorMessage || "The model request was aborted.");
		}
		return null;
	}
	return null;
}

function buildSessionTitleFromPrompt(prompt: string) {
	const cleaned =
		String(prompt || "")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^['"`]+|['"`]+$/g, "")
			.replace(/[?.!]+$/g, "") || "New session";
	return truncate(cleaned, 80);
}

function buildAttachmentContext(attachments: any[] = []) {
	return attachments
		.map((attachment) => {
			const safeName = String(attachment?.name || "attachment").replace(/"/g, "&quot;");
			if (attachment?.kind === "text" && typeof attachment.text === "string") {
				return `<file name="${safeName}">\n${attachment.text}\n</file>`;
			}
			if (attachment?.kind === "image") {
				return `<file name="${safeName}"></file>`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}

function buildPromptImages(attachments: any[] = []) {
	return attachments
		.filter((attachment) => attachment?.kind === "image" && typeof attachment.data === "string" && attachment.data.trim())
		.map((attachment) => ({
			type: "image" as const,
			data: attachment.data,
			mimeType: attachment.mimeType || "image/png",
		}));
}

function flattenTabs(state: any) {
	const windows = Array.isArray(state?.windows) ? state.windows : [];
	return windows.flatMap((windowInfo: any) =>
		(Array.isArray(windowInfo.tabs) ? windowInfo.tabs : []).map((tab: any) => ({
			...tab,
			windowFocused: Boolean(windowInfo.focused),
		})),
	);
}

function pickActiveTab(state: any) {
	const tabs = flattenTabs(state);
	return tabs.find((tab: any) => tab.active && tab.windowFocused) || tabs.find((tab: any) => tab.active) || tabs[0] || null;
}

function isPrivilegedUrl(url: unknown) {
	return /^(?:chrome|edge|brave|about):\/\//i.test(String(url || ""));
}

function summarizeOpenTabs(state: any, activeTab: any, limit = 8) {
	const targetWindowId = activeTab?.windowId;
	return flattenTabs(state)
		.filter((tab: any) => {
			if (!tab?.id || isPrivilegedUrl(tab.url)) return false;
			return targetWindowId == null || tab.windowId === targetWindowId;
		})
		.sort((a: any, b: any) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(Boolean(b.windowFocused)) - Number(Boolean(a.windowFocused)))
		.slice(0, limit)
		.map((tab: any) => ({
			id: tab.id,
			windowId: tab.windowId,
			active: Boolean(tab.active),
			title: tab.title || "(untitled)",
			url: tab.url || "",
		}));
}

async function renderBrowserContext(host: RuntimeHost) {
	try {
		const state = await host.snapshotState();
		const activeTab = pickActiveTab(state);
		const openTabs = summarizeOpenTabs(state, activeTab);
		let selection = null;
		let visible = null;
		let warning = null;

		if (activeTab?.id && activeTab.url && !isPrivilegedUrl(activeTab.url)) {
			try {
				selection = await host.runCommand("get_selection", { tabId: activeTab.id });
			} catch (error: any) {
				warning = error?.message || String(error);
			}
			try {
				visible = await host.runCommand("get_visible_text", { tabId: activeTab.id, maxChars: 3000, maxBlocks: 12 });
			} catch (error: any) {
				warning ||= error?.message || String(error);
			}
		} else if (activeTab?.url) {
			warning = `Interactive page context is unavailable on privileged pages like ${activeTab.url}`;
		}

		const lines: string[] = [];
		if (activeTab) {
			lines.push(`Active tab title: ${activeTab.title || "(untitled)"}`);
			lines.push(`Active tab URL: ${activeTab.url || "(unknown)"}`);
		}
		if (openTabs.length) {
			lines.push("Open tabs in the current browser window:");
			for (const tab of openTabs) {
				const prefix = tab.active ? "* " : "- ";
				lines.push(`${prefix}${tab.title || "(untitled)"}${tab.url ? ` - ${tab.url}` : ""}`);
			}
		}
		const selectionText = selection?.selection?.text || selection?.selection || "";
		if (selectionText) lines.push(`Selected text: ${JSON.stringify(truncate(selectionText, 1200))}`);
		const visibleText = visible?.visible?.text || visible?.text || "";
		if (visibleText) {
			lines.push("Visible text snapshot:");
			lines.push(truncate(visibleText, 3000));
		}
		if (warning) lines.push(`Warning: ${warning}`);
		return lines.join("\n") || "Browser context was unavailable.";
	} catch (error: any) {
		return `Browser context was unavailable.\nReason: ${error?.message || String(error)}`;
	}
}

function buildLauncherPrompt(prompt: string, browserContext: string, attachments: any[], learningMode: boolean) {
	const attachmentContext = buildAttachmentContext(attachments);
	return [
		"The user invoked Onhand from the browser extension side panel.",
		"",
		`User question:\n${String(prompt || "").trim() || "(See attached files.)"}`,
		...(attachmentContext ? ["", "Attached files:", attachmentContext] : []),
		"",
		"Captured browser context right before the question:",
		browserContext,
		"",
		"Use this captured context as your starting point. Prefer already-open tabs and pages over navigation.",
		"Support major claims with visible evidence from the user's open pages. Highlight the supporting passage first, then explain what it shows.",
		"Use markdown emphasis sparingly and only for short phrases that really matter.",
		...(learningMode ? ["", ONHAND_LEARNING_MODE_APPEND] : []),
	].join("\n");
}

function toolResultText(result: any, maxChars = 5000) {
	return truncate(JSON.stringify(result, null, 2), maxChars);
}

function createTools(host: RuntimeHost): AgentTool[] {
	const commandTool = (
		name: string,
		label: string,
		description: string,
		parameters: any,
		commandName: string,
		options: { sequential?: boolean } = {},
	): AgentTool => ({
		name,
		label,
		description,
		parameters,
		executionMode: options.sequential ? "sequential" : undefined,
		async execute(_toolCallId, params) {
			const result = await host.runCommand(commandName, params as Record<string, unknown>);
			return {
				content: [{ type: "text", text: toolResultText(result) }],
				details: result,
			};
		},
	});

	return [
		{
			name: "browser_list_tabs",
			label: "Browser List Tabs",
			description: "List windows and tabs from the current Chromium browser session.",
			parameters: LIST_TABS_SCHEMA,
			async execute(_toolCallId, params: any) {
				const state = await host.snapshotState();
				const tabs = flattenTabs(state).filter((tab: any) => !params?.onlyActive || tab.active);
				return {
					content: [{ type: "text", text: toolResultText({ tabs }) }],
					details: { state, tabs },
				};
			},
		},
		commandTool(
			"browser_get_visible_text",
			"Browser Visible Text",
			"Read the text currently visible in a browser tab.",
			VISIBLE_TEXT_SCHEMA,
			"get_visible_text",
		),
		commandTool(
			"browser_get_selection",
			"Browser Selection",
			"Read the user's current text selection in a browser tab.",
			Type.Object({ ...TAB_SELECTOR_SCHEMA }),
			"get_selection",
		),
		commandTool(
			"browser_highlight_text",
			"Browser Highlight Text",
			"Highlight exact visible text on the page. Use short, distinctive spans.",
			HIGHLIGHT_TEXT_SCHEMA,
			"highlight_text",
			{ sequential: true },
		),
		commandTool(
			"browser_show_note",
			"Browser Show Note",
			"Show a short explanatory note attached to a highlighted passage.",
			SHOW_NOTE_SCHEMA,
			"show_note",
			{ sequential: true },
		),
		commandTool(
			"browser_scroll_to_annotation",
			"Browser Scroll To Annotation",
			"Scroll the page to a previously created highlight or note.",
			SCROLL_TO_ANNOTATION_SCHEMA,
			"scroll_to_annotation",
			{ sequential: true },
		),
		commandTool(
			"browser_clear_annotations",
			"Browser Clear Annotations",
			"Clear Onhand highlights and notes from the target tab.",
			Type.Object({ ...TAB_SELECTOR_SCHEMA }),
			"clear_annotations",
			{ sequential: true },
		),
		commandTool(
			"browser_run_js",
			"Browser Run JS",
			"Evaluate JavaScript in the target tab. Prefer readable browser tools before using this.",
			RUN_JS_SCHEMA,
			"run_js",
		),
	];
}

function getToolStatusMessage(toolName: string) {
	switch (toolName) {
		case "browser_list_tabs":
			return "Checking open tabs...";
		case "browser_get_selection":
			return "Reading your current selection...";
		case "browser_get_visible_text":
			return "Reading the visible part of the page...";
		case "browser_highlight_text":
			return "Highlighting the relevant passage...";
		case "browser_show_note":
			return "Adding a note on the page...";
		case "browser_scroll_to_annotation":
			return "Moving the page to the relevant section...";
		case "browser_clear_annotations":
			return "Clearing previous Onhand annotations...";
		default:
			return toolName?.startsWith("browser_") ? "Inspecting the current page..." : `Using ${toolName}...`;
	}
}

function buildPageAction(toolName: string, result: any): PageAction | null {
	const details = result?.details || result || {};
	const tab = details.tab || null;
	switch (toolName) {
		case "browser_highlight_text": {
			const matchedTextFull = String(details.annotation?.matchedText || "").trim();
			const matchedText = truncate(matchedTextFull || "Relevant passage", 72);
			return {
				key: `highlight:${details.annotation?.annotationId || matchedText}`,
				type: "annotation",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.annotation?.annotationId || null,
				label: "Highlighted text",
				detail: matchedText,
				citationText: matchedTextFull || matchedText,
			};
		}
		case "browser_show_note": {
			const noteTextFull = String(details.note?.note || details.note?.text || details.note?.label || "").trim();
			const noteText = truncate(noteTextFull || "Short explanation", 72);
			return {
				key: `note:${details.note?.annotationId || noteText}`,
				type: "note",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.note?.annotationId || null,
				label: "Added note",
				detail: noteText,
				citationText: noteTextFull || noteText,
			};
		}
		case "browser_scroll_to_annotation":
			return {
				key: `scroll:${details.annotation?.annotationId || Date.now()}`,
				type: "annotation",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.annotation?.annotationId || null,
				label: "Moved to section",
				detail: "Brought the relevant part of the page into view",
			};
		default:
			return null;
	}
}

function appendUniquePageAction(actions: PageAction[], action: PageAction | null) {
	if (!action) return false;
	if (actions.some((existing) => existing.key === action.key)) return false;
	actions.push(action);
	return true;
}

export function createOnhandBrowserRuntime(host: RuntimeHost) {
	let storePromise: Promise<any> | null = null;
	let uiState: any | null = null;
	let activeAgent: Agent | null = null;
	let activeRequest: any | null = null;

	async function loadStore() {
		if (storePromise) return await storePromise;
		storePromise = (async () => {
			const stored = await chrome.storage.local.get({ [STORAGE_KEY]: null });
			const raw = stored[STORAGE_KEY] || {};
			const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
			const authMode = normalizeAuthMode(rawSettings.authMode ?? DEFAULT_SETTINGS.authMode);
			const rawProvider = String(rawSettings.aiProvider || DEFAULT_SETTINGS.aiProvider).trim();
			const aiProvider = normalizeProviderForAuthMode(
				rawProvider,
				authMode,
			);
			const rawModel =
				authMode === "api-key" && aiProvider === OPENAI_API_PROVIDER && rawProvider !== OPENAI_API_PROVIDER
					? OPENAI_API_MODEL
					: String(rawSettings.aiModel || DEFAULT_SETTINGS.aiModel);
			const settings: RuntimeSettings = {
				...DEFAULT_SETTINGS,
				...rawSettings,
				learningMode: Boolean(rawSettings.learningMode),
				aiProvider,
				aiModel: normalizeModelForProvider(rawModel, aiProvider, authMode),
				aiApiKey: typeof rawSettings.aiApiKey === "string" ? rawSettings.aiApiKey : "",
				authMode,
				oauthCredentials: normalizeOAuthCredentials(rawSettings.oauthCredentials),
			};
			const sessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
			let currentSessionId = typeof raw.currentSessionId === "string" ? raw.currentSessionId : "";
			if (!currentSessionId || !sessions[currentSessionId]) {
				const session = createSession();
				sessions[session.id] = session;
				currentSessionId = session.id;
			}
			return { settings, sessions, currentSessionId };
		})();
		return await storePromise;
	}

	async function saveStore(store: any) {
		storePromise = Promise.resolve(store);
		await chrome.storage.local.set({ [STORAGE_KEY]: store });
	}

	async function getCurrentSession() {
		const store = await loadStore();
		return store.sessions[store.currentSessionId] as RuntimeSession;
	}

	async function replaceCurrentSession(session: RuntimeSession) {
		const store = await loadStore();
		session.updatedAt = nowIso();
		store.sessions[session.id] = session;
		store.currentSessionId = session.id;
		await saveStore(store);
		return session;
	}

	async function ensureUiState() {
		if (uiState) return uiState;
		const store = await loadStore();
		const session = store.sessions[store.currentSessionId] as RuntimeSession;
		uiState = createEmptyState(session, store.settings);
		uiState.messages = buildConversationMessages(session.messages);
		return uiState;
	}

	async function publishState(partial: Record<string, unknown> = {}) {
		const state = await ensureUiState();
		uiState = {
			...state,
			...partial,
			updatedAt: Date.now(),
		};
		return uiState;
	}

	function updateAssistantDraft(requestId: string, text: string, extra: Record<string, unknown> = {}) {
		const message = uiState?.messages?.find((entry: UiMessage) => entry.id === `assistant:${requestId}`);
		if (!message) return;
		message.text = text;
		Object.assign(message, extra);
		uiState.updatedAt = Date.now();
	}

	function appendActivity(activity: UiActivity) {
		if (!uiState) return;
		const existingIndex = uiState.activities.findIndex((entry: UiActivity) => entry.id === activity.id);
		if (existingIndex >= 0) {
			uiState.activities[existingIndex] = { ...uiState.activities[existingIndex], ...activity };
		} else {
			uiState.activities.push(activity);
		}
		uiState.updatedAt = Date.now();
	}

	function beginRequest(session: RuntimeSession, settings: RuntimeSettings, requestId: string, displayPrompt: string) {
		const now = nowIso();
		uiState = {
			...createEmptyState(session, settings),
			turns: session.turns || [],
			currentTurnId: requestId,
			messages: [
				...buildConversationMessages(session.messages),
				{ id: `user:${requestId}`, role: "user", text: displayPrompt.trim(), createdAt: now },
				{ id: `assistant:${requestId}`, role: "assistant", text: "", createdAt: now, pending: true },
			],
			activities: [],
			pageActions: [],
			status: "Starting Onhand...",
			activeRequestId: requestId,
		};
	}

	async function finalizeRequest(
		session: RuntimeSession,
		requestId: string,
		error: Error | null = null,
		messagesOverride: AgentMessage[] | null = null,
	) {
		if (!activeRequest || activeRequest.id !== requestId) return;
		const agentMessages = messagesOverride || activeAgent?.state.messages || [];
		const finalError = error || extractAssistantFailure(agentMessages, Boolean(activeRequest.aborted));
		const reply = activeRequest.reply.trim() || (finalError ? `Error: ${finalError.message}` : extractAssistantText(agentMessages)) || "(No reply generated.)";
		updateAssistantDraft(requestId, reply, { pending: false, error: Boolean(finalError) });
		const turn: UiTurn = {
			id: requestId,
			userPrompt: activeRequest.displayPrompt,
			reply,
			activities: [...(uiState?.activities || [])],
			pageActions: [...activeRequest.pageActions],
			pending: false,
			error: Boolean(finalError),
			createdAt: activeRequest.createdAt,
		};
		session.messages = agentMessages.length ? [...agentMessages] : session.messages;
		session.turns = [...(session.turns || []), turn];
		session.pageActions = [...activeRequest.pageActions];
		await replaceCurrentSession(session);
		await publishState({
			currentSession: buildSessionState(session),
			turns: session.turns,
			messages: buildConversationMessages(session.messages),
			activities: [...turn.activities],
			pageActions: [...activeRequest.pageActions],
			status: finalError ? "Prompt failed" : activeRequest.aborted ? "Stopped" : "Reply ready",
			activeRequestId: null,
		});
		activeAgent = null;
		activeRequest = null;
	}

	function handleAgentEvent(session: RuntimeSession, requestId: string, event: AgentEvent) {
		if (!activeRequest || activeRequest.id !== requestId) return;
		switch (event.type) {
			case "agent_start":
				void publishState({ status: "Thinking..." });
				break;
			case "message_update": {
				const assistantEvent: any = (event as any).assistantMessageEvent;
				if (assistantEvent?.type === "text_delta") {
					activeRequest.reply += assistantEvent.delta || "";
					updateAssistantDraft(requestId, activeRequest.reply, { pending: true });
					void publishState({ status: "Responding..." });
				} else if (assistantEvent?.type === "thinking_delta" && !activeRequest.reply.trim()) {
					activeRequest.reasoning = `${activeRequest.reasoning || ""}${assistantEvent.delta || ""}`;
					appendActivity({
						id: `reasoning:${requestId}`,
						kind: "reasoning",
						label: "Reasoning",
						text: truncate(activeRequest.reasoning, 5000),
					});
					void publishState({ status: "Thinking..." });
				}
				break;
			}
			case "tool_execution_start": {
				const toolName = (event as any).toolName || "";
				appendActivity({
					id: `tool:${(event as any).toolCallId || toolName}`,
					kind: "tool",
					label: getToolStatusMessage(toolName),
					toolName,
					state: "running",
				});
				void publishState({ status: getToolStatusMessage(toolName) });
				break;
			}
			case "tool_execution_end": {
				const toolName = (event as any).toolName || "";
				const activityId = `tool:${(event as any).toolCallId || toolName}`;
				if ((event as any).isError) {
					appendActivity({
						id: activityId,
						kind: "tool",
						label: getToolStatusMessage(toolName),
						toolName,
						state: "error",
					});
					void publishState({ status: "Trying a different approach..." });
				} else {
					appendActivity({
						id: activityId,
						kind: "tool",
						label: getToolStatusMessage(toolName),
						toolName,
						state: "complete",
					});
					appendUniquePageAction(activeRequest.pageActions, buildPageAction(toolName, (event as any).result));
					void publishState({
						pageActions: [...activeRequest.pageActions],
						status: "Writing answer...",
					});
				}
				break;
			}
			case "agent_end":
				void finalizeRequest(session, requestId, null, (event as any).messages || null).catch((error) => host.log?.("finalize failed", error));
				break;
		}
	}

	function prepareModelForBrowser(model: any, settings: RuntimeSettings) {
		const prepared = {
			...model,
			headers: stripForbiddenBrowserHeaders(model.headers),
		};
		return prepared;
	}

	async function getConfiguredModel(settings: RuntimeSettings) {
		const model =
			settings.aiProvider === SMOKE_PROVIDER
				? getSmokeModel(settings.aiModel)
				: (await host.resolveModel?.(settings.aiProvider, settings.aiModel)) || getModel(settings.aiProvider as any, settings.aiModel as any);
		if (!model) {
			throw new Error(`Unknown AI model: ${settings.aiProvider}/${settings.aiModel}`);
		}
		if (settings.authMode === "oauth") {
			if (!isBrowserOAuthProvider(settings.aiProvider)) {
				throw new Error("Only OpenAI Codex supports direct sign-in. Use OpenAI API key auth for API-key mode.");
			}
			if (!settings.oauthCredentials?.[settings.aiProvider]) {
				throw new Error(`Sign in to ${getBrowserOAuthProvider(settings.aiProvider)?.name || settings.aiProvider} in Onhand options first.`);
			}
		} else if (!settings.aiApiKey) {
			throw new Error("Set an OpenAI API key or use OpenAI Codex sign-in in the Onhand extension options before using the browser runtime.");
		}
		return prepareModelForBrowser(model, settings);
	}

	async function resolveApiKey(provider: string) {
		const store = await loadStore();
		const settings = store.settings as RuntimeSettings;
		if (provider !== settings.aiProvider) return undefined;
		if (settings.authMode !== "oauth") return settings.aiApiKey || undefined;
		const credentials = settings.oauthCredentials?.[provider];
		if (!credentials) return undefined;
		const result = await getBrowserOAuthApiKey(provider, credentials, {
			onProgress: (event) => host.notifyAuthProgress?.(event),
		});
		if (JSON.stringify(result.credentials) !== JSON.stringify(credentials)) {
			settings.oauthCredentials = {
				...(settings.oauthCredentials || {}),
				[provider]: result.credentials,
			};
			store.settings = settings;
			await saveStore(store);
			await publishState({
				preferences: {
					runtime: "browser-extension",
					...buildPublicSettings(settings),
				},
			});
		}
		return result.apiKey;
	}

	async function getPublicSettings() {
		const store = await loadStore();
		return buildPublicSettings(store.settings);
	}

	return {
		async getState() {
			const store = await loadStore();
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			const state = await ensureUiState();
			return {
				...state,
				currentSession: buildSessionState(session),
				preferences: {
					...state.preferences,
					runtime: "browser-extension",
					...buildPublicSettings(store.settings),
				},
			};
		},

		async getSettings() {
			return await getPublicSettings();
		},

		async updateSettings(partial: Partial<RuntimeSettings>) {
			const store = await loadStore();
			const nextPartial = partial || {};
			const nextOAuthCredentials =
				nextPartial.oauthCredentials && typeof nextPartial.oauthCredentials === "object"
					? normalizeOAuthCredentials(nextPartial.oauthCredentials)
					: store.settings.oauthCredentials;
			const authMode = normalizeAuthMode(nextPartial.authMode ?? store.settings.authMode);
			const aiProvider = normalizeProviderForAuthMode(
				String(nextPartial.aiProvider || store.settings.aiProvider || DEFAULT_SETTINGS.aiProvider).trim(),
				authMode,
				true,
			);
			const aiModel = normalizeModelForProvider(
				String(nextPartial.aiModel || store.settings.aiModel || DEFAULT_SETTINGS.aiModel),
				aiProvider,
				authMode,
			);
			store.settings = {
				...store.settings,
				...nextPartial,
				learningMode: Boolean(nextPartial.learningMode ?? store.settings.learningMode),
				aiProvider,
				aiModel,
				aiApiKey: typeof nextPartial.aiApiKey === "string" ? nextPartial.aiApiKey.trim() : store.settings.aiApiKey,
				authMode,
				oauthCredentials: nextOAuthCredentials,
			};
			await saveStore(store);
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			return await getPublicSettings();
		},

		async signIn(request: any = {}) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before changing sign-in.");
			const providerId = String(request.providerId || "").trim();
			const provider = getBrowserOAuthProvider(providerId);
			if (!provider) throw new Error(`Unknown direct sign-in provider: ${providerId || "(blank)"}`);
			host.notifyAuthProgress?.({
				providerId,
				status: "Starting direct sign-in",
				detail: `Provider: ${provider.name}`,
			});
			const credentials = await loginBrowserOAuthProvider({
				providerId,
				onProgress: (event) => host.notifyAuthProgress?.(event),
			});
			const store = await loadStore();
			const nextModel = getDefaultOAuthModel(providerId) || OPENAI_CODEX_MODEL;
			store.settings = {
				...store.settings,
				authMode: "oauth",
				aiProvider: providerId,
				aiModel: nextModel,
				oauthCredentials: {
					...(store.settings.oauthCredentials || {}),
					[providerId]: credentials,
				},
			};
			await saveStore(store);
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			host.notifyAuthProgress?.({
				providerId,
				status: "Direct sign-in complete",
				detail: `Using ${provider.name} with ${nextModel}.`,
			});
			return await getPublicSettings();
		},

		async signOut(providerId?: string) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before changing sign-in.");
			const store = await loadStore();
			const targetProviderId = String(providerId || store.settings.aiProvider || "").trim();
			if (!targetProviderId) throw new Error("Provider id is required.");
			const oauthCredentials = { ...(store.settings.oauthCredentials || {}) };
			delete oauthCredentials[targetProviderId];
			store.settings = {
				...store.settings,
				oauthCredentials,
				authMode: "oauth",
				aiProvider: OPENAI_CODEX_PROVIDER,
				aiModel: OPENAI_CODEX_MODEL,
			};
			await saveStore(store);
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			return await getPublicSettings();
		},

		async listSessions(limit = 20) {
			const store = await loadStore();
			const sessions = Object.values(store.sessions)
				.sort((left: any, right: any) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
				.slice(0, Math.max(1, limit))
				.map((session: any) => {
					const firstUser = buildConversationMessages(session.messages).find((message) => message.role === "user");
					return {
						path: session.id,
						id: session.id,
						title: session.name || firstUser?.text || "New session",
						name: session.name || null,
						preview: firstUser?.text || "No messages yet.",
						messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
						modifiedAt: session.updatedAt || session.createdAt || nowIso(),
						isCurrent: session.id === store.currentSessionId,
					};
				});
			return {
				currentSession: buildSessionState(store.sessions[store.currentSessionId]),
				sessions,
			};
		},

		async startNewSession() {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before starting a new session.");
			const store = await loadStore();
			const session = createSession();
			store.sessions[session.id] = session;
			store.currentSessionId = session.id;
			await saveStore(store);
			uiState = createEmptyState(session, store.settings);
			return {
				created: { cancelled: false },
				currentSession: buildSessionState(session),
			};
		},

		async switchSession(sessionId: string) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before switching sessions.");
			const store = await loadStore();
			if (!store.sessions[sessionId]) throw new Error("Session not found.");
			store.currentSessionId = sessionId;
			await saveStore(store);
			const session = store.sessions[sessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			return {
				switched: { cancelled: false },
				currentSession: buildSessionState(session),
			};
		},

		async renameSession(sessionName: string) {
			const session = await getCurrentSession();
			session.name = truncate(sessionName, 120);
			await replaceCurrentSession(session);
			await publishState({ currentSession: buildSessionState(session) });
			return { currentSession: buildSessionState(session) };
		},

		async restoreSession(_sessionId?: string) {
			throw new Error("Browser-only session restore is not implemented yet.");
		},

		async submitPrompt(request: any) {
			if (activeRequest) throw new Error("Onhand is already responding. Please wait for the current reply to finish.");
			const store = await loadStore();
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			const prompt = String(request?.prompt || "").trim();
			const displayPrompt = String(request?.displayPrompt || prompt || "").trim() || "Attached files";
			const attachments = Array.isArray(request?.attachments) ? request.attachments : [];
			const requestId = crypto.randomUUID();
			const model = await getConfiguredModel(store.settings);
			const browserContext = await renderBrowserContext(host);
			const learningMode = Boolean(request?.learningMode ?? store.settings.learningMode);
			if (!session.name && session.messages.length === 0) {
				session.name = buildSessionTitleFromPrompt(displayPrompt);
			}

			beginRequest(session, store.settings, requestId, displayPrompt);
			activeRequest = {
				id: requestId,
				displayPrompt,
				reply: "",
				reasoning: "",
				pageActions: [] as PageAction[],
				createdAt: nowIso(),
				aborted: false,
			};
			await publishState({ status: "Starting Onhand..." });

			activeAgent = new Agent({
				initialState: {
					systemPrompt: ONHAND_SYSTEM_PROMPT,
					model,
					tools: createTools(host),
					messages: [...(session.messages || [])],
					thinkingLevel: "low",
				},
				getApiKey: (provider) => resolveApiKey(provider),
				toolExecution: "parallel",
			});
			activeAgent.subscribe((event) => handleAgentEvent(session, requestId, event));

			void activeAgent
				.prompt(buildLauncherPrompt(prompt, browserContext, attachments, learningMode), buildPromptImages(attachments))
				.catch((error) => finalizeRequest(session, requestId, error instanceof Error ? error : new Error(String(error))));

			return { requestId };
		},

		async stop() {
			if (!activeAgent || !activeRequest) throw new Error("Onhand is not currently responding.");
			activeRequest.aborted = true;
			await publishState({ status: "Stopping..." });
			activeAgent.abort();
			return {
				stopped: true,
				currentSession: buildSessionState(await getCurrentSession()),
			};
		},

		async activateAction(actionKey: string) {
			const state = await ensureUiState();
			const actions = [
				...(Array.isArray(state.pageActions) ? state.pageActions : []),
				...(Array.isArray(state.turns) ? state.turns.flatMap((turn: UiTurn) => turn.pageActions || []) : []),
			];
			const action = actions.find((candidate: PageAction) => candidate.key === actionKey);
			if (!action) throw new Error("Could not find that Onhand page action.");
			if (typeof action.tabId === "number") {
				await host.runCommand("activate_tab", { tabId: action.tabId });
			}
			if (action.annotationId) {
				await host.runCommand("scroll_to_annotation", {
					tabId: typeof action.tabId === "number" ? action.tabId : undefined,
					annotationId: action.annotationId,
					target: action.type === "note" ? "note" : "annotation",
				});
			}
			return action;
		},
	};
}
