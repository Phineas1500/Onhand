import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOTKEY = process.env.ONHAND_HOTKEY || "CommandOrControl+Shift+Space";
const CONFIG_FILE = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const DEFAULT_TIMEOUT_MS = 15000;

let mainWindow = null;

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

async function bridgeRequest(path, init = {}) {
	const connection = await loadBridgeConnection();
	const headers = new Headers(init.headers || {});
	headers.set("Authorization", `Bearer ${connection.token}`);
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(`${connection.baseUrl}${path}`, {
		...init,
		headers,
	});
	const data = await response.json();
	if (!response.ok || data?.ok === false) {
		throw new Error(data?.error || `Bridge request failed: ${response.status}`);
	}
	return data;
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

async function getBrowserContext() {
	try {
		const health = await bridgeRequest("/health");
		const stateData = await bridgeRequest("/state");
		const client = stateData.client;
		const activeTab = pickActiveTab(client?.state);
		let visible = null;
		let warning = null;

		if (activeTab?.id && activeTab.url && !isPrivilegedUrl(activeTab.url)) {
			try {
				const visibleData = await bridgeRequest("/command", {
					method: "POST",
					body: JSON.stringify({
						name: "get_visible_text",
						args: { tabId: activeTab.id, maxChars: 3000, maxBlocks: 12 },
						timeoutMs: DEFAULT_TIMEOUT_MS,
					}),
				});
				visible = visibleData.result?.visible || null;
			} catch (error) {
				warning = error?.message || String(error);
			}
		} else if (activeTab?.url) {
			warning = `Visible context is unavailable on privileged pages like ${activeTab.url}`;
		}

		return {
			ok: true,
			hotkey: HOTKEY,
			bridge: {
				host: health.host,
				port: health.port,
				connectedClients: Array.isArray(health.connectedClients) ? health.connectedClients.length : 0,
			},
			clientId: client?.clientId,
			activeTab,
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

async function submitPrompt(prompt) {
	const context = await getBrowserContext();
	return {
		ok: true,
		prompt,
		timestamp: new Date().toISOString(),
		reply:
			"This is the first Onhand desktop shell. It can already inspect the current browser context, but prompt routing to the pi SDK and the full Onhand agent is the next step.",
		context,
	};
}

function sendFocusInput() {
	mainWindow?.webContents.send("onhand:focus-input");
}

function showWindow() {
	if (!mainWindow) return;
	mainWindow.show();
	mainWindow.focus();
	sendFocusInput();
}

function hideWindow() {
	if (!mainWindow) return;
	mainWindow.hide();
}

function toggleWindow() {
	if (!mainWindow) return;
	if (mainWindow.isVisible()) {
		hideWindow();
	} else {
		showWindow();
	}
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 920,
		height: 640,
		minWidth: 760,
		minHeight: 420,
		show: true,
		title: "Onhand",
		autoHideMenuBar: true,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		backgroundColor: "#0f172a",
		webPreferences: {
			preload: join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.loadFile(join(__dirname, "index.html"));
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	mainWindow.webContents.on("did-finish-load", () => {
		sendFocusInput();
	});
}

ipcMain.handle("onhand:get-startup-state", async () => ({
	hotkey: HOTKEY,
	version: app.getVersion(),
}));

ipcMain.handle("onhand:refresh-context", async () => {
	return await getBrowserContext();
});

ipcMain.handle("onhand:submit-prompt", async (_event, prompt) => {
	return await submitPrompt(String(prompt || "").trim());
});

ipcMain.handle("onhand:hide-window", async () => {
	hideWindow();
	return { ok: true };
});

app.whenReady().then(() => {
	createWindow();
	const registered = globalShortcut.register(HOTKEY, () => {
		toggleWindow();
	});
	if (!registered) {
		log(`Could not register global shortcut: ${HOTKEY}`);
	} else {
		log(`Registered global shortcut: ${HOTKEY}`);
	}
	log("Desktop shell ready");

	app.on("activate", () => {
		if (!mainWindow) createWindow();
		showWindow();
	});
});

app.on("will-quit", () => {
	globalShortcut.unregisterAll();
});
