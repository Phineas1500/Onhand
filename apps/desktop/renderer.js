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

function setUnavailableState(message) {
	contextChip.textContent = "Unavailable";
	contextChip.className = "context-chip error";
	pageTitle.textContent = "Onhand desktop bridge unavailable";
	pageSubtitle.textContent = message;
	setStatus("Unavailable", "error");
	selectionItem.classList.add("hidden");
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

function renderContext(context) {
	if (!context?.ok) {
		setStatus("Bridge unavailable", "error");
		contextChip.textContent = "No browser";
		contextChip.className = "context-chip error";
		pageTitle.textContent = "Could not reach the browser bridge";
		pageSubtitle.textContent = context?.error || "Start the bridge and reconnect the browser extension.";
		selectionItem.classList.add("hidden");
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
	if (!subtitleParts.length) subtitleParts.push(connectionCount > 0 ? "Ready to ask about the current browser page." : "Waiting for a connected browser tab.");

	contextChip.textContent = hostname || (tab ? "Current tab" : "No active tab");
	contextChip.className = "context-chip";
	pageTitle.textContent = tab?.title || "No active browser tab";
	pageSubtitle.textContent = subtitleParts.join(" · ");
	setStatus(connectionCount > 0 ? "Ready" : "Waiting for browser connection", connectionCount > 0 ? "ok" : "");

	if (hasSelection) {
		selectionPreview.textContent = truncate(context.selection.text, 220);
		selectionItem.classList.remove("hidden");
	} else {
		selectionItem.classList.add("hidden");
	}
}

async function refreshContext() {
	setStatus("Refreshing context…");
	const context = await onhandApp.refreshContext();
	renderContext(context);
	return context;
}

promptForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) return;

	promptInput.disabled = true;
	setStatus("Collecting context…");
	showReply(`Asked: ${truncate(prompt, 80)}`, "Collecting current page context…");

	try {
		const result = await onhandApp.submitPrompt(prompt);
		showReply(`Asked: ${truncate(prompt, 80)}`, result.reply);
		renderContext(result.context);
		setStatus("Reply ready", "ok");
		promptInput.value = "";
	} catch (error) {
		const message = error?.message || String(error);
		showReply(`Asked: ${truncate(prompt, 80)}`, `Error: ${message}`);
		setStatus("Prompt failed", "error");
	} finally {
		promptInput.disabled = false;
		promptInput.focus();
	}
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		onhandApp.hideWindow({ restorePreviousApp: true });
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		promptInput.focus();
		promptInput.select();
	}
});

onhandApp.onFocusInput(() => {
	promptInput.focus();
	promptInput.select();
});

onhandApp.onPaletteOpened(() => {
	refreshContext().catch((error) => {
		setStatus("Refresh failed", "error");
		pageTitle.textContent = "Could not refresh browser context";
		pageSubtitle.textContent = error?.message || String(error);
		selectionItem.classList.add("hidden");
	});
	promptInput.focus();
	promptInput.select();
});

hideReply();
try {
	await refreshContext();
} catch (error) {
	setUnavailableState(error?.message || String(error));
}
