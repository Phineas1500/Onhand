import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
	disposeOnhandAgent,
	getOnhandPageAction,
	getOnhandUiState,
	getSessionOverview,
	primeOnhandUiRequest,
	renameCurrentOnhandSession,
	startNewOnhandSession,
	stopOnhandRun,
	submitOnhandPrompt,
	switchOnhandSession,
} from "./onhand-agent.mjs";
import { createOnhandUiServer } from "./onhand-ui-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOTKEY = process.env.ONHAND_HOTKEY || "CommandOrControl+Shift+Space";
const CONFIG_FILE = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const FAST_TIMEOUT_MS = 2500;
const HIGHLIGHT_TIMEOUT_MS = Number(process.env.PI_BROWSER_BRIDGE_HIGHLIGHT_TIMEOUT_MS || 35000);
const ONHAND_UI_PORT = Number(process.env.ONHAND_UI_PORT || 3211);
const ONHAND_SETTINGS_PATH = join(__dirname, "..", "..", ".onhand", "settings.json");
const BROWSER_ARTIFACT_INDEX_PATH = join(__dirname, "..", "..", ".onhand", "artifacts", "browser", "index.json");
const BLUR_HIDE_DELAY_MS = 120;
const HOTKEY_DEBOUNCE_MS = 300;
const WORKSPACE_VISIBILITY_SETTLE_MS = 60;
const DEFAULT_ONHAND_SETTINGS = {
	learningMode: false,
	preferredBrowserClientId: null,
	sessionBrowserClientIds: {},
};
const execFileAsync = promisify(execFile);
const MACOS_WORKSPACE_VISIBILITY_OPTIONS = {
	visibleOnFullScreen: true,
	skipTransformProcessType: true,
};

let mainWindow = null;
let previousFrontmostAppId = null;
let pendingBlurHideTimeout = null;
let pendingWorkspaceDetachTimeout = null;
let hotkeyToggleInFlight = false;
let lastHotkeyToggleAt = 0;
let appIsQuitting = false;
let onhandUiServer = null;
let onhandSettingsCache = null;

function log(...args) {
	console.log("[onhand-desktop]", ...args);
}

async function loadOnhandSettings() {
	if (onhandSettingsCache) {
		return { ...onhandSettingsCache };
	}
	try {
		const raw = await readFile(ONHAND_SETTINGS_PATH, "utf8");
		const parsed = JSON.parse(raw);
		onhandSettingsCache = {
			...DEFAULT_ONHAND_SETTINGS,
			...(parsed && typeof parsed === "object" ? parsed : {}),
			learningMode: Boolean(parsed?.learningMode),
			preferredBrowserClientId: normalizeBrowserClientId(parsed?.preferredBrowserClientId),
			sessionBrowserClientIds: normalizeSessionBrowserClientIds(parsed?.sessionBrowserClientIds),
		};
	} catch {
		onhandSettingsCache = { ...DEFAULT_ONHAND_SETTINGS };
	}
	return { ...onhandSettingsCache };
}

