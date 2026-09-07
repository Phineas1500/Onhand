const HEARTBEAT_MS = 20_000;

async function readClipboardText() {
	if (navigator.clipboard?.readText) {
		try {
			return await navigator.clipboard.readText();
		} catch {
			// Chromium's async Clipboard API requires focus, which an offscreen
			// document cannot receive. Extension clipboardRead permits Paste here.
		}
	}
	return (await readClipboardSnapshot()).text;
}

async function readClipboardSnapshot() {
	// A text read alone cannot distinguish an empty clipboard from an image.
	// Paste exposes the formats without changing the system clipboard and works
	// in this unfocused extension document with clipboardRead permission.
	const textarea = document.createElement("textarea");
	document.body.appendChild(textarea);
	let timeoutId;
	try {
		return await new Promise((resolve, reject) => {
			textarea.addEventListener("paste", (event) => {
				event.preventDefault();
				const data = event.clipboardData;
				if (!data) {
					reject(new Error("Clipboard paste did not expose data."));
					return;
				}
				const types = Array.from(data.types || [], (type) => String(type).toLowerCase());
				const text = data.getData("text/plain");
				const canRestoreTextOnly = data.types != null && !data.files?.length &&
					types.every((type) => type === "text/plain") && (!text || types.includes("text/plain"));
				resolve({ text, types, canRestoreTextOnly });
			}, { once: true });
			timeoutId = setTimeout(() => reject(new Error("Clipboard paste timed out.")), 1500);
			textarea.focus();
			if (!document.execCommand("paste")) reject(new Error("document.execCommand('paste') returned false."));
		});
	} finally {
		clearTimeout(timeoutId);
		textarea.remove();
	}
}

async function writeClipboardText(text) {
	const value = String(text ?? "");
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(value);
			return;
		} catch {
			// Use the extension's clipboardWrite permission without requiring focus.
		}
	}
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.left = "-10000px";
	textarea.style.top = "-10000px";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		if (!document.execCommand("copy")) throw new Error("document.execCommand('copy') returned false.");
	} finally {
		textarea.remove();
	}
}

function sendHeartbeat() {
	chrome.runtime
		.sendMessage({
			type: "offscreen-heartbeat",
			sentAt: Date.now(),
		})
		.catch(() => {});
}

sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_MS);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.target !== "offscreen") return false;
	(async () => {
		if (message?.type === "offscreen:clipboard-snapshot") {
			sendResponse({ ok: true, ...(await readClipboardSnapshot()) });
			return;
		}
		if (message?.type === "offscreen:clipboard-read") {
			sendResponse({ ok: true, text: await readClipboardText() });
			return;
		}
		if (message?.type === "offscreen:clipboard-write") {
			await writeClipboardText(message.text);
			sendResponse({ ok: true });
			return;
		}
		sendResponse({ ok: false, error: "Unknown offscreen message" });
	})().catch((error) => {
		sendResponse({ ok: false, error: error?.message || String(error) });
	});
	return true;
});
