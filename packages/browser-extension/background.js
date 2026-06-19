import { ONHAND_EXTENSION_RUNTIME_REVISION } from "./runtime-revision.js";
import { createOnhandBrowserRuntime } from "./onhand-runtime.bundle.js";

const SCREENSHOT_DELAY_MS = 150;
const SCRIPT_EXECUTION_TIMEOUT_MS = 2500;
const PDF_READER_FRAME_EXECUTION_TIMEOUT_MS = 6000;
const DEBUGGER_ATTACH_RETRY_DELAY_MS = 150;
const SIDEBAR_WINDOW_STATES_KEY = "onhandSidebarWindowStates";
const SIDEBAR_QUICK_OPEN_REQUEST_KEY = "onhandSidebarQuickOpenRequest";
const SIDEBAR_QUICK_OPEN_RETRY_DELAYS_MS = [0, 80, 240, 600];
const ONHAND_SIDEBAR_PANEL_PATH = "sidepanel.html";
const OPERA_TOOLBAR_POPUP_PATH = "opera-sidebar-help.html";
const OPERA_TOOLBAR_ACTION_TITLE = "Onhand: open from Opera's sidebar";
const OPERA_TOOLBAR_HINT_BADGE_TEXT = "Side";
const OPERA_TOOLBAR_HINT_DURATION_MS = 4000;
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const OPENAI_REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const OPENAI_REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_REALTIME_VOICE = "marin";
const REALTIME_API_KEY_SETUP_MESSAGE =
	"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.";
const ONHAND_THEME_STORAGE_KEY = "onhandSidebarTheme";
const ONHAND_THEME_VALUES = new Set(["system", "light", "dark"]);
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const GOOGLE_SCHOLAR_READER_EXTENSION_ID = "dahenjhkoodjbpjheillcadbppiidmhp";
const GOOGLE_SCHOLAR_READER_FRAME_PREFIX = `chrome-extension://${GOOGLE_SCHOLAR_READER_EXTENSION_ID}/reader.html`;
const NATIVE_CHROME_PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";
const NATIVE_CHROME_PDF_VIEWER_PREFIX = `chrome-extension://${NATIVE_CHROME_PDF_VIEWER_EXTENSION_ID}/`;
const FONT_ASSET_PATHS = Object.freeze({
	newYorkRegular: "fonts/NewYork.woff2",
	newYorkItalic: "fonts/NewYorkItalic.woff2",
	ioskeleyRegular: "fonts/IoskeleyMono-Regular.woff2",
	ioskeleyBold: "fonts/IoskeleyMono-Bold.woff2",
	ioskeleyItalic: "fonts/IoskeleyMono-Italic.woff2",
});

let creatingOffscreenDocument = null;
let onhandBrowserRuntime = null;
const debuggerTaskChains = new Map();
const tabCommandTaskChains = new Map();
let operaToolbarHintTimer = null;

function log(...args) {
	console.log("[onhand-extension]", ...args);
}

function getOnhandBrowserRuntime() {
	if (!onhandBrowserRuntime) {
		onhandBrowserRuntime = createOnhandBrowserRuntime({
			runCommand: (name, args = {}) => handleCommand(name, args),
			snapshotState,
			log,
			notifyAuthProgress: (event) => {
				chrome.runtime
					.sendMessage({
						type: "browser-runtime:auth-progress",
						...event,
					})
					.catch(() => {});
			},
			extensionVersion: chrome.runtime.getManifest().version,
			runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
		});
	}
	return onhandBrowserRuntime;
}

function configureSidePanelActionClick() {
	if (!chrome.sidePanel?.setPanelBehavior) return;
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
		log("Could not configure side panel action behavior", error?.message || String(error));
	});
}

function getOperaSidebarAction() {
	return globalThis.opr?.sidebarAction || null;
}

function configureOperaSidebarAction() {
	const sidebarAction = getOperaSidebarAction();
	if (!sidebarAction) return;
	try {
		sidebarAction.setTitle?.({ title: "Onhand" });
	} catch (error) {
		log("Could not configure Opera sidebar title", error?.message || String(error));
	}
	try {
		sidebarAction.setPanel?.({ panel: ONHAND_SIDEBAR_PANEL_PATH });
	} catch (error) {
		log("Could not configure Opera sidebar panel", error?.message || String(error));
	}
	if (chrome.action?.setTitle) {
		chrome.action.setTitle({ title: OPERA_TOOLBAR_ACTION_TITLE }).catch((error) => {
			log("Could not configure Opera toolbar action title", error?.message || String(error));
		});
	}
	if (chrome.action?.setPopup) {
		chrome.action.setPopup({ popup: OPERA_TOOLBAR_POPUP_PATH }).catch((error) => {
			log("Could not configure Opera toolbar action popup", error?.message || String(error));
		});
	}
}

function restrictStorageToTrustedContexts() {
	if (!chrome.storage?.local?.setAccessLevel) return;
	chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => {
		log("Could not restrict extension storage access", error?.message || String(error));
	});
}

function initializeExtensionSurface() {
	restrictStorageToTrustedContexts();
	configureSidePanelActionClick();
	configureOperaSidebarAction();
	ensureOffscreenDocument().catch((error) => {
		log("Could not initialize offscreen runtime document", error?.message || String(error));
	});
}

async function openOnhandOptionsPage() {
	const optionsUrl = chrome.runtime.getURL("options.html");
	if (chrome.runtime?.openOptionsPage) {
		try {
			await chrome.runtime.openOptionsPage();
			return;
		} catch (error) {
			log("Could not open extension options page with runtime API", error?.message || String(error));
		}
	}
	if (chrome.tabs?.create) {
		await chrome.tabs.create({ url: optionsUrl, active: true });
		return;
	}
	throw new Error("Could not open Onhand options page.");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExtensionFontUrls() {
	return Object.fromEntries(Object.entries(FONT_ASSET_PATHS).map(([key, path]) => [key, chrome.runtime.getURL(path)]));
}

function normalizeOnhandTheme(value) {
	const theme = String(value || "system").toLowerCase();
	return ONHAND_THEME_VALUES.has(theme) ? theme : "system";
}

async function getOnhandThemePreference() {
	try {
		const stored = await chrome.storage.local.get({ [ONHAND_THEME_STORAGE_KEY]: "system" });
		return normalizeOnhandTheme(stored[ONHAND_THEME_STORAGE_KEY]);
	} catch {
		return "system";
	}
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
			justification: "Maintain the Onhand browser runtime in Chrome MV3.",
		})
		.finally(() => {
			creatingOffscreenDocument = null;
		});

	await creatingOffscreenDocument;
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

async function resolveSidebarMessageWindowId(message, sender) {
	if (typeof message?.windowId === "number") return message.windowId;
	if (typeof sender?.tab?.windowId === "number") return sender.tab.windowId;
	try {
		return await resolveSidebarWindowId({});
	} catch {
		return null;
	}
}

async function openSidebarForWindow(windowId) {
	if (typeof windowId !== "number") {
		throw new Error("No browser window is available for the Onhand sidebar.");
	}
	if (!chrome.sidePanel?.open && getOperaSidebarAction()) {
		return await handleOperaToolbarAction(windowId);
	}
	if (!chrome.sidePanel?.open) {
		throw new Error("This browser does not expose a native side panel API for Onhand.");
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

function createQuickOpenRequest(windowId) {
	const randomId =
		typeof globalThis.crypto?.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `quick-open-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return {
		id: randomId,
		windowId,
		target: "composer",
		createdAt: Date.now(),
	};
}

async function requestSidebarQuickOpen(windowId) {
	const request = createQuickOpenRequest(windowId);
	await chrome.storage.local.set({ [SIDEBAR_QUICK_OPEN_REQUEST_KEY]: request });
	for (const delayMs of SIDEBAR_QUICK_OPEN_RETRY_DELAYS_MS) {
		setTimeout(() => {
			chrome.runtime
				.sendMessage({
					type: "sidebar:quick-open",
					request,
				})
				.catch(() => {});
		}, delayMs);
	}
	return request;
}

async function showOperaToolbarInstruction(tabId) {
	if (!chrome.action) return;
	if (operaToolbarHintTimer) {
		clearTimeout(operaToolbarHintTimer);
		operaToolbarHintTimer = null;
	}
	const details = typeof tabId === "number" ? { tabId } : {};
	try {
		await chrome.action.setTitle?.({
			...details,
			title: "Use the Onhand button in Opera's left sidebar",
		});
		await chrome.action.setBadgeText?.({
			...details,
			text: OPERA_TOOLBAR_HINT_BADGE_TEXT,
		});
		await chrome.action.setBadgeBackgroundColor?.({
			...details,
			color: "#4f46e5",
		});
	} catch (error) {
		log("Could not show Opera toolbar sidebar hint", error?.message || String(error));
	}
	operaToolbarHintTimer = setTimeout(() => {
		Promise.all([
			chrome.action.setTitle?.({ ...details, title: OPERA_TOOLBAR_ACTION_TITLE }),
			chrome.action.setBadgeText?.({ ...details, text: "" }),
		]).catch((error) => {
			log("Could not clear Opera toolbar sidebar hint", error?.message || String(error));
		});
		operaToolbarHintTimer = null;
	}, OPERA_TOOLBAR_HINT_DURATION_MS);
}

async function handleOperaToolbarAction(windowId, tabId) {
	await showOperaToolbarInstruction(tabId);
	return {
		windowId,
		open: false,
		surface: "opera-sidebar-instructions",
	};
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

async function snapshotState(args = {}) {
	const requestedWindowId = typeof args.windowId === "number" && Number.isFinite(args.windowId) ? args.windowId : undefined;
	const windows = await chrome.windows.getAll({ populate: true });
	const focusedWindow = windows.find((windowInfo) => windowInfo.focused);
	const visibleWindows = requestedWindowId === undefined ? windows : windows.filter((windowInfo) => windowInfo.id === requestedWindowId);
	return {
		capturedAt: Date.now(),
		focusedWindowId: focusedWindow?.id ?? null,
		windows: visibleWindows.map(simplifyWindow),
	};
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

	const titleNeedle = String(args.titleContains || "").trim().toLowerCase();
	const urlNeedle = String(args.urlContains || "").trim().toLowerCase();
	const windowId = typeof args.windowId === "number" && Number.isFinite(args.windowId) ? args.windowId : undefined;
	if (titleNeedle || urlNeedle) {
		const scopedWindowId = windowId === undefined ? (await chrome.windows.getLastFocused())?.id : windowId;
		const tabs = await chrome.tabs.query(scopedWindowId === undefined ? { active: true, lastFocusedWindow: true } : { windowId: scopedWindowId });
		const matches = tabs.filter((tab) => {
			const titleMatches = !titleNeedle || String(tab.title || "").toLowerCase().includes(titleNeedle);
			const urlMatches = !urlNeedle || String(tab.url || "").toLowerCase().includes(urlNeedle);
			return tab.id && titleMatches && urlMatches;
		});
		if (!matches.length) {
			throw new Error(`No tab matched ${titleNeedle ? `title "${args.titleContains}"` : ""}${titleNeedle && urlNeedle ? " and " : ""}${urlNeedle ? `URL "${args.urlContains}"` : ""}`);
		}
		return matches.find((tab) => tab.active) || matches[0];
	}

	const [tab] = await chrome.tabs.query(
		windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId },
	);
	if (!tab?.id) {
		throw new Error("No active tab found");
	}
	return tab;
}

function hasTabMatchSelector(args = {}) {
	return Boolean(String(args.titleContains || "").trim() || String(args.urlContains || "").trim());
}

async function resolveReadTargetTab(args = {}) {
	if (hasTabMatchSelector(args)) {
		throw new Error("Reading page content by titleContains or urlContains is not allowed. Use the active tab or an explicit tabId selected by the user.");
	}
	return await resolveTargetTab(args);
}

function isDebuggerAttachConflict(error) {
	return /another debugger|already attached/i.test(error?.message || String(error));
}

function isRestrictedScriptingError(error) {
	return /Cannot access contents of url|chrome-error:\/\/chromewebdata|Cannot access a chrome:\/\/ URL|Cannot access a chrome-extension:\/\/ URL|Cannot access a file:\/\/ URL|The extensions gallery cannot be scripted|Missing host permission/i.test(
		error?.message || String(error),
	);
}

function describeTabForError(tab) {
	return tab?.title || tab?.url || `tab ${tab?.id || "(unknown)"}`;
}

function isFileUrl(value) {
	try {
		return new URL(String(value || "")).protocol === "file:";
	} catch {
		return false;
	}
}

function localFileAccessMessage(tab, error = null) {
	const suffix = error ? ` Chrome reported: ${error?.message || String(error)}` : "";
	return `This is a local file tab. Onhand can read file:// pages only after Chrome grants the extension file access. Open chrome://extensions, find Onhand, enable "Allow access to file URLs", then reload this tab. You can also serve the file over localhost and open the http://localhost URL.${suffix}`;
}

function isLocalFileAccessError(tab, error) {
	return isFileUrl(tab?.url) && isRestrictedScriptingError(error);
}

function createLocalFileAccessError(tab, error) {
	return new Error(localFileAccessMessage(tab, error));
}

function unsupportedLocalFilePayload(tab, error = null) {
	const message = localFileAccessMessage(tab, error);
	return {
		surface: "local-file",
		unsupported: true,
		reason: message,
		text: message,
		markdown: message,
		url: tab?.url || "",
		title: tab?.title || "",
	};
}

function unsupportedLocalFileToolkitPayload(methodName, tab, error = null) {
	const payload = unsupportedLocalFilePayload(tab, error);
	if (methodName === "getSelectionInfo") {
		return {
			...payload,
			hasSelection: false,
			text: "",
		};
	}
	if (methodName === "getViewportHeadings") {
		return {
			...payload,
			currentHeading: null,
			headings: [],
		};
	}
	if (methodName === "getScrollState") {
		return {
			...payload,
			scrollY: 0,
			maxScrollY: 0,
			progressY: 0,
		};
	}
	return payload;
}

function isOwnExtensionPdfViewerUrl(value) {
	if (!value) return false;
	try {
		const url = new URL(String(value));
		const extensionUrl = new URL(chrome.runtime.getURL("pdf-viewer.html"));
		return url.origin === extensionUrl.origin && url.pathname === extensionUrl.pathname;
	} catch {
		return false;
	}
}

function isOnhandPdfViewerLikeUrl(value) {
	if (isOwnExtensionPdfViewerUrl(value)) return true;
	try {
		const url = new URL(String(value || ""));
		return /\/onhand-pdf-viewer\.html$/i.test(url.pathname);
	} catch {
		return false;
	}
}

function isHttpLikeUrl(value) {
	try {
		const protocol = new URL(String(value)).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

function isLikelyPdfResourceUrl(value) {
	if (!isHttpLikeUrl(value)) return false;
	try {
		const url = new URL(String(value));
		const path = decodeURIComponent(url.pathname || "").toLowerCase();
		const search = decodeURIComponent(url.search || "").toLowerCase();
		return (
			path.endsWith(".pdf") ||
			path.includes(".pdf/") ||
			path.includes("/pdf/") ||
			path.endsWith("/pdf") ||
			search.includes(".pdf") ||
			search.includes("format=pdf") ||
			search.includes("contenttype=pdf") ||
			search.includes("content-type=application/pdf")
		);
	} catch {
		return false;
	}
}

function normalizePdfUrlCandidate(value, baseUrl = "") {
	const candidate = String(value || "").trim();
	if (!candidate) return "";
	try {
		const url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		return url.toString();
	} catch {
		return "";
	}
}

function extractPdfSourceUrlFromViewerLikeUrl(value) {
	const baseUrl = String(value || "");
	if (!baseUrl) return "";
	try {
		const url = new URL(baseUrl);
		const acceptAnyHttpCandidate = isOnhandPdfViewerLikeUrl(baseUrl);
		for (const key of ["url", "file", "pdf", "src"]) {
			const candidate = normalizePdfUrlCandidate(url.searchParams.get(key), baseUrl);
			if (candidate && (acceptAnyHttpCandidate || isLikelyPdfResourceUrl(candidate))) return candidate;
		}
	} catch {}
	return "";
}

function resolvePdfSourceUrlForViewer(args = {}, tab = null) {
	const explicitPdfUrl = normalizePdfUrlCandidate(args.pdfUrl);
	if (explicitPdfUrl) return explicitPdfUrl;

	const tabUrl = String(tab?.url || "");
	if (isGoogleDocsDocumentUrl(tabUrl)) {
		const googleDocsPdfUrl = buildGoogleDocsPdfExportUrl(tabUrl);
		if (googleDocsPdfUrl) return googleDocsPdfUrl;
	}
	const nestedPdfUrl = extractPdfSourceUrlFromViewerLikeUrl(tabUrl);
	if (nestedPdfUrl) return nestedPdfUrl;

	const directPdfUrl = normalizePdfUrlCandidate(tabUrl);
	if (directPdfUrl && isLikelyPdfResourceUrl(directPdfUrl)) return directPdfUrl;

	throw new Error(
		"Could not determine a PDF URL for the Onhand viewer. Open a direct PDF tab, a PDF reader URL with a file/url parameter, or pass pdfUrl explicitly.",
	);
}

function normalizePdfPageNumber(value) {
	const match = String(value ?? "").match(/\d+/);
	if (!match) return null;
	const pageNumber = Number.parseInt(match[0], 10);
	if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;
	return pageNumber;
}

function normalizePdfScrollRatio(value) {
	const ratio = Number(value);
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;
	return Math.max(0, Math.min(1, ratio));
}

function normalizePdfPageDetection(value, source = "") {
	const rawPageNumber = value && typeof value === "object" ? value.pageNumber ?? value.page ?? value.currentPageNumber : value;
	const pageNumber = normalizePdfPageNumber(rawPageNumber);
	if (!pageNumber) return null;
	return {
		...(value && typeof value === "object" ? value : {}),
		pageNumber,
		source: String((value && typeof value === "object" ? value.source : "") || source || "pdf-page"),
	};
}

function normalizeNonDefaultPdfPageDetection(value, source = "") {
	const detection = normalizePdfPageDetection(value, source);
	if (!detection || detection.pageNumber <= 1) return null;
	return detection;
}

function inferPdfPageNumberFromUrl(value) {
	if (!value) return null;
	try {
		const url = new URL(String(value));
		for (const key of ["page", "pageNumber", "initialPage", "p"]) {
			const pageNumber = normalizePdfPageNumber(url.searchParams.get(key));
			if (pageNumber) return pageNumber;
		}
		const hash = String(url.hash || "").replace(/^#/, "");
		if (!hash) return null;
		const hashParams = new URLSearchParams(hash.includes("=") ? hash : `page=${hash}`);
		for (const key of ["page", "pageNumber", "initialPage", "p"]) {
			const pageNumber = normalizePdfPageNumber(hashParams.get(key));
			if (pageNumber) return pageNumber;
		}
		return normalizePdfPageNumber(hash.match(/\bpage[=/:-](\d+)\b/i)?.[1]);
	} catch {
		return null;
	}
}

function inferPdfPageNumberFromVisiblePayload(payload) {
	if (!payload || typeof payload !== "object") return null;
	const pages = (Array.isArray(payload.pages) && payload.pages.length ? payload.pages : payload.blocks) || [];
	const pageCandidates = pages
		.map((page) => {
			const pageNumber = normalizePdfPageNumber(page?.pageNumber);
			if (!pageNumber) return null;
			const rect = page?.rect && typeof page.rect === "object" ? page.rect : {};
			const top = Number.isFinite(Number(page?.top)) ? Number(page.top) : Number(rect.top);
			const bottom = Number.isFinite(Number(page?.bottom)) ? Number(page.bottom) : Number(rect.bottom);
			return {
				pageNumber,
				top: Number.isFinite(top) ? top : null,
				bottom: Number.isFinite(bottom) ? bottom : null,
			};
		})
		.filter(Boolean);
	if (!pageCandidates.length) return null;

	const viewportHeight = Number(payload.viewport?.height || 0);
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return pageCandidates[0].pageNumber;
	const centerY = viewportHeight / 2;
	const scored = pageCandidates.map((page) => {
		if (!Number.isFinite(page.top) || !Number.isFinite(page.bottom)) {
			return { pageNumber: page.pageNumber, score: Number.MAX_SAFE_INTEGER };
		}
		if (page.top <= centerY && page.bottom >= centerY) return { pageNumber: page.pageNumber, score: 0 };
		return { pageNumber: page.pageNumber, score: Math.min(Math.abs(page.top - centerY), Math.abs(page.bottom - centerY)) };
	});
	scored.sort((a, b) => a.score - b.score);
	return scored[0]?.pageNumber || pageCandidates[0].pageNumber;
}

function buildOnhandPdfViewerUrl(pdfUrl, options = {}) {
	const viewerUrl = new URL(chrome.runtime.getURL("pdf-viewer.html"));
	viewerUrl.searchParams.set("url", pdfUrl);
	const pageNumber = normalizePdfPageNumber(options.pageNumber ?? options.page ?? options.initialPageNumber ?? options.initialPage);
	if (pageNumber) viewerUrl.searchParams.set("page", String(pageNumber));
	const scrollRatio = normalizePdfScrollRatio(options.scrollRatio ?? options.initialScrollRatio);
	if (!pageNumber && scrollRatio) viewerUrl.searchParams.set("scrollRatio", String(Number(scrollRatio.toFixed(6))));
	return viewerUrl.toString();
}

function inlinePdfViewerBridgeStorageKey(pdfUrl) {
	return `onhandInlinePdfViewerBridge:${encodeURIComponent(String(pdfUrl || ""))}`;
}

const ONHAND_PDF_VIEWER_PORT_NAME = "onhand-pdf-viewer";
const onhandPdfViewerPortRecords = new Map();

function onhandPdfViewerPortKey(tabId, pdfUrl) {
	return `${Number(tabId)}:${normalizePdfUrlCandidate(pdfUrl) || String(pdfUrl || "")}`;
}

function onhandPdfViewerSourcePortKey(pdfUrl) {
	return `source:${normalizePdfUrlCandidate(pdfUrl) || String(pdfUrl || "")}`;
}

function unregisterOnhandPdfViewerPort(port) {
	for (const [key, record] of onhandPdfViewerPortRecords.entries()) {
		if (record?.port === port) onhandPdfViewerPortRecords.delete(key);
	}
}

function registerOnhandPdfViewerPort(port, sourceUrl) {
	const tabId = port?.sender?.tab?.id;
	const normalizedSourceUrl = normalizePdfUrlCandidate(sourceUrl) || extractPdfSourceUrlFromViewerLikeUrl(port?.sender?.url);
	if (!normalizedSourceUrl) return null;
	const record = {
		key: typeof tabId === "number" ? onhandPdfViewerPortKey(tabId, normalizedSourceUrl) : onhandPdfViewerSourcePortKey(normalizedSourceUrl),
		tabId: typeof tabId === "number" ? tabId : null,
		sourceUrl: normalizedSourceUrl,
		port,
		registeredAt: Date.now(),
	};
	if (typeof tabId === "number") {
		onhandPdfViewerPortRecords.set(onhandPdfViewerPortKey(tabId, normalizedSourceUrl), record);
	}
	onhandPdfViewerPortRecords.set(onhandPdfViewerSourcePortKey(normalizedSourceUrl), record);
	return record;
}

function createBridgeToken() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function setInlinePdfViewerBridgeToken(pdfUrl, token) {
	if (!chrome.storage?.session) return token;
	await chrome.storage.session.set({
		[inlinePdfViewerBridgeStorageKey(pdfUrl)]: token,
	});
	return token;
}

async function getInlinePdfViewerBridgeToken(pdfUrl) {
	if (!chrome.storage?.session) return "";
	const key = inlinePdfViewerBridgeStorageKey(pdfUrl);
	const stored = await chrome.storage.session.get(key);
	return String(stored?.[key] || "");
}

async function ensureInlinePdfViewerBridgeToken(pdfUrl) {
	const existing = await getInlinePdfViewerBridgeToken(pdfUrl);
	if (existing) return existing;
	return await setInlinePdfViewerBridgeToken(pdfUrl, createBridgeToken());
}

async function installInlineOnhandPdfViewer(tabId, pdfUrl, options = {}) {
	const viewerUrl = buildOnhandPdfViewerUrl(pdfUrl, options);
	return await executeScriptInTab(
		tabId,
		(targetViewerUrl, targetPdfUrl) => {
			const rootId = "onhand-inline-pdf-viewer-root";
			const frameId = "onhand-inline-pdf-viewer-frame";
			if (!document.body) {
				document.documentElement.append(document.createElement("body"));
			}

			let root = document.getElementById(rootId);
			if (!root) {
				root = document.createElement("div");
				root.id = rootId;
				document.documentElement.append(root);
			}
			root.setAttribute("data-onhand-inline-pdf-viewer", "true");
			root.setAttribute("data-onhand-pdf-url", targetPdfUrl);
			Object.assign(root.style, {
				position: "fixed",
				inset: "0",
				zIndex: "2147483646",
				background: "#2f2f2f",
			});

			let frame = document.getElementById(frameId);
			if (!frame) {
				frame = document.createElement("iframe");
				frame.id = frameId;
				frame.title = "Onhand PDF Viewer";
				frame.setAttribute("data-onhand-inline-pdf-frame", "true");
				frame.setAttribute("allow", "clipboard-read; clipboard-write");
				Object.assign(frame.style, {
					border: "0",
					width: "100%",
					height: "100%",
					display: "block",
					background: "#2f2f2f",
				});
				root.append(frame);
			}
			if (frame.getAttribute("src") !== targetViewerUrl) {
				frame.setAttribute("src", targetViewerUrl);
			}
			document.documentElement.setAttribute("data-onhand-inline-pdf-viewer", "true");
			document.body.style.overflow = "hidden";
			return {
				ok: true,
				viewerUrl: targetViewerUrl,
				pdfUrl: targetPdfUrl,
				frameId,
			};
		},
		[viewerUrl, pdfUrl],
	);
}

function stripUrlHash(value) {
	try {
		const url = new URL(String(value || ""));
		url.hash = "";
		return url.toString();
	} catch {
		return String(value || "").split("#")[0];
	}
}

function shouldInferPdfPageNumberFromTab(tab, pdfUrl) {
	const tabUrl = String(tab?.url || "");
	if (!tabUrl) return false;
	const pdfUrlWithoutHash = stripUrlHash(pdfUrl);
	const nestedPdfUrl = extractPdfSourceUrlFromViewerLikeUrl(tabUrl);
	if (nestedPdfUrl && (!pdfUrlWithoutHash || stripUrlHash(nestedPdfUrl) === pdfUrlWithoutHash)) return true;
	const directPdfUrl = normalizePdfUrlCandidate(tabUrl);
	if (directPdfUrl && isLikelyPdfResourceUrl(directPdfUrl) && (!pdfUrlWithoutHash || stripUrlHash(directPdfUrl) === pdfUrlWithoutHash)) return true;
	return false;
}

async function inferPdfPageNumberFromTabDom(tabId) {
	const detectPageFromCurrentDocument = () => {
		const normalizePageNumber = (value) => {
			const match = String(value ?? "").match(/\d+/);
			if (!match) return null;
			const pageNumber = Number.parseInt(match[0], 10);
			return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
		};
		const normalizePageIndex = (value) => {
			const match = String(value ?? "").match(/\d+/);
			if (!match) return null;
			const pageIndex = Number.parseInt(match[0], 10);
			return Number.isFinite(pageIndex) && pageIndex >= 0 ? pageIndex : null;
		};
		const readElementPageNumber = (element) => {
			if (!(element instanceof Element)) return null;
			const candidates = [
				"value" in element ? element.value : "",
				element.getAttribute("aria-valuenow"),
				element.getAttribute("aria-valuetext"),
				element.getAttribute("value"),
				element.getAttribute("data-page-number"),
				element.getAttribute("data-page"),
				element.getAttribute("data-pn"),
				element.textContent,
			];
			for (const candidate of candidates) {
				const pageNumber = normalizePageNumber(candidate);
				if (pageNumber) return pageNumber;
			}
			return null;
		};
		const isOnhandPdfViewerElement = (element) =>
			Boolean(
				element instanceof Element &&
					element.closest?.(
						"#onhand-inline-pdf-viewer-root, #onhand-inline-pdf-viewer-frame, [data-onhand-inline-pdf-viewer], [data-onhand-inline-pdf-frame], [data-onhand-pdf-page], [data-onhand-pdf-text-layer]",
					),
			);
		const roots = [];
		const collectRoots = (root) => {
			if (!root || roots.includes(root) || roots.length > 120) return;
			roots.push(root);
			let elements = [];
			try {
				elements = Array.from(root.querySelectorAll("*")).slice(0, 6000);
			} catch {
				return;
			}
			for (const element of elements) {
				if (element.shadowRoot) collectRoots(element.shadowRoot);
			}
		};
		collectRoots(document);

		const controlSelectors = [
			'input[aria-label*="page" i]',
			'input[title*="page" i]',
			'input[name*="page" i]',
			'input[id*="page" i]',
			'[role="spinbutton"][aria-label*="page" i]',
			'[aria-valuenow][aria-label*="page" i]',
			'viewer-page-selector input',
			'#pageSelector input',
			'#page-selector input',
			'#pageNumber',
			'#page-number',
		];
		const controlCandidates = [];
		for (const root of roots) {
			for (const selector of controlSelectors) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll(selector));
				} catch {
					continue;
				}
				for (const element of matches) {
					if (isOnhandPdfViewerElement(element)) continue;
					const pageNumber = readElementPageNumber(element);
					if (pageNumber) controlCandidates.push({ pageNumber, source: "page-control" });
				}
			}
		}
		const preferredControl = controlCandidates.find((candidate) => candidate.pageNumber > 1) || controlCandidates[0];
		if (preferredControl) return preferredControl;

		const propertyCandidates = [];
		for (const root of roots) {
			for (const selector of ["pdf-viewer", "viewer-page-selector", "viewer-toolbar", "viewer-viewport"]) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll(selector)).slice(0, 1000);
				} catch {
					continue;
				}
				propertyCandidates.push(...matches);
			}
		}
		for (const candidate of propertyCandidates) {
			if (isOnhandPdfViewerElement(candidate)) continue;
			for (const path of [
				["page"],
				["pageNo"],
				["pageNo_"],
				["pageNumber"],
				["pageNumber_"],
				["currentPage"],
				["currentPage_"],
				["currentPageNumber"],
				["currentPageNumber_"],
				["index"],
				["index_"],
				["viewport", "page"],
				["viewport", "position", "page"],
				["viewport", "position_", "page"],
				["viewport", "pageNo"],
				["viewport_", "page"],
				["viewport_", "pageNo"],
				["viewport_", "position", "page"],
				["viewport_", "position_", "page"],
				["viewport_", "getMostVisiblePage"],
			]) {
				let value = candidate;
				for (const key of path) value = typeof value?.[key] === "function" ? value[key]() : value?.[key];
				const pageNumber = normalizePageNumber(value);
				if (pageNumber) return { pageNumber, source: "native-pdf-viewer-property" };
			}
		}

		const pageSelectors = [
			".page[data-page-number]",
			".gsr-page[data-pn]",
			"[data-onhand-pdf-page]",
			"[data-page-number]",
			"[data-page-index]",
			"[data-page]",
			'[role="region"][aria-label*="page" i]',
			'[aria-label^="Page "]',
			'[aria-label^="page "]',
		];
		const candidates = [];
		const seen = new Set();
		for (const root of roots) {
			for (const selector of pageSelectors) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll(selector));
				} catch {
					continue;
				}
				for (const element of matches) {
					if (!(element instanceof Element) || seen.has(element)) continue;
					if (isOnhandPdfViewerElement(element)) continue;
					seen.add(element);
					const rect = element.getBoundingClientRect();
					if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width <= 0 || rect.height <= 0) continue;
					const pageIndex = normalizePageIndex(element.getAttribute("data-page-index"));
					const pageNumber =
						readElementPageNumber(element) ||
						normalizePageNumber(element.getAttribute("aria-label")?.match(/\bpage\s+(\d+)\b/i)?.[1]) ||
						(pageIndex !== null ? pageIndex + 1 : null);
					if (!pageNumber) continue;
					const centerY = window.innerHeight / 2;
					const score = rect.top <= centerY && rect.bottom >= centerY ? 0 : Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY));
					candidates.push({ pageNumber, score });
				}
			}
		}
		if (!candidates.length) return null;
		candidates.sort((a, b) => a.score - b.score);
		return { pageNumber: candidates[0].pageNumber, source: "visible-page" };
	};

	try {
		const result = await executeScriptInTabMainWorld(tabId, detectPageFromCurrentDocument);
		if (result) return result;
	} catch {
	}
	try {
		const results = await executeScriptInAllFramesMainWorld(tabId, detectPageFromCurrentDocument);
		const candidates = results.map((entry) => entry?.result).filter(Boolean);
		return candidates.find((candidate) => normalizePdfPageNumber(candidate?.pageNumber) > 1) || candidates[0] || null;
	} catch {}
	return await executeScriptInTab(tabId, detectPageFromCurrentDocument);
}

async function inferPdfScrollRatioFromTabDom(tabId) {
	const detectScrollFromCurrentDocument = () => {
		const normalizeScrollRatio = (value) => {
			const ratio = Number(value);
			if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;
			return Math.max(0, Math.min(1, ratio));
		};
		const roots = [];
		const collectRoots = (root) => {
			if (!root || roots.includes(root) || roots.length > 120) return;
			roots.push(root);
			let elements = [];
			try {
				elements = Array.from(root.querySelectorAll("*")).slice(0, 6000);
			} catch {
				return;
			}
			for (const element of elements) {
				if (element.shadowRoot) collectRoots(element.shadowRoot);
			}
		};
		collectRoots(document);
		const candidates = [];
		const addCandidate = (element, source) => {
			if (!element) return;
			const scrollTop = Number(element.scrollTop || 0);
			const scrollHeight = Number(element.scrollHeight || 0);
			const clientHeight = Number(element.clientHeight || 0);
			const maxScrollTop = scrollHeight - clientHeight;
			const ratio = normalizeScrollRatio(maxScrollTop > 0 ? scrollTop / maxScrollTop : null);
			if (ratio) candidates.push({ scrollRatio: ratio, source, scrollTop, scrollHeight, clientHeight });
		};
		addCandidate(document.scrollingElement, "document-scrolling-element");
		addCandidate(document.documentElement, "document-element");
		addCandidate(document.body, "document-body");
		const windowMaxScroll = Math.max(
			0,
			Number(document.documentElement?.scrollHeight || document.body?.scrollHeight || 0) - Number(window.innerHeight || 0),
		);
		const windowRatio = normalizeScrollRatio(windowMaxScroll > 0 ? Number(window.scrollY || window.pageYOffset || 0) / windowMaxScroll : null);
		if (windowRatio) {
			candidates.push({
				scrollRatio: windowRatio,
				source: "window-scroll",
				scrollTop: Number(window.scrollY || window.pageYOffset || 0),
				scrollHeight: windowMaxScroll + Number(window.innerHeight || 0),
				clientHeight: Number(window.innerHeight || 0),
			});
		}
		for (const root of roots) {
			for (const selector of [
				"#viewerContainer",
				"#viewer",
				"#scroller",
				"viewer-viewport",
				"pdf-viewer",
				".pdfViewer",
				".viewer",
				"[role='document']",
			]) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll(selector)).slice(0, 1000);
				} catch {
					continue;
				}
				for (const element of matches) addCandidate(element, `scroll-container:${selector}`);
			}
		}
		candidates.sort((a, b) => Math.max(b.scrollHeight || 0, b.clientHeight || 0) - Math.max(a.scrollHeight || 0, a.clientHeight || 0));
		return candidates[0] || null;
	};

	for (const readScroll of [
		() => executeScriptInTabMainWorld(tabId, detectScrollFromCurrentDocument),
		async () => {
			const results = await executeScriptInAllFramesMainWorld(tabId, detectScrollFromCurrentDocument);
			return results.map((entry) => entry?.result).filter(Boolean)[0] || null;
		},
		() => executeScriptInTab(tabId, detectScrollFromCurrentDocument),
		async () => {
			const results = await executeScriptInAllFrames(tabId, detectScrollFromCurrentDocument);
			return results.map((entry) => entry?.result).filter(Boolean)[0] || null;
		},
	]) {
		try {
			const result = await readScroll();
			const scrollRatio = normalizePdfScrollRatio(result?.scrollRatio);
			if (scrollRatio) return { ...result, scrollRatio };
		} catch {}
	}
	return null;
}

