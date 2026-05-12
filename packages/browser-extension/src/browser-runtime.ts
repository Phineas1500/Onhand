import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModel, registerFauxProvider, streamSimple, Type } from "@mariozechner/pi-ai";
import { streamOpenAICodexResponses } from "@mariozechner/pi-ai/openai-codex-responses";
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
	artifactIds: string[];
}

interface RuntimeSettings {
	learningMode: boolean;
	speedMode: SpeedMode;
	aiProvider: string;
	aiModel: string;
	aiApiKey: string;
	authMode: "api-key" | "oauth";
	oauthCredentials: Record<string, BrowserOAuthCredentials>;
}

type SpeedMode = "auto" | "fast" | "deep";
type ReasoningProfileName = "fast" | "balanced" | "deep";
type ReasoningEffort = "none" | "low" | "medium";
type TextVerbosity = "low" | "medium";

interface ReasoningProfile {
	setting: SpeedMode;
	mode: ReasoningProfileName;
	reason: string;
	reasoningEffort: ReasoningEffort;
	textVerbosity: TextVerbosity;
	maxTokens: number;
	promptPolicy: string;
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
	title?: string;
	url?: string;
	annotationId?: string | null;
	artifactId?: string | null;
	label: string;
	detail: string;
	citationText?: string;
}

interface BrowserArtifact {
	id: string;
	createdAt: string;
	updatedAt: string;
	sessionId: string | null;
	label: string | null;
	tab: any;
	page: any;
	outerHTML?: string | null;
	screenshotDataUrl?: string | null;
}

interface ReplayAnnotation {
	key: string;
	tabId?: number | null;
	windowId?: number | null;
	title?: string;
	url?: string;
	annotationId?: string | null;
	matchedText: string;
	noteText?: string;
	noteLabel?: string;
}

interface RuntimeArtifactHooks {
	captureArtifact: (params: any) => Promise<any>;
	listArtifacts: (params: any) => Promise<BrowserArtifact[]>;
	restoreArtifact: (params: any) => Promise<any>;
}

const STORAGE_KEY = "onhandBrowserRuntime";
const ARTIFACTS_STORAGE_KEY = "onhandBrowserArtifacts";
const ARTIFACT_DB_NAME = "onhandBrowserRuntime";
const ARTIFACT_DB_VERSION = 1;
const ARTIFACT_STORE_NAME = "browserArtifacts";
const OPENAI_API_PROVIDER = "openai";
const OPENAI_API_MODEL = "gpt-4.1-mini";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_MODEL = "gpt-5.5";
const SMOKE_PROVIDER = "onhand-smoke";
const SMOKE_MODEL = "onhand-smoke-1";
const SMOKE_PORTS_MODEL = "onhand-smoke-ports-1";
const BROWSER_CONTEXT_MAX_CHARS = 1800;
const BROWSER_CONTEXT_MAX_BLOCKS = 8;
const TOOL_RESULT_MAX_CHARS = 1800;
const VISIBLE_TEXT_TOOL_MAX_CHARS = 2400;
const RECENT_CONTEXT_TURN_LIMIT = 4;
const RECENT_CONTEXT_PROMPT_MAX_CHARS = 260;
const RECENT_CONTEXT_REPLY_MAX_CHARS = 700;
const ONHAND_MAX_OUTPUT_TOKENS = 900;
const ONHAND_FAST_OUTPUT_TOKENS = 700;
const ONHAND_DEEP_OUTPUT_TOKENS = 1600;
const DEFAULT_SETTINGS: RuntimeSettings = {
	learningMode: false,
	speedMode: "auto",
	aiProvider: OPENAI_CODEX_PROVIDER,
	aiModel: OPENAI_CODEX_MODEL,
	aiApiKey: "",
	authMode: "oauth",
	oauthCredentials: {},
};

const ONHAND_INTERNAL_PROMPT_PREFIX = "[Onhand internal]";
let smokeModelRegistration: ReturnType<typeof registerFauxProvider> | null = null;

const ONHAND_SYSTEM_PROMPT = `You are Onhand, a contextual tutor and research copilot running inside a Chromium extension side panel.

Prefer helping with the material already open in the user's browser. Stay grounded in the captured browser context supplied with each prompt.

For quick questions that the captured context already answers, answer directly and concisely. Use browser tools only when you need more context, need to act on the page, or a highlight/note would materially improve the answer.

When visual grounding would help, highlight the exact supporting text, add a short note near it, scroll it into view, and then answer concisely.

For straightforward explanations, one or two strong supporting passages are usually enough. Once the main claims are grounded, stop gathering more evidence and answer.

Avoid navigating away from the current page unless the user explicitly asks.

Use click/type/navigation tools only when the user is clearly asking you to interact with the page. Do not submit forms, transmit sensitive data, create accounts, change permissions, or take high-stakes actions unless the user explicitly provided that instruction for the specific site and action. Use markdown sparingly.`;

const ONHAND_LEARNING_MODE_APPEND = `Learning mode is enabled for this request.

Help the user learn from the material on screen. When useful, identify a prerequisite concept, correct likely misconceptions, and add one short retrieval-check note. Do not force Socratic behavior on simple or transactional prompts.`;

const LIST_TABS_SCHEMA = Type.Object({
	onlyActive: Type.Optional(Type.Boolean({ description: "Only include active tabs" })),
});

const TAB_SELECTOR_SCHEMA = {
	tabId: Type.Optional(Type.Number({ description: "Exact browser tab ID to target. Omit this to use the active tab." })),
};

const TAB_MATCH_SCHEMA = {
	...TAB_SELECTOR_SCHEMA,
	titleContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab title" })),
	urlContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab URL" })),
};

const NAVIGATE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	url: Type.String({ description: "URL to navigate to" }),
	newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab instead of navigating the current or matched tab" })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the tab to finish loading" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds" })),
});

const VISIBLE_TEXT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters of visible text to return" })),
	maxBlocks: Type.Optional(Type.Number({ description: "Maximum visible text blocks to return" })),
});

const EXTRACT_CONTENT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters of readable page content to return" })),
});

const VIEWPORT_HEADINGS_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	maxHeadings: Type.Optional(Type.Number({ description: "Maximum nearby headings to return" })),
});

const CAPTURE_STATE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	persist: Type.Optional(Type.Boolean({ description: "Persist this page capture as a browser-only Onhand artifact" })),
	includeHtml: Type.Optional(Type.Boolean({ description: "Persist a full HTML snapshot when persist=true" })),
	includeScreenshot: Type.Optional(Type.Boolean({ description: "Persist a screenshot when persist=true" })),
	label: Type.Optional(Type.String({ description: "Optional artifact label" })),
});

const HIGHLIGHT_TEXT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	text: Type.String({ description: "Visible text to highlight on the page" }),
	occurrence: Type.Optional(Type.Number({ description: "1-based occurrence of the match to highlight" })),
	clearExisting: Type.Optional(Type.Boolean({ description: "Clear existing Onhand highlights first" })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Scroll the highlighted match into view" })),
});

const SHOW_NOTE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	annotationId: Type.String({ description: "Annotation ID returned by browser_highlight_text" }),
	note: Type.String({ description: "Short explanatory note to display near the highlighted content" }),
	label: Type.Optional(Type.String({ description: "Optional short label shown above the note" })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Keep the anchored content in view when showing the note" })),
});

const SCROLL_TO_ANNOTATION_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	annotationId: Type.String({ description: "Annotation ID returned by browser_highlight_text" }),
	target: Type.Optional(Type.String({ description: "Scroll target: annotation or note" })),
});

const RUN_JS_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	expression: Type.String({ description: "JavaScript expression to evaluate in the target tab" }),
});

const DOM_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum HTML characters to return" })),
});

const FIND_ELEMENTS_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	text: Type.String({ description: "Visible text or label text to search for" }),
	interactiveOnly: Type.Optional(Type.Boolean({ description: "Only search interactive/editable elements" })),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact text match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden elements in matching" })),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of matches to return" })),
});

const CLICK_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	selector: Type.String({ description: "CSS selector for the element to click" }),
});

const TYPE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	selector: Type.String({ description: "CSS selector for the input or contenteditable element" }),
	text: Type.String({ description: "Text to type into the matched element" }),
	clear: Type.Optional(Type.Boolean({ description: "Clear the current value first" })),
	submit: Type.Optional(Type.Boolean({ description: "Submit the parent form after typing when possible" })),
});

const CLICK_TEXT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	text: Type.String({ description: "Visible text of the element to click" }),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact text match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden elements in matching" })),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of candidate matches to consider" })),
});

