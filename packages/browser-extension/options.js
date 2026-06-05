const RUNTIME_STORAGE_KEY = "onhandBrowserRuntime";
const CODEX_PROVIDER = "openai-codex";
const CODEX_MODEL = "gpt-5.5";
const API_PROVIDERS = {
	openai: {
		name: "OpenAI API",
		defaultModel: "gpt-4.1-mini",
		keyLabel: "OpenAI platform API key",
		keyPlaceholder: "sk-...",
		capabilities: { realtime: true, vision: true, tools: true, structuredOutput: true },
	},
	anthropic: {
		name: "Anthropic API",
		defaultModel: "claude-sonnet-4-5-20250929",
		keyLabel: "Anthropic API key",
		keyPlaceholder: "sk-ant-...",
		capabilities: { realtime: false, vision: true, tools: true, structuredOutput: true },
	},
	google: {
		name: "Google Gemini API",
		defaultModel: "gemini-2.5-flash",
		keyLabel: "Gemini API key",
		keyPlaceholder: "AIza...",
		capabilities: { realtime: false, vision: true, tools: true, structuredOutput: true },
	},
};

const providerInput = document.getElementById("aiProvider");
const modelSelectEl = document.getElementById("aiModelSelect");
const aiModelInput = document.getElementById("aiModel");
const modelHelpEl = document.getElementById("modelHelp");
const authModeInput = document.getElementById("authMode");
const apiKeyProviderInput = document.getElementById("apiKeyProvider");
const aiApiKeyInput = document.getElementById("aiApiKey");
const apiKeyLabelEl = document.getElementById("apiKeyLabel");
const apiKeyHelpEl = document.getElementById("apiKeyHelp");
const capabilityStatusEl = document.getElementById("capabilityStatus");
const statusEl = document.getElementById("status");
const authStatusEl = document.getElementById("authStatus");
let runtimePublicSettings = null;
let pendingApiKeys = {};

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

function getProviderMeta(providerId) {
	return API_PROVIDERS[providerId] || API_PROVIDERS.openai;
}

function selectedProvider() {
	return isCodexSignInMode() ? CODEX_PROVIDER : providerInput.value || "openai";
}

function selectedModel() {
	if (isCodexSignInMode()) return CODEX_MODEL;
	return aiModelInput.value.trim() || getProviderMeta(providerInput.value).defaultModel;
}

function providerModels(providerId) {
	return runtimePublicSettings?.providerModels?.[providerId] || [];
}

function populateModelSelect(providerId, selectedId) {
	const models = providerModels(providerId);
	modelSelectEl.textContent = "";
	const customOption = document.createElement("option");
	customOption.value = "__custom__";
	customOption.textContent = models.length ? "Custom model…" : "Custom model id";
	for (const model of models) {
		const option = document.createElement("option");
		option.value = model.id;
		option.textContent = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
		modelSelectEl.append(option);
	}
	modelSelectEl.append(customOption);
	if (models.some((model) => model.id === selectedId)) {
		modelSelectEl.value = selectedId;
		aiModelInput.value = selectedId;
		aiModelInput.hidden = true;
	} else {
		modelSelectEl.value = "__custom__";
		aiModelInput.value = selectedId || getProviderMeta(providerId).defaultModel;
		aiModelInput.hidden = false;
	}
}

function syncCapabilityStatus() {
	if (isCodexSignInMode()) {
		capabilityStatusEl.textContent = "Text chat uses OpenAI Codex sign-in. Voice/realtime still requires an OpenAI platform API key.";
		capabilityStatusEl.className = "warn";
		return;
	}
	const providerId = providerInput.value || "openai";
	const modelId = selectedModel();
	const meta = getProviderMeta(providerId);
	const model = providerModels(providerId).find((candidate) => candidate.id === modelId);
	const caps = model
		? {
				realtime: Boolean(model.realtime),
				vision: model.input?.includes?.("image"),
				tools: Boolean(model.tools),
				structuredOutput: Boolean(model.structuredOutput),
			}
		: meta.capabilities;
	const unsupported = [
		caps.realtime ? "" : "realtime voice",
		caps.vision ? "" : "vision",
		caps.tools ? "" : "page tools",
		caps.structuredOutput ? "" : "structured output",
	].filter(Boolean);
	capabilityStatusEl.textContent = unsupported.length
		? `${meta.name}/${modelId} may not support: ${unsupported.join(", ")}. Onhand will show an error instead of silently failing if a request needs one of these features.`
		: `${meta.name}/${modelId} supports Onhand text chat, page tools, vision inputs, and structured helper output. Voice/realtime requires an OpenAI platform realtime-capable key.`;
	capabilityStatusEl.className = unsupported.length ? "warn" : "ok";
}

