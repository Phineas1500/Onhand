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

interface AssistantDraftTextBlock {
	contentIndex: number;
	text: string;
}

interface UiTurn {
	id: string;
	userPrompt: string;
	reply: string;
	activities: UiActivity[];
	toolTraces?: ToolTraceEntry[];
	pageActions: PageAction[];
	pending: boolean;
	error: boolean;
	createdAt: string;
	errorReport?: RuntimeErrorReportSnapshot | null;
}

interface ToolTraceEntry {
	id: string;
	toolCallId: string;
	toolName: string;
	state: "running" | "complete" | "error";
	startedAt: string;
	endedAt?: string;
	duration_ms?: number;
	args?: unknown;
	effectiveArgs?: unknown;
	resultSummary?: string;
	resultDetails?: unknown;
	error?: string;
}

const TOOL_TRACE_RESULT_SUMMARY_MAX_CHARS = 20000;

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
const ONHAND_FREE_VISUAL_IMAGE_TARGET_BASE64_CHARS = 650000;
const ONHAND_FREE_VISUAL_IMAGE_SMALL_BASE64_CHARS = 180000;
const ONHAND_FREE_VISUAL_IMAGE_MAX_EDGE_PX = 1440;
const ONHAND_FREE_VISUAL_IMAGE_EDGE_STEPS = [1440, 1200, 960];
const ONHAND_FREE_VISUAL_IMAGE_QUALITY_STEPS = [0.76, 0.66, 0.56];
// Public builds do not hard-code the hosted workers/free-tier proxy. Configure
// it locally with the onhandFreeTierBaseUrl key in chrome.storage.local. See
// docs/FREE_TIER.md.
const ONHAND_FREE_TIER_DEFAULT_BASE_URL = "";
const ONHAND_FREE_BASE_URL_STORAGE_KEY = "onhandFreeTierBaseUrl";
const ONHAND_FREE_TOKEN_STORAGE_KEY = "onhandFreeTierToken";
const ONHAND_FREE_TURN_ID_HEADER = "X-Onhand-Turn-Id";
const ONHAND_FREE_SESSION_ID_HEADER = "X-Onhand-Session-Id";
const ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY = "onhandFreeTierQuotaBypassSecret";
const ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY = "onhandFreeTierQuotaBypassExpiresAt";
const ONHAND_FREE_QUOTA_BYPASS_HEADER = "X-Onhand-Quota-Bypass";
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
const BROWSER_CONTEXT_COMMAND_TIMEOUT_MS = 5000;
const REALTIME_READABLE_CONTEXT_MAX_CHARS = 9000;
const REALTIME_ANCHOR_CONTEXT_MAX_CHARS = 4200;
const TOOL_RESULT_MAX_CHARS = 1800;
const VISIBLE_TEXT_TOOL_MAX_CHARS = 2400;
const RECENT_CONTEXT_TURN_LIMIT = 4;
const RECENT_CONTEXT_PROMPT_MAX_CHARS = 260;
const RECENT_CONTEXT_REPLY_MAX_CHARS = 700;
const PRIOR_PAGE_CONTEXT_MAX_CHARS = 5200;
const PRIOR_PAGE_CONTEXT_SECTION_MAX_CHARS = 950;
const PRIOR_PAGE_CONTEXT_MAX_SECTIONS = 6;
const ONHAND_MAX_OUTPUT_TOKENS = 900;
const ONHAND_FAST_OUTPUT_TOKENS = 550;
const ONHAND_DEEP_OUTPUT_TOKENS = 1100;
const ONHAND_COMPACT_TEACHING_OUTPUT_TOKENS = 460;
const COMPACT_TEACHING_EXTRACT_MAX_CHARS = 5200;
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
- The page is the canvas. Read the page before answering when page context matters; anchor every answer drawn from the page with a source highlight on the supporting text, and add short marginal notes where they add interpretation. Keep the page unmarked only when the user asks for no page changes or the page does not support the claim.
- Every material page claim must be grounded in visible/readable page context. If you cannot point to a specific location on a specific open page, do not present the claim as coming from that page.
- Teach, don't tell. Help the user see how the page answers the question instead of replacing the page with a detached summary.
- The user's pages come first. Use the current tab and already-open tabs before navigation. New pages are a fallback only when the open material cannot answer.
- When the user explicitly asks to search online, look up external sources, open URLs, or take them to another source, that request is permission to navigate. Open or switch to the relevant source/search page, then ground claims on that page with highlights and notes. Preserve the user's current page by opening each distinct destination URL in its own tab unless the user explicitly asks to replace the current tab; reuse an already-open matching tab instead of creating duplicates.
- When the user asks to open, follow, inspect, check, or review links/notes/readings/resources listed on the current page or an already-open index/master page, that request is permission to navigate within those linked pages. Use browser_list_tabs when needed to recover the already-open index/master page, then browser_activate_tab, browser_find_elements, browser_click_text/browser_click, or browser_navigate to open each distinct linked page once in a tab, inspect it, and ground the final answer on the destination pages. Do not create repeat tabs for the same URL. Do not stop at highlighting the index/master page unless the index itself answers the question.
- Be concise in words, thorough in coverage. For broad teach/review/summarize prompts, choose the strongest one to three source highlights, not every point you mention, and add at most one short interpretive note unless the user explicitly asks for notes. Comparisons usually need two source highlights, one per side, with at most one note on the practical difference. Roadmap, list, process, derivation, proof, or other enumerable coverage tasks may need more highlights for required top-level items, but notes should stay sparse and only explain genuinely hard or reusable points. Thorough means covering the relevant required points, not annotating everything nearby.
- Write for a narrow side panel. Avoid dense wall-of-text paragraphs. Prefer short paragraphs, compact labeled sections, bullets, or numbered steps when explaining diagrams, processes, comparisons, lists, or multi-part ideas. Do not use horizontal rules like "---" as section separators in sidebar answers. For visual explanations, use labels like "What it shows", "How to read it", or "Takeaway" when useful. Keep trivial answers simple, but split deeper answers into scannable chunks instead of one long block.
- The session is the artifact. Preserve existing session highlights, notes, citations, and restoreable page state across follow-up questions unless the user explicitly asks to clear or replace them.
- Stay unobtrusive but make the marginalia carry weight. Add short interpretive notes only where they add future replay value — name the passage's role or explain the hard step under ~280 characters. Do not add a note for every highlight, and do not duplicate what the highlight already says. Place any longer detail in chat.
- Wording hygiene: do not narrate internal page-work plans or grounding preambles with phrases like "let me anchor", "let me ground this", "I'll anchor", "highlighted above", or "I highlighted". Start with the answer, then reference the source naturally.
- Math formatting: when writing LaTeX symbols or equations, wrap inline math in $...$ and display equations in $$...$$. Never leave raw LaTeX commands such as \\cdot, \\sqrt, \\frac, or \\text{} outside math delimiters, including inside bullets and numbered steps. If extracted page math is fragmented or missing operators, do not copy it verbatim into chat or source highlights; either rewrite a clean formula only when the intended formula is clear from context, or explain the relationship in words.

Default answer mode:
- For every question you answer from page material, create one durable source highlight on the exact visible/readable text that supports the answer, then answer in chat referencing that highlight. This applies to ordinary factual questions too: do not answer chat-only when the page supports the claim. Exceptions: if the user explicitly asks for no page changes, answer in prose only; for a quick visual figure/diagram question, answer sidebar-only after capturing the image; and if the page genuinely does not support the claim, say so rather than forcing a generic highlight. Add a short note when the highlight is interpretive (name the passage's role or explain a hard step); a plain confirmatory highlight may stand without a note. Requests to teach, review, walk through, or summarize what a page says, requests for highlighting/notes, evidence location, learning/review source markers, or source/navigation work all create highlights as well, following the multi-point rules below.
- If captured context already contains the needed text, answer from it and avoid extra inspection. If it does not, do one focused read of the current page before answering. Do not call the same read tool repeatedly unless the first result is unusable.
- If the user asks about a named section, heading, phrase, table, row, value, tensor, or item and the visible snapshot does not contain it, call browser_extract_content once before saying it is missing, not visible, or asking the user to scroll. A visible-text-only read is not enough to rule out offscreen page content.
- For follow-up questions that refer to an already-highlighted idea, reuse the existing session source when it supports the answer. Do not try to highlight a paraphrase of your own explanation; browser_highlight_text text must be copied from visible/readable page text.
- Grounding budget: simple questions still anchor on one strong highlight of the supporting text plus a short answer. If the user asks for annotations, evidence location, learning/review source markers, source-navigation work, or a page-level teaching/review summary, use one strong highlight and at most one short note for a simple claim. Do not annotate examples, side effects, or reuse details unless the user asked about those distinct points. For broad page teaching/review, highlight one to three central concepts — never the page title, course title, or a generic heading; prefer definitions, mechanisms, or conclusions over motivation-only contrasts unless a contrast is the whole answer. Add at most one note unless the user explicitly asks for notes. If you do not have successful highlights for later sections, keep the chat answer scoped to the highlighted source instead of writing a detached whole-page lecture. Roadmap/list/navigation questions are not simple if the answer names multiple steps or items, but notes should still be sparse.
- Quick visual questions such as "what does this figure show?", "what is this diagram?", or "try here" should usually be sidebar-only after capturing the visible region or PDF page image. Do not automatically add a note for a quick visual explanation. If a durable source marker is useful, prefer a caption/supporting-text highlight; add a note only when it adds future replay value beyond a label. This does not limit notes for learning, review, evidence-location, source-navigation, comparison, or deeper conceptual workflows.
- Add a short interpretive note (one to two sentences, under ~280 characters) only on highlights that carry explanatory weight: name the role of the passage or explain a hard step. Do not add notes that merely paraphrase the highlight; most confirmatory source highlights should stand without a note.
- Only successful highlight/note tool results count as source markers. If a highlight attempt fails, retry once with a smaller exact visible span, then omit/qualify that claim in chat.
- For multi-part, comparative, "show evidence", or confused follow-up questions, create a source highlight for each distinct key point you actually explain, but do not add extra highlights just to increase source count. For compare/contrast prompts, usually use two concise source highlights, one for each side, plus one short marginal note on the passage that captures the practical difference or takeaway; add at most one contrast/conclusion highlight when the page states it directly. Do not highlight full algorithms or every sub-step unless the user asks for that level of detail. Keep each note and chat paragraph short. Stop once the answer is supported.
- For roadmap, list, process, derivation, proof, or navigation questions, treat the prompt as an enumerable coverage task: every required step, item, or top-level peer you name in chat needs its own source highlight unless one highlighted list/table/span literally contains all named items. Mark sibling/top-level items first; do not spend multiple markers on child/subtopic items under one parent while other required top-level items have no marker. Once a parent/top-level item is marked, move to the next sibling item; do not mark child headings, examples, usage patterns, or subfeatures under that same item unless the user specifically asks for that item's internal breakdown. Do not rely on a heading-only highlight if the answer depends on items beneath it. Highlight the sentence, list item, formula label, or linked item that actually supports the claimed path. Use notes sparingly: add them only for the few items where an orienting explanation matters, not for every roadmap item. When the question asks for an overview of several named things, first identify the top-level peer items and highlight each item's own defining sentence or term — do not drill into one item's sub-sections while its sibling items go unmarked. Never include section numbers, list numbers, or "5.1."-style prefixes in browser_highlight_text; copy only the wording, because pages often render the number in a separate element so the prefixed text will not match. Always attempt to anchor a roadmap or overview on the page rather than answering with chat-only prose. If a particular required item's highlight genuinely fails after a retry, keep the item only if readable page context supports it and briefly say that marker could not be placed; never silently drop a required item or fabricate support.
- For "where does this page explain..." location questions, highlight the explanatory phrase or sentence that names the requested concept, not a math-only formula as the first or only source marker. If a formula is important, use it as a second highlight after the location/explanation highlight.
- For explicit named formula/equation/theorem requests, locate that named formula or its section first. Do not substitute a nearby unrelated formula just because it is visible. If the named formula is not in the visible snapshot, call browser_extract_content once, then highlight the exact formula text or the nearest phrase that names the formula.
- For list-shaped visible text, use the individual item wording for highlights. Markdown bullets and heading hashes in visible/readable text are structure cues; do not send a heading-plus-list block as one highlight.
- If the user asks what a page-wide list contains and the visible snapshot appears partial, call browser_extract_content once before answering. Do not replace missing list items with nearby headings or sections.
- Chat should be brief and tied to the page context: one to three short paragraphs or compact structured chunks for ordinary questions. When an answer needs depth, use headings, bullets, or numbered steps so it remains readable in the sidebar. Do not use horizontal rules as separators. For broad teaching/review summaries, avoid display equations unless the user asks for formula details; explain the relationship in prose when extracted math is dense or fragile. Do not add a long "other topics" or method-roadmap list that is not covered by the source highlights; offer to expand instead. When annotations are created, describe what those highlights show instead of giving a detached page summary.
- If the page does not contain the answer, say that briefly and ask whether to use another open tab or navigate elsewhere. Do not fabricate page support.
- If the user already asked for external sources, web search, Google, URLs, or to be taken to sources, do not ask again before navigating. Use browser_navigate with newTab true for a distinct destination URL, or activate/reuse an already-open matching tab, inspect the destination, and ground the answer on the destination page rather than the original page.
- If the user already asked to open or check relevant linked notes, readings, resources, articles, papers, or pages from the current page or a page used earlier in the session, do not keep only annotating the current page. If the current page is already a destination note, use browser_list_tabs to find the already-open course/index/master tab before asking the user for it; activate that tab, find or click the relevant links, open each distinct destination page once, inspect it, and place highlights/notes on the destination pages that support the answer.
- For PDFs, keep the same user-facing flow as normal pages. For selected/highlighted PDF text, use exact selected text from browser_get_selection, copied selection, or captured context first. Chrome's native PDF viewer is usually supported through selection, clipboard, or debugger fallbacks; do not claim it blocks selection merely because a fallback failed. If tool output says the reader is Google Scholar PDF Reader, describe it as Google Scholar PDF Reader even when the top-level tab URL is a direct PDF URL. If Google Scholar Reader or another third-party PDF reader blocks selected text, open browser_open_pdf_in_onhand_viewer and ask the user to highlight the passage there only if selected text did not transfer. Recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions in the future. Open browser_open_pdf_in_onhand_viewer whenever analysis, offscreen/deeper PDF reading, full-PDF search, durable PDF source markers, highlights, or notes would help; skip it only for quick one-sentence or yes/no selected-text answers when selected text is already available in a supported reader. For visual PDF questions about the current figure, slide, equation, diagram, screenshot, or visible page, capture the current PDF page image and answer in the sidebar first; do not automatically search/read/highlight/note just because the user says "try here" or asks what the visible figure shows. Add PDF highlights/notes for visual questions only when the user asks to mark/save/review it, asks where supporting evidence is, needs durable learning context, or the answer depends on a specific text passage. Do not treat a selected named concept, term, section heading, formula label, or paper mechanism as a quick selected-text answer: search/read the explanatory PDF section, jump to the best page when useful, highlight the strongest supporting passage, add one short note under 280 characters, then answer. When opening the viewer from another PDF reader, preserve the current selected text/page whenever available. If you use browser_pdf_search or browser_pdf_read_pages to answer from offscreen/deeper PDF pages, add a durable source highlight on the most important supporting passage with browser_highlight_text and a short browser_show_note under 280 characters unless the user asked for no page changes or this is only a quick visual explanation. If the user accepts an offer to go deeper in a PDF with "yes", "please", or similar, complete the offered search/read/jump/highlight/note workflow before answering. Never say you will highlight or add a note unless the corresponding tool call already succeeded. For Google Docs, browser_extract_content reads the document export, and browser_highlight_text can open the current Doc's PDF export in Onhand's viewer before highlighting; use that viewer only when annotation is needed instead of claiming the Docs editor itself is annotatable. For questions about offscreen PDF content, slides, or "where does it discuss..." use browser_pdf_search and browser_pdf_read_pages before answering; use browser_pdf_jump_to_page, browser_highlight_text, and browser_show_note to mark important supporting passages. Use browser_pdf_capture_page_image for visual slide/equation/figure grounding when text is insufficient.
- When the user asks about a cited work ("what does [14] say?", "open this reference", "what paper is that from?"), use browser_pdf_find_citation to look up the bibliography entry instead of searching manually. Highlight the entry in the current paper, then open the suggested URL with browser_navigate (newTab: true) so the user's paper stays open, hand a PDF result to the Onhand viewer, and highlight the passage in the cited work that answers the question. Ground the answer in the cited work itself, noting where both highlights are.
- When the user explicitly asks to compare or relate the current material to another open tab, another named source, or multiple open documents ("compare with the other paper", "how does this differ from the other open source?", "do these papers agree?"), use browser_list_tabs to identify the other source, read it with explicit tabId parameters (browser_get_visible_text, browser_extract_content, or the PDF tools) instead of switching the user away from their page, and highlight the key passage in each source. Do not infer cross-tab permission from standalone comparison or agreement wording such as "Do you agree with this?"; answer from the current page and ask before reading other tabs.
- When an answer draws on more than one tab or document, highlight or cite each substantive claim in the source that supports it and name that source (by title) next to the claim in chat. Never attribute a claim to a source it was not grounded in; if no open source supports a claim, say so rather than borrowing a nearby highlight.
- If the user explicitly asks for no page changes, keep the answer short and name the visible/source context you relied on.

Use click/type/navigation tools only when the user is clearly asking you to interact with the page. Do not submit forms, transmit sensitive data, create accounts, change permissions, or take high-stakes actions unless the user explicitly provided that instruction for the specific site and action. Use Markdown structure sparingly but intentionally; do not use horizontal rules as separators. Do not use Markdown tables unless the user explicitly asks for a table; use compact labeled bullets instead.`;

const ONHAND_LEARNING_MODE_APPEND = `Learning is enabled for this request.

Learning uses a tutoring stance:
- For direct conceptual questions, give a concise page-grounded answer first, then optionally ask one short page-grounded check. Do not make the check the whole answer unless the user explicitly asked to be quizzed.
- Stay fast: the first move should be a useful source highlight or page-grounded prompt, not a long preamble. In the answer, do not start with process narration like "let me ground this"; start with the lesson.
- Scaffold from the user's open material and recent conversation. If a prerequisite concept is needed, point to it first.
- Use onhand_record_learning_event to keep learner state current: record a concept when you introduce it, record a prediction/retrieval check when you place it, and resolve an open check before moving on when the user answers it.
- A concept is one reviewable learning unit, not every highlighted detail, citation, algebra step, or note. Record multiple concepts in one turn only when each would deserve its own future retrieval check.
- If a new point is a restatement, detail, or follow-up on an existing concept, reuse that conceptId and update/append its source instead of creating a new concept row.
- Include annotationId, tabTitle, and url in learning events whenever you have them from browser tool results. If you open a check, reuse the returned checkId when resolving it later.
- If a concept is already in learner state, prefer a lightweight refresher: use the existing source highlight, avoid broad re-inspection, add at most one replacement highlight and no note unless the user asks for a deeper pass, and do not re-explain from scratch.
- If that concept already has an open check, do not open or record a second check. Point back to the existing check or ask the user to answer it.
- If the user's latest turn is an answer to an open check, acknowledges/frustrates about a repeated check, or asks "did I not answer?", resolve or respond to that check from the conversation state before doing any new page grounding. Do not add fresh annotations for this meta/follow-up turn.
- Make the user think out loud when productive: prediction, "say it back", or "what changes if..." prompts must be tied to a highlight or note, not floated in chat.
- Nudge before correcting. If the user is wrong or stuck, point to the relevant text and give a hint before stating the correction.
- Cross-tab interleaving is offer-first. Scan the captured open-tab list, and call browser_list_tabs once only if the captured list is missing or ambiguous. If another already-open tab likely contains a prerequisite, contrast, or related example, name that tab briefly and ask whether the user wants to connect it. This offer-first rule does not apply when the user explicitly asks to check/open other linked notes/resources from a course/index/master page or from topics you already mentioned; in that case, use the already-open index tab if available.
- Do not switch to, read, highlight, or note a related tab unless the user explicitly asks for cross-tab work or accepts the offer. If the user did ask for cross-tab comparison, highlight each page separately and say which tab supports which claim.
- Do not record an offered related tab as a learning source until you actually inspect or highlight it.
- Homework/problem priority: if the page or prompt looks like an exercise, problem set, assignment, quiz, exam, or the user asks for a "final answer" to a problem, do not give the final numeric, symbolic, or code answer in Learning mode, even if the user asks directly.
- For homework/problem prompts, highlight the problem and the relevant rule or setup, add a short note if helpful, then ask for the next step the learner should do. For example, ask them to identify inside/outside functions, compute the inner derivative, choose the rule, or write the next line. Do not reveal the final answer until the user switches to answer mode or presents their own completed work and asks for feedback.
- Drop the Socratic stance only for non-homework conceptual questions, study artifacts, or visibly frustrated users; the homework/problem priority still wins. Still ground material claims in page context.`;

const PROMPT_EVAL_SOURCE_PATTERN = /^prompt-eval(?:\b|[-_:])/i;
const PROMPT_EVAL_APPEND_MAX_CHARS = 12000;

function isPromptEvalSource(value: unknown) {
	return PROMPT_EVAL_SOURCE_PATTERN.test(String(value || "").trim());
}

function normalizePromptEvalAppend(value: unknown) {
	const text = String(value || "").replace(/\r\n?/g, "\n").trim();
	if (!text) return "";
	return text.length > PROMPT_EVAL_APPEND_MAX_CHARS
		? `${text.slice(0, PROMPT_EVAL_APPEND_MAX_CHARS).trimEnd()}\n\n[Prompt-eval append truncated.]`
		: text;
}

function buildPromptEvalSystemPrompt(systemPrompt: string, evalAppend = "", evalVariant = "") {
	const append = normalizePromptEvalAppend(evalAppend);
	if (!append) return systemPrompt;
	const label = evalVariant ? `Temporary prompt-eval system policy candidate (${evalVariant}):` : "Temporary prompt-eval system policy candidate:";
	return [systemPrompt, label, append].join("\n\n");
}

const LIST_TABS_SCHEMA = Type.Object({
	onlyActive: Type.Optional(Type.Boolean({ description: "Only include active tabs" })),
});

const OPTIONAL_NUMBER_OR_STRING_SCHEMA = (description: string) =>
	Type.Optional(Type.Union([Type.Number(), Type.String()], { description }));

const TAB_SELECTOR_SCHEMA = {
	tabId: OPTIONAL_NUMBER_OR_STRING_SCHEMA("Exact browser tab ID to target. Omit this to use the active tab."),
};

const TAB_MATCH_SCHEMA = {
	...TAB_SELECTOR_SCHEMA,
	windowId: OPTIONAL_NUMBER_OR_STRING_SCHEMA("Exact browser window ID to target. Omit this to use the active window."),
	titleContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab title" })),
	urlContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab URL" })),
};

const READ_TAB_SELECTOR_SCHEMA = {
	...TAB_SELECTOR_SCHEMA,
};

const NAVIGATE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	url: Type.String({ description: "HTTP(S) URL to navigate to. Do not use browser_navigate for file:// URLs; local files must be opened manually by the user first." }),
	newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab instead of navigating the current or matched tab. Defaults to true when the destination differs from the starting page, but the browser reuses an already-open matching URL instead of creating duplicates. Set false only to reload or deliberately replace the current page." })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the tab to finish loading" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds" })),
});

const OPEN_PDF_VIEWER_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	pdfUrl: Type.Optional(Type.String({ description: "Direct http(s) PDF URL. Omit this to infer it from the target tab URL, including Google Docs document URLs via PDF export." })),
	newTab: Type.Optional(Type.Boolean({ description: "Open the Onhand viewer without replacing the target tab when needed. If a matching Onhand PDF viewer is already open for the same PDF, reuse it instead of creating a duplicate." })),
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
	query: Type.Optional(Type.String({ description: "Short search query used to prioritize matching headings, tables, rows, or values in long pages" })),
});

const TEXTBOOK_SEARCH_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	query: Type.String({ description: "Word, phrase, name, or concept to search using the current online textbook or reader's own search UI" }),
	maxResults: Type.Optional(Type.Number({ description: "Maximum reader search results to return" })),
	openResult: Type.Optional(Type.Boolean({ description: "Open the chosen reader search result. Defaults to false; use only when navigation is needed to answer. After a successful openedResult.navigated=true, use browser_extract_content once on the opened page instead of manually clicking through the reader UI." })),
	resultIndex: Type.Optional(Type.Number({ description: "1-based search result index to open when openResult is true. Defaults to 1." })),
	timeoutMs: Type.Optional(Type.Number({ description: "Maximum time in milliseconds to wait for the reader search UI to return results" })),
	readyTimeoutMs: Type.Optional(Type.Number({ description: "Maximum time in milliseconds to wait for the reader app search shell to hydrate" })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the target tab to finish loading before searching. Defaults to true." })),
	loadTimeoutMs: Type.Optional(Type.Number({ description: "Maximum time in milliseconds to wait for the reader tab load before searching" })),
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
	clearExisting: Type.Optional(Type.Boolean({ description: "Clear existing Onhand highlights first. Defaults to false so follow-up source highlights accumulate." })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Scroll the highlighted match into view" })),
});

const SHOW_NOTE_SCHEMA = Type.Object({
	...TAB_MATCH_SCHEMA,
	annotationId: Type.String({ description: "Annotation ID returned by browser_highlight_text" }),
	note: Type.String({ description: "A short interpretive marginal note (1-2 sentences, under ~280 characters) shown near the highlighted content. Name the passage's role or explain the hard step; do not paraphrase the highlight. Put longer detail in chat." }),
	label: Type.Optional(Type.String({ description: "Optional short label shown above the note" })),
	scrollIntoView: Type.Optional(Type.Boolean({ description: "Keep the highlighted content in view when showing the note" })),
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
	scrollIntoView: Type.Optional(Type.Boolean({ description: "When selector is provided, scroll it into view before capture. Defaults to true." })),
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
	annotationId: Type.Optional(Type.String({ description: "Annotation id for the source highlight tied to this learning event" })),
	artifactId: Type.Optional(Type.String({ description: "Artifact id for the source material tied to this learning event" })),
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
const READER_SEARCH_TOOL_NAMES = ["browser_textbook_search"];

const VISUAL_CONTEXT_TOOL_NAMES = ["browser_get_visible_region_image"];
const VISUAL_GROUNDING_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation", "browser_clear_annotations"];
const PDF_ANNOTATION_TOOL_NAMES = ["browser_highlight_text", "browser_show_note", "browser_scroll_to_annotation"];
const PAGE_CHANGE_TOOL_NAMES = [
	"browser_highlight_text",
	"browser_show_note",
	"browser_clear_annotations",
	"browser_capture_state",
	"browser_restore_state",
];
const TAB_TOOL_NAMES = ["browser_list_tabs", "browser_activate_tab", "browser_navigate", "browser_open_pdf_in_onhand_viewer"];
const PDF_TOOL_NAMES = ["browser_pdf_search", "browser_pdf_read_pages", "browser_pdf_jump_to_page", "browser_pdf_capture_page_image", "browser_pdf_find_citation"];
const ELEMENT_READ_TOOL_NAMES = ["browser_find_elements"];
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
const BROAD_SOURCE_TOOL_NAMES = [...CORE_READ_TOOL_NAMES, ...TAB_TOOL_NAMES, ...ELEMENT_READ_TOOL_NAMES];
const KNOWN_BROWSER_TOOL_NAMES = new Set([
	...CORE_READ_TOOL_NAMES,
	...READER_SEARCH_TOOL_NAMES,
	...VISUAL_CONTEXT_TOOL_NAMES,
	...VISUAL_GROUNDING_TOOL_NAMES,
	...PAGE_CHANGE_TOOL_NAMES,
	...TAB_TOOL_NAMES,
	...PDF_TOOL_NAMES,
	...ELEMENT_READ_TOOL_NAMES,
	...INTERACTION_TOOL_NAMES,
	...DEBUG_INSPECTION_TOOL_NAMES,
	...RUNTIME_JS_TOOL_NAMES,
	...ARTIFACT_TOOL_NAMES,
]);
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
	const normalizedText = String(text || "").toLowerCase();
	return textHasAny(
		normalizedText,
		/\b(take me to|open (?:up )?(?:the |a |an )?(?:url|link|source|site|page|tab|article|paper|website|result|google|web|browser)|look up|search(?: up)?|google|web|online|external|outside sources?|other sources?|more sources?|(?:find|show) (?:me )?(?:a |an |one |some |a few |more )?(?:source|sources|reference|references|paper|papers|article|articles)(?:\s+that|\s+which|\s+for|\b)|go (?:on|to) google|url)\b/,
	);
}

function promptAsksForLinkedPageNavigation(text: string) {
	const explicitNavigationVerb = /\b(open(?: up)?|follow|click|visit|navigate(?: to)?|go to|load|pull up|bring up)\b/;
	const linkedResourceTarget = /\b(linked?|links?|notes?|lecture notes?|readings?|resources?|source pages?|linked pages?)\b/;
	const genericLinkedDestination = /\b(?:linked|listed|referenced|cited|source|related|relevant|other)\s+(?:pages?|articles?|papers?|documents?)\b|\b(?:pages?|articles?|papers?|documents?)\s+(?:linked|listed|referenced|cited|on this page|from this page)\b/;
	if (textHasAny(text, explicitNavigationVerb) && (textHasAny(text, linkedResourceTarget) || textHasAny(text, genericLinkedDestination))) return true;
	return textHasAny(
		text,
		/\b(find|check|inspect|look at|review|read|scan)\b[\s\S]{0,120}\b(other|relevant|important|useful|related)\s*(notes?|lecture notes?|links?|readings?|resources?|source pages?|linked pages?)\b|\b(other|relevant|important|useful|related)\s*(notes?|lecture notes?|links?|readings?|resources?|source pages?|linked pages?)\b[\s\S]{0,120}\b(find|check|inspect|look at|review|read|scan)\b/,
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

function formatGoogleDocsSelectionFallbackForModel(value: any) {
	const fallback = value?.googleDocsSelectionFallback;
	if (!fallback || typeof fallback !== "object" || fallback.attempted !== true) return "";
	const status = fallback.ok === true ? "ok" : "failed";
	const error = String(fallback.error || "").trim();
	return `Google Docs selection fallback: ${status}${error ? ` (${truncate(error, 300)})` : ""}`;
}

function pdfReaderLabelFromSelection(value: any) {
	if (!value || typeof value !== "object") return "";
	if (value.googleScholarReader?.detected || value.viewer === "google-scholar") return "Google Scholar PDF Reader";
	if (value.viewer === "chrome-pdf-viewer" || /native-chrome-pdf-viewer/i.test(String(value.source || ""))) return "Chrome native PDF viewer";
	if (value.viewer) return String(value.viewer);
	return "";
}

function formatPdfReaderStatusForModel(value: any) {
	const label = pdfReaderLabelFromSelection(value);
	if (!label) return "";
	const reader = value?.googleScholarReader && typeof value.googleScholarReader === "object" ? value.googleScholarReader : null;
	const state = String(reader?.selectionState || "").trim();
	if (label === "Google Scholar PDF Reader" && state && state !== "text") {
		return `PDF reader: ${label}\nGoogle Scholar selected/highlighted text status: ${state}. The reader was detected, but selected text was not readable. Use the Onhand PDF viewer for this selection, and recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions.`;
	}
	return `PDF reader: ${label}`;
}

function formatPdfSelectionFallbackForModel(value: any) {
	if (!value || typeof value !== "object") return "";
	const fallbacks = [
		["Google Scholar PDF selection", value.googleScholarReaderSelectionFallback],
		["Native PDF selection", value.nativePdfSelectionFallback],
		["Browser PDF copy selection", value.browserClipboardSelectionFallback],
		["PDF frame selection", value.debuggerFrameSelectionFallback],
	].filter((entry): entry is [string, any] => {
		const fallback = entry[1];
		return fallback && typeof fallback === "object" && fallback.attempted === true;
	});
	const mainFrameError = String(value.mainFrameSelectionError || "").trim();
	const readerStatus = getSelectionText(value) ? "" : formatPdfReaderStatusForModel(value);
	if (!readerStatus && !fallbacks.length && !mainFrameError) return "";
	const lines = fallbacks.map(([label, fallback]) => {
		const status = fallback.ok === true ? "ok" : "failed";
		const error = String(fallback.error || "").trim();
		return `${label}: ${status}${error ? ` (${truncate(error, 220)})` : ""}`;
	});
	if (mainFrameError) lines.unshift(`PDF main-frame selection: failed (${truncate(mainFrameError, 220)})`);
	return [readerStatus, lines.join("\n")].filter(Boolean).join("\n");
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
		.replace(/^\s*\d+(?:\.\d+)+\.\s+/u, "")
		.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
		.replace(/^\s{0,3}#{1,6}\s+/, "")
		.replace(/\s+/g, " ")
		.trim();
}

function stripShortLeadingHighlightLabel(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	const match = text.match(/^([^:\n]{2,70}):\s+(.{16,})$/u);
	if (!match) return text;
	const labelWords = match[1].match(/[A-Za-z][A-Za-z]{2,}/g) || [];
	if (labelWords.length > 6) return text;
	return match[2].trim();
}

function cleanMarkdownHeadingHighlightText(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	if (!text) return "";
	const cleaned = text
		.replace(/^#{1,6}\s+/, "")
		.replace(/[¶#]+$/g, "")
		.trim();
	if (!cleaned || cleaned === text) return "";
	if (cleaned.length < 3 || cleaned.length > HIGHLIGHT_RETRY_MAX_CHARS) return "";
	return cleaned;
}

function stripTrailingHeadingAnchorMarker(value: unknown) {
	const text = String(value || "").trim();
	if (!text) return "";
	const cleaned = text.replace(/\s*¶+$/gu, "").trim();
	if (!cleaned || cleaned === text) return "";
	return cleaned;
}

function trimHighlightCandidateBeforeFormulaNoise(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	if (!text) return "";
	const colonFormula = text.match(/^(.{20,220}?:)\s+\S{0,90}(?:[=~∼≈≤≥<>|∣\\{}_^]|[∫∑∏√])/u);
	if (colonFormula?.[1]) return colonFormula[1].trim();
	return text;
}

const HIGHLIGHT_RETRY_MAX_CANDIDATES = 5;
const HIGHLIGHT_RETRY_MAX_CHARS = 180;
const HIGHLIGHT_FAILURE_ABORT_LIMIT = 4;
const COMPACT_TEACHING_HIGHLIGHT_FAILURE_ABORT_LIMIT = 3;
const HIGHLIGHT_SKIP_ORIGINAL_OVER_CHARS = 320;
const HIGHLIGHT_PREFLIGHT_MEDIUM_MIN_CHARS = 72;
const HIGHLIGHT_PREFLIGHT_MEDIUM_MIN_WORDS = 10;
const HIGHLIGHT_COMMAND_TIMEOUT_MS = 6000;
const HIGHLIGHT_TOOL_CALL_TIMEOUT_MS = 12000;
const ANNOTATION_COMMAND_TIMEOUT_MS = 6000;
const TEACHING_SOURCE_HIGHLIGHT_MAX = 3;
const TEACHING_SOURCE_NOTE_MAX = 1;
const COMPACT_TEACHING_HIGHLIGHT_ERROR_LIMIT = 2;
const STRUCTURED_SOURCE_NOTE_MAX = 3;
const COMPARISON_SOURCE_HIGHLIGHT_MAX = 4;
const STRUCTURED_SOURCE_HIGHLIGHT_ERROR_LIMIT = 2;

function shouldTryHighlightScanFallbackBeforeOriginal(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	if (!text || text.length > 100) return false;
	if (/[.!?;:]/.test(text) || /[=∫∏∑√≈≤≥<>|∣\\{}_^]/u.test(text)) return false;
	const wordCount = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
	return wordCount >= 1 && wordCount <= 6;
}

function highlightRetryWordCount(value: unknown) {
	return (normalizeHighlightRetryCandidate(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function buildHighlightRetryCandidates(value: unknown) {
	const raw = String(value || "").trim();
	if (!raw) return [];
	const hasListShape = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/u.test(raw);
	const hasMultipleLines = raw.split(/\r?\n/).filter((line) => line.trim()).length > 1;
	const hasFormulaNoise = /[=∫∏∑√≈≤≥<>|∣\\{}_^]/u.test(raw);
	const retryLimit = hasFormulaNoise ? 2 : HIGHLIGHT_RETRY_MAX_CANDIDATES;

	const candidates: string[] = [];
	const addCandidate = (candidate: unknown) => {
		const normalized = normalizeHighlightRetryCandidate(candidate);
		if (normalized.length < 16 || normalized.length > HIGHLIGHT_RETRY_MAX_CHARS) return;
		const wordTokens = normalized.match(/[A-Za-z][A-Za-z]{2,}/g) || [];
		if (wordTokens.length < 3) return;
		if (normalized.toLowerCase() === normalizeHighlightRetryCandidate(raw).toLowerCase()) return;
		if (!candidates.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized);
	};
	const addCandidateVariants = (candidate: unknown) => {
		const normalized = normalizeHighlightRetryCandidate(candidate);
		if (!normalized) return;
		const withoutLabel = stripShortLeadingHighlightLabel(normalized);
		addCandidate(trimHighlightCandidateBeforeFormulaNoise(withoutLabel));
		addCandidate(trimHighlightCandidateBeforeFormulaNoise(normalized));
		addCandidate(withoutLabel);
		addCandidate(normalized);
	};

	for (const line of raw.split(/\r?\n/)) addCandidateVariants(line);
	for (const part of raw.split(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/u)) addCandidateVariants(part);
	if (!hasListShape || !hasMultipleLines) {
		const normalizedRaw = normalizeHighlightRetryCandidate(raw);
		const parts = normalizedRaw
			.split(/(?<=[!?;:])\s+|(?<!r\.v\.)(?<!e\.g\.)(?<!i\.e\.)(?<=[.])\s+|\s+[–—-]\s+/iu)
			.map((part) => part.trim())
			.filter(Boolean);
		for (const part of parts) {
			addCandidateVariants(part);
			const clausePattern = hasFormulaNoise
				? /\s+(?:which|where|because|but|then|so)\s+/i
				: /\s+(?:which|where|because|but|then|so|from|using|via|through|between|with)\s+/i;
			for (const clause of part.split(clausePattern)) {
				addCandidateVariants(clause);
			}
		}
		if (normalizedRaw.length > HIGHLIGHT_RETRY_MAX_CHARS) {
			const words = normalizedRaw.split(/\s+/).filter(Boolean);
			for (let index = 0; index < words.length; index += 10) {
				addCandidateVariants(words.slice(index, index + 22).join(" "));
				if (candidates.length >= HIGHLIGHT_RETRY_MAX_CANDIDATES) break;
			}
		}
	}
	if (!candidates.length) {
		for (const candidate of getReplayHighlightCandidates(raw)) addCandidateVariants(candidate);
	}

	return candidates.slice(0, retryLimit);
}

function shouldTryHighlightRetryCandidatesBeforeOriginal(value: unknown) {
	const normalized = normalizeHighlightRetryCandidate(value);
	if (normalized.length > HIGHLIGHT_RETRY_MAX_CHARS) return true;
	if (normalized.length < HIGHLIGHT_PREFLIGHT_MEDIUM_MIN_CHARS) return false;
	if (highlightRetryWordCount(normalized) < HIGHLIGHT_PREFLIGHT_MEDIUM_MIN_WORDS) return false;
	if (/[=∫∏∑√≈≤≥<>|∣\\{}_^]/u.test(normalized)) return false;
	return buildHighlightRetryCandidates(normalized).length > 0;
}

function shouldSkipOriginalHighlightAttempt(value: unknown, attemptedCandidates: number) {
	if (!attemptedCandidates) return false;
	return normalizeHighlightRetryCandidate(value).length > HIGHLIGHT_SKIP_ORIGINAL_OVER_CHARS;
}

function annotationCommandTimeoutMs(commandName: string) {
	if (commandName === "highlight_text") return HIGHLIGHT_COMMAND_TIMEOUT_MS;
	if (["show_note", "scroll_to_annotation", "clear_annotations"].includes(commandName)) return ANNOTATION_COMMAND_TIMEOUT_MS;
	return 0;
}

async function withToolCommandTimeout(label: string, timeoutMs: number, run: () => Promise<any>) {
	return await new Promise((resolve, reject) => {
		let settled = false;
		const timeoutId = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error(`${label} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		Promise.resolve()
			.then(run)
			.then((result) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				resolve(result);
			})
			.catch((error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				reject(error);
			});
	});
}

