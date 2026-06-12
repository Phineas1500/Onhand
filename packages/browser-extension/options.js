const RUNTIME_STORAGE_KEY = "onhandBrowserRuntime";
const THEME_STORAGE_KEY = "onhandSidebarTheme";
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
	openrouter: {
		name: "OpenRouter",
		defaultModel: "deepseek/deepseek-v4-flash",
		keyLabel: "OpenRouter API key",
		keyPlaceholder: "sk-or-...",
		capabilities: { realtime: false, vision: false, tools: true, structuredOutput: false },
	},
	"onhand-free": {
		name: "Onhand Free (beta)",
		defaultModel: "deepseek/deepseek-v4-flash",
		keyLabel: "No key needed",
		keyPlaceholder: "",
		keyless: true,
		capabilities: { realtime: false, vision: false, tools: true, structuredOutput: false },
	},
};

const providerInput = document.getElementById("aiProvider");
const modelSelectEl = document.getElementById("aiModelSelect");
const aiModelInput = document.getElementById("aiModel");
const modelHelpEl = document.getElementById("modelHelp");
const authModeInput = document.getElementById("authMode");
const apiKeySectionEl = document.getElementById("apiKeySection");
const apiKeyActionsEl = document.getElementById("apiKeyActions");
const aiApiKeyInput = document.getElementById("aiApiKey");
const apiKeyLabelEl = document.getElementById("apiKeyLabel");
const apiKeyHelpEl = document.getElementById("apiKeyHelp");
const capabilityStatusEl = document.getElementById("capabilityStatus");
const realtimeVoiceEnabledInput = document.getElementById("realtimeVoiceEnabled");
const realtimeVoiceHelpEl = document.getElementById("realtimeVoiceHelp");
const realtimeOpenAiKeyFieldEl = document.getElementById("realtimeOpenAiKeyField");
const realtimeOpenAiApiKeyInput = document.getElementById("realtimeOpenAiApiKey");
const realtimeOpenAiKeyHelpEl = document.getElementById("realtimeOpenAiKeyHelp");
const statusEl = document.getElementById("status");
const authStatusEl = document.getElementById("authStatus");
const codexAuthSummaryEl = document.getElementById("codexAuthSummary");
const codexSignInButton = document.querySelector(`[data-oauth-provider="${CODEX_PROVIDER}"]`);
const signOutAuthButton = document.getElementById("signOutAuth");
const CODEX_AUTH_DEFAULT_SUMMARY = codexAuthSummaryEl.textContent;
let runtimePublicSettings = null;
let pendingApiKeys = {};

function applyOnhandTheme(value) {
	const theme = String(value || "system").toLowerCase();
	document.documentElement.dataset.onhandTheme = ["light", "dark", "system"].includes(theme) ? theme : "system";
}

chrome.storage.local.get({ [THEME_STORAGE_KEY]: "system" }).then((stored) => applyOnhandTheme(stored[THEME_STORAGE_KEY]));
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes[THEME_STORAGE_KEY]) applyOnhandTheme(changes[THEME_STORAGE_KEY].newValue);
});

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

function getOAuthProviderMeta(providerId) {
	return runtimePublicSettings?.oauthProviders?.find((provider) => provider.id === providerId) || null;
}

function getProviderDefaultModel(providerId) {
	if (providerId === CODEX_PROVIDER) return getOAuthProviderMeta(providerId)?.defaultModel || CODEX_MODEL;
	return getProviderMeta(providerId).defaultModel;
}

function selectedProvider() {
	return isCodexSignInMode() ? CODEX_PROVIDER : providerInput.value || "openai";
}

function selectedApiKeyProvider() {
	return isCodexSignInMode() ? "openai" : providerInput.value || "openai";
}

function selectedModel() {
	const providerId = selectedProvider();
	return aiModelInput.value.trim() || getProviderDefaultModel(providerId);
}

function providerModels(providerId) {
	return runtimePublicSettings?.providerModels?.[providerId] || [];
}

function populateModelSelect(providerId, selectedId) {
	const models = providerModels(providerId);
	const fallbackModelId = getProviderDefaultModel(providerId);
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
		aiModelInput.value = selectedId || fallbackModelId;
		aiModelInput.hidden = false;
	}
}

function isOpenAiApiKeyMode() {
	return !isCodexSignInMode() && (providerInput.value || "openai") === "openai";
}

function isRealtimeVoiceEnabled() {
	return Boolean(realtimeVoiceEnabledInput.checked);
}