function syncAuthModeFields() {
	if (isCodexSignInMode()) {
		providerInput.value = "openai";
		providerInput.disabled = true;
		modelSelectEl.disabled = true;
		aiModelInput.value = CODEX_MODEL;
		aiModelInput.disabled = true;
		aiModelInput.hidden = false;
		modelHelpEl.textContent = "Codex sign-in uses OpenAI Codex with GPT-5.5 for text chat.";
	} else {
		providerInput.disabled = false;
		modelSelectEl.disabled = false;
		aiModelInput.disabled = false;
		const providerId = providerInput.value || "openai";
		if (!aiModelInput.value.trim() || aiModelInput.value.trim() === CODEX_MODEL) aiModelInput.value = getProviderMeta(providerId).defaultModel;
		populateModelSelect(providerId, aiModelInput.value.trim());
		modelHelpEl.textContent = "API key mode uses your selected provider/model for chat, learning, and page-tool requests.";
	}
	syncApiKeyFields();
	syncCapabilityStatus();
}

function syncApiKeyFields() {
	const providerId = apiKeyProviderInput.value || "openai";
	const meta = getProviderMeta(providerId);
	apiKeyLabelEl.textContent = meta.keyLabel;
	aiApiKeyInput.placeholder = meta.keyPlaceholder;
	aiApiKeyInput.value = pendingApiKeys[providerId] || "";
	const saved = runtimePublicSettings?.apiKeyProviders?.find((provider) => provider.id === providerId)?.hasApiKey;
	apiKeyHelpEl.textContent = `${saved ? "Saved key exists. Enter a new key to update it, or remove it below." : "No saved key for this provider."} Keys are stored only in chrome.storage.local and are redacted from status diagnostics.`;
}

function collectApiKeys() {
	const providerId = apiKeyProviderInput.value || "openai";
	pendingApiKeys[providerId] = aiApiKeyInput.value.trim();
	return Object.fromEntries(Object.entries(pendingApiKeys).filter(([, key]) => key));
}

async function loadForm() {
	const stored = await chrome.storage.local.get({ [RUNTIME_STORAGE_KEY]: null });
	const runtimeSettings = stored[RUNTIME_STORAGE_KEY]?.settings || {};
	pendingApiKeys = { ...(runtimeSettings.aiApiKeys || {}) };
	if (runtimeSettings.aiApiKey && !pendingApiKeys.openai) pendingApiKeys.openai = runtimeSettings.aiApiKey;
	authModeInput.value = runtimeSettings.authMode === "api-key" ? "api-key" : "oauth";
	providerInput.value = API_PROVIDERS[runtimeSettings.aiProvider] ? runtimeSettings.aiProvider : "openai";
	apiKeyProviderInput.value = providerInput.value;
	aiModelInput.value = authModeInput.value === "oauth" ? CODEX_MODEL : runtimeSettings.aiModel || getProviderMeta(providerInput.value).defaultModel;
	syncAuthModeFields();
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "get-status" });
	if (!response?.ok) {
		renderStatus(response?.error || "Could not read background status", "error");
		return;
	}
	runtimePublicSettings = response.status?.browserRuntime || null;
	renderStatus(response.status);
	const browserRuntime = response.status?.browserRuntime;
	if (browserRuntime?.signedInProviders || browserRuntime?.apiKeyProviders) {
		const signedIn = (browserRuntime.signedInProviders || [])
			.filter((provider) => provider.signedIn)
			.map((provider) => `${provider.name}: ${provider.email || provider.accountId || provider.projectId || "signed in"}`);
		const apiKeys = (browserRuntime.apiKeyProviders || []).map((provider) => `${provider.name}: ${provider.hasApiKey ? "API key saved" : "no API key"}`);
		renderAuthStatus([...signedIn, ...apiKeys].join("\n") || "No credentials stored.");
	}
	syncAuthModeFields();
}