function countToolTracesByState(request: any, toolName: string, states: string[] = []) {
	const allowedStates = new Set(states);
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).filter((trace: any) => {
		if (trace?.toolName !== toolName) return false;
		return !allowedStates.size || allowedStates.has(trace?.state);
	}).length;
}

function tracePageUrl(trace: any) {
	const direct = String(trace?.resultDetails?.tab?.url || trace?.details?.tab?.url || trace?.tab?.url || "");
	if (direct) return direct;
	const match = String(trace?.resultSummary || "").match(/https?:\/\/[^\s)>\]]+/i);
	return match ? match[0].replace(/[.,;:]+$/g, "") : "";
}

function highlightFailureBudgetTraceWindow(request: any) {
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	let lastNavigationIndex = -1;
	let lastNavigationIdentity = "";
	traces.forEach((trace: any, index: number) => {
		if (trace?.state !== "complete") return;
		const toolName = String(trace?.toolName || "");
		if (toolName !== "browser_navigate" && toolName !== "browser_activate_tab") return;
		const tabUrl = tracePageUrl(trace);
		if (!tabUrl) {
			lastNavigationIdentity = "";
			lastNavigationIndex = index;
			return;
		}
		if (tabUrl.startsWith("chrome-extension://")) return;
		const navigationIdentity = normalizeUrlForPriorPageContext(tabUrl);
		if (navigationIdentity && navigationIdentity === lastNavigationIdentity) return;
		lastNavigationIdentity = navigationIdentity;
		lastNavigationIndex = index;
	});
	return lastNavigationIndex >= 0 ? traces.slice(lastNavigationIndex + 1) : traces;
}

const READABLE_SOURCE_FALLBACK_TOOL_NAMES = new Set([
	"browser_extract_content",
	"browser_get_visible_text",
	"browser_get_viewport_headings",
	"browser_find_elements",
]);

function traceHasReadableFallbackContent(trace: any) {
	if (!trace || trace.state !== "complete") return false;
	if (!READABLE_SOURCE_FALLBACK_TOOL_NAMES.has(String(trace.toolName || ""))) return false;
	const text = [
		trace.resultSummary,
		trace.resultText,
		trace.result,
		trace.details?.text,
		trace.details?.content,
		trace.resultDetails?.text,
		trace.resultDetails?.content,
	]
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter(Boolean)
		.join("\n");
	return /\S/.test(text);
}

function hasReadableSourceContentAfterLatestNavigation(request: any) {
	return highlightFailureBudgetTraceWindow(request).some(traceHasReadableFallbackContent);
}

function shouldAbortAfterRepeatedHighlightFailures(request: any) {
	if (!request || request.aborted) return false;
	const traces = highlightFailureBudgetTraceWindow(request);
	if (traces.some(isCompletedSourceHighlightTrace)) return false;
	const prompt = request?.displayPrompt || "";
	const hasReadableSourceContent = hasReadableSourceContentAfterLatestNavigation(request);
	const asksForExternalOrLinkedSource = promptAsksForExternalBrowsing(prompt) || promptAsksForLinkedPageNavigation(prompt);
	const failureLimit =
		asksForExternalOrLinkedSource && hasReadableSourceContent
			? 1
			: asksForExternalOrLinkedSource
			? 2
			: promptAsksForCompactPageTeaching(prompt) && !promptAsksForStructuredPageSourceMarker(prompt) && !promptAsksForComparison(prompt)
			? COMPACT_TEACHING_HIGHLIGHT_FAILURE_ABORT_LIMIT
			: HIGHLIGHT_FAILURE_ABORT_LIMIT;
	return traces.filter((trace: any) => trace?.toolName === "browser_highlight_text" && trace?.state === "error").length >= failureLimit;
}

function buildRepeatedHighlightFailureGuardResult(toolName: string, commandName: string, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!shouldAbortAfterRepeatedHighlightFailures(request)) return null;
	const prompt = request?.displayPrompt || request?.prompt || "";
	const hasReadableSourceContent = hasReadableSourceContentAfterLatestNavigation(request);
	const shouldTryAlternateSource =
		(promptAsksForExternalBrowsing(prompt) || promptAsksForLinkedPageNavigation(prompt)) && !hasReadableSourceContent;
	return {
		guardrail: {
			kind: "repeated_highlight_failure",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: shouldTryAlternateSource
				? [
						"Highlighting has failed repeatedly on this source page.",
						`Do not call ${toolName} again on the same page for this turn.`,
						"Open or activate a different credible source page, a simpler printable page, or another already-open source tab, then retry one short exact source highlight there before answering.",
						"Only answer without a durable highlight if the alternate source page also fails. Do not use Markdown tables or horizontal rules.",
					].join(" ")
				: [
						"Highlighting has failed repeatedly on this page, so durable source highlights are not available here.",
						`Do not call ${toolName} again for this turn.`,
						"Answer the user's question now from the readable page content.",
						"Do not mention highlight failures, source-marker status, or claim the page is highlighted. Do not use Markdown tables or horizontal rules.",
					].join(" "),
		},
	};
}

const POST_HIGHLIGHT_FAILURE_ANSWER_NOW_COMMANDS = new Set([
	"activate_tab",
	"navigate",
	"click",
	"extract_content",
	"find_elements",
	"get_scroll_state",
	"get_viewport_headings",
	"get_visible_text",
]);

function buildPostHighlightFailureAnswerNowGuardResult(toolName: string, commandName: string, request: any) {
	if (commandName === "highlight_text") return null;
	if (!POST_HIGHLIGHT_FAILURE_ANSWER_NOW_COMMANDS.has(commandName)) return null;
	if (!shouldAbortAfterRepeatedHighlightFailures(request)) return null;
	if (!hasReadableSourceContentAfterLatestNavigation(request)) return null;
	return {
		guardrail: {
			kind: "post_highlight_failure_answer_now",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"Highlighting has already failed repeatedly, and readable page content for this source is available.",
				`Do not call ${toolName} or more page navigation/read tools for this turn.`,
				"Answer the user's question now from the readable page content.",
				"Do not mention highlight failures, source-marker status, or claim the page is highlighted.",
			].join(" "),
		},
	};
}

function getSelectionText(selection: unknown) {
	if (typeof selection === "string") return selection.trim();
	if (selection && typeof selection === "object" && typeof (selection as any).text === "string") {
		return (selection as any).text.trim();
	}
	return "";
}