function inferPdfPageNumberFromAccessibilityNodes(nodes, sourcePrefix = "accessibility") {
	const readAxValue = (value) => {
		if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
			return value.value;
		}
		return value;
	};
	const readAxProperty = (node, name) => {
		if (!node || !name) return undefined;
		if (Object.prototype.hasOwnProperty.call(node, name)) return readAxValue(node[name]);
		const property = node.properties?.find((candidate) => candidate?.name === name);
		return readAxValue(property?.value);
	};
	const readAxProperties = (node, names) => {
		for (const name of names) {
			const value = readAxProperty(node, name);
			if (value !== undefined && value !== null && String(value).trim()) return value;
		}
		return undefined;
	};
	const isSelected = (node) =>
		Boolean(
			node?.selected === true ||
				node?.properties?.some((property) => property?.name === "selected" && readAxValue(property?.value) === true),
		);
	const pageControlCandidates = [];
	const thumbnailCandidates = [];
	const nodeSummaries = [];
	for (const node of nodes) {
		const name = String(readAxProperties(node, ["name"]) || "");
		const description = String(readAxProperties(node, ["description"]) || "");
		const role = String(readAxProperties(node, ["role"]) || "");
		const value = readAxProperties(node, ["value", "valuetext", "valuenow"]);
		const label = `${name} ${description}`.trim();
		nodeSummaries.push({ name, description, role, value, label });
		const roleLooksLikePageControl = /text|spin|input/i.test(role);
		if (!/page\s+number/i.test(label) && !(/page/i.test(label) && roleLooksLikePageControl) && !(/spin/i.test(role) && value != null)) continue;
		const pageNumber = normalizePdfPageNumber(value);
		if (pageNumber) pageControlCandidates.push({ pageNumber, source: `${sourcePrefix}-page-control` });
	}
	for (const node of nodes) {
		const name = String(readAxProperties(node, ["name"]) || "");
		const description = String(readAxProperties(node, ["description"]) || "");
		const role = String(readAxProperties(node, ["role"]) || "");
		if (!isSelected(node)) continue;
		const label = `${name} ${description}`.trim();
		if (!/thumbnail\s+for\s+page/i.test(label) && !/tab/i.test(role)) continue;
		const pageNumber = normalizePdfPageNumber(label);
		if (pageNumber) thumbnailCandidates.push({ pageNumber, source: `${sourcePrefix}-selected-thumbnail` });
	}
	const preferredThumbnail = thumbnailCandidates.find((candidate) => candidate.pageNumber > 1) || thumbnailCandidates[0];
	if (preferredThumbnail) return preferredThumbnail;
	const preferredControl = pageControlCandidates.find((candidate) => candidate.pageNumber > 1) || pageControlCandidates[0];
	if (preferredControl) return preferredControl;
	for (let index = 0; index < nodeSummaries.length; index += 1) {
		const summary = nodeSummaries[index];
		if (!/page\s+number/i.test(`${summary.label} ${summary.role}`)) continue;
		for (const candidate of [summary, ...nodeSummaries.slice(index + 1, index + 6)]) {
			const candidateText = String(candidate?.value ?? candidate?.label ?? "");
			if (/^\s*\/\s*\d+\s*$/.test(candidateText)) continue;
			const pageNumber = normalizePdfPageNumber(candidateText);
			if (pageNumber) {
				return { pageNumber, source: `${sourcePrefix}-nearby-page-control` };
			}
		}
	}
	return null;
}

function collectDebuggerFrameEntries(frameTreeResponse) {
	const entries = [];
	const visit = (frameTree) => {
		const frame = frameTree?.frame;
		if (frame?.id) entries.push({ frameId: frame.id, url: String(frame.url || "") });
		for (const childFrame of frameTree?.childFrames || []) visit(childFrame);
	};
	visit(frameTreeResponse?.frameTree);
	return entries;
}

function frameOrContextLooksLikeNativeChromePdfViewer(frame, context) {
	const values = [
		frame?.url,
		frame?.urlFragment,
		context?.origin,
		context?.name,
		context?.auxData?.name,
	]
		.filter(Boolean)
		.map(String);
	return values.some((value) => value.startsWith(NATIVE_CHROME_PDF_VIEWER_PREFIX));
}

function nativeChromePdfTargetId(targetInfo) {
	return String(targetInfo?.id || targetInfo?.targetId || "");
}

function debuggerTargetLooksLikeNativeChromePdfViewer(targetInfo) {
	return (
		String(targetInfo?.url || "").startsWith(NATIVE_CHROME_PDF_VIEWER_PREFIX) ||
		String(targetInfo?.extensionId || "") === NATIVE_CHROME_PDF_VIEWER_EXTENSION_ID
	);
}

async function getNativeChromePdfViewerDebuggerTargets(tab = null) {
	if (!chrome.debugger?.getTargets) return [];
	const targets = await chrome.debugger.getTargets();
	const tabId = typeof tab?.id === "number" ? tab.id : null;
	const tabTitle = String(tab?.title || "");
	const candidates = (Array.isArray(targets) ? targets : [])
		.filter((targetInfo) => nativeChromePdfTargetId(targetInfo) && debuggerTargetLooksLikeNativeChromePdfViewer(targetInfo))
		.map((targetInfo) => {
			const targetTabId = typeof targetInfo.tabId === "number" ? targetInfo.tabId : null;
			let score = 10;
			if (tabId !== null && targetTabId === tabId) score = 0;
			else if (tabTitle && String(targetInfo.title || "").includes(tabTitle)) score = 1;
			else if (targetTabId === null) score = 4;
			return { targetInfo, score };
		})
		.filter(({ score }) => score < 10)
		.sort((a, b) => a.score - b.score);
	return candidates.map(({ targetInfo }) => targetInfo);
}

function getNativeChromePdfViewerPageExpression() {
	return `(() => {
		const normalizePageNumber = (value) => {
			const match = String(value ?? "").match(/\\d+/);
			if (!match) return null;
			const pageNumber = Number.parseInt(match[0], 10);
			return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
		};
			const readElementPageNumber = (element) => {
				if (!(element instanceof Element)) return null;
				const candidates = [
					"value" in element ? element.value : "",
					element.getAttribute("aria-valuenow"),
					element.getAttribute("aria-valuetext"),
					element.getAttribute("value"),
					element.getAttribute("data-page-number"),
					element.getAttribute("data-page"),
					element.getAttribute("title"),
					element.getAttribute("aria-label"),
				element.textContent,
			];
			for (const candidate of candidates) {
				const pageNumber = normalizePageNumber(candidate);
				if (pageNumber) return pageNumber;
			}
			return null;
		};
		const roots = [];
		const collectRoots = (root) => {
			if (!root || roots.includes(root) || roots.length > 120) return;
			roots.push(root);
			let elements = [];
			try {
				elements = Array.from(root.querySelectorAll("*")).slice(0, 6000);
			} catch {
				return;
			}
			for (const element of elements) {
				if (element.shadowRoot) collectRoots(element.shadowRoot);
			}
		};
		collectRoots(document);

		const controlSelectors = [
			'input[aria-label*="page" i]',
			'input[title*="page" i]',
			'input[name*="page" i]',
			'input[id*="page" i]',
			'[role="spinbutton"][aria-label*="page" i]',
			'[aria-valuenow][aria-label*="page" i]',
			'viewer-page-selector input',
			'#pageSelector input',
			'#page-selector input',
				'#pageNumber',
				'#page-number',
			];
			const pageControlCandidates = [];
			for (const root of roots) {
				for (const selector of controlSelectors) {
					let matches = [];
					try {
						matches = Array.from(root.querySelectorAll(selector));
					} catch {
						continue;
					}
					for (const element of matches) {
						const pageNumber = readElementPageNumber(element);
						if (pageNumber) pageControlCandidates.push({ pageNumber, source: "native-pdf-viewer-page-control" });
					}
				}
			}
			const preferredPageControl = pageControlCandidates.find((candidate) => candidate.pageNumber > 1) || pageControlCandidates[0];
			if (preferredPageControl) return preferredPageControl;

			const pageFieldCandidates = [];
			for (const root of roots) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll("input, [role='spinbutton'], [aria-valuenow]")).slice(0, 6000);
				} catch {
					continue;
				}
				for (const element of matches) {
					const label = [
						element.getAttribute("aria-label"),
						element.getAttribute("aria-valuetext"),
						element.getAttribute("title"),
						element.getAttribute("name"),
						element.id,
						element.className,
					]
						.filter(Boolean)
						.join(" ");
					if (!/page/i.test(label)) continue;
					const pageNumber = readElementPageNumber(element);
					if (pageNumber) pageFieldCandidates.push({ pageNumber, source: "native-pdf-viewer-page-field" });
				}
			}
			const preferredPageField = pageFieldCandidates.find((candidate) => candidate.pageNumber > 1) || pageFieldCandidates[0];
			if (preferredPageField) return preferredPageField;

			const thumbnailCandidates = [];
			for (const root of roots) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll('[aria-selected="true"], [selected], .selected, [role="tab"][aria-selected="true"]')).slice(0, 1000);
				} catch {
					continue;
				}
				for (const element of matches) {
					const label = [
						element.getAttribute("aria-label"),
						element.getAttribute("aria-valuetext"),
						element.getAttribute("title"),
						element.textContent,
					]
					.filter(Boolean)
						.join(" ");
					if (!/(thumbnail\\s+for\\s+page|\\bpage\\s+\\d+\\b)/i.test(label)) continue;
					const pageNumber = normalizePageNumber(label);
					if (pageNumber) thumbnailCandidates.push({ pageNumber, source: "native-pdf-viewer-selected-thumbnail" });
				}
			}
			const preferredThumbnail = thumbnailCandidates.find((candidate) => candidate.pageNumber > 1) || thumbnailCandidates[0];
			if (preferredThumbnail) return preferredThumbnail;

		const propertyCandidates = [];
		for (const root of roots) {
			for (const selector of ["pdf-viewer", "viewer-page-selector", "viewer-toolbar"]) {
				let matches = [];
				try {
					matches = Array.from(root.querySelectorAll(selector));
				} catch {
					continue;
				}
				propertyCandidates.push(...matches);
			}
		}
		for (const candidate of propertyCandidates) {
			for (const path of [
				["page"],
				["pageNo"],
				["pageNo_"],
				["pageNumber"],
				["pageNumber_"],
				["currentPage"],
				["currentPage_"],
				["currentPageNumber"],
				["currentPageNumber_"],
				["index"],
				["index_"],
				["viewport", "page"],
				["viewport", "position", "page"],
				["viewport", "position_", "page"],
				["viewport", "pageNo"],
				["viewport_", "page"],
				["viewport_", "pageNo"],
				["viewport_", "position", "page"],
				["viewport_", "position_", "page"],
				["viewport_", "getMostVisiblePage"],
			]) {
				let value = candidate;
				for (const key of path) value = typeof value?.[key] === "function" ? value[key]() : value?.[key];
				const pageNumber = normalizePageNumber(value);
				if (pageNumber) return { pageNumber, source: "native-pdf-viewer-property" };
			}
		}

		return null;
	})()`;
}

async function inferPdfPageNumberFromNativeChromePdfViewerFrame(tabId) {
	return await evaluateInMatchingFrame(
		tabId,
		frameOrContextLooksLikeNativeChromePdfViewer,
		getNativeChromePdfViewerPageExpression(),
		"No Chrome PDF viewer frame context found",
	);
}