async function save() {
	const aiApiKeys = collectApiKeys();
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:update-settings",
		aiProvider: selectedProvider(),
		aiModel: selectedModel(),
		authMode: authModeInput.value === "oauth" ? "oauth" : "api-key",
		aiApiKey: aiApiKeys.openai || "",
		aiApiKeys,
	});
	if (!response?.ok) throw new Error(response?.error || "Could not save browser runtime settings.");
	await refreshStatus();
}

async function validateSelectedKey() {
	const providerId = apiKeyProviderInput.value || "openai";
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:validate-api-key",
		providerId,
		apiKey: aiApiKeyInput.value.trim() || pendingApiKeys[providerId] || "",
	});
	if (!response?.ok) throw new Error(response?.error || response?.result?.error || "API key validation failed.");
	renderStatus(`${response.result.providerName} key shape looks valid.`, "ok");
}

async function removeSelectedKey() {
	const providerId = apiKeyProviderInput.value || "openai";
	pendingApiKeys[providerId] = "";
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:remove-api-key", providerId });
	if (!response?.ok) throw new Error(response?.error || "Could not remove API key.");
	await refreshStatus();
}

async function signIn(providerId, defaultModel) {
	if (!providerId) throw new Error("Provider id is required.");
	if (providerId !== CODEX_PROVIDER) throw new Error("Only OpenAI Codex sign-in is supported.");
	aiModelInput.value = defaultModel || CODEX_MODEL;
	authModeInput.value = "oauth";
	syncAuthModeFields();
	renderAuthStatus(`Starting ${providerId} sign-in...`);
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:oauth-sign-in", providerId, aiModel: CODEX_MODEL });
	if (!response?.ok) throw new Error(response?.error || "Direct sign-in failed.");
	await loadForm();
	await refreshStatus();
	renderAuthStatus(`Signed in to ${providerId}.`, "ok");
}

async function signOutSelectedProvider() {
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:oauth-sign-out", providerId: CODEX_PROVIDER });
	if (!response?.ok) throw new Error(response?.error || "Could not sign out.");
	await loadForm();
	await refreshStatus();
	renderAuthStatus(`Signed out of ${CODEX_PROVIDER}.`, "ok");
}

document.getElementById("save").addEventListener("click", () => save().catch((error) => renderStatus(error?.message || String(error), "error")));
document.getElementById("validateKey").addEventListener("click", () => validateSelectedKey().catch((error) => renderStatus(error?.message || String(error), "error")));
document.getElementById("removeKey").addEventListener("click", () => removeSelectedKey().catch((error) => renderStatus(error?.message || String(error), "error")));
authModeInput.addEventListener("change", syncAuthModeFields);
providerInput.addEventListener("change", () => {
	aiModelInput.value = getProviderMeta(providerInput.value).defaultModel;
	apiKeyProviderInput.value = providerInput.value;
	syncAuthModeFields();
});
modelSelectEl.addEventListener("change", () => {
	if (modelSelectEl.value === "__custom__") {
		aiModelInput.hidden = false;
		aiModelInput.focus();
	} else {
		aiModelInput.value = modelSelectEl.value;
		aiModelInput.hidden = true;
	}
	syncCapabilityStatus();
});
aiModelInput.addEventListener("input", syncCapabilityStatus);
apiKeyProviderInput.addEventListener("change", syncApiKeyFields);
aiApiKeyInput.addEventListener("input", () => {
	pendingApiKeys[apiKeyProviderInput.value || "openai"] = aiApiKeyInput.value.trim();
});
document.getElementById("refresh").addEventListener("click", () => refreshStatus().catch((error) => renderStatus(error?.message || String(error), "error")));
document.getElementById("signOutAuth").addEventListener("click", () => signOutSelectedProvider().catch((error) => renderAuthStatus(error?.message || String(error), "error")));
for (const button of document.querySelectorAll("[data-oauth-provider]")) {
	button.addEventListener("click", () => signIn(button.dataset.oauthProvider, button.dataset.defaultModel).catch((error) => renderAuthStatus(error?.message || String(error), "error")));
}
chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "browser-runtime:auth-progress") renderAuthProgress(message.event || {});
});

await refreshStatus().catch((error) => renderStatus(error?.message || String(error), "error"));
await loadForm().catch((error) => renderStatus(error?.message || String(error), "error"));
