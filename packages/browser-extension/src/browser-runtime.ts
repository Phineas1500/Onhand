import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModel, getModels, registerFauxProvider, streamOpenAIResponses, streamSimple, Type } from "@earendil-works/pi-ai";
import { streamOpenAICodexResponses } from "@earendil-works/pi-ai/openai-codex-responses";
import * as Sentry from "@sentry/browser";
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
	snapshotState: (args?: Record<string, unknown>) => Promise<any>;
	log?: (...args: unknown[]) => void;
	notifyAuthProgress?: (event: BrowserOAuthProgressEvent) => void;
	resolveModel?: (provider: string, model: string) => any;
	extensionVersion?: string;
	runtimeRevision?: string;
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
	learnerState: LearnerState;
}

interface RuntimeSettings {
	learningMode: boolean;
	realtimeVoiceEnabled: boolean;
	// Kept for stored-state compatibility. The product no longer exposes speed modes.
	speedMode: SpeedMode;
	aiProvider: string;
	aiModel: string;
	aiApiKey: string;
	aiApiKeys: Record<string, string>;
	authMode: "api-key" | "oauth";
	oauthCredentials: Record<string, BrowserOAuthCredentials>;
	diagnosticsEnabled: boolean;
	diagnosticsClientId: string;
	advancedRuntimeInspectionEnabled: boolean;
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
	errorReport?: RuntimeErrorReportSnapshot | null;
}

interface UiActivity {
	id: string;
	kind: "tool" | "reasoning";
	label: string;
	text?: string;
	toolName?: string;
	state?: "running" | "complete" | "retrying" | "recovered" | "error";
}

interface RuntimeErrorReportSnapshot {
	schema_version: number;
	type: "prompt_error" | "runtime_error" | "voice_error" | "options_error";
	created_at: string;
	submitted_at?: string;
	report_id?: string;
	extension_version: string;
	runtime_revision: string;
	auth_mode: string;
	ai_provider: string;
	ai_model: string;
	realtime_voice_enabled: boolean;
	learning_mode: boolean;
	error_kind: string;
	error_message: string;
	error_stack: string;
	duration_ms: number;
	action_count: number;
	artifact_count: number;
	activity_summary: Array<{
		kind: string;
		tool_name: string;
		state: string;
	}>;
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
	pdfAnchor?: any;
}

type LearnerMode = "answer" | "learning";
type LearnerCheckKind = "prediction" | "retrieval";
type LearnerAssessment = "correct" | "partial" | "incorrect" | "skipped";

interface LearnerConceptSource {
	tabTitle?: string;
	url?: string;
	annotationId?: string;
	artifactId?: string;
	// Verbatim highlighted text, kept so a "source" jump can re-find the
	// passage by text (rendering the page it lives on) when the original
	// highlight element is gone — e.g. in a later session or an unrendered
	// page of a large PDF.
	matchedText?: string;
}

interface LearnerConcept {
	conceptId: string;
	label: string;
	firstSeenAt: string;
	lastSeenAt: string;
	sources: LearnerConceptSource[];
}

interface LearnerCheck {
	checkId: string;
	kind: LearnerCheckKind;
	conceptId: string;
	promptText: string;
	annotationId?: string;
	askedAt: string;
}

interface LearnerResponse {
	checkId: string;
	assessment: LearnerAssessment;
	resolvedAt: string;
	evidence?: string;
	// Carried over from the resolved check so cross-session review
	// scheduling can key assessments to concepts.
	conceptId?: string;
	promptText?: string;
}

interface LearnerState {
	mode: LearnerMode;
	conceptsIntroduced: LearnerConcept[];
	openChecks: LearnerCheck[];
	responses: LearnerResponse[];
}

type LearningEvent =
	| {
			kind: "concept_introduced";
			conceptId?: string;
			conceptLabel?: string;
			label?: string;
			annotationId?: string;
			artifactId?: string;
			url?: string;
			tabTitle?: string;
			matchedText?: string;
			at?: string;
	  }
	| {
			kind: "check_opened";
			checkId?: string;
			checkKind?: LearnerCheckKind;
			kindOverride?: LearnerCheckKind;
			conceptId?: string;
			conceptLabel?: string;
			label?: string;
			promptText?: string;
			annotationId?: string;
			artifactId?: string;
			url?: string;
			tabTitle?: string;
			matchedText?: string;
			at?: string;
	  }
	| {
			kind: "check_resolved";
			checkId?: string;
			itemId?: string;
			assessment?: LearnerAssessment;
			evidence?: string;
			at?: string;
	  };

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
	actionKeys?: string[];
	tabId?: number | null;
	windowId?: number | null;
	title?: string;
	url?: string;
	annotationId?: string | null;
	matchedText: string;
	noteText?: string;
	noteLabel?: string;
	pdfAnchor?: any;
}

interface RuntimeArtifactHooks {
	captureArtifact: (params: any) => Promise<any>;
	listArtifacts: (params: any) => Promise<BrowserArtifact[]>;
	restoreArtifact: (params: any) => Promise<any>;
}

const STORAGE_KEY = "onhandBrowserRuntime";
const ARTIFACTS_STORAGE_KEY = "onhandBrowserArtifacts";
const SESSIONS_FALLBACK_STORAGE_KEY = "onhandBrowserSessions";
const REVIEW_SNOOZE_STORAGE_KEY = "onhandReviewSnoozes";
const RUNTIME_DB_NAME = "onhandBrowserRuntime";
const RUNTIME_DB_VERSION = 2;
const ARTIFACT_STORE_NAME = "browserArtifacts";
const SESSION_STORE_NAME = "runtimeSessions";
const OPENAI_API_PROVIDER = "openai";
const OPENAI_API_MODEL = "gpt-4.1-mini";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_MODEL = "gpt-5.5";
const ANTHROPIC_API_PROVIDER = "anthropic";
const ANTHROPIC_API_MODEL = "claude-sonnet-4-5-20250929";
const GOOGLE_API_PROVIDER = "google";
const GOOGLE_API_MODEL = "gemini-2.5-flash";
const OPENROUTER_API_PROVIDER = "openrouter";
const OPENROUTER_API_MODEL = "deepseek/deepseek-v4-flash";
const ONHAND_FREE_PROVIDER = "onhand-free";
const ONHAND_FREE_MODEL = "deepseek/deepseek-v4-flash";
const ONHAND_FREE_TEXT_CONTEXT_WINDOW = 1048576;
const ONHAND_FREE_VISUAL_CONTEXT_WINDOW = 131072;
const ONHAND_FREE_VISUAL_IMAGE_BLOCK_LIMIT = 2;
const ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS = 48000;
const ONHAND_FREE_VISUAL_RECENT_TEXT_BLOCK_MAX_CHARS = 9000;
const ONHAND_FREE_VISUAL_OLD_TOOL_TEXT_BLOCK_MAX_CHARS = 2200;
const ONHAND_FREE_VISUAL_OLD_TEXT_BLOCK_MAX_CHARS = 3600;
// The deployed workers/free-tier proxy. Override without rebuilding via
// the onhandFreeTierBaseUrl key in chrome.storage.local (used by tests
// and staged deployments). See docs/FREE_TIER.md.
const ONHAND_FREE_TIER_DEFAULT_BASE_URL = "https://onhand-free-tier.sriram-kiron.workers.dev/v1";
const ONHAND_FREE_BASE_URL_STORAGE_KEY = "onhandFreeTierBaseUrl";
const ONHAND_FREE_TOKEN_STORAGE_KEY = "onhandFreeTierToken";
const ONHAND_FREE_TURN_ID_HEADER = "X-Onhand-Turn-Id";
const ONHAND_FREE_SESSION_ID_HEADER = "X-Onhand-Session-Id";
const ONHAND_SENTRY_DSN = "https://f08b1742f4020abed600bca50fbb7458@o4511248777478144.ingest.us.sentry.io/4511565377110016";
const ONHAND_SENTRY_DIST = "chrome";
const ONHAND_SENTRY_STACK_EXTENSION_URL = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";
const ONHAND_DIAGNOSTICS_EVENT_NAMES = new Set([
	"diagnostics_enabled",
	"extension_installed",
	"extension_updated",
	"options_opened",
	"settings_saved",
	"sidepanel_opened",
	"sidepanel_closed",
	"prompt_submitted",
	"prompt_succeeded",
	"prompt_failed",
	"prompt_stopped",
	"session_started",
	"session_restored",
	"session_restore_failed",
	"browser_run_js_started",
	"browser_run_js_succeeded",
	"browser_run_js_failed",
]);
const SUPPORTED_API_PROVIDERS: Record<
	string,
	{ id: string; name: string; defaultModel: string; keyLabel: string; keyPlaceholder: string; keyPrefix?: string; realtime: boolean; keyless?: boolean }
> = {
	[OPENAI_API_PROVIDER]: {
		id: OPENAI_API_PROVIDER,
		name: "OpenAI API",
		defaultModel: OPENAI_API_MODEL,
		keyLabel: "OpenAI platform API key",
		keyPlaceholder: "sk-...",
		keyPrefix: "sk-",
		realtime: true,
	},
	[ANTHROPIC_API_PROVIDER]: {
		id: ANTHROPIC_API_PROVIDER,
		name: "Anthropic API",
		defaultModel: ANTHROPIC_API_MODEL,
		keyLabel: "Anthropic API key",
		keyPlaceholder: "sk-ant-...",
		keyPrefix: "sk-ant-",
		realtime: false,
	},
	[GOOGLE_API_PROVIDER]: {
		id: GOOGLE_API_PROVIDER,
		name: "Google Gemini API",
		defaultModel: GOOGLE_API_MODEL,
		keyLabel: "Gemini API key",
		keyPlaceholder: "AIza...",
		keyPrefix: "AIza",
		realtime: false,
	},
	[OPENROUTER_API_PROVIDER]: {
		id: OPENROUTER_API_PROVIDER,
		name: "OpenRouter",
		defaultModel: OPENROUTER_API_MODEL,
		keyLabel: "OpenRouter API key",
		keyPlaceholder: "sk-or-...",
		keyPrefix: "sk-or-",
		realtime: false,
	},
	[ONHAND_FREE_PROVIDER]: {
		id: ONHAND_FREE_PROVIDER,
		name: "Onhand Free (beta)",
		defaultModel: ONHAND_FREE_MODEL,
		keyLabel: "No key needed",
		keyPlaceholder: "",
		realtime: false,
		keyless: true,
	},
};

// Any OpenRouter model id is usable via the custom-model field; ids
// missing from pi-ai's catalog get this synthetic shape.
function buildOpenRouterFallbackModel(modelId: string) {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: OPENROUTER_API_PROVIDER,
		baseUrl: "https://openrouter.ai/api/v1",
		reasoning: false,
		input: ["text"],
		contextWindow: 131072,
		maxTokens: 32768,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}
const SMOKE_PROVIDER = "onhand-smoke";
const SMOKE_MODEL = "onhand-smoke-1";
const SMOKE_PORTS_MODEL = "onhand-smoke-ports-1";
const SMOKE_LEARNING_MODEL = "onhand-smoke-learning-1";
const BROWSER_CONTEXT_MAX_CHARS = 1800;
const BROWSER_CONTEXT_MAX_BLOCKS = 8;
const REALTIME_READABLE_CONTEXT_MAX_CHARS = 9000;
const REALTIME_ANCHOR_CONTEXT_MAX_CHARS = 4200;
const TOOL_RESULT_MAX_CHARS = 1800;
const VISIBLE_TEXT_TOOL_MAX_CHARS = 2400;
const RECENT_CONTEXT_TURN_LIMIT = 4;
const RECENT_CONTEXT_PROMPT_MAX_CHARS = 260;
const RECENT_CONTEXT_REPLY_MAX_CHARS = 700;
const ONHAND_MAX_OUTPUT_TOKENS = 900;
const ONHAND_FAST_OUTPUT_TOKENS = 550;
const ONHAND_DEEP_OUTPUT_TOKENS = 1100;
const DEFAULT_SETTINGS: RuntimeSettings = {
	learningMode: false,
	realtimeVoiceEnabled: false,
	speedMode: "auto",
	aiProvider: OPENAI_CODEX_PROVIDER,
	aiModel: OPENAI_CODEX_MODEL,
	aiApiKey: "",
	aiApiKeys: {},
	authMode: "oauth",
	oauthCredentials: {},
	diagnosticsEnabled: false,
	diagnosticsClientId: "",
	advancedRuntimeInspectionEnabled: true,
};

const ONHAND_INTERNAL_PROMPT_PREFIX = "[Onhand internal]";
const REALTIME_API_KEY_SETUP_MESSAGE =
	"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.";
let smokeModelRegistration: ReturnType<typeof registerFauxProvider> | null = null;

const ONHAND_SYSTEM_PROMPT = `You are Onhand, a contextual tutor running inside a Chromium extension side panel.

Onhand's constitution:
- The page is the canvas. Do the page work before the chat answer: anchored highlights and short marginal notes carry the substance; chat is secondary.
- Every material claim is anchored. If you cannot point to a specific location on a specific open page, do not present the claim as coming from that page.
- Teach, don't tell. Help the user see how the page answers the question instead of replacing the page with a detached summary.
- The user's pages come first. Use the current tab and already-open tabs before navigation. New pages are a fallback only when the open material cannot answer.
- When the user explicitly asks to search online, look up external sources, open URLs, or take them to another source, that request is permission to navigate. Open or switch to the relevant source/search page, then ground claims on that page with highlights and notes.
- When the user asks to open, follow, inspect, check, or review links/notes/readings/resources listed on the current page or an already-open index/master page, that request is permission to navigate within those linked pages. Use browser_list_tabs when needed to recover the already-open index/master page, then browser_activate_tab, browser_find_elements, browser_click_text/browser_click, or browser_navigate to open the relevant linked pages, inspect them, and anchor the final answer on the destination pages. Do not stop at highlighting the index/master page unless the index itself answers the question.
- Be concise by default and deep when warranted. A focused pass means one useful anchor and a short synthesis, not ungrounded prose. Thorough means covering the key relevant points, not annotating everything nearby.
- The session is the artifact. Preserve existing session highlights, notes, citations, and restoreable page state across follow-up questions unless the user explicitly asks to clear or replace them.
- Stay unobtrusive. Notes should feel like marginalia: short, local, placed near what they explain, and useful when replayed later.

Default answer mode:
- For questions about page material, first ground the answer in exact visible/open-page text: highlight the key passage(s), add a short orienting note only when it helps the user read or remember the passage, and scroll the first relevant anchor into view.
- If captured context already contains the needed text, use it to choose the anchor and avoid extra inspection. If it does not, do one focused read of the current page before answering. Do not call the same read tool repeatedly unless the first result is unusable.
- For follow-up questions that refer to an already-highlighted idea, reuse the existing session anchor when it supports the answer. Do not try to highlight a paraphrase of your own explanation; browser_highlight_text text must be copied from visible/readable page text.
- Grounding budget: for simple definition or "what/why" questions, use one strong anchor, at most one short note, then answer. Do not annotate examples, side effects, or reuse details unless the user asked about those distinct points. Roadmap/list/navigation questions are not simple if the answer names multiple steps or items.
- Do not add notes that merely paraphrase the highlight. A note should name the role of the passage, explain a hard step, or leave useful marginalia for session replay.
- Only successful highlight/note tool results count as anchors. If a highlight attempt fails, retry with a smaller exact visible span or omit/qualify that claim in chat.
- For multi-part, comparative, "show evidence", or confused follow-up questions, anchor each distinct key point, but keep each note and chat paragraph short. Stop once the answer is supported.
- For roadmap, list, or navigation questions, every named step or item in chat must be anchored by a highlight/note. Do not rely on a heading-only highlight if the answer depends on items beneath it. Highlight the sentence, list, or linked items that actually support the claimed path; if a reliable anchor is not available, answer only the anchored part and say the rest is visible but not anchored.
- For list-shaped visible text, use the individual item wording for highlights. Markdown bullets and heading hashes in visible/readable text are structure cues; do not send a heading-plus-list block as one highlight.
- If the user asks what a page-wide list contains and the visible snapshot appears partial, call browser_extract_content once before answering. Do not replace missing list items with nearby headings or sections.
- Chat should be a brief guide to what the annotations show: one to three short paragraphs for ordinary questions, with citations, not a detached summary of the page.
- If the page does not contain the answer, say that briefly and ask whether to use another open tab or navigate elsewhere. Do not fabricate page support.
- If the user already asked for external sources, web search, Google, URLs, or to be taken to sources, do not ask again before navigating. Use browser_navigate or an already-open tab, inspect the destination, and anchor the answer on the destination page rather than the original page.
- If the user already asked to open or check relevant linked notes, readings, resources, articles, papers, or pages from the current page or a page used earlier in the session, do not keep only annotating the current page. If the current page is already a destination note, use browser_list_tabs to find the already-open course/index/master tab before asking the user for it; activate that tab, find or click the relevant links, open them in new tabs when useful, inspect each destination page, and place highlights/notes on the destination pages that support the answer.
- For PDFs, keep the same user-facing flow as normal pages. If a native/third-party PDF tab reports an unsupported PDF surface, use browser_open_pdf_in_onhand_viewer to open the PDF in Onhand's viewer. For Google Docs, browser_extract_content reads the document export, and browser_highlight_text can open the current Doc's PDF export in Onhand's viewer before anchoring; use that viewer for highlights and notes instead of claiming the Docs editor itself is annotatable. For questions about offscreen PDF content, slides, or "where does it discuss..." use browser_pdf_search and browser_pdf_read_pages before answering; use browser_pdf_jump_to_page, browser_highlight_text, and browser_show_note to anchor the answer. Use browser_pdf_capture_page_image for visual slide/equation/figure grounding when text is insufficient.
- When the user asks about a cited work ("what does [14] say?", "open this reference", "what paper is that from?"), use browser_pdf_find_citation to look up the bibliography entry instead of searching manually. Highlight the entry in the current paper, then open the suggested URL with browser_navigate (newTab: true) so the user's paper stays open, hand a PDF result to the Onhand viewer, and anchor the passage in the cited work that answers the question. Ground the answer in the cited work itself, noting where both anchors are.
- When the user explicitly asks to compare or relate the current material to another open tab, another named source, or multiple open documents ("compare with the other paper", "how does this differ from the other open source?", "do these papers agree?"), use browser_list_tabs to identify the other source, read it with explicit tabId parameters (browser_get_visible_text, browser_extract_content, or the PDF tools) instead of switching the user away from their page, and highlight the key passage in each source. Do not infer cross-tab permission from standalone comparison or agreement wording such as "Do you agree with this?"; answer from the current page and ask before reading other tabs.
- When an answer draws on more than one tab or document, anchor each substantive claim in the source that supports it and name that source (by title) next to the claim in chat. Never attribute a claim to a source it was not anchored in; if no open source supports a claim, say so rather than borrowing a nearby anchor.
- If the user explicitly asks for no page changes, keep the answer short and name the visible/source context you relied on.

Use click/type/navigation tools only when the user is clearly asking you to interact with the page. Do not submit forms, transmit sensitive data, create accounts, change permissions, or take high-stakes actions unless the user explicitly provided that instruction for the specific site and action. Use markdown sparingly.`;

const ONHAND_LEARNING_MODE_APPEND = `Learning is enabled for this request.

Learning uses a tutoring stance:
- For direct conceptual questions, give a concise anchored answer first, then optionally ask one short page-anchored check. Do not make the check the whole answer unless the user explicitly asked to be quizzed.
- Stay fast: the first move should be a useful page anchor or anchored prompt, not a long preamble.
- Scaffold from the user's open material and recent conversation. If a prerequisite concept is needed, point to it first.
- Use onhand_record_learning_event to keep learner state current: record a concept when you introduce it, record a prediction/retrieval check when you place it, and resolve an open check before moving on when the user answers it.
- A concept is one reviewable learning unit, not every highlighted detail, citation, algebra step, or note. Record multiple concepts in one turn only when each would deserve its own future retrieval check.
- If a new point is a restatement, detail, or follow-up on an existing concept, reuse that conceptId and update/append its source instead of creating a new concept row.
- Include annotationId, tabTitle, and url in learning events whenever you have them from browser tool results. If you open a check, reuse the returned checkId when resolving it later.
- If a concept is already in learner state, prefer a lightweight refresher: use the existing source anchor, avoid broad re-inspection, add at most one replacement highlight and no note unless the user asks for a deeper pass, and do not re-explain from scratch.
- If that concept already has an open check, do not open or record a second check. Point back to the existing check or ask the user to answer it.
- If the user's latest turn is an answer to an open check, acknowledges/frustrates about a repeated check, or asks "did I not answer?", resolve or respond to that check from the conversation state before doing any new page grounding. Do not add fresh annotations for this meta/follow-up turn.
- Make the user think out loud when productive: prediction, "say it back", or "what changes if..." prompts must be anchored to a highlight or note, not floated in chat.
- Nudge before correcting. If the user is wrong or stuck, point to the relevant text and give a hint before stating the correction.
- Cross-tab interleaving is offer-first. Scan the captured open-tab list, and call browser_list_tabs once only if the captured list is missing or ambiguous. If another already-open tab likely contains a prerequisite, contrast, or related example, name that tab briefly and ask whether the user wants to connect it. This offer-first rule does not apply when the user explicitly asks to check/open other linked notes/resources from a course/index/master page or from topics you already mentioned; in that case, use the already-open index tab if available.
- Do not switch to, read, highlight, or note a related tab unless the user explicitly asks for cross-tab work or accepts the offer. If the user did ask for cross-tab comparison, anchor each page separately and say which tab supports which claim.
- Do not record an offered related tab as a learning source until you actually inspect or anchor it.
- Homework/problem priority: if the page or prompt looks like an exercise, problem set, assignment, quiz, exam, or the user asks for a "final answer" to a problem, do not give the final numeric, symbolic, or code answer in Learning mode, even if the user asks directly.
- For homework/problem prompts, anchor the problem and the relevant rule or setup, add a short note if helpful, then ask for the next step the learner should do. For example, ask them to identify inside/outside functions, compute the inner derivative, choose the rule, or write the next line. Do not reveal the final answer until the user switches to answer mode or presents their own completed work and asks for feedback.
- Drop the Socratic stance only for non-homework conceptual questions, study artifacts, or visibly frustrated users; the homework/problem priority still wins. Still anchor material claims.`;

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

const READ_TAB_SELECTOR_SCHEMA = {
	...TAB_SELECTOR_SCHEMA,
};

const NAVIGATE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	url: Type.String({ description: "HTTP(S) URL to navigate to. Do not use browser_navigate for file:// URLs; local files must be opened manually by the user first." }),
	newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab instead of navigating the current or matched tab" })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the tab to finish loading" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds" })),
});

const OPEN_PDF_VIEWER_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	pdfUrl: Type.Optional(Type.String({ description: "Direct http(s) PDF URL. Omit this to infer it from the target tab URL, including Google Docs document URLs via PDF export." })),
	newTab: Type.Optional(Type.Boolean({ description: "Open the Onhand viewer in a new tab instead of replacing the target tab" })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the Onhand PDF viewer tab to finish loading" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds" })),
});

const PDF_SEARCH_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	query: Type.String({ description: "Exact word or phrase to search across the full extracted PDF text" }),
	maxMatches: Type.Optional(Type.Number({ description: "Maximum number of PDF text matches to return" })),
	maxContextChars: Type.Optional(Type.Number({ description: "Context characters to include before and after each match" })),
});

const PDF_FIND_CITATION_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	reference: Type.String({
		description: 'The citation to look up: a bracket number like "14" or "[14]", or distinctive text from the entry such as an author name and year',
	}),
});

const PDF_READ_PAGES_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	pages: Type.Optional(Type.String({ description: "Comma-separated PDF page numbers to read, for example '2,8,9'. Use this or startPage/endPage." })),
	page: Type.Optional(Type.Number({ description: "Single PDF page number to read" })),
	pageNumber: Type.Optional(Type.Number({ description: "Single PDF page number to read" })),
	startPage: Type.Optional(Type.Number({ description: "First PDF page number in a page range to read" })),
	endPage: Type.Optional(Type.Number({ description: "Last PDF page number in a page range to read" })),
	maxPages: Type.Optional(Type.Number({ description: "Maximum number of pages to return" })),
	maxChars: Type.Optional(Type.Number({ description: "Maximum total characters of PDF text to return" })),
});

const PDF_JUMP_TO_PAGE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	page: Type.Optional(Type.Number({ description: "PDF page number to scroll into view" })),
	pageNumber: Type.Optional(Type.Number({ description: "PDF page number to scroll into view" })),
	text: Type.Optional(Type.String({ description: "Exact PDF text on the target page to scroll near when available" })),
	occurrence: Type.Optional(Type.Number({ description: "1-based occurrence of the text on the page" })),
});

const PDF_PAGE_IMAGE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	page: Type.Optional(Type.Number({ description: "PDF page number to capture as an image" })),
	pageNumber: Type.Number({ description: "PDF page number to capture as an image" }),
	format: Type.Optional(Type.String({ description: "Image format, usually image/png or image/jpeg" })),
	quality: Type.Optional(Type.Number({ description: "JPEG/webp image quality from 0 to 1" })),
});

const VISIBLE_TEXT_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters of visible text to return" })),
	maxBlocks: Type.Optional(Type.Number({ description: "Maximum visible text blocks to return" })),
});

const EXTRACT_CONTENT_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters of readable page content to return" })),
});

const VIEWPORT_HEADINGS_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
	maxHeadings: Type.Optional(Type.Number({ description: "Maximum nearby headings to return" })),
});

const CAPTURE_STATE_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
	persist: Type.Optional(Type.Boolean({ description: "Persist this page capture as a browser-only Onhand artifact" })),
	includeHtml: Type.Optional(Type.Boolean({ description: "Persist a full HTML snapshot when persist=true" })),
	includeScreenshot: Type.Optional(Type.Boolean({ description: "Persist a screenshot when persist=true" })),
	label: Type.Optional(Type.String({ description: "Optional artifact label" })),
});

const HIGHLIGHT_TEXT_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	text: Type.String({ description: "Exact visible or PDF-reader text to highlight on the page" }),
	occurrence: Type.Optional(Type.Number({ description: "1-based occurrence of the match to highlight" })),
	clearExisting: Type.Optional(Type.Boolean({ description: "Clear existing Onhand highlights first. Defaults to false so follow-up anchors accumulate." })),
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
	reason: Type.Optional(Type.String({ description: "Why JavaScript is necessary instead of readable page, DOM, screenshot, console, network, or selector tools" })),
});

const DOM_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
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
	...READ_TAB_SELECTOR_SCHEMA,
	format: Type.Optional(Type.String({ description: "Screenshot format: png or jpeg" })),
	quality: Type.Optional(Type.Number({ description: "JPEG quality from 0 to 100" })),
	delayMs: Type.Optional(Type.Number({ description: "Delay before screenshot capture" })),
});