async function inferPdfPageNumberFromNativeChromePdfViewerTarget(tab) {
	const targets = await getNativeChromePdfViewerDebuggerTargets(tab);
	let lastError = null;
	for (const targetInfo of targets) {
		const targetId = nativeChromePdfTargetId(targetInfo);
		if (!targetId) continue;
		try {
			const detection = await withDebuggerTarget({ targetId }, async ({ send }) => {
				try {
					await send("Runtime.enable");
					const expressionResult = await evaluateDebuggerExpression(
						send,
						getNativeChromePdfViewerPageExpression(),
						undefined,
						"Could not infer PDF page from Chrome PDF viewer target",
					);
					const expressionDetection = normalizePdfPageDetection(expressionResult, "native-pdf-target-expression");
					if (expressionDetection) {
						return {
							...expressionDetection,
							source: `native-pdf-target:${expressionDetection.source}`,
						};
					}
				} catch (error) {
					lastError = error;
				}
				try {
					await send("Accessibility.enable");
					const tree = await send("Accessibility.getFullAXTree");
					const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
					const accessibilityDetection = normalizePdfPageDetection(
						inferPdfPageNumberFromAccessibilityNodes(nodes, "native-pdf-target-accessibility"),
						"native-pdf-target-accessibility",
					);
					if (accessibilityDetection) {
						return {
							...accessibilityDetection,
							source: `native-pdf-target:${accessibilityDetection.source}`,
						};
					}
				} catch (error) {
					lastError = error;
				}
				return null;
			});
			if (detection) return detection;
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError) throw lastError;
	return null;
}

async function inferPdfPageNumberFromRelatedDebuggerTargets(tabId) {
	return await withDebugger(tabId, async ({ target, send }) => {
		const sessions = [];
		const seenSessionIds = new Set();
		const sendToSession = async (sessionId, method, params = {}) => {
			return await chrome.debugger.sendCommand({ ...target, sessionId }, method, params);
		};
		const addSession = (sessionId, targetInfo = {}, source = "target") => {
			if (!sessionId || seenSessionIds.has(sessionId)) return;
			seenSessionIds.add(sessionId);
			sessions.push({ sessionId, targetInfo, source });
		};
		const onEvent = (source, method, params) => {
			if (source.tabId !== target.tabId || method !== "Target.attachedToTarget") return;
			const sessionId = params?.sessionId;
			addSession(sessionId, params?.targetInfo, "attached-target");
			if (!sessionId) return;
			const sessionTarget = { ...source, sessionId };
			chrome.debugger.sendCommand(sessionTarget, "Runtime.enable").catch(() => {});
			chrome.debugger.sendCommand(sessionTarget, "Accessibility.enable").catch(() => {});
			chrome.debugger
				.sendCommand(sessionTarget, "Target.setAutoAttach", {
					autoAttach: true,
					waitForDebuggerOnStart: false,
					flatten: true,
				})
				.catch(() => {});
		};
		chrome.debugger.onEvent.addListener(onEvent);
		try {
			await send("Target.setAutoAttach", {
				autoAttach: true,
				waitForDebuggerOnStart: false,
				flatten: true,
			});
			await delay(350);
			let lastError = null;
			const rankedSessions = sessions
				.map((session) => {
					const url = String(session.targetInfo?.url || "");
					const type = String(session.targetInfo?.type || "");
					const title = String(session.targetInfo?.title || "");
					let score = 5;
					if (url.startsWith(NATIVE_CHROME_PDF_VIEWER_PREFIX)) score = 0;
					else if (/pdf/i.test(`${type} ${title} ${url}`)) score = 1;
					else if (/iframe|other/i.test(type)) score = 2;
					return { ...session, score };
				})
				.sort((a, b) => a.score - b.score);
			for (const session of rankedSessions) {
				try {
					const expressionResult = await evaluateDebuggerExpression(
						(method, params = {}) => sendToSession(session.sessionId, method, params),
						getNativeChromePdfViewerPageExpression(),
						undefined,
						"Could not infer PDF page from related PDF viewer target",
					);
					const expressionDetection = normalizeNonDefaultPdfPageDetection(
						expressionResult,
						`related-target:${session.targetInfo?.type || "target"}:expression`,
					);
					if (expressionDetection) return expressionDetection;
				} catch (error) {
					lastError = error;
				}
				try {
					await sendToSession(session.sessionId, "Accessibility.enable");
					const tree = await sendToSession(session.sessionId, "Accessibility.getFullAXTree");
					const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
					const accessibilityDetection = normalizeNonDefaultPdfPageDetection(
						inferPdfPageNumberFromAccessibilityNodes(
							nodes,
							`related-target:${session.targetInfo?.type || "target"}:accessibility`,
						),
					);
					if (accessibilityDetection) return accessibilityDetection;
				} catch (error) {
					lastError = error;
				}
			}
			if (lastError) throw lastError;
			return null;
		} finally {
			chrome.debugger.onEvent.removeListener(onEvent);
			try {
				await send("Target.setAutoAttach", {
					autoAttach: false,
					waitForDebuggerOnStart: false,
					flatten: true,
				});
			} catch {}
		}
	});
}

async function inferPdfPageNumberFromDebuggerDefaultContext(tabId) {
	return await withDebugger(tabId, async ({ send }) => {
		await send("Page.enable");
		await send("Runtime.enable");
		const response = await send("Runtime.evaluate", {
			expression: getNativeChromePdfViewerPageExpression(),
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) {
			throw new Error(
				response.exceptionDetails.exception?.description ||
					response.exceptionDetails.text ||
					"Could not infer PDF page from debugger default context",
			);
		}
		return normalizeRemoteObject(response.result);
	});
}

function getDebuggerDomNodeAttributes(node) {
	const attrs = {};
	const attributes = Array.isArray(node?.attributes) ? node.attributes : [];
	for (let index = 0; index < attributes.length; index += 2) {
		attrs[String(attributes[index] || "").toLowerCase()] = String(attributes[index + 1] ?? "");
	}
	return attrs;
}

async function readDebuggerDomNodeDetails(send, node) {
	const attrs = getDebuggerDomNodeAttributes(node);
	const staticDetails = {
		nodeName: String(node?.nodeName || node?.localName || ""),
		nodeValue: String(node?.nodeValue || ""),
		...attrs,
	};
	try {
		const resolved = await send("DOM.resolveNode", { nodeId: node.nodeId });
		const objectId = resolved?.object?.objectId;
		if (!objectId) return staticDetails;
		try {
			const response = await send("Runtime.callFunctionOn", {
				objectId,
				functionDeclaration: `function() {
					return {
						value: "value" in this ? this.value : "",
						textContent: this.textContent || "",
						ariaValueNow: this.getAttribute?.("aria-valuenow") || "",
						ariaValueText: this.getAttribute?.("aria-valuetext") || "",
						ariaLabel: this.getAttribute?.("aria-label") || "",
						ariaSelected: this.getAttribute?.("aria-selected") || "",
						title: this.getAttribute?.("title") || "",
						name: this.getAttribute?.("name") || "",
						id: this.id || "",
						className: typeof this.className === "string" ? this.className : "",
						role: this.getAttribute?.("role") || "",
						selected: Boolean(this.selected),
					};
				}`,
				returnByValue: true,
			});
			return {
				...staticDetails,
				...(normalizeRemoteObject(response?.result) || {}),
			};
		} finally {
			try {
				await send("Runtime.releaseObject", { objectId });
			} catch {}
		}
	} catch {
		return staticDetails;
	}
}

function inferPdfPageNumberFromDebuggerDomDetails(details) {
	const values = [
		details?.value,
		details?.ariaValueNow,
		details?.ariaValueText,
		details?.["aria-valuenow"],
		details?.["aria-valuetext"],
		details?.value,
		details?.textContent,
		details?.nodeValue,
	];
	for (const value of values) {
		const pageNumber = normalizePdfPageNumber(value);
		if (pageNumber) return pageNumber;
	}
	return null;
}

async function inferPdfScrollRatioFromDebuggerLayout(tabId) {
	return await withDebugger(tabId, async ({ send }) => {
		await send("Page.enable");
		const metrics = await send("Page.getLayoutMetrics");
		const visualViewport = metrics?.cssVisualViewport || metrics?.visualViewport || {};
		const layoutViewport = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
		const contentSize = metrics?.cssContentSize || metrics?.contentSize || {};
		const pageY = Number(visualViewport.pageY ?? layoutViewport.pageY ?? 0);
		const viewportHeight = Number(visualViewport.clientHeight ?? layoutViewport.clientHeight ?? 0);
		const contentHeight = Number(contentSize.height ?? 0);
		const maxScrollY = contentHeight - viewportHeight;
		if (!Number.isFinite(pageY) || !Number.isFinite(maxScrollY) || maxScrollY <= 0) return null;
		const scrollRatio = normalizePdfScrollRatio(pageY / maxScrollY);
		if (!scrollRatio) return null;
		return {
			scrollRatio,
			pageY,
			viewportHeight,
			contentHeight,
			source: "debugger-layout-scroll",
		};
	});
}

function debuggerDomNodeLooksLikeOnhandPdfViewer(descriptor = "", details = {}) {
	const haystack = [
		descriptor,
		details?.ariaLabel,
		details?.["aria-label"],
		details?.title,
		details?.name,
		details?.id,
		details?.role,
		details?.className,
		details?.class,
		details?.["data-onhand-inline-pdf-viewer"],
		details?.["data-onhand-inline-pdf-frame"],
		details?.["data-onhand-pdf-page"],
		details?.["data-onhand-pdf-text-layer"],
	]
		.filter(Boolean)
		.join(" ");
	return /\bonhand-(?:inline-)?pdf\b/i.test(haystack) || /\bdata-onhand-pdf\b/i.test(haystack);
}

async function inferPdfPageNumberFromDebuggerDom(tabId) {
	return await withDebugger(tabId, async ({ send }) => {
		await send("Page.enable");
		await send("Runtime.enable");
		await send("DOM.enable");
		const response = await send("DOM.getFlattenedDocument", {
			depth: -1,
			pierce: true,
		});
		const nodes = Array.isArray(response?.nodes) ? response.nodes : [];
		const pageControlCandidates = [];
		for (const node of nodes) {
			if (!node?.nodeId) continue;
			const attrs = getDebuggerDomNodeAttributes(node);
			const descriptor = [
				node.nodeName,
				node.localName,
				attrs["aria-label"],
				attrs.title,
				attrs.name,
				attrs.id,
				attrs.role,
				attrs.class,
			]
				.filter(Boolean)
				.join(" ");
			const looksLikePageControl =
				/\b(input|viewer-page-selector|viewer-toolbar|viewer-pdf-toolbar)\b/i.test(String(node.nodeName || node.localName || "")) ||
				/page/i.test(descriptor) ||
				/spinbutton/i.test(descriptor);
			if (!looksLikePageControl) continue;
			const details = await readDebuggerDomNodeDetails(send, node);
			if (debuggerDomNodeLooksLikeOnhandPdfViewer(descriptor, details)) continue;
			const detailsDescriptor = [
				details.ariaLabel,
				details["aria-label"],
				details.title,
				details.name,
				details.id,
				details.role,
				details.className,
				details.class,
			]
				.filter(Boolean)
				.join(" ");
			if (!/page|spinbutton|viewer-page-selector/i.test(`${descriptor} ${detailsDescriptor}`)) continue;
			const pageNumber = inferPdfPageNumberFromDebuggerDomDetails(details);
			if (pageNumber) pageControlCandidates.push({ pageNumber, source: "debugger-dom-page-control" });
		}
		const preferredPageControl = pageControlCandidates.find((candidate) => candidate.pageNumber > 1) || pageControlCandidates[0];
		if (preferredPageControl) return preferredPageControl;

		const thumbnailCandidates = [];
		for (const node of nodes) {
			if (!node?.nodeId) continue;
			const attrs = getDebuggerDomNodeAttributes(node);
			const selected =
				/true/i.test(attrs["aria-selected"] || "") ||
				Object.prototype.hasOwnProperty.call(attrs, "selected") ||
				/\bselected\b/i.test(attrs.class || "");
			if (!selected) continue;
			const details = await readDebuggerDomNodeDetails(send, node);
			if (debuggerDomNodeLooksLikeOnhandPdfViewer("", details)) continue;
			const label = [
				details.ariaLabel,
				details["aria-label"],
				details.title,
				details.textContent,
				details.nodeValue,
			]
				.filter(Boolean)
				.join(" ");
			if (!/(thumbnail\s+for\s+page|page\s+\d+)/i.test(label)) continue;
			const pageNumber = normalizePdfPageNumber(label);
			if (pageNumber) thumbnailCandidates.push({ pageNumber, source: "debugger-dom-selected-thumbnail" });
		}
		const preferredThumbnail = thumbnailCandidates.find((candidate) => candidate.pageNumber > 1) || thumbnailCandidates[0];
		if (preferredThumbnail) return preferredThumbnail;
		return null;
	});
}

async function inferPdfPageNumberFromAccessibilityTree(tabId) {
	return await withDebugger(tabId, async ({ send }) => {
		try {
			await send("Accessibility.enable");
		} catch {}
		const readTree = async (params = {}, sourcePrefix = "accessibility") => {
			const tree = await send("Accessibility.getFullAXTree", params);
			const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
			return inferPdfPageNumberFromAccessibilityNodes(nodes, sourcePrefix);
		};

		let frameEntries = [];
		try {
			await send("Page.enable");
			frameEntries = collectDebuggerFrameEntries(await send("Page.getFrameTree"));
		} catch {}

		const ownExtensionRoot = chrome.runtime.getURL("");
		const readableFrameEntries = frameEntries
			.filter((entry) => entry.frameId && !entry.url.startsWith(ownExtensionRoot))
			.sort((a, b) => {
				const aIsNativePdfViewer = a.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/");
				const bIsNativePdfViewer = b.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/");
				return Number(bIsNativePdfViewer) - Number(aIsNativePdfViewer);
			});
		for (const entry of readableFrameEntries) {
			try {
				const result = await readTree({ frameId: entry.frameId }, "accessibility-frame");
				if (result) return result;
			} catch {}
		}

		return await readTree();
	});
}

async function inferPdfPageNumberFromOpenOnhandPdfViewer(tabId) {
	const statusCommand = { command: "status" };
	for (const readStatus of [
		() => callOnhandPdfViewerFrameViaRuntimePort(tabId, statusCommand, "No Onhand PDF viewer runtime port found"),
		() => callOnhandPdfViewerFrameViaBridge(tabId, statusCommand, "No Onhand PDF viewer frame context found"),
	]) {
		try {
			const status = await readStatus();
			const pageNumber = normalizePdfPageNumber(status?.pageNumber ?? status?.currentPageNumber ?? status?.page);
			if (pageNumber) return { pageNumber, source: "onhand-pdf-viewer-status" };
		} catch {}
	}
	return null;
}

async function inferInitialPdfViewerPageLocation(args = {}, tab = null, pdfUrl = "") {
	const explicitPageNumber = normalizePdfPageNumber(args.pageNumber ?? args.page ?? args.initialPageNumber ?? args.initialPage);
	if (explicitPageNumber) return { pageNumber: explicitPageNumber, source: "explicit" };
	for (const candidateUrl of [pdfUrl, args.pdfUrl]) {
		const pageNumber = inferPdfPageNumberFromUrl(candidateUrl);
		if (pageNumber) return { pageNumber, source: "url" };
	}
	if (!tab?.id || !shouldInferPdfPageNumberFromTab(tab, pdfUrl)) return null;

	const tabUrlPageNumber = inferPdfPageNumberFromUrl(tab.url);
	if (tabUrlPageNumber) return { pageNumber: tabUrlPageNumber, source: "tab-url" };
	try {
		const result = await inferPdfPageNumberFromOpenOnhandPdfViewer(tab.id);
		const detection = normalizePdfPageDetection(result, "onhand-pdf-viewer-status");
		if (detection) return detection;
	} catch {}

	const fallbackReaders = [
		() => inferPdfPageNumberFromRelatedDebuggerTargets(tab.id),
		() => inferPdfPageNumberFromNativeChromePdfViewerTarget(tab),
		() => inferPdfPageNumberFromNativeChromePdfViewerFrame(tab.id),
		() => inferPdfPageNumberFromDebuggerDefaultContext(tab.id),
		() => inferPdfPageNumberFromDebuggerDom(tab.id),
		() => inferPdfPageNumberFromAccessibilityTree(tab.id),
		() => inferPdfPageNumberFromTabDom(tab.id),
	];

	for (const readFallback of fallbackReaders) {
		try {
			const detection = normalizeNonDefaultPdfPageDetection(await readFallback());
			if (detection) return detection;
		} catch {}
	}

	try {
		const visible = await runPageToolkitMethod(tab.id, "getVisibleText", {
			maxPages: 4,
			maxBlocks: 8,
			maxChars: 2000,
		});
		const pageNumber = inferPdfPageNumberFromVisiblePayload(visible);
		if (pageNumber && pageNumber > 1) return { pageNumber, source: "visible-payload" };
	} catch {}

	return null;
}

async function inferInitialPdfViewerPageNumber(args = {}, tab = null, pdfUrl = "") {
	const location = await inferInitialPdfViewerPageLocation(args, tab, pdfUrl);
	return location?.pageNumber || null;
}

async function assertDebuggerEligibleTab(tabId) {
	const tab = await chrome.tabs.get(tabId);
	if (!canRunPageToolkitOnTab(tab)) {
		throw new Error(`Onhand cannot attach the browser debugger to this non-web tab: ${describeTabForError(tab)}`);
	}
	return tab;
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
		await assertDebuggerEligibleTab(tabId);
		const target = { tabId };
		await attachDebuggerWithRetry(target);
		try {
			return await fn({
				target,
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

async function withDebuggerTarget(target, fn) {
	const targetKey = `target:${target?.targetId || target?.tabId || ""}`;
	if (!target?.targetId && typeof target?.tabId !== "number") {
		throw new Error("Missing debugger target");
	}
	const previousTask = debuggerTaskChains.get(targetKey) || Promise.resolve();
	const scheduledTask = previousTask.catch(() => {}).then(async () => {
		await attachDebuggerWithRetry(target);
		try {
			return await fn({
				target,
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
		if (debuggerTaskChains.get(targetKey) === trackedTask) {
			debuggerTaskChains.delete(targetKey);
		}
	});

	debuggerTaskChains.set(targetKey, trackedTask);
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

async function executeScriptInTabMainWorld(tabId, func, args = []) {
	const results = await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func,
		args,
	});
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error("No main-world script result returned");
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

const createPageToolkit = (options = {}) => {
	const toolkitOptions = options && typeof options === "object" ? options : {};
	const fontUrls = toolkitOptions.fontUrls && typeof toolkitOptions.fontUrls === "object" ? toolkitOptions.fontUrls : {};
	const katexUrl = typeof toolkitOptions.katexUrl === "string" ? toolkitOptions.katexUrl : "";
	const normalizeAnnotationTheme = (value) => {
		const theme = String(value || "system").toLowerCase();
		return theme === "light" || theme === "dark" ? theme : "system";
	};
	const annotationTheme = normalizeAnnotationTheme(toolkitOptions.theme);
	const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
	const lowerText = (value) => normalizeText(value).toLowerCase();
	const escapeHtml = (value) =>
		String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	const cssEscape = (value) => {
		if (window.CSS?.escape) return window.CSS.escape(String(value));
		return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
	};
	const attrEscape = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const cssUrl = (value) => {
		const url = String(value || "").trim();
		if (!url) return "";
		return `url("${url.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
	};
	const annotationFontFaces = () => {
		const newYorkRegular = cssUrl(fontUrls.newYorkRegular);
		const newYorkItalic = cssUrl(fontUrls.newYorkItalic);
		const ioskeleyRegular = cssUrl(fontUrls.ioskeleyRegular);
		const ioskeleyBold = cssUrl(fontUrls.ioskeleyBold);
		const ioskeleyItalic = cssUrl(fontUrls.ioskeleyItalic);
		if (!newYorkRegular || !newYorkItalic || !ioskeleyRegular || !ioskeleyBold || !ioskeleyItalic) return "";
		return `
			@font-face {
			  font-family: "New York";
			  font-style: normal;
			  font-weight: 400 1000;
			  font-display: swap;
			  src: ${newYorkRegular} format("woff2");
			}
			@font-face {
			  font-family: "New York";
			  font-style: italic;
			  font-weight: 400 1000;
			  font-display: swap;
			  src: ${newYorkItalic} format("woff2");
			}
			@font-face {
			  font-family: "Ioskeley Mono";
			  font-style: normal;
			  font-weight: 400;
			  font-display: swap;
			  src: ${ioskeleyRegular} format("woff2");
			}
			@font-face {
			  font-family: "Ioskeley Mono";
			  font-style: normal;
			  font-weight: 700;
			  font-display: swap;
			  src: ${ioskeleyBold} format("woff2");
			}
			@font-face {
			  font-family: "Ioskeley Mono";
			  font-style: italic;
			  font-weight: 400;
			  font-display: swap;
			  src: ${ioskeleyItalic} format("woff2");
			}
		`;
	};
	const NOTE_TOKEN_PREFIX = "@@ONHAND_NOTE_TOKEN_";
	let noteKatexModule = null;
	let noteKatexLoadPromise = null;

	const createNoteTokenStore = () => {
		const tokens = [];
		return {
			replace(html) {
				const token = `${NOTE_TOKEN_PREFIX}${tokens.length}@@`;
				tokens.push(html);
				return token;
			},
			restore(text) {
				let restored = String(text || "");
				for (let index = 0; index < tokens.length; index += 1) {
					restored = restored.split(`${NOTE_TOKEN_PREFIX}${index}@@`).join(tokens[index]);
				}
				return restored;
			},
		};
	};

	const noteMayContainMath = (value) => /\\\(|\\\[|\$\$|\$(?!\$)/.test(String(value || ""));

	const renderNoteMathExpression = (source, displayMode = false) => {
		const expression = String(source || "").trim();
		if (!expression) return "";
		const tag = displayMode ? "div" : "span";
		const className = displayMode ? "onhand-note-math-block" : "onhand-note-math-inline";
		try {
			if (noteKatexModule?.renderToString) {
				const rendered = noteKatexModule.renderToString(expression, {
					displayMode,
					throwOnError: false,
					output: "mathml",
					strict: "ignore",
				});
				return `<${tag} class="${className}">${rendered}</${tag}>`;
			}
		} catch {}
		return `<${tag} class="${className} onhand-note-math-fallback">${escapeHtml(expression)}</${tag}>`;
	};

	const renderNoteRichText = (text) => {
		const store = createNoteTokenStore();
		let working = String(text || "").replace(/\r\n?/g, "\n");
		working = working.replace(/`([^`]+)`/g, (_match, code) =>
			store.replace(`<code data-onhand-note-part="code">${escapeHtml(code)}</code>`),
		);
		working = working.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => store.replace(renderNoteMathExpression(math, true)));
		working = working.replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => store.replace(renderNoteMathExpression(math, true)));
		working = working.replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => store.replace(renderNoteMathExpression(math, false)));
		working = working.replace(/\$(?!\$)([^$\n]+?)\$/g, (_match, math) => store.replace(renderNoteMathExpression(math, false)));
		let html = escapeHtml(working);
		html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
		return store.restore(html);
	};

	const ensureNoteKatexLoaded = () => {
		if (noteKatexModule || !katexUrl) return Promise.resolve(noteKatexModule);
		if (noteKatexLoadPromise) return noteKatexLoadPromise;
		noteKatexLoadPromise = import(katexUrl)
			.then((module) => {
				noteKatexModule = module.default || module;
				return noteKatexModule;
			})
			.catch(() => null);
		return noteKatexLoadPromise;
	};

	const applyAnnotationThemeToElement = (element) => {
		if (!(element instanceof Element)) return false;
		if (annotationTheme === "system") {
			if (element.hasAttribute("data-onhand-theme")) {
				element.removeAttribute("data-onhand-theme");
			}
			return true;
		}
		if (element.getAttribute("data-onhand-theme") !== annotationTheme) {
			element.setAttribute("data-onhand-theme", annotationTheme);
		}
		return true;
	};

	const syncAnnotationThemeAttributes = () => {
		let updated = 0;
		for (const element of Array.from(
			document.querySelectorAll(
				'span[data-onhand-highlight-kind="inline"], [data-onhand-highlight-kind="block"], [data-onhand-highlight-kind="pdf"], [data-onhand-pdf-segment-kind="highlight"], [data-onhand-note-kind="card"]',
			),
		)) {
			if (applyAnnotationThemeToElement(element)) updated += 1;
		}
		return { theme: annotationTheme, updated };
	};

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
		href: element instanceof HTMLAnchorElement ? element.href || null : null,
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
			${annotationFontFaces()}

			/* ============================================================
			   Onhand in-browser annotations — Ramaway Dawn reskin.

			   Paste this verbatim into the template-literal body of
			   \`ensureAnnotationStyles()\` in background.js, replacing the
			   existing yellow+red rules.

			   DOM contract unchanged:
			     span[data-onhand-highlight-kind="inline"]      — inline highlight
			     [data-onhand-highlight-kind="block"]           — block highlight
			     [data-onhand-highlight-kind="pdf"]             — PDF overlay highlight
			     [data-onhand-pdf-segment-kind="highlight"]     — extra PDF overlay segment
			     [data-onhand-note-kind="card"]                 — note card
			       [data-onhand-note-part="label"]              — eyebrow
			       [data-onhand-note-part="body"]               — prose
			   ============================================================ */

			/* Palette is scoped to Onhand nodes only so we never leak into the host page. */
			span[data-onhand-highlight-kind="inline"],
			[data-onhand-highlight-kind="block"],
			[data-onhand-highlight-kind="pdf"],
			[data-onhand-pdf-segment-kind="highlight"],
			[data-onhand-note-kind="card"] {
			  --onhand-hl-bg: rgba(234, 157, 52, 0.32) !important;
			  --onhand-gold:  #ea9d34 !important;
			  --onhand-pine:  #286983 !important;
			  --onhand-mantle: #e6dbd1 !important;
			  --onhand-surface-2: #cac1b9 !important;
			  --onhand-text:  #575279 !important;
			  --onhand-subtext: #797593 !important;
			  --onhand-font-serif: "New York", "Iowan Old Style", Charter, Georgia, serif !important;
			  --onhand-font-mono: "Ioskeley Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
			}

			@media (prefers-color-scheme: dark) {
			  span[data-onhand-highlight-kind="inline"],
			  [data-onhand-highlight-kind="block"],
			  [data-onhand-highlight-kind="pdf"],
			  [data-onhand-pdf-segment-kind="highlight"],
			  [data-onhand-note-kind="card"] {
			    --onhand-hl-bg: rgba(246, 193, 119, 0.28) !important;
			    --onhand-gold:  #f6c177 !important;
			    --onhand-pine:  #9ccfd8 !important;
			    --onhand-mantle: #1f1d2e !important;
			    --onhand-surface-2: #44415a !important;
			    --onhand-text:  #e0def4 !important;
			    --onhand-subtext: #908caa !important;
			  }
			}

			span[data-onhand-highlight-kind="inline"][data-onhand-theme="light"],
			[data-onhand-highlight-kind="block"][data-onhand-theme="light"],
			[data-onhand-highlight-kind="pdf"][data-onhand-theme="light"],
			[data-onhand-pdf-segment-kind="highlight"][data-onhand-theme="light"],
			[data-onhand-note-kind="card"][data-onhand-theme="light"] {
			  --onhand-hl-bg: rgba(234, 157, 52, 0.32) !important;
			  --onhand-gold:  #ea9d34 !important;
			  --onhand-pine:  #286983 !important;
			  --onhand-mantle: #e6dbd1 !important;
			  --onhand-surface-2: #cac1b9 !important;
			  --onhand-text:  #575279 !important;
			  --onhand-subtext: #797593 !important;
			}

			span[data-onhand-highlight-kind="inline"][data-onhand-theme="dark"],
			[data-onhand-highlight-kind="block"][data-onhand-theme="dark"],
			[data-onhand-highlight-kind="pdf"][data-onhand-theme="dark"],
			[data-onhand-pdf-segment-kind="highlight"][data-onhand-theme="dark"],
			[data-onhand-note-kind="card"][data-onhand-theme="dark"] {
			  --onhand-hl-bg: rgba(246, 193, 119, 0.28) !important;
			  --onhand-gold:  #f6c177 !important;
			  --onhand-pine:  #9ccfd8 !important;
			  --onhand-mantle: #1f1d2e !important;
			  --onhand-surface-2: #44415a !important;
			  --onhand-text:  #e0def4 !important;
			  --onhand-subtext: #908caa !important;
			}

			/* Inline highlight — soft gold wash, no outline, no color override on the text */
			span[data-onhand-highlight-kind="inline"] {
			  background: var(--onhand-hl-bg) !important;
			  color: inherit !important;
			  border-radius: 2px !important;
			  padding: 0 0.08em !important;
			  box-decoration-break: clone !important;
			  -webkit-box-decoration-break: clone !important;
			  transition: background 150ms ease-out !important;
			}

			/* Block highlight — left gold rail + faint wash, preserves surrounding text */
			[data-onhand-highlight-kind="block"] {
			  background: var(--onhand-hl-bg) !important;
			  border-left: 3px solid var(--onhand-gold) !important;
			  padding-left: 12px !important;
			  margin-left: -15px !important;
			  border-radius: 0 3px 3px 0 !important;
			  color: inherit !important;
			  scroll-margin-top: 20vh !important;
			  scroll-margin-bottom: 20vh !important;
			}

			li[data-onhand-highlight-kind="block"] {
			  margin-left: 0 !important;
			  padding-left: 10px !important;
			}

			/* PDF highlight — overlay geometry, not text-layer mutation */
			[data-onhand-highlight-kind="pdf"],
			[data-onhand-pdf-segment-kind="highlight"] {
			  position: absolute !important;
			  background: var(--onhand-hl-bg) !important;
			  border-radius: 2px !important;
			  pointer-events: auto !important;
			  cursor: pointer !important;
			  scroll-margin-top: 20vh !important;
			  scroll-margin-bottom: 20vh !important;
			}

			/* Note card — editorial callout, pine-barred */
			[data-onhand-note-kind="card"] {
			  background: var(--onhand-mantle) !important;
			  color: var(--onhand-text) !important;
			  border: 1px solid var(--onhand-surface-2) !important;
			  border-left: 3px solid var(--onhand-pine) !important;
			  border-radius: 0 4px 4px 0 !important;
			  box-shadow: 0 1px 2px rgba(87, 82, 121, 0.06) !important;
			  margin: 14px 0 18px !important;
			  padding: 12px 14px !important;
			  display: block !important;
			  width: fit-content !important;
			  inline-size: fit-content !important;
			  max-width: min(32rem, 100%) !important;
			  max-inline-size: min(32rem, 100%) !important;
			  font: 15px/1.55 var(--onhand-font-serif) !important;
			  position: relative !important;
			  z-index: auto !important;
			  scroll-margin-top: 20vh !important;
			  scroll-margin-bottom: 20vh !important;
			  white-space: normal !important;
			  overflow-wrap: anywhere !important;
			  vertical-align: top !important;
			  clear: none !important;
			}

			@media (prefers-color-scheme: dark) {
			  [data-onhand-note-kind="card"] {
			    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
			  }
			}

			[data-onhand-note-kind="card"][data-onhand-theme="light"] {
			  box-shadow: 0 1px 2px rgba(87, 82, 121, 0.06) !important;
			}

			[data-onhand-note-kind="card"][data-onhand-theme="dark"] {
			  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
			}

			/* Eyebrow label — mono, pine-toned, with a pine dot */
			[data-onhand-note-part="label"] {
			  font-family: var(--onhand-font-mono) !important;
			  color: var(--onhand-pine) !important;
			  font-size: 11px !important;
			  font-weight: 700 !important;
			  letter-spacing: 0.08em !important;
			  margin-bottom: 6px !important;
			  text-transform: uppercase !important;
			  display: flex !important;
			  align-items: center !important;
			  gap: 6px !important;
			}

			[data-onhand-note-part="label"]::before {
			  content: "" !important;
			  display: inline-block !important;
			  width: 5px !important;
			  height: 5px !important;
			  border-radius: 50% !important;
			  background: var(--onhand-pine) !important;
			}

			[data-onhand-note-part="header"] {
			  display: flex !important;
			  align-items: center !important;
			  justify-content: space-between !important;
			  gap: 10px !important;
			  margin-bottom: 6px !important;
			}

			[data-onhand-note-part="header"] [data-onhand-note-part="label"] {
			  margin-bottom: 0 !important;
			}

			[data-onhand-note-toggle] {
			  width: 22px !important;
			  height: 22px !important;
			  border: 1px solid var(--onhand-surface-2) !important;
			  border-radius: 3px !important;
			  background: color-mix(in srgb, var(--onhand-mantle) 70%, white) !important;
			  color: var(--onhand-pine) !important;
			  cursor: pointer !important;
			  font: 700 12px/1 var(--onhand-font-mono) !important;
			  padding: 0 !important;
			}

			[data-onhand-note-kind="card"][data-onhand-note-collapsed="true"] [data-onhand-note-part="label"],
			[data-onhand-note-kind="card"][data-onhand-note-collapsed="true"] [data-onhand-note-part="body"] {
			  display: none !important;
			}

			[data-onhand-note-kind="card"][data-onhand-note-collapsed="true"] [data-onhand-note-part="header"] {
			  margin: 0 !important;
			  width: 100% !important;
			  height: 100% !important;
			  display: flex !important;
			  align-items: center !important;
			  justify-content: center !important;
			}

			[data-onhand-note-kind="card"][data-onhand-note-collapsed="true"] {
			  opacity: 0.48 !important;
			}

			[data-onhand-note-kind="card"][data-onhand-note-collapsed="true"] [data-onhand-note-toggle] {
			  width: 100% !important;
			  height: 100% !important;
			  border: 0 !important;
			  background: transparent !important;
			}

			/* Body prose — New York-backed editorial serif */
			[data-onhand-note-part="body"] {
			  white-space: pre-wrap !important;
			  color: var(--onhand-text) !important;
			}

			[data-onhand-note-part="body"] strong {
			  font-weight: 700 !important;
			  color: var(--onhand-text) !important;
			}

			[data-onhand-note-part="body"] em {
			  font-style: italic !important;
			  color: var(--onhand-text) !important;
			}

			[data-onhand-note-part="code"] {
			  font-family: var(--onhand-font-mono) !important;
			  font-size: 0.9em !important;
			  background: color-mix(in srgb, var(--onhand-surface-2) 42%, transparent) !important;
			  border: 1px solid color-mix(in srgb, var(--onhand-surface-2) 72%, transparent) !important;
			  border-radius: 5px !important;
			  padding: 0.08em 0.32em !important;
			}

			.onhand-note-math-inline,
			.onhand-note-math-block {
			  color: var(--onhand-text) !important;
			  max-width: 100% !important;
			}

			.onhand-note-math-inline {
			  display: inline !important;
			}

			.onhand-note-math-block {
			  display: block !important;
			  margin: 8px 0 !important;
			  overflow-x: auto !important;
			  overflow-y: hidden !important;
			}

			.onhand-note-math-inline math,
			.onhand-note-math-block math {
			  color: var(--onhand-text) !important;
			  max-width: 100% !important;
			}

			.onhand-note-math-fallback {
			  font-style: italic !important;
			}
		`;
		syncAnnotationThemeAttributes();
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
		'[data-testid="tweetText"]',
	].join(", ");

	const MATH_CONTAINER_SELECTOR = [
		"mjx-container",
		".MathJax",
		".katex",
		".math",
		'[role="math"]',
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

	const ONHAND_ANNOTATION_DOM_SELECTOR = [
		"[data-onhand-pdf-overlay-layer]",
		"[data-onhand-pdf-segment-kind]",
		"[data-onhand-highlight-kind]",
		"[data-onhand-note-kind]",
		"[data-onhand-note-part]",
	].join(", ");

	const PDF_VIEWER_UI_TEXT_EXCLUDED_SELECTOR = [
		"button",
		"input",
		"select",
		"textarea",
		'[role="button"]',
		'[role="dialog"]',
		'[role="menu"]',
		'[role="menubar"]',
		'[role="toolbar"]',
		'[aria-modal="true"]',
		'[contenteditable="true"]',
		"[contenteditable=true]",
		'[class*="comment" i]',
		'[class*="popup" i]',
		'[class*="popover" i]',
		'[class*="tooltip" i]',
		'[class*="toolbar" i]',
		'[data-testid*="comment" i]',
		'[data-testid*="popup" i]',
		'[data-testid*="toolbar" i]',
		'[aria-label*="comment" i]',
		'[aria-label*="toolbar" i]',
	].join(", ");

	const rectToObject = (rect) => ({
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		bottom: rect.bottom,
		right: rect.right,
	});

	const isPdfLikeUrl = (value = location.href) => {
		try {
			const url = new URL(String(value || ""), location.href);
			if (/\.pdf$/i.test(url.pathname)) return true;
			if (/(?:^|\/)pdfs?(?:\/|$)/i.test(url.pathname)) return true;
			for (const [name, raw] of url.searchParams.entries()) {
				const key = String(name || "").toLowerCase();
				const parameterValue = String(raw || "").toLowerCase();
				if ((key === "format" || key === "type" || key === "output" || key === "view") && parameterValue === "pdf") return true;
				if (/\.pdf(?:[?#]|$)/i.test(parameterValue)) return true;
				if (isDirectPdfDocumentUrl(raw)) return true;
			}
			return false;
		} catch {
			const text = String(value || "");
			return /\.pdf(?:[?#]|$)/i.test(text) || /(?:^|\/)pdfs?(?:\/|$)/i.test(text) || /(?:[?&#](?:format|type|output|view)=pdf)(?:&|$)/i.test(text);
		}
	};

	const isDirectPdfDocumentUrl = (value = location.href) => {
		try {
			const url = new URL(String(value || ""), location.href);
			if (/\.pdf$/i.test(url.pathname)) return true;
			if (/(?:^|\/)pdfs?(?:\/|$)/i.test(url.pathname)) return true;
			for (const [name, raw] of url.searchParams.entries()) {
				const key = String(name || "").toLowerCase();
				const parameterValue = String(raw || "").toLowerCase();
				if ((key === "format" || key === "type" || key === "output" || key === "view") && parameterValue === "pdf") return true;
			}
			return false;
		} catch {
			const text = String(value || "");
			return /\.pdf(?:[?#]|$)/i.test(text) || /(?:^|\/)pdfs?(?:\/|$)/i.test(text) || /(?:[?&#](?:format|type|output|view)=pdf)(?:&|$)/i.test(text);
		}
	};

	const resolvePdfUrl = (value) => {
		if (!value || !isDirectPdfDocumentUrl(value)) return null;
		try {
			return new URL(String(value), location.href).href;
		} catch {
			return String(value);
		}
	};

	const PDF_DOCUMENT_URL_PARAM_NAMES = ["file", "url", "pdf", "pdfUrl", "src", "href"];
	const GOOGLE_SCHOLAR_READER_FRAME_URL_PREFIX = "chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html";
	const GOOGLE_SCHOLAR_READER_FRAME_SELECTOR = `iframe[src^="${GOOGLE_SCHOLAR_READER_FRAME_URL_PREFIX}"]`;

	const getSourceTabUrl = () => {
		const raw = typeof options.sourceTabUrl === "string" ? options.sourceTabUrl : "";
		if (!raw) return null;
		try {
			const url = new URL(raw);
			if (!/^https?:$/i.test(url.protocol)) return null;
			return url.href;
		} catch {
			return null;
		}
	};

	const getCurrentHttpUrl = () => {
		try {
			const url = new URL(location.href);
			if (!/^https?:$/i.test(url.protocol)) return null;
			return url.href;
		} catch {
			return null;
		}
	};

	const getSourceTabTitle = () => (typeof options.sourceTabTitle === "string" && options.sourceTabTitle.trim() ? options.sourceTabTitle.trim() : "");

	const getPdfViewerUrl = () => {
		const sourceTabUrl = getSourceTabUrl();
		if (sourceTabUrl && String(location.href || "").startsWith(GOOGLE_SCHOLAR_READER_FRAME_URL_PREFIX)) return sourceTabUrl;
		return location.href;
	};

	const getPdfUrlFromUrlParameters = (value) => {
		if (!value) return null;
		try {
			const url = new URL(String(value), location.href);
			for (const name of PDF_DOCUMENT_URL_PARAM_NAMES) {
				const raw = url.searchParams.get(name);
				const resolved = resolvePdfUrl(raw);
				if (resolved) return resolved;
			}
			for (const raw of url.searchParams.values()) {
				const resolved = resolvePdfUrl(raw);
				if (resolved) return resolved;
			}
		} catch {}
		return null;
	};

	const isGoogleScholarPdfReader = () => {
		const text = normalizeText(
			[
				document.title,
				document.querySelector('[aria-label*="Google Scholar" i]')?.getAttribute?.("aria-label"),
				document.querySelector('[title*="Google Scholar" i]')?.getAttribute?.("title"),
				document.querySelector('[aria-label*="Scholar" i]')?.getAttribute?.("aria-label"),
				document.querySelector('[title*="Scholar" i]')?.getAttribute?.("title"),
			]
				.filter(Boolean)
				.join(" "),
		);
		return /\bgoogle scholar\b|\bscholar pdf reader\b/i.test(text);
	};

	const hasGoogleScholarReaderFrameEmbed = () => {
		try {
			return Boolean(document.querySelector(GOOGLE_SCHOLAR_READER_FRAME_SELECTOR));
		} catch {
			return false;
		}
	};

	const PDF_EMBED_SELECTOR = [
		'embed[type="application/pdf"]',
		'object[type="application/pdf"]',
		'iframe[src$=".pdf" i]',
		'iframe[src*=".pdf?" i]',
		'iframe[src*=".pdf#" i]',
		'embed[src$=".pdf" i]',
		'embed[src*=".pdf?" i]',
		'embed[src*=".pdf#" i]',
		'object[data$=".pdf" i]',
		'object[data*=".pdf?" i]',
		'object[data*=".pdf#" i]',
	].join(", ");

	const findPdfEmbedElement = () => document.querySelector(PDF_EMBED_SELECTOR);

	const getPdfDocumentUrl = () => {
		const currentUrl = resolvePdfUrl(location.href);
		if (currentUrl) return currentUrl;
		const parameterUrl = getPdfUrlFromUrlParameters(location.href);
		if (parameterUrl) return parameterUrl;
		const embed = findPdfEmbedElement();
		if (embed instanceof Element) {
			for (const attr of ["src", "data"]) {
				const raw = embed.getAttribute(attr);
				const resolved = resolvePdfUrl(raw) || getPdfUrlFromUrlParameters(raw);
				if (resolved) return resolved;
			}
		}
		if (hasGoogleScholarReaderFrameEmbed()) return getCurrentHttpUrl();
		const sourceTabUrl = getSourceTabUrl();
		if (sourceTabUrl && (isGoogleScholarPdfReader() || hasGoogleScholarReaderFrameEmbed() || isPdfLikeUrl(sourceTabUrl))) return sourceTabUrl;
		return null;
	};

	const buildPdfDocumentInfo = (surface = {}) => {
		const pdfUrl = surface.pdfUrl || getPdfDocumentUrl();
		const viewerUrl = surface.viewerUrl || getPdfViewerUrl();
		return {
			url: pdfUrl || viewerUrl,
			viewerUrl,
			title: getSourceTabTitle() || document.title || undefined,
			...(surface.pageCount ? { pageCount: surface.pageCount } : {}),
			...(pdfUrl ? { pdfUrl } : {}),
		};
	};

	const hasPdfEmbedElement = () => Boolean(findPdfEmbedElement());

	const hasOnhandPdfViewerDocumentSignal = () =>
		Boolean(
			document.body?.getAttribute?.("data-onhand-pdf-rendered") === "true" ||
				document.body?.hasAttribute?.("data-onhand-pdf-url") ||
				document.querySelector("[data-onhand-pdf-viewer-root], [data-onhand-pdf-page], [data-onhand-pdf-text-layer]"),
		);

	const hasLikelyPdfDocumentSignal = () =>
		isPdfLikeUrl() || isGoogleScholarPdfReader() || hasGoogleScholarReaderFrameEmbed() || hasPdfEmbedElement() || hasOnhandPdfViewerDocumentSignal();

	const PDF_EXPLICIT_PAGE_SELECTORS = [
		".page[data-page-number]",
		".gsr-page[data-pn]",
		"[data-page-number]",
		"[data-onhand-pdf-page]",
		".page:has(.textLayer)",
		".page:has([data-onhand-pdf-text-layer])",
		".gsr-page:has(.gsr-text-ctn)",
	];

	const PDF_GENERIC_PAGE_SELECTORS = [
		"[data-page-index]",
		"[data-page]",
		'[role="region"][aria-label*="page" i]',
		'[aria-label^="Page "]',
		'[aria-label^="page "]',
	];

	const PDF_PAGE_CLOSEST_SELECTOR = [
		".page[data-page-number]",
		".gsr-page[data-pn]",
		"[data-page-number]",
		"[data-page-index]",
		"[data-page]",
		"[data-onhand-pdf-page]",
		".page",
		'[role="region"][aria-label*="page" i]',
		'[aria-label^="Page "]',
		'[aria-label^="page "]',
	].join(", ");

	const isPdfPageCandidateElement = (element) => {
		if (!(element instanceof Element)) return false;
		try {
			if (element.matches(".page, .gsr-page[data-pn], [data-page-number], [data-page-index], [data-page], [data-onhand-pdf-page]")) return true;
		} catch {}
		const ariaLabel = element.getAttribute?.("aria-label") || "";
		return /\bpage\s+\d+\b/i.test(ariaLabel);
	};

	const PDF_TEXT_LAYER_SELECTORS = [
		".textLayer",
		".gsr-text-ctn",
		"[data-onhand-pdf-text-layer]",
		'[class*="selectable-text" i]',
		'[class*="selectable_text" i]',
		'[data-testid*="selectable-text" i]',
		'[aria-label*="selectable text" i]',
		'[class*="textlayer" i]',
		'[class*="text-layer" i]',
		'[class*="text_layer" i]',
		'[data-testid*="text-layer" i]',
		'[aria-label*="text layer" i]',
	];

	const collectPdfPageElements = (options = {}) => {
		const pages = [];
		const seen = new Set();
		const includeGeneric = options.includeGeneric === true;
		const selectors = [
			...PDF_EXPLICIT_PAGE_SELECTORS,
			"[data-page-number] .textLayer",
			"[data-page-number] [data-onhand-pdf-text-layer]",
			...(includeGeneric ? PDF_GENERIC_PAGE_SELECTORS : []),
		];
		for (const selector of selectors) {
			let matches = [];
			try {
				matches = Array.from(document.querySelectorAll(selector));
			} catch {
				continue;
			}
			for (const match of matches) {
				const page = match.closest?.(PDF_PAGE_CLOSEST_SELECTOR) || match;
				if (!(page instanceof Element) || seen.has(page)) continue;
				if (!isPdfPageCandidateElement(page)) continue;
				seen.add(page);
				pages.push(page);
			}
		}
		return pages;
	};

	const getPdfPageNumber = (page, fallbackIndex = 0) => {
		const rawPageNumber =
			page?.getAttribute?.("data-page-number") ||
			page?.getAttribute?.("data-pn") ||
			page?.getAttribute?.("data-page") ||
			"";
		const parsedPageNumber = Number.parseInt(String(rawPageNumber || "").replace(/[^\d]/g, ""), 10);
		if (Number.isFinite(parsedPageNumber) && parsedPageNumber > 0) return parsedPageNumber;

		const rawPageIndex = page?.getAttribute?.("data-page-index") || "";
		const parsedPageIndex = Number.parseInt(String(rawPageIndex || "").replace(/[^\d]/g, ""), 10);
		if (Number.isFinite(parsedPageIndex) && parsedPageIndex >= 0) return parsedPageIndex + 1;

		const ariaPageNumber = page?.getAttribute?.("aria-label")?.match(/\bpage\s+(\d+)\b/i)?.[1] || "";
		const parsedAriaPageNumber = Number.parseInt(String(ariaPageNumber || "").replace(/[^\d]/g, ""), 10);
		if (Number.isFinite(parsedAriaPageNumber) && parsedAriaPageNumber > 0) return parsedAriaPageNumber;

		return fallbackIndex + 1;
	};

	const getPdfTextLayer = (page, options = {}) => {
		if (!(page instanceof Element)) return null;
		for (const selector of PDF_TEXT_LAYER_SELECTORS) {
			try {
				const layer = page.matches?.(selector) ? page : page.querySelector(selector);
				if (layer instanceof Element) return layer;
			} catch {}
		}
		if (options.allowPageFallback === true && getPdfLayerReadableText(page)) return page;
		return null;
	};

	const getPdfLayerReadableText = (element) => {
		if (!(element instanceof Element)) return "";
		if (element.matches?.(ONHAND_ANNOTATION_DOM_SELECTOR)) return "";
		const clone = element.cloneNode(true);
		if (!(clone instanceof Element)) return normalizeText(element.textContent || "");
		for (const node of Array.from(clone.querySelectorAll(`${READABLE_TEXT_EXCLUDED_SELECTOR}, ${ONHAND_ANNOTATION_DOM_SELECTOR}, ${PDF_VIEWER_UI_TEXT_EXCLUDED_SELECTOR}`))) {
			node.remove();
		}
		return normalizeText(clone.textContent || "");
	};

	const getAnnotationSurfaceInfo = () => {
		const hasPdfEmbed = hasPdfEmbedElement();
		const pdfDocumentUrl = getPdfDocumentUrl();
		const likelyPdfDocument = hasLikelyPdfDocumentSignal();
		const pdfPages = collectPdfPageElements({ includeGeneric: likelyPdfDocument });
		const hasPdfTextLayer = pdfPages.some((page) => getPdfTextLayer(page, { allowPageFallback: likelyPdfDocument }));
		if (!hasPdfTextLayer && !hasPdfEmbed && !likelyPdfDocument) {
			return {
				surface: "html",
				viewer: "html",
				url: location.href,
				title: document.title,
			};
		}
		const viewer = isGoogleScholarPdfReader() || hasGoogleScholarReaderFrameEmbed() ? "google-scholar" : hasPdfTextLayer ? "pdfjs" : "unknown-pdf";
		return {
			surface: "pdf",
			viewer,
			url: getPdfViewerUrl(),
				title: getSourceTabTitle() || document.title,
				pageCount: pdfPages.length || undefined,
				pdfUrl: pdfDocumentUrl,
				viewerUrl: getPdfViewerUrl(),
				hasTextLayer: hasPdfTextLayer,
				unsupportedReason: hasPdfTextLayer ? undefined : "PDF surface has no readable text layer",
				likelyPdfDocument,
			};
		};

	const buildUnsupportedPdfSurfaceResult = (surface = getAnnotationSurfaceInfo()) => ({
		surface: "pdf",
		viewer: surface.viewer || "unknown-pdf",
		url: getPdfViewerUrl(),
		title: getSourceTabTitle() || document.title,
		pdfUrl: surface.pdfUrl,
		viewerUrl: surface.viewerUrl || getPdfViewerUrl(),
		scrollX: window.scrollX,
		scrollY: window.scrollY,
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight,
		},
		pageCount: surface.pageCount,
		blockCount: 0,
		blocks: [],
		pages: [],
		unsupported: true,
		reason: surface.unsupportedReason || "PDF surface has no readable text layer",
		text: "This PDF viewer does not expose selectable page text to Onhand yet. Open the PDF in Google Scholar PDF Reader or another text-layer PDF viewer, or select text directly if the viewer supports selection.",
	});

	const collectPdfVisibleText = (options = {}) => {
		const surface = getAnnotationSurfaceInfo();
		if (surface.surface !== "pdf") return null;
		if (!surface.hasTextLayer) return buildUnsupportedPdfSurfaceResult(surface);
		const maxPages = Math.max(1, Math.min(20, Number(options.maxPages || 8) || 8));
		const maxChars = Math.max(200, Math.min(20000, Number(options.maxChars || 6000) || 6000));
		const viewportTop = 0;
		const viewportBottom = window.innerHeight;
		const pages = [];
		let usedChars = 0;
		for (const [index, page] of collectPdfPageElements({ includeGeneric: surface.likelyPdfDocument }).entries()) {
			if (!(page instanceof Element) || !isVisible(page)) continue;
			const rect = page.getBoundingClientRect();
			if (rect.bottom <= viewportTop || rect.top >= viewportBottom) continue;
			const textLayer = getPdfTextLayer(page, { allowPageFallback: surface.likelyPdfDocument });
			const text = getPdfLayerReadableText(textLayer || page);
			if (!text) continue;
			const remaining = maxChars - usedChars;
			if (remaining <= 0 || pages.length >= maxPages) break;
			const pageText = text.length > remaining ? `${text.slice(0, remaining).trimEnd()}...` : text;
			usedChars += pageText.length;
			pages.push({
				tag: "pdf-page",
				pageNumber: getPdfPageNumber(page, index),
				text: pageText,
				top: rect.top,
				bottom: rect.bottom,
				rect: rectToObject(rect),
				selector: buildSelector(page),
			});
		}
		if (!pages.length) return null;
		return {
			surface: surface.surface,
			viewer: surface.viewer,
			url: getPdfViewerUrl(),
			title: getSourceTabTitle() || document.title,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			pageCount: surface.pageCount || pages.length,
			pdfUrl: surface.pdfUrl,
			viewerUrl: surface.viewerUrl || getPdfViewerUrl(),
			blockCount: pages.length,
			blocks: pages,
			pages,
			text: pages.map((page) => `[p. ${page.pageNumber}] ${page.text}`).join("\n\n"),
		};
	};

	const clampUnit = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

	const normalizePdfRect = (rect, pageRect, pageNumber) => {
		const pageWidth = Math.max(1, pageRect.width || 1);
		const pageHeight = Math.max(1, pageRect.height || 1);
		return {
			pageNumber,
			x: clampUnit((rect.left - pageRect.left) / pageWidth),
			y: clampUnit((rect.top - pageRect.top) / pageHeight),
			width: clampUnit(rect.width / pageWidth),
			height: clampUnit(rect.height / pageHeight),
			coordinateSpace: "page-normalized",
		};
	};

	const getPdfPageLayoutSize = (page, pageRect = null) => {
		const rect = pageRect || page?.getBoundingClientRect?.() || {};
		const width = Number(page?.clientWidth || page?.offsetWidth || rect.width || 1) || 1;
		const height = Number(page?.clientHeight || page?.offsetHeight || rect.height || 1) || 1;
		return {
			width: Math.max(1, width),
			height: Math.max(1, height),
		};
	};

	const denormalizePdfRect = (rect, page, pageRect = null) => {
		const size = getPdfPageLayoutSize(page, pageRect);
		return {
			left: rect.x * size.width,
			top: rect.y * size.height,
			width: rect.width * size.width,
			height: rect.height * size.height,
		};
	};

	const parsePdfAnchorFromElement = (annotationElement) => {
		try {
			const parsed = JSON.parse(annotationElement?.getAttribute?.("data-onhand-pdf-anchor") || "null");
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	};

	const getPdfAnnotationRegistry = () => {
		if (!window.__onhandPdfAnnotationRegistry) {
			window.__onhandPdfAnnotationRegistry = new Map();
		}
		return window.__onhandPdfAnnotationRegistry;
	};

	const registerPdfAnnotationRecord = (annotationId, record = {}) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId) return null;
		const registry = getPdfAnnotationRegistry();
		const existing = registry.get(rawAnnotationId) || {};
		const nextRecord = {
			...existing,
			...record,
			annotationId: rawAnnotationId,
			kind: "pdf",
			updatedAt: Date.now(),
		};
		registry.set(rawAnnotationId, nextRecord);
		ensurePdfOverlayMutationObserver();
		return nextRecord;
	};

		const getPdfAnnotationRecord = (annotationId) => {
			const rawAnnotationId = String(annotationId || "").trim();
			if (!rawAnnotationId) return null;
			return getPdfAnnotationRegistry().get(rawAnnotationId) || null;
		};

	const findRenderedPdfPageForAnchor = (pdfAnchor) => {
		if (!pdfAnchor || typeof pdfAnchor !== "object") return null;
		const anchorPage = findPdfPageByNumber(pdfAnchor.pageNumber);
		if (anchorPage instanceof HTMLElement) return anchorPage;
		const rects = Array.isArray(pdfAnchor.rects) ? pdfAnchor.rects : [];
			for (const rect of rects) {
			const page = findPdfPageByNumber(rect?.pageNumber);
			if (page instanceof HTMLElement) return page;
		}
		const pages = collectPdfPageElements({ includeGeneric: true });
		const pageNumber = Number.parseInt(String(pdfAnchor.pageNumber || ""), 10);
		const indexedPage = Number.isFinite(pageNumber) && pageNumber > 0 ? pages[pageNumber - 1] : null;
		if (indexedPage instanceof HTMLElement) return indexedPage;
		if ((pageNumber === 1 || !Number.isFinite(pageNumber)) && pages[0] instanceof HTMLElement) return pages[0];
		return null;
	};

	const setPdfOverlayStyle = (element, property, value) => {
		element.style.setProperty(property, value, "important");
	};

	const getPdfNoteForAnnotation = (annotationId) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId) return null;
		const note = document.querySelector(`[data-onhand-note-for="${attrEscape(rawAnnotationId)}"]`);
		return note instanceof HTMLElement ? note : null;
	};

	const setPdfNoteCollapsed = (note, collapsed) => {
		if (!(note instanceof HTMLElement)) return null;
		const isCollapsed = Boolean(collapsed);
		const body = note.querySelector('[data-onhand-note-part="body"]');
		const label = note.querySelector('[data-onhand-note-part="label"]');
		const toggle = note.querySelector("[data-onhand-note-toggle]");
		note.setAttribute("data-onhand-note-collapsed", isCollapsed ? "true" : "false");
		if (body instanceof HTMLElement) body.hidden = isCollapsed;
		if (label instanceof HTMLElement) label.hidden = isCollapsed;
		if (toggle instanceof HTMLButtonElement) {
			toggle.textContent = isCollapsed ? "+" : "x";
			toggle.setAttribute("aria-label", isCollapsed ? "Expand note" : "Collapse note");
			toggle.setAttribute("title", isCollapsed ? "Expand note" : "Collapse note");
			toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
		}
		if (isCollapsed) {
			for (const [property, value] of [
				["width", "30px"],
				["inline-size", "30px"],
				["min-width", "0"],
				["max-width", "30px"],
				["height", "30px"],
				["min-height", "30px"],
				["padding", "0"],
				["overflow", "hidden"],
				["display", "flex"],
				["align-items", "center"],
				["justify-content", "center"],
				["cursor", "pointer"],
				["border-radius", "4px"],
				["opacity", "0.48"],
			]) {
				setPdfOverlayStyle(note, property, value);
			}
			return note;
		}
		for (const property of [
			"width",
			"inline-size",
			"min-width",
			"max-width",
			"height",
			"min-height",
			"padding",
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"overflow",
			"display",
			"align-items",
			"justify-content",
			"cursor",
			"border-radius",
			"opacity",
		]) {
			note.style.removeProperty(property);
		}
		return note;
	};

	const hasStaleCollapsedPdfNoteStyle = (note) => {
		if (!(note instanceof HTMLElement)) return false;
		const collapsedValues = new Map([
			["height", "30px"],
			["min-height", "30px"],
			["padding", "0px"],
			["padding-top", "0px"],
			["padding-right", "0px"],
			["padding-bottom", "0px"],
			["padding-left", "0px"],
			["overflow", "hidden"],
			["display", "flex"],
			["align-items", "center"],
			["justify-content", "center"],
			["cursor", "pointer"],
			["border-radius", "4px"],
			["opacity", "0.48"],
		]);
		for (const [property, expectedValue] of collapsedValues) {
			const value = note.style.getPropertyValue(property);
			if (!value) continue;
			if (value === expectedValue || (expectedValue === "0px" && value === "0")) return true;
		}
		return false;
	};

	const expandPdfNoteForAnnotation = (annotationId) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId) return null;
		const note = getPdfNoteForAnnotation(rawAnnotationId);
		if (!(note instanceof HTMLElement)) return null;
		setPdfNoteCollapsed(note, false);
		const annotationElement = document.querySelector(annotationSelector(rawAnnotationId));
		const page = annotationElement?.closest?.(PDF_PAGE_CLOSEST_SELECTOR);
		if (annotationElement instanceof HTMLElement && page instanceof HTMLElement) {
			positionPdfNoteElement(note, annotationElement, page);
		}
		return note;
	};

	const bindPdfAnnotationNoteTrigger = (trigger, annotationId) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!(trigger instanceof HTMLElement) || !rawAnnotationId || trigger.hasAttribute("data-onhand-note-trigger-bound")) return;
		trigger.setAttribute("data-onhand-note-trigger-bound", "true");
		trigger.setAttribute("role", "button");
		trigger.setAttribute("tabindex", "0");
		trigger.setAttribute("title", "Show Onhand note");
		setPdfOverlayStyle(trigger, "pointer-events", "auto");
		setPdfOverlayStyle(trigger, "cursor", "pointer");
		trigger.addEventListener("click", () => {
			expandPdfNoteForAnnotation(rawAnnotationId);
		});
		trigger.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			expandPdfNoteForAnnotation(rawAnnotationId);
		});
	};

	const attachPdfNoteInteractions = (note, annotationElement) => {
		if (!(note instanceof HTMLElement)) return;
		const annotationId = String(note.getAttribute("data-onhand-note-for") || annotationElement?.getAttribute?.("data-onhand-annotation-id") || "");
		if (!annotationId) return;
		if (annotationElement instanceof HTMLElement) bindPdfAnnotationNoteTrigger(annotationElement, annotationId);
		for (const segment of Array.from(document.querySelectorAll(`[data-onhand-pdf-segment-for="${attrEscape(annotationId)}"]`))) {
			bindPdfAnnotationNoteTrigger(segment, annotationId);
		}
		if (note.hasAttribute("data-onhand-note-toggle-bound")) return;
		note.setAttribute("data-onhand-note-toggle-bound", "true");
		const toggle = note.querySelector("[data-onhand-note-toggle]");
		if (toggle instanceof HTMLButtonElement) {
			toggle.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const nextCollapsed = note.getAttribute("data-onhand-note-collapsed") !== "true";
				setPdfNoteCollapsed(note, nextCollapsed);
				if (!nextCollapsed) expandPdfNoteForAnnotation(annotationId);
			});
		}
		note.addEventListener("click", (event) => {
			if (note.getAttribute("data-onhand-note-collapsed") !== "true") return;
			event.preventDefault();
			expandPdfNoteForAnnotation(annotationId);
		});
	};

	const createPdfNoteElement = (annotationId, noteText, options = {}) => {
		const noteId = String(options.noteId || nextAnnotationId());
		const note = document.createElement("div");
		note.setAttribute("data-onhand-note-kind", "card");
		note.setAttribute("data-onhand-pdf-note", "true");
		note.setAttribute("data-onhand-note-id", noteId);
		note.setAttribute("data-onhand-note-for", annotationId);
		applyAnnotationThemeToElement(note);

		const header = document.createElement("div");
		header.setAttribute("data-onhand-note-part", "header");

		const label = document.createElement("span");
		label.setAttribute("data-onhand-note-part", "label");
		label.textContent = String(options.label || "Onhand");

		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.setAttribute("data-onhand-note-toggle", "true");
		toggle.textContent = "x";

		const body = document.createElement("div");
		body.setAttribute("data-onhand-note-part", "body");
		body.setAttribute("data-onhand-note-source", noteText);
		body.innerHTML = renderNoteRichText(noteText);
		body.setAttribute("data-onhand-note-renderer", noteKatexModule ? "katex" : "plain");
		header.append(label, toggle);
		note.append(header, body);
		setPdfNoteCollapsed(note, false);
		return note;
	};

	const positionPdfHighlightElement = (annotationElement, page, pdfAnchor) => {
		if (!(annotationElement instanceof HTMLElement) || !(page instanceof HTMLElement)) return false;
		const rects = Array.isArray(pdfAnchor?.rects) ? pdfAnchor.rects : [];
		const annotationId = String(annotationElement.getAttribute("data-onhand-annotation-id") || "");
		const pageNumber = getPdfPageNumber(page);
		const primaryIndex = rects.findIndex(
			(rect) => rect && Number(rect.pageNumber || pageNumber) === pageNumber && Number(rect.width) > 0 && Number(rect.height) > 0,
		);
		const fallbackIndex = rects.findIndex((rect) => rect && Number(rect.width) > 0 && Number(rect.height) > 0);
		const targetIndex = primaryIndex >= 0 ? primaryIndex : fallbackIndex;
		const primaryRect = targetIndex >= 0 ? rects[targetIndex] : null;
		if (!primaryRect) return false;
		positionPdfVisualRect(annotationElement, page, primaryRect);
		syncPdfHighlightSegments(annotationId, pdfAnchor, targetIndex);
		return true;
	};

	const positionPdfVisualRect = (element, page, rect) => {
		if (!(element instanceof HTMLElement) || !(page instanceof HTMLElement) || !rect) return false;
		const positioned = denormalizePdfRect(rect, page, page.getBoundingClientRect());
		setPdfOverlayStyle(element, "left", `${positioned.left}px`);
		setPdfOverlayStyle(element, "top", `${positioned.top}px`);
		setPdfOverlayStyle(element, "width", `${Math.max(1, positioned.width)}px`);
		setPdfOverlayStyle(element, "height", `${Math.max(1, positioned.height)}px`);
		return true;
	};

	const removePdfHighlightSegments = (annotationId) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId) return 0;
		let removed = 0;
		for (const segment of Array.from(document.querySelectorAll(`[data-onhand-pdf-segment-for="${attrEscape(rawAnnotationId)}"]`))) {
			segment.remove();
			removed += 1;
		}
		return removed;
	};

	const syncPdfHighlightSegments = (annotationId, pdfAnchor, primaryRectIndex = 0) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId || !pdfAnchor) return 0;
		removePdfHighlightSegments(rawAnnotationId);
		const rects = Array.isArray(pdfAnchor.rects) ? pdfAnchor.rects : [];
		let created = 0;
		for (const [index, rect] of rects.entries()) {
			if (index === primaryRectIndex || !rect || Number(rect.width) <= 0 || Number(rect.height) <= 0) continue;
			const page = findPdfPageByNumber(rect.pageNumber);
			if (!(page instanceof HTMLElement)) continue;
			const overlayLayer = ensurePdfOverlayLayer(page);
			if (!overlayLayer) continue;
			const segment = document.createElement("div");
			segment.setAttribute("data-onhand-pdf-segment-kind", "highlight");
			segment.setAttribute("data-onhand-pdf-segment-for", rawAnnotationId);
			segment.setAttribute("data-onhand-pdf-segment-index", String(index));
			segment.setAttribute("data-onhand-matched-text", normalizeText(pdfAnchor.matchedText || pdfAnchor.textQuote?.exact || ""));
			segment.setAttribute("aria-hidden", "true");
			applyAnnotationThemeToElement(segment);
			if (!positionPdfVisualRect(segment, page, rect)) continue;
			bindPdfAnnotationNoteTrigger(segment, rawAnnotationId);
			overlayLayer.appendChild(segment);
			created += 1;
		}
		return created;
	};

	const toPdfPageRect = (rect, page, pageRect) => {
		const size = getPdfPageLayoutSize(page, pageRect);
		const scaleX = pageRect.width ? size.width / pageRect.width : 1;
		const scaleY = pageRect.height ? size.height / pageRect.height : 1;
		const left = (rect.left - pageRect.left) * scaleX;
		const top = (rect.top - pageRect.top) * scaleY;
		const width = rect.width * scaleX;
		const height = rect.height * scaleY;
		return {
			left,
			top,
			right: left + width,
			bottom: top + height,
			width,
			height,
		};
	};

	const pdfRectOverlapArea = (a, b) => {
		const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
		const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
		return width * height;
	};

	const getPdfTextRectsForPage = (page, pageRect) =>
		Array.from(page.querySelectorAll(".textLayer span, [data-onhand-pdf-text-layer] span"))
			.map((element) => {
				const rect = element.getBoundingClientRect();
				if (!rect || rect.width <= 0 || rect.height <= 0) return null;
				return toPdfPageRect(rect, page, pageRect);
			})
			.filter(Boolean);

	const scorePdfNoteCandidate = (candidate, textRects, anchorRect) => {
		const candidateRect = {
			left: candidate.left,
			top: candidate.top,
			right: candidate.left + candidate.width,
			bottom: candidate.top + candidate.height,
			width: candidate.width,
			height: candidate.height,
		};
		const textOverlap = textRects.reduce((sum, rect) => sum + pdfRectOverlapArea(candidateRect, rect), 0);
		const anchorOverlap = pdfRectOverlapArea(candidateRect, anchorRect);
		const anchorDistance = Math.abs(candidate.left - anchorRect.left) + Math.abs(candidate.top - anchorRect.top);
		return textOverlap * 1000 + anchorOverlap * 1200 + anchorDistance * 0.01 + candidate.order;
	};

	const choosePdfNotePosition = (page, pageRect, anchorRect, noteWidth, noteHeight) => {
		const { width: pageWidth, height: pageHeight } = getPdfPageLayoutSize(page, pageRect);
		const margin = Math.max(12, Math.min(20, pageWidth * 0.025));
		const gap = Math.max(10, Math.min(18, pageHeight * 0.018));
		const clamp = (value, min, max) => {
			if (max < min) return min;
			return Math.max(min, Math.min(max, value));
		};
		const maxLeft = Math.max(margin, pageWidth - noteWidth - margin);
		const maxTop = Math.max(margin, pageHeight - noteHeight - margin);
		const rightOfAnchor = clamp(anchorRect.right + gap, margin, maxLeft);
		const leftOfAnchor = clamp(anchorRect.left - noteWidth - gap, margin, maxLeft);
		const alignedWithAnchor = clamp(anchorRect.left, margin, maxLeft);
		const rightEdge = maxLeft;
		const leftEdge = margin;
		const aboveAnchor = anchorRect.top - noteHeight - gap;
		const belowAnchor = anchorRect.bottom + gap;
		const alignedTop = anchorRect.top;
		const candidates = [
			[rightOfAnchor, aboveAnchor],
			[rightEdge, aboveAnchor],
			[alignedWithAnchor, aboveAnchor],
			[leftOfAnchor, aboveAnchor],
			[rightOfAnchor, belowAnchor],
			[rightEdge, belowAnchor],
			[alignedWithAnchor, belowAnchor],
			[leftOfAnchor, belowAnchor],
			[rightEdge, alignedTop],
			[leftEdge, alignedTop],
			[rightEdge, margin],
			[rightEdge, maxTop],
			[leftEdge, maxTop],
		].map(([left, top], order) => ({
			left: clamp(left, margin, maxLeft),
			top: clamp(top, margin, maxTop),
			width: noteWidth,
			height: noteHeight,
			order,
		}));
		const textRects = getPdfTextRectsForPage(page, pageRect);
		return candidates.reduce((best, candidate) => {
			const score = scorePdfNoteCandidate(candidate, textRects, anchorRect);
			return !best || score < best.score ? { ...candidate, score } : best;
		}, null);
	};

	const positionPdfNoteElement = (note, annotationElement, page) => {
		if (!(note instanceof HTMLElement) || !(annotationElement instanceof HTMLElement) || !(page instanceof HTMLElement)) return false;
		const wasCollapsed = note.getAttribute("data-onhand-note-collapsed") === "true";
		if (!wasCollapsed && hasStaleCollapsedPdfNoteStyle(note)) setPdfNoteCollapsed(note, false);
		const pageRect = page.getBoundingClientRect();
		const anchorRect = annotationElement.getBoundingClientRect();
		const pageSize = getPdfPageLayoutSize(page, pageRect);
		const noteWidthPx = Math.max(220, Math.min(360, pageSize.width * 0.3));
		setPdfOverlayStyle(note, "position", "absolute");
		setPdfOverlayStyle(note, "width", `${noteWidthPx}px`);
		setPdfOverlayStyle(note, "inline-size", `${noteWidthPx}px`);
		if (!wasCollapsed) {
			setPdfOverlayStyle(note, "display", "block");
			setPdfOverlayStyle(note, "height", "auto");
			setPdfOverlayStyle(note, "min-height", "76px");
			setPdfOverlayStyle(note, "padding", "12px 14px");
			setPdfOverlayStyle(note, "box-sizing", "border-box");
			setPdfOverlayStyle(note, "font", '15px/1.55 var(--onhand-font-serif, "New York", "Iowan Old Style", Charter, Georgia, serif)');
			setPdfOverlayStyle(note, "overflow", "visible");
			setPdfOverlayStyle(note, "align-items", "normal");
			setPdfOverlayStyle(note, "justify-content", "normal");
			setPdfOverlayStyle(note, "cursor", "auto");
			setPdfOverlayStyle(note, "border-radius", "0 4px 4px 0");
		}
		const measuredHeight = note.getBoundingClientRect().height || note.offsetHeight || 0;
		const noteHeightPx = wasCollapsed ? 30 : Math.max(76, Math.min(240, measuredHeight || 96));
		const positioned = choosePdfNotePosition(page, pageRect, toPdfPageRect(anchorRect, page, pageRect), noteWidthPx, noteHeightPx);
		if (positioned) {
			setPdfOverlayStyle(note, "left", `${positioned.left}px`);
			setPdfOverlayStyle(note, "top", `${positioned.top}px`);
		}
		setPdfOverlayStyle(note, "margin", "0");
		setPdfOverlayStyle(note, "pointer-events", "auto");
		setPdfOverlayStyle(note, "z-index", "21");
		if (wasCollapsed) setPdfNoteCollapsed(note, true);
		else attachPdfNoteInteractions(note, annotationElement);
		return true;
	};

	const rehydratePdfAnnotationRegistry = () => {
		const registry = getPdfAnnotationRegistry();
		let highlights = 0;
		let notes = 0;
		for (const record of registry.values()) {
			const annotationId = String(record?.annotationId || "");
			const pdfAnchor = record?.pdfAnchor;
			if (!annotationId || !pdfAnchor) continue;
				const page = findRenderedPdfPageForAnchor(pdfAnchor);
				if (!(page instanceof HTMLElement)) continue;
			let annotationElement = document.querySelector(annotationSelector(annotationId));
			if (!(annotationElement instanceof HTMLElement)) {
				const restored = createPdfOverlayHighlight(page, pdfAnchor, record.matchedText || pdfAnchor.matchedText || pdfAnchor.textQuote?.exact || "", {
					annotationId,
					register: false,
					scrollIntoView: false,
				});
				annotationElement = restored?.highlight || null;
				if (annotationElement) highlights += 1;
			}
			if (!(annotationElement instanceof HTMLElement) || !record.note?.text) continue;
			if (findNoteForAnnotation(annotationId)) continue;
			const overlayLayer = ensurePdfOverlayLayer(page);
			if (!overlayLayer) continue;
			const note = createPdfNoteElement(annotationId, record.note.text, {
				noteId: record.note.noteId,
				label: record.note.label || "Onhand",
			});
			overlayLayer.appendChild(note);
			positionPdfNoteElement(note, annotationElement, page);
			notes += 1;
		}
		if (notes > 0) schedulePdfOverlayPositionSync();
		return { highlights, notes };
	};

	const syncPdfOverlayPositions = () => {
		rehydratePdfAnnotationRegistry();
		let highlights = 0;
		let notes = 0;
		for (const annotationElement of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]'))) {
			if (!(annotationElement instanceof HTMLElement)) continue;
			const pdfAnchor = parsePdfAnchorFromElement(annotationElement);
			const page = findRenderedPdfPageForAnchor(pdfAnchor) || annotationElement.closest?.(PDF_PAGE_CLOSEST_SELECTOR);
			if (!(page instanceof HTMLElement)) continue;
			if (positionPdfHighlightElement(annotationElement, page, pdfAnchor)) highlights += 1;
			const annotationId = annotationElement.getAttribute("data-onhand-annotation-id") || "";
			const note = annotationId ? findNoteForAnnotation(annotationId) : null;
			if (positionPdfNoteElement(note, annotationElement, page)) notes += 1;
		}
		return { highlights, notes };
	};

	const schedulePdfOverlayPositionSync = () => {
		if (window.__onhandPdfOverlaySyncScheduled) return;
		const runSync = () => {
			window.__onhandPdfOverlaySyncScheduled = 0;
			try {
				syncPdfOverlayPositions();
			} catch {}
		};
		window.__onhandPdfOverlaySyncScheduled = typeof window.requestAnimationFrame === "function"
			? window.requestAnimationFrame(runSync)
			: window.setTimeout(runSync, 0);
	};

	const observePdfOverlayPage = (page) => {
		if (!(page instanceof HTMLElement) || typeof window.ResizeObserver !== "function") return;
		if (!window.__onhandPdfOverlayObservedPages) {
			window.__onhandPdfOverlayObservedPages = new WeakSet();
		}
		if (window.__onhandPdfOverlayObservedPages.has(page)) return;
		if (!window.__onhandPdfOverlayResizeObserver) {
			window.__onhandPdfOverlayResizeObserver = new window.ResizeObserver(schedulePdfOverlayPositionSync);
			window.addEventListener("resize", schedulePdfOverlayPositionSync, { passive: true });
		}
		window.__onhandPdfOverlayObservedPages.add(page);
		window.__onhandPdfOverlayResizeObserver.observe(page);
	};

	const ensurePdfOverlayMutationObserver = () => {
		if (window.__onhandPdfOverlayMutationObserver || typeof window.MutationObserver !== "function") return;
		const root = document.body || document.documentElement;
		if (!root) return;
		window.__onhandPdfOverlayMutationObserver = new window.MutationObserver(() => {
			if (!getPdfAnnotationRegistry().size) return;
			schedulePdfOverlayPositionSync();
		});
		window.__onhandPdfOverlayMutationObserver.observe(root, { childList: true, subtree: true });
	};

	const getRangeClientRects = (range, fallbackRect) => {
		const rects = [];
		try {
			if (typeof range.getClientRects === "function") {
				for (const rect of Array.from(range.getClientRects())) {
					if (rect.width > 0 && rect.height > 0) rects.push(rect);
				}
			}
		} catch {}
		try {
			if (!rects.length && typeof range.getBoundingClientRect === "function") {
				const rect = range.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) rects.push(rect);
			}
		} catch {}
		if (!rects.length && fallbackRect?.width > 0 && fallbackRect?.height > 0) rects.push(fallbackRect);
		return rects;
	};

	let pdfTextMeasureCanvas = null;

	const getPdfTextMeasureContext = () => {
		if (!pdfTextMeasureCanvas) pdfTextMeasureCanvas = document.createElement("canvas");
		return pdfTextMeasureCanvas.getContext?.("2d") || null;
	};

	const measurePdfText = (element, text) => {
		if (!(element instanceof HTMLElement)) return 0;
		const context = getPdfTextMeasureContext();
		if (!context) return 0;
		const style = window.getComputedStyle(element);
		context.font =
			style.font && style.font !== ""
				? style.font
				: `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${style.fontSize || "16px"} ${style.fontFamily || "sans-serif"}`;
		return context.measureText(String(text || "")).width;
	};

	const rangeIntersectsPdfTextNode = (range, node) => {
		try {
			return typeof range.intersectsNode === "function" ? range.intersectsNode(node) : true;
		} catch {
			return false;
		}
	};

	const getPdfTextSegmentClientRects = (range, page) => {
		if (!range || !(page instanceof HTMLElement)) return [];
		const textLayer = getPdfTextLayer(page, { allowPageFallback: true });
		if (!(textLayer instanceof Element)) return [];
		const rects = [];
		const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (!rangeIntersectsPdfTextNode(range, node)) continue;
			const text = node.nodeValue || "";
			const startOffset = node === range.startContainer ? range.startOffset : 0;
			const endOffset = node === range.endContainer ? range.endOffset : text.length;
			if (endOffset <= startOffset) continue;
			const segmentText = text.slice(startOffset, endOffset);
			if (!normalizeText(segmentText)) continue;
			const element = node.parentElement;
			if (!(element instanceof HTMLElement)) continue;
			const spanRect = element.getBoundingClientRect();
			if (!spanRect || spanRect.width <= 0 || spanRect.height <= 0) continue;
			const fullWidth = measurePdfText(element, text);
			const segmentWidth = measurePdfText(element, segmentText);
			if (!fullWidth || !segmentWidth) continue;
			const prefixWidth = measurePdfText(element, text.slice(0, startOffset));
			const left = spanRect.left + (prefixWidth / fullWidth) * spanRect.width;
			const width = Math.min(spanRect.right, left + (segmentWidth / fullWidth) * spanRect.width) - left;
			if (width <= 0) continue;
			rects.push({
				x: left,
				y: spanRect.top,
				left,
				top: spanRect.top,
				right: left + width,
				bottom: spanRect.bottom,
				width,
				height: spanRect.height,
			});
		}
		return rects;
	};

	const getPdfRangeClientRects = (range, page, fallbackRect) => {
		const textSegmentRects = getPdfTextSegmentClientRects(range, page);
		return textSegmentRects.length ? textSegmentRects : getRangeClientRects(range, fallbackRect);
	};

	const ensurePdfOverlayLayer = (page) => {
		if (!(page instanceof HTMLElement)) return null;
		let layer = page.querySelector(":scope > [data-onhand-pdf-overlay-layer]");
		if (layer instanceof HTMLElement) {
			observePdfOverlayPage(page);
			return layer;
		}
		const style = window.getComputedStyle(page);
		if (style.position === "static") page.style.position = "relative";
		layer = document.createElement("div");
		layer.setAttribute("data-onhand-pdf-overlay-layer", "true");
		layer.style.position = "absolute";
		layer.style.inset = "0";
		layer.style.pointerEvents = "none";
		layer.style.zIndex = "20";
		page.appendChild(layer);
		observePdfOverlayPage(page);
		return layer;
	};

	const findPdfPageByNumber = (pageNumber) => {
		const targetPageNumber = Number.parseInt(String(pageNumber || ""), 10);
		if (!Number.isFinite(targetPageNumber) || targetPageNumber <= 0) return null;
		const pages = collectPdfPageElements({ includeGeneric: hasLikelyPdfDocumentSignal() });
		return pages.find((page, index) => getPdfPageNumber(page, index) === targetPageNumber) || null;
	};

	const getPdfPageForNode = (node) => {
		const element = node instanceof Element ? node : node?.parentElement || null;
		if (!(element instanceof Element)) return null;
		return element.closest?.(PDF_PAGE_CLOSEST_SELECTOR) || null;
	};

	const rectIntersectionArea = (a, b) => {
		const left = Math.max(a.left, b.left);
		const right = Math.min(a.right, b.right);
		const top = Math.max(a.top, b.top);
		const bottom = Math.min(a.bottom, b.bottom);
		return Math.max(0, right - left) * Math.max(0, bottom - top);
	};

	const findPdfPageForViewportRect = (rect, fallbackPage = null) => {
		if (!rect || rect.width <= 0 || rect.height <= 0) return fallbackPage;
		let best = null;
		let bestArea = 0;
		for (const page of collectPdfPageElements({ includeGeneric: hasLikelyPdfDocumentSignal() })) {
			const pageRect = page.getBoundingClientRect();
			const area = rectIntersectionArea(rect, pageRect);
			if (area > bestArea) {
				best = page;
				bestArea = area;
			}
		}
		return best || fallbackPage;
	};

	const buildPdfAnchorFromRange = (range, rawText, options = {}) => {
		const matchedText = normalizeText(rawText);
		if (!matchedText || !range) return null;
		const startPage = getPdfPageForNode(range.startContainer);
		const endPage = getPdfPageForNode(range.endContainer);
		const commonPage = getPdfPageForNode(range.commonAncestorContainer);
		const fallbackPage = startPage || endPage || commonPage;
		if (!(fallbackPage instanceof Element)) return null;
		const surface = options.surface || getAnnotationSurfaceInfo();
		if (surface.surface !== "pdf") return null;
		const fallbackLayer = getPdfTextLayer(fallbackPage, { allowPageFallback: surface.likelyPdfDocument });
		const fallbackRect = fallbackLayer?.getBoundingClientRect?.() || fallbackPage.getBoundingClientRect();
		const normalizedRects = getPdfRangeClientRects(range, fallbackPage, fallbackRect)
			.map((rect) => {
				const page = findPdfPageForViewportRect(rect, fallbackPage);
				if (!(page instanceof Element)) return null;
				const pageNumber = getPdfPageNumber(page);
				return normalizePdfRect(rect, page.getBoundingClientRect(), pageNumber);
			})
			.filter((rect) => rect && rect.width > 0 && rect.height > 0);
		if (!normalizedRects.length) return null;
		const primaryPageNumber = Number(normalizedRects[0].pageNumber || getPdfPageNumber(fallbackPage));
		const primaryPage = findPdfPageByNumber(primaryPageNumber) || fallbackPage;
		const textLayerText = getPdfLayerReadableText(getPdfTextLayer(primaryPage, { allowPageFallback: surface.likelyPdfDocument }) || primaryPage);
		const lowerLayerText = lowerText(textLayerText);
		const lowerMatchedText = lowerText(matchedText);
		const index = lowerMatchedText ? lowerLayerText.indexOf(lowerMatchedText) : -1;
		const prefix = index > 0 ? textLayerText.slice(Math.max(0, index - 80), index).trim() : undefined;
		const suffix = index >= 0 ? textLayerText.slice(index + matchedText.length, index + matchedText.length + 80).trim() : undefined;
		return {
			page: primaryPage,
				pdfAnchor: {
					surface: "pdf",
					viewer: surface.viewer || "unknown-pdf",
					document: buildPdfDocumentInfo(surface),
					pageNumber: primaryPageNumber,
				matchedText,
				textQuote: {
					exact: matchedText,
					...(prefix ? { prefix } : {}),
					...(suffix ? { suffix } : {}),
				},
				rects: normalizedRects,
			},
		};
	};

	const buildPdfAnnotationResult = (annotationElement, page, pdfAnchor, rawQuery, options = {}) => {
		const { approximate, fallback, ...extra } = options || {};
		return {
			annotationId: String(annotationElement.getAttribute("data-onhand-annotation-id") || ""),
			kind: "pdf",
			surface: "pdf",
			viewer: pdfAnchor.viewer,
			matchedText: pdfAnchor.matchedText || normalizeText(rawQuery),
			container: summarizeElement(page, { pageNumber: pdfAnchor.pageNumber }),
			rect: rectToObject(annotationElement.getBoundingClientRect()),
			scrollY: window.scrollY,
			approximate: Boolean(approximate),
			fallback: fallback || undefined,
			...extra,
			pdfAnchor,
		};
	};

	const createPdfOverlayHighlight = (page, pdfAnchor, rawQuery, options = {}) => {
		if (!(page instanceof HTMLElement)) return null;
		const rects = Array.isArray(pdfAnchor?.rects) ? pdfAnchor.rects : [];
		const primaryRect = rects.find((rect) => rect && Number(rect.width) > 0 && Number(rect.height) > 0);
		if (!primaryRect) return null;
		const overlayLayer = ensurePdfOverlayLayer(page);
		if (!overlayLayer) return null;
		const annotationId = String(options.annotationId || nextAnnotationId());
		const matchedText = normalizeText(pdfAnchor?.matchedText || pdfAnchor?.textQuote?.exact || rawQuery);
		const pageNumber = getPdfPageNumber(page);
		const anchor = {
			surface: "pdf",
			viewer: pdfAnchor?.viewer || options.viewer || "unknown-pdf",
				document: {
					...buildPdfDocumentInfo(options.surface || {}),
					...(pdfAnchor?.document || {}),
				},
			pageNumber: Number(pdfAnchor?.pageNumber || primaryRect.pageNumber || pageNumber) || pageNumber,
			matchedText,
			textQuote: {
				...(pdfAnchor?.textQuote || {}),
				exact: pdfAnchor?.textQuote?.exact || matchedText,
			},
			rects,
			occurrence: pdfAnchor?.occurrence,
		};
		const highlight = document.createElement("div");
		highlight.setAttribute("data-onhand-highlight-kind", "pdf");
		highlight.setAttribute("data-onhand-annotation-id", annotationId);
		highlight.setAttribute("data-onhand-matched-text", matchedText);
		highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(anchor));
		applyAnnotationThemeToElement(highlight);
		positionPdfHighlightElement(highlight, page, anchor);
		bindPdfAnnotationNoteTrigger(highlight, annotationId);
		overlayLayer.appendChild(highlight);
		if (options.register !== false) {
			registerPdfAnnotationRecord(annotationId, {
				matchedText,
				pdfAnchor: anchor,
			});
		}
		return { highlight, pdfAnchor: anchor };
	};

	const getPdfAnchorComparableText = (pdfAnchor, fallback = "") =>
		compactHighlightSearchText(pdfAnchor?.matchedText || pdfAnchor?.textQuote?.exact || fallback || "");

	const getPdfAnchorPageNumber = (pdfAnchor) => {
		const directPage = Number(pdfAnchor?.pageNumber || "");
		if (Number.isFinite(directPage) && directPage > 0) return directPage;
		const rect = Array.isArray(pdfAnchor?.rects)
			? pdfAnchor.rects.find((candidate) => Number(candidate?.pageNumber) > 0)
			: null;
		const rectPage = Number(rect?.pageNumber || "");
		return Number.isFinite(rectPage) && rectPage > 0 ? rectPage : null;
	};

	const getPdfAnchorDocumentUrl = (pdfAnchor) => String(pdfAnchor?.document?.pdfUrl || pdfAnchor?.document?.url || "").trim();

	const pdfAnnotationMatchesReplayTarget = (annotationElement, rawQuery, options = {}, occurrence = 1) => {
		if (!(annotationElement instanceof Element)) return false;
		const targetAnchor = options.pdfAnchor || null;
		const existingAnchor = parsePdfAnchorFromElement(annotationElement);
		const targetPage = getPdfAnchorPageNumber(targetAnchor);
		const existingPage = getPdfAnchorPageNumber(existingAnchor) || getPdfPageNumber(annotationElement.closest?.(PDF_PAGE_CLOSEST_SELECTOR));
		if (targetPage && existingPage && targetPage !== existingPage) return false;
		const targetUrl = getPdfAnchorDocumentUrl(targetAnchor);
		const existingUrl = getPdfAnchorDocumentUrl(existingAnchor);
		if (targetUrl && existingUrl && targetUrl !== existingUrl) return false;
		const targetText = getPdfAnchorComparableText(targetAnchor, rawQuery);
		const existingText = getPdfAnchorComparableText(existingAnchor, annotationElement.getAttribute("data-onhand-matched-text") || "");
		if (targetText && existingText && targetText !== existingText && !targetText.includes(existingText) && !existingText.includes(targetText)) return false;
		const targetOccurrence = Number(targetAnchor?.occurrence || options.occurrence || occurrence || 1);
		const existingOccurrence = Number(existingAnchor?.occurrence || 1);
		if (
			Number.isFinite(targetOccurrence) &&
			Number.isFinite(existingOccurrence) &&
			targetOccurrence > 0 &&
			existingOccurrence > 0 &&
			targetOccurrence !== existingOccurrence
		) {
			return false;
		}
		return Boolean(targetText || existingText);
	};

	const findExistingPdfAnnotation = (rawQuery, options = {}, occurrence = 1) => {
		for (const annotationElement of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]'))) {
			if (pdfAnnotationMatchesReplayTarget(annotationElement, rawQuery, options, occurrence)) return annotationElement;
		}
		return null;
	};

	const removePdfOverlayAnnotation = (annotationElement) => {
		if (!(annotationElement instanceof Element)) return false;
		const annotationId = String(annotationElement.getAttribute("data-onhand-annotation-id") || "");
		if (annotationId) {
			removeNotesForAnnotation(annotationId);
			for (const segment of Array.from(document.querySelectorAll(`[data-onhand-pdf-segment-for="${attrEscape(annotationId)}"]`))) {
				segment.remove();
			}
			getPdfAnnotationRegistry().delete(annotationId);
		}
		annotationElement.remove();
		for (const layer of Array.from(document.querySelectorAll("[data-onhand-pdf-overlay-layer]"))) {
			if (!layer.querySelector('[data-onhand-highlight-kind="pdf"], [data-onhand-pdf-segment-kind="highlight"], [data-onhand-note-kind="card"]')) {
				layer.remove();
			}
		}
		return true;
	};

	const removeDuplicatePdfAnnotations = (keeper, rawQuery, options = {}, occurrence = 1) => {
		let removed = 0;
		for (const annotationElement of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]'))) {
			if (annotationElement === keeper) continue;
			if (!pdfAnnotationMatchesReplayTarget(annotationElement, rawQuery, options, occurrence)) continue;
			if (removePdfOverlayAnnotation(annotationElement)) removed += 1;
		}
		return removed;
	};

	const restorePdfAnchorHighlight = async (pdfAnchor, rawQuery, options = {}) => {
		if (!pdfAnchor || typeof pdfAnchor !== "object") return null;
		const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || pdfAnchor.occurrence || 1) || 1));
		if (options.reuseExisting === true) {
			const existing = findExistingPdfAnnotation(rawQuery, { ...options, pdfAnchor }, occurrence);
			if (existing instanceof HTMLElement) {
				const existingAnchor = parsePdfAnchorFromElement(existing) || pdfAnchor;
				const existingPage = findRenderedPdfPageForAnchor(existingAnchor) || existing.closest?.(PDF_PAGE_CLOSEST_SELECTOR);
				if (!(existingPage instanceof HTMLElement)) return null;
				const duplicateCount = removeDuplicatePdfAnnotations(existing, rawQuery, { ...options, pdfAnchor }, occurrence);
				positionPdfHighlightElement(existing, existingPage, existingAnchor);
				if (options.scrollIntoView !== false) {
					existing.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
					await ensureElementInViewport(existing, "center");
				} else {
					await waitForLayout();
				}
				return buildPdfAnnotationResult(existing, existingPage, existingAnchor, rawQuery, {
					fallback: "pdf-anchor",
					reusedExisting: true,
					...(duplicateCount ? { duplicateCount } : {}),
				});
			}
		}
		const page = findRenderedPdfPageForAnchor(pdfAnchor);
		if (!page) return null;
		ensureAnnotationStyles();
		const restored = createPdfOverlayHighlight(page, pdfAnchor, rawQuery, options);
		if (!restored) return null;
		if (options.scrollIntoView !== false) {
			restored.highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
			await ensureElementInViewport(restored.highlight, "center");
		} else {
			await waitForLayout();
		}
		return buildPdfAnnotationResult(restored.highlight, page, restored.pdfAnchor, rawQuery, {
			fallback: "pdf-anchor",
		});
	};

	const findExistingPdfAnnotationByText = (rawQuery, occurrence = 1) => {
		const query = compactHighlightSearchText(rawQuery);
		if (!query) return null;
		let matchIndex = 0;
		for (const annotationElement of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]'))) {
			if (!(annotationElement instanceof Element)) continue;
			const text = getPdfAnchorComparableText(parsePdfAnchorFromElement(annotationElement), annotationElement.getAttribute("data-onhand-matched-text") || "");
			if (text !== query) continue;
			matchIndex += 1;
			if (matchIndex === occurrence) return annotationElement;
		}
		return null;
	};

	const findPdfTextRange = (textLayer, rawQuery, occurrence = 1) => {
		const textNodes = collectHighlightTextNodes(textLayer, { excludePdfViewerUi: true });
		if (!textNodes.length) return null;
		const mappedText = buildNormalizedTextMap(textNodes);
		const normalizedQuery = lowerText(rawQuery);
		const searchQuery = normalizeHighlightSearchText(rawQuery);
		const compactQuery = compactHighlightSearchText(rawQuery);
		const useCompactQuery = compactQuery.length >= (isMathLikeHighlightQuery(rawQuery) ? 3 : 12);
		const modes = [
			{ text: mappedText.lowerText, positions: mappedText.positions, query: normalizedQuery, fallback: null },
			{ text: mappedText.searchText, positions: mappedText.searchPositions, query: searchQuery, fallback: "normalized-text" },
			...(useCompactQuery
				? [
						{
							text: mappedText.compactText,
							positions: mappedText.compactPositions,
							query: compactQuery,
							fallback: isMathLikeHighlightQuery(rawQuery) ? "compact-math-text" : "compact-text",
						},
					]
				: []),
		];
		for (const mode of modes) {
			if (!mode.query || !mode.text.includes(mode.query)) continue;
			let searchFrom = 0;
			let matchIndex = 0;
			while (searchFrom <= mode.text.length) {
				const foundAt = mode.text.indexOf(mode.query, searchFrom);
				if (foundAt === -1) break;
				matchIndex += 1;
				if (matchIndex === occurrence) {
					const start = mode.positions[foundAt];
					const end = mode.positions[foundAt + mode.query.length - 1];
					if (!start || !end) break;
					const range = document.createRange();
					range.setStart(start.node, start.offset);
					range.setEnd(end.node, getRangeEndOffset(end));
					return {
						range,
						matchedText: normalizeText(range.toString()) || normalizeText(rawQuery),
						fallback: mode.fallback || undefined,
					};
				}
				searchFrom = foundAt + Math.max(mode.query.length, 1);
			}
		}
		return null;
	};

	const collectPdfSearchPages = (options = {}) => {
		const viewportCenter = window.innerHeight / 2;
		return collectPdfPageElements({ includeGeneric: options.includeGeneric === true })
			.map((page, index) => {
				const rect = page.getBoundingClientRect();
				const visible = rect.bottom > 0 && rect.top < window.innerHeight;
				const center = rect.top + rect.height / 2;
				return {
					page,
					index,
					visible,
					distance: Math.abs(center - viewportCenter),
				};
			})
			.sort((a, b) => {
				if (a.visible !== b.visible) return a.visible ? -1 : 1;
				if (a.visible && b.visible && a.distance !== b.distance) return a.distance - b.distance;
				return a.index - b.index;
			});
	};

	const highlightPdfText = async (query, options = {}) => {
		const rawQuery = String(query ?? "").trim();
		if (!rawQuery) throw new Error("highlightPdfText requires a non-empty query");
		const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
		const scrollIntoView = options.scrollIntoView !== false;
		ensureAnnotationStyles();
		if (options.clearExisting === true) clearAnnotations();
		else syncPdfOverlayPositions();
		const restoredFromAnchor = await restorePdfAnchorHighlight(options.pdfAnchor, rawQuery, options);
		if (restoredFromAnchor) return restoredFromAnchor;
		if (options.reuseExisting) {
			const existing = findExistingPdfAnnotationByText(rawQuery, occurrence);
			if (existing) {
				const page = existing.closest?.(PDF_PAGE_CLOSEST_SELECTOR) || existing;
				const pdfAnchor = JSON.parse(existing.getAttribute("data-onhand-pdf-anchor") || "{}");
				return buildPdfAnnotationResult(existing, page, pdfAnchor, rawQuery, { reusedExisting: true });
			}
		}
		const surface = options.surface || getAnnotationSurfaceInfo();
		for (const { page, index } of collectPdfSearchPages({ includeGeneric: surface.likelyPdfDocument })) {
			const textLayer = getPdfTextLayer(page, { allowPageFallback: surface.likelyPdfDocument });
			if (!textLayer) continue;
			const match = findPdfTextRange(textLayer, rawQuery, occurrence);
			if (!match) continue;
			const pageNumber = getPdfPageNumber(page, index);
			const pageRect = page.getBoundingClientRect();
			const fallbackRect = textLayer.getBoundingClientRect();
			const rects = getPdfRangeClientRects(match.range, page, fallbackRect).map((rect) => normalizePdfRect(rect, pageRect, pageNumber));
			if (!rects.length) continue;
			const overlayLayer = ensurePdfOverlayLayer(page);
			if (!overlayLayer) continue;
			const annotationId = nextAnnotationId();
			const highlight = document.createElement("div");
			highlight.setAttribute("data-onhand-highlight-kind", "pdf");
			highlight.setAttribute("data-onhand-annotation-id", annotationId);
			highlight.setAttribute("data-onhand-matched-text", match.matchedText);
			const pdfAnchor = {
				surface: "pdf",
				viewer: surface.viewer || "unknown-pdf",
				document: {
					...buildPdfDocumentInfo(surface),
				},
				pageNumber,
				matchedText: match.matchedText,
				textQuote: {
					exact: match.matchedText,
				},
				rects,
				occurrence,
			};
			highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(pdfAnchor));
			applyAnnotationThemeToElement(highlight);
			positionPdfHighlightElement(highlight, page, pdfAnchor);
			bindPdfAnnotationNoteTrigger(highlight, annotationId);
			overlayLayer.appendChild(highlight);
			registerPdfAnnotationRecord(annotationId, {
				matchedText: match.matchedText,
				pdfAnchor,
			});
			if (scrollIntoView) {
				highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
				await ensureElementInViewport(highlight, "center");
			} else {
				await waitForLayout();
			}
			return buildPdfAnnotationResult(highlight, page, pdfAnchor, rawQuery, {
				approximate: Boolean(match.fallback),
				fallback: match.fallback,
			});
		}
		throw new Error(`No visible PDF text matched: ${query}`);
	};

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
		if (annotationElement.getAttribute("data-onhand-highlight-kind") === "pdf") {
			return annotationElement.closest(PDF_PAGE_CLOSEST_SELECTOR) || annotationElement;
		}
		return annotationElement.closest(ANNOTATION_CONTAINER_SELECTOR) || annotationElement.parentElement || annotationElement;
	};

	const NOTE_NARROW_CONTEXT_WIDTH = 300;
	const NOTE_READABLE_CONTEXT_WIDTH = 380;

	const getElementWidth = (element) => {
		if (!(element instanceof Element)) return 0;
		const rect = element.getBoundingClientRect();
		return Math.max(0, rect.width || element.clientWidth || 0);
	};

	const widenNarrowNotePlacement = (placement) => {
		const target = placement?.target;
		if (!(target instanceof Element)) return placement;
		const targetWidth = getElementWidth(target);
		if (!targetWidth || targetWidth >= NOTE_NARROW_CONTEXT_WIDTH) return placement;
		for (let current = target.parentElement; current && current !== document.body; current = current.parentElement) {
			if (!(current instanceof Element)) continue;
			if (current.matches?.("html, body, table, tr, tbody, thead, tfoot")) continue;
			const width = getElementWidth(current);
			if (width >= NOTE_READABLE_CONTEXT_WIDTH) {
				return { target: current, position: "afterend" };
			}
		}
		return placement;
	};

	const findNoteInsertionPlacement = (container) => {
		if (!(container instanceof Element)) return { target: container, position: "afterend" };
		const tag = container.tagName;
		if (tag === "CODE") {
			const pre = container.closest("pre");
			if (pre) return widenNarrowNotePlacement({ target: pre, position: "afterend" });
			const blockAncestor = container.parentElement?.closest(ANNOTATION_CONTAINER_SELECTOR);
			if (blockAncestor) return findNoteInsertionPlacement(blockAncestor);
		}
		if (tag === "CAPTION") {
			const table = container.closest("table");
			if (table) return widenNarrowNotePlacement({ target: table, position: "afterend" });
		}
		if (tag === "LI" || tag === "TD" || tag === "TH") {
			return widenNarrowNotePlacement({ target: container, position: "beforeend" });
		}
		const parent = container.parentElement;
		if (!(parent instanceof Element)) return widenNarrowNotePlacement({ target: container, position: "afterend" });
		const isHeading = /^H[1-6]$/.test(tag);
		const hasPermalinkSibling = Array.from(parent.children).some((child) =>
			child !== container && child.matches?.("a.anchor, .anchor")
		);
		// GitHub renders markdown headings as a wrapper with a sibling permalink anchor.
		// Insert notes after the wrapper so captions do not split the heading/link row.
		if (isHeading && parent.classList.contains("markdown-heading") && hasPermalinkSibling) {
			return widenNarrowNotePlacement({ target: parent, position: "afterend" });
		}
		return widenNarrowNotePlacement({ target: container, position: "afterend" });
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

	const collectHighlightTextNodes = (root, options = {}) => {
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
					if (parent.closest(ONHAND_ANNOTATION_DOM_SELECTOR)) return NodeFilter.FILTER_REJECT;
					if (options.excludePdfViewerUi === true && parent.closest(PDF_VIEWER_UI_TEXT_EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
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

	const HIGHLIGHT_CHARACTER_ALIASES = new Map(
		Object.entries({
			"₀": "0",
			"₁": "1",
			"₂": "2",
			"₃": "3",
			"₄": "4",
			"₅": "5",
			"₆": "6",
			"₇": "7",
			"₈": "8",
			"₉": "9",
			"⁰": "0",
			"¹": "1",
			"²": "2",
			"³": "3",
			"⁴": "4",
			"⁵": "5",
			"⁶": "6",
			"⁷": "7",
			"⁸": "8",
			"⁹": "9",
			"ₐ": "a",
			"ₑ": "e",
			"ₕ": "h",
			"ᵢ": "i",
			"ⱼ": "j",
			"ₖ": "k",
			"ₗ": "l",
			"ₘ": "m",
			"ₙ": "n",
			"ₒ": "o",
			"ₚ": "p",
			"ᵣ": "r",
			"ₛ": "s",
			"ₜ": "t",
			"ᵤ": "u",
			"ᵥ": "v",
			"ₓ": "x",
			"ᵃ": "a",
			"ᵇ": "b",
			"ᶜ": "c",
			"ᵈ": "d",
			"ᵉ": "e",
			"ᶠ": "f",
			"ᵍ": "g",
			"ʰ": "h",
			"ⁱ": "i",
			"ʲ": "j",
			"ᵏ": "k",
			"ˡ": "l",
			"ᵐ": "m",
			"ⁿ": "n",
			"ᵒ": "o",
			"ᵖ": "p",
			"ʳ": "r",
			"ˢ": "s",
			"ᵗ": "t",
			"ᵘ": "u",
			"ᵛ": "v",
			"ʷ": "w",
			"ˣ": "x",
			"ʸ": "y",
			"ᶻ": "z",
			"√": "sqrt",
			"−": "-",
			"‐": "-",
			"‑": "-",
			"‒": "-",
			"–": "-",
			"—": "-",
			"―": "-",
			"“": '"',
			"”": '"',
			"„": '"',
			"‟": '"',
			"‘": "'",
			"’": "'",
			"‚": "'",
			"‛": "'",
			"…": "...",
			"×": "x",
			"∗": "*",
		}),
	);
	const HIGHLIGHT_SEARCH_IGNORED_CHARACTERS = new Set(["`"]);

	const normalizeHighlightSearchFragment = (character) => {
		if (HIGHLIGHT_SEARCH_IGNORED_CHARACTERS.has(character)) return "";
		const aliased = HIGHLIGHT_CHARACTER_ALIASES.get(character);
		if (aliased) return aliased;
		return String(character || "")
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[\u200b-\u200f\u2060-\u206f]/g, "");
	};

	const buildSearchProjection = (text, positions = []) => {
		let searchText = "";
		const searchPositions = [];
		let pendingSpace;

		const appendSearchCharacter = (character, position) => {
			if (!character) return;
			if (/\s/.test(character)) {
				if (searchText && pendingSpace === undefined) pendingSpace = position || null;
				return;
			}
			if (pendingSpace !== undefined) {
				searchText += " ";
				searchPositions.push(pendingSpace);
				pendingSpace = undefined;
			}
			searchText += character.toLowerCase();
			searchPositions.push(position);
		};

		const source = String(text || "");
		for (let index = 0; index < source.length; ) {
			const character = String.fromCodePoint(source.codePointAt(index));
			const position = positions[index] || null;
			const normalized = normalizeHighlightSearchFragment(character);
			for (const normalizedCharacter of normalized) {
				appendSearchCharacter(normalizedCharacter, position);
			}
			index += character.length;
		}

		let compactText = "";
		const compactPositions = [];
		for (let index = 0; index < searchText.length; index += 1) {
			if (!/[a-z0-9]/.test(searchText[index])) continue;
			compactText += searchText[index];
			compactPositions.push(searchPositions[index]);
		}

		return { searchText, searchPositions, compactText, compactPositions };
	};

	const getRangeEndOffset = (position) => position?.endOffset ?? (position?.offset ?? 0) + 1;

	const normalizeHighlightSearchText = (value) => buildSearchProjection(String(value || "").replace(/\s+/g, " ").trim()).searchText;

	const compactHighlightSearchText = (value) => buildSearchProjection(String(value || "").replace(/\s+/g, " ").trim()).compactText;

	const stripTexMarkupForSearch = (value) => {
		let text = String(value || "");
		if (!text.trim()) return "";
		for (let index = 0; index < 6; index += 1) {
			const replaced = text.replace(
				/\\(?:bf|mathbf|boldsymbol|mathit|mathrm|mathcal|mathbb|mathsf|mathtt|rm|cal|it|text|operatorname)\s*\{([^{}]*)\}/g,
				"$1",
			);
			if (replaced === text) break;
			text = replaced;
		}
		return text
			.replace(/\$\$/g, " ")
			.replace(/\$/g, " ")
			.replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, " ")
			.replace(/\\(?:quad|qquad)\b/g, " ")
			.replace(/\\[,;!:]/g, " ")
			.replace(/\\(?:vert|mid)\b/g, "|")
			.replace(/\\(?:to|rightarrow)\b/g, "->")
			.replace(/\\(?:times|cdot)\b/g, "*")
			.replace(/\\infty\b/g, "infty")
			.replace(/\\[a-zA-Z]+\b/g, " ")
			.replace(/[{}]/g, " ");
	};

	const normalizeMathSourceSearchText = (value) => normalizeHighlightSearchText(stripTexMarkupForSearch(value));

	const compactMathSourceSearchText = (value) => compactHighlightSearchText(stripTexMarkupForSearch(value));

	const isMathLikeHighlightQuery = (value) => {
		const text = String(value || "").trim();
		if (!text) return false;
		if (/[=()[\]{}_^√∑∏∫+\-*\/\\]|[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/u.test(text)) return true;
		const compact = text.replace(/\s+/g, "");
		return /^[A-Z][A-Za-z0-9]{1,10}$/.test(compact);
	};

	const pageHasRawTexSource = () => {
		const text = document.body?.textContent || "";
		return /(?:\$\$|\\\(|\\\[|\\begin\{)/.test(text);
	};

	const pageHasRenderedMath = () => Boolean(document.querySelector(`${MATH_CONTAINER_SELECTOR}, script[type^="math/tex"]`));

	const waitForMathTypesetting = async (rawQuery) => {
		if (!isMathLikeHighlightQuery(rawQuery)) return;
		if (!pageHasRawTexSource() && !window.MathJax) return;

		const wait = (timeoutMs) => new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
		const waitForMathJaxQueue = async () => {
			const mathJax = window.MathJax;
			if (!mathJax) return false;
			let queued = false;
			await Promise.race([
				new Promise((resolve) => {
					const done = () => resolve(true);
					try {
						if (mathJax.startup?.promise?.then) {
							queued = true;
							mathJax.startup.promise.then(done, done);
						} else if (mathJax.Hub?.Queue) {
							queued = true;
							mathJax.Hub.Queue(done);
						} else if (mathJax.typesetPromise) {
							queued = true;
							mathJax.typesetPromise().then(done, done);
						} else {
							done();
						}
					} catch {
						done();
					}
				}),
				wait(2500).then(() => false),
			]);
			return queued;
		};

		const startedAt = Date.now();
		while (!window.MathJax && pageHasRawTexSource() && Date.now() - startedAt < 2500) {
			await wait(100);
		}
		await waitForMathJaxQueue();
		for (let attempt = 0; attempt < 20; attempt += 1) {
			if (pageHasRenderedMath()) break;
			if (!pageHasRawTexSource()) break;
			await wait(100);
		}
		await waitForLayout();
	};

	const tokenizeNormalizedText = (value) =>
		normalizeHighlightSearchText(value)
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
		const querySearch = normalizeHighlightSearchText(rawQuery);
		const queryCompact = compactHighlightSearchText(rawQuery);
		const useCompact = queryCompact.length >= (isMathLikeHighlightQuery(rawQuery) ? 3 : 12);
		const queryTokens = tokenizeApproximateQuery(rawQuery);
		const minimumOverlap = Math.min(2, queryTokens.length);
		for (const container of root.querySelectorAll(`${ANNOTATION_CONTAINER_SELECTOR}, ${MATH_CONTAINER_SELECTOR}`)) {
			if (!(container instanceof Element)) continue;
			if (!isVisible(container)) continue;
			if (container.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR)) continue;
			if (container.closest('[data-onhand-highlight-kind]')) continue;
			const text = lowerText(getElementText(container));
			if (!text) continue;
			const searchText = normalizeHighlightSearchText(text);
			const compactText = compactHighlightSearchText(text);
			if (!text.includes(queryLower) && !searchText.includes(querySearch) && !(useCompact && compactText.includes(queryCompact))) {
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
			for (let offset = 0; offset < value.length; ) {
				const character = String.fromCodePoint(value.codePointAt(offset));
				const position = { node, offset, endOffset: offset + character.length };
				if (/\s/.test(character)) {
					if (hasContent && !pendingSpace) {
						pendingSpace = position;
					}
					offset += character.length;
					continue;
				}

				if (pendingSpace) {
					text += " ";
					positions.push(pendingSpace);
					pendingSpace = null;
				}

				text += character;
				for (let unit = 0; unit < character.length; unit += 1) {
					positions.push(position);
				}
				hasContent = true;
				offset += character.length;
			}
		}

		const searchProjection = buildSearchProjection(text, positions);
		return {
			text,
			lowerText: text.toLowerCase(),
			positions,
			searchText: searchProjection.searchText,
			searchPositions: searchProjection.searchPositions,
			compactText: searchProjection.compactText,
			compactPositions: searchProjection.compactPositions,
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

	const buildSearchTokenRanges = (mappedText) => {
		const positionToTextIndex = new Map();
		(mappedText.positions || []).forEach((position, index) => {
			if (position && !positionToTextIndex.has(position)) positionToTextIndex.set(position, index);
		});
		const tokens = [];
		const pattern = /[a-z0-9]{2,}/g;
		let match;
		while ((match = pattern.exec(mappedText.searchText || ""))) {
			const token = match[0];
			const startPosition = mappedText.searchPositions?.[match.index];
			const endPosition = mappedText.searchPositions?.[pattern.lastIndex - 1];
			const startIndex = positionToTextIndex.get(startPosition);
			const endIndex = positionToTextIndex.get(endPosition);
			if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) continue;
			tokens.push({
				token,
				startIndex,
				endIndex: endIndex + 1,
			});
		}
		return tokens;
	};

	const findBestTokenWindowHighlightRange = (mappedText, query) => {
		const queryTokens = tokenizeApproximateQuery(query);
		if (queryTokens.length < 2) return null;
		const queryTokenSet = new Set(queryTokens);
		const primaryToken = queryTokens[0] || null;
		const pageTokens = buildSearchTokenRanges(mappedText).filter((entry) => entry.token.length >= 2);
		if (!pageTokens.length) return null;

		const maxWindowTokens = Math.min(32, Math.max(8, queryTokens.length + 10));
		let best = null;
		for (let startTokenIndex = 0; startTokenIndex < pageTokens.length; startTokenIndex += 1) {
			const matched = new Set();
			for (let endTokenIndex = startTokenIndex; endTokenIndex < pageTokens.length && endTokenIndex < startTokenIndex + maxWindowTokens; endTokenIndex += 1) {
				const token = pageTokens[endTokenIndex].token;
				if (queryTokenSet.has(token)) matched.add(token);
				if (!matched.size) continue;
				const windowTokenCount = endTokenIndex - startTokenIndex + 1;
				const overlap = matched.size;
				const coverage = overlap / queryTokens.length;
				const density = overlap / Math.max(windowTokenCount, 1);
				const hasPrimary = Boolean(primaryToken && matched.has(primaryToken));
				if (overlap < Math.min(3, queryTokens.length) && coverage < 0.7) continue;
				if (!hasPrimary && coverage < 0.75) continue;
				const startIndex = pageTokens[startTokenIndex].startIndex;
				const endIndex = pageTokens[endTokenIndex].endIndex;
				const text = mappedText.text.slice(startIndex, endIndex).trim();
				if (text.length < 12) continue;
				const score = overlap * 150 + coverage * 80 + density * 45 + (hasPrimary ? 25 : 0) - text.length * 0.015;
				if (!best || score > best.score) {
					best = { startIndex, endIndex, overlap, coverage, score, text };
				}
			}
		}
		return best;
	};

	const findBestApproximateHighlightRange = (mappedText, query) => {
		const queryTokens = tokenizeApproximateQuery(query);
		if (queryTokens.length < 2) return null;
		const tokenSet = new Set(queryTokens);
		let best = findBestTokenWindowHighlightRange(mappedText, query);
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
		applyAnnotationThemeToElement(highlight);
		try {
			range.surroundContents(highlight);
		} catch {
			const fragment = range.extractContents();
			highlight.appendChild(fragment);
			range.insertNode(highlight);
		}
		return highlight;
	};

	const getListItemAncestorsForNode = (node) => {
		const element = node instanceof Element ? node : node?.parentElement;
		const ancestors = [];
		for (let current = element; current && current !== document.body; current = current.parentElement) {
			if (current instanceof HTMLLIElement) ancestors.push(current);
		}
		return ancestors;
	};

	const getSharedListItemForRange = (range) => {
		const startItems = getListItemAncestorsForNode(range.startContainer);
		const endItems = getListItemAncestorsForNode(range.endContainer);
		for (const item of startItems) {
			if (endItems.includes(item)) return item;
		}
		return null;
	};

	const rangeIncludesListStructure = (range) => {
		try {
			return Boolean(range.cloneContents()?.querySelector?.("ol, ul, li"));
		} catch {
			return false;
		}
	};

	const findStructuredRangeHighlightElement = (range) => {
		if (!rangeIncludesListStructure(range)) return null;
		const sharedListItem = getSharedListItemForRange(range);
		if (sharedListItem && isVisible(sharedListItem)) return sharedListItem;
		const common =
			range.commonAncestorContainer instanceof Element
				? range.commonAncestorContainer
				: range.commonAncestorContainer?.parentElement;
		const listContainer = common?.closest?.("li, ol, ul") || common?.querySelector?.("li, ol, ul") || null;
		return listContainer instanceof Element && isVisible(listContainer) ? listContainer : null;
	};

	const findNoteForAnnotation = (annotationId) => {
		const note = document.querySelector(`[data-onhand-note-for="${attrEscape(annotationId)}"]`);
		return note instanceof Element ? note : null;
	};

	const buildAnnotationResult = (annotationElement, rawQuery, options = {}) => {
		const annotationId = String(annotationElement.getAttribute("data-onhand-annotation-id") || "");
		const kind = String(annotationElement.getAttribute("data-onhand-highlight-kind") || "inline");
		return {
			annotationId,
			kind,
			matchedText: getElementText(annotationElement).slice(0, 500) || normalizeText(rawQuery),
			container: summarizeElement(findAnnotationContainer(annotationElement)),
			rect: rectToObject(annotationElement.getBoundingClientRect()),
			scrollY: window.scrollY,
			approximate: Boolean(options.approximate),
			fallback: options.fallback || undefined,
			reusedExisting: Boolean(options.reusedExisting),
		};
	};

	const findExistingAnnotationByText = (rawQuery, occurrence = 1) => {
		const normalizedQuery = lowerText(rawQuery);
		const searchQuery = normalizeHighlightSearchText(rawQuery);
		const compactQuery = compactHighlightSearchText(rawQuery);
		const useCompactQuery = compactQuery.length >= (isMathLikeHighlightQuery(rawQuery) ? 3 : 12);
		if (!normalizedQuery && !searchQuery && !compactQuery) return null;
		let matchIndex = 0;
		for (const annotationElement of Array.from(document.querySelectorAll("[data-onhand-highlight-kind]"))) {
			if (!(annotationElement instanceof Element)) continue;
			if (!isVisible(annotationElement)) continue;
			const text = getElementText(annotationElement);
			if (!text) continue;
			const lower = lowerText(text);
			const searchText = normalizeHighlightSearchText(text);
			const compactText = compactHighlightSearchText(text);
			let fallback = "existing-annotation";
			let matched = lower.includes(normalizedQuery);
			if (!matched && searchQuery && searchText.includes(searchQuery)) {
				matched = true;
				fallback = "existing-normalized-text";
			}
			if (!matched && useCompactQuery && compactText.includes(compactQuery)) {
				matched = true;
				fallback = isMathLikeHighlightQuery(rawQuery) ? "existing-compact-math-text" : "existing-compact-text";
			}
			if (!matched) continue;
			matchIndex += 1;
			if (matchIndex === occurrence) return { annotationElement, fallback };
		}
		return null;
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
		getPdfAnnotationRegistry().clear();
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
			element.removeAttribute("data-onhand-theme");
			clearedBlock += 1;
		}

			let clearedPdf = 0;
			for (const element of Array.from(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]'))) {
				element.remove();
				clearedPdf += 1;
			}
			let clearedPdfSegments = 0;
			for (const element of Array.from(document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]'))) {
				element.remove();
				clearedPdfSegments += 1;
			}
			for (const layer of Array.from(document.querySelectorAll("[data-onhand-pdf-overlay-layer]"))) {
				if (!layer.querySelector('[data-onhand-highlight-kind="pdf"], [data-onhand-pdf-segment-kind="highlight"], [data-onhand-note-kind="card"]')) {
					layer.remove();
				}
			}

			return {
			clearedNotes,
				clearedInline,
				clearedBlock,
				clearedPdf,
				clearedPdfSegments,
				clearedTotal: clearedNotes + clearedInline + clearedBlock + clearedPdf + clearedPdfSegments,
			};
		};

	const highlightBlockElement = async (element, rawQuery, options = {}) => {
		if (!(element instanceof Element)) return null;
		const annotationId = nextAnnotationId();
		element.setAttribute("data-onhand-highlight-kind", "block");
		element.setAttribute("data-onhand-annotation-id", annotationId);
		applyAnnotationThemeToElement(element);
		if (options.scrollIntoView !== false) {
			element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
		}
		await waitForLayout();
		return {
			annotationId,
			kind: "block",
			matchedText: getElementText(element).slice(0, 500) || normalizeText(rawQuery),
			container: summarizeElement(findAnnotationContainer(element)),
			rect: rectToObject(element.getBoundingClientRect()),
			scrollY: window.scrollY,
			approximate: Boolean(options.approximate),
			fallback: options.fallback || undefined,
		};
	};

	const highlightRange = async (range, rawQuery, options = {}) => {
		const structuredElement = findStructuredRangeHighlightElement(range);
		if (structuredElement) {
			return await highlightBlockElement(structuredElement, rawQuery, {
				scrollIntoView: options.scrollIntoView,
				approximate: options.approximate,
				fallback: options.fallback,
			});
		}
		const annotationId = nextAnnotationId();
		const highlight = wrapRangeInHighlight(range, annotationId);
		if (options.scrollIntoView !== false) {
			highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
		}
		await waitForLayout();
		return {
			annotationId,
			kind: "inline",
			matchedText: getElementText(highlight).slice(0, 500) || normalizeText(options.fallbackText || rawQuery),
			container: summarizeElement(findAnnotationContainer(highlight)),
			rect: rectToObject(highlight.getBoundingClientRect()),
			scrollY: window.scrollY,
			approximate: Boolean(options.approximate),
			fallback: options.fallback || undefined,
		};
	};

	const getMathElementComparableText = (element) => {
		if (!(element instanceof Element)) return "";
		const parts = [
			getElementText(element),
			element.getAttribute("aria-label"),
			element.getAttribute("data-latex"),
			element.getAttribute("data-tex"),
			element.getAttribute("alttext"),
		];
		for (const annotation of element.querySelectorAll("annotation, annotation-xml")) {
			parts.push(annotation.textContent || "");
		}
		return parts.filter(Boolean).join(" ");
	};

	const isMathTexScript = (element) => {
		if (!(element instanceof Element)) return false;
		if (element.tagName.toLowerCase() !== "script") return false;
		return /^math\/tex\b/i.test(String(element.getAttribute("type") || ""));
	};

	const findPreviousMathTexScript = (element) => {
		let current = element instanceof Element ? element : null;
		for (let index = 0; current && index < 12; index += 1) {
			current = current.previousElementSibling;
			if (!current) break;
			if (isMathTexScript(current)) return current;
			const nested = current.querySelector?.('script[type^="math/tex"]');
			if (nested instanceof Element && isMathTexScript(nested)) return nested;
		}
		return null;
	};

	const findRenderedMathTargetForScript = (script) => {
		if (!isMathTexScript(script)) return null;
		const scriptId = script.getAttribute("id") || "";
		if (scriptId) {
			const frame = document.getElementById(`${scriptId}-Frame`);
			if (frame instanceof Element && isVisible(frame)) {
				return frame.closest(".MathJax_Display, mjx-container, .katex, .math") || frame;
			}
		}
		let current = script.nextElementSibling;
		for (let index = 0; current && index < 8; index += 1) {
			if (current.matches?.(MATH_CONTAINER_SELECTOR) && isVisible(current)) return current;
			const nested = current.querySelector?.(MATH_CONTAINER_SELECTOR);
			if (nested instanceof Element && isVisible(nested)) return nested;
			current = current.nextElementSibling;
		}
		const parent = script.parentElement;
		return parent instanceof Element && isVisible(parent) ? parent : null;
	};

	const mathSourceTextsForElement = (element) => {
		if (!(element instanceof Element)) return [];
		const parts = [getMathElementComparableText(element)];
		const id = element.getAttribute("id") || element.closest?.("[id]")?.getAttribute?.("id") || "";
		const scriptId = id.endsWith("-Frame") ? id.slice(0, -"-Frame".length) : "";
		const script = scriptId ? document.getElementById(scriptId) : null;
		if (isMathTexScript(script)) parts.push(script.textContent || "");
		const previousScript = findPreviousMathTexScript(element.closest?.(".MathJax_Display, mjx-container, .katex, .math") || element);
		if (previousScript) parts.push(previousScript.textContent || "");
		return parts.filter((part, index, list) => part && list.indexOf(part) === index);
	};

	const mathSourceMatchesQuery = (sourceText, rawQuery) => {
		const querySearch = normalizeMathSourceSearchText(rawQuery);
		const queryCompact = compactMathSourceSearchText(rawQuery);
		if (!queryCompact || queryCompact.length < 3) return false;
		const sourceSearch = normalizeMathSourceSearchText(sourceText);
		const sourceCompact = compactMathSourceSearchText(sourceText);
		return Boolean(
			(sourceSearch && querySearch && sourceSearch.includes(querySearch)) ||
				(sourceCompact && sourceCompact.includes(queryCompact)),
		);
	};

	const findBestMathSourceFallback = (rawQuery) => {
		if (!isMathLikeHighlightQuery(rawQuery)) return null;
		let best = null;
		const consider = (target, sourceText, score) => {
			if (!(target instanceof Element) || !isVisible(target)) return;
			if (target.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR)) return;
			if (target.closest('[data-onhand-highlight-kind]')) return;
			if (!mathSourceMatchesQuery(sourceText, rawQuery)) return;
			const rect = target.getBoundingClientRect();
			const centeredScore = score - Math.abs(rect.top - window.innerHeight / 2) * 0.01;
			if (!best || centeredScore > best.score) best = { element: target, score: centeredScore };
		};

		for (const script of Array.from(document.querySelectorAll('script[type^="math/tex"]'))) {
			if (!isMathTexScript(script)) continue;
			const target = findRenderedMathTargetForScript(script);
			consider(target, script.textContent || "", 1200);
		}
		for (const element of Array.from(document.querySelectorAll(MATH_CONTAINER_SELECTOR))) {
			if (!(element instanceof Element)) continue;
			for (const sourceText of mathSourceTextsForElement(element)) {
				consider(element, sourceText, 1000);
			}
		}
		return best?.element || null;
	};

	const findBestMathBlockFallback = (rawQuery) => {
		if (!isMathLikeHighlightQuery(rawQuery)) return null;
		const root = document.body || document.documentElement;
		const querySearch = normalizeHighlightSearchText(rawQuery);
		const queryCompact = compactHighlightSearchText(rawQuery);
		const queryTokens = tokenizeApproximateQuery(rawQuery);
		let best = null;
		for (const element of root.querySelectorAll(MATH_CONTAINER_SELECTOR)) {
			if (!(element instanceof Element)) continue;
			if (!isVisible(element)) continue;
			if (element.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR)) continue;
			if (element.closest('[data-onhand-highlight-kind]')) continue;
			const text = getMathElementComparableText(element);
			if (!text.trim()) continue;
			const searchText = normalizeHighlightSearchText(text);
			const compactText = compactHighlightSearchText(text);
			const tokenSet = new Set(tokenizeApproximateQuery(text));
			const overlap = countTokenOverlap(queryTokens, tokenSet);
			let score = overlap * 100;
			if (querySearch && searchText.includes(querySearch)) score += 500;
			if (queryCompact && compactText.includes(queryCompact)) score += 400;
			if (score <= 0) continue;
			const rect = element.getBoundingClientRect();
			score -= Math.abs(rect.top - window.innerHeight / 2) * 0.01;
			if (!best || score > best.score) {
				best = { element, score };
			}
		}
		return best?.element || null;
	};

	const highlightText = async (query, options = {}) => {
		const rawQuery = String(query ?? "").trim();
		const normalizedQuery = lowerText(rawQuery);
		if (!normalizedQuery) throw new Error("highlightText requires a non-empty query");
		const searchQuery = normalizeHighlightSearchText(rawQuery);
		const compactQuery = compactHighlightSearchText(rawQuery);
		const useCompactQuery = compactQuery.length >= (isMathLikeHighlightQuery(rawQuery) ? 3 : 12);
		const compactFallback = isMathLikeHighlightQuery(rawQuery) ? "compact-math-text" : "compact-text";

		const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
		const clearExisting = options.clearExisting === true;
		const scrollIntoView = options.scrollIntoView !== false;
		const exactOnly = Boolean(options.exactOnly || options.allowApproximate === false);
		ensureAnnotationStyles();
			await waitForMathTypesetting(rawQuery);
			if (options.pdfAnchor?.surface === "pdf") {
				if (clearExisting) clearAnnotations();
				const restoredFromAnchor = await restorePdfAnchorHighlight(options.pdfAnchor, rawQuery, {
					...options,
					scrollIntoView,
				});
				if (restoredFromAnchor) return restoredFromAnchor;
			}
			const annotationSurface = getAnnotationSurfaceInfo();
			if (annotationSurface.surface === "pdf" && annotationSurface.hasTextLayer) {
				return await highlightPdfText(rawQuery, {
					...options,
				occurrence,
				clearExisting,
				scrollIntoView,
					surface: annotationSurface,
				});
			}
			if (annotationSurface.surface === "pdf") {
				throw new Error(
					`Unsupported PDF annotation surface: ${annotationSurface.unsupportedReason || "this PDF viewer does not expose selectable page text to Onhand yet"}`,
				);
			}
			if (options.reuseExisting) {
			const existing = findExistingAnnotationByText(rawQuery, occurrence);
			if (existing?.annotationElement) {
				if (scrollIntoView) {
					existing.annotationElement.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
					await ensureElementInViewport(existing.annotationElement, "center");
				} else {
					await waitForLayout();
				}
				return buildAnnotationResult(existing.annotationElement, rawQuery, {
					approximate: existing.fallback !== "existing-annotation",
					fallback: existing.fallback,
					reusedExisting: true,
				});
			}
		}
		if (clearExisting) clearAnnotations();

		let matchIndex = 0;
		let bestApproximateMatch = null;
		for (const container of collectHighlightContainers(normalizedQuery, rawQuery)) {
			const textNodes = collectHighlightTextNodes(container);
			if (!textNodes.length) continue;
			const mappedText = buildNormalizedTextMap(textNodes);
			const exactModes = [
				{
					text: mappedText.lowerText,
					positions: mappedText.positions,
					query: normalizedQuery,
					fallback: null,
				},
				{
					text: mappedText.searchText,
					positions: mappedText.searchPositions,
					query: searchQuery,
					fallback: "normalized-text",
				},
				...(useCompactQuery
					? [
							{
								text: mappedText.compactText,
								positions: mappedText.compactPositions,
								query: compactQuery,
								fallback: compactFallback,
							},
						]
					: []),
			];
			for (const mode of exactModes) {
				if (!mode.query || !mode.text.includes(mode.query)) continue;
				let searchFrom = 0;
				while (searchFrom <= mode.text.length) {
					const foundAt = mode.text.indexOf(mode.query, searchFrom);
					if (foundAt === -1) break;
					matchIndex += 1;
					if (matchIndex === occurrence) {
						const start = mode.positions[foundAt];
						const end = mode.positions[foundAt + mode.query.length - 1];
						if (!start || !end) break;

						const mathContainer = start.node?.parentElement?.closest?.(MATH_CONTAINER_SELECTOR);
						if (mathContainer && isMathLikeHighlightQuery(rawQuery)) {
							return await highlightBlockElement(mathContainer, rawQuery, {
								scrollIntoView,
								approximate: Boolean(mode.fallback),
								fallback: mode.fallback || "math-container",
							});
						}

						const range = document.createRange();
						range.setStart(start.node, start.offset);
						range.setEnd(end.node, getRangeEndOffset(end));
						return await highlightRange(range, rawQuery, {
							scrollIntoView,
							approximate: Boolean(mode.fallback),
							fallback: mode.fallback,
						});
					}
					searchFrom = foundAt + Math.max(mode.query.length, 1);
				}
			}

			const approximate = exactOnly ? null : findBestApproximateHighlightRange(mappedText, rawQuery);
			if (!approximate) continue;
			if (!bestApproximateMatch || approximate.score > bestApproximateMatch.score) {
				bestApproximateMatch = { ...approximate, mappedText, container };
			}
		}

		const mathSourceFallback = occurrence === 1 ? findBestMathSourceFallback(rawQuery) : null;
		if (mathSourceFallback) {
			return await highlightBlockElement(mathSourceFallback, rawQuery, {
				scrollIntoView,
				approximate: false,
				fallback: "math-source",
			});
		}

		if (!exactOnly && bestApproximateMatch && occurrence === 1) {
			const start = bestApproximateMatch.mappedText.positions[bestApproximateMatch.startIndex];
			const end = bestApproximateMatch.mappedText.positions[bestApproximateMatch.endIndex - 1];
			if (start && end) {
				const mathContainer = start.node?.parentElement?.closest?.(MATH_CONTAINER_SELECTOR);
				if (mathContainer && isMathLikeHighlightQuery(rawQuery)) {
					return await highlightBlockElement(mathContainer, rawQuery, {
						scrollIntoView,
						approximate: true,
						fallback: "math-container",
					});
				}
				const range = document.createRange();
				range.setStart(start.node, start.offset);
				range.setEnd(end.node, getRangeEndOffset(end));
				return await highlightRange(range, rawQuery, {
					scrollIntoView,
					approximate: true,
					fallbackText: bestApproximateMatch.text,
				});
			}
		}

		const mathFallback = !exactOnly && occurrence === 1 ? findBestMathBlockFallback(rawQuery) : null;
		if (mathFallback) {
			return await highlightBlockElement(mathFallback, rawQuery, {
				scrollIntoView,
				approximate: true,
				fallback: "math-container",
			});
		}

		throw new Error(`No visible text matched: ${query}`);
	};

	const getVisibleText = (options = {}) => {
		const pdfVisibleText = collectPdfVisibleText(options);
		if (pdfVisibleText) return pdfVisibleText;

		const maxBlocks = Math.max(1, Math.min(80, Number(options.maxBlocks || 25) || 25));
		const maxChars = Math.max(200, Math.min(20000, Number(options.maxChars || 6000) || 6000));
		const blocks = [];
		const seen = new Set();
		const viewportTop = 0;
		const viewportBottom = window.innerHeight;
		let totalChars = 0;

		for (const element of document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code, figcaption, caption, summary, td, th, [data-testid="tweetText"]')) {
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
		let rect = null;
		try {
			rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
		} catch {
			rect = null;
		}
		const startElement = range.startContainer instanceof Element
			? range.startContainer
			: range.startContainer?.parentElement || null;
		const endElement = range.endContainer instanceof Element
			? range.endContainer
			: range.endContainer?.parentElement || null;
		const containerElement = range.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range.commonAncestorContainer?.parentElement || startElement || endElement || null;

		const pdfSelection = buildPdfAnchorFromRange(range, text);
		return {
			...base,
			hasSelection: Boolean(text),
			isCollapsed: selection.isCollapsed,
			text,
			rangeCount: selection.rangeCount,
			rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
			container: pdfSelection?.page ? summarizeElement(pdfSelection.page, { pageNumber: pdfSelection.pdfAnchor.pageNumber }) : containerElement ? summarizeElement(containerElement) : null,
			start: startElement ? summarizeElement(startElement) : null,
			end: endElement ? summarizeElement(endElement) : null,
			anchorOffset: selection.anchorOffset,
			focusOffset: selection.focusOffset,
			...(pdfSelection
				? {
					surface: "pdf",
					viewer: pdfSelection.pdfAnchor.viewer,
					pageNumber: pdfSelection.pdfAnchor.pageNumber,
					pdfAnchor: pdfSelection.pdfAnchor,
				}
				: {}),
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

	const findAnnotationElementOrNull = (annotationId) => {
		const element = document.querySelector(annotationSelector(annotationId));
		return element instanceof Element ? element : null;
	};

	const PDF_PAGE_NAVIGATION_CONTROL_SELECTORS = [
		".gsr-tb-pn-input",
		'input[aria-label*="page" i]',
		'input[title*="page" i]',
		'input[name*="page" i]',
		'input[id*="page" i]',
		'[role="spinbutton"][aria-label*="page" i]',
		'[contenteditable="true"][aria-label*="page" i]',
		"[contenteditable=true][aria-label*='page' i]",
	].join(", ");

	const waitForPdfPageRendered = async (pageNumber, timeoutMs = 900) => {
		const startedAt = Date.now();
		let page = findPdfPageByNumber(pageNumber);
		while (!(page instanceof HTMLElement) && Date.now() - startedAt < timeoutMs) {
			await waitForLayout(75);
			page = findPdfPageByNumber(pageNumber);
		}
		return page instanceof HTMLElement ? page : null;
	};

	const setPdfPageControlValue = (control, pageNumber) => {
		if (!(control instanceof HTMLElement)) return false;
		const value = String(pageNumber);
		try {
			control.focus?.({ preventScroll: true });
		} catch {
			try {
				control.focus?.();
			} catch {}
		}
		if ("value" in control) {
			control.value = value;
		} else if (control.isContentEditable) {
			control.textContent = value;
		} else {
			control.setAttribute("aria-valuenow", value);
			control.textContent = value;
		}
		for (const eventName of ["input", "change"]) {
			try {
				control.dispatchEvent(new Event(eventName, { bubbles: true, cancelable: true }));
			} catch {}
		}
		for (const eventName of ["keydown", "keyup"]) {
			try {
				control.dispatchEvent(new KeyboardEvent(eventName, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
			} catch {}
		}
		return true;
	};

	const requestPdfViewerPageRender = async (pageNumber) => {
		const targetPageNumber = Number.parseInt(String(pageNumber || ""), 10);
		if (!Number.isFinite(targetPageNumber) || targetPageNumber <= 0) return { requested: false, page: null };
		let requested = false;
		let method = null;
		for (const control of Array.from(document.querySelectorAll(PDF_PAGE_NAVIGATION_CONTROL_SELECTORS))) {
			if (!(control instanceof HTMLElement)) continue;
			if (!isVisible(control)) continue;
			if (setPdfPageControlValue(control, targetPageNumber)) {
				requested = true;
				method = "page-control";
				break;
			}
		}
		if (!requested) {
			try {
				const hashText = String(location.hash || "").replace(/^#/, "");
				const params = new URLSearchParams(hashText);
				if (params.get("page") !== String(targetPageNumber)) {
					params.set("page", String(targetPageNumber));
					location.hash = params.toString();
					requested = true;
					method = "hash";
				}
			} catch {}
		}
		if (!requested) return { requested: false, method: null, page: null };
		return {
			requested,
			method,
			page: await waitForPdfPageRendered(targetPageNumber),
		};
	};

	const scrollToPdfAnnotationRecord = async (record, options = {}) => {
		const annotationId = String(record?.annotationId || "").trim();
		const pageNumber = Number(record?.pdfAnchor?.pageNumber || 0);
		if (!annotationId || !pageNumber) return null;
		let page = findRenderedPdfPageForAnchor(record.pdfAnchor);
		if (page instanceof HTMLElement) {
			syncPdfOverlayPositions();
			const annotationElement = findAnnotationElementOrNull(annotationId);
			if (annotationElement) return { annotationElement };
		}

		const block = ["start", "center", "end", "nearest"].includes(String(options.block))
			? String(options.block)
			: "center";
		const renderRequest = await requestPdfViewerPageRender(pageNumber);
		if (renderRequest.page instanceof HTMLElement) {
			syncPdfOverlayPositions();
			const annotationElement = findAnnotationElementOrNull(annotationId);
			if (annotationElement) return { annotationElement, requestedPageRender: renderRequest.method };
		}
		const pages = collectPdfPageElements({ includeGeneric: hasLikelyPdfDocumentSignal() })
			.map((candidate, index) => ({
				page: candidate,
				pageNumber: getPdfPageNumber(candidate, index),
			}))
			.filter((entry) => entry.page instanceof HTMLElement && Number.isFinite(entry.pageNumber));
		if (!pages.length) {
			return {
				annotationId,
				targetKind: "pdf-page-missing",
				pageNumber,
				container: null,
				anchorRect: null,
				noteRect: null,
				targetRect: null,
				viewport: {
					width: window.innerWidth,
					height: window.innerHeight,
				},
				scrollY: window.scrollY,
				virtualized: true,
				requestedPageRender: renderRequest.requested ? renderRequest.method : null,
				message: `PDF page ${pageNumber} is not currently rendered.`,
			};
		}
		const nearest = pages.reduce((best, entry) => {
			if (!best) return entry;
			return Math.abs(entry.pageNumber - pageNumber) < Math.abs(best.pageNumber - pageNumber) ? entry : best;
		}, null);
		nearest.page.scrollIntoView({ behavior: "auto", block, inline: "nearest" });
		await ensureElementInViewport(nearest.page, block);
		syncPdfOverlayPositions();
		const annotationElement = findAnnotationElementOrNull(annotationId);
		if (annotationElement) return { annotationElement };
		return {
			annotationId,
			targetKind: "pdf-page-estimate",
			pageNumber,
			nearestPageNumber: nearest.pageNumber,
				container: summarizeElement(nearest.page, { pageNumber: nearest.pageNumber }),
				anchorRect: null,
				noteRect: null,
				targetRect: rectToObject(nearest.page.getBoundingClientRect()),
				viewport: {
					width: window.innerWidth,
					height: window.innerHeight,
				},
				scrollY: window.scrollY,
				virtualized: true,
				requestedPageRender: renderRequest.requested ? renderRequest.method : null,
				message: `PDF page ${pageNumber} is not currently rendered; jumped near page ${nearest.pageNumber}.`,
			};
		};

	const scrollToAnnotation = async (annotationId, options = {}) => {
		const rawAnnotationId = String(annotationId ?? "").trim();
		if (!rawAnnotationId) throw new Error("scrollToAnnotation requires a non-empty annotationId");
		syncPdfOverlayPositions();
		let annotationElement = findAnnotationElementOrNull(rawAnnotationId);
		let pdfScrollResult = null;
		if (!annotationElement) {
			const record = getPdfAnnotationRecord(rawAnnotationId);
			pdfScrollResult = record ? await scrollToPdfAnnotationRecord(record, options) : null;
			if (pdfScrollResult?.annotationElement) {
				annotationElement = pdfScrollResult.annotationElement;
			} else if (pdfScrollResult) {
				return pdfScrollResult;
			}
		}
		if (!annotationElement) {
			throw new Error(`No annotation found with id: ${rawAnnotationId}`);
		}
		const container = findAnnotationContainer(annotationElement);
		const note = findNoteForAnnotation(rawAnnotationId);
		const block = ["start", "center", "end", "nearest"].includes(String(options.block))
			? String(options.block)
			: "center";
		const preferredTarget = options.target === "note" ? "note" : "annotation";
		if (preferredTarget === "note" && note) {
			setPdfNoteCollapsed(note, false);
			const page = annotationElement.closest?.(PDF_PAGE_CLOSEST_SELECTOR);
			if (page instanceof HTMLElement) positionPdfNoteElement(note, annotationElement, page);
		}
		const target = preferredTarget === "note" && note ? note : container;
		target.scrollIntoView({ behavior: "auto", block, inline: "nearest" });
		await ensureElementInViewport(target, block);
		const flashTarget = preferredTarget === "note" && note ? note : annotationElement;
		try {
			flashTarget.animate(
				[
					{ outline: "2px solid var(--onhand-gold, #ea9d34)", outlineOffset: "2px" },
					{ outline: "2px solid transparent", outlineOffset: "2px" },
				],
				{ duration: 700, easing: "ease-out" },
			);
		} catch {
			const previousOutline = flashTarget.style.outline;
			const previousOutlineOffset = flashTarget.style.outlineOffset;
			flashTarget.style.outline = "2px solid #ea9d34";
			flashTarget.style.outlineOffset = "2px";
			window.setTimeout(() => {
				flashTarget.style.outline = previousOutline;
				flashTarget.style.outlineOffset = previousOutlineOffset;
			}, 700);
		}
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
			...(pdfScrollResult?.requestedPageRender ? { requestedPageRender: pdfScrollResult.requestedPageRender } : {}),
		};
	};

	const showPdfNote = async (annotationElement, annotationId, noteText, options = {}) => {
		const page = annotationElement.closest?.(PDF_PAGE_CLOSEST_SELECTOR);
		if (!(page instanceof HTMLElement)) throw new Error(`PDF annotation page not found for id: ${annotationId}`);
		const overlayLayer = ensurePdfOverlayLayer(page);
		if (!overlayLayer) throw new Error(`PDF overlay layer not found for id: ${annotationId}`);
		const replacedCount = removeNotesForAnnotation(annotationId);
		const labelText = String(options.label || "Onhand");
		if (noteMayContainMath(noteText)) {
			await ensureNoteKatexLoaded();
		}
		const note = createPdfNoteElement(annotationId, noteText, { label: labelText });
		const noteId = String(note.getAttribute("data-onhand-note-id") || "");

		overlayLayer.appendChild(note);
		positionPdfNoteElement(note, annotationElement, page);
		const pdfAnchor = parsePdfAnchorFromElement(annotationElement);
		registerPdfAnnotationRecord(annotationId, {
			matchedText: normalizeText(annotationElement.getAttribute("data-onhand-matched-text") || pdfAnchor?.matchedText || pdfAnchor?.textQuote?.exact || ""),
			pdfAnchor,
			note: {
				noteId,
				label: labelText,
				text: noteText,
			},
		});

		const scrolled = options.scrollIntoView === false ? null : await scrollToAnnotation(annotationId, { block: options.block, target: "note" });
		if (!scrolled) await waitForLayout();
		return {
			noteId,
			annotationId,
			text: noteText.slice(0, 500),
			container: summarizeElement(page, { pageNumber: getPdfPageNumber(page) }),
			insertionTarget: summarizeElement(overlayLayer),
			insertionPosition: "pdf-overlay",
			anchorRect: rectToObject(annotationElement.getBoundingClientRect()),
			rect: rectToObject(note.getBoundingClientRect()),
			scrollY: window.scrollY,
			replacedCount,
			pdfAnchor,
			scrolled,
		};
	};

	const showNote = async (annotationId, noteText, options = {}) => {
		const rawAnnotationId = String(annotationId ?? "").trim();
		const rawNoteText = String(noteText ?? "").trim();
		if (!rawAnnotationId) throw new Error("showNote requires a non-empty annotationId");
		if (!rawNoteText) throw new Error("showNote requires non-empty note text");

		ensureAnnotationStyles();
		syncPdfOverlayPositions();
		const annotationElement = findAnnotationElement(rawAnnotationId);
		if (annotationElement.getAttribute("data-onhand-highlight-kind") === "pdf") {
			return await showPdfNote(annotationElement, rawAnnotationId, rawNoteText, options);
		}
		const container = findAnnotationContainer(annotationElement);
		const insertionPlacement = findNoteInsertionPlacement(container);
		const replacedCount = removeNotesForAnnotation(rawAnnotationId);
		const noteId = nextAnnotationId();
		const note = document.createElement("div");
		note.setAttribute("data-onhand-note-kind", "card");
		note.setAttribute("data-onhand-note-id", noteId);
		note.setAttribute("data-onhand-note-for", rawAnnotationId);
		applyAnnotationThemeToElement(note);

		const label = document.createElement("div");
		label.setAttribute("data-onhand-note-part", "label");
		label.textContent = String(options.label || "Onhand");

		const body = document.createElement("div");
		body.setAttribute("data-onhand-note-part", "body");
		body.setAttribute("data-onhand-note-source", rawNoteText);
		if (noteMayContainMath(rawNoteText)) {
			await ensureNoteKatexLoaded();
		}
		body.innerHTML = renderNoteRichText(rawNoteText);
		body.setAttribute("data-onhand-note-renderer", noteKatexModule ? "katex" : "plain");

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

	const capturePrimaryScrollContainer = () => {
		const candidates = [];
		const viewportHeight = Math.max(1, Number(window.innerHeight || 0));
		const viewportWidth = Math.max(1, Number(window.innerWidth || 0));
		const addCandidate = (element, source, isWindow = false) => {
			const scrollTop = isWindow ? Number(window.scrollY || window.pageYOffset || 0) : Number(element?.scrollTop || 0);
			const scrollLeft = isWindow ? Number(window.scrollX || window.pageXOffset || 0) : Number(element?.scrollLeft || 0);
			const scrollHeight = isWindow
				? Math.max(Number(document.documentElement?.scrollHeight || 0), Number(document.body?.scrollHeight || 0))
				: Number(element?.scrollHeight || 0);
			const scrollWidth = isWindow
				? Math.max(Number(document.documentElement?.scrollWidth || 0), Number(document.body?.scrollWidth || 0))
				: Number(element?.scrollWidth || 0);
			const clientHeight = isWindow ? viewportHeight : Number(element?.clientHeight || 0);
			const clientWidth = isWindow ? viewportWidth : Number(element?.clientWidth || 0);
			const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
			const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
			if (maxScrollTop < 120 && maxScrollLeft < 120) return;
			if (!isWindow) {
				let rect = null;
				try { rect = element.getBoundingClientRect(); } catch {}
				const visible = rect && rect.bottom > 0 && rect.top < viewportHeight && rect.width > 80 && rect.height > 80;
				if (!visible || clientHeight < 120 || clientWidth < 120) return;
				let canScroll = false;
				try {
					const style = getComputedStyle(element);
					canScroll = /(auto|scroll|overlay)/.test(String(style.overflowY || "") + " " + String(style.overflowX || ""));
				} catch {}
				if (!canScroll && scrollTop <= 0 && scrollLeft <= 0) return;
			}
			const activeBonus = scrollTop > 0 || scrollLeft > 0 ? 10000 : 0;
			candidates.push({
				source,
				scrollTop,
				scrollLeft,
				scrollHeight,
				scrollWidth,
				clientHeight,
				clientWidth,
				maxScrollTop,
				maxScrollLeft,
				scrollRatio: maxScrollTop > 0 ? scrollTop / maxScrollTop : null,
				score: activeBonus + maxScrollTop + clientHeight * 0.5,
			});
		};
		addCandidate(null, "window", true);
		const seen = new Set();
		for (const element of [document.scrollingElement, document.documentElement, document.body, ...Array.from(document.querySelectorAll("*")).slice(0, 8000)]) {
			if (!element || seen.has(element)) continue;
			seen.add(element);
			addCandidate(element, element === document.scrollingElement ? "document-scrolling-element" : "scrollable-element");
		}
		candidates.sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
		const best = candidates.find((candidate) => Number(candidate.scrollTop || 0) > 0 || Number(candidate.scrollLeft || 0) > 0) || candidates[0] || null;
		if (!best || (Number(best.scrollTop || 0) <= 0 && Number(best.scrollLeft || 0) <= 0)) return null;
		return best;
	};

	const captureState = async () => {
		syncPdfOverlayPositions();
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
				let pdfAnchor = null;
				try {
					pdfAnchor = JSON.parse(annotationElement.getAttribute("data-onhand-pdf-anchor") || "null");
				} catch {
					pdfAnchor = null;
				}
				return {
					annotationId,
					kind,
					matchedText: normalizeText(annotationElement.getAttribute("data-onhand-matched-text") || getElementText(annotationElement)).slice(0, 500),
					container: summarizeElement(container),
					rect: rectToObject(annotationElement.getBoundingClientRect()),
					pdfAnchor,
					note: note
						? {
							noteId: note.getAttribute("data-onhand-note-id") || null,
							label: normalizeText(label?.textContent || "") || null,
							text: normalizeText(body?.getAttribute?.("data-onhand-note-source") || body?.textContent || note.textContent || "").slice(0, 1000),
							rect: rectToObject(note.getBoundingClientRect()),
						}
						: null,
				};
			})
			.filter(Boolean);
		const capturedAnnotationIds = new Set(annotations.map((annotation) => annotation.annotationId).filter(Boolean));
		for (const record of getPdfAnnotationRegistry().values()) {
			if (!record?.annotationId || capturedAnnotationIds.has(record.annotationId) || !record.pdfAnchor) continue;
			annotations.push({
				annotationId: record.annotationId,
				kind: "pdf",
				matchedText: normalizeText(record.matchedText || record.pdfAnchor.matchedText || record.pdfAnchor.textQuote?.exact || "").slice(0, 500),
				container: {
					tag: "pdf-page",
					pageNumber: record.pdfAnchor.pageNumber,
					text: `PDF page ${record.pdfAnchor.pageNumber || ""}`.trim(),
				},
				rect: null,
				pdfAnchor: record.pdfAnchor,
				note: record.note
					? {
						noteId: record.note.noteId || null,
						label: record.note.label || null,
						text: normalizeText(record.note.text || "").slice(0, 1000),
						rect: null,
					}
					: null,
				virtualized: true,
			});
		}

		return {
			url: location.href,
			title: document.title,
			capturedAt: Date.now(),
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			scrollContainer: capturePrimaryScrollContainer(),
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
			annotationCount: annotations.length,
			annotations,
		};
	};

	const syncAnnotationTheme = () => {
		const result = syncAnnotationThemeAttributes();
		if (result.updated > 0) {
			ensureAnnotationStyles();
		}
		return result;
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
		getAnnotationSurfaceInfo,
		highlightText,
		getVisibleText,
		getSelectionInfo,
		getViewportHeadings,
		getScrollState,
		scrollToAnnotation,
		showNote,
		captureState,
		clearAnnotations,
		syncAnnotationTheme,
		pickElements,
	};
};

async function evaluateInTab(tabId, expression, options = {}) {
	if (!options.skipScripting) {
		try {
			const settledPayload = await withOperationTimeout(
				executeScriptInTabMainWorld(
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
				),
				SCRIPT_EXECUTION_TIMEOUT_MS,
				"Script evaluation timed out",
			);
			if (!settledPayload?.ok) {
				throw new Error(settledPayload?.error || "Script evaluation failed");
			}
			return normalizeExecuteScriptValue(settledPayload.value);
		} catch (scriptError) {
			if (isRestrictedScriptingError(scriptError)) {
				throw scriptError;
			}
			return await withOperationTimeout(
				withDebugger(tabId, async ({ send }) => {
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
				}),
				SCRIPT_EXECUTION_TIMEOUT_MS,
				"Debugger evaluation timed out",
			);
		}
	}
	return await withOperationTimeout(
		withDebugger(tabId, async ({ send }) => {
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
		}),
		SCRIPT_EXECUTION_TIMEOUT_MS,
		"Debugger evaluation timed out",
	);
}

async function getPageToolkitOptions(tab = null) {
	const options = {
		fontUrls: getExtensionFontUrls(),
		katexUrl: chrome.runtime.getURL("vendor/katex.mjs"),
		theme: await getOnhandThemePreference(),
	};
	if (typeof tab?.url === "string" && tab.url) options.sourceTabUrl = tab.url;
	if (typeof tab?.title === "string" && tab.title) options.sourceTabTitle = tab.title;
	return options;
}

async function executePageToolkitMethodViaScripting(tabId, methodName, args = [], toolkitOptions = {}) {
	const payload = await executeScriptInTab(
		tabId,
		async (toolkitSource, targetMethodName, targetArgs, targetToolkitOptions) => {
			try {
				const toolkitFactory = (0, eval)(`(${toolkitSource})`);
				const toolkit = toolkitFactory(targetToolkitOptions);
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
		[createPageToolkit.toString(), methodName, args, toolkitOptions],
	);
	if (!payload?.ok) {
		throw new Error(payload?.error || `Page toolkit method failed: ${methodName}`);
	}
	return payload.value;
}

async function getAllFramesForTab(tabId) {
	if (!chrome.webNavigation?.getAllFrames) return [];
	return await new Promise((resolve, reject) => {
		try {
			chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
				const error = chrome.runtime.lastError;
				if (error) {
					reject(new Error(error.message || "Could not inspect tab frames"));
					return;
				}
				resolve(Array.isArray(frames) ? frames : []);
			});
		} catch (error) {
			reject(error);
		}
	});
}

async function getOnhandPdfViewerFrameIds(tabId) {
	const frames = await getAllFramesForTab(tabId);
	return frames
		.filter((frame) => typeof frame?.frameId === "number" && isOwnExtensionPdfViewerUrl(frame.url))
		.map((frame) => frame.frameId);
}

async function executeScriptInFrame(tabId, frameId, func, args = []) {
	const results = await chrome.scripting.executeScript({
		target: { tabId, frameIds: [frameId] },
		world: "ISOLATED",
		func,
		args,
	});
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error(`No script result returned for frame ${frameId}`);
	}
	return results[0].result;
}

function isInjectableFrameUrl(value) {
	try {
		const parsed = new URL(String(value || ""));
		if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:") return true;
		// Own-extension frames (the Onhand PDF viewer) are injectable; other
		// extensions' frames — notably the browser's native PDF viewer — are
		// not, and trying to inject into them aborts the whole allFrames call.
		if (parsed.protocol === "chrome-extension:") return parsed.origin === new URL(chrome.runtime.getURL("")).origin;
		return false;
	} catch {
		return false;
	}
}

async function getInjectableFrameIds(tabId) {
	const frames = await getAllFramesForTab(tabId);
	return frames.filter((frame) => typeof frame?.frameId === "number" && isInjectableFrameUrl(frame.url)).map((frame) => frame.frameId);
}

// chrome.scripting.executeScript with allFrames:true throws "Cannot access a
// chrome-extension:// URL of different extension" if any frame belongs to
// another extension (the native PDF viewer on every PDF tab), aborting the
// whole injection. Fall back to injecting per accessible frame so one foreign
// frame cannot starve the rest.
async function executeScriptInFramesWithFallback(tabId, world, func, args) {
	try {
		const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world, func, args });
		return Array.isArray(results) ? results : [];
	} catch (error) {
		if (!isRestrictedScriptingError(error)) throw error;
		const frameIds = await getInjectableFrameIds(tabId);
		const targets = frameIds.length ? frameIds : [0];
		const results = [];
		for (const frameId of targets) {
			try {
				const frameResults = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world, func, args });
				if (Array.isArray(frameResults)) results.push(...frameResults);
			} catch (frameError) {
				if (!isRestrictedScriptingError(frameError)) throw frameError;
			}
		}
		return results;
	}
}

async function executeScriptInAllFrames(tabId, func, args = []) {
	return await executeScriptInFramesWithFallback(tabId, "ISOLATED", func, args);
}

async function executeScriptInAllFramesMainWorld(tabId, func, args = []) {
	return await executeScriptInFramesWithFallback(tabId, "MAIN", func, args);
}

async function evaluateInOnhandPdfViewerFrameViaScripting(tabId, expression, missingMessage) {
	const frameIds = await getOnhandPdfViewerFrameIds(tabId);
	if (!frameIds.length) throw new Error(missingMessage);
	let lastError = null;
	for (const frameId of frameIds) {
		try {
			const payload = await executeScriptInFrame(
				tabId,
				frameId,
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
			if (!payload?.ok) throw new Error(payload?.error || missingMessage);
			return normalizeExecuteScriptValue(payload.value);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError || new Error(missingMessage);
}

async function callOnhandPdfViewerFrameViaBridge(tabId, commandPayload, missingMessage) {
	const tab = await chrome.tabs.get(tabId);
	const pdfUrl = resolvePdfSourceUrlForViewer({}, tab);
	const token = await ensureInlinePdfViewerBridgeToken(pdfUrl);
	const viewerUrlPrefix = chrome.runtime.getURL("pdf-viewer.html");
	const frameResults = await executeScriptInAllFrames(
		tabId,
		async (bridgeToken, targetPdfUrl, targetCommandPayload, timeoutMs, expectedViewerUrlPrefix) => {
			const frame = document.querySelector("#onhand-inline-pdf-viewer-frame, iframe[data-onhand-inline-pdf-frame]");
			if (!frame?.contentWindow) {
				return {
					ok: false,
					error: "No inline Onhand PDF viewer frame found",
				};
			}
			const frameSrc = String(frame.getAttribute("src") || frame.src || "");
			if (!frameSrc.startsWith(expectedViewerUrlPrefix)) {
				return {
					ok: false,
					error: "Inline Onhand PDF viewer frame has an unexpected source",
				};
			}

			const requestId = `onhand-pdf-viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
			return await new Promise((resolve) => {
				const channel = new MessageChannel();
				let finished = false;
				const finish = (value) => {
					if (finished) return;
					finished = true;
					clearTimeout(timeoutId);
					try {
						channel.port1.close();
					} catch {}
					resolve(value);
				};
				const timeoutId = setTimeout(() => {
					finish({
						ok: false,
						error: "Timed out waiting for inline Onhand PDF viewer bridge",
					});
				}, timeoutMs);
				channel.port1.onmessage = (event) => {
					const data = event?.data || {};
					if (data.requestId !== requestId) return;
					finish(data);
				};
				try {
					channel.port1.start?.();
					frame.contentWindow.postMessage(
						{
							type: "onhand-pdf-viewer-bridge-init",
							token: bridgeToken,
							sourceUrl: targetPdfUrl,
						},
						"*",
					);
					frame.contentWindow.postMessage(
						{
							...(targetCommandPayload && typeof targetCommandPayload === "object" ? targetCommandPayload : {}),
							type: "onhand-pdf-viewer-bridge-command",
							requestId,
							token: bridgeToken,
							sourceUrl: targetPdfUrl,
						},
						"*",
						[channel.port2],
					);
				} catch (error) {
					finish({
						ok: false,
						error: error?.message || String(error),
					});
				}
			});
		},
		[token, pdfUrl, commandPayload, PDF_READER_FRAME_EXECUTION_TIMEOUT_MS, viewerUrlPrefix],
	);
	const payload = frameResults.find((result) => result?.result?.ok)?.result;
	if (!payload && frameResults.length) {
		const errors = frameResults
			.map((result) => result?.result?.error)
			.filter(Boolean);
		if (errors.length) throw new Error(errors[errors.length - 1]);
	}
	if (!payload?.ok) throw new Error(payload?.error || missingMessage);
	return normalizeExecuteScriptValue(payload.value);
}

async function evaluateInOnhandPdfViewerFrameViaBridge(tabId, expression, missingMessage) {
	return await callOnhandPdfViewerFrameViaBridge(tabId, { command: "evaluate", expression }, missingMessage);
}

async function callOnhandPdfViewerFrameViaRuntimePort(tabId, commandPayload, missingMessage) {
	const tab = await chrome.tabs.get(tabId);
	const pdfUrl = resolvePdfSourceUrlForViewer({}, tab);
	const record =
		onhandPdfViewerPortRecords.get(onhandPdfViewerPortKey(tabId, pdfUrl)) ||
		onhandPdfViewerPortRecords.get(onhandPdfViewerSourcePortKey(pdfUrl));
	if (!record?.port) throw new Error(missingMessage || "No Onhand PDF viewer runtime port found");
	const requestId = `onhand-pdf-viewer-port-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return await new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			try {
				record.port.onMessage.removeListener(onMessage);
			} catch {}
		};
		const finish = (fn, value) => {
			cleanup();
			fn(value);
		};
		const timeoutId = setTimeout(() => {
			finish(reject, new Error("Timed out waiting for Onhand PDF viewer runtime bridge"));
		}, PDF_READER_FRAME_EXECUTION_TIMEOUT_MS);
		const onMessage = (message) => {
			if (message?.type !== "onhand-pdf-viewer-evaluate-result" || message.requestId !== requestId) return;
			if (!message.ok) {
				finish(reject, new Error(message.error || missingMessage || "Onhand PDF viewer runtime bridge failed"));
				return;
			}
			finish(resolve, normalizeExecuteScriptValue(message.value));
		};
		try {
			record.port.onMessage.addListener(onMessage);
			record.port.postMessage({
				...(commandPayload && typeof commandPayload === "object" ? commandPayload : {}),
				type: "onhand-pdf-viewer-evaluate",
				requestId,
			});
		} catch (error) {
			finish(reject, error);
		}
	});
}

async function evaluateInOnhandPdfViewerFrameViaRuntimePort(tabId, expression, missingMessage) {
	return await callOnhandPdfViewerFrameViaRuntimePort(tabId, { command: "evaluate", expression }, missingMessage);
}

function collectDebuggerFrameTree(frameTree, frames = []) {
	if (!frameTree?.frame) return frames;
	frames.push(frameTree.frame);
	for (const child of frameTree.childFrames || []) {
		collectDebuggerFrameTree(child, frames);
	}
	return frames;
}

function frameOrContextLooksLikeGoogleScholarReader(frame, context) {
	const values = [
		frame?.url,
		frame?.urlFragment,
		context?.origin,
		context?.name,
		context?.auxData?.name,
	]
		.filter(Boolean)
		.map(String);
	return values.some((value) => value.startsWith(GOOGLE_SCHOLAR_READER_FRAME_PREFIX));
}

function frameOrContextLooksLikeOnhandPdfViewer(frame, context) {
	const values = [
		frame?.url,
		frame?.urlFragment,
		context?.origin,
		context?.name,
		context?.auxData?.name,
	]
		.filter(Boolean)
		.map(String);
	return values.some((value) => isOnhandPdfViewerLikeUrl(value));
}

function isUnsupportedPdfSurfacePayload(payload) {
	return payload && typeof payload === "object" && payload.surface === "pdf" && payload.unsupported === true;
}

function shouldRetryGoogleScholarReaderFrame(methodName, payload) {
	if (isUnsupportedPdfSurfacePayload(payload)) return true;
	if (methodName === "getSelectionInfo" && payload && typeof payload === "object" && payload.hasSelection === false) return true;
	if (methodName === "captureState" && payload && typeof payload === "object" && Number(payload.annotationCount || 0) === 0) return true;
	if (methodName === "clearAnnotations") return true;
	return false;
}

function annotateGoogleScholarReaderFrameFallbackFailure(payload, error) {
	if (!payload || typeof payload !== "object") return payload;
	return {
		...payload,
		readerFrameFallback: {
			attempted: true,
			ok: false,
			error: error?.message || String(error || "Google Scholar PDF Reader frame fallback failed"),
		},
	};
}

function annotateGoogleScholarReaderFrameFallbackFailureIfRelevant(methodName, payload, error) {
	if (!error || !payload || typeof payload !== "object") return payload;
	if (!shouldRetryGoogleScholarReaderFrame(methodName, payload)) return payload;
	return annotateGoogleScholarReaderFrameFallbackFailure(payload, error);
}

// The viewer frame executor joins the failure messages of its delivery
// attempts. Treat the result as "frame not present" only when every part
// is a missing-frame/transport miss; anything else is a real error from
// the viewer surface and should be surfaced instead of the generic
// main-world unsupported-PDF error (see docs/onhand-pdf-qa-2026-06-09.md).
function isMissingOnhandPdfViewerFrameError(error) {
	const message = error?.message || String(error || "");
	if (!message.trim()) return false;
	return message.split("; ").every((part) => /No Onhand PDF viewer (runtime port|frame)|frame context found/i.test(part));
}

function annotateOnhandPdfViewerFrameFallbackFailure(payload, error) {
	if (!payload || typeof payload !== "object") return payload;
	return {
		...payload,
		onhandPdfViewerFrameFallback: {
			attempted: true,
			ok: false,
			error: error?.message || String(error || "Onhand PDF viewer frame fallback failed"),
		},
	};
}

function isLikelyPdfTabUrl(value) {
	try {
		const url = new URL(String(value || ""));
		if (/\.pdf$/i.test(url.pathname)) return true;
		if (/(?:^|\/)pdfs?(?:\/|$)/i.test(url.pathname)) return true;
		for (const [name, raw] of url.searchParams.entries()) {
			const key = String(name || "").toLowerCase();
			const parameterValue = String(raw || "").toLowerCase();
			if ((key === "format" || key === "type" || key === "output" || key === "view") && parameterValue === "pdf") return true;
			if (/\.pdf(?:[?#]|$)/i.test(parameterValue)) return true;
		}
		return false;
	} catch {
		const text = String(value || "");
		return /\.pdf(?:[?#]|$)/i.test(text) || /(?:^|\/)pdfs?(?:\/|$)/i.test(text) || /(?:[?&#](?:format|type|output|view)=pdf)(?:&|$)/i.test(text);
	}
}

function shouldTryGoogleScholarReaderFrameForTab(tab, payload = null) {
	if (isUnsupportedPdfSurfacePayload(payload) && payload.viewer === "google-scholar") return true;
	return isLikelyPdfTabUrl(tab?.url);
}

function shouldTryOnhandPdfViewerFrameForTab(tab, payload = null) {
	if (isOwnExtensionPdfViewerUrl(tab?.url)) return payload == null || isUnsupportedPdfSurfacePayload(payload);
	if (isUnsupportedPdfSurfacePayload(payload)) return true;
	return isLikelyPdfTabUrl(tab?.url);
}

async function withDebuggerFrameContexts(tabId, findMatchingContexts, fn) {
	return await withDebugger(tabId, async ({ send, target }) => {
		const contexts = [];
		const onEvent = (source, method, params) => {
			if (source.tabId !== target.tabId) return;
			if (method !== "Runtime.executionContextCreated") return;
			if (params?.context) contexts.push(params.context);
		};
		chrome.debugger.onEvent.addListener(onEvent);
		try {
			await send("Page.enable");
			await send("Runtime.enable");
			const frameTree = await send("Page.getFrameTree");
			await delay(150);
			const frames = collectDebuggerFrameTree(frameTree?.frameTree);
			const frameById = new Map(frames.map((frame) => [frame.id, frame]));
			const candidates = contexts.filter((context) => {
				const frame = frameById.get(context?.auxData?.frameId);
				return findMatchingContexts(frame, context);
			});
			return await fn({ send, candidates });
		} finally {
			chrome.debugger.onEvent.removeListener(onEvent);
		}
	});
}

async function evaluateDebuggerExpression(send, expression, contextId, missingMessage) {
	const params = {
		expression,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	};
	if (typeof contextId === "number") params.contextId = contextId;
	const response = await send("Runtime.evaluate", params);
	if (response.exceptionDetails) {
		throw new Error(
			response.exceptionDetails.exception?.description ||
				response.exceptionDetails.text ||
				missingMessage,
		);
	}
	return normalizeRemoteObject(response.result);
}

async function evaluateInMatchingDebuggerFrame(tabId, findMatchingContexts, expression, missingMessage) {
	return await withDebugger(tabId, async ({ send }) => {
		await send("Page.enable");
		await send("Runtime.enable");
		const frameTree = await send("Page.getFrameTree");
		const frames = collectDebuggerFrameTree(frameTree?.frameTree);
		const candidates = frames.filter((frame) => findMatchingContexts(frame, null));
		if (!candidates.length) throw new Error(missingMessage);

		let lastError = null;
		for (const frame of candidates) {
			try {
				const world = await send("Page.createIsolatedWorld", {
					frameId: frame.id,
					worldName: "onhand-frame-eval",
					grantUniversalAccess: true,
				});
				if (!world?.executionContextId) throw new Error(missingMessage);
				return await evaluateDebuggerExpression(send, expression, world.executionContextId, missingMessage);
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError || new Error(missingMessage);
	});
}

async function evaluateInMatchingFrame(tabId, findMatchingContexts, expression, missingMessage) {
	try {
		return await evaluateInMatchingDebuggerFrame(tabId, findMatchingContexts, expression, missingMessage);
	} catch (frameError) {
		try {
			return await withDebuggerFrameContexts(tabId, findMatchingContexts, async ({ send, candidates }) => {
				if (!candidates.length) throw frameError || new Error(missingMessage);
				let lastError = null;
				for (const context of candidates) {
					try {
						return await evaluateDebuggerExpression(send, expression, context.id, missingMessage);
					} catch (error) {
						lastError = error;
					}
				}
				throw lastError || frameError || new Error(missingMessage);
			});
		} catch (contextError) {
			throw contextError || frameError;
		}
	}
}

async function executePageToolkitMethodViaOnhandPdfViewerFrame(tabId, methodName, args = [], toolkitOptions = {}) {
	const missingMessage = `No Onhand PDF viewer frame context found for ${methodName}`;
	const commandPayload = {
		command: "page-toolkit-method",
		methodName,
		args,
		toolkitOptions,
	};
	try {
		return await callOnhandPdfViewerFrameViaRuntimePort(tabId, commandPayload, missingMessage);
	} catch (runtimePortError) {
		try {
			return await callOnhandPdfViewerFrameViaBridge(tabId, commandPayload, missingMessage);
		} catch (bridgeFrameError) {
			try {
				const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
				const serializedOptions = JSON.stringify(toolkitOptions);
				const expression = `(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`;
				return await evaluateInOnhandPdfViewerFrameViaScripting(tabId, expression, missingMessage);
			} catch (scriptingFrameError) {
				try {
					const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
					const serializedOptions = JSON.stringify(toolkitOptions);
					const expression = `(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`;
					return await evaluateInMatchingFrame(tabId, frameOrContextLooksLikeOnhandPdfViewer, expression, missingMessage);
				} catch (debuggerFrameError) {
					const messages = [runtimePortError, bridgeFrameError, scriptingFrameError, debuggerFrameError]
						.map((error) => error?.message || String(error || ""))
						.filter(Boolean)
						.filter((message, index, all) => all.indexOf(message) === index);
					// When the viewer itself reported a real error, drop the
					// transport misses from the other delivery attempts so the
					// surfaced message stays readable.
					const meaningful = messages.filter((message) => !/No Onhand PDF viewer (runtime port|frame)|frame context found/i.test(message));
					throw new Error((meaningful.length ? meaningful : messages).join("; "));
				}
			}
		}
	}
}

async function executePageToolkitMethodViaGoogleScholarReaderFrame(tabId, methodName, args = [], toolkitOptions = {}) {
	const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
	const serializedOptions = JSON.stringify(toolkitOptions);
	const expression = `(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`;
	return await evaluateInMatchingFrame(
		tabId,
		frameOrContextLooksLikeGoogleScholarReader,
		expression,
		`Google Scholar PDF Reader frame evaluation failed: ${methodName}`,
	);
}

async function runPageToolkitMethod(tabId, methodName, ...args) {
	const tab = await chrome.tabs.get(tabId);
	if (!canRunPageToolkitOnTab(tab)) {
		throw new Error(`Onhand page tools only run on web or local-file tabs, not ${describeTabForError(tab)}`);
	}
	const toolkitOptions = await getPageToolkitOptions(tab);
	try {
		const payload = await withOperationTimeout(
			executePageToolkitMethodViaScripting(tabId, methodName, args, toolkitOptions),
			SCRIPT_EXECUTION_TIMEOUT_MS,
			`Page toolkit scripting timed out: ${methodName}`,
		);
		if (shouldTryOnhandPdfViewerFrameForTab(tab, payload)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaOnhandPdfViewerFrame(tabId, methodName, args, toolkitOptions),
					SCRIPT_EXECUTION_TIMEOUT_MS,
					`Onhand PDF viewer frame toolkit timed out: ${methodName}`,
				);
			} catch (frameError) {
				if (!isMissingOnhandPdfViewerFrameError(frameError) && payload && typeof payload === "object") {
					return annotateOnhandPdfViewerFrameFallbackFailure(payload, frameError);
				}
			}
		}
		if (shouldTryGoogleScholarReaderFrameForTab(tab, payload) && shouldRetryGoogleScholarReaderFrame(methodName, payload)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaGoogleScholarReaderFrame(tabId, methodName, args, toolkitOptions),
					PDF_READER_FRAME_EXECUTION_TIMEOUT_MS,
					`Google Scholar PDF Reader frame toolkit timed out: ${methodName}`,
				);
			} catch (frameError) {
				if (payload && typeof payload === "object") {
					return annotateGoogleScholarReaderFrameFallbackFailure(payload, frameError);
				}
			}
		}
		return payload;
	} catch (scriptError) {
		if (isLocalFileAccessError(tab, scriptError)) {
			if (["captureState", "getVisibleText", "getSelectionInfo", "getViewportHeadings", "getScrollState"].includes(methodName)) {
				return unsupportedLocalFileToolkitPayload(methodName, tab, scriptError);
			}
			throw createLocalFileAccessError(tab, scriptError);
		}
		// A restricted-scripting error on a PDF tab usually means the main
		// frame is the browser's native PDF viewer (a different extension);
		// Onhand's inline viewer frame is still reachable, so only give up
		// when there is no Onhand or reader frame left to try.
		if (
			isRestrictedScriptingError(scriptError) &&
			!isOwnExtensionPdfViewerUrl(tab?.url) &&
			!shouldTryOnhandPdfViewerFrameForTab(tab) &&
			!shouldTryGoogleScholarReaderFrameForTab(tab)
		) {
			throw scriptError;
		}
		const mainFrameScriptingRestricted = isRestrictedScriptingError(scriptError);
		if (mainFrameScriptingRestricted) {
			log("Page toolkit main-frame scripting was restricted; trying PDF viewer frame", methodName, tab?.url, scriptError?.message || String(scriptError));
		}
		let readerFrameFallbackError = null;
		if (shouldTryGoogleScholarReaderFrameForTab(tab)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaGoogleScholarReaderFrame(tabId, methodName, args, toolkitOptions),
					PDF_READER_FRAME_EXECUTION_TIMEOUT_MS,
					`Google Scholar PDF Reader frame toolkit timed out: ${methodName}`,
				);
			} catch (frameError) {
				readerFrameFallbackError = frameError;
			}
		}
		let onhandFrameFallbackError = null;
		if (shouldTryOnhandPdfViewerFrameForTab(tab)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaOnhandPdfViewerFrame(tabId, methodName, args, toolkitOptions),
					SCRIPT_EXECUTION_TIMEOUT_MS,
					`Onhand PDF viewer frame toolkit timed out: ${methodName}`,
				);
			} catch (frameError) {
				onhandFrameFallbackError = frameError;
			}
		}
		if (mainFrameScriptingRestricted) {
			// Do not convert Chrome's scripting access denial (for example
			// missing host permission or a protected page) into a whole-tab
			// debugger evaluation. PDF-looking URLs are only a signal to try
			// explicit reader/viewer frames; if those frames are absent or fail,
			// preserve the original browser-enforced access boundary.
			if (onhandFrameFallbackError && !isMissingOnhandPdfViewerFrameError(onhandFrameFallbackError)) {
				throw onhandFrameFallbackError;
			}
			throw scriptError;
		}
		const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
		const serializedOptions = JSON.stringify(toolkitOptions);
		let payload;
		try {
			payload = await withOperationTimeout(
				evaluateInTab(
					tabId,
					`(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`,
					{ skipScripting: true },
				),
				SCRIPT_EXECUTION_TIMEOUT_MS,
				`Page toolkit debugger fallback timed out: ${methodName}`,
			);
		} catch (debuggerFallbackError) {
			// The viewer frame is the authoritative PDF surface when present;
			// its error explains the failure better than the main world's
			// generic unsupported-PDF error.
			if (onhandFrameFallbackError && !isMissingOnhandPdfViewerFrameError(onhandFrameFallbackError)) {
				throw onhandFrameFallbackError;
			}
			throw debuggerFallbackError;
		}
		return annotateGoogleScholarReaderFrameFallbackFailureIfRelevant(methodName, payload, readerFrameFallbackError);
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

async function waitForOnhandPdfViewerReady(tabId, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;
	while (Date.now() < deadline) {
		try {
			const status = await evaluateInTab(
				tabId,
				`(() => {
					const error = document.querySelector(".onhand-pdf-error")?.textContent || "";
					return {
						ready: document.body?.getAttribute("data-onhand-pdf-rendered") === "true",
						error,
						statusText: document.querySelector("#onhand-pdf-status")?.textContent || "",
						pageCountText: document.querySelector("#onhand-pdf-page-count")?.textContent || "",
					};
				})()`,
				{ skipScripting: true },
			);
			if (status?.ready) return { ok: true, ...status };
			if (status?.error) {
				throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
			}
		} catch (error) {
			lastError = error;
		}
		await delay(150);
	}
	throw new Error(lastError?.message || "Timed out waiting for Onhand PDF viewer to finish rendering.");
}

async function waitForInlineOnhandPdfViewerReady(tabId, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;
	const statusCommand = { command: "status" };
	const expression = `(() => {
		const error = document.querySelector(".onhand-pdf-error")?.textContent || "";
		return {
			ready: document.body?.getAttribute("data-onhand-pdf-rendered") === "true",
			error,
			statusText: document.querySelector("#onhand-pdf-status")?.textContent || "",
			pageCountText: document.querySelector("#onhand-pdf-page-count")?.textContent || "",
		};
	})()`;
	while (Date.now() < deadline) {
		try {
			const status = await callOnhandPdfViewerFrameViaRuntimePort(tabId, statusCommand, "No Onhand PDF viewer runtime port found");
			if (status?.ready) return { ok: true, ...status };
			if (status?.error) {
				throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
			}
		} catch (runtimePortError) {
			lastError = runtimePortError;
		}
		try {
			const status = await callOnhandPdfViewerFrameViaBridge(tabId, statusCommand, "No Onhand PDF viewer frame context found");
			if (status?.ready) return { ok: true, ...status };
			if (status?.error) {
				throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
			}
		} catch (error) {
			try {
				const status = await evaluateInOnhandPdfViewerFrameViaScripting(tabId, expression, "No Onhand PDF viewer frame context found");
				if (status?.ready) return { ok: true, ...status };
				if (status?.error) {
					throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
				}
			} catch (fallbackError) {
				try {
					const status = await evaluateInMatchingFrame(
						tabId,
						frameOrContextLooksLikeOnhandPdfViewer,
						expression,
						"No Onhand PDF viewer frame context found",
					);
					if (status?.ready) return { ok: true, ...status };
					if (status?.error) {
						throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
					}
				} catch (debuggerError) {
					lastError = debuggerError || fallbackError || error;
				}
			}
		}
		await delay(150);
	}
	throw new Error(lastError?.message || "Timed out waiting for inline Onhand PDF viewer to finish rendering.");
}

function canRunPageToolkitOnTab(tab) {
	if (typeof tab?.id !== "number" || !tab.url) return false;
	if (isOwnExtensionPdfViewerUrl(tab.url)) return true;
	try {
		const protocol = new URL(tab.url).protocol;
		return protocol === "http:" || protocol === "https:" || protocol === "file:";
	} catch {
		return false;
	}
}

async function syncAnnotationThemeInOpenTabs() {
	const tabs = await chrome.tabs.query({});
	const eligibleTabs = tabs.filter(canRunPageToolkitOnTab);
	if (!eligibleTabs.length) return;
	const toolkitOptions = await getPageToolkitOptions();
	const results = await Promise.allSettled(
		eligibleTabs.map((tab) =>
			withOperationTimeout(
				executePageToolkitMethodViaScripting(tab.id, "syncAnnotationTheme", [], toolkitOptions),
				1000,
				`Annotation theme sync timed out: ${tab.id}`,
			),
		),
	);
	const skipped = results.filter((result) => result.status === "rejected").length;
	if (skipped) {
		log(`Skipped annotation theme sync for ${skipped} tab(s)`);
	}
}

function assertSafeBrowserNavigationUrl(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return;
	}
	if (parsed.protocol === "file:") {
		throw new Error("browser_navigate cannot open file:// URLs. Open local files manually in Chrome, then use Onhand on the active user-opened file tab.");
	}
}

async function navigateBrowser(args = {}) {
	if (typeof args.url !== "string" || !args.url.trim()) {
		throw new Error("navigate requires a non-empty 'url'");
	}
	assertSafeBrowserNavigationUrl(args.url);
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
		return finalTab;
	}

	const targetTab = await resolveTargetTab(args);
	const updatedTab = await chrome.tabs.update(targetTab.id, {
		url: args.url,
		active: args.active === true ? true : undefined,
	});
	const finalTab = waitForLoad ? await waitForTabComplete(updatedTab.id, timeoutMs) : await chrome.tabs.get(updatedTab.id);
	return finalTab;
}

async function probeInlineOnhandPdfViewerStatus(tabId, pdfUrl) {
	const statusCommand = { command: "status" };
	const attempts = [
		() => callOnhandPdfViewerFrameViaRuntimePort(tabId, statusCommand, "No Onhand PDF viewer runtime port found"),
		() => callOnhandPdfViewerFrameViaBridge(tabId, statusCommand, "No Onhand PDF viewer frame context found"),
	];
	for (const attempt of attempts) {
		try {
			const status = await attempt();
			if (!status || status.error) continue;
			// Accept a viewer that is still rendering this PDF: reinstalling
			// would restart the render from scratch.
			if (!status.sourceUrl || stripUrlHash(status.sourceUrl) === stripUrlHash(pdfUrl)) return status;
		} catch {}
	}
	return null;
}

async function openPdfInOnhandViewer(args = {}) {
	const sourceTab = await resolveTargetTab(args);
	const pdfUrl = resolvePdfSourceUrlForViewer(args, sourceTab);
	const sourceIsGoogleDocs = isGoogleDocsDocumentUrl(sourceTab.url);
	const shouldOpenViewerInNewTab = args.newTab === true || (sourceIsGoogleDocs && args.newTab !== false);
	// Reuse a viewer that is already rendered for this PDF instead of
	// reinstalling: re-running the install rewrites the iframe src with a
	// freshly inferred page param, which reloads the viewer and yanks the
	// user away from where they were reading on every prompt.
	if (args.forceReload !== true && !shouldOpenViewerInNewTab && !sourceIsGoogleDocs && !isOnhandPdfViewerLikeUrl(sourceTab.url) && isHttpLikeUrl(pdfUrl)) {
		const existingStatus = await probeInlineOnhandPdfViewerStatus(sourceTab.id, pdfUrl);
		if (existingStatus) {
			const focusedTab = args.active === false ? sourceTab : await focusTab(sourceTab.id);
			const reuseTimeoutMs = clampNumber(args.timeoutMs, 15000, { min: 100, max: 120000 });
			const viewerReady =
				existingStatus.ready || args.waitForLoad === false
					? { ok: true, ...existingStatus }
					: await waitForInlineOnhandPdfViewerReady(sourceTab.id, reuseTimeoutMs);
			return {
				tab: simplifyTab(focusedTab),
				sourceTab: simplifyTab(sourceTab),
				pdfUrl,
				viewerUrl: buildOnhandPdfViewerUrl(pdfUrl, existingStatus.pageNumber ? { pageNumber: existingStatus.pageNumber } : {}),
				initialPageNumber: existingStatus.pageNumber || null,
				initialPageSource: "existing-onhand-pdf-viewer",
				initialScrollRatio: null,
				viewerReady,
				alreadyOpen: true,
				opened: false,
				replacedCurrentTab: false,
				reusedExistingViewer: true,
				preservedSourceUrl: true,
			};
		}
	}
	const initialPageLocation = await inferInitialPdfViewerPageLocation(args, sourceTab, pdfUrl);
	const initialPageNumber = initialPageLocation?.pageNumber || null;
	const initialPageSource = initialPageLocation?.source || null;
	let initialScrollRatio = null;
	if (!initialPageNumber && sourceTab?.id && shouldInferPdfPageNumberFromTab(sourceTab, pdfUrl)) {
		try {
			const tabLocation = await inferPdfScrollRatioFromTabDom(sourceTab.id);
			initialScrollRatio = normalizePdfScrollRatio(tabLocation?.scrollRatio);
		} catch {}
		if (!initialScrollRatio) {
			try {
				const layoutLocation = await inferPdfScrollRatioFromDebuggerLayout(sourceTab.id);
				initialScrollRatio = normalizePdfScrollRatio(layoutLocation?.scrollRatio);
			} catch {}
		}
	}
	const viewerOptions = initialPageNumber
		? { pageNumber: initialPageNumber }
		: initialScrollRatio
			? { scrollRatio: initialScrollRatio }
			: {};
	const viewerUrl = buildOnhandPdfViewerUrl(pdfUrl, viewerOptions);
	const waitForLoad = args.waitForLoad !== false;
	const timeoutMs = clampNumber(args.timeoutMs, 15000, { min: 100, max: 120000 });
	const sourceTabSnapshot = simplifyTab(sourceTab);
	log("PDF viewer initial location", {
		sourceTab: sourceTabSnapshot,
		pdfUrl,
		initialPageNumber,
		initialPageSource,
		initialScrollRatio,
		viewerUrl,
	});

	if (!sourceIsGoogleDocs && !isOnhandPdfViewerLikeUrl(sourceTab.url) && isHttpLikeUrl(pdfUrl)) {
		let targetTab;
		if (args.newTab === true) {
			targetTab = await chrome.tabs.create({
				url: pdfUrl,
				active: args.active !== false,
				windowId: typeof sourceTab.windowId === "number" ? sourceTab.windowId : undefined,
			});
		} else if (sourceTab.url === pdfUrl || String(sourceTab.url || "").split("#")[0] === pdfUrl.split("#")[0]) {
			targetTab = args.active === false ? sourceTab : await focusTab(sourceTab.id);
		} else {
			targetTab = await chrome.tabs.update(sourceTab.id, {
				url: pdfUrl,
				active: args.active === false ? undefined : true,
			});
		}
		const finalTab = waitForLoad ? await waitForTabComplete(targetTab.id, timeoutMs) : await chrome.tabs.get(targetTab.id);
		await ensureInlinePdfViewerBridgeToken(pdfUrl);
		const inlineViewer = await installInlineOnhandPdfViewer(finalTab.id, pdfUrl, viewerOptions);
		const viewerReady = waitForLoad ? await waitForInlineOnhandPdfViewerReady(finalTab.id, timeoutMs) : null;
		return {
			tab: simplifyTab(await chrome.tabs.get(finalTab.id)),
			sourceTab: sourceTabSnapshot,
			pdfUrl,
			viewerUrl,
			initialPageNumber,
			initialPageSource,
			initialScrollRatio,
			viewerReady,
			inlineViewer,
			alreadyOpen: sourceTab.url === pdfUrl,
			opened: true,
			replacedCurrentTab: args.newTab !== true,
			preservedSourceUrl: true,
		};
	}

	if (isOnhandPdfViewerLikeUrl(sourceTab.url) && extractPdfSourceUrlFromViewerLikeUrl(sourceTab.url) === pdfUrl) {
		const focusedTab = args.active === false ? sourceTab : await focusTab(sourceTab.id);
		const viewerReady = waitForLoad && isOwnExtensionPdfViewerUrl(focusedTab.url) ? await waitForOnhandPdfViewerReady(focusedTab.id, timeoutMs) : null;
		return {
			tab: simplifyTab(focusedTab),
			sourceTab: sourceTabSnapshot,
			pdfUrl,
			viewerUrl,
			initialPageNumber,
			initialPageSource,
			initialScrollRatio,
			viewerReady,
			alreadyOpen: true,
			opened: false,
			replacedCurrentTab: false,
		};
	}

	let targetTab;
	if (shouldOpenViewerInNewTab) {
		targetTab = await chrome.tabs.create({
			url: viewerUrl,
			active: args.active !== false,
			windowId: typeof sourceTab.windowId === "number" ? sourceTab.windowId : undefined,
		});
	} else {
		targetTab = await chrome.tabs.update(sourceTab.id, {
			url: viewerUrl,
			active: args.active === false ? undefined : true,
		});
	}

	const finalTab = waitForLoad ? await waitForTabComplete(targetTab.id, timeoutMs) : await chrome.tabs.get(targetTab.id);
	let viewerReady = null;
	if (waitForLoad && isOwnExtensionPdfViewerUrl(finalTab?.url)) {
		viewerReady = await waitForOnhandPdfViewerReady(finalTab.id, timeoutMs);
	}
	return {
		tab: simplifyTab(finalTab),
		sourceTab: sourceTabSnapshot,
		pdfUrl,
		viewerUrl,
		initialPageNumber,
		initialPageSource,
		initialScrollRatio,
		viewerReady,
		alreadyOpen: false,
		opened: true,
		replacedCurrentTab: !shouldOpenViewerInNewTab,
		preservedSourceUrl: sourceIsGoogleDocs && shouldOpenViewerInNewTab,
	};
}

async function highlightGoogleDocsViaPdfViewer(sourceTab, args = {}) {
	const pdfUrl = buildGoogleDocsPdfExportUrl(sourceTab?.url);
	if (!pdfUrl) throw new Error("Could not build a Google Docs PDF export URL for this document.");
	const handoff = await openPdfInOnhandViewer({
		...args,
		tabId: sourceTab.id,
		pdfUrl,
		newTab: true,
		waitForLoad: true,
		active: args.active,
	});
	const viewerTabId = handoff?.tab?.id;
	if (typeof viewerTabId !== "number") {
		throw new Error("Could not open the Google Doc in Onhand's PDF viewer.");
	}
	const annotation = await runPageToolkitMethod(viewerTabId, "highlightText", args.text, {
		occurrence: args.occurrence,
		clearExisting: args.clearExisting,
		scrollIntoView: args.scrollIntoView,
		exactOnly: args.exactOnly,
		allowApproximate: args.allowApproximate,
		reuseExisting: args.reuseExisting,
		pdfAnchor: args.pdfAnchor,
	});
	const viewerTab = await chrome.tabs.get(viewerTabId);
	return {
		tab: simplifyTab(viewerTab),
		sourceTab: simplifyTab(sourceTab),
		annotation,
		handoff: {
			surface: "google-docs",
			mode: "pdf-export",
			pdfUrl,
			viewerUrl: handoff.viewerUrl,
			opened: Boolean(handoff.opened),
			alreadyOpen: Boolean(handoff.alreadyOpen),
			replacedCurrentTab: Boolean(handoff.replacedCurrentTab),
			preservedSourceUrl: true,
		},
	};
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
	} catch (scriptError) {
		if (isRestrictedScriptingError(scriptError)) {
			throw scriptError;
		}
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
	const clip =
		options.clip && typeof options.clip === "object" && Number(options.clip.width) > 0 && Number(options.clip.height) > 0
			? {
					x: Number(options.clip.x) || 0,
					y: Number(options.clip.y) || 0,
					width: Number(options.clip.width),
					height: Number(options.clip.height),
					scale: Number(options.clip.scale) > 0 ? Number(options.clip.scale) : 1,
				}
			: undefined;

		try {
			const base64 = await withDebugger(focusedTab.id, async ({ send }) => {
				await send("Page.enable");
				const response = await send("Page.captureScreenshot", {
					format,
					quality,
					fromSurface: true,
					...(clip ? { clip } : {}),
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

async function getVisibleRegionSnapshot(tabId, options = {}) {
	const focusedTab = await focusTab(tabId);
	const viewport = await executeScriptInTab(
		focusedTab.id,
		(selector) => {
			const viewport = {
				width: Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1)),
				height: Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1)),
				devicePixelRatio: Number(window.devicePixelRatio || 1),
				scrollX: Math.round(window.scrollX || 0),
				scrollY: Math.round(window.scrollY || 0),
			};
			let selectorRegion = null;
			const rawSelector = String(selector || "").trim();
			if (rawSelector) {
				const element = document.querySelector(rawSelector);
				if (!element) throw new Error(`No element matched selector: ${rawSelector}`);
				const rect = element.getBoundingClientRect();
				selectorRegion = {
					x: Math.round(rect.left),
					y: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
					selector: rawSelector,
				};
			}
			return { viewport, selectorRegion };
		},
		[String(options.selector || "")],
	);
	const viewportInfo = viewport?.viewport || { width: 1, height: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
	const selectorRegion = viewport?.selectorRegion || null;
	const rawRegion = selectorRegion || {
		x: typeof options.x === "number" ? options.x : 0,
		y: typeof options.y === "number" ? options.y : 0,
		width: typeof options.width === "number" ? options.width : viewportInfo.width,
		height: typeof options.height === "number" ? options.height : viewportInfo.height,
	};
	const x = clampNumber(rawRegion.x, 0, { min: 0, max: Math.max(0, viewportInfo.width - 1) });
	const y = clampNumber(rawRegion.y, 0, { min: 0, max: Math.max(0, viewportInfo.height - 1) });
	const width = clampNumber(rawRegion.width, viewportInfo.width - x, { min: 1, max: Math.max(1, viewportInfo.width - x) });
	const height = clampNumber(rawRegion.height, viewportInfo.height - y, { min: 1, max: Math.max(1, viewportInfo.height - y) });
	const region = {
		x,
		y,
		width,
		height,
		coordinateSystem: "viewport-css-pixels",
		...(selectorRegion?.selector ? { selector: selectorRegion.selector } : {}),
	};
	const screenshot = await captureTabScreenshot(focusedTab.id, {
		...options,
		clip: {
			x,
			y,
			width,
			height,
			scale: 1,
		},
	});
	return {
		tab: focusedTab,
		dataUrl: screenshot.dataUrl,
		method: screenshot.method,
		mimeType: options.format === "jpeg" ? "image/jpeg" : "image/png",
		label: String(options.label || selectorRegion?.selector || "visible region").trim().slice(0, 80) || "visible region",
		region,
		viewport: viewportInfo,
		capturedAt: new Date().toISOString(),
	};
}

function normalizeGoogleDocsExportText(value) {
	return String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/\u0000/g, "")
		.replace(/\uFEFF/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function isGoogleDocsDocumentUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return url.hostname === "docs.google.com" && /^\/document\/d\/[^/]+/i.test(url.pathname);
	} catch {
		return false;
	}
}

function googleDocsDocumentIdFromUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return decodeURIComponent(url.pathname.match(/^\/document\/d\/([^/]+)/i)?.[1] || "");
	} catch {
		return "";
	}
}

function buildGoogleDocsTextExportUrl(value) {
	const sourceUrl = new URL(String(value || ""));
	const documentId = googleDocsDocumentIdFromUrl(sourceUrl.href);
	if (!documentId) return "";
	const exportUrl = new URL(`/document/d/${encodeURIComponent(documentId)}/export`, sourceUrl.origin);
	exportUrl.searchParams.set("format", "txt");
	return exportUrl.href;
}

function buildGoogleDocsPdfExportUrl(value) {
	const sourceUrl = new URL(String(value || ""));
	const documentId = googleDocsDocumentIdFromUrl(sourceUrl.href);
	if (!documentId) return "";
	const exportUrl = new URL(`/document/d/${encodeURIComponent(documentId)}/export`, sourceUrl.origin);
	exportUrl.searchParams.set("format", "pdf");
	return exportUrl.href;
}

function googleDocsTextExportUnsupportedPayload(tab, reason, exportUrl = "") {
	return {
		surface: "google-docs",
		source: "google-docs-export",
		unsupported: true,
		reason,
		url: tab?.url || "",
		exportUrl,
		title: tab?.title || "",
		blockCount: 0,
		charCount: 0,
		truncated: false,
		blocks: [],
		markdown: reason,
		text: reason,
	};
}

function googleDocsTextExportPayloadFromText(tab, text, exportUrl, maxChars = 20000) {
	const limit = Math.max(1000, Math.min(50000, Number(maxChars || 20000) || 20000));
	const normalized = normalizeGoogleDocsExportText(text);
	const truncatedText = normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
	const blocks = [];
	let usedChars = 0;
	for (const paragraph of truncatedText.split(/\n{2,}|\n/g).map((part) => part.trim()).filter(Boolean)) {
		if (usedChars >= limit || blocks.length >= 120) break;
		const remaining = limit - usedChars;
		const output = paragraph.length > remaining ? `${paragraph.slice(0, Math.max(0, remaining - 1))}…` : paragraph;
		blocks.push({
			tag: "p",
			selector: "google-docs-export",
			text: output,
		});
		usedChars += output.length + 2;
	}
	const markdown = blocks.map((block) => block.text).join("\n\n");
	return {
		surface: "google-docs",
		source: "google-docs-export",
		url: tab?.url || "",
		exportUrl,
		title: tab?.title || "",
		root: "google-docs-export",
		blockCount: blocks.length,
		charCount: markdown.length,
		truncated: normalized.length > limit,
		blocks,
		markdown: markdown || "Google Docs export returned no document body text.",
		text: markdown || "Google Docs export returned no document body text.",
	};
}

async function extractGoogleDocsTextExportForTab(tab, options = {}) {
	if (!isGoogleDocsDocumentUrl(tab?.url)) return null;
	const exportUrl = buildGoogleDocsTextExportUrl(tab.url);
	if (!exportUrl) return googleDocsTextExportUnsupportedPayload(tab, "Could not identify the Google Docs document id from this tab URL.");
	try {
		const response = await fetch(exportUrl, {
			credentials: "include",
			cache: "no-store",
			redirect: "follow",
		});
		if (!response?.ok) {
			return googleDocsTextExportUnsupportedPayload(tab, `Could not export this Google Doc as text (${response?.status || "unknown status"}).`, exportUrl);
		}
		const contentType = String(response.headers?.get?.("content-type") || "");
		const text = await response.text();
		if (/text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
			return googleDocsTextExportUnsupportedPayload(tab, "Google Docs returned an HTML page instead of document text.", exportUrl);
		}
		return googleDocsTextExportPayloadFromText(tab, text, exportUrl, options.maxChars);
	} catch (error) {
		return googleDocsTextExportUnsupportedPayload(tab, `Could not export this Google Doc as text: ${error?.message || String(error)}`, exportUrl);
	}
}

async function extractReadableContentInPage(options = {}) {
	const maxChars = Math.max(1000, Math.min(50000, Number(options.maxChars || 20000) || 20000));
	const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
	const normalizeExportText = (value) =>
		String(value || "")
			.replace(/\r\n?/g, "\n")
			.replace(/\u0000/g, "")
			.replace(/\uFEFF/g, "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	const isGoogleDocsDocumentPage = () => {
		try {
			return location.hostname === "docs.google.com" && /^\/document\/d\/[^/]+/i.test(location.pathname);
		} catch {
			return false;
		}
	};
	const googleDocsDocumentId = () => {
		try {
			return decodeURIComponent(location.pathname.match(/^\/document\/d\/([^/]+)/i)?.[1] || "");
		} catch {
			return "";
		}
	};
	const googleDocsUnsupportedPayload = (reason, exportUrl = "") => ({
		surface: "google-docs",
		source: "google-docs-export",
		unsupported: true,
		reason,
		url: location.href,
		exportUrl,
		title: document.title,
		blockCount: 0,
		charCount: 0,
		truncated: false,
		blocks: [],
		markdown: reason,
		text: reason,
	});
	const googleDocsPayloadFromText = (text, exportUrl) => {
		const normalized = normalizeExportText(text);
		const truncatedText = normalized.length > maxChars ? `${normalized.slice(0, Math.max(0, maxChars - 1))}…` : normalized;
		const blocks = [];
		let usedChars = 0;
		for (const paragraph of truncatedText.split(/\n{2,}|\n/g).map((part) => part.trim()).filter(Boolean)) {
			if (usedChars >= maxChars || blocks.length >= 120) break;
			const remaining = maxChars - usedChars;
			const output = paragraph.length > remaining ? `${paragraph.slice(0, Math.max(0, remaining - 1))}…` : paragraph;
			blocks.push({
				tag: "p",
				selector: "google-docs-export",
				text: output,
			});
			usedChars += output.length + 2;
		}
		const markdown = blocks.map((block) => block.text).join("\n\n");
		return {
			surface: "google-docs",
			source: "google-docs-export",
			url: location.href,
			exportUrl,
			title: document.title,
			root: "google-docs-export",
			blockCount: blocks.length,
			charCount: markdown.length,
			truncated: normalized.length > maxChars,
			blocks,
			markdown: markdown || "Google Docs export returned no document body text.",
			text: markdown || "Google Docs export returned no document body text.",
		};
	};
	const fetchGoogleDocsExportContent = async () => {
		if (!isGoogleDocsDocumentPage()) return null;
		const documentId = googleDocsDocumentId();
		if (!documentId) return googleDocsUnsupportedPayload("Could not identify the Google Docs document id from this tab URL.");
		const exportUrl = new URL(`/document/d/${encodeURIComponent(documentId)}/export`, location.origin);
		exportUrl.searchParams.set("format", "txt");
		try {
			const response = await fetch(exportUrl.href, {
				credentials: "include",
				cache: "no-store",
			});
			if (!response?.ok) {
				return googleDocsUnsupportedPayload(`Could not export this Google Doc as text (${response?.status || "unknown status"}).`, exportUrl.href);
			}
			const contentType = String(response.headers?.get?.("content-type") || "");
			const text = await response.text();
			if (/text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
				return googleDocsUnsupportedPayload("Google Docs returned an HTML page instead of document text.", exportUrl.href);
			}
			return googleDocsPayloadFromText(text, exportUrl.href);
		} catch (error) {
			return googleDocsUnsupportedPayload(`Could not export this Google Doc as text: ${error?.message || String(error)}`, exportUrl.href);
		}
	};
	const isVisible = (element) => {
		if (!(element instanceof Element)) return false;
		const style = window.getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const selectorFor = (element) => {
		if (!(element instanceof Element)) return "";
		const bits = [element.tagName.toLowerCase()];
		if (element.id) bits.push(`#${element.id}`);
		const className = String(element.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
		if (className) bits.push(`.${className}`);
		return bits.join("");
	};
	const root =
		document.querySelector("article") ||
		document.querySelector("main") ||
		document.querySelector('[role="main"]') ||
		document.querySelector(".mw-parser-output") ||
		document.body ||
		document.documentElement;
	const ignoredSelector = "script, style, noscript, svg, nav, header, footer, aside, form, button, input, select, textarea";
	const blocks = [];
	const seen = new Set();
	let usedChars = 0;
	const pushBlock = (kind, text, element) => {
		const clean = normalize(text);
		if (!clean || clean.length < 2) return;
		const key = clean.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		const prefix = /^h[1-6]$/.test(kind) ? `${"#".repeat(Number(kind.slice(1)) || 2)} ` : kind === "li" ? "- " : kind === "blockquote" ? "> " : "";
		const body = kind === "pre" ? `\`\`\`\n${String(text || "").trim().slice(0, 3000)}\n\`\`\`` : `${prefix}${clean}`;
		if (usedChars >= maxChars) return;
		const remaining = maxChars - usedChars;
		const output = body.length > remaining ? `${body.slice(0, Math.max(0, remaining - 1))}…` : body;
		blocks.push({
			tag: kind,
			selector: selectorFor(element),
			text: output,
		});
		usedChars += output.length + 2;
	};

	const googleDocsContent = await fetchGoogleDocsExportContent();
	if (googleDocsContent) return googleDocsContent;

	const title = normalize(document.querySelector("h1")?.textContent || document.title);
	if (title) pushBlock("h1", title, document.querySelector("h1") || document.documentElement);

	for (const element of root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, caption")) {
		if (usedChars >= maxChars) break;
		if (!(element instanceof Element) || !isVisible(element)) continue;
		if (element.closest(ignoredSelector) && !["pre"].includes(element.tagName.toLowerCase())) continue;
		pushBlock(element.tagName.toLowerCase(), element.textContent || "", element);
	}

	if (blocks.length < 3) {
		for (const element of root.querySelectorAll("div, section")) {
			if (usedChars >= maxChars || blocks.length >= 40) break;
			if (!(element instanceof Element) || !isVisible(element)) continue;
			if (element.closest(ignoredSelector)) continue;
			const text = normalize(element.textContent || "");
			if (text.length < 80 || text.length > 1200) continue;
			pushBlock("p", text, element);
		}
	}

	const markdown = blocks.map((block) => block.text).join("\n\n");
	return {
		url: location.href,
		title: document.title,
		root: selectorFor(root),
		blockCount: blocks.length,
		charCount: markdown.length,
		truncated: markdown.length >= maxChars,
		blocks,
		markdown,
		text: markdown,
	};
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
			return {
				pong: true,
				extensionVersion: chrome.runtime.getManifest().version,
				runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
				state: await snapshotState(),
			};
		}
		case "list_tabs":
		case "get_state": {
			return await snapshotState(args);
		}
		case "activate_tab": {
			const tab = await resolveTargetTab(args);
			const focusedTab = await focusTab(tab.id);
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
		case "open_pdf_in_onhand_viewer": {
			return await openPdfInOnhandViewer(args);
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
				let result;
				try {
					result = await evaluateInTab(tab.id, args.expression);
				} catch (error) {
					if (isLocalFileAccessError(tab, error)) throw createLocalFileAccessError(tab, error);
					throw error;
				}
				return {
					tab: simplifyTab(tab),
					result,
				};
			});
		}
		case "get_dom": {
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				let outerHTML;
				try {
					outerHTML = await getDomOuterHtml(tab.id);
				} catch (error) {
					if (isLocalFileAccessError(tab, error)) throw createLocalFileAccessError(tab, error);
					throw error;
				}
				return {
					tab: simplifyTab(tab),
					outerHTML,
				};
			});
		}
		case "extract_content": {
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				let content;
				try {
					content =
						(await extractGoogleDocsTextExportForTab(tab, { maxChars: args.maxChars })) ||
						(await evaluateInTab(tab.id, `(${extractReadableContentInPage.toString()})(${JSON.stringify({ maxChars: args.maxChars })})`));
				} catch (error) {
					if (isLocalFileAccessError(tab, error)) content = unsupportedLocalFilePayload(tab, error);
					else throw error;
				}
				return {
					tab: simplifyTab(tab),
					content,
				};
			});
		}
		case "highlight_text": {
			if (typeof args.text !== "string" || !args.text.trim()) {
				throw new Error("highlight_text requires a non-empty 'text'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				if (!args.pdfAnchor && isGoogleDocsDocumentUrl(tab.url)) {
					return await highlightGoogleDocsViaPdfViewer(tab, args);
				}
				const annotation = await runPageToolkitMethod(tab.id, "highlightText", args.text, {
					occurrence: args.occurrence,
					clearExisting: args.clearExisting,
					scrollIntoView: args.scrollIntoView,
					exactOnly: args.exactOnly,
					allowApproximate: args.allowApproximate,
					reuseExisting: args.reuseExisting,
					pdfAnchor: args.pdfAnchor,
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
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const page = await runPageToolkitMethod(tab.id, "captureState");
				return {
					tab: simplifyTab(tab),
					page,
				};
			});
		}
		case "get_visible_text": {
			const tab = await resolveReadTargetTab(args);
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
		case "pdf_search": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const search = await runPageToolkitMethod(tab.id, "searchPdf", {
					query: args.query,
					text: args.text,
					maxMatches: args.maxMatches,
					limit: args.limit,
					maxContextChars: args.maxContextChars,
				});
				return {
					tab: simplifyTab(tab),
					search,
				};
			});
		}
		case "pdf_find_citation": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				// findCitation lives only in the Onhand viewer, so go straight
				// to the viewer executors instead of the generic page toolkit.
				const payload = {
					command: "page-toolkit-method",
					methodName: "findCitation",
					args: [{ reference: args.reference ?? args.label ?? args.query }],
				};
				let citation;
				try {
					citation = await callOnhandPdfViewerFrameViaRuntimePort(tab.id, payload, "No Onhand PDF viewer runtime port found");
				} catch {
					citation = await callOnhandPdfViewerFrameViaBridge(
						tab.id,
						payload,
						"Citation lookup needs the Onhand PDF viewer. Open the PDF with browser_open_pdf_in_onhand_viewer first.",
					);
				}
				return {
					tab: simplifyTab(tab),
					citation,
				};
			});
		}
		case "pdf_read_pages": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const pages = await runPageToolkitMethod(tab.id, "readPdfPages", {
					pages: args.pages,
					page: args.page,
					pageNumber: args.pageNumber,
					startPage: args.startPage,
					endPage: args.endPage,
					maxPages: args.maxPages,
					maxChars: args.maxChars,
				});
				return {
					tab: simplifyTab(tab),
					pages,
				};
			});
		}
		case "pdf_jump_to_page": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const jump = await runPageToolkitMethod(tab.id, "jumpToPdfPage", {
					pageNumber: args.pageNumber,
					page: args.page,
					text: args.text,
					occurrence: args.occurrence,
					pdfAnchor: args.pdfAnchor,
				});
				return {
					tab: simplifyTab(tab),
					jump,
				};
			});
		}
		case "pdf_capture_page_image": {
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const image = await runPageToolkitMethod(tab.id, "capturePdfPageImage", {
					pageNumber: args.pageNumber,
					page: args.page,
					format: args.format,
					quality: args.quality,
				});
				return {
					tab: simplifyTab(tab),
					...image,
				};
			});
		}
		case "get_visible_region_image": {
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const image = await getVisibleRegionSnapshot(tab.id, args);
				const data = typeof image.dataUrl === "string" && image.dataUrl.includes(",") ? image.dataUrl.split(",")[1] : "";
				return {
					tab: simplifyTab(image.tab),
					dataUrl: image.dataUrl,
					data,
					mimeType: image.mimeType,
					method: image.method,
					label: image.label,
					region: image.region,
					viewport: image.viewport,
					capturedAt: image.capturedAt,
				};
			});
		}
		case "get_selection": {
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const selection = await runPageToolkitMethod(tab.id, "getSelectionInfo");
				return {
					tab: simplifyTab(tab),
					selection,
				};
			});
		}
		case "get_viewport_headings": {
			const tab = await resolveReadTargetTab(args);
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
			const tab = await resolveReadTargetTab(args);
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
			const tab = await resolveReadTargetTab(args);
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

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local") return;
	if (changes[ONHAND_THEME_STORAGE_KEY]) {
		syncAnnotationThemeInOpenTabs().catch((error) => log("Annotation theme sync after settings change failed", error));
	}
});

