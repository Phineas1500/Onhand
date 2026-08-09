import { ONHAND_EXTENSION_RUNTIME_REVISION } from "./runtime-revision.js";
import { createOnhandBrowserRuntime } from "./onhand-runtime.bundle.js";
import { searchPdfCorpus } from "./pdf-corpus-search.bundle.js";

const SCREENSHOT_DELAY_MS = 150;
const SCRIPT_EXECUTION_TIMEOUT_MS = 2500;
const PAGE_TOOLKIT_ANNOTATION_TIMEOUT_MS = 12000;
const PDF_READER_FRAME_EXECUTION_TIMEOUT_MS = 6000;
const TAB_COMMAND_TIMEOUT_MS = 15000;
const DEBUGGER_COMMAND_TIMEOUT_MS = 3000;
const PDF_PAGE_DETECTOR_TIMEOUT_MS = 2500;
const PDF_SELECTION_HANDOFF_TIMEOUT_MS = 4000;
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
const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
const OPENAI_REALTIME_VOICE = "marin";
const REALTIME_API_KEY_SETUP_MESSAGE =
	"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.";
const ONHAND_THEME_STORAGE_KEY = "onhandSidebarTheme";
const ONHAND_THEME_VALUES = new Set(["system", "light", "dark"]);
const ONHAND_FREE_TOKEN_STORAGE_KEY = "onhandFreeTierToken";
const ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY = "onhandFreeTierQuotaBypassSecret";
const ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY = "onhandFreeTierQuotaBypassExpiresAt";
const ONHAND_FREE_QUOTA_BYPASS_MIN_LENGTH = 16;
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const GOOGLE_DOCS_CLIPBOARD_MARKER_PREFIX = "__ONHAND_GOOGLE_DOCS_SELECTION_PROBE__";
const BROWSER_SELECTION_CLIPBOARD_MARKER_PREFIX = "__ONHAND_BROWSER_SELECTION_PROBE__";
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
let lastFetchStatePageCapture = null;
// The sidebar polls fetch-state every 900ms while the panel is open; a fresh
// full-page capture per poll costs 50-700ms of renderer work on the active
// tab. Idle polls reuse a short-lived capture instead.
const FETCH_STATE_PAGE_CAPTURE_TTL_MS = 2500;
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

async function hashFreeTierToken(token) {
	const compact = String(token || "").replace(/\s+/g, " ").trim().slice(0, 512);
	if (!compact) return "";
	const bytes = new TextEncoder().encode(compact);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 32);
}

async function freeTierBypassState(action = "status") {
	const stored = await chrome.storage.local.get({
		[ONHAND_FREE_TOKEN_STORAGE_KEY]: "",
		[ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY]: "",
		[ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY]: "",
	});
	const token = String(stored[ONHAND_FREE_TOKEN_STORAGE_KEY] || "");
	const expiresAt = String(stored[ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY] || "").trim();
	const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
	const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
	return {
		ok: true,
		action,
		enabled: String(stored[ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY] || "").trim().length >= ONHAND_FREE_QUOTA_BYPASS_MIN_LENGTH && !expired,
		expiresAt,
		expired,
		hasFreeTierToken: Boolean(token),
		deviceHash: await hashFreeTierToken(token),
	};
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
			reasons: ["WORKERS", "CLIPBOARD"],
			justification: "Maintain the Onhand browser runtime and recover selected Google Docs text in Chrome MV3.",
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
		throw new Error(
			"Reading page content by titleContains or urlContains is not supported. Omit the selector to read the active tab, or call browser_list_tabs and pass that tab's exact tabId.",
		);
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

async function isAllowedFileSchemeAccess() {
	try {
		return await new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(Boolean(allowed))));
	} catch {
		return false;
	}
}

// pdf-viewer.html is web-accessible, so any site can open it with a
// url=file:/// parameter. The viewer therefore refuses to read local bytes
// unless the launch was granted by this background (handoff or session
// restore). Grants are one-shot per file URL with a short TTL, then
// remembered per tab (chrome.storage.session) so in-tab reloads keep working.
const ONHAND_PDF_VIEWER_FILE_GRANT_TTL_MS = 2 * 60 * 1000;
const ONHAND_PDF_VIEWER_FILE_AUTH_STORAGE_KEY = "onhand:pdf-viewer-file-auth";
const pendingOnhandPdfViewerFileGrants = new Map();

// Credentialed retries need the same trust boundary as local-file reads.
// pdf-viewer.html is web-accessible, so never let an arbitrary page turn it
// into an authenticated cross-origin fetcher. A retry is allowed only for the
// exact HTTPS source + tab pair that this background explicitly handed off,
// and the authorization is remembered only for that viewer tab's reloads.
const ONHAND_PDF_VIEWER_CREDENTIAL_GRANT_TTL_MS = 2 * 60 * 1000;
const ONHAND_PDF_VIEWER_CREDENTIAL_AUTH_STORAGE_KEY = "onhand:pdf-viewer-credential-auth";
const pendingOnhandPdfViewerCredentialGrants = new Map();
const ONHAND_AUTHENTICATED_PDF_MAX_BYTES = 24 * 1024 * 1024;
const ONHAND_AUTHENTICATED_PDF_LOAD_TIMEOUT_MS = 10000;
const ONHAND_AUTHENTICATED_PDF_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

function isHttpsUrl(value) {
	try {
		return new URL(String(value || "")).protocol === "https:";
	} catch {
		return false;
	}
}

function onhandPdfViewerCredentialGrantKey(tabId, pdfUrl) {
	const key = stripUrlHash(String(pdfUrl || ""));
	return typeof tabId === "number" && key && isHttpsUrl(key) ? `${tabId}:${key}` : "";
}

function grantOnhandPdfViewerCredentialedSource(tabId, pdfUrl) {
	const grantKey = onhandPdfViewerCredentialGrantKey(tabId, pdfUrl);
	if (!grantKey) return;
	pendingOnhandPdfViewerCredentialGrants.set(grantKey, Date.now() + ONHAND_PDF_VIEWER_CREDENTIAL_GRANT_TTL_MS);
	if (pendingOnhandPdfViewerCredentialGrants.size > 32) {
		const now = Date.now();
		for (const [key, expiresAt] of pendingOnhandPdfViewerCredentialGrants) {
			if (expiresAt < now) pendingOnhandPdfViewerCredentialGrants.delete(key);
		}
	}
}

async function authorizeOnhandPdfViewerCredentialedSource(sender, pdfUrl) {
	const senderUrl = String(sender?.url || "");
	if (!isOwnExtensionPdfViewerUrl(senderUrl)) return false;
	const grantKey = onhandPdfViewerCredentialGrantKey(sender?.tab?.id, pdfUrl);
	if (!grantKey) return false;
	let remembered = {};
	try {
		remembered =
			(await chrome.storage.session.get(ONHAND_PDF_VIEWER_CREDENTIAL_AUTH_STORAGE_KEY))?.[
				ONHAND_PDF_VIEWER_CREDENTIAL_AUTH_STORAGE_KEY
			] || {};
	} catch {}
	const rememberedAt = Number(remembered[grantKey] || 0);
	if (rememberedAt && Date.now() - rememberedAt <= ONHAND_PDF_VIEWER_CREDENTIAL_GRANT_TTL_MS) return true;
	if (rememberedAt) {
		delete remembered[grantKey];
		try {
			await chrome.storage.session.set({ [ONHAND_PDF_VIEWER_CREDENTIAL_AUTH_STORAGE_KEY]: remembered });
		} catch {}
	}
	const expiresAt = pendingOnhandPdfViewerCredentialGrants.get(grantKey);
	if (!expiresAt || expiresAt < Date.now()) return false;
	pendingOnhandPdfViewerCredentialGrants.delete(grantKey);
	remembered[grantKey] = Date.now();
	try {
		await chrome.storage.session.set({ [ONHAND_PDF_VIEWER_CREDENTIAL_AUTH_STORAGE_KEY]: remembered });
	} catch {}
	return true;
}

function pdfUrlForAuthorizedViewerTab(tab) {
	const tabUrl = String(tab?.url || "");
	return isOnhandPdfViewerLikeUrl(tabUrl) ? extractPdfSourceUrlFromViewerLikeUrl(tabUrl) : stripUrlHash(tabUrl);
}

function decodeDebuggerStreamChunk(payload) {
	const data = String(payload?.data || "");
	if (!data) return new Uint8Array();
	if (payload?.base64Encoded) {
		const binary = atob(data);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return bytes;
	}
	return new TextEncoder().encode(data);
}

function encodeBytesAsBase64(bytes) {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
	}
	return btoa(binary);
}

function looksLikePdfBytes(bytes) {
	const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.byteLength)));
	return header.includes("%PDF-");
}

