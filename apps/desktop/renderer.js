const onhandApp = window.onhandApp;

const promptForm = document.getElementById("promptForm");
const promptInput = document.getElementById("promptInput");
const contextChip = document.getElementById("contextChip");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const selectionItem = document.getElementById("selectionItem");
const selectionPreview = document.getElementById("selectionPreview");
const replyItem = document.getElementById("replyItem");
const replyTitle = document.getElementById("replyTitle");
const replyBody = document.getElementById("replyBody");
const sessionList = document.getElementById("sessionList");
const newSessionButton = document.getElementById("newSessionButton");
const idleHint = document.getElementById("idleHint");
const statusText = document.getElementById("statusText");
const hotkeyHint = document.getElementById("hotkeyHint");
const newSessionHint = document.getElementById("newSessionHint");

let activeRequestId = null;
let activePromptLabel = "";
let activeReplyText = "";
let currentSessionFile = null;

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

function setStatus(text, kind = "") {
	statusText.textContent = text;
	statusText.className = `status-text${kind ? ` ${kind}` : ""}`;
}

function showReply(title, body) {
	replyTitle.textContent = title;
	replyBody.textContent = body;
	replyItem.classList.remove("hidden");
}

function hideReply() {
	replyItem.classList.add("hidden");
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

	if (sessions.length === 0) {
		idleHint.classList.remove("hidden");
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "No saved sessions yet. Your first launcher conversation will appear here.";
		sessionList.append(empty);
		return;
	}

	idleHint.classList.add("hidden");

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
					activePromptLabel = "";
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

function beginPromptUi(prompt, requestId) {
	activeRequestId = requestId;
	activePromptLabel = `Asked: ${truncate(prompt, 80)}`;
	activeReplyText = "";
	promptInput.disabled = true;
	showReply(activePromptLabel, "");
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

function handlePromptEvent(event) {
	if (!event?.requestId) return;
	if (activeRequestId && event.requestId !== activeRequestId) return;

	switch (event.type) {
		case "start": {
			beginPromptUi(event.prompt || activePromptLabel || "Onhand question", event.requestId);
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
		case "reply_delta": {
			activeReplyText = typeof event.reply === "string" ? event.reply : `${activeReplyText}${event.delta || ""}`;
			showReply(activePromptLabel || "Onhand", activeReplyText || "Thinking…");
			break;
		}
		case "complete": {
			activeReplyText = String(event.reply || activeReplyText || "(No reply generated.)");
			showReply(activePromptLabel || "Onhand", activeReplyText);
			setStatus("Reply ready", "ok");
			void finishPromptUi();
			break;
		}
		case "error": {
			showReply(activePromptLabel || "Onhand", `Error: ${event.message || "Unknown error"}`);
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

	activePromptLabel = `Asked: ${truncate(prompt, 80)}`;
	activeReplyText = "";
	promptInput.disabled = true;
	showReply(activePromptLabel, "");
	setStatus("Starting Onhand…");
	updateSessionControls();

	try {
		const result = await onhandApp.submitPrompt(prompt);
		activeRequestId = result.requestId;
		updateSessionControls();
	} catch (error) {
		const message = error?.message || String(error);
		showReply(activePromptLabel || "Onhand", `Error: ${message}`);
		setStatus("Prompt failed", "error");
		activeRequestId = null;
		promptInput.disabled = false;
		updateSessionControls();
		focusInputIfAvailable();
	}
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
				activePromptLabel = "";
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
