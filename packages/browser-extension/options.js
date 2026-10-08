const RUNTIME_STORAGE_KEY = "onhandBrowserRuntime";
const THEME_STORAGE_KEY = "onhandSidebarTheme";
const CODEX_PROVIDER = "openai-codex";
const CODEX_MODEL = "gpt-5.5";
const FREE_TIER_PROVIDER = "onhand-free";
const API_PROVIDERS = {
	openai: {
		name: "OpenAI",
		defaultModel: "gpt-4.1-mini",
		keyLabel: "OpenAI API key",
		keyPlaceholder: "sk-...",
		capabilities: { realtime: true, vision: true, tools: true, structuredOutput: true },
	},
	anthropic: {
		name: "Anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		keyLabel: "Anthropic API key",
		keyPlaceholder: "sk-ant-...",
		capabilities: { realtime: false, vision: true, tools: true, structuredOutput: true },
	},
	google: {
		name: "Google Gemini",
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
		name: "Onhand Free",
		defaultModel: "gpt-6-luna",
		keyLabel: "No key needed",
		keyPlaceholder: "",
		keyless: true,
		// The free-tier worker only serves its allowlisted model, so a
		// custom-model field would be a dead end.
		lockedModels: true,
		capabilities: { realtime: false, vision: false, tools: true, structuredOutput: false },
	},
};
const VOICE_MODEL = "GPT-Live 1";
const VOICE_PRICE = "$0.05 per connected minute, plus model usage";
const DIAGNOSTICS_OPTIONAL_HELP =
	"Sends only the extension version, model category, event names, coarse errors, redacted crash reports and counts. Never prompts, page content, URLs, screenshots, saved sessions, transcripts or keys.";
const DIAGNOSTICS_FREE_HELP =
	"Required for Onhand Free, so Onhand can watch reliability, usage limits, costs, crashes and abuse. Still never sends prompts, page content, URLs, screenshots, saved sessions, transcripts or keys.";
// Text fields save this long after the last keystroke, and right away when
// they lose focus.
const TYPING_SAVE_DELAY_MS = 1000;

const authModeRadios = [...document.querySelectorAll('input[name="authMode"]')];
const authModeInput = {
	get value() {
		return authModeRadios.find((radio) => radio.checked)?.value || "oauth";
	},
	set value(mode) {
		for (const radio of authModeRadios) radio.checked = radio.value === mode;
	},
};
const modePanels = [...document.querySelectorAll("[data-mode-panel]")];
const providerInput = document.getElementById("aiProvider");
const modelFieldEl = document.getElementById("modelField");
const modelSelectEl = document.getElementById("aiModelSelect");
const aiModelInput = document.getElementById("aiModel");
const modelHelpEl = document.getElementById("modelHelp");
const capabilityStatusEl = document.getElementById("capabilityStatus");
const apiKeySectionEl = document.getElementById("apiKeySection");
const aiApiKeyInput = document.getElementById("aiApiKey");
const apiKeyLabelEl = document.getElementById("apiKeyLabel");
const apiKeyHelpEl = document.getElementById("apiKeyHelp");
const removeKeyButton = document.getElementById("removeKey");
const codexFastModeFieldEl = document.getElementById("codexFastModeField");
const codexFastModeEnabledInput = document.getElementById("codexFastModeEnabled");
const openAiKeyFieldEl = document.getElementById("openAiKeyField");
const openAiKeyOptionalEl = document.getElementById("openAiKeyOptional");
const openAiKeyHomeEl = document.getElementById("openAiKeyHome");
const voiceOpenAiKeyHomeEl = document.getElementById("voiceOpenAiKeyHome");
const realtimeOpenAiApiKeyInput = document.getElementById("realtimeOpenAiApiKey");
const realtimeOpenAiKeyHelpEl = document.getElementById("realtimeOpenAiKeyHelp");
const realtimeVoiceEnabledInput = document.getElementById("realtimeVoiceEnabled");
const realtimeVoiceHelpEl = document.getElementById("realtimeVoiceHelp");
const voiceOptionsEl = document.getElementById("voiceOptions");
const liveDelegationInput = document.getElementById("liveDelegation");
const liveResponsesModelFieldEl = document.getElementById("liveResponsesModelField");
const liveResponsesModelInput = document.getElementById("liveResponsesModel");
const liveInterruptionInput = document.getElementById("liveInterruptionEnabled");
const diagnosticsEnabledInput = document.getElementById("diagnosticsEnabled");
const diagnosticsHelpEl = document.getElementById("diagnosticsHelp");
const advancedRuntimeInspectionEnabledInput = document.getElementById("advancedRuntimeInspectionEnabled");
const experimentalModelLaneClassifierInput = document.getElementById("experimentalModelLaneClassifier");
const statusEl = document.getElementById("status");
const codexAuthSummaryEl = document.getElementById("codexAuthSummary");
const authProgressEl = document.getElementById("authProgress");
const codexSignInButton = document.querySelector(`[data-oauth-provider="${CODEX_PROVIDER}"]`);
const signOutAuthButton = document.getElementById("signOutAuth");
const toastEl = document.getElementById("toast");
let runtimePublicSettings = null;
let pendingApiKeys = {};
let lastStatus = null;
// The reader's own diagnostics choice. Onhand Free requires diagnostics and
// shows the box ticked while it is selected, but with autosave a glance at
// the Free option must not leave diagnostics on after switching away.
let diagnosticsChoice = false;

