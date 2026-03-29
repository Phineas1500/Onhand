const bridgeUrlInput = document.getElementById("bridgeUrl");
const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");

function wsToHttp(url) {
	const parsed = new URL(url);
	parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
	if (parsed.pathname === "/ws") parsed.pathname = "/health";
	return parsed.toString();
}

function renderStatus(data, className = "") {
	statusEl.className = className;
	statusEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function loadForm() {
	const stored = await chrome.storage.local.get({
		bridgeUrl: "ws://127.0.0.1:3210/ws",
		token: "",
	});
	bridgeUrlInput.value = stored.bridgeUrl;
	tokenInput.value = stored.token;
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "get-status" });
	if (!response?.ok) {
		renderStatus(response?.error || "Could not read background status", "error");
		return;
	}
	renderStatus(response.status);
}

async function save() {
	await chrome.storage.local.set({
		bridgeUrl: bridgeUrlInput.value.trim(),
		token: tokenInput.value.trim(),
	});
	await chrome.runtime.sendMessage({ type: "reconnect" });
	await refreshStatus();
}

async function testBridge() {
	try {
		const response = await fetch(wsToHttp(bridgeUrlInput.value.trim()), {
			headers: {
				Authorization: `Bearer ${tokenInput.value.trim()}`,
			},
		});
		const data = await response.json();
		if (!response.ok) {
			renderStatus(data, "error");
			return;
		}
		renderStatus(data, "ok");
	} catch (error) {
		renderStatus(error?.message || String(error), "error");
	}
}

document.getElementById("save").addEventListener("click", () => {
	save().catch((error) => renderStatus(error?.message || String(error), "error"));
});

document.getElementById("test").addEventListener("click", () => {
	testBridge().catch((error) => renderStatus(error?.message || String(error), "error"));
});

document.getElementById("refresh").addEventListener("click", () => {
	refreshStatus().catch((error) => renderStatus(error?.message || String(error), "error"));
});

loadForm()
	.then(refreshStatus)
	.catch((error) => renderStatus(error?.message || String(error), "error"));
