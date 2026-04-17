const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("onhandApp", {
	getStartupState: () => ipcRenderer.invoke("onhand:get-startup-state"),
	setLearningMode: (learningMode) => ipcRenderer.invoke("onhand:set-learning-mode", learningMode),
	refreshContext: () => ipcRenderer.invoke("onhand:refresh-context"),
	listSessions: (limit) => ipcRenderer.invoke("onhand:list-sessions", limit),
	newSession: () => ipcRenderer.invoke("onhand:new-session"),
	switchSession: (sessionPath) => ipcRenderer.invoke("onhand:switch-session", sessionPath),
	submitPrompt: (prompt) => ipcRenderer.invoke("onhand:submit-prompt", prompt),
	hideWindow: (options) => ipcRenderer.invoke("onhand:hide-window", options),
	onFocusInput: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("onhand:focus-input", listener);
		return () => ipcRenderer.removeListener("onhand:focus-input", listener);
	},
	onPaletteOpened: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("onhand:palette-opened", listener);
		return () => ipcRenderer.removeListener("onhand:palette-opened", listener);
	},
	onPromptEvent: (callback) => {
		const listener = (_event, payload) => callback(payload);
		ipcRenderer.on("onhand:prompt-event", listener);
		return () => ipcRenderer.removeListener("onhand:prompt-event", listener);
	},
});
