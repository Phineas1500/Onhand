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

For questions about the current page or already-open tabs, use browser tools first. Do not use bash, read, write, or edit to fetch, parse, or inspect the current page unless the browser tools have already failed or the user explicitly asks for filesystem or code help.

When the user asks for explanation, analysis, comparison, interpretation, proof sketch, significance, tradeoffs, or change over time, do not stop at the most literal surface reading of the page. Distinguish between the directly stated fact and the deeper explanation the user is actually asking for, such as causes, mechanisms, assumptions, structure, evidence, consequences, or why one case differs from another.

If the current page alone is too thin for that deeper answer, inspect other already-open tabs first. Use multiple tabs when that materially improves the explanation, especially when the user is asking "why", "how", "what explains the difference", "what does this imply", "how do these compare", or similar questions.

For grounded answers, each major explanatory claim should be supported by something the user can actually see on one of their open pages. Find the supporting passage first, then explain what it shows. Prefer quotes or very close paraphrases of the highlighted text when introducing the supporting evidence.

Do not use the current page merely as a jumping-off point for unsupported general knowledge. If the page does not support an important part of the answer, inspect another already-open tab. If the open tabs still do not support it, either leave that claim out or clearly mark it as a limited inference rather than presenting it as if the page said it.

Use introductions, abstracts, summaries, and headers to orient yourself, but do not stop there when the user is asking for a deeper answer. For "why", "how", "how much", "compare", "prove", "derive", "significance", "tradeoffs", or any detail-sensitive question, inspect the body sections, examples, methods, results, tables, side notes, or later discussion that actually carry the specifics. Prefer the more detailed supporting passage when it materially sharpens the answer.

When the user asks about content that is already open, do not stop at a detached answer when you can ground it visually. If you can identify the exact supporting passage on an existing page or tab, prefer this flow:
- switch to the most relevant already-open tab if needed
- highlight the exact supporting text
- add a short note near it that explains what the quoted passage supports
- scroll it into view
- save at most one browser artifact, after the final highlight/note state is in place, and only when replay or revisit value is genuinely useful. Most ordinary explanatory answers should not persist an artifact at all.
- if you need multiple highlights or notes on the same page, do them sequentially rather than in parallel; wait for one annotation step to finish before starting the next

Prefer the clearest answer-bearing text in the main content or page header. Avoid grounding on footer boilerplate, legal copy, or generic navigation text when a better passage is available. When you ground an answer on the page, leave at least one short explanatory note on the main supporting passage unless the page would clearly become cluttered. If you use multiple highlighted passages to support distinct major claims, prefer leaving a short note on each of those highlighted passages unless doing so would clearly overburden the page. Use multiple highlights/notes only when each one adds distinct explanatory value.

For a straightforward one-page explanatory answer, two or three strong supporting passages are usually enough. Once the main claims are grounded, stop gathering more evidence and answer. Only keep browsing, highlighting, or annotating beyond that when a later section adds a genuinely new part of the explanation.

Prefer readable browser extraction tools before ad hoc DOM spelunking. On articles, notes, textbooks, blogs, papers, and similar content-heavy pages, first gather the relevant body text in a readable form, then decide which passages actually support the answer. Use browser_run_js only when the normal browser tools cannot expose the needed section, structure, or text clearly enough.

Do not rush to an answer from one weak surface quote if the page has richer supporting detail lower down. It is acceptable to inspect a few relevant sections or open tabs first when that materially improves the explanation, as long as you stay grounded in what the user can actually see on those pages.

When highlighting, prefer short, distinctive visible spans from the supporting passage rather than long exact sentences or whole paragraphs. Choose the smallest phrase that still anchors the evidence clearly, but keep it self-contained: avoid dangling fragments, half-clauses, or tiny math lead-ins such as a few words before an equation. If the best evidence is expressed mathematically, prefer highlighting the nearby natural-language sentence or a fuller clause that states what the equation means, then explain the formal part in the note or answer.

Keep your reasoning focused on the conceptual interpretation of the page, not on repetitive tool mechanics. Do not narrate every DOM or extraction step unless it materially affects the answer.

Avoid navigating away from the current page unless the user explicitly asks. Keep replies concise and launcher-friendly by default, keep on-page notes short and explanatory, and use markdown emphasis sparingly. Bold only short phrases that truly need emphasis; do not bold whole bullets, sentences, or most of the answer.`;

const ONHAND_LEARNING_MODE_APPEND = `Learning mode is enabled for this request.

