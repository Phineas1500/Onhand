import { ONHAND_EXTENSION_RUNTIME_REVISION } from "./runtime-revision.js";

const DEFAULT_SETTINGS = {
	bridgeUrl: "ws://127.0.0.1:3210/ws",
	token: "",
	clientLabel: "",
};

const DEFAULT_ONHAND_API_PORT = 3211;
const STATE_DEBOUNCE_MS = 200;
const RECONNECT_DELAY_MS = 2000;
const WEBSOCKET_KEEPALIVE_MS = 20_000;
const SCREENSHOT_DELAY_MS = 150;
const SCRIPT_EXECUTION_TIMEOUT_MS = 2500;
const DEBUGGER_ATTACH_RETRY_DELAY_MS = 150;
const SIDEBAR_WINDOW_STATES_KEY = "onhandSidebarWindowStates";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

let ws = null;
let socketGeneration = 0;
let reconnectTimer = null;
let keepAliveTimer = null;
let stateTimer = null;
let settingsCache = null;
let creatingOffscreenDocument = null;
let connectBridgePromise = null;
const debuggerTaskChains = new Map();
const tabCommandTaskChains = new Map();

function log(...args) {
	console.log("[onhand-browser-bridge]", ...args);
}

function configureSidePanelActionClick() {
	if (!chrome.sidePanel?.setPanelBehavior) return;
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
		log("Could not configure side panel action behavior", error?.message || String(error));
	});
}

function initializeExtensionSurface() {
	configureSidePanelActionClick();
	ensureOffscreenDocument().catch((error) => {
		log("Could not initialize offscreen heartbeat document", error?.message || String(error));
	});
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateStatus(partial) {
	await chrome.storage.local.set(partial);
}

async function loadSettings() {
	const stored = await chrome.storage.local.get({
		...DEFAULT_SETTINGS,
		clientId: "",
		connectionStatus: "disconnected",
		lastError: "",
		lastConnectedAt: 0,
	});

	if (!stored.clientId) {
		stored.clientId = self.crypto.randomUUID();
		await chrome.storage.local.set({ clientId: stored.clientId });
	}

	settingsCache = stored;
	return stored;
}

async function getSettings() {
	return settingsCache || (await loadSettings());
}

function clearReconnectTimer() {
	if (!reconnectTimer) return;
	clearTimeout(reconnectTimer);
	reconnectTimer = null;
}

async function ensureOffscreenDocument() {
	if (!chrome.offscreen?.createDocument) return;

	const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [offscreenUrl],
	});

	if (existingContexts.length > 0) {
		return;
	}

	if (creatingOffscreenDocument) {
		await creatingOffscreenDocument;
		return;
	}

	creatingOffscreenDocument = chrome.offscreen
		.createDocument({
			url: OFFSCREEN_DOCUMENT_PATH,
			reasons: ["WORKERS"],
			justification: "Maintain the browser bridge heartbeat in Chrome MV3.",
		})
		.finally(() => {
			creatingOffscreenDocument = null;
		});

	await creatingOffscreenDocument;
}

function clearKeepAliveTimer() {
	if (!keepAliveTimer) return;
	clearInterval(keepAliveTimer);
	keepAliveTimer = null;
}

function startKeepAlive() {
	clearKeepAliveTimer();
	keepAliveTimer = setInterval(() => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			clearKeepAliveTimer();
			return;
		}
		sendToBridge({
			type: "keepalive",
			clientId: settingsCache?.clientId || undefined,
			sentAt: Date.now(),
		});
	}, WEBSOCKET_KEEPALIVE_MS);
}

function scheduleReconnect() {
	clearReconnectTimer();
	reconnectTimer = setTimeout(() => {
		connectBridge().catch((error) => {
			log("Reconnect failed", error);
		});
	}, RECONNECT_DELAY_MS);
}

function stopSocket() {
	clearKeepAliveTimer();
	if (!ws) return;
	try {
		ws.onopen = null;
		ws.onclose = null;
		ws.onerror = null;
		ws.onmessage = null;
		ws.close();
	} catch {}
	ws = null;
}

function sendToBridge(message) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	ws.send(JSON.stringify(message));
	return true;
}

function bridgeWsToHttp(url) {
	const parsed = new URL(String(url || DEFAULT_SETTINGS.bridgeUrl));
	parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
	return parsed;
}

function getOnhandApiBaseUrl(bridgeUrl) {
	const parsed = bridgeWsToHttp(bridgeUrl);
	parsed.port = String(DEFAULT_ONHAND_API_PORT);
	parsed.pathname = "";
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString().replace(/\/$/, "");
}

function getBridgeHealthUrl(bridgeUrl) {
	const parsed = bridgeWsToHttp(bridgeUrl);
	parsed.pathname = "/health";
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

async function probeBridgeAvailability(settings) {
	const response = await fetch(getBridgeHealthUrl(settings.bridgeUrl), {
		headers: {
			Authorization: `Bearer ${settings.token}`,
		},
	});

	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error("Bridge health check returned a non-JSON response.");
	}

	if (!response.ok || data?.ok === false) {
		throw new Error(data?.error || `Bridge health check failed: ${response.status}`);
	}

	return data;
}

async function callOnhandApi(path, init = {}) {
	const settings = await getSettings();
	if (!settings.token) {
		throw new Error("Set the bridge token in the extension options.");
	}

	const headers = new Headers(init.headers || {});
	headers.set("Authorization", `Bearer ${settings.token}`);
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(`${getOnhandApiBaseUrl(settings.bridgeUrl)}${path}`, {
		...init,
		headers,
	});

	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error(`Onhand UI API returned a non-JSON response for ${path}`);
	}

	if (!response.ok || data?.ok === false) {
		throw new Error(data?.error || `Onhand UI API request failed: ${response.status}`);
	}

	return data;
}

async function getSidebarWindowStates() {
	const stored = await chrome.storage.local.get({ [SIDEBAR_WINDOW_STATES_KEY]: {} });
	return stored[SIDEBAR_WINDOW_STATES_KEY] || {};
}

async function setSidebarWindowOpen(windowId, open) {
	if (typeof windowId !== "number") return;
	const states = await getSidebarWindowStates();
	if (open) {
		states[String(windowId)] = true;
	} else {
		delete states[String(windowId)];
	}
	await chrome.storage.local.set({ [SIDEBAR_WINDOW_STATES_KEY]: states });
}

async function isSidebarOpenForWindow(windowId) {
	if (typeof windowId !== "number") return false;
	const states = await getSidebarWindowStates();
	return Boolean(states[String(windowId)]);
}

async function resolveSidebarWindowId(args = {}) {
	if (typeof args.windowId === "number") return args.windowId;
	const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	if (typeof activeTab?.windowId === "number") return activeTab.windowId;
	const windowInfo = await chrome.windows.getLastFocused();
	return windowInfo?.id ?? null;
}

async function openSidebarForWindow(windowId) {
	if (typeof windowId !== "number") {
		throw new Error("No browser window is available for the Onhand sidebar.");
	}
	try {
		await chrome.sidePanel.open({ windowId });
	} catch (error) {
		const message = error?.message || String(error);
		if (/user gesture|may only be called/i.test(message)) {
			throw new Error("Chrome blocked auto-opening the side panel. Click the Onhand extension icon once.");
		}
		throw error;
	}
	await setSidebarWindowOpen(windowId, true);
	return { windowId, open: true };
}

async function closeSidebarForWindow(windowId) {
	if (typeof windowId !== "number") return { windowId, open: false };
	if (chrome.sidePanel?.close) {
		await chrome.sidePanel.close({ windowId });
	}
	await setSidebarWindowOpen(windowId, false);
	return { windowId, open: false };
}

function simplifyTab(tab) {
	return {
		id: tab.id,
		windowId: tab.windowId,
		index: tab.index,
		active: Boolean(tab.active),
		pinned: Boolean(tab.pinned),
		audible: Boolean(tab.audible),
		muted: Boolean(tab.mutedInfo?.muted),
		title: tab.title || "",
		url: tab.url || "",
		status: tab.status || "unknown",
		discarded: Boolean(tab.discarded),
	};
}

function simplifyWindow(windowInfo) {
	return {
		id: windowInfo.id,
		focused: Boolean(windowInfo.focused),
		type: windowInfo.type,
		state: windowInfo.state,
		tabs: (windowInfo.tabs || []).map(simplifyTab),
	};
}

async function snapshotState() {
	const windows = await chrome.windows.getAll({ populate: true });
	const focusedWindow = windows.find((windowInfo) => windowInfo.focused);
	return {
		capturedAt: Date.now(),
		focusedWindowId: focusedWindow?.id ?? null,
		windows: windows.map(simplifyWindow),
	};
}

async function pushState(reason = "update") {
	const settings = await getSettings();
	if (!settings.clientId) return;
	const state = await snapshotState();
	sendToBridge({
		type: "state",
		clientId: settings.clientId,
		reason,
		state,
	});
}

function scheduleStatePush(reason) {
	if (stateTimer) clearTimeout(stateTimer);
	stateTimer = setTimeout(() => {
		pushState(reason).catch((error) => {
			log("Failed to push state", error);
		});
	}, STATE_DEBOUNCE_MS);
}

async function focusTab(tabId) {
	const tab = await chrome.tabs.get(tabId);
	if (typeof tab.windowId === "number") {
		await chrome.windows.update(tab.windowId, { focused: true });
	}
	await chrome.tabs.update(tabId, { active: true });
	return await chrome.tabs.get(tabId);
}

async function resolveTargetTab(args = {}) {
	if (typeof args.tabId === "number") {
		return await chrome.tabs.get(args.tabId);
	}

	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	if (!tab?.id) {
		throw new Error("No active tab found");
	}
	return tab;
}

function isDebuggerAttachConflict(error) {
	return /another debugger|already attached/i.test(error?.message || String(error));
}

async function attachDebuggerWithRetry(target) {
	let lastError = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await chrome.debugger.attach(target, "1.3");
			return;
		} catch (error) {
			lastError = error;
			if (!isDebuggerAttachConflict(error)) throw error;
			try {
				await chrome.debugger.detach(target);
			} catch {}
			await delay(DEBUGGER_ATTACH_RETRY_DELAY_MS * (attempt + 1));
		}
	}
	throw lastError;
}

async function withDebugger(tabId, fn) {
	const previousTask = debuggerTaskChains.get(tabId) || Promise.resolve();
	const scheduledTask = previousTask.catch(() => {}).then(async () => {
		const target = { tabId };
		await attachDebuggerWithRetry(target);
		try {
			return await fn({
				send: async (method, params = {}) => {
					return await chrome.debugger.sendCommand(target, method, params);
				},
			});
		} finally {
			try {
				await chrome.debugger.detach(target);
			} catch {}
		}
	});

	const trackedTask = scheduledTask.finally(() => {
		if (debuggerTaskChains.get(tabId) === trackedTask) {
			debuggerTaskChains.delete(tabId);
		}
	});

	debuggerTaskChains.set(tabId, trackedTask);
	return await trackedTask;
}

async function withTabCommand(tabId, fn) {
	const previousTask = tabCommandTaskChains.get(tabId) || Promise.resolve();
	const scheduledTask = previousTask.catch(() => {}).then(fn);
	const trackedTask = scheduledTask.finally(() => {
		if (tabCommandTaskChains.get(tabId) === trackedTask) {
			tabCommandTaskChains.delete(tabId);
		}
	});
	tabCommandTaskChains.set(tabId, trackedTask);
	return await trackedTask;
}

function normalizeExecuteScriptValue(value) {
	if (value == null) return value;
	if (["string", "number", "boolean"].includes(typeof value)) return value;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}

async function withOperationTimeout(promise, timeoutMs, timeoutMessage) {
	let timeoutId = null;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

async function executeScriptInTab(tabId, func, args = []) {
	const results = await chrome.scripting.executeScript({
		target: { tabId },
		world: "ISOLATED",
		func,
		args,
	});
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error("No script result returned");
	}
	return results[0].result;
}

function normalizeRemoteObject(remoteObject) {
	if (!remoteObject) return null;
	if (Object.prototype.hasOwnProperty.call(remoteObject, "value")) {
		return remoteObject.value;
	}
	if (Object.prototype.hasOwnProperty.call(remoteObject, "unserializableValue")) {
		return remoteObject.unserializableValue;
	}
	return {
		type: remoteObject.type,
		subtype: remoteObject.subtype,
		description: remoteObject.description,
	};
}

function clampNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.round(value)));
}

function truncateText(value, maxLength = 500) {
	const text = typeof value === "string" ? value : String(value ?? "");
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}…`;
}

function remoteObjectToText(remoteObject) {
	const value = normalizeRemoteObject(remoteObject);
	if (typeof value === "string") return value;
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "object") {
		const json = JSON.stringify(value);
		return json === undefined ? String(value) : json;
	}
	return String(value);
}

function normalizeHeaders(headers) {
	if (!headers || typeof headers !== "object") return undefined;
	const normalized = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined || value === null) continue;
		normalized[String(key)] = Array.isArray(value)
			? value.map((part) => String(part)).join(", ")
			: String(value);
	}
	return normalized;
}

function isTextualMimeType(mimeType, url = "") {
	const mime = String(mimeType || "").toLowerCase();
	if (
		mime.startsWith("text/") ||
		mime.includes("json") ||
		mime.includes("javascript") ||
		mime.includes("xml") ||
		mime.includes("svg") ||
		mime.includes("x-www-form-urlencoded")
	) {
		return true;
	}
	return /\.(?:txt|md|html?|json|js|mjs|css|xml|svg|csv)(?:[?#]|$)/i.test(url);
}

function decodeBase64Utf8(base64) {
	const binary = atob(base64);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function formatResponseBodyPayload(bodyPayload, mimeType, maxChars) {
	if (!bodyPayload || typeof bodyPayload.body !== "string") {
		return undefined;
	}

	let text;
	let encoding = bodyPayload.base64Encoded ? "base64" : "text";
	try {
		text = bodyPayload.base64Encoded ? decodeBase64Utf8(bodyPayload.body) : bodyPayload.body;
	} catch {
		return {
			encoding,
			text: `[Body omitted: could not decode ${encoding} payload]`,
			truncated: false,
		};
	}

	if (!isTextualMimeType(mimeType)) {
		return {
			encoding,
			text: `[Body omitted: non-textual content type ${mimeType || "unknown"}]`,
			truncated: false,
		};
	}

	const truncated = text.length > maxChars;
	return {
		encoding,
		text: truncated ? text.slice(0, maxChars) : text,
		truncated,
	};
}

const clickElementInPage = async ({ selector }) => {
	const element = document.querySelector(selector);
	if (!element) {
		throw new Error(`No element matches selector: ${selector}`);
	}

	const rect = element.getBoundingClientRect();
	const style = window.getComputedStyle(element);
	if ((rect.width === 0 && rect.height === 0) || style.display === "none" || style.visibility === "hidden") {
		throw new Error(`Element matched ${selector} but is not visible`);
	}

	element.scrollIntoView?.({ block: "center", inline: "center" });
	element.focus?.({ preventScroll: true });

	if (typeof element.click === "function") {
		element.click();
	} else {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
	}

	return {
		selector,
		tag: element.tagName.toLowerCase(),
		text: (element.innerText || element.textContent || "").trim().slice(0, 200),
	};
};

const typeIntoElementInPage = async ({ selector, text, clear = true, submit = false }) => {
	const element = document.querySelector(selector);
	if (!element) {
		throw new Error(`No element matches selector: ${selector}`);
	}

	const rect = element.getBoundingClientRect();
	const style = window.getComputedStyle(element);
	if ((rect.width === 0 && rect.height === 0) || style.display === "none" || style.visibility === "hidden") {
		throw new Error(`Element matched ${selector} but is not visible`);
	}

	element.scrollIntoView?.({ block: "center", inline: "center" });
	element.focus?.({ preventScroll: true });

	const elementSummary = {
		selector,
		tag: element.tagName.toLowerCase(),
		text: (element.innerText || element.textContent || "").trim().slice(0, 200),
	};

	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
		const currentValue = element.value || "";
		const nextValue = clear ? text : `${currentValue}${text}`;
		const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
		if (setter) setter.call(element, nextValue);
		else element.value = nextValue;

		element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
		if (submit) {
			element.form?.requestSubmit?.();
		}

		return {
			...elementSummary,
			valueLength: element.value.length,
		};
	}

	if (element.isContentEditable) {
		const currentText = element.textContent || "";
		element.textContent = clear ? text : `${currentText}${text}`;
		element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
		element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
		return {
			...elementSummary,
			valueLength: (element.textContent || "").length,
		};
	}

	throw new Error(`Element matched ${selector} but is not text-editable`);
};

const waitForSelectorInPage = async ({ selector, timeoutMs = 10000, visible = false }) => {
	const describe = (element) => ({
		selector,
		tag: element.tagName.toLowerCase(),
		text: (element.innerText || element.textContent || "").trim().slice(0, 200),
	});

	const isVisible = (element) => {
		const rect = element.getBoundingClientRect();
		const style = window.getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
	};

	const findMatch = () => {
		const element = document.querySelector(selector);
		if (!element) return null;
		if (visible && !isVisible(element)) return null;
		return element;
	};

	const existing = findMatch();
	if (existing) {
		return describe(existing);
	}

	return await new Promise((resolve, reject) => {
		let settled = false;
		let observer;
		let intervalId;
		let timeoutId;

		const cleanup = () => {
			observer?.disconnect();
			if (intervalId) window.clearInterval(intervalId);
			if (timeoutId) window.clearTimeout(timeoutId);
		};

		const succeed = (element) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(describe(element));
		};

		const fail = (message) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error(message));
		};

		const check = () => {
			const element = findMatch();
			if (element) {
				succeed(element);
			}
		};

		observer = new MutationObserver(check);
		observer.observe(document.documentElement || document, {
			childList: true,
			subtree: true,
			attributes: visible,
		});
		intervalId = window.setInterval(check, 100);
		timeoutId = window.setTimeout(() => fail(`Timed out waiting for selector: ${selector}`), timeoutMs);
		check();
	});
};

const createPageToolkit = () => {
	const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
	const lowerText = (value) => normalizeText(value).toLowerCase();
	const cssEscape = (value) => {
		if (window.CSS?.escape) return window.CSS.escape(String(value));
		return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
	};
	const attrEscape = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

	const isVisible = (element) => {
		if (!(element instanceof Element)) return false;
		const style = window.getComputedStyle(element);
		if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
			return false;
		}
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};

	const isClickable = (element) => {
		if (!(element instanceof Element)) return false;
		const tag = element.tagName.toLowerCase();
		if (["a", "button", "summary", "label"].includes(tag)) return true;
		if (tag === "input") {
			const type = String(element.getAttribute("type") || "text").toLowerCase();
			return type !== "hidden";
		}
		const role = String(element.getAttribute("role") || "").toLowerCase();
		if (["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"].includes(role)) {
			return true;
		}
		if (element.hasAttribute("onclick")) return true;
		return Number.isFinite(element.tabIndex) && element.tabIndex >= 0;
	};

	const isEditable = (element) => {
		if (!(element instanceof Element)) return false;
		if (element instanceof HTMLTextAreaElement) return true;
		if (element instanceof HTMLInputElement) {
			const type = String(element.type || "text").toLowerCase();
			return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "range", "image", "hidden"].includes(type);
		}
		return element.isContentEditable;
	};

	const READABLE_TEXT_EXCLUDED_SELECTOR = [
		"script",
		"style",
		"noscript",
		".MathJax_Preview",
		".MJX_Assistive_MathML",
		"mjx-assistive-mml",
		".katex-mathml",
		"annotation",
		"annotation-xml",
		"semantics",
	].join(", ");

	const getElementText = (element) => {
		if (!(element instanceof Element)) return normalizeText(element?.textContent || "");
		const clone = element.cloneNode(true);
		if (clone instanceof Element) {
			for (const node of Array.from(clone.querySelectorAll(READABLE_TEXT_EXCLUDED_SELECTOR))) {
				node.remove();
			}
			return normalizeText(clone.textContent || "");
		}
		return normalizeText(element.innerText || element.textContent || "");
	};

	const getLabelTextForControl = (element) => {
		if (!(element instanceof Element)) return "";
		const texts = [];
		if ("labels" in element && element.labels) {
			for (const label of Array.from(element.labels)) {
				const text = getElementText(label);
				if (text) texts.push(text);
			}
		}
		const labelledBy = element.getAttribute?.("aria-labelledby");
		if (labelledBy) {
			for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
				const labelEl = document.getElementById(id);
				const text = getElementText(labelEl);
				if (text) texts.push(text);
			}
		}
		return texts.join(" | ");
	};

	const scoreCandidateText = (candidateText, queryLower) => {
		const text = lowerText(candidateText);
		if (!text) return 0;
		if (text === queryLower) return 120;
		if (text.startsWith(queryLower)) return 95;
		if (text.includes(queryLower)) return 70;
		return 0;
	};

	const uniqueSelector = (selector, element) => {
		try {
			const matches = document.querySelectorAll(selector);
			return matches.length === 1 && matches[0] === element;
		} catch {
			return false;
		}
	};

	const buildSelector = (element) => {
		if (!(element instanceof Element)) return "";
		if (element.id) {
			const selector = `#${cssEscape(element.id)}`;
			if (uniqueSelector(selector, element)) return selector;
		}

		const tag = element.tagName.toLowerCase();
		const attributeSelectors = [
			element.getAttribute("data-testid") ? `[data-testid="${attrEscape(element.getAttribute("data-testid"))}"]` : null,
			element.getAttribute("name") ? `${tag}[name="${attrEscape(element.getAttribute("name"))}"]` : null,
			element.getAttribute("aria-label") ? `${tag}[aria-label="${attrEscape(element.getAttribute("aria-label"))}"]` : null,
			element.getAttribute("placeholder") ? `${tag}[placeholder="${attrEscape(element.getAttribute("placeholder"))}"]` : null,
		];
		for (const selector of attributeSelectors) {
			if (selector && uniqueSelector(selector, element)) return selector;
		}

		let current = element;
		const segments = [];
		while (current && current.nodeType === 1 && current !== document.documentElement) {
			let segment = current.tagName.toLowerCase();
			if (current.id) {
				segment += `#${cssEscape(current.id)}`;
				segments.unshift(segment);
				const selector = segments.join(" > ");
				if (uniqueSelector(selector, element)) return selector;
				break;
			}
			const classNames = Array.from(current.classList || [])
				.filter((cls) => cls && !/^(active|selected|hover|focus|open|closed|visited)$/i.test(cls))
				.slice(0, 2);
			if (classNames.length > 0) {
				segment += classNames.map((cls) => `.${cssEscape(cls)}`).join("");
			}
			const parent = current.parentElement;
			if (parent) {
				const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
				if (sameTagSiblings.length > 1) {
					segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
				}
			}
			segments.unshift(segment);
			const selector = segments.join(" > ");
			if (uniqueSelector(selector, element)) return selector;
			current = current.parentElement;
		}
		return segments.join(" > ");
	};

	const summarizeElement = (element, extra = {}) => ({
		selector: buildSelector(element),
		tag: element.tagName.toLowerCase(),
		text: getElementText(element).slice(0, 200) || null,
		role: element.getAttribute?.("role") || null,
		ariaLabel: normalizeText(element.getAttribute?.("aria-label") || "") || null,
		placeholder: normalizeText(element.getAttribute?.("placeholder") || "") || null,
		name: element.getAttribute?.("name") || null,
		id: element.id || null,
		clickable: isClickable(element),
		editable: isEditable(element),
		labelText: getLabelTextForControl(element) || null,
		...extra,
	});

	const getInteractiveElements = () =>
		Array.from(
			new Set(
				Array.from(
					document.querySelectorAll(
						'a, button, input, textarea, select, label, summary, [role], [onclick], [contenteditable="true"], [contenteditable=true], [tabindex], [aria-label], [placeholder], [data-testid]'
					),
				),
			),
		);

	const getSearchElements = (interactiveOnly) =>
		interactiveOnly ? getInteractiveElements() : Array.from(document.querySelectorAll("body *")).slice(0, 4000);

	const findElementsByText = (query, options = {}) => {
		const queryLower = lowerText(query);
		if (!queryLower) throw new Error("A non-empty text query is required");
		const interactiveOnly = options.interactiveOnly !== false;
		const exact = Boolean(options.exact);
		const includeHidden = Boolean(options.includeHidden);
		const maxResults = Math.max(1, Math.min(50, Number(options.maxResults || 10)));
		const matches = [];
		const seen = new Map();

		for (const element of getSearchElements(interactiveOnly)) {
			if (!(element instanceof Element)) continue;
			if (!includeHidden && !isVisible(element)) continue;
			if (interactiveOnly && !isClickable(element) && !isEditable(element) && element.tagName.toLowerCase() !== "label") {
				continue;
			}

			const textSources = [
				["text", getElementText(element)],
				["aria-label", element.getAttribute("aria-label") || ""],
				["title", element.getAttribute("title") || ""],
				["placeholder", element.getAttribute("placeholder") || ""],
				["name", element.getAttribute("name") || ""],
				["id", element.id || ""],
				["label", getLabelTextForControl(element)],
			];

			let bestScore = 0;
			let matchedBy = null;
			for (const [source, text] of textSources) {
				const score = scoreCandidateText(text, queryLower);
				if (score > bestScore) {
					bestScore = score;
					matchedBy = source;
				}
			}

			if (bestScore === 0) continue;
			if (exact && bestScore < 120) continue;
			if (isClickable(element)) bestScore += 20;
			if (isEditable(element)) bestScore += 15;
			if (element.tagName.toLowerCase() === "label") bestScore += 10;
			if (includeHidden || isVisible(element)) bestScore += 5;

			const summary = summarizeElement(element, { matchedBy, score: bestScore });
			if (!summary.selector) continue;
			const existing = seen.get(summary.selector);
			if (!existing || existing.score < summary.score) {
				seen.set(summary.selector, summary);
			}
		}

		matches.push(...seen.values());
		matches.sort((a, b) => b.score - a.score || (a.text || "").length - (b.text || "").length);
		return matches.slice(0, maxResults);
	};

	const clickElement = (element) => {
		if (!(element instanceof Element)) throw new Error("Target element not found");
		if (!isVisible(element)) throw new Error("Target element is not visible");
		element.scrollIntoView?.({ block: "center", inline: "center" });
		element.focus?.({ preventScroll: true });
		if (typeof element.click === "function") {
			element.click();
		} else {
			element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
		}
		return summarizeElement(element);
	};

	const setValueOnElement = (element, text, clear = true, submit = false) => {
		if (!(element instanceof Element)) throw new Error("Target element not found");
		if (!isVisible(element)) throw new Error("Target element is not visible");
		element.scrollIntoView?.({ block: "center", inline: "center" });
		element.focus?.({ preventScroll: true });

		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			const currentValue = element.value || "";
			const nextValue = clear ? text : `${currentValue}${text}`;
			const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
			if (setter) setter.call(element, nextValue);
			else element.value = nextValue;
			element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
			element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
			if (submit) element.form?.requestSubmit?.();
			return summarizeElement(element, { valueLength: element.value.length });
		}

		if (element.isContentEditable) {
			const currentText = element.textContent || "";
			element.textContent = clear ? text : `${currentText}${text}`;
			element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
			element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
			return summarizeElement(element, { valueLength: (element.textContent || "").length });
		}

		throw new Error("Target element is not editable");
	};

	const clickByText = (query, options = {}) => {
		const matches = findElementsByText(query, { ...options, interactiveOnly: true });
		if (matches.length === 0) throw new Error(`No visible interactive element matched text: ${query}`);
		const target = document.querySelector(matches[0].selector);
		if (!(target instanceof Element)) throw new Error(`Matched element no longer exists for selector: ${matches[0].selector}`);
		return {
			element: clickElement(target),
			matches,
		};
	};

	const typeByLabel = (labelQuery, text, options = {}) => {
		const queryLower = lowerText(labelQuery);
		if (!queryLower) throw new Error("A non-empty label query is required");
		const includeHidden = Boolean(options.includeHidden);
		const clear = options.clear !== false;
		const submit = Boolean(options.submit);
		const exact = Boolean(options.exact);
		const candidates = [];

		const pushCandidate = (element, matchedBy, sourceText, bonus = 0) => {
			if (!(element instanceof Element)) return;
			if (!isEditable(element)) return;
			if (!includeHidden && !isVisible(element)) return;
			const score = scoreCandidateText(sourceText, queryLower);
			if (score === 0) return;
			if (exact && score < 120) return;
			candidates.push({
				element,
				matchedBy,
				sourceText: normalizeText(sourceText),
				score: score + bonus,
			});
		};

		for (const label of document.querySelectorAll("label")) {
			const labelText = getElementText(label);
			const control = label.control || (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input, textarea, [contenteditable="true"], [contenteditable=true]'));
			pushCandidate(control, "label", labelText, 50);
		}

		for (const element of document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable=true]')) {
			pushCandidate(element, "aria-label", element.getAttribute("aria-label") || "", 40);
			pushCandidate(element, "placeholder", element.getAttribute("placeholder") || "", 30);
			pushCandidate(element, "label", getLabelTextForControl(element), 45);
			pushCandidate(element, "name", element.getAttribute("name") || "", 10);
			pushCandidate(element, "id", element.id || "", 5);
		}

		const deduped = new Map();
		for (const candidate of candidates) {
			const selector = buildSelector(candidate.element);
			if (!selector) continue;
			const existing = deduped.get(selector);
			if (!existing || existing.score < candidate.score) {
				deduped.set(selector, { ...candidate, selector });
			}
		}

		const matches = Array.from(deduped.values()).sort((a, b) => b.score - a.score).slice(0, 10);
		if (matches.length === 0) throw new Error(`No editable field matched label: ${labelQuery}`);
		const target = document.querySelector(matches[0].selector);
		if (!(target instanceof Element)) throw new Error(`Matched editable field no longer exists for selector: ${matches[0].selector}`);
		return {
			element: setValueOnElement(target, text, clear, submit),
			matchedBy: matches[0].matchedBy,
			matches: matches.map((candidate) => ({
				selector: candidate.selector,
				matchedBy: candidate.matchedBy,
				sourceText: candidate.sourceText,
				score: candidate.score,
			})),
		};
	};

	const waitForLayout = (timeoutMs = 250) =>
		new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeoutId);
				resolve();
			};
			const timeoutId = window.setTimeout(finish, timeoutMs);
			window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
		});

	const ensureAnnotationStyles = () => {
		const styleId = "onhand-browser-annotation-style";
		let style = document.getElementById(styleId);
		if (!(style instanceof HTMLStyleElement)) {
			style = document.createElement("style");
			style.id = styleId;
			(document.head || document.documentElement).appendChild(style);
		}
		style.textContent = `
			span[data-onhand-highlight-kind="inline"] {
				background: #fde047 !important;
				color: #111827 !important;
				outline: 2px solid #ef4444 !important;
				outline-offset: 1px !important;
				border-radius: 3px !important;
				padding: 0 0.08em !important;
				box-decoration-break: clone !important;
				-webkit-box-decoration-break: clone !important;
			}
			[data-onhand-highlight-kind="block"] {
				background: rgba(253, 224, 71, 0.85) !important;
				color: inherit !important;
				outline: 2px solid #ef4444 !important;
				outline-offset: 3px !important;
				border-radius: 6px !important;
				scroll-margin-top: 20vh !important;
				scroll-margin-bottom: 20vh !important;
			}
			[data-onhand-note-kind="card"] {
				background: linear-gradient(90deg, #f59e0b 0 6px, #fff7c2 6px) !important;
				color: #111827 !important;
				border: 2px solid #f59e0b !important;
				border-radius: 10px !important;
				box-shadow: 0 14px 30px rgba(17, 24, 39, 0.18) !important;
				margin: 12px 0 16px !important;
				padding: 12px 14px 12px 20px !important;
				display: block !important;
				width: fit-content !important;
				inline-size: fit-content !important;
				max-width: min(26rem, 100%) !important;
				max-inline-size: min(26rem, 100%) !important;
				font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
				position: relative !important;
				z-index: auto !important;
				scroll-margin-top: 20vh !important;
				scroll-margin-bottom: 20vh !important;
				white-space: normal !important;
				overflow-wrap: anywhere !important;
				vertical-align: top !important;
				clear: both !important;
			}
			[data-onhand-note-part="label"] {
				color: #92400e !important;
				font-size: 12px !important;
				font-weight: 700 !important;
				letter-spacing: 0.04em !important;
				margin-bottom: 6px !important;
				text-transform: uppercase !important;
			}
			[data-onhand-note-part="body"] {
				white-space: pre-wrap !important;
			}
		`;
	};

	const nextAnnotationId = () => `onhand-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

	const ANNOTATION_CONTAINER_SELECTOR = [
		"p",
		"li",
		"blockquote",
		"pre",
		"code",
		"td",
		"th",
		"figcaption",
		"caption",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"summary",
	].join(", ");

	const EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR = [
		"nav",
		"header",
		"footer",
		"aside",
		'[role="navigation"]',
		"#toc",
		".toc",
		".vector-toc",
		".navbox",
		".mw-portlet",
		".mw-jump-link",
	].join(", ");

	const EXCLUDED_HIGHLIGHT_TEXT_ANCESTOR_SELECTOR = [
		".MathJax_Preview",
		".MJX_Assistive_MathML",
		"mjx-assistive-mml",
		".katex-mathml",
		"annotation",
		"annotation-xml",
		"semantics",
	].join(", ");

	const rectToObject = (rect) => ({
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		bottom: rect.bottom,
		right: rect.right,
	});

	const annotationSelector = (annotationId) => `[data-onhand-annotation-id="${attrEscape(annotationId)}"]`;

	const findAnnotationElement = (annotationId) => {
		const element = document.querySelector(annotationSelector(annotationId));
		if (!(element instanceof Element)) {
			throw new Error(`No annotation found with id: ${annotationId}`);
		}
		return element;
	};

	const findAnnotationContainer = (annotationElement) => {
		if (!(annotationElement instanceof Element)) {
			throw new Error("Annotation element not found");
		}
		if (annotationElement.getAttribute("data-onhand-highlight-kind") === "block") {
			return annotationElement;
		}
		return annotationElement.closest(ANNOTATION_CONTAINER_SELECTOR) || annotationElement.parentElement || annotationElement;
	};

	const findNoteInsertionPlacement = (container) => {
		if (!(container instanceof Element)) return { target: container, position: "afterend" };
		const tag = container.tagName;
		if (tag === "CODE") {
			const pre = container.closest("pre");
			if (pre) return { target: pre, position: "afterend" };
			const blockAncestor = container.parentElement?.closest(ANNOTATION_CONTAINER_SELECTOR);
			if (blockAncestor) return findNoteInsertionPlacement(blockAncestor);
		}
		if (tag === "CAPTION") {
			const table = container.closest("table");
			if (table) return { target: table, position: "afterend" };
		}
		if (tag === "LI" || tag === "TD" || tag === "TH") {
			return { target: container, position: "beforeend" };
		}
		const parent = container.parentElement;
		if (!(parent instanceof Element)) return { target: container, position: "afterend" };
		const isHeading = /^H[1-6]$/.test(tag);
		const hasPermalinkSibling = Array.from(parent.children).some((child) =>
			child !== container && child.matches?.("a.anchor, .anchor")
		);
		// GitHub renders markdown headings as a wrapper with a sibling permalink anchor.
		// Insert notes after the wrapper so captions do not split the heading/link row.
		if (isHeading && parent.classList.contains("markdown-heading") && hasPermalinkSibling) {
			return { target: parent, position: "afterend" };
		}
		return { target: container, position: "afterend" };
	};

	const insertNoteAtPlacement = (note, placement) => {
		const target = placement?.target;
		if (!(target instanceof Element)) throw new Error("Could not determine where to place the note");
		if (placement.position === "beforeend") {
			target.append(note);
			return;
		}
		target.insertAdjacentElement("afterend", note);
	};

	const collectHighlightTextNodes = (root) => {
		const accepted = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
				const value = String(node.nodeValue || "");
				if (!value.trim()) return NodeFilter.FILTER_REJECT;
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tag = parent.tagName.toLowerCase();
				if (["script", "style", "noscript", "textarea", "input"].includes(tag)) return NodeFilter.FILTER_REJECT;
				if (parent.closest('[data-onhand-highlight-kind]')) return NodeFilter.FILTER_REJECT;
				if (parent.closest('[contenteditable="true"], [contenteditable=true]')) return NodeFilter.FILTER_REJECT;
				if (parent.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
				if (parent.closest(EXCLUDED_HIGHLIGHT_TEXT_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
				if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let currentNode;
		while ((currentNode = walker.nextNode())) {
			if (currentNode instanceof Text) accepted.push(currentNode);
		}
		return accepted;
	};

	const APPROXIMATE_HIGHLIGHT_STOP_WORDS = new Set([
		"a",
		"an",
		"and",
		"are",
		"as",
		"at",
		"be",
		"by",
		"for",
		"from",
		"how",
		"in",
		"is",
		"it",
		"of",
		"on",
		"or",
		"that",
		"the",
		"their",
		"this",
		"to",
		"was",
		"we",
		"what",
		"when",
		"where",
		"which",
		"with",
	]);

	const tokenizeNormalizedText = (value) =>
		String(value ?? "")
			.toLowerCase()
			.split(/[^a-z0-9]+/i)
			.map((part) => part.trim())
			.filter((part) => part.length >= 2);

	const tokenizeApproximateQuery = (value) =>
		tokenizeNormalizedText(value).filter((part) => part.length >= 3 && !APPROXIMATE_HIGHLIGHT_STOP_WORDS.has(part));

	const countTokenOverlap = (tokens, otherTokenSet) => {
		let overlap = 0;
		for (const token of tokens) {
			if (otherTokenSet.has(token)) overlap += 1;
		}
		return overlap;
	};

	const collectHighlightContainers = (queryLower, rawQuery) => {
		const root = document.body || document.documentElement;
		const candidates = [];
		const queryTokens = tokenizeApproximateQuery(rawQuery);
		const minimumOverlap = Math.min(2, queryTokens.length);
		for (const container of root.querySelectorAll(ANNOTATION_CONTAINER_SELECTOR)) {
			if (!(container instanceof Element)) continue;
			if (!isVisible(container)) continue;
			if (container.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR)) continue;
			if (container.closest('[data-onhand-highlight-kind]')) continue;
			const text = lowerText(getElementText(container));
			if (!text) continue;
			if (!text.includes(queryLower)) {
				if (!queryTokens.length) continue;
				const containerTokens = new Set(tokenizeApproximateQuery(text));
				const overlap = countTokenOverlap(queryTokens, containerTokens);
				if (overlap < minimumOverlap) continue;
			}
			candidates.push(container);
		}
		return candidates;
	};

	const buildNormalizedTextMap = (textNodes) => {
		const positions = [];
		let text = "";
		let pendingSpace = null;
		let hasContent = false;

		for (const node of textNodes) {
			const value = String(node.nodeValue || "");
			for (let offset = 0; offset < value.length; offset += 1) {
				const character = value[offset];
				if (/\s/.test(character)) {
					if (hasContent && !pendingSpace) {
						pendingSpace = { node, offset };
					}
					continue;
				}

				if (pendingSpace) {
					text += " ";
					positions.push(pendingSpace);
					pendingSpace = null;
				}

				text += character;
				positions.push({ node, offset });
				hasContent = true;
			}
		}

		return {
			text,
			lowerText: text.toLowerCase(),
			positions,
		};
	};

	const buildSegmentRanges = (mappedText) => {
		const ranges = [];
		const text = String(mappedText?.text || "");
		let start = 0;
		for (let index = 0; index < text.length; index += 1) {
			const character = text[index];
			if (![".", "!", "?", ";", ":"].includes(character)) continue;
			const end = index + 1;
			if (end > start) ranges.push([start, end]);
			start = end;
			while (start < text.length && /\s/.test(text[start])) start += 1;
		}
		if (start < text.length) ranges.push([start, text.length]);
		return ranges.filter(([segmentStart, segmentEnd]) => segmentEnd - segmentStart >= 12);
	};

	const findBestApproximateHighlightRange = (mappedText, query) => {
		const queryTokens = tokenizeApproximateQuery(query);
		if (queryTokens.length < 2) return null;
		const tokenSet = new Set(queryTokens);
		let best = null;
		const primaryToken = queryTokens[0] || null;

		for (const [startIndex, endIndex] of buildSegmentRanges(mappedText)) {
			const segmentText = mappedText.text.slice(startIndex, endIndex).trim();
			if (!segmentText) continue;
			const segmentTokens = tokenizeApproximateQuery(segmentText);
			if (!segmentTokens.length) continue;
			const segmentTokenSet = new Set(segmentTokens);
			if (primaryToken && !segmentTokenSet.has(primaryToken)) continue;
			const overlap = countTokenOverlap(queryTokens, segmentTokenSet);
			if (overlap === 0) continue;
			const coverage = overlap / queryTokens.length;
			const density = overlap / Math.max(segmentTokens.length, 1);
			const score = overlap * 120 + coverage * 40 + density * 15 - segmentText.length * 0.02;
			if (!best || score > best.score) {
				best = { startIndex, endIndex, overlap, coverage, score, text: segmentText };
			}
		}

		if (!best) return null;
		const minimumOverlap = Math.min(3, queryTokens.length);
		if (best.overlap < minimumOverlap && best.coverage < 0.6) return null;
		return best;
	};

	const wrapRangeInHighlight = (range, annotationId) => {
		const highlight = document.createElement("span");
		highlight.setAttribute("data-onhand-highlight-kind", "inline");
		highlight.setAttribute("data-onhand-annotation-id", annotationId);
		try {
			range.surroundContents(highlight);
		} catch {
			const fragment = range.extractContents();
			highlight.appendChild(fragment);
			range.insertNode(highlight);
		}
		return highlight;
	};

	const findNoteForAnnotation = (annotationId) => {
		const note = document.querySelector(`[data-onhand-note-for="${attrEscape(annotationId)}"]`);
		return note instanceof Element ? note : null;
	};

	const ensureElementInViewport = async (element, block = "center") => {
		if (!(element instanceof Element)) return;
		const findScrollContainer = () => {
			for (let current = element.parentElement; current && current !== document.body; current = current.parentElement) {
				const style = getComputedStyle(current);
				const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1;
				const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX) && current.scrollWidth > current.clientWidth + 1;
				if (canScrollY || canScrollX) return current;
			}
			return document.scrollingElement || document.documentElement || document.body;
		};
		await waitForLayout();
		const margin = 24;
		const html = document.documentElement;
		const body = document.body;
		const previousHtmlScrollBehavior = html?.style?.scrollBehavior || "";
		const previousBodyScrollBehavior = body?.style?.scrollBehavior || "";
		if (html?.style) html.style.scrollBehavior = "auto";
		if (body?.style) body.style.scrollBehavior = "auto";
		try {
			for (let attempt = 0; attempt < 6; attempt += 1) {
				const rect = element.getBoundingClientRect();
				if (rect.top >= margin && rect.bottom <= window.innerHeight - margin && rect.left >= 0 && rect.right <= window.innerWidth) return;

				let desiredTop = Math.round((window.innerHeight - rect.height) / 2);
				if (block === "start") desiredTop = margin;
				if (block === "end") desiredTop = window.innerHeight - rect.height - margin;
				desiredTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - margin));

				let deltaX = 0;
				if (rect.left < margin) deltaX = rect.left - margin;
				if (rect.right > window.innerWidth - margin) deltaX = rect.right - window.innerWidth + margin;
				const deltaY = rect.top - desiredTop;
				const scroller = findScrollContainer();
				if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
					window.scrollBy(deltaX, deltaY);
				} else {
					scroller.scrollTop += deltaY;
					scroller.scrollLeft += deltaX;
				}
				await waitForLayout(500);
			}
		} finally {
			if (html?.style) html.style.scrollBehavior = previousHtmlScrollBehavior;
			if (body?.style) body.style.scrollBehavior = previousBodyScrollBehavior;
		}
	};

	const removeNotesForAnnotation = (annotationId) => {
		let removed = 0;
		for (const note of Array.from(document.querySelectorAll(`[data-onhand-note-for="${attrEscape(annotationId)}"]`))) {
			note.remove();
			removed += 1;
		}
		return removed;
	};

	const clearAnnotations = () => {
		let clearedNotes = 0;
		for (const note of Array.from(document.querySelectorAll('[data-onhand-note-kind="card"]'))) {
			note.remove();
			clearedNotes += 1;
		}

		let clearedInline = 0;
		for (const highlight of Array.from(document.querySelectorAll('span[data-onhand-highlight-kind="inline"]'))) {
			const parent = highlight.parentNode;
			if (!parent) continue;
			while (highlight.firstChild) {
				parent.insertBefore(highlight.firstChild, highlight);
			}
			parent.removeChild(highlight);
			parent.normalize?.();
			clearedInline += 1;
		}

		let clearedBlock = 0;
		for (const element of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="block"]'))) {
			element.removeAttribute("data-onhand-highlight-kind");
			element.removeAttribute("data-onhand-annotation-id");
			clearedBlock += 1;
		}

		return {
			clearedNotes,
			clearedInline,
			clearedBlock,
			clearedTotal: clearedNotes + clearedInline + clearedBlock,
		};
	};

	const highlightText = async (query, options = {}) => {
		const rawQuery = String(query ?? "").trim();
		const normalizedQuery = lowerText(rawQuery);
		if (!normalizedQuery) throw new Error("highlightText requires a non-empty query");

		const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
		const clearExisting = options.clearExisting !== false;
		const scrollIntoView = options.scrollIntoView !== false;
		ensureAnnotationStyles();
		if (clearExisting) clearAnnotations();

		let matchIndex = 0;
		let bestApproximateMatch = null;
		for (const container of collectHighlightContainers(normalizedQuery, rawQuery)) {
			const textNodes = collectHighlightTextNodes(container);
			if (!textNodes.length) continue;
			const mappedText = buildNormalizedTextMap(textNodes);
			const hasExactMatch = mappedText.lowerText.includes(normalizedQuery);
			if (!hasExactMatch) {
				const approximate = findBestApproximateHighlightRange(mappedText, rawQuery);
				if (!approximate) continue;
				if (!bestApproximateMatch || approximate.score > bestApproximateMatch.score) {
					bestApproximateMatch = { ...approximate, mappedText, container };
				}
				continue;
			}

			let searchFrom = 0;
			while (searchFrom <= mappedText.lowerText.length) {
				const foundAt = mappedText.lowerText.indexOf(normalizedQuery, searchFrom);
				if (foundAt === -1) break;
				matchIndex += 1;
				if (matchIndex === occurrence) {
					const start = mappedText.positions[foundAt];
					const end = mappedText.positions[foundAt + normalizedQuery.length - 1];
					if (!start || !end) break;

					const range = document.createRange();
					range.setStart(start.node, start.offset);
					range.setEnd(end.node, end.offset + 1);
					const annotationId = nextAnnotationId();
					const highlight = wrapRangeInHighlight(range, annotationId);
					if (scrollIntoView) {
						highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
					}
					await waitForLayout();
					return {
						annotationId,
						kind: "inline",
						matchedText: getElementText(highlight).slice(0, 500) || normalizeText(rawQuery),
						container: summarizeElement(findAnnotationContainer(highlight)),
						rect: rectToObject(highlight.getBoundingClientRect()),
						scrollY: window.scrollY,
					};
				}
				searchFrom = foundAt + Math.max(normalizedQuery.length, 1);
			}
		}

		if (bestApproximateMatch && occurrence === 1) {
			const start = bestApproximateMatch.mappedText.positions[bestApproximateMatch.startIndex];
			const end = bestApproximateMatch.mappedText.positions[bestApproximateMatch.endIndex - 1];
			if (start && end) {
				const range = document.createRange();
				range.setStart(start.node, start.offset);
				range.setEnd(end.node, end.offset + 1);
				const annotationId = nextAnnotationId();
				const highlight = wrapRangeInHighlight(range, annotationId);
				if (scrollIntoView) {
					highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
				}
				await waitForLayout();
				return {
					annotationId,
					kind: "inline",
					matchedText: getElementText(highlight).slice(0, 500) || normalizeText(bestApproximateMatch.text || rawQuery),
					container: summarizeElement(findAnnotationContainer(highlight)),
					rect: rectToObject(highlight.getBoundingClientRect()),
					scrollY: window.scrollY,
					approximate: true,
				};
			}
		}

		throw new Error(`No visible text matched: ${query}`);
	};

	const getVisibleText = (options = {}) => {
		const maxBlocks = Math.max(1, Math.min(80, Number(options.maxBlocks || 25) || 25));
		const maxChars = Math.max(200, Math.min(20000, Number(options.maxChars || 6000) || 6000));
		const blocks = [];
		const seen = new Set();
		const viewportTop = 0;
		const viewportBottom = window.innerHeight;
		let totalChars = 0;

		for (const element of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code, figcaption, caption, summary, td, th")) {
			if (!(element instanceof Element)) continue;
			if (!isVisible(element)) continue;
			const rect = element.getBoundingClientRect();
			if (rect.bottom <= viewportTop || rect.top >= viewportBottom) continue;
			const text = getElementText(element);
			if (!text) continue;
			const selector = buildSelector(element);
			if (!selector || seen.has(selector)) continue;
			seen.add(selector);
			const block = {
				tag: element.tagName.toLowerCase(),
				selector,
				text: text.slice(0, 500),
				top: rect.top,
				bottom: rect.bottom,
				isHeading: /^h[1-6]$/.test(element.tagName.toLowerCase()),
			};
			blocks.push(block);
			totalChars += block.text.length;
			if (blocks.length >= maxBlocks || totalChars >= maxChars) break;
		}

		const visibleText = [];
		let usedChars = 0;
		for (const block of blocks) {
			if (usedChars >= maxChars) break;
			const remaining = maxChars - usedChars;
			const text = block.text.length > remaining ? `${block.text.slice(0, remaining)}…` : block.text;
			visibleText.push(text);
			usedChars += text.length;
		}

		return {
			url: location.href,
			title: document.title,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			blockCount: blocks.length,
			blocks,
			text: visibleText.join("\n\n"),
		};
	};

	const getSelectionInfo = () => {
		const selection = window.getSelection();
		const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
		const base = {
			url: location.href,
			title: document.title,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			activeElement: activeElement ? summarizeElement(activeElement) : null,
		};

		if (!selection || selection.rangeCount === 0) {
			return {
				...base,
				hasSelection: false,
				isCollapsed: true,
				text: "",
				rangeCount: 0,
				rect: null,
				container: null,
			};
		}

		const range = selection.getRangeAt(0);
		const text = String(selection.toString() || "").replace(/\s+/g, " ").trim();
		const rect = range.getBoundingClientRect();
		const startElement = range.startContainer instanceof Element
			? range.startContainer
			: range.startContainer?.parentElement || null;
		const endElement = range.endContainer instanceof Element
			? range.endContainer
			: range.endContainer?.parentElement || null;
		const containerElement = range.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range.commonAncestorContainer?.parentElement || startElement || endElement || null;

		return {
			...base,
			hasSelection: Boolean(text),
			isCollapsed: selection.isCollapsed,
			text,
			rangeCount: selection.rangeCount,
			rect: rect.width || rect.height ? rectToObject(rect) : null,
			container: containerElement ? summarizeElement(containerElement) : null,
			start: startElement ? summarizeElement(startElement) : null,
			end: endElement ? summarizeElement(endElement) : null,
			anchorOffset: selection.anchorOffset,
			focusOffset: selection.focusOffset,
		};
	};

	const getViewportHeadings = (options = {}) => {
		const maxHeadings = Math.max(1, Math.min(20, Number(options.maxHeadings || 8) || 8));
		const viewportHeight = window.innerHeight;
		const activationThreshold = Math.max(80, Math.round(viewportHeight * 0.35));
		const headings = [];

		for (const element of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
			if (!(element instanceof Element)) continue;
			if (!isVisible(element)) continue;
			const text = getElementText(element);
			if (!text) continue;
			const selector = buildSelector(element);
			if (!selector) continue;
			const rect = element.getBoundingClientRect();
			headings.push({
				level: Number(element.tagName.slice(1)) || undefined,
				tag: element.tagName.toLowerCase(),
				selector,
				text: text.slice(0, 300),
				top: rect.top,
				bottom: rect.bottom,
				isVisible: rect.bottom > 0 && rect.top < viewportHeight,
			});
		}

		let currentHeading = null;
		for (const heading of headings) {
			if (heading.top <= activationThreshold) {
				currentHeading = heading;
			} else {
				break;
			}
		}

		const visibleHeadings = headings.filter((heading) => heading.isVisible).slice(0, maxHeadings);
		const upcomingHeadings = headings.filter((heading) => heading.top > 0).slice(0, maxHeadings);
		const uniqueNearby = [];
		const seen = new Set();
		for (const heading of [currentHeading, ...visibleHeadings, ...upcomingHeadings]) {
				if (!heading) continue;
				if (seen.has(heading.selector)) continue;
				seen.add(heading.selector);
				uniqueNearby.push(heading);
				if (uniqueNearby.length >= maxHeadings) break;
		}

		return {
			url: location.href,
			title: document.title,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			currentHeading,
			visibleHeadings,
			upcomingHeadings,
			headings: uniqueNearby,
		};
	};

	const getScrollState = () => {
		const doc = document.documentElement;
		const body = document.body;
		const scrollHeight = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0);
		const scrollWidth = Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0);
		const maxScrollY = Math.max(0, scrollHeight - window.innerHeight);
		const maxScrollX = Math.max(0, scrollWidth - window.innerWidth);
		const scrollY = window.scrollY;
		const scrollX = window.scrollX;
		const progressY = maxScrollY > 0 ? scrollY / maxScrollY : 0;
		const progressX = maxScrollX > 0 ? scrollX / maxScrollX : 0;

		return {
			url: location.href,
			title: document.title,
			scrollX,
			scrollY,
			maxScrollX,
			maxScrollY,
			scrollWidth,
			scrollHeight,
			progressX,
			progressY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			atTop: scrollY <= 2,
			atBottom: scrollY >= maxScrollY - 2,
			atLeft: scrollX <= 2,
			atRight: scrollX >= maxScrollX - 2,
		};
	};

	const scrollToAnnotation = async (annotationId, options = {}) => {
		const rawAnnotationId = String(annotationId ?? "").trim();
		if (!rawAnnotationId) throw new Error("scrollToAnnotation requires a non-empty annotationId");
		const annotationElement = findAnnotationElement(rawAnnotationId);
		const container = findAnnotationContainer(annotationElement);
		const note = findNoteForAnnotation(rawAnnotationId);
		const block = ["start", "center", "end", "nearest"].includes(String(options.block))
			? String(options.block)
			: "center";
		const preferredTarget = options.target === "note" ? "note" : "annotation";
		const target = preferredTarget === "note" && note ? note : container;
		target.scrollIntoView({ behavior: "auto", block, inline: "nearest" });
		await ensureElementInViewport(target, block);
		return {
			annotationId: rawAnnotationId,
			targetKind: target === note ? "note" : "annotation",
			container: summarizeElement(container),
			anchorRect: rectToObject(annotationElement.getBoundingClientRect()),
			noteRect: note ? rectToObject(note.getBoundingClientRect()) : null,
			targetRect: rectToObject(target.getBoundingClientRect()),
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			scrollY: window.scrollY,
		};
	};

	const showNote = async (annotationId, noteText, options = {}) => {
		const rawAnnotationId = String(annotationId ?? "").trim();
		const rawNoteText = String(noteText ?? "").trim();
		if (!rawAnnotationId) throw new Error("showNote requires a non-empty annotationId");
		if (!rawNoteText) throw new Error("showNote requires non-empty note text");

		ensureAnnotationStyles();
		const annotationElement = findAnnotationElement(rawAnnotationId);
		const container = findAnnotationContainer(annotationElement);
		const insertionPlacement = findNoteInsertionPlacement(container);
		const replacedCount = removeNotesForAnnotation(rawAnnotationId);
		const noteId = nextAnnotationId();
		const note = document.createElement("div");
		note.setAttribute("data-onhand-note-kind", "card");
		note.setAttribute("data-onhand-note-id", noteId);
		note.setAttribute("data-onhand-note-for", rawAnnotationId);

		const label = document.createElement("div");
		label.setAttribute("data-onhand-note-part", "label");
		label.textContent = String(options.label || "Onhand");

		const body = document.createElement("div");
		body.setAttribute("data-onhand-note-part", "body");
		body.textContent = rawNoteText;

		note.append(label, body);
		insertNoteAtPlacement(note, insertionPlacement);
		note.style.boxSizing = "border-box";
		const scrolled = options.scrollIntoView === false ? null : await scrollToAnnotation(rawAnnotationId, { block: options.block, target: "note" });
		if (!scrolled) {
			await waitForLayout();
		}
		return {
			noteId,
			annotationId: rawAnnotationId,
			text: rawNoteText.slice(0, 500),
			container: summarizeElement(container),
			insertionTarget: summarizeElement(insertionPlacement.target),
			insertionPosition: insertionPlacement.position,
			anchorRect: rectToObject(annotationElement.getBoundingClientRect()),
			rect: rectToObject(note.getBoundingClientRect()),
			scrollY: window.scrollY,
			replacedCount,
			scrolled,
		};
	};

	const captureState = async () => {
		await waitForLayout();
		const annotations = Array.from(document.querySelectorAll('[data-onhand-highlight-kind]'))
			.map((annotationElement) => {
				if (!(annotationElement instanceof Element)) return null;
				const annotationId = String(annotationElement.getAttribute("data-onhand-annotation-id") || "");
				const kind = String(annotationElement.getAttribute("data-onhand-highlight-kind") || "unknown");
				const container = findAnnotationContainer(annotationElement);
				const note = annotationId ? findNoteForAnnotation(annotationId) : null;
				const label = note?.querySelector?.('[data-onhand-note-part="label"]');
				const body = note?.querySelector?.('[data-onhand-note-part="body"]');
				return {
					annotationId,
					kind,
					matchedText: getElementText(annotationElement).slice(0, 500),
					container: summarizeElement(container),
					rect: rectToObject(annotationElement.getBoundingClientRect()),
					note: note
						? {
							noteId: note.getAttribute("data-onhand-note-id") || null,
							label: normalizeText(label?.textContent || "") || null,
							text: normalizeText(body?.textContent || note.textContent || "").slice(0, 1000),
							rect: rectToObject(note.getBoundingClientRect()),
						}
						: null,
				};
			})
			.filter(Boolean);

		return {
			url: location.href,
			title: document.title,
			capturedAt: Date.now(),
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			annotationCount: annotations.length,
			annotations,
		};
	};

	const pickElements = async (message) => {
		if (!message) throw new Error("pickElements requires a message");
		return await new Promise((resolve) => {
			const selections = [];
			const selectedElements = new Set();

			const overlay = document.createElement("div");
			overlay.style.cssText =
				"position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none";

			const highlight = document.createElement("div");
			highlight.style.cssText =
				"position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s";
			overlay.appendChild(highlight);

			const banner = document.createElement("div");
			banner.style.cssText =
				"position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 24px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;z-index:2147483647;max-width:80vw;text-align:center";

			const describeSelected = (element) => ({
				...summarizeElement(element),
				html: String(element.outerHTML || "").slice(0, 500),
				parents: Array.from({ length: 5 })
					.reduce((acc, _value, index) => {
						const current = index === 0 ? element.parentElement : acc[index - 1]?.parentElement;
						if (!current || current === document.body) return acc;
						acc.push(current);
						return acc;
					}, [])
					.map((parent) => buildSelector(parent))
					.filter(Boolean)
					.join(" > "),
			});

			const updateBanner = () => {
				banner.textContent = `${message} (${selections.length} selected, Cmd/Ctrl+click to add, Enter to finish, Esc to cancel)`;
			};
			updateBanner();
			document.body.append(banner, overlay);

			const cleanup = () => {
				document.removeEventListener("mousemove", onMove, true);
				document.removeEventListener("click", onClick, true);
				document.removeEventListener("keydown", onKey, true);
				overlay.remove();
				banner.remove();
				selectedElements.forEach((el) => {
					el.style.outline = "";
				});
			};

			const onMove = (event) => {
				const element = document.elementFromPoint(event.clientX, event.clientY);
				if (!element || overlay.contains(element) || banner.contains(element)) return;
				const rect = element.getBoundingClientRect();
				highlight.style.cssText = `position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px`;
			};

			const onClick = (event) => {
				if (banner.contains(event.target)) return;
				event.preventDefault();
				event.stopPropagation();
				const element = document.elementFromPoint(event.clientX, event.clientY);
				if (!element || overlay.contains(element) || banner.contains(element)) return;

				if (event.metaKey || event.ctrlKey) {
					if (!selectedElements.has(element)) {
						selectedElements.add(element);
						element.style.outline = "3px solid #10b981";
						selections.push(describeSelected(element));
						updateBanner();
					}
				} else {
					cleanup();
					resolve(selections.length > 0 ? selections : describeSelected(element));
				}
			};

			const onKey = (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					cleanup();
					resolve(null);
				} else if (event.key === "Enter" && selections.length > 0) {
					event.preventDefault();
					cleanup();
					resolve(selections);
				}
			};

			document.addEventListener("mousemove", onMove, true);
			document.addEventListener("click", onClick, true);
			document.addEventListener("keydown", onKey, true);
		});
	};

	return {
		findElementsByText,
		clickByText,
		typeByLabel,
		highlightText,
		getVisibleText,
		getSelectionInfo,
		getViewportHeadings,
		getScrollState,
		scrollToAnnotation,
		showNote,
		captureState,
		clearAnnotations,
		pickElements,
	};
};

async function evaluateInTab(tabId, expression, options = {}) {
	if (!options.skipScripting) {
		try {
		const payload = await executeScriptInTab(
			tabId,
			async (source) => {
				try {
					const value = await (0, eval)(source);
					return {
						ok: true,
						value: (() => {
							if (value == null) return value;
							if (["string", "number", "boolean"].includes(typeof value)) return value;
							try {
								return JSON.parse(JSON.stringify(value));
							} catch {
								return String(value);
							}
						})(),
					};
				} catch (error) {
					return {
						ok: false,
						error: error?.message || String(error),
					};
				}
			},
			[expression],
		);
		const settledPayload = await withOperationTimeout(
			Promise.resolve(payload),
			SCRIPT_EXECUTION_TIMEOUT_MS,
			"Script evaluation timed out",
		);
		if (!settledPayload?.ok) {
			throw new Error(settledPayload?.error || "Script evaluation failed");
		}
		return normalizeExecuteScriptValue(settledPayload.value);
		} catch (scriptError) {
			return await withDebugger(tabId, async ({ send }) => {
				const response = await send("Runtime.evaluate", {
					expression,
					awaitPromise: true,
					returnByValue: true,
					userGesture: true,
				});
				if (response.exceptionDetails) {
					throw new Error(
						response.exceptionDetails.exception?.description ||
							response.exceptionDetails.text ||
							scriptError?.message ||
							"Runtime.evaluate failed",
					);
				}
				return normalizeRemoteObject(response.result);
			});
		}
	}
	return await withDebugger(tabId, async ({ send }) => {
		const response = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) {
			throw new Error(
				response.exceptionDetails.exception?.description ||
					response.exceptionDetails.text ||
					"Runtime.evaluate failed",
			);
		}
		return normalizeRemoteObject(response.result);
	});
}

async function runPageToolkitMethod(tabId, methodName, ...args) {
	try {
		const payload = await withOperationTimeout(
			executeScriptInTab(
				tabId,
				async (toolkitSource, targetMethodName, targetArgs) => {
					try {
						const toolkitFactory = (0, eval)(`(${toolkitSource})`);
						const toolkit = toolkitFactory();
						return {
							ok: true,
							value: await toolkit[targetMethodName](...(Array.isArray(targetArgs) ? targetArgs : [])),
						};
					} catch (error) {
						return {
							ok: false,
							error: error?.message || String(error),
						};
					}
				},
				[createPageToolkit.toString(), methodName, args],
			),
			SCRIPT_EXECUTION_TIMEOUT_MS,
			`Page toolkit scripting timed out: ${methodName}`,
		);
		if (!payload?.ok) {
			throw new Error(payload?.error || `Page toolkit method failed: ${methodName}`);
		}
		return payload.value;
	} catch (scriptError) {
		const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
		return await evaluateInTab(
			tabId,
			`(async () => { const toolkit = (${createPageToolkit.toString()})(); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`,
			{ skipScripting: true },
		);
	}
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
	const tab = await chrome.tabs.get(tabId);
	if (tab.status === "complete") return tab;

	return await new Promise((resolve, reject) => {
		let timeoutId;
		const onUpdated = async (updatedTabId, changeInfo, updatedTab) => {
			if (updatedTabId !== tabId) return;
			if (changeInfo.status !== "complete") return;
			cleanup();
			resolve(updatedTab);
		};

		const cleanup = () => {
			chrome.tabs.onUpdated.removeListener(onUpdated);
			if (timeoutId) clearTimeout(timeoutId);
		};

		chrome.tabs.onUpdated.addListener(onUpdated);
		timeoutId = setTimeout(async () => {
			cleanup();
			try {
				resolve(await chrome.tabs.get(tabId));
			} catch (error) {
				reject(error);
			}
		}, timeoutMs);
	});
}

async function navigateBrowser(args = {}) {
	if (typeof args.url !== "string" || !args.url.trim()) {
		throw new Error("navigate requires a non-empty 'url'");
	}
	const waitForLoad = args.waitForLoad !== false;
	const timeoutMs = clampNumber(args.timeoutMs, 15000, { min: 100, max: 120000 });

	if (args.newTab) {
		let windowId = typeof args.windowId === "number" ? args.windowId : undefined;
		if (windowId === undefined) {
			const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
			windowId = activeTab?.windowId;
		}
		const createdTab = await chrome.tabs.create({
			url: args.url,
			active: args.active !== false,
			windowId,
		});
		const finalTab = waitForLoad ? await waitForTabComplete(createdTab.id, timeoutMs) : await chrome.tabs.get(createdTab.id);
		scheduleStatePush("navigate:new-tab");
		return finalTab;
	}

	const targetTab = await resolveTargetTab(args);
	const updatedTab = await chrome.tabs.update(targetTab.id, {
		url: args.url,
		active: args.active === true ? true : undefined,
	});
	const finalTab = waitForLoad ? await waitForTabComplete(updatedTab.id, timeoutMs) : await chrome.tabs.get(updatedTab.id);
		scheduleStatePush("navigate:update-tab");
	return finalTab;
}

async function getCookiesForTab(tabId) {
	const tab = await chrome.tabs.get(tabId);
	return await withDebugger(tabId, async ({ send }) => {
		const params = tab.url ? { urls: [tab.url] } : {};
		const response = await send("Network.getCookies", params);
		return (response.cookies || []).map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			httpOnly: Boolean(cookie.httpOnly),
			secure: Boolean(cookie.secure),
			session: Boolean(cookie.session),
			sameSite: cookie.sameSite,
			expires: cookie.expires,
			priority: cookie.priority,
			size: cookie.size,
			sourcePort: cookie.sourcePort,
			sourceScheme: cookie.sourceScheme,
		}));
	});
}

async function getDomOuterHtml(tabId) {
	try {
		return await executeScriptInTab(tabId, () => document.documentElement?.outerHTML || "");
	} catch {
		return await withDebugger(tabId, async ({ send }) => {
			await send("DOM.enable");
			const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
			const { outerHTML } = await send("DOM.getOuterHTML", { nodeId: root.nodeId });
			return outerHTML;
		});
	}
}

async function captureTabScreenshot(tabId, options = {}) {
	const focusedTab = await focusTab(tabId);
	await delay(typeof options.delayMs === "number" ? options.delayMs : SCREENSHOT_DELAY_MS);
	const format = options.format === "jpeg" ? "jpeg" : "png";
	const quality =
		format === "jpeg" && typeof options.quality === "number"
			? clampNumber(options.quality, 80, { min: 0, max: 100 })
			: undefined;

		try {
			const base64 = await withDebugger(focusedTab.id, async ({ send }) => {
				await send("Page.enable");
				const response = await send("Page.captureScreenshot", {
					format,
					quality,
					fromSurface: true,
				});
				if (!response?.data) {
					throw new Error("Page.captureScreenshot returned no image data");
				}
				return response.data;
			});
			return {
				tab: focusedTab,
				dataUrl: `data:image/${format};base64,${base64}`,
				method: "debugger",
			};
		} catch (debuggerError) {
			try {
				const dataUrl = await chrome.tabs.captureVisibleTab(focusedTab.windowId, {
					format,
					quality,
				});
				return {
					tab: focusedTab,
					dataUrl,
					method: "tabs.captureVisibleTab",
				};
			} catch (tabsError) {
				const debuggerMessage = debuggerError?.message || String(debuggerError);
				const tabsMessage = tabsError?.message || String(tabsError);
				throw new Error(`Could not capture screenshot via debugger (${debuggerMessage}) or tabs.captureVisibleTab (${tabsMessage})`);
			}
		}
}

async function collectConsoleEvents(tabId, options = {}) {
	const durationMs = clampNumber(options.durationMs, 3000, { min: 0, max: 60000 });
	const maxEntries = clampNumber(options.maxEntries, 50, { min: 1, max: 500 });

	return await withDebugger(tabId, async ({ send }) => {
		const entries = [];
		const seen = new Set();

		const pushEntry = (entry) => {
			const normalized = {
				kind: entry.kind || "console",
				level: entry.level || "info",
				type: entry.type || entry.kind || "console",
				text: truncateText(entry.text || "", 2000),
				url: entry.url || "",
				lineNumber: typeof entry.lineNumber === "number" ? entry.lineNumber : undefined,
				timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
			};
			const signature = JSON.stringify([
				normalized.kind,
				normalized.level,
				normalized.type,
				normalized.text,
				normalized.url,
				normalized.lineNumber,
			]);
			if (seen.has(signature)) return;
			seen.add(signature);
			entries.push(normalized);
			if (entries.length > maxEntries) entries.shift();
		};

		const onEvent = (source, method, params = {}) => {
			if (source.tabId !== tabId) return;

			if (method === "Runtime.consoleAPICalled") {
				const firstFrame = params.stackTrace?.callFrames?.[0];
				pushEntry({
					kind: "console",
					level: params.type || "log",
					type: params.type || "log",
					text: (params.args || []).map(remoteObjectToText).join(" ") || "(no arguments)",
					url: firstFrame?.url || "",
					lineNumber: typeof firstFrame?.lineNumber === "number" ? firstFrame.lineNumber + 1 : undefined,
					timestamp: Date.now(),
				});
				return;
			}

			if (method === "Runtime.exceptionThrown") {
				const details = params.exceptionDetails || {};
				const firstFrame = details.stackTrace?.callFrames?.[0];
				pushEntry({
					kind: "exception",
					level: "error",
					type: "exception",
					text: details.exception?.description || details.text || "Exception thrown",
					url: details.url || firstFrame?.url || "",
					lineNumber:
						typeof details.lineNumber === "number"
							? details.lineNumber + 1
							: typeof firstFrame?.lineNumber === "number"
								? firstFrame.lineNumber + 1
								: undefined,
					timestamp: Date.now(),
				});
				return;
			}

			if (method === "Log.entryAdded") {
				const entry = params.entry || {};
				pushEntry({
					kind: "logEntry",
					level: entry.level || "info",
					type: entry.source || "log",
					text: entry.text || "",
					url: entry.url || "",
					lineNumber: typeof entry.lineNumber === "number" ? entry.lineNumber + 1 : undefined,
					timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
				});
			}
		};

		chrome.debugger.onEvent.addListener(onEvent);
		try {
			await send("Runtime.enable");
			await send("Log.enable");
			await send("Page.enable");

			if (options.reload) {
				await send("Page.reload", { ignoreCache: Boolean(options.ignoreCache) });
			}

			if (typeof options.expression === "string" && options.expression.trim()) {
				if (options.reload) await delay(250);
				const response = await send("Runtime.evaluate", {
					expression: options.expression,
					awaitPromise: true,
					returnByValue: true,
					userGesture: true,
				});
				if (response.exceptionDetails) {
					pushEntry({
						kind: "evaluationError",
						level: "error",
						type: "evaluationError",
						text:
							response.exceptionDetails.exception?.description ||
							response.exceptionDetails.text ||
							"Runtime.evaluate failed",
						url:
							response.exceptionDetails.url ||
							response.exceptionDetails.stackTrace?.callFrames?.[0]?.url ||
							"",
						lineNumber:
							typeof response.exceptionDetails.lineNumber === "number"
								? response.exceptionDetails.lineNumber + 1
								: undefined,
					});
				}
			}

			await delay(durationMs);
			return entries.sort((a, b) => a.timestamp - b.timestamp);
		} finally {
			chrome.debugger.onEvent.removeListener(onEvent);
		}
	});
}

async function collectNetworkEvents(tabId, options = {}) {
	const durationMs = clampNumber(options.durationMs, 4000, { min: 0, max: 60000 });
	const maxEntries = clampNumber(options.maxEntries, 100, { min: 1, max: 1000 });
	const bodyMaxEntries = clampNumber(options.bodyMaxEntries, 3, { min: 1, max: 20 });
	const bodyMaxChars = clampNumber(options.bodyMaxChars, 4000, { min: 100, max: 200000 });
	const includeRequestHeaders = Boolean(options.includeRequestHeaders);
	const includeResponseHeaders = Boolean(options.includeResponseHeaders);
	const includeBodies = Boolean(options.includeBodies);
	const matchUrlContains =
		typeof options.matchUrlContains === "string" && options.matchUrlContains.trim()
			? options.matchUrlContains.toLowerCase()
			: undefined;
	const onlyFailures = Boolean(options.onlyFailures);

	return await withDebugger(tabId, async ({ send }) => {
		const records = new Map();
		const archived = [];

		const createRecord = (requestId) => ({
			requestId,
			url: "",
			method: "GET",
			resourceType: "other",
			initiatorType: "",
			failed: false,
			finished: false,
			requestHeaders: undefined,
			responseHeaders: undefined,
		});

		const cloneRecord = (record) => ({
			...record,
			requestHeaders: record.requestHeaders ? { ...record.requestHeaders } : undefined,
			responseHeaders: record.responseHeaders ? { ...record.responseHeaders } : undefined,
		});

		const archiveRecord = (record) => {
			archived.push(cloneRecord(record));
			if (archived.length > maxEntries * 2) archived.shift();
		};

		const getRecord = (requestId) => {
			const existing = records.get(requestId);
			if (existing) return existing;
			const created = createRecord(requestId);
			records.set(requestId, created);
			return created;
		};

		const onEvent = (source, method, params = {}) => {
			if (source.tabId !== tabId) return;

			if (method === "Network.requestWillBeSent") {
				if (params.redirectResponse) {
					const previous = records.get(params.requestId);
					if (previous) {
						previous.status = params.redirectResponse.status;
						previous.statusText = params.redirectResponse.statusText;
						previous.mimeType = params.redirectResponse.mimeType;
						previous.fromDiskCache = Boolean(params.redirectResponse.fromDiskCache);
						previous.fromServiceWorker = Boolean(params.redirectResponse.fromServiceWorker);
						if (includeResponseHeaders) {
							previous.responseHeaders = normalizeHeaders(params.redirectResponse.headers);
						}
						previous.finished = true;
						previous.redirectedTo = params.request?.url || "";
						archiveRecord(previous);
					}
				}

				const record = createRecord(params.requestId);
				record.url = params.request?.url || "";
				record.method = params.request?.method || "GET";
				record.resourceType = params.type || "other";
				record.initiatorType = params.initiator?.type || "";
				record.startTime = typeof params.timestamp === "number" ? params.timestamp : undefined;
				record.redirectedFrom = params.redirectResponse?.url || undefined;
				if (includeRequestHeaders) {
					record.requestHeaders = normalizeHeaders(params.request?.headers);
				}
				records.set(params.requestId, record);
				return;
			}

			if (method === "Network.responseReceived") {
				const record = getRecord(params.requestId);
				record.url = record.url || params.response?.url || "";
				record.resourceType = params.type || record.resourceType;
				record.status = params.response?.status;
				record.statusText = params.response?.statusText;
				record.mimeType = params.response?.mimeType;
				record.fromDiskCache = Boolean(params.response?.fromDiskCache);
				record.fromServiceWorker = Boolean(params.response?.fromServiceWorker);
				record.remoteIPAddress = params.response?.remoteIPAddress;
				if (includeResponseHeaders) {
					record.responseHeaders = normalizeHeaders(params.response?.headers);
				}
				return;
			}

			if (method === "Network.loadingFinished") {
				const record = getRecord(params.requestId);
				record.finished = true;
				record.encodedDataLength = params.encodedDataLength;
				record.endTime = typeof params.timestamp === "number" ? params.timestamp : undefined;
				return;
			}

			if (method === "Network.loadingFailed") {
				const record = getRecord(params.requestId);
				record.failed = true;
				record.finished = true;
				record.errorText = params.errorText;
				record.canceled = Boolean(params.canceled);
				record.endTime = typeof params.timestamp === "number" ? params.timestamp : undefined;
			}
		};

		chrome.debugger.onEvent.addListener(onEvent);
		try {
			await send("Network.enable");
			await send("Page.enable");
			if (options.reload) {
				await send("Page.reload", { ignoreCache: Boolean(options.ignoreCache) });
			}
			await delay(durationMs);

			const allRecords = [...archived, ...records.values()]
				.sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
				.map(cloneRecord);

			let selectedRecords = allRecords;
			if (matchUrlContains) {
				selectedRecords = selectedRecords.filter((record) =>
					String(record.url || "").toLowerCase().includes(matchUrlContains),
				);
			}
			if (onlyFailures) {
				selectedRecords = selectedRecords.filter((record) => record.failed);
			}
			selectedRecords = selectedRecords.slice(-maxEntries);

			if (includeBodies) {
				let bodyCandidates = selectedRecords.filter((record) => {
					if (record.failed) return false;
					if (onlyFailures) return false;
					if (typeof record.status === "number" && [101, 204, 205, 304].includes(record.status)) return false;
					if (!record.finished) return false;
					if (!isTextualMimeType(record.mimeType, record.url)) return false;
					return true;
				});

				bodyCandidates = bodyCandidates
					.sort((a, b) => {
						const priority = (record) => {
							switch (String(record.resourceType || "").toLowerCase()) {
								case "document":
									return 5;
								case "xhr":
								case "fetch":
									return 4;
								case "stylesheet":
									return 3;
								case "script":
									return 2;
								default:
									return 1;
							}
						};
						return priority(b) - priority(a) || (b.startTime || 0) - (a.startTime || 0);
					})
					.slice(0, bodyMaxEntries);

				for (const record of bodyCandidates) {
					try {
						const bodyPayload = await send("Network.getResponseBody", { requestId: record.requestId });
						record.responseBody = formatResponseBodyPayload(bodyPayload, record.mimeType, bodyMaxChars);
					} catch (error) {
						record.responseBodyError = error?.message || String(error);
					}
				}
			}

			return selectedRecords.map((record) => ({
				requestId: record.requestId,
				url: record.url,
				method: record.method,
				resourceType: record.resourceType,
				initiatorType: record.initiatorType,
				status: record.status,
				statusText: record.statusText,
				mimeType: record.mimeType,
				failed: record.failed,
				errorText: record.errorText,
				canceled: record.canceled,
				fromDiskCache: record.fromDiskCache,
				fromServiceWorker: record.fromServiceWorker,
				redirectedFrom: record.redirectedFrom,
				redirectedTo: record.redirectedTo,
				requestHeaders: includeRequestHeaders ? record.requestHeaders : undefined,
				responseHeaders: includeResponseHeaders ? record.responseHeaders : undefined,
				responseBody: record.responseBody,
				responseBodyError: record.responseBodyError,
				durationMs:
					typeof record.startTime === "number" && typeof record.endTime === "number"
						? Math.max(0, Math.round((record.endTime - record.startTime) * 1000))
						: undefined,
			}));
		} finally {
			chrome.debugger.onEvent.removeListener(onEvent);
		}
	});
}

async function handleCommand(name, args = {}) {
	switch (name) {
		case "ping": {
			const settings = await getSettings();
			return {
				pong: true,
				clientId: settings.clientId,
				extensionVersion: chrome.runtime.getManifest().version,
				runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
				state: await snapshotState(),
			};
		}
		case "list_tabs":
		case "get_state": {
			return await snapshotState();
		}
		case "activate_tab": {
			const tab = await resolveTargetTab(args);
			const focusedTab = await focusTab(tab.id);
			scheduleStatePush("activate_tab");
			return {
				tab: simplifyTab(focusedTab),
			};
		}
		case "navigate": {
			const navigatedTab = await navigateBrowser(args);
			return {
				tab: simplifyTab(navigatedTab),
			};
		}
		case "get_cookies": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const cookies = await getCookiesForTab(tab.id);
				return {
					tab: simplifyTab(tab),
					cookies,
				};
			});
		}
		case "run_js": {
			if (typeof args.expression !== "string" || !args.expression.trim()) {
				throw new Error("run_js requires a non-empty 'expression'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const result = await evaluateInTab(tab.id, args.expression);
				return {
					tab: simplifyTab(tab),
					result,
				};
			});
		}
		case "get_dom": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const outerHTML = await getDomOuterHtml(tab.id);
				return {
					tab: simplifyTab(tab),
					outerHTML,
				};
			});
		}
		case "highlight_text": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("highlight_text requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const annotation = await runPageToolkitMethod(tab.id, "highlightText", args.text, {
					occurrence: args.occurrence,
					clearExisting: args.clearExisting,
					scrollIntoView: args.scrollIntoView,
				});
				return {
					tab: simplifyTab(tab),
					annotation,
				};
			});
		}
		case "show_note": {
			if (typeof args.annotationId !== "string" || !args.annotationId.trim()) {
				throw new Error("show_note requires a non-empty 'annotationId'");
			}
			if (typeof args.note !== "string" || !args.note.trim()) {
				throw new Error("show_note requires a non-empty 'note'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const note = await runPageToolkitMethod(tab.id, "showNote", args.annotationId, args.note, {
					label: args.label,
					scrollIntoView: args.scrollIntoView,
					block: args.block,
				});
				return {
					tab: simplifyTab(tab),
					note,
				};
			});
		}
		case "scroll_to_annotation": {
			if (typeof args.annotationId !== "string" || !args.annotationId.trim()) {
				throw new Error("scroll_to_annotation requires a non-empty 'annotationId'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const annotation = await runPageToolkitMethod(tab.id, "scrollToAnnotation", args.annotationId, {
					block: args.block,
					target: args.target,
				});
				return {
					tab: simplifyTab(tab),
					annotation,
				};
			});
		}
		case "capture_state": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const page = await runPageToolkitMethod(tab.id, "captureState");
				return {
					tab: simplifyTab(tab),
					page,
				};
			});
		}
		case "get_visible_text": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const visible = await runPageToolkitMethod(tab.id, "getVisibleText", {
					maxChars: args.maxChars,
					maxBlocks: args.maxBlocks,
				});
				return {
					tab: simplifyTab(tab),
					visible,
				};
			});
		}
		case "get_selection": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const selection = await runPageToolkitMethod(tab.id, "getSelectionInfo");
				return {
					tab: simplifyTab(tab),
					selection,
				};
			});
		}
		case "get_viewport_headings": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const headings = await runPageToolkitMethod(tab.id, "getViewportHeadings", {
					maxHeadings: args.maxHeadings,
				});
				return {
					tab: simplifyTab(tab),
					headings,
				};
			});
		}
		case "get_scroll_state": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const scroll = await runPageToolkitMethod(tab.id, "getScrollState");
				return {
					tab: simplifyTab(tab),
					scroll,
				};
			});
		}
		case "clear_annotations": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const cleared = await runPageToolkitMethod(tab.id, "clearAnnotations");
				return {
					tab: simplifyTab(tab),
					...cleared,
				};
			});
		}
		case "find_elements": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("find_elements requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const matches = await runPageToolkitMethod(tab.id, "findElementsByText", args.text, {
					interactiveOnly: args.interactiveOnly,
					exact: args.exact,
					includeHidden: args.includeHidden,
					maxResults: args.maxResults,
				});
				return {
					tab: simplifyTab(tab),
					matches,
				};
			});
		}
		case "click": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("click requires a non-empty 'selector'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const element = await evaluateInTab(tab.id, `(${clickElementInPage.toString()})(${JSON.stringify({ selector: args.selector })})`);
				return {
					tab: simplifyTab(tab),
					element,
				};
			});
		}
		case "type_text": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("type_text requires a non-empty 'selector'");
			}
			if (typeof args.text !== "string") {
				throw new Error("type_text requires a string 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const element = await evaluateInTab(
					tab.id,
					`(${typeIntoElementInPage.toString()})(${JSON.stringify({
						selector: args.selector,
						text: args.text,
						clear: args.clear,
						submit: args.submit,
					})})`,
				);
				return {
					tab: simplifyTab(tab),
					element,
				};
			});
		}
		case "wait_for_selector": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("wait_for_selector requires a non-empty 'selector'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const element = await evaluateInTab(
					tab.id,
					`(${waitForSelectorInPage.toString()})(${JSON.stringify({
						selector: args.selector,
						timeoutMs: args.timeoutMs,
						visible: args.visible,
					})})`,
				);
				return {
					tab: simplifyTab(tab),
					element,
				};
			});
		}
		case "collect_console": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const entries = await collectConsoleEvents(tab.id, args);
				return {
					tab: simplifyTab(tab),
					entries,
				};
			});
		}
		case "collect_network": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const entries = await collectNetworkEvents(tab.id, args);
				return {
					tab: simplifyTab(tab),
					entries,
				};
			});
		}
		case "click_text": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("click_text requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const result = await runPageToolkitMethod(tab.id, "clickByText", args.text, {
					exact: args.exact,
					includeHidden: args.includeHidden,
					maxResults: args.maxResults,
				});
				return {
					tab: simplifyTab(tab),
					element: result.element,
					matches: result.matches,
				};
			});
		}
		case "type_by_label": {
			if (typeof args.labelText !== "string" || !args.labelText.trim()) {
				throw new Error("type_by_label requires a non-empty 'labelText'");
			}
			if (typeof args.text !== "string") {
				throw new Error("type_by_label requires a string 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const result = await runPageToolkitMethod(tab.id, "typeByLabel", args.labelText, args.text, {
					clear: args.clear,
					submit: args.submit,
					exact: args.exact,
					includeHidden: args.includeHidden,
				});
				return {
					tab: simplifyTab(tab),
					element: result.element,
					matchedBy: result.matchedBy,
					matches: result.matches,
				};
			});
		}
		case "pick_elements": {
			if (typeof args.message !== "string" || !args.message.trim()) {
				throw new Error("pick_elements requires a non-empty 'message'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const selection = await runPageToolkitMethod(tab.id, "pickElements", args.message);
				return {
					tab: simplifyTab(tab),
					selection,
				};
			});
		}
		case "capture_screenshot": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const screenshot = await captureTabScreenshot(tab.id, args);
				return {
					tab: simplifyTab(screenshot.tab),
					dataUrl: screenshot.dataUrl,
					method: screenshot.method,
				};
			});
		}
		case "open_onhand_sidebar": {
			const windowId = await resolveSidebarWindowId(args);
			return await openSidebarForWindow(windowId);
		}
		case "close_onhand_sidebar": {
			const windowId = await resolveSidebarWindowId(args);
			return await closeSidebarForWindow(windowId);
		}
		default:
			throw new Error(`Unknown command: ${name}`);
	}
}

async function handleBridgeMessage(message) {
	if (!message || typeof message !== "object") return;

	if (message.type === "welcome") {
		await updateStatus({
			connectionStatus: "connected",
			lastError: "",
			lastConnectedAt: Date.now(),
		});
		return;
	}

	if (message.type !== "command") return;

	try {
		const result = await handleCommand(message.name, message.args || {});
		sendToBridge({
			type: "result",
			id: message.id,
			ok: true,
			result,
		});
	} catch (error) {
		sendToBridge({
			type: "result",
			id: message.id,
			ok: false,
			error: error?.message || String(error),
		});
	}
}

async function connectBridge(force = false) {
	if (connectBridgePromise) {
		return connectBridgePromise;
	}

	connectBridgePromise = (async () => {
		ensureOffscreenDocument().catch((error) => {
			log("Could not ensure offscreen heartbeat document", error?.message || String(error));
		});

		const settings = await loadSettings();
		if (!settings.token) {
			await updateStatus({
				connectionStatus: "needs-configuration",
				lastError: "Set the bridge token in the extension options.",
			});
			return;
		}

		if (!force && ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) {
			return;
		}

		clearReconnectTimer();
		stopSocket();

		const generation = ++socketGeneration;
		const bridgeUrl = new URL(settings.bridgeUrl);
		bridgeUrl.searchParams.set("token", settings.token);
		bridgeUrl.searchParams.set("clientId", settings.clientId);

		await updateStatus({
			connectionStatus: "connecting",
			lastError: "",
		});

		try {
			await probeBridgeAvailability(settings);
		} catch (error) {
			await updateStatus({
				connectionStatus: "disconnected",
				lastError: error?.message || "Bridge is not reachable yet.",
			});
			scheduleReconnect();
			return;
		}

		ws = new WebSocket(bridgeUrl.toString());

		ws.onopen = async () => {
			if (generation !== socketGeneration) return;
			log("Connected to bridge", bridgeUrl.toString());
			startKeepAlive();
			sendToBridge({
				type: "hello",
				clientId: settings.clientId,
				clientLabel: String(settings.clientLabel || "").trim() || undefined,
				browserName: navigator.userAgent,
				extensionVersion: chrome.runtime.getManifest().version,
				runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
				connectedAt: Date.now(),
			});
			await updateStatus({
				connectionStatus: "connected",
				lastError: "",
				lastConnectedAt: Date.now(),
			});
			await pushState("connect");
		};

		ws.onmessage = async (event) => {
			if (generation !== socketGeneration) return;
			try {
				const message = JSON.parse(event.data);
				await handleBridgeMessage(message);
			} catch (error) {
				log("Failed to handle bridge message", error);
			}
		};

		ws.onerror = async () => {
			if (generation !== socketGeneration) return;
			await updateStatus({
				connectionStatus: "error",
				lastError: "WebSocket error while connecting to bridge.",
			});
		};

		ws.onclose = async () => {
			if (generation !== socketGeneration) return;
			log("Disconnected from bridge");
			await updateStatus({
				connectionStatus: "disconnected",
			});
			scheduleReconnect();
		};
	})().finally(() => {
		connectBridgePromise = null;
	});

	return connectBridgePromise;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (!changes.bridgeUrl && !changes.token && !changes.clientLabel) return;
	settingsCache = null;
	connectBridge(true).catch((error) => log("Reconnect after settings change failed", error));
});

if (chrome.sidePanel?.onOpened?.addListener) {
	chrome.sidePanel.onOpened.addListener(async (info) => {
		if (typeof info?.windowId === "number") {
			await setSidebarWindowOpen(info.windowId, true);
		}
	});
}

if (chrome.sidePanel?.onClosed?.addListener) {
	chrome.sidePanel.onClosed.addListener(async (info) => {
		if (typeof info?.windowId === "number") {
			await setSidebarWindowOpen(info.windowId, false);
		}
	});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	(async () => {
		if (message?.type === "reconnect") {
			await connectBridge(true);
			sendResponse({ ok: true });
			return;
		}

		if (message?.type === "get-status") {
			const settings = await loadSettings();
			sendResponse({
				ok: true,
				status: {
					bridgeUrl: settings.bridgeUrl,
					token: settings.token,
					clientId: settings.clientId,
					clientLabel: settings.clientLabel,
					connectionStatus: settings.connectionStatus,
					lastError: settings.lastError,
					lastConnectedAt: settings.lastConnectedAt,
				},
			});
			return;
		}

		if (message?.type === "offscreen-heartbeat") {
			if (!ws || [WebSocket.CLOSING, WebSocket.CLOSED].includes(ws.readyState)) {
				await connectBridge();
			}
			sendResponse({ ok: true });
			return;
		}

		if (message?.type === "sidebar:get-window-state") {
			const windowId =
				typeof message.windowId === "number" ? message.windowId : typeof _sender?.tab?.windowId === "number" ? _sender.tab.windowId : null;
			sendResponse({
				ok: true,
				open: await isSidebarOpenForWindow(windowId),
			});
			return;
		}

		if (message?.type === "sidebar:fetch-state") {
			const response = await callOnhandApi("/state");
			sendResponse({
				ok: true,
				state: response.state,
			});
			return;
		}

		if (message?.type === "sidebar:set-learning-mode") {
			const response = await callOnhandApi("/settings", {
				method: "POST",
				body: JSON.stringify({
					learningMode: Boolean(message.learningMode),
				}),
			});
			sendResponse({
				ok: true,
				settings: response.settings,
			});
			return;
		}

		if (message?.type === "sidebar:list-sessions") {
			const params = new URLSearchParams();
			if (typeof message.limit === "number" && Number.isFinite(message.limit)) {
				params.set("limit", String(message.limit));
			}
			const response = await callOnhandApi(`/sessions${params.size ? `?${params.toString()}` : ""}`);
			sendResponse({
				ok: true,
				currentSession: response.currentSession,
				sessions: response.sessions,
			});
			return;
		}

		if (message?.type === "sidebar:new-session") {
			const response = await callOnhandApi("/sessions/new", {
				method: "POST",
			});
			sendResponse({
				ok: true,
				created: response.created,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:switch-session") {
			const response = await callOnhandApi("/sessions/switch", {
				method: "POST",
				body: JSON.stringify({
					sessionPath: message.sessionPath,
				}),
			});
			sendResponse({
				ok: true,
				switched: response.switched,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:restore-session") {
			const settings = await getSettings();
			const response = await callOnhandApi("/sessions/restore", {
				method: "POST",
				body: JSON.stringify({
					sessionPath: message.sessionPath,
					browserClientId: settings.clientId,
				}),
			});
			sendResponse({
				ok: true,
				restoredPages: response.restoredPages,
				restoredCount: response.restoredCount,
			});
			return;
		}

		if (message?.type === "sidebar:submit-prompt") {
			const settings = await getSettings();
			const response = await callOnhandApi("/prompt", {
				method: "POST",
				body: JSON.stringify({
					prompt: message.prompt,
					displayPrompt: message.displayPrompt,
					attachments: Array.isArray(message.attachments) ? message.attachments : [],
					source: message.source === "sidebar" ? "sidebar" : "desktop",
					learningMode: Boolean(message.learningMode),
					browserClientId: settings.clientId,
				}),
			});
			sendResponse({
				ok: true,
				requestId: response.requestId,
			});
			return;
		}

		if (message?.type === "sidebar:activate-action") {
			const settings = await getSettings();
			const response = await callOnhandApi("/action", {
				method: "POST",
				body: JSON.stringify({
					key: message.key,
					browserClientId: settings.clientId,
				}),
			});
			sendResponse({
				ok: true,
				result: response.result,
			});
			return;
		}

		if (message?.type === "sidebar:stop") {
			const response = await callOnhandApi("/stop", {
				method: "POST",
			});
			sendResponse({
				ok: true,
				stopped: response.stopped,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:close") {
			const windowId =
				typeof message.windowId === "number" ? message.windowId : typeof _sender?.tab?.windowId === "number" ? _sender.tab.windowId : null;
			const result = await closeSidebarForWindow(windowId);
			sendResponse({
				ok: true,
				...result,
			});
			return;
		}

		sendResponse({ ok: false, error: "Unknown message" });
	})().catch((error) => {
		sendResponse({ ok: false, error: error?.message || String(error) });
	});

	return true;
});

chrome.action.onClicked.addListener((tab) => {
	(async () => {
		const windowId =
			typeof tab?.windowId === "number" ? tab.windowId : await resolveSidebarWindowId({ windowId: tab?.windowId });
		if (typeof windowId !== "number") {
			chrome.runtime.openOptionsPage();
			return;
		}
		if (await isSidebarOpenForWindow(windowId)) {
			await closeSidebarForWindow(windowId);
			return;
		}
		await openSidebarForWindow(windowId);
	})().catch((error) => log("Could not toggle Onhand sidebar from toolbar action", error?.message || String(error)));
});

for (const eventName of [
	chrome.tabs.onCreated,
	chrome.tabs.onRemoved,
	chrome.tabs.onMoved,
	chrome.tabs.onActivated,
	chrome.windows.onCreated,
	chrome.windows.onRemoved,
	chrome.windows.onFocusChanged,
]) {
	eventName.addListener(() => scheduleStatePush("browser-event"));
}

chrome.tabs.onUpdated.addListener(() => {
	scheduleStatePush("tabs.onUpdated");
});

chrome.windows.onRemoved.addListener(async (windowId) => {
	await setSidebarWindowOpen(windowId, false);
});

connectBridge().catch((error) => {
	log("Initial connect failed", error);
});

initializeExtensionSurface();