async function readDebuggerStream(send, handle) {
	const chunks = [];
	let byteLength = 0;
	try {
		while (true) {
			const payload = await send("IO.read", {
				handle,
				size: ONHAND_AUTHENTICATED_PDF_STREAM_CHUNK_BYTES,
			});
			const chunk = decodeDebuggerStreamChunk(payload);
			byteLength += chunk.byteLength;
			if (byteLength > ONHAND_AUTHENTICATED_PDF_MAX_BYTES) {
				throw new Error(`The protected PDF is larger than Onhand's ${Math.floor(ONHAND_AUTHENTICATED_PDF_MAX_BYTES / 1024 / 1024)} MB browser-context limit.`);
			}
			if (chunk.byteLength) chunks.push(chunk);
			if (payload?.eof) break;
		}
	} finally {
		try {
			await send("IO.close", { handle });
		} catch {}
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function loadAuthorizedPdfBytesFromTab(sender, pdfUrl) {
	if (!(await authorizeOnhandPdfViewerCredentialedSource(sender, pdfUrl))) {
		throw new Error("The authenticated PDF retry was not authorized for this viewer tab.");
	}
	const tabId = sender?.tab?.id;
	if (typeof tabId !== "number") throw new Error("The authenticated PDF retry has no source tab.");
	const tab = await chrome.tabs.get(tabId);
	const trustedSourceUrl = pdfUrlForAuthorizedViewerTab(tab);
	if (stripUrlHash(trustedSourceUrl) !== stripUrlHash(pdfUrl)) {
		throw new Error("The authenticated PDF retry no longer matches the source tab.");
	}

	const bytes = await withDebugger(tabId, async ({ target, send }) => {
		await send("Page.enable");
		const frameTree = await send("Page.getFrameTree");
		const frameId = frameTree?.frameTree?.frame?.id;
		if (!frameId) throw new Error("Could not resolve the PDF tab's browser frame.");
		const loaded = await withOperationTimeout(
			chrome.debugger.sendCommand(target, "Network.loadNetworkResource", {
				frameId,
				url: pdfUrl,
				options: {
					disableCache: false,
					includeCredentials: true,
				},
			}),
			ONHAND_AUTHENTICATED_PDF_LOAD_TIMEOUT_MS,
			"Timed out loading the PDF through its authenticated browser tab.",
		);
		const resource = loaded?.resource || {};
		if (!resource.success || !resource.stream) {
			throw new Error(
				`The authenticated browser tab could not load the PDF${resource.httpStatusCode ? ` (HTTP ${resource.httpStatusCode})` : resource.netErrorName ? ` (${resource.netErrorName})` : ""}.`,
			);
		}
		return await readDebuggerStream(send, resource.stream);
	});
	if (!bytes.byteLength || !looksLikePdfBytes(bytes)) {
		throw new Error("The authenticated browser tab returned a non-PDF response.");
	}
	return {
		dataBase64: encodeBytesAsBase64(bytes),
		byteLength: bytes.byteLength,
	};
}

function grantOnhandPdfViewerFileSource(fileUrl) {
	const key = stripUrlHash(String(fileUrl || ""));
	if (!key || !isFileUrl(key)) return;
	pendingOnhandPdfViewerFileGrants.set(key, Date.now() + ONHAND_PDF_VIEWER_FILE_GRANT_TTL_MS);
	if (pendingOnhandPdfViewerFileGrants.size > 32) {
		const now = Date.now();
		for (const [grantKey, expiresAt] of pendingOnhandPdfViewerFileGrants) {
			if (expiresAt < now) pendingOnhandPdfViewerFileGrants.delete(grantKey);
		}
	}
}

async function authorizeOnhandPdfViewerFileSource(sender, fileUrl) {
	const senderUrl = String(sender?.url || "");
	if (!isOwnExtensionPdfViewerUrl(senderUrl)) return false;
	const key = stripUrlHash(String(fileUrl || ""));
	if (!key || !isFileUrl(key)) return false;
	const tabId = sender?.tab?.id;
	const tabKey = typeof tabId === "number" ? tabId + ":" + key : "";
	let remembered = {};
	try {
		remembered = (await chrome.storage.session.get(ONHAND_PDF_VIEWER_FILE_AUTH_STORAGE_KEY))?.[ONHAND_PDF_VIEWER_FILE_AUTH_STORAGE_KEY] || {};
	} catch {}
	if (tabKey && remembered[tabKey]) return true;
	const expiresAt = pendingOnhandPdfViewerFileGrants.get(key);
	if (!expiresAt || expiresAt < Date.now()) return false;
	pendingOnhandPdfViewerFileGrants.delete(key);
	if (tabKey) {
		remembered[tabKey] = Date.now();
		try {
			await chrome.storage.session.set({ [ONHAND_PDF_VIEWER_FILE_AUTH_STORAGE_KEY]: remembered });
		} catch {}
	}
	return true;
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
	// Local file PDFs are handled by the Onhand viewer too (subject to the
	// "Allow access to file URLs" gate checked at handoff time).
	if (isFileUrl(value)) {
		try {
			return decodeURIComponent(new URL(String(value)).pathname || "").toLowerCase().endsWith(".pdf");
		} catch {
			return false;
		}
	}
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

function normalizePdfUrlCandidate(value, baseUrl = "", { allowFile = false } = {}) {
	const candidate = String(value || "").trim();
	if (!candidate) return "";
	try {
		const url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
		// file: is accepted only when the caller vouches for the source (the
		// user's own file:// tab or Onhand's own viewer URL) — never for
		// page-controlled candidates, or any web page could point Onhand's file
		// permission at an arbitrary local path. The viewer-handoff path
		// additionally gates on "Allow access to file URLs".
		if (url.protocol === "file:") return allowFile ? url.toString() : "";
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
		// Only Onhand's own extension viewer is trusted to carry file: sources;
		// a web page merely *shaped* like the viewer is not.
		const allowFile = isOwnExtensionPdfViewerUrl(baseUrl);
		for (const key of ["url", "file", "pdf", "src"]) {
			const candidate = normalizePdfUrlCandidate(url.searchParams.get(key), baseUrl, { allowFile });
			if (candidate && (acceptAnyHttpCandidate || isLikelyPdfResourceUrl(candidate))) return candidate;
		}
	} catch {}
	return "";
}

function resolvePdfSourceUrlForViewer(args = {}, tab = null) {
	// An explicit file: pdfUrl is honored only when it IS the file the user
	// already has open (the tab's own file: URL, or the file source embedded in
	// Onhand's own viewer URL), compared hash-insensitively. Merely being on a
	// file: tab is not enough: a prompt-injected local HTML/PDF could otherwise
	// steer the model to open a DIFFERENT local file under Onhand's permission.
	const explicitCandidate = normalizePdfUrlCandidate(args.pdfUrl, "", { allowFile: true });
	if (explicitCandidate && isFileUrl(explicitCandidate)) {
		const trustedFileUrls = new Set();
		const currentTabUrl = String(tab?.url || "");
		if (isFileUrl(currentTabUrl)) trustedFileUrls.add(stripUrlHash(normalizePdfUrlCandidate(currentTabUrl, "", { allowFile: true })));
		const viewerEmbeddedSource = extractPdfSourceUrlFromViewerLikeUrl(currentTabUrl);
		if (viewerEmbeddedSource && isFileUrl(viewerEmbeddedSource)) trustedFileUrls.add(stripUrlHash(viewerEmbeddedSource));
		if (trustedFileUrls.has(stripUrlHash(explicitCandidate))) return explicitCandidate;
	} else if (explicitCandidate) {
		return explicitCandidate;
	}

	const tabUrl = String(tab?.url || "");
	if (isGoogleDocsDocumentUrl(tabUrl)) {
		const googleDocsPdfUrl = buildGoogleDocsPdfExportUrl(tabUrl);
		if (googleDocsPdfUrl) return googleDocsPdfUrl;
	}
	const nestedPdfUrl = extractPdfSourceUrlFromViewerLikeUrl(tabUrl);
	if (nestedPdfUrl) return nestedPdfUrl;

	// The tab's own URL is user-opened, so file: is trusted here.
	const directPdfUrl = normalizePdfUrlCandidate(tabUrl, "", { allowFile: true });
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

function normalizePdfSelectionText(value) {
	return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePdfSelectionForViewerHandoff(selection, pdfUrl = "") {
	const text = normalizePdfSelectionText(selection?.text || selection?.pdfAnchor?.matchedText || selection?.pdfAnchor?.textQuote?.exact || "");
	if (!text) return null;
	const pageNumber = normalizePdfPageNumber(selection?.pageNumber || selection?.container?.pageNumber || selection?.pdfAnchor?.pageNumber);
	const documentUrl =
		normalizePdfUrlCandidate(pdfUrl, "", { allowFile: true }) ||
		normalizePdfUrlCandidate(selection?.url, "", { allowFile: true }) ||
		normalizePdfUrlCandidate(selection?.pdfAnchor?.document?.url, "", { allowFile: true });
	const title = String(selection?.title || selection?.pdfAnchor?.document?.title || "").trim();
	const textQuote = selection?.pdfAnchor?.textQuote && typeof selection.pdfAnchor.textQuote === "object" ? { ...selection.pdfAnchor.textQuote, exact: text } : { exact: text };
	const pdfAnchor = {
		...(selection?.pdfAnchor && typeof selection.pdfAnchor === "object" ? selection.pdfAnchor : {}),
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		...(documentUrl || title ? { document: { ...(documentUrl ? { url: documentUrl } : {}), ...(title ? { title } : {}) } } : {}),
		...(pageNumber ? { pageNumber } : {}),
		matchedText: text,
		textQuote,
	};
	return {
		...selection,
		surface: "pdf",
		source: selection?.source || "pdf-selection-handoff",
		viewer: "onhand-pdf-viewer",
		hasSelection: true,
		isCollapsed: false,
		text,
		...(pageNumber ? { pageNumber } : {}),
		pdfAnchor,
	};
}

function getPdfPageNumberFromSelectionPayload(selection) {
	if (!selection || typeof selection !== "object") return null;
	return normalizePdfPageNumber(
		selection.pageNumber ||
			selection.page ||
			selection.currentPageNumber ||
			selection.container?.pageNumber ||
			selection.pdfAnchor?.pageNumber ||
			selection.googleScholarReader?.pageNumber,
	);
}

async function resolveInlineOnhandPdfViewerSourceUrl(tabId, tab = null) {
	// Do not trust inline viewer DOM attributes or iframe query strings here: they
	// live in the page DOM and can be spoofed by hostile page JavaScript. Derive
	// the source only from trusted extension-visible tab state (or explicit
	// caller-provided source URLs) so PDF commands cannot be routed cross-tab.
	return resolvePdfSourceUrlForViewer({}, tab || (await chrome.tabs.get(tabId)));
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
	const normalizedSourceUrl = normalizePdfUrlCandidate(sourceUrl, "", { allowFile: true }) || extractPdfSourceUrlFromViewerLikeUrl(port?.sender?.url);
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
			// Reaching the installer means the background did not accept this
			// iframe as a healthy reusable viewer. Recreate an existing frame whose
			// URL is unchanged so a prior PDF.js error cannot poison every retry.
			if (frame && frame.getAttribute("src") === targetViewerUrl) {
				frame.remove();
				frame = null;
			}
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

function navigationUrlMatchKey(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	try {
		const url = new URL(raw);
		if (!/^https?:$/i.test(url.protocol)) return "";
		url.hash = "";
		return url.toString();
	} catch {
		return "";
	}
}

async function findExistingNavigationTab(url, windowId) {
	const key = navigationUrlMatchKey(url);
	if (!key) return null;
	const tabs = await chrome.tabs.query(typeof windowId === "number" ? { windowId } : {});
	const matches = tabs.filter((tab) => tab?.id && navigationUrlMatchKey(tab.url) === key);
	return matches.find((tab) => tab.active) || matches[0] || null;
}

function shouldInferPdfPageNumberFromTab(tab, pdfUrl) {
	const tabUrl = String(tab?.url || "");
	if (!tabUrl) return false;
	const pdfUrlWithoutHash = stripUrlHash(pdfUrl);
	const nestedPdfUrl = extractPdfSourceUrlFromViewerLikeUrl(tabUrl);
	if (nestedPdfUrl && (!pdfUrlWithoutHash || stripUrlHash(nestedPdfUrl) === pdfUrlWithoutHash)) return true;
	const directPdfUrl = normalizePdfUrlCandidate(tabUrl, "", { allowFile: true });
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
	const summaryText = (summary) => String(summary?.value ?? summary?.label ?? "").trim();
	const summaryLooksLikePageEntry = (summary) =>
		/text|spin|input/i.test(String(summary?.role || "")) || Boolean(summary?.value != null && String(summary.value).trim());
	const pageControlCandidates = [];
	const pageFractionCandidates = [];
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
	for (let index = 0; index < nodeSummaries.length; index += 1) {
		const summary = nodeSummaries[index];
		const candidateText = summaryText(summary);
		const inlineFraction = candidateText.match(/^\s*(\d{1,4})\s*\/\s*(\d{1,4})\s*$/);
		const pageNumber = normalizePdfPageNumber(inlineFraction?.[1] || candidateText);
		if (!pageNumber || !summaryLooksLikePageEntry(summary)) continue;
		let totalPageCount = normalizePdfPageNumber(inlineFraction?.[2]);
		const nearby = nodeSummaries.slice(index + 1, index + 5);
		for (let offset = 0; offset < nearby.length && !totalPageCount; offset += 1) {
			const text = summaryText(nearby[offset]);
			const slashTotal = text.match(/^\s*\/\s*(\d{1,4})\s*$/);
			if (slashTotal) {
				totalPageCount = normalizePdfPageNumber(slashTotal[1]);
				break;
			}
			if (/^\s*\/\s*$/.test(text)) {
				for (const candidate of nearby.slice(offset + 1, offset + 4)) {
					totalPageCount = normalizePdfPageNumber(summaryText(candidate));
					if (totalPageCount) break;
				}
			}
		}
		if (totalPageCount && totalPageCount >= pageNumber && totalPageCount > 1) {
			pageFractionCandidates.push({ pageNumber, source: `${sourcePrefix}-page-fraction` });
		}
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
	const preferredFraction = pageFractionCandidates.find((candidate) => candidate.pageNumber > 1) || pageFractionCandidates[0];
	if (preferredFraction) return preferredFraction;
	const preferredControl = pageControlCandidates.find((candidate) => candidate.pageNumber > 1) || pageControlCandidates[0];
	if (preferredControl) return preferredControl;
	const hasNearbyPageNavigation = (index) => {
		const windowStart = Math.max(0, index - 5);
		const windowEnd = Math.min(nodeSummaries.length, index + 6);
		return nodeSummaries.slice(windowStart, windowEnd).some((summary) => /(?:previous|next)\s+page/i.test(summary.label));
	};
	for (let index = 0; index < nodeSummaries.length; index += 1) {
		const summary = nodeSummaries[index];
		const candidateText = String(summary.value ?? summary.label ?? "");
		const pageNumber = normalizePdfPageNumber(candidateText);
		if (!pageNumber || !hasNearbyPageNavigation(index)) continue;
		const nearby = nodeSummaries.slice(index + 1, index + 4);
		const hasFractionSeparator = nearby.some((candidate) => /^\s*\/\s*$/.test(String(candidate?.value ?? candidate?.label ?? "")));
		const hasTotalPageCount = nearby.some((candidate) => {
			const totalPageCount = normalizePdfPageNumber(candidate?.value ?? candidate?.label);
			return totalPageCount && totalPageCount >= pageNumber;
		});
		if (hasFractionSeparator && hasTotalPageCount) {
			return { pageNumber, source: `${sourcePrefix}-nearby-page-fraction` };
		}
	}
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

function debuggerTargetId(targetInfo) {
	return String(targetInfo?.id || targetInfo?.targetId || "");
}

function debuggerTargetLooksLikeNativeChromePdfViewer(targetInfo) {
	return (
		String(targetInfo?.url || "").startsWith(NATIVE_CHROME_PDF_VIEWER_PREFIX) ||
		String(targetInfo?.extensionId || "") === NATIVE_CHROME_PDF_VIEWER_EXTENSION_ID
	);
}

function debuggerTargetLooksLikeGoogleScholarReader(targetInfo) {
	return (
		String(targetInfo?.url || "").startsWith(GOOGLE_SCHOLAR_READER_FRAME_PREFIX) ||
		String(targetInfo?.extensionId || "") === GOOGLE_SCHOLAR_READER_EXTENSION_ID
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

async function getGoogleScholarReaderDebuggerTargets(tab = null) {
	if (!chrome.debugger?.getTargets) return [];
	const targets = await chrome.debugger.getTargets();
	const tabId = typeof tab?.id === "number" ? tab.id : null;
	const tabUrl = String(tab?.url || "");
	const candidates = (Array.isArray(targets) ? targets : [])
		.filter((targetInfo) => debuggerTargetId(targetInfo) && debuggerTargetLooksLikeGoogleScholarReader(targetInfo))
		.map((targetInfo) => {
			const targetTabId = typeof targetInfo.tabId === "number" ? targetInfo.tabId : null;
			let score = 10;
			if (tabId !== null && targetTabId === tabId) score = 0;
			else if (isLikelyPdfResourceUrl(tabUrl) && targetTabId === null) score = 2;
			else if (targetTabId === null) score = 4;
			return { targetInfo, score };
		})
		.filter(({ score }) => score < 10)
		.sort((a, b) => a.score - b.score);
	return candidates.map(({ targetInfo }) => targetInfo);
}

async function detectGoogleScholarReaderSurface(tab = null) {
	try {
		const targets = await getGoogleScholarReaderDebuggerTargets(tab);
		const target = targets.find(Boolean);
		if (!target) return null;
		return {
			detected: true,
			viewer: "google-scholar",
			readerName: "Google Scholar PDF Reader",
			targetId: debuggerTargetId(target),
			targetUrl: String(target.url || ""),
			targetTitle: String(target.title || ""),
		};
	} catch {
		return null;
	}
}

function markGoogleScholarReaderSelectionSurface(currentSelection, readerSurface = null, fallback = null) {
	const selection = currentSelection && typeof currentSelection === "object" ? currentSelection : {};
	const text = typeof selection.text === "string" ? selection.text : "";
	const hasSelection = Boolean(text) || selection.hasSelection === true;
	const source = String(selection.source || "");
	return {
		...selection,
		surface: "pdf",
		viewer: "google-scholar",
		source: source && !/native-chrome-pdf-viewer/i.test(source) ? source : "google-scholar-reader-detected",
		hasSelection,
		text,
		googleScholarReader: {
			...(selection.googleScholarReader && typeof selection.googleScholarReader === "object" ? selection.googleScholarReader : {}),
			...(readerSurface && typeof readerSurface === "object" ? readerSurface : {}),
			detected: true,
			viewer: "google-scholar",
			readerName: "Google Scholar PDF Reader",
			selectionTextAvailable: Boolean(text),
			selectionState: text ? "text" : hasSelection ? "selection-without-readable-text" : "unknown",
			...(fallback && typeof fallback === "object" ? { selectionFallback: fallback } : {}),
		},
	};
}

async function getDebuggerPageTargetForTab(tab = null) {
	if (!chrome.debugger?.getTargets || typeof tab?.id !== "number") return null;
	const targets = await chrome.debugger.getTargets();
	const tabUrl = String(tab?.url || "");
	const candidates = (Array.isArray(targets) ? targets : [])
		.filter((targetInfo) => debuggerTargetId(targetInfo) && typeof targetInfo.tabId === "number" && targetInfo.tabId === tab.id)
		.map((targetInfo) => {
			const type = String(targetInfo.type || "");
			const url = String(targetInfo.url || "");
			let score = 10;
			if (type === "page" && url === tabUrl) score = 0;
			else if (type === "page") score = 1;
			else if (url === tabUrl) score = 2;
			return { targetInfo, score };
		})
		.filter(({ score }) => score < 10)
		.sort((a, b) => a.score - b.score);
	return candidates[0]?.targetInfo || null;
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

function getNativeChromePdfViewerSelectionExpression() {
	const pageExpression = getNativeChromePdfViewerPageExpression();
	return `(() => {
		const normalizeText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
		const rectToObject = (rect) => rect
			? {
				x: Math.round(rect.x || rect.left || 0),
				y: Math.round(rect.y || rect.top || 0),
				left: Math.round(rect.left || 0),
				top: Math.round(rect.top || 0),
				right: Math.round(rect.right || 0),
				bottom: Math.round(rect.bottom || 0),
				width: Math.round(rect.width || 0),
				height: Math.round(rect.height || 0),
			}
			: null;
		const selection = window.getSelection?.() || document.getSelection?.();
		const text = normalizeText(selection?.toString?.() || "");
		let range = null;
		let rect = null;
		try {
			range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
		} catch {}
		let pageDetection = null;
		try {
			pageDetection = (${pageExpression});
		} catch {}
		const pageNumber = pageDetection && Number.isFinite(Number(pageDetection.pageNumber)) ? Number(pageDetection.pageNumber) : null;
		return {
			surface: "pdf",
			viewer: "chrome-pdf-viewer",
			source: "native-chrome-pdf-viewer-selection",
			hasSelection: Boolean(text),
			isCollapsed: Boolean(selection?.isCollapsed),
			text,
			rangeCount: Number(selection?.rangeCount || 0),
			rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
			container: pageNumber
				? {
					tag: "pdf-page",
					text: \`Page \${pageNumber}\`,
					pageNumber,
				}
				: null,
			pageNumber,
			pageSource: pageDetection?.source || "",
			pdfAnchor: text
				? {
					surface: "pdf",
					viewer: "chrome-pdf-viewer",
					pageNumber,
					matchedText: text,
					textQuote: { exact: text },
				}
				: null,
		};
		})()`;
}

function getGoogleScholarReaderPageExpression() {
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
				element.getAttribute("data-pn"),
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
		const candidates = [];
		const addCandidate = (pageNumber, source, score = 0) => {
			pageNumber = normalizePageNumber(pageNumber);
			if (!pageNumber) return;
			candidates.push({ pageNumber, source, score });
		};
		const addInputFractionCandidate = (element, source, score = -1) => {
			if (!(element instanceof Element)) return;
			const pageNumber = readElementPageNumber(element);
			if (!pageNumber) return;
			const nearbyText = [
				"value" in element ? element.value : "",
				element.parentElement?.textContent,
				element.closest?.('[role="toolbar"], header, nav, .toolbar, .gsr-toolbar')?.textContent,
			]
				.filter(Boolean)
				.join(" ");
			const fractionMatch = Array.from(nearbyText.matchAll(/(?:^|\\D)(\\d{1,4})\\s*\\/\\s*(\\d{1,4})(?!\\d)/g))
				.find((match) => normalizePageNumber(match?.[1]) === pageNumber);
			const totalPages = normalizePageNumber(fractionMatch?.[2]);
			if (totalPages && totalPages >= pageNumber && totalPages > 1) {
				addCandidate(pageNumber, source, score);
			}
		};
		for (const selector of [
			".gsr-tb-pn-input",
			'input[aria-label*="page" i]',
			'input[title*="page" i]',
			'[role="spinbutton"][aria-label*="page" i]',
			'[aria-valuenow][aria-label*="page" i]',
		]) {
			for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 20)) {
				addCandidate(readElementPageNumber(element), "google-scholar-page-control", 0);
			}
		}
		for (const element of Array.from(document.querySelectorAll("input, [role='spinbutton']")).slice(0, 80)) {
			addInputFractionCandidate(element, "google-scholar-page-fraction", -1);
		}
		for (const element of Array.from(document.querySelectorAll(".gsr-thumbnail.gsr-select, .gsr-thumbnail[aria-selected='true'], [aria-selected='true']")).slice(0, 50)) {
			const label = [
				element.getAttribute("aria-label"),
				element.getAttribute("title"),
				element.textContent,
			]
				.filter(Boolean)
				.join(" ");
			if (!/(?:thumbnail\\s+for\\s+page|\\bpage\\s+\\d+\\b|^\\s*\\d+\\s*$)/i.test(label)) continue;
			addCandidate(readElementPageNumber(element) || label, "google-scholar-selected-thumbnail", 1);
		}
		const centerY = Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || 1)) / 2;
		for (const element of Array.from(document.querySelectorAll(".gsr-page[data-pn], [data-pn], [data-page-number], [aria-label^='Page '], [aria-label^='page ']")).slice(0, 200)) {
			if (!(element instanceof Element)) continue;
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
			const pageNumber = readElementPageNumber(element);
			if (!pageNumber) continue;
			const score = rect.top <= centerY && rect.bottom >= centerY ? 0 : Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY)) + 10;
			addCandidate(pageNumber, "google-scholar-visible-page", score);
		}
		candidates.sort((left, right) => left.score - right.score || Number(right.pageNumber > 1) - Number(left.pageNumber > 1));
		return candidates[0] || null;
	})()`;
}

function getGoogleScholarReaderSelectionExpression() {
	return `(() => {
		const normalizeText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
		const normalizePageNumber = (value) => {
			const match = String(value ?? "").match(/\\d+/);
			if (!match) return null;
			const pageNumber = Number.parseInt(match[0], 10);
			return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
		};
		const selection = window.getSelection?.() || document.getSelection?.();
		const text = normalizeText(selection?.toString?.() || "");
		let range = null;
		let containerElement = null;
		try {
			range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			containerElement = range?.commonAncestorContainer instanceof Element
				? range.commonAncestorContainer
			: range?.commonAncestorContainer?.parentElement || null;
		} catch {}
		const pageElement = containerElement?.closest?.(".gsr-page") || null;
		let pageDetection = null;
		try {
			pageDetection = (${getGoogleScholarReaderPageExpression()});
		} catch {}
		const pageNumber =
			normalizePageNumber(pageElement?.getAttribute?.("data-pn")) ||
			normalizePageNumber(pageDetection?.pageNumber) ||
			normalizePageNumber(document.querySelector(".gsr-tb-pn-input")?.value) ||
			normalizePageNumber(document.querySelector(".gsr-thumbnail.gsr-select")?.getAttribute?.("aria-label"));
		return {
			surface: "pdf",
			viewer: "google-scholar",
			source: "google-scholar-reader-target-selection",
			hasSelection: Boolean(text),
			isCollapsed: Boolean(selection?.isCollapsed),
			text,
			rangeCount: Number(selection?.rangeCount || 0),
			container: pageElement
				? {
					tag: pageElement.tagName?.toLowerCase?.() || "",
					className: String(pageElement.className || "").slice(0, 120),
					pageNumber,
				}
				: null,
			pageNumber,
			pageSource: pageDetection?.source || "",
			url: location.href,
			title: document.title,
			pdfAnchor: text
				? {
					surface: "pdf",
					viewer: "google-scholar",
					pageNumber,
					matchedText: text,
					textQuote: { exact: text },
				}
				: null,
		};
	})()`;
}

function selectionPayloadHasText(payload) {
	return Boolean(String(payload?.text || "").replace(/\s+/g, " ").trim());
}

function normalizeClipboardSelectionText(value) {
	return String(value ?? "")
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function googleDocsExportTextContainsSelection(content, selectionText) {
	const normalizedSelection = normalizeClipboardSelectionText(selectionText).toLowerCase();
	if (!normalizedSelection) return false;
	const normalizedDocument = normalizeClipboardSelectionText(content?.text || content?.markdown || "").toLowerCase();
	if (!normalizedDocument) return false;
	return normalizedDocument.includes(normalizedSelection);
}

function getGoogleDocsTextEventCopyExpression() {
	return `(() => {
		const frames = Array.from(document.querySelectorAll("iframe.docs-texteventtarget-iframe"));
		const attempts = [];
		for (const frame of frames) {
			const frameClass = String(frame.className || "");
			try {
				const doc = frame.contentDocument;
				const win = frame.contentWindow;
				if (!doc || !win) {
					attempts.push({ ok: false, frameClass, reason: "missing contentDocument" });
					continue;
				}
				const selection = win.getSelection?.();
				const activeElement = doc.activeElement || doc.body;
				frame.focus?.();
				win.focus?.();
				activeElement?.focus?.();
				const ok = Boolean(doc.execCommand?.("copy"));
				attempts.push({
					ok,
					frameClass,
					activeTag: activeElement?.tagName || "",
					selectionTextLength: String(selection?.toString?.() || "").replace(/\\s+/g, " ").trim().length,
					rangeCount: Number(selection?.rangeCount || 0),
				});
				if (ok) return { ok: true, source: "google-docs-text-event-iframe", attempts };
			} catch (error) {
				attempts.push({ ok: false, frameClass, error: error?.message || String(error) });
			}
		}
		return { ok: false, source: "google-docs-text-event-iframe", attempts };
	})()`;
}

async function sendOffscreenClipboardMessage(type, payload = {}) {
	await ensureOffscreenDocument();
	const response = await chrome.runtime.sendMessage({
		target: "offscreen",
		type,
		...payload,
	});
	if (!response?.ok) throw new Error(response?.error || `Offscreen clipboard message failed: ${type}`);
	return response;
}

async function sendSidebarClipboardMessage(type, payload = {}) {
	const response = await chrome.runtime.sendMessage({
		target: "sidebar",
		type,
		...payload,
	});
	if (!response?.ok) throw new Error(response?.error || `Sidebar clipboard message failed: ${type}`);
	return response;
}

async function readTextFromOffscreenClipboard() {
	const response = await sendOffscreenClipboardMessage("offscreen:clipboard-read");
	return String(response.text || "");
}

async function writeTextToOffscreenClipboard(text) {
	await sendOffscreenClipboardMessage("offscreen:clipboard-write", { text: String(text ?? "") });
}

async function readTextFromExtensionClipboard() {
	const errors = [];
	try {
		const response = await sendSidebarClipboardMessage("sidebar:clipboard-read");
		return String(response.text || "");
	} catch (error) {
		errors.push(`sidebar: ${error?.message || String(error)}`);
	}
	try {
		return await readTextFromOffscreenClipboard();
	} catch (error) {
		errors.push(`offscreen: ${error?.message || String(error)}`);
	}
	throw new Error(`Could not read clipboard text (${errors.join("; ")})`);
}

async function writeTextToExtensionClipboard(text) {
	const value = String(text ?? "");
	const errors = [];
	try {
		await sendSidebarClipboardMessage("sidebar:clipboard-write", { text: value });
		return;
	} catch (error) {
		errors.push(`sidebar: ${error?.message || String(error)}`);
	}
	try {
		await writeTextToOffscreenClipboard(value);
		return;
	} catch (error) {
		errors.push(`offscreen: ${error?.message || String(error)}`);
	}
	throw new Error(`Could not write clipboard text (${errors.join("; ")})`);
}

async function copyGoogleDocsSelectionThroughTextEventIframe(tab) {
	return await withDebugger(tab.id, async ({ send }) => {
		const result = await evaluateDebuggerExpression(
			send,
			getGoogleDocsTextEventCopyExpression(),
			undefined,
			"Could not copy selected Google Docs text",
		);
		if (!result?.ok) {
			throw new Error("Google Docs text-event iframe did not report a successful copy.");
		}
		return result;
	});
}

async function maybeGetGoogleDocsClipboardSelection(tab, currentSelection) {
	if (selectionPayloadHasText(currentSelection)) return currentSelection;
	if (!isGoogleDocsDocumentUrl(tab?.url)) return currentSelection;

	let originalClipboard = "";
	let marker = "";
	const fallback = {
		attempted: true,
		ok: false,
		source: "google-docs-text-event-iframe-copy",
	};
	try {
		originalClipboard = await readTextFromExtensionClipboard();
		marker = `${GOOGLE_DOCS_CLIPBOARD_MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
		await writeTextToExtensionClipboard(marker);
		const copyResult = await copyGoogleDocsSelectionThroughTextEventIframe(tab);
		await delay(80);
		const copiedText = normalizeClipboardSelectionText(await readTextFromExtensionClipboard());
		if (!copiedText || copiedText === marker) {
			return {
				...(currentSelection || {}),
				googleDocsSelectionFallback: {
					...fallback,
					error: "Google Docs copy did not put selected text on the clipboard.",
					copyResult,
				},
			};
		}
		const content = await extractGoogleDocsTextExportForTab(tab, { maxChars: 50000 });
		const validatedAgainstExport = googleDocsExportTextContainsSelection(content, copiedText);
		if (!validatedAgainstExport && !content?.unsupported) {
			return {
				...(currentSelection || {}),
				googleDocsSelectionFallback: {
					...fallback,
					error: "Copied Google Docs text did not match the document text export.",
					copiedTextLength: copiedText.length,
					copyResult,
				},
			};
		}
		return {
			surface: "google-docs",
			source: "google-docs-text-event-iframe-copy",
			hasSelection: true,
			isCollapsed: false,
			text: copiedText,
			url: tab?.url || "",
			title: tab?.title || "",
			validatedAgainstExport,
			exportUrl: content?.exportUrl || "",
			googleDocsSelectionFallback: {
				...fallback,
				ok: true,
				copiedTextLength: copiedText.length,
				validatedAgainstExport,
				copyResult,
			},
		};
	} catch (error) {
		return {
			...(currentSelection || {}),
			googleDocsSelectionFallback: {
				...fallback,
				error: error?.message || String(error),
			},
		};
	} finally {
		if (marker) {
			try {
				await writeTextToExtensionClipboard(originalClipboard);
			} catch {}
		}
	}
}

async function dispatchCopyShortcutToTab(tab) {
	if (!tab?.id) throw new Error("No tab available for browser selection copy.");
	const platform = await chrome.runtime.getPlatformInfo().catch(() => null);
	const modifier = platform?.os === "mac" ? 4 : 2;
	const pageTarget = await getDebuggerPageTargetForTab(tab).catch(() => null);
	const googleScholarTargets = await getGoogleScholarReaderDebuggerTargets(tab).catch(() => []);
	const nativePdfTargets = await getNativeChromePdfViewerDebuggerTargets(tab).catch(() => []);
	const sendCopy = async (send) => {
		await send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			modifiers: modifier,
			key: "c",
			code: "KeyC",
			windowsVirtualKeyCode: 67,
			nativeVirtualKeyCode: 67,
		});
		await send("Input.dispatchKeyEvent", {
			type: "keyUp",
			modifiers: modifier,
			key: "c",
			code: "KeyC",
			windowsVirtualKeyCode: 67,
			nativeVirtualKeyCode: 67,
		});
	};
	const targetIds = [
		...googleScholarTargets,
		pageTarget,
		...nativePdfTargets,
	]
		.map((targetInfo) => debuggerTargetId(targetInfo))
		.filter(Boolean);
	const uniqueTargetIds = [...new Set(targetIds)];
	let lastError = null;
	for (const targetId of uniqueTargetIds) {
		try {
			await withDebuggerTarget({ targetId }, async ({ send }) => {
				await sendCopy(send);
			});
			return;
		} catch (error) {
			lastError = error;
		}
	}
	try {
		await withDebugger(tab.id, async ({ send }) => {
			await sendCopy(send);
		});
	} catch (error) {
		throw lastError || error;
	}
}

async function readTextFromFocusedBrowserClipboard(tab) {
	if (!tab?.id) throw new Error("No tab available for browser clipboard read.");
	const expression = `(() => {
		return Promise.resolve()
			.then(() => navigator.clipboard && typeof navigator.clipboard.readText === "function" ? navigator.clipboard.readText() : "")
			.catch((error) => ({ error: error?.message || String(error) }));
	})()`;
	const pageTarget = await getDebuggerPageTargetForTab(tab).catch(() => null);
	const googleScholarTargets = await getGoogleScholarReaderDebuggerTargets(tab).catch(() => []);
	const nativePdfTargets = await getNativeChromePdfViewerDebuggerTargets(tab).catch(() => []);
	const targetIds = [
		...googleScholarTargets,
		pageTarget,
		...nativePdfTargets,
	]
		.map((targetInfo) => debuggerTargetId(targetInfo))
		.filter(Boolean);
	const uniqueTargetIds = [...new Set(targetIds)];
	let lastError = null;
	const readWithSend = async (send) => {
		await send("Runtime.enable");
		const value = await evaluateDebuggerExpression(send, expression, undefined, "Could not read focused tab clipboard text");
		if (value && typeof value === "object" && value.error) throw new Error(value.error);
		return String(value || "");
	};
	for (const targetId of uniqueTargetIds) {
		try {
			const text = await withDebuggerTarget({ targetId }, async ({ send }) => await readWithSend(send));
			if (text) return text;
		} catch (error) {
			lastError = error;
		}
	}
	try {
		return await withDebugger(tab.id, async ({ send }) => await readWithSend(send));
	} catch (error) {
		throw lastError || error;
	}
}

async function maybeGetBrowserClipboardPdfSelection(tab, currentSelection) {
	if (selectionPayloadHasText(currentSelection)) return currentSelection;
	if (!tab?.id || !isLikelyPdfResourceUrl(tab?.url)) return currentSelection;

	let originalClipboard = "";
	let marker = "";
	let canRestoreClipboard = false;
	let setupError = null;
	const fallback = {
		attempted: true,
		ok: false,
		source: "browser-selection-keyboard-copy",
	};
	try {
		try {
			originalClipboard = await readTextFromExtensionClipboard();
			marker = `${BROWSER_SELECTION_CLIPBOARD_MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
			await writeTextToExtensionClipboard(marker);
			canRestoreClipboard = true;
		} catch (error) {
			setupError = error;
		}
		await focusTab(tab.id);
		await dispatchCopyShortcutToTab(tab);
		await delay(180);
		let readError = null;
		let copiedRawText = "";
		try {
			copiedRawText = await readTextFromFocusedBrowserClipboard(tab);
		} catch (error) {
			readError = error;
		}
		if (!copiedRawText) {
			try {
				copiedRawText = await readTextFromExtensionClipboard();
			} catch (error) {
				readError = readError || error;
			}
		}
		const copiedText = normalizeClipboardSelectionText(copiedRawText);
		if (!copiedText || copiedText === marker) {
			const reasons = [
				setupError ? `clipboard setup: ${setupError?.message || String(setupError)}` : "",
				readError ? `clipboard read: ${readError?.message || String(readError)}` : "",
			].filter(Boolean);
			return {
				...(currentSelection || {}),
				browserClipboardSelectionFallback: {
					...fallback,
					error: `Browser copy did not expose selected PDF text on the clipboard.${reasons.length ? ` ${reasons.join("; ")}` : ""}`,
				},
			};
		}
		let pageNumber = normalizePdfPageNumber(currentSelection?.pageNumber || currentSelection?.pdfAnchor?.pageNumber);
		if (!pageNumber) {
			try {
				const pageLocation = await inferInitialPdfViewerPageLocation({}, tab, normalizePdfUrlCandidate(tab.url, "", { allowFile: true }) || tab.url);
				pageNumber = normalizePdfPageNumber(pageLocation?.pageNumber);
			} catch {}
		}
		const pdfAnchor = {
			surface: "pdf",
			viewer: currentSelection?.viewer || "browser-pdf-selection",
			...(pageNumber ? { pageNumber } : {}),
			matchedText: copiedText,
			textQuote: { exact: copiedText },
		};
		return {
			surface: "pdf",
			viewer: currentSelection?.viewer || "browser-pdf-selection",
			source: "browser-selection-keyboard-copy",
			hasSelection: true,
			isCollapsed: false,
			text: copiedText,
			url: tab?.url || "",
			title: tab?.title || "",
			...(pageNumber ? { pageNumber } : {}),
			pdfAnchor,
			browserClipboardSelectionFallback: {
				...fallback,
				ok: true,
				copiedTextLength: copiedText.length,
			},
		};
	} catch (error) {
		return {
			...(currentSelection || {}),
			browserClipboardSelectionFallback: {
				...fallback,
				error: error?.message || String(error),
			},
		};
	} finally {
		if (canRestoreClipboard) {
			try {
				await writeTextToExtensionClipboard(originalClipboard);
			} catch {}
		}
	}
}

function getDebuggerFrameSelectionExpression() {
	return `(() => {
		const normalizeText = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
		const rectToObject = (rect) => rect
			? {
				x: Math.round(rect.x || rect.left || 0),
				y: Math.round(rect.y || rect.top || 0),
				left: Math.round(rect.left || 0),
				top: Math.round(rect.top || 0),
				right: Math.round(rect.right || 0),
				bottom: Math.round(rect.bottom || 0),
				width: Math.round(rect.width || 0),
				height: Math.round(rect.height || 0),
			}
			: null;
		const selection = window.getSelection?.() || document.getSelection?.();
		const text = normalizeText(selection?.toString?.() || "");
		let range = null;
		let rect = null;
		try {
			range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
		} catch {}
		const containerElement = range?.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range?.commonAncestorContainer?.parentElement || null;
		return {
			surface: "web",
			source: "debugger-frame-selection",
			hasSelection: Boolean(text),
			isCollapsed: Boolean(selection?.isCollapsed),
			text,
			rangeCount: Number(selection?.rangeCount || 0),
			rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
			container: containerElement
				? {
					tag: containerElement.tagName?.toLowerCase?.() || "",
					id: containerElement.id || "",
					className: String(containerElement.className || "").slice(0, 120),
					text: normalizeText(containerElement.textContent || "").slice(0, 160),
				}
				: null,
			url: location.href,
			title: document.title,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
			},
		};
	})()`;
}

async function getDebuggerFrameSelection(tabId) {
	const expression = getDebuggerFrameSelectionExpression();
	return await withDebuggerFrameContexts(
		tabId,
		(frame, context) => {
			if (!context?.auxData?.isDefault) return false;
			const url = String(frame?.url || "");
			if (!url) return false;
			return /^(https?|file):/i.test(url);
		},
		async ({ send, candidates }) => {
			let bestSelection = null;
			let lastError = null;
			for (const context of candidates) {
				try {
					const selection = await evaluateDebuggerExpression(
						send,
						expression,
						context.id,
						"Could not read selected text from frame",
					);
					if (!selectionPayloadHasText(selection)) continue;
					if (!bestSelection || String(selection.text || "").length > String(bestSelection.text || "").length) {
						bestSelection = {
							...selection,
							frameId: context?.auxData?.frameId || "",
							contextOrigin: context?.origin || "",
						};
					}
				} catch (error) {
					lastError = error;
				}
			}
			if (bestSelection) return bestSelection;
			throw lastError || new Error("No selected text found in frame contexts");
		},
	);
}

async function maybeGetDebuggerFrameSelection(tab, currentSelection) {
	if (selectionPayloadHasText(currentSelection)) return currentSelection;
	let lastError = null;
	try {
		const selection = await getDebuggerFrameSelection(tab.id);
		if (selectionPayloadHasText(selection)) return selection;
	} catch (error) {
		lastError = error;
	}
	if (lastError && currentSelection && typeof currentSelection === "object") {
		return {
			...currentSelection,
			debuggerFrameSelectionFallback: {
				attempted: true,
				ok: false,
				error: lastError?.message || String(lastError),
			},
		};
	}
	return currentSelection;
}

function normalizeReadableContentText(payload) {
	return String(payload?.markdown || payload?.text || payload?.reason || "")
		.replace(/\s+/g, " ")
		.trim();
}

function readableContentPayloadTextLength(payload) {
	return normalizeReadableContentText(payload).length;
}

function readableContentQueryTokens(query) {
	const stopWords = new Set([
		"about",
		"also",
		"and",
		"are",
		"context",
		"does",
		"each",
		"for",
		"from",
		"have",
		"page",
		"same",
		"that",
		"the",
		"this",
		"three",
		"using",
		"what",
		"which",
		"with",
	]);
	return Array.from(
		new Set(
			String(query || "")
				.toLowerCase()
				.match(/[a-z][a-z0-9._-]{2,}|[0-9]+(?:\.[0-9]+)?%?/g) || [],
		),
	)
		.filter((token) => !stopWords.has(token))
		.slice(0, 32);
}

function readableContentQueryScore(text, tokens) {
	if (!tokens.length) return 0;
	const haystack = String(text || "").toLowerCase();
	let score = 0;
	for (const token of tokens) {
		if (!token) continue;
		if (haystack.includes(token)) score += /[0-9.%]/.test(token) ? 5 : Math.min(4, Math.max(1, token.length - 2));
		if (token.endsWith("s") && token.length > 4 && haystack.includes(token.slice(0, -1))) score += 1;
	}
	return score;
}

function isLikelyOnlineTextbookReaderUrl(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return false;
	}
	if (!/^(https?|file):$/i.test(parsed.protocol)) return false;
	const host = parsed.hostname.toLowerCase();
	if (
		/(^|\.)(vitalsource\.com|jigsaw\.vitalsource\.com|pearson\.com|cengage\.com|mheducation\.com|mcgrawhill\.com|redshelf\.com|brytewave\.com|perusall\.com|zybooks\.com)$/i.test(
			host,
		)
	) {
		return true;
	}
	const path = parsed.pathname.toLowerCase();
	return parsed.protocol === "file:" && /\b(ebook|textbook|courseware|reader)\b/.test(path);
}

function isLikelyOnlineTextbookReaderTab(tab) {
	return isLikelyOnlineTextbookReaderUrl(tab?.url);
}

function sameOriginUrls(firstUrl, secondUrl) {
	try {
		return new URL(String(firstUrl || "")).origin === new URL(String(secondUrl || "")).origin;
	} catch {
		return false;
	}
}

function readableContentLooksLikeReaderSearchUi(payload) {
	const text = normalizeReadableContentText(payload).toLowerCase();
	if (!text) return false;
	const searchChromeSignals = [
		/\bsearch across book\b/,
		/\bchapters containing search results?\b/,
		/\bcontent\s*\(\d+\)\s*figures\s*\(\d+\)\s*workbook\s*\(\d+\)/,
		/\bfigures\s*\(\d+\)\s*workbook\s*\(\d+\)/,
		/\b\d+\s+results?\b/,
	];
	const signalCount = searchChromeSignals.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
	return signalCount >= 2 || (/^#\s*vitalsource bookshelf\b/.test(text) && /\bsearch\b/.test(text));
}

// An embedded-content shell: the top document carries only chrome/title text
// while the body lives in a cross-origin subframe (Claude artifact pages,
// sandboxed previews, embedded readers).
const EMBEDDED_CONTENT_SHELL_TOP_TEXT_MAX_CHARS = 600;

async function tabHasCrossOriginContentSubframe(tabId, tabUrl) {
	const frames = await getAllFramesForTab(tabId).catch(() => []);
	let tabHost = "";
	try {
		tabHost = new URL(String(tabUrl || "")).host;
	} catch {}
	return frames.some((frame) => {
		if (!frame || frame.frameId === 0) return false;
		const url = String(frame.url || "");
		if (!/^https?:/i.test(url)) return false;
		try {
			return new URL(url).host !== tabHost;
		} catch {
			return false;
		}
	});
}

async function shouldTryDebuggerFrameReadableContent(tab, currentContent, options = {}) {
	const url = String(tab?.url || "");
	if (!/^(https?|file):/i.test(url)) return false;
	const currentText = normalizeReadableContentText(currentContent);
	const currentLength = currentText.length;
	const tokens = readableContentQueryTokens(options.query);
	if (!isLikelyOnlineTextbookReaderTab(tab)) {
		// Embedded-content shells qualify too: the shape is chrome-thin top
		// text plus a cross-origin body frame. Anything else keeps the
		// single-frame fast path.
		if (currentLength >= EMBEDDED_CONTENT_SHELL_TOP_TEXT_MAX_CHARS) return false;
		return await tabHasCrossOriginContentSubframe(tab?.id, url);
	}
	if (readableContentLooksLikeReaderSearchUi(currentContent)) return true;
	if (tokens.length && readableContentQueryScore(currentText, tokens) <= 0) return true;
	if (currentLength < 5000) return true;
	const blockCount = Number(currentContent?.blockCount || currentContent?.blocks?.length || 0);
	return blockCount > 0 && blockCount < 5;
}

function debuggerFrameReadableContentIsBetter(candidate, currentContent, options = {}) {
	const candidateText = normalizeReadableContentText(candidate);
	const currentText = normalizeReadableContentText(currentContent);
	const candidateLength = candidateText.length;
	const currentLength = currentText.length;
	const tokens = readableContentQueryTokens(options.query);
	const candidateQueryScore = readableContentQueryScore(candidateText, tokens);
	const currentQueryScore = readableContentQueryScore(currentText, tokens);
	// A frame whose text has none of the query's terms while the top page has
	// them is an unrelated embed (ad, widget), not the body frame.
	if (tokens.length && candidateQueryScore <= 0 && currentQueryScore > 0) return false;
	if (candidateLength < 1000) {
		// A shell page whose top document is only chrome/title still gains
		// from a modest frame body; anything else needs a substantial one.
		if (!(currentLength < EMBEDDED_CONTENT_SHELL_TOP_TEXT_MAX_CHARS && candidateLength >= currentLength + 200)) return false;
	}
	if (readableContentLooksLikeReaderSearchUi(currentContent) && !readableContentLooksLikeReaderSearchUi(candidate)) return true;
	if (tokens.length && candidateQueryScore > currentQueryScore) return true;
	if (currentLength < 1000) return true;
	if (candidateLength >= currentLength + 1200 && (currentLength < 5000 || candidateLength >= currentLength * 1.5)) return true;
	return false;
}

async function getDebuggerFrameReadableContent(tabId, options = {}, currentContent = null, tab = null) {
	const extractOptions = {
		maxChars: options.maxChars,
		query: options.query,
		maxHeadingOutline: options.maxHeadingOutline,
	};
	const expression = `(${extractReadableContentInPage.toString()})(${JSON.stringify(extractOptions)})`;
	const queryTokens = readableContentQueryTokens(options.query);
	return await withDebuggerFrameContexts(
		tabId,
		(frame, context) => {
			if (!context?.auxData?.isDefault) return false;
			const url = String(frame?.url || "");
			if (!url || !/^(https?|file):/i.test(url)) return false;
			if (tab?.url && sameOriginUrls(tab.url, url)) return true;
			return isLikelyOnlineTextbookReaderUrl(url);
		},
		async ({ send, candidates }) => {
			let bestContent = null;
			let bestScore = -Infinity;
			let lastError = null;
			for (const context of candidates) {
				try {
					const content = await evaluateDebuggerExpression(
						send,
						expression,
						context.id,
						"Could not read readable content from frame",
					);
					if (!content || typeof content !== "object") continue;
					const text = normalizeReadableContentText(content);
					if (text.length < 1000) continue;
					const queryScore = readableContentQueryScore(text, queryTokens);
					const score = queryScore * 100000 + Math.min(text.length, 50000);
					const enriched = {
						...content,
						surface: content.surface || "web-frame",
						source: "debugger-frame-readable-content",
						frameId: context?.auxData?.frameId || "",
						contextOrigin: context?.origin || "",
						frameTitle: content.title || "",
						frameUrl: content.url || "",
					};
					if (score > bestScore && debuggerFrameReadableContentIsBetter(enriched, currentContent, options)) {
						bestScore = score;
						bestContent = enriched;
					}
				} catch (error) {
					lastError = error;
				}
			}
			if (bestContent) return bestContent;
			throw lastError || new Error("No readable nested frame content found");
		},
	);
}

// Readable extraction inside subframes via chrome.scripting (no debugger
// attach); returns the richest non-top-frame result from a DOMINANT frame or
// null. The dominance gate (frame viewport at least ~30% of the top frame's)
// keeps ad/widget iframes on short pages from being mistaken for the body
// frame. The extractor is injected directly as a function — string-eval
// injection would be blocked by frames whose CSP bans unsafe-eval (Claude
// artifact frames do).
// Frame viewport areas via a cheap scripting probe. Used to require that a
// frame chosen to replace top-document content is DOMINANT (>=30% of the top
// frame's viewport) — an ad/widget embed on a short page is not the body.
async function getFrameViewportAreasForTab(tabId) {
	const areas = new Map();
	try {
		const results = await executeScriptInAllFrames(tabId, () => ({ width: window.innerWidth, height: window.innerHeight }), []);
		for (const entry of Array.isArray(results) ? results : []) {
			if (entry?.result) areas.set(entry.frameId, Math.max(0, entry.result.width * entry.result.height));
		}
	} catch {}
	return areas;
}

function frameAreaIsDominant(areas, frameId) {
	const topArea = areas.get(0) || 0;
	if (topArea <= 0) return true;
	return (areas.get(frameId) || 0) >= topArea * 0.3;
}

async function getScriptingFrameReadableContent(tabId, options = {}) {
	const frameAreas = await getFrameViewportAreasForTab(tabId);
	const results = await executeScriptInAllFrames(tabId, extractReadableContentInPage, [
		{ maxChars: options.maxChars, query: options.query },
	]);
	let best = null;
	for (const entry of Array.isArray(results) ? results : []) {
		if (!entry || entry.frameId === 0) continue;
		if (!frameAreaIsDominant(frameAreas, entry.frameId)) continue;
		const value = entry.result;
		if (!value || typeof value !== "object") continue;
		const length = normalizeReadableContentText(value).length;
		if (!best || length > best.length) best = { value, length };
	}
	return best?.value || null;
}

async function maybeGetDebuggerFrameReadableContent(tab, currentContent, options = {}) {
	if (!(await shouldTryDebuggerFrameReadableContent(tab, currentContent, options))) return currentContent;
	try {
		const scriptingContent = await getScriptingFrameReadableContent(tab.id, options);
		if (debuggerFrameReadableContentIsBetter(scriptingContent, currentContent, options)) return scriptingContent;
	} catch {}
	try {
		const content = await getDebuggerFrameReadableContent(tab.id, options, currentContent, tab);
		if (debuggerFrameReadableContentIsBetter(content, currentContent, options)) return content;
	} catch {}
	return currentContent;
}

function isLikelyNativeChromePdfSelectionTab(tab) {
	const tabUrl = String(tab?.url || "");
	return tabUrl.startsWith(NATIVE_CHROME_PDF_VIEWER_PREFIX) || isLikelyPdfResourceUrl(tabUrl);
}

async function getNativeChromePdfViewerSelectionFromTarget(tab) {
	const expression = getNativeChromePdfViewerSelectionExpression();
	const targets = await getNativeChromePdfViewerDebuggerTargets(tab);
	let lastError = null;
	for (const targetInfo of targets) {
		const targetId = nativeChromePdfTargetId(targetInfo);
		if (!targetId) continue;
		try {
			return await withDebuggerTarget({ targetId }, async ({ send }) => {
				await send("Runtime.enable");
				return await evaluateDebuggerExpression(
					send,
					expression,
					undefined,
					"Could not read selection from Chrome PDF viewer target",
				);
			});
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError) throw lastError;
	return null;
}

async function getNativeChromePdfViewerSelectionFromFrame(tabId) {
	return await evaluateInMatchingFrame(
		tabId,
		frameOrContextLooksLikeNativeChromePdfViewer,
		getNativeChromePdfViewerSelectionExpression(),
		"No Chrome PDF viewer frame context found",
	);
}

async function getGoogleScholarReaderSelectionFromTarget(tab) {
	const expression = getGoogleScholarReaderSelectionExpression();
	const targets = await getGoogleScholarReaderDebuggerTargets(tab);
	let lastError = null;
	for (const targetInfo of targets) {
		const targetId = debuggerTargetId(targetInfo);
		if (!targetId) continue;
		try {
			return await withDebuggerTarget({ targetId }, async ({ send }) => {
				await send("Runtime.enable");
				return await evaluateDebuggerExpression(
					send,
					expression,
					undefined,
					"Could not read selection from Google Scholar PDF Reader target",
				);
			});
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError) throw lastError;
	return null;
}

async function inferPdfPageNumberFromGoogleScholarReaderTarget(tab) {
	const expression = getGoogleScholarReaderPageExpression();
	const targets = await getGoogleScholarReaderDebuggerTargets(tab);
	let lastError = null;
	for (const targetInfo of targets) {
		const targetId = debuggerTargetId(targetInfo);
		if (!targetId) continue;
		try {
			const detection = await withDebuggerTarget({ targetId }, async ({ send }) => {
				await send("Runtime.enable");
				return await evaluateDebuggerExpression(
					send,
					expression,
					undefined,
					"Could not infer page from Google Scholar PDF Reader target",
				);
			});
			const normalized = normalizePdfPageDetection(detection, "google-scholar-reader-target-page");
			if (normalized) {
				return {
					...normalized,
					source: `google-scholar-reader-target:${normalized.source}`,
				};
			}
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError) throw lastError;
	return null;
}

async function inferPdfPageNumberFromGoogleScholarReaderFrame(tabId) {
	const detection = await evaluateInMatchingFrame(
		tabId,
		frameOrContextLooksLikeGoogleScholarReader,
		getGoogleScholarReaderPageExpression(),
		"No Google Scholar PDF Reader frame context found",
	);
	const normalized = normalizePdfPageDetection(detection, "google-scholar-reader-frame-page");
	if (!normalized) return null;
	return {
		...normalized,
		source: `google-scholar-reader-frame:${normalized.source}`,
	};
}

async function inferPdfPageNumberFromGoogleScholarReaderContexts(tabId) {
	const expression = getGoogleScholarReaderPageExpression();
	return await withDebuggerFrameContexts(
		tabId,
		(frame, context) => !frameOrContextLooksLikeOwnExtension(frame, context),
		async ({ send, candidates }) => {
			if (!candidates.length) throw new Error("No debugger contexts found for PDF page detection");
			let lastError = null;
			const detections = [];
			for (const context of candidates) {
				try {
					const detection = await evaluateDebuggerExpression(
						send,
						expression,
						context.id,
						"Could not infer page from debugger context",
					);
					const normalized = normalizeNonDefaultPdfPageDetection(detection, "google-scholar-reader-context-page");
					if (!normalized) continue;
					detections.push({
						...normalized,
						source: `google-scholar-reader-context:${normalized.source}`,
						contextOrigin: context?.origin || "",
						contextName: context?.name || "",
					});
				} catch (error) {
					lastError = error;
				}
			}
			detections.sort((left, right) => Number(left.score ?? 0) - Number(right.score ?? 0) || left.pageNumber - right.pageNumber);
			if (detections[0]) return detections[0];
			throw lastError || new Error("No debugger context exposed a PDF page number");
		},
	);
}

async function maybeGetNativeChromePdfViewerSelection(tab, currentSelection) {
	if (selectionPayloadHasText(currentSelection)) return currentSelection;
	if (!isLikelyNativeChromePdfSelectionTab(tab)) return currentSelection;
	let lastError = null;
	for (const readNativeSelection of [
		() => getNativeChromePdfViewerSelectionFromTarget(tab),
		() => getNativeChromePdfViewerSelectionFromFrame(tab.id),
	]) {
		try {
			const selection = await readNativeSelection();
			if (selectionPayloadHasText(selection)) return selection;
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError && currentSelection && typeof currentSelection === "object") {
		return {
			...currentSelection,
			nativePdfSelectionFallback: {
				attempted: true,
				ok: false,
				error: lastError?.message || String(lastError),
			},
		};
	}
	return currentSelection;
}

async function maybeGetGoogleScholarReaderSelection(tab, currentSelection) {
	if (selectionPayloadHasText(currentSelection)) return currentSelection;
	if (!tab?.id || !isLikelyPdfResourceUrl(tab?.url)) return currentSelection;
	const readerSurface = await detectGoogleScholarReaderSurface(tab);
	let lastError = null;
	try {
		const selection = await getGoogleScholarReaderSelectionFromTarget(tab);
		if (selectionPayloadHasText(selection)) return selection;
		if (selection && typeof selection === "object") return markGoogleScholarReaderSelectionSurface(selection, readerSurface);
	} catch (error) {
		lastError = error;
	}
	if ((lastError || readerSurface) && currentSelection && typeof currentSelection === "object") {
		const fallback = {
			attempted: true,
			ok: false,
			error: lastError?.message || String(lastError || "Google Scholar PDF Reader selection text was not exposed"),
		};
		return markGoogleScholarReaderSelectionSurface(
			{
				...currentSelection,
				googleScholarReaderSelectionFallback: fallback,
			},
			readerSurface,
			fallback,
		);
	}
	return currentSelection;
}

async function getNativeChromePdfViewerSelectionForHandoff(tab, pdfUrl = "") {
	if (!tab?.id || !isLikelyNativeChromePdfSelectionTab(tab)) return null;
	const selection = await maybeGetNativeChromePdfViewerSelection(tab, {
		hasSelection: false,
		isCollapsed: true,
		text: "",
	});
	return normalizePdfSelectionForViewerHandoff(selection, pdfUrl);
}

async function getGoogleScholarReaderSelectionForHandoff(tab, pdfUrl = "") {
	if (!tab?.id || !isLikelyPdfResourceUrl(tab?.url)) return null;
	const selection = await maybeGetGoogleScholarReaderSelection(tab, {
		hasSelection: false,
		isCollapsed: true,
		text: "",
	});
	return normalizePdfSelectionForViewerHandoff(selection, pdfUrl);
}

async function getPdfSelectionForViewerHandoff(tab, pdfUrl = "") {
	if (!tab?.id) return null;
	let pageSelection = null;
	try {
		pageSelection = await runPageToolkitMethod(tab.id, "getSelectionInfo");
		const handoffSelection = normalizePdfSelectionForViewerHandoff(pageSelection, pdfUrl);
		if (handoffSelection) {
			return {
				...handoffSelection,
				source: handoffSelection.source || "pdf-reader-selection-handoff",
			};
		}
	} catch (error) {
		if (!isRestrictedScriptingError(error) || !isLikelyNativeChromePdfSelectionTab(tab)) {
			log("Could not read PDF selection from page toolkit for viewer handoff", error?.message || String(error));
		} else {
			pageSelection = {
				surface: "pdf",
				viewer: "chrome-pdf-viewer",
				source: "native-chrome-pdf-viewer-restricted-main-frame",
				hasSelection: false,
				text: "",
				mainFrameSelectionError: error?.message || String(error),
			};
		}
	}
	try {
		const googleScholarSelection = await getGoogleScholarReaderSelectionForHandoff(tab, pdfUrl);
		if (googleScholarSelection) return googleScholarSelection;
	} catch (error) {
		log("Could not capture Google Scholar PDF Reader selection for viewer handoff", error?.message || String(error));
	}
	try {
		const nativeSelection = await getNativeChromePdfViewerSelectionForHandoff(tab, pdfUrl);
		if (nativeSelection) return nativeSelection;
	} catch (error) {
		log("Could not capture native PDF selection for viewer handoff", error?.message || String(error));
	}
	try {
		const clipboardSelection = await maybeGetBrowserClipboardPdfSelection(tab, pageSelection || { hasSelection: false, isCollapsed: true, text: "" });
		const handoffSelection = normalizePdfSelectionForViewerHandoff(clipboardSelection, pdfUrl);
		if (handoffSelection) return handoffSelection;
	} catch (error) {
		log("Could not capture browser clipboard PDF selection for viewer handoff", error?.message || String(error));
	}
	try {
		const frameSelection = await maybeGetDebuggerFrameSelection(tab, pageSelection || { hasSelection: false, isCollapsed: true, text: "" });
		const handoffSelection = normalizePdfSelectionForViewerHandoff(frameSelection, pdfUrl);
		if (handoffSelection) {
			return {
				...handoffSelection,
				source: handoffSelection.source || "pdf-frame-selection-handoff",
			};
		}
	} catch (error) {
		log("Could not capture frame PDF selection for viewer handoff", error?.message || String(error));
	}
	return null;
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
			return await withOperationTimeout(
				chrome.debugger.sendCommand({ ...target, sessionId }, method, params),
				DEBUGGER_COMMAND_TIMEOUT_MS,
				`Debugger session command timed out: ${method}`,
			);
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
						const closestToolbar = typeof this.closest === "function"
							? this.closest('[role="toolbar"], header, nav, .toolbar, .gsr-toolbar, .viewer-toolbar, viewer-toolbar')
							: null;
						return {
							value: "value" in this ? this.value : "",
							textContent: this.textContent || "",
							parentTextContent: this.parentElement?.textContent || "",
							toolbarTextContent: closestToolbar?.textContent || "",
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

function inferPdfPageFractionFromDebuggerDomDetails(details) {
	const pageNumber = normalizePdfPageNumber(
		details?.value ||
			details?.ariaValueNow ||
			details?.ariaValueText ||
			details?.["aria-valuenow"] ||
			details?.["aria-valuetext"] ||
			details?.nodeValue,
	);
	if (!pageNumber) return null;
	const nearbyText = [
		details?.value,
		details?.textContent,
		details?.parentTextContent,
		details?.toolbarTextContent,
		details?.ariaValueText,
		details?.["aria-valuetext"],
	]
		.filter(Boolean)
		.join(" ");
	for (const match of nearbyText.matchAll(/(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,4})(?!\d)/g)) {
		const candidatePage = normalizePdfPageNumber(match?.[1]);
		const totalPages = normalizePdfPageNumber(match?.[2]);
		if (candidatePage === pageNumber && totalPages && totalPages >= pageNumber && totalPages > 1) {
			return pageNumber;
		}
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
			const pageFractionCandidates = [];
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
				const looksLikePageFractionEntry =
					/\b(input|textbox|text\s*field|viewer-page-selector|viewer-toolbar|viewer-pdf-toolbar)\b/i.test(
						String(node.nodeName || node.localName || ""),
					) || /\b(input|textbox|text\s*field|spinbutton)\b/i.test(descriptor);
				if (!looksLikePageFractionEntry) continue;
				const details = await readDebuggerDomNodeDetails(send, node);
				if (debuggerDomNodeLooksLikeOnhandPdfViewer(descriptor, details)) continue;
				const pageNumber = inferPdfPageFractionFromDebuggerDomDetails(details);
				if (pageNumber) pageFractionCandidates.push({ pageNumber, source: "debugger-dom-page-fraction" });
			}
			const preferredPageFraction = pageFractionCandidates.find((candidate) => candidate.pageNumber > 1) || pageFractionCandidates[0];
			if (preferredPageFraction) return preferredPageFraction;

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

function createPdfViewerHandoffDiagnostics(args = {}, tab = null, pdfUrl = "") {
	if (args.includeDiagnostics !== true && args.debug !== true) return null;
	return {
		startedAt: new Date().toISOString(),
		sourceTab: tab ? simplifyTab(tab) : null,
		pdfUrl,
		detectors: [],
	};
}

function recordPdfViewerHandoffDiagnostic(diagnostics, entry) {
	if (!diagnostics || !entry) return;
	diagnostics.detectors.push({
		...entry,
		durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Math.round(Number(entry.durationMs))) : undefined,
	});
	if (diagnostics.detectors.length > 30) diagnostics.detectors.splice(0, diagnostics.detectors.length - 30);
}

function summarizePdfPageDetectionForDiagnostics(value, fallbackSource = "") {
	const detection = normalizePdfPageDetection(value, fallbackSource);
	if (!detection) return null;
	return {
		pageNumber: detection.pageNumber,
		source: detection.source,
		...(detection.score !== undefined ? { score: detection.score } : {}),
		...(detection.scrollRatio !== undefined ? { scrollRatio: detection.scrollRatio } : {}),
		...(detection.contextOrigin ? { contextOrigin: detection.contextOrigin } : {}),
		...(detection.contextName ? { contextName: detection.contextName } : {}),
	};
}

async function runPdfPageLocationDetector(label, read, diagnostics, options = {}) {
	const timeoutMs = clampNumber(options.timeoutMs, PDF_PAGE_DETECTOR_TIMEOUT_MS, { min: 250, max: 10000 });
	const startedAt = Date.now();
	try {
		const raw = await withOperationTimeout(
			Promise.resolve().then(read),
			timeoutMs,
			`PDF page detector timed out: ${label}`,
		);
		const normalized = options.allowPageOne
			? normalizePdfPageDetection(raw, label)
			: normalizeNonDefaultPdfPageDetection(raw, label);
		recordPdfViewerHandoffDiagnostic(diagnostics, {
			label,
			ok: true,
			accepted: Boolean(normalized),
			detection: summarizePdfPageDetectionForDiagnostics(normalized || raw, label),
			durationMs: Date.now() - startedAt,
		});
		return normalized;
	} catch (error) {
		recordPdfViewerHandoffDiagnostic(diagnostics, {
			label,
			ok: false,
			error: error?.message || String(error),
			durationMs: Date.now() - startedAt,
		});
		return null;
	}
}

async function inferInitialPdfViewerPageLocation(args = {}, tab = null, pdfUrl = "", diagnostics = null) {
	const explicitPageNumber = normalizePdfPageNumber(args.pageNumber ?? args.page ?? args.initialPageNumber ?? args.initialPage);
	if (explicitPageNumber) {
		const detection = { pageNumber: explicitPageNumber, source: String(args.initialPageSource || "explicit") };
		recordPdfViewerHandoffDiagnostic(diagnostics, { label: "explicit", ok: true, accepted: true, detection, durationMs: 0 });
		return detection;
	}
	for (const candidateUrl of [pdfUrl, args.pdfUrl]) {
		const pageNumber = inferPdfPageNumberFromUrl(candidateUrl);
		if (pageNumber) {
			const detection = { pageNumber, source: "url" };
			recordPdfViewerHandoffDiagnostic(diagnostics, { label: "url", ok: true, accepted: true, detection, durationMs: 0 });
			return detection;
		}
	}
	if (!tab?.id || !shouldInferPdfPageNumberFromTab(tab, pdfUrl)) {
		recordPdfViewerHandoffDiagnostic(diagnostics, {
			label: "tab-eligibility",
			ok: false,
			error: !tab?.id ? "No source tab id." : "Source tab is not eligible for PDF page inference.",
			durationMs: 0,
		});
		return null;
	}

	const tabUrlPageNumber = inferPdfPageNumberFromUrl(tab.url);
	if (tabUrlPageNumber) {
		const detection = { pageNumber: tabUrlPageNumber, source: "tab-url" };
		recordPdfViewerHandoffDiagnostic(diagnostics, { label: "tab-url", ok: true, accepted: true, detection, durationMs: 0 });
		return detection;
	}

	const fallbackReaders = [
		{ label: "google-scholar-target", read: () => inferPdfPageNumberFromGoogleScholarReaderTarget(tab) },
		{ label: "google-scholar-frame", read: () => inferPdfPageNumberFromGoogleScholarReaderFrame(tab.id) },
		{ label: "google-scholar-contexts", read: () => inferPdfPageNumberFromGoogleScholarReaderContexts(tab.id) },
		{ label: "related-debugger-targets", read: () => inferPdfPageNumberFromRelatedDebuggerTargets(tab.id) },
		{ label: "native-chrome-target", read: () => inferPdfPageNumberFromNativeChromePdfViewerTarget(tab) },
		{ label: "native-chrome-frame", read: () => inferPdfPageNumberFromNativeChromePdfViewerFrame(tab.id) },
		{ label: "debugger-default-context", read: () => inferPdfPageNumberFromDebuggerDefaultContext(tab.id) },
		{ label: "debugger-dom", read: () => inferPdfPageNumberFromDebuggerDom(tab.id) },
		{ label: "accessibility-tree", read: () => inferPdfPageNumberFromAccessibilityTree(tab.id) },
		{ label: "tab-dom", read: () => inferPdfPageNumberFromTabDom(tab.id) },
	];

	for (const fallback of fallbackReaders) {
		const detection = await runPdfPageLocationDetector(fallback.label, fallback.read, diagnostics);
		if (detection) return detection;
	}

	const visibleDetection = await runPdfPageLocationDetector("visible-payload", async () => {
		const visible = await runPageToolkitMethod(tab.id, "getVisibleText", {
			maxPages: 4,
			maxBlocks: 8,
			maxChars: 2000,
		});
		const pageNumber = inferPdfPageNumberFromVisiblePayload(visible);
		return pageNumber ? { pageNumber, source: "visible-payload" } : null;
	}, diagnostics);
	if (visibleDetection) return visibleDetection;

	const onhandViewerDetection = await runPdfPageLocationDetector("open-onhand-viewer-status", async () => {
		const result = await inferPdfPageNumberFromOpenOnhandPdfViewer(tab.id);
		return normalizePdfPageDetection(result, "onhand-pdf-viewer-status");
	}, diagnostics, { allowPageOne: true });
	if (onhandViewerDetection) return onhandViewerDetection;

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
			await withOperationTimeout(
				chrome.debugger.attach(target, "1.3"),
				DEBUGGER_COMMAND_TIMEOUT_MS,
				`Debugger attach timed out: ${target?.tabId || target?.targetId || "target"}`,
			);
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
	const scheduledTask = withOperationTimeout(
		previousTask.catch(() => {}).then(async () => {
			await assertDebuggerEligibleTab(tabId);
			const target = { tabId };
			await attachDebuggerWithRetry(target);
			try {
				return await fn({
					target,
					send: async (method, params = {}) => {
						return await withOperationTimeout(
							chrome.debugger.sendCommand(target, method, params),
							DEBUGGER_COMMAND_TIMEOUT_MS,
							`Debugger command timed out: ${method}`,
						);
					},
				});
			} finally {
				try {
					await chrome.debugger.detach(target);
				} catch {}
			}
		}),
		TAB_COMMAND_TIMEOUT_MS,
		`Timed out waiting for debugger task on tab ${tabId}`,
	);

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
	const scheduledTask = withOperationTimeout(
		previousTask.catch(() => {}).then(async () => {
			await attachDebuggerWithRetry(target);
			try {
				return await fn({
					target,
					send: async (method, params = {}) => {
						return await withOperationTimeout(
							chrome.debugger.sendCommand(target, method, params),
							DEBUGGER_COMMAND_TIMEOUT_MS,
							`Debugger command timed out: ${method}`,
						);
					},
				});
			} finally {
				try {
					await chrome.debugger.detach(target);
				} catch {}
			}
		}),
		TAB_COMMAND_TIMEOUT_MS,
		`Timed out waiting for debugger task on ${targetKey}`,
	);

	const trackedTask = scheduledTask.finally(() => {
		if (debuggerTaskChains.get(targetKey) === trackedTask) {
			debuggerTaskChains.delete(targetKey);
		}
	});

	debuggerTaskChains.set(targetKey, trackedTask);
	return await trackedTask;
}

async function withTabCommand(tabId, fn, timeoutMs = TAB_COMMAND_TIMEOUT_MS) {
	const enqueuedAt = Date.now();
	const previousTask = tabCommandTaskChains.get(tabId) || Promise.resolve();
	const scheduledTask = withOperationTimeout(
		previousTask
			.catch(() => {})
			.then(() => {
				// Command budgets start at enqueue, so queue congestion is
				// indistinguishable from slow execution in tool traces. Log the
				// wait separately to make the signature unmistakable.
				const queueWaitMs = Date.now() - enqueuedAt;
				if (queueWaitMs > 500) log("slow queue wait", `tab ${tabId}`, `${queueWaitMs}ms`);
				return Promise.resolve().then(fn);
			}),
		timeoutMs,
		`Timed out waiting for page command on tab ${tabId}`,
	);
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
		let style = null;
		try {
			style = window.getComputedStyle(element);
		} catch {
			return false;
		}
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
			// Hidden/occluded documents never fire rAF and throttle timers to ≥1s
			// ticks, so the nominal cap balloons into multi-second stalls that blow
			// the 6s annotation command budget. Layout is still computed
			// synchronously on demand (getBoundingClientRect), so with no paint
			// pending there is nothing to wait for.
			if (document.visibilityState === "hidden") {
				resolve();
				return;
			}
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
			  pointer-events: none !important;
			  cursor: default !important;
			  user-select: none !important;
			  -webkit-user-select: none !important;
			  scroll-margin-top: 20vh !important;
			  scroll-margin-bottom: 20vh !important;
			}

			/* Note card — editorial callout, pine-barred */
			/* flow-root (a BFC) so the card can never slide under floated page
			   figures/infoboxes: beside a float it shrinks to the free space or
			   drops below, instead of overlapping the image the way a plain
			   block box does when a narrow viewport (open side panel) squeezes
			   the column. */
			[data-onhand-note-kind="card"] {
			  background: var(--onhand-mantle) !important;
			  color: var(--onhand-text) !important;
			  border: 1px solid var(--onhand-surface-2) !important;
			  border-left: 3px solid var(--onhand-pine) !important;
			  border-radius: 0 4px 4px 0 !important;
			  box-shadow: 0 1px 2px rgba(87, 82, 121, 0.06) !important;
			  margin: 14px 0 18px !important;
			  padding: 12px 14px !important;
			  display: flow-root !important;
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
			"math",
			'[role="math"]',
		].join(", ");

		const DISPLAY_MATH_HIGHLIGHT_TARGET_SELECTOR = [
			".MathJax_Display",
			"mjx-container",
			".katex-display",
			".katex",
			".math",
			"math",
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

	// A document masthead carries real prose (a dashboard's thesis, an
	// article's standfirst); a site-chrome header is mostly links and short
	// labels. Only the former may hold annotations.
	const isContentfulDocumentHeader = (headerElement) => {
		const text = (headerElement.innerText || "").trim();
		if (text.length < 160) return false;
		let linkTextLength = 0;
		for (const link of headerElement.querySelectorAll("a")) linkTextLength += (link.innerText || "").trim().length;
		return linkTextLength <= text.length * 0.3;
	};

	// Nearest-ancestor walk with the masthead exception: an allowed header may
	// itself sit inside a nav/aside that still excludes it, and a nav inside
	// an allowed header still excludes its own contents.
	const isInsideExcludedAnnotationAncestor = (element) => {
		let current = element instanceof Element ? element : element?.parentElement;
		while (current && current !== document.body) {
			const excludedAncestor = current.closest(EXCLUDED_ANNOTATION_ANCESTOR_SELECTOR);
			if (!excludedAncestor) return false;
			if (excludedAncestor.tagName === "HEADER" && isContentfulDocumentHeader(excludedAncestor)) {
				current = excludedAncestor.parentElement;
				continue;
			}
			return true;
		}
		return false;
	};

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
		const left = clampUnit((rect.left - pageRect.left) / pageWidth);
		const top = clampUnit((rect.top - pageRect.top) / pageHeight);
		const rawRight = Number.isFinite(rect.right)
			? (rect.right - pageRect.left) / pageWidth
			: (rect.left - pageRect.left + rect.width) / pageWidth;
		const rawBottom = Number.isFinite(rect.bottom)
			? (rect.bottom - pageRect.top) / pageHeight
			: (rect.top - pageRect.top + rect.height) / pageHeight;
		const right = clampUnit(rawRight);
		const bottom = clampUnit(rawBottom);
		return {
			pageNumber,
			x: left,
			y: top,
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top),
			coordinateSpace: "page-normalized",
		};
	};

	const MIN_PDF_HIGHLIGHT_RECT_RATIO = 0.0005;
	const MAX_PDF_HIGHLIGHT_RECT_HEIGHT_RATIO = 0.35;

	const sanitizePdfNormalizedRect = (rect, fallbackPageNumber = null, options = {}) => {
		if (!rect || typeof rect !== "object") return null;
		const pageNumber = Number.parseInt(String(rect.pageNumber || fallbackPageNumber || ""), 10);
		if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;
		const x = Number(rect.x ?? rect.left);
		const y = Number(rect.y ?? rect.top);
		const width = Number(rect.width);
		const height = Number(rect.height);
		if (![x, y, width, height].every(Number.isFinite)) return null;
		if (width <= 0 || height <= 0) return null;
		const left = Math.max(0, Math.min(1, x));
		const top = Math.max(0, Math.min(1, y));
		const right = Math.max(0, Math.min(1, x + width));
		const bottom = Math.max(0, Math.min(1, y + height));
		const boundedWidth = right - left;
		const boundedHeight = bottom - top;
		if (boundedWidth <= MIN_PDF_HIGHLIGHT_RECT_RATIO || boundedHeight <= MIN_PDF_HIGHLIGHT_RECT_RATIO) return null;
		const looksLikeSingleLineRect = boundedHeight >= 0.98 && boundedWidth < 0.95;
		if (options.rejectTall !== false && boundedHeight > MAX_PDF_HIGHLIGHT_RECT_HEIGHT_RATIO && !looksLikeSingleLineRect) return null;
		return {
			pageNumber,
			x: left,
			y: top,
			width: boundedWidth,
			height: boundedHeight,
			coordinateSpace: "page-normalized",
		};
	};

	const getSanitizedPdfAnchorRectEntries = (pdfAnchor, fallbackPageNumber = null, options = {}) => {
		const rects = Array.isArray(pdfAnchor?.rects) ? pdfAnchor.rects : [];
		return rects
			.map((rect, index) => {
				const sanitized = sanitizePdfNormalizedRect(rect, fallbackPageNumber, options);
				return sanitized ? { index, rect: sanitized } : null;
			})
			.filter(Boolean);
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
		for (const { rect } of getSanitizedPdfAnchorRectEntries(pdfAnchor)) {
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

	const makePdfHighlightOverlayPassive = (element) => {
		if (!(element instanceof HTMLElement)) return;
		element.removeAttribute("role");
		element.removeAttribute("tabindex");
		element.removeAttribute("title");
		element.removeAttribute("data-onhand-note-trigger-bound");
		element.setAttribute("aria-hidden", "true");
		setPdfOverlayStyle(element, "pointer-events", "none");
		setPdfOverlayStyle(element, "cursor", "default");
		setPdfOverlayStyle(element, "user-select", "none");
		setPdfOverlayStyle(element, "-webkit-user-select", "none");
	};

	const attachPdfNoteInteractions = (note, annotationElement) => {
		if (!(note instanceof HTMLElement)) return;
		const annotationId = String(note.getAttribute("data-onhand-note-for") || annotationElement?.getAttribute?.("data-onhand-annotation-id") || "");
		if (!annotationId) return;
		if (annotationElement instanceof HTMLElement) makePdfHighlightOverlayPassive(annotationElement);
		for (const segment of Array.from(document.querySelectorAll(`[data-onhand-pdf-segment-for="${attrEscape(annotationId)}"]`))) {
			makePdfHighlightOverlayPassive(segment);
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

	const positionPdfHighlightElement = (annotationElement, page, pdfAnchor, options = {}) => {
		if (!(annotationElement instanceof HTMLElement) || !(page instanceof HTMLElement)) return false;
		makePdfHighlightOverlayPassive(annotationElement);
		const rectEntries = getSanitizedPdfAnchorRectEntries(pdfAnchor, getPdfPageNumber(page), options);
		const annotationId = String(annotationElement.getAttribute("data-onhand-annotation-id") || "");
		const pageNumber = getPdfPageNumber(page);
		const primaryEntry = rectEntries.find((entry) => Number(entry.rect.pageNumber) === pageNumber) || null;
		if (!primaryEntry) return false;
		positionPdfVisualRect(annotationElement, page, primaryEntry.rect);
		syncPdfHighlightSegments(annotationId, pdfAnchor, primaryEntry.index, options);
		return true;
	};

	const positionPdfVisualRect = (element, page, rect) => {
		if (!(element instanceof HTMLElement) || !(page instanceof HTMLElement) || !rect) return false;
		makePdfHighlightOverlayPassive(element);
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

	const syncPdfHighlightSegments = (annotationId, pdfAnchor, primaryRectIndex = 0, options = {}) => {
		const rawAnnotationId = String(annotationId || "").trim();
		if (!rawAnnotationId || !pdfAnchor) return 0;
		removePdfHighlightSegments(rawAnnotationId);
		const rectEntries = getSanitizedPdfAnchorRectEntries(pdfAnchor, null, options);
		let created = 0;
		for (const { index, rect } of rectEntries) {
			if (index === primaryRectIndex) continue;
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
			makePdfHighlightOverlayPassive(segment);
			if (!positionPdfVisualRect(segment, page, rect)) continue;
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
					return sanitizePdfNormalizedRect(normalizePdfRect(rect, page.getBoundingClientRect(), pageNumber), pageNumber, { rejectTall: false });
				})
				.filter(Boolean);
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
		const pageNumber = getPdfPageNumber(page);
		const rectEntries = getSanitizedPdfAnchorRectEntries(pdfAnchor, Number(pdfAnchor?.pageNumber || pageNumber) || pageNumber);
		const rects = rectEntries.map((entry) => entry.rect);
		if (!rectEntries.some((entry) => Number(entry.rect.pageNumber) === pageNumber)) return null;
		const overlayLayer = ensurePdfOverlayLayer(page);
		if (!overlayLayer) return null;
		const annotationId = String(options.annotationId || nextAnnotationId());
		const matchedText = normalizeText(pdfAnchor?.matchedText || pdfAnchor?.textQuote?.exact || rawQuery);
		const anchor = {
			surface: "pdf",
			viewer: pdfAnchor?.viewer || options.viewer || "unknown-pdf",
				document: {
					...buildPdfDocumentInfo(options.surface || {}),
					...(pdfAnchor?.document || {}),
				},
			pageNumber: Number(pdfAnchor?.pageNumber || pageNumber) || pageNumber,
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
		if (!positionPdfHighlightElement(highlight, page, anchor)) return null;
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
		const mappedText = buildNormalizedTextMap(textNodes, { pdfNodeBoundaries: true });
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
			const rects = getPdfRangeClientRects(match.range, page, fallbackRect)
				.map((rect) => sanitizePdfNormalizedRect(normalizePdfRect(rect, pageRect, pageNumber), pageNumber, { rejectTall: false }))
				.filter(Boolean);
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
				if (!positionPdfHighlightElement(highlight, page, pdfAnchor, { rejectTall: false })) continue;
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

	const isFootnoteReferenceMarker = (element) => {
		// Superscript footnote/citation markers ("[1]", "[note 3]") are rendered inside the
		// prose text stream but are stripped from readable extractions, so copied sentences
		// that span them would never exact-match unless we skip the marker text.
		if (!(element instanceof Element)) return false;
		const sup = element.closest("sup");
		if (!sup) return false;
		if (String(sup.getAttribute("role") || "").toLowerCase() === "doc-noteref") return true;
		if (!sup.querySelector('a[href*="#"]')) return false;
		return normalizeText(sup.textContent || "").length <= 40;
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
					const annotationAncestor = parent.closest(ONHAND_ANNOTATION_DOM_SELECTOR);
					if (annotationAncestor) {
						// Inline/block highlights wrap ORIGINAL page text, which must stay
						// matchable — otherwise a partial highlight from an earlier attempt or
						// turn permanently blocks exact matches for any span overlapping it.
						// Onhand-injected content (note cards, PDF overlays) stays excluded.
						const highlightKind = annotationAncestor.getAttribute("data-onhand-highlight-kind");
						if (highlightKind !== "inline" && highlightKind !== "block") return NodeFilter.FILTER_REJECT;
					}
					if (options.excludePdfViewerUi === true && parent.closest(PDF_VIEWER_UI_TEXT_EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
					if (parent.closest('[contenteditable="true"], [contenteditable=true]')) return NodeFilter.FILTER_REJECT;
					if (isInsideExcludedAnnotationAncestor(parent)) return NodeFilter.FILTER_REJECT;
				if (parent.closest(EXCLUDED_HIGHLIGHT_TEXT_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
				if (isFootnoteReferenceMarker(parent)) return NodeFilter.FILTER_REJECT;
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
		if (/[=()[\]{}_^√∑∏∫+*\/\\]|[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]/u.test(text)) return true;
		if (/[−‐‑‒–—―]/u.test(text) && /(?:\d\s*[−‐‑‒–—―]\s*\d|[A-Za-z]\s*[−‐‑‒–—―]\s*\d|\d\s*[−‐‑‒–—―]\s*[A-Za-z])/u.test(text)) return true;
		const compact = text.replace(/\s+/g, "");
		return /^[A-Z][A-Za-z0-9]{1,10}$/.test(compact);
	};

	const pageHasRawTexSource = () => {
		const text = document.body?.textContent || "";
		return /(?:\$\$|\\\(|\\\[|\\begin\{)/.test(text);
	};

	const pageHasRenderedMath = () => Boolean(document.querySelector(`${MATH_CONTAINER_SELECTOR}, script[type^="math/tex"]`));

	const waitForMathTypesetting = async (rawQuery) => {
		// Wait for MathJax's queue only for math-like queries. Prose highlights on math
		// pages should not get stuck behind a long MathJax startup promise.
		if (!window.MathJax) {
			// No typesetting engine present. Pages that already expose rendered math
			// (MathML, MathJax/KaTeX output) have nothing pending; only unrendered raw
			// TeX justifies waiting for an engine to appear. Background tabs throttle
			// timers to ~1s, so needless waiting here can burn the whole tool budget.
			if (pageHasRenderedMath()) return;
			if (!pageHasRawTexSource()) return;
		}
		const queryLooksMathLike = isMathLikeHighlightQuery(rawQuery);

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
		if (queryLooksMathLike) await waitForMathJaxQueue();
		// Time-capped rather than iteration-capped: throttled background-tab timers
		// stretch each wait to ~1s, so counting attempts could block for ~20s.
		const renderWaitStartedAt = Date.now();
		while (Date.now() - renderWaitStartedAt < 2000) {
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
			if (isInsideExcludedAnnotationAncestor(container)) continue;
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

	// Containers for context-anchored recovery: the highlighted text itself has
	// drifted, so select containers by the anchor's surrounding context instead
	// of the query.
	const collectAnchorContextContainers = (compactPrefix, compactSuffix) => {
		const root = document.body || document.documentElement;
		const candidates = [];
		for (const container of root.querySelectorAll(`${ANNOTATION_CONTAINER_SELECTOR}, ${MATH_CONTAINER_SELECTOR}`)) {
			if (!(container instanceof Element)) continue;
			if (!isVisible(container)) continue;
			if (isInsideExcludedAnnotationAncestor(container)) continue;
			if (container.closest('[data-onhand-highlight-kind]')) continue;
			const compactText = compactHighlightSearchText(getElementText(container));
			if (!compactText.includes(compactPrefix) || !compactText.includes(compactSuffix)) continue;
			candidates.push(container);
		}
		return candidates;
	};

	// pdf.js text layers render one absolutely positioned span per text item
	// with no whitespace between spans, so a naive node walk glues wrapped
	// lines and adjacent words together while extraction (what the model
	// copies from) separates them. Geometry tells a word boundary (new line or
	// visible horizontal gap) apart from a kerning split inside one word.
	const pdfTextNodeBoundaryNeedsSpace = (previousNode, nextNode) => {
		if (!previousNode) return false;
		const previousElement = previousNode.parentElement;
		const nextElement = nextNode.parentElement;
		if (!previousElement || !nextElement || previousElement === nextElement) return false;
		const previousRect = previousElement.getBoundingClientRect();
		const nextRect = nextElement.getBoundingClientRect();
		const lineHeight = Math.max(previousRect.height, nextRect.height);
		if (!lineHeight) return true;
		if (Math.abs(nextRect.top - previousRect.top) > lineHeight / 2) return true;
		return nextRect.left - previousRect.right > lineHeight * 0.12;
	};

	// HTML text-quote anchors: each inline highlight records its matched text
	// plus ~80 chars of surrounding context so a later restore can disambiguate
	// repeated text and recover the span when the page text has drifted.
	// Mirrors the PDF anchor machinery in pdf-viewer.ts (same context length,
	// same compact-space scoring, same "context" recovery fallback name) so both
	// surfaces re-find annotations the same way.
	const HTML_ANCHOR_CONTEXT_LENGTH = 80;
	// A 1-2 char boundary coincidence is meaningless; require a real run of
	// agreeing context before trusting it over the stored occurrence.
	const HTML_ANCHOR_MIN_CONTEXT_SCORE = 6;
	// Context-anchored recovery of drifted text needs enough context on both
	// sides to make the recovered span trustworthy.
	const HTML_ANCHOR_MIN_RECOVERY_CONTEXT = 6;

	const collectAnchorMatchIndices = (haystack, needle) => {
		const indices = [];
		if (!needle) return indices;
		let from = 0;
		for (;;) {
			const index = haystack.indexOf(needle, from);
			if (index === -1) break;
			indices.push(index);
			from = index + Math.max(needle.length, 1);
		}
		return indices;
	};

	const anchorCommonSuffixLength = (a, b) => {
		let i = a.length - 1;
		let j = b.length - 1;
		let count = 0;
		while (i >= 0 && j >= 0 && a[i] === b[j]) {
			i -= 1;
			j -= 1;
			count += 1;
		}
		return count;
	};

	const anchorCommonPrefixLength = (a, b) => {
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
		return i;
	};

	// How well the text around a candidate match position agrees with the
	// anchor's stored prefix/suffix. Compared in compact (alphanumeric) space so
	// punctuation and whitespace drift never sinks the score. Higher = better.
	const scoreAnchorContextAt = (haystack, startIndex, matchLength, compactPrefix, compactSuffix) => {
		let score = 0;
		if (compactPrefix) {
			const before = compactHighlightSearchText(haystack.slice(Math.max(0, startIndex - HTML_ANCHOR_CONTEXT_LENGTH), startIndex));
			score += anchorCommonSuffixLength(before, compactPrefix);
		}
		if (compactSuffix) {
			const after = compactHighlightSearchText(haystack.slice(startIndex + matchLength, startIndex + matchLength + HTML_ANCHOR_CONTEXT_LENGTH));
			score += anchorCommonPrefixLength(after, compactSuffix);
		}
		return score;
	};

	const extractHighlightAnchorContext = (text, startIndex, matchLength) => {
		const prefix = text.slice(Math.max(0, startIndex - HTML_ANCHOR_CONTEXT_LENGTH), startIndex).trim();
		const suffix = text.slice(startIndex + matchLength, startIndex + matchLength + HTML_ANCHOR_CONTEXT_LENGTH).trim();
		if (!prefix && !suffix) return null;
		const context = {};
		if (prefix) context.prefix = prefix;
		if (suffix) context.suffix = suffix;
		return context;
	};

	const parseHtmlHighlightAnchor = (anchor) => {
		if (!anchor || typeof anchor !== "object") return null;
		if (anchor.surface && anchor.surface !== "html") return null;
		const quote = anchor.textQuote && typeof anchor.textQuote === "object" ? anchor.textQuote : anchor;
		const exact = normalizeText(String(quote.exact || ""));
		const prefix = normalizeText(String(quote.prefix || ""));
		const suffix = normalizeText(String(quote.suffix || ""));
		if (!prefix && !suffix) return null;
		return {
			exact,
			prefix,
			suffix,
			compactPrefix: compactHighlightSearchText(prefix),
			compactSuffix: compactHighlightSearchText(suffix),
			occurrence: Math.max(1, Number(anchor.occurrence || 1) || 1),
		};
	};

	const readHighlightAnchorAttribute = (element) => {
		try {
			const parsed = JSON.parse(element.getAttribute("data-onhand-anchor") || "null");
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	};

	const applyHighlightAnchorAttributes = (element, matchedText, options = {}) => {
		if (!options.anchorContext) return;
		const exact = normalizeText(matchedText).slice(0, 500);
		if (!exact) return;
		const textQuote = { exact };
		if (options.anchorContext.prefix) textQuote.prefix = String(options.anchorContext.prefix).slice(0, 200);
		if (options.anchorContext.suffix) textQuote.suffix = String(options.anchorContext.suffix).slice(0, 200);
		element.setAttribute("data-onhand-matched-text", exact);
		element.setAttribute(
			"data-onhand-anchor",
			JSON.stringify({
				surface: "html",
				textQuote,
				occurrence: Math.max(1, Number(options.anchorOccurrence || 1) || 1),
			}),
		);
	};

	// The ordered exact-match projections highlightText scans. Shared between
	// the legacy Nth-occurrence scan and the anchored (context-scored) pass so
	// both see identical match surfaces.
	const buildExactHighlightModes = (mappedText, queries) => [
		{
			text: mappedText.lowerText,
			positions: mappedText.positions,
			query: queries.normalizedQuery,
			fallback: null,
		},
		{
			text: mappedText.searchText,
			positions: mappedText.searchPositions,
			query: queries.searchQuery,
			fallback: "normalized-text",
		},
		...(queries.citationStrippedQuery && queries.citationStrippedQuery !== queries.searchQuery
			? [
					{
						text: mappedText.searchText,
						positions: mappedText.searchPositions,
						query: queries.citationStrippedQuery,
						fallback: "citation-stripped-text",
					},
				]
			: []),
		...(queries.useCompactQuery
			? [
					{
						text: mappedText.compactText,
						positions: mappedText.compactPositions,
						query: queries.compactQuery,
						fallback: queries.compactFallback,
					},
				]
			: []),
		...(queries.useCompactQuery && queries.citationStrippedCompactQuery && queries.citationStrippedCompactQuery !== queries.compactQuery
			? [
					{
						text: mappedText.compactText,
						positions: mappedText.compactPositions,
						query: queries.citationStrippedCompactQuery,
						fallback: "citation-stripped-compact-text",
					},
				]
			: []),
	];

	const buildNormalizedTextMap = (textNodes, options = {}) => {
		const positions = [];
		let text = "";
		let pendingSpace = null;
		let hasContent = false;
		let previousNode = null;

		for (const node of textNodes) {
			const value = String(node.nodeValue || "");
			if (options.pdfNodeBoundaries && hasContent && !pendingSpace && pdfTextNodeBoundaryNeedsSpace(previousNode, node)) {
				pendingSpace = { node, offset: 0, endOffset: 0 };
			}
			previousNode = node;
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

	// A range that crosses block boundaries (e.g. a forum comment's header row
	// plus its body) must not get an inline span wrap: the span's inline box
	// fragments around the block children and its empty painted fragments show
	// up as thin highlight slivers flanking the content.
	const rangeIncludesBlockStructure = (range) => {
		try {
			return Boolean(
				range
					.cloneContents()
					// No <br> here: a range spanning a soft line break inside one
					// paragraph is still inline content and wraps cleanly; promoting
					// it would wash the whole container over a two-line phrase.
					?.querySelector?.("div, p, table, tbody, tr, td, th, section, article, blockquote, pre, h1, h2, h3, h4, h5, h6"),
			);
		} catch {
			return false;
		}
	};

	const findBlockRangeHighlightElement = (range) => {
		if (!rangeIncludesBlockStructure(range)) return null;
		const common =
			range.commonAncestorContainer instanceof Element
				? range.commonAncestorContainer
				: range.commonAncestorContainer?.parentElement;
		let container = common;
		while (container && container !== document.body) {
			const display = window.getComputedStyle(container).display;
			if (display !== "inline" && display !== "inline-block" && display !== "contents") break;
			container = container.parentElement;
		}
		if (!(container instanceof Element) || container === document.body || !isVisible(container)) return null;
		// A shared container much larger than the match means the range straddles
		// unrelated siblings; keep the old behavior rather than washing a huge
		// region gold.
		const containerTextLength = getElementText(container).length;
		const rangeTextLength = String(range.toString() || "").length;
		if (containerTextLength > Math.max(1600, rangeTextLength * 4)) return null;
		return container;
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

		const findMathHighlightTargetForElement = (element) => {
			if (!(element instanceof Element)) return null;
			const mathElement = element.matches?.(MATH_CONTAINER_SELECTOR) ? element : element.closest?.(MATH_CONTAINER_SELECTOR);
			if (!(mathElement instanceof Element) || !isVisible(mathElement)) return null;
			const displayTarget = mathElement.closest?.(DISPLAY_MATH_HIGHLIGHT_TARGET_SELECTOR);
			const target = displayTarget instanceof Element ? displayTarget : mathElement;
			if (target.closest?.("[data-onhand-highlight-kind]")) return null;
			return isVisible(target) ? target : mathElement;
		};

		const findMathHighlightElementForRange = (range, rawQuery) => {
			const common =
				range.commonAncestorContainer instanceof Element
					? range.commonAncestorContainer
					: range.commonAncestorContainer?.parentElement;
			const candidates = [];
			const consider = (element) => {
				const target = findMathHighlightTargetForElement(element);
				if (!target || candidates.includes(target)) return;
				try {
					if (range.intersectsNode(target)) candidates.push(target);
				} catch {
					candidates.push(target);
				}
			};
			const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer?.parentElement;
			const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer?.parentElement;
			consider(startElement);
			consider(endElement);
			if (common instanceof Element) {
				if (common.matches?.(MATH_CONTAINER_SELECTOR)) consider(common);
				for (const element of Array.from(common.querySelectorAll?.(MATH_CONTAINER_SELECTOR) || [])) {
					try {
						if (range.intersectsNode(element)) consider(element);
					} catch {
						consider(element);
					}
				}
			}
			if (!candidates.length) return null;
			if (!isMathLikeHighlightQuery(rawQuery)) {
				const sharedListItem = getSharedListItemForRange(range);
				if (sharedListItem && isVisible(sharedListItem)) return sharedListItem;
				const container = common?.closest?.(ANNOTATION_CONTAINER_SELECTOR);
				if (container instanceof Element && isVisible(container)) return container;
			}
			return candidates
				.map((element) => ({ element, rect: element.getBoundingClientRect() }))
				.sort((left, right) => {
					const leftArea = Math.max(0, left.rect.width) * Math.max(0, left.rect.height);
					const rightArea = Math.max(0, right.rect.width) * Math.max(0, right.rect.height);
					return rightArea - leftArea;
				})[0]?.element || candidates[0];
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
			anchor: readHighlightAnchorAttribute(annotationElement) || undefined,
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
			// Wall-clock deadline, not just an attempt cap: on a page that never
			// converges (unrendered tab with zero viewport, oscillating scroll
			// containers), six throttled waits alone can exceed the whole 6s
			// annotation command budget. The scroll correction has been applied by
			// then; further settling is cosmetic.
			const deadline = Date.now() + 1500;
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
				if (Date.now() >= deadline) return;
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

	const removeAnnotations = (annotationIds) => {
		const ids = Array.from(
			new Set(
				(Array.isArray(annotationIds) ? annotationIds : [annotationIds])
					.map((id) => String(id || "").trim())
					.filter(Boolean),
			),
		);
		let removedCount = 0;
		for (const annotationId of ids) {
			let removedThis = false;
			for (const element of Array.from(document.querySelectorAll(annotationSelector(annotationId)))) {
				if (!(element instanceof Element)) continue;
				const kind = element.getAttribute("data-onhand-highlight-kind");
				if (kind === "pdf") {
					removedThis = removePdfOverlayAnnotation(element) || removedThis;
					continue;
				}
				if (kind === "block") {
					element.removeAttribute("data-onhand-highlight-kind");
					element.removeAttribute("data-onhand-annotation-id");
					element.removeAttribute("data-onhand-theme");
					removedThis = true;
					continue;
				}
				if (kind === "inline") {
					const parent = element.parentNode;
					if (!parent) continue;
					while (element.firstChild) parent.insertBefore(element.firstChild, element);
					parent.removeChild(element);
					parent.normalize?.();
					removedThis = true;
				}
			}
			if (removeNotesForAnnotation(annotationId) > 0) removedThis = true;
			getPdfAnnotationRegistry().delete(annotationId);
			if (removedThis) removedCount += 1;
		}
		if (!removedCount) throw new Error(`No annotation found with id: ${ids.join(", ") || "(blank)"}`);
		return { removedCount, requestedCount: ids.length };
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
			const mathElement = findMathHighlightElementForRange(range, rawQuery);
			if (mathElement) {
				return await highlightBlockElement(mathElement, rawQuery, {
					scrollIntoView: options.scrollIntoView,
					approximate: options.approximate,
					fallback: options.fallback || "math-range",
				});
			}
			const structuredElement = findStructuredRangeHighlightElement(range);
			if (structuredElement) {
				return await highlightBlockElement(structuredElement, rawQuery, {
					scrollIntoView: options.scrollIntoView,
					approximate: options.approximate,
				fallback: options.fallback,
			});
		}
		const blockRangeElement = findBlockRangeHighlightElement(range);
		if (blockRangeElement) {
			// A second block-crossing match in the same container must reuse the
			// existing annotation: re-promoting would overwrite the container's
			// annotation id and orphan any note attached to the first one.
			const existingBlockAnnotationId =
				blockRangeElement.getAttribute("data-onhand-highlight-kind") === "block"
					? blockRangeElement.getAttribute("data-onhand-annotation-id")
					: null;
			if (existingBlockAnnotationId) {
				if (options.scrollIntoView !== false) {
					blockRangeElement.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
				}
				await waitForLayout();
				return {
					annotationId: existingBlockAnnotationId,
					kind: "block",
					matchedText: getElementText(blockRangeElement).slice(0, 500) || normalizeText(rawQuery),
					container: summarizeElement(findAnnotationContainer(blockRangeElement)),
					rect: rectToObject(blockRangeElement.getBoundingClientRect()),
					scrollY: window.scrollY,
					approximate: Boolean(options.approximate),
					reusedExisting: true,
					fallback: options.fallback || "block-range",
				};
			}
			return await highlightBlockElement(blockRangeElement, rawQuery, {
				scrollIntoView: options.scrollIntoView,
				approximate: options.approximate,
				fallback: options.fallback || "block-range",
			});
		}
		const annotationId = nextAnnotationId();
		const highlight = wrapRangeInHighlight(range, annotationId);
		const matchedText = getElementText(highlight).slice(0, 500) || normalizeText(options.fallbackText || rawQuery);
		applyHighlightAnchorAttributes(highlight, matchedText, options);
		if (options.scrollIntoView !== false) {
			highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
		}
		await waitForLayout();
		return {
			annotationId,
			kind: "inline",
			matchedText,
			container: summarizeElement(findAnnotationContainer(highlight)),
			rect: rectToObject(highlight.getBoundingClientRect()),
			scrollY: window.scrollY,
			approximate: Boolean(options.approximate),
			fallback: options.fallback || undefined,
			anchor: readHighlightAnchorAttribute(highlight) || undefined,
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

	const getMathSourceTextForImage = (image) => {
		// Some pages render math as SVG/PNG images that carry their TeX or plain-math
		// source in the alt text while exposing no highlightable text nodes.
		if (!(image instanceof HTMLImageElement)) return "";
		const alt = normalizeText(image.getAttribute("alt") || "");
		if (!alt) return "";
		return /\\[a-zA-Z]+|[=≤≥≠∈∑∏∫√^_{}|]|\([^)]*\)/.test(alt) ? alt : "";
	};

	const findMathImageHighlightTarget = (image) => {
		// Prefer the dedicated math wrapper (often holding hidden MathML plus the visible
		// image) over the bare <img>, but stop at prose containers or shared wrappers.
		let target = image;
		for (let current = image.parentElement, depth = 0; current instanceof Element && depth < 4; current = current.parentElement, depth += 1) {
			if (current.matches(ANNOTATION_CONTAINER_SELECTOR)) break;
			if (getElementText(current)) break;
			if (current.querySelectorAll("img").length > 1) break;
			target = current;
		}
		return target;
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
			if (isInsideExcludedAnnotationAncestor(target)) return;
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
		for (const image of Array.from(document.querySelectorAll("img[alt]"))) {
			const sourceText = getMathSourceTextForImage(image);
			if (!sourceText) continue;
			consider(findMathImageHighlightTarget(image), sourceText, 1100);
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
			if (isInsideExcludedAnnotationAncestor(element)) continue;
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
		// Readable extractions keep bracketed footnote markers ("[15]", "[note 2]")
		// while the page text map skips them, so tolerate copied text that includes
		// the markers by also matching a marker-stripped variant of the query.
		const citationStrippedRaw = rawQuery.replace(/\[\s*(?:\d{1,3}|[a-z]|note\s+\d{1,3}|citation needed|edit)\s*\]/gi, " ");
		const citationStrippedQuery = citationStrippedRaw === rawQuery ? "" : normalizeHighlightSearchText(citationStrippedRaw);
		const citationStrippedCompactQuery = citationStrippedRaw === rawQuery ? "" : compactHighlightSearchText(citationStrippedRaw);

		const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
		const clearExisting = options.clearExisting === true;
		const scrollIntoView = options.scrollIntoView !== false;
		const exactOnly = Boolean(options.exactOnly || options.allowApproximate === false);
		const htmlAnchor = parseHtmlHighlightAnchor(options.anchor);
		const highlightQueries = {
			normalizedQuery,
			searchQuery,
			compactQuery,
			useCompactQuery,
			compactFallback,
			citationStrippedQuery,
			citationStrippedCompactQuery,
		};
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

		// Anchored pass: with a stored text-quote anchor, score every exact
		// occurrence against its prefix/suffix context and take the best-agreeing
		// one — this is what lets restore survive repeated text and page edits.
		// Falls through to the legacy Nth-occurrence scan when the context is
		// absent or matches nowhere convincingly.
		if (htmlAnchor && (htmlAnchor.compactPrefix || htmlAnchor.compactSuffix)) {
			const anchoredCandidates = [];
			for (const container of collectHighlightContainers(normalizedQuery, rawQuery)) {
				const textNodes = collectHighlightTextNodes(container);
				if (!textNodes.length) continue;
				const mappedText = buildNormalizedTextMap(textNodes);
				for (const mode of buildExactHighlightModes(mappedText, highlightQueries)) {
					if (!mode.query || !mode.text.includes(mode.query)) continue;
					let containerBest = null;
					for (const foundAt of collectAnchorMatchIndices(mode.text, mode.query)) {
						const score = scoreAnchorContextAt(mode.text, foundAt, mode.query.length, htmlAnchor.compactPrefix, htmlAnchor.compactSuffix);
						if (score < HTML_ANCHOR_MIN_CONTEXT_SCORE) continue;
						if (!containerBest || score > containerBest.score) containerBest = { mode, foundAt, score };
					}
					if (containerBest) {
						// Nested containers surface the same DOM position twice;
						// dedupe so occurrence tie-breaking below stays honest.
						const start = containerBest.mode.positions[containerBest.foundAt];
						const duplicate = anchoredCandidates.some((candidate) => {
							const existing = candidate.mode.positions[candidate.foundAt];
							return existing && start && existing.node === start.node && existing.offset === start.offset;
						});
						if (!duplicate) anchoredCandidates.push(containerBest);
						break;
					}
				}
			}
			if (anchoredCandidates.length) {
				const bestScore = Math.max(...anchoredCandidates.map((candidate) => candidate.score));
				// Repeated rows can share identical surroundings; among the tied
				// best, honor the stored occurrence so the right copy still wins.
				const tied = anchoredCandidates.filter((candidate) => candidate.score === bestScore);
				const chosen = tied[Math.min(htmlAnchor.occurrence, tied.length) - 1];
				const start = chosen.mode.positions[chosen.foundAt];
				const end = chosen.mode.positions[chosen.foundAt + chosen.mode.query.length - 1];
				if (start && end) {
					const range = document.createRange();
					range.setStart(start.node, start.offset);
					range.setEnd(end.node, getRangeEndOffset(end));
					return await highlightRange(range, rawQuery, {
						scrollIntoView,
						approximate: Boolean(chosen.mode.fallback),
						fallback: chosen.mode.fallback,
						anchorContext: extractHighlightAnchorContext(chosen.mode.text, chosen.foundAt, chosen.mode.query.length),
						anchorOccurrence: occurrence,
					});
				}
			}
		}

		let matchIndex = 0;
		let bestApproximateMatch = null;
		for (const container of collectHighlightContainers(normalizedQuery, rawQuery)) {
			const textNodes = collectHighlightTextNodes(container);
			if (!textNodes.length) continue;
			const mappedText = buildNormalizedTextMap(textNodes);
			for (const mode of buildExactHighlightModes(mappedText, highlightQueries)) {
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
							anchorContext: extractHighlightAnchorContext(mode.text, foundAt, mode.query.length),
							anchorOccurrence: occurrence,
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
					anchorContext: extractHighlightAnchorContext(
						bestApproximateMatch.mappedText.text,
						bestApproximateMatch.startIndex,
						bestApproximateMatch.endIndex - bestApproximateMatch.startIndex,
					),
					anchorOccurrence: occurrence,
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

		// Context-anchored recovery: the saved text drifted, but the anchor's
		// surrounding context is stable. Highlight the span sitting between the
		// stored prefix and suffix — across every prefix occurrence, the gap
		// closest to the original match length, when plausible. Runs even under
		// exactOnly: it is a high-precision re-anchor, not a fuzzy match.
		if (
			htmlAnchor &&
			htmlAnchor.compactPrefix.length >= HTML_ANCHOR_MIN_RECOVERY_CONTEXT &&
			htmlAnchor.compactSuffix.length >= HTML_ANCHOR_MIN_RECOVERY_CONTEXT
		) {
			const referenceLength = Math.max(compactQuery.length, compactHighlightSearchText(htmlAnchor.exact).length);
			const maxSpan = Math.max(referenceLength * 2, referenceLength + 24, 16);
			let bestRecovery = null;
			for (const container of collectAnchorContextContainers(htmlAnchor.compactPrefix, htmlAnchor.compactSuffix)) {
				const textNodes = collectHighlightTextNodes(container);
				if (!textNodes.length) continue;
				const mappedText = buildNormalizedTextMap(textNodes);
				for (const prefixIndex of collectAnchorMatchIndices(mappedText.compactText, htmlAnchor.compactPrefix)) {
					const spanStart = prefixIndex + htmlAnchor.compactPrefix.length;
					const suffixIndex = mappedText.compactText.indexOf(htmlAnchor.compactSuffix, spanStart);
					if (suffixIndex <= spanStart || suffixIndex - spanStart > maxSpan) continue;
					const spanLength = suffixIndex - spanStart;
					if (!bestRecovery || Math.abs(spanLength - referenceLength) < Math.abs(bestRecovery.spanLength - referenceLength)) {
						bestRecovery = { mappedText, spanStart, suffixIndex, spanLength };
					}
				}
			}
			if (bestRecovery) {
				const start = bestRecovery.mappedText.compactPositions[bestRecovery.spanStart];
				const end = bestRecovery.mappedText.compactPositions[bestRecovery.suffixIndex - 1];
				if (start && end) {
					const range = document.createRange();
					range.setStart(start.node, start.offset);
					range.setEnd(end.node, getRangeEndOffset(end));
					return await highlightRange(range, rawQuery, {
						scrollIntoView,
						approximate: true,
						fallback: "context",
						fallbackText: htmlAnchor.exact || rawQuery,
						anchorContext: { prefix: htmlAnchor.prefix, suffix: htmlAnchor.suffix },
						anchorOccurrence: htmlAnchor.occurrence,
					});
				}
			}
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
					anchor: readHighlightAnchorAttribute(annotationElement),
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
		removeAnnotations,
		syncAnnotationTheme,
		pickElements,
	};
};

async function evaluateInTab(tabId, expression, options = {}) {
	const timeoutMs = clampNumber(options.timeoutMs, SCRIPT_EXECUTION_TIMEOUT_MS, { min: SCRIPT_EXECUTION_TIMEOUT_MS, max: 120000 });
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
				timeoutMs,
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
				timeoutMs,
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
		timeoutMs,
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

function pageToolkitExecutionTimeoutMs(methodName) {
	return ["highlightText", "showNote", "scrollToAnnotation"].includes(methodName) ? PAGE_TOOLKIT_ANNOTATION_TIMEOUT_MS : SCRIPT_EXECUTION_TIMEOUT_MS;
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

async function callOnhandPdfViewerFrameViaBridge(tabId, commandPayload, missingMessage, sourceUrl = "") {
	const tab = await chrome.tabs.get(tabId);
	const pdfUrl = sourceUrl ? String(sourceUrl).trim() : await resolveInlineOnhandPdfViewerSourceUrl(tabId, tab);
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

async function callOnhandPdfViewerFrameViaRuntimePort(tabId, commandPayload, missingMessage, sourceUrl = "") {
	const tab = await chrome.tabs.get(tabId);
	const pdfUrl = sourceUrl ? String(sourceUrl).trim() : await resolveInlineOnhandPdfViewerSourceUrl(tabId, tab);
	const record = onhandPdfViewerPortRecords.get(onhandPdfViewerPortKey(tabId, pdfUrl));
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

function frameOrContextLooksLikeOwnExtension(frame, context) {
	const ownExtensionRoot = chrome.runtime.getURL("");
	const values = [
		frame?.url,
		frame?.urlFragment,
		context?.origin,
		context?.name,
		context?.auxData?.name,
	]
		.filter(Boolean)
		.map(String);
	return values.some((value) => value.startsWith(ownExtensionRoot));
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

async function transferPdfSelectionToOnhandViewer(tabId, selection, pdfUrl = "") {
	const handoffSelection = normalizePdfSelectionForViewerHandoff(selection, pdfUrl);
	if (!handoffSelection) return null;
	const text = handoffSelection.text;
	try {
		const annotation = await executePageToolkitMethodViaOnhandPdfViewerFrame(tabId, "highlightText", [
			text,
			{
				pdfAnchor: handoffSelection.pdfAnchor,
				scrollIntoView: true,
				reuseExisting: true,
			},
		]);
		return {
			ok: true,
			source: handoffSelection.source,
			text,
			pageNumber: handoffSelection.pageNumber || handoffSelection.pdfAnchor?.pageNumber || null,
			pdfAnchor: annotation?.pdfAnchor || handoffSelection.pdfAnchor,
			annotation,
		};
	} catch (error) {
		return {
			ok: false,
			source: handoffSelection.source,
			text,
			pageNumber: handoffSelection.pageNumber || handoffSelection.pdfAnchor?.pageNumber || null,
			pdfAnchor: handoffSelection.pdfAnchor,
			error: error?.message || String(error),
		};
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

const GENERIC_WEB_FRAME_PAGE_TOOLKIT_METHODS = new Set([
	"highlightText",
	"showNote",
	"scrollToAnnotation",
	"removeAnnotations",
]);

function shouldTryGenericWebFramePageToolkit(methodName) {
	return GENERIC_WEB_FRAME_PAGE_TOOLKIT_METHODS.has(methodName);
}

function shouldAggregateGenericWebFramePageToolkit(methodName) {
	return methodName === "clearAnnotations" || methodName === "captureState";
}

function normalizePageToolkitPayloadText(payload) {
	const parts = [
		payload?.matchedText,
		payload?.text,
		payload?.reason,
		payload?.container?.text,
		payload?.container?.selector,
		payload?.container?.tag,
	]
		.filter(Boolean)
		.map(String);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function pageToolkitPayloadLooksLikeReaderSearchUi(payload, query = "") {
	const text = normalizePageToolkitPayloadText(payload).toLowerCase();
	if (!text) return false;
	const queryText = String(query || "").replace(/\s+/g, " ").trim().toLowerCase();
	const searchChromeSignals = [
		/\bsearch across book\b/,
		/\bchapters containing search results?\b/,
		/\bcontent\s*\(\d+\)\s*figures\s*\(\d+\)\s*workbook\s*\(\d+\)/,
		/\bfigures\s*\(\d+\)\s*workbook\s*\(\d+\)/,
		/\b\d+\s+results?\b/,
	];
	const signalCount = searchChromeSignals.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
	const hasResultCount = /(?:^|[^0-9])\d{1,6}\s*results?\b/.test(text);
	const hasEllipsizedSnippets = /(?:\.\.\.|…)/.test(text);
	const hasRepeatedPageNumbers = (text.match(/\b\d{2,5}\b/g) || []).length >= 2;
	const looksLikeSingleSearchSnippet = hasEllipsizedSnippets && /(?:^|[^0-9])(?:page\s*)?\d{2,5}(?:\s|$)/i.test(text) && text.length <= 900;
	const selectorText = String(payload?.container?.selector || "").toLowerCase();
	if (signalCount >= 2) return true;
	if (hasResultCount && /\b(content|figures|workbook|search|chapter|page)\b/.test(text)) return true;
	if (hasResultCount && hasEllipsizedSnippets && hasRepeatedPageNumbers) return true;
	if (hasResultCount && /\bul\b|\bli(?:[.#:]|$)/.test(selectorText) && text.length > Math.max(160, queryText.length * 2)) return true;
	if (looksLikeSingleSearchSnippet && /\bul\b|\bli(?:[.#:]|$)|button/.test(selectorText)) return true;
	if (queryText && hasResultCount && text.includes(queryText) && text.length > Math.max(180, queryText.length * 3)) return true;
	return false;
}

function pageToolkitFramePayloadLooksLikeReaderSearchUi(framePayload, query = "") {
	return pageToolkitPayloadLooksLikeReaderSearchUi(framePayload?.value, query);
}

function shouldPreferTextbookFramePageToolkit(tab, methodName, payload, args = []) {
	return methodName === "highlightText" && isLikelyOnlineTextbookReaderTab(tab) && pageToolkitPayloadLooksLikeReaderSearchUi(payload, args?.[0]);
}

function frameOrContextLooksLikeGenericWebFrame(frame, context) {
	if (context?.auxData && context.auxData.isDefault === false) return false;
	const values = [
		frame?.url,
		frame?.urlFragment,
		context?.origin,
		context?.name,
		context?.auxData?.name,
	]
		.filter(Boolean)
		.map(String);
	return values.some((value) => /^(https?|file):/i.test(value));
}

function annotatePageToolkitFrameValue(value, framePayload, method) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const frameId = framePayload?.frameId;
	const frameUrl = framePayload?.frameUrl || framePayload?.url || "";
	const frameTitle = framePayload?.frameTitle || framePayload?.title || "";
	return {
		...value,
		pageToolkitFrameFallback: {
			attempted: true,
			ok: true,
			method,
			...(typeof frameId === "number" ? { frameId } : {}),
			...(frameUrl ? { frameUrl } : {}),
			...(frameTitle ? { frameTitle } : {}),
		},
	};
}

function mergeClearAnnotationResults(primary, secondary) {
	const first = primary && typeof primary === "object" ? primary : {};
	const second = secondary && typeof secondary === "object" ? secondary : {};
	const numericKeys = ["clearedNotes", "clearedInline", "clearedBlock", "clearedPdf", "clearedPdfSegments"];
	const merged = { ...first };
	for (const key of numericKeys) {
		merged[key] = Number(first[key] || 0) + Number(second[key] || 0);
	}
	merged.clearedTotal = numericKeys.reduce((total, key) => total + Number(merged[key] || 0), 0);
	if (second.pageToolkitFrameFallback) {
		merged.pageToolkitFrameFallback = second.pageToolkitFrameFallback;
	}
	return merged;
}

function aggregateClearAnnotationFrameValues(payloads, method = "chrome-scripting-all-frames") {
	const numericKeys = ["clearedNotes", "clearedInline", "clearedBlock", "clearedPdf", "clearedPdfSegments"];
	const totals = Object.fromEntries(numericKeys.map((key) => [key, 0]));
	const frames = [];
	for (const payload of payloads) {
		const value = payload?.value;
		if (!value || typeof value !== "object") continue;
		const clearedTotal = Number(value.clearedTotal || 0);
		for (const key of numericKeys) totals[key] += Number(value[key] || 0);
		if (clearedTotal > 0) {
			frames.push({
				frameId: payload.frameId,
				frameUrl: payload.frameUrl || payload.url || "",
				frameTitle: payload.frameTitle || payload.title || "",
				clearedTotal,
			});
		}
	}
	return {
		...totals,
		clearedTotal: numericKeys.reduce((total, key) => total + Number(totals[key] || 0), 0),
		pageToolkitFrameFallback: {
			attempted: true,
			ok: true,
			method,
			frameCount: payloads.length,
			clearedFrameCount: frames.length,
			frames: frames.slice(0, 10),
		},
	};
}

function pickBestPageToolkitFramePayload(payloads, methodName, args = []) {
	const successful = payloads.filter((payload) => payload?.ok);
	if (!successful.length) return null;
	if (methodName === "captureState") {
		return successful
			.slice()
			.sort((left, right) => Number(right.value?.annotationCount || 0) - Number(left.value?.annotationCount || 0))[0];
	}
	if (methodName === "highlightText") {
		const query = args?.[0];
		const nonSearchUiPayload = successful.find((payload) => !pageToolkitFramePayloadLooksLikeReaderSearchUi(payload, query));
		if (nonSearchUiPayload) return nonSearchUiPayload;
	}
	if (methodName === "getVisibleText") {
		// On embedded-content shells the top frame usually succeeds first with
		// chrome-thin text; the body frame's longer text is the useful payload.
		return successful
			.slice()
			.sort((left, right) => normalizePageToolkitPayloadText(right.value).length - normalizePageToolkitPayloadText(left.value).length)[0];
	}
	return successful[0];
}

// Installs the generated page-toolkit factory file into every accessible
// frame's isolated world. Frames whose CSP bans unsafe-eval (Claude artifact
// frames, sandboxed embeds) reject the string-eval injection path, but
// chrome.scripting `files` injection is not subject to page CSP.
async function ensurePageToolkitFactoryFileInFrames(tabId) {
	try {
		await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-toolkit-content.js"] });
	} catch (error) {
		if (!isRestrictedScriptingError(error)) throw error;
		const frameIds = await getInjectableFrameIds(tabId);
		for (const frameId of frameIds.length ? frameIds : [0]) {
			try {
				await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["page-toolkit-content.js"] });
			} catch (frameError) {
				if (!isRestrictedScriptingError(frameError)) throw frameError;
			}
		}
	}
}

async function executePageToolkitMethodViaScriptingFrames(tabId, methodName, args = [], toolkitOptions = {}) {
	const frameInfos = await getAllFramesForTab(tabId).catch(() => []);
	const frameUrlById = new Map(frameInfos.map((frame) => [frame.frameId, frame.url || ""]));
	// Dominance must be part of frame SELECTION for visible text: filtering
	// only the picked payload afterwards would discard a dominant body frame
	// whenever a non-dominant embed happens to have longer text.
	const visibleTextFrameAreas = methodName === "getVisibleText" ? await getFrameViewportAreasForTab(tabId) : null;
	await ensurePageToolkitFactoryFileInFrames(tabId).catch(() => {});
	const results = await executeScriptInAllFrames(
		tabId,
		async (toolkitSource, targetMethodName, targetArgs, targetToolkitOptions) => {
			try {
				const toolkitFactory =
					typeof globalThis.__onhandPageToolkitFactory === "function" ? globalThis.__onhandPageToolkitFactory : (0, eval)(`(${toolkitSource})`);
				const toolkit = toolkitFactory(targetToolkitOptions);
				return {
					ok: true,
					value: await toolkit[targetMethodName](...(Array.isArray(targetArgs) ? targetArgs : [])),
					url: location.href,
					title: document.title,
				};
			} catch (error) {
				return {
					ok: false,
					error: error?.message || String(error),
					url: location.href,
					title: document.title,
				};
			}
		},
		[createPageToolkit.toString(), methodName, args, toolkitOptions],
	);
	const payloads = (Array.isArray(results) ? results : [])
		.map((entry) => {
			const result = entry?.result || {};
			return {
				...result,
				frameId: entry?.frameId,
				frameUrl: frameUrlById.get(entry?.frameId) || result.url || "",
				frameTitle: result.title || "",
			};
		})
		.filter((payload) => payload && typeof payload === "object")
		.filter(
			(payload) =>
				!visibleTextFrameAreas || payload.frameId === 0 || frameAreaIsDominant(visibleTextFrameAreas, payload.frameId),
		);
	if (methodName === "clearAnnotations") return aggregateClearAnnotationFrameValues(payloads.filter((payload) => payload.ok));
	const bestPayload = pickBestPageToolkitFramePayload(payloads, methodName, args);
	if (bestPayload) {
		return annotatePageToolkitFrameValue(bestPayload.value, bestPayload, "chrome-scripting-all-frames");
	}
	const errors = payloads
		.map((payload) => payload.error)
		.filter(Boolean)
		.filter((message, index, all) => all.indexOf(message) === index);
	throw new Error(errors.slice(0, 3).join("; ") || `No page toolkit frame could run ${methodName}`);
}

async function executePageToolkitMethodViaGenericWebFrame(tabId, methodName, args = [], toolkitOptions = {}) {
	const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
	const serializedOptions = JSON.stringify(toolkitOptions);
	const expression = `(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`;
	const value = await evaluateInMatchingFrame(
		tabId,
		frameOrContextLooksLikeGenericWebFrame,
		expression,
		`No readable web frame could run page toolkit method: ${methodName}`,
	);
	return annotatePageToolkitFrameValue(value, { frameUrl: value?.url || "", frameTitle: value?.title || "" }, "debugger-frame");
}

async function executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args = [], toolkitOptions = {}) {
	const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
	const serializedOptions = JSON.stringify(toolkitOptions);
	const expression = `(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`;
	return await withDebugger(tabId, async ({ send }) => {
		await send("Page.enable");
		await send("Runtime.enable");
		const frameTree = await send("Page.getFrameTree");
		const frames = collectDebuggerFrameTree(frameTree?.frameTree).filter((frame) => frameOrContextLooksLikeGenericWebFrame(frame, null));
		if (!frames.length) throw new Error(`No readable web frames found for ${methodName}`);
		const payloads = [];
		const errors = [];
		for (const frame of frames) {
			try {
				const world = await send("Page.createIsolatedWorld", {
					frameId: frame.id,
					worldName: "onhand-frame-aggregate",
					grantUniversalAccess: true,
				});
				if (!world?.executionContextId) throw new Error(`Could not create web frame execution context for ${methodName}`);
				const value = await evaluateDebuggerExpression(
					send,
					expression,
					world.executionContextId,
					`Could not run page toolkit method in web frame: ${methodName}`,
				);
				payloads.push({
					ok: true,
					value,
					frameId: frame.id,
					frameUrl: value?.url || frame.url || "",
					frameTitle: value?.title || frame.name || "",
				});
			} catch (error) {
				errors.push(error);
			}
		}
		if (methodName === "clearAnnotations") return aggregateClearAnnotationFrameValues(payloads, "debugger-frame");
		const bestPayload = pickBestPageToolkitFramePayload(payloads, methodName, args);
		if (bestPayload) return annotatePageToolkitFrameValue(bestPayload.value, bestPayload, "debugger-frame");
		throw errors[0] || new Error(`No readable web frame could run page toolkit method: ${methodName}`);
	});
}

async function runPageToolkitMethod(tabId, methodName, ...args) {
	const tab = await chrome.tabs.get(tabId);
	if (!canRunPageToolkitOnTab(tab)) {
		throw new Error(`Onhand page tools only run on web or local-file tabs, not ${describeTabForError(tab)}`);
	}
	const toolkitOptions = await getPageToolkitOptions(tab);
	const pageToolkitTimeoutMs = pageToolkitExecutionTimeoutMs(methodName);
	const pageToolkitFrameTimeoutMs = Math.max(pageToolkitTimeoutMs, PDF_READER_FRAME_EXECUTION_TIMEOUT_MS);
	try {
		const payload = await withOperationTimeout(
			executePageToolkitMethodViaScripting(tabId, methodName, args, toolkitOptions),
			pageToolkitTimeoutMs,
			`Page toolkit scripting timed out: ${methodName}`,
		);
		if (shouldPreferTextbookFramePageToolkit(tab, methodName, payload, args)) {
			let scriptingFramePayload = null;
			try {
				scriptingFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit textbook-frame scripting timed out: ${methodName}`,
				);
				if (!pageToolkitPayloadLooksLikeReaderSearchUi(scriptingFramePayload, args?.[0])) return scriptingFramePayload;
			} catch (frameError) {
				log("Page toolkit textbook frame scripting fallback failed", methodName, tab?.url, frameError?.message || String(frameError));
			}
			try {
				const debuggerFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
					`Page toolkit textbook-frame debugger timed out: ${methodName}`,
				);
				if (!pageToolkitPayloadLooksLikeReaderSearchUi(debuggerFramePayload, args?.[0])) return debuggerFramePayload;
			} catch (frameError) {
				log("Page toolkit textbook debugger-frame fallback failed", methodName, tab?.url, frameError?.message || String(frameError));
			}
			if (scriptingFramePayload) return scriptingFramePayload;
		}
		if (shouldTryOnhandPdfViewerFrameForTab(tab, payload)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaOnhandPdfViewerFrame(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
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
					pageToolkitFrameTimeoutMs,
					`Google Scholar PDF Reader frame toolkit timed out: ${methodName}`,
				);
			} catch (frameError) {
				if (payload && typeof payload === "object") {
					return annotateGoogleScholarReaderFrameFallbackFailure(payload, frameError);
				}
			}
		}
		if (methodName === "clearAnnotations") {
			let clearedPayload = payload;
			let scriptingFrameError = null;
			try {
				const framePayload = await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit frame clear timed out: ${methodName}`,
				);
				const frameCount = Number(framePayload?.pageToolkitFrameFallback?.frameCount || 0);
				if (frameCount > 0 || Number(framePayload?.clearedTotal || 0) > 0) {
					clearedPayload = mergeClearAnnotationResults(clearedPayload, framePayload);
				}
			} catch (error) {
				scriptingFrameError = error;
			}
			try {
				const debuggerFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
					`Page toolkit debugger-frame clear timed out: ${methodName}`,
				);
				return mergeClearAnnotationResults(clearedPayload, debuggerFramePayload);
			} catch (debuggerFrameError) {
				if (clearedPayload !== payload) return clearedPayload;
				if (payload && typeof payload === "object") {
					return {
						...payload,
						pageToolkitFrameFallback: {
							attempted: true,
							ok: false,
							error: debuggerFrameError?.message || scriptingFrameError?.message || String(debuggerFrameError || scriptingFrameError || "Page toolkit frame clear failed"),
						},
					};
				}
			}
		}
		if (
			methodName === "getVisibleText" &&
			normalizePageToolkitPayloadText(payload).length < EMBEDDED_CONTENT_SHELL_TOP_TEXT_MAX_CHARS &&
			(await tabHasCrossOriginContentSubframe(tabId, tab?.url))
		) {
			// Embedded-content shell: the visible text lives in a cross-origin
			// body frame, not the chrome-thin top document. Only a DOMINANT
			// frame may replace the top text — an ad/widget embed on a short
			// page must not become "the page". The scripting executor is
			// eval-based and fails in frames whose CSP bans unsafe-eval, so
			// fall through to the debugger executor.
			const frameAreas = await getFrameViewportAreasForTab(tabId);
			const frameInfos = await getAllFramesForTab(tabId).catch(() => []);
			const framePayloadIsDominant = (framePayload) => {
				const fallbackInfo = framePayload?.pageToolkitFrameFallback || {};
				let frameId = typeof fallbackInfo.frameId === "number" ? fallbackInfo.frameId : null;
				if (frameId === null && fallbackInfo.frameUrl) {
					const match = frameInfos.find((frame) => frame.url === fallbackInfo.frameUrl);
					frameId = match ? match.frameId : null;
				}
				if (frameId === null) return false;
				return frameAreaIsDominant(frameAreas, frameId);
			};
			try {
				const framePayload = await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit frame visible-text timed out: ${methodName}`,
				);
				if (
					normalizePageToolkitPayloadText(framePayload).length > normalizePageToolkitPayloadText(payload).length + 200 &&
					framePayloadIsDominant(framePayload)
				) {
					return framePayload;
				}
			} catch {}
			try {
				const debuggerFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
					`Page toolkit debugger-frame visible-text timed out: ${methodName}`,
				);
				if (
					normalizePageToolkitPayloadText(debuggerFramePayload).length > normalizePageToolkitPayloadText(payload).length + 200 &&
					framePayloadIsDominant(debuggerFramePayload)
				) {
					return debuggerFramePayload;
				}
			} catch {}
		}
		if (methodName === "captureState" && Number(payload?.annotationCount || 0) === 0) {
			try {
				const framePayload = await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit frame capture timed out: ${methodName}`,
				);
				if (Number(framePayload?.annotationCount || 0) > Number(payload?.annotationCount || 0)) return framePayload;
			} catch {}
			try {
				const debuggerFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
					`Page toolkit debugger-frame capture timed out: ${methodName}`,
				);
				if (Number(debuggerFramePayload?.annotationCount || 0) > Number(payload?.annotationCount || 0)) return debuggerFramePayload;
			} catch {}
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
					pageToolkitFrameTimeoutMs,
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
					pageToolkitFrameTimeoutMs,
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
		if (shouldTryGenericWebFramePageToolkit(methodName)) {
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit web-frame scripting timed out: ${methodName}`,
				);
			} catch (scriptingFrameError) {
				try {
					return await withOperationTimeout(
						executePageToolkitMethodViaGenericWebFrame(tabId, methodName, args, toolkitOptions),
						pageToolkitTimeoutMs,
						`Page toolkit web-frame debugger timed out: ${methodName}`,
					);
				} catch (debuggerFrameError) {
					log(
						"Page toolkit generic frame fallback failed",
						methodName,
						tab?.url,
						scriptingFrameError?.message || String(scriptingFrameError),
						debuggerFrameError?.message || String(debuggerFrameError),
					);
				}
			}
		}
		if (shouldAggregateGenericWebFramePageToolkit(methodName)) {
			let scriptingFramePayload = null;
			let scriptingFrameError = null;
			try {
				scriptingFramePayload = await withOperationTimeout(
					executePageToolkitMethodViaScriptingFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitTimeoutMs,
					`Page toolkit web-frame scripting timed out: ${methodName}`,
				);
			} catch (error) {
				scriptingFrameError = error;
			}
			if (methodName === "clearAnnotations") {
				const frameCount = Number(scriptingFramePayload?.pageToolkitFrameFallback?.frameCount || 0);
				if (frameCount > 0 || Number(scriptingFramePayload?.clearedTotal || 0) > 0) {
					return scriptingFramePayload;
				}
			} else if (methodName === "captureState") {
				const frameCount = Number(scriptingFramePayload?.pageToolkitFrameFallback?.frameCount || 0);
				if (frameCount > 0 && Number(scriptingFramePayload?.annotationCount || 0) > 0) {
					return scriptingFramePayload;
				}
			}
			try {
				return await withOperationTimeout(
					executePageToolkitMethodViaGenericWebFrames(tabId, methodName, args, toolkitOptions),
					pageToolkitFrameTimeoutMs,
					`Page toolkit web-frame debugger timed out: ${methodName}`,
				);
			} catch (debuggerFrameError) {
				log(
					"Page toolkit aggregate frame fallback failed",
					methodName,
					tab?.url,
					scriptingFrameError?.message || String(scriptingFrameError),
					debuggerFrameError?.message || String(debuggerFrameError),
				);
			}
		}
		const serializedArgs = args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(", ");
		const serializedOptions = JSON.stringify(toolkitOptions);
		let payload;
		try {
			payload = await withOperationTimeout(
				evaluateInTab(
					tabId,
					`(async () => { const toolkit = (${createPageToolkit.toString()})(${serializedOptions}); return await toolkit[${JSON.stringify(methodName)}](${serializedArgs}); })()`,
					{ skipScripting: true, timeoutMs: pageToolkitTimeoutMs },
				),
				pageToolkitTimeoutMs,
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

async function waitForInlineOnhandPdfViewerReady(tabId, timeoutMs = 15000, pdfUrl = "") {
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
			const status = await callOnhandPdfViewerFrameViaRuntimePort(tabId, statusCommand, "No Onhand PDF viewer runtime port found", pdfUrl);
			if (status?.ready) return { ok: true, ...status };
			if (status?.error) {
				throw new Error(`Onhand PDF viewer failed to load the PDF: ${status.error}`);
			}
		} catch (runtimePortError) {
			lastError = runtimePortError;
		}
		try {
			const status = await callOnhandPdfViewerFrameViaBridge(tabId, statusCommand, "No Onhand PDF viewer frame context found", pdfUrl);
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

function pdfViewerReadyFailure(error) {
	return {
		ok: false,
		error: error?.message || String(error),
	};
}

async function safeWaitForInlineOnhandPdfViewerReady(tabId, timeoutMs = 15000, pdfUrl = "") {
	try {
		return await waitForInlineOnhandPdfViewerReady(tabId, timeoutMs, pdfUrl);
	} catch (error) {
		return pdfViewerReadyFailure(error);
	}
}

async function safeWaitForOnhandPdfViewerReady(tabId, timeoutMs = 15000) {
	try {
		return await waitForOnhandPdfViewerReady(tabId, timeoutMs);
	} catch (error) {
		return pdfViewerReadyFailure(error);
	}
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

// Distinguish destinations the browser refuses to show from real pages.
// Security interstitials (plain-HTTP warnings, TLS "connection is not
// private") render as unscriptable chrome-error documents; bot walls
// (Cloudflare "Just a moment...") are real pages with telltale titles. The
// agent must report these and move on — only the user may click through a
// security warning.
function classifyBlockedNavigation(tab, probeError) {
	const url = String(tab?.url || "");
	const title = String(tab?.title || "").trim();
	if (probeError) {
		const message = String(probeError?.message || probeError || "");
		if (/chrome-error:\/\/chromewebdata|showing error page/i.test(message)) {
			const insecure = /^http:\/\//i.test(url);
			return {
				kind: insecure ? "insecure-site-warning" : "browser-interstitial",
				detail: insecure
					? "The browser is showing a not-secure warning because this site uses plain HTTP. Only the user can click Continue to site; do not retry and do not try to bypass it. Name this blocked source in the answer and use an alternative."
					: "The browser is showing an error or security interstitial for this destination (invalid certificate, unreachable server, or similar). Only the user can click through a security warning; do not retry and do not try to bypass it. Name this blocked source in the answer and use an alternative.",
			};
		}
	}
	if (/^(just a moment|attention required|access denied|please verify you are (a )?human|checking your browser|verifying you are human)/i.test(title)) {
		return {
			kind: "bot-challenge",
			detail: "The destination is showing a bot-verification challenge instead of the page. Do not attempt to solve or bypass it; use a different source or tell the user to open it manually.",
		};
	}
	return null;
}

async function probeTabScriptable(tabId) {
	if (!tabId) return null;
	try {
		await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
		return null;
	} catch (error) {
		return error;
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
		const existingTab = await findExistingNavigationTab(args.url, windowId);
		if (existingTab?.id) {
			const tab =
				args.active !== false
					? await focusTab(existingTab.id)
					: waitForLoad && existingTab.status !== "complete"
						? await waitForTabComplete(existingTab.id, timeoutMs)
						: existingTab;
			return {
				tab,
				createdNewTab: false,
				reusedExistingTab: true,
			};
		}
		const createdTab = await chrome.tabs.create({
			url: args.url,
			active: args.active !== false,
			windowId,
		});
		const finalTab = waitForLoad ? await waitForTabComplete(createdTab.id, timeoutMs) : await chrome.tabs.get(createdTab.id);
		return {
			tab: finalTab,
			createdNewTab: true,
			reusedExistingTab: false,
		};
	}

	const targetTab = await resolveTargetTab(args);
	const updatedTab = await chrome.tabs.update(targetTab.id, {
		url: args.url,
		active: args.active === true ? true : undefined,
	});
	const finalTab = waitForLoad ? await waitForTabComplete(updatedTab.id, timeoutMs) : await chrome.tabs.get(updatedTab.id);
	return {
		tab: finalTab,
		createdNewTab: false,
		reusedExistingTab: false,
	};
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

function shouldDetachPdfViewerOpenFromSourceTab(args = {}) {
	// Only http(s) candidates detach: an explicit file: pdfUrl is trusted
	// solely against the file already open in the source tab, and explicit
	// tab targeting (tabId/titleContains/urlContains) means the model wants
	// that tab as the source.
	if (typeof args.tabId === "number") return false;
	if (args.newTab !== true) return false;
	if (String(args.titleContains || "").trim() || String(args.urlContains || "").trim()) return false;
	return Boolean(normalizePdfUrlCandidate(args.pdfUrl, "", { allowFile: false }));
}

async function openPdfInOnhandViewer(args = {}) {
	const sourceTab = await resolveTargetTab(args);
	const pdfUrl = resolvePdfSourceUrlForViewer(args, sourceTab);
	if (isFileUrl(pdfUrl) && !(await isAllowedFileSchemeAccess())) {
		// Actionable failure: without file access the viewer cannot read the bytes,
		// so tell the model/user exactly what to enable instead of failing opaquely.
		throw new Error(localFileAccessMessage(sourceTab));
	}
	if (isFileUrl(pdfUrl)) grantOnhandPdfViewerFileSource(pdfUrl);
	const diagnostics = createPdfViewerHandoffDiagnostics(args, sourceTab, pdfUrl);
	const sourceIsGoogleDocs = isGoogleDocsDocumentUrl(sourceTab.url);
	const shouldOpenViewerInNewTab = args.newTab === true || (sourceIsGoogleDocs && args.newTab !== false);
	let initialSelectionHandoff = normalizePdfSelectionForViewerHandoff(args.pdfSelection || args.selection, pdfUrl);
	let initialSelectionHandoffFailure = null;
	if (!initialSelectionHandoff && args.disableSelectionHandoff !== true) {
		const selectionStartedAt = Date.now();
		try {
			initialSelectionHandoff = await withOperationTimeout(
				getPdfSelectionForViewerHandoff(sourceTab, pdfUrl),
				PDF_SELECTION_HANDOFF_TIMEOUT_MS,
				"PDF selection handoff capture timed out.",
			);
			if (diagnostics) {
				diagnostics.selectionCapture = {
					ok: Boolean(initialSelectionHandoff),
					durationMs: Date.now() - selectionStartedAt,
					source: initialSelectionHandoff?.source || "",
					pageNumber: initialSelectionHandoff?.pageNumber || initialSelectionHandoff?.pdfAnchor?.pageNumber || null,
					textLength: String(initialSelectionHandoff?.text || "").length,
				};
			}
		} catch (error) {
			log("Could not capture PDF selection for viewer handoff", error?.message || String(error));
			initialSelectionHandoffFailure = {
				ok: false,
				source: "pdf-selection-handoff",
				error: error?.message || String(error),
			};
			if (diagnostics) {
				diagnostics.selectionCapture = {
					ok: false,
					durationMs: Date.now() - selectionStartedAt,
					error: error?.message || String(error),
				};
			}
		}
	}
	if (!initialSelectionHandoff && !initialSelectionHandoffFailure && args.disableSelectionHandoff !== true && isLikelyPdfResourceUrl(pdfUrl)) {
		initialSelectionHandoffFailure = {
			ok: false,
			source: "pdf-selection-handoff",
			error: "No selected PDF text could be captured before opening the Onhand viewer.",
		};
	}
	const getSelectionHandoffResult = async (tabId) => {
		if (initialSelectionHandoff) return await transferPdfSelectionToOnhandViewer(tabId, initialSelectionHandoff, pdfUrl);
		return initialSelectionHandoffFailure;
	};
	const getReuseSelectionHandoffResult = async (tabId) => {
		if (args.forceSelectionHandoff === true) return await getSelectionHandoffResult(tabId);
		return null;
	};
	const providedSelectionPageNumber = getPdfPageNumberFromSelectionPayload(args.pdfSelection || args.selection);
	const initialPageLocation = initialSelectionHandoff?.pageNumber
		? { pageNumber: initialSelectionHandoff.pageNumber, source: `${initialSelectionHandoff.source || "pdf-selection"}:selection` }
		: providedSelectionPageNumber
			? { pageNumber: providedSelectionPageNumber, source: "provided-selection-page" }
		: await inferInitialPdfViewerPageLocation(args, sourceTab, pdfUrl, diagnostics);
	const initialPageNumber = initialPageLocation?.pageNumber || null;
	const initialPageSource = initialPageLocation?.source || null;
	if (diagnostics) {
		diagnostics.selectedInitialPage = initialPageLocation
			? summarizePdfPageDetectionForDiagnostics(initialPageLocation)
			: null;
	}
	const buildExistingViewerReuseResult = async (existingStatus, existingPageNumber) => {
		const focusedTab = args.active === false ? sourceTab : await focusTab(sourceTab.id);
		const reuseTimeoutMs = clampNumber(args.timeoutMs, 15000, { min: 100, max: 120000 });
		const viewerReady =
			existingStatus.ready || args.waitForLoad === false
				? { ok: true, ...existingStatus }
				: await safeWaitForInlineOnhandPdfViewerReady(sourceTab.id, reuseTimeoutMs, pdfUrl);
		const selectionHandoff = await getReuseSelectionHandoffResult(focusedTab.id);
		return {
			tab: simplifyTab(focusedTab),
			sourceTab: simplifyTab(sourceTab),
			pdfUrl,
			viewerUrl: buildOnhandPdfViewerUrl(pdfUrl, existingPageNumber ? { pageNumber: existingPageNumber } : {}),
			initialPageNumber: existingPageNumber || null,
			initialPageSource: "existing-onhand-pdf-viewer",
			requestedInitialPageNumber: initialPageNumber || null,
			requestedInitialPageSource: initialPageSource,
			initialScrollRatio: null,
			selectionHandoff,
			viewerReady,
			alreadyOpen: true,
			opened: false,
			replacedCurrentTab: false,
			reusedExistingViewer: true,
			preservedSourceUrl: true,
			pageLocationDiagnostics: diagnostics,
		};
	};
	// Reuse a viewer that is already rendered for this PDF instead of
	// reinstalling: re-running the install rewrites the iframe src with a
	// freshly inferred page param, which reloads the viewer and yanks the
	// user away from where they were reading on every prompt. This also
	// applies when a later tool call asks for a new tab after an automatic
	// preflight already mounted the inline viewer on the current PDF tab.
	if (args.forceReload !== true && !sourceIsGoogleDocs && !isOnhandPdfViewerLikeUrl(sourceTab.url) && isHttpLikeUrl(pdfUrl)) {
		const existingStatus = await probeInlineOnhandPdfViewerStatus(sourceTab.id, pdfUrl);
		if (existingStatus) {
			const existingPageNumber = normalizePdfPageNumber(
				existingStatus.pageNumber ?? existingStatus.currentPageNumber ?? existingStatus.page,
			);
			if (initialPageNumber && existingPageNumber !== initialPageNumber) {
				log("Reusing inline Onhand PDF viewer without reload; requested page differs", {
					pdfUrl,
					existingPageNumber: existingPageNumber || null,
					initialPageNumber,
					initialPageSource,
				});
			}
			return await buildExistingViewerReuseResult(existingStatus, existingPageNumber);
			}
		}
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
	if (diagnostics) {
		diagnostics.viewerOptions = viewerOptions;
		diagnostics.viewerUrl = viewerUrl;
		diagnostics.initialScrollRatio = initialScrollRatio;
	}

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
		grantOnhandPdfViewerCredentialedSource(finalTab.id, pdfUrl);
		const inlineViewer = await installInlineOnhandPdfViewer(finalTab.id, pdfUrl, viewerOptions);
		const viewerReady = waitForLoad ? await safeWaitForInlineOnhandPdfViewerReady(finalTab.id, timeoutMs, pdfUrl) : null;
		const selectionHandoff = await getSelectionHandoffResult(finalTab.id);
		return {
			tab: simplifyTab(await chrome.tabs.get(finalTab.id)),
			sourceTab: sourceTabSnapshot,
			pdfUrl,
			viewerUrl,
			initialPageNumber,
			initialPageSource,
			initialScrollRatio,
			selectionHandoff,
				viewerReady,
				inlineViewer,
				alreadyOpen: sourceTab.url === pdfUrl,
				opened: true,
				replacedCurrentTab: args.newTab !== true && args.detachedNewTab !== true,
				preservedSourceUrl: true,
				pageLocationDiagnostics: diagnostics,
			};
		}

	if (args.forceReload !== true && isOnhandPdfViewerLikeUrl(sourceTab.url) && extractPdfSourceUrlFromViewerLikeUrl(sourceTab.url) === pdfUrl) {
		const focusedTab = args.active === false ? sourceTab : await focusTab(sourceTab.id);
		const viewerReady = waitForLoad && isOwnExtensionPdfViewerUrl(focusedTab.url) ? await safeWaitForOnhandPdfViewerReady(focusedTab.id, timeoutMs) : null;
		const selectionHandoff = await getReuseSelectionHandoffResult(focusedTab.id);
		return {
			tab: simplifyTab(focusedTab),
			sourceTab: sourceTabSnapshot,
			pdfUrl,
			viewerUrl,
			initialPageNumber,
			initialPageSource,
			initialScrollRatio,
			selectionHandoff,
			viewerReady,
			alreadyOpen: true,
			opened: false,
			replacedCurrentTab: false,
			pageLocationDiagnostics: diagnostics,
		};
	}

	let targetTab;
	if (shouldOpenViewerInNewTab) {
		targetTab = await chrome.tabs.create({
			url: isHttpsUrl(pdfUrl) ? "about:blank" : viewerUrl,
			active: args.active !== false,
			windowId: typeof sourceTab.windowId === "number" ? sourceTab.windowId : undefined,
		});
		if (isHttpsUrl(pdfUrl)) {
			grantOnhandPdfViewerCredentialedSource(targetTab.id, pdfUrl);
			targetTab = await chrome.tabs.update(targetTab.id, { url: viewerUrl });
		}
	} else {
		grantOnhandPdfViewerCredentialedSource(sourceTab.id, pdfUrl);
		targetTab = await chrome.tabs.update(sourceTab.id, {
			url: viewerUrl,
			active: args.active === false ? undefined : true,
		});
	}

	const finalTab = waitForLoad ? await waitForTabComplete(targetTab.id, timeoutMs) : await chrome.tabs.get(targetTab.id);
	let viewerReady = null;
	if (waitForLoad && isOwnExtensionPdfViewerUrl(finalTab?.url)) {
		viewerReady = await safeWaitForOnhandPdfViewerReady(finalTab.id, timeoutMs);
	}
	const selectionHandoff = await getSelectionHandoffResult(finalTab.id);
	return {
		tab: simplifyTab(finalTab),
		sourceTab: sourceTabSnapshot,
		pdfUrl,
		viewerUrl,
		initialPageNumber,
		initialPageSource,
		initialScrollRatio,
		selectionHandoff,
		viewerReady,
		alreadyOpen: false,
		opened: true,
		replacedCurrentTab: !shouldOpenViewerInNewTab,
		preservedSourceUrl: sourceIsGoogleDocs && shouldOpenViewerInNewTab,
		pageLocationDiagnostics: diagnostics,
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

async function getVisibleRegionViewportFallback(focusedTab, scriptError = null) {
	try {
		const viewport = await withDebugger(focusedTab.id, async ({ send }) => {
			await send("Page.enable");
			const metrics = await send("Page.getLayoutMetrics");
			const visualViewport = metrics?.cssVisualViewport || metrics?.visualViewport || {};
			const layoutViewport = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
			const width = Number(visualViewport.clientWidth ?? layoutViewport.clientWidth ?? 0);
			const height = Number(visualViewport.clientHeight ?? layoutViewport.clientHeight ?? 0);
			if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
				throw new Error("Debugger layout metrics did not include a viewport size.");
			}
			return {
				width: Math.max(1, Math.round(width)),
				height: Math.max(1, Math.round(height)),
				devicePixelRatio: Number(visualViewport.scale || 1) || 1,
				scrollX: Math.round(Number(visualViewport.pageX ?? layoutViewport.pageX ?? 0) || 0),
				scrollY: Math.round(Number(visualViewport.pageY ?? layoutViewport.pageY ?? 0) || 0),
			};
		});
		return {
			viewport,
			selectorRegion: null,
			source: "debugger-layout",
			...(scriptError ? { scriptError: scriptError?.message || String(scriptError) } : {}),
		};
	} catch (debuggerError) {
		const windowInfo =
			typeof focusedTab.windowId === "number"
				? await chrome.windows.get(focusedTab.windowId).catch(() => null)
				: null;
		return {
			viewport: {
				width: Math.max(1, Math.round(Number(windowInfo?.width || 1280))),
				height: Math.max(1, Math.round(Number(windowInfo?.height || 720))),
				devicePixelRatio: 1,
				scrollX: 0,
				scrollY: 0,
			},
			selectorRegion: null,
			source: "window-approximation",
			...(scriptError || debuggerError
				? {
					scriptError: scriptError?.message || String(scriptError || ""),
					debuggerError: debuggerError?.message || String(debuggerError || ""),
				}
				: {}),
		};
	}
}

async function getVisibleRegionSnapshot(tabId, options = {}) {
	const focusedTab = await focusTab(tabId);
	let viewport;
	try {
		viewport = await executeScriptInTab(
			focusedTab.id,
			(selector, shouldScrollIntoView) => {
			let selectorRegion = null;
			const rawSelector = String(selector || "").trim();
			if (rawSelector) {
				const element = document.querySelector(rawSelector);
				if (!element) throw new Error(`No element matched selector: ${rawSelector}`);
				if (shouldScrollIntoView !== false) {
					element.scrollIntoView?.({ behavior: "auto", block: "center", inline: "center" });
				}
				const rect = element.getBoundingClientRect();
				const viewportWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1));
				const viewportHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1));
				const visibleLeft = Math.max(0, rect.left);
				const visibleTop = Math.max(0, rect.top);
				const visibleRight = Math.min(viewportWidth, rect.right);
				const visibleBottom = Math.min(viewportHeight, rect.bottom);
				const visibleWidth = Math.max(0, visibleRight - visibleLeft);
				const visibleHeight = Math.max(0, visibleBottom - visibleTop);
				const elementArea = Math.max(1, rect.width * rect.height);
				const visibleRatio = Math.max(0, Math.min(1, (visibleWidth * visibleHeight) / elementArea));
				selectorRegion = {
					x: Math.round(rect.left),
					y: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
					selector: rawSelector,
					visibleRatio,
					clipped: visibleRatio < 0.98 || rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight,
					smallRegion: rect.width < 120 || rect.height < 120,
					visibleRect: {
						x: Math.round(visibleLeft),
						y: Math.round(visibleTop),
						width: Math.round(visibleWidth),
						height: Math.round(visibleHeight),
					},
				};
			}
			const viewport = {
				width: Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1)),
				height: Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1)),
				devicePixelRatio: Number(window.devicePixelRatio || 1),
				scrollX: Math.round(window.scrollX || 0),
				scrollY: Math.round(window.scrollY || 0),
			};
			return { viewport, selectorRegion };
			},
			[String(options.selector || ""), options.scrollIntoView !== false],
		);
		if (viewport && typeof viewport === "object") viewport.source = viewport.source || "page-script";
	} catch (error) {
		viewport = await getVisibleRegionViewportFallback(focusedTab, error);
	}
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
		...(selectorRegion ? { visibleRatio: selectorRegion.visibleRatio, clipped: Boolean(selectorRegion.clipped), smallRegion: Boolean(selectorRegion.smallRegion) } : {}),
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
		...(selectorRegion
			? {
				selectorRegion: {
					x: selectorRegion.x,
					y: selectorRegion.y,
					width: selectorRegion.width,
					height: selectorRegion.height,
					selector: selectorRegion.selector,
					visibleRatio: selectorRegion.visibleRatio,
					clipped: Boolean(selectorRegion.clipped),
					smallRegion: Boolean(selectorRegion.smallRegion),
					visibleRect: selectorRegion.visibleRect,
				},
			}
			: {}),
		viewport: viewportInfo,
		viewportSource: viewport?.source || "page-script",
		...(viewport?.scriptError ? { viewportScriptError: viewport.scriptError } : {}),
		...(viewport?.debuggerError ? { viewportDebuggerError: viewport.debuggerError } : {}),
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