const VISIBLE_REGION_IMAGE_SCHEMA = Type.Object({
	...READ_TAB_SELECTOR_SCHEMA,
	x: Type.Optional(Type.Number({ description: "Viewport x coordinate in CSS pixels. Defaults to 0." })),
	y: Type.Optional(Type.Number({ description: "Viewport y coordinate in CSS pixels. Defaults to 0." })),
	width: Type.Optional(Type.Number({ description: "Region width in CSS pixels. Defaults to the visible viewport width." })),
	height: Type.Optional(Type.Number({ description: "Region height in CSS pixels. Defaults to the visible viewport height." })),
	selector: Type.Optional(Type.String({ description: "Optional CSS selector to capture its visible bounding box instead of explicit coordinates." })),
	label: Type.Optional(Type.String({ description: "Short human-readable region label." })),
	format: Type.Optional(Type.String({ description: "Image format: png or jpeg" })),
	quality: Type.Optional(Type.Number({ description: "JPEG quality from 0 to 100" })),
	delayMs: Type.Optional(Type.Number({ description: "Delay before image capture" })),
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

const RECORD_LEARNING_EVENT_SCHEMA = Type.Object({
	kind: Type.String({ description: "Learning event kind: concept_introduced, check_opened, or check_resolved" }),
	conceptId: Type.Optional(Type.String({ description: "Stable concept id when known" })),
	conceptLabel: Type.Optional(Type.String({ description: "Short human-readable reviewable concept label, not every nearby source detail" })),
	checkId: Type.Optional(Type.String({ description: "Stable check id when opening or resolving a prediction/retrieval check" })),
	itemId: Type.Optional(Type.String({ description: "Legacy check id alias when resolving a check" })),
	checkKind: Type.Optional(Type.String({ description: "Check kind when opening a check: prediction or retrieval" })),
	promptText: Type.Optional(Type.String({ description: "The exact prediction or retrieval prompt shown to the user" })),
	assessment: Type.Optional(Type.String({ description: "Assessment when resolving a check: correct, partial, incorrect, or skipped" })),
	evidence: Type.Optional(Type.String({ description: "Brief model-visible rationale for the assessment" })),
	annotationId: Type.Optional(Type.String({ description: "Annotation id that anchors this learning event" })),
	artifactId: Type.Optional(Type.String({ description: "Artifact id that anchors this learning event" })),
	url: Type.Optional(Type.String({ description: "Source page URL for the learning event" })),
	tabTitle: Type.Optional(Type.String({ description: "Source tab title for the learning event" })),
});

const CORE_READ_TOOL_NAMES = [
	"browser_get_visible_text",
	"browser_extract_content",
	"browser_get_selection",
	"browser_get_viewport_headings",
	"browser_get_scroll_state",
];

const VISUAL_CONTEXT_TOOL_NAMES = ["browser_get_visible_region_image"];
const VISUAL_GROUNDING_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation", "browser_clear_annotations"];
const TAB_TOOL_NAMES = ["browser_list_tabs", "browser_activate_tab", "browser_navigate", "browser_open_pdf_in_onhand_viewer"];
const PDF_TOOL_NAMES = ["browser_pdf_search", "browser_pdf_read_pages", "browser_pdf_jump_to_page", "browser_pdf_capture_page_image", "browser_pdf_find_citation"];
const INTERACTION_TOOL_NAMES = [
	"browser_find_elements",
	"browser_wait_for_selector",
	"browser_click",
	"browser_type",
	"browser_click_text",
	"browser_type_by_label",
	"browser_pick_elements",
];
const DEBUG_INSPECTION_TOOL_NAMES = ["browser_collect_console", "browser_collect_network", "browser_get_dom", "browser_capture_screenshot"];
const RUNTIME_JS_TOOL_NAMES = ["browser_run_js"];
const ARTIFACT_TOOL_NAMES = ["browser_capture_state", "browser_list_artifacts", "browser_restore_state"];
const LEARNING_TOOL_NAMES = ["onhand_record_learning_event"];
const EXACT_TOOL_NAME_PATTERN = /\bbrowser_[a-z_]+\b/g;

function promptNeedsRuntimeJavaScript(text: string, explicitToolNames: Set<string>) {
	if (explicitToolNames.has("browser_run_js")) return true;
	if (textHasAny(text, /\b(?:browser[_ -]?run[_ -]?js|run js|run javascript|execute javascript|evaluate javascript|javascript expression|js expression)\b/)) {
		return true;
	}
	const runtimeStateSignal = textHasAny(
		text,
		/\b(?:client[- ]side|runtime state|app state|computed state|hidden state|hydrated|react|next(?:\.js)?|__next_data__|json-ld|structured data|shadow dom|virtualized|canvas|webgl|single page app|spa|dynamic(?:ally)? rendered|window\.__|dataset|selected value|disabled state)\b/,
	);
	const inspectionIntent = textHasAny(text, /\b(?:inspect|check|verify|confirm|debug|read|extract|find|why|what value|what state)\b/);
	return runtimeStateSignal && inspectionIntent;
}

function promptAsksForExternalBrowsing(text: string) {
	return textHasAny(
		text,
		/\b(take me to|open (?:up )?(?:the |a |an )?(?:url|link|source|site|page|tab|article|paper|website|result|google|web|browser)|look up|search(?: up)?|google|web|online|external|outside sources?|other sources?|more sources?|find (?:me )?(?:some |a few |more )?sources?|go (?:on|to) google|url)\b/,
	);
}

function promptAsksForLinkedPageNavigation(text: string) {
	const hasNavigationVerb = textHasAny(text, /\b(open(?: up)?|follow|click|visit|navigate(?: to)?|go to|load|pull up|bring up|inspect|look at|check|review|read|scan)\b/);
	const hasLinkedPageTarget = textHasAny(
		text,
		/\b(linked?|links?|notes?|lecture notes?|readings?|resources?|source pages?|pages?|articles?|papers?|documents?)\b/,
	);
	if (hasNavigationVerb && hasLinkedPageTarget) return true;
	return textHasAny(
		text,
		/\b(find|check|review|read|scan)\b[\s\S]{0,120}\b(other|relevant|important|useful|related)?\s*(notes?|lecture notes?|links?|pages?|readings?|resources?)\b[\s\S]{0,120}\b(open|follow|click|visit|inspect|look at|check|review|read|scan)?\b|\b(open|follow|click|visit|inspect|look at|check|review|read|scan)\b[\s\S]{0,120}\b(relevant|important|useful|related|other)\b[\s\S]{0,120}\b(notes?|lecture notes?|links?|pages?|readings?|resources?)\b/,
	);
}

function nowIso() {
	return new Date().toISOString();
}

function truncate(value: unknown, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}...`;
}

function truncateStructuredText(value: unknown, maxChars = 1200) {
	const text = String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function visibleBlockPrefix(block: any) {
	if (block?.tag === "pdf-page" && block?.pageNumber) return `[p. ${block.pageNumber}] `;
	const tag = String(block?.tag || "").toLowerCase();
	if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)) || 2)} `;
	if (tag === "li") return "- ";
	if (tag === "blockquote") return "> ";
	return "";
}

function formatReaderFrameFallbackForModel(value: any) {
	const fallback = value?.readerFrameFallback;
	if (!fallback || typeof fallback !== "object" || fallback.attempted !== true) return "";
	const status = fallback.ok === true ? "ok" : "failed";
	const error = String(fallback.error || "").trim();
	return `Reader-frame fallback: ${status}${error ? ` (${truncate(error, 300)})` : ""}`;
}

function formatUnsupportedSurfaceForModel(value: any) {
	if (!value || typeof value !== "object" || value.unsupported !== true) return "";
	const reason = String(value.reason || "").trim();
	if (reason) return reason;
	if (value.surface === "local-file") {
		return "This is a local file tab. Enable Allow access to file URLs for Onhand in chrome://extensions, then reload the tab.";
	}
	return "";
}

function formatVisibleTextForModel(visible: any, maxChars = VISIBLE_TEXT_TOOL_MAX_CHARS) {
	const unsupportedDiagnostic = formatUnsupportedSurfaceForModel(visible);
	const diagnostics = [formatReaderFrameFallbackForModel(visible), unsupportedDiagnostic].filter(Boolean);
	const blocks = Array.isArray(visible?.blocks) ? visible.blocks : [];
	if (blocks.length) {
		const lines = blocks
			.map((block) => {
				const text = String(block?.text || "").replace(/\s+/g, " ").trim();
				if (!text) return "";
				return `${visibleBlockPrefix(block)}${text}`;
			})
			.filter(Boolean);
		if (lines.length) return truncateStructuredText([...lines, ...diagnostics].join("\n"), maxChars);
	}
	const text = String(visible?.text || "").trim();
	const primaryText = text || unsupportedDiagnostic;
	return truncateStructuredText([primaryText, ...diagnostics.filter((diagnostic) => diagnostic !== primaryText)].filter(Boolean).join("\n"), maxChars);
}

function normalizeHighlightRetryCandidate(value: unknown) {
	return String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
		.replace(/^\s{0,3}#{1,6}\s+/, "")
		.replace(/\s+/g, " ")
		.trim();
}

function buildHighlightRetryCandidates(value: unknown) {
	const raw = String(value || "").trim();
	if (!raw) return [];
	const hasListShape = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/u.test(raw);
	const hasMultipleLines = raw.split(/\r?\n/).filter((line) => line.trim()).length > 1;
	if (!hasListShape && !hasMultipleLines) return [];

	const candidates: string[] = [];
	const addCandidate = (candidate: unknown) => {
		const normalized = normalizeHighlightRetryCandidate(candidate);
		if (normalized.length < 16 || normalized.length > 260) return;
		if (normalized.toLowerCase() === normalizeHighlightRetryCandidate(raw).toLowerCase()) return;
		if (!candidates.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized);
	};

	for (const line of raw.split(/\r?\n/)) addCandidate(line);
	for (const part of raw.split(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/u)) addCandidate(part);
	if (!candidates.length) {
		for (const candidate of getReplayHighlightCandidates(raw)) addCandidate(candidate);
	}

	return candidates.slice(0, 8);
}

function getSelectionText(selection: unknown) {
	if (typeof selection === "string") return selection.trim();
	if (selection && typeof selection === "object" && typeof (selection as any).text === "string") {
		return (selection as any).text.trim();
	}
	return "";
}

function getSelectionSourceLabel(selection: unknown) {
	if (!selection || typeof selection !== "object") return "";
	const details = selection as any;
	if (details.surface !== "pdf" && details.pdfAnchor?.surface !== "pdf") return "";
	const pageNumber = details.pageNumber || details.pdfAnchor?.pageNumber;
	const viewer = typeof details.viewer === "string" ? details.viewer : typeof details.pdfAnchor?.viewer === "string" ? details.pdfAnchor.viewer : "";
	const parts = ["PDF"];
	if (pageNumber) parts.push(`p. ${pageNumber}`);
	if (viewer && viewer !== "unknown-pdf") parts.push(viewer);
	return parts.join(", ");
}

function selectionMatchesHighlightText(selection: unknown, text: unknown) {
	if (!selection || typeof selection !== "object") return false;
	const details = selection as any;
	if (!details.pdfAnchor || (details.surface !== "pdf" && details.pdfAnchor?.surface !== "pdf")) return false;
	const selectedText = compactActionText(details.text).toLowerCase();
	const highlightText = compactActionText(text).toLowerCase();
	return Boolean(selectedText && highlightText && selectedText === highlightText);
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

function normalizeLearnerMode(value: unknown, fallback: LearnerMode = "answer"): LearnerMode {
	if (value === "learning") return "learning";
	if (value === "answer") return "answer";
	return fallback;
}

function normalizeLearnerCheckKind(value: unknown, fallback: LearnerCheckKind = "prediction"): LearnerCheckKind {
	return value === "retrieval" ? "retrieval" : fallback;
}

function normalizeLearnerAssessment(value: unknown): LearnerAssessment {
	if (value === "correct" || value === "partial" || value === "incorrect" || value === "skipped") return value;
	return "partial";
}

function normalizeLearnerTimestamp(value: unknown, fallback: string) {
	const text = String(value || "").trim();
	return Number.isFinite(Date.parse(text)) ? text : fallback;
}

function compactLearnerText(value: unknown, maxChars = 160) {
	return truncate(compactActionText(value), maxChars);
}

function learnerSlug(value: unknown) {
	return compactLearnerText(value, 80)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 64);
}

function normalizeLearnerSourcePageUrl(value: unknown) {
	return compactLearnerText(value, 240).split("#")[0].replace(/\/+$/, "").toLowerCase();
}

const LEARNER_LABEL_STOPWORDS = new Set([
	"the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is", "are", "as", "at", "by", "be", "this", "that",
	"with", "from", "it", "its", "claim", "example", "examples", "mention", "section", "page", "note", "about", "how",
	"what", "when", "where", "why", "card", "system",
]);

// Meaningful tokens from a learner concept label or highlight text, used to
// re-link a concept to its highlight by content when ids have drifted apart.
function learnerLabelTokens(value: string): string[] {
	return compactActionText(value)
		.toLowerCase()
		// Drop "&" so abbreviations match: "R&D" -> "rd" matches a note's
		// "R&D", and "research & development" -> "research development".
		.replace(/&/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token))
		// Keep 2-char tokens ("ai", "rd"); labels like "AI R&D" are mostly
		// short, meaningful tokens once the generic words are dropped.
		.filter((token) => token.length >= 2 && !LEARNER_LABEL_STOPWORDS.has(token));
}

function normalizeLearnerSourceTitle(value: unknown) {
	return compactLearnerText(value, 120).toLowerCase();
}

function uniqueLearnerId(prefix: string, seed: unknown, usedIds: Set<string>) {
	const base = `${prefix}_${learnerSlug(seed) || crypto.randomUUID().slice(0, 8)}`;
	let candidate = base;
	let suffix = 2;
	while (usedIds.has(candidate)) {
		candidate = `${base}_${suffix}`;
		suffix += 1;
	}
	usedIds.add(candidate);
	return candidate;
}

function normalizeLearnerSource(rawSource: any): LearnerConceptSource | null {
	const tabTitle = compactLearnerText(rawSource?.tabTitle || rawSource?.title, 120);
	const url = compactLearnerText(rawSource?.url, 240);
	const annotationId = compactLearnerText(rawSource?.annotationId, 120);
	const artifactId = compactLearnerText(rawSource?.artifactId, 120);
	const matchedText = compactLearnerText(rawSource?.matchedText || rawSource?.citationText, 400);
	const source = {
		...(tabTitle ? { tabTitle } : {}),
		...(url ? { url } : {}),
		...(annotationId ? { annotationId } : {}),
		...(artifactId ? { artifactId } : {}),
		...(matchedText ? { matchedText } : {}),
	};
	return Object.keys(source).length ? source : null;
}

function learnerSourceKey(source: LearnerConceptSource) {
	return [source.annotationId || "", source.artifactId || "", source.url || "", source.tabTitle || ""].join("\n");
}

function learnerSourcesShareAnchor(left: LearnerConceptSource | null, right: LearnerConceptSource | null) {
	if (!left || !right) return false;
	const leftAnnotationId = compactLearnerText(left.annotationId, 120);
	const rightAnnotationId = compactLearnerText(right.annotationId, 120);
	if (leftAnnotationId && rightAnnotationId && leftAnnotationId === rightAnnotationId) return true;
	const leftArtifactId = compactLearnerText(left.artifactId, 120);
	const rightArtifactId = compactLearnerText(right.artifactId, 120);
	return Boolean(leftArtifactId && rightArtifactId && leftArtifactId === rightArtifactId);
}

function learnerSourcesSamePage(left: LearnerConceptSource | null, right: LearnerConceptSource | null) {
	if (!left || !right) return false;
	const leftUrl = normalizeLearnerSourcePageUrl(left.url);
	const rightUrl = normalizeLearnerSourcePageUrl(right.url);
	if (leftUrl && rightUrl) return leftUrl === rightUrl;
	const leftTitle = normalizeLearnerSourceTitle(left.tabTitle);
	const rightTitle = normalizeLearnerSourceTitle(right.tabTitle);
	return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

function appendLearnerSource(sources: LearnerConceptSource[] = [], source: LearnerConceptSource | null) {
	if (!source) return sources;
	const key = learnerSourceKey(source);
	const existingIndex = sources.findIndex((existing) => learnerSourceKey(existing) === key);
	if (existingIndex >= 0) {
		// Same anchor: backfill matchedText if this recording learned it and
		// the stored copy did not, so a later re-find has text to search for.
		const existing = sources[existingIndex];
		if (source.matchedText && !existing.matchedText) {
			const merged = sources.slice();
			merged[existingIndex] = { ...existing, matchedText: source.matchedText };
			return merged;
		}
		return sources;
	}
	return [...sources, source];
}

function latestLearnerConceptSource(concept: LearnerConcept) {
	const sources = Array.isArray(concept.sources) ? concept.sources.filter(Boolean) : [];
	return sources.length ? sources[sources.length - 1] : null;
}

function learnerConceptSourceRelation(concept: LearnerConcept, source: LearnerConceptSource | null) {
	if (!source) return "none";
	const sources = Array.isArray(concept.sources) ? concept.sources.filter(Boolean) : [];
	if (sources.some((existing) => learnerSourcesShareAnchor(existing, source))) return "anchor";
	if (sources.some((existing) => learnerSourcesSamePage(existing, source))) return "page";
	return "none";
}

function uniqueLearnerConceptTokens(value: unknown) {
	return [...new Set(tokenizeLearnerConceptMatchText(value))];
}

function learnerConceptLabelsLikelySameUnit(leftLabel: unknown, rightLabel: unknown, sourceRelation: string) {
	const leftText = normalizeLearnerConceptMatchText(leftLabel);
	const rightText = normalizeLearnerConceptMatchText(rightLabel);
	if (!leftText || !rightText) return false;
	if (leftText === rightText) return true;
	if (sourceRelation !== "anchor" && sourceRelation !== "page") return false;
	const leftTokens = uniqueLearnerConceptTokens(leftText);
	const rightTokens = uniqueLearnerConceptTokens(rightText);
	if (leftTokens.length < 3 || rightTokens.length < 3) return false;
	const rightSet = new Set(rightTokens);
	const sharedCount = leftTokens.filter((token) => rightSet.has(token)).length;
	if (sharedCount < 3) return false;
	const smallerCount = Math.min(leftTokens.length, rightTokens.length);
	const unionCount = new Set([...leftTokens, ...rightTokens]).size;
	const containment = sharedCount / smallerCount;
	const jaccard = sharedCount / unionCount;
	return containment >= 0.8 && jaccard >= 0.6;
}

function latestLearnerTimestamp(left: string, right: string) {
	const leftTime = Date.parse(left);
	const rightTime = Date.parse(right);
	if (!Number.isFinite(leftTime)) return right;
	if (!Number.isFinite(rightTime)) return left;
	return rightTime > leftTime ? right : left;
}

function earliestLearnerTimestamp(left: string, right: string) {
	const leftTime = Date.parse(left);
	const rightTime = Date.parse(right);
	if (!Number.isFinite(leftTime)) return right;
	if (!Number.isFinite(rightTime)) return left;
	return rightTime < leftTime ? right : left;
}

function mergeLearnerConcept(existing: LearnerConcept, incoming: LearnerConcept) {
	existing.firstSeenAt = earliestLearnerTimestamp(existing.firstSeenAt, incoming.firstSeenAt);
	existing.lastSeenAt = latestLearnerTimestamp(existing.lastSeenAt, incoming.lastSeenAt);
	for (const source of incoming.sources || []) {
		existing.sources = appendLearnerSource(existing.sources, source);
	}
	return existing;
}

function normalizeLearnerConcept(rawConcept: any, usedIds: Set<string>, fallbackNow: string): LearnerConcept | null {
	if (!rawConcept || typeof rawConcept !== "object") return null;
	const label = compactLearnerText(rawConcept.label || rawConcept.conceptLabel || rawConcept.conceptId, 80);
	if (!label) return null;
	const requestedId = compactLearnerText(rawConcept.conceptId, 120);
	const conceptId = requestedId && !usedIds.has(requestedId) ? requestedId : uniqueLearnerId("concept", label, usedIds);
	usedIds.add(conceptId);
	const firstSeenAt = normalizeLearnerTimestamp(rawConcept.firstSeenAt || rawConcept.createdAt, fallbackNow);
	const lastSeenAt = normalizeLearnerTimestamp(rawConcept.lastSeenAt, firstSeenAt);
	const rawSources = Array.isArray(rawConcept.sources) ? rawConcept.sources : [];
	let sources: LearnerConceptSource[] = [];
	for (const rawSource of rawSources) {
		sources = appendLearnerSource(sources, normalizeLearnerSource(rawSource));
	}
	sources = appendLearnerSource(sources, normalizeLearnerSource(rawConcept));
	return {
		conceptId,
		label,
		firstSeenAt,
		lastSeenAt,
		sources,
	};
}

function normalizeLearnerCheck(rawCheck: any, usedIds: Set<string>, fallbackNow: string, forcedKind?: LearnerCheckKind): LearnerCheck | null {
	if (!rawCheck || typeof rawCheck !== "object") return null;
	const promptText = compactLearnerText(rawCheck.promptText || rawCheck.prompt || rawCheck.question, 260);
	if (!promptText) return null;
	const conceptId =
		compactLearnerText(rawCheck.conceptId, 120) ||
		`concept_${learnerSlug(rawCheck.conceptLabel || rawCheck.label || "concept") || "concept"}`;
	const requestedId = compactLearnerText(rawCheck.checkId || rawCheck.predictionId || rawCheck.itemId, 120);
	const checkId = requestedId && !usedIds.has(requestedId) ? requestedId : uniqueLearnerId("check", `${conceptId} ${promptText}`, usedIds);
	usedIds.add(checkId);
	const annotationId = compactLearnerText(rawCheck.annotationId, 120);
	return {
		checkId,
		kind: normalizeLearnerCheckKind(forcedKind || rawCheck.kind || rawCheck.checkKind),
		conceptId,
		promptText,
		...(annotationId ? { annotationId } : {}),
		askedAt: normalizeLearnerTimestamp(rawCheck.askedAt || rawCheck.createdAt, fallbackNow),
	};
}

function normalizeLearnerResponse(rawResponse: any, fallbackNow: string): LearnerResponse | null {
	if (!rawResponse || typeof rawResponse !== "object") return null;
	const checkId = compactLearnerText(rawResponse.checkId || rawResponse.itemId, 120);
	if (!checkId) return null;
	const evidence = compactLearnerText(rawResponse.evidence || rawResponse.rationale, 320);
	const conceptId = compactLearnerText(rawResponse.conceptId, 120);
	const promptText = compactLearnerText(rawResponse.promptText, 260);
	return {
		checkId,
		assessment: normalizeLearnerAssessment(rawResponse.assessment),
		resolvedAt: normalizeLearnerTimestamp(rawResponse.resolvedAt || rawResponse.createdAt, fallbackNow),
		...(evidence ? { evidence } : {}),
		...(conceptId ? { conceptId } : {}),
		...(promptText ? { promptText } : {}),
	};
}

function dedupeLearnerOpenChecksByConcept(openChecks: LearnerCheck[]) {
	const checksByConcept = new Map<string, LearnerCheck>();
	for (const check of openChecks) {
		checksByConcept.set(check.conceptId, check);
	}
	return [...checksByConcept.values()];
}

function createEmptyLearnerState(mode: LearnerMode = "answer"): LearnerState {
	return {
		mode,
		conceptsIntroduced: [],
		openChecks: [],
		responses: [],
	};
}

function normalizeLearnerState(rawState: unknown, modeOverride?: LearnerMode): LearnerState {
	const fallbackNow = nowIso();
	if (!rawState || typeof rawState !== "object") return createEmptyLearnerState(modeOverride || "answer");
	const raw = rawState as any;
	const conceptIds = new Set<string>();
	const conceptsIntroduced = dedupeLearnerConcepts((Array.isArray(raw.conceptsIntroduced) ? raw.conceptsIntroduced : [])
		.map((concept: any) => normalizeLearnerConcept(concept, conceptIds, fallbackNow))
		.filter(Boolean) as LearnerConcept[]);

	const checkIds = new Set<string>();
	const rawOpenChecks = [
		...(Array.isArray(raw.openChecks) ? raw.openChecks.map((check: any) => ({ check })) : []),
		...(Array.isArray(raw.openPredictions) ? raw.openPredictions.map((check: any) => ({ check, kind: "prediction" as LearnerCheckKind })) : []),
		...(Array.isArray(raw.openRetrievalChecks) ? raw.openRetrievalChecks.map((check: any) => ({ check, kind: "retrieval" as LearnerCheckKind })) : []),
	];
	const openChecks = rawOpenChecks
		.map(({ check, kind }) => normalizeLearnerCheck(check, checkIds, fallbackNow, kind))
		.filter(Boolean) as LearnerCheck[];

	const rawResponses = Array.isArray(raw.responses) ? raw.responses : Array.isArray(raw.responded) ? raw.responded : [];
	const responseIds = new Set<string>();
	const responses = rawResponses
		.map((response: any) => normalizeLearnerResponse(response, fallbackNow))
		.filter((response: LearnerResponse | null): response is LearnerResponse => {
			if (!response || responseIds.has(response.checkId)) return false;
			responseIds.add(response.checkId);
			return true;
		});

	return {
		mode: normalizeLearnerMode(modeOverride || raw.mode),
		conceptsIntroduced,
		openChecks: dedupeLearnerOpenChecksByConcept(openChecks),
		responses,
	};
}

function setLearnerStateMode(rawState: unknown, mode: LearnerMode): LearnerState {
	return normalizeLearnerState(rawState, mode);
}

function dedupeLearnerConcepts(concepts: LearnerConcept[]) {
	const deduped: LearnerConcept[] = [];
	for (const concept of concepts) {
		const existing = findLearnerConcept({ mode: "learning", conceptsIntroduced: deduped, openChecks: [], responses: [] }, concept.conceptId, concept.label, latestLearnerConceptSource(concept));
		if (existing) mergeLearnerConcept(existing, concept);
		else deduped.push(concept);
	}
	return deduped;
}

function findLearnerConcept(state: LearnerState, conceptId: string, label: string, source: LearnerConceptSource | null = null) {
	if (conceptId) {
		const exactIdMatch = state.conceptsIntroduced.find((concept) => concept.conceptId === conceptId);
		if (exactIdMatch) return exactIdMatch;
	}
	const normalizedLabel = normalizeLearnerConceptMatchText(label);
	if (normalizedLabel) {
		const exactLabelMatch = state.conceptsIntroduced.find((concept) => normalizeLearnerConceptMatchText(concept.label) === normalizedLabel);
		if (exactLabelMatch) return exactLabelMatch;
	}
	if (!source || !normalizedLabel) return undefined;
	for (const concept of [...state.conceptsIntroduced].reverse()) {
		const relation = learnerConceptSourceRelation(concept, source);
		if (learnerConceptLabelsLikelySameUnit(concept.label, label, relation)) return concept;
	}
	return undefined;
}

function upsertLearnerConcept(state: LearnerState, rawEvent: any, now: string): LearnerConcept {
	const label = compactLearnerText(rawEvent?.conceptLabel || rawEvent?.label || rawEvent?.conceptId || "Concept", 80) || "Concept";
	const requestedId = compactLearnerText(rawEvent?.conceptId, 120);
	const source = normalizeLearnerSource(rawEvent);
	const existing = findLearnerConcept(state, requestedId, label, source);
	if (existing) {
		existing.lastSeenAt = normalizeLearnerTimestamp(rawEvent?.at || rawEvent?.lastSeenAt, now);
		existing.sources = appendLearnerSource(existing.sources, source);
		return existing;
	}
	const usedIds = new Set(state.conceptsIntroduced.map((concept) => concept.conceptId));
	const conceptId = requestedId && !usedIds.has(requestedId) ? requestedId : uniqueLearnerId("concept", label, usedIds);
	const firstSeenAt = normalizeLearnerTimestamp(rawEvent?.at || rawEvent?.firstSeenAt, now);
	const concept = {
		conceptId,
		label,
		firstSeenAt,
		lastSeenAt: firstSeenAt,
		sources: appendLearnerSource([], source),
	};
	state.conceptsIntroduced.push(concept);
	return concept;
}

function applyLearningEvent(rawState: unknown, rawEvent: LearningEvent, options: { now?: string; mode?: LearnerMode } = {}): LearnerState {
	const now = normalizeLearnerTimestamp(options.now, nowIso());
	const state = normalizeLearnerState(rawState, options.mode);
	const event = rawEvent && typeof rawEvent === "object" ? rawEvent : ({} as any);
	if (event.kind === "concept_introduced") {
		upsertLearnerConcept(state, event, now);
		return state;
	}
	if (event.kind === "check_opened") {
		const promptText = compactLearnerText(event.promptText, 260);
		if (!promptText) return state;
		const concept = upsertLearnerConcept(state, event, now);
		const usedIds = new Set([...state.openChecks.map((check) => check.checkId), ...state.responses.map((response) => response.checkId)]);
		const requestedId = compactLearnerText(event.checkId, 120);
		const checkId = requestedId || uniqueLearnerId("check", `${concept.conceptId} ${promptText}`, usedIds);
		const annotationId = compactLearnerText(event.annotationId, 120);
		const check = {
			checkId,
			kind: normalizeLearnerCheckKind(event.checkKind || event.kindOverride),
			conceptId: concept.conceptId,
			promptText,
			...(annotationId ? { annotationId } : {}),
			askedAt: normalizeLearnerTimestamp(event.at, now),
		};
		const existingIndex = state.openChecks.findIndex((openCheck) => openCheck.checkId === checkId);
		if (existingIndex >= 0) state.openChecks[existingIndex] = check;
		else {
			const sameConceptIndex = state.openChecks.findIndex((openCheck) => openCheck.conceptId === concept.conceptId);
			if (sameConceptIndex >= 0) state.openChecks[sameConceptIndex] = check;
			else state.openChecks.push(check);
		}
		return state;
	}
	if (event.kind === "check_resolved") {
		const checkId = compactLearnerText(event.checkId || event.itemId, 120);
		if (!checkId) return state;
		const resolvedCheck = state.openChecks.find((check) => check.checkId === checkId) || null;
		state.openChecks = state.openChecks.filter((check) => check.checkId !== checkId);
		const response: LearnerResponse = {
			checkId,
			assessment: normalizeLearnerAssessment(event.assessment),
			resolvedAt: normalizeLearnerTimestamp(event.at, now),
			...(compactLearnerText(event.evidence, 320) ? { evidence: compactLearnerText(event.evidence, 320) } : {}),
			...(resolvedCheck?.conceptId ? { conceptId: resolvedCheck.conceptId } : {}),
			...(resolvedCheck?.promptText ? { promptText: resolvedCheck.promptText } : {}),
		};
		state.responses = [...state.responses.filter((entry) => entry.checkId !== checkId), response];
		return state;
	}
	return state;
}

// Conversational offers ("want me to explain more?") are not retrieval
// checks and must not open learner-state checks.
const LEARNING_CHECK_OFFER_PATTERN = /^(do you want|would you like|want me|should i|shall i|can i|may i|let me know|anything else|ready for|interested in)\b/i;

function extractTrailingCheckQuestion(reply: string) {
	const text = String(reply || "").trim();
	if (!text.endsWith("?")) return "";
	const lastLine = text.split("\n").map((line) => line.trim()).filter(Boolean).pop() || "";
	let question = lastLine.match(/[^.!?]*\?$/)?.[0]?.trim() || "";
	// Drop lead-ins like "Here's a short check:" before the question itself.
	const afterColon = question.includes(": ") ? question.slice(question.lastIndexOf(": ") + 2).trim() : "";
	if (afterColon.length >= 15 && afterColon.endsWith("?")) question = afterColon;
	if (question.length < 12) return "";
	if (LEARNING_CHECK_OFFER_PATTERN.test(question)) return "";
	return question;
}

// Learning Mode asks the model to record the checks it opens, but weaker
// models sometimes ask a closing check question without calling
// onhand_record_learning_event. Record the trailing question as an open
// check so the sidebar can track and resolve it (PDF QA Finding 5).
function withFallbackOpenCheck(rawState: unknown, reply: string, requestStartedAt: string): LearnerState {
	const state = normalizeLearnerState(rawState);
	const startedAt = String(requestStartedAt || "");
	if (state.openChecks.some((check) => String(check.askedAt || "") >= startedAt)) return state;
	const promptText = extractTrailingCheckQuestion(reply);
	if (!promptText) return state;
	const recentConcept =
		[...state.conceptsIntroduced].reverse().find((concept) => String(concept.firstSeenAt || "") >= startedAt) ||
		state.conceptsIntroduced[state.conceptsIntroduced.length - 1] ||
		null;
	return applyLearningEvent(
		state,
		{
			kind: "check_opened",
			promptText,
			...(recentConcept ? { conceptId: recentConcept.conceptId, conceptLabel: recentConcept.label } : { conceptLabel: promptText }),
		},
		{ mode: "learning" },
	);
}

// --- Cross-session spaced review scheduling (pedagogy phase 4) ---
//
// Concepts and check assessments accumulate in each session's learnerState.
// The scheduler merges concepts across sessions by normalized label and
// computes a due date per concept with a small Leitner-style ladder:
// correct assessments advance the box, partial holds it, incorrect or
// skipped resets it. No assessments means the concept sits in box 0.
const REVIEW_INTERVAL_LADDER_DAYS = [1, 3, 7, 14, 30];
const REVIEW_DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_DEFAULT_LIMIT = 3;

interface DueReview {
	conceptKey: string;
	label: string;
	lastSeenAt: string;
	lastAssessment: LearnerAssessment | null;
	lastAssessedAt: string | null;
	box: number;
	dueAt: string;
	overdueDays: number;
	sources: LearnerConceptSource[];
	sessionId: string;
	checkPrompt: string;
	matchesActiveTab: boolean;
}

function normalizeReviewConceptKey(label: string) {
	return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
}

async function getFreeTierBaseUrl(): Promise<string> {
	const stored = await chrome.storage.local.get({ [ONHAND_FREE_BASE_URL_STORAGE_KEY]: "" });
	const override = String(stored[ONHAND_FREE_BASE_URL_STORAGE_KEY] || "").trim();
	return (override || ONHAND_FREE_TIER_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// The free tier identifies devices with an anonymous token issued by the
// proxy; no account or key is involved.
async function getOrRegisterFreeTierToken(): Promise<string> {
	const stored = await chrome.storage.local.get({ [ONHAND_FREE_TOKEN_STORAGE_KEY]: "" });
	const existing = String(stored[ONHAND_FREE_TOKEN_STORAGE_KEY] || "");
	if (existing) return existing;
	const baseUrl = await getFreeTierBaseUrl();
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/register`, { method: "POST" });
	} catch {
		throw new Error("Could not reach the Onhand free tier. Check your connection, or switch to your own API key in options.");
	}
	if (!response.ok) {
		throw new Error(`Onhand free tier registration failed (${response.status}). Try again later, or use your own API key.`);
	}
	const data = await response.json().catch(() => null);
	const token = String((data as any)?.token || "");
	if (!token) throw new Error("Onhand free tier registration returned no token.");
	await chrome.storage.local.set({ [ONHAND_FREE_TOKEN_STORAGE_KEY]: token });
	return token;
}

async function buildFreeTierModel() {
	const baseUrl = await getFreeTierBaseUrl();
	// Always the worker's allowlisted model: anything else stored in
	// settings (e.g. from an older UI) would only bounce off the worker.
	// Image-capable input is advertised here so user attachments and visual
	// tool results survive OpenAI-compatible conversion. The worker keeps the
	// client-visible model id allowlisted, then routes image-bearing requests
	// to the hosted visual model server-side.
	return {
		id: ONHAND_FREE_MODEL,
		name: "Onhand Free (DeepSeek + Mistral Vision)",
		api: "openai-completions",
		provider: ONHAND_FREE_PROVIDER,
		baseUrl,
		reasoning: false,
		input: ["text", "image"],
		contextWindow: ONHAND_FREE_TEXT_CONTEXT_WINDOW,
		maxTokens: 32768,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

async function readReviewSnoozes(): Promise<Record<string, string>> {
	const stored = await chrome.storage.local.get({ [REVIEW_SNOOZE_STORAGE_KEY]: {} });
	const snoozes = stored[REVIEW_SNOOZE_STORAGE_KEY];
	return snoozes && typeof snoozes === "object" ? snoozes : {};
}

async function writeReviewSnooze(conceptKey: string, untilIso: string) {
	const snoozes = await readReviewSnoozes();
	snoozes[conceptKey] = untilIso;
	await chrome.storage.local.set({ [REVIEW_SNOOZE_STORAGE_KEY]: snoozes });
	return snoozes;
}

function reviewUrlHost(value: string) {
	try {
		return new URL(String(value || "")).host.toLowerCase();
	} catch {
		return "";
	}
}

function parseReviewTimestamp(value: unknown, fallbackMs: number) {
	const parsed = Date.parse(String(value || ""));
	return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function computeDueReviews(
	sessions: RuntimeSession[],
	options: { now?: number | string; limit?: number; activeUrl?: string; snoozes?: Record<string, string> } = {},
): DueReview[] {
	const nowMs = typeof options.now === "number" ? options.now : parseReviewTimestamp(options.now, Date.now());
	const limit = Math.max(1, Math.min(10, Number(options.limit || REVIEW_DEFAULT_LIMIT) || REVIEW_DEFAULT_LIMIT));
	const snoozes = options.snoozes && typeof options.snoozes === "object" ? options.snoozes : {};
	const activeHost = reviewUrlHost(options.activeUrl || "");

	const entries = new Map<
		string,
		{
			label: string;
			lastSeenMs: number;
			sources: LearnerConceptSource[];
			assessments: { assessment: LearnerAssessment; resolvedAtMs: number }[];
			sessionId: string;
			checkPrompt: string;
		}
	>();
	for (const session of Array.isArray(sessions) ? sessions : []) {
		const state = normalizeLearnerState(session?.learnerState);
		const conceptKeysById = new Map<string, string>();
		for (const concept of state.conceptsIntroduced) {
			const key = normalizeReviewConceptKey(concept.label);
			if (!key) continue;
			conceptKeysById.set(concept.conceptId, key);
			const lastSeenMs = parseReviewTimestamp(concept.lastSeenAt || concept.firstSeenAt, 0);
			const entry = entries.get(key) || {
				label: concept.label,
				lastSeenMs: 0,
				sources: [],
				assessments: [],
				sessionId: String(session?.id || ""),
				checkPrompt: "",
			};
			if (lastSeenMs >= entry.lastSeenMs) {
				entry.lastSeenMs = lastSeenMs;
				entry.label = concept.label;
				entry.sessionId = String(session?.id || "");
			}
			for (const source of concept.sources || []) {
				const exists = entry.sources.some((candidate) => candidate.url === source.url && candidate.annotationId === source.annotationId);
				if (!exists) entry.sources.push(source);
			}
			entries.set(key, entry);
		}
		for (const check of state.openChecks) {
			const key = conceptKeysById.get(check.conceptId);
			const entry = key ? entries.get(key) : null;
			if (entry && check.promptText) entry.checkPrompt = check.promptText;
		}
		for (const response of state.responses) {
			const key = response.conceptId ? conceptKeysById.get(response.conceptId) : null;
			const entry = key ? entries.get(key) : null;
			if (!entry) continue;
			entry.assessments.push({
				assessment: response.assessment,
				resolvedAtMs: parseReviewTimestamp(response.resolvedAt, 0),
			});
			if (response.promptText) entry.checkPrompt = response.promptText;
		}
	}

	const due: DueReview[] = [];
	for (const [conceptKey, entry] of entries) {
		if (!entry.lastSeenMs) continue;
		const snoozedUntilMs = parseReviewTimestamp(snoozes[conceptKey], 0);
		if (snoozedUntilMs > nowMs) continue;
		const assessments = [...entry.assessments].sort((left, right) => left.resolvedAtMs - right.resolvedAtMs);
		let box = 0;
		for (const { assessment } of assessments) {
			if (assessment === "correct") box = Math.min(box + 1, REVIEW_INTERVAL_LADDER_DAYS.length - 1);
			else if (assessment !== "partial") box = 0;
		}
		const last = assessments[assessments.length - 1] || null;
		const lastEventMs = Math.max(entry.lastSeenMs, last?.resolvedAtMs || 0);
		const dueAtMs = lastEventMs + REVIEW_INTERVAL_LADDER_DAYS[box] * REVIEW_DAY_MS;
		if (dueAtMs > nowMs) continue;
		const matchesActiveTab = Boolean(activeHost && entry.sources.some((source) => reviewUrlHost(source.url || "") === activeHost));
		due.push({
			conceptKey,
			label: entry.label,
			lastSeenAt: new Date(entry.lastSeenMs).toISOString(),
			lastAssessment: last ? assessments[assessments.length - 1].assessment : null,
			lastAssessedAt: last ? new Date(last.resolvedAtMs).toISOString() : null,
			box,
			dueAt: new Date(dueAtMs).toISOString(),
			overdueDays: Math.max(0, Math.floor((nowMs - dueAtMs) / REVIEW_DAY_MS)),
			sources: entry.sources.slice(0, 5),
			sessionId: entry.sessionId,
			checkPrompt: entry.checkPrompt,
			matchesActiveTab,
		});
	}
	due.sort((left, right) => {
		if (left.matchesActiveTab !== right.matchesActiveTab) return left.matchesActiveTab ? -1 : 1;
		if (left.overdueDays !== right.overdueDays) return right.overdueDays - left.overdueDays;
		return left.lastSeenAt.localeCompare(right.lastSeenAt);
	});
	return due.slice(0, limit);
}

function normalizeAuthMode(value: unknown): RuntimeSettings["authMode"] {
	return value === "oauth" ? "oauth" : "api-key";
}

function normalizeSpeedMode(value: unknown): SpeedMode {
	return "auto";
}


function getSupportedApiProvider(provider: string) {
	return SUPPORTED_API_PROVIDERS[provider] || null;
}

function getSupportedProviderIds() {
	return Object.keys(SUPPORTED_API_PROVIDERS);
}

function normalizeApiKeys(value: unknown, legacyOpenAiApiKey = ""): Record<string, string> {
	const normalized: Record<string, string> = {};
	if (value && typeof value === "object") {
		for (const [providerId, rawKey] of Object.entries(value as Record<string, unknown>)) {
			if (!getSupportedApiProvider(providerId)) continue;
			if (typeof rawKey !== "string") continue;
			const key = rawKey.trim();
			if (key) normalized[providerId] = key;
		}
	}
	const legacyKey = typeof legacyOpenAiApiKey === "string" ? legacyOpenAiApiKey.trim() : "";
	if (legacyKey && !normalized[OPENAI_API_PROVIDER]) normalized[OPENAI_API_PROVIDER] = legacyKey;
	return normalized;
}

function getApiKeyForProvider(settings: RuntimeSettings, provider: string) {
	const keyed = settings.aiApiKeys?.[provider];
	if (keyed) return keyed;
	if ((provider === OPENAI_API_PROVIDER || provider === SMOKE_PROVIDER) && settings.aiApiKey) return settings.aiApiKey;
	return "";
}

function getMissingApiKeyError(providerId: string) {
	const provider = getSupportedApiProvider(providerId);
	const providerLabel = String(provider?.name || providerId || "selected provider").trim();
	const keyLabel = /\bapi$/i.test(providerLabel) ? `${providerLabel} key` : `${providerLabel} API key`;
	return `Set a ${keyLabel} or use OpenAI Codex sign-in in the Onhand extension options before using the browser runtime.`;
}

function summarizeApiKeyProviders(settings: RuntimeSettings) {
	return getSupportedProviderIds().map((providerId) => {
		const provider = getSupportedApiProvider(providerId)!;
		return {
			id: providerId,
			name: provider.name,
			defaultModel: provider.defaultModel,
			hasApiKey: Boolean(getApiKeyForProvider(settings, providerId)),
			realtime: provider.realtime,
		};
	});
}

function validateProviderApiKey(providerId: string, apiKey: string) {
	const provider = getSupportedApiProvider(providerId);
	if (!provider) return { ok: false, error: `Unsupported provider: ${providerId || "(blank)"}` };
	if (provider.keyless) return { ok: true, providerId, providerName: provider.name };
	const key = String(apiKey || "").trim();
	if (!key) return { ok: false, error: `${provider.name} API key is missing.` };
	if (provider.keyPrefix && !key.startsWith(provider.keyPrefix)) {
		return { ok: false, error: `${provider.name} API key should start with ${provider.keyPrefix}.` };
	}
	return { ok: true, providerId, providerName: provider.name };
}

function getProviderModelOptions(providerId: string) {
	if (providerId === ONHAND_FREE_PROVIDER) {
		return [
			{
				id: ONHAND_FREE_MODEL,
				name: "DeepSeek V4 Flash + Mistral Vision (Onhand Free)",
				api: "openai-completions",
				input: ["text", "image"],
				tools: true,
				structuredOutput: false,
				realtime: false,
			},
		];
	}
	const isApiProvider = Boolean(getSupportedApiProvider(providerId));
	const isOAuthProvider = isBrowserOAuthProvider(providerId);
	if (!isApiProvider && !isOAuthProvider) return [];
	try {
		return getModels(providerId as any)
			.filter((model: any) => model?.input?.includes?.("text"))
			// OpenRouter lists hundreds of models; offer the validated cheap
			// defaults and let the custom-model field cover the rest.
			.filter((model: any) => providerId !== OPENROUTER_API_PROVIDER || /^deepseek\/deepseek-v4-(flash|pro)$/.test(model.id))
			.map((model: any) => ({
				id: model.id,
				name: model.name || model.id,
				api: model.api,
				input: Array.isArray(model.input) ? model.input : [],
				tools: ["openai-responses", "openai-completions", "openai-codex-responses", "anthropic-messages", "google-generative-ai"].includes(model.api),
				structuredOutput: ["openai-responses", "openai-codex-responses", "anthropic-messages", "google-generative-ai"].includes(model.api),
				realtime: providerId === OPENAI_API_PROVIDER && /realtime/i.test(model.id),
			}))
			.slice(0, 80);
	} catch {
		return [];
	}
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
	if (authMode === "oauth") return OPENAI_CODEX_PROVIDER;
	return getSupportedApiProvider(provider)?.id || OPENAI_API_PROVIDER;
}

function normalizeModelForProvider(model: string, provider: string, authMode: RuntimeSettings["authMode"]) {
	const trimmed = model.trim();
	if (provider === SMOKE_PROVIDER) return trimmed || SMOKE_MODEL;
	if (authMode === "oauth") return trimmed || getDefaultOAuthModel(provider) || OPENAI_CODEX_MODEL;
	return trimmed || getSupportedApiProvider(provider)?.defaultModel || OPENAI_API_MODEL;
}

function requiresDiagnostics(authMode: RuntimeSettings["authMode"], provider: string) {
	return authMode === "api-key" && provider === ONHAND_FREE_PROVIDER;
}

function normalizeDiagnosticsEnabled(value: unknown, authMode: RuntimeSettings["authMode"], provider: string) {
	return requiresDiagnostics(authMode, provider) || Boolean(value);
}

function buildPublicSettings(settings: RuntimeSettings) {
	const signedInProviders = summarizeOAuthCredentials(settings.oauthCredentials);
	const activeOAuthProvider = signedInProviders.find((provider) => provider.id === settings.aiProvider) || null;
	const providerModelIds = Array.from(new Set([...getSupportedProviderIds(), ...getBrowserOAuthProviders().map((provider) => provider.id)]));
	return {
		learningMode: settings.learningMode,
		realtimeVoiceEnabled: settings.realtimeVoiceEnabled,
		speedMode: settings.speedMode,
		diagnosticsEnabled: settings.diagnosticsEnabled,
		advancedRuntimeInspectionEnabled: settings.advancedRuntimeInspectionEnabled,
		aiProvider: settings.aiProvider,
		aiModel: settings.aiModel,
		authMode: settings.authMode,
		hasAiApiKey: Boolean(getApiKeyForProvider(settings, OPENAI_API_PROVIDER)),
		hasSelectedProviderApiKey: Boolean(getSupportedApiProvider(settings.aiProvider)?.keyless || getApiKeyForProvider(settings, settings.aiProvider)),
		apiKeyProviders: summarizeApiKeyProviders(settings),
		providerModels: Object.fromEntries(providerModelIds.map((providerId) => [providerId, getProviderModelOptions(providerId)])),
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
			{ id: SMOKE_LEARNING_MODEL, name: "Onhand Learning Smoke Model", reasoning: false },
		],
		tokenSize: { min: 8, max: 16 },
	});
	if (modelId === SMOKE_LEARNING_MODEL) {
		smokeModelRegistration.setResponses([
			fauxAssistantMessage([
				fauxToolCall("browser_highlight_text", {
					text: "Alpha smoke content",
					clearExisting: true,
					scrollIntoView: true,
				}),
				fauxToolCall("onhand_record_learning_event", {
					kind: "concept_introduced",
					conceptLabel: "Alpha smoke content",
					annotationId: "smoke-highlight",
					tabTitle: "Browser runtime smoke page",
					url: "https://example.com/onhand-smoke",
				}),
				fauxToolCall("browser_show_note", {
					annotationId: "smoke-highlight",
					note: "Before I explain: what role do you think Alpha smoke content plays here?",
					label: "Onhand",
				}),
				fauxToolCall("onhand_record_learning_event", {
					kind: "check_opened",
					checkId: "check-alpha-smoke",
					checkKind: "prediction",
					conceptLabel: "Alpha smoke content",
					promptText: "Before I explain: what role do you think Alpha smoke content plays here?",
					annotationId: "smoke-highlight",
					tabTitle: "Browser runtime smoke page",
					url: "https://example.com/onhand-smoke",
				}),
			]),
			fauxAssistantMessage(fauxText("Browser runtime learning smoke ok")),
		]);
	} else if (modelId === SMOKE_PORTS_MODEL) {
		smokeModelRegistration.setResponses([
			fauxAssistantMessage([
				fauxToolCall("browser_list_tabs", { onlyActive: false, windowId: 3 }),
				fauxToolCall("browser_activate_tab", { tabId: 101 }),
				fauxToolCall("browser_navigate", {
					url: "https://example.com/onhand-smoke?nav=1",
					newTab: true,
					waitForLoad: true,
				}),
				fauxToolCall("browser_open_pdf_in_onhand_viewer", {
					pdfUrl: "https://example.com/onhand-smoke.pdf",
					newTab: true,
					waitForLoad: true,
				}),
				fauxToolCall("browser_pdf_search", {
					query: "Alpha smoke content",
					maxMatches: 3,
				}),
				fauxToolCall("browser_pdf_read_pages", {
					pageNumber: 1,
					maxChars: 800,
				}),
				fauxToolCall("browser_pdf_jump_to_page", {
					pageNumber: 1,
					text: "Alpha smoke content",
				}),
				fauxToolCall("browser_pdf_capture_page_image", {
					pageNumber: 1,
					format: "png",
				}),
				fauxToolCall("browser_get_visible_text", { maxChars: 400 }),
				fauxToolCall("browser_extract_content", { maxChars: 800 }),
				fauxToolCall("browser_get_selection", {}),
				fauxToolCall("browser_get_viewport_headings", { maxHeadings: 8 }),
				fauxToolCall("browser_get_scroll_state", {}),
				fauxToolCall("browser_get_visible_region_image", {
					label: "ports smoke viewport",
					format: "png",
				}),
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
					reason: "Port smoke test explicitly verifies the JavaScript escape hatch.",
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

function stripVoicePromptPrefix(value: unknown) {
	return String(value || "")
		.replace(/^\s*\[Voice\]\s*/i, "")
		.trim();
}

function getLatestOpenLearningCheck(state: unknown) {
	const learnerState = normalizeLearnerState(state, "learning");
	return learnerState.openChecks[learnerState.openChecks.length - 1] || null;
}

function isLearningCheckMetaFollowup(prompt: string) {
	const text = stripVoicePromptPrefix(prompt).toLowerCase();
	return /\b(did i not|didn't i|did i already|already answered|i answered|i just answered|i just said|did i not give|didn't i give|wait[, ]+did|you asked me again|why are you asking)\b/.test(
		text,
	);
}

function isLikelyLearningCheckAnswer(prompt: string) {
	const text = stripVoicePromptPrefix(prompt).toLowerCase();
	if (!text || text.length < 12) return false;
	if (/[?？]\s*$/.test(text) && !/\b(i think|my answer|by saying|what i meant)\b/.test(text)) return false;
	return /\b(i think|i'd say|i would say|my answer|it means|that means|it's saying|it is saying|this says|because|by saying)\b/.test(text);
}

const LEARNING_CHECK_MATCH_STOPWORDS = new Set([
	"about",
	"answer",
	"because",
	"concept",
	"contain",
	"contains",
	"could",
	"does",
	"field",
	"give",
	"help",
	"inside",
	"important",
	"just",
	"mean",
	"means",
	"needed",
	"page",
	"prompt",
	"right",
	"saying",
	"should",
	"that",
	"the",
	"think",
	"this",
	"what",
	"with",
	"would",
]);

function learningCheckMatchTokens(value: unknown) {
	return new Set(
		String(value || "")
			.toLowerCase()
			.match(/[a-z][a-z0-9_'-]{2,}/g)
			?.map((token) => token.replace(/^['-]+|['-]+$/g, ""))
			.filter((token) => token && !LEARNING_CHECK_MATCH_STOPWORDS.has(token)) || [],
	);
}

function learningCheckAnswerMatchesOpenCheck(prompt: string, check: LearnerCheck, state: LearnerState) {
	const answerTokens = learningCheckMatchTokens(prompt);
	if (!answerTokens.size) return true;
	const conceptLabel = getLearnerConceptLabel(state, check.conceptId);
	const checkTokens = learningCheckMatchTokens(`${conceptLabel} ${check.promptText}`);
	for (const token of answerTokens) {
		if (checkTokens.has(token)) return true;
	}
	return false;
}

function buildLearningCheckAcknowledgement(prompt: string, check: LearnerCheck, state: LearnerState) {
	const cleanPrompt = stripVoicePromptPrefix(prompt);
	const conceptLabel = getLearnerConceptLabel(state, check.conceptId);
	const meta = isLearningCheckMetaFollowup(prompt);
	const promptText = truncate(check.promptText, 160);
	if (meta) {
		return [
			"Yes — you did answer it. I should have treated that as your response instead of asking the same check again.",
			`I'll mark this ${check.kind} check on ${conceptLabel} as answered and keep using the existing source anchor for it.`,
		].join("\n\n");
	}
	if (/\bmulti[- ]?head|attention\b/i.test(`${conceptLabel} ${promptText} ${cleanPrompt}`)) {
		return [
			"Yes — that is the right direction.",
			"More precisely: multi-head attention runs several learned attention heads in parallel, so the model can build different weighted token-relationship patterns at the same time. I'll mark that check as answered.",
		].join("\n\n");
	}
	return [
		"Yes — that answers the check well enough to move on.",
		`I'll mark the check as answered. The open prompt was: "${promptText}"`,
	].join("\n\n");
}

function buildLearningCheckFollowup(prompt: string, state: unknown) {
	const learnerState = normalizeLearnerState(state, "learning");
	const check = getLatestOpenLearningCheck(learnerState);
	if (!check) return null;
	const metaFollowup = isLearningCheckMetaFollowup(prompt);
	if (!metaFollowup && !isLikelyLearningCheckAnswer(prompt)) return null;
	if (!metaFollowup && !learningCheckAnswerMatchesOpenCheck(prompt, check, learnerState)) return null;
	const assessment = metaFollowup ? "partial" : "correct";
	return {
		check,
		learnerState,
		assessment,
		reply: buildLearningCheckAcknowledgement(prompt, check, learnerState),
	};
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
		learnerState: createEmptyLearnerState(),
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
	session.learnerState = normalizeLearnerState(session.learnerState);
	return session;
}

function canUseIndexedDb() {
	return typeof indexedDB !== "undefined";
}

function openRuntimeDb(): Promise<any> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(RUNTIME_DB_NAME, RUNTIME_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(ARTIFACT_STORE_NAME)) {
				const store = db.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: "id" });
				store.createIndex("createdAt", "createdAt", { unique: false });
				store.createIndex("sessionId", "sessionId", { unique: false });
			}
			if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
				const store = db.createObjectStore(SESSION_STORE_NAME, { keyPath: "id" });
				store.createIndex("updatedAt", "updatedAt", { unique: false });
			}
		};
		request.onerror = () => reject(request.error || new Error("Could not open Onhand runtime store."));
		request.onsuccess = () => resolve(request.result);
	});
}

