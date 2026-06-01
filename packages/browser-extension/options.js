const RUNTIME_STORAGE_KEY = "onhandBrowserRuntime";
const CODEX_PROVIDER = "openai-codex";
const CODEX_MODEL = "gpt-5.5";
const API_PROVIDER = "openai";
const API_MODEL = "gpt-4.1-mini";

const aiModelInput = document.getElementById("aiModel");
const modelHelpEl = document.getElementById("modelHelp");
const authModeInput = document.getElementById("authMode");
const aiApiKeyInput = document.getElementById("aiApiKey");
const apiKeyHelpEl = document.getElementById("apiKeyHelp");
const statusEl = document.getElementById("status");
const authStatusEl = document.getElementById("authStatus");

function renderStatus(data, className = "") {
	statusEl.className = className;
	statusEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function renderAuthStatus(data, className = "") {
	authStatusEl.className = className;
	authStatusEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function renderAuthProgress(event) {
	const lines = [
		event.providerId ? `Provider: ${event.providerId}` : "",
		event.status ? `Status: ${event.status}` : "",
		event.detail ? `Detail: ${event.detail}` : "",
		event.userCode ? `Code: ${event.userCode}` : "",
		event.url ? `URL: ${event.url}` : "",
	].filter(Boolean);
	renderAuthStatus(lines.join("\n") || "Sign-in is running...");
}

function isCodexSignInMode() {
	return authModeInput.value === "oauth";
}

function syncAuthModeFields() {
	if (isCodexSignInMode()) {
		aiModelInput.value = CODEX_MODEL;
		aiModelInput.disabled = true;
		aiApiKeyInput.disabled = false;
		modelHelpEl.textContent = "Codex sign-in uses OpenAI Codex with GPT-5.5 for text chat.";
		apiKeyHelpEl.textContent = "Optional while Codex sign-in is selected. Voice audio and voice page answers use this OpenAI platform API key for gpt-realtime-2; text chat continues to use Codex sign-in.";
		return;
	}
	aiModelInput.disabled = false;
	aiApiKeyInput.disabled = false;
	if (!aiModelInput.value.trim() || aiModelInput.value.trim() === CODEX_MODEL) {
		aiModelInput.value = API_MODEL;
	}
	modelHelpEl.textContent = "API key mode uses the OpenAI API provider. Change the model only if you know the API model is available.";
	apiKeyHelpEl.textContent = "Used for text chat in API-key mode and for Voice/gpt-realtime-2 audio plus voice page answers. Stored only in extension local storage.";
}

function selectedProvider() {
	return isCodexSignInMode() ? CODEX_PROVIDER : API_PROVIDER;
}

function selectedModel() {
	return isCodexSignInMode() ? CODEX_MODEL : aiModelInput.value.trim() || API_MODEL;
}

async function loadForm() {
	const stored = await chrome.storage.local.get({
		[RUNTIME_STORAGE_KEY]: null,
	});
	const runtimeSettings = stored[RUNTIME_STORAGE_KEY]?.settings || {};
	authModeInput.value = runtimeSettings.authMode === "api-key" ? "api-key" : "oauth";
	const apiModel = runtimeSettings.aiProvider === API_PROVIDER ? runtimeSettings.aiModel || API_MODEL : API_MODEL;
	aiModelInput.value = authModeInput.value === "oauth" ? CODEX_MODEL : apiModel;
	aiApiKeyInput.value = runtimeSettings.aiApiKey || "";
	syncAuthModeFields();
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "get-status" });
	if (!response?.ok) {
		renderStatus(response?.error || "Could not read background status", "error");
		return;
	}
	renderStatus(response.status);
	const browserRuntime = response.status?.browserRuntime;
	if (browserRuntime?.signedInProviders) {
		const signedIn = browserRuntime.signedInProviders
			.filter((provider) => provider.signedIn)
			.map((provider) => {
				const label = provider.email || provider.accountId || provider.projectId || "signed in";
				return `${provider.name}: ${label}`;
			});
		renderAuthStatus(signedIn.length ? signedIn.join("\n") : "No direct sign-in credentials stored.");
	}
}

async function save() {
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:update-settings",
		aiProvider: selectedProvider(),
		aiModel: selectedModel(),
		authMode: authModeInput.value === "oauth" ? "oauth" : "api-key",
		aiApiKey: aiApiKeyInput.value.trim(),
	});
	if (!response?.ok) {
		throw new Error(response?.error || "Could not save browser runtime settings.");
	}
	await refreshStatus();
}

async function signIn(providerId, defaultModel) {
	if (!providerId) throw new Error("Provider id is required.");
	if (providerId !== CODEX_PROVIDER) throw new Error("Only OpenAI Codex sign-in is supported.");
	aiModelInput.value = defaultModel || CODEX_MODEL;
	authModeInput.value = "oauth";
	syncAuthModeFields();
	renderAuthStatus(`Starting ${providerId} sign-in...`);
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:oauth-sign-in",
		providerId,
		aiModel: CODEX_MODEL,
	});
	if (!response?.ok) {
		throw new Error(response?.error || "Direct sign-in failed.");
	}
	await loadForm();
	await refreshStatus();
	renderAuthStatus(`Signed in to ${providerId}.`, "ok");
}

async function signOutSelectedProvider() {
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:oauth-sign-out",
		providerId: CODEX_PROVIDER,
	});
	if (!response?.ok) {
		throw new Error(response?.error || "Could not sign out.");
	}
	await loadForm();
	await refreshStatus();
	renderAuthStatus(`Signed out of ${CODEX_PROVIDER}.`, "ok");
}

document.getElementById("save").addEventListener("click", () => {
	save().catch((error) => renderStatus(error?.message || String(error), "error"));
});

authModeInput.addEventListener("change", syncAuthModeFields);

document.getElementById("refresh").addEventListener("click", () => {
	refreshStatus().catch((error) => renderStatus(error?.message || String(error), "error"));
});

document.getElementById("signOutAuth").addEventListener("click", () => {
	signOutSelectedProvider().catch((error) => renderAuthStatus(error?.message || String(error), "error"));
});

for (const button of document.querySelectorAll("[data-oauth-provider]")) {
	button.addEventListener("click", () => {
		signIn(button.dataset.oauthProvider, button.dataset.defaultModel).catch((error) =>
			renderAuthStatus(error?.message || String(error), "error"),
		);
	});
}

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type !== "browser-runtime:auth-progress") return;
	renderAuthProgress(message);
});

loadForm()
	.then(refreshStatus)
	.catch((error) => renderStatus(error?.message || String(error), "error"));