function applyOnhandTheme(value) {
	const theme = String(value || "light").toLowerCase();
	document.documentElement.dataset.onhandTheme = ["light", "dark", "system"].includes(theme) ? theme : "light";
}

chrome.storage.local.get({ [THEME_STORAGE_KEY]: "light" }).then((stored) => applyOnhandTheme(stored[THEME_STORAGE_KEY]));
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes[THEME_STORAGE_KEY]) applyOnhandTheme(changes[THEME_STORAGE_KEY].newValue);
});

let toastTimer = null;
function showToast(message, kind = "") {
	toastEl.textContent = message;
	toastEl.className = `toast show${kind ? ` ${kind}` : ""}`;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toastEl.className = `toast${kind ? ` ${kind}` : ""}`;
	}, kind === "error" ? 5000 : 1600);
}

function renderStatus(data) {
	statusEl.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function renderAuthProgress(event) {
	const lines = [
		event.status ? `${event.status}` : "",
		event.detail ? `${event.detail}` : "",
		event.userCode ? `Code: ${event.userCode}` : "",
		event.url ? `${event.url}` : "",
	].filter(Boolean);
	authProgressEl.hidden = false;
	authProgressEl.textContent = lines.join(" · ") || "Signing in…";
}

// Programmatic updates must not move the caret or overwrite what the reader
// is typing while an autosave refreshes the form.
function setInputValue(input, value) {
	if (document.activeElement === input || input.value === value) return;
	input.value = value;
}

function isCodexSignInMode() {
	return authModeInput.value === "oauth";
}

// "Onhand Free" is its own choice in the UI, but it is stored as authMode
// "api-key" + provider "onhand-free" so the runtime and the sidebar onboarding
// flow need no schema change.
function isFreeTierMode() {
	return authModeInput.value === "free";
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
	if (isCodexSignInMode()) return CODEX_PROVIDER;
	if (isFreeTierMode()) return FREE_TIER_PROVIDER;
	return providerInput.value || "openai";
}

function selectedApiKeyProvider() {
	if (isCodexSignInMode()) return "openai";
	if (isFreeTierMode()) return FREE_TIER_PROVIDER;
	return providerInput.value || "openai";
}

function selectedModel() {
	return aiModelInput.value.trim() || getProviderDefaultModel(selectedProvider());
}

function providerModels(providerId) {
	return runtimePublicSettings?.providerModels?.[providerId] || [];
}

function hasSavedKey(providerId) {
	return Boolean(runtimePublicSettings?.apiKeyProviders?.find((provider) => provider.id === providerId)?.hasApiKey);
}

function populateModelSelect(providerId, selectedId) {
	const models = providerModels(providerId);
	const fallbackModelId = getProviderDefaultModel(providerId);
	const lockedModels = Boolean(getProviderMeta(providerId).lockedModels);
	modelSelectEl.textContent = "";
	for (const model of models) {
		const option = document.createElement("option");
		option.value = model.id;
		option.textContent = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
		modelSelectEl.append(option);
	}
	if (lockedModels && !models.length) {
		const option = document.createElement("option");
		option.value = fallbackModelId;
		option.textContent = fallbackModelId;
		modelSelectEl.append(option);
	}
	if (!lockedModels) {
		const customOption = document.createElement("option");
		customOption.value = "__custom__";
		customOption.textContent = models.length ? "Other model…" : "Model id";
		modelSelectEl.append(customOption);
	}
	if (models.some((model) => model.id === selectedId)) {
		modelSelectEl.value = selectedId;
		setInputValue(aiModelInput, selectedId);
		aiModelInput.hidden = true;
	} else if (lockedModels) {
		modelSelectEl.value = models[0]?.id || fallbackModelId;
		setInputValue(aiModelInput, modelSelectEl.value);
		aiModelInput.hidden = true;
	} else {
		modelSelectEl.value = "__custom__";
		setInputValue(aiModelInput, selectedId || fallbackModelId);
		aiModelInput.hidden = false;
	}
}

function isOpenAiApiKeyMode() {
	return authModeInput.value === "api-key" && (providerInput.value || "openai") === "openai";
}

function isRealtimeVoiceEnabled() {
	return Boolean(realtimeVoiceEnabledInput.checked);
}

// Only API-key models can lack a feature Onhand needs; say so, otherwise stay quiet.
function syncCapabilityStatus() {
	capabilityStatusEl.hidden = true;
	if (authModeInput.value !== "api-key") return;
	const providerId = selectedProvider();
	const modelId = selectedModel();
	const meta = getProviderMeta(providerId);
	const model = providerModels(providerId).find((candidate) => candidate.id === modelId);
	const caps = model
		? { vision: model.input?.includes?.("image"), tools: Boolean(model.tools), structuredOutput: Boolean(model.structuredOutput) }
		: meta.capabilities;
	const unsupported = [caps.vision ? "" : "images", caps.tools ? "" : "page tools", caps.structuredOutput ? "" : "structured output"].filter(Boolean);
	if (!unsupported.length) return;
	capabilityStatusEl.hidden = false;
	capabilityStatusEl.textContent = `${meta.name} ${modelId} may not support ${unsupported.join(", ")}. Onhand shows an error if a request needs one.`;
}

function syncAuthModeFields() {
	const mode = authModeInput.value;
	for (const panel of modePanels) panel.hidden = panel.dataset.modePanel !== mode;
	codexFastModeFieldEl.hidden = mode !== "oauth";
	if (mode === "oauth") {
		modelFieldEl.hidden = false;
		const currentModelId = aiModelInput.value.trim();
		const models = providerModels(CODEX_PROVIDER);
		if (!currentModelId || (models.length && !models.some((model) => model.id === currentModelId))) {
			aiModelInput.value = getProviderDefaultModel(CODEX_PROVIDER);
		}
		populateModelSelect(CODEX_PROVIDER, aiModelInput.value.trim());
		modelHelpEl.textContent = "Which models you can pick depends on your ChatGPT plan.";
	} else if (mode === "free") {
		modelFieldEl.hidden = true;
		aiModelInput.value = getProviderDefaultModel(FREE_TIER_PROVIDER);
		populateModelSelect(FREE_TIER_PROVIDER, aiModelInput.value);
	} else {
		modelFieldEl.hidden = false;
		const providerId = providerInput.value || "openai";
		const currentModelId = aiModelInput.value.trim();
		const isOtherModeModel =
			currentModelId === CODEX_MODEL ||
			providerModels(CODEX_PROVIDER).some((model) => model.id === currentModelId) ||
			(currentModelId === getProviderDefaultModel(FREE_TIER_PROVIDER) && !providerModels(providerId).some((model) => model.id === currentModelId));
		if (!currentModelId || isOtherModeModel) aiModelInput.value = getProviderMeta(providerId).defaultModel;
		populateModelSelect(providerId, aiModelInput.value.trim());
		modelHelpEl.textContent = "";
	}
	modelHelpEl.hidden = !modelHelpEl.textContent;
	syncDiagnosticsFields();
	syncApiKeyFields();
	syncCapabilityStatus();
}

function syncDiagnosticsFields() {
	if (isFreeTierMode()) {
		diagnosticsEnabledInput.checked = true;
		diagnosticsEnabledInput.disabled = true;
		diagnosticsHelpEl.textContent = DIAGNOSTICS_FREE_HELP;
		return;
	}
	diagnosticsEnabledInput.checked = diagnosticsChoice;
	diagnosticsEnabledInput.disabled = false;
	diagnosticsHelpEl.textContent = DIAGNOSTICS_OPTIONAL_HELP;
}

function syncApiKeyFields() {
	const providerId = selectedApiKeyProvider();
	const meta = getProviderMeta(providerId);
	apiKeySectionEl.hidden = authModeInput.value !== "api-key" || Boolean(meta.keyless);
	apiKeyLabelEl.textContent = meta.keyLabel;
	aiApiKeyInput.placeholder = meta.keyPlaceholder;
	setInputValue(aiApiKeyInput, pendingApiKeys[providerId] || "");
	const saved = hasSavedKey(providerId);
	removeKeyButton.hidden = !saved;
	apiKeyHelpEl.textContent = saved ? "Saved. Stored only in this browser." : "Stored only in this browser.";
	syncRealtimeVoiceFields();
}

// One OpenAI API key field serves both voice and, with a ChatGPT plan, the
// quick request check that lets answers start sooner. It sits under the
// model in ChatGPT mode and under Voice otherwise; with OpenAI as the API-key
// provider, that key already is the OpenAI key.
function syncRealtimeVoiceFields() {
	const enabled = isRealtimeVoiceEnabled();
	const openAiKey = isOpenAiApiKeyMode() ? aiApiKeyInput.value.trim() : String(pendingApiKeys.openai || "");
	const hasOpenAiKey = Boolean(openAiKey) || hasSavedKey("openai");
	const showInModel = isCodexSignInMode();
	const showInVoice = !showInModel && enabled && !isOpenAiApiKeyMode();
	openAiKeyFieldEl.hidden = !showInModel && !showInVoice;
	if (showInModel && openAiKeyFieldEl.parentElement !== openAiKeyHomeEl) openAiKeyHomeEl.append(openAiKeyFieldEl);
	if (showInVoice && openAiKeyFieldEl.parentElement !== voiceOpenAiKeyHomeEl) voiceOpenAiKeyHomeEl.append(openAiKeyFieldEl);
	openAiKeyOptionalEl.hidden = !showInModel;
	setInputValue(realtimeOpenAiApiKeyInput, pendingApiKeys.openai || "");
	const saved = hasSavedKey("openai") ? "Saved. " : "";
	realtimeOpenAiKeyHelpEl.textContent = showInModel
		? `${saved}Lets answers start up to 2 seconds sooner (Onhand uses it for a quick check of each request, about $0.0003) and turns on voice. Stored only in this browser.`
		: `${saved}Voice uses this key for ${VOICE_MODEL}. Stored only in this browser.`;

	voiceOptionsEl.hidden = !enabled;
	realtimeVoiceHelpEl.classList.remove("warn");
	if (!enabled) {
		realtimeVoiceHelpEl.textContent = `Talk with Onhand using ${VOICE_MODEL}: ${VOICE_PRICE}. Needs an OpenAI API key.`;
	} else if (!hasOpenAiKey) {
		realtimeVoiceHelpEl.textContent = `Add an OpenAI API key ${showInModel ? "above" : "below"} to start voice.`;
		realtimeVoiceHelpEl.classList.add("warn");
	} else {
		realtimeVoiceHelpEl.textContent = `On. ${VOICE_PRICE[0].toUpperCase()}${VOICE_PRICE.slice(1)}.`;
	}
}

function syncLiveFields() {
	liveResponsesModelFieldEl.hidden = liveDelegationInput.value !== "responses";
}

function collectApiKeys() {
	if (!apiKeySectionEl.hidden) pendingApiKeys[selectedApiKeyProvider()] = aiApiKeyInput.value.trim();
	if (!openAiKeyFieldEl.hidden) pendingApiKeys.openai = realtimeOpenAiApiKeyInput.value.trim();
	return Object.fromEntries(Object.entries(pendingApiKeys).filter(([, key]) => key));
}

async function loadForm() {
	const stored = await chrome.storage.local.get({ [RUNTIME_STORAGE_KEY]: null });
	const runtimeSettings = stored[RUNTIME_STORAGE_KEY]?.settings || {};
	pendingApiKeys = { ...(runtimeSettings.aiApiKeys || {}) };
	if (runtimeSettings.aiApiKey && !pendingApiKeys.openai) pendingApiKeys.openai = runtimeSettings.aiApiKey;
	const storedProvider = API_PROVIDERS[runtimeSettings.aiProvider] ? runtimeSettings.aiProvider : "openai";
	authModeInput.value =
		runtimeSettings.authMode === "api-key" ? (storedProvider === FREE_TIER_PROVIDER ? "free" : "api-key") : "oauth";
	providerInput.value = storedProvider === FREE_TIER_PROVIDER ? "openai" : storedProvider;
	realtimeVoiceEnabledInput.checked = Boolean(runtimeSettings.realtimeVoiceEnabled);
	// Mirrors the runtime's one-time voice migration: values saved before it
	// adopt the Onhand agent as Live's backend; later saved choices are kept.
	const voiceChoicesSaved = runtimeSettings.voiceDefaultsMigrated === true;
	liveDelegationInput.value = voiceChoicesSaved && runtimeSettings.liveDelegation === "responses" ? "responses" : "client";
	liveInterruptionInput.checked = Boolean(runtimeSettings.liveInterruptionEnabled);
	liveResponsesModelInput.value = runtimeSettings.liveResponsesModel === "gpt-5.6-luna" ? "gpt-5.6-luna" : "gpt-5.6-terra";
	syncLiveFields();
	diagnosticsChoice = Boolean(runtimeSettings.diagnosticsEnabled);
	diagnosticsEnabledInput.checked = diagnosticsChoice;
	advancedRuntimeInspectionEnabledInput.checked = runtimeSettings.advancedRuntimeInspectionEnabled !== false;
	codexFastModeEnabledInput.checked = runtimeSettings.codexFastModeEnabled === true;
	// Default-on (see DEFAULT_SETTINGS): unset storage must render CHECKED, or
	// the first autosave would write an explicit false and silently opt the
	// user out before their first turn.
	experimentalModelLaneClassifierInput.checked = runtimeSettings.experimentalModelLaneClassifier !== false;
	const modelProviderId = isCodexSignInMode() ? CODEX_PROVIDER : isFreeTierMode() ? FREE_TIER_PROVIDER : providerInput.value;
	aiModelInput.value = runtimeSettings.aiModel || getProviderDefaultModel(modelProviderId);
	syncAuthModeFields();
}

function syncCodexAuthCard() {
	const codex = runtimePublicSettings?.signedInProviders?.find((provider) => provider.id === CODEX_PROVIDER);
	const signedIn = Boolean(codex?.signedIn);
	codexSignInButton.hidden = signedIn;
	signOutAuthButton.hidden = !signedIn;
	if (!signedIn) {
		codexAuthSummaryEl.textContent = "Not signed in.";
		return;
	}
	const identity = codex.email || codex.accountId || "";
	codexAuthSummaryEl.textContent = codex.expired
		? "Session expired. Sign out, then sign in again."
		: `Signed in${identity ? ` as ${identity}` : ""}.`;
}

async function refreshStatus() {
	const response = await chrome.runtime.sendMessage({ type: "get-status" });
	if (!response?.ok) {
		renderStatus(response?.error || "Could not read background status");
		return;
	}
	lastStatus = response.status;
	runtimePublicSettings = response.status?.browserRuntime || null;
	syncCodexAuthCard();
	renderStatus(response.status);
	syncAuthModeFields();
}

async function save() {
	const aiApiKeys = collectApiKeys();
	const response = await chrome.runtime.sendMessage({
		type: "browser-runtime:update-settings",
		aiProvider: selectedProvider(),
		aiModel: selectedModel(),
		authMode: isCodexSignInMode() ? "oauth" : "api-key",
		realtimeVoiceEnabled: isRealtimeVoiceEnabled(),
		liveDelegation: liveDelegationInput.value,
		liveInterruptionEnabled: liveInterruptionInput.checked,
		liveResponsesModel: liveResponsesModelInput.value,
		diagnosticsEnabled: isFreeTierMode() || diagnosticsChoice,
		advancedRuntimeInspectionEnabled: Boolean(advancedRuntimeInspectionEnabledInput.checked),
		codexFastModeEnabled: Boolean(codexFastModeEnabledInput.checked),
		experimentalModelLaneClassifier: Boolean(experimentalModelLaneClassifierInput.checked),
		aiApiKey: aiApiKeys.openai || "",
		aiApiKeys,
	});
	if (!response?.ok) throw new Error(response?.error || "Could not save settings.");
	await refreshStatus();
}

// Every change saves itself. Saves run one at a time, so a quick run of
// changes cannot finish out of order and leave an older value stored.
let saveTimer = null;
let saveQueue = Promise.resolve();
function runSave() {
	saveTimer = null;
	saveQueue = saveQueue.then(async () => {
		try {
			await save();
			showToast("Saved");
		} catch (error) {
			showToast(`Couldn't save: ${error?.message || String(error)}`, "error");
		}
	});
	return saveQueue;
}

function scheduleSave(delayMs = 0) {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(runSave, delayMs);
}

async function removeSelectedKey() {
	const providerId = selectedApiKeyProvider();
	pendingApiKeys[providerId] = "";
	aiApiKeyInput.value = "";
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:remove-api-key", providerId });
	if (!response?.ok) throw new Error(response?.error || "Could not remove the API key.");
	await refreshStatus();
	showToast("Key removed");
}

async function signIn(providerId, defaultModel) {
	if (providerId !== CODEX_PROVIDER) throw new Error("Only ChatGPT sign-in is supported.");
	authModeInput.value = "oauth";
	if (!aiModelInput.value.trim()) aiModelInput.value = defaultModel || getProviderDefaultModel(CODEX_PROVIDER);
	syncAuthModeFields();
	renderAuthProgress({ status: "Opening ChatGPT sign-in…" });
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:oauth-sign-in", providerId, aiModel: selectedModel() });
	if (!response?.ok) throw new Error(response?.error || "Sign-in failed.");
	authProgressEl.hidden = true;
	await loadForm();
	await refreshStatus();
	showToast("Signed in");
}

async function signOutSelectedProvider() {
	const response = await chrome.runtime.sendMessage({ type: "browser-runtime:oauth-sign-out", providerId: CODEX_PROVIDER });
	if (!response?.ok) throw new Error(response?.error || "Could not sign out.");
	await loadForm();
	await refreshStatus();
	showToast("Signed out");
}

async function trackOptionsOpened() {
	await chrome.runtime
		.sendMessage({
			type: "browser-runtime:track-event",
			eventName: "options_opened",
			data: { result: "ok" },
		})
		.catch(() => {});
}

const reportError = (error) => showToast(error?.message || String(error), "error");

for (const radio of authModeRadios) {
	radio.addEventListener("change", () => {
		syncAuthModeFields();
		scheduleSave();
	});
}
providerInput.addEventListener("change", () => {
	aiModelInput.value = getProviderMeta(providerInput.value).defaultModel;
	syncAuthModeFields();
	scheduleSave();
});
modelSelectEl.addEventListener("change", () => {
	if (modelSelectEl.value === "__custom__") {
		aiModelInput.hidden = false;
		aiModelInput.focus();
		return;
	}
	aiModelInput.value = modelSelectEl.value;
	aiModelInput.hidden = true;
	syncCapabilityStatus();
	scheduleSave();
});
aiModelInput.addEventListener("input", () => {
	syncCapabilityStatus();
	scheduleSave(TYPING_SAVE_DELAY_MS);
});
aiApiKeyInput.addEventListener("input", () => {
	pendingApiKeys[selectedApiKeyProvider()] = aiApiKeyInput.value.trim();
	syncRealtimeVoiceFields();
	scheduleSave(TYPING_SAVE_DELAY_MS);
});
realtimeOpenAiApiKeyInput.addEventListener("input", () => {
	pendingApiKeys.openai = realtimeOpenAiApiKeyInput.value.trim();
	syncRealtimeVoiceFields();
	scheduleSave(TYPING_SAVE_DELAY_MS);
});
for (const input of [aiModelInput, aiApiKeyInput, realtimeOpenAiApiKeyInput]) {
	input.addEventListener("change", () => scheduleSave());
}
realtimeVoiceEnabledInput.addEventListener("change", () => {
	syncRealtimeVoiceFields();
	scheduleSave();
});
liveDelegationInput.addEventListener("change", () => {
	syncLiveFields();
	scheduleSave();
});
diagnosticsEnabledInput.addEventListener("change", () => {
	diagnosticsChoice = diagnosticsEnabledInput.checked;
	scheduleSave();
});
for (const input of [liveResponsesModelInput, liveInterruptionInput, codexFastModeEnabledInput, advancedRuntimeInspectionEnabledInput, experimentalModelLaneClassifierInput]) {
	input.addEventListener("change", () => scheduleSave());
}
removeKeyButton.addEventListener("click", () => removeSelectedKey().catch(reportError));
signOutAuthButton.addEventListener("click", () => signOutSelectedProvider().catch(reportError));
codexSignInButton.addEventListener("click", () =>
	signIn(codexSignInButton.dataset.oauthProvider, codexSignInButton.dataset.defaultModel).catch((error) => {
		authProgressEl.hidden = true;
		reportError(error);
	}),
);
document.getElementById("copyStatus").addEventListener("click", async () => {
	try {
		await refreshStatus();
		await navigator.clipboard.writeText(JSON.stringify(lastStatus, null, 2));
		showToast("Status copied");
	} catch (error) {
		reportError(error);
	}
});
chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "browser-runtime:auth-progress") renderAuthProgress(message.event || {});
});
// A change still waiting out the typing delay is saved when the page closes.
window.addEventListener("pagehide", () => {
	if (saveTimer) runSave();
});

await refreshStatus().catch((error) => renderStatus(error?.message || String(error)));
await loadForm().catch(reportError);
await trackOptionsOpened();