const TYPE_BY_LABEL_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	labelText: Type.String({ description: "Label, placeholder, aria-label, or field name to match" }),
	text: Type.String({ description: "Text to type into the matched field" }),
	clear: Type.Optional(Type.Boolean({ description: "Clear the current field value first" })),
	submit: Type.Optional(Type.Boolean({ description: "Submit the form after typing when possible" })),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact label match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden fields in matching" })),
});

const WAIT_FOR_SELECTOR_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	selector: Type.String({ description: "CSS selector to wait for" }),
	visible: Type.Optional(Type.Boolean({ description: "Require the element to be visible" })),
	timeoutMs: Type.Optional(Type.Number({ description: "How long to wait before timing out" })),
});

const PICK_ELEMENTS_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	message: Type.String({ description: "Instruction shown while the user picks elements on the page" }),
});

const CONSOLE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	durationMs: Type.Optional(Type.Number({ description: "How long to observe console output" })),
	maxEntries: Type.Optional(Type.Number({ description: "Maximum number of console entries" })),
	reload: Type.Optional(Type.Boolean({ description: "Reload the page before collecting console output" })),
	ignoreCache: Type.Optional(Type.Boolean({ description: "Ignore cache when reload=true" })),
	expression: Type.Optional(Type.String({ description: "Optional JavaScript expression to evaluate after listeners are attached" })),
});

const NETWORK_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	durationMs: Type.Optional(Type.Number({ description: "How long to observe network activity" })),
	maxEntries: Type.Optional(Type.Number({ description: "Maximum number of network entries" })),
	reload: Type.Optional(Type.Boolean({ description: "Reload the page before collecting network activity" })),
	ignoreCache: Type.Optional(Type.Boolean({ description: "Ignore cache when reload=true" })),
	onlyFailures: Type.Optional(Type.Boolean({ description: "Only show failed network requests" })),
	matchUrlContains: Type.Optional(Type.String({ description: "Only show requests whose URL contains this substring" })),
	includeRequestHeaders: Type.Optional(Type.Boolean({ description: "Include request headers" })),
	includeResponseHeaders: Type.Optional(Type.Boolean({ description: "Include response headers" })),
	includeBodies: Type.Optional(Type.Boolean({ description: "Fetch response bodies for matching text responses" })),
	bodyMaxEntries: Type.Optional(Type.Number({ description: "Maximum number of response bodies to fetch" })),
	bodyMaxChars: Type.Optional(Type.Number({ description: "Maximum characters to keep from each fetched response body" })),
});

const SCREENSHOT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	format: Type.Optional(Type.String({ description: "Screenshot format: png or jpeg" })),
	quality: Type.Optional(Type.Number({ description: "JPEG quality from 0 to 100" })),
	delayMs: Type.Optional(Type.Number({ description: "Delay before screenshot capture" })),
});

const LIST_ARTIFACTS_SCHEMA = Type.Object({
	query: Type.Optional(Type.String({ description: "Search artifact id, label, title, or URL" })),
	limit: Type.Optional(Type.Number({ description: "Maximum artifacts to return" })),
});

const RESTORE_ARTIFACT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	artifactId: Type.String({ description: "Browser-only Onhand artifact id to restore" }),
	clearExisting: Type.Optional(Type.Boolean({ description: "Clear existing annotations before restoring" })),
	openIfNeeded: Type.Optional(Type.Boolean({ description: "Open the artifact URL in a new tab if no matching tab is open" })),
});

const CORE_READ_TOOL_NAMES = [
	"browser_get_visible_text",
	"browser_extract_content",
	"browser_get_selection",
	"browser_get_viewport_headings",
	"browser_get_scroll_state",
];

const VISUAL_GROUNDING_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation", "browser_clear_annotations"];
const TAB_TOOL_NAMES = ["browser_list_tabs", "browser_activate_tab", "browser_navigate"];
const INTERACTION_TOOL_NAMES = [
	"browser_find_elements",
	"browser_wait_for_selector",
	"browser_click",
	"browser_type",
	"browser_click_text",
	"browser_type_by_label",
	"browser_pick_elements",
];
const DEBUG_TOOL_NAMES = ["browser_collect_console", "browser_collect_network", "browser_get_dom", "browser_capture_screenshot", "browser_run_js"];
const ARTIFACT_TOOL_NAMES = ["browser_capture_state", "browser_list_artifacts", "browser_restore_state"];
const EXACT_TOOL_NAME_PATTERN = /\bbrowser_[a-z_]+\b/g;

function nowIso() {
	return new Date().toISOString();
}