function googleDocsCaptureStatePayload(tab) {
	return {
		surface: "google-docs",
		source: "google-docs-fast-capture",
		url: tab?.url || "",
		title: tab?.title || "",
		scrollX: 0,
		scrollY: 0,
		viewport: {
			width: 0,
			height: 0,
		},
		annotationCount: 0,
		annotations: [],
		blockCount: 0,
		blocks: [],
		text: "",
		capturedAt: new Date().toISOString(),
	};
}

function googleDocsVisibleTextPayloadFromExport(tab, content, options = {}) {
	const maxBlocks = Math.max(1, Math.min(80, Number(options.maxBlocks || 25) || 25));
	const maxChars = Math.max(200, Math.min(20000, Number(options.maxChars || 6000) || 6000));
	const sourceBlocks = Array.isArray(content?.blocks) ? content.blocks : [];
	const blocks = [];
	let usedChars = 0;
	for (const sourceBlock of sourceBlocks) {
		if (blocks.length >= maxBlocks || usedChars >= maxChars) break;
		const rawText = String(sourceBlock?.text || "").replace(/\s+/g, " ").trim();
		if (!rawText) continue;
		const remaining = maxChars - usedChars;
		const text = rawText.length > remaining ? `${rawText.slice(0, Math.max(0, remaining - 1))}…` : rawText;
		blocks.push({
			tag: sourceBlock?.tag || "p",
			selector: `google-docs-export:nth-of-type(${blocks.length + 1})`,
			text,
			top: 0,
			bottom: 0,
			isHeading: false,
			source: "google-docs-export",
		});
		usedChars += text.length + 2;
	}
	const text = blocks.map((block) => block.text).join("\n\n");
	return {
		surface: "google-docs",
		source: "google-docs-export-visible-text",
		unsupported: Boolean(content?.unsupported),
		reason: content?.reason || "",
		url: tab?.url || content?.url || "",
		exportUrl: content?.exportUrl || "",
		title: tab?.title || content?.title || "",
		scrollX: 0,
		scrollY: 0,
		viewport: {
			width: 0,
			height: 0,
		},
		blockCount: blocks.length,
		blocks,
		text: text || content?.text || "",
		truncated: Boolean(content?.truncated),
	};
}

