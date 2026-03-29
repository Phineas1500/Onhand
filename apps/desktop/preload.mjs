import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("onhandApp", {
	getStartupState: () => ipcRenderer.invoke("onhand:get-startup-state"),
	refreshContext: () => ipcRenderer.invoke("onhand:refresh-context"),
	submitPrompt: (prompt) => ipcRenderer.invoke("onhand:submit-prompt", prompt),
	hideWindow: () => ipcRenderer.invoke("onhand:hide-window"),
	onFocusInput: (callback) => {
		const listener = () => callback();
		ipcRenderer.on("onhand:focus-input", listener);
		return () => ipcRenderer.removeListener("onhand:focus-input", listener);
	},
});
