const onhandApp = window.onhandApp;

const promptForm = document.getElementById("promptForm");
const promptInput = document.getElementById("promptInput");
const contextChip = document.getElementById("contextChip");
const learningModeToggle = document.getElementById("learningModeToggle");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const selectionItem = document.getElementById("selectionItem");
const selectionPreview = document.getElementById("selectionPreview");
const replyItem = document.getElementById("replyItem");
const replyTitle = document.getElementById("replyTitle");
const replyBody = document.getElementById("replyBody");
const replyActionsWrap = document.getElementById("replyActionsWrap");
const replyActions = document.getElementById("replyActions");
const sessionList = document.getElementById("sessionList");
const newSessionButton = document.getElementById("newSessionButton");
const idleHint = document.getElementById("idleHint");
const statusText = document.getElementById("statusText");
const hotkeyHint = document.getElementById("hotkeyHint");
const newSessionHint = document.getElementById("newSessionHint");

let activeRequestId = null;
let activePromptText = "";
let activeReplyText = "";
let activePageActions = [];
let currentSessionFile = null;
let currentSessionCount = 0;
let learningModeEnabled = false;

function truncate(text, maxChars = 180) {
	const value = String(text || "").replace(/\s+/g, " ").trim();
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars - 1)}…`;
}

function getHostname(url) {
	try {
		return new URL(String(url || "")).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text) {
	let html = escapeHtml(text);
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
	return html;
}

function renderReplyMarkdown(text) {
	const source = String(text || "").replace(/\r\n?/g, "\n");
	if (!source.trim()) {
		return '<p class="answer-placeholder">Thinking…</p>';
	}

	const lines = source.split("\n");
	const parts = [];
	let paragraphLines = [];
	let listItems = [];

	function flushParagraph() {
		if (!paragraphLines.length) return;
		parts.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
		paragraphLines = [];
	}

	function flushList() {
		if (!listItems.length) return;
		parts.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
		listItems = [];
	}

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			flushParagraph();
			flushList();
			continue;
		}

		const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
		if (headingMatch) {
			flushParagraph();
			flushList();
			const level = Math.min(4, headingMatch[1].length + 1);
			parts.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
			continue;
		}

		const unorderedListMatch = trimmed.match(/^[-*]\s+(.*)$/);
		if (unorderedListMatch) {
			flushParagraph();
			listItems.push(unorderedListMatch[1]);
			continue;
		}

		const orderedListMatch = trimmed.match(/^\d+\.\s+(.*)$/);
		if (orderedListMatch) {
			flushParagraph();
			listItems.push(orderedListMatch[1]);
			continue;
		}

		paragraphLines.push(trimmed);
	}

	flushParagraph();
	flushList();

	return parts.join("") || `<p>${renderInlineMarkdown(source)}</p>`;
}

function setStatus(text, kind = "") {
	statusText.textContent = text;
	statusText.className = `status-text${kind ? ` ${kind}` : ""}`;
}

function renderLearningModeToggle() {
	if (!(learningModeToggle instanceof HTMLInputElement)) return;
	learningModeToggle.checked = learningModeEnabled;
	learningModeToggle.closest(".mode-toggle")?.classList.toggle("active", learningModeEnabled);
	learningModeToggle.disabled = Boolean(activeRequestId);
}

function normalizePageActions(actions) {
	const items = Array.isArray(actions) ? actions : [];
	const seen = new Set();
	const normalized = [];
	for (const action of items) {
		if (!action || typeof action !== "object") continue;
		const label = truncate(action.label || action.title || "Action", 50);
		const detail = action.detail ? truncate(action.detail, 72) : "";
		const key = action.key || `${label}:${detail}`;
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push({ key, label, detail });
	}
	return normalized;
}

function renderReplyActions() {
	replyActions.replaceChildren();
	if (!activePageActions.length) {
		replyActionsWrap.classList.add("hidden");
		return;
	}

	for (const action of activePageActions) {
		const pill = document.createElement("div");
		pill.className = "answer-action-pill";
		pill.textContent = action.detail ? `${action.label} · ${action.detail}` : action.label;
		if (action.detail) pill.title = action.detail;
		replyActions.append(pill);
	}

	replyActionsWrap.classList.remove("hidden");
}

function syncIdleHint() {
	idleHint.classList.toggle("hidden", currentSessionCount > 0 || !replyItem.classList.contains("hidden"));
}

function showReply(question, body) {
	replyTitle.textContent = question || "Latest reply";
	replyBody.innerHTML = renderReplyMarkdown(body);
	replyItem.classList.remove("hidden");
	renderReplyActions();
	syncIdleHint();
}

function hideReply() {
	replyItem.classList.add("hidden");
	replyTitle.textContent = "Latest reply";
	replyBody.innerHTML = "";
	activePageActions = [];
	renderReplyActions();
	syncIdleHint();
}

function focusInputIfAvailable() {
	if (promptInput.disabled) return;
	promptInput.focus();
	promptInput.select();
}

function setUnavailableState(message) {
	contextChip.textContent = "Unavailable";
	contextChip.className = "context-chip error";
	pageTitle.textContent = "Onhand desktop bridge unavailable";
	pageSubtitle.textContent = message;
	selectionItem.classList.add("hidden");
	setStatus("Unavailable", "error");
}

if (!onhandApp) {
	setUnavailableState("The preload bridge did not initialize.");
	throw new Error("window.onhandApp is unavailable");
}

const startupState = await onhandApp.getStartupState();
learningModeEnabled = Boolean(startupState?.learningMode);
renderLearningModeToggle();

function formatHotkey(accelerator, platform) {
	const value = String(accelerator || "");
	if (platform === "darwin") {
		return value
			.replace(/CommandOrControl/g, "⌘")
			.replace(/Command/g, "⌘")
			.replace(/Control/g, "⌃")
			.replace(/Shift/g, "⇧")
			.replace(/Alt|Option/g, "⌥")
			.replace(/Enter/g, "↩")
			.replace(/\+/g, "");
	}
	return value.replace(/CommandOrControl/g, "Ctrl");
}

function formatRelativeTime(timestamp) {
	if (!timestamp) return "Recent";
	const deltaSeconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1000);
	const absSeconds = Math.abs(deltaSeconds);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	if (absSeconds < 60) return rtf.format(Math.round(deltaSeconds), "second");
	if (absSeconds < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
	if (absSeconds < 86400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
	if (absSeconds < 604800) return rtf.format(Math.round(deltaSeconds / 86400), "day");
	return rtf.format(Math.round(deltaSeconds / 604800), "week");
}

hotkeyHint.textContent = formatHotkey(startupState.hotkey, startupState.platform);
newSessionHint.textContent = startupState.platform === "darwin" ? "⌘N new" : "Ctrl+N new";

function updateSessionControls() {
	newSessionButton.disabled = Boolean(activeRequestId);
	renderLearningModeToggle();
}

function renderContext(context, options = {}) {
	const preserveStatus = Boolean(options.preserveStatus);

	if (!context?.ok) {
		contextChip.textContent = "No browser";
		contextChip.className = "context-chip error";
		pageTitle.textContent = "Could not reach the browser bridge";
		pageSubtitle.textContent = context?.error || "Start the bridge and reconnect the browser extension.";
		selectionItem.classList.add("hidden");
		if (!preserveStatus) setStatus("Bridge unavailable", "error");
		return;
	}

	const tab = context.activeTab;
	const hostname = getHostname(tab?.url);
	const connectionCount = Number(context?.bridge?.connectedClients || 0);
	const hasSelection = Boolean(context?.selection?.hasSelection && context?.selection?.text);
	const subtitleParts = [];

	if (hostname) subtitleParts.push(hostname);
	if (context.warning) subtitleParts.push(truncate(context.warning, 120));
	if (!hostname && tab?.url) subtitleParts.push(truncate(tab.url, 120));
	if (!subtitleParts.length) {
		subtitleParts.push(
			connectionCount > 0 ? "Ready to ask about the current browser page." : "Waiting for a connected browser tab.",
		);
	}

	contextChip.textContent = hostname || (tab ? "Current tab" : "No active tab");
	contextChip.className = "context-chip";
	pageTitle.textContent = tab?.title || "No active browser tab";
	pageSubtitle.textContent = subtitleParts.join(" · ");
	if (!preserveStatus) {
		setStatus(connectionCount > 0 ? "Ready" : "Waiting for browser connection", connectionCount > 0 ? "ok" : "");
	}

	if (hasSelection) {
		selectionPreview.textContent = truncate(context.selection.text, 220);
		selectionItem.classList.remove("hidden");
	} else {
		selectionItem.classList.add("hidden");
	}
}

function renderSessions(overview) {
	sessionList.replaceChildren();
	currentSessionFile = overview?.currentSession?.sessionFile || overview?.sessions?.find((session) => session.isCurrent)?.path || null;
	const sessions = Array.isArray(overview?.sessions) ? overview.sessions : [];
	currentSessionCount = sessions.length;

	if (sessions.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "No saved sessions yet. Your first launcher conversation will appear here.";
		sessionList.append(empty);
		syncIdleHint();
		return;
	}

	for (const session of sessions) {
		const item = document.createElement("div");
		item.className = `list-item session-item${session.isCurrent ? " current" : ""}`;
		item.tabIndex = 0;
		item.setAttribute("role", "button");
		item.dataset.path = session.path;

		const icon = document.createElement("div");
		icon.className = "item-icon";
		icon.textContent = session.isCurrent ? "●" : "◦";

		const content = document.createElement("div");
		content.className = "item-content";

		const title = document.createElement("div");
		title.className = "item-title";
		title.textContent = session.title;

		const subtitle = document.createElement("div");
		subtitle.className = "item-subtitle";
		subtitle.textContent = session.preview;

		const meta = document.createElement("div");
		meta.className = "item-meta";
		meta.textContent = session.isCurrent ? "Current" : formatRelativeTime(session.modifiedAt);

		content.append(title, subtitle);
		item.append(icon, content, meta);

		const activate = async () => {
			if (activeRequestId || session.isCurrent) return;
			setStatus("Switching session…");
			promptInput.disabled = true;
			try {
				const result = await onhandApp.switchSession(session.path);
				if (result?.switched) {
					hideReply();
					activePromptText = "";
					activeReplyText = "";
					promptInput.value = "";
					setStatus(`Switched to ${session.title}`, "ok");
					await refreshSessions();
				}
			} catch (error) {
				setStatus(error?.message || String(error), "error");
			} finally {
				promptInput.disabled = Boolean(activeRequestId);
				updateSessionControls();
				focusInputIfAvailable();
			}
		};

		item.addEventListener("click", () => {
			void activate();
		});
		item.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				void activate();
			}
		});

		sessionList.append(item);
	}

	syncIdleHint();
}

async function refreshSessions() {
	const overview = await onhandApp.listSessions(2);
	renderSessions(overview);
	updateSessionControls();
	return overview;
}

async function refreshContext() {
	if (!activeRequestId) setStatus("Refreshing context…");
	const context = await onhandApp.refreshContext();
	renderContext(context, { preserveStatus: Boolean(activeRequestId) });
	return context;
}

function primePromptUi(prompt) {
	activePromptText = truncate(prompt, 160);
	activeReplyText = "";
	activePageActions = [];
	promptInput.disabled = true;
	showReply(activePromptText, "");
	setStatus("Starting Onhand…");
	updateSessionControls();
}

function beginPromptUi(prompt, requestId) {
	activeRequestId = requestId;
	if (!activePromptText) {
		activePromptText = truncate(prompt, 160);
	}
	showReply(activePromptText || "Onhand question", activeReplyText);
	setStatus("Starting Onhand…");
	updateSessionControls();
}

async function finishPromptUi(options = {}) {
	activeRequestId = null;
	promptInput.disabled = false;
	promptInput.value = "";
	updateSessionControls();
	await refreshSessions().catch(() => {});
	if (options.focus !== false) focusInputIfAvailable();
}

function setPageActions(actions) {
	activePageActions = normalizePageActions(actions);
	renderReplyActions();
}

function handlePromptEvent(event) {
	if (!event?.requestId) return;
	if (activeRequestId && event.requestId !== activeRequestId) return;

	switch (event.type) {
		case "start": {
			beginPromptUi(event.prompt || activePromptText || "Onhand question", event.requestId);
			break;
		}
		case "context": {
			renderContext(event.context, { preserveStatus: true });
			break;
		}
		case "status": {
			setStatus(event.status || "Working…");
			break;
		}
		case "page_actions": {
			setPageActions(event.actions || []);
			break;
		}
		case "reply_delta": {
			activeReplyText = typeof event.reply === "string" ? event.reply : `${activeReplyText}${event.delta || ""}`;
			showReply(activePromptText || "Onhand", activeReplyText);
			break;
		}
		case "complete": {
			if (Array.isArray(event.actions)) {
				setPageActions(event.actions);
			}
			activeReplyText = String(event.reply || activeReplyText || "(No reply generated.)");
			showReply(activePromptText || "Onhand", activeReplyText);
			setStatus("Reply ready", "ok");
			void finishPromptUi();
			break;
		}
		case "error": {
			if (Array.isArray(event.actions)) {
				setPageActions(event.actions);
			}
			showReply(activePromptText || "Onhand", `Error: ${event.message || "Unknown error"}`);
			setStatus("Prompt failed", "error");
			void finishPromptUi();
			break;
		}
		default:
			break;
	}
}

promptForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt || activeRequestId) return;

	primePromptUi(prompt);

	try {
		const result = await onhandApp.submitPrompt({
			prompt,
			displayPrompt: prompt,
			learningMode: learningModeEnabled,
			source: "desktop",
		});
		activeRequestId = result.requestId;
		updateSessionControls();
		void onhandApp.hideWindow({ restorePreviousApp: true }).catch(() => {});
	} catch (error) {
		const message = error?.message || String(error);
		showReply(activePromptText || "Onhand", `Error: ${message}`);
		setStatus("Prompt failed", "error");
		activeRequestId = null;
		promptInput.disabled = false;
		updateSessionControls();
		focusInputIfAvailable();
	}
});

learningModeToggle?.addEventListener("change", () => {
	const nextValue = Boolean(learningModeToggle.checked);
	learningModeEnabled = nextValue;
	renderLearningModeToggle();
	void onhandApp.setLearningMode(nextValue).catch((error) => {
		learningModeEnabled = !nextValue;
		renderLearningModeToggle();
		setStatus(error?.message || String(error), "error");
	});
});

newSessionButton.addEventListener("click", () => {
	if (activeRequestId) return;
	promptInput.disabled = true;
	updateSessionControls();
	setStatus("Starting new session…");
	void onhandApp
		.newSession()
		.then(async (result) => {
			if (result?.created) {
				hideReply();
				activePromptText = "";
				activeReplyText = "";
				promptInput.value = "";
				setStatus("New session ready", "ok");
				await refreshSessions();
			}
		})
		.catch((error) => {
			setStatus(error?.message || String(error), "error");
		})
		.finally(() => {
			promptInput.disabled = Boolean(activeRequestId);
			updateSessionControls();
			focusInputIfAvailable();
		});
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		onhandApp.hideWindow({ restorePreviousApp: true });
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		focusInputIfAvailable();
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
		event.preventDefault();
		newSessionButton.click();
	}
});

onhandApp.onFocusInput(() => {
	focusInputIfAvailable();
});

onhandApp.onPaletteOpened(() => {
	Promise.all([refreshContext(), refreshSessions()]).catch((error) => {
		setStatus("Refresh failed", "error");
		pageTitle.textContent = "Could not refresh launcher state";
		pageSubtitle.textContent = error?.message || String(error);
		selectionItem.classList.add("hidden");
	});
	focusInputIfAvailable();
});

onhandApp.onPromptEvent((event) => {
	handlePromptEvent(event);
});

hideReply();
try {
	await Promise.all([refreshContext(), refreshSessions()]);
} catch (error) {
	setUnavailableState(error?.message || String(error));
}