function syncCapabilityStatus() {
	if (isCodexSignInMode()) {
		const modelId = selectedModel();
		capabilityStatusEl.textContent = isRealtimeVoiceEnabled()
			? `Text chat uses OpenAI Codex sign-in with ${modelId}. Realtime Voice uses an OpenAI platform API key for gpt-realtime-2.`
			: `Text chat uses OpenAI Codex sign-in with ${modelId}. Realtime Voice is disabled.`;
		capabilityStatusEl.className = "ok";
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
		caps.vision ? "" : "vision",
		caps.tools ? "" : "page tools",
		caps.structuredOutput ? "" : "structured output",
	].filter(Boolean);
	const realtimeText = isRealtimeVoiceEnabled()
		? isOpenAiApiKeyMode()
			? " The same OpenAI API key is also used for gpt-realtime-2."
			: " Realtime Voice uses a separate OpenAI platform API key for gpt-realtime-2."
		: " Realtime Voice is disabled.";
	capabilityStatusEl.textContent = unsupported.length
		? `${meta.name}/${modelId} may not support: ${unsupported.join(", ")}. Onhand will show an error instead of silently failing if a request needs one of these features.${realtimeText}`
		: `${meta.name}/${modelId} supports Onhand text chat, page tools, vision inputs, and structured helper output.${realtimeText}`;
	capabilityStatusEl.className = unsupported.length ? "warn" : "ok";
}

function syncAuthModeFields() {
	if (isCodexSignInMode()) {
		providerInput.value = "openai";
		providerInput.disabled = true;
		modelSelectEl.disabled = false;
		aiModelInput.disabled = false;
		const providerId = CODEX_PROVIDER;
		const currentModelId = aiModelInput.value.trim();
		const models = providerModels(providerId);
		if (!currentModelId || (models.length && !models.some((model) => model.id === currentModelId))) {
			aiModelInput.value = getProviderDefaultModel(providerId);
		}
		populateModelSelect(providerId, aiModelInput.value.trim());
		modelHelpEl.textContent = "Codex sign-in uses your selected OpenAI Codex model for text chat. Switch Authentication to Provider API key if you want text chat to use an API key.";
	} else {
		providerInput.disabled = false;
		modelSelectEl.disabled = false;
		aiModelInput.disabled = false;
		const providerId = providerInput.value || "openai";
		if (!aiModelInput.value.trim() || aiModelInput.value.trim() === CODEX_MODEL || providerModels(CODEX_PROVIDER).some((model) => model.id === aiModelInput.value.trim())) {
			aiModelInput.value = getProviderMeta(providerId).defaultModel;
		}
		populateModelSelect(providerId, aiModelInput.value.trim());
		modelHelpEl.textContent = "Provider API key mode uses your selected provider/model for text chat, learning, and page-tool requests.";
	}
	syncApiKeyFields();
	syncCapabilityStatus();
}

function syncApiKeyFields() {
	const providerId = selectedApiKeyProvider();
	const meta = getProviderMeta(providerId);
	const showApiKeySection = !isCodexSignInMode() && !meta.keyless;
	apiKeySectionEl.hidden = !showApiKeySection;
	apiKeyActionsEl.hidden = !showApiKeySection;
	apiKeyLabelEl.textContent = meta.keyLabel;
	aiApiKeyInput.placeholder = meta.keyPlaceholder;
	aiApiKeyInput.value = pendingApiKeys[providerId] || "";
	const saved = runtimePublicSettings?.apiKeyProviders?.find((provider) => provider.id === providerId)?.hasApiKey;
	apiKeyHelpEl.textContent = meta.keyless
		? "The free tier needs no key. Usage is capped per day; switch to your own API key any time for unlimited use."
		: `${saved ? "Saved key exists. Enter a new key to update it, or remove it below." : "No saved key for this provider."} Keys are stored only in chrome.storage.local and are redacted from status diagnostics.`;
	syncRealtimeVoiceFields();
}

function syncRealtimeVoiceFields() {
	const enabled = isRealtimeVoiceEnabled();
	const usingOpenAiApiKeyForText = isOpenAiApiKeyMode();
	const showSeparateOpenAiKey = enabled && !usingOpenAiApiKeyForText;
	realtimeOpenAiKeyFieldEl.hidden = !showSeparateOpenAiKey;
	realtimeOpenAiApiKeyInput.value = pendingApiKeys.openai || "";
	const savedOpenAiKey = runtimePublicSettings?.apiKeyProviders?.find((provider) => provider.id === "openai")?.hasApiKey;
	realtimeOpenAiKeyHelpEl.textContent = `${savedOpenAiKey ? "Saved OpenAI key exists. Enter a new key to update it." : "No saved OpenAI key yet."} Voice uses this key for gpt-realtime-2; text chat keeps using the selected authentication mode above.`;
	if (!enabled) {
		realtimeVoiceHelpEl.textContent = "Realtime Voice is disabled. Enable it to use gpt-realtime-2 with an OpenAI platform API key.";
		return;
	}
	if (usingOpenAiApiKeyForText) {
		realtimeVoiceHelpEl.textContent = "Realtime Voice will use the same OpenAI platform API key selected for Provider API key mode to start gpt-realtime-2.";
		return;
	}
	realtimeVoiceHelpEl.textContent = isCodexSignInMode()
		? "Realtime Voice requires an OpenAI platform API key for gpt-realtime-2. Text chat still uses OpenAI Codex sign-in."
		: "Realtime Voice requires an OpenAI platform API key for gpt-realtime-2. Text chat still uses your selected provider API key.";
}