function googleDocsViewportHeadingsPayloadFromExport(tab, content, options = {}) {
	const maxHeadings = Math.max(1, Math.min(20, Number(options.maxHeadings || 8) || 8));
	const titleText = String(tab?.title || content?.title || "")
		.replace(/\s+-\s+Google Docs$/i, "")
		.trim();
	const headings = titleText
		? [
				{
					level: 1,
					tag: "h1",
					selector: "google-docs-export-title",
					text: titleText,
					top: 0,
					bottom: 0,
					isVisible: true,
					inferred: true,
				},
			].slice(0, maxHeadings)
		: [];
	return {
		surface: "google-docs",
		source: "google-docs-export-headings",
		unsupported: Boolean(content?.unsupported),
		reason: content?.reason || "",
		url: tab?.url || content?.url || "",
		exportUrl: content?.exportUrl || "",
		title: tab?.title || content?.title || "",
		scrollX: 0,
		scrollY: 0,
		viewport: {
			width: 0,
			height: 0,
		},
		currentHeading: headings[0] || null,
		visibleHeadings: headings,
		upcomingHeadings: [],
		headings,
		message: content?.unsupported
			? content?.reason || "Google Docs export is unavailable."
			: "Google Docs editor heading positions are not exposed reliably; this heading context is inferred from the document title.",
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
	const maxHeadingOutline = Math.max(0, Math.min(160, Number(options.maxHeadingOutline || 80) || 80));
	const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
	const queryStopWords = new Set([
		"about",
		"also",
		"and",
		"are",
		"context",
		"does",
		"each",
		"for",
		"from",
		"have",
		"page",
		"same",
		"that",
		"the",
		"this",
		"three",
		"using",
		"what",
		"which",
		"with",
	]);
	const queryTokens = Array.from(
		new Set(
			(String(options.query || "").toLowerCase().match(/[a-z][a-z0-9._-]{2,}|[0-9]+(?:\.[0-9]+)?%?/g) || []).filter(
				(token) => !queryStopWords.has(token),
			),
		),
	).slice(0, 32);
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
	// When the environment computes layout, trust it: zero-rect elements are
	// hidden UI (closed dialogs, unselected tab panels) whose text can never be
	// highlighted, so extracting it breaks the copy-then-highlight contract.
	// The text fallback only applies in layout-less environments (tests).
	const pageLayoutAvailable = (() => {
		const rect = (document.body || document.documentElement)?.getBoundingClientRect?.();
		return Boolean(rect && (rect.width > 0 || rect.height > 0));
	})();
	const isVisible = (element) => {
		if (!(element instanceof Element)) return false;
		const style = window.getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden" || (style.opacity !== "" && Number(style.opacity) === 0)) return false;
		if (element.hasAttribute("hidden") || String(element.getAttribute("aria-hidden") || "").toLowerCase() === "true") return false;
		const rect = element.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return true;
		return !pageLayoutAvailable && normalize(element.textContent || "").length > 0;
	};
	const selectorFor = (element) => {
		if (!(element instanceof Element)) return "";
		const bits = [element.tagName.toLowerCase()];
		if (element.id) bits.push(`#${element.id}`);
		const className = String(element.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
		if (className) bits.push(`.${className}`);
		return bits.join("");
	};
	const readableRootScore = (element) => {
		if (!(element instanceof Element)) return 0;
		const clone = element.cloneNode(true);
		if (clone instanceof Element) {
			for (const node of Array.from(clone.querySelectorAll("script, style, noscript, svg, nav, header, footer, aside, form, button, input, select, textarea"))) {
				node.remove();
			}
		}
		return normalize(clone.textContent || "").length;
	};
	const rootCandidates = [
		...Array.from(document.querySelectorAll("article, main, [role='main'], .mw-parser-output")),
		document.body,
		document.documentElement,
	].filter((element, index, list) => element instanceof Element && list.indexOf(element) === index);
	const scoredRoots = rootCandidates.map((element) => ({ element, score: readableRootScore(element) }));
	const bestOverallRoot = scoredRoots.slice().sort((left, right) => right.score - left.score)[0];
	// The body always contains any semantic container, so raw text length alone
	// always prefers the body and lets site chrome (banners, footers, injected
	// sidebars) bleed into readable content. Prefer the fullest semantic
	// container whenever it holds the majority of the readable text.
	const bestSemanticRoot = scoredRoots
		.filter(({ element }) => element !== document.body && element !== document.documentElement)
		.sort((left, right) => right.score - left.score)[0];
	const root =
		(bestSemanticRoot && bestSemanticRoot.score >= 400 && bestSemanticRoot.score >= (bestOverallRoot?.score || 0) * 0.5
			? bestSemanticRoot.element
			: bestOverallRoot?.element) ||
		document.body ||
		document.documentElement;
	const ignoredSelector = "script, style, noscript, svg, nav, header, footer, aside, form, button, input, select, textarea";
	const blocks = [];
	const headingOutline = [];
	const headingOutlineElements = [];
	const seenHeadingOutline = new Set();
	const seen = new Set();
	let usedChars = 0;
	const pushHeadingOutline = (element) => {
		if (headingOutline.length >= maxHeadingOutline) return;
		if (!(element instanceof Element) || !isVisible(element)) return;
		if (element.closest(ignoredSelector)) return;
		const tag = element.tagName.toLowerCase();
		const level = Number(tag.slice(1)) || 2;
		const clean = normalize(headingOwnText(element));
		if (!clean || clean.length < 2) return;
		const key = `${tag}:${clean.toLowerCase()}`;
		if (seenHeadingOutline.has(key)) return;
		seenHeadingOutline.add(key);
		const entry = {
			tag,
			level,
			selector: selectorFor(element),
			text: `${"#".repeat(level)} ${clean.slice(0, 300)}`,
		};
		headingOutline.push(entry);
		headingOutlineElements.push({ entry, element });
	};
	const isHeadingElement = (element) => element instanceof Element && /^h[1-6]$/i.test(element.tagName);
	const tableMarkdown = (table, maxRows = 18, maxTableChars = 2400) => {
		if (!(table instanceof Element)) return "";
		const rows = [];
		const caption = normalize(table.querySelector("caption")?.textContent || "");
		if (caption) rows.push(`Table: ${caption}`);
		for (const row of Array.from(table.querySelectorAll("tr"))) {
			if (!(row instanceof Element) || !isVisible(row)) continue;
			const cells = Array.from(row.children || [])
				.filter((cell) => cell instanceof Element && /^(td|th)$/i.test(cell.tagName) && isVisible(cell))
				.map((cell) => normalize(cell.textContent || "").slice(0, 220))
				.filter(Boolean);
			if (!cells.length) continue;
			rows.push(`| ${cells.join(" | ")} |`);
			if (rows.length >= maxRows) break;
		}
		const text = rows.join("\n");
		return text.length > maxTableChars ? `${text.slice(0, Math.max(0, maxTableChars - 1))}…` : text;
	};
	const queryScore = (value) => {
		if (!queryTokens.length) return 0;
		const text = normalize(value).toLowerCase();
		if (!text) return 0;
		let score = 0;
		for (const token of queryTokens) {
			if (!token) continue;
			if (text.includes(token)) score += /[0-9.%]/.test(token) ? 5 : Math.min(4, Math.max(1, token.length - 2));
			if (token.endsWith("s") && token.length > 4 && text.includes(token.slice(0, -1))) score += 1;
		}
		return score;
	};
	const queryTokenMatches = (value, token) => {
		const text = normalize(value).toLowerCase();
		if (!text || !token) return false;
		if (text.includes(token)) return true;
		return token.endsWith("s") && token.length > 4 && text.includes(token.slice(0, -1));
	};
	const querySnippet = (value, maxSnippetChars = 1800) => {
		const clean = normalize(value);
		if (!queryTokens.length || clean.length <= maxSnippetChars) return clean;
		const lower = clean.toLowerCase();
		const hits = [];
		for (const token of queryTokens) {
			if (!token) continue;
			const variants = [token];
			if (token.endsWith("s") && token.length > 4) variants.push(token.slice(0, -1));
			for (const variant of variants) {
				let searchFrom = 0;
				let perTokenHits = 0;
				while (perTokenHits < 3) {
					const index = lower.indexOf(variant, searchFrom);
					if (index < 0) break;
					hits.push({ index, length: variant.length });
					searchFrom = index + Math.max(1, variant.length);
					perTokenHits += 1;
				}
			}
		}
		if (!hits.length) return clean.slice(0, Math.max(0, maxSnippetChars - 1)) + "…";
		hits.sort((left, right) => left.index - right.index);
		const windows = [];
		for (const hit of hits) {
			const start = Math.max(0, hit.index - 420);
			const end = Math.min(clean.length, hit.index + hit.length + 520);
			const previous = windows[windows.length - 1];
			if (previous && start <= previous.end + 80) {
				previous.end = Math.max(previous.end, end);
			} else {
				windows.push({ start, end, focus: hit.index });
			}
		}
		const snippets = [];
		let usedSnippetChars = 0;
		for (const windowRange of windows) {
			if (usedSnippetChars >= maxSnippetChars) break;
			const separatorLength = snippets.length ? 3 : 0;
			const remaining = maxSnippetChars - usedSnippetChars - separatorLength;
			if (remaining <= 0) break;
			let sliceStart = windowRange.start;
			let sliceEnd = windowRange.end;
			if (sliceEnd - sliceStart > remaining) {
				const focus = Math.max(windowRange.start, Math.min(windowRange.end, windowRange.focus || windowRange.start));
				sliceStart = Math.max(windowRange.start, focus - Math.floor(remaining / 2));
				sliceEnd = Math.min(windowRange.end, sliceStart + remaining);
				if (sliceEnd - sliceStart < remaining) sliceStart = Math.max(windowRange.start, sliceEnd - remaining);
			}
			let snippet = clean.slice(sliceStart, sliceEnd);
			if (sliceStart > 0) snippet = `… ${snippet}`;
			if (sliceEnd < clean.length) snippet = `${snippet} …`;
			if (snippet.length > remaining) snippet = `${snippet.slice(0, Math.max(0, remaining - 1))}…`;
			snippets.push(snippet);
			usedSnippetChars += snippet.length + separatorLength;
		}
		return snippets.join(" … ");
	};
	const collectHeadingSnippet = (heading, maxSnippetChars = 280) => {
		if (!(heading instanceof Element)) return "";
		const chunks = [];
		let usedSnippetChars = 0;
		const append = (value) => {
			const clean = normalize(value);
			if (!clean || clean.length < 2) return;
			if (chunks.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return;
			const remaining = maxSnippetChars - usedSnippetChars;
			if (remaining <= 0) return;
			const output = clean.length > remaining ? `${clean.slice(0, Math.max(0, remaining - 1))}…` : clean;
			chunks.push(output);
			usedSnippetChars += output.length + 1;
		};
		const collectFrom = (element) => {
			if (!(element instanceof Element) || !isVisible(element)) return false;
			if (element.closest(ignoredSelector)) return false;
			if (isHeadingElement(element)) return true;
			const tag = element.tagName.toLowerCase();
			if (tag === "table") {
				append(tableMarkdown(element, 8, maxSnippetChars));
				return false;
			}
			if (["p", "li", "blockquote", "pre", "figcaption", "caption"].includes(tag)) {
				append(element.textContent || "");
				return false;
			}
			for (const child of Array.from(element.children || [])) {
				if (collectFrom(child)) return true;
				if (usedSnippetChars >= maxSnippetChars) return false;
			}
			if (!element.children?.length) append(element.textContent || "");
			return false;
		};
		let sibling = heading.nextElementSibling;
		while (sibling && usedSnippetChars < maxSnippetChars) {
			if (collectFrom(sibling)) break;
			sibling = sibling.nextElementSibling;
		}
		if (!chunks.length && heading.parentElement) {
			sibling = heading.parentElement.nextElementSibling;
			while (sibling && usedSnippetChars < maxSnippetChars) {
				if (collectFrom(sibling)) break;
				sibling = sibling.nextElementSibling;
			}
		}
		return chunks.join(" ");
	};
	const sectionLooksFormulaHeavy = (heading) => {
		if (!(heading instanceof Element)) return false;
		let sibling = heading.nextElementSibling;
		let scanned = 0;
		let mathHits = 0;
		while (sibling && scanned < 10) {
			if (isHeadingElement(sibling)) break;
			if (sibling instanceof Element && isVisible(sibling) && !sibling.closest(ignoredSelector)) {
				const text = normalize(sibling.textContent || "");
				if (
					sibling.querySelector?.("mjx-container, math, .MathJax, [data-mathml]") ||
					/[∑∏√∞≈≤≥∈⊙]|\\(?:sin|cos|softmax|frac|mathbf|mathbb)\b|\b(?:sin|cos|softmax|layernorm)\s*\(/i.test(text)
				) {
					mathHits += 1;
					if (mathHits >= 2) return true;
				}
				scanned += 1;
			}
			sibling = sibling.nextElementSibling;
		}
		return false;
	};
	// textContent includes structurally hidden descendants (tooltips, templates,
	// closed dialogs) that the page never renders inside the block, so copied
	// text containing them could never be highlighted.
	const hiddenBlockDescendantSelector = '[hidden], [aria-hidden="true"], [role="tooltip"], tool-tip, template, dialog';
	const withoutRemoved = (element, selector) => {
		if (!(element instanceof Element)) return "";
		if (!element.querySelector(selector)) return element.textContent || "";
		const clone = element.cloneNode(true);
		for (const node of Array.from(clone.querySelectorAll(selector))) node.remove();
		return clone.textContent || "";
	};
	const visibleBlockText = (element) => withoutRemoved(element, hiddenBlockDescendantSelector);
	// A list item's textContent concatenates any nested list into one unhighlightable
	// glued string; the nested items are collected as their own blocks anyway.
	const listItemOwnText = (element) => withoutRemoved(element, `ul, ol, ${hiddenBlockDescendantSelector}`);
	// Docs sites append self-link anchors ("¶", "#", "§") to headings; they are
	// separate link elements, so copied heading text never matches with them glued on.
	const headingOwnText = (element) => {
		if (!(element instanceof Element)) return "";
		const links = Array.from(element.querySelectorAll('a[href^="#"]')).filter((link) => normalize(link.textContent || "").length <= 2);
		if (!links.length) return element.textContent || "";
		const clone = element.cloneNode(true);
		for (const link of Array.from(clone.querySelectorAll('a[href^="#"]'))) {
			if (normalize(link.textContent || "").length <= 2) link.remove();
		}
		return clone.textContent || "";
	};
	const blockTextFor = (tag, element) => {
		if (tag === "table") return tableMarkdown(element);
		if (tag === "li") return listItemOwnText(element);
		if (/^h[1-6]$/.test(tag)) return headingOwnText(element);
		return visibleBlockText(element);
	};
	const pushBlock = (kind, text, element) => {
		const clean = normalize(text);
		if (!clean || clean.length < 2) return;
		const key = clean.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		const prefix = /^h[1-6]$/.test(kind) ? `${"#".repeat(Number(kind.slice(1)) || 2)} ` : kind === "li" ? "- " : kind === "blockquote" ? "> " : "";
		const body =
			kind === "pre"
				? `\`\`\`\n${String(text || "").trim().slice(0, 3000)}\n\`\`\``
				: kind === "table"
					? String(text || "").trim()
					: `${prefix}${clean}`;
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

	for (const element of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
		pushHeadingOutline(element);
	}
	for (const { entry: heading, element } of headingOutlineElements) {
		const snippet = collectHeadingSnippet(element, sectionLooksFormulaHeavy(element) ? 900 : 280);
		if (snippet) {
			heading.snippet = snippet;
			heading.markdown = `${heading.text}\n  ${snippet}`;
		}
	}

	// The document's first h1 is often hidden chrome (sr-only dialog headings,
	// skip links); only a visible, non-chrome h1 can serve as the title block.
	const titleElement =
		Array.from(document.querySelectorAll("h1")).find((element) => isVisible(element) && !element.closest(ignoredSelector)) || null;
	const title = normalize(titleElement ? headingOwnText(titleElement) : document.title);
	if (title) pushBlock("h1", title, titleElement || document.documentElement);

	if (queryTokens.length) {
		const relevant = [];
		let index = 0;
		for (const element of root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, caption, table")) {
			if (!(element instanceof Element) || !isVisible(element)) continue;
			if (element.closest(ignoredSelector) && !["pre"].includes(element.tagName.toLowerCase())) continue;
			const tag = element.tagName.toLowerCase();
			const text = blockTextFor(tag, element);
			const score = queryScore(text);
			if (score <= 0) continue;
			relevant.push({ tag, text, element, score, index: index++ });
		}
		const relevantBudget = Math.min(maxChars, Math.max(3000, Math.floor(maxChars * 0.45)));
		const sortedRelevant = relevant.sort((left, right) => right.score - left.score || left.index - right.index);
		const orderedRelevant = [];
		const seenRelevant = new Set();
		const pushRelevant = (item) => {
			if (!item || seenRelevant.has(item.element)) return;
			seenRelevant.add(item.element);
			orderedRelevant.push(item);
		};
		for (const token of queryTokens) {
			pushRelevant(sortedRelevant.find((item) => queryTokenMatches(item.text, token)));
		}
		for (const item of sortedRelevant) pushRelevant(item);
		const perRelevantSnippetBudget = Math.min(
			1800,
			Math.max(650, Math.floor(relevantBudget / Math.max(2, Math.min(8, queryTokens.length + 1)))),
		);
		for (const item of orderedRelevant.slice(0, 18)) {
			if (usedChars >= relevantBudget) break;
			const text =
				item.tag === "table"
					? item.text
					: querySnippet(item.text, Math.min(perRelevantSnippetBudget, Math.max(650, relevantBudget - usedChars)));
			pushBlock(item.tag, text, item.element);
		}
	}

	for (const element of root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, caption, table")) {
		if (usedChars >= maxChars) break;
		if (!(element instanceof Element) || !isVisible(element)) continue;
		if (element.closest(ignoredSelector) && !["pre"].includes(element.tagName.toLowerCase())) continue;
		const tag = element.tagName.toLowerCase();
		pushBlock(tag, blockTextFor(tag, element), element);
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
		headingOutline,
		headingOutlineMarkdown: headingOutline.map((heading) => heading.markdown || heading.text).join("\n"),
		blocks,
		markdown,
		text: markdown,
	};
}

async function searchTextbookReaderInPage(options = {}) {
	const query = String(options.query || "").trim();
	const maxResults = Math.max(1, Math.min(20, Number(options.maxResults || 8) || 8));
	const timeoutMs = Math.max(800, Math.min(8000, Number(options.timeoutMs || 3500) || 3500));
	const readyTimeoutMs = Math.max(0, Math.min(20000, Number(options.readyTimeoutMs || 10000) || 10000));
	const openResult = Boolean(options.openResult);
	const resultIndex = Math.max(1, Math.min(50, Number(options.resultIndex || 1) || 1));
	const startedAt = Date.now();
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
	const lower = (value) => normalize(value).toLowerCase();
	const queryTokens = Array.from(
		new Set(
			query
				.toLowerCase()
				.match(/[a-z][a-z0-9'-]{2,}|[0-9]+/g) || [],
		),
	).filter((token) => !new Set(["about", "across", "and", "book", "chapter", "find", "from", "into", "look", "of", "or", "page", "search", "that", "the", "this", "where", "with"]).has(token));
	const allElements = (selector, root = document) => {
		try {
			return Array.from(root.querySelectorAll(selector)).filter((element) => element instanceof Element);
		} catch {
			if (!String(selector || "").includes(",")) return [];
			const elements = [];
			const seen = new Set();
			for (const part of String(selector || "").split(",").map((item) => item.trim()).filter(Boolean)) {
				try {
					for (const element of Array.from(root.querySelectorAll(part)).filter((candidate) => candidate instanceof Element)) {
						if (seen.has(element)) continue;
						seen.add(element);
						elements.push(element);
					}
				} catch {}
			}
			return elements;
		}
	};
	const isVisible = (element) => {
		if (!(element instanceof Element)) return false;
		if (element.hasAttribute("hidden") || lower(element.getAttribute("aria-hidden")) === "true") return false;
		const style = window.getComputedStyle(element);
		if (!style || style.display === "none" || style.visibility === "hidden" || (style.opacity !== "" && Number(style.opacity) === 0)) return false;
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const fieldValue = (element) => {
		if (!element) return "";
		if ("value" in element) return String(element.value || "");
		return normalize(element.textContent || "");
	};
	const cssEscape = (value) =>
		globalThis.CSS?.escape ? globalThis.CSS.escape(String(value || "")) : String(value || "").replace(/["\\]/g, "\\$&");
	const elementLabel = (element) => {
		if (!(element instanceof Element)) return "";
		const labelledBy = String(element.getAttribute("aria-labelledby") || "")
			.split(/\s+/)
			.map((id) => normalize(document.getElementById(id)?.textContent || ""))
			.filter(Boolean)
			.join(" ");
		const labelFor =
			element.id && document.querySelector(`label[for="${cssEscape(element.id)}"]`)
				? normalize(document.querySelector(`label[for="${cssEscape(element.id)}"]`)?.textContent || "")
				: "";
		const wrappingLabel = normalize(element.closest("label")?.textContent || "");
		return normalize(
			[
				element.getAttribute("aria-label"),
				labelledBy,
				labelFor,
				wrappingLabel,
				element.getAttribute("placeholder"),
				element.getAttribute("title"),
				element.getAttribute("name"),
				element.getAttribute("data-testid"),
				fieldValue(element),
				element.textContent,
			]
				.filter(Boolean)
				.join(" "),
		);
	};
	const selectorFor = (element) => {
		if (!(element instanceof Element)) return "";
		const tag = element.tagName.toLowerCase();
		const id = element.id ? `#${element.id}` : "";
		const classes = String(element.className || "")
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 3)
			.map((name) => `.${name}`)
			.join("");
		const label = elementLabel(element);
		return `${tag}${id}${classes}${label ? ` [${label.slice(0, 80)}]` : ""}`;
	};
	const clickElement = (element) => {
		if (!(element instanceof Element)) return false;
		element.scrollIntoView?.({ block: "center", inline: "center" });
		const rect = element.getBoundingClientRect();
		const eventOptions = {
			bubbles: true,
			cancelable: true,
			view: window,
			clientX: Math.round(rect.left + rect.width / 2),
			clientY: Math.round(rect.top + rect.height / 2),
		};
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
			element.dispatchEvent(new MouseEvent(type, eventOptions));
		}
		if (typeof element.click === "function") element.click();
		else element.dispatchEvent(new MouseEvent("click", eventOptions));
		return true;
	};
	const classifyAdapter = () => {
		const host = lower(location.hostname);
		const title = lower(document.title);
		const body = lower(document.body?.innerText || "").slice(0, 4000);
		if (/vitalsource|bookshelf|jigsaw/.test(`${host} ${title} ${body}`)) {
			return {
				name: "vitalsource-bookshelf",
				confidence: "high",
				reason: "Detected VitalSource/Bookshelf reader signals.",
			};
		}
		if (/pearson|cengage|mcgraw|mheducation|redshelf|brytewave|perusall|zybooks|courseware|ebook|textbook|reader/.test(`${host} ${title} ${body}`)) {
			return {
				name: "generic-textbook-reader",
				confidence: "medium",
				reason: "Detected online textbook or reader signals.",
			};
		}
		return {
			name: "generic-web-reader",
			confidence: "low",
			reason: "Using generic accessible search UI detection.",
		};
	};
	const searchIntentScore = (label, element) => {
		const text = lower(label);
		if (!text || !/search|find/.test(text)) return 0;
		let score = 20;
		if (/\b(search|find)\s+(across|all|inside|in|within|this)?\s*(the\s*)?(book|textbook|ebook|reader|course|chapter|content)\b/.test(text)) score += 40;
		if (/\b(book|textbook|ebook|reader|chapter|contents|course)\b/.test(text)) score += 20;
		if (/\bsearch\b/.test(text) && text.length <= 80) score += 10;
		if (/searchbox|search/.test(lower(element.getAttribute("role")))) score += 16;
		if (element.matches?.("input, textarea, [contenteditable='true'], [role='searchbox']")) score += 14;
		if (element.matches?.("button, [role='button'], a")) score += 8;
		if (/\bclose|clear|cancel|delete|remove\b/.test(text)) score -= 30;
		return score;
	};
	const findSearchControls = () => {
		const selector = [
			"input",
			"textarea",
			"[contenteditable='true']",
			"[role='searchbox']",
			"button",
			"a",
			"[role='button']",
			"[aria-label]",
			"[placeholder]",
			"[title]",
			"[data-testid*='search' i]",
			"[class*='search' i]",
			"[id*='search' i]",
		].join(",");
		return allElements(selector)
			.filter(isVisible)
			.map((element, index) => ({
				element,
				index,
				label: elementLabel(element),
				score: searchIntentScore(elementLabel(element), element),
			}))
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score || left.index - right.index);
	};
	const isSearchInput = (element) => {
		if (!(element instanceof Element) || !isVisible(element)) return false;
		if (!element.matches("input, textarea, [contenteditable='true'], [role='searchbox']")) return false;
		const type = lower(element.getAttribute("type"));
		if (type && !["search", "text", "email", "url"].includes(type)) return false;
		return searchIntentScore(elementLabel(element), element) > 0 || /search|find/.test(lower(elementLabel(element)));
	};
	const findSearchInput = () =>
		allElements("input, textarea, [contenteditable='true'], [role='searchbox']")
			.filter(isSearchInput)
			.map((element, index) => ({
				element,
				index,
				label: elementLabel(element),
				score: searchIntentScore(elementLabel(element), element),
			}))
			.sort((left, right) => right.score - left.score || left.index - right.index)[0] || null;
	const setNativeValue = (element, value) => {
		if (!(element instanceof Element)) return;
		element.focus?.();
		if (element.matches("[contenteditable='true']")) {
			element.textContent = value;
		} else if ("value" in element) {
			const prototype = Object.getPrototypeOf(element);
			const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
			if (descriptor?.set) descriptor.set.call(element, value);
			else element.value = value;
		}
		element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: value, inputType: "insertText" }));
		element.dispatchEvent(new Event("change", { bubbles: true }));
	};
	const submitSearch = (input) => {
		if (!(input instanceof Element)) return false;
		const eventOptions = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", which: 13, keyCode: 13 };
		input.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
		input.dispatchEvent(new KeyboardEvent("keypress", eventOptions));
		input.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
		const owner = input.closest("form, [role='search'], [role='dialog'], aside, nav, section, div") || input.form || document;
		const button = allElements("button, input[type='submit'], [role='button']", owner)
			.filter(isVisible)
			.map((element, index) => ({ element, index, label: elementLabel(element), score: searchIntentScore(elementLabel(element), element) }))
			.filter((entry) => entry.score > 0 && !/\bclose|cancel|clear\b/i.test(entry.label))
			.sort((left, right) => right.score - left.score || left.index - right.index)[0]?.element;
		if (button) return clickElement(button);
		return true;
	};
	const queryTokenPattern = (token) => {
		const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const suffix = token.length >= 6 ? "[a-z0-9'-]*" : "";
		return new RegExp(`(^|[^a-z0-9])${escaped}${suffix}(?=$|[^a-z0-9])`, "i");
	};
	const firstQueryHitIndex = (text) => {
		const candidate = lower(text);
		if (!candidate) return -1;
		if (!queryTokens.length) return candidate.indexOf(lower(query));
		let best = -1;
		for (const token of queryTokens) {
			const match = candidate.match(queryTokenPattern(token));
			if (!match || typeof match.index !== "number") continue;
			const index = match.index + Math.max(0, match[0].length - token.length);
			if (best < 0 || index < best) best = index;
		}
		return best;
	};
	const queryTokenScore = (text) => {
		const candidate = lower(text);
		if (!candidate) return 0;
		if (!queryTokens.length) return candidate.includes(lower(query)) ? 10 : 0;
		const tokenMatches = (token) => {
			return queryTokenPattern(token).test(candidate);
		};
		let score = 0;
		for (const token of queryTokens) {
			if (tokenMatches(token)) score += Math.min(12, Math.max(3, token.length));
			else if (token.endsWith("s") && token.length > 4 && tokenMatches(token.slice(0, -1))) score += 2;
		}
		return score;
	};
	const resultPageLabel = (text) => normalize(text.match(/\b(?:page|p\.?)\s*([A-Za-z]?\d+|[ivxlcdm]+)\b/i)?.[0] || "");
	const resultTitle = (text) => {
		const clean = normalize(text);
		const parts = clean.split(/\s(?:page|p\.?)\s+(?:[A-Za-z]?\d+|[ivxlcdm]+)\b/i);
		return normalize(parts[0] || clean).slice(0, 160);
	};
	const clickableForResult = (element) => {
		if (!(element instanceof Element)) return null;
		if (element.matches("a, button, [role='button'], [role='option'], [role='link']")) return element;
		const closest = element.closest("a, button, [role='button'], [role='option'], [role='link']");
		if (closest) return closest;
		return element.querySelector("a, button, [role='button'], [role='option'], [role='link']");
	};
	const collectResults = () => {
		const selector = [
			"a",
			"button",
			"li",
			"article",
			"[role='option']",
			"[role='listitem']",
			"[role='link']",
			"[data-testid*='search' i]",
			"[class*='search' i]",
			"[id*='search' i]",
		].join(",");
		const seen = new Set();
		const entries = [];
		for (const element of allElements(selector)) {
			if (!isVisible(element)) continue;
			if (element.matches("input, textarea, [contenteditable='true']")) continue;
			const text = normalize(element.textContent || elementLabel(element));
			if (text.length < 6 || text.length > 1400) continue;
			if (/^(search|find|close|cancel|clear|back|menu)$/i.test(text)) continue;
			const tokenScore = queryTokenScore(text);
			if (tokenScore <= 0) continue;
			const firstHit = firstQueryHitIndex(text);
			const leadingText = text.slice(0, 160);
			if (
				firstHit > 180 &&
				/\b(?:highlights, notes|bookmarks?|flashcards?|bookmark page|search across book|reader preferences|skip to book navigation|previous|more options|table of contents)\b/i.test(
					leadingText,
				)
			) {
				continue;
			}
			const hasSmallerQueryChild = Array.from(element.children || []).some((child) => {
				if (!(child instanceof Element) || !isVisible(child)) return false;
				const childText = normalize(child.textContent || "");
				return childText.length >= 6 && childText.length < text.length * 0.9 && firstQueryHitIndex(childText) >= 0;
			});
			if (hasSmallerQueryChild) continue;
			const searchish = /search|result|hit|chapter|page|book|reader/i.test(
				`${element.className || ""} ${element.id || ""} ${element.getAttribute("role") || ""} ${element.getAttribute("data-testid") || ""} ${elementLabel(element)}`,
			);
			let score = tokenScore;
			if (resultPageLabel(text)) score += 8;
			if (clickableForResult(element)) score += 5;
			if (searchish) score += 4;
			if (score <= 0) continue;
			const key = lower(text).slice(0, 360);
			if (seen.has(key)) continue;
			seen.add(key);
			entries.push({
				element,
				score,
				text,
				title: resultTitle(text),
				pageLabel: resultPageLabel(text),
				snippet: text.slice(0, 700),
				clickable: Boolean(clickableForResult(element)),
			});
		}
		return entries.sort((left, right) => right.score - left.score || left.text.length - right.text.length).slice(0, maxResults);
	};
	const readTotalResultCount = () => {
		const text = normalize(document.body?.innerText || document.body?.textContent || "");
		const contentMatch = text.match(/\bContent\s*\(\s*(\d{1,6})\s*\)/i);
		if (contentMatch) return Number(contentMatch[1]) || null;
		const resultMatch = text.match(/\b(\d{1,6})\s+results?\b/i);
		return resultMatch ? Number(resultMatch[1]) || null : null;
	};
	const waitForResults = async () => {
		const deadline = Date.now() + timeoutMs;
		let lastResults = collectResults();
		while (Date.now() < deadline) {
			if (lastResults.length) return lastResults;
			await wait(250);
			lastResults = collectResults();
		}
		return lastResults;
	};
	const waitForSearchShell = async () => {
		const deadline = Date.now() + readyTimeoutMs;
		let controls = findSearchControls();
		let input = findSearchInput();
		while (!input && !controls.length && Date.now() < deadline) {
			await wait(250);
			controls = findSearchControls();
			input = findSearchInput();
		}
		return {
			controls,
			searchInput: input,
			waitedMs: Math.max(0, Date.now() - startedAt),
		};
	};
	const waitForResultNavigation = async (previousUrl, previousTitle) => {
		const deadline = Date.now() + Math.max(1200, Math.min(8000, timeoutMs + 1800));
		let lastUrl = location.href;
		let lastTitle = document.title;
		while (Date.now() < deadline) {
			lastUrl = location.href;
			lastTitle = document.title;
			if (lastUrl !== previousUrl || lastTitle !== previousTitle) {
				return {
					afterUrl: lastUrl,
					afterTitle: lastTitle,
					navigated: true,
				};
			}
			await wait(250);
		}
		return {
			afterUrl: location.href,
			afterTitle: document.title,
			navigated: location.href !== previousUrl || document.title !== previousTitle,
		};
	};
	const pageLooksLikeSearchResults = () => {
		const text = normalize(document.body?.innerText || document.body?.textContent || "").slice(0, 6000);
		if (!text) return false;
		const hasReaderSearch = /\bsearch\s+(?:across|inside|within|this)?\s*(?:the\s*)?(?:book|textbook|ebook|reader|content)\b/i.test(text);
		const hasCount = /\bContent\s*\(\s*\d{1,6}\s*\)/i.test(text) || /(?:^|[^0-9])\d{1,6}\s*results?\b/i.test(text);
		return hasReaderSearch && hasCount;
	};
	const dismissReaderSearchUi = async () => {
		if (!pageLooksLikeSearchResults()) {
			return { attempted: false, dismissed: false, reason: "Reader search results were not visible." };
		}
		const candidates = allElements("button, a, [role='button'], [aria-label], [title]")
			.filter(isVisible)
			.map((element, index) => {
				const label = elementLabel(element);
				let score = 0;
				if (/\bclose\s+(?:search|results?|panel|dialog|drawer)\b/i.test(label)) score += 80;
				if (/^close$/i.test(label)) score += 60;
				if (/\bdismiss|hide|cancel\b/i.test(label)) score += 20;
				if (/\b(search|results?|panel|dialog|drawer)\b/i.test(label)) score += 12;
				const ownerText = normalize(element.closest("[role='dialog'], aside, section, nav, div")?.textContent || "");
				if (/\bsearch\s+(?:across|inside|within|this)?\s*(?:the\s*)?(?:book|textbook|ebook|reader|content)\b/i.test(ownerText)) score += 12;
				if (/(?:^|[^0-9])\d{1,6}\s*results?\b/i.test(ownerText) || /\bContent\s*\(\s*\d{1,6}\s*\)/i.test(ownerText)) score += 12;
				if (/\b(skip|bookmark|previous|next|preferences|more options|table of contents|highlight|note)\b/i.test(label)) score -= 50;
				return { element, index, label, score };
			})
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score || left.index - right.index);
		const chosen = candidates[0];
		if (!chosen) return { attempted: true, dismissed: false, reason: "No close control was found for the reader search panel." };
		clickElement(chosen.element);
		await wait(500);
		return {
			attempted: true,
			dismissed: !pageLooksLikeSearchResults(),
			control: {
				label: chosen.label,
				selector: selectorFor(chosen.element),
				score: chosen.score,
			},
		};
	};

	const adapter = classifyAdapter();
	if (!query) {
		return {
			ok: false,
			unsupported: true,
			reason: "No search query was provided.",
			surface: "textbook-search",
			source: "reader-search-ui",
			adapter,
			query,
			results: [],
			resultCount: 0,
			url: location.href,
			title: document.title,
		};
	}

	const beforeUrl = location.href;
	const beforeTitle = document.title;
	const shell = await waitForSearchShell();
	const controls = shell.controls;
	let searchInput = shell.searchInput;
	let usedControl = null;
	if (!searchInput && controls.length) {
		usedControl = controls[0];
		clickElement(usedControl.element);
		await wait(450);
		searchInput = findSearchInput();
	}
	if (!searchInput) {
		return {
			ok: false,
			unsupported: true,
			reason: "No accessible book-search input or control was found on this reader page.",
			surface: "textbook-search",
			source: "reader-search-ui",
			adapter,
			query,
			capabilities: {
				hasSearchControl: controls.length > 0,
				hasSearchInput: false,
				canOpenResult: false,
			},
			searchControls: controls.slice(0, 5).map((entry) => ({
				label: entry.label,
				selector: selectorFor(entry.element),
				score: entry.score,
			})),
			waitedForSearchMs: shell.waitedMs,
			results: [],
			resultCount: 0,
			url: location.href,
			title: document.title,
		};
	}
	usedControl = usedControl || searchInput;
	setNativeValue(searchInput.element, query);
	await wait(120);
	submitSearch(searchInput.element);
	await wait(450);
	let resultEntries = await waitForResults();
	if (!resultEntries.length) {
		submitSearch(searchInput.element);
		await wait(450);
		resultEntries = await waitForResults();
	}
	const results = resultEntries.map((entry, index) => ({
		index: index + 1,
		title: entry.title,
		pageLabel: entry.pageLabel,
		snippet: entry.snippet,
		score: entry.score,
		clickable: entry.clickable,
	}));
	const totalResultCount = readTotalResultCount();
	let openedResult = null;
	let dismissedSearchUi = null;
	if (openResult && resultEntries[resultIndex - 1]) {
		const target = resultEntries[resultIndex - 1];
		const clickable = clickableForResult(target.element);
		if (clickable) {
			clickElement(clickable);
			const navigation = await waitForResultNavigation(beforeUrl, beforeTitle);
			dismissedSearchUi = await dismissReaderSearchUi();
			openedResult = {
				index: resultIndex,
				title: target.title,
				pageLabel: target.pageLabel,
				beforeUrl,
				...navigation,
				dismissedSearchUi,
			};
		} else {
			openedResult = {
				index: resultIndex,
				title: target.title,
				pageLabel: target.pageLabel,
				error: "The selected result did not expose a clickable element.",
				navigated: false,
			};
		}
	}
	// Never leave the reader's search overlay open behind the tool result:
	// later highlights would land on the search-state URL/DOM, and closing
	// the panel afterwards can re-render the content and break those marks.
	if (!dismissedSearchUi?.dismissed) {
		const finalDismissal = await dismissReaderSearchUi();
		if (finalDismissal?.attempted || !dismissedSearchUi) dismissedSearchUi = finalDismissal;
	}
	return {
		ok: true,
		dismissedSearchUi,
		surface: "textbook-search",
		source: "reader-search-ui",
		adapter,
		query,
		capabilities: {
			hasSearchControl: controls.length > 0,
			hasSearchInput: true,
			canOpenResult: resultEntries.some((entry) => entry.clickable),
		},
		searchControl: usedControl
			? {
				label: usedControl.label,
				selector: selectorFor(usedControl.element),
				score: usedControl.score,
			}
			: null,
		input: {
			label: searchInput.label,
			selector: selectorFor(searchInput.element),
		},
		resultCount: results.length,
		totalResultCount,
		results,
		openedResult,
		waitedForSearchMs: shell.waitedMs,
		url: location.href,
		title: document.title,
		beforeUrl,
		beforeTitle,
		elapsedMs: Date.now() - startedAt,
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
	const commandStartedAt = Date.now();
	try {
		return await handleCommandInner(name, args);
	} finally {
		const elapsedMs = Date.now() - commandStartedAt;
		if (elapsedMs > 500) log("slow command", name, `${elapsedMs}ms`);
	}
}

async function handleCommandInner(name, args = {}) {
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
		case "search_linked_pdf_corpus": {
			const commandStartedAt = Date.now();
			const overallTimeoutMs = Number(args.overallTimeoutMs) > 0
				? Math.max(100, Math.min(120000, Number(args.overallTimeoutMs)))
				: 30000;
			const remainingOverallMs = () => Math.max(0, overallTimeoutMs - (Date.now() - commandStartedAt));
			const tab = await resolveReadTargetTab(args);
			const linkScrape = withTabCommand(tab.id, async () => {
				return await evaluateInTab(
					tab.id,
					`(() => Array.from(document.querySelectorAll("a[href]"), (anchor) => ({
						title: String(anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "").replace(/\\s+/g, " ").trim(),
						url: anchor.href || ""
					})).filter((link) => /^https?:\\/\\//i.test(link.url) && /\\.pdf(?:[?#]|$)/i.test(link.url)).slice(0, 100))()`,
				);
			});
			const links = await withOperationTimeout(linkScrape, Math.max(100, remainingOverallMs()), "PDF corpus search deadline exceeded");
			// Only DOM access belongs under the serialized 15-second tab-command
			// budget. Corpus fetch, parse, and ranking can legitimately take longer
			// and do not hold page or debugger state after the link scrape finishes.
			const corpus = await searchPdfCorpus({
				sources: Array.isArray(links) ? links : [],
				evidenceSlots: Array.isArray(args.evidenceSlots) ? args.evidenceSlots : [],
				maxSources: args.maxSources,
				maxMatchesPerSlot: args.maxMatchesPerSlot,
				concurrency: args.concurrency,
				overallTimeoutMs: Math.max(100, remainingOverallMs()),
			});
			if (!corpus.readableSourceCount && corpus.failures?.length) {
				console.warn("Onhand linked-PDF corpus search could not read any sources", corpus.failures.slice(0, 4));
			}
			return {
				tab: simplifyTab(tab),
				linkedPdfCount: Array.isArray(links) ? links.length : 0,
				corpus,
			};
		}
		case "activate_tab": {
			const tab = await resolveTargetTab(args);
			const focusedTab = await focusTab(tab.id);
			return {
				tab: simplifyTab(focusedTab),
			};
		}
			case "close_scaffolding_tabs": {
				const requested = (Array.isArray(args.tabIds) ? args.tabIds : [])
					.map((id) => Number(id))
					.filter((id) => Number.isFinite(id) && id > 0);
				const closedTabIds = [];
				for (const tabId of requested.slice(0, 20)) {
					try {
						const tab = await chrome.tabs.get(tabId);
						// Never close a tab the user is looking at, wherever it is.
						if (!tab || tab.active) continue;
						await chrome.tabs.remove(tabId);
						closedTabIds.push(tabId);
					} catch {}
				}
				return { closedTabIds, closedCount: closedTabIds.length };
			}
			case "navigate": {
				const navigation = await navigateBrowser(args);
				const probeError = await probeTabScriptable(navigation.tab?.id);
				const blocked = classifyBlockedNavigation(navigation.tab, probeError);
				return {
					tab: simplifyTab(navigation.tab),
					navigation: {
						createdNewTab: navigation.createdNewTab,
						reusedExistingTab: navigation.reusedExistingTab,
					},
					...(blocked ? { blocked } : {}),
				};
			}
			case "open_pdf_in_onhand_viewer": {
				// A pdfUrl-only newTab open has no meaningful source tab: resolving
				// one falls back to whatever tab is active, so the whole open (PDF
				// load + viewer install) must finish inside that unrelated tab's
				// command budget while selection/page probes aim at it. Give the
				// PDF its own tab up front and serialize there instead.
				if (shouldDetachPdfViewerOpenFromSourceTab(args)) {
					const detachedTab = await chrome.tabs.create({
						active: args.active !== false,
						...(typeof args.windowId === "number" ? { windowId: args.windowId } : {}),
					});
					const openTimeoutMs = clampNumber(args.timeoutMs, 15000, { min: 100, max: 120000 }) * 2 + 5000;
					return await withTabCommand(detachedTab.id, async () => {
						try {
							return await openPdfInOnhandViewer({
								...args,
								tabId: detachedTab.id,
								newTab: false,
								detachedNewTab: true,
								disableSelectionHandoff: true,
							});
						} catch (error) {
							const currentTab = await chrome.tabs.get(detachedTab.id).catch(() => detachedTab);
							const blocked = classifyBlockedNavigation(currentTab, error);
							if (blocked) throw new Error(`The PDF tab is blocked before it can load. ${blocked.detail}`);
							throw error;
						}
					}, openTimeoutMs);
				}
				const tab = await resolveTargetTab(args);
				return await withTabCommand(tab.id, async () => {
					try {
						return await openPdfInOnhandViewer({ ...args, tabId: tab.id });
					} catch (error) {
						const blocked = classifyBlockedNavigation(tab, error);
						if (blocked) throw new Error(`The PDF tab is blocked before it can load. ${blocked.detail}`);
						throw error;
					}
				});
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
						(await evaluateInTab(tab.id, `(${extractReadableContentInPage.toString()})(${JSON.stringify({ maxChars: args.maxChars, query: args.query })})`));
					content = await maybeGetDebuggerFrameReadableContent(tab, content, {
						maxChars: args.maxChars,
						query: args.query,
					});
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
		case "textbook_search": {
			if (typeof args.query !== "string" || !args.query.trim()) {
				throw new Error("textbook_search requires a non-empty 'query'");
			}
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				let search;
				const targetTab =
					args.waitForLoad === false
						? tab
						: await waitForTabComplete(
							tab.id,
							clampNumber(args.loadTimeoutMs, 12000, { min: 500, max: 60000 }),
						);
				try {
					const searchTimeoutMs = clampNumber(args.timeoutMs, 3500, { min: 800, max: 8000 });
					const readyTimeoutMs = clampNumber(args.readyTimeoutMs, 10000, { min: 0, max: 20000 });
					const evaluationTimeoutMs = searchTimeoutMs + readyTimeoutMs + 2500;
					search = await evaluateInTab(
						targetTab.id,
						`(${searchTextbookReaderInPage.toString()})(${JSON.stringify({
							query: args.query,
							maxResults: args.maxResults,
							openResult: args.openResult,
							resultIndex: args.resultIndex,
							timeoutMs: searchTimeoutMs,
							readyTimeoutMs,
						})})`,
						{ timeoutMs: evaluationTimeoutMs },
					);
				} catch (error) {
					if (isLocalFileAccessError(tab, error)) throw createLocalFileAccessError(tab, error);
					throw error;
				}
				return {
					tab: simplifyTab(await chrome.tabs.get(targetTab.id)),
					search,
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
					anchor: args.anchor,
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
		case "reopen_onhand_pdf_viewer": {
			// Internal session-restore command (no browser_* tool maps here, so the
			// model cannot reach it): reopen the Onhand viewer for a previously
			// annotated source recorded in the session. Trusting the stored URL is
			// what lets citation clicks revive a closed local-file viewer without
			// routing file:// through browser_navigate.
			const requestedViewerUrl = String(args.viewerUrl || "").trim();
			const requestedPdfUrl = String(args.pdfUrl || "").trim();
			let viewerUrl = "";
			if (requestedViewerUrl) {
				if (!isOwnExtensionPdfViewerUrl(requestedViewerUrl)) {
					throw new Error("reopen_onhand_pdf_viewer only accepts Onhand's own viewer URLs.");
				}
				viewerUrl = requestedViewerUrl;
			} else if (requestedPdfUrl && (isFileUrl(requestedPdfUrl) || isLikelyPdfResourceUrl(requestedPdfUrl))) {
				viewerUrl = buildOnhandPdfViewerUrl(requestedPdfUrl);
			}
			if (!viewerUrl) throw new Error("reopen_onhand_pdf_viewer requires a viewerUrl or pdfUrl.");
			const sourcePdfUrl = extractPdfSourceUrlFromViewerLikeUrl(viewerUrl) || requestedPdfUrl;
			if (isFileUrl(sourcePdfUrl) && !(await isAllowedFileSchemeAccess())) {
				throw new Error(localFileAccessMessage({ url: sourcePdfUrl }));
			}
			if (isFileUrl(sourcePdfUrl)) grantOnhandPdfViewerFileSource(sourcePdfUrl);
			let created = await chrome.tabs.create({
				url: isHttpsUrl(sourcePdfUrl) ? "about:blank" : viewerUrl,
				active: args.active !== false,
			});
			if (isHttpsUrl(sourcePdfUrl)) {
				grantOnhandPdfViewerCredentialedSource(created.id, sourcePdfUrl);
				created = await chrome.tabs.update(created.id, { url: viewerUrl });
			}
			const timeoutMs = clampNumber(args.timeoutMs, 20000, { min: 100, max: 120000 });
			const viewerReady = await safeWaitForInlineOnhandPdfViewerReady(created.id, timeoutMs, sourcePdfUrl);
			return {
				tab: simplifyTab(await chrome.tabs.get(created.id)),
				viewerUrl,
				pdfUrl: sourcePdfUrl,
				viewerReady,
				opened: true,
			};
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
				if (isGoogleDocsDocumentUrl(tab.url)) {
					return {
						tab: simplifyTab(tab),
						page: googleDocsCaptureStatePayload(tab),
					};
				}
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
				if (isGoogleDocsDocumentUrl(tab.url)) {
					const content = await extractGoogleDocsTextExportForTab(tab, { maxChars: args.maxChars });
					return {
						tab: simplifyTab(tab),
						visible: googleDocsVisibleTextPayloadFromExport(tab, content, {
							maxChars: args.maxChars,
							maxBlocks: args.maxBlocks,
						}),
					};
				}
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
				const jumpArgs = {
					pageNumber: args.pageNumber,
					page: args.page,
					text: args.text,
					occurrence: args.occurrence,
					pdfAnchor: args.pdfAnchor,
				};
				let jump = null;
				if (String(args.pdfAnchor?.viewer || "").toLowerCase() === "onhand-pdf-viewer") {
					try {
						jump = await withOperationTimeout(
							executePageToolkitMethodViaOnhandPdfViewerFrame(tab.id, "jumpToPdfPage", [jumpArgs], await getPageToolkitOptions(tab)),
							PDF_READER_FRAME_EXECUTION_TIMEOUT_MS,
							"Onhand PDF viewer frame toolkit timed out: jumpToPdfPage",
						);
					} catch (frameError) {
						if (!isMissingOnhandPdfViewerFrameError(frameError)) throw frameError;
					}
				}
				if (!jump) {
					jump = await runPageToolkitMethod(tab.id, "jumpToPdfPage", jumpArgs);
				}
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
				let pageSelection;
				try {
					pageSelection = await runPageToolkitMethod(tab.id, "getSelectionInfo");
				} catch (error) {
					if (!isRestrictedScriptingError(error) || !isLikelyNativeChromePdfSelectionTab(tab)) throw error;
					pageSelection = {
						surface: "pdf",
						viewer: "chrome-pdf-viewer",
						source: "native-chrome-pdf-viewer-restricted-main-frame",
						hasSelection: false,
						text: "",
						mainFrameSelectionError: error?.message || String(error),
					};
					}
					let selection = await maybeGetGoogleScholarReaderSelection(tab, pageSelection);
					selection = await maybeGetNativeChromePdfViewerSelection(tab, selection);
					selection = await maybeGetBrowserClipboardPdfSelection(tab, selection);
					selection = await maybeGetGoogleDocsClipboardSelection(tab, selection);
					selection = await maybeGetDebuggerFrameSelection(tab, selection);
					return {
						tab: simplifyTab(tab),
						selection,
					};
				});
			}
		case "get_viewport_headings": {
			const tab = await resolveReadTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				if (isGoogleDocsDocumentUrl(tab.url)) {
					const content = await extractGoogleDocsTextExportForTab(tab, { maxChars: 2000 });
					return {
						tab: simplifyTab(tab),
						headings: googleDocsViewportHeadingsPayloadFromExport(tab, content, {
							maxHeadings: args.maxHeadings,
						}),
					};
				}
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
		case "remove_annotations": {
			const annotationIds = (Array.isArray(args.annotationIds) ? args.annotationIds : [])
				.map((id) => String(id || "").trim())
				.filter(Boolean);
			if (!annotationIds.length) throw new Error("remove_annotations requires a non-empty 'annotationIds' array");
			const tab = await resolveTargetTab(args);
			return await withTabCommand(tab.id, async () => {
				const removed = await runPageToolkitMethod(tab.id, "removeAnnotations", annotationIds);
				return {
					tab: simplifyTab(tab),
					...removed,
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
	browser_list_tabs: "list_tabs",
	browser_activate_tab: "activate_tab",
	browser_navigate: "navigate",
	browser_find_elements: "find_elements",
	browser_click: "click",
	browser_click_text: "click_text",
	browser_open_pdf_in_onhand_viewer: "open_pdf_in_onhand_viewer",
	browser_pdf_search: "pdf_search",
	browser_pdf_read_pages: "pdf_read_pages",
	browser_pdf_jump_to_page: "pdf_jump_to_page",
	browser_pdf_capture_page_image: "pdf_capture_page_image",
	browser_pdf_find_citation: "pdf_find_citation",
	browser_get_visible_text: "get_visible_text",
	browser_get_visible_region_image: "get_visible_region_image",
	browser_extract_content: "extract_content",
	browser_textbook_search: "textbook_search",
	browser_get_selection: "get_selection",
	browser_get_viewport_headings: "get_viewport_headings",
	browser_get_scroll_state: "get_scroll_state",
	browser_highlight_text: "highlight_text",
	browser_show_note: "show_note",
	browser_scroll_to_annotation: "scroll_to_annotation",
	browser_clear_annotations: "clear_annotations",
});

const REALTIME_BROWSER_SELECTOR_COMMANDS = new Set([
	"activate_tab",
	"navigate",
	"find_elements",
	"click",
	"click_text",
	"open_pdf_in_onhand_viewer",
	"pdf_search",
	"pdf_read_pages",
	"pdf_jump_to_page",
	"pdf_capture_page_image",
	"pdf_find_citation",
	"get_visible_text",
	"get_visible_region_image",
	"extract_content",
	"textbook_search",
	"get_selection",
	"get_viewport_headings",
	"get_scroll_state",
	"highlight_text",
	"show_note",
	"scroll_to_annotation",
	"clear_annotations",
]);

function sanitizeRealtimeBrowserToolArgsForCommand(command, args = {}) {
	const sanitized = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
	if (!REALTIME_BROWSER_SELECTOR_COMMANDS.has(command)) {
		delete sanitized.tabId;
		delete sanitized.titleContains;
		delete sanitized.urlContains;
	}
	if (command === "navigate" || command === "open_pdf_in_onhand_viewer") {
		if (!Object.prototype.hasOwnProperty.call(sanitized, "newTab")) sanitized.newTab = false;
		if (sanitized.newTab === true && !Object.prototype.hasOwnProperty.call(sanitized, "active")) sanitized.active = false;
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
	if (message?.target === "offscreen" || message?.target === "sidebar") return false;
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

		if (message?.type === "debug:free-tier-bypass-state") {
			sendResponse(await freeTierBypassState("status"));
			return;
		}

		if (message?.type === "debug:set-free-tier-bypass") {
			const secret = String(message.secret || "").trim();
			if (secret.length < ONHAND_FREE_QUOTA_BYPASS_MIN_LENGTH) {
				sendResponse({
					ok: false,
					error: `Bypass secret must be at least ${ONHAND_FREE_QUOTA_BYPASS_MIN_LENGTH} characters.`,
				});
				return;
			}
			const expiresAt = String(message.expiresAt || "").trim();
			await chrome.storage.local.set({
				[ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY]: secret,
				...(expiresAt ? { [ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY]: expiresAt } : {}),
			});
			sendResponse(await freeTierBypassState("enable"));
			return;
		}

		if (message?.type === "debug:clear-free-tier-bypass") {
			await chrome.storage.local.remove([
				ONHAND_FREE_QUOTA_BYPASS_STORAGE_KEY,
				ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT_STORAGE_KEY,
			]);
			sendResponse(await freeTierBypassState("disable"));
			return;
		}

		if (message?.type === "pdf-viewer:authorize-file-source") {
			sendResponse({ ok: await authorizeOnhandPdfViewerFileSource(_sender, message.url) });
			return;
		}

		if (message?.type === "pdf-viewer:authorize-credentialed-source") {
			sendResponse({ ok: await authorizeOnhandPdfViewerCredentialedSource(_sender, message.url) });
			return;
		}

		if (message?.type === "pdf-viewer:load-authorized-source") {
			sendResponse({ ok: true, ...(await loadAuthorizedPdfBytesFromTab(_sender, message.url)) });
			return;
		}

		if (message?.type === "debug:fetch-turn-trace") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse(await runtime.getDebugTraces(message.limit));
			return;
		}

		if (message?.type === "browser-runtime:classify-intent-eval") {
			const runtime = getOnhandBrowserRuntime();
			sendResponse({
				ok: true,
				result: await runtime.classifyPromptIntentForEval(String(message.prompt || ""), {
					provider: typeof message.provider === "string" ? message.provider : undefined,
				}),
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
				experimentalModelLaneClassifier: message.experimentalModelLaneClassifier,
				codexFastModeEnabled: message.codexFastModeEnabled,
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
					// A fresh page capture shares the tab's serialized command queue
					// with the active turn's tool calls: state polling during a turn
					// stacked capture_state behind slow tool work, and every later
					// command's budget paid for the pileup (timeouts start at
					// enqueue). While a request is active, serve the last capture
					// instead of queueing a new one; idle polls reuse a capture
					// younger than the TTL. A cached capture is only served for the
					// tab it was taken on.
					const resolvedTabId = typeof state.tab?.id === "number" ? state.tab.id : null;
					const cachedTabId = typeof lastFetchStatePageCapture?.tab?.id === "number" ? lastFetchStatePageCapture.tab.id : null;
					const cacheMatchesTab =
						Boolean(lastFetchStatePageCapture) && (cachedTabId == null || resolvedTabId == null || cachedTabId === resolvedTabId);
					const cacheFresh = cacheMatchesTab && Date.now() - (lastFetchStatePageCapture.capturedAt || 0) < FETCH_STATE_PAGE_CAPTURE_TTL_MS;
					if (state.activeRequestId) {
						if (cacheMatchesTab) {
							state.tab = lastFetchStatePageCapture.tab || state.tab || null;
							state.page = lastFetchStatePageCapture.page || null;
						}
					} else if (cacheFresh) {
						state.tab = lastFetchStatePageCapture.tab || state.tab || null;
						state.page = lastFetchStatePageCapture.page || null;
					} else {
						const captured = await handleCommand("capture_state", { windowId: message.windowId });
						lastFetchStatePageCapture = { tab: captured?.tab || null, page: captured?.page || null, capturedAt: Date.now() };
						state.tab = captured?.tab || state.tab || null;
						state.page = captured?.page || null;
					}
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
			const allowedTools = new Set(["pdf_search", "pdf_read_pages", "pdf_jump_to_page", "pdf_capture_page_image", "pdf_find_citation"]);
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
			const response = await runtime.listSessions(typeof message.limit === "number" && Number.isFinite(message.limit) ? message.limit : undefined);
			sendResponse({
				ok: true,
				currentSession: response.currentSession,
				sessions: response.sessions,
				totalCount: response.totalCount,
				hasMore: response.hasMore,
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
					forceReload: true,
					includeDiagnostics: true,
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
	// Run the one-time classifier-default migration eagerly on install/update, so
	// it lands before the options page (which reads raw storage) is opened.
	getOnhandBrowserRuntime().getSettings().catch(() => {});
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