if (chrome.sidePanel?.onOpened?.addListener) {
	chrome.sidePanel.onOpened.addListener(async (info) => {
		if (typeof info?.windowId === "number") {
			await setSidebarWindowOpen(info.windowId, true);
			await requestSidebarQuickOpen(info.windowId);
			getOnhandBrowserRuntime().trackEvent("sidepanel_opened", { result: "ok" }).catch(() => {});
		}
	});
}

if (chrome.sidePanel?.onClosed?.addListener) {
	chrome.sidePanel.onClosed.addListener(async (info) => {
		if (typeof info?.windowId === "number") {
			await setSidebarWindowOpen(info.windowId, false);
			getOnhandBrowserRuntime().trackEvent("sidepanel_closed", { result: "ok" }).catch(() => {});
		}
	});
}

chrome.runtime.onConnect.addListener((port) => {
	if (port?.name !== ONHAND_PDF_VIEWER_PORT_NAME) return;
	const senderUrl = port?.sender?.url || "";
	const senderOrigin = port?.sender?.origin || "";
	const ownExtensionOrigin = new URL(chrome.runtime.getURL("")).origin;
	const isOwnPdfViewerSender =
		isOwnExtensionPdfViewerUrl(senderUrl) ||
		senderOrigin === ownExtensionOrigin ||
		(port?.sender?.id === chrome.runtime.id && (!senderUrl || senderUrl.startsWith(chrome.runtime.getURL(""))));
	if (!isOwnPdfViewerSender) {
		try {
			port.disconnect();
		} catch {}
		return;
	}
	port.onMessage.addListener((message) => {
		if (message?.type !== "onhand-pdf-viewer-register") return;
		registerOnhandPdfViewerPort(port, message.sourceUrl);
	});
	port.onDisconnect.addListener(() => {
		unregisterOnhandPdfViewerPort(port);
	});
});