function collectApiKeys() {
	if (!apiKeySectionEl.hidden) {
		const providerId = selectedApiKeyProvider();
		pendingApiKeys[providerId] = aiApiKeyInput.value.trim();
	}
	if (!realtimeOpenAiKeyFieldEl.hidden) pendingApiKeys.openai = realtimeOpenAiApiKeyInput.value.trim();
	return Object.fromEntries(Object.entries(pendingApiKeys).filter(([, key]) => key));
}

async function loadForm() {
	const stored = await chrome.storage.local.get({ [RUNTIME_STORAGE_KEY]: null });
	const runtimeSettings = stored[RUNTIME_STORAGE_KEY]?.settings || {};
	pendingApiKeys = { ...(runtimeSettings.aiApiKeys || {}) };
	if (runtimeSettings.aiApiKey && !pendingApiKeys.openai) pendingApiKeys.openai = runtimeSettings.aiApiKey;
	authModeInput.value = runtimeSettings.authMode === "api-key" ? "api-key" : "oauth";
	providerInput.value = API_PROVIDERS[runtimeSettings.aiProvider] ? runtimeSettings.aiProvider : "openai";
	realtimeVoiceEnabledInput.checked = Boolean(runtimeSettings.realtimeVoiceEnabled);
	const modelProviderId = authModeInput.value === "oauth" ? CODEX_PROVIDER : providerInput.value;
	aiModelInput.value = runtimeSettings.aiModel || getProviderDefaultModel(modelProviderId);
	syncAuthModeFields();
}

function syncCodexAuthCard() {
	const codex = runtimePublicSettings?.signedInProviders?.find((provider) => provider.id === CODEX_PROVIDER);
	const signedIn = Boolean(codex?.signedIn);
	codexSignInButton.hidden = signedIn;
	signOutAuthButton.hidden = !signedIn;
	if (!signedIn) {
		codexAuthSummaryEl.textContent = CODEX_AUTH_DEFAULT_SUMMARY;
		return;
	}
	const identity = codex.email || codex.accountId || "";
	codexAuthSummaryEl.textContent = `Signed in${identity ? ` as ${identity}` : ""}.${codex.expired ? " Session expired — sign out and sign in again." : ""}`;
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "get-status" });
	if (!response?.ok) {
		renderStatus(response?.error || "Could not read background status", "error");
		return;
	}
	runtimePublicSettings = response.status?.browserRuntime || null;
	syncCodexAuthCard();
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
		realtimeVoiceEnabled: isRealtimeVoiceEnabled(),
		aiApiKey: aiApiKeys.openai || "",
		aiApiKeys,
	});
	if (!response?.ok) throw new Error(response?.error || "Could not save browser runtime settings.");
	await refreshStatus();
}

async function validateSelectedKey() {
	const providerId = selectedApiKeyProvider();
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:validate-api-key",
		providerId,
		apiKey: aiApiKeyInput.value.trim() || pendingApiKeys[providerId] || "",
	});
	if (!response?.ok) throw new Error(response?.error || response?.result?.error || "API key validation failed.");
	renderStatus(`${response.result.providerName} key shape looks valid.`, "ok");
}

async function removeSelectedKey() {
	const providerId = selectedApiKeyProvider();
	pendingApiKeys[providerId] = "";
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:remove-api-key", providerId });
	if (!response?.ok) throw new Error(response?.error || "Could not remove API key.");
	await refreshStatus();
}

async function signIn(providerId, defaultModel) {
	if (!providerId) throw new Error("Provider id is required.");
	if (providerId !== CODEX_PROVIDER) throw new Error("Only OpenAI Codex sign-in is supported.");
	authModeInput.value = "oauth";
	if (!aiModelInput.value.trim()) aiModelInput.value = defaultModel || getProviderDefaultModel(CODEX_PROVIDER);
	syncAuthModeFields();
	renderAuthStatus(`Starting ${providerId} sign-in...`);
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:oauth-sign-in", providerId, aiModel: selectedModel() });
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
aiApiKeyInput.addEventListener("input", () => {
	pendingApiKeys[selectedApiKeyProvider()] = aiApiKeyInput.value.trim();
	syncRealtimeVoiceFields();
	syncCapabilityStatus();
});
realtimeVoiceEnabledInput.addEventListener("change", () => {
	syncRealtimeVoiceFields();
	syncCapabilityStatus();
});
realtimeOpenAiApiKeyInput.addEventListener("input", () => {
	pendingApiKeys.openai = realtimeOpenAiApiKeyInput.value.trim();
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
