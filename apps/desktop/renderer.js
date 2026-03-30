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
const idleHint = document.getElementById("idleHint");
const statusText = document.getElementById("statusText");
const hotkeyHint = document.getElementById("hotkeyHint");

let activeRequestId = null;
let activePromptLabel = "";
let activeReplyText = "";

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
	idleHint.classList.add("hidden");
}

function hideReply() {
	replyItem.classList.add("hidden");
	idleHint.classList.remove("hidden");
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

hotkeyHint.textContent = formatHotkey(startupState.hotkey, startupState.platform);

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
}

function finishPromptUi() {
	activeRequestId = null;
	promptInput.disabled = false;
	promptInput.value = "";
	focusInputIfAvailable();
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
			finishPromptUi();
			break;
		}
		case "error": {
			showReply(activePromptLabel || "Onhand", `Error: ${event.message || "Unknown error"}`);
			setStatus("Prompt failed", "error");
			finishPromptUi();
			break;
		}
		default:
			break;
	}
}

promptForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) return;
	if (activeRequestId) return;

	activePromptLabel = `Asked: ${truncate(prompt, 80)}`;
	activeReplyText = "";
	promptInput.disabled = true;
	showReply(activePromptLabel, "");
	setStatus("Starting Onhand…");

	try {
		const result = await onhandApp.submitPrompt(prompt);
		activeRequestId = result.requestId;
	} catch (error) {
		const message = error?.message || String(error);
		showReply(activePromptLabel || "Onhand", `Error: ${message}`);
		setStatus("Prompt failed", "error");
		activeRequestId = null;
		promptInput.disabled = false;
		focusInputIfAvailable();
	}
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		onhandApp.hideWindow({ restorePreviousApp: true });
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		focusInputIfAvailable();
	}
});

onhandApp.onFocusInput(() => {
	focusInputIfAvailable();
});

onhandApp.onPaletteOpened(() => {
	refreshContext().catch((error) => {
		setStatus("Refresh failed", "error");
		pageTitle.textContent = "Could not refresh browser context";
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
	await refreshContext();
} catch (error) {
	setUnavailableState(error?.message || String(error));
}