function normalizeRealtimeAnchors(value) {
	const anchors = Array.isArray(value) ? value : [];
	return anchors
		.map((anchor) => ({
			text: typeof anchor?.text === "string" ? anchor.text.trim() : "",
			note: typeof anchor?.note === "string" ? anchor.note.trim() : "",
			label: typeof anchor?.label === "string" ? anchor.label.trim() : "",
			conceptLabel: typeof anchor?.conceptLabel === "string" ? anchor.conceptLabel.trim() : "",
			checkKind: typeof anchor?.checkKind === "string" ? anchor.checkKind.trim() : "",
			checkPrompt: typeof anchor?.checkPrompt === "string" ? anchor.checkPrompt.trim() : "",
		}))
		.filter((anchor) => anchor.text);
}

function summarizeRealtimePdfContext({ tab, page, selection, visible, errors } = {}) {
	const tabUrl = String(tab?.url || page?.url || visible?.url || selection?.url || "");
	const pageSurface = page && typeof page === "object" ? page : null;
	const visibleSurface = visible && typeof visible === "object" ? visible : null;
	const selectionSurface = selection && typeof selection === "object" ? selection : null;
	const isPdf =
		pageSurface?.surface === "pdf" ||
		visibleSurface?.surface === "pdf" ||
		selectionSurface?.surface === "pdf" ||
		isLikelyPdfResourceUrl(tabUrl) ||
		isOnhandPdfViewerLikeUrl(tabUrl);
	if (!isPdf) return null;
	const text =
		String(selectionSurface?.text || "").trim() ||
		String(visibleSurface?.text || "").trim() ||
		String(pageSurface?.text || "").trim();
	const unsupported =
		pageSurface?.unsupported === true ||
		visibleSurface?.unsupported === true ||
		selectionSurface?.unsupported === true ||
		Boolean((errors?.capture || errors?.visible || errors?.selection) && isLikelyPdfResourceUrl(tabUrl) && !text);
	return {
		surface: "pdf",
		viewer: pageSurface?.viewer || visibleSurface?.viewer || selectionSurface?.viewer || (isOnhandPdfViewerLikeUrl(tabUrl) ? "onhand-pdf-viewer" : ""),
		url: tabUrl,
		supported: Boolean(text && !unsupported),
		unsupported,
		handoffAvailable: Boolean(!isOnhandPdfViewerLikeUrl(tabUrl) && isLikelyPdfResourceUrl(tabUrl)),
		message: unsupported
			? "PDF context is not readable in this surface yet. Open it in Onhand's PDF viewer before tutoring from it."
			: text
				? "PDF text context is available."
				: "PDF detected; text context is still loading or unavailable.",
	};
}