function truncate(value: unknown, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}...`;
}

function getSelectionText(selection: unknown) {
	if (typeof selection === "string") return selection.trim();
	if (selection && typeof selection === "object" && typeof (selection as any).text === "string") {
		return (selection as any).text.trim();
	}
	return "";
}

function compactActionText(value: unknown) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function pageActionTabFields(tab: any) {
	const title = compactActionText(tab?.title);
	const url = compactActionText(tab?.url);
	return {
		...(title ? { title } : {}),
		...(url ? { url } : {}),
	};
}

function normalizeAuthMode(value: unknown): RuntimeSettings["authMode"] {
	return value === "oauth" ? "oauth" : "api-key";
}

function normalizeSpeedMode(value: unknown): SpeedMode {
	return value === "fast" || value === "deep" ? value : "auto";
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
		speedMode: settings.speedMode,
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
		models: [
			{ id: SMOKE_MODEL, name: "Onhand Smoke Model", reasoning: false },
			{ id: SMOKE_PORTS_MODEL, name: "Onhand Ports Smoke Model", reasoning: false },
		],
		tokenSize: { min: 8, max: 16 },
	});
	if (modelId === SMOKE_PORTS_MODEL) {
		smokeModelRegistration.setResponses([
			fauxAssistantMessage([
				fauxToolCall("browser_list_tabs", { onlyActive: false }),
				fauxToolCall("browser_activate_tab", { tabId: 101 }),
				fauxToolCall("browser_navigate", {
					url: "https://example.com/onhand-smoke?nav=1",
					newTab: true,
					waitForLoad: true,
				}),
				fauxToolCall("browser_get_visible_text", { maxChars: 400 }),
				fauxToolCall("browser_extract_content", { maxChars: 800 }),
				fauxToolCall("browser_get_selection", {}),
				fauxToolCall("browser_get_viewport_headings", { maxHeadings: 8 }),
				fauxToolCall("browser_get_scroll_state", {}),
				fauxToolCall("browser_highlight_text", {
					text: "Alpha smoke content",
					clearExisting: true,
					scrollIntoView: true,
				}),
				fauxToolCall("browser_show_note", {
					annotationId: "smoke-highlight",
					note: "Ports smoke note",
					label: "Onhand",
				}),
				fauxToolCall("browser_scroll_to_annotation", {
					annotationId: "smoke-highlight",
					target: "annotation",
				}),
				fauxToolCall("browser_clear_annotations", {}),
				fauxToolCall("browser_capture_state", {
					persist: true,
					includeHtml: true,
					includeScreenshot: true,
					label: "ports smoke artifact",
				}),
				fauxToolCall("browser_list_artifacts", { query: "seed", limit: 5 }),
				fauxToolCall("browser_restore_state", {
					artifactId: "artifact_smoke_seed",
					clearExisting: true,
					openIfNeeded: true,
				}),
				fauxToolCall("browser_find_elements", {
					text: "Demo button",
					interactiveOnly: true,
					exact: true,
				}),
				fauxToolCall("browser_wait_for_selector", {
					selector: "#result",
					visible: true,
					timeoutMs: 1000,
				}),
				fauxToolCall("browser_click", { selector: "#cssButton" }),
				fauxToolCall("browser_type", {
					selector: "#cssInput",
					text: "typed by selector",
					clear: true,
				}),
				fauxToolCall("browser_click_text", {
					text: "Demo button",
					exact: true,
				}),
				fauxToolCall("browser_type_by_label", {
					labelText: "Demo field",
					text: "typed by label",
					clear: true,
				}),
				fauxToolCall("browser_pick_elements", {
					message: "Pick Demo button for Onhand smoke test",
				}),
				fauxToolCall("browser_collect_console", {
					durationMs: 10,
					maxEntries: 5,
					expression: "console.log('onhand-console-smoke')",
				}),
				fauxToolCall("browser_collect_network", {
					durationMs: 10,
					maxEntries: 5,
					reload: true,
					ignoreCache: true,
					onlyFailures: false,
				}),
				fauxToolCall("browser_get_dom", { maxChars: 800 }),
				fauxToolCall("browser_capture_screenshot", { format: "png" }),
				fauxToolCall("browser_run_js", {
					expression: "window.__onhandPortSmoke",
				}),
			]),
			fauxAssistantMessage(fauxText("Browser runtime ports ok")),
		]);
	} else {
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
	}
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
		artifactIds: [],
	};
}

function normalizeSession(rawSession: any): RuntimeSession {
	const fallback = createSession();
	const session = {
		...fallback,
		...(rawSession && typeof rawSession === "object" ? rawSession : {}),
	} as RuntimeSession;
	session.messages = Array.isArray(session.messages) ? session.messages : [];
	session.turns = Array.isArray(session.turns) ? session.turns : [];
	session.pageActions = Array.isArray(session.pageActions) ? session.pageActions : [];
	session.artifactIds = Array.isArray(session.artifactIds) ? session.artifactIds.filter((id) => typeof id === "string") : [];
	return session;
}

function canUseIndexedDb() {
	return typeof indexedDB !== "undefined";
}

function openArtifactDb(): Promise<any> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(ARTIFACT_DB_NAME, ARTIFACT_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(ARTIFACT_STORE_NAME)) {
				const store = db.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: "id" });
				store.createIndex("createdAt", "createdAt", { unique: false });
				store.createIndex("sessionId", "sessionId", { unique: false });
			}
		};
		request.onerror = () => reject(request.error || new Error("Could not open Onhand artifact store."));
		request.onsuccess = () => resolve(request.result);
	});
}

async function withArtifactStore<T>(mode: "readonly" | "readwrite", callback: (store: any) => Promise<T> | T): Promise<T> {
	const db = await openArtifactDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction(ARTIFACT_STORE_NAME, mode);
			const store = transaction.objectStore(ARTIFACT_STORE_NAME);
			let settled = false;
			Promise.resolve(callback(store))
				.then((value) => {
					settled = true;
					resolve(value);
				})
				.catch((error) => {
					settled = true;
					reject(error);
				});
			transaction.onerror = () => {
				if (!settled) reject(transaction.error || new Error("Onhand artifact transaction failed."));
			};
		});
	} finally {
		db.close?.();
	}
}

function requestToPromise<T = any>(request: any): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onerror = () => reject(request.error || new Error("Onhand artifact request failed."));
		request.onsuccess = () => resolve(request.result);
	});
}

async function readFallbackArtifacts(): Promise<Record<string, BrowserArtifact>> {
	const stored = await chrome.storage.local.get({ [ARTIFACTS_STORAGE_KEY]: {} });
	const artifacts = stored[ARTIFACTS_STORAGE_KEY];
	return artifacts && typeof artifacts === "object" ? artifacts : {};
}

async function writeFallbackArtifacts(artifacts: Record<string, BrowserArtifact>) {
	await chrome.storage.local.set({ [ARTIFACTS_STORAGE_KEY]: artifacts });
}

async function putBrowserArtifact(artifact: BrowserArtifact) {
	if (canUseIndexedDb()) {
		await withArtifactStore("readwrite", async (store) => {
			await requestToPromise(store.put(artifact));
		});
		return;
	}
	const artifacts = await readFallbackArtifacts();
	artifacts[artifact.id] = artifact;
	await writeFallbackArtifacts(artifacts);
}

async function getBrowserArtifact(artifactId: string): Promise<BrowserArtifact | null> {
	const id = String(artifactId || "").trim();
	if (!id) return null;
	if (canUseIndexedDb()) {
		return await withArtifactStore("readonly", async (store) => (await requestToPromise<BrowserArtifact | undefined>(store.get(id))) || null);
	}
	const artifacts = await readFallbackArtifacts();
	return artifacts[id] || null;
}

async function listBrowserArtifacts(params: any = {}): Promise<BrowserArtifact[]> {
	const limit = Math.max(1, Math.min(100, Number(params.limit || 20) || 20));
	const query = String(params.query || "").trim().toLowerCase();
	let artifacts: BrowserArtifact[] = [];
	if (canUseIndexedDb()) {
		artifacts = await withArtifactStore("readonly", async (store) => {
			const all = await requestToPromise<BrowserArtifact[]>(store.getAll());
			return Array.isArray(all) ? all : [];
		});
	} else {
		artifacts = Object.values(await readFallbackArtifacts());
	}
	if (query) {
		artifacts = artifacts.filter((artifact) =>
			[
				artifact.id,
				artifact.label,
				artifact.tab?.title,
				artifact.tab?.url,
				artifact.page?.title,
				artifact.page?.url,
			]
				.join(" ")
				.toLowerCase()
				.includes(query),
		);
	}
	return artifacts
		.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
		.slice(0, limit);
}

function artifactSummary(artifact: BrowserArtifact) {
	return {
		artifactId: artifact.id,
		createdAt: artifact.createdAt,
		updatedAt: artifact.updatedAt,
		sessionId: artifact.sessionId,
		label: artifact.label,
		title: artifact.page?.title || artifact.tab?.title || "",
		url: artifact.page?.url || artifact.tab?.url || "",
		annotationCount: artifact.page?.annotationCount ?? (Array.isArray(artifact.page?.annotations) ? artifact.page.annotations.length : 0),
		hasHtml: Boolean(artifact.outerHTML),
		hasScreenshot: Boolean(artifact.screenshotDataUrl),
	};
}

function summarizeRestoredArtifact(result: any) {
	const tab = result?.tab || null;
	const artifact = result?.artifact || null;
	const failures = Array.isArray(result?.failures) ? result.failures : [];
	return {
		source: result?.source || "browser-artifact",
		artifactId: result?.artifactId || artifact?.id || "",
		tabId: typeof tab?.id === "number" ? tab.id : null,
		title: artifact?.page?.title || artifact?.tab?.title || tab?.title || "",
		url: artifact?.page?.url || artifact?.tab?.url || tab?.url || "",
		restoredCount: Number(result?.restoredAnnotations || 0),
		restoredAnnotations: Number(result?.restoredAnnotations || 0),
		restoredNotes: Number(result?.restoredNotes || 0),
		failedCount: failures.length,
		failures,
	};
}

function replayActionKey(action: PageAction, text = "") {
	const annotationId = compactActionText(action.annotationId);
	if (annotationId) return `annotation:${annotationId}`;
	const target = typeof action.tabId === "number"
		? `tab:${action.tabId}`
		: compactActionText(action.url)
			? `url:${compactActionText(action.url)}`
			: compactActionText(action.title)
				? `title:${compactActionText(action.title).toLowerCase()}`
				: "active";
	const normalizedText = compactActionText(text || action.citationText || action.detail).toLowerCase();
	return `text:${target}:${normalizedText}`;
}

function mergeReplayTarget(target: ReplayAnnotation, action: PageAction) {
	if (typeof target.tabId !== "number" && typeof action.tabId === "number") target.tabId = action.tabId;
	if (typeof target.windowId !== "number" && typeof action.windowId === "number") target.windowId = action.windowId;
	if (!target.annotationId && action.annotationId) target.annotationId = action.annotationId;
	if (!target.title && action.title) target.title = action.title;
	if (!target.url && action.url) target.url = action.url;
}

function buildReplayAnnotationsFromPageActions(pageActions: PageAction[] = []): ReplayAnnotation[] {
	const annotations = new Map<string, ReplayAnnotation>();
	const notes = new Map<string, { action: PageAction; text: string }>();
	for (const action of pageActions) {
		if (!action || typeof action !== "object") continue;
		if (action.type === "note") {
			const noteText = compactActionText(action.citationText || action.detail);
			if (!noteText) continue;
			notes.set(replayActionKey(action), { action, text: noteText });
			continue;
		}
		const isHighlight = action.type === "annotation" && (String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text");
		if (!isHighlight) continue;
		const matchedText = compactActionText(action.citationText || action.detail);
		if (!matchedText) continue;
		const key = replayActionKey(action, matchedText);
		const existing = annotations.get(key);
		if (existing) {
			mergeReplayTarget(existing, action);
			continue;
		}
		annotations.set(key, {
			key,
			tabId: typeof action.tabId === "number" ? action.tabId : null,
			windowId: typeof action.windowId === "number" ? action.windowId : null,
			title: action.title,
			url: action.url,
			annotationId: action.annotationId || null,
			matchedText,
		});
	}
	for (const [key, note] of notes) {
		const annotation = annotations.get(key);
		if (!annotation) continue;
		annotation.noteText = note.text;
		mergeReplayTarget(annotation, note.action);
	}
	return Array.from(annotations.values());
}

function collectSessionPageActions(session: RuntimeSession): PageAction[] {
	const actions = [
		...(Array.isArray(session.pageActions) ? session.pageActions : []),
		...(Array.isArray(session.turns) ? session.turns.flatMap((turn) => turn.pageActions || []) : []),
	];
	const seen = new Set<string>();
	return actions.filter((action) => {
		const key = action?.key || JSON.stringify(action || {});
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function timestampFromIso(value: string | undefined, fallback = Date.now()) {
	const parsed = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
}

function createStoredConversationMessages(turns: UiTurn[] = []): AgentMessage[] {
	return turns
		.filter((turn) => turn && !turn.pending && String(turn.userPrompt || turn.reply || "").trim())
		.flatMap((turn) => {
			const timestamp = timestampFromIso(turn.createdAt);
			const messages: AgentMessage[] = [];
			if (String(turn.userPrompt || "").trim()) {
				messages.push({
					role: "user",
					content: [{ type: "text", text: truncate(turn.userPrompt, RECENT_CONTEXT_PROMPT_MAX_CHARS) }],
					timestamp,
				} as AgentMessage);
			}
			if (String(turn.reply || "").trim()) {
				messages.push({
					role: "assistant",
					content: [{ type: "text", text: truncate(turn.reply, RECENT_CONTEXT_REPLY_MAX_CHARS) }],
					api: "onhand-history",
					provider: "onhand",
					model: "conversation-history",
					usage: emptyUsage(),
					stopReason: "stop",
					timestamp: timestamp + 1,
				} as AgentMessage);
			}
			return messages;
		});
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

function buildRecentConversationContext(session: RuntimeSession) {
	const recentTurns = (Array.isArray(session.turns) ? session.turns : [])
		.filter((turn) => turn && !turn.pending && !turn.error && (turn.userPrompt || turn.reply))
		.slice(-RECENT_CONTEXT_TURN_LIMIT);
	if (!recentTurns.length) return "";
	return recentTurns
		.map((turn) =>
			[
				`User: ${truncate(turn.userPrompt, RECENT_CONTEXT_PROMPT_MAX_CHARS)}`,
				turn.reply ? `Onhand: ${truncate(turn.reply, RECENT_CONTEXT_REPLY_MAX_CHARS)}` : "",
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n\n");
}

function classifyPromptForReasoning(prompt: string, attachments: any[] = [], learningMode = false): ReasoningProfileName {
	const text = String(prompt || "").toLowerCase();
	const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
	if (learningMode || hasAttachments) return "deep";

	const asksForToolSmoke =
		/\bbrowser_[a-z_]+\b|\b(port smoke|smoke test|ports?|tools?|debug(?:ging)?|diagnostic|dom|console|network|screenshot|selector|artifact|capture|restore)\b/.test(text);
	const asksForPageAction =
		/\b(highlight|annotate|note|scroll|click|open|navigate|go to|fill|type|select|press|mark|point (?:me )?to|show me where)\b/.test(text);
	const asksForDeepWork =
		/\b(why|how does|how do|compare|contrast|analy[sz]e|evaluate|argue|evidence|sources?|research|investigate|debug|trace|plan|strategy|teach|quiz|lesson|step[- ]by[- ]step|detailed|deep|thorough|review|critique|across tabs|multiple tabs|all tabs)\b/.test(
			text,
		);
	const asksForFastAnswer =
		/\b(one sentence|briefly|quickly|short answer|tl;?dr|no highlights?|no notes?|according to this page|what is|who is|when did|where is|which|how many|summari[sz]e)\b/.test(
			text,
		);

	if (asksForToolSmoke) return "balanced";
	if (asksForDeepWork) return "deep";
	if (asksForPageAction) return "balanced";
	if (asksForFastAnswer) return "fast";
	if (text.length > 260) return "balanced";
	return "fast";
}

function buildReasoningProfile(settings: RuntimeSettings, prompt: string, attachments: any[] = [], learningMode = false): ReasoningProfile {
	const setting = normalizeSpeedMode(settings.speedMode);
	const mode = setting === "auto" ? classifyPromptForReasoning(prompt, attachments, learningMode) : setting;
	const base = {
		setting,
		mode,
		reason: setting === "auto" ? `Auto chose ${mode}.` : `User selected ${setting}.`,
	};
	switch (mode) {
		case "deep":
			return {
				...base,
				reasoningEffort: "medium",
				textVerbosity: "medium",
				maxTokens: ONHAND_DEEP_OUTPUT_TOKENS,
				promptPolicy:
					"Speed policy: Deep. Spend more effort on synthesis and use browser tools when extra evidence or page actions would improve the answer. Still avoid redundant inspection and unrelated navigation.",
			};
		case "balanced":
			return {
				...base,
				reasoningEffort: "low",
				textVerbosity: "low",
				maxTokens: ONHAND_MAX_OUTPUT_TOKENS,
				promptPolicy:
					"Speed policy: Auto chose a balanced pass. Use at most one focused round of browser inspection unless the user explicitly requested a page action or the captured context is insufficient.",
			};
		case "fast":
		default:
			return {
				...base,
				reasoningEffort: "none",
				textVerbosity: "low",
				maxTokens: ONHAND_FAST_OUTPUT_TOKENS,
				promptPolicy:
					"Speed policy: Fast. Prefer answering immediately from the captured context in one to three short paragraphs. Do not call browser tools or create page actions unless the user explicitly asks or the captured context is clearly insufficient.",
			};
	}
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
				visible = await host.runCommand("get_visible_text", {
					tabId: activeTab.id,
					maxChars: BROWSER_CONTEXT_MAX_CHARS,
					maxBlocks: BROWSER_CONTEXT_MAX_BLOCKS,
				});
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
		const selectionText = getSelectionText(selection?.selection);
		if (selectionText) lines.push(`Selected text: ${JSON.stringify(truncate(selectionText, 800))}`);
		const visibleText = visible?.visible?.text || visible?.text || "";
		if (visibleText) {
			lines.push("Visible text snapshot:");
			lines.push(truncate(visibleText, BROWSER_CONTEXT_MAX_CHARS));
		}
		if (warning) lines.push(`Warning: ${warning}`);
		return lines.join("\n") || "Browser context was unavailable.";
	} catch (error: any) {
		return `Browser context was unavailable.\nReason: ${error?.message || String(error)}`;
	}
}

function textHasAny(text: string, pattern: RegExp) {
	pattern.lastIndex = 0;
	return pattern.test(text);
}

function selectToolsForPrompt(allTools: AgentTool[], prompt: string, _attachments: any[] = [], _learningMode = false) {
	const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));
	const selected = new Set<string>();
	const text = String(prompt || "").toLowerCase();
	const explicitToolNames = new Set(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN) || []);
	const wantsAllPorts = /\ball (?:browser )?(?:ports|tools)\b|\bport smoke\b|\bsmoke test\b/.test(text);

	const add = (names: string[]) => {
		for (const name of names) {
			if (toolsByName.has(name)) selected.add(name);
		}
	};

	if (wantsAllPorts) {
		add(allTools.map((tool) => tool.name));
	} else {
		add(CORE_READ_TOOL_NAMES);
		add(VISUAL_GROUNDING_TOOL_NAMES);
		add([...explicitToolNames]);

		if (textHasAny(text, /\b(tab|tabs|window|windows|activate|switch|open|navigate|go to|url|across tabs|multiple tabs|all tabs)\b/)) {
			add(TAB_TOOL_NAMES);
		}
		if (textHasAny(text, /\b(click|type|fill|field|button|selector|form|press|pick|choose|wait for|input)\b/)) {
			add(INTERACTION_TOOL_NAMES);
		}
		if (textHasAny(text, /\b(debug|console|network|dom|html|screenshot|javascript|js|run code|evaluate)\b/)) {
			add(DEBUG_TOOL_NAMES);
		}
		if (textHasAny(text, /\b(artifact|capture state|save state|restore|session replay|saved page|list artifacts?)\b/)) {
			add(ARTIFACT_TOOL_NAMES);
		}
		if (explicitToolNames.has("browser_show_note")) add(["browser_highlight_text"]);
		if (explicitToolNames.has("browser_restore_state")) add(["browser_list_artifacts"]);
	}

	if (!selected.size) add(CORE_READ_TOOL_NAMES);
	return allTools.filter((tool) => selected.has(tool.name));
}

function shouldIncludeToolInventory(prompt: string) {
	const text = String(prompt || "").toLowerCase();
	return Boolean(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN)) || /\b(port smoke|smoke test|ports?|tools?|debug(?:ging)?|diagnostic)\b/.test(text);
}

function buildToolInventory(prompt: string, tools: AgentTool[]) {
	if (!shouldIncludeToolInventory(prompt) || !tools.length) return "";
	return tools.map((tool) => `- ${tool.name}: ${truncate(tool.description || "", 140)}`).join("\n");
}

function buildLauncherPrompt(
	prompt: string,
	browserContext: string,
	attachments: any[],
	learningMode: boolean,
	reasoningProfile: ReasoningProfile,
	tools: AgentTool[] = [],
	recentConversation = "",
) {
	const attachmentContext = buildAttachmentContext(attachments);
	const toolInventory = buildToolInventory(prompt, tools);
	return [
		"The user invoked Onhand from the browser extension side panel.",
		...(recentConversation ? ["", "Recent conversation, summarized:", recentConversation] : []),
		"",
		`User question:\n${String(prompt || "").trim() || "(See attached files.)"}`,
		...(attachmentContext ? ["", "Attached files:", attachmentContext] : []),
		"",
		"Captured browser context right before the question:",
		browserContext,
		"",
		reasoningProfile.promptPolicy,
		`Routing note: ${reasoningProfile.reason}`,
		"",
		"Use this captured context as your starting point. Prefer already-open tabs and pages over navigation.",
		"If the answer is clear from the captured context, answer now without calling a browser tool.",
		"Use browser tools only when more context or a page action is needed. If you do use page actions, support major claims with one or two visible passages.",
		...(toolInventory ? ["", "Available browser tools for this request:", toolInventory] : []),
		"Use markdown emphasis sparingly and only for short phrases that really matter.",
		...(learningMode ? ["", ONHAND_LEARNING_MODE_APPEND] : []),
	].join("\n");
}

function toolResultText(result: any, maxChars = 5000) {
	return truncate(JSON.stringify(result, null, 2), maxChars);
}

function formatCompactTab(tab: any) {
	const title = String(tab?.title || "(untitled)").trim();
	const url = String(tab?.url || "").trim();
	return url ? `${title} - ${url}` : title;
}

function formatCompactElement(element: any) {
	if (!element) return "element";
	const tag = element.tag ? `<${element.tag}>` : "element";
	const selector = element.selector ? ` ${element.selector}` : "";
	const text = element.text ? ` "${truncate(element.text, 80)}"` : "";
	return `${tag}${selector}${text}`;
}

function formatArtifactList(artifacts: BrowserArtifact[]) {
	if (!artifacts.length) return "No saved Onhand browser artifacts found.";
	return artifacts
		.slice(0, 20)
		.map((artifact, index) => {
			const summary = artifactSummary(artifact);
			const bits = [
				summary.label ? `label=${JSON.stringify(summary.label)}` : "",
				`${summary.annotationCount} annotations`,
				summary.hasHtml ? "html" : "",
				summary.hasScreenshot ? "screenshot" : "",
			].filter(Boolean);
			return `${index + 1}. ${summary.artifactId}${bits.length ? ` [${bits.join(", ")}]` : ""}\n   ${summary.title || "(untitled)"}\n   ${summary.url || "(no url)"}`;
		})
		.join("\n");
}

function toolResultTextForModel(toolName: string, result: any) {
	const details = result?.details || result || {};
	const tab = details.tab || null;
	switch (toolName) {
		case "browser_list_tabs": {
			const tabs = Array.isArray(details.tabs) ? details.tabs : [];
			const lines = tabs.slice(0, 12).map((tabInfo: any) => `${tabInfo?.active ? "* " : "- "}${formatCompactTab(tabInfo)}`);
			return lines.length ? `Open tabs:\n${lines.join("\n")}` : "No browser tabs found.";
		}
		case "browser_activate_tab":
			return `Activated tab: ${formatCompactTab(tab)}`;
		case "browser_navigate":
			return `Navigated to: ${formatCompactTab(tab)}`;
		case "browser_get_visible_text": {
			const visible = details.visible || {};
			const text = String(visible.text || "").trim();
			const heading = `Visible text from ${formatCompactTab(tab || visible)}:`;
			return text ? `${heading}\n${truncate(text, VISIBLE_TEXT_TOOL_MAX_CHARS)}` : `${heading}\n(No visible text returned.)`;
		}
		case "browser_extract_content": {
			const content = details.content || details.extracted || {};
			const text = String(content.markdown || content.text || content || "").trim();
			const heading = `Readable content from ${formatCompactTab(tab || content)}:`;
			return text ? `${heading}\n${truncate(text, 8000)}` : `${heading}\n(No readable content returned.)`;
		}
		case "browser_get_selection": {
			const selectionText = getSelectionText(details.selection);
			return selectionText ? `Selected text:\n${truncate(selectionText, 1200)}` : "No selected text.";
		}
		case "browser_get_viewport_headings": {
			const headings = details.headings || {};
			const current = headings.currentHeading?.text ? `Current heading: ${headings.currentHeading.text}` : "Current heading: none";
			const nearby = (Array.isArray(headings.headings) ? headings.headings : [])
				.slice(0, 12)
				.map((heading: any, index: number) => `${index + 1}. ${heading.text || "(untitled heading)"}`)
				.join("\n");
			return `${current}${nearby ? `\nNearby headings:\n${nearby}` : ""}`;
		}
		case "browser_get_scroll_state": {
			const scroll = details.scroll || {};
			const progress = typeof scroll.progressY === "number" ? `${Math.round(scroll.progressY * 100)}%` : "(unknown)";
			return `Scroll state for ${formatCompactTab(tab || scroll)}: y=${scroll.scrollY ?? "?"}/${scroll.maxScrollY ?? "?"}, progress=${progress}, atTop=${Boolean(scroll.atTop)}, atBottom=${Boolean(scroll.atBottom)}`;
		}
		case "browser_highlight_text": {
			const annotationId = details.annotation?.annotationId || "(unknown annotation)";
			const matchedText = details.annotation?.matchedText || details.annotation?.text || "the requested text";
			return `Highlighted ${JSON.stringify(truncate(matchedText, 500))} on ${formatCompactTab(tab)}. annotationId: ${annotationId}`;
		}
		case "browser_show_note": {
			const annotationId = details.note?.annotationId || details.annotation?.annotationId || "(unknown annotation)";
			const noteText = details.note?.note || details.note?.text || details.note?.label || "";
			return `Added note to annotationId ${annotationId}: ${truncate(noteText, 700)}`;
		}
		case "browser_scroll_to_annotation": {
			const annotationId = details.annotation?.annotationId || "(unknown annotation)";
			return `Scrolled to annotationId ${annotationId}.`;
		}
		case "browser_clear_annotations":
			return "Cleared Onhand annotations on the page.";
		case "browser_capture_state": {
			const page = details.page || {};
			const artifact = details.persistedArtifact || details.artifact || null;
			const annotations = Array.isArray(page.annotations) ? page.annotations.length : page.annotationCount || 0;
			return [
				`Captured page state for ${formatCompactTab(tab || page)}.`,
				`Annotations: ${annotations}`,
				artifact?.artifactId ? `Saved artifact: ${artifact.artifactId}` : "",
			]
				.filter(Boolean)
				.join("\n");
		}
		case "browser_list_artifacts":
			return formatArtifactList(Array.isArray(details.artifacts) ? details.artifacts : []);
		case "browser_restore_state":
			return `Restored artifact ${details.artifactId || details.artifact?.id || ""}: ${details.restoredAnnotations || 0} annotation(s), ${details.restoredNotes || 0} note(s).`;
		case "browser_find_elements": {
			const matches = Array.isArray(details.matches) ? details.matches : [];
			return matches.length
				? `Matching elements:\n${matches.slice(0, 10).map((match: any, index: number) => `${index + 1}. ${formatCompactElement(match)}`).join("\n")}`
				: "No matching elements found.";
		}
		case "browser_click":
		case "browser_click_text":
			return `Clicked ${formatCompactElement(details.element)} on ${formatCompactTab(tab)}.`;
		case "browser_type":
		case "browser_type_by_label":
			return `Typed into ${formatCompactElement(details.element)} on ${formatCompactTab(tab)}.`;
		case "browser_wait_for_selector":
			return `Found ${formatCompactElement(details.element)} on ${formatCompactTab(tab)}.`;
		case "browser_pick_elements":
			return `Element picker returned:\n${toolResultText(details.selection, 2500)}`;
		case "browser_collect_console": {
			const entries = Array.isArray(details.entries) ? details.entries : [];
			return entries.length
				? `Console entries:\n${entries.slice(0, 20).map((entry: any, index: number) => `${index + 1}. [${entry.level || "info"}] ${truncate(entry.text || "", 300)}`).join("\n")}`
				: "No console entries captured.";
		}
		case "browser_collect_network": {
			const entries = Array.isArray(details.entries) ? details.entries : [];
			return entries.length
				? `Network entries:\n${entries.slice(0, 25).map((entry: any, index: number) => `${index + 1}. ${entry.method || "GET"} ${entry.failed ? `FAILED ${entry.errorText || ""}` : entry.status || "pending"} ${truncate(entry.url || "", 220)}`).join("\n")}`
				: "No network entries captured.";
		}
		case "browser_get_dom": {
			const html = String(details.outerHTML || "").trim();
			return html ? `DOM from ${formatCompactTab(tab)}:\n${truncate(html, 5000)}` : "No DOM returned.";
		}
		case "browser_capture_screenshot":
			return `Captured screenshot for ${formatCompactTab(tab)} (${details.method || "unknown method"}).`;
		default:
			return toolResultText(details, TOOL_RESULT_MAX_CHARS);
	}
}

export const __browserRuntimeTest = {
	buildReplayAnnotationsFromPageActions,
	formatToolResultForModel: toolResultTextForModel,
	getSelectionText,
	summarizeRestoredArtifact,
};

function streamOnhandFast(model: any, context: any, options: any = {}) {
	const { onhandReasoningProfile, ...streamOptions } = options || {};
	const reasoningProfile = onhandReasoningProfile as ReasoningProfile | undefined;
	const baseOptions = {
		...streamOptions,
		cacheRetention: "none",
		maxTokens: reasoningProfile?.maxTokens || ONHAND_MAX_OUTPUT_TOKENS,
	};
	if (model?.api === "openai-codex-responses") {
		return streamOpenAICodexResponses(model, context, {
			...baseOptions,
			reasoningEffort: reasoningProfile?.reasoningEffort || "none",
			reasoningSummary: "auto",
			textVerbosity: reasoningProfile?.textVerbosity || "low",
		});
	}
	return streamSimple(model, context, baseOptions);
}

function createTools(host: RuntimeHost, artifactHooks: RuntimeArtifactHooks): AgentTool[] {
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
				content: [{ type: "text", text: toolResultTextForModel(name, result) }],
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
				const details = { state, tabs };
				return {
					content: [{ type: "text", text: toolResultTextForModel("browser_list_tabs", details) }],
					details,
				};
			},
		},
		commandTool(
			"browser_activate_tab",
			"Browser Activate Tab",
			"Focus and activate a browser tab. Prefer listing tabs first when the target is unclear.",
			Type.Object({ ...TAB_MATCH_SCHEMA }),
			"activate_tab",
		),
		commandTool(
			"browser_navigate",
			"Browser Navigate",
			"Navigate the current or matched tab, or open a new tab when explicitly useful.",
			NAVIGATE_SCHEMA,
			"navigate",
			{ sequential: true },
		),
		commandTool(
			"browser_get_visible_text",
			"Browser Visible Text",
			"Read the text currently visible in a browser tab.",
			VISIBLE_TEXT_SCHEMA,
			"get_visible_text",
		),
		commandTool(
			"browser_extract_content",
			"Browser Extract Content",
			"Extract readable article or document text from the live page. Prefer this for long pages before resorting to JavaScript.",
			EXTRACT_CONTENT_SCHEMA,
			"extract_content",
		),
		commandTool(
			"browser_get_selection",
			"Browser Selection",
			"Read the user's current text selection in a browser tab.",
			Type.Object({ ...TAB_MATCH_SCHEMA }),
			"get_selection",
		),
		commandTool(
			"browser_get_viewport_headings",
			"Browser Viewport Headings",
			"Read the current and nearby headings for section context in a tab.",
			VIEWPORT_HEADINGS_SCHEMA,
			"get_viewport_headings",
		),
		commandTool(
			"browser_get_scroll_state",
			"Browser Scroll State",
			"Read scroll position and page progress for a tab.",
			Type.Object({ ...TAB_MATCH_SCHEMA }),
			"get_scroll_state",
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
			Type.Object({ ...TAB_MATCH_SCHEMA }),
			"clear_annotations",
			{ sequential: true },
		),
		{
			name: "browser_capture_state",
			label: "Browser Capture State",
			description: "Capture page state and annotations. Set persist=true only when the state should be replayable later.",
			parameters: CAPTURE_STATE_SCHEMA,
			executionMode: "sequential",
			async execute(_toolCallId, params: any) {
				const result = await artifactHooks.captureArtifact(params);
				return {
					content: [{ type: "text", text: toolResultTextForModel("browser_capture_state", result) }],
					details: result,
				};
			},
		},
		{
			name: "browser_list_artifacts",
			label: "Browser List Artifacts",
			description: "List browser-only Onhand artifacts that can be restored in the browser.",
			parameters: LIST_ARTIFACTS_SCHEMA,
			async execute(_toolCallId, params: any) {
				const artifacts = await artifactHooks.listArtifacts(params);
				const details = { artifactCount: artifacts.length, artifacts };
				return {
					content: [{ type: "text", text: toolResultTextForModel("browser_list_artifacts", details) }],
					details,
				};
			},
		},
		{
			name: "browser_restore_state",
			label: "Browser Restore State",
			description: "Restore saved Onhand highlights and notes from a browser-only artifact.",
			parameters: RESTORE_ARTIFACT_SCHEMA,
			executionMode: "sequential",
			async execute(_toolCallId, params: any) {
				const result = await artifactHooks.restoreArtifact(params);
				return {
					content: [{ type: "text", text: toolResultTextForModel("browser_restore_state", result) }],
					details: result,
				};
			},
		},
		commandTool(
			"browser_find_elements",
			"Browser Find Elements",
			"Find visible or interactive page elements by text, label, placeholder, or aria-label.",
			FIND_ELEMENTS_SCHEMA,
			"find_elements",
		),
		commandTool(
			"browser_wait_for_selector",
			"Browser Wait For Selector",
			"Wait for a CSS selector to appear before a requested page interaction.",
			WAIT_FOR_SELECTOR_SCHEMA,
			"wait_for_selector",
		),
		commandTool(
			"browser_click",
			"Browser Click",
			"Click an element by CSS selector only when the user asked Onhand to interact with the page.",
			CLICK_SCHEMA,
			"click",
			{ sequential: true },
		),
		commandTool(
			"browser_type",
			"Browser Type",
			"Type text into a field by CSS selector only when the user explicitly asked for page interaction. Do not submit sensitive or high-stakes data unless the user explicitly provided it for this destination.",
			TYPE_SCHEMA,
			"type_text",
			{ sequential: true },
		),
		commandTool(
			"browser_click_text",
			"Browser Click Text",
			"Click the best matching button, link, or control by visible text when the user asked Onhand to interact with the page.",
			CLICK_TEXT_SCHEMA,
			"click_text",
			{ sequential: true },
		),
		commandTool(
			"browser_type_by_label",
			"Browser Type By Label",
			"Type into a field by human-facing label or placeholder only when the user explicitly asked for page interaction. Do not submit sensitive or high-stakes data unless the user explicitly provided it for this destination.",
			TYPE_BY_LABEL_SCHEMA,
			"type_by_label",
			{ sequential: true },
		),
		commandTool(
			"browser_pick_elements",
			"Browser Pick Elements",
			"Show an element picker overlay so the user can identify ambiguous page elements.",
			PICK_ELEMENTS_SCHEMA,
			"pick_elements",
			{ sequential: true },
		),
		commandTool(
			"browser_collect_console",
			"Browser Collect Console",
			"Collect console messages, warnings, and exceptions from a tab for debugging.",
			CONSOLE_SCHEMA,
			"collect_console",
		),
		commandTool(
			"browser_collect_network",
			"Browser Collect Network",
			"Collect network requests and responses from a tab for debugging.",
			NETWORK_SCHEMA,
			"collect_network",
		),
		commandTool(
			"browser_get_dom",
			"Browser Get DOM",
			"Fetch raw page HTML. Prefer readable extraction for ordinary content questions.",
			DOM_SCHEMA,
			"get_dom",
		),
		commandTool(
			"browser_capture_screenshot",
			"Browser Capture Screenshot",
			"Capture a screenshot of the current or matched tab for visual debugging.",
			SCREENSHOT_SCHEMA,
			"capture_screenshot",
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
		case "browser_activate_tab":
			return "Switching tabs...";
		case "browser_navigate":
			return "Navigating...";
		case "browser_get_selection":
			return "Reading your current selection...";
		case "browser_get_visible_text":
			return "Reading the visible part of the page...";
		case "browser_extract_content":
			return "Extracting readable page content...";
		case "browser_get_viewport_headings":
			return "Checking page headings...";
		case "browser_get_scroll_state":
			return "Checking scroll position...";
		case "browser_highlight_text":
			return "Highlighting the relevant passage...";
		case "browser_show_note":
			return "Adding a note on the page...";
		case "browser_scroll_to_annotation":
			return "Moving the page to the relevant section...";
		case "browser_clear_annotations":
			return "Clearing previous Onhand annotations...";
		case "browser_capture_state":
			return "Saving page state...";
		case "browser_restore_state":
			return "Restoring saved page state...";
		case "browser_list_artifacts":
			return "Checking saved page states...";
		case "browser_find_elements":
			return "Finding page elements...";
		case "browser_wait_for_selector":
			return "Waiting for the page...";
		case "browser_click":
		case "browser_click_text":
			return "Clicking on the page...";
		case "browser_type":
		case "browser_type_by_label":
			return "Typing on the page...";
		case "browser_pick_elements":
			return "Waiting for element selection...";
		case "browser_collect_console":
			return "Collecting console output...";
		case "browser_collect_network":
			return "Collecting network activity...";
		case "browser_get_dom":
			return "Reading page HTML...";
		case "browser_capture_screenshot":
			return "Capturing screenshot...";
		default:
			return toolName?.startsWith("browser_") ? "Inspecting the current page..." : `Using ${toolName}...`;
	}
}

function buildPageAction(toolName: string, result: any): PageAction | null {
	const details = result?.details || result || {};
	const tab = details.tab || null;
	switch (toolName) {
		case "browser_activate_tab": {
			const detail = truncate(tab?.title || tab?.url || "Relevant tab", 72);
			return {
				key: `tab:${tab?.id || detail}`,
				type: "tab",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Switched tab",
				detail,
			};
		}
		case "browser_navigate": {
			const detail = truncate(tab?.title || tab?.url || "Opened page", 72);
			return {
				key: `tab:${tab?.id || detail}`,
				type: "tab",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Opened page",
				detail,
			};
		}
		case "browser_highlight_text": {
			const matchedTextFull = String(details.annotation?.matchedText || "").trim();
			const matchedText = truncate(matchedTextFull || "Relevant passage", 72);
			return {
				key: `highlight:${details.annotation?.annotationId || matchedText}`,
				type: "annotation",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
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
				...pageActionTabFields(tab),
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
				...pageActionTabFields(tab),
				annotationId: details.annotation?.annotationId || null,
				label: "Moved to section",
				detail: "Brought the relevant part of the page into view",
			};
		case "browser_capture_state": {
			const artifactId = details.persistedArtifact?.artifactId || details.artifact?.id || null;
			if (!artifactId) return null;
			return {
				key: `artifact:${artifactId}`,
				type: "artifact",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				artifactId,
				label: "Saved artifact",
				detail: truncate(details.page?.title || tab?.title || artifactId, 72),
			};
		}
		case "browser_restore_state":
			return {
				key: `restore:${details.artifactId || details.artifact?.id || Date.now()}`,
				type: "artifact",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				artifactId: details.artifactId || details.artifact?.id || null,
				label: "Restored artifact",
				detail: truncate(details.artifact?.page?.title || details.artifact?.tab?.title || "Saved browser state", 72),
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
				speedMode: normalizeSpeedMode(rawSettings.speedMode),
				aiProvider,
				aiModel: normalizeModelForProvider(rawModel, aiProvider, authMode),
				aiApiKey: typeof rawSettings.aiApiKey === "string" ? rawSettings.aiApiKey : "",
				authMode,
				oauthCredentials: normalizeOAuthCredentials(rawSettings.oauthCredentials),
			};
			const rawSessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
			const sessions = Object.fromEntries(Object.entries(rawSessions).map(([id, session]) => [id, normalizeSession(session)]));
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
		session.turns = [...(session.turns || []), turn];
		session.messages = createStoredConversationMessages(session.turns);
		session.pageActions = [...activeRequest.pageActions];
		session.artifactIds = Array.from(new Set([...(session.artifactIds || []), ...(activeRequest.artifactIds || [])]));
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

	function buildArtifactId(tab: any, page: any) {
		const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
		const title = String(page?.title || tab?.title || "page")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "page";
		return `artifact_${stamp}_${title}_${crypto.randomUUID().slice(0, 8)}`;
	}

	async function captureArtifact(params: any = {}) {
		const capture = await host.runCommand("capture_state", params);
		const tab = capture?.tab || null;
		const page = capture?.page || null;
		let persistedArtifact: any = null;
		if (params?.persist) {
			let outerHTML: string | null = null;
			let screenshotDataUrl: string | null = null;
			if (params.includeHtml === true) {
				try {
					const dom = await host.runCommand("get_dom", { ...params, tabId: tab?.id || params.tabId });
					outerHTML = typeof dom?.outerHTML === "string" ? dom.outerHTML : null;
				} catch (error) {
					host.log?.("artifact HTML capture failed", error);
				}
			}
			if (params.includeScreenshot === true) {
				try {
					const screenshot = await host.runCommand("capture_screenshot", { ...params, tabId: tab?.id || params.tabId });
					screenshotDataUrl = typeof screenshot?.dataUrl === "string" ? screenshot.dataUrl : null;
				} catch (error) {
					host.log?.("artifact screenshot capture failed", error);
				}
			}
			const now = nowIso();
			const artifact: BrowserArtifact = {
				id: buildArtifactId(tab, page),
				createdAt: now,
				updatedAt: now,
				sessionId: (await getCurrentSession())?.id || null,
				label: typeof params.label === "string" && params.label.trim() ? truncate(params.label, 120) : null,
				tab,
				page,
				outerHTML,
				screenshotDataUrl,
			};
			await putBrowserArtifact(artifact);
			if (activeRequest) {
				activeRequest.artifactIds = Array.from(new Set([...(activeRequest.artifactIds || []), artifact.id]));
			}
			persistedArtifact = {
				...artifactSummary(artifact),
				artifactId: artifact.id,
			};
		}
		return {
			tab,
			page,
			persistedArtifact,
		};
	}

	function findArtifactTab(tabs: any[], artifact: BrowserArtifact, params: any = {}) {
		if (typeof params.tabId === "number") return tabs.find((tab) => tab.id === params.tabId) || null;
		const url = String(artifact.page?.url || artifact.tab?.url || "").trim();
		const title = String(artifact.page?.title || artifact.tab?.title || "").trim().toLowerCase();
		return (
			tabs.find((tab) => url && tab.url === url) ||
			tabs.find((tab) => url && String(tab.url || "").split("#")[0] === url.split("#")[0]) ||
			tabs.find((tab) => title && String(tab.title || "").toLowerCase() === title) ||
			null
		);
	}

	async function restoreArtifact(params: any = {}) {
		const artifact = await getBrowserArtifact(params.artifactId);
		if (!artifact) throw new Error(`Could not find Onhand artifact: ${params.artifactId || "(blank)"}`);
		const state = await host.snapshotState();
		const tabs = flattenTabs(state);
		let tab = findArtifactTab(tabs, artifact, params);
		const url = artifact.page?.url || artifact.tab?.url || "";
		if (!tab) {
			if (params.openIfNeeded === false || !url) {
				throw new Error(`No matching tab is open for artifact ${artifact.id}.`);
			}
			const navigated = await host.runCommand("navigate", { url, newTab: true, waitForLoad: true });
			tab = navigated?.tab || navigated;
		} else {
			const activated = await host.runCommand("activate_tab", { tabId: tab.id });
			tab = activated?.tab || tab;
		}
		const tabId = tab?.id;
		if (typeof tabId !== "number") throw new Error("Could not resolve a tab for artifact restore.");
		if (params.clearExisting !== false) {
			await host.runCommand("clear_annotations", { tabId });
		}
		const annotations = Array.isArray(artifact.page?.annotations) ? artifact.page.annotations : [];
		let restoredAnnotations = 0;
		let restoredNotes = 0;
		const failures: string[] = [];
		for (const annotation of annotations) {
			const text = String(annotation?.matchedText || "").trim();
			if (!text) continue;
			try {
				const highlighted = await host.runCommand("highlight_text", {
					tabId,
					text,
					clearExisting: false,
					scrollIntoView: false,
				});
				restoredAnnotations += 1;
				const noteText = String(annotation?.note?.text || "").trim();
				const annotationId = highlighted?.annotation?.annotationId;
				if (noteText && annotationId) {
					await host.runCommand("show_note", {
						tabId,
						annotationId,
						note: noteText,
						label: annotation?.note?.label || "Onhand",
						scrollIntoView: false,
					});
					restoredNotes += 1;
				}
			} catch (error: any) {
				failures.push(error?.message || String(error));
			}
		}
		if (typeof artifact.page?.scrollY === "number" || typeof artifact.page?.scrollX === "number") {
			await host.runCommand("run_js", {
				tabId,
				expression: `window.scrollTo(${Number(artifact.page?.scrollX || 0)}, ${Number(artifact.page?.scrollY || 0)}); true;`,
			}).catch((error) => host.log?.("artifact scroll restore failed", error));
		}
		return {
			tab,
			artifact,
			artifactId: artifact.id,
			restoredAnnotations,
			restoredNotes,
			failures,
		};
	}

	function replayTargetKey(annotation: ReplayAnnotation) {
		if (typeof annotation.tabId === "number") return `tab:${annotation.tabId}`;
		if (annotation.url) return `url:${annotation.url.split("#")[0]}`;
		if (annotation.title) return `title:${annotation.title.toLowerCase()}`;
		return "active";
	}

	function findReplayTab(tabs: any[], annotation: ReplayAnnotation) {
		if (typeof annotation.tabId === "number") {
			const matchedTab = tabs.find((tab) => tab.id === annotation.tabId);
			if (matchedTab) return matchedTab;
		}
		const url = String(annotation.url || "").trim();
		const title = String(annotation.title || "").trim().toLowerCase();
		return (
			tabs.find((tab) => url && tab.url === url) ||
			tabs.find((tab) => url && String(tab.url || "").split("#")[0] === url.split("#")[0]) ||
			tabs.find((tab) => title && String(tab.title || "").toLowerCase() === title) ||
			null
		);
	}

	function buildReplayArtifact(session: RuntimeSession, targetKey: string, tab: any, annotations: ReplayAnnotation[]) {
		const first = annotations[0] || {};
		const now = nowIso();
		return {
			id: `session_replay_${session.id}_${targetKey}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 160),
			createdAt: session.createdAt,
			updatedAt: now,
			sessionId: session.id,
			label: session.name || "Session replay",
			tab,
			page: {
				title: tab?.title || first.title || "",
				url: tab?.url || first.url || "",
				annotations: annotations.map((annotation) => ({
					matchedText: annotation.matchedText,
					note: annotation.noteText ? { text: annotation.noteText, label: annotation.noteLabel || "Onhand" } : null,
				})),
			},
		};
	}

	async function restoreSessionPageActions(session: RuntimeSession, params: any = {}) {
		const replayAnnotations = buildReplayAnnotationsFromPageActions(collectSessionPageActions(session));
		if (!replayAnnotations.length) throw new Error("No saved browser artifacts or replayable page actions were found for this session.");
		const state = await host.snapshotState();
		const tabs = flattenTabs(state);
		const activeTab = pickActiveTab(state);
		const grouped = new Map<string, ReplayAnnotation[]>();
		for (const annotation of replayAnnotations) {
			const key = replayTargetKey(annotation);
			const group = grouped.get(key) || [];
			group.push(annotation);
			grouped.set(key, group);
		}

		const restored = [];
		for (const [targetKey, annotations] of grouped) {
			const first = annotations[0];
			const failures: string[] = [];
			let tab = findReplayTab(tabs, first);
			const hasExplicitTarget = typeof first.tabId === "number" || Boolean(first.url || first.title);
			if (!tab && first.url && params.openIfNeeded !== false) {
				try {
					const navigated = await host.runCommand("navigate", { url: first.url, newTab: true, waitForLoad: true });
					tab = navigated?.tab || navigated;
				} catch (error: any) {
					failures.push(error?.message || String(error));
				}
			}
			if (!tab && !hasExplicitTarget) tab = activeTab;
			const tabId = tab?.id;
			if (typeof tabId !== "number") {
				restored.push({
					source: "browser-replay",
					tab: null,
					artifact: buildReplayArtifact(session, targetKey, null, annotations),
					artifactId: "",
					restoredAnnotations: 0,
					restoredNotes: 0,
					failures: failures.length ? failures : [`No matching browser tab is open for replay target ${targetKey}.`],
				});
				continue;
			}

			try {
				const activated = await host.runCommand("activate_tab", { tabId });
				tab = activated?.tab || tab;
			} catch (error) {
				host.log?.("session replay tab activation failed", error);
			}
			if (params.clearExisting !== false) {
				try {
					await host.runCommand("clear_annotations", { tabId });
				} catch (error: any) {
					failures.push(error?.message || String(error));
				}
			}

			let restoredAnnotations = 0;
			let restoredNotes = 0;
			for (const annotation of annotations) {
				try {
					const highlighted = await host.runCommand("highlight_text", {
						tabId,
						text: annotation.matchedText,
						clearExisting: false,
						scrollIntoView: false,
					});
					restoredAnnotations += 1;
					const annotationId = highlighted?.annotation?.annotationId;
					if (annotation.noteText && annotationId) {
						await host.runCommand("show_note", {
							tabId,
							annotationId,
							note: annotation.noteText,
							label: annotation.noteLabel || "Onhand",
							scrollIntoView: false,
						});
						restoredNotes += 1;
					}
				} catch (error: any) {
					failures.push(error?.message || String(error));
				}
			}

			restored.push({
				source: "browser-replay",
				tab,
				artifact: buildReplayArtifact(session, targetKey, tab, annotations),
				artifactId: "",
				restoredAnnotations,
				restoredNotes,
				failures,
			});
		}
		return restored;
	}

	const artifactHooks: RuntimeArtifactHooks = {
		captureArtifact,
		listArtifacts: listBrowserArtifacts,
		restoreArtifact,
	};

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
				speedMode: normalizeSpeedMode(nextPartial.speedMode ?? store.settings.speedMode),
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

		async restoreSession(sessionId?: string) {
			const store = await loadStore();
			const targetSessionId = String(sessionId || store.currentSessionId || "").trim();
			const session = store.sessions[targetSessionId] as RuntimeSession;
			if (!session) throw new Error("Session not found.");
			const artifactIds = Array.isArray(session.artifactIds) ? session.artifactIds : [];
			const restored: any[] = artifactIds.length
				? []
				: await restoreSessionPageActions(session, { openIfNeeded: true, clearExisting: true });
			for (const artifactId of artifactIds) {
				restored.push(await restoreArtifact({ artifactId, openIfNeeded: true, clearExisting: true }));
			}
			const restoredPages = restored.map(summarizeRestoredArtifact);
			const restoredAnnotations = restored.reduce((total, page) => total + Number(page?.restoredAnnotations || 0), 0);
			const status = artifactIds.length
				? `Restored ${restored.length} saved page state${restored.length === 1 ? "" : "s"}.`
				: `Replayed ${restoredAnnotations} browser highlight${restoredAnnotations === 1 ? "" : "s"} from this session.`;
			await publishState({ status });
			return {
				restored,
				restoredPages,
				restoredCount: restoredPages.length,
				currentSession: buildSessionState(session),
			};
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
			const recentConversation = buildRecentConversationContext(session);
			const learningMode = Boolean(request?.learningMode ?? store.settings.learningMode);
			const requestSettings = {
				...store.settings,
				speedMode: normalizeSpeedMode(request?.speedMode ?? store.settings.speedMode),
			};
			const reasoningProfile = buildReasoningProfile(requestSettings, prompt, attachments, learningMode);
			const tools = selectToolsForPrompt(createTools(host, artifactHooks), prompt, attachments, learningMode);
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
				artifactIds: [] as string[],
				createdAt: nowIso(),
				aborted: false,
			};
			await publishState({ status: `Starting Onhand (${reasoningProfile.mode})...` });

			activeAgent = new Agent({
				initialState: {
					systemPrompt: ONHAND_SYSTEM_PROMPT,
					model,
					tools,
					messages: [],
					thinkingLevel: "off",
				},
				getApiKey: (provider) => resolveApiKey(provider),
				streamFn: (streamModel: any, streamContext: any, streamOptions: any = {}) =>
					streamOnhandFast(streamModel, streamContext, {
						...streamOptions,
						onhandReasoningProfile: reasoningProfile,
					}),
				toolExecution: "parallel",
			});
			activeAgent.subscribe((event) => handleAgentEvent(session, requestId, event));

			void activeAgent
				.prompt(buildLauncherPrompt(prompt, browserContext, attachments, learningMode, reasoningProfile, tools, recentConversation), buildPromptImages(attachments))
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
			if (action.artifactId) {
				await restoreArtifact({ artifactId: action.artifactId, openIfNeeded: true, clearExisting: true });
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