async function withRuntimeStore<T>(storeName: string, mode: "readonly" | "readwrite", callback: (store: any) => Promise<T> | T): Promise<T> {
	const db = await openRuntimeDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction(storeName, mode);
			const store = transaction.objectStore(storeName);
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
				if (!settled) reject(transaction.error || new Error("Onhand storage transaction failed."));
			};
		});
	} finally {
		db.close?.();
	}
}

async function withArtifactStore<T>(mode: "readonly" | "readwrite", callback: (store: any) => Promise<T> | T): Promise<T> {
	return await withRuntimeStore(ARTIFACT_STORE_NAME, mode, callback);
}

function requestToPromise<T = any>(request: any): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onerror = () => reject(request.error || new Error("Onhand storage request failed."));
		request.onsuccess = () => resolve(request.result);
	});
}

async function readFallbackSessions(): Promise<Record<string, any>> {
	const stored = await chrome.storage.local.get({ [SESSIONS_FALLBACK_STORAGE_KEY]: {} });
	const sessions = stored[SESSIONS_FALLBACK_STORAGE_KEY];
	return sessions && typeof sessions === "object" ? sessions : {};
}

async function writeFallbackSessions(sessions: Record<string, any>) {
	await chrome.storage.local.set({ [SESSIONS_FALLBACK_STORAGE_KEY]: sessions });
}

async function getAllSessionRecords(): Promise<RuntimeSession[]> {
	if (canUseIndexedDb()) {
		const all = await withRuntimeStore(SESSION_STORE_NAME, "readonly", async (store) => await requestToPromise<RuntimeSession[]>(store.getAll()));
		return Array.isArray(all) ? all : [];
	}
	return Object.values(await readFallbackSessions());
}

async function putSessionRecords(sessions: RuntimeSession[]) {
	const records = (Array.isArray(sessions) ? sessions : []).filter((session) => session && typeof session.id === "string" && session.id);
	if (!records.length) return;
	if (canUseIndexedDb()) {
		await withRuntimeStore(SESSION_STORE_NAME, "readwrite", async (store) => {
			await Promise.all(records.map((session) => requestToPromise(store.put(session))));
		});
		return;
	}
	const stored = await readFallbackSessions();
	for (const session of records) stored[session.id] = session;
	await writeFallbackSessions(stored);
}