function buildRealtimeSessionConfig() {
	return {
		type: "realtime",
		model: OPENAI_REALTIME_MODEL,
		output_modalities: ["audio"],
		audio: {
			input: {
				noise_reduction: { type: "far_field" },
				transcription: { model: "gpt-4o-mini-transcribe" },
				turn_detection: {
					type: "semantic_vad",
					eagerness: "low",
					create_response: false,
					interrupt_response: false,
				},
			},
			output: { voice: OPENAI_REALTIME_VOICE },
		},
		instructions: [
			"You are Onhand's realtime audio interface.",
			"Use semantic patience for microphone turns.",
			"Do not answer page questions from audio by yourself; Onhand will send exact answer text to speak when the runtime agent has finished page grounding.",
		].join(" "),
	};
}

function createRealtimeMultipartBody(sdp, session) {
	const boundary = `onhand-realtime-${crypto.randomUUID()}`;
	const delimiter = `--${boundary}`;
	const body = [
		delimiter,
		'Content-Disposition: form-data; name="sdp"',
		"Content-Type: application/sdp",
		"",
		sdp,
		delimiter,
		'Content-Disposition: form-data; name="session"',
		"Content-Type: application/json",
		"",
		JSON.stringify(session),
		`${delimiter}--`,
		"",
	].join("\r\n");
	return {
		body,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

async function createRealtimeCallWithStoredApiKey(browserSdp) {
	const sdp = typeof browserSdp === "string" ? browserSdp : "";
	const normalizedSdp = sdp.replace(/\r\n/g, "\n");
	if (!normalizedSdp.startsWith("v=0") || !/\nm=audio\s/i.test(normalizedSdp) || !/\nm=application\s/i.test(normalizedSdp)) {
		throw new Error(`Browser SDP is missing required audio/data-channel media sections (${sdp.length} chars received).`);
	}
	const credential = await getOnhandBrowserRuntime().getOpenAIRealtimeCredential();
	const apiKey = String(credential?.apiKey || "").trim();
	if (!apiKey) throw new Error(REALTIME_API_KEY_SETUP_MESSAGE);

	const multipart = createRealtimeMultipartBody(sdp, buildRealtimeSessionConfig());

	const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": multipart.contentType,
			"OpenAI-Safety-Identifier": "onhand-browser-extension",
		},
		body: multipart.body,
	});
	const answerSdp = await response.text();
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			throw new Error(`${REALTIME_API_KEY_SETUP_MESSAGE} OpenAI rejected the saved key.`);
		}
		throw new Error(answerSdp || `OpenAI Realtime call setup failed with ${response.status}.`);
	}
	return {
		sdp: answerSdp,
		model: OPENAI_REALTIME_MODEL,
		voice: OPENAI_REALTIME_VOICE,
		source: credential?.source || "extension-auth",
	};
}