function getSelectionPageNumber(selection: unknown) {
	if (!selection || typeof selection !== "object") return null;
	const details = selection as any;
	const pageNumber = Number(details.pageNumber || details.pdfAnchor?.pageNumber || 0);
	return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

function getSelectionSourceLabel(selection: unknown) {
	if (!selection || typeof selection !== "object") return "";
	const details = selection as any;
	if (details.source === "debugger-frame-selection" || details.frameId || details.contextOrigin) {
		return "frame";
	}
	if (details.surface === "google-docs" || String(details.source || "").startsWith("google-docs-")) {
		return "Google Docs";
	}
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

const ON_PAGE_NOTE_MAX_CHARS = 280;

function compactOnPageNoteText(value: unknown, maxChars = ON_PAGE_NOTE_MAX_CHARS) {
	const text = compactActionText(value);
	if (!text) return "";
	const firstSentence = text.match(/^(.{12,}?[.!?])(?:\s|$)/);
	if (firstSentence && firstSentence[1].length <= maxChars) return firstSentence[1].trim();
	if (text.length <= maxChars) return text;

	const head = text.slice(0, Math.max(0, maxChars - 3)).trimEnd();
	const minBoundary = Math.floor(maxChars * 0.6);
	let boundary = -1;
	for (const token of [". ", "; ", ": ", ", ", " "]) {
		const index = head.lastIndexOf(token);
		if (index >= minBoundary) boundary = Math.max(boundary, index);
	}
	const trimmed = (boundary >= minBoundary ? head.slice(0, boundary) : head)
		.replace(/[,:;.\-\s]+$/g, "")
		.trimEnd();
	return `${trimmed || head}...`;
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
	const baseUrl = (override || ONHAND_FREE_TIER_DEFAULT_BASE_URL).replace(/\/+$/, "");
	if (!baseUrl) {
		throw new Error("Onhand Free is not configured. Set chrome.storage.local.onhandFreeTierBaseUrl to the deployed free-tier Worker URL.");
	}
	return baseUrl;
}

async function getFreeTierQuotaBypassSecret(): Promise<string> {
	const stored = await chrome.storage.local.get({
		[ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY]: "",
		[ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY]: "",
	});
	const expiresAt = String(stored[ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY] || "").trim();
	const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
	if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return "";
	return String(stored[ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY] || "").trim();
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
	const quotaBypassSecret = await getFreeTierQuotaBypassSecret();
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
		...(quotaBypassSecret
			? { headers: { [ONHAND_FREE_QUOTA_BYPASS_HEADER]: quotaBypassSecret } }
			: {}),
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
			`I'll mark this ${check.kind} check on ${conceptLabel} as answered and keep using the existing source highlight for it.`,
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

function buildExistingAnchorContext(session: RuntimeSession, maxAnchors = 8) {
	const annotations = buildReplayAnnotationsFromPageActions(collectSessionPageActions(session));
	if (!annotations.length) return "";
	const lines = annotations.slice(-maxAnchors).map((annotation, index) => {
		const annotationId = compactActionText(annotation.annotationId);
		const pageNumber = Number(annotation.pdfAnchor?.pageNumber || 0);
		const title = compactActionText(annotation.title);
		const matchedText = truncate(stripReplayCitationMarkers(annotation.matchedText || ""), 220);
		const noteText = truncate(stripReplayCitationMarkers(annotation.noteText || ""), 120);
		const metadata = [
			annotationId ? `annotationId=${annotationId}` : "",
			Number.isFinite(pageNumber) && pageNumber > 0 ? `p. ${pageNumber}` : "",
			title ? `tab="${truncate(title, 60)}"` : "",
		].filter(Boolean).join(", ");
		const note = noteText ? `; note=${JSON.stringify(noteText)}` : "";
		return `${index + 1}. ${metadata || "existing source"}: ${JSON.stringify(matchedText)}${note}`;
	});
	return [
		"Existing session source highlights already available:",
		"Reuse these source highlights on follow-up questions when they support the answer. Do not recreate, re-highlight, or re-note the same passage; add a new source highlight only for genuinely new supporting evidence.",
		"If you need to bring an existing source highlight into view, use browser_scroll_to_annotation with its annotationId instead of browser_highlight_text.",
		...lines,
	].join("\n");
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

function normalizeAssistantTextBlockIndex(value: unknown, fallback = 0) {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

function joinAssistantTextBlocks(blocks: AssistantDraftTextBlock[] = []) {
	return [...blocks]
		.sort((left, right) => normalizeAssistantTextBlockIndex(left?.contentIndex) - normalizeAssistantTextBlockIndex(right?.contentIndex))
		.map((block) => String(block?.text || "").trim())
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

function ensureAssistantDraftTextBlock(request: any, contentIndex: unknown) {
	if (!request || typeof request !== "object") return null;
	const index = normalizeAssistantTextBlockIndex(contentIndex, Array.isArray(request.replyBlocks) ? request.replyBlocks.length : 0);
	if (!Array.isArray(request.replyBlocks)) request.replyBlocks = [];
	let block = request.replyBlocks.find((candidate: AssistantDraftTextBlock) => candidate?.contentIndex === index);
	if (!block) {
		block = { contentIndex: index, text: "" };
		request.replyBlocks.push(block);
	}
	return block;
}

function appendAssistantDraftTextDelta(request: any, event: any) {
	const block = ensureAssistantDraftTextBlock(request, event?.contentIndex);
	if (!block) return "";
	block.text += String(event?.delta || "");
	request.reply = joinAssistantTextBlocks(request.replyBlocks);
	return request.reply;
}

function resetAssistantDraftText(request: any) {
	if (!request || typeof request !== "object") return "";
	request.reply = "";
	request.replyBlocks = [];
	return request.reply;
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return joinAssistantTextBlocks(
		content
			.filter((block: any) => block?.type === "text")
			.map((block: any, index) => ({
				contentIndex: typeof block?.contentIndex === "number" ? block.contentIndex : index,
				text: block.text || "",
			})),
	);
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

function hasCompletedUserToolTrace(request: any) {
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).some(
		(trace: any) => trace?.state === "complete" && trace?.toolName && !isInternalToolName(trace.toolName),
	);
}

function hasCompletedToolTrace(request: any, toolName: string) {
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).some(
		(trace: any) => trace?.state === "complete" && trace?.toolName === toolName,
	);
}

function shouldRequirePageSourceMarkerRetry(request: any) {
	if (!request || request.aborted || request.pageSourceMarkerRetry || request.pdfAnchorRetry) return false;
	if (promptForbidsPageChanges(request.displayPrompt)) return false;
	if (!promptRequiresPageSourceMarker(request.displayPrompt)) return false;
	if (hasCompletedToolTrace(request, "browser_pdf_read_pages")) return false;
	const requiredHighlights = promptAsksForStructuredPageSourceMarker(request.displayPrompt) ? 2 : 1;
	return completedSourceHighlightCount(request) < requiredHighlights;
}

function buildPageSourceMarkerRetryPrompt(request: any, assistantText: string) {
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	const structured = promptAsksForStructuredPageSourceMarker(request?.displayPrompt);
	const completedHighlights = completedSourceHighlightCount(request);
	const markerInstruction = structured
		? completedHighlights > 0
			? "This structured page answer needs one more durable source marker before the final chat answer."
			: "This structured page answer needs durable page source markers before the final chat answer."
		: "This page-grounded answer needs a durable page source marker before the final chat answer.";
	const highlightInstruction = structured
			? [
				"Before answering, call browser_highlight_text with short exact visible/readable spans for the key claims.",
				"For roadmap, list, process, derivation, or proof answers, use one source marker per required item you will name, unless one highlighted source list/table directly contains every named item. For compare/contrast answers, usually use one concise source marker per side.",
				"For roadmap or list answers, mark distinct top-level sibling items or sections before child/subtopic items; do not spend multiple source markers under one parent while another required top-level item has no marker.",
				"If a required item cannot be highlighted after retry but readable page context supports it, mention the marker limitation instead of silently dropping the item. If readable context does not support it, omit it and say the page did not support it.",
				"Do not use the page title, course title, reading list, or a generic heading as the source marker.",
			].join(" ")
		: "Before answering, call browser_highlight_text with one short exact visible/readable explanatory span from the page that supports the main teaching point. Do not use the page title, course title, reading list, or a generic heading as the source marker. Prefer the central definition, mechanism, or conclusion over a motivation-only contrast. If the final answer mentions both motivation and mechanism, anchor the mechanism or compact the answer to the highlighted motivation.";
	const pageTraceText = traces
		.filter((trace: any) => trace?.state === "complete" && ["browser_extract_content", "browser_get_visible_text"].includes(trace.toolName))
		.map((trace: any) => `${trace.toolName}:\n${truncateStructuredText(String(trace.resultSummary || ""), 2400)}`)
		.filter(Boolean)
		.join("\n\n");
	return [
		markerInstruction,
		highlightInstruction,
		structured
			? "Call browser_show_note only for the few highlights where a note adds real orientation; keep notes under 280 characters and do not add a note for every marker unless the user explicitly asked for notes."
			: "Call browser_show_note at most once for this teaching answer, only if one marginal note adds real orientation; keep it under 280 characters and do not paraphrase the highlight.",
		"If browser_highlight_text fails, retry once with a smaller exact sentence or phrase. If the best support is rendered math, use the formula label or exact formula text; rendered math will be promoted to a block highlight when needed.",
		structured
			? "After the source markers succeed, answer the original user question concisely. For roadmap/list/process/derivation/proof answers, include every required item supported by successful source markers or by readable page context when a marker genuinely failed; explicitly note any required item whose marker could not be placed. For compare/contrast answers, keep the comparison scoped to the marked sides. Do not say you highlighted or added a note unless those tool calls succeeded."
			: "After the highlight succeeds, answer the original user question concisely and describe what the highlighted passage shows. If the draft covers multiple sections but only one source marker succeeded, compact the answer around that supported passage instead of giving a broad unsupported page summary. Do not say you highlighted or added a note unless those tool calls succeeded.",
		`Original user question: ${stripVoicePromptPrefix(request?.displayPrompt || "")}`,
		assistantText ? `Draft answer to preserve after source marking:\n${truncateStructuredText(assistantText, 3000)}` : "",
		pageTraceText ? `Completed page context:\n${pageTraceText}` : "",
	].filter(Boolean).join("\n\n");
}

function shouldRequirePdfAnchorRetry(request: any) {
	if (!request || request.aborted || request.pdfAnchorRetry) return false;
	if (promptForbidsPageChanges(request.displayPrompt)) return false;
	if (!hasCompletedToolTrace(request, "browser_pdf_read_pages")) return false;
	return !(hasCompletedToolTrace(request, "browser_highlight_text") && hasCompletedToolTrace(request, "browser_show_note"));
}

function buildPdfAnchorRetryPrompt(request: any, assistantText: string) {
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	const pdfTraceText = traces
		.filter((trace: any) => trace?.state === "complete" && ["browser_pdf_search", "browser_pdf_read_pages", "browser_pdf_jump_to_page"].includes(trace.toolName))
		.map((trace: any) => `${trace.toolName}:\n${truncateStructuredText(String(trace.resultSummary || ""), 2400)}`)
		.filter(Boolean)
		.join("\n\n");
	return [
		"You read PDF pages for this answer but did not leave a durable PDF source highlight.",
		"Before answering, call browser_pdf_jump_to_page if useful, then call browser_highlight_text with exact text copied from the PDF page/read result, then call browser_show_note with one short marginal note under 280 characters on that highlight.",
		"If browser_highlight_text fails, retry once with a smaller exact sentence or phrase from the PDF text. If the user explicitly forbade page changes, this instruction would not have been sent.",
		"After the highlight and note succeed, answer the original user question concisely and mention what the highlighted passage shows. Do not say you highlighted or added a note unless those tool calls succeeded.",
		`Original user question: ${stripVoicePromptPrefix(request?.displayPrompt || "")}`,
		assistantText ? `Draft answer to preserve after highlighting:\n${truncateStructuredText(assistantText, 3000)}` : "",
		pdfTraceText ? `Completed PDF context:\n${pdfTraceText}` : "",
	].filter(Boolean).join("\n\n");
}

function visibleReplyWordCount(value: unknown) {
	const words = String(value || "").trim().match(/\S+/g);
	return words ? words.length : 0;
}

function normalizeAssistantReplySpacing(value: string) {
	return String(value || "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

function stripOrphanedMarkdownDelimiterLines(value: string) {
	return String(value || "")
		.split("\n")
		.filter((line) => !/^\s*(?:\*\*|__|`{1,3})\s*$/.test(line))
		.join("\n");
}

function stripDanglingInlineMarkdownDelimiters(value: string) {
	return String(value || "").replace(/[ \t]+(?:\*\*|__|`{1,3})(?=\s*(?:\n|$))/g, "");
}

function stripAssistantProcessNarration(value: string) {
	let text = String(value || "");
	text = text.replace(/^\s*(?:now\s+)?for\s+this\s+learning\s+session\.?\s*/gim, "");
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+record\s+(?:the\s+)?(?:core\s+)?concept\s*:?\s*/gi, "");
	text = text.replace(
		/\b(?:[Ll]et me|[Ii](?:'|’)ll|[Ii] will)\s+add\s+(?:durable\s+)?source\s+markers?\b[^\n]{0,180}?(?=(?:[Hh]ere(?:'|’)s|[Hh]ere is|This|The)\b)/g,
		"",
	);
	text = text.replace(
		/\b(?:let me|i(?:'|’)ll|i will)\s+add\s+(?:(?:a|an|one|two|three|four|couple\s+of|few|some|durable|quick|additional|key|top-level|main)\s+){0,8}source\s+markers?\b[^.!?\n]*[.!?]+/gi,
		"",
	);
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+put\s+(?:a\s+)?(?:durable\s+)?source\s+markers?\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\bi(?:'|’)ve\s+highlighted\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+start\s+by\s+(?:reading|extracting|checking|finding|looking(?:\s+at)?)\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+start\s+with\b[^.!?\n]{0,180}(?=(?:here(?:'|’)s|here is|this|the|what)\b)/gi, "");
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+start\s+with\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\bi\s+found\s+(?:the\s+)?(?:key|relevant|best|main|core)?\s*(?:explanatory\s+)?(?:passages?|sections?|text|content|source(?:s)?)\.?/gi, "");
	text = text.replace(
		/\b(?:(?:now|first|next|also|okay|ok)[,\s]+)?(?:let me|i(?:'|’)ll|i will|i need to)\s+(?:(?:first|now|next|also|just|quickly|retry)\s+)?(?:read|extract|inspect|get|look(?:\s+at|\s+through)?|highlight(?:ing)?|add\s+(?:(?:[\w'-]+)\s+){0,10}(?:highlights?|markers?|notes?)|create\s+(?:(?:[\w'-]+)\s+){0,10}(?:highlights?|markers?|notes?)|ground|anchor|record|open|search|scroll|navigate|find|locate|check|capture|grab|mark|try)\b[^.!?\n]*(?:[.!?]+)?/gi,
		"",
	);
	text = text.replace(
		/\n{2,}\s*(?:(?:there(?:'|’)s|there is)\s+already\b[\s\S]{0,500}\bopen\b[\s\S]{0,500})?\b(?:let me|i(?:'|’)ll|i will|i need to)\s+try\b[\s\S]*$/i,
		"",
	);
	text = text.replace(
		/\n{2,}\s*(?:there(?:'|’)s|there is)\s+already\b[^\n]{0,220}\bopen\s+in\s+(?:another|a)\s+tab[.!?]?(?:\n{2,}\s*(?:the|this)\s+[^.\n]{0,180}\bpage\b[^.\n]*(?:[.!?])?)?\s*$/i,
		"",
	);
	text = text.replace(/^\s*(?:(?:good|great|ok|okay|sure|right|got it)[.,:;!?\u2014\u2013-]?\s*)+/i, "");
	text = text.replace(/^\s*[,.;:]\s*/i, "");
	text = text.replace(/^\s*the page lays this out clearly\.?\s*/i, "");
	text = text.replace(/^\s*(?:the\s+)?visible text\b[^.!?\n]*(?:[.!?]+)?\s*/i, "");
	text = text.replace(/^\s*(?:the\s+)?visible snapshot shows\b[^.!?\n]*(?:but|however)\s*/i, "");
	text = text.replace(/^\s*(?:now\s+)?i\s+have\s+the\s+page\s+content\.?\s*/i, "");
	text = text.replace(/^\s*(?:good|ok|okay)[,\s]+(?:ok|okay)[,\s]+/i, "");
	text = text.replace(/^\s*(?:here(?:'|’)s|here is)\s+how\s+the\s+page\s+(?:presents|compares|explains|frames)\b[^.!?\n]*(?:[.!?]+)?\s*/i, "");
	text = text.replace(/\b(?:now\s+)?i can see\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\bthe page is scrolled\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/^\s*the page is only\b[^.\n]*(?:scrolled|below)\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*good,\s+the page\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*the page (?:appears to be|has|is scrollable)\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*this looks like\b[^.!?\n]*\blet me\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/\b(?:good point|great question)\.\s*/gi, "");
	text = text.replace(/\b(?:highlighted above|anchored above|source marker above)\b[.!?]?/gi, "");
	return text;
}

function stripLeadingOrphanedProcessFragment(value: string) {
	return String(value || "").replace(
		/^\s*(?:(?:this|that|it|the\s+page|the\s+passage|the\s+section)\s+)?[a-z][a-z\s]{1,90}[.!?]\s*(?=(?:here(?:'|’)s|here is|this|the|what|how|why)\b)/i,
		"",
	);
}

function stripDuplicatedOpeningClause(value: string) {
	let text = String(value || "");
	text = text.replace(
		/^\s*((?:Here(?:'|’)s|Here is)\s+(?:the\s+)?(?:roadmap|summary|answer|rundown|overview)\s*:)\s*((?:Here(?:'|’)s|Here is)\b)/i,
		"$2",
	);
	text = text.replace(
		/^\s*(?:Here(?:'|’)s|Here is)\s+(?:a|the)\s+(?:roadmap|summary|answer|rundown|overview)\b[^.!?\n]{0,180}[.!?]\s*((?:Here(?:'|’)s|Here is)\s+(?:a|the)\s+(?:roadmap|summary|answer|rundown|overview)\b[^\n]*)/i,
		"$1",
	);
	text = text.replace(
		/^\s*(?:Here(?:'|’)s|Here is)\b[^.!?\n]{20,180}(?=(?:Here(?:'|’)s|Here is)\b)\s*((?:Here(?:'|’)s|Here is)\b[^\n]*)/i,
		"$1",
	);
	text = text.replace(
		/^\s*(?:Here(?:'|’)s|Here is)\b[^—–\n]{20,180}\s+[—–-]\s+((?:Here(?:'|’)s|Here is)\b[^\n]+)/i,
		"$1",
	);
	text = text.replace(
		/^\s*Here\s+are\b[^—–\n]{20,180}\s+[—–-]\s+((?:Here(?:'|’)s|Here is)\b[^\n]+)/i,
		"$1",
	);
	text = text.replace(
		/^\s*(?:Here(?:'|’)s|Here is)\b[^:\n]{20,180}:\s*((?:Here(?:'|’)s|Here is)\b[^\n]+)/i,
		"$1",
	);
	return text;
}

function stripLeadingGluedBoldLabels(value: string) {
	return String(value || "").replace(
		/^\s*(?:\*\*(?:\d+[.)]?\s*)?[^*\n]{2,140}\*\*){2,}\s*(?=(?:Here(?:'|’)s|Here is|This|The)\b)/i,
		"",
	);
}

function stripIncompleteTrailingLine(value: string) {
	const lines = String(value || "").split("\n");
	const lastNonEmptyIndex = () => {
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (lines[index].trim()) return index;
		}
		return -1;
	};
	const unbalanced = (line: string, open: string, close: string) => line.split(open).length - 1 > line.split(close).length - 1;
	let index = lastNonEmptyIndex();
	if (index < 0) return "";
	const trimmed = lines[index].trim();
	const danglingDelimiter =
		unbalanced(trimmed, "(", ")") ||
		unbalanced(trimmed, "[", "]") ||
		unbalanced(trimmed, "{", "}") ||
		(trimmed.match(/`/g) || []).length % 2 === 1 ||
		(trimmed.match(/\$/g) || []).length % 2 === 1;
	if (danglingDelimiter) {
		lines.splice(index);
		index = lastNonEmptyIndex();
	}
	if (index >= 0 && /^(?:#{1,4}\s+\S|\*\*[^*\n]{2,120}\*\*\s*:?[.!?]?|[^.!?\n]{2,90}:[.!?]?)$/.test(lines[index].trim())) {
		lines.splice(index);
	}
	return normalizeAssistantReplySpacing(lines.join("\n"));
}

function stripDuplicatedAnswerRestart(value: string) {
	const text = String(value || "").trim();
	if (visibleReplyWordCount(text) < 60) return text;
	const restartPattern =
		/(?:Here(?:'|’)s\s+(?:(?:the|a)\s+)?(?:compact\s+|concise\s+|short\s+)?(?:roadmap|summary|answer|rundown|overview)\b|Here(?:'|’)s\s+(?:what\s+this\s+(?:page|article|lecture|document)|how\s+the\s+page|the\s+key|a\s+practical|the\s+gist)|(?:This|The)\s+(?:page|article|chapter|document)(?:'s|’s)?\s+roadmap\b|(?:This|The)\s+(?:page|article|chapter|document)\s+covers\s+(?:\*\*)?(?:these|the\s+following|several|multiple|\d+|one|two|three|four|five|six|seven|eight|nine|ten|[a-z-]+\s+(?:core|main|major|supporting)))\b/gi;
	for (const match of text.matchAll(restartPattern)) {
		const index = Number(match.index || 0);
		if (index < 180) continue;
		const prefix = text.slice(0, index).trim();
		if (visibleReplyWordCount(prefix) < 45) continue;
		if (structuredListItemCount(prefix) < 3 && markdownSectionCount(prefix) < 2) continue;
		const punctuated = /[.!?)]$/.test(prefix) ? prefix : `${prefix}.`;
		return normalizeAssistantReplySpacing(punctuated);
	}
	return text;
}

function stripRedundantHighlightRecap(value: string) {
	const text = String(value || "").trim();
	if (visibleReplyWordCount(text) < 30) return text;
	const recapPattern =
		/\n{2,}(?:(?:The\s+(?:page|article|chapter|document)(?:'s|’s)?\s+roadmap(?:\s+at\s+a\s+glance|\s*\([^)]{0,80}\))?\.?\s*)?(?:Highlighted sections?|Source markers?|Marked sections?)(?:\s+on\s+the\s+page)?|The\s+(?:page|article|chapter|document)(?:'s|’s)?\s+roadmap\b|You can see|The highlights?(?:\s+on\s+the\s+page)?|The highlighted sections?)\b[^:\n]{0,180}:\s*\n/i;
	const sentenceRecapPattern = /\n{2,}(?:The highlights?(?:\s+on\s+the\s+page)?\s+(?:mark|show|cover|identify)|The highlighted (?:passages?|sections?)\s+(?:mark|show|cover|identify))\b/i;
	const match = text.match(recapPattern) || text.match(sentenceRecapPattern);
	if (!match || typeof match.index !== "number") return text;
	const prefix = text.slice(0, match.index).trim();
	const suffix = text.slice(match.index + match[0].length).trim();
	if (visibleReplyWordCount(prefix) < 10) return text;
	if (structuredListItemCount(prefix) < 3) return text;
	if (recapPattern.test(match[0]) && structuredListItemCount(suffix) < 2) return text;
	const punctuated = /[.!?)]$/.test(prefix) ? prefix : `${prefix}.`;
	return normalizeAssistantReplySpacing(punctuated);
}

const STRUCTURED_ITEM_COMMON_TERMS = new Set([
	"section",
	"sections",
	"chapter",
	"page",
	"roadmap",
	"covered",
	"covers",
	"data",
	"structures",
	"sequence",
	"sequences",
	"techniques",
	"statement",
	"type",
	"main",
	"what",
	"with",
	"from",
	"using",
	"more",
	"other",
	"types",
]);

function looksLikeStructuredRoadmapItemLine(line: string) {
	const trimmed = String(line || "").trim();
	return (
		/^(?:[-*]\s+|\d+[.)]\s+)/.test(trimmed) ||
		/^\*\*[^*\n]{2,120}\*\*\s*(?:[—–-]|:|\|)/.test(trimmed) ||
		/^\d+(?:\.\d+){0,3}\.?\s+\S/.test(trimmed)
	);
}

function sourceTextIncludesEntityTerm(normalizedSourceText: string, term: string) {
	if (!normalizedSourceText || !term) return false;
	if (normalizedSourceText.includes(term)) return true;
	if (term.endsWith("ies") && term.length > 4) return normalizedSourceText.includes(`${term.slice(0, -3)}y`);
	if (term.endsWith("s") && term.length > 4) return normalizedSourceText.includes(term.slice(0, -1));
	return false;
}

function structuredItemLabelTerms(value: string) {
	const trimmed = String(value || "").trim();
	const boldLabel = trimmed.match(/^(?:[-*]\s+|\d+[.)]\s+)?\*\*([^*\n]{2,120})\*\*/);
	const headingLabel = trimmed.match(/^\s{0,3}#{1,4}\s+([^\n:—–|-]{2,120})/);
	const plainLabel = trimmed.match(/^(?:[-*]\s+|\d+[.)]\s+)([^:\n—–|-]{2,120})(?:[:—–-]|\s{2,})/);
	const label = boldLabel?.[1] || headingLabel?.[1] || plainLabel?.[1] || "";
	return entityWords(label)
		.map((term) => term.toLowerCase())
		.filter((term) => term.length >= 4 && !STRUCTURED_ITEM_COMMON_TERMS.has(term));
}

function structuredItemLineSupportedByHighlights(line: string, normalizedSourceText: string) {
	const labelTerms = structuredItemLabelTerms(line);
	if (labelTerms.length) return labelTerms.some((term) => sourceTextIncludesEntityTerm(normalizedSourceText, term));
	const terms = entityWords(line)
		.map((term) => term.toLowerCase())
		.filter((term) => term.length >= 4 && !STRUCTURED_ITEM_COMMON_TERMS.has(term));
	if (!terms.length) return true;
	return terms.some((term) => sourceTextIncludesEntityTerm(normalizedSourceText, term));
}

function looksLikeStructuredRoadmapItemBlock(block: string) {
	const trimmed = String(block || "").trim();
	return (
		/^\*\*[^*\n]{2,120}\*\*\s*(?:[—–-]|:|\n)/.test(trimmed) ||
		/^(?:[-*]\s+|\d+[.)]\s+)\*\*[^*\n]{2,120}\*\*/.test(trimmed) ||
		/^\s{0,3}#{1,4}\s+\S/.test(trimmed)
	);
}

function looksLikeUnsupportedRemainderBlock(block: string) {
	return /^(?:This|The)\s+(?:page|chapter|article|document|section)\s+(?:also\s+)?(?:includes?|covers?|mentions?|lists?|continues\s+with|goes\s+on\s+to)\b/i.test(
		String(block || "").trim(),
	);
}

function stripUnsupportedStructuredItemsByHighlights(value: string, request: any) {
	if (!promptAsksForStructuredPageSourceMarker(request?.displayPrompt)) return value;
	if (completedSourceHighlightCount(request) < 2) return value;
	const normalizedSourceText = normalizeEntityText(completedSourceHighlightText(request));
	if (!normalizedSourceText) return value;
	const blocks = String(value || "").split(/\n{2,}/);
	let blockChanged = false;
	let itemBlocks = 0;
	let keptItemBlocks = 0;
	const keptBlocks = blocks.filter((block) => {
		const trimmed = block.trim();
		if (!trimmed) return true;
		if (looksLikeUnsupportedRemainderBlock(trimmed)) {
			blockChanged = true;
			return false;
		}
		if (!looksLikeStructuredRoadmapItemBlock(trimmed)) return true;
		itemBlocks += 1;
		if (!structuredItemLineSupportedByHighlights(trimmed, normalizedSourceText)) {
			blockChanged = true;
			return false;
		}
		keptItemBlocks += 1;
		return true;
	});
	const blockFilteredValue =
		blockChanged && (itemBlocks === 0 || keptItemBlocks >= 2)
			? normalizeAssistantReplySpacing(keptBlocks.join("\n\n"))
			: String(value || "");
	const lines = blockFilteredValue.split("\n");
	const kept: string[] = [];
	let changed = false;
	let itemLines = 0;
	let keptItemLines = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed) {
			kept.push(line);
			continue;
		}
		if (/\|/.test(trimmed) && (/\s\|\s/.test(trimmed) || /^\s*-{2,}:?\s*\|/.test(trimmed))) {
			changed = true;
			continue;
		}
		if (/^(?:This|The)\s+(?:page|chapter|article|document)\s+covers\b.*\b(?:main\s+)?sections?\b.*\broadmap\b/i.test(trimmed)) {
			kept.push("Here is the roadmap supported by the source markers:");
			changed = true;
			continue;
		}
		if (looksLikeStructuredRoadmapItemLine(trimmed)) {
			itemLines += 1;
			if (!structuredItemLineSupportedByHighlights(trimmed, normalizedSourceText)) {
				changed = true;
				continue;
			}
			keptItemLines += 1;
		}
		kept.push(line);
	}
	if (!changed || (itemLines > 0 && keptItemLines < 2)) return blockFilteredValue;
	return normalizeAssistantReplySpacing(kept.join("\n"));
}

function renumberTopLevelOrderedListLines(value: string) {
	const lines = String(value || "").split("\n");
	let expected = 1;
	let inRun = false;
	const output = lines.map((line) => {
		const match = line.match(/^(\s{0,3})(\d+)([.)])(\s+\S.*)$/);
		if (!match) {
			if (line.trim() && !(inRun && /^\s{1,}[-*]\s+\S/.test(line))) inRun = false;
			return line;
		}
		if (!inRun) {
			expected = 1;
			inRun = true;
		}
		const next = `${match[1]}${expected}${match[3]}${match[4]}`;
		expected += 1;
		return next;
	});
	return normalizeAssistantReplySpacing(output.join("\n"));
}

function normalizeDanglingTrailingPunctuation(value: string) {
	return String(value || "")
		.replace(/[ \t]+[—–-]\s*$/g, ".")
		.replace(/[ \t]+[—–-]\s*(?=\n{2,}|$)/g, ".");
}

function stripHorizontalRuleSeparators(value: string) {
	return String(value || "")
		.replace(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/gm, "\n")
		.replace(/[ \t]+(?:-{3,}|_{3,}|\*{3,})[ \t]+/g, "\n\n");
}

function normalizeMarkdownBlockBoundaries(value: string) {
	let text = String(value || "");
	text = text.replace(/([^\n])[ \t]+(#{1,4}[ \t]+\S)/g, "$1\n\n$2");
	const bodyStarterPattern =
		/\s+(a|an|the|this|these|that|those|it|they|instead|since|each|in|for|when|where|why|how|unlike|but|so|because|you|first|second|third|finally|then|next|prediction|takeaway)\b/i;
	text = text
		.split("\n")
		.map((line) => {
			const match = line.match(/^(\s{0,3}#{1,4}\s+)(.+)$/);
			if (!match) return line;
			const prefix = match[1];
			const content = match[2].trim();
			if (content.length < 48) return line;
			const punctuationSplit = content.match(/^(.{4,90}[?:!])\s+([A-Z][\s\S]{10,})$/);
			if (punctuationSplit?.[1] && punctuationSplit?.[2]) {
				return `${prefix}${punctuationSplit[1].trim()}\n\n${punctuationSplit[2].trim()}`;
			}
			const candidates = [...content.matchAll(new RegExp(bodyStarterPattern.source, "gi"))]
				.filter((candidate) => Number(candidate.index) >= 12 && Number(candidate.index) <= 96);
			if (!candidates.length) return line;
			const splitIndex = Number(candidates[0].index);
			const heading = content.slice(0, splitIndex).trim();
			const body = content.slice(splitIndex).trim();
			if (!heading || !body) return line;
			return `${prefix}${heading}\n\n${body}`;
		})
		.join("\n");
	return text.replace(/^(\s{0,3}#{1,4}\s+\d+[.)]\s+[^.!?\n]{3,90}[.!?])[ \t]+(?=\S)/gim, "$1\n\n");
}

function looksLikeStandaloneAssistantHeadingLine(value: string) {
	const trimmed = String(value || "").trim();
	return /^(?:#{1,4}\s+\S.{0,100}|\*\*[^*\n]{2,100}\*\*:?)$/.test(trimmed);
}

function stripEmptyAssistantHeadings(value: string) {
	const lines = String(value || "").split("\n");
	const kept: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (looksLikeStandaloneAssistantHeadingLine(line)) {
			if (/\b(?:what|how|why|where|when)\s*$/i.test(compactActionText(line))) continue;
			const nextNonEmpty = lines.slice(index + 1).find((candidate) => candidate.trim());
			if (!nextNonEmpty || looksLikeStandaloneAssistantHeadingLine(nextNonEmpty) || compactActionText(nextNonEmpty) === compactTeachingFooter()) continue;
		}
		kept.push(line);
	}
	return normalizeAssistantReplySpacing(kept.join("\n"));
}

function stripDanglingLineBeforeCompactFooter(value: string) {
	const lines = String(value || "").split("\n");
	const footerIndex = lines.findIndex((line) => compactActionText(line) === compactTeachingFooter());
	if (footerIndex <= 0) return normalizeAssistantReplySpacing(lines.join("\n"));
	for (let index = footerIndex - 1; index >= 0; index -= 1) {
		const trimmed = lines[index].trim();
		if (!trimmed) continue;
		const plain = compactActionText(trimmed);
		const looksDangling =
			!/[.!?)]$/.test(plain) &&
			(/^\*\*[^*\n]{1,80}$/.test(trimmed) ||
				/^(?:#{1,4}\s*)?(?:what|how|why|where|when)\b[^.!?\n]{0,60}$/i.test(plain) ||
				/[—–-]\s+\S/.test(trimmed) ||
				/\b(?:because|since|when|while|where|which|that|using|from|with|directly|through|via|into|then|therefore)$/i.test(plain) ||
				plain.length > 70);
		if (looksDangling) lines.splice(index, 1);
		break;
	}
	return normalizeAssistantReplySpacing(lines.join("\n"));
}

function markdownTableCells(line: string) {
	const trimmed = String(line || "").trim();
	if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
	return trimmed
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isMarkdownTableSeparatorRow(cells: string[]) {
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function convertMarkdownTableBlockToBullets(block: string[]) {
	const rows = block
		.map(markdownTableCells)
		.filter((cells) => cells.length && cells.some((cell) => cell.trim()));
	if (rows.length < 2) return block.filter((line) => line.trim() !== "|");
	let header = rows[0];
	const separator = rows[1];
	if (!header.length || !isMarkdownTableSeparatorRow(separator)) return block;
	const bodyRows = rows
		.slice(2)
		.filter((cells) => cells.length && !isMarkdownTableSeparatorRow(cells));
	if (!bodyRows.length) return [];
	const maxBodyCells = Math.max(...bodyRows.map((cells) => cells.length));
	if (maxBodyCells === header.length + 1) header = ["Feature", ...header];
	return bodyRows.map((cells) => {
		const cleanCells = cells.map((cell) => cell.trim()).filter((cell, index) => cell || index < header.length);
		if (header.length === 2 && cleanCells.length >= 2) return `- ${cleanCells[0]}: ${cleanCells[1]}`;
		if (header.length >= 3 && cleanCells.length >= 3) {
			const label = cleanCells[0];
			const parts = cleanCells.slice(1).map((cell, index) => `${header[index + 1] || `Column ${index + 2}`}: ${cell}`);
			return `- ${label}: ${parts.join("; ")}`;
		}
		const parts = cells.map((cell, index) => `${header[index] || `Column ${index + 1}`}: ${cell}`);
		return `- ${parts.join("; ")}`;
	});
}

function convertMarkdownTablesToBullets(value: string) {
	const normalizedRows = String(value || "").replace(/\|[ \t]+\|/g, "|\n|");
	const lines = normalizedRows.split("\n");
	const output: string[] = [];
	for (let index = 0; index < lines.length; ) {
		if (!markdownTableCells(lines[index]).length) {
			output.push(lines[index]);
			index += 1;
			continue;
		}
		const block: string[] = [];
		while (index < lines.length && markdownTableCells(lines[index]).length) {
			block.push(lines[index]);
			index += 1;
		}
		output.push(...convertMarkdownTableBlockToBullets(block));
	}
	return output.join("\n");
}

function stripMalformedTableBulletArtifacts(value: string) {
	const lines = String(value || "").split("\n");
	return lines
		.filter((line) => !/^\s*[-*]\s+[^:\n]{1,80}:\s+Aspect:\s+/i.test(line))
		.join("\n");
}

function stripFragmentedMathLines(value: string) {
	return String(value || "")
		.replace(/^\s*(?:[$]{1,2}\s*)?(?:[pP𝑝]\s*(?:[A-Za-z\s]+)?\s*)?\([^)\n]{1,160}\)\s*=\s*(?:[$]{1,2}\s*)?$/gm, "")
		.replace(/^\s*(?:[$]{1,2}\s*)?(?:[𝑊W]\s*(?:\||∣)[^\n]{1,140})\s*=\s*(?:[$]{1,2}\s*)?$/gm, "");
}

function stripEmptyCitationParentheses(value: string) {
	return String(value || "")
		.replace(/[ \t]+\(\)(?=\s*(?:\n|$))/g, "")
		.replace(/[ \t]+\(\)(?=\s*[-–—:])/g, "");
}

function stripInlineHighlightLabels(value: string) {
	return String(value || "")
		.replace(
			/(^|\n)([ \t]*(?:>[ \t]*)?)(?:Highlighted(?:\s+(?:on\s+the\s+page|passage|source))?|Source\s+(?:highlight|marker))\s*:\s*/gi,
			"$1$2",
		)
		.replace(/[ \t]*[—–-][ \t]*(?:\*)?Highlighted\s+on\s+(?:the\s+)?page(?:\*)?/gi, "")
		.replace(/[ \t]*\((?:\*)?highlighted\s+on\s+(?:the\s+)?page(?:\*)?\)/gi, "")
		.replace(/[ \t]*\((?:\*)?highlights?\s*\d+(?:\s*(?:&|and|,)\s*\d+)*(?:\*)?\)/gi, "")
		.replace(/[ \t]*\((?:\*)?highlight\s*\d+(?:\*)?\)/gi, "")
		.replace(/[ \t]*\((?:\*)?(?:not\s+)?highlighted[^)]{0,100}(?:\*)?\)/gi, "");
}

function stripOrdinalHighlightParentheticals(value: string) {
	return String(value || "").replace(
		/\s*\((?:the\s+)?(?:first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th))\s+(?:source\s+)?highlight(?:\s*,\s*with\s+note)?\)/gi,
		"",
	);
}

function stripHighlightStatusClauses(value: string) {
	return String(value || "")
		.replace(/^\s*(?:unfortunately|sorry)[^.!?\n]{0,260}\b(?:durable\s+)?source\s+highlights?\b[^.!?\n]*(?:[.!?]+)\s*/i, "")
		.replace(/\s+[—–-]\s+I(?:'ve| have)\s+(?:marked|highlighted)\s+[^:\n.]{1,120}:/gi, ":")
		.replace(/\bI(?:'ve| have)\s+(?:marked|highlighted)\s+[^.\n]{1,120}\.\s*/gi, "")
		.replace(/(?:^|\n)\s*Each\s+(?:section|item|source|passage|point)[^.\n]{0,160}\bhighlighted\b[^.\n]*\.\s*/gi, "\n")
		.replace(/\b(?:the\s+)?highlights?(?:\s+and\s+notes?)?\s+on\s+(?:the\s+)?page\s+(?:cover|show|mark|identify)\b[^.!?\n]*(?:[.!?]+)?/gi, "")
		.replace(/(?:^|\n)\s*(?:the\s+)?(?:source\s+)?markers?[^.\n]{0,220}\b(?:timed\s+out|failed|could(?:\s+not|n't)|cannot|can't|was\s+not|wasn't)\b[^.\n]*(?:[.!?]+)?\s*/gi, "\n")
		.replace(/\b(?:though|although|while)?\s*(?:a|an|another|separate|additional|the)?\s*(?:source\s+)?(?:highlight|marker)[^.!?\n]{0,120}\b(?:could(?:\s+not|n't)|cannot|can't|failed\s+to|was\s+not|wasn't)\b[^.!?\n]*(?:[.!?]+)?/gi, "")
		.replace(/\b(?:the\s+)?(?:one|two|three|four|five|six|\d+)\s+central\s+concepts?\s+are\s+highlighted\s+on\s+(?:the\s+)?page\b[^.!?\n]*(?:[.!?]+)?/gi, "");
}

function truncateAtMissingHighlightStatus(value: string) {
	const text = String(value || "");
	const missingMarker = /\b(?:highlight|marker)[^.!?\n]{0,120}\b(?:could(?:\s+not|n't)|cannot|can't|failed\s+to|was\s+not|wasn't)\b/i;
	const blocks = text.split(/\n{2,}/);
	const missingIndex = blocks.findIndex((block) => missingMarker.test(block));
	if (missingIndex < 0) return text;
	return blocks.slice(0, missingIndex).join("\n\n").trim();
}

function stripUnsupportedRemainingSectionsTail(value: string, request: any) {
	const text = String(value || "").trim();
	if (!text || !request || !promptAsksForStructuredPageSourceMarker(request?.displayPrompt)) return text;
	const match = text.match(
		/(?:^|\n{2,})\s*(?:(?:the\s+)?remaining\s+sections?|(?:the|this)\s+(?:page|article|chapter|document)\s+also\s+(?:covers?|includes?|mentions?|lists?)|it\s+also\s+(?:covers?|includes?|mentions?|lists?))\b/i,
	);
	if (!match || typeof match.index !== "number" || match.index <= 0) return text;
	return text.slice(0, match.index).trim();
}

function isSurplusHighlightGuardSummary(value: unknown) {
	const text = String(value || "").toLowerCase();
	return (
		text.includes("guardrail") ||
		text.includes("tool call blocked") ||
		text.includes("highlighting has failed repeatedly") ||
		text.includes("do not call browser_highlight_text again") ||
		text.includes("source highlights already succeeded") ||
		text.includes("answer now from the existing")
	);
}

function isCompletedSourceHighlightTrace(trace: any) {
	if (trace?.state !== "complete" || trace?.toolName !== "browser_highlight_text") return false;
	const summary = String(trace?.resultSummary || "");
	if (isSurplusHighlightGuardSummary(summary)) return false;
	if (/\bannotationId:\s*[a-z0-9_-]+/i.test(summary)) return true;
	if (/\bHighlighted(?:\s+text)?\b/i.test(summary)) return true;
	const details = trace?.details || trace?.resultDetails;
	return Boolean(details && /\bannotationId\b/i.test(JSON.stringify(details)));
}

function completedSourceHighlightCount(request: any) {
	const traceCount = (Array.isArray(request?.toolTraces) ? request.toolTraces : []).filter(isCompletedSourceHighlightTrace).length;
	const actionCount = (Array.isArray(request?.pageActions) ? request.pageActions : []).filter((action: any) => (
		String(action?.key || "").startsWith("highlight:") ||
		action?.label === "Highlighted text" ||
		action?.type === "highlight" ||
		(action?.type === "annotation" && action?.annotationId)
	)).length;
	return Math.max(traceCount, actionCount);
}

function completedSourceHighlightTraceCount(request: any) {
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).filter(isCompletedSourceHighlightTrace).length;
}

function completedSourceHighlightTraceText(request: any) {
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : [])
		.filter(isCompletedSourceHighlightTrace)
		.map((trace: any) => `${trace?.resultSummary || ""} ${JSON.stringify(trace?.details || {})}`)
		.join("\n")
		.toLowerCase();
}

function completedSourceHighlightText(request: any) {
	const traceText = completedSourceHighlightTraceText(request);
	const actionText = (Array.isArray(request?.pageActions) ? request.pageActions : [])
		.filter((action: any) => String(action?.key || "").startsWith("highlight:") || action?.label === "Highlighted text" || action?.type === "highlight")
		.map((action: any) => `${action?.detail || ""} ${action?.citationText || ""}`)
		.join("\n");
	return `${traceText}\n${actionText}`.toLowerCase();
}

function completedSourceHighlightCitations(request: any) {
	const traceText = (Array.isArray(request?.toolTraces) ? request.toolTraces : [])
		.filter(isCompletedSourceHighlightTrace)
		.map((trace: any) => {
			const quoted = String(trace?.resultSummary || "").match(/Highlighted\s+"([^"]{1,500})"/i)?.[1];
			return quoted || String(trace?.effectiveArgs?.text || trace?.args?.text || "");
		})
		.filter(Boolean);
	const actionText = (Array.isArray(request?.pageActions) ? request.pageActions : [])
		.filter((action: any) => String(action?.key || "").startsWith("highlight:") || action?.label === "Highlighted text" || action?.type === "highlight" || action?.type === "annotation")
		.map((action: any) => String(action?.citationText || action?.detail || ""))
		.filter(Boolean);
	return Array.from(new Set([...actionText, ...traceText].map((text) => text.trim()).filter(Boolean)));
}

function completedHighlightTraceForAnnotation(request: any, annotationId: unknown) {
	const target = String(annotationId || "").trim();
	if (!target) return null;
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).find((trace: any) => {
		if (!isCompletedSourceHighlightTrace(trace)) return false;
		const details = trace?.resultDetails || trace?.details || {};
		const traceAnnotationId = String(details?.annotation?.annotationId || "");
		return traceAnnotationId === target;
	}) || null;
}

function completedHighlightUsedFrameFallback(trace: any) {
	const details = trace?.resultDetails || trace?.details || {};
	const fallback = details?.annotation?.pageToolkitFrameFallback;
	return Boolean(fallback && typeof fallback === "object" && fallback.attempted === true);
}

function markdownSectionCount(value: string) {
	return (String(value || "").match(/(?:^|\n)\s{0,3}#{1,4}\s+\S/g) || []).length;
}

function assistantSectionCount(value: string) {
	return splitAssistantReplySections(value).length;
}

function splitAssistantReplySections(value: string) {
	const text = String(value || "").trim();
	if (!text) return [];
	return text
		.split(/\n{2,}(?=(?:\s{0,3}#{1,4}\s+\S|\*\*[^*\n]{3,90}\*\*\s*(?:\n|$)))/)
		.map((section) => section.trim())
		.filter(Boolean);
}

function promptAsksForFormulaOrExactMath(prompt: unknown) {
	return /\b(?:formula|equation|derive|derivation|proof|theorem|math|notation|symbol|verbatim|exact)\b/i.test(String(prompt || ""));
}

function stripDisplayMathBlocks(value: string) {
	return String(value || "")
		.replace(/\$\$[\s\S]{0,900}?\$\$/g, "")
		.replace(/\\\[[\s\S]{0,900}?\\\]/g, "")
		.replace(/\n{3,}/g, "\n\n");
}

function stripDanglingDisplayMathFragments(value: string) {
	return String(value || "")
		.replace(/^\s*(?:\$\$\\?|\$\$|\\\[|\\\])\s*$/gm, "")
		.replace(/\$\$\\?\s*(?=\n{2,}|$)/g, "")
		.replace(/\\\[\s*(?=\n{2,}|$)/g, "");
}

function stripDanglingMathDefinitionLines(value: string) {
	return String(value || "")
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			if (!/^where\b/i.test(trimmed)) return true;
			return !/(?:[$\\{}^_=]|[𝑊𝑝𝑞𝑥𝑦𝑖𝑁𝑲𝑾WpqxyiNK]\b|\b(?:posterior|prior|likelihood|sampled|drawn|normal|distribution)\b)/iu.test(trimmed);
		})
		.join("\n");
}

function stripDanglingMathLeadIns(value: string) {
	const lines = String(value || "").split("\n");
	const kept: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		const plain = compactActionText(trimmed);
		const nextNonEmpty = lines.slice(index + 1).find((candidate) => candidate.trim());
		const looksLikeFormulaLeadIn =
			(/:$/.test(trimmed) || /\b(?:is|as|by|with|equals?)$/i.test(plain)) &&
			/\b(?:formula|equation|integral|integrates|prediction|posterior|prior|estimate|likelihood|probability|average|averaging|approximate|computed|given by|described as|written as|as follows|in practice)\b/i.test(plain);
		const followedByNoFormula =
			!nextNonEmpty ||
			!/^(?:[$]|\\\[|\\\(|[A-Za-z𝑊𝑝𝑞𝑥𝑦𝑖𝑁𝑲𝑾WpqxyiNK][^.!?\n]{0,80}\s*[=∫∏∑≈≤≥<>|∣])/u.test(nextNonEmpty.trim());
		if (looksLikeFormulaLeadIn && followedByNoFormula) {
			if (trimmed.length >= 90 || /[.!?]\s+\S/.test(trimmed.replace(/:\s*$/, ""))) {
				kept.push(line.replace(/:\s*$/, "."));
			}
			continue;
		}
		kept.push(line);
	}
	return normalizeAssistantReplySpacing(kept.join("\n"));
}

function stripCompactTeachingMathBlocks(value: string, request: any) {
	if (!request || promptAsksForFormulaOrExactMath(request.displayPrompt)) return value;
	if (!promptAsksForCompactPageTeaching(request.displayPrompt)) return value;
	return stripDanglingMathLeadIns(stripDanglingMathDefinitionLines(stripDanglingDisplayMathFragments(stripDisplayMathBlocks(value))));
}

const GENERIC_ENTITY_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"answer",
	"approach",
	"approaches",
	"article",
	"because",
	"between",
	"chapter",
	"compare",
	"comparison",
	"concept",
	"contrast",
	"current",
	"document",
	"explain",
	"formula",
	"from",
	"guide",
	"highlight",
	"idea",
	"into",
	"lecture",
	"main",
	"method",
	"methods",
	"model",
	"note",
	"page",
	"paper",
	"passage",
	"problem",
	"process",
	"roadmap",
	"section",
	"source",
	"step",
	"steps",
	"summary",
	"table",
	"takeaway",
	"technique",
	"techniques",
	"text",
	"the",
	"theorem",
	"this",
	"through",
	"what",
	"where",
	"with",
]);

function normalizeEntityText(value: unknown) {
	return String(value || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function entityWords(value: unknown) {
	return normalizeEntityText(value)
		.split(/\s+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3 && !GENERIC_ENTITY_STOPWORDS.has(word));
}

function compactEntity(value: unknown) {
	return entityWords(value).join(" ");
}

function extractSignificantEntities(value: unknown) {
	const text = String(value || "");
	const candidates = new Set<string>();
	for (const match of text.matchAll(/\*\*([^*\n]{3,90})\*\*/g)) {
		const entity = compactEntity(match[1]);
		if (entity) candidates.add(entity);
	}
	for (const match of text.matchAll(/^\s*(?:[-*]|\d+[.)])\s+(?:\*\*)?([^:\n.]{3,90})(?:\*\*)?(?::|[—-]|\s{2,})/gm)) {
		const entity = compactEntity(match[1]);
		if (entity) candidates.add(entity);
	}
	for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:[-\s]+[A-Z][A-Za-z0-9]+){1,5})\b/g)) {
		const entity = compactEntity(match[1]);
		if (entity.split(/\s+/).length >= 2) candidates.add(entity);
	}
	return [...candidates].filter((entity) => entity.length >= 4).slice(0, 12);
}

function substantiveEntityMentionCount(value: string) {
	return extractSignificantEntities(value).length;
}

function structuredListItemCount(value: string) {
	return (String(value || "").match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\S/g) || []).length;
}

function markdownTableRowCount(value: string) {
	return String(value || "")
		.split("\n")
		.filter((line) => markdownTableCells(line).length > 1)
		.length;
}

function looksLikeRoadmapSection(value: string) {
	const text = String(value || "").toLowerCase();
	return (
		/\b(?:rest of (?:the )?(?:page|article|lecture|document|chapter)|what comes next|goes on to|builds up from|spends .* on|practical challenge|how to|roadmap|progression|workflow|pipeline|sequence)\b/.test(text) ||
		/\b(?:sampling|analysis|proof|derivation|workflow|pipeline)\s+methods?\b/.test(text) ||
		/\b(?:bulk|remainder) of (?:the )?(?:page|article|lecture|document|chapter)\b.*\b(?:covers?|explains?|walks? through)\b/.test(text) ||
		/\b(?:methods?|approaches|techniques?|steps?|stages?|phases?|algorithms?)\b/.test(text) ||
		structuredListItemCount(value) >= 3 ||
		markdownTableRowCount(value) >= 4
	);
}

function mentionsUnsupportedRoadmap(value: string) {
	const text = String(value || "").toLowerCase();
	return (
		/\b(?:rest of (?:the )?(?:page|article|lecture|document|chapter)|what comes next|goes on to|builds up from|spends .* on|practical challenge|roadmap|progression)\b/.test(text) ||
		/\b(?:bulk|remainder) of (?:the )?(?:page|article|lecture|document|chapter)\b.*\b(?:covers?|explains?|walks? through)\b/.test(text) ||
		(structuredListItemCount(value) >= 3 && /\b(?:methods?|approaches|techniques?|steps?|stages?|phases?|algorithms?|challenge)\b/.test(text)) ||
		markdownTableRowCount(value) >= 4 ||
		(substantiveEntityMentionCount(value) >= 3 && /\b(?:covers?|includes?|methods?|approaches|techniques?|lecture|page|article|document|chapter)\b/.test(text)) ||
		substantiveEntityMentionCount(value) >= 4
	);
}

function sourceHighlightsCoverRoadmap(request: any, reply: string) {
	const sourceText = completedSourceHighlightTraceText(request) || completedSourceHighlightText(request);
	if (!sourceText.trim()) return false;
	if (structuredListItemCount(sourceText) >= 3 || markdownTableRowCount(sourceText) >= 4) return true;
	const normalizedSource = normalizeEntityText(sourceText);
	const entities = extractSignificantEntities(reply);
	if (!entities.length) return false;
	const sourceTokens = new Set(normalizedSource.split(/\s+/).filter(Boolean));
	const sourceCoversEntity = (entity: string) => {
		if (normalizedSource.includes(entity)) return true;
		const words = entity.split(/\s+/).filter(Boolean);
		const acronym = words.map((word) => word[0] || "").join("");
		return acronym.length >= 2 && sourceTokens.has(acronym);
	};
	return entities.every(sourceCoversEntity);
}

function visibleReplySourceMarkerCount(value: unknown) {
	const markers = new Set<string>();
	for (const match of String(value || "").matchAll(/(?:^|[^\w])\[(\d{1,3})\](?!\w)/g)) {
		markers.add(match[1]);
	}
	return markers.size;
}

function shouldPreserveSubstantiveMultiSourceReply(value: string, request: any) {
	if (!request) return false;
	const prompt = request.displayPrompt;
	const isPageTeaching =
		promptAsksForTeachingPageSourceMarker(prompt) ||
		promptAsksForStructuredPageSourceMarker(prompt);
	if (!isPageTeaching) return false;
	if (completedSourceHighlightCount(request) < 2) return false;
	if (visibleReplySourceMarkerCount(value) < 2) return false;
	if (visibleReplyWordCount(value) < 90) return false;
	return (
		assistantSectionCount(value) >= 2 ||
		markdownSectionCount(value) >= 2 ||
		structuredListItemCount(value) >= 2
	);
}

function removeUnsupportedRoadmapSections(value: string) {
	const sections = splitAssistantReplySections(value);
	if (sections.length < 2) return value;
	const keep: string[] = [];
	for (const section of sections) {
		if (looksLikeRoadmapSection(section) && keep.length > 0) break;
		keep.push(section);
	}
	return keep.length ? keep.join("\n\n") : value;
}

function removeUnsupportedRoadmapLead(value: string) {
	const blocks = String(value || "")
		.trim()
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean);
	if (blocks.length < 2) return value;
	const first = blocks[0];
	const firstWords = visibleReplyWordCount(first);
	const broadPageOverview =
		firstWords <= 70 &&
		/\b(?:this|the)\s+(?:page|article|lecture|document|chapter)\b/i.test(first) &&
		/\b(?:covers?|introduces?|focus(?:es)?\s+on|walks?\s+through|builds?\s+(?:up\s+)?(?:to|from)|goes?\s+on\s+to)\b/i.test(first);
	if (!broadPageOverview) return value;
	return blocks.slice(1).join("\n\n") || value;
}

function removeUnsupportedRoadmapTail(value: string) {
	const text = String(value || "").trim();
	const match = text.match(
		/\b(?:the\s+)?(?:rest|bulk|remainder) of (?:the )?(?:page|article|lecture|document|chapter)\b|(?:^|\n)\s*(?:later|next|subsequent)\s+sections?\b|\b(?:sampling|analysis|proof|derivation|workflow|pipeline)\s+methods?\b/i,
	);
	if (!match || typeof match.index !== "number" || match.index <= 0) return text;
	const prefix = text
		.slice(0, match.index)
		.replace(/[ \t]*(?:[-–—,:;]\s*)?$/g, "")
		.trim();
	return prefix || text;
}

function removeTrailingQuestionLine(value: string) {
	const lines = String(value || "").split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index].trim();
		if (!line) continue;
		if (line.endsWith("?")) lines.splice(index, 1);
		break;
	}
	return normalizeAssistantReplySpacing(lines.join("\n"));
}

function truncateReplyAtWordBudget(value: string, maxWords: number) {
	const text = String(value || "").trim();
	const words = [...text.matchAll(/\S+/g)];
	if (words.length <= maxWords) return text;
	const last = words[maxWords - 1];
	const truncated = text.slice(0, Number(last.index || 0) + last[0].length).trim();
	const sentenceMatch = truncated.match(/^([\s\S]*[.!?])(?:\s|$)/);
	return (sentenceMatch?.[1] || truncated).trim();
}

function compactOverbroadPageTeachingReply(value: string, request: any) {
	const text = normalizeAssistantReplySpacing(stripEmptyAssistantHeadings(value));
	if (!text || !request || promptForbidsPageChanges(request.displayPrompt)) return text;
	const isSourceMarkedTeaching =
		promptAsksForTeachingPageSourceMarker(request.displayPrompt) ||
		promptAsksForStructuredPageSourceMarker(request.displayPrompt);
	if (!isSourceMarkedTeaching) return text;
	const traceHighlightCount = completedSourceHighlightTraceCount(request);
	const highlightCount = traceHighlightCount || completedSourceHighlightCount(request);
	const compactFirstPass = promptAsksForCompactPageTeaching(request.displayPrompt) && highlightCount <= 1;
	const mathTrimmedText = compactFirstPass ? normalizeAssistantReplySpacing(stripCompactTeachingMathBlocks(text, request)) : text;
	const unsupportedSamplingRoadmap =
		highlightCount > 0 &&
		highlightCount <= TEACHING_SOURCE_HIGHLIGHT_MAX &&
		mentionsUnsupportedRoadmap(mathTrimmedText) &&
		!sourceHighlightsCoverRoadmap(request, mathTrimmedText);
	const unsupportedCompactFirstPassRoadmap =
		compactFirstPass &&
		highlightCount <= 1 &&
		mentionsUnsupportedRoadmap(mathTrimmedText);
	if (highlightCount > 1 && !unsupportedSamplingRoadmap) return text;
	const overbroad =
		unsupportedSamplingRoadmap ||
		unsupportedCompactFirstPassRoadmap ||
		(compactFirstPass &&
			(visibleReplyWordCount(mathTrimmedText) > 220 ||
				assistantSectionCount(mathTrimmedText) >= 3 ||
				/\$\$|\\\[/.test(text) ||
				mentionsUnsupportedRoadmap(mathTrimmedText))) ||
		visibleReplyWordCount(mathTrimmedText) > 450 ||
		markdownSectionCount(mathTrimmedText) >= 3 ||
		substantiveEntityMentionCount(mathTrimmedText) >= 4;
	if (!overbroad) return text;
	const withoutQuestion = removeTrailingQuestionLine(mathTrimmedText);
	const withoutUnsupportedRoadmap =
		unsupportedSamplingRoadmap || unsupportedCompactFirstPassRoadmap
			? removeUnsupportedRoadmapTail(removeUnsupportedRoadmapSections(removeUnsupportedRoadmapLead(withoutQuestion)))
			: withoutQuestion;
	const sections = splitAssistantReplySections(withoutQuestion);
	const unsupportedRemovalChanged =
		normalizeAssistantReplySpacing(withoutUnsupportedRoadmap) !== normalizeAssistantReplySpacing(withoutQuestion);
	const focused =
		(unsupportedSamplingRoadmap || unsupportedCompactFirstPassRoadmap) && unsupportedRemovalChanged
			? (() => {
				const cleanedSections = splitAssistantReplySections(withoutUnsupportedRoadmap);
				return cleanedSections.length >= 3 ? cleanedSections.slice(0, compactFirstPass ? 2 : 2).join("\n\n") : withoutUnsupportedRoadmap;
			})()
			: sections.length >= 3
				? sections.slice(0, compactFirstPass ? 3 : 2).join("\n\n")
				: withoutQuestion;
	const compact = truncateReplyAtWordBudget(focused, compactFirstPass ? 200 : 280);
	const footer = promptAsksForTeachingPageSourceMarker(request.displayPrompt)
		? ""
		: "";
	return normalizeAssistantReplySpacing(`${compact}${footer}`);
}

function firstCompletedSourceHighlightCitation(request: any) {
	const actions = Array.isArray(request?.pageActions) ? request.pageActions : [];
	for (const action of actions) {
		const isHighlight = String(action?.key || "").startsWith("highlight:") || action?.label === "Highlighted text" || action?.type === "highlight" || action?.type === "annotation";
		if (!isHighlight) continue;
		const text = compactActionText(action.citationText || action.matchedText || action.detail);
		if (text) return text;
	}
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	for (const trace of traces) {
		if (!isCompletedSourceHighlightTrace(trace)) continue;
		const details = trace?.resultDetails || trace?.details || {};
		const annotation = details?.annotation || {};
		const text = compactActionText(annotation.matchedText || annotation.container?.text || details?.matchedText);
		if (text) return text;
		const summary = String(trace?.resultSummary || "");
		const match = summary.match(/Highlighted\s+"([^"\n]{20,240})"/i);
		if (match?.[1]) return compactActionText(match[1]);
		const labelMatch = summary.match(/Highlighted(?:\s+text)?:\s*([^\n]{20,320})/i);
		if (labelMatch?.[1]) return compactActionText(labelMatch[1].replace(/\bannotationId:\s*[a-z0-9_-]+\b.*$/i, ""));
	}
	return "";
}

function truncateWords(value: unknown, maxWords: number) {
	const text = compactActionText(value);
	const words = text.match(/\S+/g) || [];
	if (words.length <= maxWords) return text;
	return `${words.slice(0, maxWords).join(" ").replace(/[,:;.!?]+$/, "")}...`;
}

function compactTeachingFooter() {
	return "This keeps the first pass focused. Ask for a section-by-section walkthrough to expand it.";
}

function removeCompactTeachingFooter(value: string) {
	return normalizeAssistantReplySpacing(String(value || "").replace(new RegExp(compactTeachingFooter().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), ""));
}

function dedupeCompactTeachingFooter(value: string) {
	const footer = compactTeachingFooter();
	const pattern = new RegExp(footer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	let seen = false;
	return normalizeAssistantReplySpacing(String(value || "").replace(pattern, () => {
		if (seen) return "";
		seen = true;
		return footer;
	}));
}

function cleanCompactTeachingSubject(value: unknown) {
	const text = compactActionText(value)
		.replace(/^(?:the|this|current)\s+(?:page|article|lecture|document|chapter)\s+(?:says?|is|covers?|about)\s+/i, "")
		.replace(/\b(?:on|in|from)\s+(?:this|the|current)\s+(?:page|article|lecture|document|chapter)\b.*$/i, "")
		.replace(/[.?!:;,\s]+$/g, "")
		.trim();
	if (!text || text.length < 4 || text.length > 90) return "";
	const words = text.match(/[A-Za-z][A-Za-z0-9'’-]*/g) || [];
	if (words.length < 1 || words.length > 9) return "";
	const generic = new Set(["page", "article", "lecture", "document", "chapter", "source", "this", "that", "current", "it"]);
	if (words.every((word) => generic.has(word.toLowerCase()))) return "";
	return text;
}

function extractCompactTeachingSubject(prompt: unknown) {
	const text = stripVoicePromptPrefix(String(prompt || "")).replace(/\s+/g, " ").trim();
	const patterns = [
		/\b(?:says?|teaches?|explains?|covers?)\s+about\s+(.+?)\s*[.?!]?$/i,
		/\b(?:teach|review|summarize|walk\s+through|explain)\s+(?:me\s+)?(?:what\s+)?(?:this|the|current)?\s*(?:page|article|lecture|document|chapter)?\s*(?:says?|teaches?|explains?|covers?)?\s+about\s+(.+?)\s*[.?!]?$/i,
		/\babout\s+(.+?)\s*[.?!]?$/i,
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		const subject = cleanCompactTeachingSubject(match?.[1] || "");
		if (subject) return subject;
	}
	return "";
}

function ensureCompactTeachingSubject(value: string, request: any) {
	const text = normalizeAssistantReplySpacing(value);
	if (!request || !promptAsksForCompactPageTeaching(request.displayPrompt)) return text;
	const subject = extractCompactTeachingSubject(request.displayPrompt);
	if (!subject) return text;
	const subjectTerms = entityWords(subject).filter((term) => term.length >= 4);
	if (subjectTerms.length && subjectTerms.every((term) => normalizeEntityText(text).includes(term))) return text;
	const heading = `**What this page says about ${subject}:**`;
	if (/^\s*\*\*What the highlighted passage says:\*\*/i.test(text)) {
		return normalizeAssistantReplySpacing(text.replace(/^\s*\*\*What the highlighted passage says:\*\*/i, heading));
	}
	if (/^\s*(?:What the highlighted passage says:)/i.test(text)) {
		return normalizeAssistantReplySpacing(text.replace(/^\s*What the highlighted passage says:/i, heading));
	}
	return normalizeAssistantReplySpacing(`${heading}\n\n${text}`);
}

function looksLikeThinCompactTeachingReply(value: string, request: any) {
	if (!promptAsksForCompactPageTeaching(request?.displayPrompt)) return false;
	if (completedSourceHighlightCount(request) < 1) return false;
	const body = removeCompactTeachingFooter(stripAssistantProcessNarration(value));
	if (visibleReplyWordCount(body) < 35) return true;
	if (visibleReplyWordCount(body) < 90 && /\bhighlighted\s+passage\s+(?:captures|shows|gives|contains)\b[\s\S]{0,120}\bcore\s+idea\b/i.test(body)) return true;
	const promptTerms = extractPromptConceptTerms(request?.displayPrompt || "").slice(0, 5);
	const highlightTerms = entityWords(firstCompletedSourceHighlightCitation(request)).slice(0, 6);
	const terms = [...new Set([...promptTerms, ...highlightTerms])].filter((term) => term.length >= 4);
	if (!terms.length) return false;
	return terms.filter((term) => normalizeEntityText(body).includes(term)).length < Math.min(2, terms.length);
}

function cleanFallbackSupportSentence(value: unknown) {
	let text = compactActionText(value);
	text = text.replace(/^[#*\-\d.)\s]+/, "").trim();
	text = stripShortLeadingHighlightLabel(text);
	if (/\b(?:ICML|AAAI|NeurIPS|ICLR|CVPR|ACL|EMNLP|arXiv|preprint|Proceedings|Conference|Journal|Handbook|doi:|https?:\/\/|www\.)\b/i.test(text)) return "";
	if (/^(?:\(?[A-Z][A-Za-z'’-]+,\s*\d{4}\)?|[A-Z][A-Za-z'’-]+,\s+[A-Z]\.|[A-Z][A-Za-z'’-]+ et al\.?)/.test(text)) return "";
	const beforeFormulaNoise = trimHighlightCandidateBeforeFormulaNoise(text);
	if (beforeFormulaNoise.length >= 35) text = beforeFormulaNoise;
	else {
		text = text.replace(
			/\s*[A-Za-z𝑊W*⋆′'{}\\\s^_-]+\s*(?:!=|==|<=|>=|\\neq|≠|≤|≥)\s*[A-Za-z𝑊W*⋆′'{}\\\s^_-]+(?:\s*\([^)]*\))?/gu,
			" ",
		);
	}
	text = text.replace(/\s+/g, " ").trim();
	if (text.length < 35 || text.length > 320) return "";
	const formulaSymbolCount = (text.match(/[=∫∏∑√≈≤≥<>|∣]/gu) || []).length;
	const proseWordCount = (text.match(/[A-Za-z]{3,}/g) || []).length;
	if (formulaSymbolCount >= 2 && proseWordCount <= 10) return "";
	if (/[=∫∏∑√≈≤≥<>|∣]/u.test(text) && text.length > 140) return "";
	if (/^(?:readable content|page heading outline|source frame|warning|note:)/i.test(text)) return "";
	return text;
}

function scoreFallbackSupportSentence(sentence: string, request: any, highlightText: string) {
	const normalized = normalizeEntityText(sentence);
	if (!normalized) return 0;
	const normalizedHighlight = normalizeEntityText(highlightText);
	if (normalizedHighlight && normalized.includes(normalizedHighlight)) return 0;
	const promptTerms = extractPromptConceptTerms(request?.displayPrompt || "").filter((term) => term.length >= 4);
	const highlightTerms = entityWords(highlightText).filter((term) => term.length >= 4);
	let score = 0;
	for (const term of new Set([...promptTerms, ...highlightTerms])) {
		if (normalized.includes(term)) score += 2;
	}
	const highlightOverlap = [...new Set(highlightTerms)].filter((term) => normalized.includes(term)).length;
	if (highlightTerms.length >= 3 && highlightOverlap >= Math.ceil(highlightTerms.length * 0.6)) score -= highlightOverlap * 2;
	if (/\b(?:model|models|data|posterior|prior|method|approach|prediction|estimate|example|result|because|means|shows|uses|works)\b/i.test(sentence)) score += 1;
	if (/\b(?:weights?|parameters?|configurations?|likelihood|objective|evidence|support|constraint|assumption|trade[-\s]?off)\b/i.test(sentence)) score += 3;
	if (/[=∫∏∑√≈≤≥<>|∣]/u.test(sentence)) score -= 1;
	return score;
}

function pickFallbackSupportSentence(request: any, highlightText: string) {
	const candidates: string[] = [];
	for (const block of recentReadableTraceBlocks(request)) {
		const parts = String(block || "")
			.split(/(?<=[.!?])\s+|\n+|(?:\s+-\s+)/)
			.map(cleanFallbackSupportSentence)
			.filter(Boolean);
		for (const part of parts) {
			if (!candidates.some((existing) => normalizeEntityText(existing) === normalizeEntityText(part))) candidates.push(part);
		}
	}
	return candidates
		.map((sentence) => ({ sentence, score: scoreFallbackSupportSentence(sentence, request, highlightText) }))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length)[0]?.sentence || "";
}

function buildCompactTeachingFallbackReply(request: any) {
	const highlightText = firstCompletedSourceHighlightCitation(request);
	if (!highlightText) return "";
	const support = pickFallbackSupportSentence(request, highlightText);
	const lines = [
		`Core idea: ${truncateWords(highlightText, 26)}`,
		support ? `Context: ${truncateWords(support, 30)}` : "",
		`Takeaway: start with that source passage; it is the page's hook for the first explanation.`,
		compactTeachingFooter(),
	].filter(Boolean);
	return normalizeAssistantReplySpacing(lines.join("\n\n"));
}

function recoverLowInformationCompactTeachingReply(value: string, request: any) {
	const text = normalizeAssistantReplySpacing(value);
	if (!looksLikeThinCompactTeachingReply(text, request)) return text;
	return buildCompactTeachingFallbackReply(request) || text;
}

function normalizeTrailingLearningCheck(value: string, request: any) {
	const text = normalizeAssistantReplySpacing(value);
	if (!text || !request?.learningMode) return text;
	const check = extractTrailingCheckQuestion(text);
	if (!check) return text;
	const shouldDropCheck =
		Boolean(request?.pageSourceMarkerRetry || request?.pdfAnchorRetry) ||
		visibleReplyWordCount(text) > 220;
	if (shouldDropCheck) return removeTrailingQuestionLine(text);
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (!lines[index].trim()) continue;
		lines[index] = `Check: ${check}`;
		break;
	}
	return normalizeAssistantReplySpacing(lines.join("\n"));
}

function stripTinyVisibleReplyArtifacts(value: string) {
	let text = String(value || "");
	text = text.replace(/^\s*(?:now\s+)?for\s+this\s+learning\s+session\.?\s*/gim, "");
	text = text.replace(/\b(?:let me|i(?:'|’)ll|i will)\s+record\s+(?:the\s+)?(?:core\s+)?concept\s*:?\s*/gi, "");
	text = text.replace(
		/^\s*(?:let me|i(?:'|’)ll|i will)\s+start\s+by\s+(?:reading|extracting|checking|finding|looking(?:\s+at)?)[\s\S]{0,260}?i\s+found\s+(?:the\s+)?(?:key|relevant|best|main|core)?\s*(?:explanatory\s+)?(?:passages?|sections?|text|content|source(?:s)?)\.?\s*/i,
		"",
	);
	text = text.replace(
		/^\s*(?:unfortunately|sorry)[^.!?\n]{0,260}\b(?:durable\s+)?source\s+highlights?\b[^.!?\n]*(?:[.!?]+)\s*/i,
		"",
	);
	text = text.replace(
		/^\s*(?:let me|i(?:'|’)ll|i will|i need to)\s+(?:add|create|place|put|mark)\b[\s\S]{0,220}?(?=(?:here(?:'|’)s|here is|this page|the page|##|\*\*|\d+[.)]\s|[-*]\s))/i,
		"",
	);
	text = text.replace(
		/([.!?])\s*(?:let me|i(?:'|’)ll|i will|i need to)\s+(?:add|create|place|put|mark|highlight)\b[^.!?\n]{0,220}(?:[.!?]+)?(?=\s*(?:here(?:'|’)s|here is|this page|the page|##|\*\*|\d+[.)]\s|[-*]\s))/gi,
		"$1 ",
	);
	text = text.replace(
		/^\s*(?:(?:now|first|next|also|okay|ok)[,\s]+)?(?:let me|i(?:'|’)ll|i will|i need to)\s+(?:(?:first|now|next|also|just|quickly|retry)\s+)?(?:read|extract|inspect|get|look(?:\s+at|\s+through)?|highlight(?:ing)?|add\s+(?:(?:[\w'-]+)\s+){0,10}(?:highlights?|markers?|notes?)|create\s+(?:(?:[\w'-]+)\s+){0,10}(?:highlights?|markers?|notes?)|ground|anchor|record|open|search|scroll|navigate|find|locate|check|capture|grab|mark|try)\b[^.!?\n]*(?:[.!?]+)?\s*/gim,
		"",
	);
	text = text.replace(/\bi(?:'|’)ve\s+highlighted\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/\b(?:highlighted above|anchored above|source marker above)\b[.!?]?/gi, "");
	text = text.replace(/(?:^|\n)\s*Each\s+(?:section|item|source|passage|point)[^.\n]{0,160}\bhighlighted\b[^.\n]*\.\s*/gi, "\n");
	text = text.replace(/\b(?:the\s+)?highlights?(?:\s+and\s+notes?)?\s+on\s+(?:the\s+)?page\s+(?:cover|show|mark|identify)\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/(?:^|\n)\s*(?:the\s+)?(?:source\s+)?markers?[^.\n]{0,220}\b(?:timed\s+out|failed|could(?:\s+not|n't)|cannot|can't|was\s+not|wasn't)\b[^.\n]*(?:[.!?]+)?\s*/gi, "\n");
	text = text.replace(/\b(?:though|although|while)?\s*(?:a|an|another|separate|additional|the)?\s*(?:source\s+)?(?:highlight|marker)[^.!?\n]{0,120}\b(?:could(?:\s+not|n't)|cannot|can't|failed\s+to|was\s+not|wasn't)\b[^.!?\n]*(?:[.!?]+)?/gi, "");
	text = text.replace(/^\s*(?:(?:good|great|ok|okay|sure|right|got it)[.,:;!?\u2014\u2013-]?\s*)+/i, "");
	text = text.replace(/^\s*(?:the page lays this out clearly|now i have the page content)\.?\s*/i, "");
	text = text.replace(/^\s*the page is only\b[^.\n]*(?:scrolled|below)\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*good,\s+the page\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*the page (?:appears to be|has|is scrollable)\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/^\s*this looks like\b[^.!?\n]*\blet me\b[^.!?\n]*(?:[.!?]+)?\s*$/gim, "");
	text = text.replace(/\s*(?:\n{1,2})?(?:want me to|would you like me to|should i)\b[^.!?\n]{0,180}$/i, "");
	return text;
}

function looksLikeOnlyVisibleReplyArtifact(value: unknown) {
	const text = normalizeAssistantReplySpacing(value);
	if (!text) return false;
	return /\b(?:let me|i(?:'|’)ll|i will|i need to|i found|highlight(?:ed|ing)?|source markers?|source highlights?|page is only|page appears to be|page is scrollable)\b/i.test(text);
}

function sanitizeAssistantVisibleReply(value: unknown, _request: any = null) {
	const original = String(value || "").replace(/\r\n?/g, "\n").trim();
	let text = original;
	if (!text) return "";
	text = stripOrphanedMarkdownDelimiterLines(text);
	text = stripTinyVisibleReplyArtifacts(text);
	text = stripEmptyCitationParentheses(text.replace(/\s+\(\)\s*:/g, ":"));
	text = stripHorizontalRuleSeparators(text);
	text = normalizeMarkdownBlockBoundaries(text);
	text = stripDanglingInlineMarkdownDelimiters(text);
	text = normalizeAssistantReplySpacing(text);
	text = stripOrphanedMarkdownDelimiterLines(text);
	return text || (looksLikeOnlyVisibleReplyArtifact(original) ? "" : original);
}

function shouldRecordFallbackOpenCheckForRequest(request: any, reply: string) {
	if (!request?.learningMode) return false;
	if (request?.pageSourceMarkerRetry || request?.pdfAnchorRetry) return false;
	if (visibleReplyWordCount(reply) > 220) return false;
	return Boolean(extractTrailingCheckQuestion(reply));
}

function buildFinalAssistantReply(assistantText: string, finalError: Error | null, request: any = null) {
	const text = sanitizeAssistantVisibleReply(assistantText, request);
	if (!finalError) return text || "(No reply generated.)";
	const errorReply = `Error: ${finalError.message || "Prompt failed."}`;
	const automatedRetryFailedBeforeFreshText =
		Boolean(request?.pdfAnchorRetry || request?.pageSourceMarkerRetry || request?.blankReplyRetry) && !String(request?.reply || "").trim();
	if (automatedRetryFailedBeforeFreshText) return errorReply;
	if (!text) return errorReply;
	return `${text}\n\n${errorReply}`;
}

function hasCompletedTabInventory(request: any) {
	return (Array.isArray(request?.toolTraces) ? request.toolTraces : []).some(
		(trace: any) => trace?.state === "complete" && trace?.toolName === "browser_list_tabs",
	);
}

function annotationIdParts(annotationId: unknown) {
	const match = String(annotationId || "").trim().match(/^onhand-(\d+)-([A-Za-z0-9]+)$/);
	return match ? { stamp: match[1], suffix: match[2] } : null;
}

function resolveActiveAnnotationId(request: any, annotationId: unknown, noteText: unknown = "") {
	const requested = compactActionText(annotationId);
	if (!requested || !request) return requested;
	const annotations = (Array.isArray(request.pageActions) ? request.pageActions : [])
		.filter((action: any) => action?.type === "annotation" && compactActionText(action.annotationId))
		.map((action: any) => ({
			annotationId: compactActionText(action.annotationId),
			text: `${action.detail || ""} ${action.citationText || ""}`.toLowerCase(),
			parts: annotationIdParts(action.annotationId),
		}));
	if (!annotations.length || annotations.some((entry) => entry.annotationId === requested)) return requested;
	const requestedParts = annotationIdParts(requested);
	if (!requestedParts) return requested;
	const noteWords = new Set(String(noteText || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
	const scored = annotations
		.map((entry) => {
			let score = 0;
			if (entry.parts?.stamp === requestedParts.stamp) score += 30;
			if (entry.parts?.suffix === requestedParts.suffix) score += 20;
			for (const word of noteWords) {
				if (entry.text.includes(word)) score += 1;
			}
			return { ...entry, score };
		})
		.filter((entry) => entry.score >= 20)
		.sort((left, right) => right.score - left.score);
	return scored[0]?.annotationId || requested;
}

function buildBlankReplyRetryPrompt(request: any) {
	if (
		promptRequiresPageSourceMarker(request?.displayPrompt) &&
		!promptForbidsPageChanges(request?.displayPrompt) &&
		!hasCompletedToolTrace(request, "browser_highlight_text")
	) {
		return buildPageSourceMarkerRetryPrompt(request, "");
	}
	const latestTrace = (Array.isArray(request?.toolTraces) ? [...request.toolTraces] : [])
		.reverse()
		.find((trace: any) => trace?.state === "complete" && trace?.resultSummary);
	const toolExcerpt = latestTrace?.resultSummary ? truncateStructuredText(String(latestTrace.resultSummary), 7000) : "";
	return [
		"You completed browser/tool work but returned no answer.",
		"Answer the original user question now using the completed tool result below. Do not call more tools.",
		`Original user question: ${stripVoicePromptPrefix(request?.displayPrompt || "")}`,
		toolExcerpt ? `Completed tool result:\n${toolExcerpt}` : "",
	].filter(Boolean).join("\n\n");
}

function findMissingKnownBrowserToolTrace(request: any) {
	const traces = Array.isArray(request?.toolTraces) ? [...request.toolTraces].reverse() : [];
	return traces.find((trace: any) => {
		const toolName = String(trace?.toolName || "");
		if (!KNOWN_BROWSER_TOOL_NAMES.has(toolName)) return false;
		const errorText = `${trace?.error || ""}\n${trace?.resultSummary || ""}\n${JSON.stringify(trace?.resultDetails || {})}`;
		return /\btool\b[\s\S]{0,80}\bnot found\b/i.test(errorText);
	}) || null;
}

function missingToolRetryToolNamesForPrompt(
	toolName: string,
	prompt: unknown,
	options: { forcePdfTools?: boolean; advancedRuntimeInspectionEnabled?: boolean; forceToolNames?: string[] } = {},
) {
	if (!KNOWN_BROWSER_TOOL_NAMES.has(toolName)) return [];
	const text = String(prompt || "").toLowerCase();
	const explicitToolNames = new Set(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN) || []);
	const explicitlyRequested = explicitToolNames.has(toolName) || (Array.isArray(options.forceToolNames) && options.forceToolNames.includes(toolName));
	const pageChangePolicy = promptPageChangePolicy(prompt);
	if (BROAD_SOURCE_TOOL_NAMES.includes(toolName)) return BROAD_SOURCE_TOOL_NAMES;
	if (toolName === "browser_textbook_search") {
		return textHasAny(
			text,
			/\b(?:textbooks?|e-?books?|bookshelf|online book|reader|courseware|chapter|section)\b/,
		) || explicitlyRequested
			? READER_SEARCH_TOOL_NAMES
			: [];
	}
	if (PDF_TOOL_NAMES.includes(toolName) || toolName === "browser_open_pdf_in_onhand_viewer") {
		return options.forcePdfTools || promptAsksForPdfCorpusOrViewerWork(text) || explicitlyRequested
			? ["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES, ...PDF_ANNOTATION_TOOL_NAMES]
			: [];
	}
	if (VISUAL_CONTEXT_TOOL_NAMES.includes(toolName)) {
		return promptAsksAboutVisualRegion(text) || explicitlyRequested ? VISUAL_CONTEXT_TOOL_NAMES : [];
	}
	if (VISUAL_GROUNDING_TOOL_NAMES.includes(toolName) || PAGE_CHANGE_TOOL_NAMES.includes(toolName)) {
		if (pageChangePolicy.forbidsAllPageChanges) return [];
		if (pageChangePolicy.forbidsHighlights && ["browser_highlight_text", "browser_scroll_to_annotation", "browser_clear_annotations"].includes(toolName)) return [];
		if (pageChangePolicy.forbidsNotes && toolName === "browser_show_note") return [];
		return promptAllowsPageSourceHighlights(prompt) || explicitlyRequested ? VISUAL_GROUNDING_TOOL_NAMES : [];
	}
	if (INTERACTION_TOOL_NAMES.includes(toolName)) {
		const interactionIntent =
			promptAsksForLinkedPageNavigation(text) ||
			textHasAny(text, /\b(click|type|fill|field|button|selector|form|press|pick|choose|wait for|input)\b/);
		return interactionIntent || explicitlyRequested ? INTERACTION_TOOL_NAMES : [];
	}
	if (DEBUG_INSPECTION_TOOL_NAMES.includes(toolName)) {
		return textHasAny(text, /\b(debug|console|network|dom|html|screenshot)\b/) || explicitlyRequested ? DEBUG_INSPECTION_TOOL_NAMES : [];
	}
	if (RUNTIME_JS_TOOL_NAMES.includes(toolName)) {
		return options.advancedRuntimeInspectionEnabled !== false && (promptNeedsRuntimeJavaScript(text, explicitToolNames) || explicitlyRequested)
			? RUNTIME_JS_TOOL_NAMES
			: [];
	}
	if (ARTIFACT_TOOL_NAMES.includes(toolName)) {
		return textHasAny(text, /\b(artifact|capture state|save state|restore|session replay|saved page|list artifacts?)\b/) || explicitlyRequested
			? ARTIFACT_TOOL_NAMES
			: [];
	}
	return [];
}

function buildMissingToolRetryPrompt(request: any, toolName: string) {
	return [
		`The previous attempt tried to use ${toolName}, but that tool was not available in the request's tool pack.`,
		"The runtime has now enabled the needed tool pack. Retry the original user request from the current browser context.",
		"Ignore any earlier fallback answer that said the tool was unavailable. Do the browser work first if it is needed, then answer concisely without process narration.",
		`Original user question: ${stripVoicePromptPrefix(request?.displayPrompt || request?.prompt || "")}`,
	].join("\n\n");
}

function queueBlankReplyRetry(agent: Agent, prompt: string, onError: (error: Error) => void) {
	if (typeof (agent as any).followUp === "function" && typeof (agent as any).waitForIdle === "function" && typeof (agent as any).continue === "function") {
		(agent as any).followUp({
			role: "user",
			content: [{ type: "text", text: prompt }],
			timestamp: Date.now(),
		});
		void (agent as any).waitForIdle().then(
			() => {
				void (agent as any).continue().catch((retryError: unknown) => {
					onError(retryError instanceof Error ? retryError : new Error(String(retryError)));
				});
			},
			(retryError: unknown) => {
				onError(retryError instanceof Error ? retryError : new Error(String(retryError)));
			},
		);
		return;
	}
	void agent.prompt(prompt).catch((retryError) => onError(retryError instanceof Error ? retryError : new Error(String(retryError))));
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

function normalizeUrlForPriorPageContext(value: unknown) {
	try {
		const url = new URL(String(value || ""));
		url.hash = "";
		return url.href;
	} catch {
		return String(value || "").split("#")[0].trim();
	}
}

function promptKeywordsForPriorPageContext(prompt: unknown) {
	const stop = new Set([
		"about",
		"also",
		"and",
		"are",
		"associate",
		"associated",
		"does",
		"for",
		"from",
		"have",
		"listed",
		"models",
		"notes",
		"page",
		"papers",
		"repeat",
		"same",
		"table",
		"tell",
		"that",
		"them",
		"this",
		"those",
		"what",
		"which",
		"with",
	]);
	return Array.from(
		new Set(
			String(prompt || "")
				.toLowerCase()
				.match(/[a-z][a-z0-9]{2,}/g) || [],
		),
	).filter((word) => !stop.has(word)).slice(0, 24);
}

function promptReferencesPriorPageContext(prompt: unknown) {
	const text = String(prompt || "").toLowerCase();
	return (
		/\b(?:using|from|based on|with)\s+(?:the\s+)?(?:same|previous|prior|earlier|above)\s+(?:page|document|doc|article|paper|source|context|extract|lecture|notes?)\b/.test(text) ||
		/\b(?:same|previous|prior|earlier|above)\s+(?:page|document|doc|article|paper|source|context|extract|lecture|notes?)\b/.test(text)
	);
}

function promptNeedsExactReadableContext(prompt: unknown) {
	return /\b(?:exact|verbatim|quote|quoted|formula|equation|symbol|notation|math|sinusoidal|sine|cosine|table|tables|row|rows|column|columns|tensor|tensors|parameter(?:[-\s]?count)?|parameters?|params?|percent|percentage|value|values)\b|%/i.test(String(prompt || ""));
}

function promptNeedsFocusedReadableContext(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text) return false;
	if (promptNeedsExactReadableContext(text)) return true;
	if (promptAsksForStructuredPageSourceMarker(text)) return true;
	if (
		textHasAny(text, /\b(?:compare|comparison|contrast|versus|vs\.?|differ(?:ence|ences|ent)?)\b/) &&
		(promptReferencesCurrentPageMaterial(text) || extractComparisonEntities(text).length >= 2)
	) {
		return true;
	}
	if (
		textHasAny(text, /\b(?:roadmap|outline|progression|methods?|approaches?|techniques?|algorithm)\b/) &&
		/\b(?:page|article|lecture|document|section|source|method|technique|process|workflow|algorithm|approach|chapter)\b/.test(text)
	) {
		return true;
	}
	if (
		textHasAny(text, /\b(?:where|derive|derivation|proof|walk(?:\s+me)?\s+through|how\s+(?:does|do|did))\b/) &&
		/\b(?:page|article|lecture|document|section|source|formula|equation|theorem|algorithm|method|process|chapter)\b/.test(text)
	) {
		return true;
	}
	return false;
}

function buildReadableContentQuery(prompt: unknown) {
	const clean = stripVoicePromptPrefix(prompt).replace(/\s+/g, " ").trim();
	if (!clean) return "";
	return clean.slice(0, 320);
}

function splitPriorExtractSections(summary: string) {
	const outlineMatch = summary.match(/Page heading outline with section snippets:\n([\s\S]*?)(?:\n\nReadable body excerpt:|\n\n\(Note:|$)/i);
	const source = (outlineMatch?.[1] || summary).replace(/¶/g, "");
	const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
	const sections: string[] = [];
	let current = "";
	for (const line of lines) {
		if (/^#{1,6}\s+/.test(line)) {
			if (current) sections.push(current.trim());
			current = line;
		} else if (current) {
			current += ` ${line}`;
		}
	}
	if (current) sections.push(current.trim());
	return sections.length ? sections : [truncateStructuredText(source, PRIOR_PAGE_CONTEXT_SECTION_MAX_CHARS)];
}

function buildPriorExtractedPageContext(session: RuntimeSession, activeTab: any, prompt: string) {
	if (promptNeedsExactReadableContext(prompt)) return "";
	const activeUrl = normalizeUrlForPriorPageContext(activeTab?.url);
	const referencesPriorPage = promptReferencesPriorPageContext(prompt);
	if (!activeUrl && !referencesPriorPage) return "";
	const keywords = promptKeywordsForPriorPageContext(prompt);
	const candidates: Array<{ score: number; createdAt: string; text: string; summaryLength: number; title: string; url: string; activeMatch: boolean }> = [];
	for (const turn of Array.isArray(session.turns) ? session.turns : []) {
		if (!turn || turn.pending || turn.error || !Array.isArray(turn.toolTraces)) continue;
		for (const trace of turn.toolTraces) {
			if (trace?.toolName !== "browser_extract_content" || trace.state !== "complete") continue;
			const details: any = trace.resultDetails || {};
			const traceUrl = normalizeUrlForPriorPageContext(details?.tab?.url || details?.content?.url);
			const activeMatch = Boolean(activeUrl && traceUrl && traceUrl === activeUrl);
			if (!traceUrl || (!activeMatch && !referencesPriorPage)) continue;
			const summary = String(trace.resultSummary || "").trim();
			if (!summary) continue;
			for (const section of splitPriorExtractSections(summary)) {
				const lower = section.toLowerCase();
				const score = keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0);
				if (score <= 0) continue;
				candidates.push({
					score: score + (activeMatch ? 100 : 0) + (referencesPriorPage ? 10 : 0),
					createdAt: String(turn.createdAt || ""),
					text: truncateStructuredText(section, PRIOR_PAGE_CONTEXT_SECTION_MAX_CHARS),
					summaryLength: summary.length,
					title: String(details?.tab?.title || details?.content?.title || activeTab?.title || ""),
					url: traceUrl,
					activeMatch,
				});
			}
		}
	}
	if (!candidates.length) return "";
	const selected = candidates
		.sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
		.slice(0, PRIOR_PAGE_CONTEXT_MAX_SECTIONS);
	const body = selected.map((entry) => entry.text).join("\n\n");
	if (!body.trim()) return "";
	const source = selected[0];
	return [
		`Session page context already read from ${source.activeMatch ? "the active page" : "a prior page in this session"}:`,
		`Source: ${source.title || activeTab?.title || "(untitled)"} - ${source.url || activeUrl}`,
		"Use this cached extract before calling browser_extract_content again. If it answers the follow-up, do not re-extract the page.",
		truncateStructuredText(body, PRIOR_PAGE_CONTEXT_MAX_CHARS),
	].join("\n");
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
				"- For likely repeated concepts, keep the turn lightweight: start with a brief reminder that it came up earlier, use the existing source highlight when possible, and avoid re-running the full teaching flow.",
				"- Page-work budget for repeated concepts: jump/scroll to the existing source highlight if available; if that fails, use at most one fallback read and at most one replacement highlight copied from visible/readable page text, not from your explanation. Do not annotate nearby examples or add notes unless the user explicitly asks for a deeper pass.",
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
		/\bbrowser_[a-z_]+\b|\b(port smoke|ports?|tools?|debug(?:ging)?|diagnostic|dom|console|network|screenshot|selector|artifact|capture|restore)\b/.test(text);
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
	if (promptAsksForCompactPageTeaching(prompt)) {
		return {
			...base,
			mode: "balanced",
			reason: "Internal routing chose compact page teaching.",
			reasoningEffort: "none",
			textVerbosity: "low",
			maxTokens: ONHAND_COMPACT_TEACHING_OUTPUT_TOKENS,
			promptPolicy:
				"Runtime policy: Page teaching/review. Highlight each key concept the page covers for this question — roughly one source highlight per concept (soft cap about six) — and add a short interpretive note (one to two sentences) on each. Keep the chat synthesis concise with short labels or bullets, and let the highlights and notes carry the explanation. Do not write a detached whole-page lecture, and do not include display equations unless the user asked for formulas.",
		};
	}
	switch (mode) {
		case "deep":
			return {
				...base,
				reasoningEffort: "low",
				textVerbosity: "low",
				maxTokens: ONHAND_DEEP_OUTPUT_TOKENS,
				promptPolicy:
					"Runtime policy: Source-thorough pass. Cover each distinct requested key point with source highlights and short interpretive notes where useful. For roadmap/list/process/derivation/proof prompts, do not impose a fixed marker cap; cover every required item the answer names unless a single highlighted list/table contains them. Avoid redundant inspection and unrelated navigation.",
			};
		case "balanced":
				return {
					...base,
					reasoningEffort: "none",
					textVerbosity: "low",
					maxTokens: ONHAND_MAX_OUTPUT_TOKENS,
					promptPolicy:
						"Runtime policy: Focused grounding pass. Anchor the answer with one source highlight on the supporting page text, then answer briefly referencing it (skip the highlight only for no-page-changes requests, quick visual questions, or when the page does not support the claim). Add more highlights/notes when the user asks where evidence is located, when page-level teaching/review needs durable source markers, or when learning/source-navigation work needs durable source highlights. Inspect more only when captured context is insufficient.",
				};
		case "fast":
		default:
			return {
				...base,
				reasoningEffort: "none",
				textVerbosity: "low",
				maxTokens: ONHAND_FAST_OUTPUT_TOKENS,
				promptPolicy:
					"Runtime policy: Quick grounded answer. Prefer captured context; keep page work read-only unless the user asks for annotations or source locations. Answer in one to three short readable paragraphs or compact bullets; avoid dense sidebar blocks.",
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

function imageDataUrlFromBlock(block: any) {
	if (!block || typeof block !== "object") return "";
	const mimeType = String(block.mimeType || block.media_type || "image/png");
	const data = String(block.data || "");
	if (data.startsWith("data:image/")) return data;
	if (data) return `data:${mimeType};base64,${data}`;
	const imageUrl = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
	const url = String(imageUrl || block.url || "");
	return url.startsWith("data:image/") ? url : "";
}

function imageBlockWithDataUrl(block: any, dataUrl: string) {
	const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/s);
	if (!match) return block;
	const mimeType = match[1] || "image/jpeg";
	const data = match[2] || "";
	if (block?.type === "image_url") {
		if (typeof block.image_url === "string") return { ...block, image_url: dataUrl };
		return { ...block, image_url: { ...(block.image_url || {}), url: dataUrl } };
	}
	if (block?.type === "input_image") {
		return { ...block, image_url: dataUrl, url: dataUrl, data, mimeType, media_type: mimeType };
	}
	return { ...block, type: block?.type || "image", data, mimeType, media_type: mimeType };
}

function dataUrlBase64Length(dataUrl: string) {
	const match = String(dataUrl || "").match(/^data:[^;,]+;base64,(.+)$/s);
	return match ? match[1].length : String(dataUrl || "").length;
}

function scaledImageDimensions(width: number, height: number, maxEdge: number) {
	const sourceWidth = Number(width) || 0;
	const sourceHeight = Number(height) || 0;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;
	const edge = Math.max(1, Number(maxEdge) || ONHAND_FREE_VISUAL_IMAGE_MAX_EDGE_PX);
	const ratio = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
	return {
		width: Math.max(1, Math.round(sourceWidth * ratio)),
		height: Math.max(1, Math.round(sourceHeight * ratio)),
	};
}

function bytesToBase64(bytes: Uint8Array) {
	if (typeof btoa === "function") {
		let binary = "";
		const chunkSize = 0x8000;
		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
		}
		return btoa(binary);
	}
	const bufferCtor = (globalThis as any).Buffer;
	if (bufferCtor) return bufferCtor.from(bytes).toString("base64");
	return "";
}

async function blobToDataUrl(blob: Blob, fallbackMimeType = "image/jpeg") {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const encoded = bytesToBase64(bytes);
	if (!encoded) return "";
	return `data:${blob.type || fallbackMimeType};base64,${encoded}`;
}

async function loadImageForFreeTierCompression(dataUrl: string): Promise<any | null> {
	if (typeof createImageBitmap === "function" && typeof fetch === "function") {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		return await createImageBitmap(blob);
	}
	if (typeof Image === "undefined" || typeof document === "undefined") return null;
	return await new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not load image for compression."));
		image.src = dataUrl;
	});
}

async function encodeImageAsJpegDataUrl(image: any, width: number, height: number, quality: number) {
	const canvas =
		typeof OffscreenCanvas === "function"
			? new OffscreenCanvas(width, height)
			: typeof document !== "undefined"
				? document.createElement("canvas")
				: null;
	if (!canvas) return "";
	(canvas as any).width = width;
	(canvas as any).height = height;
	const context = (canvas as any).getContext?.("2d");
	if (!context) return "";
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	context.drawImage(image, 0, 0, width, height);
	if (typeof (canvas as any).convertToBlob === "function") {
		const blob = await (canvas as any).convertToBlob({ type: "image/jpeg", quality });
		return await blobToDataUrl(blob, "image/jpeg");
	}
	if (typeof (canvas as HTMLCanvasElement).toBlob !== "function") return "";
	const blob = await new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality));
	return blob ? await blobToDataUrl(blob, "image/jpeg") : "";
}

async function compressImageDataUrlForFreeTier(dataUrl: string) {
	const raw = String(dataUrl || "").trim();
	const match = raw.match(/^data:(image\/[^;,]+);base64,(.+)$/s);
	if (!match) return raw;
	const sourceMimeType = match[1] || "image/png";
	const originalBase64Chars = match[2].length;
	if (/^image\/jpe?g$/i.test(sourceMimeType) && originalBase64Chars <= ONHAND_FREE_VISUAL_IMAGE_TARGET_BASE64_CHARS) return raw;
	if (originalBase64Chars <= ONHAND_FREE_VISUAL_IMAGE_SMALL_BASE64_CHARS) return raw;
	let image: any | null = null;
	try {
		image = await loadImageForFreeTierCompression(raw);
		const sourceWidth = Number(image?.width || image?.naturalWidth || 0);
		const sourceHeight = Number(image?.height || image?.naturalHeight || 0);
		let bestDataUrl = raw;
		let bestSize = originalBase64Chars;
		for (const maxEdge of ONHAND_FREE_VISUAL_IMAGE_EDGE_STEPS) {
			const dimensions = scaledImageDimensions(sourceWidth, sourceHeight, maxEdge);
			if (!dimensions) break;
			for (const quality of ONHAND_FREE_VISUAL_IMAGE_QUALITY_STEPS) {
				const candidate = await encodeImageAsJpegDataUrl(image, dimensions.width, dimensions.height, quality);
				const candidateSize = dataUrlBase64Length(candidate);
				if (candidate && candidateSize > 0 && candidateSize < bestSize) {
					bestDataUrl = candidate;
					bestSize = candidateSize;
				}
				if (candidate && candidateSize > 0 && candidateSize <= ONHAND_FREE_VISUAL_IMAGE_TARGET_BASE64_CHARS) return candidate;
			}
		}
		return bestDataUrl;
	} catch {
		return raw;
	} finally {
		try {
			image?.close?.();
		} catch {}
	}
}

async function compressFreeTierVisualImageBlock(block: any, compressDataUrl = compressImageDataUrlForFreeTier) {
	const dataUrl = imageDataUrlFromBlock(block);
	if (!dataUrl) return block;
	try {
		const compressed = await compressDataUrl(dataUrl);
		if (!compressed || compressed === dataUrl) return block;
		return imageBlockWithDataUrl(block, compressed);
	} catch {
		return block;
	}
}

async function compressFreeTierVisualContextMessages(messages: any[] = [], compressDataUrl = compressImageDataUrlForFreeTier) {
	if (!messagesContainImage(messages)) return messages;
	return await Promise.all(
		messages.map(async (message) => {
			const content = message?.content;
			if (!Array.isArray(content)) return message;
			const nextContent = await Promise.all(
				content.map((block: any) =>
					contentBlockIsImage(block) ? compressFreeTierVisualImageBlock(block, compressDataUrl) : block,
				),
			);
			return { ...message, content: nextContent };
		}),
	);
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
	const compacted = compactFreeTierVisualContextMessages(messages);
	return (await compressFreeTierVisualContextMessages(compacted)) as AgentMessage[];
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

function buildPdfPageImagePromptImages(capture: unknown) {
	const details = capture && typeof capture === "object" ? (capture as any) : null;
	const pageNumber = details?.pageNumber || details?.page || "capture";
	const attachment = imageAttachmentFromDataUrl(details?.dataUrl, `pdf-page-${pageNumber}.png`);
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

function isGoogleDocsDocumentUrlForContext(value: unknown) {
	return /^https:\/\/docs\.google\.com\/document\/d\/[^/]+\/edit(?:[?#/]|$)/i.test(String(value || ""));
}

async function withBrowserContextTimeout(label: string, run: () => Promise<any>) {
	return await new Promise((resolve, reject) => {
		let settled = false;
		const timeoutId = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error(`Timed out while preparing page context: ${label}`));
		}, BROWSER_CONTEXT_COMMAND_TIMEOUT_MS);
		Promise.resolve()
			.then(run)
			.then((result) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				resolve(result);
			})
			.catch((error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				reject(error);
			});
	});
}

async function runBrowserContextCommand(host: RuntimeHost, command: string, params: Record<string, unknown>) {
	return await withBrowserContextTimeout(command, () => host.runCommand(command, params));
}

async function runBrowserContextSnapshot(host: RuntimeHost, args: Record<string, unknown> = {}) {
	return await withBrowserContextTimeout("snapshot_state", () => host.snapshotState(args));
}

async function renderBrowserContextDetails(
	host: RuntimeHost,
	options: { targetWindowId?: number; includeReadableContent?: boolean; readableMaxChars?: number; includeVisualRegionImage?: boolean } = {},
) {
	try {
		const state = await runBrowserContextSnapshot(host);
		const activeTab = pickActiveTab(state, options.targetWindowId);
		const openTabs = summarizeOpenTabs(state, activeTab);
		let selection = null;
		let visible = null;
		let extracted = null;
		let visualRegion = null;
		let warning = null;

		if (activeTab?.id && activeTab.url && !isPrivilegedUrl(activeTab.url)) {
			const isGoogleDocsDocument = isGoogleDocsDocumentUrlForContext(activeTab.url);
			try {
				selection = await runBrowserContextCommand(host, "get_selection", { tabId: activeTab.id });
			} catch (error: any) {
				warning = error?.message || String(error);
			}
			if (!isGoogleDocsDocument) {
				try {
					visible = await runBrowserContextCommand(host, "get_visible_text", {
						tabId: activeTab.id,
						maxChars: BROWSER_CONTEXT_MAX_CHARS,
						maxBlocks: BROWSER_CONTEXT_MAX_BLOCKS,
					});
				} catch (error: any) {
					warning ||= error?.message || String(error);
				}
			}
			if (options.includeReadableContent || isGoogleDocsDocument) {
				try {
					extracted = await runBrowserContextCommand(host, "extract_content", {
						tabId: activeTab.id,
						maxChars: options.readableMaxChars || (isGoogleDocsDocument ? BROWSER_CONTEXT_MAX_CHARS : REALTIME_READABLE_CONTEXT_MAX_CHARS),
					});
				} catch (error: any) {
					warning ||= error?.message || String(error);
				}
			}
			if (options.includeVisualRegionImage) {
				try {
					visualRegion = await runBrowserContextCommand(host, "get_visible_region_image", {
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
		if ((options.includeReadableContent || isGoogleDocsDocumentUrlForContext(activeTab?.url)) && readableText) {
			lines.push(isGoogleDocsDocumentUrlForContext(activeTab?.url) ? "Google Docs excerpt:" : "Readable page excerpt:");
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
			if (pdfSelectionAccessWasBlocked(selection?.selection)) {
				lines.push(
					"PDF selected text was not exposed by this reader. If the user is asking about selected/highlighted PDF text, use the Onhand PDF viewer handoff and ask the user to rehighlight there if selected text did not transfer. Recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions. Do not claim Chrome's native PDF viewer blocks selection unless the active reader is actually Chrome's native viewer and selection/copy fallbacks failed.",
				);
			}
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

function promptAsksAboutPdfPagePosition(prompt: unknown) {
	return /\b(?:page\s+number|current\s+page|which\s+page|what\s+page|where\s+am\s+i|page\s+am\s+i\s+on|what\s+page\s+is\s+this)\b/i.test(String(prompt || ""));
}

function promptReferencesVisiblePdfSelectionOrPage(prompt: unknown) {
	const text = String(prompt || "").toLowerCase();
	if (promptAsksAboutPdfPagePosition(text)) return true;
	if (/\b(?:selected|selection|highlighted|highlight|marked|cursor|text\s+i\s+selected|passage\s+i\s+selected)\b/.test(text)) return true;
	if (/\b(?:what\s+does|explain|can\s+you\s+explain|what\s+is|tell\s+me\s+what)\s+(?:this|that|it)\s+(?:mean|means|say|says|refer\s+to|show|shows|represent|represents)\b/.test(text)) {
		return true;
	}
	return false;
}

function promptExplicitlyMentionsVisibleSelection(prompt: unknown) {
	return /\b(?:selected|selection|highlighted|highlight|marked|text\s+i\s+selected|passage\s+i\s+selected)\b/i.test(String(prompt || ""));
}

function promptCouldReferToHighlightedPdfText(prompt: unknown) {
	const text = String(prompt || "");
	if (promptAsksAboutPdfPagePosition(text)) return false;
	if (promptExplicitlyMentionsVisibleSelection(text)) return true;
	if (promptAsksAboutVisualRegion(text)) return false;
	return /\b(?:what\s+does|explain|can\s+you\s+explain|what\s+is|tell\s+me\s+what)\s+(?:this|that|it)\s+(?:mean|means|say|says|refer\s+to|show|shows|represent|represents)\b/i.test(
		text,
	);
}

function promptPageChangePolicy(prompt: unknown) {
	const text = String(prompt || "").toLowerCase();
	const negativeDirective = /\b(?:do not|don't|dont|no|without|avoid|skip)\b[^.?!\n]{0,80}/;
	const forbidsAllPageChanges =
		/\b(?:do not|don't|dont|no|without|avoid|skip)\s+(?:add(?:ing)?\s+)?(?:page changes?|page edits?|marginalia)\b/.test(text) ||
		/\b(?:do not|don't|dont)\s+(?:change|modify|edit|annotate|mark up)\s+(?:the\s+)?page\b/.test(text) ||
		/\b(?:answer only|text only|chat only)\b/.test(text);
	const forbidsHighlights =
		forbidsAllPageChanges ||
		/\b(?:do not|don't|dont|no|without|avoid|skip)\s+(?:add(?:ing)?\s+)?(?:highlights?|highlighting|annotations?|annotat(?:e|ing|ions?)|mark(?:ing)?(?:\s+up)?)\b/.test(
			text,
		) ||
		new RegExp(`${negativeDirective.source}\\b(?:highlights?|highlighting|annotations?|annotat(?:e|ing|ions?)|mark(?:ing)?(?:\\s+up)?)\\b`).test(text);
	const forbidsNotes =
		forbidsAllPageChanges ||
		/\b(?:do not|don't|dont|no|without|avoid|skip)\s+(?:add(?:ing)?\s+)?(?:notes?)\b/.test(text) ||
		new RegExp(`${negativeDirective.source}\\bnotes?\\b`).test(text);
	return { forbidsAllPageChanges, forbidsHighlights, forbidsNotes };
}

function promptExplicitlyRequestsNote(prompt: unknown) {
	const text = String(prompt || "").toLowerCase();
	return (
		/\b(?:add|make|create|write|leave|show|attach|put)\b[^.?!\n]{0,80}\bnotes?\b/.test(text) ||
		/\bnotes?\b[^.?!\n]{0,80}\b(?:on|for|about|near|next to|beside)\b/.test(text)
	);
}

function promptForbidsPageChanges(prompt: unknown) {
	const policy = promptPageChangePolicy(prompt);
	return policy.forbidsAllPageChanges || policy.forbidsHighlights || policy.forbidsNotes;
}

function browserContextHasUsableText(details: any) {
	const selectionText = getSelectionText(details?.selection);
	const visibleText = formatVisibleTextForModel(details?.visible, 1200);
	const readableText = extractReadableContentText(details?.extracted);
	return Boolean(selectionText || visibleText || readableText);
}

function pdfSelectionAccessWasBlocked(selection: unknown) {
	if (!selection || typeof selection !== "object") return false;
	const details = selection as any;
	const fallbackValues = [
		details.googleScholarReaderSelectionFallback,
		details.nativePdfSelectionFallback,
		details.browserClipboardSelectionFallback,
		details.debuggerFrameSelectionFallback,
	];
	const attemptedBlockedFallback = fallbackValues.some((fallback) => fallback && typeof fallback === "object" && fallback.attempted === true && fallback.ok !== true);
	return Boolean(
		(details.surface === "pdf" || details.pdfAnchor?.surface === "pdf" || details.viewer || attemptedBlockedFallback) &&
			(!getSelectionText(details) || attemptedBlockedFallback) &&
			(String(details.mainFrameSelectionError || "").trim() || attemptedBlockedFallback),
	);
}

function pdfSelectionHighlightStatusUnknown(selection: unknown) {
	if (!selection || typeof selection !== "object" || getSelectionText(selection)) return false;
	const details = selection as any;
	const fallbackValues = [
		details.googleScholarReaderSelectionFallback,
		details.nativePdfSelectionFallback,
		details.browserClipboardSelectionFallback,
		details.debuggerFrameSelectionFallback,
	];
	const attemptedBlockedFallback = fallbackValues.some((fallback) => fallback && typeof fallback === "object" && fallback.attempted === true && fallback.ok !== true);
	const readerState = String(details.googleScholarReader?.selectionState || details.selectionState || "").trim().toLowerCase();
	if (readerState === "unknown") return true;
	if (details.hasSelection === true) return true;
	return Boolean(pdfSelectionAccessWasBlocked(details) && attemptedBlockedFallback);
}

function pdfSelectionReaderShouldUseOnhandViewer(selection: unknown) {
	if (!selection || typeof selection !== "object") return false;
	const details = selection as any;
	const viewer = String(details.viewer || "").toLowerCase();
	if (details.googleScholarReader?.detected || viewer === "google-scholar") return true;
	if (viewer && !/^(chrome-pdf-viewer|native-chrome-pdf-viewer|onhand-pdf-viewer|pdfjs)$/i.test(viewer)) return true;
	return pdfSelectionAccessWasBlocked(details);
}

function shouldOpenPdfViewerForUnknownPdfSelection(prompt: unknown, details?: any) {
	if (!details || !browserContextLooksLikePdf(details)) return false;
	if (isOnhandPdfViewerUrl(details.activeTab?.url)) return false;
	if (!promptCouldReferToHighlightedPdfText(prompt)) return false;
	if (pdfSelectionReaderShouldUseOnhandViewer(details.selection)) return true;
	return pdfSelectionHighlightStatusUnknown(details.selection);
}

function shouldCaptureVisualRegionForPdfSelectionFallback(prompt: unknown, details?: any) {
	if (!details || !promptReferencesVisiblePdfSelectionOrPage(prompt) || !browserContextLooksLikePdf(details)) return false;
	const selectionText = getSelectionText(details.selection);
	if (pdfSelectionReaderShouldUseOnhandViewer(details.selection)) return false;
	if (promptAsksAboutPdfPagePosition(prompt)) {
		return !getSelectionPageNumber(details.selection);
	}
	if (promptExplicitlyMentionsVisibleSelection(prompt)) return true;
	if (pdfSelectionAccessWasBlocked(details.selection)) return true;
	if (selectionText) return false;
	return !browserContextHasUsableText(details);
}

function shouldCaptureVisualRegionForPrompt(prompt: unknown, details?: any) {
	if (promptAsksAboutVisualRegion(prompt)) return true;
	if (shouldCaptureVisualRegionForPdfSelectionFallback(prompt, details)) return true;
	if (details && !browserContextHasUsableText(details)) return true;
	return false;
}

function buildVisualResponseFormatRequirement(prompt: unknown, details?: any, pdfVisualCapture?: any) {
	if (!promptAsksAboutVisualRegion(prompt)) return "";
	const subject = pdfVisualCapture?.dataUrl || browserContextLooksLikePdf(details) ? "visible PDF/figure question" : "visual question";
	return [
		`Response format requirement for this ${subject}:`,
		"- Do not answer as one dense paragraph.",
		"- Use 2-4 compact Markdown sections or bullets with short labels such as **What it shows**, **How to read it**, and **Takeaway**.",
		"- Keep each section to 1-2 short sentences; preserve depth by adding bullets, not by lengthening paragraphs.",
		"- Use a plain paragraph only when the complete answer is one sentence.",
	].join("\n");
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

function browserContextPdfReaderText(details: any, maxChars = 3000) {
	const activeTab = details?.activeTab || {};
	const selection = details?.selection || {};
	const visible = details?.visible || {};
	const extracted = details?.extracted || {};
	const pieces = [
		activeTab.title,
		activeTab.url,
		activeTab.pendingUrl,
		selection.viewer,
		selection.source,
		selection.surface,
		selection.frameUrl,
		selection.contextOrigin,
		selection.mainFrameSelectionError,
		selection.googleScholarReaderSelectionFallback?.error,
		selection.nativePdfSelectionFallback?.error,
		selection.browserClipboardSelectionFallback?.error,
		selection.debuggerFrameSelectionFallback?.error,
		getSelectionText(selection),
		formatVisibleTextForModel(visible?.visible || visible, maxChars),
		extractReadableContentText(extracted).slice(0, maxChars),
	];
	return pieces
		.map((piece) => String(piece || "").trim())
		.filter(Boolean)
		.join("\n");
}

function normalizePdfContextPageNumber(value: unknown) {
	const match = String(value ?? "").match(/\d+/);
	if (!match) return null;
	const pageNumber = Number.parseInt(match[0], 10);
	return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

function inferPdfPageNumberFromBrowserContextDetails(details: any) {
	const selectionPage = getSelectionPageNumber(details?.selection);
	if (selectionPage) return { pageNumber: selectionPage, source: "selection" };
	const directPage = normalizePdfContextPageNumber(
		details?.selection?.googleScholarReader?.pageNumber ??
			details?.visible?.pageNumber ??
			details?.visible?.currentPageNumber ??
			details?.visible?.page,
	);
	if (directPage) return { pageNumber: directPage, source: "context-page" };
	const text = browserContextPdfReaderText(details, 2000);
	const pageOfMatch = text.match(/\bpage\s+(\d{1,4})\s+(?:of|\/)\s+(\d{1,4})\b/i);
	if (pageOfMatch) {
		const pageNumber = normalizePdfContextPageNumber(pageOfMatch[1]);
		const totalPages = normalizePdfContextPageNumber(pageOfMatch[2]);
		if (pageNumber && totalPages && pageNumber <= totalPages) return { pageNumber, source: "context-page-fraction" };
	}
	const fractionPattern = /(?:^|[^\d])(\d{1,4})\s*\/\s*(\d{1,4})(?!\d)/g;
	let match: RegExpExecArray | null = null;
	while ((match = fractionPattern.exec(text))) {
		const pageNumber = normalizePdfContextPageNumber(match[1]);
		const totalPages = normalizePdfContextPageNumber(match[2]);
		if (pageNumber && totalPages && pageNumber <= totalPages) return { pageNumber, source: "context-page-fraction" };
	}
	return null;
}

function inferPdfCurrentPageNumberFromBrowserContextDetails(details: any) {
	const directPage = normalizePdfContextPageNumber(
		details?.selection?.googleScholarReader?.pageNumber ??
			details?.visible?.pageNumber ??
			details?.visible?.currentPageNumber ??
			details?.visible?.page,
	);
	if (directPage) return { pageNumber: directPage, source: "context-page" };
	const text = browserContextPdfReaderText(details, 2000);
	const viewerPageParamMatch = text.match(/[?&]page=(\d{1,4})(?:[&#]|$)/i);
	if (viewerPageParamMatch) {
		const pageNumber = normalizePdfContextPageNumber(viewerPageParamMatch[1]);
		if (pageNumber) return { pageNumber, source: "viewer-url-page" };
	}
	const pageOfMatch = text.match(/\bpage\s+(\d{1,4})\s+(?:of|\/)\s+(\d{1,4})\b/i);
	if (pageOfMatch) {
		const pageNumber = normalizePdfContextPageNumber(pageOfMatch[1]);
		const totalPages = normalizePdfContextPageNumber(pageOfMatch[2]);
		if (pageNumber && totalPages && pageNumber <= totalPages) return { pageNumber, source: "context-page-fraction" };
	}
	const fractionPattern = /(?:^|[^\d])(\d{1,4})\s*\/\s*(\d{1,4})(?!\d)/g;
	let match: RegExpExecArray | null = null;
	while ((match = fractionPattern.exec(text))) {
		const pageNumber = normalizePdfContextPageNumber(match[1]);
		const totalPages = normalizePdfContextPageNumber(match[2]);
		if (pageNumber && totalPages && pageNumber <= totalPages) return { pageNumber, source: "context-page-fraction" };
	}
	return null;
}

function inferPdfVisualPageNumberFromBrowserContextDetails(details: any) {
	const currentPage = inferPdfCurrentPageNumberFromBrowserContextDetails(details);
	if (currentPage) return currentPage;
	const selectionPage = getSelectionPageNumber(details?.selection);
	if (selectionPage) return { pageNumber: selectionPage, source: "selection" };
	return null;
}

function inferPdfVisualPageNumberFromPdfHandoffResult(result: any) {
	if (!result || typeof result !== "object") return null;
	const directPage = normalizePdfContextPageNumber(
		result?.viewerReady?.pageNumber ?? result?.initialPageNumber ?? result?.selectionHandoff?.pageNumber ?? result?.pageNumber,
	);
	if (directPage) return { pageNumber: directPage, source: "pdf-handoff" };
	const viewerText = [result?.viewerUrl, result?.inlineViewer?.viewerUrl, result?.viewerReady?.viewerUrl].filter(Boolean).join("\n");
	const viewerPageParamMatch = viewerText.match(/[?&]page=(\d{1,4})(?:[&#]|$)/i);
	if (viewerPageParamMatch) {
		const pageNumber = normalizePdfContextPageNumber(viewerPageParamMatch[1]);
		if (pageNumber) return { pageNumber, source: "pdf-handoff-viewer-url" };
	}
	return null;
}

function shouldCapturePdfPageImageForPrompt(prompt: unknown, details?: any) {
	return Boolean(promptAsksAboutVisualRegion(prompt) && browserContextLooksLikePdf(details));
}

function textLooksLikePdfReaderSurface(text: unknown) {
	const value = String(text || "");
	if (!value) return false;
	if (/\bgoogle scholar(?:\s+pdf)?\s+reader\b/i.test(value)) return true;
	if (/\b(?:pdf\s+reader|pdf\s+viewer|built-in\s+viewer|native\s+pdf)\b/i.test(value)) return true;
	if (/chrome-extension:\/\/(?:dahenjhkoodjbpjheillcadbppiidmhp|mhjfbmdgcfjbbpaeojofohoefgiehjai)\b/i.test(value)) return true;
	if (/\b(?:AI Outline|Fit to width|Actual size|Highlights|Cite)\b/.test(value) && /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(value)) {
		return true;
	}
	return false;
}

function promptAsksForPageAnchors(text: string) {
	return textHasAny(
		text,
		/\b(?:highlights?|highlighting|annotat(?:e|ion|ions|ing)|notes?|marginalia|mark(?:ing)? up|anchor(?:ed|s|ing)?|citations?|cites?|evidence|supporting passage|show me where|point me to|where exactly)\b|\bwhere does\b[\s\S]{0,100}\b(?:discuss|say|mention|cover|define|explain)\b/,
	);
}

function promptAsksForTeachingPageSourceMarker(prompt: unknown) {
	const text = stripVoicePromptPrefix(prompt)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return false;
	const asksForTeaching =
		/\b(?:teach(?:\s+me)?|tutor|review|study|walk(?:\s+me)?\s+through|explain|summar(?:y|ies|i[sz]e)|overview|takeaways?|rundown)\b/.test(text);
	const referencesPageMaterial =
		/\b(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|passage|material|source)\b/.test(text) ||
		/\b(?:page|article|lecture|document|doc|reading|section|passage|material|source)\s+(?:says|covers|discusses|teaches|explains)\b/.test(text) ||
		/\bwhat\s+(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|passage|material|source)\s+says\b/.test(text);
	return asksForTeaching && referencesPageMaterial;
}

function normalizePageSourcePromptText(prompt: unknown) {
	return stripVoicePromptPrefix(prompt)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function promptReferencesCurrentPageMaterial(text: string) {
	if (!text) return false;
	return (
		/\b(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|passage|material|source|slide|deck|paper)\b/.test(text) ||
		/\b(?:on|in|from|according to)\s+(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|passage|material|source|slide|deck|paper)\b/.test(text) ||
		/\b(?:page|article|lecture|document|doc|reading|section|passage|material|source|slide|deck|paper)\s+(?:says|covers|discusses|teaches|explains|mentions|shows|derives|lists|calls|notes)\b/.test(text) ||
		/\bwhat\s+(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|passage|material|source|slide|deck|paper)\s+(?:says|means|shows|covers|teaches|explains)\b/.test(text)
	);
}

function promptAsksForStructuredPageSourceMarker(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text || !promptReferencesCurrentPageMaterial(text)) return false;
	return textHasAny(
		text,
		/\b(?:compare|comparison|contrast|versus|vs\.?|differ(?:ence|ences|ent)?|relate|relationship|agree|disagree)\b|\b(?:roadmap|outline|main\s+steps?|steps?|process|workflow|pipeline|sequence|progression|algorithm|methods?|approaches?|techniques?|list|table|pros\s+and\s+cons|limitations?|takeaways?)\b|\b(?:derive|derivation|proof|prove|show\s+why|how\s+(?:does|do|did)|why\s+(?:does|do|did)|explain\s+how|walk(?:\s+me)?\s+through)\b|\b(?:quiz\s+me|test\s+me|study\s+guide|practice\s+questions?|flashcards?|review\s+sheet)\b/,
	);
}

function promptAsksForCompactPageTeaching(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text || promptForbidsPageChanges(prompt)) return false;
	if (!promptAsksForTeachingPageSourceMarker(prompt)) return false;
	if (promptAsksForStructuredPageSourceMarker(prompt) || promptAsksForComparison(prompt)) return false;
	return !textHasAny(text, /\b(?:deep|detailed|thorough|exhaustive|section[-\s]?by[-\s]?section|every section|all sections|full walkthrough|complete walkthrough)\b/);
}

function promptAsksForComparison(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	return Boolean(text && /\b(?:compare|comparison|contrast|versus|vs\.?|differ(?:ence|ences|ent)?)\b/.test(text));
}

function promptAsksForSinglePageComparison(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text || !promptReferencesCurrentPageMaterial(text)) return false;
	return promptAsksForComparison(prompt);
}

function promptAllowsPageSourceHighlights(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text || promptForbidsPageChanges(prompt)) return false;
	return (
		promptAsksForPageAnchors(text) ||
		promptAsksForTeachingPageSourceMarker(prompt) ||
		promptAsksForStructuredPageSourceMarker(prompt) ||
		promptAsksForExternalBrowsing(text) ||
		promptAsksForLinkedPageNavigation(text)
	);
}

function promptRequiresPageSourceMarker(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	if (!text || promptForbidsPageChanges(prompt)) return false;
	return (
		promptAsksForPageAnchors(text) ||
		promptAsksForTeachingPageSourceMarker(prompt) ||
		promptAsksForStructuredPageSourceMarker(prompt) ||
		promptAsksForExternalBrowsing(text) ||
		promptAsksForLinkedPageNavigation(text)
	);
}

function promptAsksForPdfCorpusOrViewerWork(text: string) {
	return (
		textHasAny(
			text,
			/\b(?:pdfs?|pdf viewer|onhand viewer|native pdf|unsupported_pdf_surface|slides?|slide deck|lecture deck|page\s+\d+|pages?\s+\d+|read through|full pdf|whole pdf|entire pdf|offscreen|not visible|elsewhere|another part|other part|more detail|in detail|deeper|deep dive|analy(?:ze|sis)|break down|walk through|explain|people|authors?|entities|find|search|locat(?:e|ing)|where)\b/,
		) ||
		textHasAny(text, /\breferences?\b|\bcitations?\b|\bcited\b|\bbibliography\b|\[\d{1,3}\]/) ||
		promptAsksForPageAnchors(text)
	);
}

function promptLooksLikeQuickPdfSelectionAnswer(text: string) {
	const normalized = String(text || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized || normalized.length > 120) return false;
	if (promptAsksForPdfCorpusOrViewerWork(normalized)) return false;
	return textHasAny(
		normalized,
		/\b(?:what does (?:this|that|it) mean|what is this|define this|is this|does this|can this|yes or no|one[- ]sentence|one sentence|quick(?:ly)?|brief(?:ly)?)\b/,
	);
}

function shouldDeferPdfViewerForVisibleSelectionPrompt(prompt: unknown) {
	const text = String(prompt || "").toLowerCase();
	if (!promptReferencesVisiblePdfSelectionOrPage(text)) return false;
	return promptLooksLikeQuickPdfSelectionAnswer(text);
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
	const readerText = browserContextPdfReaderText(details);
	const visible = details?.visible || {};
	const selection = details?.selection || {};
	const blocks = Array.isArray(visible?.blocks) ? visible.blocks : [];
	return Boolean(
		isOnhandPdfViewerUrl(activeUrl) ||
			isLikelyPdfUrlForAutoHandoff(activeUrl) ||
			textLooksLikePdfReaderSurface(readerText) ||
			visible?.surface === "pdf" ||
			selection?.surface === "pdf" ||
			selection?.pdfAnchor?.surface === "pdf" ||
			selection?.viewer === "google-scholar" ||
			blocks.some((block: any) => block?.tag === "pdf-page" || block?.surface === "pdf"),
	);
}

function selectToolsForPrompt(
	allTools: AgentTool[],
	prompt: string,
	_attachments: any[] = [],
	learningMode = false,
	learnerState: unknown = null,
	options: {
		forcePdfTools?: boolean;
		advancedRuntimeInspectionEnabled?: boolean;
		suppressExtractContent?: boolean;
		selectionFirstPdfQuestion?: boolean;
		forceToolNames?: string[];
	} = {},
) {
	const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));
	const selected = new Set<string>();
	const text = String(prompt || "").toLowerCase();
	const explicitToolNames = new Set(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN) || []);
	const runtimeInspectionEnabled = options.advancedRuntimeInspectionEnabled !== false;
	const wantsAllPorts = /\ball (?:browser )?(?:ports|tools)\b|\bport smoke\b/.test(text);
	const pageChangePolicy = promptPageChangePolicy(prompt);
	const selectionFirstPdfQuestion = Boolean(options.selectionFirstPdfQuestion ?? (options.forcePdfTools && promptReferencesVisiblePdfSelectionOrPage(text)));
	const shouldDeferPdfViewerForQuickSelection = shouldDeferPdfViewerForVisibleSelectionPrompt(text);
	const deferPdfViewerForVisiblePdfSelection =
		selectionFirstPdfQuestion &&
		shouldDeferPdfViewerForQuickSelection &&
		!["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES].some((name) => explicitToolNames.has(name));
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
	const wantsExternalBrowsing = promptAsksForExternalBrowsing(text);
	const wantsLinkedPageNavigation = promptAsksForLinkedPageNavigation(text);
	const crossTabComparisonVerb = textHasAny(text, /\b(compare|comparison|contrast|versus|vs\.?|differ|difference|agree|disagree|relate)\b/);
	const explicitCrossTabComparisonTarget = textHasAny(
		text,
		/\b(?:other|another|both|two|2|multiple|several|all|across|open) (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b|\b(?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?) (?:i have |that are |currently )?open\b|\bthese (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b|\b(?:across|between) (?:tabs?|windows?|papers?|articles?|documents?|sources?|pages?)\b/,
	);
	const sourceOrNavigationPrompt = wantsExternalBrowsing || wantsLinkedPageNavigation || (crossTabComparisonVerb && explicitCrossTabComparisonTarget);

	if (wantsAllPorts) {
		add(selectableToolNames);
	} else {
		add(CORE_READ_TOOL_NAMES);
		add(ELEMENT_READ_TOOL_NAMES);
		add([...explicitToolNames]);
		add(Array.isArray(options.forceToolNames) ? options.forceToolNames : []);

		const needsFocusedReadableContext = promptNeedsFocusedReadableContext(text);
		const wantsDurableAnchors =
			promptAllowsPageSourceHighlights(prompt) ||
			learningMode ||
			needsFocusedReadableContext ||
			wantsExternalBrowsing ||
			wantsLinkedPageNavigation ||
			(crossTabComparisonVerb && explicitCrossTabComparisonTarget) ||
			explicitToolNames.has("browser_highlight_text") ||
			explicitToolNames.has("browser_show_note") ||
			explicitToolNames.has("browser_scroll_to_annotation") ||
			explicitToolNames.has("browser_clear_annotations");
		if (wantsDurableAnchors) {
			add(VISUAL_GROUNDING_TOOL_NAMES);
		}
		if (
			wantsExternalBrowsing ||
			wantsLinkedPageNavigation ||
			textHasAny(text, /\b(tab|tabs|window|windows|activate|switch|open|navigate|go to|take me to|url|across tabs|multiple tabs|all tabs)\b/) ||
			(crossTabComparisonVerb && explicitCrossTabComparisonTarget)
		) {
			add(TAB_TOOL_NAMES);
			add(ELEMENT_READ_TOOL_NAMES);
		}
		if (
			options.forcePdfTools ||
			promptAsksForPdfCorpusOrViewerWork(text)
		) {
			add(["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES]);
			add(PDF_ANNOTATION_TOOL_NAMES);
		}
		if (
			textHasAny(
				text,
				/\b(?:textbooks?|e-?books?|bookshelf|online book|reader|courseware|vitalsource|pearson|cengage|mcgraw|mheducation|redshelf|brytewave|perusall|zybooks|chapter|section)\b/,
			) &&
			textHasAny(
				text,
				/\b(?:search|find|where|mention|mentions|mentioned|covered|located|look up|look into|elsewhere|another part|other part|not loaded|not visible|across|entire book|whole book|book-wide)\b/,
			)
		) {
			add(READER_SEARCH_TOOL_NAMES);
			add(["browser_navigate"]);
		}
		if (promptAsksAboutVisualRegion(text)) {
			add(VISUAL_CONTEXT_TOOL_NAMES);
		}
		if (learningMode) {
			add(LEARNING_TOOL_NAMES);
		}
		if (wantsLinkedPageNavigation || textHasAny(text, /\b(click|type|fill|field|button|selector|form|press|pick|choose|wait for|input)\b/)) {
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
	const needsFocusedReadableContext = promptNeedsFocusedReadableContext(text);
	if (repeatedConcepts.length && !wantsAllPorts && !needsFocusedReadableContext) {
		for (const name of ["browser_extract_content", "browser_show_note"]) {
			if (!explicitToolNames.has(name)) selected.delete(name);
		}
	}
	if (pageChangePolicy.forbidsAllPageChanges) {
		for (const name of PAGE_CHANGE_TOOL_NAMES) selected.delete(name);
	} else {
		if (pageChangePolicy.forbidsHighlights) {
			selected.delete("browser_highlight_text");
			selected.delete("browser_scroll_to_annotation");
			selected.delete("browser_clear_annotations");
		}
		if (pageChangePolicy.forbidsNotes) selected.delete("browser_show_note");
	}
	const needsExactReadableContext = promptNeedsExactReadableContext(text);
	if (options.suppressExtractContent && !sourceOrNavigationPrompt && !explicitToolNames.has("browser_extract_content") && !needsExactReadableContext && !needsFocusedReadableContext) {
		selected.delete("browser_extract_content");
	}
	if (needsExactReadableContext && selected.has("browser_extract_content") && !explicitToolNames.has("browser_get_visible_text")) {
		selected.delete("browser_get_visible_text");
	}
	if (deferPdfViewerForVisiblePdfSelection && !options.forcePdfTools) {
		for (const name of PDF_TOOL_NAMES) {
			if (!explicitToolNames.has(name)) selected.delete(name);
		}
	}
	if (
		options.forcePdfTools &&
		selectionFirstPdfQuestion &&
		!promptAsksForExternalBrowsing(text) &&
		!promptAsksForLinkedPageNavigation(text)
	) {
		for (const name of ["browser_list_tabs", "browser_activate_tab", "browser_navigate"]) {
			if (!explicitToolNames.has(name) && !(Array.isArray(options.forceToolNames) && options.forceToolNames.includes(name))) selected.delete(name);
		}
	}
	if (!selected.size) add(CORE_READ_TOOL_NAMES);
	return allTools.filter((tool) => selected.has(tool.name));
}

function shouldIncludeToolInventory(prompt: string) {
	const text = String(prompt || "").toLowerCase();
	return Boolean(String(prompt || "").match(EXACT_TOOL_NAME_PATTERN)) || /\b(port smoke|ports?|tools?|debug(?:ging)?|diagnostic)\b/.test(text);
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
	existingAnchorContext = "",
	responseFormatRequirement = "",
	promptEvalLauncherAppend = "",
) {
	const attachmentContext = buildAttachmentContext(attachments);
	const toolInventory = buildToolInventory(prompt, tools);
	const learnerStateSummary = learningMode ? buildLearnerStatePromptSummary(learnerState, prompt) : "";
	const evalLauncherAppend = normalizePromptEvalAppend(promptEvalLauncherAppend);
	const availableToolNames = new Set((Array.isArray(tools) ? tools : []).map((tool) => tool.name));
	const hasTool = (name: string) => availableToolNames.has(name);
	const hasAnyTool = (names: string[]) => names.some((name) => availableToolNames.has(name));
	const linkedNavigationLine =
		hasTool("browser_click_text") || hasTool("browser_click")
			? "- Linked-note/resource requests are navigation tasks. If the user asks to open, check, or inspect notes, readings, links, resources, papers, or pages listed on the current page or a page used earlier in the session, recover an already-open index/master tab when needed, then use available tab/navigation/link tools to open the relevant linked pages before answering. Highlight the useful passages on the destination pages, not just the index/master page."
			: "- Linked-note/resource requests are navigation tasks. If the user asks to open, check, or inspect notes, readings, links, resources, papers, or pages listed on the current page or a page used earlier in the session, use available tab/navigation and element-discovery tools to open or inspect the relevant linked pages before answering. Highlight the useful passages on the destination pages, not just the index/master page.";
	const toolSpecificPolicyLines = [
		hasTool("browser_textbook_search")
			? "- For online textbook/ebook/reader pages where the current loaded section does not contain the requested topic, or the user asks about another part/the whole book, use browser_textbook_search first to search through the reader's own book-search UI. Do not manually click/type through the reader search UI unless browser_textbook_search is unavailable or reports unsupported. Read results first; open a result only when navigation is needed to answer. If browser_textbook_search returns openedResult.navigated=true, immediately use browser_extract_content once with the same or focused query on the opened page, then answer, highlight, and note from that opened content. Do not switch tabs, close search panels, call generic click/find/wait tools, or repeat book search just to verify this opened result. Use browser_navigate only to reload the current reader URL once if the reader itself is blank, stuck loading, or reports an error. For one explanatory textbook passage, prefer one contiguous highlight spanning the key supporting sentences and one note; do not split nearby sentences into multiple highlights unless the user asks for multiple source highlights."
			: "",
		hasAnyTool(["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES])
			? "- For selected/highlighted PDF questions, use selected text from captured context first. Chrome's native PDF viewer usually exposes selection through browser_get_selection, copy fallback, or debugger fallback, so do not blame Chrome's native viewer unless that is truly the active reader and those fallbacks failed. If tool output names Google Scholar PDF Reader, call it Google Scholar PDF Reader even when the tab URL itself is a direct PDF URL. If Google Scholar Reader or another third-party PDF reader blocks selected text, open the Onhand PDF viewer and ask the user to highlight the passage there only if selected text did not transfer. Recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions in the future. Open the Onhand PDF viewer when analysis, full-PDF search, offscreen context, exact page marking, or durable highlights/notes would improve the answer, and preserve the current page/selection when opening it. For current visible PDF figures/slides/equations/diagrams, use browser_pdf_capture_page_image and answer first; do not automatically search/read/highlight/note for a lightweight prompt such as 'try here' unless the user asks to mark/save/review it, asks where evidence is, or the answer needs a specific text passage. Do not treat selected named concepts, terms, section headings, formulas, or paper mechanisms as quick answers: search/read the explanatory PDF section, jump to the best page when useful, highlight the strongest supporting passage, add one short note under 280 characters, then answer. If the user accepts an offer to go deeper in a PDF with yes/please/similar, finish the search/read/jump/highlight/note workflow before answering. Never say you will highlight or add a note unless the corresponding tool call already succeeded."
			: "",
		hasAnyTool(VISUAL_CONTEXT_TOOL_NAMES)
			? "- For equations, charts, diagrams, figures, screenshots, or weak text extraction, use browser_get_visible_region_image or browser_pdf_capture_page_image to inspect the visible region. Visual claims must name the captured region and still use exact text highlights when text sources are needed or requested. If the user explicitly asks to highlight a formula/equation, call browser_highlight_text with the selected formula text or closest visible formula label; the page tool will use a block formula highlight when rendered math is involved. For explicit named formula/equation/theorem requests, locate that named formula or section first; do not substitute a nearby unrelated formula just because it is visible. If the named formula is not in the visible snapshot, call browser_extract_content once, then highlight the exact formula text or the nearest phrase that names the formula. For ordinary source grounding where rendered math extraction is collapsed or fragmented, prefer the nearby explanatory sentence, label, or caption instead of copying broken formula text."
			: "- For equations, charts, diagrams, figures, screenshots, or weak text extraction, use readable text first. If the user explicitly asks to highlight a formula/equation and highlighting is available, use the selected formula text or closest visible formula label; the page tool will use a block formula highlight when rendered math is involved. For explicit named formula/equation/theorem requests, locate that named formula or section first; do not substitute a nearby unrelated formula just because it is visible. If the named formula is not in the visible snapshot, call browser_extract_content once, then highlight the exact formula text or the nearest phrase that names the formula. If visual context is required but no visual capture tool is available, say what visual context is missing instead of guessing.",
		hasAnyTool(RUNTIME_JS_TOOL_NAMES)
			? "- browser_run_js is a last-resort runtime-state escape hatch for complex client-side pages. Use it only when explicitly requested or when readable text, DOM, screenshot, console, network, and selector tools cannot answer a dynamic/hidden-state question.\n- Keep browser_run_js read-only unless the user explicitly asks for page interaction. Do not use it to inspect cookies, local/session storage, authentication material, secrets, payment fields, or unrelated page data.\n- For DOM value checks with browser_run_js, read .value for form controls and .textContent or relevant ARIA attributes for ordinary elements. Do not use getComputedStyle(...).content unless the user asks about CSS-generated content."
			: "",
	].filter(Boolean);
	return [
		"The user invoked Onhand from the browser extension side panel.",
		...(recentConversation ? ["", "Recent conversation, summarized:", recentConversation] : []),
		...(existingAnchorContext ? ["", existingAnchorContext] : []),
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
		...(responseFormatRequirement ? [responseFormatRequirement, ""] : []),
		"Use this captured context as your starting point. Prefer current and already-open pages over navigation.",
		"Constitution runtime contract:",
		"- Do page work before chat: anchor the answer with a source highlight on the supporting text (skip only for no-page-changes requests, quick visual questions, or when the page does not support the claim). Add more highlights, notes, and scroll to existing highlights when the user asks for annotations, evidence location, learning/review source markers, source-navigation work, or a page-level teaching/review summary.",
		"- Page-material claims need page grounding. Use captured/readable page context for simple answers; use exact highlights and short notes for major claims only when durable source highlights are useful or requested.",
		"- External-source requests are navigation tasks. If the user asks to search online, use Google/web sources, open URLs, or take them to sources, use available tab/navigation tools first and then ground claims on the destination source pages.",
		linkedNavigationLine,
			"- Grounding budget: simple questions get one strong source highlight and a short answer. Broad teach/review/walkthrough/summarize requests need one to three durable explanatory source highlights for the central concepts, with at most one short note unless the user explicitly asks for notes. Do not use the page title, course title, reading list, or a generic heading as a source marker; prefer definitions, mechanisms, or conclusions over motivation-only contrasts unless the contrast is the whole answer. If only one highlight succeeds, keep the answer focused on that highlighted passage instead of writing a broad unsupported page summary. Roadmap/list/navigation questions are not simple when the answer names multiple items, but notes should still be sparse.",
		"- Quick visual questions such as what a figure, diagram, chart, equation, screenshot, slide, or visible PDF page shows should usually stay sidebar-only after visual capture. Do not automatically add a note for these quick visual explanations. If durable context is useful, prefer a caption/supporting-text highlight; add a note only when it adds future replay value. This does not reduce notes for learning, review, evidence-location, source-navigation, comparison, or deeper conceptual workflows.",
		"- Add short interpretive notes only where they add future replay value; name the passage's role or explain the hard step under 280 characters, but do not paraphrase the highlight. Do not add a note for every highlight. Put longer detail in chat.",
		"- Write for the narrow side panel: use short paragraphs, compact labels, bullets, or numbered steps for diagrams, processes, comparisons, lists, and multi-part ideas. Do not use Markdown tables unless the user explicitly asks for a table; use compact labeled bullets instead. Do not use horizontal rules like --- as section separators. For broad teaching/review summaries, avoid display equations unless the user asks for formula details; explain the relationship in prose when extracted math is dense or fragile. Do not add long unhighlighted 'other topics' or method-roadmap lists; offer to expand instead. For visual explanations, labels like What it shows, How to read it, and Takeaway are preferred when useful.",
		"- Failed highlight attempts are not source markers. Retry once with a smaller exact visible span, or leave that claim out of the answer.",
		"- If the captured context already includes the needed text, answer from it and avoid extra read or annotation tools unless the user asked for highlights/citations or the request is a page-level teaching/review summary.",
			"- Source-thorough path: if the question has distinct subclaims or asks for support/evidence, highlight each key point you actually explain; do not add extra highlights just to increase source count. For comparison prompts, usually create two concise source highlights, one for each side, plus one short marginal note on the practical difference or takeaway; add at most one direct contrast/conclusion highlight when the page states it. For roadmap/list/process/derivation/proof prompts, mark every required top-level item before child/subtopic items; do not silently drop required items that the page contains. Do not highlight full algorithms or every sub-step unless asked. Keep the answer concise.",
		"- Roadmap/list/navigation answers need the actual supporting list or linked items, not a heading-only highlight. Each named step/item in chat needs its own source highlight, or one highlighted source list/table/span that literally contains every named item. If a required item cannot be highlighted after retry but readable page context supports it, say the marker could not be placed instead of silently omitting it.",
		"- For list-shaped visible/readable text, highlight the exact item words one item at a time. Treat Markdown bullets and heading markers in tool output as structure cues, not part of the page text to quote.",
		"- If a page-wide list appears partial in the visible snapshot, use browser_extract_content once before answering. Do not substitute nearby headings for missing list items.",
		"- If the user asks about a named section, heading, phrase, table, row, value, tensor, or item that is not in the visible snapshot, use browser_extract_content once before saying it is missing, not visible, or asking the user to scroll. A visible-text-only read is not enough to rule out offscreen page content.",
		"- Do not call browser_extract_content more than once unless the first result is unusable.",
		"- For online textbook/ebook/reader pages where the current loaded section does not contain the requested topic, or the user asks about another part/the whole book, use browser_textbook_search first to search through the reader's own search UI. Do not manually click/type through the reader search UI unless browser_textbook_search is unavailable or reports unsupported. Read results first; open a result only when navigation is needed to answer. If browser_textbook_search returns openedResult.navigated=true, immediately use browser_extract_content once with the same or focused query on the opened page, then answer, highlight, and note from that opened content. Do not switch tabs, close search panels, call generic click/find/wait tools, or repeat book search just to verify the opened result. Use browser_navigate only to reload the current reader URL once if the reader itself is blank, stuck loading, or reports an error. For one explanatory textbook passage, prefer one contiguous highlight spanning the key supporting sentences and one note; do not split nearby sentences into multiple highlights unless the user asks for multiple source highlights.",
		"- For selected/highlighted PDF questions, use selected text from captured context first. Chrome's native PDF viewer usually exposes selection through browser_get_selection, copy fallback, or debugger fallback, so do not blame Chrome's native viewer unless that is truly the active reader and those fallbacks failed. If tool output names Google Scholar PDF Reader, call it Google Scholar PDF Reader even when the tab URL itself is a direct PDF URL. If Google Scholar Reader or another third-party PDF reader blocks selected text, open the Onhand PDF viewer and ask the user to highlight the passage there only if selected text did not transfer. Recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions in the future. Open the Onhand PDF viewer when analysis, full-PDF search, offscreen context, exact page marking, or durable highlights/notes would improve the answer, and preserve the current page/selection when opening it. For current visible PDF figures/slides/equations/diagrams, use browser_pdf_capture_page_image and answer first; do not automatically search/read/highlight/note for a lightweight prompt such as 'try here' unless the user asks to mark/save/review it, asks where evidence is, or the answer needs a specific text passage. Do not treat selected named concepts, terms, section headings, formulas, or paper mechanisms as quick answers: search/read the explanatory PDF section, jump to the best page when useful, highlight the strongest supporting passage, add one short note under 280 characters, then answer. If the user accepts an offer to go deeper in a PDF with yes/please/similar, finish the search/read/jump/highlight/note workflow before answering. Never say you will highlight or add a note unless that tool call already succeeded.",
			"- For equations, charts, diagrams, figures, screenshots, or weak text extraction, use browser_get_visible_region_image or browser_pdf_capture_page_image to inspect the visible region. Visual claims must name the captured region and still use exact text highlights when text sources are needed or requested. If the user explicitly asks to highlight a formula/equation, call browser_highlight_text with the selected formula text or closest visible formula label; the page tool will use a block formula highlight when rendered math is involved. For explicit named formula/equation/theorem requests, locate that named formula or section first; do not substitute a nearby unrelated formula just because it is visible. If the named formula is not in the visible snapshot, call browser_extract_content once, then highlight the exact formula text or the nearest phrase that names the formula. For ordinary source grounding where rendered math extraction is collapsed or fragmented, prefer the nearby explanatory sentence, label, or caption instead of copying broken formula text.",
		"- If a visual answer cannot be tied to text or a captured visible region, say what visual context is missing instead of guessing.",
			"- If no reliable source highlight is available, say what is missing instead of presenting unsupported page claims.",
			"- Do not use the word 'anchor' in user-facing replies unless the user used it first. Never write filler like 'let me anchor this', 'let me ground this', 'highlighted above', or 'I highlighted'; perform the tool work silently, then teach from the result.",
				"- Math must be renderable markdown: wrap inline LaTeX in $...$ and block equations in $$...$$. Do not write bare LaTeX commands like \\cdot, \\sqrt, \\frac, or \\text{} in normal prose or list items. If extracted page math is fragmented or missing operators, do not copy it verbatim into chat or source highlights; either rewrite a clean formula only when the intended formula is clear from context, or explain the relationship in words.",
			"- browser_run_js is a last-resort runtime-state escape hatch for complex client-side pages. Use it only when explicitly requested or when readable text, DOM, screenshot, console, network, and selector tools cannot answer a dynamic/hidden-state question.",
		"- Keep browser_run_js read-only unless the user explicitly asks for page interaction. Do not use it to inspect cookies, local/session storage, authentication material, secrets, payment fields, or unrelated page data.",
		"- For DOM value checks with browser_run_js, read .value for form controls and .textContent or relevant ARIA attributes for ordinary elements. Do not use getComputedStyle(...).content unless the user asks about CSS-generated content.",
		...toolSpecificPolicyLines,
		...(evalLauncherAppend ? ["", "Temporary prompt-eval launcher policy candidate:", evalLauncherAppend] : []),
		...(toolInventory ? ["", "Available browser tools for this request:", toolInventory] : []),
		"Use Markdown structure when it improves sidebar readability; keep emphasis itself sparse and meaningful. Avoid Markdown tables unless explicitly requested.",
		...(learningMode ? ["", ONHAND_LEARNING_MODE_APPEND] : []),
	]
		.filter((line, index, lines) => {
			if (typeof line !== "string") return true;
			if (toolSpecificPolicyLines.includes(line)) return lines.lastIndexOf(line) === index;
			return !(
				line.includes("browser_textbook_search first") ||
				line.includes("For selected/highlighted PDF questions") ||
				line.includes("For equations, charts, diagrams, figures") ||
				line.includes("browser_run_js is a last-resort") ||
				line.includes("Keep browser_run_js read-only") ||
				line.includes("For DOM value checks with browser_run_js")
			);
		})
		.join("\n");
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
		"- If a visible-region image is attached, use it only for the visual part of the move and keep the page reference tied to exact text when exact text is available.",
		"- If the visual region is necessary but no exact text source is available, set anchor.kind to visual_region and make voice_script ask the student to identify or select the relevant visual part instead of inventing an explanation.",
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
		"- If feedback depends on an attached visible-region image, refer to the visual region explicitly and avoid unsupported claims when the image or text source is insufficient.",
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
	if (!text) return "No PDF page text returned.";
	return [
		`PDF page text:\n${truncateStructuredText(text, 8000)}`,
		"Next step: if you answer from this offscreen/deeper PDF text, call browser_highlight_text with an exact supporting passage from these pages, then call browser_show_note with one short note under 280 characters before replying. Do not say the answer is highlighted or sourced unless those calls succeed.",
	].join("\n\n");
}

function extractToolResultGuardrail(result: any) {
	if (!result || typeof result !== "object") return null;
	const details = Object.prototype.hasOwnProperty.call(result, "details") ? result.details : result;
	if (details && typeof details === "object" && (details as any).guardrail) return (details as any).guardrail;
	return null;
}

function toolResultTextForModel(toolName: string, result: any) {
	const details = result?.details || result || {};
	const tab = details.tab || null;
	const guardrail = extractToolResultGuardrail(result);
	if (guardrail?.message) {
		return `Guardrail blocked ${guardrail.blockedTool || toolName}: ${String(guardrail.message)}`;
	}
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
				const selection = details.selectionHandoff || {};
				const selectedText =
					selection.ok && selection.text
						? `\nTransferred selected text${selection.pageNumber ? ` (p. ${selection.pageNumber})` : ""}:\n${truncate(String(selection.text || ""), 1200)}`
						: selection.ok === false && selection.error
							? `\nPDF selection handoff failed: ${truncate(String(selection.error || ""), 300)}`
							: "";
				return `${alreadyOpen} PDF in Onhand viewer: ${formatCompactTab(tab)}${pdfUrl}${selectedText}`;
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
			const warnings = [];
			if (region.clipped) warnings.push(`Warning: the selector region was clipped by the viewport; visible ratio ${Math.round(Number(region.visibleRatio || 0) * 100)}%.`);
			if (region.smallRegion || Number(region.width || 0) < 120 || Number(region.height || 0) < 120) {
				warnings.push("Warning: the captured region is very small and may not contain the requested figure, plot, or diagram.");
			}
			return [
				`Captured visible region image from ${formatCompactTab(tab)}.`,
				`Region: ${label}; ${region.width || "?"}x${region.height || "?"} CSS px at ${region.x || 0},${region.y || 0}; viewport ${viewport.width || "?"}x${viewport.height || "?"}.`,
				...warnings,
				"Use this image for visual grounding only; cite exact page text too when text is available.",
			].join("\n");
		}
		case "browser_extract_content": {
			const content = details.content || details.extracted || {};
			const rawText = typeof content === "string" ? content : content.markdown || content.text || content.reason || "";
			const text = String(rawText || "").trim();
			const heading = `Readable content from ${formatCompactTab(tab || content)}:`;
			const outlineText =
				typeof content.headingOutlineMarkdown === "string"
					? content.headingOutlineMarkdown.trim()
					: Array.isArray(content.headingOutline)
						? content.headingOutline.map((entry: any) => String(entry?.markdown || entry?.text || "").trim()).filter(Boolean).join("\n")
						: "";
			const outline = outlineText ? `Page heading outline with section snippets:\n${truncateStructuredText(outlineText, 12000)}\n\n` : "";
			const truncationNote = content.truncated ? "\n\n(Note: readable body excerpt was truncated; use the heading outline to notice later sections.)" : "";
			const frameSource =
				content.source === "debugger-frame-readable-content"
					? `Source frame: ${[content.frameTitle || content.title, content.contextOrigin || content.frameUrl].filter(Boolean).join(" · ")}.\n`
					: "";
			return text
				? `${heading}\n${frameSource}${outline}Readable body excerpt:\n${truncateStructuredText(text, 8000)}${truncationNote}`
				: `${heading}\n${frameSource}${outline || "(No readable content returned.)"}`;
		}
		case "browser_textbook_search": {
			const search = details.search || details || {};
			const adapter = search.adapter?.name || "generic-reader";
			const resultCount = Array.isArray(search.results) ? search.results.length : Number(search.resultCount || 0) || 0;
			const totalResultCount = Number(search.totalResultCount || 0) || 0;
			const status = search.ok ? "Reader search" : "Reader search unavailable";
			const countLabel =
				totalResultCount > resultCount
					? `${resultCount} shown, ${totalResultCount} total`
					: `${resultCount} result${resultCount === 1 ? "" : "s"}`;
			const header = `${status} for ${JSON.stringify(search.query || "")} on ${formatCompactTab(tab || search)}: ${countLabel} (${adapter}).`;
			const reason = !search.ok && search.reason ? `\nReason: ${truncate(search.reason, 240)}` : "";
			const controls = search.searchControl?.label ? `\nSearch control: ${truncate(search.searchControl.label, 160)}` : "";
			const lines = (Array.isArray(search.results) ? search.results : [])
				.slice(0, 8)
				.map((result: any) => {
					const page = result.pageLabel ? ` ${result.pageLabel}` : "";
					const title = result.title ? truncate(result.title, 140) : "Untitled result";
					const snippet = result.snippet ? ` — ${truncate(result.snippet, 220)}` : "";
					return `${result.index || "?"}. ${title}${page}${snippet}`;
				});
			const opened = search.openedResult
				? `\nOpened result ${search.openedResult.index || "?"}: ${truncate(search.openedResult.title || "", 160)}${search.openedResult.navigated ? `\nCurrent reader URL: ${search.openedResult.afterUrl || search.url || ""}\nNext step: use browser_extract_content once with a focused query on this opened reader page, then answer or annotate from that content. Do not switch tabs, close search panels, manually click results, or repeat the reader search to verify this opened result.` : "\nThe result did not navigate the reader."}`
				: "";
			return `${header}${reason}${controls}${lines.length ? `\nResults:\n${lines.join("\n")}` : ""}${opened}`;
		}
			case "browser_get_selection": {
				const selection = details.selection || {};
				const selectionText = getSelectionText(selection);
				const sourceLabel = getSelectionSourceLabel(selection);
				const diagnostics = [
					formatReaderFrameFallbackForModel(selection),
					formatPdfSelectionFallbackForModel(selection),
					formatGoogleDocsSelectionFallbackForModel(selection),
				].filter(Boolean).join("\n");
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
			const message = String(headings.message || headings.reason || "").trim();
			return [current, nearby ? `Nearby headings:\n${nearby}` : "", message].filter(Boolean).join("\n");
		}
		case "browser_get_scroll_state": {
			const scroll = details.scroll || {};
			const progress = typeof scroll.progressY === "number" ? `${Math.round(scroll.progressY * 100)}%` : "(unknown)";
			return `Scroll state for ${formatCompactTab(tab || scroll)}: y=${scroll.scrollY ?? "?"}/${scroll.maxScrollY ?? "?"}, progress=${progress}, atTop=${Boolean(scroll.atTop)}, atBottom=${Boolean(scroll.atBottom)}`;
		}
		case "browser_highlight_text": {
			if (details.guardrail?.message) return String(details.guardrail.message);
			const annotationId = details.annotation?.annotationId || "(unknown annotation)";
			const matchedText = details.annotation?.matchedText || details.annotation?.text || "the requested text";
			const fallback = details.highlightRetry?.originalText
				? " Original highlight text did not match as one visible span; only this smaller item is highlighted."
				: "";
			return `Highlighted ${JSON.stringify(truncate(matchedText, 500))} on ${formatCompactTab(tab)}. annotationId: ${annotationId}.${fallback}`;
		}
		case "browser_show_note": {
			if (details.guardrail?.message) return String(details.guardrail.message);
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

function traceTimeMs(trace: any, key: "startedAt" | "endedAt" = "endedAt") {
	const value = Date.parse(String(trace?.[key] || trace?.startedAt || ""));
	return Number.isFinite(value) ? value : 0;
}

function traceDetails(trace: any) {
	return trace && typeof trace === "object" && trace.resultDetails && typeof trace.resultDetails === "object" ? trace.resultDetails : {};
}

function findReadyPdfSelectionHandoffFromTraces(traces: unknown) {
	const entries = Array.isArray(traces) ? traces : [];
	for (const trace of entries.slice().reverse()) {
		if (!trace || typeof trace !== "object") continue;
		const toolName = String((trace as any).toolName || "");
		if ((trace as any).state !== "complete") continue;
		if (toolName !== "browser_open_pdf_in_onhand_viewer" && toolName !== "browser_get_selection") continue;
		const details = traceDetails(trace);
		const selectionCandidates = [
			details.selectionHandoff,
			details.selection,
			details.selectionHandoff?.pdfAnchor,
			details.selectionHandoff?.pdfAnchor?.textQuote,
			details.selection?.pdfAnchor,
			details.selection?.pdfAnchor?.textQuote,
		];
		for (const candidate of selectionCandidates) {
			const text =
				getSelectionText(candidate) ||
				(candidate && typeof candidate === "object" && typeof (candidate as any).matchedText === "string" ? (candidate as any).matchedText.trim() : "") ||
				(candidate && typeof candidate === "object" && typeof (candidate as any).exact === "string" ? (candidate as any).exact.trim() : "");
			if (!text) continue;
			const pageNumber = getSelectionPageNumber(candidate) || getSelectionPageNumber(details.selectionHandoff) || getSelectionPageNumber(details.selection);
			return {
				text,
				pageNumber,
				toolName,
			};
		}
		const summary = String((trace as any).resultSummary || "");
		const summaryMatch = summary.match(/Transferred selected text(?:\s+\(p\.\s*(\d+)\))?:\s*([\s\S]+)/i);
		if (summaryMatch) {
			const text = summaryMatch[2].trim();
			if (text) {
				const pageNumber = Number(summaryMatch[1] || 0);
				return {
					text,
					pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null,
					toolName,
				};
			}
		}
	}
	return null;
}

function isLikelyTextbookReaderUrl(value: unknown) {
	return /\b(vitalsource|bookshelf|jigsaw|pearson|cengage|mcgraw|mheducation|redshelf|brytewave|perusall|zybooks|courseware|ebook|textbook|reader)\b/i.test(
		String(value || ""),
	);
}

function findReadyTextbookContextFromTraces(traces: unknown) {
	const entries = Array.isArray(traces) ? traces : [];
	const openedTrace = entries
		.slice()
		.reverse()
		.find((trace: any) => {
			const details = traceDetails(trace);
			const search = details.search || details;
			return trace?.toolName === "browser_textbook_search" && trace?.state === "complete" && search?.openedResult?.navigated === true;
		});
	if (!openedTrace) return null;
	const openedAt = traceTimeMs(openedTrace);
	const openedDetails = traceDetails(openedTrace);
	const openedSearch = openedDetails.search || openedDetails;
	const bodyExtractTrace = entries
		.filter((trace: any) => traceTimeMs(trace) >= openedAt)
		.slice()
		.reverse()
		.find((trace: any) => {
			const details = traceDetails(trace);
			const content = details.content || details.extracted || {};
			const text = String(content.markdown || content.text || "").replace(/\s+/g, " ").trim();
			return trace?.toolName === "browser_extract_content" && trace?.state === "complete" && content.source === "debugger-frame-readable-content" && text.length >= 200;
		});
	if (!bodyExtractTrace) return null;
	const extractDetails = traceDetails(bodyExtractTrace);
	const content = extractDetails.content || extractDetails.extracted || {};
	return {
		openedTrace,
		bodyExtractTrace,
		tab: extractDetails.tab || openedDetails.tab || null,
		search: openedSearch,
		openedResult: openedSearch.openedResult || null,
		content,
	};
}

function buildTextbookContextReadyGuardResult(toolName: string, commandName: string, params: any, traces: unknown) {
	const ready = findReadyTextbookContextFromTraces(traces);
	if (!ready) return null;
	const blockedReadCommands = new Set([
		"textbook_search",
		"extract_content",
		"get_visible_text",
		"get_viewport_headings",
		"get_scroll_state",
		"find_elements",
		"click_text",
		"click",
		"wait_for_selector",
		"pdf_search",
		"pdf_read_pages",
		"pdf_jump_to_page",
		"pdf_capture_page_image",
		"get_visible_region_image",
	]);
	const shouldBlockNavigation = commandName === "navigate" && isLikelyTextbookReaderUrl(params?.url);
	if (!blockedReadCommands.has(commandName) && !shouldBlockNavigation) return null;
	const sourceName = [ready.content?.frameTitle || ready.content?.title, ready.content?.contextOrigin || ready.content?.frameUrl].filter(Boolean).join(" · ");
	const openedTitle = ready.openedResult?.title ? ` Opened result: ${truncate(String(ready.openedResult.title), 160)}.` : "";
	return {
		tab: ready.tab,
		guardrail: {
			kind: "textbook_context_ready",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"Textbook context is already ready from an opened reader search result and a readable body-frame extraction.",
				sourceName ? `Source frame: ${sourceName}.` : "",
				openedTitle,
				`Do not call ${toolName} again for this textbook lookup.`,
				"Answer now from the readable body excerpt already returned. If the user requested annotations, call browser_highlight_text with exact text from that excerpt, then browser_show_note.",
			]
				.filter(Boolean)
				.join(" "),
		},
		textbookContext: {
			query: ready.search?.query || params?.query || "",
			openedResult: ready.openedResult,
			content: {
				title: ready.content?.frameTitle || ready.content?.title || "",
				source: ready.content?.source || "",
				frameUrl: ready.content?.frameUrl || ready.content?.url || "",
			},
		},
	};
}

function buildVisiblePdfSelectionFirstPassGuardResult(
	toolName: string,
	commandName: string,
	prompt: unknown,
	isFirstPassPdfSelectionQuestion: boolean,
	traces: unknown = [],
) {
	if (!isFirstPassPdfSelectionQuestion) return null;
	const text = String(prompt || "").toLowerCase();
	const shouldDeferViewer = shouldDeferPdfViewerForVisibleSelectionPrompt(text);
	if (promptAsksForPdfCorpusOrViewerWork(text) && !shouldDeferViewer && commandName !== "navigate") return null;
	const readySelection = findReadyPdfSelectionHandoffFromTraces(traces);
	const alwaysBlockedCommands = new Set(["navigate"]);
	const quickAnswerBlockedCommands = new Set([
		"clear_annotations",
	]);
	if (readySelection) quickAnswerBlockedCommands.add("open_pdf_in_onhand_viewer");
	const blocked =
		alwaysBlockedCommands.has(commandName) ||
		(shouldDeferViewer && quickAnswerBlockedCommands.has(commandName));
	if (!blocked) return null;
	const selectionText = readySelection?.text ? truncate(String(readySelection.text), 240) : "";
	const pageText = readySelection?.pageNumber ? ` on page ${readySelection.pageNumber}` : "";
	return {
		guardrail: {
			kind: "visible_pdf_selection_first_pass",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"This is a first-pass question about selected or highlighted text in the currently visible PDF.",
				selectionText ? `The selected PDF text is already available${pageText}: "${selectionText}".` : "",
				`Do not call ${toolName} for a quick selected-text answer unless the user asks for offscreen search, deeper PDF reading, page marking, notes, or annotations.`,
				"Use the selected text, copied selection, or visible text from the current reader first when that context is available.",
				"If selected text has already been captured or transferred into the Onhand PDF viewer, answer now from that selected text and its visible page context.",
				"Do not say you are stuck, ask the user to scroll, or chase another section just because deeper PDF tools are unnecessary or blocked for this quick selected-text answer.",
				"If Google Scholar Reader or another third-party PDF reader blocks selected text, open the PDF in Onhand's PDF viewer and ask the user to highlight there only if selected text does not transfer. Recommend Chrome's default PDF viewer or the Onhand viewer for smoother selected-text questions. Do not describe Chrome's native PDF viewer as blocking selection unless the active reader is actually Chrome's native PDF viewer and selection/copy fallbacks failed.",
			]
				.filter(Boolean)
				.join(" "),
		},
	};
}

function buildSurplusHighlightGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForSinglePageComparison(prompt)) return null;
	const highlightCount = completedSourceHighlightCount(request);
	if (highlightCount < 2) return null;
	if (highlightCount >= COMPARISON_SOURCE_HIGHLIGHT_MAX) {
		return {
			guardrail: {
				kind: "surplus_comparison_highlight",
				blockedTool: toolName,
				blockedCommand: commandName,
				message: [
					`${highlightCount} comparison source highlights already succeeded, which is enough for this compare/contrast answer.`,
					`Do not call ${toolName} again for this turn unless the user explicitly asks for more evidence.`,
					hasCompletedToolTrace(request, "browser_show_note")
						? "Answer now from the existing comparison highlights. Keep the comparison concise."
						: "If one note would clarify the practical difference, add one short browser_show_note under 280 characters; otherwise answer now from the existing comparison highlights.",
				].join(" "),
			},
		};
	}
	const comparisonEntities = extractComparisonEntities(prompt);
	if (comparisonEntities.length >= 2) {
		const citations = completedSourceHighlightCitations(request);
		const covered = comparisonEntities.filter((entity) =>
			citations.some((citation) => sourceCitationProvidesExplanatoryComparisonSupport(citation, entity)),
		).length;
		if (covered < Math.min(2, comparisonEntities.length)) return null;
	}
	return {
		guardrail: {
			kind: "surplus_comparison_highlight",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"Two comparison source highlights already succeeded, which is enough for this compare/contrast answer.",
				`Do not call ${toolName} again for this comparison unless the user explicitly asks for more evidence.`,
				hasCompletedToolTrace(request, "browser_show_note")
					? "Answer now from the existing comparison highlights. Keep the comparison concise."
					: "If one highlight captures the practical difference, add one short browser_show_note under 280 characters to that highlight; otherwise answer now from the existing comparison highlights. Keep the comparison concise.",
			].join(" "),
		},
	};
}

function buildEmptyHighlightTextGuardResult(toolName: string, commandName: string, params: any) {
	if (commandName !== "highlight_text") return null;
	if (String(params?.text || "").trim()) return null;
	return {
		guardrail: {
			kind: "empty_highlight_text",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"browser_highlight_text requires a non-empty exact visible or readable text span.",
				`Do not call ${toolName} with empty text.`,
				"Use a short exact heading, phrase, or sentence from browser_extract_content or browser_get_visible_text, then retry if a source marker is still needed.",
			].join(" "),
		},
	};
}

function isSectionNumberOnlyHighlightText(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	if (!text) return false;
	if (/\p{L}/u.test(text)) return false;
	return /^(?:§\s*)?(?:[0-9]+|[ivxlcdm]+)(?:\.[0-9ivxlcdm]+)*\.?$/i.test(text);
}

function promptAsksForDerivationOrProofSourceMarker(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	return Boolean(
		text &&
			promptAsksForStructuredPageSourceMarker(prompt) &&
			textHasAny(text, /\b(?:derive|derivation|proof|prove|show\s+why|how\s+(?:does|do|did)|explain\s+how|walk(?:\s+me)?\s+through)\b/),
	);
}

function looksLikeHeadingOnlyHighlightText(value: unknown) {
	const text = compactActionText(value).replace(/[¶#]+/g, "").trim();
	if (!text) return false;
	if (isSectionNumberOnlyHighlightText(text)) return true;
	if (/[.!?]\s*$/.test(text)) return false;
	const words = entityWords(text);
	if (words.length < 2 || words.length > 8) return false;
	const hasVerb = /\b(?:is|are|was|were|means|shows|uses|treats|samples?|draws?|converts?|provides?|returns?|takes?|allows?|works?|captures?|represents?|defines?|explains?|derives?|equals?|starts?|divid(?:e|es|ing)|substitut(?:e|es|ing))\b/i.test(text);
	if (hasVerb) return false;
	return /^[\p{Lu}\p{N}]/u.test(text);
}

function buildWeakStructuredHighlightTextGuardResult(toolName: string, commandName: string, params: any, prompt: unknown) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForStructuredPageSourceMarker(prompt)) return null;
	const sectionNumberOnly = isSectionNumberOnlyHighlightText(params?.text);
	const headingOnlyDerivation =
		!sectionNumberOnly && promptAsksForDerivationOrProofSourceMarker(prompt) && looksLikeHeadingOnlyHighlightText(params?.text);
	if (!sectionNumberOnly && !headingOnlyDerivation) return null;
	return {
		guardrail: {
			kind: "weak_structured_highlight_text",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: sectionNumberOnly
				? [
						"That browser_highlight_text span is only a section number, so it is too weak to support a structured roadmap/list/comparison item.",
						`Do not call ${toolName} with only a section number.`,
						"Retry with exact visible section-title text that includes the item name, or with the first explanatory sentence/list item under that section.",
						"If no stronger exact span is available, omit that item from the chat answer.",
					].join(" ")
				: [
						"That browser_highlight_text span is only a heading, so it is too weak to support a derivation/proof/explanation answer.",
						`Do not call ${toolName} with only the heading for this answer.`,
						"Retry with exact explanatory text, equation text, or a sentence under that heading that states the derivation step.",
						"If no stronger exact span is available, answer from readable content without claiming the heading is a source marker.",
					].join(" "),
		},
	};
}

function looksLikeWeakCompactTeachingHighlightText(value: unknown, request: any) {
	const text = compactActionText(value);
	if (!text) return true;
	if (text.length > 260) return true;
	const normalized = normalizeEntityText(text);
	const title = normalizeEntityText(request?.initialActiveTab?.title || "");
	if (title && normalized === title) return true;
	const words = entityWords(text);
	const hasVerb = /\b(?:is|are|means|shows|uses|treats|samples?|draws?|converts?|provides?|returns?|takes?|allows?|works?|captures?|represents?|defines?|explains?)\b/i.test(text);
	if (words.length <= 10 && !hasVerb && /[:|&–—-]/.test(text)) return true;
	return false;
}

function buildWeakCompactTeachingHighlightGuardResult(toolName: string, commandName: string, params: any, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForCompactPageTeaching(prompt)) return null;
	if (!looksLikeWeakCompactTeachingHighlightText(params?.text, request)) return null;
	return {
		guardrail: {
			kind: "weak_compact_teaching_highlight",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"That source marker is too weak for a compact teaching answer: it is empty, too long, or title/heading-like.",
				`Do not call ${toolName} with page titles, generic headings, or large blocks of text.`,
				"Retry with one short exact explanatory sentence or phrase that states the central definition, mechanism, or conclusion for the user's topic.",
			].join(" "),
		},
	};
}

function stripTrailingPageQualifier(value: string) {
	return String(value || "")
		.replace(/\b(?:on|in|from|according to)\s+(?:this|the|current)\s+(?:page|article|lecture|document|doc|reading|section|source|slide|paper)\b[\s\S]*$/i, "")
		.replace(/\b(?:on|in|from)\s+(?:this|the|current)\b[\s\S]*$/i, "")
		.trim();
}

function cleanComparisonEntity(value: unknown) {
	return compactEntity(
		String(value || "")
			.replace(/\b(?:compare|comparison|contrast|versus|vs\.?|differences?|different|between|with|to|and|or|the|this|current|page|article|lecture|document|source)\b/gi, " ")
			.replace(/[?!.,:;()[\]{}"“”]+/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function extractComparisonEntities(prompt: unknown) {
	const text = stripTrailingPageQualifier(String(prompt || "").replace(/\s+/g, " ").trim());
	const patterns = [
		/\bbetween\s+(.+?)\s+and\s+(.+)$/i,
		/\bcompare\s+(.+?)\s+(?:and|with|to|vs\.?|versus)\s+(.+)$/i,
		/\bcontrast\s+(.+?)\s+(?:and|with|to|vs\.?|versus)\s+(.+)$/i,
		/\bdifferences?\s+(?:between\s+)?(.+?)\s+and\s+(.+)$/i,
		/\b(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i,
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (!match) continue;
		const entities = [cleanComparisonEntity(match[1]), cleanComparisonEntity(match[2])].filter(Boolean);
		if (entities.length >= 2) return Array.from(new Set(entities));
	}
	return [];
}

function sourceTextCoversEntity(sourceText: unknown, entity: string) {
	const source = normalizeEntityText(sourceText);
	const normalized = normalizeEntityText(entity);
	if (!source || !normalized) return false;
	if (source.includes(normalized)) return true;
	const words = entityWords(entity);
	if (!words.length) return false;
	return words.every((word) => source.includes(word));
}

function sourceCitationProvidesExplanatoryComparisonSupport(citation: unknown, entity: string) {
	if (!sourceTextCoversEntity(citation, entity)) return false;
	const citationWordCount = entityWords(citation).length;
	const entityWordCount = entityWords(entity).length;
	return citationWordCount >= entityWordCount + 3;
}

function buildSurplusTeachingHighlightGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForTeachingPageSourceMarker(prompt)) return null;
	if (promptAsksForStructuredPageSourceMarker(prompt) || promptAsksForComparison(prompt)) return null;
	if (completedSourceHighlightCount(request) < TEACHING_SOURCE_HIGHLIGHT_MAX) return null;
	return {
		guardrail: {
			kind: "surplus_teaching_highlight",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				`${completedSourceHighlightCount(request)} source highlights already cover the key concepts for this teaching answer.`,
				`Do not call ${toolName} again for this turn.`,
				hasCompletedToolTrace(request, "browser_show_note")
					? "Answer now from the existing highlights and note. Keep the answer concise."
					: "If one short browser_show_note would clarify the central idea, add it under 280 characters; otherwise answer now from the existing highlights.",
				"Do not use Markdown tables or horizontal rules. Do not claim the highlighter failed.",
			].join(" "),
		},
	};
}

function buildSurplusTeachingNoteGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "show_note") return null;
	if (promptExplicitlyRequestsNote(prompt)) return null;
	if (!promptAsksForCompactPageTeaching(prompt)) return null;
	if (countToolTracesByState(request, "browser_show_note", ["complete"]) < TEACHING_SOURCE_NOTE_MAX) return null;
	return {
		guardrail: {
			kind: "surplus_teaching_note",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"One teaching note already succeeded for this compact page answer.",
				`Do not call ${toolName} again for this turn unless the user explicitly asked for multiple notes.`,
				"Answer now from the existing highlights and note. Keep the sidebar answer compact.",
			].join(" "),
		},
	};
}

function buildCompactTeachingNoteFailureGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "show_note") return null;
	if (promptExplicitlyRequestsNote(prompt)) return null;
	if (!promptAsksForCompactPageTeaching(prompt)) return null;
	if (countToolTracesByState(request, "browser_show_note", ["complete"]) > 0) return null;
	if (countToolTracesByState(request, "browser_show_note", ["error"]) < 1) return null;
	return {
		guardrail: {
			kind: "compact_teaching_note_failure",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"A teaching note already failed on this page.",
				`Do not call ${toolName} again for this compact teaching answer unless the user explicitly asked for notes.`,
				"Answer now from the existing source highlights. Keep the sidebar answer compact and do not describe tool work.",
			].join(" "),
		},
	};
}

function buildStructuredHighlightBudgetGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForStructuredPageSourceMarker(prompt)) return null;
	const highlightCount = completedSourceHighlightCount(request);
	const errorCount = countToolTracesByState(request, "browser_highlight_text", ["error"]);
	if (!(highlightCount > 0 && errorCount >= STRUCTURED_SOURCE_HIGHLIGHT_ERROR_LIMIT)) {
		return null;
	}
	return {
		guardrail: {
			kind: "structured_highlight_budget",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				`${errorCount} highlight attempts have failed after at least one source highlight succeeded.`,
				`Do not call ${toolName} again for this turn.`,
				"Answer now only from the existing successful source highlights.",
				"For roadmap, list, process, derivation, or proof answers, omit items that lack a successful source highlight unless one existing highlight literally contains the full list. For compare/contrast answers, keep the comparison scoped to the marked sides.",
				"Do not mention highlight failures, timeouts, or source marker status in the chat answer.",
			].join(" "),
		},
	};
}

function buildCompactTeachingHighlightBudgetGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForCompactPageTeaching(prompt)) return null;
	if (promptAsksForStructuredPageSourceMarker(prompt) || promptAsksForComparison(prompt)) return null;
	const highlightCount = completedSourceHighlightTraceCount(request) || completedSourceHighlightCount(request);
	const errorCount = countToolTracesByState(request, "browser_highlight_text", ["error"]);
	if (!(highlightCount > 0 && errorCount >= COMPACT_TEACHING_HIGHLIGHT_ERROR_LIMIT)) return null;
	return {
		guardrail: {
			kind: "compact_teaching_highlight_budget",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				`${highlightCount} source highlight already succeeded and ${errorCount} later highlight attempts failed.`,
				`Do not call ${toolName} again for this compact teaching answer.`,
				hasCompletedToolTrace(request, "browser_show_note")
					? "Answer now from the existing source highlight and note."
					: "If one short browser_show_note would clarify the source, add it under 280 characters; otherwise answer now from the existing highlight.",
				"Keep the sidebar answer compact. Do not claim the highlighter failed or describe tool work.",
			].join(" "),
		},
	};
}

function buildStructuredNoteBudgetGuardResult(toolName: string, commandName: string, prompt: unknown, request: any) {
	if (commandName !== "show_note") return null;
	if (promptExplicitlyRequestsNote(prompt)) return null;
	if (!promptAsksForStructuredPageSourceMarker(prompt)) return null;
	const maxNotes = promptAsksForComparison(prompt) ? 1 : STRUCTURED_SOURCE_NOTE_MAX;
	if (countToolTracesByState(request, "browser_show_note", ["complete"]) < maxNotes) return null;
	return {
		guardrail: {
			kind: "structured_note_budget",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				`${maxNotes} note${maxNotes === 1 ? "" : "s"} already succeeded for this structured page answer.`,
				`Do not call ${toolName} again for this turn unless the user explicitly asked for multiple notes.`,
				"Answer now from the existing source highlights and notes. Keep the answer compact.",
			].join(" "),
		},
	};
}

function buildOptionalFrameFallbackNoteGuardResult(_toolName: string, _commandName: string, _params: any, _prompt: unknown, _request: any) {
	// Notes are core to Onhand ("the marks do the talking"): never suppress a note just because the
	// highlight was created via a frame fallback. show_note runs against the same frame DOM (per-frame
	// isolated world via the generic web-frame executor) and finds the annotation, so the note persists.
	// (Verified: a note attached to a debugger-frame highlight now lands and increments noteCount.)
	return null;
}

const READABLE_REWRITE_TRACE_TOOL_NAMES = new Set([
	"browser_extract_content",
	"browser_get_visible_text",
	"browser_get_viewport_headings",
	"browser_find_elements",
	"browser_pdf_search",
	"browser_pdf_read_pages",
	"browser_textbook_search",
]);

function recentReadableTraceBlocks(request: any) {
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	const blocks: string[] = [];
	for (const trace of traces) {
		if (trace?.state !== "complete") continue;
		if (!READABLE_REWRITE_TRACE_TOOL_NAMES.has(String(trace?.toolName || ""))) continue;
		const details = trace?.resultDetails || trace?.details || {};
		for (const key of ["content", "visible"]) {
			const candidateBlocks = details?.[key]?.blocks;
			if (!Array.isArray(candidateBlocks)) continue;
			for (const block of candidateBlocks) {
				const text = String(block?.text || "").replace(/\s+/g, " ").trim();
				if (text) blocks.push(text);
			}
		}
		const summary = String(trace?.resultSummary || "").trim();
		if (summary) {
			for (const line of summary.split(/\n+/)) {
				const text = line.replace(/\s+/g, " ").trim();
				if (text.length >= 20) blocks.push(text);
			}
		}
	}
	return blocks;
}

function splitReadablePhraseCandidates(value: unknown) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (!text) return [];
	const sentenceCandidates = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((candidate) => candidate.trim()).filter(Boolean);
	const seeds = sentenceCandidates.length ? sentenceCandidates : [text];
	const candidates: string[] = [];
	const addCandidate = (candidate: unknown) => {
		const normalizedCandidate = normalizeHighlightRetryCandidate(candidate);
		const normalized = stripTrailingHeadingAnchorMarker(normalizedCandidate) || normalizedCandidate;
		if (normalized.length < 20 || normalized.length > 360) return;
		if (!candidates.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized);
	};
	for (const seed of seeds) {
		const normalized = normalizeHighlightRetryCandidate(seed);
		const withoutLabel = stripShortLeadingHighlightLabel(normalized);
		addCandidate(trimHighlightCandidateBeforeFormulaNoise(withoutLabel));
		addCandidate(trimHighlightCandidateBeforeFormulaNoise(normalized));
		addCandidate(withoutLabel);
		addCandidate(normalized);
		if (normalized.length > 320) {
			for (const part of normalized.split(/\s*[;:]\s+/).map((candidate) => candidate.trim())) {
				addCandidate(trimHighlightCandidateBeforeFormulaNoise(part));
				addCandidate(part);
			}
		}
	}
	return candidates;
}

function looseHighlightMatchText(value: unknown) {
	return normalizeEntityText(value)
		.replace(/\b([a-z])\1{1,}\b/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function significantWordOverlap(left: unknown, right: unknown) {
	const leftWords = new Set(entityWords(left));
	const rightWords = new Set(entityWords(right));
	if (!leftWords.size || !rightWords.size) return 0;
	let matches = 0;
	for (const word of leftWords) if (rightWords.has(word)) matches += 1;
	return matches / Math.max(1, leftWords.size);
}

function looksLikeExpandedMathExtractionCandidate(candidate: unknown, proposed: unknown) {
	const candidateText = normalizeHighlightRetryCandidate(candidate);
	const proposedText = normalizeHighlightRetryCandidate(proposed);
	if (!candidateText || !proposedText) return false;
	if (candidateText.length <= proposedText.length) return false;
	if (candidateText.toLowerCase() === proposedText.toLowerCase()) return false;
	return /\b[A-Z]\s*[A-Z]\s*[A-Z]\b/u.test(candidateText) || /(?:[A-Za-z]\([^)]{1,16}\)){2,}/u.test(candidateText);
}

function canRewriteToContainedReadablePhrase(candidate: unknown, proposed: unknown) {
	const candidateWords = entityWords(candidate);
	const proposedWords = entityWords(proposed);
	if (!candidateWords.length || !proposedWords.length) return false;
	if (String(candidate || "").trim().endsWith(":") && candidateWords.length >= 5) return true;
	return candidateWords.length >= Math.max(3, Math.ceil(proposedWords.length * 0.65));
}

function findRecentReadableExactPhrase(request: any, proposed: unknown) {
	const blocks = recentReadableTraceBlocks(request);
	const proposedText = String(proposed || "").trim();
	const proposedLoose = looseHighlightMatchText(proposedText);
	if (!proposedLoose || proposedLoose.length < 16) return "";
	for (const block of blocks) {
		for (const candidate of splitReadablePhraseCandidates(block)) {
			const candidateLoose = looseHighlightMatchText(candidate);
			if (!candidateLoose) continue;
			if (looksLikeExpandedMathExtractionCandidate(candidate, proposedText)) continue;
			if (candidateLoose === proposedLoose) {
				if (candidate !== proposedText) return candidate;
				continue;
			}
			if (candidateLoose.includes(proposedLoose)) return candidate;
			if (proposedLoose.includes(candidateLoose) && canRewriteToContainedReadablePhrase(candidate, proposedText)) return candidate;
			if (significantWordOverlap(proposedText, candidate) >= 0.82) return candidate;
		}
	}
	return "";
}

function shouldKeepExactHighlightPhrase(value: unknown) {
	const text = normalizeHighlightRetryCandidate(value);
	if (!text || text.length < 16 || text.length > 90) return false;
	return highlightRetryWordCount(text) <= 8;
}

function rewriteHighlightTextToRecentReadableExactPhrase(value: unknown, request: any) {
	const proposed = String(value || "").trim();
	if (!proposed) return "";
	if (shouldKeepExactHighlightPhrase(proposed)) return "";
	const rewritten = findRecentReadableExactPhrase(request, proposed);
	if (!rewritten || rewritten === proposed) return "";
	return rewritten;
}

const VIEWPORT_READ_TOOL_NAMES = new Set(["browser_get_visible_text", "browser_get_scroll_state", "browser_get_viewport_headings"]);
const PROGRESS_TOOL_NAMES_FOR_VIEWPORT_LOOP = new Set([
	"browser_extract_content",
	"browser_highlight_text",
	"browser_show_note",
	"browser_scroll_to_annotation",
	"browser_textbook_search",
	"browser_navigate",
	"browser_open_pdf_in_onhand_viewer",
	"browser_pdf_search",
	"browser_pdf_read_pages",
]);

function traceHasRealPageWorkProgress(trace: any) {
	if (!trace || trace.state !== "complete") return false;
	const toolName = String(trace.toolName || "");
	if (!PROGRESS_TOOL_NAMES_FOR_VIEWPORT_LOOP.has(toolName)) return false;
	if (toolName === "browser_highlight_text") return isCompletedSourceHighlightTrace(trace);
	return !String(trace.resultSummary || "").toLowerCase().includes("guardrail");
}

function buildRepeatedViewportReadGuardResult(toolName: string, commandName: string, request: any) {
	if (!["get_visible_text", "get_scroll_state", "get_viewport_headings"].includes(commandName)) return null;
	const traces = Array.isArray(request?.toolTraces) ? request.toolTraces : [];
	const lastProgressIndex = traces.map(traceHasRealPageWorkProgress).lastIndexOf(true);
	const tail = traces.slice(lastProgressIndex + 1).filter((trace: any) => trace?.state === "complete" && VIEWPORT_READ_TOOL_NAMES.has(String(trace.toolName || "")));
	if (tail.length < 6) return null;
	return {
		guardrail: {
			kind: "repeated_viewport_read_loop",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"Repeated visible-text, heading, or scroll-position reads have not changed the page context.",
				`Do not call ${toolName} again for this turn.`,
				"If offscreen page sections are needed, call browser_extract_content once with a focused query.",
				"If readable page context from this session already includes the needed sections, answer from that context now.",
				"If source markers are needed, use browser_highlight_text with short exact spans for the key claims instead of more read-only probes.",
				"Do not narrate scrolling or page-position checks in the final answer.",
			].join(" "),
		},
	};
}

const LOCATION_CONCEPT_STOPWORDS = new Set([
	"about",
	"area",
	"block",
	"current",
	"derive",
	"does",
	"equation",
	"explain",
	"explains",
	"find",
	"formula",
	"highlight",
	"locate",
	"location",
	"over",
	"page",
	"place",
	"section",
	"show",
	"shows",
	"tell",
	"theorem",
	"where",
]);

const NAMED_FORMULA_STOPWORDS = new Set([
	"current",
	"equation",
	"formula",
	"highlight",
	"page",
	"section",
	"show",
	"theorem",
	"this",
]);

function extractPromptConceptTerms(prompt: unknown, extraStopwords: Set<string> = new Set()) {
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const word of entityWords(prompt)) {
		if (extraStopwords.has(word) || seen.has(word)) continue;
		seen.add(word);
		terms.push(word);
	}
	return terms.slice(0, 8);
}

function promptAsksForConceptLocation(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	return (
		/\bwhere\b/.test(text) &&
		/\b(?:page|article|lecture|document|section|source|paper|slide|chapter)\b/.test(text) &&
		extractPromptConceptTerms(text, LOCATION_CONCEPT_STOPWORDS).length > 0
	);
}

function hasConceptTerms(value: unknown, terms: string[]) {
	const text = normalizeEntityText(value);
	if (!text || !terms.length) return false;
	const matches = terms.filter((term) => text.includes(normalizeEntityText(term))).length;
	return matches >= Math.min(2, terms.length);
}

function looksLikeMathOnlyConceptMarker(value: unknown, terms: string[]) {
	const text = String(value || "").trim();
	if (!text) return false;
	if (hasConceptTerms(text, terms)) return false;
	const wordCount = entityWords(text).length;
	return /[=∫∏∑√≈≤≥<>|∣]/u.test(text) && wordCount <= 5;
}

function buildConceptLocationHighlightGuardResult(toolName: string, commandName: string, params: any, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksForConceptLocation(prompt)) return null;
	const conceptTerms = extractPromptConceptTerms(prompt, LOCATION_CONCEPT_STOPWORDS);
	if (!conceptTerms.length) return null;
	if (hasConceptTerms(completedSourceHighlightText(request), conceptTerms)) return null;
	const proposedText = (params && typeof params === "object") ? params.text : "";
	if (!looksLikeMathOnlyConceptMarker(proposedText, conceptTerms)) return null;
	return {
		guardrail: {
			kind: "concept_location_needs_explanatory_highlight",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"This is a location question about where the page explains a requested concept.",
				"Do not use a math-only formula as the first or only source marker.",
				"Call browser_highlight_text with an exact explanatory phrase or heading-adjacent sentence that names the requested concept; use a formula highlight only after the location/explanation is marked.",
			].join(" "),
		},
	};
}

function promptAsksToHighlightNamedFormula(prompt: unknown) {
	const text = normalizePageSourcePromptText(prompt);
	return (
		/\bhighlight\b/.test(text) &&
		/\b(?:formula|theorem|equation)\b/.test(text) &&
		extractPromptConceptTerms(text, NAMED_FORMULA_STOPWORDS).length > 0
	);
}

function proposedHighlightLooksLikeNamedFormula(value: unknown, prompt: unknown) {
	const conceptTerms = extractPromptConceptTerms(prompt, NAMED_FORMULA_STOPWORDS);
	const text = String(value || "");
	if (hasConceptTerms(text, conceptTerms)) return true;
	const wordCount = entityWords(text).length;
	return /[=∫∏∑√≈≤≥<>|∣]/u.test(text) && wordCount >= 3 && hasConceptTerms(text, conceptTerms.slice(0, 3));
}

function buildNamedFormulaHighlightGuardResult(toolName: string, commandName: string, params: any, prompt: unknown, request: any) {
	if (commandName !== "highlight_text") return null;
	if (!promptAsksToHighlightNamedFormula(prompt)) return null;
	if (proposedHighlightLooksLikeNamedFormula(completedSourceHighlightText(request), prompt)) return null;
	const proposedText = (params && typeof params === "object") ? params.text : "";
	if (proposedHighlightLooksLikeNamedFormula(proposedText, prompt)) return null;
	return {
		guardrail: {
			kind: "named_formula_highlight_mismatch",
			blockedTool: toolName,
			blockedCommand: commandName,
			message: [
				"The user asked to highlight a named formula, theorem, or equation.",
				"Do not highlight a nearby unrelated formula just because it is visible.",
				"First call browser_extract_content if needed, then call browser_highlight_text with exact text from the matching section, formula label, formula text plus label, or nearest phrase that names the requested formula.",
			].join(" "),
		},
	};
}

export const __browserRuntimeTest = {
	applyLearningEvent,
	buildLearnerStatePromptSummary,
	buildExistingAnchorContext,
	buildHighlightRetryCandidates,
	shouldTryHighlightRetryCandidatesBeforeOriginalForTest: shouldTryHighlightRetryCandidatesBeforeOriginal,
	buildEmptyHighlightTextGuardResultForTest: buildEmptyHighlightTextGuardResult,
	buildWeakStructuredHighlightTextGuardResultForTest: buildWeakStructuredHighlightTextGuardResult,
	buildWeakCompactTeachingHighlightGuardResultForTest: buildWeakCompactTeachingHighlightGuardResult,
	buildSurplusHighlightGuardResultForTest: buildSurplusHighlightGuardResult,
	buildSurplusTeachingHighlightGuardResultForTest: buildSurplusTeachingHighlightGuardResult,
	buildSurplusTeachingNoteGuardResultForTest: buildSurplusTeachingNoteGuardResult,
	buildCompactTeachingNoteFailureGuardResultForTest: buildCompactTeachingNoteFailureGuardResult,
	buildCompactTeachingHighlightBudgetGuardResultForTest: buildCompactTeachingHighlightBudgetGuardResult,
	buildStructuredHighlightBudgetGuardResultForTest: buildStructuredHighlightBudgetGuardResult,
	buildStructuredNoteBudgetGuardResultForTest: buildStructuredNoteBudgetGuardResult,
	cleanMarkdownHeadingHighlightTextForTest: cleanMarkdownHeadingHighlightText,
	stripTrailingHeadingAnchorMarkerForTest: stripTrailingHeadingAnchorMarker,
	looksLikeExpandedMathExtractionCandidateForTest: looksLikeExpandedMathExtractionCandidate,
	canRewriteToContainedReadablePhraseForTest: canRewriteToContainedReadablePhrase,
	sourceCitationProvidesExplanatoryComparisonSupportForTest: sourceCitationProvidesExplanatoryComparisonSupport,
	isCompletedSourceHighlightTraceForTest: isCompletedSourceHighlightTrace,
	rewriteHighlightTextToRecentReadableExactPhraseForTest: rewriteHighlightTextToRecentReadableExactPhrase,
	rewriteComparisonHighlightTextForTest: (value: unknown, _prompt: unknown, request: any) => rewriteHighlightTextToRecentReadableExactPhrase(value, request),
	shouldAbortAfterRepeatedHighlightFailuresForTest: shouldAbortAfterRepeatedHighlightFailures,
	buildPlannerAnchorCandidates,
	buildReplayAnnotationsFromPageActions,
	classifyPromptForReasoning,
	computeDueReviews,
	createEmptyLearnerState,
	extractTrailingCheckQuestion,
	normalizeReviewConceptKey,
	withFallbackOpenCheck,
	appendAssistantDraftTextDeltaForTest: appendAssistantDraftTextDelta,
	joinAssistantTextBlocksForTest: joinAssistantTextBlocks,
	resetAssistantDraftTextForTest: resetAssistantDraftText,
	applyNavigateNewTabDefaultForTest: applyNavigateNewTabDefault,
	formatPdfCitationForModel,
	formatVisibleTextForModel,
	formatToolResultForModel: toolResultTextForModel,
	findReadyTextbookContextFromTracesForTest: findReadyTextbookContextFromTraces,
	buildTextbookContextReadyGuardResultForTest: buildTextbookContextReadyGuardResult,
	buildRepeatedViewportReadGuardResultForTest: buildRepeatedViewportReadGuardResult,
	buildRepeatedHighlightFailureGuardResultForTest: buildRepeatedHighlightFailureGuardResult,
	buildPostHighlightFailureAnswerNowGuardResultForTest: buildPostHighlightFailureAnswerNowGuardResult,
	buildOptionalFrameFallbackNoteGuardResultForTest: buildOptionalFrameFallbackNoteGuardResult,
	buildVisiblePdfSelectionFirstPassGuardResultForTest: buildVisiblePdfSelectionFirstPassGuardResult,
	promptAsksForTeachingPageSourceMarkerForTest: promptAsksForTeachingPageSourceMarker,
		promptAsksForStructuredPageSourceMarkerForTest: promptAsksForStructuredPageSourceMarker,
		promptAllowsPageSourceHighlightsForTest: promptAllowsPageSourceHighlights,
		promptRequiresPageSourceMarkerForTest: promptRequiresPageSourceMarker,
		shouldRequirePageSourceMarkerRetryForTest: shouldRequirePageSourceMarkerRetry,
		buildPageSourceMarkerRetryPromptForTest: buildPageSourceMarkerRetryPrompt,
		shouldRequirePdfAnchorRetryForTest: shouldRequirePdfAnchorRetry,
		buildPdfAnchorRetryPromptForTest: buildPdfAnchorRetryPrompt,
	sanitizeAssistantVisibleReplyForTest: sanitizeAssistantVisibleReply,
	shouldRecordFallbackOpenCheckForTest: shouldRecordFallbackOpenCheckForRequest,
	buildFinalAssistantReplyForTest: buildFinalAssistantReply,
	buildBlankReplyRetryPromptForTest: buildBlankReplyRetryPrompt,
	compactOnPageNoteTextForTest: compactOnPageNoteText,
	normalizeOptionalBrowserTargetNumbersForTest: normalizeOptionalBrowserTargetNumbers,
	compactFreeTierVisualContextMessagesForTest: compactFreeTierVisualContextMessages,
	compressFreeTierVisualContextMessagesForTest: compressFreeTierVisualContextMessages,
	messagesContainImageForTest: messagesContainImage,
	getMissingApiKeyError,
	getApiKeyForProvider,
	getProviderModelOptions,
	normalizeApiKeys,
	normalizeProviderForAuthMode,
	validateProviderApiKey,
	getReplayHighlightCandidates,
	getPublicActivities,
	buildPriorExtractedPageContextForTest: buildPriorExtractedPageContext,
	finalizePublicActivitiesForTest: finalizePublicActivities,
	queueBlankReplyRetryForTest: queueBlankReplyRetry,
	summarizeToolReliabilityForTest: summarizeToolReliability,
	getSelectionText,
	getSelectionPageNumber,
	inferPdfPageNumberFromBrowserContextDetails,
	inferPdfCurrentPageNumberFromBrowserContextDetails,
	inferPdfVisualPageNumberFromBrowserContextDetails,
	inferPdfVisualPageNumberFromPdfHandoffResult,
	shouldCapturePdfPageImageForPrompt,
	browserContextLooksLikePdf,
	isOnhandPdfViewerUrl,
	parseExplicitPdfHandoffParams,
	isLikelyPdfUrlForAutoHandoff,
	runRealtimePdfHandoffIfNeeded,
	shouldAutoOpenPdfViewerForTab,
	promptReferencesVisiblePdfSelectionOrPage,
	promptCouldReferToHighlightedPdfText,
	pdfSelectionAccessWasBlocked,
	pdfSelectionHighlightStatusUnknown,
	shouldOpenPdfViewerForUnknownPdfSelection,
	buildVisualResponseFormatRequirementForTest: buildVisualResponseFormatRequirement,
	shouldDeferPdfViewerForVisibleSelectionPrompt,
	shouldCaptureVisualRegionForPrompt,
	shouldCaptureVisualRegionForPdfSelectionFallback,
	normalizePlannerMove,
	normalizeLearnerState,
	getPromptContractForTest() {
		const learnerState = applyLearningEvent(
			applyLearningEvent(createEmptyLearnerState("learning"), {
				kind: "concept_introduced",
				conceptLabel: "Proposal sampling",
				conceptId: "concept_proposal_sampling",
				annotationId: "ann-proposal",
				tabTitle: "Example lesson",
				url: "https://example.test/lesson",
			}),
			{
				kind: "check_opened",
				checkId: "check-proposal-1",
				checkKind: "prediction",
				conceptId: "concept_proposal_sampling",
				conceptLabel: "Proposal sampling",
				promptText: "Before I explain: why might a proposal need to be accepted or rejected?",
				annotationId: "ann-proposal",
			},
		);
		const answerPrompt = buildLauncherPrompt(
			"How does proposal sampling work on this page?",
			"Active tab: Example lesson\nVisible text snapshot:\nProposal sampling draws a candidate from a simpler distribution before checking whether it fits the target.",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does proposal sampling work on this page?", [], false),
			[],
			"",
		);
		const namedTools = (names: string[]) => names.map((name) => ({ name, description: "" }) as AgentTool);
		const textbookPrompt = buildLauncherPrompt(
			"Search this textbook for proposal sampling.",
			"Active tab: Example reader\nVisible text snapshot:\nChapter 1",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "Search this textbook for proposal sampling.", [], false),
			namedTools(READER_SEARCH_TOOL_NAMES),
			"",
		);
		const pdfPrompt = buildLauncherPrompt(
			"What does this selected PDF passage mean?",
			"Active tab: Example.pdf\nSelected text:\nProposal sampling draws a candidate.",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "What does this selected PDF passage mean?", [], false),
			namedTools(["browser_open_pdf_in_onhand_viewer", ...PDF_TOOL_NAMES]),
			"",
		);
		const visualPrompt = buildLauncherPrompt(
			"What does this chart show?",
			"Active tab: Example lesson\nVisible text snapshot:\nModel accuracy chart.",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "What does this chart show?", [], false),
			namedTools([...VISUAL_CONTEXT_TOOL_NAMES, ...VISUAL_GROUNDING_TOOL_NAMES]),
			"",
		);
		const runtimeJsPrompt = buildLauncherPrompt(
			"Debug this dynamic page state.",
			"Active tab: Example app\nVisible text snapshot:\nDashboard",
			[],
			false,
			buildReasoningProfile(DEFAULT_SETTINGS, "Debug this dynamic page state.", [], false),
			namedTools(RUNTIME_JS_TOOL_NAMES),
			"",
		);
		const learningPrompt = buildLauncherPrompt(
			"How does proposal sampling work on this page?",
			"Active tab: Example lesson\nVisible text snapshot:\nProposal sampling draws a candidate from a simpler distribution before checking whether it fits the target.",
			[],
			true,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does proposal sampling work on this page?", [], true),
			[],
			"",
			learnerState,
		);
		const newConceptLearningPrompt = buildLauncherPrompt(
			"How does the update rule work on this page?",
			"Active tab: Example lesson\nVisible text snapshot:\nThe update rule combines prior information with new evidence.",
			[],
			true,
			buildReasoningProfile(DEFAULT_SETTINGS, "How does the update rule work on this page?", [], true),
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
			textbookPrompt,
			pdfPrompt,
			visualPrompt,
			runtimeJsPrompt,
			learningPrompt,
			learnerState,
			newConceptLearningPrompt,
			homeworkLearningPrompt,
		};
	},
	getToolNamesForTest(
		prompt: string,
		learningMode = false,
		learnerState: unknown = null,
		options: {
			forcePdfTools?: boolean;
			advancedRuntimeInspectionEnabled?: boolean;
			suppressExtractContent?: boolean;
			selectionFirstPdfQuestion?: boolean;
			forceToolNames?: string[];
		} = {},
	) {
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
	missingToolRetryToolNamesForTest: missingToolRetryToolNamesForPrompt,
	findMissingKnownBrowserToolTraceForTest: findMissingKnownBrowserToolTrace,
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
	recordEffectiveCommandParams: (
		toolName: string,
		toolCallId: string,
		requestedParams: unknown,
		effectiveParams: unknown,
		commandName: string,
	) => void = () => {},
	guardCommand: (toolName: string, commandName: string, effectiveParams: Record<string, unknown>) => any | null = () => null,
	runHighlightScanFallback: (effectiveParams: Record<string, unknown>, lastError: unknown) => Promise<any | null> = async () => null,
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
			const executeCommand = async () => {
				let result: any;
				const runCommandWithParams = async (requestedParams: any) => {
					const effectiveParams = prepareCommandParams(requestedParams, commandName) as Record<string, unknown>;
					recordEffectiveCommandParams(name, String(_toolCallId || name), requestedParams, effectiveParams, commandName);
					const runEffectiveCommand = async () => guardCommand(name, commandName, effectiveParams) || (await host.runCommand(commandName, effectiveParams));
					const timeoutMs = annotationCommandTimeoutMs(commandName);
					return timeoutMs
						? await withToolCommandTimeout(name, timeoutMs, runEffectiveCommand)
						: await runEffectiveCommand();
				};
				const runHighlightCandidate = async (candidate: string) => {
					const retryParams = { ...(params as any), text: candidate };
					const highlighted = await runCommandWithParams(retryParams);
					return {
						...highlighted,
						highlightRetry: {
							originalText: String((params as any)?.text || ""),
							usedText: candidate,
						},
					};
				};
				let lastHighlightError: any = null;
				const tryHighlightScanFallback = async (requestedParams: any, lastError: any) => {
					if (commandName !== "highlight_text") return null;
					const effectiveParams = prepareCommandParams(requestedParams, commandName) as Record<string, unknown>;
					if (!(effectiveParams as any)?.scanPage) return null;
					recordEffectiveCommandParams(name, String(_toolCallId || name), requestedParams, effectiveParams, commandName);
					return await runHighlightScanFallback(effectiveParams, lastError);
				};
				let attemptedCandidateCount = 0;
				try {
					if (commandName === "highlight_text" && shouldTryHighlightScanFallbackBeforeOriginal((params as any)?.text)) {
						try {
							result = await tryHighlightScanFallback(params, null);
						} catch (scanError) {
							lastHighlightError = scanError;
						}
					}
					if (!result && commandName === "highlight_text" && shouldTryHighlightRetryCandidatesBeforeOriginal((params as any)?.text)) {
						const preflightCandidates = buildHighlightRetryCandidates((params as any)?.text);
						for (const candidate of preflightCandidates) {
							attemptedCandidateCount += 1;
							try {
								result = await runHighlightCandidate(candidate);
								break;
							} catch (candidateError) {
								lastHighlightError = candidateError;
							}
						}
					}
					if (!result) {
						if (commandName === "highlight_text" && shouldSkipOriginalHighlightAttempt((params as any)?.text, attemptedCandidateCount)) {
							throw lastHighlightError || new Error(`No visible text matched: ${(params as any)?.text || ""}`);
						}
						result = await runCommandWithParams(params);
					}
				} catch (error) {
					if (commandName !== "highlight_text") throw error;
					const attemptedCandidateKeys = new Set<string>();
					for (const candidate of buildHighlightRetryCandidates((params as any)?.text)) {
						attemptedCandidateKeys.add(candidate.toLowerCase());
					}
					const candidates = buildHighlightRetryCandidates((params as any)?.text).filter((candidate) => {
						if (!attemptedCandidateCount) return true;
						const key = candidate.toLowerCase();
						if (!attemptedCandidateKeys.has(key)) return true;
						attemptedCandidateKeys.delete(key);
						return false;
					});
					let lastError = error || lastHighlightError;
					for (const candidate of candidates) {
						try {
							result = await runHighlightCandidate(candidate);
							break;
						} catch (candidateError) {
							lastError = candidateError;
						}
					}
					if (!result) {
						try {
							result = await tryHighlightScanFallback(params, lastError);
						} catch (fallbackError) {
							lastError = fallbackError || lastError;
						}
					}
					if (!result) throw lastError;
				}
				return {
					content: [{ type: "text", text: toolResultTextForModel(name, result) }],
					details: result,
				};
			};
			return commandName === "highlight_text"
				? await withToolCommandTimeout(`${name} tool call`, HIGHLIGHT_TOOL_CALL_TIMEOUT_MS, executeCommand)
				: await executeCommand();
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
			"Open a direct PDF or PDF-reader tab in Onhand's PDF viewer when offscreen/deeper PDF reading, full-PDF search, exact page marking, durable highlights/notes, or selected-text recovery from Google Scholar/third-party PDF readers is needed.",
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
			"Look up a bibliography entry in the current Onhand PDF viewer by bracket number (like [14]) or entry text. Returns the entry text, a source target for highlighting it, and identifiers (arXiv id, DOI, URL) with a suggested URL for opening the cited work.",
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
				"Capture the visible viewport, a CSS-selector bounding box, or viewport coordinates as an image for equations, charts, diagrams, figures, screenshots, and weak visual text extraction. Selector captures scroll into view by default and reports clipping/tiny-region warnings. Use this before making visual claims when text tools are insufficient; do not use it as the selected-text recovery path for Google Scholar or other third-party PDF readers.",
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
			"Extract readable article or document text from the live page. For named sections, tables, rows, formulas, tensors, or exact values, pass a short query so matching long-page sections are prioritized. Use at most once per response unless the first result is unusable.",
			EXTRACT_CONTENT_SCHEMA,
			"extract_content",
		),
		commandTool(
			"browser_textbook_search",
			"Browser Textbook Search",
			"Search the current online textbook, ebook, or protected reader using the reader's own book-search UI. Use when readable extraction does not include the requested topic or the user asks about another part/the whole book. By default this only reads the search results; set openResult=true only when navigating to a result is needed. After openedResult.navigated=true, use browser_extract_content once on the opened reader page and avoid manual search-panel clicks.",
			TEXTBOOK_SEARCH_SCHEMA,
			"textbook_search",
			{ sequential: true },
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
				"Highlight exact visible/readable text that supports a material claim. The text argument must be copied from page text, not paraphrased from your answer. Use short, distinctive explanatory spans, usually one sentence or phrase under 180 characters. Avoid page-title, course-title, reading-list, and heading-only highlights unless that heading alone answers the user's question. For broad teach/review/summarize prompts, use one to three central highlights; do not mark every section or every sentence you mention. For compare/contrast prompts, prefer one concise support highlight per side, plus at most one direct contrast/conclusion sentence; do not highlight full algorithms or every sub-step unless asked. If the answer names multiple roadmap/list/navigation items, mark every required top-level item the answer names unless one exact visible span literally contains the full named list. Mark top-level sibling items before nested children; after marking a parent/top-level item, move to the next sibling item instead of marking child headings, examples, usage patterns, or subfeatures under the same parent unless the user asks for that breakdown. For list items, send the item words, not a heading-plus-list block; Markdown markers in tool output are structure cues. If the user explicitly asks to highlight a formula/equation, use the selected formula text when available or the closest visible formula label; rendered math matches are promoted to block highlights. For ordinary source grounding where rendered math extraction is collapsed or fragmented, prefer the nearby explanatory sentence, label, or caption instead of copying broken formula text. If an item cannot be highlighted successfully, do not claim it as page-supported. For simple non-list questions, use this at most once before answering.",
			HIGHLIGHT_TEXT_SCHEMA,
			"highlight_text",
			{ sequential: true },
		),
		commandTool(
			"browser_show_note",
			"Browser Show Note",
			"Attach a short marginal note to a highlight. Use one local orienting sentence under 280 characters, not a summary or detached answer. Put fuller explanation in chat. Do not add a note for every highlight.",
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
			"Last-resort read-only JavaScript evaluation for complex client-side runtime state when safer browser tools cannot answer the user's question. For DOM values, read .value on controls and .textContent on ordinary elements. Do not inspect cookies, storage, secrets, payment fields, or unrelated page data.",
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
		case "browser_textbook_search":
			return "Searching the textbook reader...";
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
	if (details.guardrail) return null;
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
		case "browser_textbook_search": {
			const search = details.search || details || {};
			const detail = truncate(search.query || "Reader search", 72);
			return {
				key: `textbook-search:${tab?.id || "tab"}:${detail}`,
				type: search.openedResult?.navigated ? "tab" : "read",
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				...pageActionTabFields(tab),
				label: search.openedResult?.navigated ? "Opened reader result" : "Searched textbook",
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
			if (details.guardrail) return null;
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

function normalizeOptionalBrowserTargetNumber(value: unknown) {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	if (!text || /^(?:undefined|null|none|nan)$/i.test(text)) return undefined;
	const number = Number(text);
	return Number.isFinite(number) ? number : undefined;
}

function normalizeOptionalBrowserTargetNumbers(params: any = {}) {
	if (!params || typeof params !== "object") return {};
	const normalized = { ...params };
	for (const key of ["tabId", "windowId"]) {
		if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
		const number = normalizeOptionalBrowserTargetNumber(normalized[key]);
		if (typeof number === "number") normalized[key] = number;
		else delete normalized[key];
	}
	return normalized;
}

function normalizeUrlForNavigationDefault(value: unknown) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	try {
		const parsed = new URL(raw);
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return raw.replace(/#.*$/, "");
	}
}

function applyNavigateNewTabDefault(params: any = {}, request: any = null) {
	const normalized = params && typeof params === "object" ? { ...params } : {};
	if (normalized.newTab === true || normalized.newTab === false) return normalized;
	const destinationUrl = normalizeUrlForNavigationDefault(normalized.url);
	if (!destinationUrl) return normalized;
	const startingUrl = normalizeUrlForNavigationDefault(request?.initialActiveUrl || request?.initialActiveTab?.url);
	if (!startingUrl || destinationUrl !== startingUrl) {
		normalized.newTab = true;
	}
	return normalized;
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
			source: compactTelemetryValue((data as any).source || "extension", 48),
			turn_id: compactOnhandTelemetryId((data as any).turn_id ?? (data as any).turnId),
			session_id: compactOnhandTelemetryId((data as any).session_id ?? (data as any).sessionId),
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
		if (/already (?:responding|processing)|use steer\(\)|followup\(\)|wait for (?:completion|the current reply)/.test(message)) return "busy";
		if (/api key|sign in|oauth|credential|auth/.test(message)) return "auth";
		if (/quota|limit|rate|429|free tier/.test(message)) return "quota";
		if (/network|fetch|connection|offline|reach/.test(message)) return "network";
		if (/model|provider|upstream|openrouter|openai|anthropic|gemini/.test(message)) return "provider";
		if (/aborted|cancelled|stopped/.test(message)) return "aborted";
		if (/permission|debugger|side panel|tab|chrome/.test(message)) return "browser_permission";
		return "runtime_error";
	}

	function shouldSuppressSentryException(kind: string, error: unknown, data: Record<string, unknown> = {}) {
		if ((data as any).force_sentry_capture || (data as any).forceSentryCapture) return false;
		const message = compactTelemetryValue((error as any)?.message || error, 500).toLowerCase();
		const messageType = compactTelemetryValue((data as any).message_type || (data as any).messageType, 120);
		const errorKind = compactTelemetryValue((data as any).error_kind || (data as any).errorKind || classifyTelemetryError(error), 80);
		if (errorKind === "aborted" || errorKind === "busy") return true;
		if (errorKind === "auth" && /sign in|oauth sign-in tab was closed|authorization completed|api key is missing|credential/.test(message)) {
			return true;
		}
		if (kind !== "runtime_exception") return false;
		if (messageType === "sidebar:submit-prompt" && /already responding|already processing|wait for the current reply/.test(message)) return true;
		if (messageType === "browser-runtime:oauth-sign-in" && /closed before authorization completed/.test(message)) return true;
		if (/^sidebar:(?:activate-action|scroll-to-annotation|jump-learner-source)$/.test(messageType)) {
			return /source not found|saved source text is not currently loaded|no annotation found|no visible text matched/.test(message);
		}
		if (/^sidebar:realtime-(?:browser|pdf)-tool$/.test(messageType)) {
			return /only run on web or local-file tabs|not onhand sidebar|unsupported pdf|no pdf|source not found|no visible text matched/.test(message);
		}
		return false;
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

	function redactTraceText(value: unknown, maxLength = 3000) {
		let text = String(value || "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t\f\v]+/g, " ")
			.replace(/\n[ \t]+/g, "\n")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		if (!text) return "";
		text = text
			.replace(/\b(?:sk|sk-or|sk-ant|AIza)[A-Za-z0-9._-]{12,}\b/g, "[redacted_key]")
			.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted_email]")
			.replace(/([?&](?:key|token|secret|api_key|access_token|refresh_token)=)[^&\s)'"<>]+/gi, "$1[redacted]")
			.replace(/chrome-extension:\/\/[a-z]{32}/gi, "chrome-extension://[extension]")
			.replace(/file:\/\/[^\s)'"<>]+/gi, "[redacted_file_url]")
			.replace(/\/Users\/[^/\s)'"<>]+/g, "/Users/[redacted_user]");
		if (text.length <= maxLength) return text;
		return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
	}

	function serializeTraceValue(value: unknown, options: { depth?: number; maxStringLength?: number; maxArrayItems?: number; maxObjectKeys?: number } = {}): unknown {
		const depth = Number(options.depth ?? 4);
		const maxStringLength = Number(options.maxStringLength ?? 3000);
		const maxArrayItems = Number(options.maxArrayItems ?? 24);
		const maxObjectKeys = Number(options.maxObjectKeys ?? 48);
		const visit = (entry: unknown, remainingDepth: number): unknown => {
			if (entry == null || typeof entry === "number" || typeof entry === "boolean") return entry;
			if (typeof entry === "string") {
				if (/^data:image\//i.test(entry)) return "[image data omitted]";
				if (entry.length > 120 && /^[A-Za-z0-9+/]+=*$/.test(entry)) return "[base64-like data omitted]";
				return redactTraceText(entry, maxStringLength);
			}
			if (typeof entry !== "object") return redactTraceText(String(entry), maxStringLength);
			if (remainingDepth <= 0) return "[nested value omitted]";
			if (Array.isArray(entry)) return entry.slice(0, maxArrayItems).map((item) => visit(item, remainingDepth - 1));
			const output: Record<string, unknown> = {};
			for (const [key, rawValue] of Object.entries(entry as Record<string, unknown>).slice(0, maxObjectKeys)) {
				if (/^(data|dataUrl|screenshot|screenshotDataUrl|image|outerHTML|html)$/i.test(key) && typeof rawValue === "string") {
					output[key] = `[${key} omitted: ${rawValue.length} chars]`;
					continue;
				}
				if (/^(apiKey|api_key|token|accessToken|access_token|refreshToken|refresh_token|secret|password)$/i.test(key)) {
					output[key] = "[redacted]";
					continue;
				}
				output[key] = visit(rawValue, remainingDepth - 1);
			}
			return output;
		};
		return visit(value, depth);
	}

	function traceResultDetails(result: any) {
		if (!result || typeof result !== "object") return serializeTraceValue(result, { depth: 2, maxStringLength: 1200 });
		const details = Object.prototype.hasOwnProperty.call(result, "details") ? result.details : result;
		return serializeTraceValue(details, { depth: 4, maxStringLength: 2400, maxArrayItems: 18, maxObjectKeys: 36 });
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
		if (shouldSuppressSentryException(kind, error, data)) return false;
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
		const freeTierBypassActive = settings.aiProvider === ONHAND_FREE_PROVIDER && Boolean(await getFreeTierQuotaBypassSecret().catch(() => ""));
		const currentTurnId = (data as any).turn_id ?? (data as any).turnId ?? activeRequest?.id ?? "";
		const currentSessionId = (data as any).session_id ?? (data as any).sessionId ?? store.currentSessionId ?? "";
		const requestSource = compactTelemetryValue(activeRequest?.source || "", 32);
		const telemetrySource =
			(data as any).source ||
			(requestSource && requestSource !== "sidebar" ? `extension-${requestSource}` : freeTierBypassActive ? "extension-free-tier-bypass" : "extension");
		const payload = {
			event_name: name,
			client_id: clientId,
			extension_version: compactTelemetryValue(manifest.version, 40),
			runtime_revision: compactTelemetryValue(host.runtimeRevision || "", 80),
			data: telemetryEventData(settings, {
				...data,
				turn_id: currentTurnId,
				session_id: currentSessionId,
				source: telemetrySource,
			}),
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
		if (!promptReferencesVisiblePdfSelectionOrPage(userQuestion)) {
			await runRealtimePdfHandoffIfNeeded(host, targetWindowId);
		}
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
		if (!promptReferencesVisiblePdfSelectionOrPage(userResponse)) {
			await runRealtimePdfHandoffIfNeeded(host, targetWindowId);
		}
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

	function toolTraceKey(toolCallId: string, toolName: string) {
		return `${toolCallId || toolName || "tool"}:${toolName || "tool"}`;
	}

	function findToolTrace(toolCallId: string, toolName: string): ToolTraceEntry | null {
		const traces = Array.isArray(activeRequest?.toolTraces) ? activeRequest.toolTraces : [];
		const key = toolTraceKey(toolCallId, toolName);
		return [...traces].reverse().find((trace) => toolTraceKey(trace.toolCallId, trace.toolName) === key) || null;
	}

	function recordToolTraceStart(toolName: string, toolCallId: string, args: unknown = {}) {
		if (!activeRequest || !toolName || isInternalToolName(toolName)) return;
		if (!Array.isArray(activeRequest.toolTraces)) activeRequest.toolTraces = [];
		const existing = findToolTrace(toolCallId, toolName);
		const entry: ToolTraceEntry = existing || {
			id: `trace:${toolCallId || crypto.randomUUID()}`,
			toolCallId: toolCallId || "",
			toolName,
			state: "running",
			startedAt: nowIso(),
		};
		entry.state = "running";
		entry.args = serializeTraceValue(args, { depth: 4, maxStringLength: 2400, maxArrayItems: 18, maxObjectKeys: 36 });
		if (!existing) activeRequest.toolTraces.push(entry);
	}

	function recordToolTraceEffectiveArgs(toolName: string, toolCallId: string, effectiveArgs: unknown = {}) {
		if (!activeRequest || !toolName || isInternalToolName(toolName)) return;
		if (!Array.isArray(activeRequest.toolTraces)) activeRequest.toolTraces = [];
		const entry = findToolTrace(toolCallId, toolName);
		if (!entry) return;
		entry.effectiveArgs = serializeTraceValue(effectiveArgs, { depth: 4, maxStringLength: 2400, maxArrayItems: 18, maxObjectKeys: 36 });
	}

	function extractToolErrorText(result: unknown) {
		const details = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "details") ? (result as any).details : result;
		const textFrom = (value: unknown): string => {
			if (value == null) return "";
			if (typeof value === "string") return value.trim();
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			if (typeof value === "object") {
				for (const nested of [
					(value as any).error,
					(value as any).message,
					(value as any).reason,
					(value as any).details,
					(value as any).cause,
				]) {
					const text = textFrom(nested);
					if (text) return text;
				}
			}
			return "";
		};
		for (const value of [
			(details as any)?.error,
			(details as any)?.message,
			(details as any)?.reason,
			(result as any)?.error,
			(result as any)?.message,
		]) {
			const text = textFrom(value);
			if (text) return text;
		}
		if (typeof result === "string" && result.trim()) return result.trim();
		return "Tool failed.";
	}

	function recordToolTraceEnd(toolName: string, toolCallId: string, result: unknown, isError: boolean) {
		if (!activeRequest || !toolName || isInternalToolName(toolName)) return;
		if (!Array.isArray(activeRequest.toolTraces)) activeRequest.toolTraces = [];
		let entry = findToolTrace(toolCallId, toolName);
		if (!entry) {
			entry = {
				id: `trace:${toolCallId || crypto.randomUUID()}`,
				toolCallId: toolCallId || "",
				toolName,
				state: "running",
				startedAt: nowIso(),
			};
			activeRequest.toolTraces.push(entry);
		}
		entry.endedAt = nowIso();
		const startedAtMs = Date.parse(entry.startedAt || "");
		const endedAtMs = Date.parse(entry.endedAt || "");
		if (Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)) {
			entry.duration_ms = Math.max(0, endedAtMs - startedAtMs);
		}
		const guardrail = extractToolResultGuardrail(result);
		const traceIsError = isError || Boolean(guardrail);
		entry.state = traceIsError ? "error" : "complete";
		let errorText = traceIsError ? (guardrail?.message ? `Guardrail blocked ${guardrail.blockedTool || toolName}: ${guardrail.message}` : extractToolErrorText(result)) : "";
		if (traceIsError && !guardrail && errorText === "Tool failed." && toolName === "browser_highlight_text") {
			const attemptedText = String((entry.args as any)?.text || "").trim();
			if (attemptedText) errorText = `No visible text matched: ${attemptedText}`;
		}
		const summary = guardrail?.message ? toolResultTextForModel(toolName, result) : traceIsError ? `${toolName} failed: ${errorText}` : toolResultTextForModel(toolName, result);
		entry.resultSummary = redactTraceText(summary, TOOL_TRACE_RESULT_SUMMARY_MAX_CHARS);
		entry.resultDetails = traceResultDetails(result);
		if (traceIsError) entry.error = redactTraceText(errorText, 1200);
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
		recordToolTraceStart(toolName, activityId, params);
		await publishState({ status: getToolStatusMessage(toolName) });
		try {
			const result = await host.runCommand(commandName, withTargetWindowId(params, targetWindowId));
			recordToolTraceEnd(toolName, activityId, { details: result }, false);
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
			recordToolTraceEnd(toolName, activityId, { details: { error: (error as any)?.message || String(error) } }, true);
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
			const state = await runBrowserContextSnapshot(host);
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

	async function runUnknownPdfSelectionHandoffIfNeeded(prompt: string, details: any, targetWindowId?: number) {
		if (!activeRequest || !shouldOpenPdfViewerForUnknownPdfSelection(prompt, details)) return null;
		const pageLocation = inferPdfPageNumberFromBrowserContextDetails(details);
		try {
			return await runPdfHandoffPreflight(
				{
					active: true,
					newTab: false,
					waitForLoad: true,
					timeoutMs: 20000,
					...(pageLocation?.pageNumber ? { pageNumber: pageLocation.pageNumber, initialPageSource: pageLocation.source } : {}),
					...(details?.selection ? { selection: details.selection } : {}),
				},
				targetWindowId,
				{
					activityId: "tool:preflight:browser_open_pdf_in_onhand_viewer:unknown-selection",
					failRequest: false,
				},
			);
		} catch (error) {
			host.log?.("unknown PDF selection handoff failed", error);
			await publishState({ status: "Could not open PDF in Onhand viewer; reading the current page..." });
			return null;
		}
	}

	async function runPdfVisualCapturePreflight(prompt: string, details: any, targetWindowId?: number, pdfHandoff?: any) {
		if (!activeRequest || !promptAsksAboutVisualRegion(prompt)) return null;
		if (!browserContextLooksLikePdf(details) && !pdfHandoff) return null;
		const pageLocation = inferPdfVisualPageNumberFromBrowserContextDetails(details) || inferPdfVisualPageNumberFromPdfHandoffResult(pdfHandoff);
		if (!pageLocation?.pageNumber) return null;
		const commandName = "pdf_capture_page_image";
		const toolName = "browser_pdf_capture_page_image";
		const activityId = `tool:preflight:${toolName}:${pageLocation.pageNumber}`;
		const params = {
			pageNumber: pageLocation.pageNumber,
			format: "image/png",
		};
		appendActivity({
			id: activityId,
			kind: "tool",
			label: getToolStatusMessage(toolName),
			toolName,
			state: "running",
		});
		recordToolTraceStart(toolName, activityId, { ...params, pageSource: pageLocation.source });
		await publishState({ status: getToolStatusMessage(toolName) });
		try {
			const result = await host.runCommand(commandName, withTargetWindowId(params, targetWindowId));
			recordToolTraceEnd(toolName, activityId, { details: result }, false);
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
				status: "Reading the PDF figure...",
			});
			return result;
		} catch (error) {
			const message = (error as any)?.message || String(error);
			host.log?.("PDF visual capture preflight failed", error);
			recordToolTraceEnd(toolName, activityId, { details: { error: message, pageNumber: pageLocation.pageNumber } }, true);
			appendActivity({
				id: activityId,
				kind: "tool",
				label: getToolStatusMessage(toolName),
				toolName,
				state: "error",
			});
			await publishState({ status: "Could not capture the PDF page image; reading available PDF context..." });
			return null;
		}
	}

	function unknownPdfSelectionHandoffNeedsReselect(result: any, details?: any) {
		if (!result) return false;
		return !getSelectionText(result.selectionHandoff) && !getSelectionText(details?.selection);
	}

	function buildUnknownPdfSelectionHandoffReply(result: any, originalDetails: any) {
		const sourceReader = pdfReaderLabelFromSelection(originalDetails?.selection) || "the original PDF reader";
		const pageNumber = Number(result?.initialPageNumber || result?.selectionHandoff?.pageNumber || 0);
		const pageText = Number.isFinite(pageNumber) && pageNumber > 0 ? ` on page ${pageNumber}` : "";
		const lines = [`I opened the PDF in the Onhand viewer${pageText}.`];
		if (!pageText) {
			lines.push("", "I could not determine the original reader's current page before opening it.");
		}
		lines.push(
			"",
			"**What happened**",
			`- I could not transfer selected or highlighted text from ${sourceReader}.`,
			"",
			"**Next step**",
			"- If you had a passage highlighted, highlight it once in the Onhand viewer and ask again. I'll use that selection directly.",
			"- For smoother selected-text questions moving forward, use Chrome's default PDF viewer or the Onhand viewer instead of Google Scholar Reader or another third-party PDF reader.",
		);
		return lines.join("\n");
	}

	function selectRuntimeToolsForRequest(
		session: RuntimeSession,
		prompt: string,
		attachments: any[],
		learningMode: boolean,
		learnerState: unknown,
		options: {
			forcePdfTools?: boolean;
			advancedRuntimeInspectionEnabled?: boolean;
			suppressExtractContent?: boolean;
			selectionFirstPdfQuestion?: boolean;
			visiblePdfSelectionFirstPass?: boolean;
			forceToolNames?: string[];
		} = {},
	) {
		const firstPassPdfSelectionQuestion = Boolean(options.visiblePdfSelectionFirstPass);
		return selectToolsForPrompt(
			createTools(
				host,
				artifactHooks,
				withRequestBrowserContext,
				(event) => recordLearningEventForSession(session, event, learningMode ? "learning" : "answer"),
				(toolName, toolCallId, _requestedParams, effectiveParams) => recordToolTraceEffectiveArgs(toolName, toolCallId, effectiveParams),
				(toolName, commandName, effectiveParams) =>
					buildRepeatedHighlightFailureGuardResult(toolName, commandName, activeRequest) ||
					buildPostHighlightFailureAnswerNowGuardResult(toolName, commandName, activeRequest) ||
					buildRepeatedViewportReadGuardResult(toolName, commandName, activeRequest) ||
					buildVisiblePdfSelectionFirstPassGuardResult(toolName, commandName, prompt, firstPassPdfSelectionQuestion, activeRequest?.toolTraces || []) ||
					buildTextbookContextReadyGuardResult(toolName, commandName, effectiveParams, activeRequest?.toolTraces || []) ||
					buildEmptyHighlightTextGuardResult(toolName, commandName, effectiveParams) ||
					buildWeakStructuredHighlightTextGuardResult(toolName, commandName, effectiveParams, prompt) ||
					buildWeakCompactTeachingHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
					buildNamedFormulaHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
					buildConceptLocationHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
					buildSurplusTeachingNoteGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildCompactTeachingNoteFailureGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildStructuredNoteBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildOptionalFrameFallbackNoteGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
					buildCompactTeachingHighlightBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildStructuredHighlightBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildSurplusTeachingHighlightGuardResult(toolName, commandName, prompt, activeRequest) ||
					buildSurplusHighlightGuardResult(toolName, commandName, prompt, activeRequest),
				async (effectiveParams) => {
					if (!(effectiveParams as any)?.scanPage) return null;
					const text = compactActionText((effectiveParams as any)?.text);
					if (!text) return null;
					let tabId = Number((effectiveParams as any)?.tabId || activeRequest?.initialActiveTab?.id || 0);
					if (!Number.isFinite(tabId) || tabId <= 0) {
						const state = await host.snapshotState();
						tabId = Number(pickActiveTab(state, activeRequest?.targetWindowId)?.id || 0);
					}
					if (!Number.isFinite(tabId) || tabId <= 0) return null;
					return await highlightTextWithReplayCandidates(tabId, text, {
						...(effectiveParams || {}),
						scanPage: true,
						skipInitialAttempt: true,
						scrollIntoView: (effectiveParams as any)?.scrollIntoView !== false,
						pdfAnchor: (effectiveParams as any)?.pdfAnchor,
					});
				},
			),
			prompt,
			attachments,
			learningMode,
			learnerState,
			options,
		);
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
				let finalError = error || extractAssistantFailure(agentMessages, Boolean(activeRequest.aborted));
				let assistantText = activeRequest.reply.trim() || extractAssistantText(agentMessages).trim();
				const missingToolTrace = !finalError && !activeRequest.aborted && !activeRequest.missingToolRetry
					? findMissingKnownBrowserToolTrace(activeRequest)
					: null;
				if (missingToolTrace && activeAgent) {
					const missingToolName = String(missingToolTrace.toolName || "");
					const promptText = String(activeRequest.prompt || activeRequest.displayPrompt || "");
					const forcedToolNames = missingToolRetryToolNamesForPrompt(
						missingToolName,
						promptText,
						activeRequest.toolSelectionOptions || {},
					);
					if (forcedToolNames.length) {
						activeRequest.missingToolRetry = true;
						const retryTools = selectRuntimeToolsForRequest(
							session,
							promptText,
							Array.isArray(activeRequest.attachments) ? activeRequest.attachments : [],
							Boolean(activeRequest.learningMode),
							session.learnerState,
							{
								...(activeRequest.toolSelectionOptions || {}),
								forceToolNames: forcedToolNames,
							},
						);
						const existingToolNames = new Set((activeAgent.state.tools || []).map((tool: AgentTool) => tool.name));
						activeAgent.state.tools = [
							...(activeAgent.state.tools || []),
							...retryTools.filter((tool) => !existingToolNames.has(tool.name)),
						];
						resetAssistantDraftText(activeRequest);
						updateAssistantDraft(requestId, "", { pending: true });
						await publishState({ status: "Retrying with needed browser tool..." });
						queueBlankReplyRetry(activeAgent, buildMissingToolRetryPrompt(activeRequest, missingToolName), (retryError) => {
							void finalizeRequest(session, requestId, retryError);
						});
						return;
					}
				}
				if (!finalError && !activeRequest.aborted && shouldRequirePageSourceMarkerRetry(activeRequest) && activeAgent) {
					activeRequest.pageSourceMarkerRetry = true;
					resetAssistantDraftText(activeRequest);
					updateAssistantDraft(requestId, "", { pending: true });
					await publishState({ status: "Adding source marker..." });
					queueBlankReplyRetry(activeAgent, buildPageSourceMarkerRetryPrompt(activeRequest, assistantText), (retryError) => {
						void finalizeRequest(session, requestId, retryError);
					});
					return;
				}
				if (!finalError && !activeRequest.aborted && shouldRequirePdfAnchorRetry(activeRequest) && activeAgent) {
					activeRequest.pdfAnchorRetry = true;
					resetAssistantDraftText(activeRequest);
				updateAssistantDraft(requestId, "", { pending: true });
				await publishState({ status: "Anchoring PDF answer..." });
				queueBlankReplyRetry(activeAgent, buildPdfAnchorRetryPrompt(activeRequest, assistantText), (retryError) => {
					void finalizeRequest(session, requestId, retryError);
				});
				return;
			}
			if (!finalError && !activeRequest.aborted && !assistantText && hasCompletedUserToolTrace(activeRequest)) {
				if (!activeRequest.blankReplyRetry && activeAgent) {
					activeRequest.blankReplyRetry = true;
					await publishState({ status: "Writing answer..." });
				queueBlankReplyRetry(activeAgent, buildBlankReplyRetryPrompt(activeRequest), (retryError) => {
					void finalizeRequest(session, requestId, retryError);
				});
				return;
			}
			finalError = new Error("The model returned an empty answer after reading page context.");
			}
			const reply = buildFinalAssistantReply(assistantText, finalError, activeRequest);
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
			toolTraces: Array.isArray(activeRequest.toolTraces) ? [...activeRequest.toolTraces] : [],
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
		if (!finalError && !activeRequest.aborted && shouldRecordFallbackOpenCheckForRequest(activeRequest, reply)) {
			session.learnerState = withFallbackOpenCheck(session.learnerState, reply, activeRequest.createdAt);
		}
		await replaceCurrentSession(session);
		activeAgent = null;
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
		const requestSource = compactTelemetryValue(activeRequest.source || "", 32);
		const telemetrySource = requestSource && requestSource !== "sidebar" ? `extension-${requestSource}` : "";
		void trackExtensionEvent(telemetryEventName, {
			...(telemetrySource ? { source: telemetrySource } : {}),
			turn_id: activeRequest.id,
			session_id: session.id || store.currentSessionId || "",
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
				if (assistantEvent?.type === "text_start") {
					ensureAssistantDraftTextBlock(activeRequest, assistantEvent.contentIndex);
				} else if (assistantEvent?.type === "text_delta") {
					const draftText = appendAssistantDraftTextDelta(activeRequest, assistantEvent);
					updateAssistantDraft(requestId, draftText, { pending: true });
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
				recordToolTraceStart(toolName, (event as any).toolCallId || toolName, (event as any).args || {});
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
					recordToolTraceEnd(
						toolName,
						(event as any).toolCallId || toolName,
						{ details: { error: (event as any).error || (event as any).message || (event as any).result || "Tool failed." } },
						true,
					);
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
					// Repeated highlight failures no longer abort the whole request (which discarded the
					// answer and surfaced "Request was aborted"). buildRepeatedHighlightFailureGuardResult
					// intercepts further highlight_text calls and tells the model to answer from readable
					// page content (noting it could not highlight), so the user still gets an answer.
					if (toolName === "browser_highlight_text" && shouldAbortAfterRepeatedHighlightFailures(activeRequest)) {
						void publishState({ status: "Answering without highlights..." });
					}
					void publishState({ status: "Trying a different approach..." });
				} else {
					const guardrail = extractToolResultGuardrail((event as any).result);
					recordToolTraceEnd(toolName, (event as any).toolCallId || toolName, (event as any).result, false);
					if (guardrail) {
						appendActivity({
							id: activityId,
							kind: "tool",
							label: getToolStatusMessage(toolName),
							toolName,
							state: "retrying",
						});
						void publishState({
							pageActions: [...activeRequest.pageActions],
							status: guardrail.kind === "repeated_highlight_failure" ? "Answering without highlights..." : "Trying a different approach...",
						});
						break;
					}
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

	function withDefaultBrowserTarget(params: any = {}, commandName = "") {
		const normalizedParams = normalizeOptionalBrowserTargetNumbers(params);
		const targetWindowId = activeRequest?.targetWindowId;
		if (typeof normalizedParams?.tabId === "number" && hasCompletedTabInventory(activeRequest)) {
			return normalizedParams || {};
		}
		const targeted = {
			...(normalizedParams || {}),
		};
		if (typeof targetWindowId === "number") targeted.windowId = targetWindowId;
		delete targeted.tabId;
		if (commandName === "activate_tab") return targeted;
		delete targeted.titleContains;
		delete targeted.urlContains;
		return targeted;
	}

	function withRequestBrowserContext(params: any = {}, commandName = "") {
		const targetedParams = withDefaultBrowserTarget(params, commandName);
		if (commandName === "show_note") {
			const noteText = compactOnPageNoteText(targetedParams?.note || targetedParams?.text || targetedParams?.label || "");
			return {
				...(targetedParams || {}),
				note: noteText,
				annotationId: resolveActiveAnnotationId(activeRequest, targetedParams?.annotationId, noteText),
			};
		}
		if (commandName === "extract_content") {
			const prompt = activeRequest?.displayPrompt || "";
			if (promptAsksForCompactPageTeaching(prompt)) {
				const requestedMaxChars = Number(targetedParams?.maxChars || 0) || 0;
				return {
					...(targetedParams || {}),
					query: targetedParams?.query || buildReadableContentQuery(prompt),
					maxChars: requestedMaxChars > 0 ? Math.min(requestedMaxChars, COMPACT_TEACHING_EXTRACT_MAX_CHARS) : COMPACT_TEACHING_EXTRACT_MAX_CHARS,
				};
			}
			if (!promptNeedsExactReadableContext(prompt) || targetedParams?.query) return targetedParams;
			const requestedMaxChars = Number(targetedParams?.maxChars || 0) || 0;
			return {
				...(targetedParams || {}),
				query: buildReadableContentQuery(prompt),
				maxChars: Math.max(requestedMaxChars, 30000),
			};
		}
		if (commandName === "navigate") {
			return applyNavigateNewTabDefault(targetedParams, activeRequest);
		}
		if (commandName !== "highlight_text") return targetedParams;
		const highlightParams = {
			...(targetedParams || {}),
			reuseExisting: targetedParams?.reuseExisting !== false,
		};
		if (promptRequiresPageSourceMarker(activeRequest?.displayPrompt)) {
			highlightParams.scrollIntoView = true;
			highlightParams.scanPage = true;
		}
		const cleanedHeadingText = cleanMarkdownHeadingHighlightText(highlightParams?.text);
		if (cleanedHeadingText) highlightParams.text = cleanedHeadingText;
		const exactHighlightText = rewriteHighlightTextToRecentReadableExactPhrase(highlightParams?.text, activeRequest);
		if (exactHighlightText) highlightParams.text = exactHighlightText;
		const anchorCleanedText = stripTrailingHeadingAnchorMarker(highlightParams?.text);
		if (anchorCleanedText) highlightParams.text = anchorCleanedText;
		if (highlightParams?.pdfAnchor) return highlightParams;
		const initialSelection = activeRequest?.initialSelection;
		if (!selectionMatchesHighlightText(initialSelection, highlightParams?.text)) return highlightParams;
		return {
			...(highlightParams || {}),
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

		function shouldFastJumpStalePdfAnchor(pdfAnchor: any) {
			const viewer = String(pdfAnchor?.viewer || "").toLowerCase();
			const viewerUrl = String(pdfAnchor?.document?.viewerUrl || pdfAnchor?.document?.url || "");
			return viewer === "onhand-pdf-viewer" || /\/pdf-viewer\.html(?:[?#]|$)/i.test(viewerUrl);
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
		if (!options.skipInitialAttempt) {
			const initialAttempt = await tryReplayHighlightCandidates(tabId, candidates, options);
			if (initialAttempt.result) return initialAttempt.result;
			lastError = initialAttempt.lastError || lastError;
		}
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
			const paired = findPairedHighlightAction(action, actions);
			const pdfAnchorSource = compactActionText(
				action.pdfAnchor?.matchedText ||
					action.pdfAnchor?.textQuote?.exact ||
					paired?.pdfAnchor?.matchedText ||
					paired?.pdfAnchor?.textQuote?.exact,
			);
			return pdfAnchorSource || compactActionText(paired?.citationText || paired?.detail) || compactActionText(action.citationText || action.detail);
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

		async listSessions(limit?: number) {
			const store = await loadStore();
			const sortedSessions = Object.values(store.sessions).sort((left: any, right: any) =>
				String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
			);
			const normalizedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
			const listedSessions = normalizedLimit ? sortedSessions.slice(0, normalizedLimit) : sortedSessions;
			const sessions = listedSessions.map((session: any) => buildSessionListItem(session as RuntimeSession, store.currentSessionId));
			return {
				currentSession: buildSessionState(store.sessions[store.currentSessionId]),
				sessions,
				totalCount: sortedSessions.length,
				hasMore: normalizedLimit > 0 && sortedSessions.length > normalizedLimit,
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
			if (activeRequest || activeAgent) throw new Error("Onhand is already responding. Please wait for the current reply to finish.");
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
			const rawSource = String(request?.source || "sidebar").trim() || "sidebar";
			const promptEvalEnabled = isPromptEvalSource(rawSource);
			const promptEvalVariant = promptEvalEnabled ? String(request?.evalVariant || "").trim().slice(0, 80) : "";
			const promptEvalSystemAppend = promptEvalEnabled ? normalizePromptEvalAppend(request?.evalSystemPromptAppend) : "";
			const promptEvalLauncherAppend = promptEvalEnabled
				? normalizePromptEvalAppend(request?.evalLauncherPromptAppend ?? request?.evalPolicyAppend)
				: "";
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
				prompt,
				displayPrompt,
				attachments,
				source: compactTelemetryValue(rawSource, 32),
				reply: "",
				replyBlocks: [] as AssistantDraftTextBlock[],
				pageActions: [] as PageAction[],
				toolTraces: [] as ToolTraceEntry[],
				artifactIds: [] as string[],
				createdAt: nowIso(),
				aborted: false,
				targetWindowId,
				initialSelection: null,
				initialActiveTab: null,
				initialActiveUrl: "",
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
				const selectionFirstPdfQuestion = promptReferencesVisiblePdfSelectionOrPage(prompt);
				let pdfHandoff = await runExplicitPdfHandoffIfRequested(prompt, targetWindowId);
				if (!pdfHandoff && !selectionFirstPdfQuestion) {
					pdfHandoff = await runAutomaticPdfHandoffIfNeeded(targetWindowId);
				}
				let browserContextDetails = await renderBrowserContextDetails(host, {
					targetWindowId,
					includeVisualRegionImage: promptAsksAboutVisualRegion(prompt),
				});
				if (!pdfHandoff) {
					const unknownSelectionHandoff = await runUnknownPdfSelectionHandoffIfNeeded(prompt, browserContextDetails, targetWindowId);
					if (unknownSelectionHandoff) {
						pdfHandoff = unknownSelectionHandoff;
						const originalBrowserContextDetails = browserContextDetails;
						browserContextDetails = await renderBrowserContextDetails(host, {
							targetWindowId,
							includeVisualRegionImage: promptAsksAboutVisualRegion(prompt),
						});
						if (unknownPdfSelectionHandoffNeedsReselect(unknownSelectionHandoff, browserContextDetails)) {
							activeRequest.reply = buildUnknownPdfSelectionHandoffReply(unknownSelectionHandoff, originalBrowserContextDetails);
							activeRequest.initialSelection = browserContextDetails.selection;
							await finalizeRequest(session, requestId, null, []);
							return { requestId };
						}
					}
				}
				if (!browserContextDetails.visualRegion && shouldCaptureVisualRegionForPrompt(prompt, browserContextDetails)) {
					browserContextDetails = await renderBrowserContextDetails(host, {
						targetWindowId,
						includeVisualRegionImage: true,
					});
				}
				const pdfVisualCapture = await runPdfVisualCapturePreflight(prompt, browserContextDetails, targetWindowId, pdfHandoff);
				const pdfVisualCaptureContext = pdfVisualCapture?.dataUrl
					? `Captured PDF page image for visual grounding: p. ${pdfVisualCapture.pageNumber || pdfVisualCapture.page || "?"}. Use the attached PDF page image for visual parts of this answer; cite exact PDF text when available.`
					: "";
				const responseFormatRequirement = buildVisualResponseFormatRequirement(prompt, browserContextDetails, pdfVisualCapture);
				const browserContext = [browserContextDetails.text, pdfVisualCaptureContext].filter(Boolean).join("\n\n");
				const priorPageContext = buildPriorExtractedPageContext(session, browserContextDetails.activeTab, prompt);
				const existingAnchorContext = buildExistingAnchorContext(session);
				const sessionContext = [recentConversation, priorPageContext].filter(Boolean).join("\n\n");
				activeRequest.initialSelection = browserContextDetails.selection;
				activeRequest.initialActiveTab = browserContextDetails.activeTab || null;
				activeRequest.initialActiveUrl = String(browserContextDetails.activeTab?.url || "");
				const forcePdfTools = Boolean(pdfHandoff || browserContextLooksLikePdf(browserContextDetails));
				const firstPassPdfSelectionQuestion = selectionFirstPdfQuestion && browserContextLooksLikePdf(browserContextDetails);
				const toolSelectionOptions = {
					forcePdfTools,
					selectionFirstPdfQuestion,
					visiblePdfSelectionFirstPass: firstPassPdfSelectionQuestion,
					advancedRuntimeInspectionEnabled: requestSettings.advancedRuntimeInspectionEnabled,
					suppressExtractContent: Boolean(priorPageContext),
				};
				activeRequest.toolSelectionOptions = toolSelectionOptions;
				const tools = selectToolsForPrompt(
					createTools(
						host,
						artifactHooks,
						withRequestBrowserContext,
						(event) => recordLearningEventForSession(session, event, learningMode ? "learning" : "answer"),
						(toolName, toolCallId, _requestedParams, effectiveParams) => recordToolTraceEffectiveArgs(toolName, toolCallId, effectiveParams),
						(toolName, commandName, effectiveParams) =>
							buildRepeatedHighlightFailureGuardResult(toolName, commandName, activeRequest) ||
							buildPostHighlightFailureAnswerNowGuardResult(toolName, commandName, activeRequest) ||
							buildRepeatedViewportReadGuardResult(toolName, commandName, activeRequest) ||
							buildVisiblePdfSelectionFirstPassGuardResult(toolName, commandName, prompt, firstPassPdfSelectionQuestion, activeRequest?.toolTraces || []) ||
							buildTextbookContextReadyGuardResult(toolName, commandName, effectiveParams, activeRequest?.toolTraces || []) ||
							buildEmptyHighlightTextGuardResult(toolName, commandName, effectiveParams) ||
							buildWeakStructuredHighlightTextGuardResult(toolName, commandName, effectiveParams, prompt) ||
							buildWeakCompactTeachingHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
							buildNamedFormulaHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
							buildConceptLocationHighlightGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
							buildSurplusTeachingNoteGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildCompactTeachingNoteFailureGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildStructuredNoteBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildOptionalFrameFallbackNoteGuardResult(toolName, commandName, effectiveParams, prompt, activeRequest) ||
							buildCompactTeachingHighlightBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildStructuredHighlightBudgetGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildSurplusTeachingHighlightGuardResult(toolName, commandName, prompt, activeRequest) ||
							buildSurplusHighlightGuardResult(toolName, commandName, prompt, activeRequest),
						async (effectiveParams) => {
							if (!(effectiveParams as any)?.scanPage) return null;
							const text = compactActionText((effectiveParams as any)?.text);
							if (!text) return null;
							let tabId = Number((effectiveParams as any)?.tabId || activeRequest?.initialActiveTab?.id || 0);
							if (!Number.isFinite(tabId) || tabId <= 0) {
								const state = await host.snapshotState();
								tabId = Number(pickActiveTab(state, activeRequest?.targetWindowId)?.id || 0);
							}
							if (!Number.isFinite(tabId) || tabId <= 0) return null;
							return await highlightTextWithReplayCandidates(tabId, text, {
								...(effectiveParams || {}),
								scanPage: true,
								skipInitialAttempt: true,
								scrollIntoView: (effectiveParams as any)?.scrollIntoView !== false,
								pdfAnchor: (effectiveParams as any)?.pdfAnchor,
							});
						},
					),
					prompt,
					attachments,
					learningMode,
					session.learnerState,
					toolSelectionOptions,
				);

				activeAgent = new Agent({
					initialState: {
						systemPrompt: buildPromptEvalSystemPrompt(ONHAND_SYSTEM_PROMPT, promptEvalSystemAppend, promptEvalVariant),
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
							sessionContext,
							session.learnerState,
							existingAnchorContext,
							responseFormatRequirement,
							promptEvalLauncherAppend,
						),
						[
							...buildPromptImages(attachments),
							...buildVisualRegionPromptImages(browserContextDetails.visualRegion),
							...buildPdfPageImagePromptImages(pdfVisualCapture),
						],
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
			const targetAnnotationId =
				action.type === "note" && pairedHighlight?.annotationId ? compactActionText(pairedHighlight.annotationId) : compactActionText(action.annotationId);
			const targetKind = action.type === "note" ? "note" : "annotation";
			let directScrollMissed = false;
			if (targetAnnotationId && typeof tabId === "number") {
				try {
					const scrolled = await host.runCommand("scroll_to_annotation", {
						tabId,
						annotationId: targetAnnotationId,
						target: targetKind,
					});
					const scrolledAnnotation = scrolled?.annotation || scrolled;
					if (action.type !== "note" || scrolledAnnotation?.targetKind === "note" || scrolledAnnotation?.noteRect) {
						return action;
					}
					directScrollMissed = true;
				} catch {
					directScrollMissed = true;
					// The saved id can drift after a restored PDF annotation is
					// re-created. Fall through to the slower text/artifact replay.
				}
			}
			if (directScrollMissed && actionPdfAnchor && shouldFastJumpStalePdfAnchor(actionPdfAnchor) && typeof tabId === "number") {
				const anchorPage = Number(actionPdfAnchor.pageNumber || 0);
				if (Number.isFinite(anchorPage) && anchorPage > 0) {
					const jumpArgs = {
						tabId,
						pageNumber: anchorPage,
						...(actionPdfAnchor.occurrence ? { occurrence: actionPdfAnchor.occurrence } : {}),
						pdfAnchor: actionPdfAnchor,
					};
					try {
						await host.runCommand("pdf_jump_to_page", jumpArgs);
						return action;
					} catch {
						try {
							await host.runCommand("open_pdf_in_onhand_viewer", {
								tabId,
								pageNumber: anchorPage,
								initialPageSource: "saved-pdf-anchor",
								active: true,
								newTab: false,
								waitForLoad: true,
								forceReload: true,
								disableSelectionHandoff: true,
								timeoutMs: 15000,
							});
							await host.runCommand("pdf_jump_to_page", jumpArgs);
							return action;
						} catch {
							// If the viewer cannot jump by anchor yet, continue into the
							// slower restore/replay path below.
						}
					}
				}
			}
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
					if (action.type === "note" && targetAnnotationId && targetAnnotationId !== action.annotationId) {
						action.annotationId = targetAnnotationId;
						changed = true;
				}
				let noteShown = false;
				try {
					const scrolled = await host.runCommand("scroll_to_annotation", {
							tabId,
							annotationId: targetAnnotationId || action.annotationId,
							target: targetKind,
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
