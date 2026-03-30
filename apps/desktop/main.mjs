import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
	disposeOnhandAgent,
	getSessionOverview,
	startNewOnhandSession,
	submitOnhandPrompt,
	switchOnhandSession,
} from "./onhand-agent.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOTKEY = process.env.ONHAND_HOTKEY || "CommandOrControl+Shift+Space";
const CONFIG_FILE = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const FAST_TIMEOUT_MS = 2500;
const BLUR_HIDE_DELAY_MS = 120;
const HOTKEY_DEBOUNCE_MS = 300;
const WORKSPACE_VISIBILITY_SETTLE_MS = 60;
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

function log(...args) {
	console.log("[onhand-desktop]", ...args);
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

function isPrivilegedUrl(url) {
	return /^(?:chrome|edge|brave|about):\/\//i.test(String(url || ""));
}

async function getBrowserContext(options = {}) {
	const includeVisibleText = Boolean(options.includeVisibleText);
	const includeSelection = Boolean(options.includeSelection);

	try {
		const [health, stateData] = await Promise.all([
			bridgeRequest("/health", {}, FAST_TIMEOUT_MS),
			bridgeRequest("/state", {}, FAST_TIMEOUT_MS),
		]);
		const client = stateData.client;
		const activeTab = pickActiveTab(client?.state);
		const connectedClients = Array.isArray(health.connectedClients) ? health.connectedClients.length : 0;
		let visible = null;
		let selection = null;
		let warning = null;

		if (!connectedClients) {
			warning = "No connected browser clients.";
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
								timeoutMs: 1500,
							}),
						},
						2200,
					);
					selection = selectionData.result?.selection || null;
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
			activeTab,
			selection,
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

async function runPromptRequest(requestId, prompt) {
	sendPromptEvent({ type: "start", requestId, prompt });
	sendPromptEvent({ type: "status", requestId, status: "Collecting browser context…" });

	try {
		const browserContext = await getBrowserContext({ includeSelection: true, includeVisibleText: true });
		sendPromptEvent({ type: "context", requestId, context: browserContext });

		await submitOnhandPrompt({
			requestId,
			prompt,
			browserContext,
			onEvent: (event) => sendPromptEvent({ requestId, ...event }),
		});
	} catch (error) {
		sendPromptEvent({
			type: "error",
			requestId,
			message: error?.message || String(error),
		});
	}
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
		if (input.type === "keyDown" && input.key === "Escape") {
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
}));

ipcMain.handle("onhand:refresh-context", async () => {
	return await getBrowserContext();
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
	const normalizedPrompt = String(prompt || "").trim();
	if (!normalizedPrompt) {
		throw new Error("Prompt cannot be empty.");
	}
	const requestId = randomUUID();
	setTimeout(() => {
		void runPromptRequest(requestId, normalizedPrompt);
	}, 0);
	return { ok: true, requestId };
});

ipcMain.handle("onhand:hide-window", async (_event, options = {}) => {
	await hideWindow(options);
	return { ok: true };
});

app.whenReady().then(() => {
	if (process.platform === "darwin") {
		app.setActivationPolicy("accessory");
	}
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

app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	void disposeOnhandAgent();
});