async function createRealtimeClientSecret() {
	const credential = await getOnhandBrowserRuntime().getOpenAIRealtimeCredential();
	const apiKey = String(credential?.apiKey || "").trim();
	if (!apiKey) throw new Error(REALTIME_API_KEY_SETUP_MESSAGE);
	const session = buildRealtimeSessionConfig();
	const attempts = [
		{ label: "nested-session", body: { session } },
		{ label: "top-level-session", body: session },
	];
	const errors = [];
	let payload = null;
	for (const attempt of attempts) {
		const response = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"OpenAI-Safety-Identifier": "onhand-browser-extension",
			},
			body: JSON.stringify(attempt.body),
		});
		const text = await response.text();
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = null;
		}
		if (response.ok) break;
		if (response.status === 401 || response.status === 403) {
			errors.push(`${attempt.label}: ${REALTIME_API_KEY_SETUP_MESSAGE} OpenAI rejected the saved key.`);
			payload = null;
			break;
		}
		errors.push(`${attempt.label}: ${text || `HTTP ${response.status}`}`);
		payload = null;
	}
	if (!payload) {
		throw new Error(errors.join(" "));
	}
	const value = payload?.value || payload?.client_secret?.value || payload?.client_secret || "";
	if (!value) throw new Error("OpenAI Realtime client secret response did not include a value.");
	return {
		value,
		model: OPENAI_REALTIME_MODEL,
		voice: OPENAI_REALTIME_VOICE,
		source: credential?.source || "extension-auth",
	};
}