Your job is not only to answer, but to help the user learn from the material already on their screen.

When it fits the question:
- identify the prerequisite concept the question depends on; if the page contains a useful definition or setup passage, highlight that first and add a short "read this first" note before giving the main explanation
- for "why", "how", "what does this mean", "prove", "derive", or similarly explanatory questions, ask the user for one short prediction before revealing the full explanation when that would materially help understanding
- after a substantive explanation, add one short retrieval-check note such as "In your own words, what does this passage claim?" when the page can support that naturally
- name the likely misconception or wrong mental model implicit in the question and correct it explicitly
- prefer fewer, better-placed annotations; learning mode should feel more deliberate, not more cluttered

Do not force Socratic behavior on every prompt. If the user clearly wants a quick answer, already shows they know the prerequisite, or the question is simple and transactional, collapse back to a direct explanation.`;

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
		turns: [],
		currentTurnId: null,
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
	const openTabs = Array.isArray(context.openTabs) ? context.openTabs : [];
	if (openTabs.length > 0) {
		lines.push("Open tabs in the current browser window:");
		for (const candidateTab of openTabs) {
			const prefix = candidateTab.active ? "* " : "- ";
			lines.push(`${prefix}${candidateTab.title || "(untitled)"}${candidateTab.url ? ` — ${candidateTab.url}` : ""}`);
		}
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

function normalizePromptAttachments(attachments) {
	if (!Array.isArray(attachments)) return [];
	return attachments.filter((attachment) => attachment && typeof attachment === "object");
}

function buildAttachmentContext(attachments) {
	const normalizedAttachments = normalizePromptAttachments(attachments);
	if (!normalizedAttachments.length) return "";

	return normalizedAttachments
		.map((attachment) => {
			const safeName = String(attachment.name || "attachment").replace(/"/g, "&quot;");
			if (attachment.kind === "text" && typeof attachment.text === "string") {
				return `<file name="${safeName}">\n${attachment.text}\n</file>`;
			}
			if (attachment.kind === "image") {
				return `<file name="${safeName}"></file>`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}

function buildPromptImages(attachments) {
	return normalizePromptAttachments(attachments)
		.filter((attachment) => attachment.kind === "image" && typeof attachment.data === "string" && attachment.data.trim())
		.map((attachment) => ({
			type: "image",
			data: attachment.data,
			mimeType: attachment.mimeType || "image/png",
		}));
}

function buildLauncherPrompt(prompt, browserContext, attachments = [], options = {}) {
	const trimmedPrompt = String(prompt || "").trim();
	const attachmentContext = buildAttachmentContext(attachments);
	const learningMode = Boolean(options.learningMode);
	return [
		"The user invoked Onhand from the desktop launcher.",
		"",
		`User question:\n${trimmedPrompt || "(See attached files.)"}`,
		...(attachmentContext ? ["", "Attached files:", attachmentContext] : []),
		"",
		"Captured browser context right before the question:",
		renderBrowserContextForPrompt(browserContext),
		"",
		"Use this captured context as your starting point. Prefer already-open tabs and pages over navigation.",
		"If the user is asking for causes, changes over time, or a comparison between outcomes, look for enough evidence to answer the deeper question instead of restating the immediate page at face value.",
		"If another already-open tab would materially improve the answer, inspect it and synthesize across tabs before replying.",
		"Support each major claim with visible evidence from the user's open pages. Highlight the supporting passage first, then explain what it shows.",
		"If a claim is not supported by the open pages, inspect another open tab or clearly treat it as a limited inference rather than presenting it as page-backed fact.",
		"Use the intro, summary, or visible overview to orient yourself, but inspect the detailed sections that actually support the answer when the user needs specifics or explanation.",
		"When it would help the user understand the answer, point to it on the live page by switching tabs, highlighting exact text, adding a short note, scrolling it into view, and saving a browser artifact.",
		"Prefer the most informative visible passage or heading that answers the question; avoid footer/legal boilerplate when a better passage exists.",
		"Use markdown emphasis sparingly and only for short phrases that really matter.",
		...(learningMode ? ["", ONHAND_LEARNING_MODE_APPEND] : []),
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

function buildTurnsFromMessages(messages = []) {
	const turns = [];
	let pendingUser = null;

	for (const message of Array.isArray(messages) ? messages : []) {
		if (!message || typeof message !== "object") continue;
		if (message.role === "user") {
			pendingUser = message;
			continue;
		}
		if (message.role !== "assistant") continue;

		const reply = String(message.text || "").trim();
		if (pendingUser) {
			turns.push({
				id: pendingUser.id?.startsWith("user:") ? pendingUser.id.slice("user:".length) : `${turns.length + 1}`,
				userPrompt: pendingUser.text || "",
				reply,
				activities: [],
				pageActions: [],
				pending: Boolean(message.pending),
				error: Boolean(message.error),
				createdAt: pendingUser.createdAt || message.createdAt || new Date().toISOString(),
			});
			pendingUser = null;
			continue;
		}

		if (reply) {
			turns.push({
				id: message.id?.startsWith("assistant:") ? message.id.slice("assistant:".length) : `${turns.length + 1}`,
				userPrompt: "",
				reply,
				activities: [],
				pageActions: [],
				pending: Boolean(message.pending),
				error: Boolean(message.error),
				createdAt: message.createdAt || new Date().toISOString(),
			});
		}
	}

	return turns;
}

function archiveCurrentTurnIntoHistory(state = uiState) {
	const turnId = state?.currentTurnId;
	if (!turnId || state?.activeRequestId === turnId) {
		return Array.isArray(state?.turns) ? [...state.turns] : [];
	}
	const existingTurns = Array.isArray(state?.turns) ? [...state.turns] : [];
	if (existingTurns.some((turn) => turn?.id === turnId)) {
		return existingTurns;
	}

	const userMessage = Array.isArray(state?.messages)
		? state.messages.find((message) => message?.id === `user:${turnId}`)
		: null;
	const assistantMessage = Array.isArray(state?.messages)
		? state.messages.find((message) => message?.id === `assistant:${turnId}`)
		: null;
	const reply = String(assistantMessage?.text || "").trim();
	const userPrompt = String(userMessage?.text || "").trim();
	const hasVisuals = Array.isArray(state?.activities) && state.activities.length > 0 || Array.isArray(state?.pageActions) && state.pageActions.length > 0;
	if (!reply && !userPrompt && !hasVisuals) {
		return existingTurns;
	}

	existingTurns.push({
		id: turnId,
		userPrompt,
		reply,
		activities: Array.isArray(state?.activities) ? [...state.activities] : [],
		pageActions: Array.isArray(state?.pageActions) ? [...state.pageActions] : [],
		pending: false,
		error: Boolean(assistantMessage?.error),
		createdAt: userMessage?.createdAt || assistantMessage?.createdAt || new Date().toISOString(),
	});
	return existingTurns;
}

function emitRequestEvent(payload) {
	activeRequest?.onEvent(payload);
}

function normalizeComparableText(value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function preserveCurrentTurnMessageIds(messages, currentTurnId, previousMessages = []) {
	if (!currentTurnId || !Array.isArray(messages) || !messages.length) {
		return Array.isArray(messages) ? messages : [];
	}

	const nextMessages = messages.map((message) => ({ ...message }));
	const previousUserMessage = Array.isArray(previousMessages)
		? previousMessages.find((message) => message?.id === `user:${currentTurnId}`)
		: null;
	const previousAssistantMessage = Array.isArray(previousMessages)
		? previousMessages.find((message) => message?.id === `assistant:${currentTurnId}`)
		: null;
	const targetUserText = normalizeComparableText(previousUserMessage?.text);
	if (!targetUserText) return nextMessages;

	const matchingUserIndex = nextMessages.findLastIndex(
		(message) => message?.role === "user" && normalizeComparableText(message?.text) === targetUserText,
	);
	if (matchingUserIndex < 0) return nextMessages;

	nextMessages[matchingUserIndex] = {
		...nextMessages[matchingUserIndex],
		id: `user:${currentTurnId}`,
		createdAt: nextMessages[matchingUserIndex].createdAt || previousUserMessage?.createdAt,
	};

	const matchingAssistantIndex = nextMessages.findIndex((message, index) => {
		if (index <= matchingUserIndex) return false;
		if (message?.role === "user") return false;
		return message?.role === "assistant";
	});
	const userBeforeAssistantIndex =
		matchingAssistantIndex >= 0
			? nextMessages.findIndex(
					(message, index) => index > matchingUserIndex && index < matchingAssistantIndex && message?.role === "user",
				)
			: -1;
	if (matchingAssistantIndex >= 0 && userBeforeAssistantIndex < 0) {
		nextMessages[matchingAssistantIndex] = {
			...nextMessages[matchingAssistantIndex],
			id: `assistant:${currentTurnId}`,
			createdAt: nextMessages[matchingAssistantIndex].createdAt || previousAssistantMessage?.createdAt,
		};
	} else if (previousAssistantMessage) {
		nextMessages.push({
			...previousAssistantMessage,
			id: `assistant:${currentTurnId}`,
			pending: false,
		});
	}

	return nextMessages;
}

function syncUiStateFromSession(session, overrides = {}) {
	const currentSession = buildSessionState(session);
	const sessionMessages = buildConversationMessagesFromAgent(session.agent.state.messages);
	const sameSession = uiState.currentSession?.sessionFile && currentSession.sessionFile && uiState.currentSession.sessionFile === currentSession.sessionFile;
	const messages =
		sameSession && uiState.currentTurnId
			? preserveCurrentTurnMessageIds(sessionMessages, uiState.currentTurnId, uiState.messages)
			: sessionMessages;
	replaceUiState({
		...createEmptyUiState(currentSession),
		turns: sameSession ? [...(uiState.turns || [])] : buildTurnsFromMessages(messages),
		currentTurnId: sameSession ? uiState.currentTurnId : null,
		messages,
		...overrides,
	});
}

function beginUiRequest(session, requestId, prompt) {
	const currentSession = buildSessionState(session);
	const previousMessages = buildConversationMessagesFromAgent(session.agent.state.messages);
	const previousTurns = archiveCurrentTurnIntoHistory();
	const now = new Date().toISOString();
	replaceUiState({
		currentSession,
		turns: previousTurns,
		currentTurnId: requestId,
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

export async function primeOnhandUiRequest(requestId, prompt, status = "Collecting browser context…") {
	const currentSession = (await getCurrentRuntimeSessionState()) || uiState.currentSession || null;
	const previousMessages = Array.isArray(uiState.messages)
		? uiState.messages.filter((message) => message.id !== `user:${requestId}` && message.id !== `assistant:${requestId}`)
		: [];
	const previousTurns = archiveCurrentTurnIntoHistory();
	const now = new Date().toISOString();

	replaceUiState({
		currentSession,
		turns: previousTurns,
		currentTurnId: requestId,
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
		status,
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

function removeUiActivity(activityId) {
	mutateUiState((state) => {
		state.activities = state.activities.filter((entry) => entry.id !== activityId);
	});
}

function setUiStatus(status) {
	mutateUiState((state) => {
		state.status = status;
	});
}

function getToolActivityId(event) {
	return `tool:${event.toolCallId || event.toolName}`;
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
	const browserClientId = activeRequest?.browserClientId || null;
	switch (toolName) {
		case "browser_activate_tab": {
			const detail = truncate(details.tab?.title || details.tab?.url || "Relevant page", 72);
			return {
				key: `tab:${details.tab?.id || detail}`,
				type: "tab",
				clientId: browserClientId,
				tabId: details.tab?.id || null,
				windowId: details.tab?.windowId || null,
				label: "Switched tab",
				detail,
			};
		}
		case "browser_highlight_text": {
			const matchedTextFull = String(details.annotation?.matchedText || "").trim();
			const matchedText = truncate(matchedTextFull || "Relevant passage", 72);
			return {
				key: `highlight:${details.annotation?.annotationId || matchedText}`,
				type: "annotation",
				clientId: browserClientId,
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
				clientId: browserClientId,
				tabId: tab?.id || null,
				windowId: tab?.windowId || null,
				annotationId: details.note?.annotationId || null,
				label: "Added note",
				detail: noteText,
				citationText: noteTextFull || noteText,
			};
		}
		case "browser_scroll_to_annotation": {
			return {
				key: `scroll:${details.annotation?.annotationId || result?.toolCallId || Date.now()}`,
				type: "annotation",
				clientId: browserClientId,
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

function removePageActions(predicate) {
	if (!activeRequest) return;
	const nextActions = activeRequest.pageActions.filter((action) => !predicate(action));
	if (nextActions.length === activeRequest.pageActions.length) return;
	activeRequest.pageActions = nextActions;
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
				id: getToolActivityId(event),
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
			const activityId = getToolActivityId(event);
			if (event.isError) {
				removeUiActivity(activityId);
				emitRequestEvent({ type: "status", status: "Trying a different approach…" });
				setUiStatus("Trying a different approach…");
			} else {
				const resultDetails = event.result?.details || {};
				const resultTabId = resultDetails.tab?.id ?? null;
				if (
					(event.toolName === "browser_highlight_text" && resultDetails.clearExisting !== false && resultTabId != null) ||
					(event.toolName === "browser_clear_annotations" && resultTabId != null)
				) {
					removePageActions(
						(action) =>
							action?.tabId === resultTabId && (action.type === "annotation" || action.type === "note"),
					);
				}
				appendUiActivity({
					id: activityId,
					kind: "tool",
					label: getToolStatusMessage(event.toolName),
					toolName: event.toolName,
					state: "complete",
				});
				pushPageAction(buildPageAction(event.toolName, event.result));
				emitRequestEvent({ type: "status", status: "Writing answer…" });
				setUiStatus("Writing answer…");
			}
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
			const finalStatus = activeRequest.aborted ? "Stopped" : "Reply ready";
			syncUiStateFromSession(session, {
				activities: [...uiState.activities],
				pageActions: [...activeRequest.pageActions],
				status: finalStatus,
				activeRequestId: null,
			});
			emitRequestEvent({
				type: "complete",
				reply,
				actions: [...activeRequest.pageActions],
				aborted: activeRequest.aborted,
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

export async function stopOnhandRun() {
	const { session } = await ensureRuntime();
	if (!activeRequest) {
		throw new Error("Onhand is not currently responding.");
	}
	activeRequest.aborted = true;
	setUiStatus("Stopping…");
	await session.abort();
	return {
		stopped: true,
		currentSession: buildSessionState(session),
	};
}

export async function submitOnhandPrompt({
	requestId,
	prompt,
	displayPrompt,
	attachments = [],
	browserContext,
	browserClientId = null,
	learningMode = false,
	onEvent,
}) {
	const { session } = await ensureRuntime();
	if (activeRequest) {
		throw new Error("Onhand is already responding. Please wait for the current reply to finish.");
	}
	const promptLabel = String(displayPrompt || prompt || "").trim() || "Attached files";
	if (!session.sessionName && session.messages.length === 0) {
		session.setSessionName(buildSessionTitleFromPrompt(promptLabel));
	}

	activeRequest = {
		id: requestId,
		onEvent,
		reply: "",
		reasoning: "",
		pageActions: [],
		toolExecutionCount: 0,
		aborted: false,
		browserClientId,
	};
	beginUiRequest(session, requestId, promptLabel);

	onEvent({
		type: "status",
		status: "Starting Onhand…",
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
		sessionName: session.sessionName || null,
	});

	const previousBridgeClientId = process.env.PI_BROWSER_BRIDGE_CLIENT_ID;
	if (browserClientId) {
		process.env.PI_BROWSER_BRIDGE_CLIENT_ID = browserClientId;
	} else {
		delete process.env.PI_BROWSER_BRIDGE_CLIENT_ID;
	}

	try {
		await session.prompt(buildLauncherPrompt(prompt, browserContext, attachments, { learningMode }), {
			images: buildPromptImages(attachments),
		});
		if (activeRequest?.id === requestId) {
			const reply = activeRequest.reply.trim() || "(No reply generated.)";
			const finalStatus = activeRequest.aborted ? "Stopped" : "Reply ready";
			syncUiStateFromSession(session, {
				activities: [...uiState.activities],
				pageActions: [...activeRequest.pageActions],
				status: finalStatus,
				activeRequestId: null,
			});
			onEvent({
				type: "complete",
				reply,
				actions: [...activeRequest.pageActions],
				aborted: activeRequest.aborted,
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
		const isAbortError =
			Boolean(activeRequest?.id === requestId && activeRequest?.aborted) ||
			/abort|cancel/i.test(String(error?.message || ""));
		if (activeRequest?.id === requestId && isAbortError) {
			const reply = activeRequest.reply.trim() || "(Run stopped.)";
			updateAssistantDraft(requestId, reply, { pending: false });
			syncUiStateFromSession(session, {
				activities: [...uiState.activities],
				pageActions: [...activeRequest.pageActions],
				status: "Stopped",
				activeRequestId: null,
			});
			onEvent({
				type: "complete",
				reply,
				actions: [...activeRequest.pageActions],
				aborted: true,
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
				sessionName: session.sessionName || null,
			});
			activeRequest = null;
			return {
				requestId,
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
				sessionName: session.sessionName || null,
			};
		}
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
	} finally {
		if (previousBridgeClientId) {
			process.env.PI_BROWSER_BRIDGE_CLIENT_ID = previousBridgeClientId;
		} else {
			delete process.env.PI_BROWSER_BRIDGE_CLIENT_ID;
		}
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