async function saveOnhandSettings(partial = {}) {
	const nextSettings = {
		...(await loadOnhandSettings()),
		...(partial && typeof partial === "object" ? partial : {}),
	};
	nextSettings.learningMode = Boolean(nextSettings.learningMode);
	nextSettings.preferredBrowserClientId = normalizeBrowserClientId(nextSettings.preferredBrowserClientId);
	nextSettings.sessionBrowserClientIds = normalizeSessionBrowserClientIds(nextSettings.sessionBrowserClientIds);
	await mkdir(dirname(ONHAND_SETTINGS_PATH), { recursive: true });
	await writeFile(ONHAND_SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
	onhandSettingsCache = nextSettings;
	return { ...nextSettings };
}

async function getOnhandSettings() {
	return await loadOnhandSettings();
}

function normalizeBrowserClientId(value) {
	const clientId = String(value || "").trim();
	return clientId || null;
}

function normalizeSessionBrowserClientIds(value) {
	if (!value || typeof value !== "object") return {};
	const entries = Object.entries(value)
		.map(([sessionFile, clientId]) => {
			const normalizedSessionFile = String(sessionFile || "").trim();
			const normalizedClientId = normalizeBrowserClientId(clientId);
			if (!normalizedSessionFile || !normalizedClientId) return null;
			return [resolve(normalizedSessionFile), normalizedClientId];
		})
		.filter(Boolean);
	return Object.fromEntries(entries);
}

function getSessionBrowserClientId(sessionFile, settings = onhandSettingsCache) {
	if (!sessionFile) return null;
	const normalizedSessionFile = resolve(String(sessionFile));
	return normalizeBrowserClientId(settings?.sessionBrowserClientIds?.[normalizedSessionFile]);
}

async function setSessionBrowserClientId(sessionFile, clientId) {
	if (!sessionFile) return await getOnhandSettings();
	const normalizedSessionFile = resolve(String(sessionFile));
	const normalizedClientId = normalizeBrowserClientId(clientId);
	const settings = await getOnhandSettings();
	const nextSessionBrowserClientIds = {
		...(settings.sessionBrowserClientIds || {}),
	};
	if (normalizedClientId) {
		nextSessionBrowserClientIds[normalizedSessionFile] = normalizedClientId;
	} else {
		delete nextSessionBrowserClientIds[normalizedSessionFile];
	}
	return await saveOnhandSettings({
		sessionBrowserClientIds: nextSessionBrowserClientIds,
	});
}

async function buildOnhandUiState() {
	return {
		...getOnhandUiState(),
		preferences: await getOnhandSettings(),
	};
}

function normalizeBaseUrl(url) {
	return String(url || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function loadBridgeConnection() {
	const raw = await readFile(CONFIG_FILE, "utf8");
	const parsed = JSON.parse(raw);
	return {
		baseUrl: normalizeBaseUrl(`http://${parsed.host || "127.0.0.1"}:${parsed.port || 3210}`),
		token: parsed.token,
	};
}

async function bridgeRequest(path, init = {}, timeoutMs = FAST_TIMEOUT_MS) {
	const connection = await loadBridgeConnection();
	const headers = new Headers(init.headers || {});
	headers.set("Authorization", `Bearer ${connection.token}`);
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs).unref();

	try {
		const response = await fetch(`${connection.baseUrl}${path}`, {
			...init,
			headers,
			signal: controller.signal,
		});
		const data = await response.json();
		if (!response.ok || data?.ok === false) {
			throw new Error(data?.error || `Bridge request failed: ${response.status}`);
		}
		return data;
	} catch (error) {
		if (error?.name === "AbortError") {
			throw new Error(`Bridge request timed out for ${path}`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function listBridgeClients() {
	const response = await bridgeRequest("/clients", {}, FAST_TIMEOUT_MS);
	return Array.isArray(response.clients) ? response.clients : [];
}

function inferBrowserLabel(client) {
	const userAgent = String(client?.hello?.browserName || "");
	if (/Helium/i.test(userAgent)) return "Helium";
	if (/Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return "Chrome";
	if (/Edg\//i.test(userAgent)) return "Edge";
	if (/Brave/i.test(userAgent)) return "Brave";
	if (/Firefox\//i.test(userAgent)) return "Firefox";
	if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "Safari";
	return "Browser";
}

function summarizeBridgeClient(client, preferredBrowserClientId = null) {
	const stateSummary = client?.stateSummary || {};
	const clientId = normalizeBrowserClientId(client?.clientId);
	const inferredBrowserLabel = inferBrowserLabel(client);
	const explicitClientLabel = String(client?.hello?.clientLabel || "").trim();
	const label = explicitClientLabel || inferredBrowserLabel;
	const descriptionParts = [];
	if (explicitClientLabel && inferredBrowserLabel && inferredBrowserLabel !== explicitClientLabel) {
		descriptionParts.push(inferredBrowserLabel);
	}
	descriptionParts.push(`${Number(stateSummary.tabCount || 0)} tab${Number(stateSummary.tabCount || 0) === 1 ? "" : "s"}`);
	return {
		clientId,
		label,
		description: descriptionParts.join(" • "),
		tabCount: Number(stateSummary.tabCount || 0),
		windowCount: Number(stateSummary.windowCount || 0),
		lastSeen: client?.lastSeen || null,
		isPreferred: Boolean(clientId && preferredBrowserClientId && clientId === preferredBrowserClientId),
	};
}

function pickBridgeClientById(clients, clientId) {
	const normalizedClientId = normalizeBrowserClientId(clientId);
	if (!normalizedClientId) return null;
	return (Array.isArray(clients) ? clients : []).find((client) => client?.clientId === normalizedClientId) || null;
}

function resolveBrowserClientFromCandidates(clients, candidates = []) {
	for (const candidate of candidates) {
		const matchedClient = pickBridgeClientById(clients, candidate);
		if (matchedClient) return matchedClient;
	}
	return Array.isArray(clients) && clients.length > 0 ? clients[0] : null;
}

async function resolveBrowserClientSelection({ requestedClientId = null, sessionFile = null } = {}) {
	const settings = await getOnhandSettings();
	const clients = await listBridgeClients();
	const sessionBrowserClientId = getSessionBrowserClientId(sessionFile, settings);
	const selectedClient = resolveBrowserClientFromCandidates(clients, [
		requestedClientId,
		sessionBrowserClientId,
		settings.preferredBrowserClientId,
	]);
	return {
		settings,
		clients,
		selectedClient,
		selectedClientId: normalizeBrowserClientId(selectedClient?.clientId),
		sessionBrowserClientId,
	};
}

function appendClientIdToBridgePath(path, clientId) {
	const normalizedClientId = normalizeBrowserClientId(clientId);
	if (!normalizedClientId) return path;
	const base = new URL(path, "http://bridge.local");
	base.searchParams.set("clientId", normalizedClientId);
	return `${base.pathname}${base.search}`;
}

async function runBridgeCommand(name, args = {}, timeoutMs = FAST_TIMEOUT_MS, clientId = null) {
	const response = await bridgeRequest(
		"/command",
		{
			method: "POST",
			body: JSON.stringify({
				name,
				args,
				clientId: normalizeBrowserClientId(clientId),
				timeoutMs,
			}),
		},
		timeoutMs + 500,
	);
	return response.result;
}

function flattenTabs(state) {
	const windows = Array.isArray(state?.windows) ? state.windows : [];
	return windows.flatMap((windowInfo) =>
		(Array.isArray(windowInfo.tabs) ? windowInfo.tabs : []).map((tab) => ({
			...tab,
			windowFocused: Boolean(windowInfo.focused),
		})),
	);
}

function pickActiveTab(state) {
	const tabs = flattenTabs(state);
	const focusedActive = tabs.find((tab) => tab.active && tab.windowFocused);
	if (focusedActive) return focusedActive;
	const active = tabs.find((tab) => tab.active);
	if (active) return active;
	return tabs[0];
}

function summarizeOpenTabs(state, activeTab, limit = 8) {
	const tabs = flattenTabs(state);
	if (!tabs.length) return [];

	const targetWindowId = activeTab?.windowId;
	return tabs
		.filter((tab) => {
			if (!tab?.id || isPrivilegedUrl(tab.url)) return false;
			if (targetWindowId == null) return true;
			return tab.windowId === targetWindowId;
		})
		.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(Boolean(b.windowFocused)) - Number(Boolean(a.windowFocused)))
		.slice(0, limit)
		.map((tab) => ({
			id: tab.id,
			windowId: tab.windowId,
			active: Boolean(tab.active),
			title: tab.title || "(untitled)",
			url: tab.url || "",
		}));
}

function isPrivilegedUrl(url) {
	return /^(?:chrome|edge|brave|about):\/\//i.test(String(url || ""));
}

async function getBrowserContext(options = {}) {
	const includeVisibleText = Boolean(options.includeVisibleText);
	const includeSelection = Boolean(options.includeSelection);

	try {
		const [health, selection] = await Promise.all([
			bridgeRequest("/health", {}, FAST_TIMEOUT_MS),
			resolveBrowserClientSelection({
				requestedClientId: options.clientId,
				sessionFile: options.sessionFile,
			}),
		]);
		const client = selection.selectedClient;
		const activeTab = pickActiveTab(client?.state);
		const openTabs = summarizeOpenTabs(client?.state, activeTab);
		const connectedClients = Array.isArray(health.connectedClients) ? health.connectedClients.length : 0;
		const browserClients = selection.clients.map((candidateClient) =>
			summarizeBridgeClient(candidateClient, selection.settings?.preferredBrowserClientId),
		);
		let visible = null;
		let selectedText = null;
		let warning = null;

		if (!connectedClients) {
			warning = "No connected browser clients.";
		} else if (!client?.clientId) {
			warning = "No matching browser client is currently connected.";
		} else if (activeTab?.id && activeTab.url && !isPrivilegedUrl(activeTab.url)) {
			if (includeSelection) {
				try {
					const selectionData = await bridgeRequest(
						"/command",
						{
							method: "POST",
							body: JSON.stringify({
								name: "get_selection",
								args: { tabId: activeTab.id },
								clientId: client.clientId,
								timeoutMs: 1500,
							}),
						},
						2200,
					);
					selectedText = selectionData.result?.selection || null;
				} catch (error) {
					warning = error?.message || String(error);
				}
			}

			if (includeVisibleText) {
				try {
					const visibleData = await bridgeRequest(
						"/command",
						{
							method: "POST",
							body: JSON.stringify({
								name: "get_visible_text",
								args: { tabId: activeTab.id, maxChars: 3000, maxBlocks: 12 },
								clientId: client.clientId,
								timeoutMs: 3000,
							}),
						},
						4000,
					);
					visible = visibleData.result?.visible || null;
				} catch (error) {
					warning ||= error?.message || String(error);
				}
			}
		} else if (activeTab?.url) {
			warning = `Interactive page context is unavailable on privileged pages like ${activeTab.url}`;
		}

		return {
			ok: true,
			hotkey: HOTKEY,
			bridge: {
				host: health.host,
				port: health.port,
				connectedClients,
			},
			clientId: client?.clientId,
			browserClients,
			activeTab,
			openTabs,
			selection: selectedText,
			visible,
			warning,
		};
	} catch (error) {
		return {
			ok: false,
			hotkey: HOTKEY,
			error: error?.message || String(error),
		};
	}
}

function sendPromptEvent(payload) {
	mainWindow?.webContents.send("onhand:prompt-event", payload);
}

function normalizePromptRequest(input) {
	if (typeof input === "string") {
		const prompt = input.trim();
		if (!prompt) {
			throw new Error("Prompt cannot be empty.");
		}
		return {
			promptText: prompt,
			displayPrompt: prompt,
			attachments: [],
			browserClientId: null,
		};
	}

	if (input && typeof input === "object" && ("promptText" in input || "displayPrompt" in input)) {
		let promptText = String(input.promptText || "").trim();
		const attachments = Array.isArray(input.attachments) ? input.attachments.filter((attachment) => attachment && typeof attachment === "object") : [];
		const displayPrompt =
			String(input.displayPrompt || "").trim() ||
			[promptText].filter(Boolean).join("\n\n");
		if (!promptText && !attachments.length && displayPrompt) {
			promptText = displayPrompt;
		}
		if (!promptText && !attachments.length) {
			throw new Error("Prompt cannot be empty.");
		}
		const attachmentNames = attachments.map((attachment) => String(attachment.name || "attachment")).filter(Boolean);
		const attachmentLine = attachmentNames.length ? `Attached: ${attachmentNames.join(", ")}` : "";
		const finalDisplayPrompt = displayPrompt || [promptText, attachmentLine].filter(Boolean).join("\n\n") || attachmentLine;
		return {
			promptText,
			displayPrompt: finalDisplayPrompt,
			attachments,
			source: input.source === "sidebar" ? "sidebar" : "desktop",
			learningMode: Boolean(input.learningMode),
			browserClientId: normalizeBrowserClientId(input.browserClientId),
		};
	}

	let promptText = String(input?.prompt || "").trim();
	const attachments = Array.isArray(input?.attachments) ? input.attachments.filter((attachment) => attachment && typeof attachment === "object") : [];
	const requestedDisplayPrompt = String(input?.displayPrompt || "").trim();
	if (!promptText && !attachments.length && requestedDisplayPrompt) {
		promptText = requestedDisplayPrompt;
	}
	if (!promptText && !attachments.length) {
		throw new Error("Prompt cannot be empty.");
	}
	const attachmentNames = attachments.map((attachment) => String(attachment.name || "attachment")).filter(Boolean);
	const attachmentLine = attachmentNames.length ? `Attached: ${attachmentNames.join(", ")}` : "";
	const displayPrompt =
		requestedDisplayPrompt ||
		[promptText, attachmentLine].filter(Boolean).join("\n\n") ||
		attachmentLine;

	return {
		promptText,
		displayPrompt,
		attachments,
		source: input?.source === "sidebar" ? "sidebar" : "desktop",
		learningMode: Boolean(input?.learningMode),
		browserClientId: normalizeBrowserClientId(input?.browserClientId),
	};
}

async function runPromptRequest(requestId, request) {
	const { promptText, displayPrompt, attachments, source, learningMode, browserClientId } = normalizePromptRequest(request);
	let initialStatus = "Collecting browser context…";
	await primeOnhandUiRequest(requestId, displayPrompt, initialStatus);
	sendPromptEvent({ type: "start", requestId, prompt: displayPrompt });
	sendPromptEvent({ type: "status", requestId, status: initialStatus });
	const currentSessionFile = getOnhandUiState().currentSession?.sessionFile || null;

	try {
		const selection = await resolveBrowserClientSelection({
			requestedClientId: browserClientId,
			sessionFile: currentSessionFile,
		});
		const resolvedBrowserClientId = selection.selectedClientId;
		if (source !== "sidebar") {
			try {
				await runBridgeCommand("open_onhand_sidebar", {}, 2500, resolvedBrowserClientId);
			} catch (error) {
				const detail = error?.message || String(error);
				if (detail) {
					initialStatus = `Collecting browser context… ${detail}`;
					sendPromptEvent({ type: "status", requestId, status: initialStatus });
				}
			}
		}

		const browserContext = await getBrowserContext({
			includeSelection: true,
			includeVisibleText: true,
			clientId: resolvedBrowserClientId,
			sessionFile: currentSessionFile,
		});
		sendPromptEvent({ type: "context", requestId, context: browserContext });

		const result = await submitOnhandPrompt({
			requestId,
			prompt: promptText,
			displayPrompt,
			attachments,
			browserContext,
			browserClientId: browserContext.clientId || resolvedBrowserClientId,
			learningMode,
			onEvent: (event) => sendPromptEvent({ requestId, ...event }),
		});
		if (result?.sessionFile && (browserContext.clientId || resolvedBrowserClientId)) {
			await setSessionBrowserClientId(result.sessionFile, browserContext.clientId || resolvedBrowserClientId);
		}
	} catch (error) {
		sendPromptEvent({
			type: "error",
			requestId,
			message: error?.message || String(error),
			actions: Array.isArray(error?.pageActions) ? error.pageActions : [],
		});
	}
}

function queuePromptRequest(request) {
	const normalizedRequest = normalizePromptRequest(request);
	const requestId = randomUUID();
	setTimeout(() => {
		void runPromptRequest(requestId, normalizedRequest).catch((error) => {
			log("Prompt request failed", error?.message || String(error));
		});
	}, 0);
	return { ok: true, requestId };
}

async function readBrowserArtifactIndex() {
	try {
		const raw = await readFile(BROWSER_ARTIFACT_INDEX_PATH, "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
	} catch {
		return [];
	}
}

function chooseBestMatchingTab(tabs, url, title) {
	const exactUrlMatches = tabs.filter((tab) => (tab?.url || "") === url);
	if (exactUrlMatches.length > 0) {
		return exactUrlMatches.find((tab) => tab.active) || exactUrlMatches[0];
	}
	const exactTitleMatches = tabs.filter((tab) => (tab?.title || "") === title);
	if (exactTitleMatches.length > 0) {
		return exactTitleMatches.find((tab) => tab.active) || exactTitleMatches[0];
	}
	return null;
}

async function getOpenBrowserTabs(clientId = null) {
	const stateData = await bridgeRequest(appendClientIdToBridgePath("/state", clientId), {}, FAST_TIMEOUT_MS);
	return flattenTabs(stateData.client?.state);
}

async function resolveTargetTabForArtifact(manifest, clientId = null) {
	const artifactUrl = manifest?.page?.url || manifest?.tab?.url || "";
	const artifactTitle = manifest?.page?.title || manifest?.tab?.title || "";
	const tabs = await getOpenBrowserTabs(clientId);
	const existingTab = chooseBestMatchingTab(tabs, artifactUrl, artifactTitle);
	if (existingTab?.id) {
		const focused = await runBridgeCommand("activate_tab", { tabId: existingTab.id }, 2500, clientId);
		return focused.tab || existingTab;
	}
	if (!artifactUrl) {
		throw new Error("Artifact does not include a restorable page URL.");
	}
	const navigated = await runBridgeCommand(
		"navigate",
		{
			url: artifactUrl,
			newTab: true,
			waitForLoad: true,
		},
		20000,
		clientId,
	);
	return navigated.tab;
}

async function restoreArtifactSummary(artifactSummary, clientId = null) {
	if (!artifactSummary?.statePath) {
		throw new Error("Artifact is missing its saved state path.");
	}
	const statePath = resolve(join(__dirname, "..", ".."), artifactSummary.statePath);
	const raw = await readFile(statePath, "utf8");
	const manifest = JSON.parse(raw);
	if (manifest?.type !== "browser_capture") {
		throw new Error(`Artifact ${artifactSummary.artifactId || statePath} is not a browser capture.`);
	}

	const tab = await resolveTargetTabForArtifact(manifest, clientId);
	await runBridgeCommand("clear_annotations", { tabId: tab.id }, 15000, clientId);

	const annotations = Array.isArray(manifest?.page?.annotations) ? manifest.page.annotations : [];
	const restored = [];
	const failed = [];

	for (const annotation of annotations) {
		try {
			const highlighted = await runBridgeCommand(
				"highlight_text",
				{
					tabId: tab.id,
					text: annotation.matchedText,
					clearExisting: false,
					scrollIntoView: false,
				},
				HIGHLIGHT_TIMEOUT_MS,
				clientId,
			);
			const restoredAnnotationId = highlighted.annotation?.annotationId;
			let noteRestored = false;
			if (restoredAnnotationId && annotation.note?.text) {
				await runBridgeCommand(
					"show_note",
					{
						tabId: tab.id,
						annotationId: restoredAnnotationId,
						note: annotation.note.text,
						label: annotation.note.label,
						scrollIntoView: false,
					},
					20000,
					clientId,
				);
				noteRestored = true;
			}
			restored.push({
				annotationId: restoredAnnotationId,
				noteRestored,
			});
		} catch (error) {
			failed.push({
				annotationId: annotation?.annotationId || null,
				error: error?.message || String(error),
			});
		}
	}

	const lastRestored = restored[restored.length - 1];
	if (lastRestored?.annotationId) {
		await runBridgeCommand(
			"scroll_to_annotation",
			{
				tabId: tab.id,
				annotationId: lastRestored.annotationId,
				target: lastRestored.noteRestored ? "note" : "annotation",
			},
			15000,
			clientId,
		);
	} else if (typeof manifest?.page?.scrollY === "number") {
		await runBridgeCommand(
			"run_js",
			{
				tabId: tab.id,
				expression: `(() => { window.scrollTo(${JSON.stringify(Number(manifest.page.scrollX || 0))}, ${JSON.stringify(Number(manifest.page.scrollY || 0))}); return { scrollX: window.scrollX, scrollY: window.scrollY }; })()`,
			},
			15000,
			clientId,
		);
	}

	return {
		artifactId: artifactSummary.artifactId,
		title: artifactSummary.title || manifest?.page?.title || manifest?.tab?.title || "(untitled)",
		url: artifactSummary.url || manifest?.page?.url || manifest?.tab?.url || "",
		tabId: tab?.id || null,
		restoredCount: restored.length,
		failedCount: failed.length,
	};
}

async function restoreSessionPages(sessionPath, browserClientId = null) {
	if (!sessionPath || typeof sessionPath !== "string") {
		throw new Error("Session path is required.");
	}
	const normalizedSessionPath = resolve(sessionPath);
	const resolvedBrowserClientId =
		normalizeBrowserClientId(browserClientId) ||
		getSessionBrowserClientId(normalizedSessionPath, await getOnhandSettings());
	const artifacts = await readBrowserArtifactIndex();
	const sessionArtifacts = artifacts
		.filter(
			(artifact) =>
				artifact &&
				resolve(String(artifact.sessionFile || "")) === normalizedSessionPath &&
				typeof artifact.statePath === "string" &&
				String(artifact.url || "").trim(),
		)
		.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));

	if (!sessionArtifacts.length) {
		throw new Error("No saved browser artifacts were found for that session.");
	}

	const latestArtifactsByUrl = new Map();
	for (const artifact of sessionArtifacts) {
		const key = String(artifact.url || artifact.title || artifact.artifactId);
		if (!latestArtifactsByUrl.has(key)) {
			latestArtifactsByUrl.set(key, artifact);
		}
	}

	const restoredPages = [];
	for (const artifact of latestArtifactsByUrl.values()) {
		restoredPages.push(await restoreArtifactSummary(artifact, resolvedBrowserClientId));
	}

	return {
		sessionPath: normalizedSessionPath,
		restoredPages,
		restoredCount: restoredPages.length,
	};
}

async function activateOnhandPageAction(actionKey, browserClientId = null) {
	const action = getOnhandPageAction(actionKey);
	if (!action) {
		throw new Error("Could not find that Onhand page action.");
	}
	const targetClientId = normalizeBrowserClientId(action.clientId) || normalizeBrowserClientId(browserClientId);

	if (typeof action.tabId === "number") {
		await runBridgeCommand("activate_tab", { tabId: action.tabId }, 2500, targetClientId);
	}

	if (action.annotationId) {
		await runBridgeCommand(
			"scroll_to_annotation",
			{
				tabId: typeof action.tabId === "number" ? action.tabId : undefined,
				annotationId: action.annotationId,
				target: action.type === "note" ? "note" : "annotation",
			},
			2500,
			targetClientId,
		);
	}

	return action;
}

async function startOnhandUiRuntimeServer() {
	const connection = await loadBridgeConnection();
	const bridgeUrl = new URL(connection.baseUrl);
	onhandUiServer = createOnhandUiServer({
		host: bridgeUrl.hostname || "127.0.0.1",
		port: ONHAND_UI_PORT,
		token: connection.token,
		getState: async () => buildOnhandUiState(),
		getSettings: async () => getOnhandSettings(),
		updateSettings: async (partial) => saveOnhandSettings(partial),
		listSessions: async (limit) => getSessionOverview(limit),
		startNewSession: async () => startNewOnhandSession(),
		switchSession: async (sessionPath) => switchOnhandSession(sessionPath),
		renameSession: async (sessionName) => renameCurrentOnhandSession(sessionName),
		restoreSession: async (sessionPath, browserClientId) => restoreSessionPages(sessionPath, browserClientId),
		stopPrompt: async () => stopOnhandRun(),
		submitPrompt: async (request) => queuePromptRequest(request),
		activateAction: async (actionKey, browserClientId) => activateOnhandPageAction(actionKey, browserClientId),
	});
	await onhandUiServer.listen();
	log(`Onhand UI API listening on ${onhandUiServer.getInfo().baseUrl}`);
}

function sendFocusInput() {
	mainWindow?.webContents.send("onhand:focus-input");
}

function notifyPaletteOpened() {
	mainWindow?.webContents.send("onhand:palette-opened");
}

async function getFrontmostApplicationId() {
	if (process.platform !== "darwin") return null;
	try {
		const { stdout } = await execFileAsync("osascript", [
			"-e",
			'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
		]);
		const bundleId = String(stdout || "").trim();
		const ownBundleId = typeof app.getBundleID === "function" ? app.getBundleID() : null;
		if (!bundleId || (ownBundleId && bundleId === ownBundleId)) {
			return null;
		}
		return bundleId;
	} catch (error) {
		log("Could not determine frontmost application", error?.message || String(error));
		return null;
	}
}

function quoteAppleScriptString(value) {
	return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function activateApplicationById(bundleId) {
	if (process.platform !== "darwin" || !bundleId) return;
	try {
		await execFileAsync("osascript", ["-e", `tell application id ${quoteAppleScriptString(bundleId)} to activate`]);
	} catch (error) {
		log(`Could not reactivate previous application ${bundleId}`, error?.message || String(error));
	}
}

function positionWindowLikePalette() {
	if (!mainWindow) return;
	const cursorPoint = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursorPoint);
	const bounds = mainWindow.getBounds();
	const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2);
	const y = Math.round(display.workArea.y + Math.max(48, Math.min(120, display.workArea.height * 0.12)));
	mainWindow.setPosition(x, y);
}

function cancelPendingBlurHide() {
	if (pendingBlurHideTimeout) {
		clearTimeout(pendingBlurHideTimeout);
		pendingBlurHideTimeout = null;
	}
}

function cancelPendingWorkspaceDetach() {
	if (pendingWorkspaceDetachTimeout) {
		clearTimeout(pendingWorkspaceDetachTimeout);
		pendingWorkspaceDetachTimeout = null;
	}
}

function setMacWorkspaceVisibility(visible) {
	if (process.platform !== "darwin" || !mainWindow) return;
	mainWindow.setVisibleOnAllWorkspaces(visible, MACOS_WORKSPACE_VISIBILITY_OPTIONS);
}

function restoreVisibleWindowAppearance() {
	if (!mainWindow) return;
	if (process.platform === "darwin") {
		mainWindow.setHasShadow(true);
	}
	mainWindow.setOpacity(1);
}

function scheduleWorkspaceDetach() {
	if (process.platform !== "darwin" || !mainWindow?.isVisible()) return;
	cancelPendingWorkspaceDetach();
	pendingWorkspaceDetachTimeout = setTimeout(() => {
		pendingWorkspaceDetachTimeout = null;
		if (!mainWindow?.isVisible() || !mainWindow.isFocused()) return;
		setMacWorkspaceVisibility(false);
	}, WORKSPACE_VISIBILITY_SETTLE_MS);
	pendingWorkspaceDetachTimeout.unref?.();
}

function prepareWindowForShow() {
	if (!mainWindow) return;
	if (process.platform === "darwin") {
		setMacWorkspaceVisibility(true);
	}
	restoreVisibleWindowAppearance();
}

function beginWindowDismiss() {
	if (!mainWindow) return;
	cancelPendingWorkspaceDetach();
	mainWindow.setOpacity(0);
	if (process.platform === "darwin") {
		mainWindow.setHasShadow(false);
		setMacWorkspaceVisibility(false);
	}
}

function scheduleBlurHide() {
	if (!mainWindow?.isVisible()) return;
	cancelPendingBlurHide();
	beginWindowDismiss();
	pendingBlurHideTimeout = setTimeout(() => {
		pendingBlurHideTimeout = null;
		if (!mainWindow?.isVisible()) return;
		if (mainWindow.isFocused()) {
			prepareWindowForShow();
			return;
		}
		void hideWindow();
	}, BLUR_HIDE_DELAY_MS);
	pendingBlurHideTimeout.unref?.();
}

async function showWindow() {
	if (!mainWindow) createWindow();
	if (!mainWindow) return;
	cancelPendingBlurHide();
	cancelPendingWorkspaceDetach();
	previousFrontmostAppId = await getFrontmostApplicationId();
	prepareWindowForShow();
	positionWindowLikePalette();
	mainWindow.show();
	mainWindow.focus();
	scheduleWorkspaceDetach();
	sendFocusInput();
	notifyPaletteOpened();
}

async function hideWindow(options = {}) {
	if (!mainWindow) return;
	cancelPendingBlurHide();
	const restorePreviousApp = Boolean(options.restorePreviousApp);
	const appToRestore = restorePreviousApp ? previousFrontmostAppId : null;
	previousFrontmostAppId = null;
	beginWindowDismiss();
	mainWindow.hide();
	if (appToRestore) {
		await activateApplicationById(appToRestore);
	}
}

async function toggleWindow() {
	if (!mainWindow) {
		await showWindow();
		return;
	}
	if (mainWindow.isVisible()) {
		await hideWindow({ restorePreviousApp: true });
	} else {
		await showWindow();
	}
}

async function handleHotkeyToggle() {
	const now = Date.now();
	if (hotkeyToggleInFlight) return;
	if (now - lastHotkeyToggleAt < HOTKEY_DEBOUNCE_MS) return;
	lastHotkeyToggleAt = now;
	hotkeyToggleInFlight = true;
	try {
		await toggleWindow();
	} finally {
		hotkeyToggleInFlight = false;
	}
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 840,
		height: 340,
		minWidth: 840,
		minHeight: 340,
		maxWidth: 840,
		maxHeight: 340,
		show: false,
		frame: false,
		transparent: true,
		hasShadow: true,
		resizable: false,
		movable: false,
		fullscreenable: false,
		maximizable: false,
		minimizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		title: "Onhand",
		backgroundColor: "#00000000",
		vibrancy: process.platform === "darwin" ? "under-window" : undefined,
		visualEffectState: process.platform === "darwin" ? "active" : undefined,
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.setAlwaysOnTop(true, "floating");
	if (process.platform === "darwin") {
		mainWindow.setHiddenInMissionControl(true);
	}
	mainWindow.setOpacity(0);
	positionWindowLikePalette();
	mainWindow.loadFile(join(__dirname, "index.html"));
	mainWindow.on("close", (event) => {
		if (appIsQuitting) return;
		event.preventDefault();
		void hideWindow({ restorePreviousApp: true });
	});
	mainWindow.on("closed", () => {
		cancelPendingBlurHide();
		cancelPendingWorkspaceDetach();
		mainWindow = null;
	});
	mainWindow.on("focus", () => {
		cancelPendingBlurHide();
		if (mainWindow?.isVisible()) {
			restoreVisibleWindowAppearance();
			scheduleWorkspaceDetach();
		}
	});
	mainWindow.on("blur", () => {
		scheduleBlurHide();
	});
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown") return;
		if (input.key === "Escape") {
			event.preventDefault();
			void hideWindow({ restorePreviousApp: true });
			return;
		}
		if ((input.meta || input.control) && String(input.key || "").toLowerCase() === "w") {
			event.preventDefault();
			void hideWindow({ restorePreviousApp: true });
		}
	});
	mainWindow.webContents.on("did-finish-load", () => {
		if (mainWindow?.isVisible()) {
			sendFocusInput();
			notifyPaletteOpened();
		}
	});
}

ipcMain.handle("onhand:get-startup-state", async () => ({
	hotkey: HOTKEY,
	platform: process.platform,
	version: app.getVersion(),
	learningMode: Boolean((await getOnhandSettings()).learningMode),
	preferredBrowserClientId: normalizeBrowserClientId((await getOnhandSettings()).preferredBrowserClientId),
}));

ipcMain.handle("onhand:set-learning-mode", async (_event, learningMode) => {
	return await saveOnhandSettings({ learningMode: Boolean(learningMode) });
});

ipcMain.handle("onhand:refresh-context", async (_event, browserClientId) => {
	return await getBrowserContext({
		clientId: normalizeBrowserClientId(browserClientId),
		sessionFile: getOnhandUiState().currentSession?.sessionFile || null,
	});
});

ipcMain.handle("onhand:set-browser-client", async (_event, browserClientId) => {
	return await saveOnhandSettings({
		preferredBrowserClientId: normalizeBrowserClientId(browserClientId),
	});
});

ipcMain.handle("onhand:list-sessions", async (_event, limit = 3) => {
	return await getSessionOverview(Number(limit) || 3);
});

ipcMain.handle("onhand:new-session", async () => {
	return await startNewOnhandSession();
});

ipcMain.handle("onhand:switch-session", async (_event, sessionPath) => {
	if (!sessionPath || typeof sessionPath !== "string") {
		throw new Error("sessionPath is required");
	}
	return await switchOnhandSession(sessionPath);
});

ipcMain.handle("onhand:submit-prompt", async (_event, prompt) => {
	return queuePromptRequest(prompt);
});

ipcMain.handle("onhand:hide-window", async (_event, options = {}) => {
	await hideWindow(options);
	return { ok: true };
});

app.whenReady().then(() => {
	if (process.platform === "darwin") {
		app.setActivationPolicy("accessory");
	}
	startOnhandUiRuntimeServer().catch((error) => {
		log("Could not start Onhand UI API", error?.message || String(error));
	});
	createWindow();
	const registered = globalShortcut.register(HOTKEY, () => {
		void handleHotkeyToggle();
	});
	if (!registered) {
		log(`Could not register global shortcut: ${HOTKEY}`);
	} else {
		log(`Registered global shortcut: ${HOTKEY}`);
	}
	log("Desktop shell ready");
});

if (process.platform === "darwin") {
	app.on("did-resign-active", () => {
		scheduleBlurHide();
	});
	app.on("did-become-active", () => {
		cancelPendingBlurHide();
		if (mainWindow?.isVisible()) {
			restoreVisibleWindowAppearance();
			scheduleWorkspaceDetach();
		}
	});
}

app.on("before-quit", () => {
	appIsQuitting = true;
});

app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	void onhandUiServer?.close?.().catch?.(() => {});
	void disposeOnhandAgent();
});