async function getRealtimeLearningContext(windowId) {
	const args = typeof windowId === "number" ? { windowId } : {};
	const runtime = getOnhandBrowserRuntime();
	const [state, captured, selection, visible] = await Promise.all([
		runtime.getState().catch((error) => ({ error: error?.message || String(error) })),
		handleCommand("capture_state", args).catch((error) => ({ error: error?.message || String(error) })),
		handleCommand("get_selection", args).catch((error) => ({ error: error?.message || String(error) })),
		handleCommand("get_visible_text", { ...args, maxChars: 5000, maxBlocks: 32 }).catch((error) => ({
			error: error?.message || String(error),
		})),
	]);
	const tab = captured?.tab || visible?.tab || selection?.tab || null;
	const errors = {
		state: state?.error || "",
		capture: captured?.error || "",
		selection: selection?.error || "",
		visible: visible?.error || "",
	};
	return {
		tab,
		page: captured?.page || null,
		selection: selection?.selection || null,
		visible: visible?.visible || null,
		pdf: summarizeRealtimePdfContext({
			tab,
			page: captured?.page || null,
			selection: selection?.selection || null,
			visible: visible?.visible || null,
			errors,
		}),
		learnerState: state?.learnerState || null,
		currentSession: state?.currentSession || null,
		preferences: state?.preferences || null,
		errors,
	};
}

async function annotateRealtimePage(message) {
	const windowId = typeof message.windowId === "number" ? message.windowId : undefined;
	const baseArgs = typeof windowId === "number" ? { windowId } : {};
	const anchors = normalizeRealtimeAnchors(message.anchors);
	if (!anchors.length) throw new Error("At least one anchor with text is required.");

	const runtime = getOnhandBrowserRuntime();
	const results = [];
	for (let index = 0; index < anchors.length; index += 1) {
		const anchor = anchors[index];
		const highlighted = await handleCommand("highlight_text", {
			...baseArgs,
			text: anchor.text,
			clearExisting: false,
			scrollIntoView: index === 0,
			reuseExisting: true,
			allowApproximate: true,
		});
		const annotationId = highlighted?.annotation?.annotationId || "";
		let note = null;
		if (annotationId && anchor.note) {
			note = await handleCommand("show_note", {
				...baseArgs,
				annotationId,
				note: anchor.note,
				label: anchor.label || "Tutor note",
				scrollIntoView: index === 0,
			});
		}

		if (anchor.conceptLabel) {
			await runtime.recordLearningEvent({
				kind: "concept_introduced",
				conceptLabel: anchor.conceptLabel,
				annotationId,
				url: highlighted?.tab?.url || "",
				tabTitle: highlighted?.tab?.title || "",
			});
		}
		if (anchor.checkPrompt) {
			await runtime.recordLearningEvent({
				kind: "check_opened",
				checkKind: anchor.checkKind === "retrieval" ? "retrieval" : "prediction",
				conceptLabel: anchor.conceptLabel || "Page concept",
				promptText: anchor.checkPrompt,
				annotationId,
				url: highlighted?.tab?.url || "",
				tabTitle: highlighted?.tab?.title || "",
			});
		}

		results.push({
			text: anchor.text,
			note: anchor.note,
			label: anchor.label,
			conceptLabel: anchor.conceptLabel,
			annotationId,
			tab: highlighted?.tab || null,
			matchedText: highlighted?.annotation?.matchedText || highlighted?.annotation?.text || "",
			noteAnnotationId: note?.note?.annotationId || "",
		});
	}
	return {
		annotations: results,
		learnerState: (await runtime.getState())?.learnerState || null,
	};
}

const REALTIME_BROWSER_TOOL_COMMANDS = Object.freeze({
	browser_navigate: "navigate",
	browser_click_text: "click_text",
	browser_open_pdf_in_onhand_viewer: "open_pdf_in_onhand_viewer",
	browser_pdf_search: "pdf_search",
	browser_pdf_read_pages: "pdf_read_pages",
	browser_pdf_jump_to_page: "pdf_jump_to_page",
	browser_get_visible_text: "get_visible_text",
	browser_extract_content: "extract_content",
	browser_get_selection: "get_selection",
	browser_get_viewport_headings: "get_viewport_headings",
	browser_get_scroll_state: "get_scroll_state",
	browser_highlight_text: "highlight_text",
	browser_show_note: "show_note",
	browser_scroll_to_annotation: "scroll_to_annotation",
	browser_clear_annotations: "clear_annotations",
});

function sanitizeRealtimeBrowserToolArgsForCommand(command, args = {}) {
	const sanitized = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
	delete sanitized.tabId;
	delete sanitized.titleContains;
	delete sanitized.urlContains;
	if (command === "navigate" || command === "open_pdf_in_onhand_viewer") {
		sanitized.newTab = false;
	}
	return sanitized;
}

function normalizeRealtimeBrowserToolArgs(args = {}) {
	const raw = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
	const aliases = {
		tab_id: "tabId",
		title_contains: "titleContains",
		url_contains: "urlContains",
		new_tab: "newTab",
		wait_for_load: "waitForLoad",
		timeout_ms: "timeoutMs",
		pdf_url: "pdfUrl",
		max_matches: "maxMatches",
		max_context_chars: "maxContextChars",
		page_number: "pageNumber",
		start_page: "startPage",
		end_page: "endPage",
		max_pages: "maxPages",
		max_chars: "maxChars",
		max_blocks: "maxBlocks",
		max_headings: "maxHeadings",
		clear_existing: "clearExisting",
		scroll_into_view: "scrollIntoView",
		exact_only: "exactOnly",
		allow_approximate: "allowApproximate",
		reuse_existing: "reuseExisting",
		annotation_id: "annotationId",
		label_text: "labelText",
		interactive_only: "interactiveOnly",
		include_hidden: "includeHidden",
		max_results: "maxResults",
		duration_ms: "durationMs",
		max_entries: "maxEntries",
		ignore_cache: "ignoreCache",
		only_failures: "onlyFailures",
		match_url_contains: "matchUrlContains",
		include_request_headers: "includeRequestHeaders",
		include_response_headers: "includeResponseHeaders",
		include_bodies: "includeBodies",
		body_max_entries: "bodyMaxEntries",
		body_max_chars: "bodyMaxChars",
		delay_ms: "delayMs",
		include_html: "includeHtml",
		include_screenshot: "includeScreenshot",
		anchor_text: "anchorText",
		text_excerpt: "textExcerpt",
		source_text: "sourceText",
		exact_text: "exactText",
	};
	for (const [from, to] of Object.entries(aliases)) {
		if (Object.prototype.hasOwnProperty.call(raw, from) && !Object.prototype.hasOwnProperty.call(raw, to)) {
			raw[to] = raw[from];
		}
	}
	if (!String(raw.text || "").trim()) {
		const nestedAnchor = raw.anchor && typeof raw.anchor === "object" ? raw.anchor : {};
		const nestedSource = raw.source && typeof raw.source === "object" ? raw.source : {};
		for (const candidate of [
			raw.quote,
			raw.phrase,
			raw.query,
			raw.anchorText,
			raw.textExcerpt,
			raw.sourceText,
			raw.exactText,
			nestedAnchor.text,
			nestedAnchor.quote,
			nestedAnchor.text_excerpt,
			nestedSource.text,
			nestedSource.quote,
			nestedSource.text_excerpt,
		]) {
			const text = String(candidate || "").replace(/\s+/g, " ").trim();
			if (text) {
				raw.text = text;
				break;
			}
		}
	}
	return raw;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	(async () => {
		if (message?.type === "get-status") {
			const runtime = getOnhandBrowserRuntime();
			const browserRuntime = await runtime.getSettings().catch((error) => ({
				error: error?.message || String(error),
			}));
			sendResponse({
				ok: true,
				status: {
					runtime: "browser-extension",
					browserRuntime,
					extensionVersion: chrome.runtime.getManifest().version,
					runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
				},
			});
			return;
		}

		if (message?.type === "browser-runtime:update-settings") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.updateSettings({
				aiProvider: message.aiProvider,
				aiModel: message.aiModel,
				aiApiKey: message.aiApiKey,
				aiApiKeys: message.aiApiKeys,
				authMode: message.authMode,
				realtimeVoiceEnabled: message.realtimeVoiceEnabled,
				diagnosticsEnabled: message.diagnosticsEnabled,
				advancedRuntimeInspectionEnabled: message.advancedRuntimeInspectionEnabled,
				speedMode: message.speedMode,
			});
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}


		if (message?.type === "browser-runtime:validate-api-key") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.validateApiKey({
				providerId: message.providerId,
				apiKey: message.apiKey,
			});
			sendResponse({
				ok: Boolean(result?.ok),
				result,
				error: result?.ok ? undefined : result?.error,
			});
			return;
		}

		if (message?.type === "browser-runtime:remove-api-key") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.removeApiKey(message.providerId);
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}

		if (message?.type === "browser-runtime:auth-progress") {
			sendResponse({ ok: true });
			return;
		}

		if (message?.type === "browser-runtime:track-event") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.trackEvent(String(message.eventName || ""), message.data && typeof message.data === "object" ? message.data : {});
			sendResponse({ ok: true, result });
			return;
		}

		if (message?.type === "browser-runtime:submit-error-report") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.submitErrorReport(String(message.turnId || ""));
			sendResponse({ ok: true, result });
			return;
		}

		if (message?.type === "browser-runtime:oauth-sign-in") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.signIn({
				providerId: message.providerId,
				aiModel: message.aiModel,
			});
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}

		if (message?.type === "browser-runtime:oauth-sign-out") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.signOut(message.providerId);
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}

		if (message?.type === "mic-permission:result") {
			chrome.runtime
				.sendMessage({
					type: "sidebar:mic-permission-result",
					ok: Boolean(message.ok),
					error: typeof message.error === "string" ? message.error : "",
				})
				.catch(() => {});
			sendResponse({ ok: true });
			return;
		}

		if (message?.type === "offscreen-heartbeat") {
			sendResponse({ ok: true });
			return;
		}

		if (message?.type === "sidebar:get-window-state") {
			const windowId = await resolveSidebarMessageWindowId(message, _sender);
			sendResponse({
				ok: true,
				open: await isSidebarOpenForWindow(windowId),
			});
			return;
		}

		if (message?.type === "sidebar:native-panel-opened") {
			const windowId = await resolveSidebarMessageWindowId(message, _sender);
			await setSidebarWindowOpen(windowId, true);
			sendResponse({ ok: true, windowId, open: true });
			return;
		}

		if (message?.type === "sidebar:fetch-state") {
			const runtime = getOnhandBrowserRuntime();
			const runtimeState = await runtime.getState();
			const state = runtimeState && typeof runtimeState === "object" ? { ...runtimeState } : runtimeState;
			if (state && typeof state === "object") {
				state.preferences = {
					...(state.preferences || {}),
					extensionVersion: chrome.runtime.getManifest().version,
					runtimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
				};
				try {
					const tab = await resolveTargetTab({ windowId: message.windowId });
					state.tab = simplifyTab(tab);
				} catch (error) {
					state.tabCaptureError = error?.message || String(error);
				}
				try {
					const captured = await handleCommand("capture_state", { windowId: message.windowId });
					state.tab = captured?.tab || state.tab || null;
					state.page = captured?.page || null;
				} catch (error) {
					state.pageCaptureError = error?.message || String(error);
				}
			}
			sendResponse({
				ok: true,
				state,
			});
			return;
		}

		if (message?.type === "sidebar:realtime-context") {
			sendResponse({
				ok: true,
				context: await getRealtimeLearningContext(typeof message.windowId === "number" ? message.windowId : undefined),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-plan-pedagogical-move") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse({
				ok: true,
				result: await runtime.planRealtimePedagogicalMove({
					userQuestion: message.userQuestion,
					targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
				}),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-evaluate-response") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse({
				ok: true,
				result: await runtime.evaluateRealtimePedagogicalResponse({
					userResponse: message.userResponse,
					previousMove: message.previousMove,
					targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
				}),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-session") {
			sendResponse({
				ok: true,
				result: await createRealtimeCallWithStoredApiKey(message.sdp),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-client-secret") {
			sendResponse({
				ok: true,
				result: await createRealtimeClientSecret(),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-browser-tool") {
			const tool = String(message.tool || "");
			const command = REALTIME_BROWSER_TOOL_COMMANDS[tool] || "";
			if (!command || (message.command && message.command !== command)) {
				throw new Error(`Unsupported realtime browser tool: ${tool || "(missing)"}`);
			}
			const normalizedArgs = normalizeRealtimeBrowserToolArgs(message.args || {});
			const result = await handleCommand(command, {
				...sanitizeRealtimeBrowserToolArgsForCommand(command, normalizedArgs),
				windowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				result,
			});
			return;
		}

		if (message?.type === "sidebar:realtime-pdf-tool") {
			const tool = String(message.tool || "");
			const allowedTools = new Set(["pdf_search", "pdf_read_pages", "pdf_jump_to_page"]);
			if (!allowedTools.has(tool)) {
				throw new Error(`Unsupported realtime PDF tool: ${tool || "(missing)"}`);
			}
			const result = await handleCommand(tool, {
				...(message.args || {}),
				windowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				result,
			});
			return;
		}

		if (message?.type === "sidebar:realtime-annotate") {
			sendResponse({
				ok: true,
				result: await annotateRealtimePage(message),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-record-learning-event") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse({
				ok: true,
				result: await runtime.recordLearningEvent(message.event || {}),
			});
			return;
		}

		if (message?.type === "sidebar:realtime-record-turn") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse({
				ok: true,
				result: await runtime.recordRealtimeVoiceTurn({
					voiceTurnId: message.voiceTurnId,
					kind: message.kind,
					userPrompt: message.userPrompt,
					reply: message.reply,
					status: message.status,
					pageActions: Array.isArray(message.pageActions) ? message.pageActions : [],
				}),
			});
			return;
		}

		if (message?.type === "sidebar:set-learning-mode") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.updateSettings({
				learningMode: Boolean(message.learningMode),
			});
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}

		if (message?.type === "sidebar:set-speed-mode") {
			const runtime = getOnhandBrowserRuntime();
			const settings = await runtime.updateSettings({
				speedMode: message.speedMode,
			});
			sendResponse({
				ok: true,
				settings,
			});
			return;
		}

		if (message?.type === "sidebar:list-due-reviews") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.listDueReviews({
				limit: typeof message.limit === "number" && Number.isFinite(message.limit) ? message.limit : undefined,
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				reviews: response.reviews,
			});
			return;
		}

		if (message?.type === "sidebar:snooze-review") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.snoozeReview({
				conceptKey: message.conceptKey,
				days: typeof message.days === "number" && Number.isFinite(message.days) ? message.days : undefined,
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				snoozedUntil: response.snoozedUntil,
				reviews: response.reviews,
			});
			return;
		}

		if (message?.type === "sidebar:list-sessions") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.listSessions(typeof message.limit === "number" && Number.isFinite(message.limit) ? message.limit : 20);
			sendResponse({
				ok: true,
				currentSession: response.currentSession,
				sessions: response.sessions,
			});
			return;
		}

		if (message?.type === "sidebar:get-session-replay") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.getSessionReplay(message.sessionPath);
			sendResponse({
				ok: true,
				...response,
			});
			return;
		}

		if (message?.type === "sidebar:get-replay-artifact") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.getReplayArtifact(message.artifactId);
			sendResponse({
				ok: true,
				...response,
			});
			return;
		}

		if (message?.type === "sidebar:new-session") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.startNewSession({
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				created: response.created,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:switch-session") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.switchSession(message.sessionPath, {
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				switched: response.switched,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:delete-session") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.deleteSession(message.sessionPath, {
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				deletedSessionId: response.deletedSessionId,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:rename-session") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.renameSession(message.sessionName);
			sendResponse({
				ok: true,
				currentSession: response.currentSession,
			});
			return;
		}

		if (message?.type === "sidebar:restore-session") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.restoreSession(message.sessionPath);
			sendResponse({
				ok: true,
				restoredPages: response.restoredPages || [],
				restoredCount: response.restoredCount || 0,
			});
			return;
		}

		if (message?.type === "sidebar:open-pdf-viewer") {
			const result = await handleCommand("open_pdf_in_onhand_viewer", {
				tabId: typeof message.tabId === "number" ? message.tabId : undefined,
				windowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				result,
			});
			return;
		}

		if (message?.type === "sidebar:submit-prompt") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.submitPrompt({
				prompt: message.prompt,
				displayPrompt: message.displayPrompt,
				attachments: Array.isArray(message.attachments) ? message.attachments : [],
				source: typeof message.source === "string" ? message.source : "sidebar",
				learningMode: Boolean(message.learningMode),
				targetWindowId: typeof message.windowId === "number" ? message.windowId : undefined,
			});
			sendResponse({
				ok: true,
				requestId: response.requestId,
			});
			return;
		}

		if (message?.type === "sidebar:submit-error-report") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.submitErrorReport(String(message.turnId || ""));
			sendResponse({ ok: true, result });
			return;
		}

		if (message?.type === "sidebar:activate-action") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.activateAction(message.key, {
				sessionPath: typeof message.sessionPath === "string" ? message.sessionPath : "",
			});
			sendResponse({
				ok: true,
				result,
			});
			return;
		}

		if (message?.type === "sidebar:jump-learner-source") {
			const runtime = getOnhandBrowserRuntime();
			const result = await runtime.jumpToLearnerSource({
				annotationId: typeof message.annotationId === "string" ? message.annotationId : "",
				matchedText: typeof message.matchedText === "string" ? message.matchedText : "",
				artifactId: typeof message.artifactId === "string" ? message.artifactId : "",
				url: typeof message.url === "string" ? message.url : "",
				tabTitle: typeof message.tabTitle === "string" ? message.tabTitle : "",
				conceptLabel: typeof message.conceptLabel === "string" ? message.conceptLabel : "",
				target: message.target === "note" ? "note" : "annotation",
			});
			sendResponse({ ok: true, result });
			return;
		}

		if (message?.type === "sidebar:scroll-to-annotation") {
			const annotationId = typeof message.annotationId === "string" ? message.annotationId.trim() : "";
			if (!annotationId) {
				throw new Error("Annotation id is required.");
			}
			const args = {
				annotationId,
				target: message.target === "note" ? "note" : "annotation",
			};
			if (typeof message.tabId === "number") {
				args.tabId = message.tabId;
			}
			const result = await handleCommand("scroll_to_annotation", args);
			sendResponse({
				ok: true,
				result,
			});
			return;
		}

		if (message?.type === "sidebar:stop") {
			const runtime = getOnhandBrowserRuntime();
			const response = await runtime.stop();
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
		getOnhandBrowserRuntime().captureRuntimeException({
			messageType: message?.type || "unknown",
			message: error?.message || String(error),
			stack: error?.stack || "",
		}).catch(() => {});
		sendResponse({ ok: false, error: error?.message || String(error) });
	});

	return true;
});

chrome.runtime.onInstalled.addListener((details) => {
	const reason = details?.reason === "update" ? "extension_updated" : details?.reason === "install" ? "extension_installed" : "";
	if (!reason) return;
	getOnhandBrowserRuntime().trackEvent(reason, { result: "ok" }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
	(async () => {
		const windowId =
			typeof tab?.windowId === "number" ? tab.windowId : await resolveSidebarWindowId({ windowId: tab?.windowId });
		if (typeof windowId !== "number") {
			await openOnhandOptionsPage();
			return;
		}
		const isOperaSidebarToolbarAction = !chrome.sidePanel?.open && Boolean(getOperaSidebarAction());
		if (isOperaSidebarToolbarAction) {
			await handleOperaToolbarAction(windowId, tab?.id);
			return;
		}
		if (await isSidebarOpenForWindow(windowId)) {
			await closeSidebarForWindow(windowId);
			return;
		}
		await openSidebarForWindow(windowId);
		await requestSidebarQuickOpen(windowId);
	})().catch((error) => log("Could not toggle Onhand sidebar from toolbar action", error?.message || String(error)));
});

chrome.windows.onRemoved.addListener(async (windowId) => {
	await setSidebarWindowOpen(windowId, false);
});

initializeExtensionSurface();
