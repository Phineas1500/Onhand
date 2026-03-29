const startupState = await window.onhandApp.getStartupState();

const statusPill = document.getElementById("statusPill");
const refreshButton = document.getElementById("refreshButton");
const promptForm = document.getElementById("promptForm");
const promptInput = document.getElementById("promptInput");
const hotkeyHint = document.getElementById("hotkeyHint");
const transcript = document.getElementById("transcript");
const contextSummary = document.getElementById("contextSummary");

hotkeyHint.textContent = `Temporary global shortcut: ${startupState.hotkey}`;

function addMessage(role, text) {
	const wrapper = document.createElement("div");
	wrapper.className = `message ${role}`;

	const roleEl = document.createElement("div");
	roleEl.className = "message-role";
	roleEl.textContent = role === "user" ? "You" : "Onhand";

	const bodyEl = document.createElement("div");
	bodyEl.className = "message-body";
	bodyEl.textContent = text;

	wrapper.append(roleEl, bodyEl);
	transcript.prepend(wrapper);
}

function setStatus(text, kind = "") {
	statusPill.textContent = text;
	statusPill.className = `status-pill${kind ? ` ${kind}` : ""}`;
}

function renderContext(context) {
	if (!context?.ok) {
		setStatus("Bridge unavailable", "error");
		contextSummary.textContent = context?.error || "Could not connect to the browser bridge.";
		return;
	}

	setStatus(
		`${context.bridge.connectedClients} browser client${context.bridge.connectedClients === 1 ? "" : "s"} connected`,
		"ok",
	);

	const lines = [];
	if (context.activeTab) {
		lines.push(`Active tab: ${context.activeTab.title || "(untitled)"}`);
		lines.push(context.activeTab.url || "");
		lines.push("");
	}

	if (context.warning) {
		lines.push(`Warning: ${context.warning}`);
		lines.push("");
	}

	if (context.visible?.text) {
		lines.push("Visible text preview:");
		lines.push(context.visible.text.trim());
	} else {
		lines.push("Visible text preview unavailable.");
	}

	contextSummary.textContent = lines.join("\n");
}

async function refreshContext() {
	setStatus("Refreshing…");
	const context = await window.onhandApp.refreshContext();
	renderContext(context);
	return context;
}

promptForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) return;

	addMessage("user", prompt);
	promptInput.value = "";
	setStatus("Collecting current context…");

	try {
		const result = await window.onhandApp.submitPrompt(prompt);
		addMessage("assistant", result.reply);
		renderContext(result.context);
	} catch (error) {
		const message = error?.message || String(error);
		addMessage("assistant", `Error: ${message}`);
		setStatus("Prompt failed", "error");
	}
});

refreshButton.addEventListener("click", () => {
	refreshContext().catch((error) => {
		setStatus("Refresh failed", "error");
		contextSummary.textContent = error?.message || String(error);
	});
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		window.onhandApp.hideWindow();
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		promptInput.focus();
		promptInput.select();
	}
});

window.onhandApp.onFocusInput(() => {
	promptInput.focus();
	promptInput.select();
});

addMessage(
	"assistant",
	"Onhand desktop shell started. Ask a question here to exercise the UI shell while we wire the full pi SDK session next.",
);

await refreshContext();
