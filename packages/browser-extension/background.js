const DEFAULT_SETTINGS = {
	bridgeUrl: "ws://127.0.0.1:3210/ws",
	token: "",
};

const STATE_DEBOUNCE_MS = 200;
const RECONNECT_DELAY_MS = 2000;
const SCREENSHOT_DELAY_MS = 150;

let ws = null;
let socketGeneration = 0;
let reconnectTimer = null;
let stateTimer = null;
let settingsCache = null;

function log(...args) {
	console.log("[onhand-browser-bridge]", ...args);
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

function scheduleReconnect() {
	clearReconnectTimer();
	reconnectTimer = setTimeout(() => {
		connectBridge().catch((error) => {
			log("Reconnect failed", error);
		});
	}, RECONNECT_DELAY_MS);
}

function stopSocket() {
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

async function withDebugger(tabId, fn) {
	const target = { tabId };
	await chrome.debugger.attach(target, "1.3");
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

	const getElementText = (element) => normalizeText(element?.innerText || element?.textContent || "");

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

	const waitForLayout = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

	const ensureAnnotationStyles = () => {
		const styleId = "onhand-browser-annotation-style";
		if (document.getElementById(styleId)) return;
		const style = document.createElement("style");
		style.id = styleId;
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
		`;
		(document.head || document.documentElement).appendChild(style);
	};

	const nextAnnotationId = () => `onhand-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

	const rectToObject = (rect) => ({
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		bottom: rect.bottom,
		right: rect.right,
	});

	const clearAnnotations = () => {
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
			clearedInline,
			clearedBlock,
			clearedTotal: clearedInline + clearedBlock,
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

		const rawNeedle = rawQuery.toLowerCase();
		let matchIndex = 0;
		const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
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
				if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let currentNode;
		while ((currentNode = walker.nextNode())) {
			const node = currentNode;
			const value = String(node.nodeValue || "");
			const lowerValue = value.toLowerCase();
			let searchFrom = 0;
			while (searchFrom <= lowerValue.length) {
				const foundAt = lowerValue.indexOf(rawNeedle, searchFrom);
				if (foundAt === -1) break;
				matchIndex += 1;
				if (matchIndex === occurrence) {
					const range = document.createRange();
					range.setStart(node, foundAt);
					range.setEnd(node, foundAt + rawQuery.length);
					const highlight = document.createElement("span");
					const annotationId = nextAnnotationId();
					highlight.setAttribute("data-onhand-highlight-kind", "inline");
					highlight.setAttribute("data-onhand-annotation-id", annotationId);
					try {
						range.surroundContents(highlight);
					} catch {
						const fragment = range.extractContents();
						highlight.appendChild(fragment);
						range.insertNode(highlight);
					}
					if (scrollIntoView) {
						highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
					}
					await waitForLayout();
					const anchorElement = highlight.parentElement || highlight;
					return {
						annotationId,
						kind: "inline",
						matchedText: highlight.textContent || rawQuery,
						container: summarizeElement(anchorElement),
						rect: rectToObject(highlight.getBoundingClientRect()),
						scrollY: window.scrollY,
					};
				}
				searchFrom = foundAt + Math.max(rawQuery.length, 1);
			}
		}

		matchIndex = 0;
		for (const element of document.querySelectorAll("p, li, blockquote, pre, code, td, th, figcaption, caption, h1, h2, h3, h4, h5, h6, summary")) {
			if (!(element instanceof Element)) continue;
			if (!isVisible(element)) continue;
			if (element.closest('[data-onhand-highlight-kind]')) continue;
			const text = getElementText(element);
			if (!text) continue;
			if (!lowerText(text).includes(normalizedQuery)) continue;
			matchIndex += 1;
			if (matchIndex !== occurrence) continue;
			const annotationId = nextAnnotationId();
			element.setAttribute("data-onhand-highlight-kind", "block");
			element.setAttribute("data-onhand-annotation-id", annotationId);
			if (scrollIntoView) {
				element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
			}
			await waitForLayout();
			return {
				annotationId,
				kind: "block",
				matchedText: text.slice(0, 300),
				container: summarizeElement(element),
				rect: rectToObject(element.getBoundingClientRect()),
				scrollY: window.scrollY,
			};
		}

		throw new Error(`No visible text matched: ${query}`);
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
		clearAnnotations,
		pickElements,
	};
};

async function evaluateInTab(tabId, expression) {
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
	const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
	return await evaluateInTab(
		tabId,
		`(async () => { const toolkit = (${createPageToolkit.toString()})(); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`,
	);
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
	return await withDebugger(tabId, async ({ send }) => {
		await send("DOM.enable");
		const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
		const { outerHTML } = await send("DOM.getOuterHTML", { nodeId: root.nodeId });
		return outerHTML;
	});
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
			const cookies = await getCookiesForTab(tab.id);
			return {
				tab: simplifyTab(tab),
				cookies,
			};
		}
		case "run_js": {
			if (typeof args.expression !== "string" || !args.expression.trim()) {
				throw new Error("run_js requires a non-empty 'expression'");
			}
			const tab = await resolveTargetTab(args);
			const result = await evaluateInTab(tab.id, args.expression);
			return {
				tab: simplifyTab(tab),
				result,
			};
		}
		case "get_dom": {
			const tab = await resolveTargetTab(args);
			const outerHTML = await getDomOuterHtml(tab.id);
			return {
				tab: simplifyTab(tab),
				outerHTML,
			};
		}
		case "highlight_text": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("highlight_text requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
			const annotation = await runPageToolkitMethod(tab.id, "highlightText", args.text, {
				occurrence: args.occurrence,
				clearExisting: args.clearExisting,
				scrollIntoView: args.scrollIntoView,
			});
			return {
				tab: simplifyTab(tab),
				annotation,
			};
		}
		case "clear_annotations": {
			const tab = await resolveTargetTab(args);
			const cleared = await runPageToolkitMethod(tab.id, "clearAnnotations");
			return {
				tab: simplifyTab(tab),
				...cleared,
			};
		}
		case "find_elements": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("find_elements requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
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
		}
		case "click": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("click requires a non-empty 'selector'");
			}
			const tab = await resolveTargetTab(args);
			const element = await evaluateInTab(tab.id, `(${clickElementInPage.toString()})(${JSON.stringify({ selector: args.selector })})`);
			return {
				tab: simplifyTab(tab),
				element,
			};
		}
		case "type_text": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("type_text requires a non-empty 'selector'");
			}
			if (typeof args.text !== "string") {
				throw new Error("type_text requires a string 'text'");
			}
			const tab = await resolveTargetTab(args);
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
		}
		case "wait_for_selector": {
			if (typeof args.selector !== "string" || !args.selector.trim()) {
				throw new Error("wait_for_selector requires a non-empty 'selector'");
			}
			const tab = await resolveTargetTab(args);
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
		}
		case "collect_console": {
			const tab = await resolveTargetTab(args);
			const entries = await collectConsoleEvents(tab.id, args);
			return {
				tab: simplifyTab(tab),
				entries,
			};
		}
		case "collect_network": {
			const tab = await resolveTargetTab(args);
			const entries = await collectNetworkEvents(tab.id, args);
			return {
				tab: simplifyTab(tab),
				entries,
			};
		}
		case "click_text": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("click_text requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
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
		}
		case "type_by_label": {
			if (typeof args.labelText !== "string" || !args.labelText.trim()) {
				throw new Error("type_by_label requires a non-empty 'labelText'");
			}
			if (typeof args.text !== "string") {
				throw new Error("type_by_label requires a string 'text'");
			}
			const tab = await resolveTargetTab(args);
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
		}
		case "pick_elements": {
			if (typeof args.message !== "string" || !args.message.trim()) {
				throw new Error("pick_elements requires a non-empty 'message'");
			}
			const tab = await resolveTargetTab(args);
			const selection = await runPageToolkitMethod(tab.id, "pickElements", args.message);
			return {
				tab: simplifyTab(tab),
				selection,
			};
		}
		case "capture_screenshot": {
			const tab = await resolveTargetTab(args);
			const focusedTab = await focusTab(tab.id);
			await delay(typeof args.delayMs === "number" ? args.delayMs : SCREENSHOT_DELAY_MS);
			const dataUrl = await chrome.tabs.captureVisibleTab(focusedTab.windowId, {
				format: args.format === "jpeg" ? "jpeg" : "png",
				quality: typeof args.quality === "number" ? args.quality : undefined,
			});
			return {
				tab: simplifyTab(focusedTab),
				dataUrl,
			};
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

	ws = new WebSocket(bridgeUrl.toString());

	ws.onopen = async () => {
		if (generation !== socketGeneration) return;
		log("Connected to bridge", bridgeUrl.toString());
		sendToBridge({
			type: "hello",
			clientId: settings.clientId,
			browserName: navigator.userAgent,
			extensionVersion: chrome.runtime.getManifest().version,
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
}

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (!changes.bridgeUrl && !changes.token) return;
	settingsCache = null;
	connectBridge(true).catch((error) => log("Reconnect after settings change failed", error));
});

chrome.runtime.onInstalled.addListener(() => {
	loadSettings().then(() => connectBridge()).catch((error) => log("Install init failed", error));
});

chrome.runtime.onStartup.addListener(() => {
	connectBridge().catch((error) => log("Startup connect failed", error));
});

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
					connectionStatus: settings.connectionStatus,
					lastError: settings.lastError,
					lastConnectedAt: settings.lastConnectedAt,
				},
			});
			return;
		}

		sendResponse({ ok: false, error: "Unknown message" });
	})().catch((error) => {
		sendResponse({ ok: false, error: error?.message || String(error) });
	});

	return true;
});

chrome.action.onClicked.addListener(() => {
	chrome.runtime.openOptionsPage();
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

connectBridge().catch((error) => {
	log("Initial connect failed", error);
});