async function deleteSessionRecords(sessionIds: string[]) {
	const ids = (Array.isArray(sessionIds) ? sessionIds : []).map((id) => String(id || "").trim()).filter(Boolean);
	if (!ids.length) return;
	if (canUseIndexedDb()) {
		await withRuntimeStore(SESSION_STORE_NAME, "readwrite", async (store) => {
			await Promise.all(ids.map((id) => requestToPromise(store.delete(id))));
		});
		return;
	}
	const stored = await readFallbackSessions();
	for (const id of ids) delete stored[id];
	await writeFallbackSessions(stored);
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

function artifactReplayAnnotations(artifact: BrowserArtifact) {
	const annotations = Array.isArray(artifact.page?.annotations) ? artifact.page.annotations : [];
	return annotations
		.map((annotation, index) => {
			if (!annotation || typeof annotation !== "object") return null;
			const note = annotation.note && typeof annotation.note === "object" ? annotation.note : null;
			return {
				annotationId: String(annotation.annotationId || `artifact-${artifact.id}-${index}`),
				kind: String(annotation.kind || "annotation"),
				matchedText: compactActionText(annotation.matchedText || annotation.text || ""),
				noteText: note ? compactActionText(note.text || "") : "",
				noteLabel: note ? compactActionText(note.label || "Onhand") : "",
				rect: annotation.rect || null,
				noteRect: note?.rect || null,
				container: annotation.container || null,
				...(annotation.pdfAnchor ? { pdfAnchor: annotation.pdfAnchor } : {}),
			};
		})
		.filter(Boolean);
}

function replayArtifactSummary(artifact: BrowserArtifact) {
	const summary = artifactSummary(artifact);
	return {
		...summary,
		id: artifact.id,
		page: {
			title: artifact.page?.title || artifact.tab?.title || "",
			url: artifact.page?.url || artifact.tab?.url || "",
			capturedAt: artifact.page?.capturedAt || null,
			scrollX: typeof artifact.page?.scrollX === "number" ? artifact.page.scrollX : null,
			scrollY: typeof artifact.page?.scrollY === "number" ? artifact.page.scrollY : null,
			viewport: artifact.page?.viewport || null,
			annotationCount: summary.annotationCount,
		},
		tab: artifact.tab || null,
		annotations: artifactReplayAnnotations(artifact),
	};
}

function replayArtifactSnapshot(artifact: BrowserArtifact) {
	return {
		...replayArtifactSummary(artifact),
		screenshotDataUrl: artifact.screenshotDataUrl || "",
		outerHTML: artifact.outerHTML || "",
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
	const urlKey = restorablePageUrlMatchKey(action.url);
	const target = typeof action.tabId === "number"
		? `tab:${action.tabId}`
		: urlKey
			? `url:${urlKey}`
			: compactActionText(action.title)
				? `title:${compactActionText(action.title).toLowerCase()}`
				: "active";
	const normalizedText = compactActionText(text || action.citationText || action.detail).toLowerCase();
	return `text:${target}:${normalizedText}`;
}

function mergeReplayTarget(target: ReplayAnnotation, action: PageAction) {
	if (action.key && !target.actionKeys?.includes(action.key)) {
		target.actionKeys = [...(target.actionKeys || []), action.key];
	}
	if (typeof target.tabId !== "number" && typeof action.tabId === "number") target.tabId = action.tabId;
	if (typeof target.windowId !== "number" && typeof action.windowId === "number") target.windowId = action.windowId;
	if (!target.annotationId && action.annotationId) target.annotationId = action.annotationId;
	if (!target.title && action.title) target.title = action.title;
	if (!target.url && action.url) target.url = action.url;
	if (!target.pdfAnchor && action.pdfAnchor) target.pdfAnchor = action.pdfAnchor;
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
			if (!existing.pdfAnchor && action.pdfAnchor) existing.pdfAnchor = action.pdfAnchor;
			continue;
		}
		const replayAnnotation: ReplayAnnotation = {
			key,
			actionKeys: action.key ? [action.key] : [],
			tabId: typeof action.tabId === "number" ? action.tabId : null,
			windowId: typeof action.windowId === "number" ? action.windowId : null,
			title: action.title,
			url: action.url,
			annotationId: action.annotationId || null,
			matchedText,
		};
		if (action.pdfAnchor) replayAnnotation.pdfAnchor = action.pdfAnchor;
		annotations.set(key, replayAnnotation);
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

function stripReplayCitationMarkers(value: string) {
	return compactActionText(value)
		.replace(/\s*(?:\[\d+(?:\s*,\s*\d+)*\])+\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function addUniqueReplayCandidate(candidates: string[], value: string) {
	const text = stripReplayCitationMarkers(value);
	if (!candidates.includes(text)) candidates.push(text);
}

function replayMathSpacingVariants(value: string) {
	const text = stripReplayCitationMarkers(value);
	if (!text || text.length > 80 || text.split(/\s+/).length > 8) return [];
	if (!/[A-Za-z0-9)\]]\s*[=<>+\-*/]\s*[A-Za-z0-9([]/.test(text)) return [];
	return [
		text.replace(/\s*([=<>+\-*/])\s*/g, " $1 ").replace(/\s+/g, " ").trim(),
		text.replace(/\s*([=<>+\-*/])\s*/g, "$1").replace(/\s+/g, " ").trim(),
	].filter(Boolean);
}

function addReplayExactCandidate(candidates: string[], value: string) {
	const text = stripReplayCitationMarkers(value);
	if (!text) return;
	addUniqueReplayCandidate(candidates, text);
	const withoutTrailingEllipsis = text.replace(/\s*(?:\.{3}|…)\s*$/, "").trim();
	if (withoutTrailingEllipsis && withoutTrailingEllipsis !== text && withoutTrailingEllipsis.length >= 12) {
		addUniqueReplayCandidate(candidates, withoutTrailingEllipsis);
	}
	for (const variant of replayMathSpacingVariants(text)) addUniqueReplayCandidate(candidates, variant);
}

function addReplayHighlightCandidate(candidates: string[], value: string) {
	const text = stripReplayCitationMarkers(value);
	if (text.length < 12) return;
	addReplayExactCandidate(candidates, text);
}

function trimReplayConnector(value: string) {
	return String(value || "")
		.replace(/^(?:but|and|so|however|therefore|then)[,\s]+/i, "")
		.replace(/^(?:that|this|it|which)\s+(?:would|could|can|might|should)\s+(?:give|yield|provide|produce|lead to|result in)\s+(?:us\s+)?/i, "")
		.replace(/^(?:can|could|would|should)\s+we\s+/i, "")
		.trim();
}

function getReplayHighlightCandidates(value: string) {
	const text = compactActionText(value);
	const candidates: string[] = [];
	addReplayHighlightCandidate(candidates, text);
	addReplayHighlightCandidate(candidates, stripReplayCitationMarkers(text));
	for (const part of text.split(/\s*(?:\.{3}|…)\s*/).filter(Boolean)) {
		addReplayHighlightCandidate(candidates, part);
		addReplayHighlightCandidate(candidates, trimReplayConnector(part));
	}
	for (const part of text.split(/(?<=[.!?;:])\s+/).filter(Boolean)) {
		addReplayHighlightCandidate(candidates, part);
		addReplayHighlightCandidate(candidates, trimReplayConnector(part));
	}
	for (const part of stripReplayCitationMarkers(text).split(/\s*(?:\.{3}|…|[.!?;:])\s*/).filter(Boolean)) {
		addReplayHighlightCandidate(candidates, part);
		addReplayHighlightCandidate(candidates, trimReplayConnector(part));
	}
	const words = text.split(/\s+/).filter(Boolean);
	for (const count of [18, 14, 10]) {
		if (words.length > count) {
			addReplayHighlightCandidate(candidates, words.slice(0, count).join(" "));
			addReplayHighlightCandidate(candidates, trimReplayConnector(words.slice(0, count).join(" ")));
			addReplayHighlightCandidate(candidates, words.slice(-count).join(" "));
		}
	}
	for (const count of [8, 6, 5]) {
		if (words.length < count) continue;
		for (let index = 0; index <= words.length - count; index += 1) {
			addReplayHighlightCandidate(candidates, words.slice(index, index + count).join(" "));
		}
	}
	return candidates.slice(0, 18);
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
	const learnerMode = settings.learningMode ? "learning" : "answer";
	return {
		currentSession: session ? buildSessionState(session) : null,
		turns: session?.turns || [],
		learnerState: session ? setLearnerStateMode(session.learnerState, learnerMode) : createEmptyLearnerState(learnerMode),
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

function buildSessionListItem(session: RuntimeSession, currentSessionId: string) {
	const conversation = buildConversationMessages(session.messages);
	const firstUser = conversation.find((message) => message.role === "user");
	const lastUser = [...conversation].reverse().find((message) => message.role === "user");
	const pageActions = collectSessionPageActions(session);
	const artifactCount = Array.isArray(session.artifactIds) ? session.artifactIds.length : 0;
	const replayableCount = buildReplayAnnotationsFromPageActions(pageActions).length;
	const highlightCount = pageActions.filter(
		(action) => action?.type === "annotation" && (String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text"),
	).length;
	const noteCount = pageActions.filter((action) => action?.type === "note").length;
	return {
		path: session.id,
		id: session.id,
		title: session.name || firstUser?.text || "New session",
		name: session.name || null,
		preview: lastUser?.text || firstUser?.text || "No messages yet.",
		messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
		turnCount: Array.isArray(session.turns) ? session.turns.length : 0,
		pageActionCount: pageActions.length,
		artifactCount,
		highlightCount,
		noteCount,
		replayableCount,
		canRestore: artifactCount > 0 || replayableCount > 0,
		modifiedAt: session.updatedAt || session.createdAt || nowIso(),
		createdAt: session.createdAt || null,
		isCurrent: session.id === currentSessionId,
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

function getLearnerConceptLabel(state: LearnerState, conceptId: string) {
	return state.conceptsIntroduced.find((concept) => concept.conceptId === conceptId)?.label || conceptId || "concept";
}

function formatLearnerSourceForPrompt(concept: LearnerConcept) {
	const source = concept.sources[concept.sources.length - 1];
	if (!source) return "";
	const bits = [
		source.annotationId ? `annotationId=${source.annotationId}` : "",
		source.artifactId ? `artifactId=${source.artifactId}` : "",
		source.tabTitle ? `tab="${truncate(source.tabTitle, 60)}"` : "",
		source.url ? `url=${truncate(source.url, 100)}` : "",
	].filter(Boolean);
	return bits.length ? ` [${bits.join(", ")}]` : "";
}

const LEARNER_CONCEPT_MATCH_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"how",
	"in",
	"into",
	"is",
	"it",
	"of",
	"on",
	"or",
	"page",
	"that",
	"the",
	"this",
	"to",
	"what",
	"when",
	"where",
	"why",
	"with",
	"address",
	"addresses",
	"explain",
	"explains",
	"mean",
	"means",
	"work",
	"works",
]);

function normalizeLearnerConceptMatchText(value: unknown) {
	return String(value || "")
		.toLowerCase()
		.replace(/^concept[_-]+/, "")
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeLearnerConceptToken(token: string) {
	if (token === "impracticality") return "impractical";
	if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
	if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
	return token;
}

function tokenizeLearnerConceptMatchText(value: unknown) {
	return normalizeLearnerConceptMatchText(value)
		.split(" ")
		.map(normalizeLearnerConceptToken)
		.filter((token) => token.length >= 3 && !LEARNER_CONCEPT_MATCH_STOPWORDS.has(token));
}

function learnerConceptPhraseMatches(promptText: string, conceptText: string) {
	if (!promptText || !conceptText || conceptText.length < 5) return false;
	return ` ${promptText} `.includes(` ${conceptText} `);
}

function learnerConceptTokensMatch(promptTokens: Set<string>, conceptTokens: string[]) {
	if (!conceptTokens.length) return false;
	if (conceptTokens.length === 1) return conceptTokens[0].length >= 5 && promptTokens.has(conceptTokens[0]);
	return conceptTokens.every((token) => promptTokens.has(token));
}

function isLearnerConceptMentionedInPrompt(concept: LearnerConcept, promptText: string, promptTokens: Set<string>) {
	const labelText = normalizeLearnerConceptMatchText(concept.label);
	const conceptIdText = normalizeLearnerConceptMatchText(concept.conceptId);
	if (learnerConceptPhraseMatches(promptText, labelText) || learnerConceptPhraseMatches(promptText, conceptIdText)) return true;
	return (
		learnerConceptTokensMatch(promptTokens, tokenizeLearnerConceptMatchText(labelText)) ||
		learnerConceptTokensMatch(promptTokens, tokenizeLearnerConceptMatchText(conceptIdText))
	);
}

function findRepeatedLearnerConceptsForPrompt(state: LearnerState, latestPrompt: unknown) {
	const promptText = normalizeLearnerConceptMatchText(latestPrompt);
	if (!promptText) return [];
	const promptTokens = new Set(tokenizeLearnerConceptMatchText(promptText));
	if (!promptTokens.size) return [];
	const matches: LearnerConcept[] = [];
	for (const concept of [...state.conceptsIntroduced].reverse()) {
		if (isLearnerConceptMentionedInPrompt(concept, promptText, promptTokens)) matches.push(concept);
		if (matches.length >= 3) break;
	}
	return matches;
}

function buildLearnerStatePromptSummary(rawState: unknown, latestPrompt = "") {
	const state = normalizeLearnerState(rawState, "learning");
	const lines = ["Current Learning Mode state for this session:"];
	const repeatedConcepts = findRepeatedLearnerConceptsForPrompt(state, latestPrompt);
	if (!state.conceptsIntroduced.length && !state.openChecks.length && !state.responses.length) {
		lines.push("- No concepts or checks have been recorded yet.");
	} else {
		if (state.conceptsIntroduced.length) {
			lines.push("- Concepts already introduced:");
			for (const concept of state.conceptsIntroduced.slice(-6)) {
				lines.push(`  - ${concept.label} (${concept.conceptId}), lastSeenAt=${concept.lastSeenAt}${formatLearnerSourceForPrompt(concept)}`);
			}
		}
		if (state.openChecks.length) {
			lines.push("- Open checks waiting on the user:");
			for (const check of state.openChecks.slice(-4)) {
				const conceptLabel = getLearnerConceptLabel(state, check.conceptId);
				const anchor = check.annotationId ? ` annotationId=${check.annotationId}` : "";
				lines.push(`  - ${check.kind} ${check.checkId} for ${conceptLabel}: "${truncate(check.promptText, 180)}"${anchor}`);
			}
		}
		if (state.responses.length) {
			lines.push("- Recently resolved checks:");
			for (const response of state.responses.slice(-3)) {
				const evidence = response.evidence ? ` - ${truncate(response.evidence, 140)}` : "";
				lines.push(`  - ${response.checkId}: ${response.assessment}${evidence}`);
			}
		}
		if (repeatedConcepts.length) {
			lines.push("- Likely repeated concepts in the user's latest message:");
			for (const concept of repeatedConcepts) {
				lines.push(`  - ${concept.label} (${concept.conceptId})${formatLearnerSourceForPrompt(concept)}`);
			}
			lines.push(
				"- For likely repeated concepts, keep the turn lightweight: start with a brief reminder that it came up earlier, use the existing source anchor when possible, and avoid re-running the full teaching flow.",
				"- Page-work budget for repeated concepts: jump/scroll to the existing anchor if available; if that fails, use at most one fallback read and at most one replacement highlight copied from visible/readable page text, not from your explanation. Do not annotate nearby examples or add notes unless the user explicitly asks for a deeper pass.",
		"- If one of these concepts already has an open check listed above, do not call onhand_record_learning_event with check_opened for it. Point to the existing check instead.",
		"- If there is no open check for the concept, ask one short retrieval/refresher check. Give a full re-explanation only if the user asks directly or seems stuck.",
		"- Do not treat a likely repeated concept as brand-new. When recording learning events for it, reuse the existing conceptId.",
			);
		}
	}
	lines.push(
		"- If the user's latest message answers an open check, resolve that check with onhand_record_learning_event before introducing new material. A reasonable paraphrase with phrases like 'I think...' or 'it is saying...' counts as an answer; do not ask the same check again.",
		"- If the latest message complains that the check was already answered, acknowledge it, resolve the open check as partial/correct based on the prior answer, and do not perform new page annotations.",
		"- For follow-ups on an open check, keep using the existing annotation/source when it supports the answer. Do not replace it with a nearby but different passage.",
		"- Concept hygiene: reuse an existing conceptId for restatements or local details; record a new concept only for a separate future retrieval-check unit.",
	);
	return lines.join("\n");
}

function classifyPromptForReasoning(prompt: string, attachments: any[] = [], learningMode = false): ReasoningProfileName {
	const text = String(prompt || "").toLowerCase();
	const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
	if (hasAttachments) return "deep";

	const asksForToolSmoke =
		/\bbrowser_[a-z_]+\b|\b(port smoke|smoke test|ports?|tools?|debug(?:ging)?|diagnostic|dom|console|network|screenshot|selector|artifact|capture|restore)\b/.test(text);
	const asksForPageAction =
		/\b(highlight|annotate|note|scroll|click|open|navigate|go to|fill|type|select|press|mark|point (?:me )?to|show me where)\b/.test(text);
	const asksForDeepWork =
		/\b(compare|contrast|analy[sz]e|evaluate|argue|evidence|sources?|research|investigate|debug|trace|plan|strategy|detailed|deep|thorough|review|critique|across tabs|multiple tabs|all tabs)\b/.test(
			text,
		);
	const asksForConceptualWork =
		/\b(why|how does|how do|teach|quiz|lesson|step[- ]by[- ]step|walk me through|help me understand)\b/.test(text);
	const asksForFastAnswer =
		/\b(one sentence|briefly|quickly|short answer|tl;?dr|no highlights?|no notes?|according to this page|what is|who is|when did|where is|which|how many|summari[sz]e)\b/.test(
			text,
		);

	if (asksForToolSmoke) return "balanced";
	if (asksForDeepWork) return "deep";
	if (asksForConceptualWork) return "balanced";
	if (asksForPageAction) return "balanced";
	if (learningMode) return "balanced";
	if (asksForFastAnswer) return "fast";
	if (text.length > 260) return "balanced";
	return "fast";
}

function buildReasoningProfile(settings: RuntimeSettings, prompt: string, attachments: any[] = [], learningMode = false): ReasoningProfile {
	const setting: SpeedMode = "auto";
	const mode = classifyPromptForReasoning(prompt, attachments, learningMode);
	const base = {
		setting,
		mode,
		reason: `Internal routing chose ${mode}.`,
	};
	switch (mode) {
		case "deep":
			return {
				...base,
				reasoningEffort: "low",
				textVerbosity: "low",
				maxTokens: ONHAND_DEEP_OUTPUT_TOKENS,
				promptPolicy:
					"Runtime policy: Source-thorough pass. Cover distinct requested key points with page anchors, but cap the first response at four highlights and three notes unless the user explicitly asks for exhaustive annotation. Avoid redundant inspection and unrelated navigation.",
			};
		case "balanced":
			return {
				...base,
				reasoningEffort: "none",
				textVerbosity: "low",
				maxTokens: ONHAND_MAX_OUTPUT_TOKENS,
				promptPolicy:
					"Runtime policy: Focused grounding pass. For ordinary page questions, use one or two highlights and at most one note, then answer briefly. Inspect more only when captured context is insufficient.",
			};
		case "fast":
		default:
			return {
				...base,
				reasoningEffort: "none",
				textVerbosity: "low",
				maxTokens: ONHAND_FAST_OUTPUT_TOKENS,
				promptPolicy:
					"Runtime policy: Quick grounded answer. Prefer captured context; use one short exact highlight when page claims need support, skip notes unless they add local value, and answer in one to three short paragraphs.",
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

function contentBlockIsImage(block: any) {
	return block?.type === "image" || block?.type === "image_url" || block?.type === "input_image";
}

function contentBlockIsText(block: any) {
	return block?.type === "text" && typeof block.text === "string";
}

function messageContainsImage(message: any) {
	const content = message?.content;
	if (Array.isArray(content)) return content.some(contentBlockIsImage);
	return false;
}

function messagesContainImage(messages: any[] = []) {
	return messages.some(messageContainsImage);
}

function contextContainsImage(context: any) {
	const messages = Array.isArray(context?.messages) ? context.messages : [];
	return messagesContainImage(messages);
}

function imageKeyForMessageBlock(messageIndex: number, blockIndex: number) {
	return `${messageIndex}:${blockIndex}`;
}

function collectImageBlockKeysToKeep(messages: any[] = []) {
	const keys = new Set<string>();
	for (let messageIndex = messages.length - 1; messageIndex >= 0 && keys.size < ONHAND_FREE_VISUAL_IMAGE_BLOCK_LIMIT; messageIndex -= 1) {
		const content = messages[messageIndex]?.content;
		if (!Array.isArray(content)) continue;
		for (let blockIndex = content.length - 1; blockIndex >= 0 && keys.size < ONHAND_FREE_VISUAL_IMAGE_BLOCK_LIMIT; blockIndex -= 1) {
			if (contentBlockIsImage(content[blockIndex])) {
				keys.add(imageKeyForMessageBlock(messageIndex, blockIndex));
			}
		}
	}
	return keys;
}

function latestImageMessageIndex(messages: any[] = []) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messageContainsImage(messages[index])) return index;
	}
	return -1;
}

function truncateVisualTextBlock(text: string, message: any, messageIndex: number, latestImageIndex: number) {
	const maxChars =
		messageIndex >= latestImageIndex
			? ONHAND_FREE_VISUAL_RECENT_TEXT_BLOCK_MAX_CHARS
			: message?.role === "toolResult"
				? ONHAND_FREE_VISUAL_OLD_TOOL_TEXT_BLOCK_MAX_CHARS
				: ONHAND_FREE_VISUAL_OLD_TEXT_BLOCK_MAX_CHARS;
	return truncateStructuredText(text, maxChars);
}

function messageTextLength(message: any) {
	const content = message?.content;
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	return content.reduce((total, block) => total + (contentBlockIsText(block) ? block.text.length : 0), 0);
}

function compactMessageForFreeTierVisualRoute(message: any, messageIndex: number, latestImageIndex: number, imageKeysToKeep: Set<string>) {
	const content = message?.content;
	if (typeof content === "string") {
		return {
			...message,
			content: truncateVisualTextBlock(content, message, messageIndex, latestImageIndex),
		};
	}
	if (!Array.isArray(content)) return message;
	const nextContent = content.flatMap((block: any, blockIndex: number) => {
		if (contentBlockIsImage(block)) {
			if (imageKeysToKeep.has(imageKeyForMessageBlock(messageIndex, blockIndex))) return [{ ...block }];
			return [{ type: "text", text: "(older visual capture omitted from compacted Onhand Free image context)" }];
		}
		if (contentBlockIsText(block)) {
			return [{ ...block, text: truncateVisualTextBlock(block.text, message, messageIndex, latestImageIndex) }];
		}
		return [{ ...block }];
	});
	return { ...message, content: nextContent };
}

function trimTextTowardVisualBudget(text: string, totalText: number, minChars: number) {
	if (totalText <= ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS) return { text, totalText };
	const overflow = totalText - ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS;
	const nextLength = Math.max(minChars, text.length - overflow);
	if (nextLength >= text.length) return { text, totalText };
	const nextText = truncateStructuredText(text, nextLength);
	return { text: nextText, totalText: totalText - (text.length - nextText.length) };
}

function enforceFreeTierVisualTextBudget(messages: any[] = [], protectedStartIndex = messages.length) {
	let totalText = messages.reduce((sum, message) => sum + messageTextLength(message), 0);
	if (totalText <= ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS) return messages;
	const compacted = messages.map((message) => ({ ...message, content: Array.isArray(message?.content) ? [...message.content] : message?.content }));
	for (let messageIndex = 0; messageIndex < compacted.length && totalText > ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS; messageIndex += 1) {
		const message = compacted[messageIndex];
		const content = message?.content;
		if (typeof content === "string") {
			const before = content.length;
			const after = truncateStructuredText(content, 900);
			message.content = after;
			totalText -= before - after.length;
			continue;
		}
		if (!Array.isArray(content)) continue;
		message.content = content.map((block: any) => {
			if (!contentBlockIsText(block) || totalText <= ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS) return block;
			const before = block.text.length;
			const after = truncateStructuredText(block.text, 900);
			totalText -= before - after.length;
			return { ...block, text: after };
		});
	}
	for (const minChars of [120, 3]) {
		for (let messageIndex = 0; messageIndex < compacted.length && totalText > ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS; messageIndex += 1) {
			if (minChars === 120 && messageIndex >= protectedStartIndex) continue;
			const message = compacted[messageIndex];
			const content = message?.content;
			if (typeof content === "string") {
				const trimmed = trimTextTowardVisualBudget(content, totalText, minChars);
				message.content = trimmed.text;
				totalText = trimmed.totalText;
				continue;
			}
			if (!Array.isArray(content)) continue;
			message.content = content.map((block: any) => {
				if (!contentBlockIsText(block) || totalText <= ONHAND_FREE_VISUAL_TEXT_BUDGET_CHARS) return block;
				const trimmed = trimTextTowardVisualBudget(block.text, totalText, minChars);
				totalText = trimmed.totalText;
				return { ...block, text: trimmed.text };
			});
		}
	}
	return compacted;
}

function compactFreeTierVisualContextMessages(messages: AgentMessage[] = []) {
	if (!messagesContainImage(messages)) return messages;
	const latestImageIndex = latestImageMessageIndex(messages);
	const imageKeysToKeep = collectImageBlockKeysToKeep(messages);
	const compacted = messages.map((message, messageIndex) =>
		compactMessageForFreeTierVisualRoute(message, messageIndex, latestImageIndex, imageKeysToKeep),
	);
	return enforceFreeTierVisualTextBudget(compacted, latestImageIndex) as AgentMessage[];
}

async function transformFreeTierContextForModel(model: any, messages: AgentMessage[]) {
	if (model?.provider !== ONHAND_FREE_PROVIDER) return messages;
	return compactFreeTierVisualContextMessages(messages);
}

function imageAttachmentFromDataUrl(dataUrl: unknown, name = "visible-region.png") {
	const text = String(dataUrl || "").trim();
	const match = text.match(/^data:([^;,]+);base64,(.+)$/s);
	if (!match) return null;
	return {
		kind: "image",
		name,
		data: match[2],
		mimeType: match[1] || "image/png",
	};
}

function buildVisualRegionPromptImages(visualRegion: unknown) {
	const region = visualRegion && typeof visualRegion === "object" ? (visualRegion as any) : null;
	const label = compactInternalText(region?.label || "visible region", 60).replace(/[^a-z0-9._-]+/gi, "-") || "visible-region";
	const attachment = imageAttachmentFromDataUrl(region?.dataUrl, `${label}.png`);
	return attachment ? buildPromptImages([attachment]) : [];
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

function pickActiveTab(state: any, targetWindowId?: number | null) {
	const tabs = flattenTabs(state);
	if (typeof targetWindowId === "number") {
		const targetWindowTab = tabs.find((tab: any) => tab.active && tab.windowId === targetWindowId);
		if (targetWindowTab) return targetWindowTab;
	}
	return tabs.find((tab: any) => tab.active && tab.windowFocused) || tabs.find((tab: any) => tab.active) || tabs[0] || null;
}

function isPrivilegedUrl(url: unknown) {
	return /^(?:chrome|edge|brave|about):\/\//i.test(String(url || ""));
}

function isOnhandPdfViewerUrl(url: unknown) {
	try {
		const parsed = new URL(String(url || ""));
		if (parsed.protocol === "chrome-extension:" && /\/pdf-viewer\.html$/i.test(parsed.pathname)) return true;
		return /\/onhand-pdf-viewer\.html$/i.test(parsed.pathname);
	} catch {
		return false;
	}
}

// The raw PDF url embedded in an Onhand viewer url. Artifacts saved while a
// PDF was open in the viewer can carry a `chrome-extension://<id>/
// pdf-viewer.html?url=<pdf>` page url; if that id is stale or from another
// install, restoring against it fails with "Cannot access a chrome-extension
// URL of different extension". Resolving back to the source pdf url lets the
// artifact restore against the live document instead.
function onhandPdfViewerSourceUrl(value: unknown): string {
	try {
		const parsed = new URL(String(value || ""));
		if (!isOnhandPdfViewerUrl(parsed.href)) return "";
		const source = parsed.searchParams.get("url") || parsed.searchParams.get("file") || "";
		if (!source) return "";
		const decoded = decodeURIComponent(source);
		return /^https?:\/\//i.test(decoded) ? decoded : "";
	} catch {
		return "";
	}
}

function onhandPdfViewerOpenUrl(sourceUrl: string, previousViewerUrl = "") {
	const source = String(sourceUrl || "").trim();
	if (!/^https?:\/\//i.test(source)) return previousViewerUrl || source;
	try {
		const viewerUrl = new URL(chrome.runtime.getURL("pdf-viewer.html"));
		viewerUrl.searchParams.set("url", source);
		try {
			const previous = new URL(String(previousViewerUrl || ""));
			if (isOnhandPdfViewerUrl(previous.href)) {
				for (const key of ["page", "scrollRatio"]) {
					const value = previous.searchParams.get(key);
					if (value) viewerUrl.searchParams.set(key, value);
				}
			}
		} catch {}
		return viewerUrl.href;
	} catch {
		return previousViewerUrl || source;
	}
}

function isGoogleDocsPdfExportUrl(value: unknown) {
	try {
		const parsed = new URL(String(value || ""));
		if (!/(^|\.)docs\.google\.com$/i.test(parsed.hostname)) return false;
		if (!/\/document\/d\/[^/]+\/export\/?$/i.test(parsed.pathname)) return false;
		return String(parsed.searchParams.get("format") || "").toLowerCase() === "pdf";
	} catch {
		return false;
	}
}

function artifactSavedUrl(artifact: BrowserArtifact | null | undefined): string {
	return String(artifact?.page?.url || artifact?.tab?.url || "").trim();
}

function artifactEffectiveUrl(artifact: BrowserArtifact | null | undefined): string {
	const raw = artifactSavedUrl(artifact);
	return onhandPdfViewerSourceUrl(raw) || raw;
}

function artifactOpenUrl(artifact: BrowserArtifact | null | undefined): string {
	const raw = artifactSavedUrl(artifact);
	const sourceUrl = onhandPdfViewerSourceUrl(raw);
	if (sourceUrl) return onhandPdfViewerOpenUrl(sourceUrl, raw);
	if (isGoogleDocsPdfExportUrl(raw)) return onhandPdfViewerOpenUrl(raw);
	return raw;
}

function isLikelyPdfUrlForAutoHandoff(url: unknown) {
	try {
		const parsed = new URL(String(url || ""));
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		const path = decodeURIComponent(parsed.pathname || "").toLowerCase();
		const search = decodeURIComponent(parsed.search || "").toLowerCase();
		return (
			path.endsWith(".pdf") ||
			path.includes(".pdf/") ||
			path.includes("/pdf/") ||
			path.endsWith("/pdf") ||
			search.includes(".pdf") ||
			search.includes("format=pdf") ||
			search.includes("contenttype=pdf") ||
			search.includes("content-type=application/pdf")
		);
	} catch {
		return false;
	}
}

function shouldAutoOpenPdfViewerForTab(tab: any) {
	if (typeof tab?.id !== "number") return false;
	const url = String(tab?.url || "");
	return Boolean(url && !isPrivilegedUrl(url) && !isOnhandPdfViewerUrl(url) && isLikelyPdfUrlForAutoHandoff(url));
}

function isOnhandPdfViewerAccessError(error: unknown) {
	const message = String((error as any)?.message || error || "");
	if (/Cannot access contents of url/i.test(message) && /chrome-extension:\/\/[^"'\s]+\/pdf-viewer\.html/i.test(message)) return true;
	// Non-essential restore steps (scroll position) that script a PDF tab whose
	// main frame is the browser's native viewer (a different extension) throw
	// this. The annotations still restore, so it must not count as a failure.
	return /Cannot access a chrome-extension:\/\/ URL of different extension/i.test(message);
}

function isRestorablePageUrl(url: unknown) {
	try {
		const protocol = new URL(normalizeRestorablePageUrl(url)).protocol;
		return protocol === "http:" || protocol === "https:" || protocol === "file:" || isOnhandPdfViewerUrl(url);
	} catch {
		return false;
	}
}

function isRestorablePageTab(tab: any) {
	return typeof tab?.id === "number" && isRestorablePageUrl(tab.url);
}

function normalizeRestorablePageUrl(url: unknown) {
	const raw = String(url || "").trim();
	if (!raw) return "";
	return raw.startsWith("/") && !raw.startsWith("//") ? `file://${raw}` : raw;
}

function restorablePageUrlMatchKey(url: unknown) {
	const normalized = normalizeRestorablePageUrl(url);
	if (!normalized) return "";
	const viewerSource = onhandPdfViewerSourceUrl(normalized);
	const matchUrl = viewerSource || normalized;
	try {
		const parsed = new URL(matchUrl);
		parsed.hash = "";
		return parsed.href;
	} catch {
		return matchUrl.split("#")[0];
	}
}

function restorablePageUrlsMatch(left: unknown, right: unknown) {
	const leftKey = restorablePageUrlMatchKey(left);
	const rightKey = restorablePageUrlMatchKey(right);
	return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function tabMatchesSavedTarget(tab: any, url: string, title: string) {
	if (!isRestorablePageTab(tab)) return false;
	const tabTitle = String(tab.title || "").trim().toLowerCase();
	if (String(url || "").trim()) return restorablePageUrlsMatch(tab.url, url);
	return Boolean(title && tabTitle === title);
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

function extractReadableContentText(extracted: any) {
	const content = extracted?.content || extracted?.extracted || extracted || {};
	if (typeof content === "string") return content.trim();
	if (content && typeof content === "object") return String(content.markdown || content.text || "").trim();
	return String(content || "").trim();
}

async function renderBrowserContextDetails(
	host: RuntimeHost,
	options: { targetWindowId?: number; includeReadableContent?: boolean; readableMaxChars?: number; includeVisualRegionImage?: boolean } = {},
) {
	try {
		const state = await host.snapshotState();
		const activeTab = pickActiveTab(state, options.targetWindowId);
		const openTabs = summarizeOpenTabs(state, activeTab);
		let selection = null;
		let visible = null;
		let extracted = null;
		let visualRegion = null;
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
			if (options.includeReadableContent) {
				try {
					extracted = await host.runCommand("extract_content", {
						tabId: activeTab.id,
						maxChars: options.readableMaxChars || REALTIME_READABLE_CONTEXT_MAX_CHARS,
					});
				} catch (error: any) {
					warning ||= error?.message || String(error);
				}
			}
			if (options.includeVisualRegionImage) {
				try {
					visualRegion = await host.runCommand("get_visible_region_image", {
						tabId: activeTab.id,
						label: "current visible region",
						format: "png",
					});
				} catch (error: any) {
					warning ||= error?.message || String(error);
				}
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
		const selectionSourceLabel = getSelectionSourceLabel(selection?.selection);
		if (selectionText) {
			lines.push(`Selected text${selectionSourceLabel ? ` (${selectionSourceLabel})` : ""}: ${JSON.stringify(truncate(selectionText, 800))}`);
		}
		const visibleText = formatVisibleTextForModel(visible?.visible || visible, BROWSER_CONTEXT_MAX_CHARS);
		if (visibleText) {
			lines.push("Visible text snapshot:");
			lines.push(visibleText);
		}
		const readableText = extractReadableContentText(extracted);
		if (options.includeReadableContent && readableText) {
			lines.push("Readable page excerpt:");
			lines.push(truncateStructuredText(readableText, REALTIME_ANCHOR_CONTEXT_MAX_CHARS));
		}
		if (visualRegion?.region) {
			const region = visualRegion.region;
			const viewport = visualRegion.viewport || {};
			lines.push(
				`Visible region image captured: ${visualRegion.label || "current visible region"} (${region.width}x${region.height} CSS px at ${region.x},${region.y}; viewport ${viewport.width || "?"}x${viewport.height || "?"}; method ${visualRegion.method || "unknown"}).`,
			);
			lines.push(
				"Use the attached visible-region image only for visual questions. Anchor visual claims to this captured region and to exact page text when available; if neither is enough, say what visual context is missing.",
			);
		}
		if (warning) lines.push(`Warning: ${warning}`);
		return {
			text: lines.join("\n") || "Browser context was unavailable.",
			activeTab,
			selection: selection?.selection || null,
			visible: visible?.visible || visible || null,
			extracted: extracted?.content || extracted?.extracted || extracted || null,
			visualRegion,
			warning,
		};
	} catch (error: any) {
		return {
			text: `Browser context was unavailable.\nReason: ${error?.message || String(error)}`,
			activeTab: null,
			selection: null,
			visible: null,
			extracted: null,
			visualRegion: null,
			warning: error?.message || String(error),
		};
	}
}

async function renderBrowserContext(host: RuntimeHost, options: { targetWindowId?: number } = {}) {
	return (await renderBrowserContextDetails(host, options)).text;
}

function promptAsksAboutVisualRegion(prompt: unknown) {
	return /\b(image|figure|diagram|chart|plot|graph|equation|formula|math|visual|screenshot|picture|table|axis|axes|curve|arrow|box|region|shown|see here|look at)\b/i.test(
		String(prompt || ""),
	);
}

function browserContextHasUsableText(details: any) {
	const selectionText = getSelectionText(details?.selection);
	const visibleText = formatVisibleTextForModel(details?.visible, 1200);
	const readableText = extractReadableContentText(details?.extracted);
	return Boolean(selectionText || visibleText || readableText);
}

function shouldCaptureVisualRegionForPrompt(prompt: unknown, details?: any) {
	if (promptAsksAboutVisualRegion(prompt)) return true;
	if (details && !browserContextHasUsableText(details)) return true;
	return false;
}

async function runRealtimePdfHandoffIfNeeded(host: RuntimeHost, targetWindowId?: number) {
	let activeTab = null;
	try {
		const state = await host.snapshotState();
		activeTab = pickActiveTab(state, targetWindowId);
	} catch (error) {
		host.log?.("realtime PDF handoff snapshot failed", error);
		return null;
	}
	if (!shouldAutoOpenPdfViewerForTab(activeTab)) return null;
	try {
		return await host.runCommand(
			"open_pdf_in_onhand_viewer",
			withTargetWindowId(
				{
					active: true,
					newTab: false,
					waitForLoad: true,
					timeoutMs: 20000,
				},
				targetWindowId,
			),
		);
	} catch (error) {
		host.log?.("realtime PDF handoff failed", error);
		return null;
	}
}

function textHasAny(text: string, pattern: RegExp) {
	pattern.lastIndex = 0;
	return pattern.test(text);
}

function parseExplicitPdfHandoffParams(prompt: string) {
	const text = String(prompt || "");
	if (!/\bbrowser_open_pdf_in_onhand_viewer\b/.test(text)) return null;
	const urlMatch =
		text.match(/\bpdfUrl\s*[:=]?\s*["'`]?(https?:\/\/[^\s"'`)]+)/i) ||
		text.match(/\burl\s*[:=]?\s*["'`]?(https?:\/\/[^\s"'`)]+)/i);
	const params: Record<string, unknown> = {};
	if (urlMatch?.[1]) {
		params.pdfUrl = urlMatch[1].replace(/[),.;]+$/g, "");
	}
	return params;
}

function withTargetWindowId(params: Record<string, unknown> = {}, targetWindowId?: number) {
	if (typeof targetWindowId !== "number" || !Number.isFinite(targetWindowId)) return params;
	if (typeof params.tabId === "number") return params;
	return {
		...params,
		windowId: targetWindowId,
	};
}

function browserContextLooksLikePdf(details: any) {
	const activeUrl = String(details?.activeTab?.url || "");
	const visible = details?.visible || {};
	const selection = details?.selection || {};
	const blocks = Array.isArray(visible?.blocks) ? visible.blocks : [];
	return Boolean(
		isOnhandPdfViewerUrl(activeUrl) ||
			isLikelyPdfUrlForAutoHandoff(activeUrl) ||
			visible?.surface === "pdf" ||
			selection?.surface === "pdf" ||
			blocks.some((block: any) => block?.tag === "pdf-page" || block?.surface === "pdf"),
	);
}

function selectToolsForPrompt(
	allTools: AgentTool[],
	prompt: string,
	_attachments: any[] = [],
	learningMode = false,
	learnerState: unknown = null,
	options: { forcePdfTools?: boolean; advancedRuntimeInspectionEnabled?: boolean } = {},
) {
	const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));
	const selected = new Set<string>();
	const text = String(prompt || "").toLowerCase();
	const explicitToolNames = new Set(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN) || []);
	const runtimeInspectionEnabled = options.advancedRuntimeInspectionEnabled !== false;
	const wantsAllPorts = /\ball (?:browser )?(?:ports|tools)\b|\bport smoke\b|\bsmoke test\b/.test(text);
	const repeatedConcepts = learningMode ? findRepeatedLearnerConceptsForPrompt(normalizeLearnerState(learnerState, "learning"), prompt) : [];
	const selectableToolNames = allTools
		.map((tool) => tool.name)
		.filter((toolName) => runtimeInspectionEnabled || !RUNTIME_JS_TOOL_NAMES.includes(toolName))
		.filter((toolName) => learningMode || !LEARNING_TOOL_NAMES.includes(toolName));

	const add = (names: string[]) => {
		for (const name of names) {
			if (!runtimeInspectionEnabled && RUNTIME_JS_TOOL_NAMES.includes(name)) continue;
			if (toolsByName.has(name)) selected.add(name);
		}
	};

	if (wantsAllPorts) {
		add(selectableToolNames);
	} else {
		add(CORE_READ_TOOL_NAMES);
		add(VISUAL_GROUNDING_TOOL_NAMES);
		add([...explicitToolNames]);

		const wantsExternalBrowsing = promptAsksForExternalBrowsing(text);
		const wantsLinkedPageNavigation = promptAsksForLinkedPageNavigation(text);
		const crossTabComparisonVerb = textHasAny(text, /\b(compare|comparison|contrast|versus|vs\.?|differ|difference|agree|disagree|relate)\b/);
		const explicitCrossTabComparisonTarget = textHasAny(
			text,
			/\b(?:other|another|both|two|2|multiple|several|all|across|open) (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b|\b(?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?) (?:i have |that are |currently )?open\b|\bthese (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b|\b(?:across|between) (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b/,
		);
		if (
			wantsExternalBrowsing ||
			wantsLinkedPageNavigation ||
			textHasAny(text, /\b(tab|tabs|window|windows|activate|switch|open|navigate|go to|take me to|url|across tabs|multiple tabs|all tabs)\b/) ||
			(crossTabComparisonVerb && explicitCrossTabComparisonTarget)
		) {
			add(TAB_TOOL_NAMES);
		}
		if (
			options.forcePdfTools ||
			textHasAny(
				text,
				/\bpdfs?\b|\bpdf viewer\b|\bnative pdf\b|\bunsupported_pdf_surface\b|\bslides?\b|\bslide deck\b|\blecture deck\b|\bpage\s+\d+\b|\bread through\b|\bfind\b|\blocating?\b|\bwhere\b/,
			) ||
			textHasAny(text, /\breferences?\b|\bcitations?\b|\bcited\b|\bbibliography\b|\[\d{1,3}\]/)
		) {
			add(["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES]);
		}
		if (promptAsksAboutVisualRegion(text)) {
			add(VISUAL_CONTEXT_TOOL_NAMES);
		}
		if (learningMode) {
			add(LEARNING_TOOL_NAMES);
		}
		if (wantsExternalBrowsing || wantsLinkedPageNavigation || textHasAny(text, /\b(click|type|fill|field|button|selector|form|press|pick|choose|wait for|input)\b/)) {
			add(INTERACTION_TOOL_NAMES);
		}
		if (textHasAny(text, /\b(debug|console|network|dom|html|screenshot|javascript|js|run code|evaluate)\b/)) {
			add(DEBUG_INSPECTION_TOOL_NAMES);
		}
		if (runtimeInspectionEnabled && promptNeedsRuntimeJavaScript(text, explicitToolNames)) {
			add(RUNTIME_JS_TOOL_NAMES);
		}
		if (textHasAny(text, /\b(artifact|capture state|save state|restore|session replay|saved page|list artifacts?)\b/)) {
			add(ARTIFACT_TOOL_NAMES);
		}
		if (explicitToolNames.has("browser_show_note")) add(["browser_highlight_text"]);
		if (explicitToolNames.has("browser_restore_state")) add(["browser_list_artifacts"]);
	}

	if (!selected.size) add(CORE_READ_TOOL_NAMES);
	if (repeatedConcepts.length && !wantsAllPorts) {
		for (const name of ["browser_extract_content", "browser_show_note"]) {
			if (!explicitToolNames.has(name)) selected.delete(name);
		}
	}
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
	learnerState: LearnerState | null = null,
) {
	const attachmentContext = buildAttachmentContext(attachments);
	const toolInventory = buildToolInventory(prompt, tools);
	const learnerStateSummary = learningMode ? buildLearnerStatePromptSummary(learnerState, prompt) : "";
	return [
		"The user invoked Onhand from the browser extension side panel.",
		...(recentConversation ? ["", "Recent conversation, summarized:", recentConversation] : []),
		...(learnerStateSummary ? ["", learnerStateSummary] : []),
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
		"Use this captured context as your starting point. Prefer current and already-open pages over navigation.",
		"Constitution runtime contract:",
		"- Do page work before chat. Highlight, note only when useful, and scroll the first anchor before giving the synthesis.",
		"- Page-material claims need anchors. Use exact highlights and short notes for the major claims unless the user explicitly asked for no page changes.",
		"- External-source requests are navigation tasks. If the user asks to search online, use Google/web sources, open URLs, or take them to sources, use tab/navigation tools first and then anchor claims on the destination source pages.",
		"- Linked-note/resource requests are navigation tasks. If the user asks to open, check, or inspect notes, readings, links, resources, papers, or pages listed on the current page or a page used earlier in the session, recover an already-open index/master tab with browser_list_tabs when needed, then use browser_activate_tab, browser_find_elements, browser_click_text/browser_click, or browser_navigate to open the relevant linked pages before answering. Anchor the useful passages on those destination pages, not just the index/master page.",
		"- Grounding budget: simple questions get one strong highlight and at most one note, then an answer. Do not annotate nearby examples just because they are related. Roadmap/list/navigation questions are not simple when the answer names multiple items.",
		"- Notes are not mini-summaries. Add one only when it explains how to read the highlighted passage or leaves useful marginalia for replay.",
		"- Failed highlight attempts are not anchors. Retry with a smaller exact visible span, or leave that claim out of the answer.",
		"- If the captured context already includes the needed text, use it to choose a short exact highlight and avoid extra read tools.",
		"- Source-thorough path: if the question has distinct subclaims or asks for support/evidence, anchor each key point, but keep the answer concise.",
		"- Roadmap/list/navigation answers need the actual supporting list or linked items, not a heading-only anchor. Every named step/item in chat needs a matching anchor, or it should be omitted/qualified as unanchored.",
		"- For list-shaped visible/readable text, highlight the exact item words one item at a time. Treat Markdown bullets and heading markers in tool output as structure cues, not part of the page text to quote.",
		"- If a page-wide list appears partial in the visible snapshot, use browser_extract_content once before answering. Do not substitute nearby headings for missing list items.",
		"- Do not call browser_extract_content more than once unless the first result is unusable.",
		"- For equations, charts, diagrams, figures, screenshots, or weak text extraction, use browser_get_visible_region_image to inspect the visible region. Visual claims must name the captured region and still use exact text highlights when text anchors are available.",
		"- If a visual answer cannot be anchored to text or a captured visible region, say what visual context is missing instead of guessing.",
		"- If no reliable anchor is available, say what is missing instead of presenting unsupported page claims.",
		"- browser_run_js is a last-resort runtime-state escape hatch for complex client-side pages. Use it only when explicitly requested or when readable text, DOM, screenshot, console, network, and selector tools cannot answer a dynamic/hidden-state question.",
		"- Keep browser_run_js read-only unless the user explicitly asks for page interaction. Do not use it to inspect cookies, local/session storage, authentication material, secrets, payment fields, or unrelated page data.",
		...(toolInventory ? ["", "Available browser tools for this request:", toolInventory] : []),
		"Use markdown emphasis sparingly and only for short phrases that really matter.",
		...(learningMode ? ["", ONHAND_LEARNING_MODE_APPEND] : []),
	].join("\n");
}

function extractJsonObjectText(value: unknown) {
	const text = String(value || "").trim();
	if (!text) return "";
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = (fenced ? fenced[1] : text).trim();
	const first = candidate.indexOf("{");
	const last = candidate.lastIndexOf("}");
	if (first < 0 || last <= first) return "";
	return candidate.slice(first, last + 1);
}

function parseJsonObject(value: unknown) {
	const jsonText = extractJsonObjectText(value);
	if (!jsonText) return {};
	try {
		const parsed = JSON.parse(jsonText);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function compactInternalText(value: unknown, maxLength = 240) {
	return truncate(String(value || "").replace(/\s+/g, " ").trim(), maxLength);
}

function firstSentenceLike(value: unknown, maxLength = 220) {
	const text = compactInternalText(value, maxLength);
	if (!text) return "";
	const match = text.match(/^(.+?[.!?])(?:\s|$)/);
	return compactInternalText(match ? match[1] : text, maxLength);
}

type PlannerAnchorCandidate = {
	text: string;
	source: "selection" | "page_match" | "visible";
	score: number;
};

function normalizePlannerAnchorCandidateText(value: unknown) {
	return String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/^\s*\[[^\]]{1,40}\]\s*/u, "")
		.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
		.replace(/^\s{0,3}#{1,6}\s+/u, "")
		.replace(/\s+/g, " ")
		.trim();
}

function splitPlannerAnchorText(value: unknown) {
	const text = String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!text) return [];
	const candidates: string[] = [];
	const addCandidate = (candidate: unknown) => {
		const normalized = normalizePlannerAnchorCandidateText(candidate);
		if (normalized.length < 24 || normalized.length > 320) return;
		if (/^(active tab|open tabs|visible text snapshot|readable page excerpt|warning):/i.test(normalized)) return;
		if (!candidates.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized);
	};
	for (const block of text.split(/\n+/)) {
		const normalizedBlock = normalizePlannerAnchorCandidateText(block);
		if (!normalizedBlock) continue;
		if (normalizedBlock.length <= 320) {
			addCandidate(normalizedBlock);
			continue;
		}
		for (const sentence of normalizedBlock.split(/(?<=[.!?])\s+/u)) addCandidate(sentence);
	}
	return candidates;
}

function questionTokenPhrases(userQuestion: string) {
	const tokens = tokenizeLearnerConceptMatchText(userQuestion);
	const phrases = new Set<string>();
	for (let size = Math.min(5, tokens.length); size >= 2; size--) {
		for (let index = 0; index + size <= tokens.length; index++) {
			phrases.add(tokens.slice(index, index + size).join(" "));
		}
	}
	return phrases;
}

function scorePlannerAnchorText(text: string, userQuestion: string, source: PlannerAnchorCandidate["source"] = "page_match") {
	const promptTokens = new Set(tokenizeLearnerConceptMatchText(userQuestion));
	if (!promptTokens.size) return source === "selection" ? 100 : 0;
	const normalizedText = normalizeLearnerConceptMatchText(text);
	const tokens = tokenizeLearnerConceptMatchText(text);
	const overlap = new Set(tokens.filter((token) => promptTokens.has(token))).size;
	let score = overlap * 4;
	for (const phrase of questionTokenPhrases(userQuestion)) {
		if (normalizedText.includes(phrase)) score += Math.min(20, phrase.split(" ").length * 5);
	}
	if (source === "selection") score += 100;
	if (source === "visible") score -= 1;
	return score;
}

function buildPlannerAnchorCandidates(input: {
	userQuestion: string;
	selection?: unknown;
	visible?: unknown;
	extracted?: unknown;
	browserContext?: string;
}) {
	const candidates: PlannerAnchorCandidate[] = [];
	const addCandidate = (text: unknown, source: PlannerAnchorCandidate["source"]) => {
		const normalized = firstSentenceLike(normalizePlannerAnchorCandidateText(text), 260);
		if (!normalized) return;
		const score = scorePlannerAnchorText(normalized, input.userQuestion, source);
		if (source !== "selection" && score < 4) return;
		const existing = candidates.find((candidate) => candidate.text.toLowerCase() === normalized.toLowerCase());
		if (existing) {
			existing.score = Math.max(existing.score, score);
			if (existing.source !== "selection" && source === "selection") existing.source = source;
			return;
		}
		candidates.push({ text: normalized, source, score });
	};
	const selectionText = getSelectionText(input.selection);
	if (selectionText) addCandidate(selectionText, "selection");

	const readableText = extractReadableContentText(input.extracted);
	for (const candidate of splitPlannerAnchorText(readableText)) addCandidate(candidate, "page_match");

	const visibleText = formatVisibleTextForModel(input.visible, BROWSER_CONTEXT_MAX_CHARS);
	for (const candidate of splitPlannerAnchorText(visibleText)) addCandidate(candidate, "visible");

	if (!candidates.length && input.browserContext) {
		for (const candidate of splitPlannerAnchorText(input.browserContext)) addCandidate(candidate, "page_match");
	}

	return candidates.sort((left, right) => right.score - left.score || left.text.length - right.text.length).slice(0, 5);
}

function formatPlannerAnchorCandidatesForPrompt(candidates: PlannerAnchorCandidate[]) {
	if (!candidates.length) return "";
	return candidates
		.map((candidate, index) => `${index + 1}. (${candidate.source}) ${candidate.text}`)
		.join("\n");
}

function choosePlannerAnchorText(rawAnchorText: string, fallback: { userQuestion: string; browserContext: string; anchorCandidates?: PlannerAnchorCandidate[] }) {
	const candidates = Array.isArray(fallback.anchorCandidates) ? fallback.anchorCandidates : [];
	const bestCandidate = candidates[0];
	if (!bestCandidate) return rawAnchorText || pickPlannerFallbackAnchor(fallback.browserContext, fallback.userQuestion) || compactInternalText(fallback.userQuestion, 180);
	if (!rawAnchorText) return bestCandidate.text;

	const rawAnchor = compactInternalText(rawAnchorText, 260);
	const rawLower = rawAnchor.toLowerCase();
	for (const candidate of candidates) {
		const candidateLower = candidate.text.toLowerCase();
		if (rawLower.includes(candidateLower) || candidateLower.includes(rawLower)) {
			if (candidate.score + 4 >= bestCandidate.score) return rawAnchor;
			break;
		}
	}

	const rawScore = scorePlannerAnchorText(rawAnchor, fallback.userQuestion, "page_match");
	if (bestCandidate.score >= 8 && rawScore + 4 < bestCandidate.score) return bestCandidate.text;
	return rawAnchor;
}

function pickPlannerFallbackAnchor(browserContext: string, userQuestion: string, anchorCandidates: PlannerAnchorCandidate[] = []) {
	if (anchorCandidates.length) return anchorCandidates[0].text;
	const lines = String(browserContext || "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length >= 24 && !/^[-*]?\s*(tab|url|title|visible|selection|captured|browser context)/i.test(line));
	const promptTokens = new Set(tokenizeLearnerConceptMatchText(userQuestion));
	const scored = lines
		.map((line) => {
			const tokens = tokenizeLearnerConceptMatchText(line);
			const overlap = tokens.filter((token) => promptTokens.has(token)).length;
			return { line, score: overlap };
		})
		.sort((left, right) => right.score - left.score);
	return firstSentenceLike(scored[0]?.line || lines[0] || "", 220);
}

function normalizePlannerMove(rawValue: unknown, fallback: { userQuestion: string; browserContext: string; anchorCandidates?: PlannerAnchorCandidate[] }) {
	const raw = parseJsonObject(rawValue) as any;
	const rawAnchor = raw.anchor && typeof raw.anchor === "object" ? raw.anchor : {};
	const rawAnchorText = compactInternalText(rawAnchor.text_excerpt || rawAnchor.text || raw.text_excerpt, 260);
	const anchorText = choosePlannerAnchorText(rawAnchorText, fallback);
	const voiceScript =
		compactInternalText(raw.voice_script || raw.question || raw.prompt, 220) ||
		`Looking at the highlighted line, what do you think it is saying in your own words?`;
	const expectedConcepts = Array.isArray(raw.expected_concepts)
		? raw.expected_concepts.map((entry: unknown) => compactInternalText(entry, 80)).filter(Boolean).slice(0, 4)
		: [];
	return {
		anchor: {
			text_excerpt: anchorText,
			kind: compactInternalText(rawAnchor.kind || "question_anchor", 40) || "question_anchor",
			note: compactInternalText(rawAnchor.note || raw.note || "Key evidence for this question.", 80),
		},
		move_type: compactInternalText(raw.move_type || "prediction_prompt", 40) || "prediction_prompt",
		voice_script: voiceScript,
		sidebar_markdown:
			compactInternalText(raw.sidebar_markdown || `**Your turn:** ${voiceScript}`, 360) || `**Your turn:** ${voiceScript}`,
		expected_concepts: expectedConcepts.length ? expectedConcepts : ["Page concept"],
		stuck_fallback:
			compactInternalText(raw.stuck_fallback || "Focus on the highlighted wording and say what relation it describes.", 180) ||
			"Focus on the highlighted wording.",
		misconceptions: Array.isArray(raw.misconceptions)
			? raw.misconceptions
					.map((entry: any) => ({
						wrong_idea: compactInternalText(entry?.wrong_idea, 120),
						nudge: compactInternalText(entry?.nudge, 180),
					}))
					.filter((entry: any) => entry.wrong_idea || entry.nudge)
					.slice(0, 3)
			: [],
	};
}

function normalizeEvaluatorMove(rawValue: unknown, fallback: { userResponse: string; previousMove: any }) {
	const raw = parseJsonObject(rawValue) as any;
	const previousVoice = compactInternalText(fallback.previousMove?.voice_script || fallback.previousMove?.question, 180);
	const correctPoints = Array.isArray(raw.correct_points)
		? raw.correct_points
				.map((entry: any) => ({
					concept: compactInternalText(entry?.concept || entry, 100),
					anchor_text: compactInternalText(entry?.anchor_text, 180),
				}))
				.filter((entry: any) => entry.concept || entry.anchor_text)
				.slice(0, 3)
		: [];
	const missedPoints = Array.isArray(raw.missed_points)
		? raw.missed_points
				.map((entry: any) => ({
					concept: compactInternalText(entry?.concept || entry, 100),
					anchor_text: compactInternalText(entry?.anchor_text, 180),
					nudge: compactInternalText(entry?.nudge, 180),
				}))
				.filter((entry: any) => entry.concept || entry.anchor_text || entry.nudge)
				.slice(0, 3)
		: [];
	const nextMove = ["nudge", "deeper", "move_on", "direct_answer_escape"].includes(raw.next_move) ? raw.next_move : "move_on";
	const feedback =
		compactInternalText(raw.feedback_summary || raw.voice_script || raw.sidebar_markdown, 220) ||
		(previousVoice
			? "Good start — that answers the check. I'll mark it and move on."
			: "Good start — that answers the check.");
	return {
		correct_points: correctPoints,
		missed_points: missedPoints,
		next_move: nextMove,
		feedback_summary: feedback,
		voice_script: compactInternalText(raw.voice_script || feedback, 220) || feedback,
		sidebar_markdown: compactInternalText(raw.sidebar_markdown || feedback, 420) || feedback,
		assessment: compactInternalText(raw.assessment || (missedPoints.length ? "partial" : "correct"), 24) || "partial",
		evidence: compactInternalText(raw.evidence || fallback.userResponse, 260),
	};
}

function buildRealtimePlannerPrompt(options: {
	userQuestion: string;
	browserContext: string;
	anchorCandidates?: PlannerAnchorCandidate[];
	recentConversation: string;
	learnerState: LearnerState;
}) {
	const learnerStateSummary = buildLearnerStatePromptSummary(options.learnerState, options.userQuestion);
	const anchorCandidateText = formatPlannerAnchorCandidatesForPrompt(options.anchorCandidates || []);
	return [
		`${ONHAND_INTERNAL_PROMPT_PREFIX} Realtime Learning Mode planner.`,
		"Return only JSON. Do not wrap it in markdown.",
		"You are planning one Socratic voice tutoring move for a student reading the current browser page.",
		"Do not answer the user's question. Produce a question or nudge that helps the student reason from the page.",
		"Required output shape:",
		`{"anchor":{"text_excerpt":"exact visible text from the page","kind":"question_anchor","note":"max 80 chars"},"move_type":"prediction_prompt|retrieval_prompt|clarifying_question","voice_script":"one short spoken question, max 35 words","sidebar_markdown":"written mirror, max 280 chars","expected_concepts":["short concept labels"],"stuck_fallback":"one hint, max 25 words","misconceptions":[{"wrong_idea":"...","nudge":"..."}]}`,
		"Hard constraints:",
		"- anchor.text_excerpt is required and must be copied from the captured page context when possible.",
		"- If Question-matched anchor candidates are present, choose anchor.text_excerpt from those candidates unless the user clearly asks about a different page area.",
		"- If a visible-region image is attached, use it only for the visual part of the move and keep the page anchor tied to exact text when exact text is available.",
		"- If the visual region is necessary but no exact text anchor is available, set anchor.kind to visual_region and make voice_script ask the student to identify or select the relevant visual part instead of inventing an explanation.",
		"- Do not include an answer field.",
		"- The voice_script should be one question or one hint, not an explanation.",
		"- The note must be local marginalia, not a summary.",
		...(options.recentConversation ? ["", "Recent conversation:", options.recentConversation] : []),
		"",
		learnerStateSummary,
		"",
		`User question:\n${options.userQuestion}`,
		...(anchorCandidateText ? ["", "Question-matched anchor candidates:", anchorCandidateText] : []),
		"",
		"Captured browser context:",
		options.browserContext,
	].join("\n");
}

function buildRealtimeEvaluatorPrompt(options: {
	userResponse: string;
	previousMove: any;
	browserContext: string;
	recentConversation: string;
	learnerState: LearnerState;
}) {
	const previousMoveText = JSON.stringify(options.previousMove || {}, null, 2);
	return [
		`${ONHAND_INTERNAL_PROMPT_PREFIX} Realtime Learning Mode evaluator.`,
		"Return only JSON. Do not wrap it in markdown.",
		"Evaluate the student's spoken response to the previous Socratic move. Nudge before correcting.",
		"Required output shape:",
		`{"correct_points":[{"concept":"...","anchor_text":"exact page text if relevant"}],"missed_points":[{"concept":"...","anchor_text":"exact page text if relevant","nudge":"..."}],"next_move":"nudge|deeper|move_on|direct_answer_escape","feedback_summary":"under 30 words","voice_script":"under 35 words","sidebar_markdown":"brief durable mirror","assessment":"correct|partial|incorrect|skipped","evidence":"brief model-visible rationale"}`,
		"Hard constraints:",
		"- Keep feedback short enough for voice.",
		"- Anchor page-material feedback to the previous move or captured page context.",
		"- If feedback depends on an attached visible-region image, refer to the visual region explicitly and avoid unsupported claims when the image or text anchor is insufficient.",
		"- Treat a reasonable paraphrase as an answer, even if it is informal. Do not repeat the same question after the student answers it.",
		"- If the user asks whether they already answered, says they just answered, or seems frustrated, acknowledge that and set next_move to direct_answer_escape or move_on.",
		"- Prefer move_on for substantially correct or partially correct answers. Use nudge only when the response is clearly missing the central point.",
		...(options.recentConversation ? ["", "Recent conversation:", options.recentConversation] : []),
		"",
		buildLearnerStatePromptSummary(options.learnerState, options.userResponse),
		"",
		"Previous pedagogical move:",
		previousMoveText,
		"",
		`Student response:\n${options.userResponse}`,
		"",
		"Captured browser context:",
		options.browserContext,
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
	const href = element.href ? ` href=${truncate(element.href, 160)}` : "";
	return `${tag}${selector}${text}${href}`;
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

function formatPdfSearchForModel(details: any) {
	const search = details.search || details || {};
	const query = String(search.query || "").trim();
	const matches = Array.isArray(search.matches) ? search.matches : [];
	if (!matches.length) return `No PDF matches found${query ? ` for "${truncate(query, 120)}"` : ""}.`;
	const lines = matches.slice(0, 12).map((match: any, index: number) => {
		const page = match.pageNumber || "?";
		const anchorText = truncate(match.matchedText || match.text || query || "match", 120);
		const snippet = truncateStructuredText(match.snippet || [match.before, match.matchedText, match.after].filter(Boolean).join(" "), 420);
		const occurrence = typeof match.occurrence === "number" ? ` occurrence ${match.occurrence}` : "";
		return `${index + 1}. [p. ${page}${occurrence}] ${anchorText}${snippet ? `\n   ${snippet}` : ""}`;
	});
	const count = typeof search.matchCount === "number" ? search.matchCount : matches.length;
	const suffix = count > lines.length ? `\n${count - lines.length} more match(es) omitted.` : "";
	return `PDF search${query ? ` for "${truncate(query, 120)}"` : ""}: ${count} match(es)\n${lines.join("\n")}${suffix}`;
}

function isPrivateIpv4Address(hostname: string) {
	const octets = hostname.split(".");
	if (octets.length !== 4) return false;
	const numbers = octets.map((part) => Number(part));
	if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [first, second, third] = numbers;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 192 && second === 0) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113) ||
		first >= 224
	);
}

const PUBLIC_CITATION_TLDS = new Set(["com", "org", "net", "edu", "gov", "mil", "int", "io", "ai", "dev", "app", "info", "science", "technology"]);

function hasPublicCitationTld(hostname: string) {
	const tld = hostname.split(".").pop() || "";
	return /^[a-z]{2}$/.test(tld) || PUBLIC_CITATION_TLDS.has(tld);
}

function isSafeCitationUrl(rawUrl: string) {
	try {
		const parsed = new URL(String(rawUrl || "").trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
		if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
		if (hostname.includes(":")) return false;
		const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
		if (isIpv4) return !isPrivateIpv4Address(hostname);
		if (!hostname.includes(".") || /\.(local|lan|home|internal|intranet|corp|test|invalid|example|onion)$/i.test(hostname)) return false;
		if (!hasPublicCitationTld(hostname)) return false;
		return true;
	} catch {
		return false;
	}
}

function formatPdfCitationForModel(details: any) {
	const citation = details.citation || details || {};
	if (!citation.found) {
		return `No citation entry found for "${truncate(String(citation.reference || ""), 80)}". ${String(citation.message || "")}`.trim();
	}
	const identifiers = citation.identifiers || {};
	const suggestedUrl = String(identifiers.suggestedUrl || "");
	const safeSuggestedUrl = suggestedUrl && isSafeCitationUrl(suggestedUrl) ? suggestedUrl : "";
	const lines = [
		`Citation entry for [${citation.reference}] on p. ${citation.pageNumber}:`,
		truncate(String(citation.entryText || ""), 500),
		identifiers.arxivId ? `arXiv id: ${identifiers.arxivId}` : "",
		identifiers.doi ? `DOI: ${identifiers.doi}` : "",
		safeSuggestedUrl
			? `To open the cited work, navigate to ${safeSuggestedUrl} in a new tab (newTab: true) so the current paper stays open, then hand the PDF to the Onhand viewer.`
			: "The entry has no direct link safe to open automatically; tell the user it could not be opened automatically.",
		`To highlight this entry here, call browser_highlight_text with text ${JSON.stringify(truncate(String(citation.entryText || ""), 110))} and pdfAnchor {"pageNumber": ${citation.pageNumber}}.`,
	].filter(Boolean);
	return lines.join("\n");
}

function formatPdfPagesForModel(details: any) {
	const pages = details.pages || details || {};
	const blocks = Array.isArray(pages.blocks) ? pages.blocks : [];
	if (!blocks.length) return "No PDF page text returned.";
	const text = blocks
		.map((block: any) => `[p. ${block.pageNumber || "?"}]\n${String(block.text || "").trim()}`)
		.filter(Boolean)
		.join("\n\n");
	return text ? `PDF page text:\n${truncateStructuredText(text, 8000)}` : "No PDF page text returned.";
}

function toolResultTextForModel(toolName: string, result: any) {
	const details = result?.details || result || {};
	const tab = details.tab || null;
	switch (toolName) {
		case "onhand_record_learning_event": {
			const event = details.event || {};
			const state = normalizeLearnerState(details.learnerState, "learning");
			if (event.kind === "check_opened") {
				const check = state.openChecks[state.openChecks.length - 1];
				return check
					? `Recorded learning check. checkId: ${check.checkId}; conceptId: ${check.conceptId}; kind: ${check.kind}.`
					: "Recorded learning check.";
			}
			if (event.kind === "check_resolved") {
				const response = state.responses.find((entry) => entry.checkId === (event.checkId || event.itemId));
				return response
					? `Resolved learning check ${response.checkId} as ${response.assessment}.`
					: `Resolved learning check ${event.checkId || event.itemId || ""}.`;
			}
			if (event.kind === "concept_introduced") {
				const concept = state.conceptsIntroduced[state.conceptsIntroduced.length - 1];
				return concept ? `Recorded learning concept. conceptId: ${concept.conceptId}; label: ${concept.label}.` : "Recorded learning concept.";
			}
			return "Recorded learning event.";
		}
		case "browser_list_tabs": {
			const tabs = Array.isArray(details.tabs) ? details.tabs : [];
			const lines = tabs.slice(0, 12).map((tabInfo: any) => `${tabInfo?.active ? "* " : "- "}${formatCompactTab(tabInfo)}`);
			return lines.length ? `Open tabs:\n${lines.join("\n")}` : "No browser tabs found.";
		}
		case "browser_activate_tab":
			return `Activated tab: ${formatCompactTab(tab)}`;
		case "browser_navigate":
			return `Navigated to: ${formatCompactTab(tab)}`;
		case "browser_open_pdf_in_onhand_viewer": {
			const alreadyOpen = details.alreadyOpen ? "Already open" : "Opened";
			const pdfUrl = details.pdfUrl ? `\nPDF source: ${details.pdfUrl}` : "";
			return `${alreadyOpen} PDF in Onhand viewer: ${formatCompactTab(tab)}${pdfUrl}`;
		}
		case "browser_pdf_search":
			return formatPdfSearchForModel(details);
		case "browser_pdf_find_citation":
			return formatPdfCitationForModel(details);
		case "browser_pdf_read_pages":
			return formatPdfPagesForModel(details);
		case "browser_pdf_jump_to_page": {
			const jump = details.jump || details || {};
			const page = jump.pageNumber || jump.pdfAnchor?.pageNumber || "?";
			const matched = jump.matchedText ? ` near "${truncate(jump.matchedText, 160)}"` : "";
			return `Jumped to PDF page ${page}${matched} on ${formatCompactTab(tab)}.`;
		}
		case "browser_pdf_capture_page_image": {
			const page = details.pageNumber || details.page || "?";
			const size = details.width && details.height ? ` (${details.width}x${details.height})` : "";
			return `Captured PDF page ${page} image${size} from ${formatCompactTab(tab)}. Use this image for visual grounding; cite exact PDF text too when available.`;
		}
		case "browser_get_visible_text": {
			const visible = details.visible || {};
			const text = formatVisibleTextForModel(visible, VISIBLE_TEXT_TOOL_MAX_CHARS);
			const heading = `Visible text from ${formatCompactTab(tab || visible)}:`;
			return text ? `${heading}\n${text}` : `${heading}\n(No visible text returned.)`;
		}
		case "browser_get_visible_region_image": {
			const region = details.region || {};
			const viewport = details.viewport || {};
			const label = details.label || "visible region";
			return [
				`Captured visible region image from ${formatCompactTab(tab)}.`,
				`Region: ${label}; ${region.width || "?"}x${region.height || "?"} CSS px at ${region.x || 0},${region.y || 0}; viewport ${viewport.width || "?"}x${viewport.height || "?"}.`,
				"Use this image for visual grounding only; cite exact page text too when text is available.",
			].join("\n");
		}
		case "browser_extract_content": {
			const content = details.content || details.extracted || {};
			const text = String(content.markdown || content.text || content.reason || content || "").trim();
			const heading = `Readable content from ${formatCompactTab(tab || content)}:`;
			return text ? `${heading}\n${truncateStructuredText(text, 8000)}` : `${heading}\n(No readable content returned.)`;
		}
		case "browser_get_selection": {
			const selection = details.selection || {};
			const selectionText = getSelectionText(selection);
			const sourceLabel = getSelectionSourceLabel(selection);
			const diagnostics = formatReaderFrameFallbackForModel(selection);
			if (selectionText) {
				return [`Selected text${sourceLabel ? ` (${sourceLabel})` : ""}:\n${truncate(selectionText, 1200)}`, diagnostics].filter(Boolean).join("\n");
			}
			return ["No selected text.", diagnostics].filter(Boolean).join("\n");
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
			const fallback = details.highlightRetry?.originalText
				? " Original highlight text did not match as one visible span; only this smaller item is anchored."
				: "";
			return `Highlighted ${JSON.stringify(truncate(matchedText, 500))} on ${formatCompactTab(tab)}. annotationId: ${annotationId}.${fallback}`;
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
	applyLearningEvent,
	buildLearnerStatePromptSummary,
	buildHighlightRetryCandidates,
	buildPlannerAnchorCandidates,
	buildReplayAnnotationsFromPageActions,
	classifyPromptForReasoning,
	computeDueReviews,
	createEmptyLearnerState,
	extractTrailingCheckQuestion,
	normalizeReviewConceptKey,
	withFallbackOpenCheck,
	formatPdfCitationForModel,
	formatVisibleTextForModel,
	formatToolResultForModel: toolResultTextForModel,
	compactFreeTierVisualContextMessagesForTest: compactFreeTierVisualContextMessages,
	messagesContainImageForTest: messagesContainImage,
	getMissingApiKeyError,
	getApiKeyForProvider,
	getProviderModelOptions,
	normalizeApiKeys,
	normalizeProviderForAuthMode,
	validateProviderApiKey,
	getReplayHighlightCandidates,
	getPublicActivities,
	finalizePublicActivitiesForTest: finalizePublicActivities,
	summarizeToolReliabilityForTest: summarizeToolReliability,
	getSelectionText,
	browserContextLooksLikePdf,
	isOnhandPdfViewerUrl,
	parseExplicitPdfHandoffParams,
	isLikelyPdfUrlForAutoHandoff,
	runRealtimePdfHandoffIfNeeded,
	shouldAutoOpenPdfViewerForTab,
	normalizePlannerMove,
	normalizeLearnerState,
	getPromptContractForTest() {
		const learnerState = applyLearningEvent(
			applyLearningEvent(createEmptyLearnerState("learning"), {
				kind: "concept_introduced",
				conceptLabel: "Rejection sampling",
				conceptId: "concept_rejection_sampling",
				annotationId: "ann-rejection",
				tabTitle: "BayesianDL",
				url: "https://example.test/bayes",
			}),
			{
				kind: "check_opened",
				checkId: "check-rejection-1",
				checkKind: "prediction",
				conceptId: "concept_rejection_sampling",
				conceptLabel: "Rejection sampling",
				promptText: "Before I explain: why do you think so many samples get rejected?",
				annotationId: "ann-rejection",
			},
		);
		const answerPrompt = buildLauncherPrompt(
			"How does rejection sampling work on this page?",
			"Active tab: BayesianDL\nVisible text snapshot:\nIn rejection sampling, we want to sample X from p(x).",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does rejection sampling work on this page?", [], false),
			[],
			"",
		);
		const learningPrompt = buildLauncherPrompt(
			"How does rejection sampling work on this page?",
			"Active tab: BayesianDL\nVisible text snapshot:\nIn rejection sampling, we want to sample X from p(x).",
			[],
			true,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does rejection sampling work on this page?", [], true),
			[],
			"",
			learnerState,
		);
		const newConceptLearningPrompt = buildLauncherPrompt(
			"How does Bayes theorem work on this page?",
			"Active tab: BayesianDL\nVisible text snapshot:\nBayes theorem updates probability after new evidence.",
			[],
			true,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does Bayes theorem work on this page?", [], true),
			[],
			"",
			learnerState,
		);
		const homeworkLearningPrompt = buildLauncherPrompt(
			"Learning mode homework test: I need the derivative for problem 1. Please give me the final answer.",
			"Active tab: Chain Rule - Practice Problems\nVisible text snapshot:\nFor problems 1-27 differentiate the given function.\n1. f(x) = (6x^2 + 7x)^4",
			[],
			true,
			buildReasoningProfile(
				DEFAULT_SETTINGS,
				"Learning mode homework test: I need the derivative for problem 1. Please give me the final answer.",
				[],
				true,
			),
			[],
			"",
			createEmptyLearnerState("learning"),
		);
		return {
			systemPrompt: ONHAND_SYSTEM_PROMPT,
			learningModeAppend: ONHAND_LEARNING_MODE_APPEND,
			answerPrompt,
			learningPrompt,
			learnerState,
			newConceptLearningPrompt,
			homeworkLearningPrompt,
		};
	},
	getToolNamesForTest(prompt: string, learningMode = false, learnerState: unknown = null, options: { forcePdfTools?: boolean; advancedRuntimeInspectionEnabled?: boolean } = {}) {
		const host: RuntimeHost = {
			async runCommand() {
				return {};
			},
			async snapshotState() {
				return { windows: [] };
			},
		};
		const artifactHooks: RuntimeArtifactHooks = {
			async captureArtifact() {
				return {};
			},
			async listArtifacts() {
				return [];
			},
			async restoreArtifact() {
				return {};
			},
		};
		return selectToolsForPrompt(createTools(host, artifactHooks), prompt, [], learningMode, learnerState, options).map((tool) => tool.name);
	},
	buildLearningCheckFollowupForTest(prompt: string, learnerState: unknown) {
		return buildLearningCheckFollowup(prompt, learnerState);
	},
	setLearnerStateMode,
	summarizeRestoredArtifact,
};

function streamOnhandFast(model: any, context: any, options: any = {}) {
	const { onhandReasoningProfile, onhandTelemetry, ...streamOptions } = options || {};
	const effectiveModel =
		model?.provider === ONHAND_FREE_PROVIDER && contextContainsImage(context)
			? {
					...model,
					input: Array.from(new Set([...(Array.isArray(model.input) ? model.input : ["text"]), "image"])),
					contextWindow: ONHAND_FREE_VISUAL_CONTEXT_WINDOW,
				}
			: model;
	const reasoningProfile = onhandReasoningProfile as ReasoningProfile | undefined;
	const telemetryOptions = withOnhandFreeTierTelemetryOptions(effectiveModel, streamOptions, onhandTelemetry);
	const baseOptions = {
		...telemetryOptions,
		// "short" lets pi-ai pass the session id as the prompt cache key so
		// providers route the loop's repeated prefixes to the same cache
		// shard; tool loops are mostly cache hits.
		cacheRetention: "short",
		maxTokens: reasoningProfile?.maxTokens || ONHAND_MAX_OUTPUT_TOKENS,
	};
	if (effectiveModel?.api === "openai-codex-responses") {
		return streamOpenAICodexResponses(effectiveModel, context, {
			...baseOptions,
			reasoningEffort: reasoningProfile?.reasoningEffort || "none",
			reasoningSummary: "auto",
			textVerbosity: reasoningProfile?.textVerbosity || "low",
		});
	}
	if (effectiveModel?.api === "openai-responses" && effectiveModel?.reasoning) {
		// Reasoning models on the plain OpenAI API must round-trip encrypted
		// reasoning content: requests are sent with store:false, so replaying
		// the previous response's reasoning item ids 404s on the second tool
		// round unless a reasoningEffort makes pi-ai request encrypted
		// content (see docs/onhand-pdf-qa-2026-06-09.md, Finding 4).
		return streamOpenAIResponses(effectiveModel, context, {
			...baseOptions,
			reasoningEffort: reasoningProfile?.reasoningEffort || "none",
			reasoningSummary: "auto",
		});
	}
	if (effectiveModel?.provider === OPENROUTER_API_PROVIDER) {
		// BYOK requests are not pinned to specific hosts: routing is the
		// key owner's choice (configurable in their OpenRouter account).
		// The hosted free tier pins US providers server-side in
		// workers/free-tier instead.
		return streamSimple(effectiveModel, context, {
			...baseOptions,
			...(effectiveModel?.reasoning && reasoningProfile?.reasoningEffort === "low" ? { reasoning: "low" } : {}),
		});
	}
	return streamSimple(effectiveModel, context, baseOptions);
}

function compactOnhandTelemetryId(value: unknown, maxLength = 80) {
	return String(value || "")
		.trim()
		.replace(/[^A-Za-z0-9_.:-]/g, "_")
		.slice(0, maxLength);
}

function withOnhandFreeTierTelemetryOptions(model: any, streamOptions: any, telemetry: any) {
	const baseOptions = streamOptions && typeof streamOptions === "object" ? streamOptions : {};
	if (model?.provider !== ONHAND_FREE_PROVIDER || !telemetry || typeof telemetry !== "object") return baseOptions;
	const turnId = compactOnhandTelemetryId(telemetry.turnId);
	const sessionId = compactOnhandTelemetryId(telemetry.sessionId);
	if (!turnId && !sessionId) return baseOptions;
	return {
		...baseOptions,
		sessionId: compactOnhandTelemetryId(baseOptions.sessionId) || sessionId || turnId,
		headers: {
			...(baseOptions.headers || {}),
			...(turnId ? { [ONHAND_FREE_TURN_ID_HEADER]: turnId } : {}),
			...(sessionId ? { [ONHAND_FREE_SESSION_ID_HEADER]: sessionId } : {}),
		},
	};
}

function createRecordLearningEventTool(recordLearningEvent: (event: LearningEvent) => Promise<LearnerState>): AgentTool {
	return {
		name: "onhand_record_learning_event",
		label: "Onhand Record Learning Event",
		description: "Internal Learning Mode tool. Record introduced concepts, opened prediction/retrieval checks, and resolved checks in this session's learner state.",
		parameters: RECORD_LEARNING_EVENT_SCHEMA,
		executionMode: "sequential",
		async execute(_toolCallId, params: any) {
			const event = (params && typeof params === "object" ? params : {}) as LearningEvent;
			const learnerState = await recordLearningEvent(event);
			const details = { event, learnerState };
			return {
				content: [{ type: "text", text: toolResultTextForModel("onhand_record_learning_event", details) }],
				details,
			};
		},
	};
}

function createTools(
	host: RuntimeHost,
	artifactHooks: RuntimeArtifactHooks,
	prepareCommandParams: (params: any, commandName?: string) => any = (params) => params,
	recordLearningEvent: (event: LearningEvent) => Promise<LearnerState> = async (event) =>
		applyLearningEvent(createEmptyLearnerState("learning"), event, { mode: "learning" }),
): AgentTool[] {
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
				let result: any;
				try {
					result = await host.runCommand(commandName, prepareCommandParams(params, commandName) as Record<string, unknown>);
				} catch (error) {
					if (commandName !== "highlight_text") throw error;
					const candidates = buildHighlightRetryCandidates((params as any)?.text);
					let lastError = error;
					for (const candidate of candidates) {
						try {
							result = await host.runCommand(
								commandName,
								prepareCommandParams({ ...(params as any), text: candidate }, commandName) as Record<string, unknown>,
							);
						result = {
							...result,
							highlightRetry: {
								originalText: String((params as any)?.text || ""),
								usedText: candidate,
							},
						};
						break;
					} catch (candidateError) {
						lastError = candidateError;
					}
				}
				if (!result) throw lastError;
			}
			return {
				content: [{ type: "text", text: toolResultTextForModel(name, result) }],
				details: result,
			};
		},
	});

	return [
		createRecordLearningEventTool(recordLearningEvent),
		{
			name: "browser_list_tabs",
			label: "Browser List Tabs",
			description: "List windows and tabs from the current Chromium browser session.",
			parameters: LIST_TABS_SCHEMA,
			async execute(_toolCallId, params: any) {
				const scopedParams = prepareCommandParams(params, "list_tabs") as any;
				const state = await host.snapshotState(scopedParams);
				const tabs = flattenTabs(state).filter(
					(tab: any) => (!scopedParams?.onlyActive || tab.active) && (typeof scopedParams?.windowId !== "number" || tab.windowId === scopedParams.windowId),
				);
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
			"browser_open_pdf_in_onhand_viewer",
			"Browser Open PDF In Onhand Viewer",
			"Open a direct PDF or PDF-reader tab in Onhand's PDF viewer when the current PDF surface has no readable text layer. After this, use the normal visible-text, highlight, note, capture, and restore tools on the viewer tab.",
			OPEN_PDF_VIEWER_SCHEMA,
			"open_pdf_in_onhand_viewer",
			{ sequential: true },
		),
		commandTool(
			"browser_pdf_search",
			"Browser PDF Search",
			"Search the full extracted text of the current Onhand PDF viewer, including pages that are not currently visible. Use this before answering PDF questions that ask where a topic is discussed.",
			PDF_SEARCH_SCHEMA,
			"pdf_search",
		),
		commandTool(
			"browser_pdf_read_pages",
			"Browser PDF Read Pages",
			"Read extracted text from specific PDF page numbers or a page range in the current Onhand PDF viewer.",
			PDF_READ_PAGES_SCHEMA,
			"pdf_read_pages",
		),
		commandTool(
			"browser_pdf_find_citation",
			"Browser PDF Find Citation",
			"Look up a bibliography entry in the current Onhand PDF viewer by bracket number (like [14]) or entry text. Returns the entry text, an anchor for highlighting it, and identifiers (arXiv id, DOI, URL) with a suggested URL for opening the cited work.",
			PDF_FIND_CITATION_SCHEMA,
			"pdf_find_citation",
		),
		commandTool(
			"browser_pdf_jump_to_page",
			"Browser PDF Jump To Page",
			"Scroll the current Onhand PDF viewer to a specific page, optionally near exact text from that page.",
			PDF_JUMP_TO_PAGE_SCHEMA,
			"pdf_jump_to_page",
			{ sequential: true },
		),
		{
			name: "browser_pdf_capture_page_image",
			label: "Browser PDF Page Image",
			description:
				"Capture a specific PDF page as an image for visual grounding of slide layouts, figures, equations, charts, or scanned content. Use text tools too when text is available.",
			parameters: PDF_PAGE_IMAGE_SCHEMA,
			async execute(_toolCallId, params: any) {
				const result = await host.runCommand("pdf_capture_page_image", prepareCommandParams(params, "pdf_capture_page_image") as Record<string, unknown>);
				const attachment = imageAttachmentFromDataUrl(result?.dataUrl, `pdf-page-${result?.pageNumber || params?.pageNumber || "capture"}.png`);
				const content: any[] = [{ type: "text", text: toolResultTextForModel("browser_pdf_capture_page_image", result) }];
				if (attachment) {
					content.push({
						type: "image",
						data: attachment.data,
						mimeType: attachment.mimeType,
					});
				}
				return {
					content,
					details: result,
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
		{
			name: "browser_get_visible_region_image",
			label: "Browser Visible Region Image",
			description:
				"Capture the visible viewport, a CSS-selector bounding box, or viewport coordinates as an image for equations, charts, diagrams, figures, screenshots, and weak text extraction. Use this before making visual claims when text tools are insufficient.",
			parameters: VISIBLE_REGION_IMAGE_SCHEMA,
			async execute(_toolCallId, params: any) {
				const result = await host.runCommand("get_visible_region_image", prepareCommandParams(params, "get_visible_region_image") as Record<string, unknown>);
				const attachment = imageAttachmentFromDataUrl(result?.dataUrl, "visible-region.png");
				const content: any[] = [{ type: "text", text: toolResultTextForModel("browser_get_visible_region_image", result) }];
				if (attachment) {
					content.push({
						type: "image",
						data: attachment.data,
						mimeType: attachment.mimeType,
					});
				}
				return {
					content,
					details: result,
				};
			},
		},
		commandTool(
			"browser_extract_content",
			"Browser Extract Content",
			"Extract readable article or document text from the live page. Use at most once per response unless the first result is unusable.",
			EXTRACT_CONTENT_SCHEMA,
			"extract_content",
		),
		commandTool(
			"browser_get_selection",
			"Browser Selection",
			"Read the user's current text selection in a browser tab.",
			Type.Object({ ...READ_TAB_SELECTOR_SCHEMA }),
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
			"Create an anchor by highlighting exact visible text that supports a material claim. The text argument must be copied from visible/readable page text, not paraphrased from your answer. Use short, distinctive spans. Avoid heading-only anchors unless the heading alone answers the user's question. If the answer names multiple roadmap/list/navigation items, create one highlight per item or one exact visible span covering the items. For list items, send the item words, not a heading-plus-list block; Markdown markers in tool output are structure cues. If an item cannot be highlighted successfully, do not claim it as page-supported. For simple non-list questions, use this at most once before answering.",
			HIGHLIGHT_TEXT_SCHEMA,
			"highlight_text",
			{ sequential: true },
		),
		commandTool(
			"browser_show_note",
			"Browser Show Note",
			"Attach a short marginal note to a highlight. Prefer one local orienting sentence over a summary or detached answer. Do not add a note for every highlight.",
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
					const result = await artifactHooks.captureArtifact(prepareCommandParams(params, "capture_state"));
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
					const result = await artifactHooks.restoreArtifact(prepareCommandParams(params, "restore_state"));
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
			"Last-resort read-only JavaScript evaluation for complex client-side runtime state when safer browser tools cannot answer the user's question. Do not inspect cookies, storage, secrets, payment fields, or unrelated page data.",
			RUN_JS_SCHEMA,
			"run_js",
		),
	];
}

function getToolStatusMessage(toolName: string) {
	switch (toolName) {
		case "onhand_record_learning_event":
			return "Updating learning state...";
		case "browser_list_tabs":
			return "Checking open tabs...";
		case "browser_activate_tab":
			return "Switching tabs...";
		case "browser_navigate":
			return "Navigating...";
		case "browser_open_pdf_in_onhand_viewer":
			return "Opening PDF in Onhand viewer...";
		case "browser_pdf_search":
			return "Searching the PDF...";
		case "browser_pdf_find_citation":
			return "Looking up the citation...";
		case "browser_pdf_read_pages":
			return "Reading PDF pages...";
		case "browser_pdf_jump_to_page":
			return "Moving to the PDF page...";
		case "browser_pdf_capture_page_image":
			return "Capturing PDF page image...";
		case "browser_get_selection":
			return "Reading your current selection...";
		case "browser_get_visible_text":
			return "Reading the visible part of the page...";
		case "browser_get_visible_region_image":
			return "Capturing the visible region...";
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
		case "browser_run_js":
			return "Inspecting client-side page state...";
		default:
			return toolName?.startsWith("browser_") ? "Inspecting the current page..." : `Using ${toolName}...`;
	}
}

function isInternalToolName(toolName: string) {
	return toolName.startsWith("onhand_");
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
		case "browser_open_pdf_in_onhand_viewer": {
			const detail = truncate(details.pdfUrl || tab?.title || tab?.url || "PDF", 72);
			return {
				key: `tab:${tab?.id || detail}:pdf-viewer`,
				type: "tab",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: details.alreadyOpen ? "Using PDF viewer" : "Opened PDF viewer",
				detail,
			};
		}
		case "browser_pdf_search": {
			const search = details.search || details || {};
			const detail = truncate(search.query || "PDF search", 72);
			return {
				key: `pdf-search:${tab?.id || "tab"}:${detail}`,
				type: "read",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Searched PDF",
				detail,
			};
		}
		case "browser_pdf_find_citation": {
			const citation = details.citation || details || {};
			const detail = truncate(`[${citation.reference || "?"}] ${citation.entryText || ""}`.trim(), 72);
			return {
				key: `pdf-citation:${tab?.id || "tab"}:${citation.reference || detail}`,
				type: "read",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Found citation",
				detail,
			};
		}
		case "browser_pdf_read_pages": {
			const pages = details.pages || details || {};
			const pageList = Array.isArray(pages.pageNumbers) ? pages.pageNumbers.join(", ") : "pages";
			return {
				key: `pdf-read:${tab?.id || "tab"}:${pageList}`,
				type: "read",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Read PDF",
				detail: truncate(`p. ${pageList}`, 72),
			};
		}
		case "browser_pdf_jump_to_page": {
			const jump = details.jump || details || {};
			const detail = `p. ${jump.pageNumber || jump.pdfAnchor?.pageNumber || "?"}`;
			return {
				key: `pdf-jump:${tab?.id || "tab"}:${detail}`,
				type: "tab",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Moved PDF",
				detail,
			};
		}
		case "browser_pdf_capture_page_image": {
			const detail = `p. ${details.pageNumber || details.page || "?"}`;
			return {
				key: `pdf-image:${tab?.id || "tab"}:${detail}`,
				type: "visual",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Captured PDF page",
				detail,
			};
		}
		case "browser_get_visible_region_image": {
			const region = details.region || {};
			const label = truncate(details.label || "Visible region", 72);
			return {
				key: `visual:${tab?.id || "tab"}:${region.x || 0}:${region.y || 0}:${region.width || 0}:${region.height || 0}`,
				type: "visual",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: "Captured visual region",
				detail: label,
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
				...(details.annotation?.pdfAnchor ? { pdfAnchor: details.annotation.pdfAnchor } : {}),
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
				...(details.note?.pdfAnchor ? { pdfAnchor: details.note.pdfAnchor } : {}),
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

function isReviewableAnnotationAction(action: PageAction | null | undefined) {
	if (!action || typeof action !== "object") return false;
	if (action.type === "note") return true;
	return action.type === "annotation" && (String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text");
}

function getPublicActivities(activities: UiActivity[] = []) {
	return activities.filter((activity) => activity?.kind === "tool" && !isInternalToolName(activity.toolName || ""));
}

function finalizePublicActivities(activities: UiActivity[] = [], finalError: Error | null = null) {
	return getPublicActivities(activities).map((activity) => {
		if (activity.state !== "retrying") return activity;
		return { ...activity, state: finalError ? "error" : "recovered" };
	});
}

function summarizeToolReliability(activities: UiActivity[] = [], pageActions: PageAction[] = []) {
	const publicActivities = getPublicActivities(activities);
	const pageActionCount = Array.isArray(pageActions) ? pageActions.length : 0;
	const failedStates = new Set(["retrying", "recovered", "error"]);
	return {
		tool_step_count: Math.max(publicActivities.length, pageActionCount),
		tool_failure_count: publicActivities.filter((activity) => failedStates.has(activity.state || "")).length,
		recovered_tool_failure_count: publicActivities.filter((activity) => activity.state === "recovered").length,
		final_tool_failure_count: publicActivities.filter((activity) => activity.state === "error").length,
	};
}

function markRecoveredToolRetries(activities: UiActivity[] = [], toolName: string) {
	if (!toolName) return false;
	let recovered = false;
	for (let index = activities.length - 1; index >= 0; index -= 1) {
		const activity = activities[index];
		if (activity?.kind !== "tool" || activity.toolName !== toolName || activity.state !== "retrying") continue;
		activities[index] = { ...activity, state: "recovered" };
		recovered = true;
	}
	return recovered;
}

export function createOnhandBrowserRuntime(host: RuntimeHost) {
	let storePromise: Promise<any> | null = null;
	let uiState: any | null = null;
	let activeAgent: Agent | null = null;
	let activeRequest: any | null = null;
	let sentryInitialized = false;
	let sentryDiagnosticsAllowed = false;
	let sentryExplicitEventAllowance = 0;

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
				realtimeVoiceEnabled: Boolean(rawSettings.realtimeVoiceEnabled),
				speedMode: normalizeSpeedMode(rawSettings.speedMode),
				aiProvider,
				aiModel: normalizeModelForProvider(rawModel, aiProvider, authMode),
				aiApiKey: typeof rawSettings.aiApiKey === "string" ? rawSettings.aiApiKey : "",
				aiApiKeys: normalizeApiKeys(rawSettings.aiApiKeys, rawSettings.aiApiKey),
				authMode,
				oauthCredentials: normalizeOAuthCredentials(rawSettings.oauthCredentials),
				diagnosticsEnabled: normalizeDiagnosticsEnabled(rawSettings.diagnosticsEnabled, authMode, aiProvider),
				diagnosticsClientId: typeof rawSettings.diagnosticsClientId === "string" ? rawSettings.diagnosticsClientId : "",
				advancedRuntimeInspectionEnabled: rawSettings.advancedRuntimeInspectionEnabled !== false,
			};
			const sessions: Record<string, RuntimeSession> = {};
			for (const record of await getAllSessionRecords()) {
				const session = normalizeSession(record);
				sessions[session.id] = session;
			}
			// Migrate sessions out of the legacy single-blob layout. Existing
			// per-session records win so a stale legacy blob cannot clobber
			// newer data if a previous migration only partially completed.
			const legacySessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : null;
			const migratedSessions: RuntimeSession[] = [];
			if (legacySessions) {
				for (const legacy of Object.values(legacySessions)) {
					const session = normalizeSession(legacy);
					if (!sessions[session.id]) {
						sessions[session.id] = session;
						migratedSessions.push(session);
					}
				}
			}
			let currentSessionId = typeof raw.currentSessionId === "string" ? raw.currentSessionId : "";
			let createdSession: RuntimeSession | null = null;
			if (!currentSessionId || !sessions[currentSessionId]) {
				const session = createSession();
				sessions[session.id] = session;
				currentSessionId = session.id;
				createdSession = session;
			}
			try {
				const recordsToPersist = createdSession ? [...migratedSessions, createdSession] : migratedSessions;
				await putSessionRecords(recordsToPersist);
				if (legacySessions) {
					await chrome.storage.local.set({ [STORAGE_KEY]: { settings, currentSessionId } });
				}
			} catch (error) {
				// Keep the legacy blob intact so the next load can retry; the
				// in-memory store already holds the merged sessions.
				host.log?.("onhand session storage migration failed", error);
			}
			return { settings, sessions, currentSessionId };
		})();
		return await storePromise;
	}

	async function saveStore(store: any, changed: { sessions?: RuntimeSession[]; deletedSessionIds?: string[] }) {
		storePromise = Promise.resolve(store);
		try {
			await putSessionRecords(changed?.sessions || []);
			await deleteSessionRecords(changed?.deletedSessionIds || []);
			await chrome.storage.local.set({ [STORAGE_KEY]: { settings: store.settings, currentSessionId: store.currentSessionId } });
		} catch (error: any) {
			host.log?.("onhand store save failed", error);
			try {
				await publishState({ status: `Onhand could not save this session: ${error?.message || error}` });
			} catch {}
			throw error;
		}
	}

	function compactTelemetryValue(value: unknown, maxLength = 120) {
		return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
	}

	function finiteTelemetryNumber(value: unknown) {
		const number = Number(value);
		return Number.isFinite(number) ? number : 0;
	}

	function telemetryEventData(settings: RuntimeSettings, data: Record<string, unknown> = {}) {
		return {
			auth_mode: compactTelemetryValue(settings.authMode, 40),
			ai_provider: compactTelemetryValue(settings.aiProvider, 80),
			ai_model: compactTelemetryValue(settings.aiModel, 120),
			realtime_voice_enabled: Boolean(settings.realtimeVoiceEnabled),
			learning_mode: Boolean(settings.learningMode),
			result: compactTelemetryValue(data.result, 48),
			status: finiteTelemetryNumber(data.status),
			duration_ms: finiteTelemetryNumber((data as any).duration_ms ?? (data as any).durationMs),
			body_bytes: finiteTelemetryNumber((data as any).body_bytes ?? (data as any).bodyBytes),
			action_count: finiteTelemetryNumber((data as any).action_count ?? (data as any).actionCount),
			artifact_count: finiteTelemetryNumber((data as any).artifact_count ?? (data as any).artifactCount),
			tool_step_count: finiteTelemetryNumber((data as any).tool_step_count ?? (data as any).toolStepCount),
			tool_failure_count: finiteTelemetryNumber((data as any).tool_failure_count ?? (data as any).toolFailureCount),
			recovered_tool_failure_count: finiteTelemetryNumber(
				(data as any).recovered_tool_failure_count ?? (data as any).recoveredToolFailureCount,
			),
			final_tool_failure_count: finiteTelemetryNumber((data as any).final_tool_failure_count ?? (data as any).finalToolFailureCount),
			error_kind: compactTelemetryValue((data as any).error_kind ?? (data as any).errorKind, 80),
		};
	}

	function classifyTelemetryError(error: unknown) {
		const message = compactTelemetryValue((error as any)?.message || error, 240).toLowerCase();
		if (!message) return "";
		if (/api key|sign in|oauth|credential|auth/.test(message)) return "auth";
		if (/quota|limit|rate|429|free tier/.test(message)) return "quota";
		if (/network|fetch|connection|offline|reach/.test(message)) return "network";
		if (/model|provider|upstream|openrouter|openai|anthropic|gemini/.test(message)) return "provider";
		if (/aborted|cancelled|stopped/.test(message)) return "aborted";
		if (/permission|debugger|side panel|tab|chrome/.test(message)) return "browser_permission";
		return "runtime_error";
	}

	function redactDiagnosticText(value: unknown, maxLength = 1200) {
		let text = String(value || "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t\f\v]+/g, " ")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		if (!text) return "";
		text = text
			.replace(/(Source not found on this page:)\s*[\s\S]+/gi, "$1 [redacted text]")
			.replace(/(Saved source text is not currently loaded in this page:)\s*[\s\S]+/gi, "$1 [redacted text]")
			.replace(/(No visible text matched:)\s*[\s\S]+/gi, "$1 [redacted text]")
			.replace(/(No visible interactive element matched text:)\s*[\s\S]+/gi, "$1 [redacted text]")
			.replace(/(No editable field matched label:)\s*[\s\S]+/gi, "$1 [redacted label]")
			.replace(/(No element matches selector:)\s*[\s\S]+/gi, "$1 [redacted selector]")
			.replace(/(Element matched)\s+[\s\S]+?\s+(but is not visible|but is not text-editable)/gi, "$1 [redacted selector] $2")
			.replace(/\b(?:sk|sk-or|sk-ant|AIza)[A-Za-z0-9._-]{12,}\b/g, "[redacted_key]")
			.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted_email]")
			.replace(/https?:\/\/[^\s)'"<>]+/gi, "[redacted_url]")
			.replace(/chrome-extension:\/\/[a-z]{32}/gi, "chrome-extension://[extension]")
			.replace(/file:\/\/[^\s)'"<>]+/gi, "[redacted_file_url]")
			.replace(/\/Users\/[^/\s)'"<>]+/g, "/Users/[redacted_user]")
			.replace(/([?&](?:key|token|secret|api_key|access_token|refresh_token)=)[^&\s)'"<>]+/gi, "$1[redacted]");
		if (text.length <= maxLength) return text;
		return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
	}

	function normalizeSentryFramePath(value: unknown) {
		const redacted = redactDiagnosticText(value, 240);
		return redacted.replace(/^chrome-extension:\/\/\[extension\]\//i, "app:///");
	}

	function redactDiagnosticStack(value: unknown, maxLength = 2400, extensionFramePrefix = "app:///") {
		const lines = String(value || "")
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => redactDiagnosticText(line, 700).replace(/chrome-extension:\/\/\[extension\]\//gi, extensionFramePrefix))
			.filter(Boolean);
		const text = lines.join("\n");
		if (text.length <= maxLength) return text;
		return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
	}

	function sentryRelease() {
		const version = compactTelemetryValue(host.extensionVersion || chrome.runtime?.getManifest?.()?.version || "", 40);
		return version ? `onhand-extension@${version}` : "onhand-extension";
	}

	function scrubSentryEvent(event: any) {
		if (!sentryDiagnosticsAllowed) {
			if (sentryExplicitEventAllowance <= 0) return null;
			sentryExplicitEventAllowance -= 1;
		}
		delete event.user;
		delete event.request;
		delete event.breadcrumbs;
		delete event.extra;
		if (event.contexts) event.contexts = event.contexts.onhand ? { onhand: event.contexts.onhand } : {};
		event.transaction = redactDiagnosticText(event.transaction, 160);
		if (event.message) event.message = redactDiagnosticText(event.message, 300);
		const values = Array.isArray(event.exception?.values) ? event.exception.values : [];
		for (const value of values) {
			if (value?.value) value.value = redactDiagnosticText(value.value, 500);
			if (value?.type) value.type = compactTelemetryValue(value.type, 120);
			const frames = Array.isArray(value?.stacktrace?.frames) ? value.stacktrace.frames : [];
			for (const frame of frames) {
				if (frame.filename) frame.filename = normalizeSentryFramePath(frame.filename);
				if (frame.abs_path) frame.abs_path = normalizeSentryFramePath(frame.abs_path);
				if (frame.function) frame.function = redactDiagnosticText(frame.function, 160);
				delete frame.context_line;
				delete frame.pre_context;
				delete frame.post_context;
				delete frame.vars;
			}
		}
		return event;
	}

	function initializeSentryIfNeeded() {
		if (sentryInitialized) return;
		Sentry.init({
			dsn: ONHAND_SENTRY_DSN,
			release: sentryRelease(),
			dist: ONHAND_SENTRY_DIST,
			environment: "production",
			sendDefaultPii: false,
			maxBreadcrumbs: 0,
			defaultIntegrations: false,
			integrations: [
				Sentry.inboundFiltersIntegration(),
				Sentry.dedupeIntegration(),
				Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
			],
			beforeBreadcrumb: () => null,
			beforeSend: scrubSentryEvent,
			tracesSampleRate: 0,
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: 0,
		});
		sentryInitialized = true;
	}

	function setSentryTags(scope: any, settings: RuntimeSettings, kind: string, data: Record<string, unknown> = {}) {
		scope.setTag("surface", "browser_runtime");
		scope.setTag("kind", compactTelemetryValue(kind, 80));
		scope.setTag("extension_version", compactTelemetryValue(host.extensionVersion || "", 40));
		scope.setTag("runtime_revision", compactTelemetryValue(host.runtimeRevision || "", 80));
		scope.setTag("auth_mode", compactTelemetryValue(settings.authMode, 40));
		scope.setTag("ai_provider", compactTelemetryValue(settings.aiProvider, 80));
		scope.setTag("ai_model", compactTelemetryValue(settings.aiModel, 120));
		const errorKind = compactTelemetryValue((data as any).error_kind || (data as any).errorKind, 80);
		if (errorKind) scope.setTag("error_kind", errorKind);
		const reportId = compactTelemetryValue((data as any).report_id || (data as any).reportId, 80);
		if (reportId) scope.setTag("cloudflare_report_id", reportId);
		const messageType = compactTelemetryValue((data as any).message_type || (data as any).messageType, 80);
		if (messageType) scope.setTag("message_type", messageType);
	}

	function captureSentryException(error: unknown, settings: RuntimeSettings, kind: string, data: Record<string, unknown> = {}) {
		const diagnosticsAllowed = Boolean(settings.diagnosticsEnabled);
		const explicitUserReport = Boolean(data.explicit_user_report);
		sentryDiagnosticsAllowed = diagnosticsAllowed;
		if (!diagnosticsAllowed && !explicitUserReport) return false;
		if (!diagnosticsAllowed && explicitUserReport) sentryExplicitEventAllowance += 1;
		initializeSentryIfNeeded();
		const message = redactDiagnosticText((error as any)?.message || error || kind, 500);
		const capturedError = new Error(message || kind);
		capturedError.name = compactTelemetryValue((error as any)?.name || "Error", 120) || "Error";
		if ((error as any)?.stack) capturedError.stack = redactDiagnosticStack((error as any).stack, 2400, ONHAND_SENTRY_STACK_EXTENSION_URL);
		Sentry.withScope((scope) => {
			setSentryTags(scope, settings, kind, data);
			scope.setContext("onhand", {
				learning_mode: Boolean(settings.learningMode),
				realtime_voice_enabled: Boolean(settings.realtimeVoiceEnabled),
				action_count: finiteTelemetryNumber((data as any).action_count ?? (data as any).actionCount),
				artifact_count: finiteTelemetryNumber((data as any).artifact_count ?? (data as any).artifactCount),
				tool_step_count: finiteTelemetryNumber((data as any).tool_step_count ?? (data as any).toolStepCount),
				tool_failure_count: finiteTelemetryNumber((data as any).tool_failure_count ?? (data as any).toolFailureCount),
				recovered_tool_failure_count: finiteTelemetryNumber(
					(data as any).recovered_tool_failure_count ?? (data as any).recoveredToolFailureCount,
				),
				final_tool_failure_count: finiteTelemetryNumber((data as any).final_tool_failure_count ?? (data as any).finalToolFailureCount),
			});
			Sentry.captureException(capturedError);
		});
		return true;
	}

	function buildErrorReportSnapshot(error: Error, request: any, activities: UiActivity[]): RuntimeErrorReportSnapshot {
		const settings = (request?.settings || {}) as RuntimeSettings;
		const startedAtMs = Date.parse(request?.createdAt || "");
		const durationMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0;
		return {
			schema_version: 1,
			type: "prompt_error",
			created_at: nowIso(),
			extension_version: compactTelemetryValue(host.extensionVersion || "", 40),
			runtime_revision: compactTelemetryValue(host.runtimeRevision || "", 80),
			auth_mode: compactTelemetryValue(settings.authMode, 40),
			ai_provider: compactTelemetryValue(settings.aiProvider, 80),
			ai_model: compactTelemetryValue(settings.aiModel, 120),
			realtime_voice_enabled: Boolean(settings.realtimeVoiceEnabled),
			learning_mode: Boolean(request?.learningMode ?? settings.learningMode),
			error_kind: classifyTelemetryError(error),
			error_message: redactDiagnosticText(error?.message || error, 700),
			error_stack: redactDiagnosticStack(error?.stack || "", 2400),
			duration_ms: durationMs,
			action_count: Array.isArray(request?.pageActions) ? request.pageActions.length : 0,
			artifact_count: Array.isArray(request?.artifactIds) ? request.artifactIds.length : 0,
			activity_summary: (Array.isArray(activities) ? activities : [])
				.slice(-16)
				.map((activity) => ({
					kind: compactTelemetryValue(activity?.kind, 32),
					tool_name: compactTelemetryValue(activity?.toolName, 80),
					state: compactTelemetryValue(activity?.state, 32),
				}))
				.filter((activity) => activity.kind || activity.tool_name || activity.state),
		};
	}

	function buildErrorReportSnapshotFromTurn(turn: UiTurn, settings: RuntimeSettings): RuntimeErrorReportSnapshot {
		return {
			schema_version: 1,
			type: "prompt_error",
			created_at: nowIso(),
			extension_version: compactTelemetryValue(host.extensionVersion || "", 40),
			runtime_revision: compactTelemetryValue(host.runtimeRevision || "", 80),
			auth_mode: compactTelemetryValue(settings.authMode, 40),
			ai_provider: compactTelemetryValue(settings.aiProvider, 80),
			ai_model: compactTelemetryValue(settings.aiModel, 120),
			realtime_voice_enabled: Boolean(settings.realtimeVoiceEnabled),
			learning_mode: Boolean(settings.learningMode),
			error_kind: "runtime_error",
			error_message: redactDiagnosticText(String(turn.reply || "").replace(/^Error:\s*/i, ""), 700),
			error_stack: "",
			duration_ms: 0,
			action_count: Array.isArray(turn.pageActions) ? turn.pageActions.length : 0,
			artifact_count: 0,
			activity_summary: (Array.isArray(turn.activities) ? turn.activities : [])
				.slice(-16)
				.map((activity) => ({
					kind: compactTelemetryValue(activity?.kind, 32),
					tool_name: compactTelemetryValue(activity?.toolName, 80),
					state: compactTelemetryValue(activity?.state, 32),
				}))
				.filter((activity) => activity.kind || activity.tool_name || activity.state),
		};
	}

	async function ensureDiagnosticsClientId(store: any) {
		const settings = store.settings as RuntimeSettings;
		if (settings.diagnosticsClientId) return settings.diagnosticsClientId;
		settings.diagnosticsClientId = crypto.randomUUID();
		store.settings = settings;
		await saveStore(store, {});
		return settings.diagnosticsClientId;
	}

	async function trackExtensionEvent(eventName: string, data: Record<string, unknown> = {}) {
		const name = compactTelemetryValue(eventName, 80);
		if (!ONHAND_DIAGNOSTICS_EVENT_NAMES.has(name)) return false;
		const store = await loadStore();
		const settings = store.settings as RuntimeSettings;
		if (!settings.diagnosticsEnabled) return false;
		const clientId = await ensureDiagnosticsClientId(store);
		const baseUrl = await getFreeTierBaseUrl();
		const manifest = chrome.runtime?.getManifest?.() || {};
		const payload = {
			event_name: name,
			client_id: clientId,
			extension_version: compactTelemetryValue(manifest.version, 40),
			runtime_revision: compactTelemetryValue(host.runtimeRevision || "", 80),
			data: telemetryEventData(settings, data),
		};
		await fetch(`${baseUrl}/telemetry`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}).catch(() => {});
		return true;
	}

	async function getCurrentSession() {
		const store = await loadStore();
		return store.sessions[store.currentSessionId] as RuntimeSession;
	}

	async function ensureSessionLoaded(store: any, sessionId: string) {
		if (!sessionId || store.sessions[sessionId]) return;
		// Sessions are cached in memory; pick up records written by another
		// context without clobbering live in-memory state.
		try {
			for (const record of await getAllSessionRecords()) {
				const session = normalizeSession(record);
				if (!store.sessions[session.id]) store.sessions[session.id] = session;
			}
		} catch (error) {
			host.log?.("onhand session reload failed", error);
		}
	}

	async function replaceCurrentSession(session: RuntimeSession) {
		const store = await loadStore();
		session.updatedAt = nowIso();
		store.sessions[session.id] = session;
		store.currentSessionId = session.id;
		await saveStore(store, { sessions: [session] });
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

	// The model records a learning event with an annotationId but not the
	// verbatim text it highlighted. Look that text (and the page/artifact it
	// belongs to) up from the highlight page action so the learner source can
	// re-find its passage later, even from another session.
	function enrichLearningEventSource(session: RuntimeSession, event: LearningEvent): LearningEvent {
		if (!event || typeof event !== "object") return event;
		const annotationId = compactActionText((event as any).annotationId);
		if (!annotationId || compactActionText((event as any).matchedText)) return event;
		const action = collectSessionPageActions(session).find(
			(candidate) => compactActionText(candidate?.annotationId) === annotationId,
		);
		if (!action) return event;
		const matchedText = compactActionText(action.citationText || action.detail);
		if (!matchedText) return event;
		return {
			...event,
			matchedText,
			...((event as any).artifactId || !action.artifactId ? {} : { artifactId: action.artifactId }),
			...((event as any).url || !action.url ? {} : { url: action.url }),
			...((event as any).tabTitle || !action.title ? {} : { tabTitle: action.title }),
		} as LearningEvent;
	}

	async function recordLearningEventForSession(session: RuntimeSession, event: LearningEvent, mode: LearnerMode) {
		const store = await loadStore();
		const storedSession = (store.sessions[session.id] as RuntimeSession) || session;
		const enrichedEvent = enrichLearningEventSource(storedSession, event);
		storedSession.learnerState = applyLearningEvent(setLearnerStateMode(storedSession.learnerState, mode), enrichedEvent, { mode });
		storedSession.updatedAt = nowIso();
		store.sessions[storedSession.id] = storedSession;
		if (store.currentSessionId === storedSession.id) {
			session.learnerState = storedSession.learnerState;
			session.updatedAt = storedSession.updatedAt;
		}
		await saveStore(store, { sessions: [storedSession] });
		await publishState({
			currentSession: buildSessionState(storedSession),
			learnerState: storedSession.learnerState,
		});
		return storedSession.learnerState;
	}

	async function recordRealtimeVoiceTurn(request: any = {}) {
		const store = await loadStore();
		const session = store.sessions[store.currentSessionId] as RuntimeSession;
		const voiceTurnId = String(request.voiceTurnId || crypto.randomUUID()).trim();
		const userPrompt = truncate(String(request.userPrompt || "").trim(), RECENT_CONTEXT_PROMPT_MAX_CHARS);
		const reply = truncate(String(request.reply || "").trim(), RECENT_CONTEXT_REPLY_MAX_CHARS);
		if (!userPrompt && !reply) throw new Error("Voice turn needs a prompt or answer.");
		const createdAt = typeof request.createdAt === "string" && request.createdAt.trim() ? request.createdAt : nowIso();
		const pageActions = (Array.isArray(request.pageActions) ? request.pageActions : []).filter(
			(action: any) => action && typeof action === "object" && String(action.key || action.label || action.detail || "").trim(),
		) as PageAction[];
		const turn: UiTurn = {
			id: voiceTurnId || crypto.randomUUID(),
			userPrompt,
			reply,
			activities: [],
			pageActions,
			pending: false,
			error: false,
			createdAt,
		};
		const existingIndex = (session.turns || []).findIndex((candidate) => candidate?.id === turn.id);
		if (existingIndex >= 0) {
			session.turns = (session.turns || []).map((candidate, index) => (index === existingIndex ? { ...candidate, ...turn } : candidate));
		} else {
			session.turns = [...(session.turns || []), turn];
		}
		session.messages = createStoredConversationMessages(session.turns);
		if (!session.name && userPrompt) {
			session.name = buildSessionTitleFromPrompt(userPrompt);
		}
		await replaceCurrentSession(session);
		await publishState({
			currentSession: buildSessionState(session),
			turns: session.turns,
			messages: buildConversationMessages(session.messages),
			pageActions: session.pageActions || [],
			status: "Voice turn saved",
			activeRequestId: null,
		});
		return {
			currentSession: buildSessionState(session),
			turn,
		};
	}

	async function runInternalTutorJsonPrompt(prompt: string, settings: RuntimeSettings, maxTokens = 900, timeoutMs = 15000, images: any[] = []) {
		const model = await getConfiguredModel(settings);
		const currentSession = await getCurrentSession().catch(() => null);
		const telemetry = {
			turnId: activeRequest?.id || crypto.randomUUID(),
			sessionId: currentSession?.id || "",
		};
		const agent = new Agent({
			initialState: {
				systemPrompt: [
					ONHAND_SYSTEM_PROMPT,
					"Internal structured tool mode: return only the requested JSON object. No markdown, no prose outside JSON.",
				].join("\n\n"),
				model,
				tools: [],
				messages: [],
				thinkingLevel: "off",
			},
			sessionId: telemetry.sessionId || telemetry.turnId,
			transformContext: (messages) => transformFreeTierContextForModel(model, messages),
			getApiKey: (provider) => resolveApiKey(provider),
			streamFn: (streamModel: any, streamContext: any, streamOptions: any = {}) =>
				streamOnhandFast(streamModel, streamContext, {
					...streamOptions,
					onhandTelemetry: telemetry,
					onhandReasoningProfile: {
						mode: "balanced",
						setting: "auto",
						reason: "Internal realtime tutor structured tool.",
						reasoningEffort: "none",
						textVerbosity: "low",
						maxTokens,
						promptPolicy: "Return compact JSON only.",
					},
				}),
			toolExecution: "parallel",
		});
		let timer: ReturnType<typeof setTimeout> | null = null;
		let timedOut = false;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(() => {
				timedOut = true;
				agent.abort();
				resolve();
			}, timeoutMs);
		});
		await Promise.race([agent.prompt(prompt, images), timeout]);
		if (timer) clearTimeout(timer);
		if (timedOut) throw new Error("Internal realtime tutor planner timed out.");
		const failure = extractAssistantFailure(agent.state.messages);
		if (failure) throw failure;
		return extractAssistantText(agent.state.messages);
	}

	async function runRealtimePedagogicalPlanner(request: any) {
		const store = await loadStore();
		const session = store.sessions[store.currentSessionId] as RuntimeSession;
		const userQuestion = compactInternalText(request?.userQuestion || request?.user_question || request?.prompt, 600);
		if (!userQuestion) throw new Error("userQuestion is required.");
		const targetWindowId =
			typeof request?.targetWindowId === "number" && Number.isFinite(request.targetWindowId) ? request.targetWindowId : undefined;
		await runRealtimePdfHandoffIfNeeded(host, targetWindowId);
		let browserContextDetails = await renderBrowserContextDetails(host, {
			targetWindowId,
			includeReadableContent: true,
			readableMaxChars: REALTIME_READABLE_CONTEXT_MAX_CHARS,
			includeVisualRegionImage: promptAsksAboutVisualRegion(userQuestion),
		});
		if (!browserContextDetails.visualRegion && shouldCaptureVisualRegionForPrompt(userQuestion, browserContextDetails)) {
			browserContextDetails = await renderBrowserContextDetails(host, {
				targetWindowId,
				includeReadableContent: true,
				readableMaxChars: REALTIME_READABLE_CONTEXT_MAX_CHARS,
				includeVisualRegionImage: true,
			});
		}
		const browserContext = browserContextDetails.text;
		const anchorCandidates = buildPlannerAnchorCandidates({
			userQuestion,
			selection: browserContextDetails.selection,
			visible: browserContextDetails.visible,
			extracted: browserContextDetails.extracted,
			browserContext,
		});
		const recentConversation = buildRecentConversationContext(session);
		const learnerState = setLearnerStateMode(session.learnerState, "learning");
		let raw = "";
		try {
			raw = await runInternalTutorJsonPrompt(
				buildRealtimePlannerPrompt({
					userQuestion,
					browserContext,
					anchorCandidates,
					recentConversation,
					learnerState,
				}),
				store.settings,
				850,
				15000,
				buildVisualRegionPromptImages(browserContextDetails.visualRegion),
			);
		} catch (error) {
			host.log?.("internal realtime planner failed; using fallback", error);
			raw = "";
		}
		return {
			move: normalizePlannerMove(raw, { userQuestion, browserContext, anchorCandidates }),
			raw,
			model: store.settings.aiModel,
			provider: store.settings.aiProvider,
		};
	}

	async function runRealtimePedagogicalEvaluator(request: any) {
		const store = await loadStore();
		const session = store.sessions[store.currentSessionId] as RuntimeSession;
		const userResponse = compactInternalText(request?.userResponse || request?.user_response || request?.response, 800);
		if (!userResponse) throw new Error("userResponse is required.");
		const previousMove = request?.previousMove || request?.previous_move || {};
		const targetWindowId =
			typeof request?.targetWindowId === "number" && Number.isFinite(request.targetWindowId) ? request.targetWindowId : undefined;
		await runRealtimePdfHandoffIfNeeded(host, targetWindowId);
		let browserContextDetails = await renderBrowserContextDetails(host, {
			targetWindowId,
			includeVisualRegionImage: promptAsksAboutVisualRegion(userResponse),
		});
		if (!browserContextDetails.visualRegion && shouldCaptureVisualRegionForPrompt(userResponse, browserContextDetails)) {
			browserContextDetails = await renderBrowserContextDetails(host, { targetWindowId, includeVisualRegionImage: true });
		}
		const browserContext = browserContextDetails.text;
		const recentConversation = buildRecentConversationContext(session);
		const learnerState = setLearnerStateMode(session.learnerState, "learning");
		let raw = "";
		try {
			raw = await runInternalTutorJsonPrompt(
				buildRealtimeEvaluatorPrompt({
					userResponse,
					previousMove,
					browserContext,
					recentConversation,
					learnerState,
				}),
				store.settings,
				850,
				15000,
				buildVisualRegionPromptImages(browserContextDetails.visualRegion),
			);
		} catch (error) {
			host.log?.("internal realtime evaluator failed; using fallback", error);
			raw = "";
		}
		return {
			evaluation: normalizeEvaluatorMove(raw, { userResponse, previousMove }),
			raw,
			model: store.settings.aiModel,
			provider: store.settings.aiProvider,
		};
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

	function shouldAutoPersistReviewSnapshot(request: any) {
		if (!request || request.aborted) return false;
		if (Array.isArray(request.artifactIds) && request.artifactIds.length > 0) return false;
		return Array.isArray(request.pageActions) && request.pageActions.some(isReviewableAnnotationAction);
	}

	async function autoPersistReviewSnapshot(session: RuntimeSession, request: any, finalError: Error | null) {
		if (finalError || !shouldAutoPersistReviewSnapshot(request)) return;
		try {
			const labelBase = session.name || request.displayPrompt || "Onhand review snapshot";
			const result = await captureArtifact({
				persist: true,
				includeHtml: true,
				includeScreenshot: true,
				label: `Review snapshot: ${truncate(labelBase, 96)}`,
			});
			appendUniquePageAction(request.pageActions, buildPageAction("browser_capture_state", { details: result }));
		} catch (error) {
			host.log?.("automatic review snapshot capture failed", error);
		}
	}

	async function runPdfHandoffPreflight(
		params: Record<string, unknown>,
		targetWindowId: number | undefined,
		options: { activityId: string; failRequest?: boolean } = { activityId: "tool:preflight:browser_open_pdf_in_onhand_viewer" },
	) {
		if (!activeRequest) return null;
		const commandName = "open_pdf_in_onhand_viewer";
		const toolName = "browser_open_pdf_in_onhand_viewer";
		const activityId = options.activityId;
		appendActivity({
			id: activityId,
			kind: "tool",
			label: getToolStatusMessage(toolName),
			toolName,
			state: "running",
		});
		await publishState({ status: getToolStatusMessage(toolName) });
		try {
			const result = await host.runCommand(commandName, withTargetWindowId(params, targetWindowId));
			appendActivity({
				id: activityId,
				kind: "tool",
				label: getToolStatusMessage(toolName),
				toolName,
				state: "complete",
			});
			appendUniquePageAction(activeRequest.pageActions, buildPageAction(toolName, result));
			await publishState({
				pageActions: [...activeRequest.pageActions],
				status: "Reading the opened PDF...",
			});
			return result;
		} catch (error) {
			appendActivity({
				id: activityId,
				kind: "tool",
				label: getToolStatusMessage(toolName),
				toolName,
				state: "retrying",
			});
			await publishState({ status: "Trying another way to read the PDF..." });
			if (options.failRequest === false) return null;
			throw error;
		}
	}

	async function runExplicitPdfHandoffIfRequested(prompt: string, targetWindowId?: number) {
		const params = parseExplicitPdfHandoffParams(prompt);
		if (!params || !activeRequest) return null;
		return await runPdfHandoffPreflight(params, targetWindowId, {
			activityId: "tool:preflight:browser_open_pdf_in_onhand_viewer:explicit",
			failRequest: true,
		});
	}

	async function runAutomaticPdfHandoffIfNeeded(targetWindowId?: number) {
		if (!activeRequest) return null;
		let activeTab = null;
		try {
			const state = await host.snapshotState();
			activeTab = pickActiveTab(state, targetWindowId);
		} catch (error) {
			host.log?.("automatic PDF handoff snapshot failed", error);
			return null;
		}
		if (!shouldAutoOpenPdfViewerForTab(activeTab)) return null;
		try {
			return await runPdfHandoffPreflight(
				{
					active: true,
					newTab: false,
					waitForLoad: true,
					timeoutMs: 20000,
				},
				targetWindowId,
				{
					activityId: "tool:preflight:browser_open_pdf_in_onhand_viewer:auto",
					failRequest: false,
				},
			);
		} catch (error) {
			host.log?.("automatic PDF handoff failed", error);
			await publishState({ status: "Could not open PDF in Onhand viewer; reading the current page..." });
			return null;
		}
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
		await autoPersistReviewSnapshot(session, activeRequest, finalError);
		const publicActivities = finalizePublicActivities(uiState?.activities || [], finalError);
		const toolReliability = summarizeToolReliability(publicActivities, activeRequest.pageActions || []);
		const errorReport = finalError ? buildErrorReportSnapshot(finalError, activeRequest, publicActivities) : null;
		updateAssistantDraft(requestId, reply, { pending: false, error: Boolean(finalError) });
		const turn: UiTurn = {
			id: requestId,
			userPrompt: activeRequest.displayPrompt,
			reply,
			activities: publicActivities,
			pageActions: [...activeRequest.pageActions],
			pending: false,
			error: Boolean(finalError),
			createdAt: activeRequest.createdAt,
			...(errorReport ? { errorReport } : {}),
		};
		session.turns = [...(session.turns || []), turn];
		session.messages = createStoredConversationMessages(session.turns);
		session.pageActions = [...activeRequest.pageActions];
		session.artifactIds = Array.from(new Set([...(session.artifactIds || []), ...(activeRequest.artifactIds || [])]));
		if (!finalError && !activeRequest.aborted && activeRequest.learningMode) {
			session.learnerState = withFallbackOpenCheck(session.learnerState, reply, activeRequest.createdAt);
		}
		await replaceCurrentSession(session);
		await publishState({
			currentSession: buildSessionState(session),
			turns: session.turns,
			messages: buildConversationMessages(session.messages),
			activities: [...turn.activities],
			pageActions: [...activeRequest.pageActions],
			learnerState: session.learnerState,
			status: finalError ? "Prompt failed" : activeRequest.aborted ? "Stopped" : "Reply ready",
			activeRequestId: null,
		});
		const startedAtMs = Date.parse(activeRequest.createdAt || "");
		const telemetryEventName = activeRequest.aborted ? "prompt_stopped" : finalError ? "prompt_failed" : "prompt_succeeded";
		void trackExtensionEvent(telemetryEventName, {
			result: activeRequest.aborted ? "stopped" : finalError ? "error" : "ok",
			duration_ms: Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0,
			action_count: activeRequest.pageActions?.length || 0,
			artifact_count: activeRequest.artifactIds?.length || 0,
			...toolReliability,
			error_kind: finalError ? classifyTelemetryError(finalError) : "",
		}).catch(() => {});
		if (finalError) {
			captureSentryException(finalError, activeRequest.settings as RuntimeSettings, "prompt_failed", {
				error_kind: classifyTelemetryError(finalError),
				duration_ms: Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0,
				action_count: activeRequest.pageActions?.length || 0,
				artifact_count: activeRequest.artifactIds?.length || 0,
				...toolReliability,
			});
		}
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
					void publishState({ status: "Thinking..." });
				}
				break;
			}
			case "tool_execution_start": {
				const toolName = (event as any).toolName || "";
				if (isInternalToolName(toolName)) {
					void publishState({ status: getToolStatusMessage(toolName) });
					break;
				}
				appendActivity({
					id: `tool:${(event as any).toolCallId || toolName}`,
					kind: "tool",
					label: getToolStatusMessage(toolName),
					toolName,
					state: "running",
				});
				if (toolName === "browser_run_js") {
					void trackExtensionEvent("browser_run_js_started", { result: "started" }).catch(() => {});
				}
				void publishState({ status: getToolStatusMessage(toolName) });
				break;
			}
			case "tool_execution_end": {
				const toolName = (event as any).toolName || "";
				if (isInternalToolName(toolName)) {
					void publishState({ status: (event as any).isError ? "Trying a different approach..." : "Writing answer..." });
					break;
				}
				const activityId = `tool:${(event as any).toolCallId || toolName}`;
				if ((event as any).isError) {
					appendActivity({
						id: activityId,
						kind: "tool",
						label: getToolStatusMessage(toolName),
						toolName,
						state: "retrying",
					});
					if (toolName === "browser_run_js") {
						void trackExtensionEvent("browser_run_js_failed", { result: "error" }).catch(() => {});
					}
					void publishState({ status: "Trying a different approach..." });
				} else {
					markRecoveredToolRetries(uiState?.activities || [], toolName);
					appendActivity({
						id: activityId,
						kind: "tool",
						label: getToolStatusMessage(toolName),
						toolName,
						state: "complete",
					});
					appendUniquePageAction(activeRequest.pageActions, buildPageAction(toolName, (event as any).result));
					if (toolName === "browser_run_js") {
						void trackExtensionEvent("browser_run_js_succeeded", { result: "ok" }).catch(() => {});
					}
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
				: settings.aiProvider === ONHAND_FREE_PROVIDER
					? await buildFreeTierModel()
					: (await host.resolveModel?.(settings.aiProvider, settings.aiModel)) ||
						getModel(settings.aiProvider as any, settings.aiModel as any) ||
						(settings.aiProvider === OPENROUTER_API_PROVIDER && settings.aiModel ? buildOpenRouterFallbackModel(settings.aiModel) : null);
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
		} else if (!getSupportedApiProvider(settings.aiProvider)?.keyless && !getApiKeyForProvider(settings, settings.aiProvider)) {
			throw new Error(getMissingApiKeyError(settings.aiProvider));
		}
		return prepareModelForBrowser(model, settings);
	}

	async function resolveApiKey(provider: string) {
		if (provider === ONHAND_FREE_PROVIDER) return await getOrRegisterFreeTierToken();
		const store = await loadStore();
		const settings = store.settings as RuntimeSettings;
		const apiKey = getApiKeyForProvider(settings, provider);
		if (apiKey) return apiKey;
		if (provider === settings.aiProvider && settings.authMode === "api-key") {
			throw new Error(getMissingApiKeyError(provider));
		}
		if (provider !== settings.aiProvider) return undefined;
		if (settings.authMode !== "oauth") return undefined;
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
			await saveStore(store, {});
			await publishState({
				preferences: {
					runtime: "browser-extension",
					...buildPublicSettings(settings),
				},
			});
		}
		return result.apiKey;
	}

	function withDefaultBrowserTarget(params: any = {}) {
		const targetWindowId = activeRequest?.targetWindowId;
		if (typeof targetWindowId !== "number") return params || {};
		if (typeof params?.tabId === "number") {
			return params || {};
		}
		return {
			...(params || {}),
			windowId: targetWindowId,
		};
	}

	function withRequestBrowserContext(params: any = {}, commandName = "") {
		const targetedParams = withDefaultBrowserTarget(params);
		if (commandName !== "highlight_text" || targetedParams?.pdfAnchor) return targetedParams;
		const initialSelection = activeRequest?.initialSelection;
		if (!selectionMatchesHighlightText(initialSelection, targetedParams?.text)) return targetedParams;
		return {
			...(targetedParams || {}),
			pdfAnchor: initialSelection.pdfAnchor,
		};
	}

	async function clearActivePageAnnotations(targetWindowId?: number) {
		try {
			const state = await host.snapshotState();
			const activeTab = pickActiveTab(state, targetWindowId);
			if (!isRestorablePageTab(activeTab)) return false;
			await host.runCommand("clear_annotations", { tabId: activeTab.id });
			return true;
		} catch (error) {
			host.log?.("session boundary annotation clear failed", error);
			return false;
		}
	}

	async function getPublicSettings() {
		const store = await loadStore();
		return buildPublicSettings(store.settings);
	}

	async function getDueReviews(params: any = {}) {
		const store = await loadStore();
		const snoozes = await readReviewSnoozes();
		let activeUrl = "";
		try {
			const state = await host.snapshotState();
			const activeTab = pickActiveTab(state, typeof params?.targetWindowId === "number" ? params.targetWindowId : undefined);
			activeUrl = String(activeTab?.url || "");
		} catch {}
		return computeDueReviews(Object.values(store.sessions) as RuntimeSession[], {
			now: params?.now,
			limit: params?.limit,
			activeUrl,
			snoozes,
		});
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
		const captureParams = withDefaultBrowserTarget(params);
		const capture = await host.runCommand("capture_state", captureParams);
		const tab = capture?.tab || null;
		const page = capture?.page || null;
		let persistedArtifact: any = null;
		if (params?.persist) {
			let outerHTML: string | null = null;
			let screenshotDataUrl: string | null = null;
			if (params.includeHtml === true) {
				try {
					const dom = await host.runCommand("get_dom", { ...captureParams, tabId: tab?.id || captureParams.tabId });
					outerHTML = typeof dom?.outerHTML === "string" ? dom.outerHTML : null;
				} catch (error) {
					host.log?.("artifact HTML capture failed", error);
				}
			}
			if (params.includeScreenshot === true) {
				try {
					const screenshot = await host.runCommand("capture_screenshot", { ...captureParams, tabId: tab?.id || captureParams.tabId });
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
		const url = artifactEffectiveUrl(artifact);
		const title = String(artifact.page?.title || artifact.tab?.title || "").trim().toLowerCase();
		if (typeof params.tabId === "number") {
			const explicitTab = tabs.find((tab) => tab.id === params.tabId);
			if (explicitTab && (!url && !title ? isRestorablePageTab(explicitTab) : tabMatchesSavedTarget(explicitTab, url, title))) {
				return explicitTab;
			}
		}
		const eligibleTabs = tabs.filter(isRestorablePageTab);
		return (
			eligibleTabs.find((tab) => url && restorablePageUrlsMatch(tab.url, url)) ||
			eligibleTabs.find((tab) => !url && title && String(tab.title || "").toLowerCase() === title) ||
			null
		);
	}

	function artifactRestoreTargetKey(artifact: BrowserArtifact, artifactId = "") {
		const url = restorablePageUrlMatchKey(artifactEffectiveUrl(artifact));
		if (url) return `url:${url}`;
		const title = String(artifact.page?.title || artifact.tab?.title || "").trim().toLowerCase();
		if (title) return `title:${title}`;
		return `artifact:${artifactId || artifact.id}`;
	}

	async function latestArtifactIdsByTarget(artifactIds: string[]) {
		const latestByTarget = new Map<string, string>();
		for (const artifactId of artifactIds) {
			const id = String(artifactId || "").trim();
			if (!id) continue;
			const artifact = await getBrowserArtifact(id);
			if (!artifact) {
				latestByTarget.set(`missing:${id}`, id);
				continue;
			}
			latestByTarget.set(artifactRestoreTargetKey(artifact, id), id);
		}
		return [...latestByTarget.values()];
	}

	function artifactHasPdfAnnotations(artifact: BrowserArtifact, annotations: any[]) {
		return annotations.some((annotation) => annotation?.pdfAnchor?.surface === "pdf" || annotation?.kind === "pdf");
	}

	function artifactLooksLikePdfViewer(artifact: BrowserArtifact) {
		const url = String(artifact.page?.url || artifact.tab?.url || "");
		return /\/pdf-viewer\.html(?:[?#]|$)/i.test(url) || /[?&](?:url|file|pdf|src)=[^#]*\.pdf/i.test(url) || isLikelyPdfUrlForAutoHandoff(url);
	}

	async function waitForPdfRestoreSurface(tabId: number, artifact: BrowserArtifact, annotations: any[]) {
		if (!artifactHasPdfAnnotations(artifact, annotations) && !artifactLooksLikePdfViewer(artifact)) return;
		try {
			await host.runCommand("open_pdf_in_onhand_viewer", {
				tabId,
				active: true,
				newTab: false,
				waitForLoad: true,
				timeoutMs: 20000,
			});
		} catch (error) {
			host.log?.("PDF restore viewer handoff failed", error);
		}
		const selector = [
			'[data-onhand-inline-pdf-viewer="true"]',
			'body[data-onhand-pdf-rendered="true"]',
			'[data-onhand-pdf-page="true"]',
			'[data-onhand-pdf-text-layer="true"]',
			'.pdfViewer .page[data-page-number] .textLayer',
			'.gsr-page[data-pn] .gsr-text-ctn',
		].join(", ");
		try {
			await host.runCommand("wait_for_selector", {
				tabId,
				selector,
				timeoutMs: 12000,
				visible: false,
			});
		} catch (error) {
			host.log?.("PDF restore surface readiness wait failed", error);
		}
	}

	async function restoreArtifact(params: any = {}) {
		const artifact = await getBrowserArtifact(params.artifactId);
		if (!artifact) throw new Error(`Could not find Onhand artifact: ${params.artifactId || "(blank)"}`);
		const state = await host.snapshotState();
		const tabs = flattenTabs(state);
		let tab = findArtifactTab(tabs, artifact, params);
		// Match viewer artifacts by their source PDF, but reopen them through
		// the current extension's viewer. Opening Google Docs exports directly
		// can trigger a browser download before Onhand can wrap the PDF.
		const url = artifactEffectiveUrl(artifact);
		const openUrl = artifactOpenUrl(artifact);
		if (!tab) {
			if (params.openIfNeeded === false || !url) {
				throw new Error(`No matching tab is open for artifact ${artifact.id}.`);
			}
			const navigated = await host.runCommand("navigate", { url: openUrl || url, newTab: true, waitForLoad: true });
			tab = navigated?.tab || navigated;
		} else {
			const activated = await host.runCommand("activate_tab", { tabId: tab.id });
			tab = activated?.tab || tab;
			}
			if (!isRestorablePageTab(tab)) {
				throw new Error(`Artifact ${artifact.id} resolved to a non-web tab and was not restored.`);
			}
			const tabId = tab?.id;
			if (typeof tabId !== "number") throw new Error("Could not resolve a tab for artifact restore.");
			const annotations = Array.isArray(artifact.page?.annotations) ? artifact.page.annotations : [];
			const failures: string[] = [];
			await waitForPdfRestoreSurface(tabId, artifact, annotations);
			if (annotations.length > 0 && (typeof artifact.page?.scrollY === "number" || typeof artifact.page?.scrollX === "number" || artifact.page?.scrollContainer)) {
				await restoreReplayScrollPosition(tabId, artifact.page?.scrollX, artifact.page?.scrollY, artifact.page?.scrollContainer).catch((error) => {
					host.log?.("artifact pre-highlight scroll restore failed", error);
				});
			}
			if (params.clearExisting !== false && annotations.length > 0) {
				try {
					await host.runCommand("clear_annotations", { tabId });
				} catch (error: any) {
					failures.push(error?.message || String(error));
				}
			}
			let restoredAnnotations = 0;
			let restoredNotes = 0;
			const restoredTargets: any[] = [];
			for (const annotation of annotations) {
				const text = String(annotation?.matchedText || "").trim();
				if (!text) continue;
				try {
					const highlighted = await highlightTextWithReplayCandidates(tabId, text, { scrollIntoView: false, pdfAnchor: annotation?.pdfAnchor, scanPage: true });
				restoredAnnotations += 1;
				const noteText = String(annotation?.note?.text || "").trim();
				const annotationId = highlighted?.annotation?.annotationId;
				restoredTargets.push({
					annotationId: String(annotation?.annotationId || ""),
					matchedText: text,
					noteText,
					title: artifact.page?.title || artifact.tab?.title || tab?.title || "",
					url: artifact.page?.url || artifact.tab?.url || tab?.url || "",
					pdfAnchor: annotation?.pdfAnchor || highlighted?.annotation?.pdfAnchor || null,
					restoredAnnotation: highlighted?.annotation || null,
				});
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
					host.log?.("artifact restore highlight failed", artifactEffectiveUrl(artifact), String(text).slice(0, 60), error?.message || String(error));
					failures.push(error?.message || String(error));
				}
			}
			if (annotations.length > 0 && (typeof artifact.page?.scrollY === "number" || typeof artifact.page?.scrollX === "number" || artifact.page?.scrollContainer)) {
				await restoreReplayScrollPosition(tabId, artifact.page?.scrollX, artifact.page?.scrollY, artifact.page?.scrollContainer).catch((error) => {
					host.log?.("artifact scroll restore failed", error);
					if (isOnhandPdfViewerAccessError(error)) return;
					failures.push(error?.message || String(error));
				});
			}
		return {
			tab,
			artifact,
			artifactId: artifact.id,
			restoredAnnotations,
			restoredNotes,
			restoredTargets,
			failures,
		};
	}

	function replayTargetKey(annotation: ReplayAnnotation) {
		const url = restorablePageUrlMatchKey(annotation.url);
		if (url) return `url:${url}`;
		const pdfUrl = pdfAnchorDocumentUrlKey(annotation.pdfAnchor);
		if (pdfUrl) return `url:${pdfUrl}`;
		if (annotation.title) return `title:${annotation.title.toLowerCase()}`;
		if (typeof annotation.tabId === "number") return `tab:${annotation.tabId}`;
		return "active";
	}

	function findReplayTab(tabs: any[], annotation: ReplayAnnotation) {
		const url = String(annotation.url || "").trim();
		const title = String(annotation.title || "").trim().toLowerCase();
		if (typeof annotation.tabId === "number") {
			const matchedTab = tabs.find((tab) => tab.id === annotation.tabId);
			if (matchedTab && (!url && !title ? isRestorablePageTab(matchedTab) : tabMatchesSavedTarget(matchedTab, url, title))) {
				return matchedTab;
			}
		}
		const eligibleTabs = tabs.filter(isRestorablePageTab);
		return (
			eligibleTabs.find((tab) => url && restorablePageUrlsMatch(tab.url, url)) ||
			eligibleTabs.find((tab) => !url && title && String(tab.title || "").toLowerCase() === title) ||
			null
		);
	}

	function findActionTab(tabs: any[], action: PageAction) {
		const url = String(action.url || "").trim();
		const title = String(action.title || "").trim().toLowerCase();
		if (typeof action.tabId === "number") {
			const matchedTab = tabs.find((tab) => tab.id === action.tabId);
			if (matchedTab && (!url && !title ? isRestorablePageTab(matchedTab) : tabMatchesSavedTarget(matchedTab, url, title))) {
				return matchedTab;
			}
		}
		const eligibleTabs = tabs.filter(isRestorablePageTab);
		return (
			eligibleTabs.find((tab) => url && restorablePageUrlsMatch(tab.url, url)) ||
			eligibleTabs.find((tab) => !url && title && String(tab.title || "").toLowerCase() === title) ||
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
					...(annotation.pdfAnchor ? { pdfAnchor: annotation.pdfAnchor } : {}),
					note: annotation.noteText ? { text: annotation.noteText, label: annotation.noteLabel || "Onhand" } : null,
				})),
			},
		};
	}

	function replayScrollRootsScript() {
		return `
			const collectRestoreScrollRoots = () => {
				const roots = [];
				const seen = new Set();
				const viewportHeight = Math.max(1, Number(window.innerHeight || 0));
				const viewportWidth = Math.max(1, Number(window.innerWidth || 0));
				const addWindow = () => {
					const scrollHeight = Math.max(
						Number(document.documentElement?.scrollHeight || 0),
						Number(document.body?.scrollHeight || 0)
					);
					const scrollWidth = Math.max(
						Number(document.documentElement?.scrollWidth || 0),
						Number(document.body?.scrollWidth || 0)
					);
					roots.push({
						type: "window",
						source: "window",
						scrollTop: Number(window.scrollY || window.pageYOffset || 0),
						scrollLeft: Number(window.scrollX || window.pageXOffset || 0),
						scrollHeight,
						scrollWidth,
						clientHeight: viewportHeight,
						clientWidth: viewportWidth,
						maxY: Math.max(0, scrollHeight - viewportHeight),
						maxX: Math.max(0, scrollWidth - viewportWidth),
						score: Math.max(0, scrollHeight - viewportHeight) + 1000
					});
				};
				const addElement = (element, source) => {
					if (!element || seen.has(element)) return;
					seen.add(element);
					const scrollTop = Number(element.scrollTop || 0);
					const scrollLeft = Number(element.scrollLeft || 0);
					const scrollHeight = Number(element.scrollHeight || 0);
					const scrollWidth = Number(element.scrollWidth || 0);
					const clientHeight = Number(element.clientHeight || 0);
					const clientWidth = Number(element.clientWidth || 0);
					const maxY = Math.max(0, scrollHeight - clientHeight);
					const maxX = Math.max(0, scrollWidth - clientWidth);
					if (maxY < 120 && maxX < 120) return;
					let rect = { top: 0, bottom: viewportHeight, width: clientWidth, height: clientHeight };
					try { rect = element.getBoundingClientRect(); } catch {}
					let overflowBonus = 0;
					try {
						const style = getComputedStyle(element);
						if (/(auto|scroll|overlay)/.test(style.overflowY || "") && maxY > 0) overflowBonus += 1200;
						if (/(auto|scroll|overlay)/.test(style.overflowX || "") && maxX > 0) overflowBonus += 400;
					} catch {}
					const visible = rect.bottom > 0 && rect.top < viewportHeight && rect.width > 80 && rect.height > 80;
					if (source === "scrollable-element" && (!visible || clientHeight < 120 || clientWidth < 120)) return;
					const activeBonus = scrollTop > 0 || scrollLeft > 0 ? 2000 : 0;
					roots.push({
						type: "element",
						source,
						element,
						scrollTop,
						scrollLeft,
						scrollHeight,
						scrollWidth,
						clientHeight,
						clientWidth,
						maxY,
						maxX,
						score: maxY + maxX * 0.25 + clientHeight * 0.5 + overflowBonus + activeBonus
					});
				};
				addWindow();
				addElement(document.scrollingElement, "document-scrolling-element");
				addElement(document.documentElement, "document-element");
				addElement(document.body, "document-body");
				const elements = Array.from(document.querySelectorAll("*")).slice(0, 8000);
				for (const element of elements) {
					if (!(element instanceof Element)) continue;
					const maxY = Number(element.scrollHeight || 0) - Number(element.clientHeight || 0);
					const maxX = Number(element.scrollWidth || 0) - Number(element.clientWidth || 0);
					if (maxY < 200 && maxX < 200) continue;
					let canScroll = false;
					try {
						const style = getComputedStyle(element);
						canScroll = /(auto|scroll|overlay)/.test(String(style.overflowY || "") + " " + String(style.overflowX || ""));
					} catch {}
					if (canScroll || Number(element.scrollTop || 0) > 0 || Number(element.scrollLeft || 0) > 0) {
						addElement(element, "scrollable-element");
					}
				}
				return roots
					.sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
					.slice(0, 16);
			};
		`;
	}

	function replayScrollPositionExpression(scrollX: unknown, scrollY: unknown, scrollContainer?: any) {
		const x = Number.isFinite(Number(scrollContainer?.scrollLeft)) ? Math.max(0, Math.floor(Number(scrollContainer.scrollLeft))) :
			Number.isFinite(Number(scrollX)) ? Math.max(0, Math.floor(Number(scrollX))) : 0;
		const y = Number.isFinite(Number(scrollContainer?.scrollTop)) ? Math.max(0, Math.floor(Number(scrollContainer.scrollTop))) :
			Number.isFinite(Number(scrollY)) ? Math.max(0, Math.floor(Number(scrollY))) : 0;
		return `(() => new Promise((resolve) => {
			const targetX = ${x};
			const targetY = ${y};
			${replayScrollRootsScript()}
			const roots = collectRestoreScrollRoots();
			window.scrollTo(targetX, targetY);
			for (const root of roots) {
				try {
					if (root.type === "window") {
						window.scrollTo(Math.min(root.maxX || targetX, targetX), Math.min(root.maxY || targetY, targetY));
					} else if (root.element) {
						root.element.scrollLeft = Math.min(root.maxX || targetX, targetX);
						root.element.scrollTop = Math.min(root.maxY || targetY, targetY);
					}
				} catch {}
			}
			requestAnimationFrame(() => setTimeout(() => resolve({
				scrollX: Math.max(window.scrollX || 0, ...roots.map((root) => Number(root.element?.scrollLeft || root.scrollLeft || 0))),
				scrollY: Math.max(window.scrollY || 0, ...roots.map((root) => Number(root.element?.scrollTop || root.scrollTop || 0))),
				scrollHeight: Math.max(0, ...roots.map((root) => Number(root.scrollHeight || 0))),
				innerHeight: Math.max(window.innerHeight || 0, ...roots.map((root) => Number(root.clientHeight || 0))),
				maxY: Math.max(0, ...roots.map((root) => Number(root.maxY || 0)))
			}), 120));
		}))()`;
	}

	async function restoreReplayScrollPosition(tabId: number, scrollX: unknown, scrollY: unknown, scrollContainer?: any) {
		if (!Number.isFinite(Number(scrollX)) && !Number.isFinite(Number(scrollY)) && !scrollContainer) return null;
		return await host.runCommand("run_js", {
			tabId,
			expression: replayScrollPositionExpression(scrollX, scrollY, scrollContainer),
		});
	}

	async function readReplayScrollMetrics(tabId: number) {
		const response = await host.runCommand("run_js", {
			tabId,
			expression: `(() => {
				${replayScrollRootsScript()}
				const roots = collectRestoreScrollRoots();
				const scrollY = Math.max(window.scrollY || 0, ...roots.map((root) => Number(root.element?.scrollTop || root.scrollTop || 0)));
				const scrollX = Math.max(window.scrollX || 0, ...roots.map((root) => Number(root.element?.scrollLeft || root.scrollLeft || 0)));
				const scrollHeight = Math.max(0, ...roots.map((root) => Number(root.scrollHeight || 0)));
				const innerHeight = Math.max(window.innerHeight || 0, ...roots.map((root) => Number(root.clientHeight || 0)));
				const maxY = Math.max(0, ...roots.map((root) => Number(root.maxY || 0)));
				return {
					scrollX,
					scrollY,
					innerHeight,
					scrollHeight,
					maxY
				};
			})()`,
		});
		const result = response?.result || {};
		return {
			scrollX: Number(result.scrollX || 0),
			scrollY: Number(result.scrollY || 0),
			innerHeight: Number(result.innerHeight || 0),
			scrollHeight: Number(result.scrollHeight || 0),
			maxY: Number(result.maxY || 0),
		};
	}

	function replayScrollScanPositions(metrics: { scrollY?: number; innerHeight?: number; maxY?: number }) {
		const maxY = Math.max(0, Number(metrics.maxY || 0));
		if (!Number.isFinite(maxY) || maxY < 200) return [];
		const viewport = Math.max(300, Number(metrics.innerHeight || 0) || 800);
		const steps = Math.max(6, Math.min(18, Math.ceil(maxY / Math.max(1, viewport * 0.75))));
		const positions = [Number(metrics.scrollY || 0), 0, maxY];
		for (let index = 0; index <= steps; index += 1) {
			positions.push(Math.round((maxY * index) / steps));
		}
		const unique: number[] = [];
		for (const position of positions) {
			const normalized = Math.max(0, Math.min(maxY, Math.round(Number(position) || 0)));
			if (!unique.some((existing) => Math.abs(existing - normalized) < 80)) unique.push(normalized);
		}
		return unique;
	}

	async function tryReplayHighlightCandidates(tabId: number, candidates: string[], options: any = {}) {
		let lastError: any = null;
		for (const candidate of candidates) {
			try {
				const result = await host.runCommand("highlight_text", {
					tabId,
					text: candidate,
					clearExisting: false,
					scrollIntoView: options.scrollIntoView !== false,
					exactOnly: true,
					allowApproximate: false,
					reuseExisting: true,
				});
				return { result, lastError: null };
			} catch (error) {
				lastError = error;
			}
		}
		return { result: null, lastError };
	}

	function visibleReplayTextCandidatesExpression(text: string) {
		const query = JSON.stringify(compactActionText(text));
		return `(() => {
			const restoreProbe = "visible-replay-text-candidates";
			const rawQuery = ${query};
			const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
			const searchNormalize = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
			const stopWords = new Set("a an and are as at be but by can could does for from has have if in into is it its of on or should that the this to when where which why with would your".split(" "));
			const querySearch = searchNormalize(rawQuery);
			const queryTokens = querySearch.split(" ").filter((token) => token.length >= 3 && !stopWords.has(token));
			if (!querySearch || !queryTokens.length) return { candidates: [] };
			const queryWords = querySearch.split(" ").filter(Boolean);
			const phraseWindows = [];
			for (const size of [6, 5, 4, 3]) {
				for (let index = 0; index <= queryWords.length - size; index += 1) {
					const phrase = queryWords.slice(index, index + size).join(" ");
					if (phrase.length >= 16) phraseWindows.push(phrase);
				}
			}
			const excludedSelector = [
				"script",
				"style",
				"noscript",
				"textarea",
				"input",
				"[data-onhand-pdf-overlay-layer]",
				"[data-onhand-pdf-segment-kind]",
				"[data-onhand-highlight-kind]",
				"[data-onhand-note-kind]",
				"[data-onhand-note-part]",
				"[contenteditable='true']",
				"[contenteditable=true]",
				"nav",
				"aside",
				"header",
				"footer",
				"[role='navigation']",
				"[role='menubar']",
				"[role='menu']",
				"[role='toolbar']"
			].join(",");
			const isVisible = (element) => {
				if (!(element instanceof Element)) return false;
				if (element.closest(excludedSelector)) return false;
				const rect = element.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
				const style = getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
				return true;
			};
			const scoreText = (value) => {
				const normalized = normalize(value);
				if (normalized.length < 12) return 0;
				const search = searchNormalize(normalized);
				if (!search) return 0;
				let score = 0;
				if (search.includes(querySearch)) score += 1600;
				if (querySearch.includes(search) && search.length >= 16) score += 1200 + Math.min(search.length, 120);
				for (const phrase of phraseWindows) {
					if (search.includes(phrase)) score += 650 + phrase.length;
				}
				const tokenSet = new Set(search.split(" ").filter((token) => token.length >= 3));
				let overlap = 0;
				for (const token of queryTokens) {
					if (tokenSet.has(token)) overlap += 1;
				}
				score += overlap * 120;
				if (overlap < 2 && score < 1000) return 0;
				return score;
			};
			const candidates = [];
			const seen = new Set();
			const addCandidate = (value, source) => {
				let normalized = normalize(value);
				if (normalized.length < 12) return;
				const score = scoreText(normalized);
				if (score <= 0) return;
				if (normalized.length > 260) {
					const search = searchNormalize(normalized);
					const phrase = phraseWindows.find((candidate) => search.includes(candidate)) || "";
					const phraseIndex = phrase ? search.indexOf(phrase) : -1;
					if (phraseIndex >= 0) {
						const approxRatio = Math.max(0, Math.min(1, phraseIndex / Math.max(1, search.length)));
						const start = Math.max(0, Math.floor(normalized.length * approxRatio) - 90);
						normalized = normalized.slice(start, start + 220).replace(/^\\S{1,30}\\s+/, "").replace(/\\s+\\S{1,30}$/, "").trim();
					} else {
						normalized = normalized.slice(0, 220).trim();
					}
				}
				if (normalized.length < 12) return;
				const key = normalized.toLowerCase();
				if (seen.has(key)) return;
				seen.add(key);
				candidates.push({ text: normalized, score, source });
			};
			const stack = [document.body];
			let visited = 0;
			while (stack.length && visited < 16000) {
				const node = stack.pop();
				visited += 1;
				if (!node) continue;
				if (node.nodeType === 3) {
					const parent = node.parentElement;
					if (isVisible(parent)) addCandidate(node.nodeValue, "text-node");
					continue;
				}
				if (node.nodeType !== 1) continue;
				if (node instanceof Element && node.closest(excludedSelector)) continue;
				const children = node.childNodes ? Array.from(node.childNodes) : [];
				for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
			}
			for (const element of Array.from(document.querySelectorAll("p, li, blockquote, pre, code, figcaption, td, th, span")).slice(0, 3000)) {
				if (!isVisible(element)) continue;
				addCandidate(element.innerText || element.textContent || "", "element");
			}
			candidates.sort((left, right) => right.score - left.score || left.text.length - right.text.length);
			return { candidates: candidates.slice(0, 8).map((candidate) => candidate.text) };
		})()`;
	}

	async function tryVisibleReplayTextCandidates(tabId: number, text: string, options: any = {}) {
		let response: any = null;
		try {
			response = await host.runCommand("run_js", {
				tabId,
				expression: visibleReplayTextCandidatesExpression(text),
			});
		} catch (error) {
			return { result: null, lastError: error };
		}
		const rawCandidates = Array.isArray(response?.result?.candidates) ? response.result.candidates : [];
		const candidates: string[] = [];
		for (const candidate of rawCandidates) {
			addReplayExactCandidate(candidates, compactActionText(candidate));
		}
		if (!candidates.length) return { result: null, lastError: null };
		return await tryReplayHighlightCandidates(tabId, candidates, options);
	}

	function replaySourcePresenceExpression(text: string) {
		const query = JSON.stringify(stripReplayCitationMarkers(compactActionText(text)));
		return `(() => {
			const restoreProbe = "replay-source-presence";
			const rawQuery = ${query};
			const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
			const searchNormalize = (value) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
			const stopWords = new Set("a an and are as at be but by can could does for from has have if in into is it its of on or should that the this to when where which why with would your".split(" "));
			const querySearch = searchNormalize(rawQuery);
			const queryTokens = querySearch.split(" ").filter((token) => token.length >= 3 && !stopWords.has(token));
			const bodySearch = searchNormalize(document.body?.innerText || document.body?.textContent || "");
			if (!querySearch || !bodySearch || !queryTokens.length) return { present: false, reason: "empty" };
			if (bodySearch.includes(querySearch)) return { present: true, reason: "exact" };
			const queryWords = querySearch.split(" ").filter(Boolean);
			for (const size of [8, 6, 5, 4]) {
				for (let index = 0; index <= queryWords.length - size; index += 1) {
					const phrase = queryWords.slice(index, index + size).join(" ");
					if (phrase.length >= 18 && bodySearch.includes(phrase)) {
						return { present: true, reason: "phrase", phrase };
					}
				}
			}
			const bodyTokens = new Set(bodySearch.split(" ").filter((token) => token.length >= 3));
			let overlap = 0;
			for (const token of queryTokens) {
				if (bodyTokens.has(token)) overlap += 1;
			}
			const requiredOverlap = Math.max(3, Math.min(8, Math.ceil(queryTokens.length * 0.35)));
			return { present: overlap >= requiredOverlap, reason: "token-overlap", overlap, requiredOverlap };
		})()`;
	}

	async function replayMissingSourceError(tabId: number, text: string) {
		const sourceText = stripReplayCitationMarkers(compactActionText(text));
		if (!sourceText) return null;
		try {
			const response = await host.runCommand("run_js", {
				tabId,
				expression: replaySourcePresenceExpression(sourceText),
			});
			if (response?.result?.present === false) {
				return new Error(`Saved source text is not currently loaded in this page: ${truncate(sourceText, 96)}`);
			}
		} catch {
			return null;
		}
		return null;
	}

	async function scanPageForReplayHighlight(tabId: number, candidates: string[], options: any = {}) {
		let metrics: Awaited<ReturnType<typeof readReplayScrollMetrics>>;
		try {
			metrics = await readReplayScrollMetrics(tabId);
		} catch (error) {
			return { result: null, lastError: error };
		}
		let lastError: any = null;
		for (const y of replayScrollScanPositions(metrics)) {
			try {
				await host.runCommand("run_js", {
					tabId,
					expression: replayScrollPositionExpression(metrics.scrollX || 0, y),
				});
			} catch (error) {
				lastError = error;
				continue;
			}
			const attempt = await tryReplayHighlightCandidates(tabId, candidates, options);
			if (attempt.result) return attempt;
			lastError = attempt.lastError || lastError;
			if (options.fallbackText) {
				const visibleAttempt = await tryVisibleReplayTextCandidates(tabId, options.fallbackText, options);
				if (visibleAttempt.result) return visibleAttempt;
				lastError = visibleAttempt.lastError || lastError;
			}
		}
		return { result: null, lastError };
	}

	async function highlightTextWithReplayCandidates(tabId: number, text: string, options: any = {}) {
		let lastError: any = null;
		if (options.pdfAnchor) {
			try {
				return await host.runCommand("highlight_text", {
					tabId,
					text: compactActionText(text || options.pdfAnchor?.matchedText || options.pdfAnchor?.textQuote?.exact || ""),
					clearExisting: false,
					scrollIntoView: options.scrollIntoView !== false,
					exactOnly: true,
					allowApproximate: false,
					reuseExisting: true,
					pdfAnchor: options.pdfAnchor,
				});
			} catch (error) {
				lastError = error;
			}
		}
		const candidates: string[] = [];
		addReplayExactCandidate(candidates, compactActionText(text));
		for (const candidate of getReplayHighlightCandidates(text)) {
			if (!candidates.includes(candidate)) candidates.push(candidate);
		}
		const initialAttempt = await tryReplayHighlightCandidates(tabId, candidates, options);
		if (initialAttempt.result) return initialAttempt.result;
		lastError = initialAttempt.lastError || lastError;
		if (options.scanPage) {
			const visibleAttempt = await tryVisibleReplayTextCandidates(tabId, text, options);
			if (visibleAttempt.result) return visibleAttempt.result;
			lastError = visibleAttempt.lastError || lastError;
			const scannedAttempt = await scanPageForReplayHighlight(tabId, candidates, { ...options, fallbackText: text });
			if (scannedAttempt.result) return scannedAttempt.result;
			lastError = scannedAttempt.lastError || lastError;
			const missingSourceError = await replayMissingSourceError(tabId, text);
			if (missingSourceError) throw missingSourceError;
		}
		throw lastError || new Error(`No visible text matched: ${text}`);
	}

	async function highlightExactReplaySource(tabId: number, text: string, options: any = {}) {
		const sourceText = stripReplayCitationMarkers(compactActionText(text));
		if (!sourceText) throw new Error("Source not found on this page.");
		const candidates: string[] = [];
		addReplayExactCandidate(candidates, sourceText);
		for (const candidate of candidates) {
			try {
				return await host.runCommand("highlight_text", {
					tabId,
					text: candidate,
					clearExisting: false,
					scrollIntoView: options.scrollIntoView !== false,
					exactOnly: true,
					allowApproximate: false,
					reuseExisting: true,
					...(options.pdfAnchor ? { pdfAnchor: options.pdfAnchor } : {}),
				});
			} catch (error: any) {
				// Try the next exact spacing variant before surfacing a source miss.
			}
		}
		throw new Error(`Source not found on this page: ${sourceText}`);
	}

function isHighlightPageAction(action: PageAction | null | undefined) {
	return Boolean(
		action &&
			action.type === "annotation" &&
			(String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text"),
	);
}

function actionKeySuffix(action: PageAction | null | undefined, prefix: string) {
	const key = compactActionText(action?.key);
	return key.startsWith(prefix) ? key.slice(prefix.length) : "";
}

function pdfAnchorDocumentUrlKey(pdfAnchor: any) {
	return restorablePageUrlMatchKey(pdfAnchor?.document?.pdfUrl || pdfAnchor?.document?.url || "");
}

function pageActionDocumentKeys(action: PageAction | null | undefined) {
	const keys = [restorablePageUrlMatchKey(action?.url), pdfAnchorDocumentUrlKey(action?.pdfAnchor)].filter(Boolean);
	return Array.from(new Set(keys));
}

function replayAnnotationDocumentKeys(target: ReplayAnnotation | null | undefined) {
	const keys = [restorablePageUrlMatchKey(target?.url), pdfAnchorDocumentUrlKey(target?.pdfAnchor)].filter(Boolean);
	return Array.from(new Set(keys));
}

function documentKeysOverlap(leftKeys: string[], rightKeys: string[]) {
	if (!leftKeys.length || !rightKeys.length) return null;
	return leftKeys.some((key) => rightKeys.includes(key));
}

function actionUrlKey(action: PageAction | null | undefined) {
	return restorablePageUrlMatchKey(action?.url);
}

function actionTitleKey(action: PageAction | null | undefined) {
	return compactActionText(action?.title).toLowerCase();
}

function actionSamePage(left: PageAction | null | undefined, right: PageAction | null | undefined) {
	const documentMatch = documentKeysOverlap(pageActionDocumentKeys(left), pageActionDocumentKeys(right));
	if (documentMatch != null) return documentMatch;
	const leftTitle = actionTitleKey(left);
	const rightTitle = actionTitleKey(right);
	return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

function replayTargetSamePage(action: PageAction | null | undefined, target: ReplayAnnotation | null | undefined) {
	const documentMatch = documentKeysOverlap(pageActionDocumentKeys(action), replayAnnotationDocumentKeys(target));
	if (documentMatch != null) return documentMatch;
	const actionTitle = actionTitleKey(action);
	const targetTitle = compactActionText(target?.title).toLowerCase();
	return Boolean(actionTitle && targetTitle && actionTitle === targetTitle);
}

function actionMatchesReplayTarget(action: PageAction | null | undefined, target: ReplayAnnotation | null | undefined) {
	if (!action || !target) return false;
	const oldAnnotationId = compactActionText(target.annotationId);
	if (oldAnnotationId && compactActionText(action.annotationId) === oldAnnotationId) return true;
	const targetText = stripReplayCitationMarkers(compactActionText(target.matchedText)).toLowerCase();
	const actionText = stripReplayCitationMarkers(compactActionText(action.citationText || action.detail)).toLowerCase();
	return Boolean(targetText && actionText && targetText === actionText && replayTargetSamePage(action, target));
}

function findPairedHighlightAction(action: PageAction, actions: PageAction[] = []) {
	const annotationId = compactActionText(action.annotationId);
	if (action.type !== "note") return null;
	const highlights = actions.filter((candidate) => candidate && candidate !== action && isHighlightPageAction(candidate));
	if (annotationId) {
		const byAnnotation = highlights.find((candidate) => compactActionText(candidate.annotationId) === annotationId);
		if (byAnnotation) return byAnnotation;
	}
	const noteSuffix = actionKeySuffix(action, "note:");
	if (noteSuffix) {
		const byKey = highlights.find(
			(candidate) => actionKeySuffix(candidate, "highlight:") === noteSuffix && actionSamePage(candidate, action),
		);
		if (byKey) return byKey;
	}
	const samePageHighlights = highlights.filter((candidate) => actionSamePage(candidate, action));
	const actionIndex = actions.indexOf(action);
	if (actionIndex >= 0) {
		const priorHighlights = samePageHighlights.filter((candidate) => {
			const candidateIndex = actions.indexOf(candidate);
			return candidateIndex >= 0 && candidateIndex < actionIndex;
		});
		const nearestPrior = priorHighlights[priorHighlights.length - 1];
		if (nearestPrior) return nearestPrior;
	}
	return samePageHighlights.length === 1 ? samePageHighlights[0] : null;
}

function findPairedHighlightSourceText(action: PageAction, actions: PageAction[] = []) {
	const paired = findPairedHighlightAction(action, actions);
	return compactActionText(paired?.citationText || paired?.detail);
}

	function activationSourceText(action: PageAction, actions: PageAction[] = []) {
		const pdfAnchorSource = compactActionText(action.pdfAnchor?.matchedText || action.pdfAnchor?.textQuote?.exact);
		return findPairedHighlightSourceText(action, actions) || pdfAnchorSource || compactActionText(action.citationText || action.detail);
	}

	function updateReplayActionArray(actions: PageAction[] | undefined, annotation: ReplayAnnotation, tab: any, restoredAnnotation: any) {
		if (!Array.isArray(actions)) return false;
		const actionKeys = new Set(annotation.actionKeys || []);
		const oldAnnotationId = annotation.annotationId || "";
		const newAnnotationId = restoredAnnotation?.annotationId || oldAnnotationId;
		let changed = false;
		for (const action of actions) {
			const matchesKey = Boolean(action.key && actionKeys.has(action.key));
			const matchesAnnotation = actionMatchesReplayTarget(action, annotation);
			if (!matchesKey && !matchesAnnotation) continue;
			if (typeof tab?.id === "number") action.tabId = tab.id;
			if (typeof tab?.windowId === "number") action.windowId = tab.windowId;
			if (tab?.title) action.title = tab.title;
			if (tab?.url) action.url = tab.url;
			if (newAnnotationId && (action.annotationId || action.type === "annotation" || action.type === "note")) {
				action.annotationId = newAnnotationId;
			}
			changed = true;
		}
		return changed;
	}

	function updateLearnerStateAnnotationTargets(learnerState: LearnerState | undefined, annotation: ReplayAnnotation, tab: any, restoredAnnotation: any) {
		if (!learnerState || typeof learnerState !== "object") return false;
		const oldAnnotationId = annotation.annotationId || "";
		const newAnnotationId = restoredAnnotation?.annotationId || oldAnnotationId;
		if (!oldAnnotationId || !newAnnotationId || oldAnnotationId === newAnnotationId) return false;
		let changed = false;
		const updateSource = (source: LearnerConceptSource | undefined) => {
			if (!source || source.annotationId !== oldAnnotationId) return;
			source.annotationId = newAnnotationId;
			if (tab?.title) source.tabTitle = tab.title;
			if (tab?.url) source.url = tab.url;
			changed = true;
		};
		for (const concept of Array.isArray(learnerState.conceptsIntroduced) ? learnerState.conceptsIntroduced : []) {
			for (const source of Array.isArray(concept.sources) ? concept.sources : []) updateSource(source);
		}
		for (const check of Array.isArray(learnerState.openChecks) ? learnerState.openChecks : []) {
			if (check.annotationId !== oldAnnotationId) continue;
			check.annotationId = newAnnotationId;
			changed = true;
		}
		return changed;
	}

	function updateSessionReplayActionTargets(session: RuntimeSession, annotation: ReplayAnnotation, tab: any, restoredAnnotation: any) {
		let changed = updateReplayActionArray(session.pageActions, annotation, tab, restoredAnnotation);
		if (Array.isArray(session.turns)) {
			for (const turn of session.turns) {
				changed = updateReplayActionArray(turn.pageActions, annotation, tab, restoredAnnotation) || changed;
			}
		}
		changed = updateLearnerStateAnnotationTargets(session.learnerState, annotation, tab, restoredAnnotation) || changed;
		if (changed) session.updatedAt = nowIso();
		return changed;
	}

	async function resolveActionTab(action: PageAction, params: any = {}) {
		const state = await host.snapshotState();
		const tabs = flattenTabs(state);
		let tab = findActionTab(tabs, action);
		const url = String(action.url || "").trim();
		if (!tab && url && params.openIfNeeded !== false) {
			const navigated = await host.runCommand("navigate", { url, newTab: true, waitForLoad: true });
			tab = navigated?.tab || navigated;
		}
		if (!tab) return null;
		const tabId = tab?.id;
		if (typeof tabId !== "number" || !isRestorablePageTab(tab)) return null;
		try {
			const activated = await host.runCommand("activate_tab", { tabId });
			return activated?.tab || tab;
		} catch (error) {
			host.log?.("action tab activation failed", error);
			return tab;
		}
	}

	async function restoreSessionPageActions(session: RuntimeSession, params: any = {}) {
		const replayAnnotations =
			Array.isArray(params.annotations) && params.annotations.length
				? (params.annotations as ReplayAnnotation[])
				: buildReplayAnnotationsFromPageActions(collectSessionPageActions(session));
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
				if (!tab && !hasExplicitTarget && isRestorablePageTab(activeTab)) tab = activeTab;
				const tabId = tab?.id;
				if (typeof tabId !== "number" || !isRestorablePageTab(tab)) {
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
					const highlighted = await highlightTextWithReplayCandidates(tabId, annotation.matchedText, {
						scrollIntoView: false,
						pdfAnchor: annotation.pdfAnchor,
						scanPage: true,
					});
					restoredAnnotations += 1;
					const annotationId = highlighted?.annotation?.annotationId;
					updateSessionReplayActionTargets(session, annotation, tab, highlighted?.annotation);
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

	function restoredTargetToReplayAnnotation(target: any): ReplayAnnotation {
		return {
			key: "",
			actionKeys: [],
			tabId: null,
			windowId: null,
			title: target?.title || "",
			url: target?.url || "",
			annotationId: target?.annotationId || null,
			matchedText: compactActionText(target?.matchedText || ""),
			noteText: compactActionText(target?.noteText || ""),
			pdfAnchor: target?.pdfAnchor || target?.restoredAnnotation?.pdfAnchor || null,
		};
	}

	function replayAnnotationMatchesRestoredTarget(annotation: ReplayAnnotation, target: ReplayAnnotation) {
		if (annotation.annotationId && target.annotationId && annotation.annotationId === target.annotationId) return true;
		const leftText = stripReplayCitationMarkers(compactActionText(annotation.matchedText)).toLowerCase();
		const rightText = stripReplayCitationMarkers(compactActionText(target.matchedText)).toLowerCase();
		if (!leftText || leftText !== rightText) return false;
		const documentMatch = documentKeysOverlap(replayAnnotationDocumentKeys(annotation), replayAnnotationDocumentKeys(target));
		if (documentMatch != null) return documentMatch;
		const leftTitle = compactActionText(annotation.title).toLowerCase();
		const rightTitle = compactActionText(target.title).toLowerCase();
		return !leftTitle || !rightTitle || leftTitle === rightTitle;
	}

	function rebindSessionTargetsFromArtifactRestore(session: RuntimeSession, result: any, replayAnnotations: ReplayAnnotation[]) {
		let changed = false;
		const targets = Array.isArray(result?.restoredTargets) ? result.restoredTargets : [];
		for (const rawTarget of targets) {
			const fallbackTarget = restoredTargetToReplayAnnotation(rawTarget);
			const replayTarget = replayAnnotations.find((annotation) => replayAnnotationMatchesRestoredTarget(annotation, fallbackTarget)) || fallbackTarget;
			if (replayTarget !== fallbackTarget) {
				changed = updateSessionReplayActionTargets(session, fallbackTarget, result?.tab || null, rawTarget?.restoredAnnotation) || changed;
			}
			changed = updateSessionReplayActionTargets(session, replayTarget, result?.tab || null, rawTarget?.restoredAnnotation) || changed;
		}
		return changed;
	}

	function restoredResultsCoverReplayAnnotations(restored: any[], replayAnnotations: ReplayAnnotation[]) {
		if (!replayAnnotations.length) return true;
		const restoredTargets = restored.flatMap((result) =>
			(Array.isArray(result?.restoredTargets) ? result.restoredTargets : []).map(restoredTargetToReplayAnnotation),
		);
		if (!restoredTargets.length) return false;
		return replayAnnotations.every((annotation) =>
			restoredTargets.some((target) => replayAnnotationMatchesRestoredTarget(annotation, target)),
		);
	}

	function restoredArtifactNeedsReplayFallback(result: any) {
		const annotations = Array.isArray(result?.artifact?.page?.annotations) ? result.artifact.page.annotations : [];
		if (!annotations.length) return false;
		const expectedAnnotations = annotations.filter((annotation: any) => String(annotation?.matchedText || "").trim()).length;
		const expectedNotes = annotations.filter((annotation: any) => String(annotation?.note?.text || "").trim()).length;
		return Number(result?.restoredAnnotations || 0) < expectedAnnotations || Number(result?.restoredNotes || 0) < expectedNotes;
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
			const dueReviews = await getDueReviews().catch(() => []);
			return {
				...state,
				currentSession: buildSessionState(session),
				dueReviews,
				preferences: {
					...state.preferences,
					runtime: "browser-extension",
					...buildPublicSettings(store.settings),
				},
			};
		},

		async recordLearningEvent(event: LearningEvent) {
			const store = await loadStore();
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			const mode = store.settings.learningMode ? "learning" : "answer";
			const learnerState = await recordLearningEventForSession(session, event, mode);
			return {
				currentSession: buildSessionState(session),
				learnerState,
			};
		},

		async recordRealtimeVoiceTurn(request: any) {
			return await recordRealtimeVoiceTurn(request);
		},

		async planRealtimePedagogicalMove(request: any) {
			return await runRealtimePedagogicalPlanner(request);
		},

		async evaluateRealtimePedagogicalResponse(request: any) {
			return await runRealtimePedagogicalEvaluator(request);
		},

		async getSettings() {
			return await getPublicSettings();
		},

		async trackEvent(eventName: string, data: Record<string, unknown> = {}) {
			return { tracked: await trackExtensionEvent(eventName, data) };
		},

		async captureRuntimeException(request: any = {}) {
			const store = await loadStore();
			const message = redactDiagnosticText(request?.message || request?.error || "Onhand runtime exception", 500);
			const error = new Error(message || "Onhand runtime exception");
			if (request?.stack) error.stack = redactDiagnosticStack(request.stack, 2400, ONHAND_SENTRY_STACK_EXTENSION_URL);
			return {
				captured: captureSentryException(error, store.settings as RuntimeSettings, "runtime_exception", {
					message_type: request?.messageType,
					error_kind: classifyTelemetryError(message),
				}),
			};
		},

		async submitErrorReport(turnId: string) {
			const store = await loadStore();
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			const id = String(turnId || "").trim();
			const turn = (Array.isArray(session.turns) ? session.turns : []).find((candidate) => String(candidate?.id || "") === id) as UiTurn | undefined;
			if (!turn) throw new Error("Could not find that failed Onhand turn.");
			if (!turn.error) throw new Error("Only failed Onhand turns can be reported.");
			const existingReport = turn.errorReport && typeof turn.errorReport === "object" ? turn.errorReport : null;
			if (existingReport?.report_id) {
				return { reportId: existingReport.report_id, alreadySubmitted: true };
			}
			const report = existingReport || buildErrorReportSnapshotFromTurn(turn, store.settings as RuntimeSettings);
			const baseUrl = await getFreeTierBaseUrl();
			const response = await fetch(`${baseUrl}/error-reports`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ report }),
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || !body?.accepted || !body?.report_id) {
				throw new Error(body?.reason ? `Could not send error report: ${body.reason}` : "Could not send error report.");
			}
			turn.errorReport = {
				...report,
				submitted_at: nowIso(),
				report_id: String(body.report_id),
			};
			session.turns = session.turns.map((candidate) => (String(candidate?.id || "") === id ? turn : candidate));
			await saveStore(store, { sessions: [session] });
			await publishState({
				currentSession: buildSessionState(session),
				turns: session.turns,
				messages: buildConversationMessages(session.messages),
				status: `Error report sent: ${turn.errorReport.report_id}`,
			});
			const sentryReportError = new Error(report.error_message || report.error_kind || "Onhand anonymized error report");
			if (report.error_stack) sentryReportError.stack = report.error_stack;
			captureSentryException(sentryReportError, store.settings as RuntimeSettings, "explicit_error_report", {
				explicit_user_report: true,
				report_id: turn.errorReport.report_id,
				error_kind: report.error_kind,
				action_count: report.action_count,
				artifact_count: report.artifact_count,
			});
			return { reportId: turn.errorReport.report_id, alreadySubmitted: false };
		},

		async getOpenAIRealtimeCredential() {
			const store = await loadStore();
			const settings = store.settings as RuntimeSettings;
			if (!settings.realtimeVoiceEnabled) {
				throw new Error("Realtime voice is disabled. Open Onhand options and enable Realtime Voice.");
			}
			const openAiApiKey = getApiKeyForProvider(settings, OPENAI_API_PROVIDER);
			if (openAiApiKey) {
				return {
					apiKey: openAiApiKey,
					source: "openai-api-key",
				};
			}
			throw new Error("Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.");
		},

		async updateSettings(partial: Partial<RuntimeSettings>) {
			const store = await loadStore();
			const nextPartial = partial || {};
			const wasDiagnosticsEnabled = Boolean(store.settings.diagnosticsEnabled);
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
				realtimeVoiceEnabled: Boolean(nextPartial.realtimeVoiceEnabled ?? store.settings.realtimeVoiceEnabled),
				speedMode: normalizeSpeedMode(nextPartial.speedMode ?? store.settings.speedMode),
				aiProvider,
				aiModel,
				aiApiKey: typeof nextPartial.aiApiKey === "string" ? nextPartial.aiApiKey.trim() : store.settings.aiApiKey,
				aiApiKeys: normalizeApiKeys((nextPartial as any).aiApiKeys ?? store.settings.aiApiKeys, typeof nextPartial.aiApiKey === "string" ? nextPartial.aiApiKey : store.settings.aiApiKey),
				authMode,
				oauthCredentials: nextOAuthCredentials,
				diagnosticsEnabled: normalizeDiagnosticsEnabled(nextPartial.diagnosticsEnabled ?? store.settings.diagnosticsEnabled, authMode, aiProvider),
				diagnosticsClientId: typeof nextPartial.diagnosticsClientId === "string" ? nextPartial.diagnosticsClientId : store.settings.diagnosticsClientId,
				advancedRuntimeInspectionEnabled: (nextPartial.advancedRuntimeInspectionEnabled ?? store.settings.advancedRuntimeInspectionEnabled) !== false,
			};
			sentryDiagnosticsAllowed = Boolean(store.settings.diagnosticsEnabled);
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			session.learnerState = setLearnerStateMode(session.learnerState, store.settings.learningMode ? "learning" : "answer");
			store.sessions[session.id] = session;
			await saveStore(store, { sessions: [session] });
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			if (!wasDiagnosticsEnabled && store.settings.diagnosticsEnabled) {
				void trackExtensionEvent("diagnostics_enabled", { result: "ok" }).catch(() => {});
			}
			void trackExtensionEvent("settings_saved", { result: "ok" }).catch(() => {});
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
			const nextModel = normalizeModelForProvider(
				String(request.aiModel || store.settings.aiModel || getDefaultOAuthModel(providerId) || OPENAI_CODEX_MODEL),
				providerId,
				"oauth",
			);
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
			await saveStore(store, {});
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

		async validateApiKey(request: any = {}) {
			const store = await loadStore();
			const providerId = normalizeProviderForAuthMode(String(request.providerId || store.settings.aiProvider || OPENAI_API_PROVIDER).trim(), "api-key", true);
			const apiKey = typeof request.apiKey === "string" ? request.apiKey : getApiKeyForProvider(store.settings, providerId);
			return validateProviderApiKey(providerId, apiKey);
		},

		async removeApiKey(providerId: string) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before changing API keys.");
			const store = await loadStore();
			const targetProviderId = normalizeProviderForAuthMode(String(providerId || store.settings.aiProvider || OPENAI_API_PROVIDER).trim(), "api-key", true);
			const aiApiKeys = { ...(store.settings.aiApiKeys || {}) };
			delete aiApiKeys[targetProviderId];
			store.settings = {
				...store.settings,
				aiApiKeys,
				aiApiKey: targetProviderId === OPENAI_API_PROVIDER ? "" : store.settings.aiApiKey,
			};
			await saveStore(store, {});
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
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
				aiModel: normalizeModelForProvider(store.settings.aiModel || OPENAI_CODEX_MODEL, OPENAI_CODEX_PROVIDER, "oauth"),
			};
			await saveStore(store, {});
			const session = store.sessions[store.currentSessionId] as RuntimeSession;
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			return await getPublicSettings();
		},

		async listDueReviews(params: any = {}) {
			return { reviews: await getDueReviews(params) };
		},

		async snoozeReview(params: any = {}) {
			const conceptKey = normalizeReviewConceptKey(String(params?.conceptKey || params?.label || ""));
			if (!conceptKey) throw new Error("Review snooze needs a conceptKey.");
			const days = Math.max(0.5, Math.min(30, Number(params?.days || 3) || 3));
			const snoozedUntil = new Date(Date.now() + days * REVIEW_DAY_MS).toISOString();
			await writeReviewSnooze(conceptKey, snoozedUntil);
			return { snoozedUntil, reviews: await getDueReviews(params) };
		},

		async listSessions(limit = 20) {
			const store = await loadStore();
			const sessions = Object.values(store.sessions)
				.sort((left: any, right: any) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
				.slice(0, Math.max(1, limit))
				.map((session: any) => buildSessionListItem(session as RuntimeSession, store.currentSessionId));
			return {
				currentSession: buildSessionState(store.sessions[store.currentSessionId]),
				sessions,
			};
		},

		async getSessionReplay(sessionId?: string) {
			const store = await loadStore();
			const targetSessionId = String(sessionId || store.currentSessionId || "").trim();
			await ensureSessionLoaded(store, targetSessionId);
			const session = store.sessions[targetSessionId] as RuntimeSession;
			if (!session) throw new Error("Session not found.");
			const artifactIds = Array.isArray(session.artifactIds) ? session.artifactIds : [];
			const artifacts = [];
			for (const artifactId of artifactIds) {
				const artifact = await getBrowserArtifact(artifactId);
				if (artifact) artifacts.push(replayArtifactSummary(artifact));
			}
			const pageActions = collectSessionPageActions(session);
			const replayableAnnotations = buildReplayAnnotationsFromPageActions(pageActions);
			return {
				currentSession: buildSessionState(store.sessions[store.currentSessionId]),
				session: buildSessionListItem(session, store.currentSessionId),
				turns: Array.isArray(session.turns) ? session.turns : [],
				pageActions,
				artifacts,
				replayableAnnotations,
				selectedArtifactId: artifacts.at(-1)?.artifactId || null,
			};
		},

		async getReplayArtifact(artifactId: string) {
			const artifact = await getBrowserArtifact(artifactId);
			if (!artifact) throw new Error(`Could not find Onhand artifact: ${artifactId || "(blank)"}`);
			return {
				artifact: replayArtifactSnapshot(artifact),
			};
		},

		async startNewSession(options: any = {}) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before starting a new session.");
			const targetWindowId = typeof options?.targetWindowId === "number" && Number.isFinite(options.targetWindowId) ? options.targetWindowId : undefined;
			await clearActivePageAnnotations(targetWindowId);
			const store = await loadStore();
			const session = createSession();
			session.learnerState = setLearnerStateMode(session.learnerState, store.settings.learningMode ? "learning" : "answer");
			store.sessions[session.id] = session;
			store.currentSessionId = session.id;
			await saveStore(store, { sessions: [session] });
			uiState = createEmptyState(session, store.settings);
			void trackExtensionEvent("session_started", { result: "ok" }).catch(() => {});
			return {
				created: { cancelled: false },
				currentSession: buildSessionState(session),
			};
		},

		async switchSession(sessionId: string, options: any = {}) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before switching sessions.");
			const targetWindowId = typeof options?.targetWindowId === "number" && Number.isFinite(options.targetWindowId) ? options.targetWindowId : undefined;
			await clearActivePageAnnotations(targetWindowId);
			const store = await loadStore();
			await ensureSessionLoaded(store, sessionId);
			if (!store.sessions[sessionId]) throw new Error("Session not found.");
			store.currentSessionId = sessionId;
			const session = store.sessions[sessionId] as RuntimeSession;
			session.learnerState = setLearnerStateMode(session.learnerState, store.settings.learningMode ? "learning" : "answer");
			store.sessions[session.id] = session;
			await saveStore(store, { sessions: [session] });
			uiState = createEmptyState(session, store.settings);
			uiState.messages = buildConversationMessages(session.messages);
			return {
				switched: { cancelled: false },
				currentSession: buildSessionState(session),
			};
		},

		async deleteSession(sessionId?: string, options: any = {}) {
			if (activeRequest) throw new Error("Wait for the current Onhand reply to finish before deleting a session.");
			const store = await loadStore();
			const targetSessionId = String(sessionId || store.currentSessionId || "").trim();
			await ensureSessionLoaded(store, targetSessionId);
			const targetSession = store.sessions[targetSessionId] as RuntimeSession;
			if (!targetSession) throw new Error("Session not found.");
			const wasCurrentSession = targetSessionId === store.currentSessionId;
			if (wasCurrentSession) {
				const targetWindowId = typeof options?.targetWindowId === "number" && Number.isFinite(options.targetWindowId) ? options.targetWindowId : undefined;
				await clearActivePageAnnotations(targetWindowId);
			}
			delete store.sessions[targetSessionId];
			let currentSession = store.sessions[store.currentSessionId] as RuntimeSession | undefined;
			if (wasCurrentSession || !currentSession) {
				currentSession = Object.values(store.sessions)
					.sort((left: any, right: any) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0] as RuntimeSession | undefined;
				if (!currentSession) {
					currentSession = createSession();
					store.sessions[currentSession.id] = currentSession;
				}
				currentSession.learnerState = setLearnerStateMode(currentSession.learnerState, store.settings.learningMode ? "learning" : "answer");
				store.sessions[currentSession.id] = currentSession;
				store.currentSessionId = currentSession.id;
				uiState = createEmptyState(currentSession, store.settings);
				uiState.messages = buildConversationMessages(currentSession.messages);
			}
			await saveStore(store, { sessions: currentSession ? [currentSession] : [], deletedSessionIds: [targetSessionId] });
			if (!wasCurrentSession) {
				await publishState({ status: "Deleted session." });
			}
			return {
				deletedSessionId: targetSessionId,
				currentSession: buildSessionState(currentSession),
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
			await ensureSessionLoaded(store, targetSessionId);
			const session = store.sessions[targetSessionId] as RuntimeSession;
			if (!session) throw new Error("Session not found.");
			const artifactIds = Array.isArray(session.artifactIds) ? session.artifactIds : [];
			const pageActions = collectSessionPageActions(session);
			const replayableAnnotations = buildReplayAnnotationsFromPageActions(pageActions);
			const restored: any[] = [];
			const artifactIdsToRestore = await latestArtifactIdsByTarget(artifactIds);
			for (const artifactId of artifactIdsToRestore) {
				try {
					const result = await restoreArtifact({ artifactId, openIfNeeded: true, clearExisting: true });
					rebindSessionTargetsFromArtifactRestore(session, result, replayableAnnotations);
					restored.push(result);
				} catch (error: any) {
					const artifact = await getBrowserArtifact(artifactId);
					restored.push({
						tab: null,
						artifact,
						artifactId,
						restoredAnnotations: 0,
						restoredNotes: 0,
						failures: [error?.message || String(error)],
					});
				}
			}
			const artifactRestoreMissesReplayTargets =
				artifactIds.length > 0 && replayableAnnotations.length > 0 && !restoredResultsCoverReplayAnnotations(restored, replayableAnnotations);
			const needsReplayRestore =
				!artifactIds.length || artifactRestoreMissesReplayTargets || (replayableAnnotations.length > 0 && restored.some(restoredArtifactNeedsReplayFallback));
			if (needsReplayRestore) {
				// Replay only the annotations the artifact restore did not
				// already cover, so a partially successful artifact pass is
				// not redone (PDF QA Finding 6). When coverage is complete but
				// counts came up short, replay everything as before.
				const restoredTargets = restored.flatMap((result) =>
					(Array.isArray(result?.restoredTargets) ? result.restoredTargets : []).map(restoredTargetToReplayAnnotation),
				);
				const uncoveredAnnotations = replayableAnnotations.filter(
					(annotation) => !restoredTargets.some((target) => replayAnnotationMatchesRestoredTarget(annotation, target)),
				);
				restored.push(
					...await restoreSessionPageActions(session, {
						openIfNeeded: true,
						clearExisting: !artifactIds.length,
						...(uncoveredAnnotations.length ? { annotations: uncoveredAnnotations } : {}),
					}),
				);
			}
			const restoredPages = restored.map(summarizeRestoredArtifact);
			const restoredAnnotations = restored.reduce((total, page) => total + Number(page?.restoredAnnotations || 0), 0);
			const replayPages = restored.filter((page) => page?.source === "browser-replay");
			const artifactPages = restored.filter((page) => page?.source !== "browser-replay");
			const status = artifactPages.length && replayPages.length
				? `Restored ${artifactPages.length} saved page state${artifactPages.length === 1 ? "" : "s"} and replayed ${restoredAnnotations} browser highlight${restoredAnnotations === 1 ? "" : "s"}.`
				: artifactIds.length
					? `Restored ${restored.length} saved page state${restored.length === 1 ? "" : "s"}.`
				: `Replayed ${restoredAnnotations} browser highlight${restoredAnnotations === 1 ? "" : "s"} from this session.`;
			session.updatedAt = nowIso();
			store.sessions[targetSessionId] = session;
			await saveStore(store, { sessions: [session] });
			await publishState(
				targetSessionId === store.currentSessionId
					? { status, currentSession: buildSessionState(session), turns: session.turns || [], pageActions: session.pageActions || [] }
					: { status },
			);
			void trackExtensionEvent("session_restored", {
				result: restored.some((page) => Array.isArray(page?.failures) && page.failures.length) ? "partial" : "ok",
				action_count: restoredAnnotations,
				artifact_count: restoredPages.length,
			}).catch(() => {});
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
			const targetWindowId =
				typeof request?.targetWindowId === "number" && Number.isFinite(request.targetWindowId) ? request.targetWindowId : undefined;
			const recentConversation = buildRecentConversationContext(session);
			const learningMode = Boolean(request?.learningMode ?? store.settings.learningMode);
			const requestSettings = {
				...store.settings,
				learningMode,
				speedMode: normalizeSpeedMode(request?.speedMode ?? store.settings.speedMode),
			};
			session.learnerState = setLearnerStateMode(session.learnerState, learningMode ? "learning" : "answer");
			const reasoningProfile = buildReasoningProfile(requestSettings, prompt, attachments, learningMode);
			if (!session.name && session.messages.length === 0) {
				session.name = buildSessionTitleFromPrompt(displayPrompt);
			}

			beginRequest(session, requestSettings, requestId, displayPrompt);
			activeRequest = {
				id: requestId,
				displayPrompt,
				reply: "",
				pageActions: [] as PageAction[],
				artifactIds: [] as string[],
				createdAt: nowIso(),
				aborted: false,
				targetWindowId,
				initialSelection: null,
				learningMode,
				settings: requestSettings,
			};
			await publishState({ status: "Starting Onhand..." });
			void trackExtensionEvent("prompt_submitted", { result: "started" }).catch(() => {});

			try {
				const learningFollowup = learningMode ? buildLearningCheckFollowup(prompt, session.learnerState) : null;
				if (learningFollowup) {
					await recordLearningEventForSession(
						session,
						{
							kind: "check_resolved",
							checkId: learningFollowup.check.checkId,
							assessment: learningFollowup.assessment,
							evidence: stripVoicePromptPrefix(prompt),
						},
						"learning",
					);
					activeRequest.reply = learningFollowup.reply;
					await finalizeRequest(session, requestId, null, []);
					return { requestId };
				}

				const model = await getConfiguredModel(store.settings);
				let pdfHandoff = await runExplicitPdfHandoffIfRequested(prompt, targetWindowId);
				if (!pdfHandoff) {
					pdfHandoff = await runAutomaticPdfHandoffIfNeeded(targetWindowId);
				}
				const browserContextDetails = await renderBrowserContextDetails(host, { targetWindowId });
				const browserContext = browserContextDetails.text;
				activeRequest.initialSelection = browserContextDetails.selection;
				const forcePdfTools = Boolean(pdfHandoff || browserContextLooksLikePdf(browserContextDetails));
				const tools = selectToolsForPrompt(
					createTools(host, artifactHooks, withRequestBrowserContext, (event) =>
						recordLearningEventForSession(session, event, learningMode ? "learning" : "answer"),
					),
					prompt,
					attachments,
					learningMode,
					session.learnerState,
					{
						forcePdfTools,
						advancedRuntimeInspectionEnabled: requestSettings.advancedRuntimeInspectionEnabled,
					},
				);

				activeAgent = new Agent({
					initialState: {
						systemPrompt: ONHAND_SYSTEM_PROMPT,
						model,
						tools,
						messages: [],
						thinkingLevel: "off",
					},
					sessionId: session.id,
					transformContext: (messages) => transformFreeTierContextForModel(model, messages),
					getApiKey: (provider) => resolveApiKey(provider),
					streamFn: (streamModel: any, streamContext: any, streamOptions: any = {}) =>
						streamOnhandFast(streamModel, streamContext, {
							...streamOptions,
							onhandTelemetry: {
								turnId: requestId,
								sessionId: session.id,
							},
							onhandReasoningProfile: reasoningProfile,
						}),
					toolExecution: "parallel",
				});
				activeAgent.subscribe((event) => handleAgentEvent(session, requestId, event));

				void activeAgent
					.prompt(
						buildLauncherPrompt(
							prompt,
							browserContext,
							attachments,
							learningMode,
							reasoningProfile,
							tools,
							recentConversation,
							session.learnerState,
						),
						buildPromptImages(attachments),
					)
					.catch((error) => finalizeRequest(session, requestId, error instanceof Error ? error : new Error(String(error))));
			} catch (error) {
				await finalizeRequest(session, requestId, error instanceof Error ? error : new Error(String(error)));
			}

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

		async activateAction(actionKey: string, options: any = {}) {
			const store = await loadStore();
			const requestedSessionId = String(options?.sessionId || options?.sessionPath || store.currentSessionId || "").trim();
			await ensureSessionLoaded(store, requestedSessionId);
			const session = store.sessions[requestedSessionId] as RuntimeSession;
			if (!session) throw new Error("Session not found.");
			const isCurrentSession = requestedSessionId === store.currentSessionId;
			const state = isCurrentSession ? await ensureUiState() : null;
			const sessionActions = collectSessionPageActions(session);
			const stateActions = state
				? [
						...(Array.isArray(state.pageActions) ? state.pageActions : []),
						...(Array.isArray(state.turns) ? state.turns.flatMap((turn: UiTurn) => turn.pageActions || []) : []),
					]
				: [];
			const allActions = [...sessionActions, ...stateActions];
			let action = sessionActions.find((candidate: PageAction) => candidate.key === actionKey);
			const actionBelongsToSession = Boolean(action);
			action = action || stateActions.find((candidate: PageAction) => candidate.key === actionKey);
			if (!action) throw new Error("Could not find that Onhand page action.");
			const pairedHighlight = findPairedHighlightAction(action, allActions);
			const actionPdfAnchor = action.pdfAnchor || pairedHighlight?.pdfAnchor || null;
			const tab = await resolveActionTab(action);
			const tabId = typeof tab?.id === "number" ? tab.id : undefined;
			let changed = false;
			if (action.artifactId) {
				await restoreArtifact({ artifactId: action.artifactId, tabId, openIfNeeded: true, clearExisting: false });
			}
			if (actionPdfAnchor && typeof tabId === "number") {
				const matchedText = activationSourceText(action, allActions) || actionPdfAnchor.matchedText || actionPdfAnchor.textQuote?.exact || "";
				await waitForPdfRestoreSurface(
					tabId,
					{
						tab,
						page: {
							title: action.title || pairedHighlight?.title || tab?.title || "",
							url: action.url || pairedHighlight?.url || tab?.url || "",
							annotations: [{ kind: "pdf", matchedText, pdfAnchor: actionPdfAnchor }],
						},
					} as any,
					[{ kind: "pdf", matchedText, pdfAnchor: actionPdfAnchor }],
				);
			}
			if (action.annotationId || (action.type === "note" && pairedHighlight?.annotationId)) {
				if (typeof tabId !== "number") throw new Error("No matching browser tab is open for that citation.");
				const targetAnnotationId =
					action.type === "note" && pairedHighlight?.annotationId ? compactActionText(pairedHighlight.annotationId) : compactActionText(action.annotationId);
				if (action.type === "note" && targetAnnotationId && targetAnnotationId !== action.annotationId) {
					action.annotationId = targetAnnotationId;
					changed = true;
				}
				let noteShown = false;
				try {
					const scrolled = await host.runCommand("scroll_to_annotation", {
						tabId,
						annotationId: targetAnnotationId || action.annotationId,
						target: action.type === "note" ? "note" : "annotation",
					});
					const scrolledAnnotation = scrolled?.annotation || scrolled;
					if (action.type === "note" && (scrolledAnnotation?.targetKind === "note" || scrolledAnnotation?.noteRect)) {
						noteShown = true;
					}
				} catch (error) {
					const citationText = activationSourceText(action, allActions);
					if (!citationText) throw error;
					const highlighted = await highlightExactReplaySource(tabId, citationText, { scrollIntoView: true, pdfAnchor: actionPdfAnchor });
					const annotationId = highlighted?.annotation?.annotationId;
					if (!annotationId) throw error;
					const replayTarget = {
						key: "",
						actionKeys: action.key ? [action.key] : [],
						annotationId: action.annotationId || null,
						matchedText: citationText,
					};
					if (actionBelongsToSession) {
						changed = updateSessionReplayActionTargets(session, replayTarget, tab, highlighted?.annotation) || changed;
					}
					action.annotationId = annotationId;
					action.tabId = tabId;
					if (typeof tab?.windowId === "number") action.windowId = tab.windowId;
					if (tab?.title) action.title = tab.title;
					if (tab?.url) action.url = tab.url;
					if (action.type === "note") {
						const noteText = compactActionText(action.citationText || action.detail);
						if (noteText) {
							await host.runCommand("show_note", {
								tabId,
								annotationId,
								note: noteText,
								label: "Onhand",
								scrollIntoView: true,
							});
							noteShown = true;
						}
					}
					changed = true;
				}
				if (action.type === "note" && !noteShown) {
					const noteText = compactActionText(action.citationText || action.detail);
					const annotationId = compactActionText(action.annotationId);
					if (noteText && annotationId) {
						await host.runCommand("show_note", {
							tabId,
							annotationId,
							note: noteText,
							label: "Onhand",
							scrollIntoView: true,
						});
					}
				}
			}
			if (changed && actionBelongsToSession) {
				session.updatedAt = nowIso();
				store.sessions[requestedSessionId] = session;
				await saveStore(store, { sessions: [session] });
				if (isCurrentSession) {
					await publishState({
						currentSession: buildSessionState(session),
						turns: session.turns || [],
						pageActions: session.pageActions || [],
					});
				}
			}
			return action;
		},

			// Jump to the source behind a tracked learner concept. Unlike
			// activateAction this works from a learner source alone (no page
			// action), so it self-heals across sessions: when the original
			// highlight element is gone, it re-finds the passage by its stored
			// text (rendering the page it lives on), then falls back to
			// restoring the saved artifact.
			async jumpToLearnerSource(params: any = {}) {
				const annotationId = compactActionText(params?.annotationId);
				let matchedText = stripReplayCitationMarkers(compactActionText(params?.matchedText));
				let artifactId = compactActionText(params?.artifactId);
				const target = params?.target === "note" ? "note" : "annotation";
				const conceptLabel = compactActionText(params?.conceptLabel);
				let url = compactActionText(params?.url);
				let title = compactActionText(params?.tabTitle || params?.title);
				// Concepts tracked before sources stored their text carry only a
				// (now stale) annotation id. The original highlight action still
				// lives in whichever session created it, so recover the verbatim
				// text from there to make those old sources jumpable too. Match
				// on the action key as well as the annotationId field: the key
				// permanently embeds the original id (`highlight:<id>`), while
				// the annotationId field drifts to a new value every time the
				// highlight is re-materialized on restore, so an old source's id
				// only still matches the key.
				let recoveredPdfAnchor: any = null;
				if (!matchedText && annotationId) {
					const store = await loadStore();
					for (const session of Object.values(store.sessions) as RuntimeSession[]) {
						const action = collectSessionPageActions(session).find(
							(candidate) =>
								compactActionText(candidate?.annotationId) === annotationId ||
								actionKeySuffix(candidate, "highlight:") === annotationId ||
								actionKeySuffix(candidate, "note:") === annotationId,
						);
						if (!action) continue;
						const paired = isHighlightPageAction(action) ? action : findPairedHighlightAction(action, collectSessionPageActions(session));
						const textSource = paired || action;
						matchedText = stripReplayCitationMarkers(compactActionText(textSource.citationText || textSource.detail));
						if (!recoveredPdfAnchor && (textSource.pdfAnchor || action.pdfAnchor)) recoveredPdfAnchor = textSource.pdfAnchor || action.pdfAnchor;
						if (!artifactId && (textSource.artifactId || action.artifactId)) artifactId = compactActionText(textSource.artifactId || action.artifactId);
						if (!url && (textSource.url || action.url)) url = compactActionText(textSource.url || action.url);
						if (!title && (textSource.title || action.title)) title = compactActionText(textSource.title || action.title);
						if (matchedText) break;
					}
				}
				// After enough restores, a concept's annotation id drifts to a
				// generation that matches neither the page action's id nor its
				// key, so id recovery yields nothing. Fall back to content: among
				// highlights on the same page, pick the one whose text best
				// overlaps the concept label. Lossy, but lands the reader on the
				// passage the concept is about instead of a dead end.
				if (!matchedText && conceptLabel && url) {
					const labelTokens = new Set(learnerLabelTokens(conceptLabel));
					if (labelTokens.size) {
						const store = await loadStore();
						let best: { action: PageAction; score: number } | null = null;
						const sameUrl = url.split("#")[0];
						for (const session of Object.values(store.sessions) as RuntimeSession[]) {
							const actions = collectSessionPageActions(session);
							for (const action of actions) {
								if (compactActionText(action.url).split("#")[0] !== sameUrl) continue;
								if (!isHighlightPageAction(action) && action.type !== "note") continue;
								const highlight = isHighlightPageAction(action) ? action : findPairedHighlightAction(action, actions);
								if (!highlight || !compactActionText(highlight.citationText || highlight.detail)) continue;
								const noteText = action.type === "note" ? compactActionText(action.citationText || action.detail) : "";
								const actionTokens = new Set(learnerLabelTokens(`${compactActionText(highlight.citationText || highlight.detail)} ${noteText}`));
								let score = 0;
								for (const token of labelTokens) if (actionTokens.has(token)) score += 1;
								if (score >= 2 && (!best || score > best.score)) best = { action: highlight, score };
							}
						}
						if (best) {
							matchedText = stripReplayCitationMarkers(compactActionText(best.action.citationText || best.action.detail));
							if (!recoveredPdfAnchor && best.action.pdfAnchor) recoveredPdfAnchor = best.action.pdfAnchor;
							if (!artifactId && best.action.artifactId) artifactId = compactActionText(best.action.artifactId);
							if (!title && best.action.title) title = compactActionText(best.action.title);
						}
					}
				}
				if (!annotationId && !matchedText && !artifactId) {
					throw new Error("Source not found on this page.");
				}
				const state = await host.snapshotState();
				const tabs = flattenTabs(state);
				const tab = findActionTab(tabs, { url, title } as PageAction);
				const tabId = typeof tab?.id === "number" ? tab.id : undefined;
				const failures: string[] = [];
				const note = (stage: string, error: any) => failures.push(`${stage}: ${error?.message || error}`);
				// Always logged (even on success) so a failing jump can be
				// diagnosed from the service-worker console: it confirms the
				// build is current and shows what was recovered to act on.
				host.log?.(
					"jumpToLearnerSource:resolve",
					JSON.stringify({ annotationId, recoveredTextLen: matchedText.length, anchorPage: Number(recoveredPdfAnchor?.pageNumber) || 0, hasArtifact: Boolean(artifactId), tabId: tabId ?? null, url }),
				);

				// 1) The highlight is still on the page.
				if (annotationId && typeof tabId === "number") {
					try {
						const scrolled = await host.runCommand("scroll_to_annotation", { tabId, annotationId, target });
						return { ok: true, mode: "existing", annotation: scrolled?.annotation || scrolled };
					} catch (error) {
						note("existing", error);
					}
				}

				// 2) Re-find the passage by its verbatim text. The replay
				// highlighter scans the whole PDF and renders the page the text
				// is on (so this works even when that page was never rendered),
				// and tolerates spacing/line-break drift that exact-only misses.
				if (matchedText && typeof tabId === "number") {
					try {
						const highlighted = await highlightTextWithReplayCandidates(tabId, matchedText, {
							scrollIntoView: true,
							scanPage: true,
							...(recoveredPdfAnchor ? { pdfAnchor: recoveredPdfAnchor } : {}),
						});
						if (highlighted?.annotation) return { ok: true, mode: "text", annotation: highlighted.annotation };
					} catch (error) {
						note("text", error);
					}
				}

				// 3) Rebuild the highlight from the saved page artifact.
				if (artifactId) {
					try {
						const restored = await restoreArtifact({ artifactId, openIfNeeded: true, clearExisting: false });
						const restoredTabId = typeof restored?.tab?.id === "number" ? restored.tab.id : tabId;
						const targetMatch = (restored?.restoredTargets || []).find(
							(entry: any) =>
								(annotationId && compactActionText(entry?.annotationId) === annotationId) ||
								(matchedText && stripReplayCitationMarkers(compactActionText(entry?.matchedText)) === matchedText),
						);
						const restoredAnnotationId = compactActionText(targetMatch?.restoredAnnotation?.annotationId);
						if (typeof restoredTabId === "number" && restoredAnnotationId) {
							const scrolled = await host.runCommand("scroll_to_annotation", { tabId: restoredTabId, annotationId: restoredAnnotationId, target });
							return { ok: true, mode: "artifact", annotation: scrolled?.annotation || scrolled };
						}
						if (typeof restoredTabId === "number" && (restored?.restoredAnnotations || 0) > 0) {
							return { ok: true, mode: "artifact" };
						}
					} catch (error) {
						note("artifact", error);
					}
				}

				// 4) Last resort: the exact highlight could not be re-created
				// (complex PDF text often defeats exact re-matching), but we know
				// which page the passage is on from the recovered anchor. Land
				// the reader on that page so "source" is never a dead end.
				let anchorPage = Number(recoveredPdfAnchor?.pageNumber) || 0;
					// Highlights saved before anchors were stored have no page to
					// fall back to; a full-document search (more lenient than exact
					// re-highlight) still locates the passage's page.
					if (anchorPage <= 0 && matchedText && typeof tabId === "number") {
						try {
							const searched = await host.runCommand("pdf_search", { query: matchedText, text: matchedText, maxMatches: 1 });
							const match = (searched?.search?.matches || searched?.matches || [])[0];
							anchorPage = Number(match?.pageNumber) || 0;
						} catch (error) {
							note("search", error);
						}
					}
				if (anchorPage > 0 && typeof tabId === "number") {
					try {
						const jumped = await host.runCommand("pdf_jump_to_page", {
							tabId,
							pageNumber: anchorPage,
							...(matchedText ? { text: matchedText } : {}),
							...(recoveredPdfAnchor?.occurrence ? { occurrence: recoveredPdfAnchor.occurrence } : {}),
							...(recoveredPdfAnchor ? { pdfAnchor: recoveredPdfAnchor } : {}),
						});
						return { ok: true, mode: "page", pageNumber: anchorPage, jump: jumped?.jump || jumped };
					} catch (error) {
						note("page", error);
					}
				}

				host.log?.("jumpToLearnerSource exhausted all recovery paths", failures.join(" | ") || "no recovery data");
				throw new Error("Source not found on this page.");
			},
	};
}
